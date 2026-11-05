import React, { useState } from 'react';
import { getApiBase, setApiBase } from '../lib/api.js';

/**
 * First-run onboarding for the installed mobile app.
 *
 * A bundled app has no origin to make relative requests against, so it has to be
 * told where its server lives — once. This is written as a branded welcome screen
 * rather than a settings form, because it is the first thing a customer ever sees.
 */

const BENEFITS = [
  ['⚡', 'Groceries in minutes', 'Shop 10 categories from stores around you'],
  ['📸', 'Shop for me', 'Send a photo or a list — a buddy finds it and prices it'],
  ['🛵', 'Live tracking', 'Follow your rider to the door and pay on delivery'],
];

export default function ServerSetup() {
  const [url, setUrl] = useState(getApiBase() || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [showField, setShowField] = useState(false);

  const connect = async (e) => {
    e?.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const clean = setApiBase(url);
      if (!clean) throw new Error('Enter your BUYBUDDY address to continue.');
      const res = await fetch(`${clean}/api/health`, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`That address answered with ${res.status}. Check it and try again.`);
      const data = await res.json();
      if (!data?.version && !data?.payments) throw new Error('That address is reachable but is not a BUYBUDDY server.');
      window.location.replace('/');
    } catch (err) {
      setApiBase('');
      setError(
        err.message ||
        'Could not reach that address. Check it starts with https:// and that the server is running.'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="onboard">
      <div className="onboard-glow onboard-glow-a" />
      <div className="onboard-glow onboard-glow-b" />

      <header className="onboard-head">
        <div className="onboard-mark" aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round">
            <path d="M6.5 8.5h11l-1 11h-9z" />
            <path d="M9.3 8.5V6.8a2.7 2.7 0 0 1 5.4 0v1.7" strokeLinecap="round" />
          </svg>
        </div>
        <div>
          <div className="onboard-word">BUYBUDDY</div>
          <div className="onboard-tag">Your Personal Shopping Partner</div>
        </div>
      </header>

      <h1 className="onboard-title">
        Anything you need.<br />Delivered by a buddy.
      </h1>

      <ul className="onboard-list">
        {BENEFITS.map(([icon, title, sub]) => (
          <li key={title}>
            <span className="onboard-ico" aria-hidden="true">{icon}</span>
            <span>
              <b>{title}</b>
              <em>{sub}</em>
            </span>
          </li>
        ))}
      </ul>

      <div className="onboard-card">
        {!showField ? (
          <button className="onboard-cta" onClick={() => setShowField(true)}>
            Get started
          </button>
        ) : (
          <form onSubmit={connect}>
            <label className="onboard-label" htmlFor="server">Your BUYBUDDY address</label>
            <input
              id="server"
              className="onboard-input"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://buybuddy.yourdomain.com"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
            />
            {error && <div className="onboard-error">{error}</div>}
            <button className="onboard-cta" type="submit" disabled={busy}>
              {busy ? 'Connecting…' : 'Continue'}
            </button>
          </form>
        )}
        <p className="onboard-fine">
          One-time setup. We store this address on this device and never ask again —
          change it later in Account settings.
        </p>
      </div>

      <footer className="onboard-foot">Lagos • Naira • Secured by Paystack</footer>
    </div>
  );
}
