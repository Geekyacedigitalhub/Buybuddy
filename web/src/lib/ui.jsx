import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, naira, getToken, setToken } from './api.js';

/* --------------------------------- icons --------------------------------- */

const P = {
  home: 'M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm9 17-4.35-4.35',
  bag: 'M6 8h12l1 12H5zM9 8V6a3 3 0 0 1 6 0v2',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  user: 'M4 21c0-4 3.6-7 8-7s8 3 8 7M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  star: 'M12 3.5 14.9 9l6.1.9-4.4 4.3 1 6.1L12 17.5 6.4 20.3l1-6.1L3 9.9 9.1 9z',
  pin: 'M12 22s7-6.2 7-12A7 7 0 1 0 5 10c0 5.8 7 12 7 12Zm0-9a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z',
  bike: 'M5 18a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm14 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM8 15h8l-2-6H9M13 9l3 6',
  chat: 'M21 12a8 8 0 0 1-8 8H7l-4 3V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  box: 'm12 3 9 5-9 5-9-5 9-5Zm9 5v8l-9 5-9-5V8',
  gear: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.5 14H3a2 2 0 1 1 0-4h.2a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.4 1Z',
  logout: 'M15 17l5-5-5-5M20 12H9M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7',
  left: 'M15 18l-6-6 6-6',
  right: 'M9 6l6 6-6 6',
  down: 'M6 9l6 6 6-6',
  check: 'M20 6 9 17l-5-5',
  x: 'M18 6 6 18M6 6l12 12',
  camera: 'M3 8h4l2-3h6l2 3h4v11H3zM12 16a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l4 2',
  card: 'M2 7h20v10H2zM2 11h20',
  truck: 'M1 6h13v10H1zM14 10h4l3 3v3h-7M5 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm11 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  filter: 'M3 6h18M7 12h10M10 18h4',
  shop: 'M4 8h16l-1 12H5L4 8ZM8 8V6a4 4 0 0 1 8 0v2',
  wallet: 'M3 8h18v11H3zM3 8l2-4h14l2 4M16 14h2',
  bell: 'M18 16V11a6 6 0 1 0-12 0v5l-2 3h16zM10 22h4',
  heart: 'M12 20s-7-4.3-7-9a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 4.7-7 9-7 9Z',
  phone: 'M6 3h4l2 5-3 2a11 11 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 4 5a2 2 0 0 1 2-2Z',
};

export function Icon({ name, size = 20, stroke = 1.8, fill = 'none', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor"
      strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" style={style} aria-hidden="true">
      <path d={P[name] || P.box} />
    </svg>
  );
}

export const Logo = ({ size = 34, tagline = false }) => (
  <Link to="/" className="logo">
    <span className="logo-mark" style={{ width: size, height: size, borderRadius: size * 0.32 }}>
      <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5.5 8h13l-1.2 12H6.7z" />
        <path d="M9 8V6.2a3 3 0 0 1 6 0V8" />
        <circle cx="10" cy="12.6" r="0.9" fill="#fff" stroke="none" />
        <circle cx="14" cy="12.6" r="0.9" fill="#fff" stroke="none" />
        <path d="M10.2 15.4c.9.9 2.7.9 3.6 0" />
      </svg>
    </span>
    <span>BUYBUDDY{tagline && <small>Your personal shopping partner</small>}</span>
  </Link>
);

/* -------------------------------- primitives ------------------------------ */

export const Button = ({ variant = 'primary', size, block, className = '', children, ...rest }) => (
  <button
    className={`btn btn-${variant} ${size ? `btn-${size}` : ''} ${block ? 'btn-block' : ''} ${className}`}
    {...rest}
  >
    {children}
  </button>
);

export const Field = ({ label, hint, children }) => (
  <label className="field">
    {label && <span className="label">{label}</span>}
    {children}
    {hint && <span className="hint">{hint}</span>}
  </label>
);

export const Input = (props) => <input className="input" {...props} />;
export const Textarea = (props) => <textarea className="textarea" {...props} />;
export const Select = ({ children, ...props }) => (
  <select className="select" {...props}>{children}</select>
);

export const Badge = ({ tone = '', children, className = '' }) => (
  <span className={`badge ${tone} ${className}`}>{children}</span>
);

export const StatusBadge = ({ status }) => {
  const tone = {
    active: 'badge-ok', completed: 'badge-ok', delivered: 'badge-green', paid: 'badge-green',
    approved: 'badge-green', accepted: 'badge-green', preparing: 'badge-orange', shopping: 'badge-orange',
    in_transit: 'badge-orange', picked_up: 'badge-orange', ready_for_pickup: 'badge-orange',
    ready_for_delivery: 'badge-orange', shopper_assigned: 'badge-orange', purchased: 'badge-orange',
    pending: 'badge-warn', pending_payment: 'badge-warn', awaiting_approval: 'badge-warn',
    open_for_shoppers: 'badge-warn', requested: 'badge-warn', suspended: 'badge-danger',
    cancelled: 'badge-danger', rejected: 'badge-danger', refunded: 'badge-dark',
  }[status] || '';
  return <Badge tone={tone}>{(status || '').replace(/_/g, ' ')}</Badge>;
};

export const Money = ({ value, old, className = '' }) => (
  <span className={className}>
    <span className="price mono">{naira(value)}</span>
    {old ? <span className="price-old mono" style={{ marginLeft: 6 }}>{naira(old)}</span> : null}
  </span>
);

