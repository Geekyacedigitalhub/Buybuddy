<div align="center">

# 🛍️ BUYBUDDY

**Your Personal Shopping Partner**

An all-in-one shopping, personal-shopper and on-demand delivery marketplace for Nigeria —
built as one API with four connected experiences: **customer**, **shopper/rider**, **merchant**
and **admin**.

`Node.js` · `Express` · `React 18` · `Vite` · `SQLite → PostgreSQL` · `Paystack` · `NGN`

</div>

---

## What this is

This repository is a **working implementation** of the BUYBUDDY development brief — not a mock-up.
Everything below runs against a real database with real business rules:

| Role | What you can actually do in the app |
|---|---|
| 📱 **Android app** | Signed `.apk` in Releases, own icon + splash, bundled offline, runtime server-address setup, hardware back button. iOS builds from a Mac |
| 📱 **Installable (PWA)** | PWA manifest, maskable icons, service worker with an offline shell, in-app **Install** button + home-screen banner, and long-press shortcuts to *Shop for me* / *My orders* / *Rewards* |
| 🛍️ **Customer** | Earn **loyalty points** on every completed order and spend them at checkout, invite friends with a **referral code** (both sides paid), **schedule a delivery** up to 7 days ahead, **save a shopping list** and reorder in one tap, browse 10 categories / 10 stores / 60+ products, search & filter, cart (single-store rule), checkout with promo codes and a full fee breakdown, pay by card (sandbox), wallet or cash, build a **"Shop for me"** request with photos and a budget, approve or reject each substitution, track the rider on a map, chat, use a delivery PIN, rate, reorder, manage a wallet and support tickets |
| 🛒 **Shopper** | Go online, receive offers, accept (atomically — two shoppers cannot take the same job), work the shopping list capturing prices and substitutions, submit the basket for approval, upload the store receipt, hand to a rider, track earnings and request withdrawals |
| 🛵 **Rider** | Accept delivery offers, pickup → in transit → deliver with the customer's 4-digit PIN (wrong PIN is rejected), attach proof photos, see earnings per delivery |
| 🏪 **Merchant** | Manage a store, full product catalogue + stock, accept/prepare/reject orders (rejection restores stock and refunds), toggle open/closed, view settlements net of commission |
| 🛡️ **Admin** | KPIs with GMV **separated from** platform revenue, order management with assignment override and refunds, approve merchants, verify shoppers/riders, suspend accounts (revokes sessions), payouts, promos, banners, push broadcasts, every fee as live config, support inbox, and an audit log of every privileged action |

**A real Android app.** The `mobile/` folder builds an installable `.apk`
(Capacitor shell around the same React app) — download it from
[Releases](https://github.com/Geekyacedigitalhub/Buybuddy/releases), install it, enter your
server address once. See [`mobile/README.md`](mobile/README.md).

**Installable on a phone as a PWA too.** BUYBUDDY is a PWA — open it on Android Chrome or iPhone Safari and
add it to the home screen, full-screen, with launcher shortcuts and an offline shell. One guide:
[`docs/MOBILE_INSTALL.md`](docs/MOBILE_INSTALL.md). No store review needed.

**Design:** forest green `#176B55`, white, `#F5F7F4` background, warm orange `#E4792F` accent, custom
shopping-bag logo mark — per brief §8. Mobile-first for the apps, desktop layouts for the dashboards.

---

## Quick start (60 seconds)

```bash
git clone <this-repo> buybuddy && cd buybuddy
npm install
npm run seed -w server        # builds the database + realistic Lagos demo data
npm run build -w web
npm start                     # → http://localhost:4000
```

Then sign in with any demo account (**local dev password: `Password123!`** — a production server ignores this and uses whatever `SEED_PASSWORD` is set to, so a live site never accepts a password printed in a README):

| Account | Role | Lands on |
|---|---|---|
| `customer@buybuddy.ng` | Customer | Storefront |
| `shopper@buybuddy.ng` | Shopper (verified) | Shopper app |
| `rider@buybuddy.ng` | Rider (verified) | Rider app |
| `merchant1@buybuddy.ng` | Merchant (GreenMart) | Merchant portal |
| `admin@buybuddy.ng` | Admin | Admin dashboard |
| `pending.merchant@buybuddy.ng` | Merchant awaiting approval | — |
| `pending.worker@buybuddy.ng` | Shopper awaiting verification | — |

> **Sandbox payments are on by default.** With no Paystack keys configured, checkout opens a built-in
> test gateway so you can complete the whole money path. Add `PAYSTACK_SECRET_KEY` to
> `server/.env` and set `PAYSTACK_MOCK=false` to use real Paystack.

### Try the two flows that matter most

1. **Merchant order:** add groceries → checkout (wallet or card) → sign in as `merchant1@buybuddy.ng`
   → accept + mark ready → sign in as `rider@buybuddy.ng` → accept, pickup, in transit → as the
   customer, grab the delivery PIN from the order → deliver → confirm → watch the rider get paid.
2. **Shop for me:** send a request with a photo and a budget → as `shopper@buybuddy.ng` accept it,
   enter prices, mark one item unavailable, submit for approval → as the customer approve one item and
   reject another → see the basket total recompute to **approved items only**. Nothing can be charged
   without that approval — enforced server-side.

---

## Testing

```bash
npm test
```

20 integration tests run against a throwaway database and the real HTTP server — including the full
merchant lifecycle, substitution approval, idempotent checkout replay, double-acceptance prevention,
wrong-PIN rejection, webhook signature validation, role-based access control, **loyalty earn / redeem /
refund**, **referral payout exactly once**, **scheduled-delivery validation**, **saved-list CRUD**,
**rate limiting (429)**, the **`/api/ready`** probe, and the **PWA install contract**
(manifest, icons, service-worker scope and no-cache headers).

```
# tests 20   # pass 20   # fail 0
```

---

## Architecture at a glance

```
React 18 SPA (customer · shopper/rider · merchant · admin)
        │  JSON + JWT
        ▼
Express API — 131 routes
  ├── role-based auth + per-object ownership checks
  ├── rate limiting, security headers, structured request logs
  ├── loyalty ledger · referrals · scheduled deliveries · saved lists
  ├── pricing engine (fees/VAT/promos, all configurable at runtime)
  ├── order state machine (explicit transitions, immutable event log)
  ├── job assignment (atomic single-winner acceptance)
  ├── payments adapter (Paystack + sandbox, HMAC webhooks, idempotency)
  └── settlement + wallet ledger
        │
        ▼
SQLite (dev/CI) → PostgreSQL (production) · 33 tables
           ├── migrations/001_init.postgres.sql  (generated, idempotent)
           └── litestream continuous backup
```

Deep dives: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) ·
[`docs/API.md`](docs/API.md) · [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)

