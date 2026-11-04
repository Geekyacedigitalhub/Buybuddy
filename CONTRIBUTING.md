# Contributing to BUYBUDDY

## Branching
`main` is always deployable and protected. Work in `feat/<short-name>`, `fix/<short-name>` or
`chore/<short-name>` and open a PR. CI (`.github/workflows/ci.yml`) must pass.

## Local setup
```bash
npm install
npm run seed -w server
cp server/.env.example server/.env
npm run dev        # API :4000 + Vite :5173
npm test           # must be green before you push
```

## Conventions
* **Money** is an integer number of Naira. Never introduce floats.
* **State changes** go through `transition()` in `server/src/lib/orders.js` — never `UPDATE orders SET status`.
* **Authorisation** is checked server-side on every route; the client is never trusted.
* **Fees/settings** belong in the `settings` table, not hard-coded.
* **New privileged action** → add an `audit()` call.
* **New endpoint** → add it to `docs/API.md` and (ideally) an integration test.
* Commit messages: `feat: …`, `fix: …`, `docs: …`, `test: …`, `chore: …`.

## Definition of done
Works in all four role experiences where relevant · tests pass · docs updated · no secrets committed ·
no new console errors · keyboard reachable and labelled controls.
