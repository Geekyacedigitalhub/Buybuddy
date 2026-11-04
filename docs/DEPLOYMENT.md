# BUYBUDDY — Deployment & operations

## 1. Local development

```bash
git clone <your-repo> buybuddy && cd buybuddy
npm install                       # installs server + web workspaces
npm run seed -w server            # creates server/data/buybuddy.sqlite + demo data
cp server/.env.example server/.env
npm run build -w web              # builds the SPA into web/dist
npm start                         # API + SPA on http://localhost:4000
```

Two-process development (hot reload):

```bash
npm run dev -w server      # API on :4000 (node --watch)
npm run dev -w web         # Vite on :5173, proxying /api → :4000
```

## 2. Environment variables

All variables live in `server/.env` (never committed). See `server/.env.example` for the annotated list.

| Variable | Required | Purpose |
|---|---|---|
| `PORT` | no (4000) | API port |
| `NODE_ENV` | yes in prod | `production` disables dev conveniences |
| `APP_URL` | yes | Public base URL — used for Paystack callback URLs and sandbox payment links |
| `JWT_SECRET` | **yes** | Long random string (`openssl rand -hex 32`) |
| `JWT_TTL` | no | e.g. `7d`, `12h` |
| `DATA_DIR`, `DB_FILE` | no | SQLite location (dev/CI only) |
| `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY` | yes for live payments | From the client's Paystack dashboard |
| `PAYSTACK_MOCK` | no | `true` forces the built-in sandbox gateway |
| `FLUTTERWAVE_SECRET_KEY` | optional | Enables the Flutterwave adapter |
| `SMS_PROVIDER`, `SMS_API_KEY` | yes for real OTP | `termii` or `twilio`; blank logs codes to console |
| `FCM_SERVER_KEY` | yes for push | Firebase Cloud Messaging |
| `GOOGLE_MAPS_API_KEY` | yes for real distances | Distance Matrix + Geocoding |
| `ALLOW_DEV_OTP` | no | Accepts `000000` outside production **only** when explicitly enabled |
| `CORS_ORIGIN` | yes if web is on another domain | Comma-separated allowlist |

## 3. Moving to PostgreSQL (production target)

SQLite is a deliberate dev/CI choice. Production requires Postgres for concurrency, backups and
replicas. Checklist (≈1–2 dev days, scripted):

1. `npm i pg` and add `server/src/lib/db-postgres.js` exposing the same `db.prepare().all/get/run`
   surface (`?` → `$n` conversion, `db.transaction(fn)` → `BEGIN/COMMIT`).
2. Translate `SCHEMA` in `server/src/lib/db.js`: `TEXT` stays `TEXT`, `INTEGER` → `integer`/`bigint`,
   `REAL` → `numeric`, add `GENERATED` identity or UUID defaults for ids (ids are already app-generated,
   so no change is needed).
3. Replace `INSERT OR IGNORE` (used in the seed only) with `ON CONFLICT DO NOTHING`.
4. Replace `MAX(0, stock - ?)` inside `UPDATE ... SET stock =` with `GREATEST(0, stock - $1)` in the
   one place it appears (`orders.js` checkout).
5. Keep SQLite for `npm test` (fast, isolated) and add a Postgres job to CI.
6. Seed production with categories, fees, zones and one admin — **never** the demo data.

## 4. Reference production topology

| Component | Recommended | Alternatives |
|---|---|---|
| API (`server/`) | Railway / Render / Fly.io — 2 instances behind the platform LB | AWS ECS, DigitalOcean App Platform |
| Web (`web/dist`) | Served by the API (simplest) or Vercel/Netlify | Cloudflare Pages |
| Database | Managed Postgres 16 with daily snapshots + PITR | Neon, Supabase, RDS |
| Object storage | Cloudflare R2 (no egress fees) or S3 | — |
| DNS/TLS | Cloudflare, HTTP→HTTPS redirect, HSTS | — |
| Monitoring | Sentry (errors) + platform metrics + uptime ping on `/api/health` | Grafana Cloud |

