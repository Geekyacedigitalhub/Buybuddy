import React, { useEffect, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import { askText } from '../lib/ask.jsx';
import { api, naira, nairaShort, pretty, timeAgo, assetUrl, downloadFile, downloadAndSave } from '../lib/api.js';
import {
  Badge, Button, Empty, Field, Icon, Input, Loading, Modal, SectionHead, Select, StatusBadge,
  Textarea, useToast,
} from '../lib/ui.jsx';
import Shell, { Bars, Kpi } from '../components/Shell.jsx';
import TextSizeControl from '../components/TextSizeControl.jsx';

const NAV = [
  { to: '/admin', label: 'Overview', icon: 'chart', end: true },
  { to: '/admin/today', label: 'Today', icon: 'clock' },
  { section: 'Operations' },
  { to: '/admin/orders', label: 'Orders', icon: 'receipt' },
  { to: '/admin/people', label: 'Customers & people', icon: 'user' },
  { to: '/admin/merchants', label: 'Merchants', icon: 'shop' },
  { to: '/admin/products', label: 'Listings', icon: 'box' },
  { to: '/admin/workers', label: 'Shoppers & riders', icon: 'bike' },
  { section: 'Money' },
  { to: '/admin/finance', label: 'Finance & payouts', icon: 'wallet' },
  { to: '/admin/marketing', label: 'Marketing', icon: 'bell' },
  { section: 'Platform' },
  { to: '/admin/support', label: 'Support', icon: 'chat' },
  { to: '/admin/settings', label: 'Settings', icon: 'gear' },
  { to: '/admin/integrations', label: 'Go-live checks', icon: 'check' },
  { to: '/admin/audit', label: 'Audit log', icon: 'filter' },
];

export default function AdminApp() {
  return (
    <Routes>
      <Route index element={<Overview />} />
      <Route path="today" element={<Today />} />
      <Route path="orders" element={<Orders />} />
      <Route path="people" element={<People />} />
      <Route path="merchants" element={<Merchants />} />
      <Route path="products" element={<Listings />} />
      <Route path="workers" element={<Workers />} />
      <Route path="finance" element={<Finance />} />
      <Route path="marketing" element={<Marketing />} />
      <Route path="support" element={<Support />} />
      <Route path="settings" element={<Settings />} />
      <Route path="integrations" element={<Integrations />} />
      <Route path="audit" element={<Audit />} />
      <Route path="*" element={<Overview />} />
    </Routes>
  );
}

/* -------------------------------- overview -------------------------------- */

function Overview() {
  const [data, setData] = useState(null);
  const [days, setDays] = useState(7);
  useEffect(() => { api.get(`/api/admin/overview?days=${days}`).then(setData).catch(() => setData(null)); }, [days]);
  if (!data) return <Loading block label="Loading marketplace data…" />;
  const k = data.kpis;

  return (
    <Shell nav={NAV} title="Marketplace overview" subtitle={`Lagos launch · last ${days} days`}>
      <div className="row wrap" style={{ gap: 8, marginBottom: 16 }}>
        {[7, 14, 30].map((d) => (
          <button key={d} className={`chip ${days === d ? 'active' : ''}`} onClick={() => setDays(d)}>{d} days</button>
        ))}
      </div>

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Kpi label="GMV (paid)" value={naira(k.gmv)} hint={`${k.orders_total} orders total`} />
        <Kpi label="Platform revenue" value={naira(k.platform_revenue)} hint={`Service ${nairaShort(k.service_revenue)} · commission ${nairaShort(k.merchant_commission)}`} tone="var(--green-700)" />
        <Kpi label="Active orders" value={k.orders_active} hint={`${k.orders_completed} completed`} />
        <Kpi label="Customers" value={k.customers} hint={`${k.merchants} merchants · ${k.shoppers + k.riders} workers`} />
      </div>

      {data.alerts.length > 0 && (
        <div className="card" style={{ background: 'var(--warn-soft)', borderColor: '#f0dfb4', marginBottom: 16 }}>
          <div className="row" style={{ gap: 10, marginBottom: 6 }}>
            <Icon name="bell" size={16} style={{ color: 'var(--warn)' }} /><span className="strong">Needs attention</span>
          </div>
          <ul style={{ listStyle: 'disc', paddingLeft: 18 }}>
            {data.alerts.map((a) => <li key={a} className="sub">{a}</li>)}
          </ul>
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr)', gap: 16, alignItems: 'start', marginBottom: 16 }}>
        <div className="card">
          <SectionHead title="GMV trend" subtitle="Paid order value per day" />
          <Bars data={data.chart} valueKey="gmv" labelKey="day" format={naira} />
          <div className="row" style={{ gap: 18, marginTop: 14 }}>
            <MiniStat label="Orders" value={data.chart.reduce((s, c) => s + c.orders, 0)} />
            <MiniStat label="Avg order" value={naira(Math.round(data.chart.reduce((s, c) => s + c.gmv, 0) / Math.max(1, data.chart.reduce((s, c) => s + c.orders, 0))))} />
            <MiniStat label="Cancelled" value={k.orders_cancelled} />
          </div>
        </div>
        <div className="card">
          <SectionHead title="Orders by status" />
          <div className="col" style={{ gap: 7 }}>
            {Object.entries(data.by_status).sort((a, b) => b[1] - a[1]).map(([s, n]) => (
              <div key={s} className="row" style={{ gap: 8 }}>
                <span className="sub grow">{pretty(s)}</span>
                <div style={{ width: 90 }}><div className="progress"><div style={{ width: `${Math.min(100, (n / Math.max(...Object.values(data.by_status))) * 100)}%` }} /></div></div>
                <span className="mono tiny" style={{ width: 24, textAlign: 'right' }}>{n}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card card-flush">
        <div className="row-between" style={{ padding: 14 }}>
          <div className="h3">Recent orders</div>
          <a className="btn btn-ghost btn-sm" href="#/admin/orders">View all</a>
        </div>
        <div className="table-wrap" role="group" aria-label="Scrollable table" tabIndex={0}>
          <table className="table">
            <thead><tr><th>Order</th><th>Customer</th><th>Type</th><th>Total</th><th>Status</th><th>Placed</th></tr></thead>
            <tbody>
              {data.recent_orders.map((o) => (
                <tr key={o.id}>
                  <td className="mono strong">{o.code}</td>
                  <td>{o.customer || '—'}</td>
                  <td><Badge tone={o.type === 'personal' ? 'badge-orange' : ''}>{o.type}</Badge></td>
                  <td className="mono">{naira(o.total)}</td>
                  <td><StatusBadge status={o.status} /></td>
                  <td className="tiny muted">{timeAgo(o.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </Shell>
  );
}

/** Rejecting a withdrawal returns a rider's money, so it needs a reason they can read. */
function RejectPayout({ payout, onClose, onSubmit }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const PRESETS = [
    'Bank details could not be verified',
    'Cash in hand not handed over yet',
    'Account name does not match',
    'Duplicate request',
  ];
  return (
    <Modal
      open={!!payout}
      onClose={onClose}
      title={`Reject ${payout?.worker_name || 'this'} withdrawal`}
      footer={(
        <div className="col" style={{ gap: 10 }}>
          {error && <div className="tiny" style={{ color: 'var(--danger)' }}>{error}</div>}
          <div className="row" style={{ gap: 8 }}>
            <Button variant="ghost" className="grow" onClick={onClose}>Keep it</Button>
            <Button
              variant="danger"
              className="grow"
              onClick={() => {
                if (reason.trim().length < 5) return setError('Say why — the rider sees this and needs to know what to fix.');
                onSubmit(reason.trim());
              }}
            >
              Reject and return {naira(payout?.amount || 0)}
            </Button>
          </div>
        </div>
      )}
    >
      <div className="sub" style={{ marginBottom: 10 }}>
        {naira(payout?.amount || 0)} goes straight back into {payout?.worker_name}'s wallet. Tell them what to fix
        so they can request again.
      </div>
      <div className="row wrap" style={{ gap: 6, marginBottom: 8 }}>
        {PRESETS.map((r) => (
          <button key={r} type="button" className={`chip ${reason === r ? 'active' : ''}`} onClick={() => { setReason(r); setError(''); }}>{r}</button>
        ))}
      </div>
      <Textarea value={reason} onChange={(e) => { setReason(e.target.value); setError(''); }} rows={3} placeholder="Reason the rider will see" />
    </Modal>
  );
}

const MiniStat = ({ label, value }) => (
  <div>
    <div className="kpi-label">{label}</div>
    <div className="strong mono" style={{ fontSize: 16 }}>{value}</div>
  </div>
);

/* ---------------------------------- today --------------------------------- */

/*
 * The overview says how the business is doing. This says what is about to go
 * wrong: an order the shop has not touched, a bag nobody is riding to, a claim
 * with money on it, a withdrawal waiting. Every line is a real order with an age,
 * and every card goes to the screen where it can be fixed.
 */
/* "1543m" tells nobody anything — say how long in the unit a person thinks in. */
function ageLabel(min) {
  if (min == null) return 'new';
  if (min < 60) return `${Math.max(0, Math.round(min))}m`;
  if (min < 1440) return `${Math.floor(min / 60)}h ${Math.round(min % 60)}m`;
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  return `${d}d ${h}h`;
}

function Today() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const load = () => api.get('/api/admin/today').then(setData).catch(() => setData(false));
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, []);

  const clearCash = async (record) => {
    setBusy(true);
    try {
      await api.post(`/api/admin/cash/${record.id}/clear`, {});
      toast.success(`Cash received — ${naira(record.outstanding)} cleared`);
      load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  if (data === null) return <Loading block />;
  if (data === false) return <Empty icon="clock" title="Could not load today" body="Check your connection and open this screen again." />;

  const q = data.queues;
  const attention = [
    {
      key: 'shop', label: 'Shops sitting on a paid order', count: q.shop_not_accepted.length,
      detail: q.shop_not_accepted.length ? `oldest waiting ${ageLabel(q.shop_not_accepted[0].waiting_minutes)}` : 'nothing over 15 minutes',
      tone: q.shop_not_accepted.length ? 'badge-danger' : 'badge-ok', to: '/admin/orders',
    },
    {
      key: 'rider', label: 'Ready, nobody riding', count: q.no_rider.length,
      detail: q.no_rider.length ? `oldest waiting ${ageLabel(q.no_rider[0].waiting_minutes)}` : 'every ready order has a rider',
      tone: q.no_rider.length ? 'badge-warn' : 'badge-ok', to: '/admin/orders',
    },
    {
      key: 'claims', label: 'Claims waiting on a decision', count: data.money.claims_count,
      detail: data.money.claims_amount ? `${naira(data.money.claims_amount)} asked for` : 'no money at stake',
      tone: data.money.claims_count ? 'badge-warn' : 'badge-ok', to: '/admin/support',
    },
    {
      key: 'payouts', label: 'Withdrawals to pay', count: data.money.payouts_count,
      detail: data.money.payouts_requested ? naira(data.money.payouts_requested) : 'nothing pending',
      tone: data.money.payouts_count ? 'badge-warn' : 'badge-ok', to: '/admin/finance',
    },
    {
      key: 'cash', label: 'Cash with riders', count: data.money.cash_records,
      detail: data.money.cash_outstanding ? naira(data.money.cash_outstanding) : 'all handed over',
      tone: data.money.cash_outstanding ? 'badge-warn' : 'badge-ok', to: '/admin/finance',
    },
    {
      key: 'apps', label: 'Applications to verify', count: data.approvals.merchants + data.approvals.workers,
      detail: `${data.approvals.merchants} merchant, ${data.approvals.workers} shopper/rider`,
      tone: (data.approvals.merchants + data.approvals.workers) ? 'badge-warn' : 'badge-ok', to: '/admin/merchants',
    },
  ];

  const Queue = ({ title, rows, empty, href }) => (
    <div className="card card-flush">
      <div style={{ padding: 14 }} className="row-between">
        <span className="h3">{title}</span>
        {rows.length > 0 && <a className="btn btn-ghost btn-sm" href={`#${href}`}>Open all</a>}
      </div>
      {rows.length === 0 && <div className="sub" style={{ padding: '0 14px 14px' }}>{empty}</div>}
      {rows.map((o) => (
        <div key={o.id} className="row-between" style={{ padding: '11px 14px', borderTop: '1px solid var(--line)', gap: 10 }}>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="strong mono" style={{ fontSize: 13 }}>{o.code}</div>
            <div className="tiny muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {o.customer} · {o.store} · {naira(o.total)}
            </div>
          </div>
          <Badge tone={(o.waiting_minutes || 0) >= 30 ? 'badge-danger' : (o.waiting_minutes || 0) >= 15 ? 'badge-warn' : 'badge-muted'}>
            {ageLabel(o.waiting_minutes)}
          </Badge>
        </div>
      ))}
    </div>
  );

  return (
    <Shell
      nav={NAV}
      title="Today"
      subtitle={`What needs a person, right now — ${new Date(`${data.day}T12:00:00+01:00`).toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long' })}`}
    >
      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Kpi label="Collected today" value={naira(data.today.collected)} hint={`${data.today.orders} orders`} />
        <Kpi label="Our fees today" value={naira(data.today.fees)} hint="Service + delivery" />
        <Kpi
          label="Avg order"
          value={naira(data.today.avg_order)}
          hint={data.today.completed
            ? `over the ${data.today.completed} finished`
            : `over the ${data.today.orders} placed so far`}
        />
        <Kpi label="New customers" value={data.today.new_customers} hint="Signed up today" />
      </div>

      <SectionHead title="Needs a decision" subtitle="The number is how many are waiting; the small line is the worst one" />
      <div className="grid grid-3" style={{ marginBottom: 18 }}>
        {attention.map((a) => (
          <a key={a.key} className="card" href={`#${a.to}`} style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="row-between">
              <span className="strong" style={{ fontSize: 13 }}>{a.label}</span>
              <Badge tone={a.tone}>{a.count}</Badge>
            </div>
            <div className="tiny muted" style={{ marginTop: 6 }}>{a.detail}</div>
            <div className="tiny" style={{ marginTop: 8, color: 'var(--green-700)', fontWeight: 700 }}>Open →</div>
          </a>
        ))}
      </div>

      <div className="grid grid-2" style={{ gap: 14 }}>
        <Queue title="Shop has not accepted" rows={q.shop_not_accepted.length ? q.shop_not_accepted : q.shop_waiting.slice(0, 4)}
          empty="Every paid order has been picked up by its shop." href="/admin/orders" />
        <Queue title="Ready but no rider" rows={q.no_rider} empty="Every bag that is ready has someone riding it." href="/admin/orders" />
        <Queue title="On the road" rows={q.on_the_road} empty="No deliveries in progress." href="/admin/orders" />
        <Queue title="Delivered, not confirmed" rows={q.delivered_unconfirmed} empty="No delivery is waiting on the customer." href="/admin/orders" />
      </div>

      {data.claims.length > 0 && (
        <>
          <SectionHead title="Claims to decide" subtitle="Money the customer has asked for back" action={<a className="btn btn-ghost btn-sm" href="#/admin/support">Support inbox</a>} />
          <div className="card card-flush" style={{ marginBottom: 16 }}>
            {data.claims.map((c) => (
              <div key={c.id} className="row-between" style={{ padding: '12px 14px', borderTop: '1px solid var(--line)', gap: 10 }}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="strong" style={{ fontSize: 13 }}>{c.subject}</div>
                  <div className="tiny muted">{c.customer_name} · {c.order_code || 'no order'} · waiting {ageLabel(c.age_minutes)}</div>
                </div>
                <span className="mono strong">{naira(c.claim_amount)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {data.money.cash_outstanding > 0 && (
        <>
          <SectionHead title="Cash to collect" subtitle="Money riders are holding from cash-on-delivery orders" />
          <CashToCollect onClear={clearCash} busy={busy} />
        </>
      )}
    </Shell>
  );
}

function CashToCollect({ onClear, busy }) {
  const [cash, setCash] = useState(null);
  useEffect(() => { api.get('/api/admin/cash').then(setCash).catch(() => setCash(null)); }, [onClear]);
  if (!cash) return null;
  const rows = (cash.records || []).filter((r) => r.outstanding > 0);
  if (rows.length === 0) return <div className="card sub">Every rider has handed their cash over.</div>;
  return (
    <div className="card card-flush">
      {rows.map((r) => (
        <div key={r.id} className="row-between" style={{ padding: '12px 14px', borderTop: '1px solid var(--line)', gap: 10 }}>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="strong mono" style={{ fontSize: 13 }}>{r.code}</div>
            <div className="tiny muted">{r.rider_name || 'Rider'} · {timeAgo(r.created_at)}</div>
          </div>
          <span className="mono strong">{naira(r.outstanding)}</span>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onClear(r)}>Received</Button>
        </div>
      ))}
    </div>
  );
}

/* --------------------------------- orders --------------------------------- */

function Orders() {
  const [data, setData] = useState(null);
  const [filters, setFilters] = useState({ status: '', type: '', q: '' });
  const [detail, setDetail] = useState(null);
  const toast = useToast();

  const load = () => {
    const p = new URLSearchParams();
    if (filters.status) p.set('status', filters.status);
    if (filters.type) p.set('type', filters.type);
    if (filters.q) p.set('q', filters.q);
    api.get(`/api/admin/orders?${p}`).then(setData).catch(() => setData({ orders: [], total: 0 }));
  };
  useEffect(() => { load(); }, [filters]);

  const open = async (o) => {
    const res = await api.get(`/api/admin/orders/${o.id}`);
    setDetail(res);
  };

  const act = async (path, body, label) => {
    try {
      await api.post(path, body);
      toast.success(label);
      setDetail(null);
      load();
    } catch (e) { toast.error(e.message); }
  };

  return (
    <Shell nav={NAV} title="Orders" subtitle="Search, assign workers, resolve disputes and refund">
      <div className="row wrap" style={{ gap: 8, marginBottom: 14 }}>
        <Input value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} placeholder="Search order code…" style={{ maxWidth: 240 }} />
        <Select aria-label="Filter orders by status" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} style={{ maxWidth: 190 }}>
          <option value="">All statuses</option>
          {['pending_payment', 'paid', 'accepted', 'preparing', 'ready_for_pickup', 'open_for_shoppers', 'shopper_assigned', 'shopping', 'awaiting_approval', 'approved', 'purchased', 'rider_assigned', 'picked_up', 'in_transit', 'delivered', 'completed', 'cancelled', 'refunded'].map((s) => (
            <option key={s} value={s}>{pretty(s)}</option>
          ))}
        </Select>
        <Select aria-label="Filter orders by type" value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })} style={{ maxWidth: 170 }}>
          <option value="">All types</option>
          <option value="merchant">Merchant</option>
          <option value="personal">Personal shopping</option>
        </Select>
        <div className="spacer" />
        <span className="sub">{data?.total ?? 0} orders</span>
      </div>

      {!data ? <Loading /> : (
        <>
        {/* Eight columns cannot survive a 390 px phone — codes and naira broke into
            two characters a line. Phones get cards, desks keep the table. */}
        <div className="col narrow-only" style={{ gap: 10 }}>
          {data.orders.length === 0 && <Empty icon="receipt" title="No orders match these filters" />}
          {data.orders.map((o) => (
            <div key={o.id} className="tile">
              <div className="row-between">
                <span className="mono strong">{o.code}</span>
                <span className="mono strong">{naira(o.total)}</span>
              </div>
              <div className="tiny muted" style={{ marginTop: 2 }}>
                {o.customer?.name || 'Customer'} · {o.customer?.phone || 'no phone'} · {timeAgo(o.created_at)}
              </div>
              <div style={{ marginTop: 6 }}>
                {o.store?.name ? <span className="sub">{o.store.name}</span> : <Badge tone="badge-orange">Personal shopping</Badge>}
              </div>
              <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
                <Badge tone={o.payment_status === 'paid' ? 'badge-ok' : o.payment_status === 'failed' ? 'badge-danger' : 'badge-warn'}>{o.payment_status}</Badge>
                <StatusBadge status={o.status} />
              </div>
              <div className="tiny muted" style={{ marginTop: 6 }}>
                {o.shopper ? `Shopper: ${o.shopper}` : 'No shopper'}{o.rider ? ` · Rider: ${o.rider}` : ''}
              </div>
              <div className="row" style={{ gap: 6, marginTop: 10, justifyContent: 'flex-end' }}>
                <Button size="sm" variant="ghost" onClick={() => open(o)}>Manage</Button>
              </div>
            </div>
          ))}
        </div>

        <div className="card card-flush table-wrap wide-only" role="group" aria-label="Scrollable table" tabIndex={0}>
          <table className="table">
            <thead><tr><th>Order</th><th>Customer</th><th>Store / type</th><th>Total</th><th>Payment</th><th>Status</th><th>Workers</th><th /></tr></thead>
            <tbody>
              {data.orders.map((o) => (
                <tr key={o.id}>
                  <td className="mono strong">{o.code}<div className="tiny muted">{timeAgo(o.created_at)}</div></td>
                  <td>{o.customer?.name}<div className="tiny muted">{o.customer?.phone}</div></td>
                  <td>{o.store?.name || <Badge tone="badge-orange">Personal shopping</Badge>}</td>
                  <td className="mono">{naira(o.total)}</td>
                  <td><Badge tone={o.payment_status === 'paid' ? 'badge-ok' : o.payment_status === 'failed' ? 'badge-danger' : 'badge-warn'}>{o.payment_status}</Badge></td>
                  <td><StatusBadge status={o.status} /></td>
                  <td className="tiny muted">{o.shopper ? `S: ${o.shopper}` : ''}{o.rider ? ` R: ${o.rider}` : ''}{!o.shopper && !o.rider ? '—' : ''}</td>
                  <td><Button size="sm" variant="ghost" onClick={() => open(o)}>Manage</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail ? `Order ${detail.order.code}` : ''}>
        {detail && (
          <div className="col" style={{ gap: 12 }}>
            <div className="row-between">
              <StatusBadge status={detail.order.status} />
              <span className="h3 mono">{naira(detail.order.total)}</span>
            </div>
            <div className="col" style={{ gap: 4 }}>
              {(detail.order.items || []).map((i) => <div key={i.id} className="sub">{i.qty} × {i.name} — {naira(i.price * i.qty)}</div>)}
              {(detail.order.shopping_items || []).map((i) => (
                <div key={i.id} className="sub">{i.description} ({i.status}) {i.proposed_price ? `— ${naira(i.proposed_price)}` : ''}</div>
              ))}
            </div>
            {/* A cash order has no provider and no reference — saying "Payment: ·" told
                the office nothing. Say how the money actually arrived. */}
            <div className="tiny muted">
              {detail.payments?.[0]
                ? `Payment: ${detail.payments[0].provider || 'provider'} · ${detail.payments[0].reference} · ${detail.payments[0].status}`
                : detail.order.payment_status === 'paid_cash'
                  ? 'Payment: cash collected by the rider on delivery'
                  : `Payment: ${String(detail.order.payment_status || 'pending').replace(/_/g, ' ')} · ${detail.order.payment_method || 'paystack'}`}
            </div>

            <div className="divider" />
            <Field label="Reassign shopper">
              <Select onChange={(e) => e.target.value && act(`/api/admin/orders/${detail.order.id}/assign`, { worker_id: e.target.value, role: 'shopper' }, 'Shopper assigned')}>
                <option value="">Choose a shopper…</option>
                {detail.eligible_shoppers.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.rating_avg}★)</option>)}
              </Select>
            </Field>
            <Field label="Reassign rider">
              <Select onChange={(e) => e.target.value && act(`/api/admin/orders/${detail.order.id}/assign`, { worker_id: e.target.value, role: 'rider' }, 'Rider assigned')}>
                <option value="">Choose a rider…</option>
                {detail.eligible_riders.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.rating_avg}★)</option>)}
              </Select>
            </Field>
            <div className="row" style={{ gap: 8 }}>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  const paidRows = detail.payments.filter((p) => ['success', 'refunded'].includes(p.status));
                  const already = paidRows.reduce((s, p) => s + (p.refunded_amount || 0), 0);
                  const left = Math.max(0, (paidRows.reduce((s, p) => s + p.amount, 0) || detail.order.total) - already);
                  const amount = await askText({
                    title: `Refund ${detail.order.code}`,
                    message: `₦${left.toLocaleString()} is still owed to the customer. Change the amount if only part of the order is affected.`,
                    label: 'How much to refund (₦)',
                    defaultValue: String(left),
                    inputType: 'number',
                    multiline: false,
                    confirmLabel: 'Next: say why',
                  });
                  if (amount === null) return;
                  const why = await askText({
                    title: 'Why is this being refunded?',
                    message: 'The customer reads this on the order, so keep it plain.',
                    presets: ['Item was missing', 'Item arrived damaged', 'Order was very late', 'Goodwill gesture', 'Rider and customer agreed'],
                    confirmLabel: `Refund ₦${Number(amount || left).toLocaleString()}`,
                    danger: true,
                  });
                  if (why === null) return;
                  act(`/api/admin/orders/${detail.order.id}/refund`, { amount: Number(amount) || left, reason: why }, 'Refund issued');
                }}
              >
                Refund {naira(Math.max(0, (detail.payments.filter((p) => ['success', 'refunded'].includes(p.status)).reduce((s, p) => s + p.amount, 0) || detail.order.total) - detail.payments.reduce((s, p) => s + (p.refunded_amount || 0), 0)))}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  try {
                    await downloadAndSave(`/api/orders/${detail.order.id}/receipt.pdf`, `BUYBUDDY-${detail.order.code}.pdf`);
                    toast.success('Receipt downloaded');
                  } catch (e) { toast.error(e.message); }
                }}
              >
                <Icon name="receipt" size={14} /> Receipt
              </Button>
              <Button size="sm" variant="ghost" onClick={() => act(`/api/admin/orders/${detail.order.id}/status`, { status: 'cancelled', note: 'Cancelled by admin' }, 'Order cancelled')}>
                Cancel order
              </Button>
            </div>
            <div className="divider" />
            <div className="label">Timeline</div>
            <div className="col" style={{ gap: 4, maxHeight: 160, overflowY: 'auto' }}>
              {detail.events.map((e) => (
                <div key={e.id} className="tiny muted">{timeAgo(e.created_at)} · {e.message || e.type}</div>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </Shell>
  );
}

/* ---------------------------------- people -------------------------------- */

function People() {
  const [data, setData] = useState(null);
  const [filters, setFilters] = useState({ role: '', status: '', q: '' });
  const toast = useToast();

  const load = () => {
    const p = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => v && p.set(k, v));
    api.get(`/api/admin/users?${p}`).then(setData).catch(() => setData({ users: [] }));
  };
  useEffect(() => { load(); }, [filters]);

  const [resetCode, setResetCode] = useState(null); // {name, code, message}

  const issueReset = async (user) => {
    try {
      const out = await api.post(`/api/admin/users/${user.id}/password-reset-code`);
      setResetCode({ name: user.name, code: out.code, message: out.message, expires_at: out.expires_at });
    } catch (e) { toast.error(e.message); }
  };

  const setStatus = async (user, status) => {
    let reason = 'Reactivated by admin';
    if (status !== 'active') {
      reason = await askText({
        title: `${status === 'suspended' ? 'Suspend' : 'Block'} ${user.name}?`,
        message: 'They are signed out and cannot order or earn until you lift this. They are not told your internal notes, only that the account is on hold and to contact support.',
        presets: ['Policy violation', 'Fraudulent activity', 'Repeated late deliveries', 'Abusive to a customer or shop'],
        confirmLabel: `Yes, ${status === 'suspended' ? 'suspend' : 'block'} the account`,
        danger: true,
      });
      if (reason === null) return;
    }
    try {
      await api.post(`/api/admin/users/${user.id}/status`, { status, reason });
      toast.success(`${user.name} ${status}`);
      load();
    } catch (e) { toast.error(e.message); }
  };

  return (
    <Shell nav={NAV} title="Customers & people" subtitle="Every account on the platform, with suspension controls">
      <div className="row wrap" style={{ gap: 8, marginBottom: 14 }}>
        <Input value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} placeholder="Name, email or phone…" style={{ maxWidth: 260 }} />
        <Select aria-label="Filter users by role" value={filters.role} onChange={(e) => setFilters({ ...filters, role: e.target.value })} style={{ maxWidth: 170 }}>
          <option value="">All roles</option>
          {['customer', 'merchant', 'shopper', 'rider', 'admin'].map((r) => <option key={r} value={r}>{pretty(r)}</option>)}
        </Select>
        <Select aria-label="Filter users by status" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} style={{ maxWidth: 170 }}>
          <option value="">All statuses</option>
          {['active', 'pending', 'suspended', 'restricted'].map((s) => <option key={s} value={s}>{pretty(s)}</option>)}
        </Select>
        <div className="spacer" /><span className="sub">{data?.total ?? 0} accounts</span>
      </div>
      {!data ? <Loading /> : (
        <div className="card card-flush table-wrap" role="group" aria-label="Scrollable table" tabIndex={0}>
          <table className="table">
            <thead><tr><th>Name</th><th>Contact</th><th>Role</th><th>Orders</th><th>Wallet</th><th>Status</th><th>Joined</th><th /></tr></thead>
            <tbody>
              {data.users.map((u) => (
                <tr key={u.id}>
                  <td className="strong" style={{ fontSize: 13 }}>{u.name}</td>
                  <td className="sub">{u.email}<div className="tiny muted mono">{u.phone}</div></td>
                  <td><Badge tone={u.role === 'admin' ? 'badge-dark' : ''}>{u.role}</Badge></td>
                  <td className="mono">{u.orders}</td>
                  <td className="mono">{naira(u.wallet_balance)}</td>
                  <td><Badge tone={u.status === 'active' ? 'badge-ok' : u.status === 'suspended' ? 'badge-danger' : 'badge-warn'}>{u.status}</Badge></td>
                  <td className="tiny muted">{timeAgo(u.created_at)}</td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      <Button size="sm" variant="ghost" onClick={() => issueReset(u)}>Reset code</Button>
                      {u.role !== 'admin' && (u.status === 'active'
                        ? <Button size="sm" variant="danger" onClick={() => setStatus(u, 'suspended')}>Suspend</Button>
                        : <Button size="sm" variant="ghost" onClick={() => setStatus(u, 'active')}>Reactivate</Button>)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!resetCode} onClose={() => setResetCode(null)} title="Password reset code">
        {resetCode && (
          <div className="col" style={{ gap: 14 }}>
            <p className="sub" style={{ margin: 0 }}>
              Give this to <strong>{resetCode.name}</strong> on the phone. They type it on the sign-in
              screen under <strong>Forgot your password?</strong> and pick a new password. It works once,
              for 15 minutes.
            </p>
            <div
              className="mono"
              style={{
                fontSize: 30, letterSpacing: 8, fontWeight: 800, textAlign: 'center',
                padding: '14px 10px', borderRadius: 12, background: 'var(--green-50)',
                border: '1px solid var(--green-200)', color: 'var(--green-800)',
              }}
            >
              {resetCode.code}
            </div>
            <p className="tiny muted" style={{ margin: 0 }}>{resetCode.message}</p>
            <Button block onClick={() => { navigator.clipboard?.writeText(resetCode.code); toast.success('Code copied'); }}>
              Copy code
            </Button>
          </div>
        )}
      </Modal>
    </Shell>
  );
}

/* -------------------------------- listings -------------------------------- */

function Listings() {
  const [data, setData] = useState(null);
  const [filters, setFilters] = useState({ q: '', status: '' });
  const toast = useToast();

  const load = () => {
    const p = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => v && p.set(k, v));
    p.set('limit', '60');
    api.get(`/api/admin/products?${p}`).then(setData).catch(() => setData({ products: [], total: 0 }));
  };
  useEffect(() => { load(); }, [filters]);

  const moderate = async (product, status) => {
    let reason;
    if (status === 'inactive') {
      reason = await askText({
        title: `Take down “${product.name}”`,
        message: 'The listing disappears from the marketplace straight away. The shop keeps its other products and sees your reason, so tell them what to fix.',
        presets: ['Photo or description does not match the product', 'Price looks wrong', 'Product is not allowed', 'Reported by a customer'],
        confirmLabel: 'Take the listing down',
        danger: true,
      });
      if (reason === null) return;
    }
    try {
      await api.patch(`/api/admin/products/${product.id}`, { status, reason });
      toast.success(status === 'active' ? 'Listing is back on the marketplace' : 'Listing hidden');
      load();
    } catch (e) { toast.error(e.message); }
  };

  return (
    <Shell nav={NAV} title="Listings" subtitle="Every product on the marketplace — take a bad one down without freezing the whole shop">
      <div className="row wrap" style={{ gap: 8, marginBottom: 14 }}>
        <Input value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} placeholder="Product or store name…" style={{ maxWidth: 280 }} />
        <Select aria-label="Filter products by visibility" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} style={{ maxWidth: 190 }}>
          <option value="">Everything</option>
          <option value="active">On the marketplace</option>
          <option value="inactive">Hidden</option>
        </Select>
        <div className="spacer" /><span className="sub">{data?.total ?? 0} listings</span>
      </div>
      {!data ? <Loading /> : data.products.length === 0 ? (
        <Empty icon="box" title="No listings match" body="Try a different name, or clear the filter." />
      ) : (
        <div className="card card-flush table-wrap" role="group" aria-label="Scrollable table" tabIndex={0}>
          <table className="table">
            <thead><tr><th>Product</th><th>Store</th><th>Price</th><th>Stock</th><th>Status</th><th /></tr></thead>
            <tbody>
              {data.products.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div className="row" style={{ gap: 8 }}>
                      {p.image && <img src={assetUrl(p.image)} alt="" style={{ width: 30, height: 30, borderRadius: 8, objectFit: 'cover' }} />}
                      <span className="strong" style={{ fontSize: 13 }}>{p.name}</span>
                    </div>
                  </td>
                  <td className="sub">{p.store_name}<div className="tiny muted">{p.owner_name}</div></td>
                  <td className="mono">{naira(p.price)}</td>
                  <td className="mono">{p.stock}</td>
                  <td><Badge tone={p.status === 'active' ? 'badge-ok' : 'badge-warn'}>{p.status === 'active' ? 'live' : 'hidden'}</Badge></td>
                  <td>
                    {p.status === 'active'
                      ? <Button size="sm" variant="danger" onClick={() => moderate(p, 'inactive')}>Take down</Button>
                      : <Button size="sm" variant="ghost" onClick={() => moderate(p, 'active')}>Put back</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}

/* -------------------------------- merchants ------------------------------- */

function Merchants() {
  const [data, setData] = useState(null);
  const toast = useToast();
  const load = () => api.get('/api/admin/merchants').then((r) => setData(r.merchants)).catch(() => setData([]));
  useEffect(() => { load(); }, []);

  const decide = async (store, decision) => {
    let reason;
    if (decision !== 'approve') {
      reason = await askText({
        title: `${decision === 'reject' ? 'Reject' : 'Suspend'} ${store.name}?`,
        message: 'The shop owner reads this, and it is the only thing they have to work with — name the document or detail that needs fixing.',
        presets: ['Incomplete documents', 'CAC number does not match the business name', 'Store address cannot be verified', 'Photo of the shop is unclear'],
        confirmLabel: `Yes, ${decision}`,
        danger: true,
      });
      if (reason === null) return;
    }
    try {
      await api.post(`/api/admin/merchants/${store.id}/decision`, { decision, reason });
      toast.success(`Store ${decision}d`);
      load();
    } catch (e) { toast.error(e.message); }
  };

  if (!data) return <Loading block />;
  const pending = data.filter((m) => m.status === 'pending');

  return (
    <Shell nav={NAV} title="Merchants" subtitle="Approve applications and manage store access">
      {pending.length > 0 && (
        <div className="card" style={{ background: 'var(--warn-soft)', borderColor: '#f0dfb4', marginBottom: 16 }}>
          <div className="strong" style={{ marginBottom: 8 }}>{pending.length} application(s) awaiting review</div>
          {pending.map((m) => (
            <div key={m.id} className="row-between" style={{ gap: 10, marginTop: 6 }}>
              <div>
                <div className="strong" style={{ fontSize: 13 }}>{m.name}</div>
                <div className="sub">{m.business_name} · CAC {m.cac_number || 'not provided'} · {m.owner_email}</div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <Button size="sm" onClick={() => decide(m, 'approve')}>Approve</Button>
                <Button size="sm" variant="danger" onClick={() => decide(m, 'reject')}>Reject</Button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="card card-flush table-wrap" role="group" aria-label="Scrollable table" tabIndex={0}>
        <table className="table">
          <thead><tr><th>Store</th><th>Owner</th><th>Area</th><th>Products</th><th>Orders</th><th>Rating</th><th>Status</th><th /></tr></thead>
          <tbody>
            {data.map((m) => (
              <tr key={m.id}>
                <td>
                  <div className="row" style={{ gap: 8 }}>
                    {m.logo && <img src={assetUrl(m.logo)} alt="" style={{ width: 30, height: 30, borderRadius: 8 }} />}
                    <span className="strong" style={{ fontSize: 13 }}>{m.name}</span>
                  </div>
                </td>
                <td className="sub">{m.owner_name}<div className="tiny muted">{m.owner_phone}</div></td>
                <td className="sub">{m.area}</td>
                <td className="mono">{m.products}</td>
                <td className="mono">{m.orders}</td>
                <td className="mono">{m.rating_avg?.toFixed(1)}</td>
                <td><Badge tone={m.status === 'active' ? 'badge-ok' : m.status === 'pending' ? 'badge-warn' : 'badge-danger'}>{m.status}</Badge></td>
                <td>
                  {m.status === 'active' && <Button size="sm" variant="ghost" onClick={() => decide(m, 'suspend')}>Suspend</Button>}
                  {['suspended', 'rejected'].includes(m.status) && <Button size="sm" variant="ghost" onClick={() => decide(m, 'reactivate')}>Reactivate</Button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}

/* --------------------------------- workers -------------------------------- */

function Workers() {
  const [data, setData] = useState(null);
  const toast = useToast();
  const load = () => api.get('/api/admin/workers').then((r) => setData(r.workers)).catch(() => setData([]));
  useEffect(() => { load(); }, []);

  const decide = async (w, decision) => {
    let reason;
    if (decision !== 'approve') {
      reason = await askText({
        title: `${decision === 'reject' ? 'Reject' : 'Suspend'} ${w.name}?`,
        message: 'They read this in the app and it is what they will fix before applying again.',
        presets: ['ID photo is unclear', 'Guarantor details missing', 'Bank name does not match the account number', 'Could not reach them on the phone'],
        confirmLabel: `Yes, ${decision}`,
        danger: true,
      });
      if (reason === null) return;
    }
    try {
      await api.post(`/api/admin/workers/${w.id}/decision`, { decision, reason });
      toast.success(`Worker ${decision}d`);
      load();
    } catch (e) { toast.error(e.message); }
  };

  if (!data) return <Loading block />;
  const pending = data.filter((w) => w.verified === 0);

  return (
    <Shell nav={NAV} title="Shoppers & riders" subtitle="Verification, performance and payout eligibility">
      {pending.length > 0 && (
        <div className="card" style={{ background: 'var(--warn-soft)', borderColor: '#f0dfb4', marginBottom: 16 }}>
          <div className="strong" style={{ marginBottom: 8 }}>{pending.length} verification request(s)</div>
          {pending.map((w) => (
            <div key={w.id} className="row-between" style={{ gap: 10, marginTop: 6 }}>
              <div>
                <div className="strong" style={{ fontSize: 13 }}>{w.name} · {pretty(w.roles)}</div>
                <div className="sub">{w.service_areas || w.service_city} · {w.phone}</div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <Button size="sm" onClick={() => decide(w, 'approve')}>Verify</Button>
                <Button size="sm" variant="danger" onClick={() => decide(w, 'reject')}>Reject</Button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="card card-flush table-wrap" role="group" aria-label="Scrollable table" tabIndex={0}>
        <table className="table">
          <thead><tr><th>Name</th><th>Roles</th><th>Service areas</th><th>Jobs</th><th>Rating</th><th>Wallet</th><th>Status</th><th /></tr></thead>
          <tbody>
            {data.map((w) => (
              <tr key={w.id}>
                <td className="strong" style={{ fontSize: 13 }}>{w.name}<div className="tiny muted">{w.phone}</div></td>
                <td><Badge>{w.roles}</Badge></td>
                <td className="sub">{w.service_areas || '—'}</td>
                <td className="mono">{w.jobs}</td>
                <td className="mono">{w.rating_avg ? `${w.rating_avg.toFixed(1)}★` : '—'}</td>
                <td className="mono">{naira(w.wallet_balance)}</td>
                <td><Badge tone={w.verified ? 'badge-ok' : 'badge-warn'}>{w.verified ? 'verified' : 'pending'}</Badge></td>
                <td>
                  {w.verified ? <Button size="sm" variant="danger" onClick={() => decide(w, 'suspend')}>Suspend</Button>
                                    : <Button size="sm" onClick={() => decide(w, 'approve')}>Verify</Button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}

/* ---------------------------------- finance -------------------------------- */

function Finance() {
  const [data, setData] = useState(null);
  const [cash, setCash] = useState(null);
  const [clearing, setClearing] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const toast = useToast();
  const load = () => {
    api.get('/api/admin/finance').then(setData).catch(() => setData(null));
    api.get('/api/admin/cash').then(setCash).catch(() => setCash(null));
  };
  useEffect(() => { load(); }, []);

  const decide = async (payout, decision, reason) => {
    try {
      await api.post(`/api/admin/payouts/${payout.id}/decision`, { decision, reason });
      toast.success(
        decision === 'reject'
          ? `Rejected — ₦${payout.amount.toLocaleString()} returned to ${payout.worker_name}`
          : `Payout ${decision}`,
      );
      setRejecting(null);
      load();
    } catch (e) { toast.error(e.message); }
  };

  const markCash = async (record, note) => {
    try {
      const r = await api.post(`/api/admin/cash/${record.id}/clear`, { note });
      toast.success(`₦${r.cleared.toLocaleString()} marked as received — the rider has been told`);
      setClearing(null);
      load();
    } catch (e) { toast.error(e.message); }
  };

  if (!data) return <Loading block />;

  return (
    <Shell nav={NAV} title="Finance & payouts" subtitle="Payments, refunds, commission and withdrawals">
      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Kpi label="Captured" value={naira(data.totals.captured)} />
        <Kpi label="Pending" value={naira(data.totals.pending)} />
        <Kpi label="Refunded" value={naira(data.totals.refunded)} />
        <Kpi label="Payouts requested" value={naira(data.totals.payouts_requested)} tone="var(--orange-ink)" />
      </div>

      {cash && cash.records.length > 0 && (
        <div className="card card-flush" style={{ marginBottom: 16 }}>
          <div style={{ padding: 14 }} className="row-between">
            <div>
              <div className="h3">Cash riders are holding</div>
              <div className="tiny muted">Cash-on-delivery money the customer has already paid. Mark it received when it reaches you.</div>
            </div>
            <div className="mono strong" style={{ color: cash.outstanding_total ? 'var(--orange-ink)' : 'var(--ok)', fontSize: 18 }}>
              {naira(cash.outstanding_total)}
            </div>
          </div>
          <div className="table-wrap" role="group" aria-label="Scrollable table" tabIndex={0}>
            <table className="table">
              <thead><tr><th>Order</th><th>Rider</th><th>Collected</th><th>Refunded</th><th>Still owed</th><th>Status</th><th /></tr></thead>
              <tbody>
                {cash.records.map((r) => (
                  <tr key={r.id}>
                    <td className="mono strong">{r.code || '—'}</td>
                    <td className="sub">{r.rider_name || 'No rider assigned'}</td>
                    <td className="mono">{naira(r.collected)}</td>
                    <td className="mono">{r.refunded ? `−${naira(r.refunded)}` : '—'}</td>
                    <td className="mono strong">{naira(r.outstanding)}</td>
                    <td><Badge tone={r.status === 'open' ? 'badge-warn' : 'badge-ok'}>{r.status === 'open' ? 'Outstanding' : 'Received'}</Badge></td>
                    <td>
                      {r.status === 'open' && (
                        <Button size="sm" onClick={() => setClearing(r)}>Mark cash received</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card card-flush" style={{ marginBottom: 16 }}>
        <div style={{ padding: 14 }} className="h3">Payout requests</div>
        <div className="table-wrap" role="group" aria-label="Scrollable table" tabIndex={0}>
          <table className="table">
            <thead><tr><th>Worker</th><th>Amount</th><th>Bank</th><th>Requested</th><th>Status</th><th /></tr></thead>
            <tbody>
              {data.payouts.map((p) => (
                <tr key={p.id}>
                  <td className="strong" style={{ fontSize: 13 }}>{p.worker_name}<div className="tiny muted">{p.role}</div></td>
                  <td className="mono">{naira(p.amount)}</td>
                  <td className="sub">{p.bank_name || '—'} {p.account_number ? `· ${p.account_number}` : ''}</td>
                  <td className="tiny muted">{timeAgo(p.requested_at)}</td>
                  <td><StatusBadge status={p.status} /></td>
                  <td>
                    {p.status === 'requested' && (
                      <div className="row" style={{ gap: 6 }}>
                        <Button size="sm" onClick={() => decide(p, 'approve')}>Approve</Button>
                        <Button size="sm" variant="danger" onClick={() => setRejecting(p)}>Reject &amp; refund</Button>
                      </div>
                    )}
                    {p.status === 'approved' && <Button size="sm" onClick={() => decide(p, 'pay')}>Mark paid</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card card-flush">
        <div style={{ padding: 14 }} className="h3">Recent payments</div>
        <div className="table-wrap" role="group" aria-label="Scrollable table" tabIndex={0}>
          <table className="table">
            <thead><tr><th>Reference</th><th>Order</th><th>Customer</th><th>Amount</th><th>Provider</th><th>Status</th><th>When</th></tr></thead>
            <tbody>
              {data.payments.map((p) => (
                <tr key={p.id}>
                  <td className="mono tiny">{p.reference}</td>
                  <td className="mono strong">{p.order_code}</td>
                  <td className="sub">{p.customer_name}</td>
                  <td className="mono">{naira(p.amount)}</td>
                  <td><Badge>{p.provider}</Badge></td>
                  <td><Badge tone={p.status === 'success' ? 'badge-ok' : p.status === 'pending' ? 'badge-warn' : 'badge-danger'}>{p.status}</Badge></td>
                  <td className="tiny muted">{timeAgo(p.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        open={!!clearing}
        onClose={() => setClearing(null)}
        title="Mark cash as received"
        footer={<Button block onClick={() => markCash(clearing, 'Cash handed over at the office')}>{`Yes — I have the ${naira(clearing?.outstanding || 0)}`}</Button>}
      >
        <div className="sub">
          Confirm that <strong>{clearing?.rider_name || 'this rider'}</strong> has handed over{' '}
          <strong>{naira(clearing?.outstanding || 0)}</strong> for {clearing?.code}. The rider's cash-in-hand goes
          to zero and they can withdraw their full balance again.
        </div>
      </Modal>

      <RejectPayout
        payout={rejecting}
        onClose={() => setRejecting(null)}
        onSubmit={(reason) => decide(rejecting, 'reject', reason)}
      />
    </Shell>
  );
}

/* --------------------------------- marketing ------------------------------- */

function Marketing() {
  const [promos, setPromos] = useState(null);
  const [banners, setBanners] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ code: '', description: '', type: 'percent', value: 10, min_subtotal: 3000, usage_limit: 100 });
  const [broadcast, setBroadcast] = useState({ title: '', body: '', role: 'customer' });
  const toast = useToast();

  const load = () => {
    api.get('/api/admin/promos').then((r) => setPromos(r.promos)).catch(() => setPromos([]));
    api.get('/api/admin/banners').then((r) => setBanners(r.banners)).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    try {
      await api.post('/api/admin/promos', form);
      toast.success('Promo created');
      setOpen(false);
      load();
    } catch (e) { toast.error(e.message); }
  };

  const toggle = async (p) => {
    await api.patch(`/api/admin/promos/${p.code}`, { active: !p.active });
    load();
  };

  const send = async () => {
    try {
      const r = await api.post('/api/admin/notifications/broadcast', broadcast);
      toast.success(`Notification sent to ${r.sent} users`);
      setBroadcast({ title: '', body: '', role: 'customer' });
    } catch (e) { toast.error(e.message); }
  };

  return (
    <Shell nav={NAV} title="Marketing" subtitle="Promo codes, banners and push notifications">
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1.3fr) minmax(0,1fr)', gap: 16, alignItems: 'start' }}>
        <div className="col" style={{ gap: 16 }}>
          <div className="card card-flush">
            <div className="row-between" style={{ padding: 14 }}>
              <div className="h3">Promo codes</div>
              <Button size="sm" onClick={() => setOpen(true)}>New promo</Button>
            </div>
            {!promos ? <Loading block={false} /> : (
              <div className="table-wrap" role="group" aria-label="Scrollable table" tabIndex={0}>
                <table className="table">
                  <thead><tr><th>Code</th><th>Type</th><th>Value</th><th>Min</th><th>Used</th><th>Status</th><th /></tr></thead>
                  <tbody>
                    {promos.map((p) => (
                      <tr key={p.code}>
                        <td className="mono strong">{p.code}</td>
                        <td><Badge>{p.type}</Badge></td>
                        <td className="mono">{p.type === 'percent' ? `${p.value}%` : p.type === 'fixed' ? naira(p.value) : 'Free delivery'}</td>
                        <td className="mono sub">{naira(p.min_subtotal)}</td>
                        <td className="mono">{p.used_count}{p.usage_limit ? `/${p.usage_limit}` : ''}</td>
                        <td><Badge tone={p.active ? 'badge-ok' : 'badge-danger'}>{p.active ? 'active' : 'off'}</Badge></td>
                        <td><Button size="sm" variant="ghost" onClick={() => toggle(p)}>{p.active ? 'Disable' : 'Enable'}</Button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card">
            <SectionHead title="Homepage banners" />
            <div className="col" style={{ gap: 8 }}>
              {banners.map((b) => (
                <div key={b.id} className="row" style={{ gap: 10 }}>
                  <div style={{ width: 34, height: 34, borderRadius: 10, background: b.bg_color, flex: 'none' }} />
                  <div className="grow">
                    <div className="strong" style={{ fontSize: 13 }}>{b.title}</div>
                    <div className="tiny muted">{b.subtitle}</div>
                  </div>
                  <Badge tone={b.active ? 'badge-ok' : ''}>{b.active ? 'live' : 'hidden'}</Badge>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="card col" style={{ gap: 12 }}>
          <div className="h3">Send a push notification</div>
          <Field label="Audience">
            <Select aria-label="Send to which role" value={broadcast.role} onChange={(e) => setBroadcast({ ...broadcast, role: e.target.value })}>
              <option value="customer">All customers</option>
              <option value="shopper">All shoppers</option>
              <option value="rider">All riders</option>
              <option value="merchant">All merchants</option>
            </Select>
          </Field>
          <Field label="Title"><Input value={broadcast.title} onChange={(e) => setBroadcast({ ...broadcast, title: e.target.value })} placeholder="Weekend deals are live" /></Field>
          <Field label="Message"><Textarea value={broadcast.body} onChange={(e) => setBroadcast({ ...broadcast, body: e.target.value })} placeholder="Up to 30% off groceries this weekend." /></Field>
          <Button onClick={send} disabled={!broadcast.title || !broadcast.body}>Send notification</Button>
          <p className="tiny muted">In production this fans out through Firebase Cloud Messaging with per-user opt-out respected.</p>
        </div>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Create promo code" footer={<Button block onClick={create}>Create promo</Button>}>
        <div className="col" style={{ gap: 12 }}>
          <Field label="Code"><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="WELCOME10" /></Field>
          <Field label="Description"><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <div className="row" style={{ gap: 10 }}>
            <Field label="Type">
              <Select aria-label="Type of banner" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                <option value="percent">Percent off</option>
                <option value="fixed">Fixed amount</option>
                <option value="free_delivery">Free delivery</option>
              </Select>
            </Field>
            <Field label="Value"><Input type="number" value={form.value} onChange={(e) => setForm({ ...form, value: Number(e.target.value) })} /></Field>
          </div>
          <div className="row" style={{ gap: 10 }}>
            <Field label="Min order (₦)"><Input type="number" value={form.min_subtotal} onChange={(e) => setForm({ ...form, min_subtotal: Number(e.target.value) })} /></Field>
            <Field label="Usage limit"><Input type="number" value={form.usage_limit} onChange={(e) => setForm({ ...form, usage_limit: Number(e.target.value) })} /></Field>
          </div>
        </div>
      </Modal>
    </Shell>
  );
}

/* ---------------------------------- support -------------------------------- */

function Support() {
  const [tickets, setTickets] = useState(null);
  const [reply, setReply] = useState({});
  const [refund, setRefund] = useState({});
  const [busy, setBusy] = useState({});
  const toast = useToast();
  const load = () => api.get('/api/admin/tickets').then((r) => setTickets(r.tickets)).catch(() => setTickets([]));
  useEffect(() => { load(); }, []);

  const send = async (t) => {
    if (!reply[t.id]?.trim()) return;
    await api.post(`/api/admin/tickets/${t.id}/reply`, { body: reply[t.id] });
    setReply({ ...reply, [t.id]: '' });
    toast.success('Reply sent');
    load();
  };
  const resolve = async (t, withRefund) => {
    const amount = Number(refund[t.id] || 0);
    if (withRefund && !(amount > 0)) { toast.error('Enter the amount to refund first.'); return; }
    setBusy({ ...busy, [t.id]: true });
    try {
      await api.post(`/api/admin/tickets/${t.id}/resolve`, {
        resolution: withRefund
          ? `Refunded ₦${amount.toLocaleString()} — ${t.subject}`
          : 'Resolved by support',
        ...(withRefund ? { refund_amount: amount } : {}),
      });
      toast.success(withRefund ? `₦${amount.toLocaleString()} refunded and ticket closed` : 'Ticket resolved');
      load();
    } catch (e) { toast.error(e.message); } finally { setBusy({ ...busy, [t.id]: false }); }
  };

  if (!tickets) return <Loading block />;

  return (
    <Shell nav={NAV} title="Support inbox" subtitle="Complaints, refunds and dispute resolution">
      {tickets.length === 0 && <Empty icon="chat" title="No tickets" body="Customers can raise tickets from the app." />}
      <div className="col" style={{ gap: 12 }}>
        {tickets.map((t) => (
          <div key={t.id} className="card">
            <div className="row-between">
              <div>
                <div className="strong">{t.subject}</div>
                <div className="tiny muted">{t.customer_name} · {t.customer_phone} · {pretty(t.category)} · {timeAgo(t.created_at)}</div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <Badge tone={t.priority === 'high' ? 'badge-danger' : 'badge-warn'}>{t.priority}</Badge>
                <StatusBadge status={t.status} />
              </div>
            </div>
            {t.claim_amount ? (
              <div className="card" style={{ marginTop: 10, background: 'var(--orange-soft)', boxShadow: 'none' }}>
                <div className="row-between">
                  <span className="strong" style={{ fontSize: 13 }}>Refund requested: {naira(t.claim_amount)}</span>
                  {t.refunded_amount > 0 && <Badge tone="badge-ok">{naira(t.refunded_amount)} already refunded</Badge>}
                </div>
                <div className="tiny" style={{ marginTop: 3 }}>
                  Paying this back goes through the normal refund path — card back to the card, wallet back to the
                  wallet — and is capped at what is still unrefunded on {t.order_id ? 'the order' : 'the order'}.
                  Nothing leaves until you press the button.
                </div>
              </div>
            ) : null}
            {t.photo && (
              <a href={t.photo} target="_blank" rel="noreferrer" className="chip" style={{ marginTop: 8 }}>
                <Icon name="receipt" size={13} /> Customer's photo
              </a>
            )}
            <div className="col" style={{ gap: 6, marginTop: 10 }}>
              {t.messages.map((m) => (
                <div key={m.id} style={{ background: m.sender_role === 'admin' ? 'var(--green-50)' : '#f7f9f7', padding: '8px 11px', borderRadius: 10, fontSize: 13 }}>
                  <span className="tiny muted strong">{m.sender_role === 'admin' ? 'Support' : t.customer_name}</span> — {m.body}
                </div>
              ))}
            </div>
            {t.status !== 'resolved' && (
              <>
                <div className="row" style={{ gap: 8, marginTop: 10 }}>
                  <Input value={reply[t.id] || ''} onChange={(e) => setReply({ ...reply, [t.id]: e.target.value })} placeholder="Reply to the customer…" />
                  <Button size="sm" onClick={() => send(t)}>Send</Button>
                  <Button size="sm" variant="ghost" onClick={() => resolve(t, false)} disabled={busy[t.id]}>Resolve</Button>
                </div>
                {t.order_id && (
                  <div className="row" style={{ gap: 8, marginTop: 8 }}>
                    <Input
                      type="number"
                      value={refund[t.id] ?? (t.claim_amount || '')}
                      onChange={(e) => setRefund({ ...refund, [t.id]: e.target.value })}
                      placeholder="Amount to refund (₦)"
                      style={{ maxWidth: 190 }}
                    />
                    <Button size="sm" onClick={() => resolve(t, true)} disabled={busy[t.id]}>
                      {busy[t.id] ? 'Refunding…' : 'Refund & resolve'}
                    </Button>
                  </div>
                )}
              </>
            )}
            {t.resolution && <div className="tiny muted" style={{ marginTop: 6 }}>Resolution: {t.resolution}</div>}
          </div>
        ))}
      </div>
    </Shell>
  );
}

/* --------------------------------- settings -------------------------------- */

function Settings() {
  const [settings, setSettings] = useState(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => { api.get('/api/admin/settings').then((r) => setSettings(r.settings)).catch(() => {}); }, []);

  const set = (k) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setSettings({ ...settings, [k]: v });
  };

  const save = async () => {
    setBusy(true);
    try {
      const r = await api.put('/api/admin/settings', { settings });
      setSettings(r.settings);
      toast.success('Settings saved');
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  if (!settings) return <Loading block />;

  const num = (k, label, hint) => (
    <Field label={label} hint={hint}>
      <Input type="number" value={settings[k]} onChange={set(k)} />
    </Field>
  );
  const text = (k, label, hint) => (
    <Field label={label} hint={hint}><Input value={settings[k] ?? ''} onChange={set(k)} /></Field>
  );
  const flag = (k, label, hint) => (
    <label className="check" style={{ padding: '10px 0' }}>
      <input type="checkbox" checked={Boolean(settings[k])} onChange={set(k)} />
      <span><span className="strong">{label}</span>{hint && <div className="tiny muted">{hint}</div>}</span>
    </label>
  );

  return (
    <Shell nav={NAV} title="Platform settings" subtitle="Fees, loyalty, referrals, scheduling and payment options — changes take effect immediately">
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 16, alignItems: 'start' }}>
        <div className="col" style={{ gap: 16 }}>
        <div className="card col" style={{ gap: 10 }}>
          <div className="h3">Text size</div>
          <div className="sub">Bigger text for the whole admin app, on this device.</div>
          <TextSizeControl />
        </div>
        <div className="card col" style={{ gap: 12 }}>
          <div className="h3">Fees & commissions</div>
          {num('service_fee_percent', 'Service fee (%)', 'Applied to merchant orders')}
          {num('service_fee_flat', 'Service fee flat (₦)')}
          {num('shopper_fee_percent', 'Shopper fee (%)', 'Personal shopping requests')}
          {num('shopper_fee_flat', 'Shopper fee flat (₦)')}
          {num('delivery_fee_base', 'Delivery base fee (₦)')}
          {num('delivery_fee_per_km', 'Delivery per km (₦)')}
          {num('express_fee', 'Express surcharge (₦)')}
          {num('vat_percent', 'VAT (%)')}
          {num('min_order_value', 'Minimum order value (₦)')}
          {num('shopper_commission_percent', 'Shopper share of shopping fee (%)')}
        </div>
        </div>
        <div className="col" style={{ gap: 16 }}>
          <div className="card col" style={{ gap: 10 }}>
            <div className="h3">Payments & features</div>
            {flag('paystack_enabled', 'Paystack')}
            {flag('wallet_enabled', 'BUYBUDDY wallet')}
            {flag('cod_enabled', 'Cash on delivery', 'Riders collect cash at the door')}
            {flag('auto_offer_jobs', 'Auto-offer jobs to workers')}
            {num('offer_radius_km', 'Job offer radius (km)')}
            {num('cancellation_window_minutes', 'Customer cancellation window (minutes)')}
          </div>
          <div className="card col" style={{ gap: 10 }}>
            <div className="h3">Loyalty & referrals</div>
            {flag('loyalty_enabled', 'Loyalty points', 'Customers earn points when an order completes')}
            {num('loyalty_points_per_1000', 'Points per ₦1,000 spent')}
            {num('loyalty_naira_per_point', 'Naira value of 1 point (₦)')}
            {num('loyalty_min_redeem', 'Minimum points per redemption')}
            {num('loyalty_max_redeem_percent', 'Max % of basket payable with points')}
            {flag('referral_enabled', 'Referral rewards')}
            {num('referral_referrer_reward', 'Referrer reward (₦)', 'Paid to wallet after the friend’s first completed order')}
            {num('referral_referee_reward', 'Friend’s first-order reward (₦)')}
          </div>
          <div className="card col" style={{ gap: 10 }}>
            <div className="h3">Scheduling</div>
            {flag('scheduling_enabled', 'Scheduled deliveries', 'Let customers pick a delivery window')}
            {num('scheduling_max_days', 'Book up to (days ahead)')}
            {num('scheduling_min_hours', 'Minimum notice (hours)')}
          </div>
          <div className="card col" style={{ gap: 10 }}>
            <div className="h3">Market & support</div>
            {text('supported_cities', 'Launch cities', 'Comma separated')}
            {text('support_email', 'Support email')}
            {text('support_phone', 'Support phone')}
          </div>
          <Button onClick={save} disabled={busy} size="lg">{busy ? 'Saving…' : 'Save settings'}</Button>
        </div>
      </div>
      <div style={{ marginTop: 16 }}>
        <DataBackup />
      </div>
    </Shell>
  );
}

/*
 * A backup you cannot take is not a backup. This is the whole database as one
 * file, and it is the only thing standing between a free host's wipe-on-deploy
 * and losing a real day of orders.
 */
function DataBackup() {
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState(null);
  const [confirm, setConfirm] = useState('');
  const toast = useToast();

  const download = async () => {
    setBusy(true);
    try {
      const blob = await downloadFile('/api/admin/backup');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `buybuddy-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success('Backup downloaded — keep it somewhere safe');
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const restore = async () => {
    if (!file) return toast.error('Choose a backup file first.');
    setBusy(true);
    try {
      const text = await file.text();
      const backup = JSON.parse(text);
      const r = await api.post('/api/admin/restore', { backup, confirm });
      toast.success(`Restored ${Object.values(r.restored || {}).reduce((a, b) => a + b, 0)} rows`);
      setTimeout(() => window.location.reload(), 900);
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="card col" style={{ gap: 10 }}>
      <div className="h3">Data &amp; backup</div>
      <p className="sub" style={{ margin: 0 }}>
        Everything in BUYBUDDY lives in one database. Download it before a deploy, and you can always put it back.
      </p>
      <div className="row" style={{ gap: 8 }}>
        <Button onClick={download} disabled={busy}>Download backup</Button>
      </div>
      <div className="divider" />
      <div className="tiny muted">Restore replaces every order, user and product with the contents of the file.</div>
      <label className="btn btn-ghost" style={{ cursor: 'pointer', alignSelf: 'flex-start' }}>
        <Icon name="box" size={14} /> {file ? file.name : 'Choose backup file'}
        <input
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={(e) => setFile(e.target.files?.[0] || null)}
        />
      </label>
      <Field label="Type REPLACE ALL DATA to confirm">
        <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="REPLACE ALL DATA" />
      </Field>
      <Button variant="danger" onClick={restore} disabled={busy || !file || confirm !== 'REPLACE ALL DATA'}>
        {busy ? 'Working…' : 'Restore from file'}
      </Button>
    </div>
  );
}

/* ----------------------------------- audit --------------------------------- */

function Audit() {
  const [logs, setLogs] = useState(null);
  useEffect(() => { api.get('/api/admin/audit-logs').then((r) => setLogs(r.logs)).catch(() => setLogs([])); }, []);
  if (!logs) return <Loading block />;
  return (
    <Shell nav={NAV} title="Audit log" subtitle="Every privileged action, recorded">
      <div className="card card-flush table-wrap" role="group" aria-label="Scrollable table" tabIndex={0}>
        <table className="table">
          <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>Details</th><th>IP</th></tr></thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id}>
                <td className="tiny muted">{new Date(l.created_at).toLocaleString('en-NG')}</td>
                <td className="sub">{l.actor_email || 'system'}</td>
                <td><Badge>{l.action}</Badge></td>
                <td className="sub">{l.entity}{l.entity_id ? ` · ${l.entity_id.slice(0, 10)}` : ''}</td>
                <td className="tiny muted" style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.meta || '—'}</td>
                <td className="tiny muted mono">{l.ip}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}

/* ------------------------------ integrations ----------------------------- */
/**
 * "Go-live checks" — answers the only question that matters before launch:
 * which parts of BUYBUDDY are actually real, and which are still simulated?
 */
function Integrations() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    api.get('/api/admin/integrations').then(setData).catch((e) => setErr(e.message));
  }, []);

  if (err) return <Shell nav={NAV} title="Go-live checks"><Empty title="Could not load" body={err} /></Shell>;
  if (!data) return <Shell nav={NAV} title="Go-live checks"><Loading /></Shell>;

  const done = data.live_count;
  const all = data.total;

  return (
    <Shell
      nav={NAV}
      title="Go-live checks"
      subtitle={`${done} of ${all} integrations live${done === all ? ' — everything is real.' : ' — the rest are still simulated.'}`}
    >
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row-between" style={{ marginBottom: 10 }}>
          <div className="h3">Launch readiness</div>
          <Badge tone={done === all ? 'badge-ok' : 'badge-warn'}>
            {Math.round((done / all) * 100)}%
          </Badge>
        </div>
        <div style={{ height: 10, borderRadius: 999, background: 'var(--green-50)', overflow: 'hidden' }}>
          <div style={{
            width: `${(done / all) * 100}%`, height: '100%', borderRadius: 999,
            background: 'linear-gradient(90deg, var(--green-600), var(--green-700))',
            transition: 'width .4s ease',
          }} />
        </div>
      </div>

      <div className="col" style={{ gap: 10 }}>
        {data.checks.map((c) => (
          <div key={c.key} className="card">
            <div className="row-between" style={{ gap: 12, alignItems: 'flex-start' }}>
              <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                <div style={{
                  width: 30, height: 30, borderRadius: 10, flex: 'none', display: 'grid', placeItems: 'center',
                  background: c.live ? 'var(--ok-soft)' : 'var(--warn-soft)',
                  color: c.live ? 'var(--ok)' : 'var(--warn)',
                }}>
                  <Icon name={c.live ? 'check' : 'clock'} size={16} />
                </div>
                <div>
                  <div className="strong" style={{ fontSize: 14 }}>{c.label}</div>
                  <div className="sub" style={{ marginTop: 3 }}>{c.detail}</div>
                  {!c.live && <div className="tiny muted" style={{ marginTop: 6 }}>Fix: {c.fix}</div>}
                </div>
              </div>
              <Badge tone={c.live ? 'badge-ok' : 'badge-warn'}>{c.live ? 'Live' : 'Simulated'}</Badge>
            </div>
          </div>
        ))}
      </div>

      {data.recentSms?.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="h3" style={{ marginBottom: 8 }}>Recent text messages</div>
          <div className="table-wrap" role="group" aria-label="Scrollable table" tabIndex={0}>
            <table className="table">
              <thead>
                <tr><th>Phone</th><th>Status</th><th>Provider</th><th>When</th></tr>
              </thead>
              <tbody>
                {data.recentSms.map((m, i) => (
                  <tr key={i}>
                    <td className="mono">{m.phone}</td>
                    <td>
                      <Badge tone={m.status === 'sent' ? 'badge-ok' : m.status === 'failed' ? 'badge-danger' : 'badge-warn'}>
                        {m.status.replace('_', ' ')}
                      </Badge>
                    </td>
                    <td>{m.provider}</td>
                    <td className="tiny muted">{timeAgo(m.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: 16, background: 'linear-gradient(120deg, var(--green-50), #fff)' }}>
        <div className="h3">How to turn each one on</div>
        <div className="sub" style={{ marginTop: 6, lineHeight: 1.7 }}>
          These are server settings, not code changes. Add the keys in your hosting dashboard
          (Render → Environment), restart, and the amber items above turn green.
          Nothing needs rebuilding — not even the app.
        </div>
      </div>
    </Shell>
  );
}
