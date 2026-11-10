import React, { useEffect, useMemo, useState } from 'react';
import { Route, Routes, useNavigate } from 'react-router-dom';
import { api, naira, pretty, timeAgo, statusTone, assetUrl } from '../lib/api.js';
import {
  Badge, Button, Empty, Field, Icon, Input, Loading, Modal, SectionHead, Select, StatusBadge,
  Textarea, useAuth, useToast,
} from '../lib/ui.jsx';
import Shell, { Kpi, Bars } from '../components/Shell.jsx';
import PhotoPicker from '../components/PhotoPicker.jsx';

const NAV = [
  { to: '/merchant', label: 'Dashboard', icon: 'chart', end: true },
  { to: '/merchant/orders', label: 'Orders', icon: 'receipt' },
  { to: '/merchant/products', label: 'Products', icon: 'box' },
  { to: '/merchant/settlements', label: 'Settlements', icon: 'wallet' },
  { to: '/merchant/settings', label: 'Store settings', icon: 'gear' },
];

export default function MerchantApp() {
  const [me, setMe] = useState(null);
  const load = () => api.get('/api/merchant/store').then(setMe).catch(() => setMe(false));
  useEffect(() => { load(); }, []);

  if (me === null) return <Loading block label="Loading your store…" />;
  if (me === false) return <NoStore onDone={load} />;

  return (
    <Routes>
      <Route index element={<Dashboard me={me} reload={load} />} />
      <Route path="orders" element={<Orders />} />
      <Route path="products" element={<Products me={me} />} />
      <Route path="settlements" element={<Settlements />} />
      <Route path="settings" element={<StoreSettings me={me} reload={load} />} />
      <Route path="*" element={<Dashboard me={me} reload={load} />} />
    </Routes>
  );
}

function NoStore({ onDone }) {
  const [form, setForm] = useState({ name: '', description: '', area: '', phone: '' });
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const create = async () => {
    setBusy(true);
    try {
      await api.post('/api/merchant/store', form);
      toast.success('Store created — awaiting admin approval');
      onDone();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Shell nav={NAV} title="Set up your store" subtitle="Your merchant account has no store yet">
      <div className="card" style={{ maxWidth: 560 }}>
        <div className="col" style={{ gap: 12 }}>
          <Field label="Store name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="GreenMart Supermarket" /></Field>
          <Field label="What do you sell?"><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <div className="row" style={{ gap: 10 }}>
            <Field label="Area"><Input value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} placeholder="Lekki Phase 1" /></Field>
            <Field label="Store phone"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
          </div>
          <Button onClick={create} disabled={busy}>{busy ? 'Creating…' : 'Create store'}</Button>
        </div>
      </div>
    </Shell>
  );
}

/* -------------------------------- decline --------------------------------- */

const DECLINE_REASONS = [
  'Out of stock',
  'Too busy right now',
  'Closing early today',
  'Items damaged',
  'Delivery address unreachable',
];

/**
 * Declining an order gives a customer their money back, so it needs a reason and
 * a moment's thought — a browser prompt() gave neither and looked nothing like
 * the rest of the app.
 */
function DeclineModal({ order, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();

  const submit = async () => {
    const text = reason.trim();
    if (text.length < 5) return setError('Pick a reason or type at least a few words — the customer sees this.');
    setBusy(true);
    setError('');
    try {
      const res = await api.post(`/api/merchant/orders/${order.id}/reject`, { reason: text });
      toast.success(res.refunded ? `Declined — ${naira(order.total)} is going back to the customer` : 'Order declined');
      onDone?.();
      onClose();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal
      open={!!order}
      onClose={onClose}
      title={`Decline ${order?.code}`}
      footer={(
        <div className="col" style={{ gap: 10 }}>
          {error && <div className="tiny" style={{ color: 'var(--danger)' }}>{error}</div>}
          <div className="row" style={{ gap: 8 }}>
            <Button variant="ghost" className="grow" onClick={onClose} disabled={busy}>Keep the order</Button>
            <Button variant="danger" className="grow" onClick={submit} disabled={busy}>
              {busy ? 'Declining…' : 'Decline and refund'}
            </Button>
          </div>
        </div>
      )}
    >
      <div className="sub" style={{ marginBottom: 12 }}>
        The customer gets {naira(order?.total || 0)} back in full. If you have already accepted this order,
        a rider may already be on the way — declining it now still works until they collect it.
      </div>
      <Field label="Why can’t you fulfil it?">
        <div className="row wrap" style={{ gap: 6, marginBottom: 8 }}>
          {DECLINE_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              className={`chip ${reason === r ? 'active' : ''}`}
              onClick={() => { setReason(r); setError(''); }}
            >
              {r}
            </button>
          ))}
        </div>
        <Textarea
          value={reason}
          onChange={(e) => { setReason(e.target.value); setError(''); }}
          placeholder="Tell the customer what happened"
          rows={3}
        />
      </Field>
    </Modal>
  );
}

