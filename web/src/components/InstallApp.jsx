import React, { useEffect, useState } from 'react';
import { Icon } from '../lib/ui.jsx';

/**
 * Installable-app plumbing.
 *
 * Android/Chrome fires `beforeinstallprompt`; we hold onto that event and only
 * surface a button when the browser says the app can actually be installed.
 * iOS Safari never fires it, so there we explain the Share → Add to Home Screen
 * route instead of showing a dead button.
 */

const DISMISS_KEY = 'bb.install.dismissed';

const isStandalone = () =>
  (typeof window !== 'undefined') &&
  (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true);

const isIos = () =>
  typeof navigator !== 'undefined' &&
  /iphone|ipad|ipod/i.test(navigator.userAgent) &&
  !window.MSStream;

export function useInstallApp() {
  const [prompt, setPrompt] = useState(null);
  const [installed, setInstalled] = useState(isStandalone);
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
  });

  useEffect(() => {
    const onPrompt = (e) => {
      e.preventDefault();
      setPrompt(e);
    };
    const onInstalled = () => { setInstalled(true); setPrompt(null); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = async () => {
    if (!prompt) return { outcome: 'unavailable' };
    prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice?.outcome === 'accepted') setInstalled(true);
    setPrompt(null);
    return choice || { outcome: 'dismissed' };
  };

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* private mode */ }
    setDismissed(true);
  };

  return {
    canInstall: Boolean(prompt) && !installed,
    installed,
    showBanner: Boolean(prompt) && !installed && !dismissed,
    needsIosInstructions: isIos() && !installed,
    install,
    dismiss,
  };
}

/** Compact card for the Account screen. Always visible, so nobody has to hunt. */
export function InstallAppCard() {
  const { canInstall, installed, needsIosInstructions, install } = useInstallApp();

  if (installed) {
    return (
      <div className="card row" style={{ gap: 10, alignItems: 'center' }}>
        <Icon name="check" size={16} />
        <div>
          <div className="strong" style={{ fontSize: 13 }}>BUYBUDDY is installed</div>
          <div className="tiny muted">Open it from your home screen — it works like a normal app.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="card col" style={{ gap: 10 }}>
      <div className="h3">Install the app</div>
      {needsIosInstructions ? (
        <p className="sub" style={{ margin: 0 }}>
          On your iPhone: tap the <b>Share</b> button at the bottom of Safari, scroll down and choose
          <b> Add to Home Screen</b>, then tap <b>Add</b>. BUYBUDDY will appear on your home screen like any other app.
        </p>
      ) : canInstall ? (
        <>
          <p className="sub" style={{ margin: 0 }}>
            Add BUYBUDDY to your home screen for one-tap ordering and full-screen delivery tracking.
          </p>
          <button className="btn btn-primary" onClick={install}>
            <Icon name="plus" size={15} /> Install BUYBUDDY
          </button>
        </>
      ) : (
        <p className="sub" style={{ margin: 0 }}>
          Open BUYBUDDY in Chrome (Android) or Safari (iPhone) and use the browser menu —
          <b> Install app</b> or <b>Add to Home Screen</b> — to put it on your home screen.
        </p>
      )}
    </div>
  );
}

/** Dismissible strip shown once, on the customer home screen. */
export function InstallBanner() {
  const { showBanner, install, dismiss } = useInstallApp();
  if (!showBanner) return null;
  return (
    <div className="card row" style={{ gap: 10, alignItems: 'center', background: 'var(--green-50)', border: '1px solid var(--green-100)' }}>
      <span style={{ fontSize: 20 }}>📲</span>
      <div className="grow">
        <div className="strong" style={{ fontSize: 13 }}>Install BUYBUDDY</div>
        <div className="tiny muted">One tap from your home screen. Works offline-friendly.</div>
      </div>
      <button className="btn btn-primary btn-sm" onClick={install}>Install</button>
      <button className="btn btn-ghost btn-icon" onClick={dismiss} aria-label="Dismiss">
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}
