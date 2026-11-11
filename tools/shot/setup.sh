#!/bin/bash
# Rebuilds the browser rig after a sandbox reset (node_modules and ~/.cache are
# not part of the saved workspace). Safe to run repeatedly.
set -e
cd /home/user/tools/shot
[ -d node_modules/puppeteer ] || npm install --no-audit --no-fund puppeteer@24 >/dev/null 2>&1
[ -x /home/user/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome ] || npx puppeteer browsers install chrome >/dev/null 2>&1
LIBS=/home/user/.cache/libs/usr/lib/x86_64-linux-gnu
if [ ! -f $LIBS/libatk-1.0.so.0 ]; then
  mkdir -p /tmp/libs && cd /tmp/libs
  for p in libnspr4 libnss3 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libdrm2 libxkbcommon0 \
           libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 \
           libasound2t64 libatspi2.0-0t64 libx11-6 libxcb1 libxext6 libglib2.0-0t64 libdbus-1-3 \
           libexpat1 libxcb-render0 libxcb-shm0 libxrender1 libpixman-1-0 libfontconfig1 \
           libfreetype6 libpng16-16 libbrotli1 libbz2-1.0 libzstd1 libselinux1 libpcre2-8-0 \
           libffi8 libuuid1 libsystemd0 liblz4-1 libcap2 libgcrypt20 libgpg-error0 liblzma5 \
           libunistring5 libgraphite2-3 libharfbuzz0b libthai0 libdatrie1 libfribidi0 libbsd0 \
           libmd0 libavahi-common3 libavahi-client3 libgnutls30t64 libp11-kit0 libtasn1-6 \
           libnettle8t64 libhogweed6t64 libidn2-0 libgmp10; do
    apt-get download $p >/dev/null 2>&1 || true
  done
  for d in *.deb; do dpkg-deb -x "$d" /home/user/.cache/libs; done
fi
echo "browser rig ready"
