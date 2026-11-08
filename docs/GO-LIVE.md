# Going live — the four switches

BUYBUDDY runs today with everything simulated in exactly four places. Each one is a **server setting**,
not a code change. Add the values in your host's dashboard (Render → your service → **Environment**),
save, and the service restarts with the switch flipped. No app update, no rebuild.

You can watch the count go up at **Admin → Go-live checks** in the web app.

---

## 1. Card payments — Paystack

| Setting | Value |
|---|---|
| `PAYSTACK_SECRET_KEY` | `sk_live_…` from your Paystack dashboard |

Get it at **dashboard.paystack.com → Settings → API Keys & Webhooks**. Use the **live** secret key, not
the test one. Then set the webhook URL to:

```
https://<your-domain>/api/payments/paystack/webhook
```

Paystack charges roughly **1.5% + ₦100** per transaction above ₦2,500 (capped at ₦2,000). Money settles
to your bank account on Paystack's schedule.

> **Before this can work:** Paystack must have approved your business (CAC/business name + bank account).
> Until then you only have test keys — the app treats them as sandbox and nothing is charged.

Flutterwave is also supported (`FLUTTERWAVE_SECRET_KEY`) if you prefer them; the checkout picks up
whichever is configured.

---

## 2. Text messages — Termii (recommended for Nigeria) or Twilio

| Setting | Value |
|---|---|
| `SMS_PROVIDER` | `termii` |
| `TERMII_API_KEY` | from **termii.com → Settings → API Keys** |
| `TERMII_SENDER_ID` | `BUYBUDDY` — must be **approved** in the Termii dashboard first |
| `TERMII_CHANNEL` | `generic` (default) or `dnd` for numbers on Do-Not-Disturb, or `whatsapp` |

**Or Twilio:**

| Setting | Value |
|---|---|
| `SMS_PROVIDER` | `twilio` |
| `TWILIO_ACCOUNT_SID` | `AC…` |
| `TWILIO_AUTH_TOKEN` | |
| `TWILIO_FROM` | `+1…` your Twilio number (or set `TWILIO_MESSAGING_SERVICE_SID`) |

### What gets sent, and when

| Moment | Message |
|---|---|
| Signup / phone verification | `123456 is your BUYBUDDY verification code. It expires in 10 minutes. Never share it.` |
| Order in transit | `BUYBUDDY: BB-12345678 is on its way. Your rider will call when they arrive…` |
| Delivered | `BUYBUDDY: BB-12345678 has been delivered…` |
| "Shop for me" priced | `Your personal shopper has priced BB-… Open the app to approve…` |
| Cancelled | `BB-… was cancelled. If you were charged, a refund is on its way.` |

Every message is written to the `sms_log` table with its provider reference, so support can answer
"I never got my code" with facts. **Admin → Go-live checks** shows the last twelve.

Numbers are normalised automatically: `0803…`, `803…`, `+234803…` and `234803…` all become
`+234803…`. Anything that is not a Nigerian mobile number is rejected before it costs you a credit.

Cost: roughly **₦4–8 per message** on Termii. A typical order sends two.

---

## 3. A real address — domain

| Setting | Value |
|---|---|
| `APP_URL` | `https://buybuddy.ng` |

1. Buy the domain (Namecheap, Whogohost, DomainKing — about ₦15–25k/year for `.ng`).
2. In Render → your service → **Settings → Custom Domains**, add it and follow the DNS instructions
   (usually two records).
3. Change `APP_URL` to the new address and restart.

`APP_URL` matters beyond cosmetics: it is the address payment providers send customers back to after a
card payment. If it is wrong, checkout completes but the customer lands on a broken page.

**This is also where you should move off the free instance.** Free services sleep after ~15 minutes and
lose their database on restart. The **$7/month** plan keeps the process warm and the data persistent.
Do this before submitting to the Play Store — a reviewer who sees a 30-second cold start may reject the
app as broken.

---

## 4. Maps — live rider tracking

| Setting | Value |
|---|---|
| `GOOGLE_MAPS_KEY` | Maps JavaScript API key from Google Cloud Console |

Optional. Right now the order screen shows progress and the rider's ETA rather than a map tile. With a
key it draws the live route. The free monthly credit covers early-stage volume.

---

## Order to do them in

1. **Paid hosting + domain** — everything else assumes a stable address.
2. **Paystack** — so a customer who installs from the Play Store can actually pay you.
3. **Termii** — so a real phone number can sign up.
4. **Maps** — polish, when you have riders on the road.

## Checking your work

Sign in as `admin@buybuddy.ng` → **Go-live checks**. Each row says either **Live** or **Simulated**, what
to set, and it lists recent SMS deliveries. When all five are green, BUYBUDDY is not a demo any more.

## If a switch stops working

- **Payments succeed but the order stays "pending payment"** → the webhook URL is wrong, or `APP_URL`
  does not match the public address.
- **OTP never arrives** → the Termii sender ID is not approved yet (messages silently fail), or the
  number is not Nigerian. Check `sms_log` for a `failed` row with the provider's reason.
- **"Invalid environment" on boot** → the service refuses to start rather than run half-configured. The
  log names the exact variable that is missing.
