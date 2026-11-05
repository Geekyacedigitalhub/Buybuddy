# Installing BUYBUDDY on your phone

BUYBUDDY is a **PWA** (progressive web app). That means it installs to your home
screen like a normal app — no Play Store, no App Store, no waiting for review —
and it updates itself the moment we ship a new version.

You need **one thing first: a web address that starts with `https://`**. A phone
cannot install an app from `localhost`, because that address only exists on the
computer running it.

There are two ways to get that address. Option A is permanent and free.

---

## Option A — put it online properly (recommended, ~5 minutes, free)

This gives you a link you can open on any phone, send to a client, or give to a
pilot merchant.

1. Open **https://render.com/deploy?repo=https://github.com/Geekyacedigitalhub/Buybuddy**
2. Click **Sign in with GitHub** (a free Render account is created as you do it).
3. Render reads `render.yaml` from the repo and shows a service called **buybuddy**.
   Click **Apply** / **Create**.
4. Wait ~3 minutes. When it says **Live**, copy the address — it looks like
   `https://buybuddy-xxxx.onrender.com`.
5. Open that address **on your phone** and follow Option C below to install it.

What happens automatically on that host: the demo marketplace is seeded on first
boot (`SEED_IF_EMPTY`), sessions get a generated secret, and `/api/ready` is
watched as a health check.

**Free-plan behaviour to expect:** the app sleeps after ~15 minutes of no traffic,
so the first visit afterwards takes ~30 seconds. It also has no permanent disk, so
your data resets when the container restarts and the demo data is rebuilt. That's
perfect for showing people, not for real customers — for that, add a paid disk or
move to Postgres ([`POSTGRES_MIGRATION.md`](POSTGRES_MIGRATION.md)).

---

## Option B — the temporary preview link (right now)

While this workspace is open, the app is reachable at a temporary `https://`
address (the preview panel). It works on a phone, but it dies when the session
ends — use it to look, not to keep.

---

## Option C — installing it on the phone

### Android (Chrome, Samsung Internet, Edge)

1. Open the https link in **Chrome**.
2. Either tap the **Install app** button inside the app (Account screen, and a
   strip on the home screen), or open the **⋮** menu → **Install app** /
   **Add to Home screen**.
3. Confirm **Install**. The BUYBUDDY bag icon appears in your app drawer and on
   the home screen, with no address bar when opened.

### iPhone / iPad (must be Safari)

1. Open the https link in **Safari** (not Chrome — iOS only installs from Safari).
2. Tap the **Share** button (the square with an arrow, bottom of the screen).
3. Scroll down, tap **Add to Home Screen**.
4. Tap **Add**. BUYBUDDY appears on your home screen and opens full-screen.

### What you get after installing

- Full-screen, no browser bars — it feels like a native app.
- Long-press the icon for shortcuts straight to **Shop for me**, **My orders**
  and **Points & referrals**.
- The app shell is cached, so it opens instantly and shows a clear "you are
  offline" screen instead of a browser error when the network drops. Live data
  (prices, stock, order status) is always fetched fresh — never stale.

---

## Signing in on the phone

Same demo accounts, password `Password123!`:

| Role | Email |
|---|---|
| Customer | `customer@buybuddy.ng` |
| Shopper | `shopper@buybuddy.ng` |
| Rider | `rider@buybuddy.ng` |
| Merchant | `merchant1@buybuddy.ng` |
| Admin | `admin@buybuddy.ng` |

The customer app is the one built for a phone. The merchant and admin dashboards
work on a phone but are designed for a laptop screen.

---

## If "Install app" does not appear

| Symptom | Cause | Fix |
|---|---|---|
| No install prompt at all | The page is not `https://`, or it is a private/incognito tab | Use the real address, in a normal tab |
| Menu shows only "Add to Home screen" | Older Android/browser | Use that instead — same result |
| iPhone has no install option | You are in Chrome or Firefox on iOS | Open in Safari |
| Installed app shows an old version | The service worker is holding the old shell | Open the app, pull to refresh, or reinstall once; the server sends `no-store` for `sw.js` so this self-resolves |

---

## For the next stage: real app-store binaries

Installing from the web covers 100% of what you need for a demo and a pilot. When
you want **Play Store / App Store** listings (the brief asks for mobile apps), the
code is already prepared for it: the same React app is wrapped with Capacitor so
the store builds share the codebase, and the web build keeps working. That work
needs a Google Play developer account ($25 one-off) and an Apple developer account
($99/year) — both are client-owned accounts.
