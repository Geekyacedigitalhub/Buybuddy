# Brand assets

| File | What it is |
|---|---|
| `app-icon-preview.png` | How the launcher icon renders on Android — square, squircle, circle, round, plus home-screen and small-size checks |
| `app-icon-192.png` | The master 192×192 icon |

Palette: forest green `#176B55`, white `#FFFFFF` glyph, warm orange `#E4792F` accent,
background `#F5F7F4`.

## Where the icon is used

- **Android app** — `mobile/android/app/src/main/res/mipmap-*/` — `ic_launcher.png`,
  `ic_launcher_round.png` and `ic_launcher_foreground.png` at mdpi 48 → xxxhdpi 192,
  plus adaptive-icon XML (`mipmap-anydpi-v26`) with a `#176B55` background and a
  monochrome layer for Android 13+ themed icons.
- **PWA / web** — `web/public/icons/` — 192, 512, maskable 512, apple-touch 180,
  favicon 32, all referenced from `web/public/manifest.webmanifest`.

## Swapping in a different logo

Replace the source art and rebuild the four icon sets:

1. Drop the new logo (1024×1024 PNG, transparent background) somewhere and note its path.
2. Regenerate `web/public/icons/*` and `mobile/android/app/src/main/res/mipmap-*/*`.
3. `npm run build -w web && cd mobile && npx cap sync android && cd android && ./gradlew assembleDebug`
4. Upload the new APK to a GitHub Release.

Keep the glyph inside the middle ~66% of the canvas: Android launchers crop adaptive
icons with circle, squircle and rounded-square masks, so art near the edges gets cut.
