import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Icon, Logo, OfflineBar, useAuth } from '../lib/ui.jsx';

/** Desktop side-navigation shell shared by the merchant portal and admin dashboard. */
export default function Shell({ nav, title, subtitle, children, accent = 'admin' }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="shell">
      <aside className="side">
        <div className="side-brand">
          <Logo size={30} tagline />
        </div>
        {nav.map((item) =>
          item.section ? (
            <div key={item.section} className="tiny" style={{ padding: '14px 12px 6px', opacity: 0.88, letterSpacing: '0.1em', fontWeight: 700 }}>
              {item.section.toUpperCase()}
            </div>
          ) : (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `side-link ${isActive ? 'active' : ''}`}
            >
              <Icon name={item.icon} size={17} />
              <span className="grow">{item.label}</span>
              <span className="tiny" style={{ opacity: 0.9 }}>{item.count ?? ''}</span>
            </NavLink>
          )
        )}
        <div className="side-foot">
          <div className="row" style={{ gap: 8, padding: '0 8px 10px' }}>
            <div style={{ width: 30, height: 30, borderRadius: 9, background: 'rgba(255,255,255,0.12)', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 12, color: '#fff' }}>
              {user.name.split(' ').map((n) => n[0]).slice(0, 2).join('')}
            </div>
            <div className="grow" style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.name}</div>
              <div className="tiny" style={{ opacity: 0.9 }}>{user.role}</div>
            </div>
          </div>
          <button className="side-link" onClick={logout}><Icon name="logout" size={16} /> Sign out</button>
        </div>
      </aside>

      <div>
        <div className="mobile-bar">
          {nav.filter((n) => !n.section).map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}
              className={({ isActive }) => `chip ${isActive ? 'active' : ''}`}>
              {item.label}
            </NavLink>
          ))}
          <button className="chip" onClick={() => navigate('/')}>Customer app</button>
        </div>
        <div className="content">
          <OfflineBar />
          <div className="row-between wrap" style={{ marginBottom: 18, gap: 10 }}>
            <div>
              <div className="h1">{title}</div>
              {subtitle && <div className="sub" style={{ marginTop: 3 }}>{subtitle}</div>}
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-ghost btn-sm hide-sm" onClick={() => navigate('/')}>
                <Icon name="shop" size={14} /> View storefront
              </button>
            </div>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

export const Kpi = ({ label, value, hint, tone }) => (
  <div className="card kpi">
    <div className="kpi-label">{label}</div>
    <div className="kpi-value" style={{ color: tone || 'var(--ink)' }}>{value}</div>
    {hint && <div className="tiny muted">{hint}</div>}
  </div>
);

export const Bars = ({ data, valueKey = 'gmv', labelKey = 'day', format = (v) => v }) => {
  const max = Math.max(1, ...data.map((d) => d[valueKey]));
  return (
    <div className="bars">
      {data.map((d) => (
        <div key={d[labelKey]} className="bar-col" title={`${d[labelKey]}: ${format(d[valueKey])}`}>
          <div className="bar-track">
            <div className="bar" style={{ height: `${d[valueKey] > 0 ? Math.max(6, (d[valueKey] / max) * 100) : 0}%` }} />
          </div>
          <span className="tiny muted">{String(d[labelKey]).slice(-2)}</span>
        </div>
      ))}
    </div>
  );
};
