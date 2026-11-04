# BUYBUDDY — API reference

Base URL: `http://localhost:4000` (single-origin) or your deployed API host.
All bodies are JSON. All money is **integer Naira**. Timestamps are ISO-8601 UTC.

## Conventions

| Topic | Rule |
|---|---|
| Auth | `Authorization: Bearer <jwt>` — obtained from `/api/auth/login` or `/api/auth/register` |
| Roles | `customer`, `shopper`, `rider`, `merchant`, `admin`. Wrong role → `403 {code:"forbidden"}` |
| Errors | `{ "error": "human readable message", "code": "bad_request|null", "details": … }` |
| Pagination | `?page=1&limit=20` → responses include `page`, `total`, often `pages` |
| Idempotency | Send `Idempotency-Key: <uuid>` on `POST /api/orders/checkout` and `POST /api/shopping/requests` |
| Status codes | `200` ok · `201` created · `400` validation/state · `401` unauthenticated · `403` forbidden · `404` missing · `409` conflict (cart store clash) · `500` server |

## Order statuses

`pending_payment · paid · accepted · preparing · ready_for_pickup · open_for_shoppers ·
shopper_assigned · shopping · awaiting_approval · approved · purchased · ready_for_delivery ·
rider_assigned · picked_up · in_transit · delivered · completed · cancelled · refunded`

Payment statuses: `pending · paid · paid_cash · failed · refunded`.

---

## Auth & account

| Method | Path | Body / notes |
|---|---|---|
| `POST` | `/api/auth/register` | `{name, email?, phone?, password, role?, city?, area?, business_name?}` → `{token, user, verification:{dev_code}}` |
| `POST` | `/api/auth/login` | `{identifier\|email\|phone, password}` → `{token, user}` |
| `POST` | `/api/auth/otp/request` | `{phone, purpose?}` |
| `POST` | `/api/auth/otp/verify` | `{phone, code}` (sandbox accepts `000000`) |
| `POST` | `/api/auth/password/forgot` | `{email\|phone}` → `{dev_token}` outside production |
| `POST` | `/api/auth/password/reset` | `{token, password}` |
| `POST` | `/api/auth/logout` | revokes every token for the user |
| `GET` | `/api/me` | current user + public settings |
| `PATCH` | `/api/me` | `{name?, email?, area?, city?, avatar?, password?, current_password?}` |
| `GET/POST` | `/api/addresses` | list / create `{line1, area, city, label?, recipient?, phone?, notes?, is_default?}` |
| `DELETE` | `/api/addresses/:id` | |
| `GET` | `/api/wallet` | `{balance, entries[]}` |
| `POST` | `/api/wallet/topup` | `{amount}` (sandbox credits instantly) |
| `GET` | `/api/notifications` | `{notifications[], unread}` |
| `POST` | `/api/notifications/read` | `{id?}` — all if omitted |
| `GET/POST` | `/api/support/tickets` | list / `{subject, message, category?, order_id?, priority?}` |
| `POST` | `/api/support/tickets/:id/messages` | `{body}` |
| `GET` | `/api/reviews?target_type=store&target_id=…` | published reviews |
| `GET` | `/api/config` | public platform settings + service areas |

## Catalogue

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/home` | categories, banners, popular stores, recommended, deals, promos, recent (auth-aware) |
| `GET` | `/api/categories` | |
| `GET` | `/api/search?q=` | `{products[], stores[], total}` |
| `GET` | `/api/stores?category=&area=&q=&page=` | |
| `GET` | `/api/stores/:idOrSlug` | store + products + categories + reviews |
| `GET` | `/api/products?category=&store=&min_price=&max_price=&in_stock=&sort=&page=` | sort: `popular\|price_asc\|price_desc\|rating\|newest` |
| `GET` | `/api/products/:id` | product + store + related + reviews |
| `GET` | `/api/favourites` · `POST /api/favourites/:productId` | toggle |
| `POST` | `/api/promos/validate` | `{code, subtotal, type?}` → discount + full fee preview |

## Cart

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/cart` | `{items[], subtotal, count, store, issues[]}` |
| `POST` | `/api/cart` | `{product_id, qty}` → `409 {code:"store_conflict"}` if another store's items are present |
| `PATCH` | `/api/cart/:itemId` | `{qty}` (0 removes) |
| `DELETE` | `/api/cart/:itemId` · `DELETE /api/cart` | |
| `POST` | `/api/cart/quote` | `{address_id?, service_level?, promo_code?}` → `{subtotal, serviceFee, deliveryFee, tax, discount, total, distance_km, issues, payment_methods}` |