export const Spinner = ({ size = 20, color = 'var(--green-700)' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" style={{ animation: 'spin 0.9s linear infinite' }}>
    <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.18" strokeWidth="3" fill="none" color={color} />
    <path d="M21 12a9 9 0 0 0-9-9" stroke={color} strokeWidth="3" strokeLinecap="round" fill="none" />
  </svg>
);

export const Loading = ({ label = 'Loading…', block = true }) => (
  <div className="col center" style={{ padding: block ? 48 : 12, alignItems: 'center', color: 'var(--ink-3)' }}>
    <Spinner />
    <span className="sub">{label}</span>
  </div>
);

export const Skeleton = ({ h = 14, w = '100%', style }) => (
  <div className="skeleton" style={{ height: h, width: w, ...style }} />
);

export const Empty = ({ icon = 'box', title, body, action }) => (
  <div className="col center" style={{ padding: '44px 20px', alignItems: 'center', gap: 10 }}>
    <div style={{ width: 54, height: 54, borderRadius: 16, background: 'var(--green-50)', display: 'grid', placeItems: 'center', color: 'var(--green-700)' }}>
      <Icon name={icon} size={26} />
    </div>
    <div className="h3">{title}</div>
    {body && <div className="sub" style={{ maxWidth: 320 }}>{body}</div>}
    {action}
  </div>
);

export const Stars = ({ value = 0, count, size = 13 }) => (
  <span className="row" style={{ gap: 3, alignItems: 'center' }}>
    <Icon name="star" size={size} fill="#E4792F" stroke="#E4792F" />
    <span style={{ fontSize: 12.5, fontWeight: 650 }}>{Number(value || 0).toFixed(1)}</span>
    {count !== undefined && <span className="tiny muted">({count})</span>}
  </span>
);

export const SectionHead = ({ title, action, subtitle }) => (
  <div className="row-between" style={{ marginBottom: 12 }}>
    <div>
      <div className="h2">{title}</div>
      {subtitle && <div className="sub" style={{ marginTop: 2 }}>{subtitle}</div>}
    </div>
    {action}
  </div>
);

export const BackBar = ({ title, onBack, right }) => (
  <div className="row" style={{ marginBottom: 14 }}>
    <button className="btn btn-ghost btn-icon" onClick={onBack} aria-label="Back"><Icon name="left" /></button>
    <div className="h2 grow">{title}</div>
    {right}
  </div>
);

export function Modal({ open, onClose, title, children, footer }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="row-between" style={{ marginBottom: 14 }}>
          <div className="h2">{title}</div>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close"><Icon name="x" size={18} /></button>
        </div>
        {children}
        {footer && <div style={{ marginTop: 18 }}>{footer}</div>}
      </div>
    </div>
  );
}

/* --------------------------------- toasts -------------------------------- */

const ToastCtx = createContext({ push: () => {}, success: () => {}, error: () => {} });
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((message, kind = '') => {
    const id = Math.random().toString(36).slice(2);
    setItems((p) => [...p, { id, message, kind }]);
    setTimeout(() => setItems((p) => p.filter((i) => i.id !== id)), 3600);
  }, []);
  const value = useMemo(
    () => ({ push, success: (m) => push(m, 'ok'), error: (m) => push(m, 'err') }),
    [push]
  );
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="toast-wrap">
        {items.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.message}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------------------------------- auth --------------------------------- */

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return null;
    }
    try {
      const res = await api.get('/api/me');
      setUser(res.user);
      setConfig(res.settings);
      return res.user;
    } catch {
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const onLogout = () => setUser(null);
    window.addEventListener('bb:logout', onLogout);
    return () => window.removeEventListener('bb:logout', onLogout);
  }, [refresh]);

  const login = async (identifier, password) => {
    const res = await api.post('/api/auth/login', { identifier, password });
    setToken(res.token);
    setUser(res.user);
    const me = await api.get('/api/me').catch(() => null);
    if (me) setConfig(me.settings);
    return res.user;
  };

  const register = async (payload) => {
    const res = await api.post('/api/auth/register', payload);
    setToken(res.token);
    setUser(res.user);
    return res;
  };

  const logout = async () => {
    try {
      await api.post('/api/auth/logout');
    } catch {}
    setToken(null);
    setUser(null);
  };

  return (
    <AuthCtx.Provider value={{ user, setUser, config, loading, login, register, logout, refresh }}>
      {children}
    </AuthCtx.Provider>
  );
}

/* ---------------------------------- cart --------------------------------- */

const CartCtx = createContext(null);
export const useCart = () => useContext(CartCtx);

export function CartProvider({ children }) {
  const [cart, setCart] = useState({ items: [], subtotal: 0, count: 0, store: null, issues: [] });
  const { user } = useAuth();

  const reload = useCallback(async () => {
    if (!getToken()) return setCart({ items: [], subtotal: 0, count: 0, store: null, issues: [] });
    try {
      setCart(await api.get('/api/cart'));
    } catch {}
  }, []);

  useEffect(() => { reload(); }, [reload, user?.id]);

  return (
    <CartCtx.Provider value={{ cart, setCart, reload }}>{children}</CartCtx.Provider>
  );
}

/* ------------------------------- order loader ---------------------------- */

export { fmtAddress } from './api.js';
