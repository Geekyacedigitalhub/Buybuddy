/**
 * The rider's real location, as the phone sees it.
 *
 * The browser and the installed Android app both expose `navigator.geolocation`,
 * so there is one code path for both. What differs is the failure: on the web a
 * customer can simply click "block" and nothing happens for ever, in the app the
 * permission can be switched off system-wide. Every failure below is turned into
 * a sentence a rider can act on, because "GeolocationPositionError: 1" is not.
 */

const FRIENDLY = {
  1: 'BUYBUDDY is not allowed to use your location. Open your phone settings, find BUYBUDDY, and turn Location on.',
  2: 'Your phone cannot get a GPS fix right now. Step outside or near a window and try again.',
  3: 'Getting your location is taking too long. Try again in a moment.',
};

export const geoSupported = () =>
  typeof navigator !== 'undefined' && !!navigator.geolocation;

/**
 * Start reporting position. `onFix` receives {lat, lng, accuracy, speed, heading, at}
 * every time the phone has a new answer; `onError` receives a readable message.
 * Returns a function that stops the reporting.
 */
export function watchLocation(onFix, onError) {
  if (!geoSupported()) {
    onError?.('This device cannot share its location.');
    return () => {};
  }

  let lastReport = 0;
  const id = navigator.geolocation.watchPosition(
    (p) => {
      // A rider on a bike gets a fix every second; the server only needs one
      // every few seconds, and the battery pays for the difference.
      const t = Date.now();
      if (t - lastReport < 4000) return;
      lastReport = t;
      onFix?.({
        lat: p.coords.latitude,
        lng: p.coords.longitude,
        accuracy: Number.isFinite(p.coords.accuracy) ? Math.round(p.coords.accuracy) : null,
        speed: Number.isFinite(p.coords.speed) ? p.coords.speed : null,
        heading: Number.isFinite(p.coords.heading) ? p.coords.heading : null,
        at: new Date(p.timestamp || t).toISOString(),
      });
    },
    (err) => onError?.(FRIENDLY[err?.code] || err?.message || 'Your location is not available.'),
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 25000 }
  );

  return () => navigator.geolocation.clearWatch(id);
}

/** Metres between two points — used to decide whether a fix is worth sending. */
export function metresBetween(a, b) {
  if (!a || !b) return Infinity;
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
