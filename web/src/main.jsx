import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { initTextSize } from './lib/textsize.js';
import './styles.css';

// before the first paint, so nobody sees the app at the wrong size and then jumps
initTextSize();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

/* Register the service worker so the app can be installed to a home screen and
   still open on a flaky connection. Registration only happens on https or
   localhost — browsers refuse service workers anywhere else. */
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* a failed registration must never break the app */
    });
  });
}
