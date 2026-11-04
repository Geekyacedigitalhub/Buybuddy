# BUYBUDDY — MVP scope matrix

Maps **every** requirement in the development brief to a decision: **Built** (working in this repo),
**MVP** (launch scope, to be completed before go-live), **R2** (release 2), **Optional**, or
**Client** (a client/legal/operational responsibility, not a software deliverable).

Legend: ✅ built · 🟡 partially built · ⬜ not started · 👤 client-side dependency

---

## 3. Customer application

| Requirement | Status | Notes / where |
|---|---|---|
| 3.1 Phone / email signup & login | ✅ | `POST /api/auth/register`, `/auth/login`, email **or** Nigerian phone |
| 3.1 Social login | 🟡 | Interface designed; needs Google/Apple client IDs (R2) |
| 3.1 OTP phone verification | ✅ | 6-digit, 10-min expiry, single-use; SMS provider pluggable (Termii). `000000` in sandbox |
| 3.1 Password recovery | ✅ | Token-based reset with 30-min expiry and session revocation |
| 3.1 Profile management | ✅ | Name, email, area, city, avatar |
| 3.1 Saved addresses & location | ✅ | Multiple addresses, default flag, landmark notes, lat/lng |
| 3.1 Session security | ✅ | JWT + `token_version` revocation, suspension kills sessions |
| 3.2 Homepage: logo, location, search "What do you need today?" | ✅ | `/#/` |
| 3.2 Promo banners, categories, popular stores, recommendations, deals, recent | ✅ | `/api/home` returns all in one call |
| 3.2 "Shop for me" shortcut | ✅ | Hero + card + bottom-nav CTA |
| 3.3 Ten shopping categories | ✅ | Seeded, admin-manageable |
| 3.4 Search products/categories/stores | ✅ | `/api/search`, keyword + category match |
| 3.4 Filters & sort | ✅ | Category, price range, in-stock, popularity, rating, newest |
| 3.4 Product detail: photos, description, price, stock, merchant | ✅ | Includes reviews and related products |
| 3.4 Cart & favourites | ✅ | Single-store cart rule with conflict prompt; favourites toggle |
| 3.4 Fulfilment estimates | ✅ | Store prep time + delivery estimate shown |
| 3.5 Shop-for-me: description or list | ✅ | Multi-item list builder (up to 40 items) |
| 3.5 Photo / document upload | ✅ | Base64 → `/api/uploads`, validated type & size (5 MB) |
| 3.5 Brand/size/colour preferences | ✅ | Per-item preference note |
| 3.5 Preferred store or shopper's choice | ✅ | Optional `store_id`; else shopper decides |
| 3.5 Budget & special instructions | ✅ | Budget is enforced as a soft limit with approval |
| 3.5 Address & service level | ✅ | Standard / express |
| 3.5 Status updates | ✅ | Every transition logged + notified |
| 3.5 Review proposed items, prices, receipt, substitutions | ✅ | Per-item approve/reject UI |
| 3.5 Approve/reject substitutions & price changes before purchase | ✅ | **Hard rule: `approved_subtotal` is the only amount ever settled** |
| 3.5 Shopper records unavailable items, photos, receipts | ✅ | Item status + receipts table |
| 3.5 Approval history preserved, no silent charging | ✅ | `order_events` + payment adjustments required for increases |
| 3.6 Cart add/remove/update | ✅ | Server-side quantity caps & stock checks |
| 3.6 Promo/referral codes | 🟡 | Promo codes ✅; referral codes R2 |
| 3.6 Full fee breakdown before payment | ✅ | Subtotal, service, delivery, VAT, discount, total |
| 3.6 Address & payment selection | ✅ | Inline address creation |
| 3.6 Order reference & receipt | ✅ | `BB-XXXXXXX` code + receipts view |
| 3.7 Paystack and/or Flutterwave | 🟡 | Paystack adapter + sandbox complete; **live keys = client account** 👤 |
| 3.7 Card, bank transfer, cash-on-delivery toggle | ✅ | COD is an admin setting |
| 3.7 Wallet (if fully specified) | ✅ | Ledger with balance-after, top-up, refunds, no customer withdrawals (deliberate) |
| 3.7 Server-side verification via webhook + verify API | ✅ | HMAC-SHA512 signature check, `/payments/:ref/verify` |
| 3.7 Never trust client success screen | ✅ | Sandbox return page re-verifies on the server |
| 3.7 Prevent duplicate charges/orders (idempotency) | ✅ | `Idempotency-Key` on checkout, unique payment reference, idempotent `completePayment` |
| 3.7 Auditable records & reconciliation tools | ✅ | `payments` table + admin finance view; CSV export R2 |
| 3.7 Failed/pending/reversed/refunded handling | ✅ | Refund endpoint, status transitions, wallet credit on wallet refunds |
| 3.8 Order status + timeline | ✅ | Immutable `order_events` rendered as a timeline |
| 3.8 Assigned shopper/rider shown | ✅ | Name, area, message button |
| 3.8 Map-based live tracking | 🟡 | UI + `/tracking` endpoint + ETA built; **GPS source simulated** until native/Maps key |
| 3.8 Contact via in-app messaging | ✅ | Threaded per order; phone call link masked by policy |
| 3.8 Notifications | ✅ | In-app notifications on every meaningful transition; FCM push R2 (device tokens) |
| 3.8 Order history, receipts, reorder | ✅ | Reorder restores an available subset into the cart |
| 3.8 Cancel only when allowed by state/policy | ✅ | State-machine + configurable window |
| 3.8 Report problems, request refunds, rate orders | ✅ | Support tickets, refund workflow, ratings for store/shopper/rider |
| 3.9 In-app chat / tickets / complaints / FAQ | 🟡 | Chat + tickets + admin inbox ✅; FAQ content page R2 |
| 3.9 Case status & resolution history | ✅ | Ticket statuses + resolution text + audit |

