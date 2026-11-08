import React, { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { Icon } from '../lib/ui.jsx';
import { watchLocation, metresBetween } from '../lib/geo.js';

/**
 * "Share my live location" for riders.
 *
 * The customer's map already drew a dot sliding along a straight line between
 * the shop and the address — a guess. This makes it real: while the rider is on
 * a delivery, the phone reports where it actually is, and the customer watches
 * the bike move down their street.
 *
 * It is off until the rider turns it on, it stops by itself the moment the
 * delivery ends, and every failure is explained in plain words.
 */
export default function LiveLocation({ orderId, status }) {
  const [sharing, setSharing] = useState(false);
  const [fix, setFix] = useState(null);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const stopRef = useRef(null);
  const sentRef = useRef({ at: 0, fix: null });
  const errorRef = useRef(null);

  const active = ['rider_assigned', 'picked_up', 'in_transit'].includes(status);

  const stop = () => {
    stopRef.current?.();
    stopRef.current = null;
    setSharing(false);
  };

  // Stop reporting the instant the delivery is over, or the screen closes.
  useEffect(() => () => stopRef.current?.(), []);
  useEffect(() => {
    if (!active && stopRef.current) stop();
  }, [active]);

  const send = async (f) => {
    // Re-sending a fix for a bike that has not moved is a wasted radio wake-up.
    const moved = metresBetween(sentRef.current.fix, f);
    if (moved < 15 && Date.now() - sentRef.current.at < 10000) return;
    sentRef.current = { at: Date.now(), fix: f };
    setSending(true);
    try {
      await api.post(`/api/worker/jobs/${orderId}/location`, {
        lat: f.lat, lng: f.lng, accuracy: f.accuracy, speed: f.speed, heading: f.heading,
      });
      errorRef.current = null;
      setError('');
    } catch (e) {
      // Keep the last good position visible; the number keeps climbing only in
      // the message, so the rider knows the map is no longer live.
      setError(e.message || 'Your location could not be sent.');
    } finally {
      setSending(false);
    }
  };

  const start = () => {
    setError('');
    setSharing(true);
    stopRef.current = watchLocation(
      (f) => { setFix(f); send(f); },
      (msg) => { setError(msg); }
    );
  };

  if (!active) return null;

  const age = fix ? Math.max(0, Math.round((Date.now() - new Date(fix.at).getTime()) / 1000)) : null;

  return (
    <div className="card col" style={{ gap: 10, borderColor: sharing && !error ? 'var(--green-100)' : undefined, background: sharing && !error ? 'var(--green-50)' : undefined }}>
      <div className="row-between" style={{ gap: 10 }}>
        <div className="row" style={{ gap: 9 }}>
          <span className="loc-dot" data-on={sharing && !error ? 'yes' : 'no'} />
          <div>
            <div className="strong" style={{ fontSize: 13.5 }}>
              {sharing && !error ? 'Sharing your live location' : 'Live location'}
            </div>
            <div className="tiny muted">
              {sharing && !error
                ? fix
                  ? `Accurate to about ${fix.accuracy ?? '?'} m · last sent ${age}s ago${sending ? ' · sending…' : ''}`
                  : 'Waiting for a GPS fix…'
                : 'The customer sees a guessed position until you share yours.'}
            </div>
          </div>
        </div>
        <button
          type="button"
          className={`btn btn-sm ${sharing ? 'btn-ghost' : 'btn-primary'}`}
          onClick={sharing ? stop : start}
        >
          <Icon name={sharing ? 'x' : 'pin'} size={14} />
          {sharing ? 'Stop' : 'Share'}
        </button>
      </div>
      {error && <div className="tiny" style={{ color: 'var(--danger)' }}>{error}</div>}
      <div className="tiny muted">
        Your location is only used for this delivery and stops when it is completed.
      </div>
    </div>
  );
}
