/* --------------------------------------------------------------------------
 * API base URL
 * Web build: same origin ('' → relative requests).
 * Installed app (Capacitor): the app is bundled inside the phone, so it needs an
 * absolute server address. That address is chosen at runtime on first launch and
 * stored locally, which means one APK works against staging, production or a
 * laptop on the same Wi-Fi — no rebuild.
 * ------------------------------------------------------------------------ */
const ENV_BASE = import.meta.env.VITE_API_URL || '';
const RUNTIME_KEY = 'bb_api_base';

const normaliseBase = (url) => {
  const v = String(url || '').trim().replace(/\/+$/, '');
  if (!v) return '';
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
};

let runtimeBase = (() => {
  try { return localStorage.getItem(RUNTIME_KEY) || ''; } catch { return ''; }
})();

export const getApiBase = () => runtimeBase || ENV_BASE;

export const setApiBase = (url) => {
  const clean = normaliseBase(url);
  runtimeBase = clean;
  try {
    if (clean) localStorage.setItem(RUNTIME_KEY, clean);
    else localStorage.removeItem(RUNTIME_KEY);
  } catch { /* private mode */ }
  return clean;
};

export const hasApiBase = () => Boolean(getApiBase());

/** True inside the installed Android/iOS app. */
export const isNativeApp = () => {
  if (typeof window === 'undefined') return false;
  const cap = window.Capacitor;
  if (cap?.isNativePlatform?.() || cap?.platform === 'android' || cap?.platform === 'ios') return true;
  // Capacitor serves the bundled app from https://localhost — no real site lives
  // there, so relative API calls cannot work and we must ask for a server.
  return window.location.protocol === 'https:' && window.location.hostname === 'localhost';
};

/** Turn a server-relative asset path (/uploads/x.jpg) into a full URL when needed. */
export const assetUrl = (p) => {
  if (!p) return p;
  if (/^(https?:|data:|blob:)/i.test(p)) return p;
  if (p.startsWith('/uploads')) return `${getApiBase()}${p}`;
  return p;
};

const BASE = () => getApiBase();

let authToken = localStorage.getItem('bb_token') || null;

export const setToken = (t) => {
  authToken = t;
  if (t) localStorage.setItem('bb_token', t);
  else localStorage.removeItem('bb_token');
};
export const getToken = () => authToken;

export class ApiError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

async function request(path, { method = 'GET', body, headers = {}, raw = false } = {}) {
  const res = await fetch(BASE() + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw) return res;
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text };
  }
  if (!res.ok) {
    if (res.status === 401 && authToken) {
      setToken(null);
      window.dispatchEvent(new Event('bb:logout'));
    }
    throw new ApiError(data.error || `Request failed (${res.status})`, res.status, data);
  }
  return data;
}

/**
 * Fetches a file (a backup, an export) with the same auth as every other call.
 * The ordinary request() helper parses JSON, which would mangle a download.
 */
export const downloadFile = async (path) => {
  const res = await fetch(BASE() + path, {
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
  });
  if (!res.ok) {
    let message = `Download failed (${res.status})`;
    try { message = (await res.json()).error || message; } catch { /* not JSON */ }
    throw new ApiError(message, res.status);
  }
  return res.blob();
};

/**
 * Hand a file to the browser's downloader. The path version is the one the app
 * uses: it keeps the auth token in the request instead of in a URL, so a receipt
 * link cannot be forwarded to someone who should not have the order.
 */
export const saveFile = (blob, filename) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
};

export const downloadAndSave = async (path, filename) => {
  const blob = await downloadFile(path);
  saveFile(blob, filename);
  return blob;
};

export const api = {
  get: (p, opts) => request(p, opts),
  post: (p, body, opts) => request(p, { ...opts, method: 'POST', body }),
  patch: (p, body, opts) => request(p, { ...opts, method: 'PATCH', body }),
  put: (p, body, opts) => request(p, { ...opts, method: 'PUT', body }),
  del: (p, opts) => request(p, { ...opts, method: 'DELETE' }),
};

/* ------------------------------- formatting ------------------------------ */

export const naira = (n) => `₦${Number(n || 0).toLocaleString('en-NG')}`;
export const nairaShort = (n) => {
  const v = Number(n || 0);
  if (v >= 1_000_000) return `₦${(v / 1_000_000).toFixed(1)}m`;
  if (v >= 10_000) return `₦${Math.round(v / 1000)}k`;
  return naira(v);
};
export const shortDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
};
export const timeAgo = (iso) => {
  if (!iso) return '';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return shortDate(iso);
};
export const clockTime = (iso) =>
  iso ? new Date(iso).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' }) : '';

export const statusTone = (status) => {
  const map = {
    active: 'badge-ok', completed: 'badge-ok', delivered: 'badge-green', paid: 'badge-green',
    approved: 'badge-green', accepted: 'badge-green', preparing: 'badge-orange', shopping: 'badge-orange',
    in_transit: 'badge-orange', picked_up: 'badge-orange', ready_for_pickup: 'badge-orange',
    pending: 'badge-warn', pending_payment: 'badge-warn', awaiting_approval: 'badge-warn',
    open_for_shoppers: 'badge-warn', shopper_assigned: 'badge-orange', suspended: 'badge-danger',
    cancelled: 'badge-danger', refunded: 'badge-dark', rejected: 'badge-danger', requested: 'badge-warn',
    resolved: 'badge-ok', open: 'badge-warn',
  };
  return map[status] || '';
};

export const pretty = (s) =>
  String(s || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

export const toDataUrl = (file) =>
  new Promise((resolve, reject) => {
    if (file.size > 4 * 1024 * 1024) return reject(new Error('Please choose a file under 4 MB.'));
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

export const fmtAddress = (a) => {
  if (!a) return '';
  // 'Lekki Phase 1, Lekki Phase 1, Lagos' — the area is often also the city
  const parts = [];
  for (const part of [a.line1, a.area, a.city]) {
    const value = (part || '').trim();
    if (!value) continue;
    const lower = value.toLowerCase();
    // 'Lekki Phase 1' inside '14 Admiralty Way, Lekki Phase 1' is already said
    if (parts.some((p) => p.toLowerCase().includes(lower))) continue;
    parts.push(value);
  }
  return parts.join(', ');
};
