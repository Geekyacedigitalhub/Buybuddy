# Play Store release

The binaries live outside the repository (they are build output, ~4 MB each):

- `BUYBUDDY-1.8.aab` — versionCode 10, signed with `buybuddy-release.jks`
- `BUYBUDDY-v1.8.apk` — the same build for installing by hand

What is here is everything you type into the Play Console:

- `listing.md` — store listing, data-safety answers, the App access block for
  reviewers, release notes, and the version table
- `SUBMIT-STEPS.md` — the click-by-click submission, with the traps that get
  marketplace apps rejected

## Rebuilding the app after a web change

The Android shell bundles the web build, so a change to the interface is only in
the app once the app is rebuilt — the live site updating is not enough.

```bash
VITE_API_URL= npm run build -w web
rm -rf mobile/android/app/src/main/assets/public/{assets,icons,img,logo,legal,index.html,manifest.webmanifest,sw.js}
cp -r web/dist/. mobile/android/app/src/main/assets/public/
cd mobile/android && ./gradlew --no-daemon --max-workers=1 assembleRelease bundleRelease
```

Bump `versionCode` in `mobile/android/app/build.gradle` every time you upload a
new build — Google refuses a version code it has already seen.
