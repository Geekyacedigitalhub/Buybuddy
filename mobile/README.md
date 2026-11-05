# The BUYBUDDY mobile app

This folder is the **native Android app**. It is not a website shortcut: it is a
real `.apk` file you install on the phone, with its own icon in the app drawer, its
own launcher entry, and the whole app bundled inside it (works on any Android
phone from version 5.1 up).

It is built with [Capacitor](https://capacitorjs.com): the same React app from
`web/` is compiled once, then wrapped in a native Android shell. That means one
codebase ships **web + Android** (and iOS from a Mac), and every feature we build
appears in all of them.

---

## The one thing to understand about a bundled app

A website knows where its server is — it *is* the server. An installed app is
just files on a phone, so it must be told the address of the BUYBUDDY server once:

```
First launch ──▶ "Connect to your server" screen ──▶ paste https://your-server ──▶ app opens
```

That address is stored on the device, so it is asked **once**. Because it is
configurable at runtime, the same APK works against a demo server, a staging
server, or a laptop on the same Wi-Fi — no rebuild needed. In the app you can
change it later under **Account → Server → Change server address**.

If your server is not online yet, deploy it in ~3 minutes for free
(see the root `README.md`), then paste the address it gives you.

---

## Installing the APK on a phone

1. Download `BUYBUDDY-v1.0.apk` from the
   [Releases page](https://github.com/Geekyacedigitalhub/Buybuddy/releases).
2. Open the downloaded file. Android will warn *"For your security, your phone is
   not allowed to install unknown apps from this source"* — that warning is
   expected: this build is not distributed through the Play Store yet.
3. Tap **Settings** in that dialog → enable **Allow from this source** → tap **Back**.
4. Tap **Install** → **Open**.
5. Paste your server address, tap **Connect**, then sign in.

If Android blocks the install silently, check **Settings → Apps → Special access →
Install unknown apps** and allow your browser or file manager.

---

## Rebuilding the APK

```bash
# 1. build the web app that gets bundled
npm install
npm run build -w web

# 2. copy it into the native project
cd mobile
npm install
npx cap sync android

# 3. compile
cd android
./gradlew assembleDebug

# output: android/app/build/outputs/apk/debug/app-debug.apk
```

Requirements: **JDK 17** and the **Android SDK** (platform 34, build-tools 34).
`./gradlew` downloads Gradle itself on first run.

Then upload the new `.apk` to a GitHub Release so phones can download it:

```bash
gh release upload v1.0-android android/app/build/outputs/apk/debug/app-debug.apk --clobber
```

---

## Signing: test build vs Play Store build

| | This APK | Play Store |
|---|---|---|
| Signing key | Android's standard debug key | your own **release keystore** |
| Who can install | anyone who enables "unknown sources" | anyone, via Play Store |
| Good for | demos, pilots, sending to a client today | public distribution |
| Needs from you | nothing | Google Play developer account (**$25, one-off**) |

Creating the release build is already wired up:

```bash
keytool -genkey -v -keystore buybuddy-release.jks -keyalg RSA -keysize 2048 \
  -validity 10000 -alias buybuddy
cd mobile/android && ./gradlew bundleRelease   # → app-release.aab for the Play Store
```

**Keep that keystore file and its password somewhere safe and offline.** If you
lose it you cannot update the app under the same listing, ever. It is git-ignored
on purpose — never commit it.

---

## iOS

The same project builds an iOS app (`npx cap add ios`), but Apple requires a Mac
with Xcode to compile it and an Apple Developer account (**$99/year**). Neither can
be done from a Linux machine, so this is a step to schedule when you have those.

---

## What the native shell gives you today — and what's next

Working now: installable app icon, splash screen, full-screen webview with no
browser bars, the app bundled offline, hardware back button, and the server
address selector.

Next native upgrades worth doing (each is a small, contained job):

1. **Push notifications (FCM)** — order updates on the lock screen.
2. **Background location for riders** — live tracking while the screen is off.
3. **Camera + gallery via native APIs** — smoother "Shop for me" photo capture.
4. **Biometric unlock** — fingerprint/face to reopen a signed-in session.
5. **Deep links** — `buybuddy.ng/orders/…` opens the app instead of the browser.
