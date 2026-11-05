# BUYBUDDY — Architecture

## 1. System overview

```
                    ┌──────────────────────────────┐
   Customer (phone) │  React 18 SPA (PWA)          │
   Shopper / Rider  │  web/ — Vite, hash router    │
   Merchant         │  role-gated routes + shells  │
   Admin            └───────────────┬──────────────┘
                                    │  JSON over HTTPS  (Bearer JWT)
                    ┌───────────────▼──────────────┐
                    │  Node.js 20 + Express API    │
                    │  server/ — 121 REST routes   │
                    │  ┌────────────────────────┐  │
                    │  │ auth / RBAC middleware │  │
                    │  │ pricing engine         │  │
                    │  │ order state machine    │  │
                    │  │ payments adapter       │  │
                    │  │ notifications + audit  │  │
                    │  └────────────────────────┘  │
                    └───┬───────────┬──────────┬───┘
                        │           │          │
             ┌──────────▼──┐  ┌─────▼─────┐  ┌─▼───────────────┐
             │ PostgreSQL  │  │ Paystack  │  │ Maps · FCM · SMS│
             │ (SQLite in  │  │ (sandbox  │  │ (adapters, keys │
             │ this repo)  │  │ in repo)  │  │  by env var)    │
             └─────────────┘  └───────────┘  └─────────────────┘
```

Single-origin deployment: the API also serves `web/dist`, so one process and one URL run the whole
platform. The SPA can be hosted separately by setting `VITE_API_URL`.

## 2. Repository layout

```
buybuddy/
├── server/
│   ├── src/
│   │   ├── index.js            # entrypoint (dotenv + listen)
│   │   ├── app.js              # express app, static hosting, error handler
│   │   ├── seed.js             # realistic Lagos marketplace seed
│   │   ├── lib/
│   │   │   ├── db.js           # connection + full schema + reset/migrate
│   │   │   ├── auth.js         # bcrypt, JWT, OTP, revocation
│   │   │   ├── orders.js       # ★ state machine, pricing, assignment, settlement
│   │   │   ├── payments.js     # ★ Paystack adapter, webhook, idempotency, refunds
│   │   │   ├── settings.js     # runtime config, notifications, wallet, audit
│   │   │   └── util.js         # ids, money, phone normalisation, errors
│   │   └── routes/
│   │       ├── accounts.js     # auth, profile, addresses, wallet, support, reviews
│   │       ├── catalog.js      # home, search, stores, products, favourites, promos
│   │       ├── cart.js         # cart + live quote
│   │       ├── orders.js       # checkout, shop-for-me, approvals, tracking, messages
│   │       ├── worker.js       # shopper/rider jobs, receipts, delivery, earnings
│   │       ├── merchant.js     # store, catalogue, order fulfilment, settlements
│   │       └── admin.js        # every admin module
│   ├── test/api.test.js        # 12 integration tests (real HTTP, seeded DB)
│   └── .env.example
├── web/
│   ├── src/
│   │   ├── App.jsx             # routes + role shells + guards
│   │   ├── styles.css          # design system (tokens + components)
│   │   ├── lib/{api,ui}.jsx    # fetch client, auth/cart contexts, component library
│   │   ├── components/Shell.jsx
│   │   └── screens/            # Auth, customer/*, Worker, Merchant, Admin
│   └── index.html
├── docs/                       # proposal, scope, architecture, API, security, deployment
└── scripts/push-to-github.sh   # create + push the repo under the client's account
```

## 3. Data model (33 tables)

```
users(id, role, name, email, phone, password_hash, status, token_version, …)
  ├── addresses            delivery points (lat/lng, landmark notes, default flag)
  ├── worker_profiles      shopper/rider: roles, service areas, docs, verified, bank
  ├── merchant_profiles    business_name, CAC, docs, verified, bank
  ├── stores               merchant_id → one store per merchant at launch
  │     └── products       price, compare_at, stock, category, image
  ├── cart_items           product_id + qty (single-store invariant)
  ├── favourites
  ├── orders               ★ the spine of the system
  │     ├── order_items        merchant order lines (price snapshot)
  │     ├── shopping_items     personal-shopping lines (requested → proposed → approved)
  │     ├── order_events       immutable timeline of every transition
  │     ├── receipts           base64 store receipts / proof of delivery
  │     ├── messages           per-order chat
  │     ├── payments           one row per gateway attempt (unique reference)
  │     └── job_offers         offers extended to workers (unique per order+worker+role)
  ├── wallet_entries       append-only ledger with balance_after
  ├── payouts              withdrawal requests with review states
  ├── notifications
  ├── support_tickets ─ support_messages
  ├── reviews              store / shopper / rider ratings
  ├── otp_codes, password_resets
  └── audit_logs           every privileged action, with actor + IP

settings(key,value)          runtime platform configuration
categories, promos, marketing_banners, campaigns
```

**Money is stored as integer Naira** everywhere (no floats, no kobo in the DB). Paystack converts to
kobo only at the adapter boundary.

## 4. Order state machine

Every status change goes through `transition()` in `server/src/lib/orders.js`, which enforces:
(a) the target status is reachable from the current one, (b) the acting role is allowed to make that
move, (c) an `order_events` row is written, (d) the right party is notified.

**Merchant order**

```
pending_payment → paid → accepted → preparing → ready_for_pickup
                                                    ↓
                            rider_assigned → picked_up → in_transit → delivered → completed
Any pre-delivery state → cancelled (stock restored; payment refunded)
```

**Personal-shopping order**