## 4. Shopper & rider application

| Requirement | Status | Notes |
|---|---|---|
| 4.1 Registration: name, phone, email, photo | ✅ | Plus vehicle/plate for riders |
| 4.1 Identity/eligibility verification, documents | ✅ | Document flags stored; **admin approval gate enforced server-side** |
| 4.1 Address & service area | ✅ | `service_areas`, `service_city` |
| 4.1 Bank/payout details stored securely | 🟡 | Stored; encryption-at-rest of account numbers via KMS before launch |
| 4.1 Consent & privacy notices | 👤 | Copy must be reviewed by client counsel |
| 4.2 Available/accepted/active/completed tasks | ✅ | Worker dashboard |
| 4.2 Earnings, balances, withdrawal history | ✅ | Wallet ledger + payout requests |
| 4.2 Accept/reject eligible requests | ✅ | Offer list with **atomic single-winner acceptance** |
| 4.2 See list, photos, budget, store, instructions | ✅ | Task detail screen |
| 4.2 Communicate with customers | ✅ | Per-order messaging |
| 4.2 Record items, quantities, prices, substitutions | ✅ | Per-item modal |
| 4.2 Request customer approval on change | ✅ | Submit-basket flow |
| 4.2 Upload receipts & proof of shopping | ✅ | Receipts with amount |
| 4.2 Hand over to rider or self-deliver | ✅ | Auto-offers riders; shopper can deliver |
| 4.3 Rider offers by area/availability/distance | 🟡 | Area + availability + rating ranking; **distance ranking needs Maps key** |
| 4.3 Accept/reject, pickup & destination details | ✅ | |
| 4.3 Open navigation | ⬜ | Deep links to Google/Apple Maps (1 day, R2) |
| 4.3 Pickup / in-transit / delivered statuses | ✅ | |
| 4.3 Contact customer via platform | ✅ | |
| 4.3 Proof of delivery (PIN, signature, photo) | 🟡 | PIN enforced ✅, photo ✅, signature pad R2 |
| 4.3 Completed deliveries & earnings | ✅ | |
| 4.4 Daily/weekly/monthly earnings, gross/fees/commission | ✅ | Summary + line items |
| 4.4 Available vs pending balances | 🟡 | Available ✅; "pending" is an estimate until settlement rules are agreed |
| 4.4 Withdrawal requests & status | ✅ | Request → approve → pay, with admin controls |
| 4.4 Admin payout review, limits, reconciliation | 🟡 | Review + pay ✅; per-worker limits & export R2 |

