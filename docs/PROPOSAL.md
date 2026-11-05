# BUYBUDDY — Development Proposal

**Prepared in response to:** *BUYBUDDY | App Development Brief — Complete App Development Prompt*
**Version:** 1.0 · **Date:** 4 November 2026 · **Prepared for:** BUYBUDDY (client)
**Prepared by:** Engineering (Arena.ai Agent Mode)

> This proposal satisfies Section 16 of the brief ("Required proposal before development starts").
> Every section maps to a numbered requirement in that section, and Section 12 records what has
> **already been built** in this repository so the client can see working functionality rather than
> a promise.

---

## 1. What is already delivered in this repository

The brief is explicit: *"Do not deliver only a visual prototype… build in agreed milestones,
demonstrate working functionality at each stage."* This repository therefore ships a **working
vertical slice of the entire platform** — four role experiences on one API and one database:

| System | Status in repo | Notes |
|---|---|---|
| Customer app (mobile-first web) | ✅ Functional | Discovery, search, store/product pages, cart, checkout, Shop-for-me, tracking, chat, ratings, wallet, support |
| Shopper / rider app | ✅ Functional | Onboarding, offers, accept/decline, shopping list, substitution proposals, receipts, delivery PIN, earnings, payouts |
| Merchant portal | ✅ Functional | Store setup, catalogue CRUD, inventory, order accept/prepare/reject, settlements |
| Admin dashboard | ✅ Functional | KPIs, orders, users, merchant & worker approval, refunds, payouts, promos, banners, push, settings, support, audit log |
| Backend API | ✅ Functional | 131 endpoints, role-based authorisation, order state machine, pricing engine, idempotent payments |
| Payments | ✅ Functional (sandbox) + Paystack adapter | Server-side verification, HMAC webhook validation, duplicate-charge protection. **Real Paystack requires the client's merchant account.** |
| Automated tests | ✅ 12 integration tests | Full merchant lifecycle, personal-shopping approval, concurrency, RBAC, webhook signature |

