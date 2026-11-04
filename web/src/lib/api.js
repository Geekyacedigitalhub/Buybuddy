const BASE = import.meta.env.VITE_API_URL || '';

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
  const res = await fetch(BASE + path, {
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

export const fmtAddress = (a) => (a ? [a.line1, a.area, a.city].filter(Boolean).join(', ') : '');