## 5. Merchant portal

| Requirement | Status |
|---|---|
| Registration, business info, document submission | ✅ |
| Store profile, logo, hours, service area | ✅ |
| Product create/edit/photo/description/variants/pricing | 🟡 (variants R2) |
| Inventory & availability | ✅ |
| Order notifications, accept/reject | ✅ |
| Preparation & fulfilment status | ✅ |
| Sales, commissions, settlements, transactions | ✅ |
| Promotions participation | 🟡 (platform-wide promos ✅; merchant-funded promos R2) |
| Reports & customer ratings | 🟡 (7-day revenue chart + ratings ✅; CSV export R2) |
| Admin-controlled onboarding; store isolation | ✅ (every merchant query is scoped by `merchant_id`) |

## 6. Admin dashboard

| Module | Status |
|---|---|
| 6.1 KPIs: customers, merchants, shoppers, riders, active/completed/cancelled/disputed, GMV vs revenue, recent activity | ✅ |
| 6.1 Filters by date/status/type (location filter R2) | 🟡 |
| 6.2 Customer management: view, complaints, suspend with reason | ✅ |
| 6.2 Merchant management: approve, verify, suspend, audit trail | ✅ |
| 6.2 Shopper/rider management: verify, reject, restrict, payout eligibility | ✅ |
| 6.2 Order management: search, assign/reassign, monitor, resolve, refund | ✅ |
| 6.2 Financial management: payments, refunds, commissions, settlements, fees, payouts, exports | 🟡 (exports R2) |
| 6.2 Marketing: banners, promos, featured stores, targeted push | 🟡 (banners/promos/push ✅; featured slots R2) |
| 6.2 Platform settings: zones, hours, fees, commissions, min order, cancellation rules, payment toggles, categories | 🟡 (all fee/payment/order settings ✅; multi-zone polygons R2) |
| 6.3 Role-based permissions + recorded admin actions | 🟡 (single admin role ✅ + audit log; granular role editor R2) |

## 7. Order management & workflows

| Requirement | Status |
|---|---|
| 7.1 Merchant workflow steps 1–9 | ✅ (all transitions implemented and tested) |
| 7.2 Personal-shopping workflow steps 10–19 | ✅ (approval, adjustment payment, receipt, settlement) |
| 7.3 Offer rules: area, availability, distance, eligibility | 🟡 (distance scoring R2) |
| 7.3 Admin override of assignment | ✅ |
| 7.3 Prevent multiple acceptances | ✅ (conditional UPDATE, tested with two riders) |
| 7.3 Timeouts, reassignment, cancellation behaviour | 🟡 (reassignment/cancellation ✅; automatic offer expiry job R2) |
| 7.3 Timestamped event history | ✅ |
| 7.3 Explicit, validated state transitions | ✅ (transition table in `server/src/lib/orders.js`) |
| 7.3 Notify affected users on status change | ✅ |

## 8. Design & UX

| Requirement | Status |
|---|---|
| Brand name, slogan, palette, logo direction | ✅ |
| Clean layouts, readable type, accessible contrast | ✅ (AA contrast on core surfaces; formal audit R2) |
| High-quality photography | 🟡 (placeholder art; **client photography budget recommended**) |
| Consistent components | ✅ (`styles.css` design system) |
| Loading / empty / error / success states | ✅ |
| Responsive phone + dashboard | ✅ |
| Restrained animations | ✅ |
| Light & dark mode | ⬜ (R2 — tokens ready) |
| Text scaling & screen-reader labels | 🟡 (labels/aria on controls; full audit R2) |

## 9. Technical architecture