## Orders (customer)

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/orders/checkout` | `{address_id, payment_method: paystack\|wallet\|cash, service_level?, promo_code?, notes?, idempotency_key?}` → `{order, payment:{authorization_url, reference, sandbox}}` |
| `POST` | `/api/shopping/requests` | `{address_id, payment_method, items:[{description, qty, target_price?, image?, note?}], budget, store_id?, service_level?, instructions?, notes?}` |
| `POST` | `/api/orders/:id/approvals` | `{items:[{id, action:"approve"\|"reject"}]}` → recomputed order; may set payment back to `pending` when the total rises |
| `POST` | `/api/orders/:id/adjustment-payment` | `{payment_method?}` → payment intent for the difference |
| `GET` | `/api/orders?status=&type=&page=` | list with `status_label` and `item_count` |
| `GET` | `/api/orders/:id` | order + items/shopping_items + timeline + messages + receipts + `delivery_pin` (customer only) |
| `GET` | `/api/orders/:id/tracking` | `{active, progress, rider, rider_position, pickup, destination, eta_minutes}` |
| `GET` | `/api/orders/:id/events` | raw audit timeline |
| `POST` | `/api/orders/:id/cancel` | `{reason}` — refunds captured payment to wallet |
| `POST` | `/api/orders/:id/confirm-delivery` | `delivered → completed` + settlement |
| `POST` | `/api/orders/:id/review` | `{rating:1-5, comment?}` — rates store, shopper and rider in one call |
| `GET/POST` | `/api/orders/:id/messages` | per-order chat |
| `POST` | `/api/orders/:id/pay` | re-initiate payment |
| `POST` | `/api/payments/:reference/verify` | **server-side** verification; returns order |
| `POST` | `/api/orders/:id/reorder` | restores available items to the cart |
| `GET` | `/api/offers?role=shopper\|rider` | job offers for the signed-in worker |

## Shopper & rider

| Method | Path | Notes |
|---|---|---|
| `GET/PATCH` | `/api/worker/profile` | vehicle, plate, service areas, bank, docs, `available` |
| `POST` | `/api/worker/availability` | `{available: bool}` |
| `GET` | `/api/worker/dashboard` | offers, active jobs, completed, earnings summary |
| `POST` | `/api/worker/jobs/:orderId/accept` | `{role}` — **atomic**, exactly one winner (`400` if taken) |
| `POST` | `/api/worker/jobs/:orderId/decline` | `{role}` |
| `POST` | `/api/worker/jobs/pull` | ask for the next job when auto-offer is off |
| `GET` | `/api/worker/jobs/:orderId` | task detail (assigned or offered only) |
| `POST` | `/api/worker/jobs/:orderId/start-shopping` | `shopper_assigned → shopping` |
| `PATCH` | `/api/worker/jobs/:orderId/items/:itemId` | `{proposed_name?, proposed_price?, proposed_qty?, status:"proposed"\|"unavailable", note?}` |
| `POST` | `/api/worker/jobs/:orderId/submit-for-approval` | `shopping → awaiting_approval` |
| `POST` | `/api/worker/jobs/:orderId/receipts` | `{data_url, amount?, note?}` (image or PDF data URL, ≤4 MB) |
| `POST` | `/api/worker/jobs/:orderId/purchased` | `approved → purchased → ready_for_delivery`, offers riders |
| `POST` | `/api/worker/jobs/:orderId/pickup` | rider: `→ picked_up` |
| `POST` | `/api/worker/jobs/:orderId/in-transit` | rider: `→ in_transit` |
| `POST` | `/api/worker/jobs/:orderId/location` | rider GPS ping hook |
| `POST` | `/api/worker/jobs/:orderId/deliver` | `{pin, photo?}` — **wrong PIN → 400** |
| `GET` | `/api/worker/earnings` | today/week/month/lifetime + ledger + payouts |
| `POST` | `/api/worker/payouts` | `{amount}` — min ₦1,000, needs bank details |

## Merchant

| Method | Path | Notes |
|---|---|---|
| `GET/POST/PATCH` | `/api/merchant/store` | store profile; `POST` creates it (status `pending` until admin approval) |
| `POST` | `/api/merchant/store/toggle-open` | `{open}` |
| `GET/POST` | `/api/merchant/products` | `{name, price, stock, category_id, description, image, compare_at?, unit?}` |
| `PATCH/DELETE` | `/api/merchant/products/:id` | `DELETE` soft-disables |
| `GET` | `/api/merchant/orders?status=` | store-scoped only |
| `POST` | `/api/merchant/orders/:id/accept` | `paid → accepted` |
| `POST` | `/api/merchant/orders/:id/ready` | `accepted → preparing → ready_for_pickup` + offers riders |
| `POST` | `/api/merchant/orders/:id/reject` | `{reason}` — restores stock, refunds |
| `GET` | `/api/merchant/dashboard` | metrics, pending/active orders, low stock, 7-day chart |
| `GET` | `/api/merchant/settlements` | settlements net of commission + ledger |

## Admin (role `admin` only)

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/admin/overview?days=7` | KPIs, status breakdown, chart, alerts (GMV vs platform revenue separated) |
| `GET` | `/api/admin/orders?status=&type=&q=&payment_status=` | |
| `GET` | `/api/admin/orders/:id` | full detail + payments, receipts, messages, events, eligible workers |
| `POST` | `/api/admin/orders/:id/assign` | `{worker_id, role}` — override assignment |
| `POST` | `/api/admin/orders/:id/status` | `{status, note}` — validated by the state machine |
| `POST` | `/api/admin/orders/:id/refund` | `{amount?, reason}` |
| `GET` | `/api/admin/users?role=&status=&q=` | |
| `POST` | `/api/admin/users/:id/status` | `{status, reason}` — suspension revokes sessions |
| `GET` | `/api/admin/merchants` | with application status and counts |
| `POST` | `/api/admin/merchants/:storeId/decision` | `{decision: approve\|reject\|suspend\|reactivate, reason?}` |
| `GET` | `/api/admin/workers` | |
| `POST` | `/api/admin/workers/:id/decision` | `{decision: approve\|reject\|suspend, reason?}` |
| `GET` | `/api/admin/finance` | payments, payouts, totals |
| `POST` | `/api/admin/payouts/:id/decision` | `{decision: approve\|reject\|pay}` |
| `GET/POST` | `/api/admin/promos` · `PATCH /api/admin/promos/:code` | create / enable-disable |
| `GET/POST` | `/api/admin/banners` · `PATCH /api/admin/banners/:id` | homepage banners |
| `POST` | `/api/admin/notifications/broadcast` | `{title, body, role}` |
| `GET/PUT` | `/api/admin/settings` | every fee, flag and support detail |
| `GET` | `/api/admin/tickets` · `POST /:id/reply` · `POST /:id/resolve` | support inbox |
| `GET` | `/api/admin/audit-logs` | privileged action history |
| `POST` | `/api/admin/categories` | add a category |

