# Moving BUYBUDDY from SQLite to PostgreSQL

> **Read this first.** BUYBUDDY v1.0 ships on SQLite on purpose: one file, zero
> operations, instant backups, and enough write throughput for the Lagos launch
> (thousands of orders a day). This document is the **migration path** for when
> you outgrow it — it is not something you need to do on day one.
>
> What exists in the repo today:
>
> | Piece | State |
> |---|---|
> | `migrations/001_init.postgres.sql` | ✅ generated, idempotent, 33 tables |
> | `server/scripts/gen-postgres-ddl.mjs` | ✅ regenerates that DDL from `db.js` |
> | `server/src/lib/sql.js` | ✅ `?` → `$n` placeholder + row-shaping helpers |
> | `docker-compose.yml --profile postgres` | ✅ Postgres 16 starts, applies `migrations/` |
> | Async driver wired into the app | ❌ **not done** — see "Step 4" |
>
> In plain language: the **database schema is ready** for Postgres and every table
> is created by one command. The application code still talks to SQLite's
> synchronous driver, so flipping the switch is a code change (estimated 3–5
> engineering days), not a config change. Nothing below breaks the current app.

---

## 1. When to migrate

Move when one of these is true — not before:

- More than ~50 write transactions per second sustained (SQLite serialises writes).
- You need read replicas, or two or more app servers behind a load balancer.
- You need point-in-time recovery (Postgres) instead of file snapshots (`litestream`).
- Analytics/reporting queries start slowing down checkout.

Until then, `litestream.yml` already gives you continuous off-site backups every
second, which covers the practical durability worry.

---

## 2. What is already done for you

### The schema

`migrations/001_init.postgres.sql` is generated **from the SQLite schema**, so the
two can never silently drift. Regenerate any time you change `db.js`:

```bash
node server/scripts/gen-postgres-ddl.mjs
# → migrations/001_init.postgres.sql  (idempotent: every statement is IF NOT EXISTS)
```

Apply it:

```bash
psql "$DATABASE_URL" -f migrations/001_init.postgres.sql
```

Or let Docker do it — the `postgres` profile mounts `./migrations` into
`/docker-entrypoint-initdb.d`, so a fresh volume is initialised automatically:

```bash
docker compose --profile postgres up
```

### The SQL portability helpers

`server/src/lib/sql.js` holds three small helpers so route code can be written once:

```js
import { toPgPlaceholders, rowsOf, runShape } from './sql.js';

toPgPlaceholders('SELECT * FROM orders WHERE id = ? AND status = ?');
// → 'SELECT * FROM orders WHERE id = $1 AND status = $2'
//   (skips ? inside quoted strings and comments)

rowsOf(result)  // → array of rows, whichever driver produced it
runShape(n)     // → { changes: n } normalised across drivers
```

These are deliberately tiny. They let you convert a route file mechanically and
test it against both engines while the migration is in flight.

---

## 3. Type mapping reference

SQLite is dynamically typed; Postgres is not. The generator already applies this
mapping — keep it in mind when you write new tables.

| SQLite declaration | Postgres | Notes |
|---|---|---|
| `TEXT PRIMARY KEY` | `text PRIMARY KEY` | ids are `ord_…`, `usr_…` strings — no sequences needed |
| `TEXT` (timestamps) | `text` | ISO-8601 strings, kept as text so JSON responses are unchanged |
| `INTEGER` (money) | `integer` / `bigint` | Naira is stored as whole naira — **no floats**, no rounding drift |
| `INTEGER` (booleans) | `integer` | `0`/`1` preserved to avoid touching every `if (row.x)` check |
| `TEXT UNIQUE` | `text UNIQUE` | plus partial unique index for nullable codes |
| JSON blobs (`*_json`) | `text` | still JSON-in-text; `jsonb` is a later optimisation |

The last two rows are deliberate compatibility choices: they keep the API
responses byte-identical during the cutover, at the cost of some Postgres
idiomaticity. Optimise after the migration is stable, not during it.

---

## 4. Step-by-step cutover

Estimated effort for an experienced Node engineer: **3–5 days**, plus a week of
shadow running.

**Step 1 — freeze the schema.** Stop adding tables. Land any pending columns via
`ensureColumn()` in `db.js` and regenerate the DDL.

**Step 2 — add the driver.** `npm i pg` in `server`. Build `server/src/lib/db-pg.js`
that exposes the **same four calls** the app already uses:

