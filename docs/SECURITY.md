# BUYBUDDY — Security notes

## Implemented in this repository

| Area | Control |
|---|---|
| Passwords | bcrypt (cost 10); never logged, never returned by the API (`sanitizeUser`) |
| Sessions | Signed JWT (HS256, 7-day TTL, issuer checked) + `users.token_version` for instant revocation on logout, password change or suspension |
| Authorisation | Role middleware on every privileged route **and** per-object ownership checks (`canAccessOrder`) so a customer cannot read another customer's order by guessing an id |
| Tenant isolation | Every merchant query is filtered by `merchant_id`; merchants can only ever see their own store, staff and orders |
| Worker isolation | Worker endpoints verify the job is actually assigned/offered to the caller before acting |
| Payments | Verification only server-side via the provider's verify API; browser success screens are never trusted |
| Webhooks | Raw-body HMAC-SHA512 signature compared to `x-paystack-signature`; invalid signatures rejected |
| Idempotency | `orders.idempotency_key` (unique) and `payments.reference` (unique); `completePayment()` is a no-op on a second call |
| Money integrity | Integer Naira only; settlement guarded by a ledger check so an order cannot be paid out twice |
| Concurrency | Job acceptance uses a conditional `UPDATE ... WHERE status = ? AND worker_id IS NULL`; checkout runs in a transaction |
| Input validation | Required-field checks, numeric coercion, enum validation on every status/decision field, Nigerian phone normalisation, upload MIME + 5 MB size cap |
| Audit | `audit_logs` records actor, action, entity, payload and IP for admin actions, refunds, suspensions, settings changes and errors |
| Secrets | Environment variables only; `.env` is git-ignored; no privileged keys are ever sent to the browser |
| Auth bypass guards | Self-registration cannot create an `admin`; admin accounts cannot be modified through the user-status endpoint |
| Rate limiting | Fixed-window limits on sign-in/register/reset (`20 failed attempts / 15 min` — successful attempts don't count, so real users are never locked out), OTP (`8/hour`), checkout (`12/min`), payments (`20/min`). Over-limit → `429` with `Retry-After` |
| Security headers | `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`; `Strict-Transport-Security` and `X-Frame-Options` applied in production (framing is permissive outside production so the app can be embedded in a preview pane) |
| Request tracing | `X-Request-Id` on every response, echoed as `request_id` in error bodies and in every structured log line — a customer can quote it to support and it matches the log entry exactly |
| Structured logging | One JSON line per request (`ts, level, request_id, method, path, status, ms, user_id, role, ip`); no passwords, tokens or card data are logged |
| Fail-fast config | `validateEnv()` refuses to boot in production with a weak `JWT_SECRET`, a non-HTTPS `APP_URL` or `ALLOW_DEV_OTP=true` |
| Loyalty/referral integrity | Points are an append-only ledger (balance = sum of entries, never a mutable column); earn is keyed to the order id so re-settling cannot double-credit; `referral_rewards.referee_id` is `UNIQUE`, so a second payout is impossible even under concurrent requests |
| Graceful shutdown | `SIGTERM`/`SIGINT` stop accepting connections, drain in-flight requests, then exit; forced after 10s |

## Must be added before public launch (tracked, not yet done)

1. **Distributed rate limiting** — the current counters live in process memory, which is correct for one instance. Before running more than one API node, swap the store for Redis (the `store` interface in `server/src/lib/security.js` is three methods: `hit`, `reset`, and a sweeper).
2. **WAF + DDoS protection** (Cloudflare) in front of the API — headers and CSP now ship in code, but edge filtering does not.
3. **Encryption at rest** for PII/bank details (Postgres column encryption or KMS-backed fields) and encrypted database disks.
4. **Dependency scanning** (`npm audit`, Dependabot) and secret scanning in CI.
5. **Penetration test** — at minimum: IDOR sweep across all `/orders/:id` routes, payment tampering, webhook replay, privilege escalation, and upload abuse.
6. **NDPA 2023 compliance pack** — lawful basis, privacy notice, data-subject request handling (export/delete), retention schedule, breach-notification runbook, and a signed DPA with any processor (Paystack, hosting, SMS).
7. **Secrets rotation runbook** and removal of the sandbox `000000` OTP path in production (`ALLOW_DEV_OTP` must be false).
8. **Pharmacy controls** — licensed-merchant verification, prescription upload/validation and a restricted-products blocklist (legally required before selling pharmacy items).

## Reporting

Security issues should be reported privately to the client's designated security contact, not in
public issue trackers.

## Merchant photo uploads

Merchants add photos from their phone instead of pasting links. The path a file
takes, and why each step exists:

1. **On the device** — `web/src/lib/photos.js` draws the picture onto a canvas at
   1200 px on the long edge, fills white behind it (transparent PNG logos would
   otherwise turn black), and re-encodes it as JPEG at quality 0.82. A 5 MB phone
   photo leaves the device at roughly 200 kB, so uploads stay fast on 3G.
2. **Over the wire** — the compressed image goes to `POST /api/uploads` as a data
   URL. Sign-in is required; anonymous uploads get `401`.
3. **On arrival** — the server ignores the file name and the declared MIME type
   and sniffs the first bytes instead. Only real JPEG (`FF D8 FF`), PNG
   (`89 50 4E 47`) and WebP (`RIFF….WEBP`) payloads are written to disk.
   Anything else is rejected with `415`, and SVG is refused outright because it
   can carry script. Bodies over 6 MB get `413`. Stored names are generated
   (`img_<random>.<ext>`), so a merchant cannot choose a path or overwrite
   another shop's file.
4. **On the way out** — `/uploads` is served with `X-Content-Type-Options:
   nosniff`, `Content-Security-Policy: default-src 'none'; img-src 'self'`, and
   `Cross-Origin-Resource-Policy: same-site`, so a stored file can be displayed
   as a picture and nothing else.

Tests in `server/test/api.test.js` cover the happy path plus disguised HTML,
SVG and oversized payloads.
