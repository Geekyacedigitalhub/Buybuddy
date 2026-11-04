# BUYBUDDY — Testing

## Automated suite (runs today)

```bash
npm test          # node --test, 12 integration tests
```

The suite boots a **throwaway database**, seeds it, starts the real HTTP server and drives complete
flows over the API — no mocked business logic.

| # | Test | What it proves |
|---|---|---|
| 1 | Health endpoint | Service boots; sandbox payment mode reported |
| 2 | Public config | Nigerian launch settings (NGN, fees) exposed |
| 3 | Bad credentials rejected | Auth cannot be bypassed by a wrong password |
| 4 | Registration + OTP | Phone normalisation to `+234…`, invalid numbers rejected, OTP verification |
| 5 | Search + unauthenticated cart | Catalogue works; cart requires auth (401) |
| 6 | Cart single-store rule + quote | `409 store_conflict`, fee/discount math is non-zero and consistent |
| 7 | **Full merchant lifecycle** | checkout → wallet pay → idempotent replay → merchant accept/ready → rider accept → pickup → in transit → wrong PIN rejected → correct PIN → customer confirms → rider credited → review |
| 8 | **Personal shopping** | request → shopper accepts → proposes prices → submits → non-owner approval blocked (403) → customer approves → `approved_subtotal` recomputed → purchased → ready for delivery |
| 9 | Webhook signature | Invalid HMAC rejected with 400 |
| 10 | RBAC | Customer blocked from admin and merchant APIs; admin overview returns data |
| 11 | Admin approvals | Pending merchant approved; pending worker verified |
| 12 | Illegal transition | `paid → completed` rejected with 400 |

## Manual UAT script (per role)

**Customer** — register with a Nigerian number → verify OTP → add an address → browse → add to cart →
try adding an item from another store (expect the conflict prompt) → apply `WELCOME10` → checkout with
wallet → confirm the fee breakdown → open the order → send a message → cancel → confirm the refund
appears in the wallet → place a Shop-for-me request with a photo → approve one item and reject another →
verify the total became `approved_subtotal`.

**Shopper** — go online → accept a request → start shopping → record prices → mark one unavailable →
submit for approval → try to buy before approval (must be blocked) → after approval upload a receipt →
hand over to a rider → check earnings appear only after completion.

**Rider** — accept a delivery → pickup → in transit → enter a wrong PIN (blocked) → enter the correct
PIN → verify the customer can confirm and that earnings credit exactly once.

**Merchant** — reject an order (stock restored, refund issued) → accept another → mark ready → view
settlement net of commission → toggle the store closed and confirm customers cannot order.

**Admin** — approve the pending merchant and pending worker → refund an order → change the delivery
base fee and confirm new quotes use it → create a promo → send a broadcast → verify every action appears
in the audit log → suspend a customer and confirm their session is revoked.

## What still needs building (M7)

* Unit tests for `calcFees` edge cases (zero subtotal, promo larger than cart, express + free delivery).
* Contract tests per endpoint (schema assertions), including 401/403 matrices for all 121 routes.
* Playwright E2E on a device matrix (iPhone SE/13, Pixel 6, small Android) and offline/poor-network runs.
* Load test with k6: 200 concurrent order creations; verify no oversell and no duplicate orders.
* Payment matrix: success, failure, pending→success, duplicate webhook, refund, partial refund,
  provider timeout, and reconciliation against provider records.
* Backup restore drill (see `DEPLOYMENT.md` §6) and a documented pen-test (see `SECURITY.md`).
* Accessibility pass (axe + manual screen-reader) targeting WCAG 2.1 AA.