| Requirement | Status |
|---|---|
| Documented, maintainable, scalable architecture | ✅ (`ARCHITECTURE.md`) |
| Secure auth, password handling, recovery | ✅ |
| RBAC + server-side authorisation everywhere | ✅ |
| Encryption in transit + at-rest protection | 🟡 (TLS at the edge; at-rest PII encryption before launch) |
| Webhook signature validation, idempotency | ✅ |
| Concurrency controls | ✅ (atomic job acceptance, transactional checkout) |
| Realtime with fallback/reconnection | 🟡 (polling fallback now; sockets R2) |
| Automated backups + tested restore | 👤 (runbook in `DEPLOYMENT.md`; must be executed on real infra) |
| Error logging, monitoring, alerting | 🟡 (structured error logs + audit; Sentry R2) |
| API + env documentation | ✅ (`API.md`, `.env.example`) |
| Rate limiting, input validation, web security | 🟡 (validation ✅; rate limiting/WAF before launch) |
| Separate dev/staging/prod | 👤 (defined; provisioning required) |
| Data retention/deletion under NDPA 2023 | 👤 (policy + tooling TBD with counsel) |
| No secrets in the mobile client | ✅ |

## 10. Additional features

| Feature | Status |
|---|---|
| Referral & rewards | ⬜ R2 |
| Loyalty points | ⬜ R2 |
| Favourite stores / saved lists | 🟡 (product favourites ✅; saved shopping lists R2) |
| Scheduled deliveries | 🟡 (`scheduled_for` field stored; scheduling engine R2) |
| Express delivery | ✅ |
| Promo campaigns & discount codes | ✅ |
| Ratings & reviews with moderation | 🟡 (ratings ✅; admin hide-review R2) |
| Notifications & preferences | 🟡 (in-app ✅; per-channel preferences R2) |
| Wallet & transaction history | ✅ |
| Multiple saved addresses | ✅ |
| Receipts & reorder | ✅ |
| Package delivery as a configurable service | ⬜ Optional |

## 11. Nigeria launch requirements

| Requirement | Status |
|---|---|
| Nigerian phone formats | ✅ (+234 normalisation with validation) |
| Naira | ✅ (₦, integer money) |
| Nigerian addresses & service areas | 🟡 (area/city/landmark + coords; zone polygons R2) |
| Local payment providers | ✅ adapter, live keys 👤 |
| Admin-configurable launch cities/neighbourhoods/zones | 🟡 (cities + store areas ✅; polygon zones R2) |
| Architecture ready for new countries/currencies/languages | ✅ (currency column, settings-driven, no NGN assumptions in the API) |
| Privacy/consumer/payment compliance | 👤 Client counsel (NDPA 2023, FCCPC, CBN guidance) |
| Pharmacy: licensed merchant verification, prescription checks, banned products | 🟡 (merchant verification gate + category exists; **prescription workflow and controlled-product blocklist are R2 and legally required before selling pharmacy items**) |

## 12–16. Testing, deliverables, ownership, phases, proposal

| Requirement | Status |
|---|---|
| Integrated end-to-end testing | 🟡 (12 automated integration tests ✅; device matrix, load, security tests in M7) |
| Repository, API docs, migrations, seed, env docs | ✅ |
| Build & release instructions | ✅ (`DEPLOYMENT.md`, `README.md`) |
| Store submission support | ⬜ M7 / `DEPLOYMENT.md` checklist |
| Third-party cost inventory | ✅ (`PROPOSAL.md` §7) |
| Ownership of repo/accounts/IP | ✅ repo script + `PROPOSAL.md` §10 |
| Milestone demonstrations & acceptance criteria | ✅ (`PROPOSAL.md` §11) |
| Written proposal before development | ✅ (`PROPOSAL.md`) |

---

## The five things that must be true before public launch

1. **Live payment keys** from the client's approved Paystack account, with webhook URL configured in
   the Paystack dashboard (not just in `.env`).
2. **Postgres + backups + restore drill** — move off SQLite, prove a restore.
3. **Supply** — 15+ vetted merchants and 10+ verified riders in launch zones.
4. **Legal pack** — privacy policy, T&Cs, refund/cancellation policy, rider/shopper agreements.
5. **Pharmacy compliance** — unless the category is disabled at launch, prescription upload and
   controlled-product restrictions must ship first.
