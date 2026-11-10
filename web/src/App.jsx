import { AskHost } from './lib/ask.jsx';
import React, { useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AuthProvider, CartProvider, Logo, Icon, useAuth, useCart, Loading, ToastProvider } from './lib/ui.jsx';
import { naira, hasApiBase, isNativeApp } from './lib/api.js';
import { NotificationsBell } from './lib/bell.jsx';
import ServerSetup from './screens/ServerSetup.jsx';

import AuthScreen from './screens/Auth.jsx';
import { Home, Browse, StorePage, ProductPage, SearchPage } from './screens/customer/Shop.jsx';
import { Cart, Checkout, PaymentReturn, SandboxPay } from './screens/customer/Checkout.jsx';
import { Orders, OrderDetail } from './screens/customer/Orders.jsx';
import ShopForMe from './screens/customer/ShopForMe.jsx';
import { Account, Wallet, Rewards, Favourites, Addresses, Notifications, Support } from './screens/customer/Account.jsx';
import WorkerApp from './screens/Worker.jsx';
import MerchantApp from './screens/Merchant.jsx';
import AdminApp from './screens/Admin.jsx';

/* ------------------------------- guards ---------------------------------- */

function RequireAuth({ roles, children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loading label="Starting BUYBUDDY…" />;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to={homeFor(user.role)} replace />;
  return children;
}

function GuestOk({ children }) {
  const { loading } = useAuth();
  if (loading) return <Loading label="Starting BUYBUDDY…" />;
  return children;
}

export const homeFor = (role) =>
  ({ admin: '/admin', merchant: '/merchant', shopper: '/worker', rider: '/worker' }[role] || '/');

/* ---------------------------- customer shell ----------------------------- */

function CustomerShell({ children }) {
  const { user } = useAuth();
  const { cart } = useCart();
  const nav = useNavigate();
  const loc = useLocation();
  const isActive = (p) => (p === '/' ? loc.pathname === '/' : loc.pathname.startsWith(p));

  const tabs = [
    { to: '/', label: 'Home', icon: 'home' },
    { to: '/search', label: 'Discover', icon: 'search' },
    { to: '/shop-for-me', label: 'Shop for me', icon: 'shop', cta: true },
    { to: '/orders', label: 'Orders', icon: 'receipt' },
    { to: '/account', label: 'Account', icon: 'user' },
  ];

  return (
    <div className="app">
      <div className="topbar">
        <div className="topbar-inner">
          <Logo tagline />
          <div className="spacer" />
          <div className="hide-sm row" style={{ gap: 6 }}>
            <div className="badge badge-green"><Icon name="pin" size={13} /> Lekki Phase 1</div>
            {user
              ? <span className="sub hide-sm">Hi, {user.name.split(' ')[0]}</span>
              : <button className="btn btn-ghost btn-sm" onClick={() => nav('/login')}>Sign in</button>}
          </div>
          {user && <NotificationsBell role="customer" />}
          <button className="btn btn-ghost btn-icon hide-xxs" onClick={() => nav('/favourites')} aria-label="Favourites">
            <Icon name="heart" size={18} />
          </button>
          <button className="btn btn-ghost btn-icon" style={{ position: 'relative' }} onClick={() => nav('/cart')} aria-label="Cart">
            <Icon name="bag" size={18} />
            {cart.count > 0 && (
              <span style={{
                position: 'absolute', top: -4, right: -4, background: 'var(--orange)', color: '#fff',
                borderRadius: 999, fontSize: 10, fontWeight: 800, minWidth: 17, height: 17,
                display: 'grid', placeItems: 'center', padding: '0 4px',
              }}>{cart.count}</span>
            )}
          </button>
        </div>
      </div>
      <main className="grow">{children}</main>
      <nav className="bottom-nav">
        <div className="bottom-nav-inner">
          {tabs.map((t) => (
            <button
              key={t.to}
              className={`bn-item ${isActive(t.to) ? 'active' : ''} ${t.cta ? 'center-cta' : ''}`}
              onClick={() => nav(t.to)}
            >
              <span className="bn-icon" style={t.cta ? {} : { padding: 2 }}><Icon name={t.icon} size={t.cta ? 19 : 21} /></span>
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}

/*
 * Publish the bottom nav's real height as --nav-h. Two things cared in pixels
 * before and got it wrong: the product page's buy bar (which sat inside the nav)
 * and the space reserved under it (which the last price hid behind).
 */
function useNavHeight() {
  useEffect(() => {
    const set = () => {
      const el = document.querySelector('.bottom-nav');
      if (!el) return;
      document.documentElement.style.setProperty('--nav-h', `${Math.round(el.getBoundingClientRect().height)}px`);
    };
    set();
    const el = document.querySelector('.bottom-nav');
    const ro = el && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(set) : null;
    if (ro && el) ro.observe(el);
    window.addEventListener('resize', set);
    window.addEventListener('orientationchange', set);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', set);
      window.removeEventListener('orientationchange', set);
    };
  }, []);
}

/*
 * The phone's own Back button. Without this, pressing Back inside a sheet —
 * "Report a problem", a refund reason, the checkout confirm — closed the whole
 * app instead of the sheet, and a customer lost what they had typed. Now Back
 * closes whatever is open, then walks the history it came through, and only
 * leaves the app from the top of the stack.
 */
function useAndroidBack() {
  useEffect(() => {
    if (!isNativeApp()) return undefined;
    let handle;
    let cancelled = false;
    import('@capacitor/app')
      .then(({ App: CapApp }) =>
        CapApp.addListener('backButton', ({ canGoBack }) => {
          const openSheet = document.querySelector('.modal-backdrop');
          if (openSheet) {
            // every sheet in the app closes on Escape, including the ask sheets
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            return;
          }
          if (canGoBack && window.history.length > 1) {
            window.history.back();
            return;
          }
          CapApp.exitApp();
        })
      )
      .then((h) => {
        if (cancelled) h.remove();
        else handle = h;
      });
    return () => {
      cancelled = true;
      handle?.remove();
    };
  }, []);
}

/* ------------------------------ worker shell ----------------------------- */

function WorkerShell({ children }) {
  const { user, logout } = useAuth();
  const loc = useLocation();
  const nav = useNavigate();
  const tabs = [
    { to: '/worker', label: 'Jobs', icon: 'bike' },
    { to: '/worker/earnings', label: 'Earnings', icon: 'wallet' },
    { to: '/worker/account', label: 'Account', icon: 'user' },
  ];
  return (
    <div className="app">
      <div className="topbar">
        <div className="topbar-inner">
          <Logo size={30} />
          <span className="badge badge-green hide-xs" style={{ marginLeft: 6 }}>
            {user.role === 'rider' ? 'Rider' : 'Shopper'}
          </span>
          <div className="spacer" />
          <span className="sub hide-sm">{user.name}</span>
          <NotificationsBell role="worker" />
          <button className="btn btn-ghost btn-icon" onClick={logout} aria-label="Log out"><Icon name="logout" size={18} /></button>
        </div>
      </div>
      <main className="grow">{children}</main>
      <nav className="bottom-nav">
        <div className="bottom-nav-inner">
          {tabs.map((t) => (
            <button
              key={t.to}
              className={`bn-item ${(t.to === '/worker' ? loc.pathname === '/worker' : loc.pathname.startsWith(t.to)) ? 'active' : ''}`}
              onClick={() => nav(t.to)}
            >
              <span className="bn-icon" style={{ padding: 2 }}><Icon name={t.icon} size={21} /></span>
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}

/* ------------------------------ app ------------------------------------- */

function LoginRoute() {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Loading label="Loading BUYBUDDY…" />;
  if (user) return <Navigate to={loc.state?.from || homeFor(user.role)} replace />;
  return <AuthScreen />;
}

export default function App() {
  // Registered once, for every role's shell: the nav's height (the product buy
  // bar sits on it) and the phone's Back button.
  useNavHeight();
  useAndroidBack();
  // Installed app with no server chosen yet: ask once, before anything fetches.
  const needsServer = isNativeApp() && !hasApiBase();

  return (
    <ToastProvider>
      <AuthProvider>
        <CartProvider>
          {needsServer ? <ServerSetup /> : (
          <HashRouter>
            <Routes>
              <Route path="/login" element={<LoginRoute />} />
              <Route path="/pay/:reference" element={<RequireAuth><SandboxPay /></RequireAuth>} />
              <Route path="/payment/return" element={<RequireAuth><PaymentReturn /></RequireAuth>} />

              {/* customer */}
              <Route path="/" element={<GuestOk><CustomerShell><Home /></CustomerShell></GuestOk>} />
              <Route path="/search" element={<GuestOk><CustomerShell><SearchPage /></CustomerShell></GuestOk>} />
              <Route path="/category/:id" element={<GuestOk><CustomerShell><Browse /></CustomerShell></GuestOk>} />
              <Route path="/browse" element={<GuestOk><CustomerShell><Browse /></CustomerShell></GuestOk>} />
              <Route path="/store/:id" element={<GuestOk><CustomerShell><StorePage /></CustomerShell></GuestOk>} />
              <Route path="/product/:id" element={<GuestOk><CustomerShell><ProductPage /></CustomerShell></GuestOk>} />
              <Route path="/cart" element={<GuestOk><CustomerShell><Cart /></CustomerShell></GuestOk>} />
              <Route path="/checkout" element={<RequireAuth roles={['customer']}><CustomerShell><Checkout /></CustomerShell></RequireAuth>} />
              <Route path="/shop-for-me" element={<RequireAuth roles={['customer']}><CustomerShell><ShopForMe /></CustomerShell></RequireAuth>} />
              <Route path="/orders" element={<RequireAuth roles={['customer']}><CustomerShell><Orders /></CustomerShell></RequireAuth>} />
              <Route path="/orders/:id" element={<RequireAuth roles={['customer']}><CustomerShell><OrderDetail /></CustomerShell></RequireAuth>} />
              <Route path="/account" element={<RequireAuth roles={['customer']}><CustomerShell><Account /></CustomerShell></RequireAuth>} />
              <Route path="/account/wallet" element={<RequireAuth roles={['customer']}><CustomerShell><Wallet /></CustomerShell></RequireAuth>} />
              <Route path="/account/rewards" element={<RequireAuth roles={['customer']}><CustomerShell><Rewards /></CustomerShell></RequireAuth>} />
              <Route path="/account/addresses" element={<RequireAuth roles={['customer']}><CustomerShell><Addresses /></CustomerShell></RequireAuth>} />
              <Route path="/account/notifications" element={<RequireAuth roles={['customer']}><CustomerShell><Notifications /></CustomerShell></RequireAuth>} />
              <Route path="/support" element={<RequireAuth roles={['customer']}><CustomerShell><Support /></CustomerShell></RequireAuth>} />
              <Route path="/favourites" element={<GuestOk><CustomerShell><Favourites /></CustomerShell></GuestOk>} />

              {/* shopper / rider */}
              <Route path="/worker/*" element={<RequireAuth roles={['shopper', 'rider']}><WorkerShell><WorkerApp /></WorkerShell></RequireAuth>} />

              {/* merchant */}
              <Route path="/merchant/*" element={<RequireAuth roles={['merchant']}><MerchantApp /></RequireAuth>} />

              {/* admin */}
              <Route path="/admin/*" element={<RequireAuth roles={['admin']}><AdminApp /></RequireAuth>} />

              <Route path="*" element={<NotFound />} />
            </Routes>
          </HashRouter>
          )}
        </CartProvider>
      </AuthProvider>
      <AskHost />
    </ToastProvider>
  );
}

function NotFound() {
  const { user } = useAuth();
  return (
    <div className="page center" style={{ paddingTop: 80 }}>
      <div className="h1">Page not found</div>
      <p className="sub" style={{ margin: '8px 0 18px' }}>That link does not exist in BUYBUDDY.</p>
      <a className="btn btn-primary" href={`#${homeFor(user?.role || 'customer')}`}>Back to home</a>
    </div>
  );
}