## Webhooks & infrastructure

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/webhooks/paystack` | raw body; validates `x-paystack-signature` (HMAC-SHA512). Idempotent. Invalid signature → `400` |
| `POST` | `/api/dev/payments/:reference/approve` | sandbox only: simulates gateway approval |
| `POST` | `/api/uploads` | `{data_url, file_name?}` → `{url}` (≤5 MB, images/PDF) |
| `GET` | `/api/health` | version, uptime timestamp, payment mode |
| `GET` | `/uploads/:file` | static uploaded files |

## Example: the money-critical path

```bash
# 1. sign in
TOKEN=$(curl -s -X POST $API/api/auth/login -H 'Content-Type: application/json' \
  -d '{"identifier":"customer@buybuddy.ng","password":"Password123!"}' | jq -r .token)

# 2. add to cart, then price it
curl -s -X POST $API/api/cart -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"product_id":"<id>","qty":2}'
curl -s -X POST $API/api/cart/quote -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"promo_code":"WELCOME10"}'

# 3. checkout (idempotent — resend the same key, get the same order)
KEY=$(uuidgen)
curl -s -X POST $API/api/orders/checkout -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: $KEY" -H 'Content-Type: application/json' \
  -d '{"address_id":"<id>","payment_method":"wallet"}'

# 4. verify the payment server-side (never trust the client)
curl -s -X POST $API/api/payments/<reference>/verify -H "Authorization: Bearer $TOKEN"
```
