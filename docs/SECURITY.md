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

## Must be added before public launch (tracked, not yet done)

1. **Rate limiting** on `/api/auth/*`, `/api/payments/*` and checkout (e.g. `express-rate-limit` + Redis store), plus login lockout after N failures.
2. **WAF + DDoS protection** (Cloudflare) and a strict **Content-Security-Policy**, `X-Frame-Options`, `Referrer-Policy`, HSTS.
3. **Encryption at rest** for PII/bank details (Postgres column encryption or KMS-backed fields) and encrypted database disks.
4. **Dependency scanning** (`npm audit`, Dependabot) and secret scanning in CI.
5. **Penetration test** — at minimum: IDOR sweep across all `/orders/:id` routes, payment tampering, webhook replay, privilege escalation, and upload abuse.
6. **NDPA 2023 compliance pack** — lawful basis, privacy notice, data-subject request handling (export/delete), retention schedule, breach-notification runbook, and a signed DPA with any processor (Paystack, hosting, SMS).
7. **Secrets rotation runbook** and removal of the sandbox `000000` OTP path in production (`ALLOW_DEV_OTP` must be false).
8. **Pharmacy controls** — licensed-merchant verification, prescription upload/validation and a restricted-products blocklist (legally required before selling pharmacy items).

## Reporting

Security issues should be reported privately to the client's designated security contact, not in
public issue trackers.
