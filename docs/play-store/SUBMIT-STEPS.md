# Putting BUYBUDDY on the Play Store — step by step

You do this once. It takes about an hour of your time plus Google's review wait (usually 1–7 days).
Everything technical is already done: the app is signed, the listing text is written, the pictures are
made, and the privacy policy has a working public link.

---

## Before you start — two things only you can do

**1. The $25 developer account.** Go to **play.google.com/console**, sign in with a Google account, and
pay the one-time **$25** registration fee. Use an account you will keep — it cannot be moved later.
You'll also need to complete Google's identity verification (ID document, and for a business, your CAC
details).

**2. Move the server to a paid instance — strongly recommended.** Google's reviewer will open the app
and try to log in. On the free plan the server sleeps after ~15 minutes, so they may see a 30-second
blank start and mark the app as broken. Roughly $7/month on Render removes this. Same server, same
code — just a plan change.

---

## The submission, click by click

1. In the Play Console, click **Create app**.
2. Fill in: App name **BUYBUDDY: Personal Shopper**, Default language **English (Nigeria)** or
   **English (United States)**, App or game **App**, Free or paid **Free**.
3. Tick both declarations (**Developer Program Policies** and **US export laws**) → **Create app**.

### Set up your app (left menu)

4. **App access** → *All functionality is available without special access* is **wrong** here. Choose
   **All or some functionality is restricted** and copy the block from `listing.md` verbatim —
   **`review@buybuddy.ng` / `Review-Only-2026-Kola`**. That is a real customer account with a delivered
   order and a live delivery in it; it cannot reach the merchant, rider or admin dashboards. Skipping
   this step is the most common reason a marketplace app gets rejected.
5. **Ads** → **No, my app does not contain ads**.
6. **Content ratings** → answer the questionnaire (Shopping app, no violence, no gambling, chat exists
   but only between a customer and their own order's rider) → you'll get **Everyone**.
7. **Target audience** → **18 and over** (this also keeps you out of the stricter children's rules).
8. **News app** → **No**.
9. **Data safety** → answer using the table in `listing.md`. Be honest: you collect name, email, phone,
   address, photos and purchase history, and you share them with a payment processor and SMS provider.
10. **Government apps** → **No**.

### Store listing (left menu → Grow → Store presence → Main store listing)

11. **App name:** `BUYBUDDY: Personal Shopper`
12. **Short description:** paste from `listing.md`
13. **Full description:** paste from `listing.md`
14. **App icon:** upload `icon-512.png`
15. **Feature graphic:** upload `feature-graphic-1024x500.png`
16. **Phone screenshots:** upload the 8 files in `screenshots/` in this order — `phone-01-home`,
    `phone-02-discover`, `phone-03-product`, `phone-04-cart`, `phone-05-checkout`, `phone-06-tracking`,
    `phone-07-orders`, `phone-08-shop-for-me`. All are 1080 × 1920, taken from the live app.
17. **Contact details:** email `support@buybuddy.ng`, website `https://buybuddy-805j.onrender.com`
18. Scroll up → **Save**.

### Privacy policy

19. **Policy → App content → Privacy policy** → paste:
    `https://buybuddy-805j.onrender.com/legal/privacy.html`
    (verified: it returns a live page, not a 404).

### Upload the app

20. Left menu → **Testing → Internal testing** → **Create new release**.
21. If Google asks about **Play App Signing**, accept it — Google keeps a backup of the signing key.
    Keep `buybuddy-release.jks` safe: it is your upload key, and losing it means a support request.
22. Upload **`BUYBUDDY-1.8.aab`** (the .aab, not the .apk).
23. Release notes: paste the "What's new" text from `listing.md` → **Next** → **Save** → **Review release**
    → **Start rollout to Internal testing**.
24. Add your own email under **Testers** and install it from the link Google gives you — this proves the
    Play-delivered build works before strangers see it.
25. When you're happy: **Production → Create new release → same .aab → roll out**.
    Google reviews it. You'll get an email.

---

## If Google rejects it

They always say why in **Policy status**. The three realistic ones for an app like this:

| Reason | Fix |
|---|---|
| "App access: reviewers could not log in" | The server was asleep or the login failed. Move to a paid instance, re-check the test account, resubmit. |
| "Privacy policy missing or unreachable" | The link must open a real page in a browser — it does; re-check you pasted the full `https://` address. |
| "Data safety mismatch" | You declared data you don't collect, or missed one you do. Compare with the table in `listing.md`. |

Nothing here requires the app to be rebuilt. You fix the form, resubmit, and the same signed file is
accepted.

---

## Keep this safe

`../Buybuddy-Android/signing/buybuddy-release.jks` plus its password (in
`README-KEY-BACKUP.txt`) is the app's identity. Put both in your cloud drive today. Lose it and you
cannot update BUYBUDDY under the same listing ever again.

---

## What is in this folder

| File | What it is |
|---|---|
| `BUYBUDDY-1.8.aab` | the file you upload to Google Play |
| `BUYBUDDY-v1.8.apk` | the same app, installable directly on your phone |
| `listing.md` | every word you paste into the Play Console, plus the App access block |
| `screenshots/` | eight 1080 × 1920 screenshots from the live app |
| `icon-512.png` | app icon, 512 × 512 |
| `feature-graphic-1024x500.png` | the banner Google shows at the top of your listing |
| `archive/` | the 1.7 build and old screenshots, kept for history |

## The one thing that can still bite you

The review account lives in the same database the free host wipes on every deploy.
If a deploy lands while Google is reviewing, `review@buybuddy.ng` stops existing
and the reviewer sees "incorrect details" — an automatic rejection. Before you
submit, either move to the paid instance ($7/month, data persists) or tell me the
submission date and I will keep deploys off the server until the review is done.