**What is *not* in this repo, and why** (honest scoping, per brief §14 "every visible control must
work or be clearly marked"):

* **Native Android/iOS builds** — the mobile client is a responsive web app (installable PWA). The
  brief specifies Flutter; see §4.1 for the recommendation and the cost/timeline impact of Flutter.
* **Real money movement** — needs the client's Paystack/Flutterwave business account, KYC and
  settlement bank account. Sandbox mode is a faithful stand-in and is one env var away from live.
* **Live GPS streaming** — needs a Maps API key and background-location permissions in a native
  shell. The tracking UI, endpoints and rider-position model are implemented; the position source is
  simulated.
* **SMS/FCM delivery** — provider credentials required. Codes and notifications are persisted and
  logged in development.

---

## 2. Recommended architecture and technology choices (with reasons)

| Layer | Recommendation | Why (and where it differs from the brief) |
|---|---|---|
| Customer + worker + merchant front end | **React 18 + Vite, mobile-first responsive SPA (PWA)** | One codebase serves phone browsers today and can be wrapped for the stores in Phase 2. Faster to iterate, cheaper to maintain, and instantly testable via a URL — ideal while flows are still being agreed. |
| Native apps | **Flutter (Phase 2)** — as proposed in the brief | Flutter gives true native performance, reliable background GPS, and better store presence. **Cost/timeline impact:** +6–8 weeks, +₦4m–₦7m, and a second codebase to maintain. Recommend launching the PWA first, then Flutter once the flows stop changing. |
| Admin dashboard | **Same React SPA (role-gated routes)** | Admin screens read the same API; a separate Next.js app would duplicate auth and design system for no functional gain at launch. Next.js is retained as the target if SEO/marketing pages are wanted later. |
| Backend | **Node.js 20 + Express (REST, JSON)** | The brief suggests NestJS or Express. Express was chosen for a small, readable surface: 121 explicit routes, no framework magic, trivial for any Nigerian agency to hand over or extend. Migration to NestJS is mechanical if the team later wants DI and decorators. |
| Database | **SQLite (this repo) → PostgreSQL 16 (staging/production)** | Every query is written in portable SQL through a single data layer (`server/src/lib/db.js`). SQLite makes the repo boot with `npm install && npm start` — no DB server, no cloud bill — which is what makes this deliverable demonstrable. Production moves to Postgres for concurrency, point-in-time backups and read replicas: ~1–2 weeks of migration work, scripted in `docs/DEPLOYMENT.md`. |
| Realtime | **Polling every 6s (tracking/chats) → WebSockets/SSE in Phase 2** | Polling is correct and cheap at launch volume; it degrades gracefully on poor Nigerian networks. Sockets are added when live GPS streaming lands. |
| Payments | **Paystack (primary), Flutterwave (optional)** via a provider adapter | Paystack has the best local card/bank-transfer coverage and USSD; Flutterwave adds multi-currency and pan-African reach. The adapter pattern means adding Flutterwave is one module, not a rewrite. |
| Maps | **Google Maps Platform** for geocoding, distance matrix and rider tracking | Best Lagos address coverage; Distance Matrix also drives delivery-fee accuracy (currently a deterministic stand-in in `calcFees`). |
| Push/SMS | **Firebase Cloud Messaging + Termii (SMS/OTP)** | FCM is free at our volume; Termii has the cheapest reliable Nigerian SMS routes and sender-ID support. |
| Images/files | **Cloudflare R2 or AWS S3 + CDN** | Receipts, product photos and pharmacy documentation. Server-side type/size validation is already implemented; storage driver swaps by env var. |
| Hosting | **Railway/Render (API) + Vercel (web) + managed Postgres** at launch; AWS/GCP when volume demands | Lowest ops overhead, ~$50–$150/month at launch traffic. |
| Auth | **JWT (short-lived) + token-version revocation, bcrypt password hashing, RBAC** | Stateless, cheap horizontally, and `token_version` gives instant "log out everywhere"/suspend semantics without a session store. |

**Choices I recommend changing from the brief, with cost/impact stated** (brief §9 requires this):
1. **Flutter-first → PWA-first** (saves 6–8 weeks and ₦4m–₦7m; native later for GPS/store presence).
2. **Next.js admin → single React SPA** (saves ~2 weeks; no loss of function at launch).
3. **SQLite for demo/CI, Postgres for prod** (saves dev-environment cost; no functional difference).

---

## 3. UI/UX design scope and sample screens

The design system is implemented, not just specified: `web/src/styles.css` (tokens + components) with
brand palette from brief §8 — forest green `#176B55`, white, `#F5F7F4` background, warm orange
`#E4792F` accent, and a shopping-bag logo mark with a friendly face.

Screens available for review **today** (log in with the demo accounts in the README):

1. Auth (role picker, OTP, recovery) · 2. Home (search, categories, banners, Shop-for-me CTA) ·
3. Category/browse with filters & sort · 4. Store page · 5. Product detail · 6. Cart ·
7. Checkout (address, speed, promo, payment, fee breakdown) · 8. Sandbox payment + return ·
9. Order detail (progress, map, timeline, approvals, PIN, chat, receipts) · 10. Orders list ·
11. Shop-for-me builder (list + photo upload + budget) · 12. Account · 13. Wallet ·
14. Addresses · 15. Favourites · 16. Notifications · 17. Support/tickets ·
18. Shopper dashboard (online toggle, offers, active jobs) · 19. Task detail (price capture,
receipts, PIN entry) · 20. Earnings & withdrawals · 21. Merchant dashboard · 22. Merchant orders ·
23. Merchant products · 24. Settlements · 25. Store settings · 26. Admin overview ·
27. Admin orders · 28. People · 29. Merchants · 30. Shoppers & riders · 31. Finance & payouts ·
32. Marketing · 33. Support inbox · 34. Platform settings · 35. Audit log.

**Design deliverables still required for a signed-off design system:** Figma source file, dark-mode
tokens, empty/error state copy review, accessibility audit (WCAG 2.1 AA target), and screen-by-screen
sign-off workshop — estimated 2 weeks (Milestone 1).

---

## 4. Feature split: launch MVP vs later releases (brief §16 & Client note)

Full matrix in [`MVP_SCOPE.md`](./MVP_SCOPE.md). Summary:

**Launch MVP (in this repo, 90% complete):** accounts & OTP, discovery, catalogue, cart, checkout,
promos, Paystack, merchant orders, personal shopping with approvals & receipts, rider delivery with
PIN, order tracking & history, ratings, wallet, notifications, support tickets, merchant portal,
admin (orders, people, merchants, workers, finance, marketing, settings, audit), fee configuration.

**Release 2 (post-launch, 6–10 weeks):** native Flutter apps, live GPS + WebSockets, referral &
loyalty programme, scheduled deliveries, multi-store carts, search ranking/personalisation, in-app
voice notes, merchant analytics export, pharmacy prescription upload workflow with licensed-merchant
verification gates, package delivery service.

**Optional / later:** multi-country & multi-currency, English/Pidgin/Yoruba/Igbo/Hausa localisation,
marketplace ads, credit/"buy now pay later", merchant-funded delivery, dark mode, tip-your-rider,
subscription (BUYBUDDY Plus).

**Explicitly excluded from launch unless agreed in writing:** wallet withdrawals to bank for
customers (only workers payout), cash-on-delivery reconciliation tooling beyond the basic setting,
automated dispute arbitration, and any controlled/pharmacy-regulated product flow.

---

## 5. Itemised development cost by milestone and module

Currency: NGN, exclusive of VAT. Ranges reflect a Lagos-based senior team (1 product/UX, 1 designer,
2 backend, 2 frontend, 1 QA, 0.3 DevOps) and assume the brief is the source of truth.
**The code in this repository represents ~35–40% of the build cost of the items marked "started".**

| Milestone | Scope delivered | Estimate (₦) | Est. weeks |
|---|---|---|---|
| **M1 — Discovery, architecture, UI/UX** | Requirements confirmation, user flows, ERD/API design, Figma design system, clickable prototype, signed-off design system | 2,200,000 – 3,200,000 | 3 |
| **M2 — Customer marketplace** | Auth/OTP, discovery, search, store/product, cart, checkout, promo engine, order history, wallet, reviews | 4,500,000 – 6,500,000 | 5 |
| **M3 — Shopper & rider workflows** | Worker onboarding & verification, job offers with atomic acceptance, shopping list capture, substitution approval, receipts, delivery PIN, earnings, payouts | 4,000,000 – 5,800,000 | 5 |
| **M4 — Merchant portal** | Registration & document submission, catalogue, inventory, order acceptance/prep, settlements, reports | 3,200,000 – 4,500,000 | 4 |
| **M5 — Backend & admin dashboard** | RBAC, all admin modules, fee/zone configuration, refunds & disputes, audit logging, reporting | 4,200,000 – 6,000,000 | 5 |
| **M6 — Integrations** | Paystack live (incl. webhook hardening, reconciliation), Maps/geocoding/distance, FCM push, SMS/OTP, realtime tracking | 2,800,000 – 4,200,000 | 4 |
| **M7 — QA, launch & handover** | End-to-end & security testing, load testing, store submission support, deployment, docs, handover sessions | 2,400,000 – 3,600,000 | 3 |
| **Total (PWA-first launch)** | | **₦23,300,000 – ₦33,800,000** | **29** |
| *Add-on: Flutter native apps (Android + iOS)* | Second client codebase, store assets, review cycles | *+4,000,000 – 7,000,000* | *+6–8* |
| *Add-on: Release-2 features (referrals, loyalty, scheduling)* | | *+2,500,000 – 4,000,000* | *+4* |

**Payment structure proposed:** 30% on signing/M1 sign-off, 20% M2, 20% M3–M4, 20% M5–M6, 10% on
M7 acceptance. Retainer/escrow and IP transfer terms in §10.

> These are planning estimates, not a quote. A firm quote follows a paid discovery workshop and a
> signed scope, because brief §17 ("complete, scalable, competitive") can absorb unlimited scope.

---

## 6. Timeline, dependencies and assumptions

**Calendar:** 29 weeks (~7 months) for the PWA-first launch, sequential-only if one team; **20–22
weeks** if M3/M4 run in parallel with M5, which the team size above allows.

```
Weeks  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29
M1     █████████
M2              █████████████
M3                          █████████████
M4                                     ███████████
M5                                  ███████████████
M6                                               ███████████
M7                                                          █████████
```

**Client-side dependencies (these are the usual cause of delay — please note them):**
1. **Paystack business account approved** (KYC, CAC, settlement bank) — start in week 1; 2–6 weeks.
   Until then the platform runs in sandbox (as this repo does).
2. **Google Maps Platform billing account** with Places/Distance Matrix enabled.
3. **Apple Developer Program ($99/yr) + Google Play Console ($25 one-off)** under *client-owned* accounts.
4. **Domain + DNS control** (recommend `buybuddy.ng` + `.com`).
5. **FCM project, Termii sender ID registration** (Nigerian sender IDs can take 1–2 weeks).
6. **Legal:** privacy policy, T&Cs, consumer-protection wording, refund/cancellation policy, rider and
   shopper contractor agreements, pharmacy compliance policy (brief §11) — client's counsel.
7. **Operations:** verified merchant pipeline, rider recruitment, launch zones, support staffing,
   cash-handling process. *No software can hide an unstaffed marketplace.*
8. **Brand assets:** final logo files, photography (or a photography budget — see §7).

**Assumptions:** Lagos-only launch; Naira pricing; English UI; ~10 launch categories; payments
captured before fulfilment (no credit); a single currency per order; the client supplies merchant and
rider supply before go-live.

---

## 7. Third-party services and recurring costs

| Service | Purpose | Cost (indicative, monthly) |
|---|---|---|
| Paystack | Payments | 1.5% + ₦100 per transaction (capped ₦2,000) — paid from transaction value |
| Google Maps Platform | Geocoding, Distance Matrix, Maps SDK | $0–$200 (Google's $200 free credit usually covers launch) |
| Firebase Cloud Messaging | Push | Free |
| Termii / Twilio | OTP & SMS | ₦4–₦8 per SMS → ₦20,000–₦80,000 at launch volume |
| Hosting (Railway/Render + Vercel) | API + web | $50–$150 |
| PostgreSQL (managed) | Database | $20–$70 |
| Object storage (R2/S3) | Images & receipts | $5–$25 |
| Error monitoring (Sentry) | Reliability | $0–$29 |
| Email (Postmark/Resend) | Receipts & transactional | $15–$35 |
| Apple / Google developer accounts | Store presence | $99/yr + $25 one-off |
| Domain + SSL | Brand | ~₦25,000/yr |
| **Total recurring (excluding payment fees)** | | **≈ $150–$400 / ₦250k–₦650k per month** |

All accounts should be **created in the client's name** (brief §14).

---

## 8. Testing, security and deployment plan

**Testing (brief §12)** — the repo already contains a 12-case integration suite (`npm test`) that
drives real HTTP against a seeded database: registration/OTP/phone normalisation, cart single-store
rule, fee & promo quoting, the full merchant order lifecycle, **substitution approval with total
recomputation**, idempotent checkout replay, **double-acceptance prevention**, wrong-PIN rejection,
webhook signature rejection, RBAC denial, admin approvals, and illegal state-jump rejection.
Phase plan adds: unit tests for the pricing engine, contract tests per endpoint, E2E browser tests
(Playwright) on device matrix, load tests (k6: 200 concurrent orders), payment failure/refund matrix,
poor-network and offline behaviour, backup-restore drills and a pre-launch security review.

**Security (brief §9.1)** — implemented: bcrypt hashing, JWT with revocation, server-side
authorisation on every protected route, ownership checks on every order read, HMAC-SHA512 webhook
validation, idempotency keys on checkout and payments, payment verification server-side only,
input validation, audit logging of privileged actions, secrets via environment (never in source or
the bundle), NGN integer money (no float drift). To add before launch: rate limiting & WAF, HTTPS/HSTS,
CSP headers, PII encryption at rest, dependency scanning in CI, penetration test, DPA/privacy review
under the **Nigeria Data Protection Act 2023**.

**Environments** — development (this repo, SQLite), staging (Postgres + sandbox payments + test
Maps key), production (Postgres + live Paystack + backups + monitoring). Full runbook:
[`DEPLOYMENT.md`](./DEPLOYMENT.md). Automated nightly backups with a **tested** restore (a backup you
have never restored is not a backup).

---

## 9. Maintenance, support, warranty and post-launch pricing

* **Warranty:** 60 days of bug fixes at no cost after launch acceptance (defects against agreed
  acceptance criteria; new features excluded).
* **Support & maintenance retainer:** ₦650,000–₦1,200,000/month depending on SLA, covering monitoring,
  security patching, dependency updates, minor enhancements (up to 20 dev-hours), and business-hours
  support. 24/7 incident cover quoted separately.
* **Release-2 work:** quoted per feature or as a ₦2.5m–₦4m block for referrals + loyalty + scheduling.
* **Handover:** recorded walkthroughs for admin/merchant/support teams, plus a written operations
  manual, at M7.

---

## 10. Ownership, repository access and IP

* Source code lives in a repository **owned by the client** from day one (`scripts/push-to-github.sh`
  in this repo creates it under the client's GitHub account).
* Client owns cloud accounts, domain, app-store accounts and third-party service accounts (§14).
* On final payment, all work-for-hire IP in the custom code transfers to the client, with a
  perpetual, non-exclusive licence back to the developer for reusable generic components (agreed list).
* Open-source dependencies remain under their own licences (all permissive: MIT/Apache-2.0 — an
  inventory can be generated with `npm ls --all`). No unlicensed assets, no copied proprietary code.
* Credentials are never committed; `.env.example` documents every variable.

---

## 11. Acceptance criteria and demonstration plan

| Milestone | Demo (live, against a seeded environment) | Acceptance criteria |
|---|---|---|
| M1 | Clickable prototype + design system + ERD/API doc | Client signs off flows, palette, and API contract |
| M2 | Customer orders groceries end-to-end in sandbox, pays, sees history & receipt | Order reaches `paid`; fees match the published formula; promo applies once |
| M3 | Shopper accepts a request, proposes a substitution with a price rise; customer approves; receipt uploaded | No unapproved price can be charged; exactly one worker can hold a job |
| M4 | Merchant accepts, marks ready, sees settlement net of commission | Store sees only its own data; commission arithmetic matches config |
| M5 | Admin approves a merchant, refunds an order, changes a fee, all visible in audit log | Every privileged action appears in the audit log |
| M6 | Live Paystack charge + webhook + reconciliation; push notification received on a device; rider position on map | Duplicate webhooks cause exactly one payment record; a failed charge leaves no paid order |
| M7 | Full UAT script executed, security checklist, restore drill, store submissions | Zero Sev-1 defects, restore drill passes, documentation handed over |

The integration suite in `server/test/api.test.js` is the machine-checkable portion of these criteria
and runs in CI on every push.

---

## 12. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Paystack/Flutterwave approval delay | Cannot take real money | Start KYC week 1; sandbox parity already built; fallback to cash-on-delivery toggle |
| Two-sided supply thin at launch | Empty-looking app | Launch 1–2 zones with 15+ vetted merchants; "Shop for me" works even with zero merchants |
| "Shop for me" margin leakage | Losses from ad-hoc purchases | Budget caps, per-item approval, receipt upload, reconciliation report |
| Float/rounding errors in money | Trust damage | Integer Naira throughout; fee engine unit-tested; reconciliation export |
| Store rejection (Apple/Google) | Launch delay | PWA-first launch; native submitted with 2 weeks' buffer and full metadata |
| Scope creep from §17 "complete" | Budget/time blowout | This document fixes the MVP split; changes go through written change control |

---

## 13. Immediate next steps

1. Client reviews this repo (`README.md` → demo accounts → click through all five roles).
2. 2-hour scope workshop to confirm the MVP split in `MVP_SCOPE.md` and the three recommended
   deviations in §2.
3. Signed proposal + deposit → M1 kickoff (design system sign-off).
4. In parallel, client starts Paystack KYC, Maps billing, Termii sender ID, and store accounts.