Costs at launch scale: **≈$150–$400/month** (see `PROPOSAL.md` §7). All accounts in the client's name.

## 5. Deploying

### 5a. PaaS (recommended for launch)

```bash
# Dockerfile (repo root) — single image that serves API + built SPA
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev --workspaces --include-workspace-root || npm install --omit=dev
COPY . .
RUN npm run build -w web
ENV NODE_ENV=production PORT=4000
EXPOSE 4000
CMD ["node", "server/src/index.js"]
```

Set the environment variables from §2 in the host's dashboard, point the health check at
`/api/health`, and enable auto-deploy from `main`.

### 5b. VPS (Node + PM2 + nginx)

```bash
git clone <repo> /var/www/buybuddy && cd /var/www/buybuddy
npm ci && npm run build -w web
npm i -g pm2
pm2 start server/src/index.js --name buybuddy-api -i 2
pm2 save && pm2 startup
```

nginx (TLS via certbot):

```nginx
server {
  server_name api.buybuddy.ng;
  client_max_body_size 8m;
  location / { proxy_pass http://127.0.0.1:4000; proxy_set_header Host $host;
               proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
               proxy_set_header X-Forwarded-Proto $scheme; }
}
```

### 5c. Paystack go-live checklist

1. Paystack business account approved (CAC, settlement bank) → live **secret** key.
2. Dashboard → Settings → API Keys/Webhooks → webhook URL `https://<api-host>/api/webhooks/paystack`.
3. Set `PAYSTACK_SECRET_KEY` (live key) and `PAYSTACK_MOCK=false`; restart the service.
4. Make one ₦100 live test order end-to-end; confirm the payment row is `success` **once** and the
   order reached `paid`.
5. Send the same webhook twice from the Paystack dashboard; confirm no duplicate payment/order.
6. Confirm refunds from the admin panel reconcile against the Paystack dashboard.

## 6. Backups & restore (must be rehearsed)

```bash
# SQLite (dev/staging)
sqlite3 server/data/buybuddy.sqlite ".backup '/backups/bb-$(date +%F).sqlite'"

# Postgres (production) — managed snapshots + nightly logical dump
pg_dump "$DATABASE_URL" | gzip > /backups/bb-$(date +%F).sql.gz
```

Monthly drill: restore yesterday's dump into a scratch database, boot the API against it, sign in,
and place one test order. Record the result. **A backup you have never restored is not a backup.**

## 7. Store submission (Phase 2 / native apps)

* Apple Developer Program ($99/yr) and Google Play Console ($25 one-off) — **client-owned accounts**.
* Required assets: app icon (1024×1024), screenshots per device size, privacy policy URL, support URL,
  age rating, data-safety answers (location + financial data), and demo credentials for reviewers.
* Apple will reject: incomplete flows, an account-deletion path that is missing, and payment for
  physical goods through in-app purchase (BUYBUDDY correctly uses Paystack — goods are physical).
* Budget two review cycles and two weeks of buffer; ship the PWA first so launch is not gated on review.

## 8. Operations runbook (first 30 days)

| Situation | Action |
|---|---|
| Payment received, order stuck at `pending_payment` | Check `/api/admin/orders/:id` → verify payment reference → admin `/status` or `/refund` |
| Rider cannot complete delivery (PIN lost) | Admin verifies ID by phone, then `/api/admin/orders/:id/status` to `delivered` with a note (audit-logged) |
| Merchant goes dark mid-order | Admin reassigns or refunds + cancels; suspend the store via merchants → suspend |
| Shopper proposes an absurd price | Customer rejects the item; ops reviews the shopper's approval history |
| Suspected fraud account | Admin → people → suspend (revokes sessions instantly) |
| Spike in 5xx | `/api/health`, host metrics, Sentry; roll back to the previous release if correlated with a deploy |

## 9. CI

`.github/workflows/ci.yml` runs on every push and PR: installs, seeds a throwaway DB, runs the
integration suite, and builds the web bundle. Enable branch protection on `main` and require the
`test` check before merge.
