import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

/**
 * The live delivery map.
 *
 * OpenStreetMap tiles — no API key, no monthly bill, no card on file. Leaflet is
 * bundled with the app (not loaded from a CDN), so the map code works even on a
 * slow connection; only the tile images need the network.
 *
 * If the tiles cannot be reached — offline, or a locked-down preview — the map
 * falls back to the drawn schematic so the screen never turns into a grey box.
 * A customer in a moving car still needs to understand where their rider is.
 */

const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; OpenStreetMap contributors';

const pin = (colour, glyph) =>
  L.divIcon({
    className: 'bb-pin',
    html: `<span style="
        width:30px;height:30px;border-radius:50% 50% 50% 4px;transform:rotate(45deg);
        background:${colour};box-shadow:0 6px 14px rgba(9,40,31,.35);
        display:grid;place-items:center;border:2px solid #fff">
        <span style="transform:rotate(-45deg);font-size:12px;line-height:1;color:#fff;font-weight:800">${glyph}</span>
      </span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 28],
    popupAnchor: [0, -26],
  });

export default function DeliveryMap({ pickup, destination, rider, trail = null, height = 230, fallback = null }) {
  const holder = useRef(null);
  const mapRef = useRef(null);
  const riderRef = useRef(null);
  const trailRef = useRef(null);
  const [tilesUp, setTilesUp] = useState(false);

  useEffect(() => {
    if (!holder.current || !pickup || !destination) return undefined;

    const map = L.map(holder.current, {
      zoomControl: true,
      attributionControl: true,
      scrollWheelZoom: false, // a scroll gesture should scroll the page, not the map
    });
    mapRef.current = map;

    map.attributionControl.setPrefix(false); // keep the credit line to who actually did the work
    const tiles = L.tileLayer(TILE_URL, { maxZoom: 19, attribution: ATTRIBUTION });
    let loaded = 0;
    tiles.on('tileload', () => {
      loaded += 1;
      if (loaded >= 2) setTilesUp(true); // two tiles is enough to know the network works
    });
    tiles.addTo(map);

    L.marker([pickup.lat, pickup.lng], { icon: pin('#176B55', 'S') })
      .addTo(map)
      .bindPopup(`<b>${pickup.label || 'Store'}</b><br/>Picked up here`);
    L.marker([destination.lat, destination.lng], { icon: pin('#E4792F', 'Y') })
      .addTo(map)
      .bindPopup(`<b>${destination.label || 'Delivery address'}</b><br/>Delivering here`);

    // The path the phone actually recorded. Without it the map would show only
    // where the rider is now, with no sense of where they have been.
    if (Array.isArray(trail) && trail.length > 1) {
      trailRef.current = L.polyline(
        trail.map((t) => [t.lat, t.lng]),
        { color: '#0C4436', weight: 3, opacity: 0.55, lineCap: 'round' }
      ).addTo(map);
    }

    const points = [[pickup.lat, pickup.lng], [destination.lat, destination.lng]];
    if (rider) points.splice(1, 0, [rider.lat, rider.lng]);
    L.polyline(points, {
      color: '#176B55', weight: 4, opacity: 0.75, dashArray: '8 7', lineCap: 'round',
    }).addTo(map);

    if (rider) {
      riderRef.current = L.marker([rider.lat, rider.lng], { icon: pin('#0C4436', 'R'), zIndexOffset: 500 })
        .addTo(map)
        .bindPopup('Your rider is here');
    }

    map.fitBounds(L.latLngBounds(points).pad(0.35), { animate: false });

    // A phone screen is small; a half-loaded map is worse than none.
    const t = setTimeout(() => map.invalidateSize(), 120);
    return () => {
      clearTimeout(t);
      map.remove();
      mapRef.current = null;
      riderRef.current = null;
    };
  }, [pickup?.lat, pickup?.lng, destination?.lat, destination?.lng]);

  // move the rider marker as the tracking feed updates, without rebuilding the map
  useEffect(() => {
    if (riderRef.current && rider) riderRef.current.setLatLng([rider.lat, rider.lng]);
  }, [rider?.lat, rider?.lng]);

  // extend the travelled path as the rider moves
  const trailKey = Array.isArray(trail) ? trail.length : 0;
  useEffect(() => {
    if (!trailRef.current || !Array.isArray(trail)) return;
    trailRef.current.setLatLngs(trail.map((t) => [t.lat, t.lng]));
  }, [trailKey]);

  return (
    <div style={{ position: 'relative', height, borderRadius: 16, overflow: 'hidden', background: '#eef3ef' }}>
      <div ref={holder} style={{ position: 'absolute', inset: 0, zIndex: 2, opacity: tilesUp ? 1 : 0, transition: 'opacity .35s ease' }} />
      {!tilesUp && fallback}
      {!tilesUp && (
        <div style={{
          position: 'absolute', bottom: 8, right: 10, zIndex: 3, fontSize: 10.5,
          color: 'var(--ink-3)', background: 'rgba(255,255,255,.85)', borderRadius: 8,
          padding: '2px 7px', fontWeight: 600,
        }}>
          Connecting to map…
        </div>
      )}
    </div>
  );
}
