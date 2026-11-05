import React, { useState } from 'react';
import { getApiBase, setApiBase } from '../lib/api.js';

/**
 * First-run setup for the installed mobile app.
 *
 * A bundled app has to be told where its server lives — the phone has no
 * "current website" to make relative requests against. We ask once, verify the
 * address really is a BUYBUDDY server, then never ask again on that device.
 */
export default function ServerSetup() {
  const [url, setUrl] = useState(getApiBase() || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const connect = async (e) => {
    e?.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const clean = setApiBase(url);
      if (!clean) throw new Error('Enter your BUYBUDDY server address.');
      const res = await fetch(`${clean}/api/health`, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`That address answered with ${res.status}. Check it and try again.`);
      const data = await res.json();
      if (!data?.version && !data?.payments) throw new Error('That address is reachable but is not a BUYBUDDY server.');
      window.location.replace('/');
    } catch (err) {
      setApiBase('');
      setError(
        err.message ||
        'Could not reach that address. Make sure the server is running and the address starts with https://'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--green-800, #176B55)', display: 'grid', placeItems: 'center',
      padding: 22, fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
    }}>
      <form
        onSubmit={connect}
        style={{ background: '#fff', borderRadius: 20, padding: 22, width: '100%', maxWidth: 420, boxShadow: '0 18px 50px rgba(0,0,0,.28)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 12, background: '#176B55', display: 'grid', placeItems: 'center',
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round">
              <path d="M6.5 8.5h11l-1 11h-9z" />
              <path d="M9.3 8.5V6.8a2.7 2.7 0 0 1 5.4 0v1.7" strokeLinecap="round" />
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#0B2F27' }}>BUYBUDDY</div>
            <div style={{ fontSize: 11.5, color: '#6B7C76', letterSpacing: '.06em', fontWeight: 700 }}>CONNECT TO YOUR SERVER</div>
          </div>
        </div>

        <p style={{ fontSize: 13.5, lineHeight: 1.6, color: '#4A5A54', margin: '12px 0 16px' }}>
          One-time setup. Enter the web address of your BUYBUDDY server — the app will remember it
          and you will not see this screen again.
        </p>

        <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#0B2F27', marginBottom: 6 }}>
          Server address
        </label>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://buybuddy-xxxx.onrender.com"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          style={{
            width: '100%', padding: '13px 14px', borderRadius: 12, border: '1.5px solid #D9E2DE',
            fontSize: 15, outline: 'none', boxSizing: 'border-box', color: '#0B2F27',
          }}
        />

        {error && (
          <div style={{ marginTop: 12, background: '#FDECEC', color: '#B42318', padding: '10px 12px', borderRadius: 10, fontSize: 12.5, lineHeight: 1.5 }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          style={{
            width: '100%', marginTop: 16, padding: '14px 16px', borderRadius: 12, border: 'none',
            background: busy ? '#8FB3A8' : '#176B55', color: '#fff', fontSize: 15, fontWeight: 700,
          }}
        >
          {busy ? 'Checking…' : 'Connect'}
        </button>

        <p style={{ fontSize: 11.5, color: '#8A9994', marginTop: 14, lineHeight: 1.5, textAlign: 'center' }}>
          Don't have a server yet? Deploy one free from the project README — you get a
          permanent https address in about three minutes.
        </p>
      </form>
    </div>
  );
}
