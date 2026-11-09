# Play Store listing — copy and paste these fields

Everything here is ready to paste into the Google Play Console. Character limits are noted so you
don't get bounced back by the form.

---

## App name (max 30 characters)

```
BUYBUDDY: Personal Shopper
```

## Short description (max 80 characters)

```
Groceries, food, pharmacy and anything else — delivered across Lagos.
```

## Full description (max 4000 characters)

```
BUYBUDDY is your personal shopping partner in Lagos.

Order from supermarkets, restaurants, pharmacies and fashion stores around you — or point a real
person at something you need and let them go and get it. A verified BUYBUDDY shopper buys it, uploads
the receipt, and a rider brings it to your door.

TEN CATEGORIES, ONE APP
Groceries and supermarket, food and restaurants, fashion and clothing, electronics and gadgets,
pharmacy and health, beauty and personal care, home and household, drinks and beverages, baby
products, and "Shop for me" for everything else.

SHOP FOR ME — SEND A PHOTO, GET THE ITEM
Saw something in a shop but there's no online store for it? Send a photo or type a list. A shopper
finds it, tells you the real price, and waits for your approval before buying anything. If the item
is out of stock, they propose a substitute and you decide. Your money is never spent without your
say-so.

TRACK IT TO YOUR DOOR
Follow your rider on the map, chat in the app, and share a delivery code only when the order is in
your hands. Riders can't close a job without it.

PAY THE WAY YOU WANT
Pay securely with your card through our licensed payment processor, from your BUYBUDDY wallet, or
cash on delivery.

BUILT FOR NIGERIAN SHOPPING
Naira prices. Lagos areas. Local stores. Support that answers.

EARN AS A BUYBUDDY WORKER
Shopping for others or delivering with us? Personal shoppers and riders choose when to go online,
see the fee before accepting a job, and track their earnings and payouts inside the same app.
Stores can manage stock, prices and orders from the merchant dashboard.

WHAT WE DON'T DO
We don't sell your data. We don't store your card details. We don't promise a delivery time we
can't keep — Lagos traffic is real.

Need help? support@buybuddy.ng
Privacy: https://buybuddy-805j.onrender.com/legal/privacy.html
Terms: https://buybuddy-805j.onrender.com/legal/terms.html
```

## Release notes — "What's new" (max 500 characters)

```
Your rider is now on the map for real — riders tap "Share" and you watch the bike move down your
street, with the route they took, distance and a live ETA. Also in this version: merchants
photograph their own products and storefront right in the app.
```

---

## Console settings

| Field | Value |
|---|---|
| App or game | App |
| Free or paid | Free |
| Category | Shopping |
| Tags | Shopping, Food & Drink, Delivery |
| Contact email | support@buybuddy.ng |
| Website | https://buybuddy-805j.onrender.com |
| Privacy policy | https://buybuddy-805j.onrender.com/legal/privacy.html |
| Content rating | Everyone (no ads, no user-to-user content beyond order chat) |
| Ads | No |
| In-app purchases | No (payments are for goods, not digital content) |

### Data safety form — answer like this

| Question | Answer |
|---|---|
| Does your app collect or share data? | Yes |
| Data types collected | Personal info (name, email, phone), Address, **Precise location** (riders, only while a delivery is running), Photos, Purchase history, App activity |
| Is data encrypted in transit? | Yes |
| Can users request deletion? | Yes — email privacy@buybuddy.ng |
| Is data shared with third parties? | Yes — payment processor, SMS provider, hosting |
| Is data used for advertising? | No |
| Location collected | Riders only, while sharing is switched on during a delivery; it stops when the delivery ends. Not collected from customers. |

### App access (required — reviewers must be able to log in)

Paste exactly this into **App access → Add instructions**:

```
App name: BUYBUDDY
1. Open the app. It opens on the sign-in screen.
2. Email: review@buybuddy.ng
   Password: Review-Only-2026-Kola
3. The account already has a delivered order and one live delivery, so the
   order list, tracking map and receipts are all populated.
4. To shop: any category → add an item → cart → checkout. Payment methods are
   card, bank transfer, Pay with Bank (OPay/PalmPay/Kuda), USSD, wallet and
   cash on delivery. Card payments require a real card, so use Wallet or
   Cash on delivery to complete a test order.
All customer features are available with this login. No staff features are
needed to review the app.
```

That account is a plain customer — it cannot reach the merchant, rider or admin
dashboards. Do not put the owner's password in the Play Console.

> **Important:** the free server sleeps after ~15 minutes idle. If the reviewer hits a cold start,
> the app takes about 30 seconds to wake. A paid instance removes this entirely — worth doing before
> you submit, so a reviewer doesn't mark it "app not working".

---

## Files in this folder

| File | Where it goes in the Play Console |
|---|---|
| `BUYBUDDY-1.7.aab` | Production → Create new release → upload this file |
| `icon-512.png` | Store listing → App icon (512×512) |
| `feature-graphic-1024x500.png` | Store listing → Feature graphic |
| `screenshots/phone-*.png` | Store listing → Phone screenshots (1080×1920, 5 of them) |
| `BUYBUDDY-v1.7.apk` | The install file for sharing directly (same build, signed with the same key) |

### Release notes — "What's new" (max 500 characters)

```
First release. Order groceries, food, pharmacy and fashion across Lagos, or send
a photo of anything and a verified BUYBUDDY shopper buys it for you. Pay by card,
bank transfer, OPay/PalmPay/Kuda, USSD, wallet or cash on delivery. Track your
rider on a live map to the door.
```

### Version being uploaded

| | |
|---|---|
| File | `BUYBUDDY-1.8.aab` |
| Version name | 1.8 |
| Version code | 10 |
| Package | `ng.buybuddy.app` |
| Signed with | `buybuddy-release.jks`, alias `buybuddy` (the upload key — back it up) |
| Min Android | 5.1 (API 22) |
| Target Android | 14 (API 34) |

The `.aab` is what Google wants. `BUYBUDDY-v1.8.apk` is the same build in
installable form — use it to test on your own phone before submitting.