/* ------------------------------- dashboard -------------------------------- */

function Dashboard({ me, reload }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  // hooks must all run before the first early return, or React throws #310
  const [declining, setDeclining] = useState(null);
  const toast = useToast();
  const nav = useNavigate();

  const load = () => api.get('/api/merchant/dashboard').then(setData).catch(() => setData(null));
  useEffect(() => { load(); }, []);

  if (!data) return <Loading block />;
  const { store, metrics, pending_orders, active_orders, low_stock, chart } = data;

  const act = async (order, action) => {
    setBusy(true);
    try {
      if (action === 'accept') await api.post(`/api/merchant/orders/${order.id}/accept`, {});
      if (action === 'ready') await api.post(`/api/merchant/orders/${order.id}/ready`, {});
      await load();
      if (action !== 'reject') toast.success('Order updated');
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <Shell
      nav={NAV.map((n) => (n.label === 'Orders' ? { ...n, count: metrics.pending_acceptance || '' } : n))}
      title={store.name}
      subtitle={`${store.area || 'Lagos'} · ${store.is_open ? 'Open for orders' : 'Closed'} · commission ${(store.commission_rate * 100).toFixed(0)}%`}
    >
      {store.status !== 'active' && (
        <div className="card" style={{ background: 'var(--warn-soft)', borderColor: '#f0dfb4', marginBottom: 16 }}>
          <div className="row" style={{ gap: 10 }}>
            <Icon name="clock" size={18} style={{ color: 'var(--warn)' }} />
            <div className="grow">
              <div className="strong">Store {store.status}</div>
              <div className="sub">An administrator must approve your store before it appears to customers.</div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Kpi label="Orders today" value={metrics.orders_today} hint={`${metrics.orders_total} lifetime`} />
        <Kpi label="Awaiting acceptance" value={metrics.pending_acceptance} hint="Accept to start preparing" tone={metrics.pending_acceptance ? 'var(--orange)' : undefined} />
        <Kpi label="GMV" value={naira(metrics.gmv)} hint={`Net ${naira(metrics.net_earnings)}`} />
        <Kpi label="Wallet" value={naira(metrics.wallet_balance)} hint="Settled earnings" />
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1.35fr) minmax(0,1fr)', gap: 16, alignItems: 'start' }}>
        <div className="col" style={{ gap: 16 }}>
          <section className="card">
            <SectionHead title="New orders" subtitle="Accept quickly — customers are notified instantly" />
            {pending_orders.length === 0 && <Empty icon="receipt" title="No new orders" block={false} />}
            <div className="col" style={{ gap: 10 }}>
              {pending_orders.map((o) => (
                <div key={o.id} className="tile">
                  <div className="row-between">
                    <div>
                      <div className="strong mono">{o.code}</div>
                      <div className="tiny muted">{timeAgo(o.created_at)} · {o.items.length} item(s)</div>
                    </div>
                    <div className="mono strong">{naira(o.total)}</div>
                  </div>
                  <div className="col" style={{ gap: 2, marginTop: 8 }}>
                    {o.items.map((i) => <div key={i.id} className="sub">{i.qty} × {i.name}</div>)}
                  </div>
                  {o.scheduled_for && !o.released_at ? (
                    <div
                      className="row"
                      style={{ gap: 8, marginTop: 10, padding: '9px 11px', borderRadius: 10, background: '#FFF8EC', border: '1px solid #F3DDB4', alignItems: 'flex-start' }}
                    >
                      <Icon name="clock" size={15} style={{ marginTop: 2, color: 'var(--orange)' }} />
                      <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>
                        <strong>Booked for {new Date(o.scheduled_for).toLocaleString('en-NG', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.</strong>{' '}
                        It appears here to accept about an hour before, so it reaches the customer hot. Nothing to do until then.
                      </div>
                    </div>
                  ) : (
                    <div className="row" style={{ gap: 8, marginTop: 10 }}>
                      <Button size="sm" className="grow" onClick={() => act(o, 'accept')} disabled={busy}>Accept order</Button>
                      <Button size="sm" variant="danger" onClick={() => setDeclining(o)} disabled={busy}>Reject</Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="card">
            <SectionHead title="In progress" action={<Button size="sm" variant="ghost" onClick={() => nav('/merchant/orders')}>All orders</Button>} />
            {active_orders.length === 0 && <Empty icon="truck" title="Nothing in progress" block={false} />}
            <div className="col" style={{ gap: 8 }}>
              {active_orders.slice(0, 6).map((o) => (
                <div key={o.id} className="row" style={{ gap: 10 }}>
                  <span className="mono strong" style={{ fontSize: 13 }}>{o.code}</span>
                  <StatusBadge status={o.status} />
                  <div className="spacer" />
                  <span className="mono sub">{naira(o.total)}</span>
                  {(o.status === 'accepted' || o.status === 'preparing') && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => act(o, 'ready')} disabled={busy}>Ready for pickup</Button>
                      <Button size="sm" variant="danger" onClick={() => setDeclining(o)} disabled={busy}>Decline</Button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="col" style={{ gap: 16 }}>
          <div className="card">
            <div className="h3" style={{ marginBottom: 10 }}>Last 7 days</div>
            <Bars data={chart} valueKey="revenue" labelKey="day" format={naira} />
            <div className="row-between" style={{ marginTop: 10 }}>
              <span className="tiny muted">Revenue per day</span>
              <span className="tiny muted">{chart.reduce((s, c) => s + c.orders, 0)} orders</span>
            </div>
          </div>

          <div className="card">
            <div className="h3" style={{ marginBottom: 10 }}>Low stock</div>
            {low_stock.length === 0 ? <div className="sub">All products are well stocked.</div> : (
              <div className="col" style={{ gap: 8 }}>
                {low_stock.map((p) => (
                  <div key={p.id} className="row-between">
                    <span className="sub" style={{ maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                    <Badge tone={p.stock === 0 ? 'badge-danger' : 'badge-warn'}>{p.stock} left</Badge>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <div className="row-between">
              <div>
                <div className="h3">Store status</div>
                <div className="sub">{store.is_open ? 'Customers can order now' : 'Your store is hidden from customers'}</div>
              </div>
              <Button
                size="sm"
                variant={store.is_open ? 'ghost' : 'primary'}
                onClick={async () => {
                  try {
                    await api.post('/api/merchant/store/toggle-open', { open: !store.is_open });
                    toast.success(store.is_open ? 'Store closed' : 'Store opened');
                    reload();
                    load();
                  } catch (e) { toast.error(e.message); }
                }}
              >
                {store.is_open ? 'Close store' : 'Open store'}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <DeclineModal order={declining} onClose={() => setDeclining(null)} onDone={load} />
    </Shell>
  );
}

/* --------------------------------- orders --------------------------------- */

function Orders() {
  const [orders, setOrders] = useState(null);
  const [filter, setFilter] = useState('');
  const toast = useToast();

  const load = () => api.get(`/api/merchant/orders${filter ? `?status=${filter}` : ''}`).then((r) => setOrders(r.orders));
  useEffect(() => { load(); }, [filter]);

  const [declining, setDeclining] = useState(null);

  const act = async (order, action) => {
    try {
      if (action === 'accept') await api.post(`/api/merchant/orders/${order.id}/accept`, {});
      if (action === 'ready') await api.post(`/api/merchant/orders/${order.id}/ready`, {});
      toast.success('Updated');
      load();
    } catch (e) { toast.error(e.message); }
  };

  return (
    <Shell nav={NAV} title="Orders" subtitle="Every order for your store, newest first">
      <div className="row wrap" style={{ gap: 8, marginBottom: 14 }}>
        {['', 'paid', 'accepted', 'preparing', 'ready_for_pickup', 'in_transit', 'delivered', 'completed', 'cancelled'].map((s) => (
          <button key={s || 'all'} className={`chip ${filter === s ? 'active' : ''}`} onClick={() => setFilter(s)}>
            {s ? pretty(s) : 'All'}
          </button>
        ))}
      </div>
      {!orders ? <Loading /> : orders.length === 0 ? <Empty icon="receipt" title="No orders in this view" /> : (
        <>
        {/* A phone cannot show seven columns: it squeezed order codes and naira
            into two characters per line. Phones get cards, desks get the table. */}
        <div className="col narrow-only" style={{ gap: 10 }}>
          {orders.map((o) => (
            <div key={o.id} className="tile">
              <div className="row-between">
                <span className="mono strong">{o.code}</span>
                <span className="mono strong">{naira(o.total)}</span>
              </div>
              <div className="tiny muted" style={{ marginTop: 2 }}>
                {o.address?.recipient || 'Customer'} · {o.address?.area || 'Lagos'} · {timeAgo(o.created_at)}
              </div>
              <div className="sub" style={{ marginTop: 6 }}>{o.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}</div>
              <div className="row-between" style={{ marginTop: 10 }}>
                <StatusBadge status={o.status} />
                <div className="row" style={{ gap: 6 }}>
                  {o.status === 'paid' && <Button size="sm" onClick={() => act(o, 'accept')}>Accept</Button>}
                  {['accepted', 'preparing'].includes(o.status) && <Button size="sm" variant="ghost" onClick={() => act(o, 'ready')}>Ready</Button>}
                  {['paid', 'accepted', 'preparing'].includes(o.status) && (
                    <Button size="sm" variant="ghost" onClick={() => setDeclining(o)}>Decline</Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="card card-flush table-wrap wide-only">
          <table className="table">
            <thead>
              <tr><th>Order</th><th>Customer</th><th>Items</th><th>Total</th><th>Status</th><th>Placed</th><th /></tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td className="mono strong">{o.code}</td>
                  <td>{o.address?.recipient || '—'}<div className="tiny muted">{o.address?.area}</div></td>
                  <td>{o.items.map((i) => `${i.qty}× ${i.name}`).join(', ').slice(0, 46)}</td>
                  <td className="mono">{naira(o.total)}</td>
                  <td><StatusBadge status={o.status} /></td>
                  <td className="tiny muted">{timeAgo(o.created_at)}</td>
                  <td>
                    <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                      {o.status === 'paid' && <Button size="sm" onClick={() => act(o, 'accept')}>Accept</Button>}
                      {['accepted', 'preparing'].includes(o.status) && <Button size="sm" variant="ghost" onClick={() => act(o, 'ready')}>Ready</Button>}
                      {['paid', 'accepted', 'preparing'].includes(o.status) && (
                        <Button size="sm" variant="ghost" onClick={() => setDeclining(o)}>Decline</Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}

      <DeclineModal order={declining} onClose={() => setDeclining(null)} onDone={load} />
    </Shell>
  );
}

/* -------------------------------- products -------------------------------- */

function Products({ me }) {
  const [data, setData] = useState(null);
  const [cats, setCats] = useState([]);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  const [form, setForm] = useState({ name: '', price: '', compare_at: '', stock: '', unit: 'each', category_id: '', description: '', image: '' });
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const load = () => api.get(`/api/merchant/products?limit=100${q ? `&q=${encodeURIComponent(q)}` : ''}`).then((r) => setData(r.products));
  useEffect(() => { load(); }, [q]);
  useEffect(() => { api.get('/api/categories').then((r) => setCats(r.categories)).catch(() => {}); }, []);

  const edit = (p) => {
    setOpen(p || { new: true });
    setForm(p ? {
      name: p.name, price: p.price, compare_at: p.compare_at || '', stock: p.stock, unit: p.unit || 'each',
      category_id: p.category_id || '', description: p.description || '', image: p.image || '',
    } : { name: '', price: '', compare_at: '', stock: '', unit: 'each', category_id: '', description: '', image: '' });
  };

  const save = async () => {
    setBusy(true);
    try {
      const payload = {
        ...form,
        price: Number(form.price),
        compare_at: form.compare_at ? Number(form.compare_at) : null,
        stock: Number(form.stock || 0),
        category_id: form.category_id || null,
      };
      if (open.new) await api.post('/api/merchant/products', payload);
      else await api.patch(`/api/merchant/products/${open.id}`, payload);
      toast.success('Product saved');
      setOpen(null);
      load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const toggle = async (p) => {
    await api.patch(`/api/merchant/products/${p.id}`, { status: p.status === 'active' ? 'inactive' : 'active' });
    load();
  };

  return (
    <Shell nav={NAV} title="Products" subtitle={`${data?.length ?? 0} products in ${me.store?.name}`}>
      <div className="row wrap" style={{ gap: 10, marginBottom: 16 }}>
        <Input value={q} onChange={(e) => setQ(q => e.target.value)} placeholder="Search products…" style={{ maxWidth: 280 }} />
        <div className="spacer" />
        <Button onClick={() => edit(null)}><Icon name="plus" size={15} /> Add product</Button>
      </div>

      {!data ? <Loading /> : data.length === 0 ? <Empty icon="box" title="No products yet" body="Add your first product so customers can order it." action={<Button onClick={() => edit(null)}>Add product</Button>} /> : (
        <div className="card card-flush table-wrap">
          <table className="table">
            <thead><tr><th>Product</th><th>Category</th><th>Price</th><th>Stock</th><th>Status</th><th /></tr></thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div className="row" style={{ gap: 10 }}>
                      <img src={assetUrl(p.image)} alt="" style={{ width: 36, height: 36, borderRadius: 9, objectFit: 'cover' }} />
                      <span className="strong" style={{ fontSize: 13 }}>{p.name}</span>
                    </div>
                  </td>
                  <td className="sub">{cats.find((c) => c.id === p.category_id)?.name || '—'}</td>
                  <td className="mono">{naira(p.price)}</td>
                  <td><Badge tone={p.stock === 0 ? 'badge-danger' : p.stock < 6 ? 'badge-warn' : 'badge-ok'}>{p.stock}</Badge></td>
                  <td><Badge tone={p.status === 'active' ? 'badge-ok' : ''}>{p.status}</Badge></td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      <Button size="sm" variant="ghost" onClick={() => edit(p)}>Edit</Button>
                      <Button size="sm" variant="ghost" onClick={() => toggle(p)}>{p.status === 'active' ? 'Disable' : 'Enable'}</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.new ? 'Add product' : 'Edit product'}
        footer={<Button block onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save product'}</Button>}>
        <div className="col" style={{ gap: 12 }}>
          <Field label="Product name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <div className="row" style={{ gap: 10 }}>
            <Field label="Price (₦)"><Input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></Field>
            <Field label="Compare at (₦)"><Input type="number" value={form.compare_at} onChange={(e) => setForm({ ...form, compare_at: e.target.value })} /></Field>
            <Field label="Stock"><Input type="number" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} /></Field>
          </div>
          <Field label="Category">
            <Select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
              <option value="">Uncategorised</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Description"><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <PhotoPicker
            label="Product photo"
            value={form.image}
            onChange={(url) => setForm((f) => ({ ...f, image: url }))}
            onError={(m) => toast.error(m)}
            hint="Take a photo of the item with your camera, or pick one from your gallery."
          />
          {(!form.image || /^https?:/i.test(form.image)) && (
            <Field label="Or paste an image link" hint="Only if the photo already lives on the internet.">
              <Input value={form.image} onChange={(e) => setForm({ ...form, image: e.target.value })} placeholder="https://…" />
            </Field>
          )}
        </div>
      </Modal>
    </Shell>
  );
}

/* ------------------------------- settlements ------------------------------ */

function Settlements() {
  const [data, setData] = useState(null);
  useEffect(() => { api.get('/api/merchant/settlements').then(setData).catch(() => setData(null)); }, []);
  if (!data) return <Loading block />;
  return (
    <Shell nav={NAV} title="Settlements" subtitle="What BUYBUDDY owes you, order by order">
      <div className="grid grid-3" style={{ marginBottom: 16 }}>
        <Kpi label="Wallet balance" value={naira(data.balance)} hint="Available for payout" />
        <Kpi label="Orders settled" value={data.settlements.length} />
        <Kpi label="Gross settled" value={naira(data.settlements.reduce((s, x) => s + x.gross, 0))} />
      </div>
      <div className="card card-flush table-wrap" style={{ marginBottom: 16 }}>
        <table className="table">
          <thead><tr><th>Order</th><th>Date</th><th>Gross</th><th>Commission</th><th>Net</th></tr></thead>
          <tbody>
            {data.settlements.map((s) => (
              <tr key={s.code}>
                <td className="mono strong">{s.code}</td>
                <td className="sub">{timeAgo(s.date)}</td>
                <td className="mono">{naira(s.gross)}</td>
                <td className="mono sub">− {naira(s.commission)}</td>
                <td className="mono strong">{naira(s.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card card-flush">
        <div style={{ padding: 14 }} className="h3">Wallet activity</div>
        {data.entries.map((e) => (
          <div key={e.id} className="row" style={{ gap: 10, padding: '12px 14px', borderTop: '1px solid var(--line)' }}>
            <div className="grow">
              <div className="strong" style={{ fontSize: 13 }}>{e.description}</div>
              <div className="tiny muted">{timeAgo(e.created_at)}</div>
            </div>
            <span className="mono strong" style={{ color: e.type === 'credit' ? 'var(--ok)' : 'var(--danger)' }}>
              {e.type === 'credit' ? '+' : '−'}{naira(e.amount)}
            </span>
          </div>
        ))}
      </div>
    </Shell>
  );
}

/* --------------------------------- settings -------------------------------- */

function StoreSettings({ me, reload }) {
  const [form, setForm] = useState(me.store || {});
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const save = async () => {
    setBusy(true);
    try {
      await api.patch('/api/merchant/store', {
        name: form.name, description: form.description, area: form.area, city: form.city,
        phone: form.phone, opens_at: form.opens_at, closes_at: form.closes_at,
        prep_minutes: Number(form.prep_minutes), min_order: Number(form.min_order),
        logo: form.logo || null, cover: form.cover || null,
      });
      toast.success('Store updated');
      reload();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <Shell nav={NAV} title="Store settings" subtitle={me.profile?.business_name || 'Merchant profile'}>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,320px)', gap: 16, alignItems: 'start' }}>
        <div className="card col" style={{ gap: 12 }}>
          <Field label="Store name"><Input value={form.name || ''} onChange={set('name')} /></Field>
          <Field label="Description"><Textarea value={form.description || ''} onChange={set('description')} /></Field>
          <div className="row" style={{ gap: 10 }}>
            <Field label="Area"><Input value={form.area || ''} onChange={set('area')} /></Field>
            <Field label="City"><Input value={form.city || ''} onChange={set('city')} /></Field>
          </div>
          <div className="row" style={{ gap: 10 }}>
            <Field label="Opens"><Input value={form.opens_at || ''} onChange={set('opens_at')} placeholder="08:00" /></Field>
            <Field label="Closes"><Input value={form.closes_at || ''} onChange={set('closes_at')} placeholder="21:00" /></Field>
            <Field label="Prep (min)"><Input type="number" value={form.prep_minutes || ''} onChange={set('prep_minutes')} /></Field>
          </div>
          <Field label="Minimum order (₦)"><Input type="number" value={form.min_order || ''} onChange={set('min_order')} /></Field>

          <div className="row wrap" style={{ gap: 16 }}>
            <PhotoPicker
              label="Store logo"
              value={form.logo || ''}
              onChange={(url) => setForm((f) => ({ ...f, logo: url }))}
              onError={(m) => toast.error(m)}
              size={104}
              hint="A square photo or your signboard works well."
              doneHint="This is the little badge customers see next to your shop name."
            />
            <PhotoPicker
              label="Storefront photo"
              value={form.cover || ''}
              onChange={(url) => setForm((f) => ({ ...f, cover: url }))}
              onError={(m) => toast.error(m)}
              size={168}
              aspect="16 / 9"
              hint="Shown as a wide banner at the top of your shop page."
              doneHint="This banner sits at the top of your shop page."
            />
          </div>

          <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</Button>
        </div>
        <div className="card">
          <div className="h3" style={{ marginBottom: 10 }}>Business details</div>
          <div className="col" style={{ gap: 8 }}>
            <Row k="Business name" v={me.profile?.business_name} />
            <Row k="CAC number" v={me.profile?.cac_number || '—'} />
            <Row k="Verification" v={me.profile?.verified ? 'Verified' : 'Pending'} />
            <Row k="Commission" v={`${(me.store?.commission_rate * 100).toFixed(0)}%`} />
            <Row k="Rating" v={`${me.store?.rating_avg?.toFixed(1)} (${me.store?.rating_count})`} />
            <Row k="Status" v={me.store?.status} />
          </div>
        </div>
      </div>
    </Shell>
  );
}

const Row = ({ k, v }) => (
  <div className="row-between">
    <span className="sub">{k}</span>
    <span className="strong" style={{ fontSize: 13 }}>{v}</span>
  </div>
);
