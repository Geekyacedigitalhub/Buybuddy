# Keeping the free server warm

Render's free plan spins a service down after about 15 minutes without traffic. The next visitor
then waits roughly 30 seconds for it to wake. That is the only downside of the free plan — everything
works, it is just slow on the first tap after a quiet spell.

There are three honest ways to deal with it. Pick one.

---

## Option A — do nothing (₦0)

The app is fine. The first person after a quiet spell waits ~30 seconds once, then everything is
normal for everyone until it goes quiet again.

**Good for:** showing the app to people, testing, early conversations with shops.

**Not good for:** a customer who is hungry and in a hurry, or a Play Store reviewer who may read a
30-second blank screen as "this app is broken".

---

## Option B — ping it from outside (₦0)

Something outside Render taps the server every 10 minutes so it never falls asleep.

**Easiest version, no code:** create a free account at **uptimerobot.com** and add a monitor:

| Field | Value |
|---|---|
| Monitor type | HTTP(s) |
| Friendly name | BUYBUDDY |
| URL | `https://buybuddy-cebr.onrender.com/api/health` |
| Monitoring interval | 5 minutes |

That is it. UptimeRobot is free for one monitor at 5-minute intervals, and it also emails you if the
app ever goes down — which is genuinely useful on its own.

**Alternative, inside GitHub:** the file `keepalive-workflow.yml` in this folder is a ready-made
GitHub Action that does the same thing every 10 minutes, free on a public repository. To install it:

1. Move the file to `.github/workflows/keepalive.yml` in the repository.
2. Push it.

GitHub will refuse the push if the token used does not have the **workflow** scope — that is a GitHub
security rule for files in `.github/workflows/`, not a BUYBUDDY problem. The token in use does not
have it, which is why the file lives here instead.

**One caveat, stated plainly:** Render gives free accounts 750 instance-hours a month. A month is
about 730 hours, so a service kept awake around the clock fits — but only just. If the service gets
restarted a lot (each deploy), it can tip over and Render will pause it until the next month. The
UptimeRobot approach has the same arithmetic. If BUYBUDDY is going to be used by real customers this
month, skip to Option C.

---

## Option C — the $7/month instance (₦11,000/month)

Render **Starter** plan, on the same service:

1. Render dashboard → **buybuddy** service → **Settings** → **Instance Type** → **Starter**.
2. Confirm. It redeploys.

What changes:

- Never sleeps — no cold start, ever.
- The database survives restarts, so real orders are not wiped when the service redeploys.
- 512 MB RAM instead of 512 MB shared, so it handles several people at once comfortably.

This is the only one of the three that makes the app safe to hand to a paying stranger, and it is
worth doing **before** the Play Store submission. Everything else in BUYBUDDY — the app, the design,
the payments code, the SMS code — is already done and is not affected by this choice.