---

## Documentation

| Document | What's in it |
|---|---|
| [`docs/PROPOSAL.md`](docs/PROPOSAL.md) | **The written proposal the brief demands (§16):** architecture with reasons, MVP split, itemised cost by milestone (₦23.3m–₦33.8m), 29-week timeline, third-party costs, testing/security plan, warranty & maintenance pricing, IP terms, acceptance criteria, risks |
| [`docs/MVP_SCOPE.md`](docs/MVP_SCOPE.md) | Every brief requirement mapped to **Built / MVP / Release 2 / Optional / Client-side** — the honest scorecard |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System diagram, data model, state machines, pricing, payments, scaling path, trade-offs |
| [`docs/API.md`](docs/API.md) | All 131 endpoints with bodies, statuses and error codes |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Environments, env vars, Docker/VPS/PaaS, Paystack go-live checklist, backups, store submission, ops runbook |
| [`docs/MOBILE_INSTALL.md`](docs/MOBILE_INSTALL.md) | How to put it on a phone: one-click hosting, Android/iPhone install steps, and the store-binary path |
| [`docs/POSTGRES_MIGRATION.md`](docs/POSTGRES_MIGRATION.md) | The SQLite → Postgres path: what is already generated, type mapping, driver adapter, transaction conversion, data import, rollback, checklist |
| [`docs/SECURITY.md`](docs/SECURITY.md) | What is hardened today and the 8 things that must land before public launch |
| [`docs/TESTING.md`](docs/TESTING.md) | The automated suite, plus a manual UAT script per role and the M7 test plan |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Conventions — money as integers, no direct status writes, audit every privileged action |

---

## Honest status against the brief

**Built and working:** the entire marketplace loop (browse → pay → fulfil → track → settle), personal
shopping with per-item approval, worker onboarding & verification, merchant portal, admin dashboard,
audit logging, wallet ledger, support tickets, 12 automated tests.

**Deliberately not in this repo** (each one is a client-side dependency, not a shortcut):

* **Native Android/iOS builds** — the mobile client is an installable responsive PWA. Flutter is
  quoted separately in the proposal (+6–8 weeks, +₦4m–₦7m).
* **Live money movement** — needs the client's approved Paystack account and KYC.
* **Live GPS streaming** — the tracking UI, endpoints and ETA model exist; the position source is
  simulated until a Maps key and a native shell are in place.
* **SMS/FCM delivery** — provider credentials required; codes and notifications are persisted and
  logged in development.
* **Pharmacy compliance** (prescription checks, restricted-product blocklist) — **required by law
  before selling pharmacy items**; ship it or disable the category at launch.

**Before public launch, five things must be true:** live payment keys · Postgres with a rehearsed
restore · real supply of merchants and riders · a legal pack (privacy, T&Cs, contractor agreements) ·
pharmacy compliance. See [`docs/PROPOSAL.md`](docs/PROPOSAL.md) §13.

---

## Repository map

```
server/             Express API, schema, seed, 12 integration tests
web/                React SPA (customer, worker, merchant, admin)
docs/               Proposal, scope matrix, architecture, API, security, deployment, testing
scripts/            push-to-github.sh — creates the repo under your account and pushes
.github/workflows/  CI: seed → test → build on every push
Dockerfile          Single image serving API + built SPA
```

## Pushing this to GitHub

The code is committed locally. To publish it under **your** account:

```bash
gh auth login                      # or: export GITHUB_TOKEN=...
./scripts/push-to-github.sh <your-github-username> buybuddy --private
```

Without the CLI or a token, push manually:

```bash
git remote add origin https://github.com/<your-username>/buybuddy.git
git branch -M main
git push -u origin main
```

---

<div align="center">

**BUYBUDDY** — anything you need, delivered by a buddy.

*Lagos, Nigeria · Naira · Payments verified server-side, never in the app.*

</div>