```
pending_payment → paid → open_for_shoppers → shopper_assigned → shopping
      → awaiting_approval → approved → purchased → ready_for_delivery
      → rider_assigned → picked_up → in_transit → delivered → completed
```

Guard rails implemented and tested:

* `pending_payment → open_for_shoppers` happens **only** from the payment confirmation path (server),
  never from a client request.
* `awaiting_approval → approved` requires every proposed item to be decided and recomputes
  `subtotal`/`service_fee`/`tax`/`total` from **approved items only**. Any increase sets
  `payment_status = pending` and requires an adjustment payment before the shopper may buy.
* `delivered` requires the customer's 4-digit PIN (or an admin override that is audit-logged).
* `completed` triggers `settleOrder()` exactly once (guarded by a settlement ledger check).
* Illegal jumps (tested: `paid → completed`) return `400`.

## 5. Pricing engine

`calcFees({ subtotal, type, serviceLevel, distanceKm, promo })` reads the `settings` table, so ops can
change fees without a deploy:

```
service_fee   = round(subtotal × fee%) + flat          (merchant vs personal rates differ)
delivery_fee  = base + per_km × clamp(distance, 0, 40) + express surcharge
discount      = percent (capped) | fixed | free_delivery   (promo min-subtotal enforced)
VAT           = (service_fee + delivery_fee) × vat%
total         = subtotal + service_fee + delivery_fee + VAT − discount
```

`distanceKm` comes from `distanceFor()` — a deterministic stand-in today; swap in Google Distance
Matrix without touching callers.

Settlement on completion:

* merchant order → merchant credited `subtotal − commission_rate × subtotal`
* personal order → shopper credited `shopper_commission_percent × shopper_fee`; rider credited the
  delivery fee
* platform revenue = service fees + merchant commission (surfaced separately from GMV in admin, per
  brief §6.1 "clearly distinguished")

## 6. Payments and idempotency

```
POST /orders/checkout { Idempotency-Key }
   └── order created (unique idempotency_key) → initPayment()
         ├── wallet : debit ledger → markOrderPaid()
         ├── cash   : COD flag    → markOrderPaid()
         └── card   : payments(pending, unique reference)
                      → Paystack initialize (or sandbox URL)
                      → browser returns → POST /payments/:ref/verify (server → provider)
                      → webhook charge.success (HMAC-SHA512 verified)
                      → completePayment()  ← idempotent: second call is a no-op
```

* No client-side success screen is trusted; the return page re-verifies server-side.
* A duplicated webhook cannot create a second paid order (`completePayment` short-circuits when the
  payment row is already `success`).
* Replaying the same `Idempotency-Key` returns the original order instead of charging again (tested).

## 7. Job assignment

`offerJob()` fans an order out to verified, available workers in the right city/role.
`acceptJob()` runs in a transaction with a conditional update:

```sql
UPDATE orders SET shopper_id = ?, status = 'shopper_assigned'
WHERE id = ? AND status = 'open_for_shoppers' AND shopper_id IS NULL
```

If `changes !== 1` the worker lost the race and receives a friendly "just taken" error. Competing
offers are expired in the same transaction. Tested with two riders accepting the same job.

## 8. Security model

| Concern | Implementation |
|---|---|
| Passwords | bcrypt, cost 10 |
| Tokens | JWT (HS256), 7-day TTL, `iss` checked, `token_version` for instant revocation |
| Authorisation | `requireAuth` / `requireRole` middleware **plus** per-object ownership checks (`canAccessOrder`) |
| Merchant isolation | every merchant query filtered by `merchant_id` |
| Webhooks | raw-body HMAC-SHA512 compared to `x-paystack-signature` |
| Input validation | required-field checks, type/range coercion, phone normalisation, file MIME + size caps |
| Secrets | environment only; `.env` git-ignored; nothing privileged in the web bundle |
| Audit | `audit_logs` on admin actions, refunds, status changes, 4xx/5xx |
| Money | integer Naira; settlement guarded against double credit |

## 9. Scaling path

| Stage | Change |
|---|---|
| Now (demo/dev) | 1 process, SQLite, polling |
| Launch (≤50k orders/mo) | Postgres, 2 API instances behind a load balancer, Redis for sessions/rate limits, object storage for images, worker for notifications via queue |
| Growth | read replicas, partition `orders`/`order_events` by month, WebSocket gateway for tracking, search index (Meilisearch/Typesense) replacing `LIKE` queries, CDN for product images |
| Multi-country | `currency` column already present; add `country`/`locale` to settings, tax + provider config per country, per-country delivery zones |

The only change required to run on Postgres is the driver + placeholder style (`?` → `$n`) and a
`SERIAL`/identity pass over the schema, both scripted in `docs/DEPLOYMENT.md`.

## 10. Key design decisions & trade-offs

1. **One API, four role experiences.** Less code, one source of truth for rules; the cost is that
   heavy admin screens ship in the customer bundle (mitigated by route-level code splitting later).
2. **Explicit state machine over ad-hoc status writes.** More code up front, but no "how did this
   order get to completed?" incidents — the single most expensive class of marketplace bug.
3. **Settings as data.** Fees, COD, wallet, offer radius, cancellation window are runtime config, so
   commercial experiments don't need releases.
4. **Ledger, not balance columns.** `wallet_entries.balance_after` makes every Naira reconcilable;
   balance is derived.
5. **Sandbox-first payments.** The whole payment lifecycle is testable without a merchant account,
   which is why this repo is demonstrable today.
6. **SQLite here, Postgres in production.** Deliberate: the deliverable had to boot with zero
   infrastructure. The data layer is the single place to change.
