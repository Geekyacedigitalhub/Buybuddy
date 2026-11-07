#!/usr/bin/env bash
# Build an APK with the server address baked in — no setup screen on first launch.
#
# Usage:
#   mobile/scripts/build-with-server.sh https://buybuddy.onrender.com
#
# Requires (already used to build v1.0/v1.1):
#   JAVA_HOME pointing at a JDK 17
#   Android SDK 34 + build-tools 34 (or a local.properties sdk.dir)
#
set -euo pipefail

SERVER="${1:-}"
if [[ -z "$SERVER" ]]; then
  echo "usage: $0 https://your-server-address" >&2
  exit 1
fi
SERVER="${SERVER%/}"                      # trailing slash off
if [[ ! "$SERVER" =~ ^https?:// ]]; then
  echo "error: address must start with https://" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

echo "▶ 1/4  building the web app with VITE_API_URL=$SERVER"
VITE_API_URL="$SERVER" npm run build -w web

echo "▶ 2/4  copying it into the native shell"
cd "$ROOT/mobile"
npx cap sync android

echo "▶ 3/4  compiling the APK"
cd "$ROOT/mobile/android"
./gradlew assembleDebug

APK="app/build/outputs/apk/debug/app-debug.apk"
echo "▶ 4/4  done: $ROOT/mobile/android/$APK"
echo
echo "The app will open straight to the sign-in screen — no address prompt."
echo "Publish it:  gh release upload <tag> $APK --clobber"