```js
db.prepare(sql).get(...params)     → single row | undefined
db.prepare(sql).run(...params)     → { changes }
db.prepare(sql).all(...params)     → rows[]
db.transaction(fn)                 → run fn atomically
```

Use `toPgPlaceholders()` inside it and a `pg.Pool`. The rest of the codebase does
not need to know which engine is underneath — that is the whole point of matching
the interface.

**Step 3 — transactions.** SQLite `db.transaction(fn)` is synchronous; Postgres is
not. Every call site inside a transaction must become `await`-ed and the enclosing
function `async`. Grep for `db.transaction(` — the hot ones are checkout
(`routes/orders.js`), settlement (`lib/orders.js`), and wallet movements.

**Step 4 — flip the switch behind a flag.**

```js
// server/src/lib/db.js
export const db = process.env.DATABASE_URL && process.env.DB_DRIVER === 'postgres'
  ? createPgAdapter(process.env.DATABASE_URL)
  : createSqliteAdapter();
```

Run the **full test suite against Postgres** before touching production:

```bash
DB_DRIVER=postgres DATABASE_URL=postgres://buybuddy:buybuddy@localhost:5432/buybuddy npm test -w server
```

The 19 integration tests are the acceptance gate — they drive real HTTP flows,
not mocks, so a green run means the adapter is faithful.

**Step 5 — migrate the data** (one-time, while the old server is read-only):

```bash
# 1. snapshot the SQLite file
sqlite3 data/buybuddy.sqlite ".backup data/buybuddy-snapshot.sqlite"

# 2. dump rows as JSON per table, then load into Postgres
node server/scripts/export-json.mjs > data/dump.json      # write this if you need it
psql "$DATABASE_URL" -f migrations/001_init.postgres.sql
node server/scripts/import-json.mjs data/dump.json

# 3. verify counts match, table by table
```

Target invariants after import: `users`, `stores`, `orders`, `order_items`,
`loyalty_entries`, `wallet_entries` row counts identical; `loyalty_entries` sum
per user identical; wallet `balance_after` of the latest entry per user identical.

**Step 6 — shadow run.** Point a staging copy at Postgres and replay a day of real
traffic (or the test suite in a loop) for a week. Compare error rates.

**Step 7 — cut over.** Deploy with `DATABASE_URL` set, watch `/api/ready` (it runs
`SELECT 1`), keep SQLite read-only for 30 days as the rollback.

---

## 5. Gotchas found while writing the DDL

- **`AUTOINCREMENT` is gone.** BUYBUDDY never used integer ids — every PK is a
  prefixed string (`ord_`, `usr_`, `loy_`). Nothing to change.
- **`INSERT OR IGNORE`** → `ON CONFLICT DO NOTHING` (idempotency keys, settings
  defaults, loyalty earns).
- **`INSERT … ON CONFLICT(x) DO UPDATE SET …`** works in both, but Postgres needs a
  real unique constraint on `x`. Check `order_assignments`, `referral_rewards`,
  `wallet_entries`.
- **Partial unique index** for `users.referral_code` (nullable) uses
  `WHERE referral_code IS NOT NULL` — SQLite and Postgres both accept this.
- **Case sensitivity.** SQLite `LIKE` is case-insensitive for ASCII; Postgres is
  not. Use `ILIKE` in search (`routes/catalog.js`) or `lower()` both sides.
- **Timestamp comparison.** Everything is ISO text; `ORDER BY created_at` is
  correct in both, but `datetime()` functions differ — prefer doing date maths in
  JavaScript, as the current code does.
- **Booleans.** `phone_verified` stays `integer 0/1` so `if (user.phone_verified)`
  keeps working in both engines.

---

## 6. Rollback

The SQLite file is never deleted during the cutover. Roll back by removing
`DATABASE_URL` / setting `DB_DRIVER=sqlite` and restarting — you lose only the
writes made while on Postgres, which is why the cutover happens in a maintenance
window with the queue drained.

---

## 7. Checklist

- [ ] `node server/scripts/gen-postgres-ddl.mjs` run after the last schema change
- [ ] `psql "$DATABASE_URL" -f migrations/001_init.postgres.sql` applied cleanly
- [ ] `DB_DRIVER=postgres npm test -w server` → 19/19 green
- [ ] `await` added to every transaction call site
- [ ] search uses `ILIKE`
- [ ] data import verified (row counts + loyalty sums + wallet balances)
- [ ] `/api/ready` returns 200 with `{"ready":true,"db":"ok"}`
- [ ] litestream snapshot retained for 30 days as rollback
