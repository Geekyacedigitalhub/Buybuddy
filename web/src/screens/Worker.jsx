import React, { useEffect, useState } from 'react';
import { Link, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { api, naira, pretty, timeAgo, fmtAddress, toDataUrl, assetUrl } from '../lib/api.js';
import { Badge, Button, Empty, Field, Icon, Input, LoadFailed, Loading, Modal, SectionHead, StatusBadge, Textarea, useAuth, useAutoRetry, useToast } from '../lib/ui.jsx';
import LiveLocation from '../components/LiveLocation.jsx';
import PhotoPicker from '../components/PhotoPicker.jsx';

export default function WorkerApp() {
  return (
    <Routes>
      <Route index element={<WorkerDashboard />} />
      <Route path="task/:id" element={<TaskDetail />} />
      <Route path="earnings" element={<Earnings />} />
      <Route path="account" element={<WorkerAccount />} />
      <Route path="*" element={<WorkerDashboard />} />
    </Routes>
  );
}

/* ------------------------------- dashboard -------------------------------- */

function WorkerDashboard() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const nav = useNavigate();
  const { user, refresh } = useAuth();

  const [error, setError] = useState(null);
  const load = () => {
    setError(null);
    return api.get('/api/worker/dashboard').then(setData).catch(setError);
  };
  useEffect(() => { load(); }, []);
  useAutoRetry(load, Boolean(error));

  if (!data && error) return <LoadFailed what="your jobs" error={error} onRetry={load} />;
  if (!data) return <Loading />;
  const { profile, offers, active, completed, earnings, role } = data;
  const online = profile?.available;

  const toggle = async () => {
    setBusy(true);
    try {
      await api.post('/api/worker/availability', { available: !online });
      toast.success(!online ? 'You are online — jobs will come in' : 'You are offline');
      load();
      refresh();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const respond = async (offer, accept) => {
    setBusy(true);
    try {
      await api.post(`/api/worker/jobs/${offer.id}/${accept ? 'accept' : 'decline'}`, { role });
      toast.success(accept ? 'Job accepted — open it to begin' : 'Job declined');
      load();
      if (accept) nav(`/worker/task/${offer.id}`);
    } catch (e) { toast.error(e.message); load(); } finally { setBusy(false); }
  };

  const notVerified = profile && !profile.verified;

  return (
    <div className="page col" style={{ gap: 16, maxWidth: 760 }}>
      {notVerified && (
        <div className="card" style={{ background: 'var(--warn-soft)', borderColor: '#f0dfb4' }}>
          <div className="row" style={{ gap: 10 }}>
            <Icon name="clock" size={18} style={{ color: 'var(--warn)' }} />
            <div className="grow">
              <div className="strong">Verification in progress</div>
              <div className="sub">An admin is reviewing your documents. You can accept jobs once approved.</div>
            </div>
          </div>
        </div>
      )}

      <div className="card" style={{ background: online ? 'linear-gradient(135deg,var(--green-700),var(--green-900))' : '#fff', color: online ? '#fff' : 'inherit', border: 'none' }}>
        <div className="row-between">
          <div>
            <div className="tiny" style={{ opacity: 0.7, letterSpacing: '0.08em', fontWeight: 700 }}>{online ? 'ONLINE' : 'OFFLINE'}</div>
            <div className="h2" style={{ marginTop: 2 }}>Hey {user.name.split(' ')[0]} 👋</div>
            <div style={{ opacity: 0.8, fontSize: 13, marginTop: 2 }}>
              {role === 'rider' ? 'Delivery rider' : 'Personal shopper'} · {profile?.rating_avg ? `${profile.rating_avg.toFixed(1)}★` : 'New'}
            </div>
          </div>
          <Button variant={online ? 'ghost' : 'primary'} onClick={toggle} disabled={busy || notVerified}
            className={online ? '' : ''} style={online ? { background: 'rgba(255,255,255,0.18)', color: '#fff', border: 'none' } : {}}>
            {online ? 'Go offline' : 'Go online'}
          </Button>
        </div>
        <div className="row" style={{ gap: 18, marginTop: 16 }}>
          <Stat label="Wallet" value={naira(earnings.wallet_balance)} light={online} />
          <Stat label="Today" value={naira(earnings.today)} light={online} />
          <Stat label="Jobs done" value={earnings.jobs_completed} light={online} />
        </div>
      </div>

      <section>
        <SectionHead title={`Job offers (${offers.length})`} subtitle="Accept fast — offers go to several buddies at once" />
        {offers.length === 0
          ? <Empty icon="bike" title="No offers right now" body={online ? 'Stay online — new requests appear here automatically.' : 'Go online to receive jobs.'} />
          : (
            <div className="col" style={{ gap: 10 }}>
              {offers.map((o) => (
                <div key={o.offer_id} className="card">
                  <div className="row-between">
                    <div className="row" style={{ gap: 8 }}>
                      <Badge tone={o.type === 'personal' ? 'badge-orange' : 'badge-green'}>
                        {o.type === 'personal' ? 'Shop for me' : 'Delivery'}
                      </Badge>
                      <span className="mono tiny muted">{o.code}</span>
                    </div>
                    <span className="mono strong">{naira(role === 'rider' ? o.delivery_fee : o.service_fee)}</span>
                  </div>
                  <div className="sub" style={{ marginTop: 8 }}>
                    <Icon name="pin" size={12} style={{ verticalAlign: -1 }} /> {fmtAddress(o.address)}
                  </div>
                  {o.type === 'personal' && (
                    <div className="tiny muted" style={{ marginTop: 4 }}>
                      {o.item_count} item(s) · budget {naira(o.budget)}
                    </div>
                  )}
                  <div className="row" style={{ gap: 8, marginTop: 12 }}>
                    <Button size="sm" className="grow" onClick={() => respond(o, true)} disabled={busy}>
                      Accept job
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => respond(o, false)} disabled={busy}>Decline</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
      </section>

      <section>
        <SectionHead title={`Active (${active.length})`} />
        {active.length === 0
          ? <Empty icon="box" title="Nothing active" body="Accepted jobs will appear here." />
          : (
            <div className="col" style={{ gap: 10 }}>
              {active.map((o) => (
                <Link key={o.id} to={`/worker/task/${o.id}`} className="card">
                  <div className="row-between">
                    <div>
                      <div className="strong" style={{ fontSize: 13.5 }}>{o.type === 'personal' ? 'Personal shopping' : o.store?.name || 'Delivery'}</div>
                      <div className="tiny muted mono">{o.code} · {timeAgo(o.created_at)}</div>
                    </div>
                    <StatusBadge status={o.status} />
                  </div>
                  <div className="sub" style={{ marginTop: 6 }}>{fmtAddress(o.address)}</div>
                  <div className="row-between" style={{ marginTop: 8 }}>
                    <span className="tiny muted">{o.shopping_items?.length || o.items?.length || 0} item(s)</span>
                    <span className="mono strong" style={{ fontSize: 13 }}>{naira(o.total)}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
      </section>

      {completed.length > 0 && (
        <section>
          <SectionHead title="Recently completed" />
          <div className="col" style={{ gap: 8 }}>
            {completed.slice(0, 4).map((o) => (
              <div key={o.id} className="card row" style={{ gap: 10 }}>
                <Icon name="check" size={16} style={{ color: 'var(--ok)' }} />
                <div className="grow">
                  <div className="strong" style={{ fontSize: 13 }}>{o.code} · {o.store?.name || 'Personal shopping'}</div>
                  <div className="tiny muted">{timeAgo(o.created_at)}</div>
                </div>
                <span className="mono strong" style={{ fontSize: 13 }}>{naira(o.delivery_fee)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

const Stat = ({ label, value, light }) => (
  <div>
    <div className="tiny" style={{ opacity: 0.7, letterSpacing: '0.06em', fontWeight: 700 }}>{label.toUpperCase()}</div>
    <div className="mono" style={{ fontWeight: 750, fontSize: 16, color: light ? '#fff' : 'var(--ink)' }}>{value}</div>
  </div>
);

/* -------------------------------- task ----------------------------------- */

function TaskDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pin, setPin] = useState('');
  const [chat, setChat] = useState('');
  const [open, setOpen] = useState(null);
  const [form, setForm] = useState({ proposed_name: '', proposed_price: '', proposed_qty: 1, note: '' });
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receipt, setReceipt] = useState({ data_url: null, amount: '', note: '' });
  // the photo taken at handover — must be declared before the early return below,
  // or React sees a different number of hooks between renders and blanks the app
  const [pickupPhoto, setPickupPhoto] = useState(null);
  const toast = useToast();
  const nav = useNavigate();
  const { user } = useAuth();

  const [error, setError] = useState(null);
  const load = () => {
    setError(null);
    return api.get(`/api/worker/jobs/${id}`).then(setData).catch(setError);
  };
  useEffect(() => { load(); }, [id]);
  useAutoRetry(load, Boolean(error));

  if (!data && error) return <LoadFailed what="this job" error={error} onRetry={load} />;
  if (!data) return <Loading />;
  const { order } = data;
  const isShopper = order.shopper_id === user.id;
  const isRider = order.rider_id === user.id;

  const act = async (fn, label) => {
    setBusy(true);
    try {
      await fn();
      await load();
      if (label) toast.success(label);
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const openItem = (item) => {
    setOpen(item);
    setForm({
      proposed_name: item.proposed_name || item.description,
      proposed_price: item.proposed_price || item.target_price || '',
      proposed_qty: item.proposed_qty || item.qty,
      note: item.note || '',
    });
  };

  const saveItem = () => act(async () => {
    await api.patch(`/api/worker/jobs/${order.id}/items/${open.id}`, {
      proposed_name: form.proposed_name,
      proposed_price: Number(form.proposed_price) || undefined,
      proposed_qty: Number(form.proposed_qty) || 1,
      note: form.note,
      status: 'proposed',
    });
    setOpen(null);
  }, 'Item recorded');

  const markUnavailable = (item) => act(
    () => api.patch(`/api/worker/jobs/${order.id}/items/${item.id}`, { status: 'unavailable', note: 'Not available at the store' }),
    'Marked unavailable'
  );

  const uploadReceipt = async (file) => {
    try {
      const dataUrl = await toDataUrl(file);
      setReceipt((r) => ({ ...r, data_url: dataUrl }));
    } catch (e) { toast.error(e.message); }
  };

  const sendReceipt = () => act(async () => {
    await api.post(`/api/worker/jobs/${order.id}/receipts`, {
      data_url: receipt.data_url, amount: receipt.amount ? Number(receipt.amount) : undefined, note: receipt.note || 'Store receipt',
    });
    setReceiptOpen(false);
    setReceipt({ data_url: null, amount: '', note: '' });
  }, 'Receipt uploaded');

  const sendChat = async (e) => {
    e.preventDefault();
    if (!chat.trim()) return;
    await api.post(`/api/orders/${order.id}/messages`, { body: chat });
    setChat('');
    load();
  };

  const steps = isShopper
    ? [
      { when: ['shopper_assigned'], label: 'Start shopping', fn: () => api.post(`/api/worker/jobs/${order.id}/start-shopping`, {}) },
      { when: ['shopping'], label: 'Submit basket for approval', fn: () => api.post(`/api/worker/jobs/${order.id}/submit-for-approval`, {}) },
      { when: ['approved'], label: 'Mark as purchased', photo: true, fn: () => api.post(`/api/worker/jobs/${order.id}/purchased`, { photo: pickupPhoto || undefined }) },
    ]
    : [
      { when: ['rider_assigned', 'ready_for_pickup'], label: 'Confirm pickup', photo: true, fn: () => api.post(`/api/worker/jobs/${order.id}/pickup`, { photo: pickupPhoto || undefined, note: pickupPhoto ? undefined : 'Order picked up — no photo taken' }) },
      { when: ['picked_up'], label: 'Start delivery (in transit)', fn: () => api.post(`/api/worker/jobs/${order.id}/in-transit`, {}) },
    ];
  const step = steps.find((s) => s.when.includes(order.status));

  const deliver = () => act(
    () => api.post(`/api/worker/jobs/${order.id}/deliver`, { pin, photo: receipt.data_url || undefined }),
    'Delivered! 🎉'
  );

  return (
    <div className="page col" style={{ gap: 14, maxWidth: 760 }}>
      <div className="row">
        <button className="btn btn-ghost btn-icon" onClick={() => nav('/worker')}><Icon name="left" /></button>
        <div className="grow">
          <div className="h2">{order.type === 'personal' ? 'Shopping task' : 'Delivery'}</div>
          <div className="sub mono">{order.code}</div>
        </div>
        <StatusBadge status={order.status} />
      </div>

      <div className="card" style={{ background: 'var(--green-50)', borderColor: 'var(--green-100)' }}>
        <div className="row-between">
          <div>
            <div className="label">YOU WILL EARN</div>
            <div className="h2 mono">{naira(isShopper ? Math.round(order.service_fee * 0.8) : order.delivery_fee)}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="label">ORDER VALUE</div>
            <div className="strong mono">{naira(order.total)}</div>
            <Badge tone={order.payment_status === 'paid' ? 'badge-ok' : 'badge-warn'}>{order.payment_status}</Badge>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="label">DELIVER TO</div>
        <div className="strong" style={{ marginTop: 3 }}>{order.address?.recipient || 'Customer'}</div>
        <div className="sub">{fmtAddress(order.address)}</div>
        {order.address?.notes && <div className="tiny muted">Note: {order.address.notes}</div>}
        <div className="row" style={{ gap: 8, marginTop: 10 }}>
          <a className="btn btn-ghost btn-sm" href={`tel:${order.address?.phone || ''}`}><Icon name="phone" size={14} /> Call</a>
          <Button size="sm" variant="ghost" onClick={() => document.getElementById('task-chat')?.scrollIntoView({ behavior: 'smooth' })}>
            <Icon name="chat" size={14} /> Message
          </Button>
        </div>
      </div>

      {order.instructions && (
        <div className="card" style={{ borderLeft: '3px solid var(--orange)' }}>
          <div className="label">CUSTOMER INSTRUCTIONS</div>
          <div className="sub" style={{ marginTop: 4 }}>{order.instructions}</div>
        </div>
      )}

      {isShopper && (
        <section>
          <SectionHead title="Shopping list" subtitle="Record the price you found. Prices above the customer's expectation need their approval." />
          <div className="col" style={{ gap: 10 }}>
            {(order.shopping_items || []).map((it) => (
              <div key={it.id} className="card">
                <div className="row-between">
                  <div className="grow">
                    <div className="strong" style={{ fontSize: 13.5 }}>{it.description} × {it.qty}</div>
                    <div className="sub">
                      {it.target_price ? `Expected ${naira(it.target_price)}` : 'No expected price'}
                      {it.proposed_price ? ` · Found ${naira(it.proposed_price)}` : ''}
                    </div>
                    {it.note && <div className="tiny" style={{ color: 'var(--orange-ink)' }}>{it.note}</div>}
                  </div>
                  <StatusBadge status={it.status} />
                </div>
                {['requested', 'proposed', 'unavailable'].includes(it.status) && (
                  <div className="row" style={{ gap: 8, marginTop: 10 }}>
                    <Button size="sm" variant="ghost" onClick={() => openItem(it)} className="grow">
                      {it.status === 'requested' ? 'Record price' : 'Edit'}
                    </Button>
                    {it.status === 'requested' && (
                      <Button size="sm" variant="danger" onClick={() => markUnavailable(it)}>Not found</Button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {isRider && ['rider_assigned', 'picked_up', 'in_transit'].includes(order.status) && (
        <LiveLocation orderId={order.id} status={order.status} />
      )}

      {step?.photo && (
        <div className="card col" style={{ gap: 10, borderColor: 'var(--green-200)' }}>
          <div className="h3">Photo of the bag</div>
          <div className="sub">
            {isShopper
              ? 'Photograph the sealed bags at the counter before you leave the shop. It is proof of exactly what was bought, if the customer or the rider questions the order.'
              : "One picture now is your proof — and the customer's — of exactly what you collected. If anyone says something was missing or wrong, this photo settles it in seconds."}
          </div>
          <PhotoPicker
            value={pickupPhoto}
            onChange={setPickupPhoto}
            label={isShopper ? 'Bags at the counter' : 'Handover photo'}
            hint="Point the camera at the sealed bags — one clear photo is enough."
            size={96}
            onError={(m) => toast.error(m)}
          />
        </div>
      )}

      <div className="card col" style={{ gap: 10 }}>
        <div className="h3">Progress</div>
        {step && <Button block size="lg" onClick={() => act(step.fn, 'Updated')} disabled={busy}>{step.label}</Button>}

        {order.status === 'awaiting_approval' && (
          <div className="sub">Waiting for the customer to approve the basket. You can still edit items.</div>
        )}
        {order.status === 'approved' && isShopper && (
          <Button block variant="ghost" onClick={() => setReceiptOpen(true)}><Icon name="receipt" size={15} /> Upload store receipt</Button>
        )}
        {order.status === 'ready_for_delivery' && (
          <div className="sub">Ready for pickup — a rider has been offered this job. You can also deliver it yourself.</div>
        )}

        {isRider && order.status === 'in_transit' && (
          <div className="col" style={{ gap: 8 }}>
            <Field label="Delivery PIN from the customer">
              <Input value={pin} onChange={(e) => setPin(e.target.value)} placeholder="4-digit PIN" inputMode="numeric" maxLength={4} />
            </Field>
            <Button block onClick={deliver} disabled={busy || pin.length < 4}>Confirm delivery</Button>
            <Button block variant="ghost" size="sm" onClick={() => setReceiptOpen(true)}>Attach delivery photo (optional)</Button>
          </div>
        )}

        {order.status === 'delivered' && (
          <div className="tile" style={{ background: 'var(--ok-soft)', border: 'none' }}>
            <div className="strong">Delivered ✅</div>
            <div className="sub">Waiting for the customer to confirm. Your earnings are released on completion.</div>
          </div>
        )}
      </div>

      <div id="task-chat" className="card">
        <div className="h3" style={{ marginBottom: 8 }}>Messages</div>
        <div className="col" style={{ gap: 6, maxHeight: 220, overflowY: 'auto' }}>
          {(order.timeline || []).length === 0 && <div className="sub">No messages yet.</div>}
          <MessagesInline orderId={order.id} userId={user.id} />
        </div>
        <form onSubmit={sendChat} className="row" style={{ gap: 8, marginTop: 10 }}>
          <Input value={chat} onChange={(e) => setChat(e.target.value)} placeholder="Message the customer…" />
          <Button type="submit" size="sm">Send</Button>
        </form>
      </div>

      <Modal open={!!open} onClose={() => setOpen(null)} title="Record item"
        footer={<Button block onClick={saveItem} disabled={busy}>Save item</Button>}>
        <div className="col" style={{ gap: 12 }}>
          <div className="sub">{open?.description} — requested × {open?.qty}</div>
          <Field label="What you found"><Input value={form.proposed_name} onChange={(e) => setForm({ ...form, proposed_name: e.target.value })} /></Field>
          <div className="row" style={{ gap: 10 }}>
            <Field label="Price (₦)"><Input type="number" value={form.proposed_price} onChange={(e) => setForm({ ...form, proposed_price: e.target.value })} /></Field>
            <Field label="Qty"><Input type="number" value={form.proposed_qty} onChange={(e) => setForm({ ...form, proposed_qty: e.target.value })} /></Field>
          </div>
          <Field label="Note to customer (optional)"><Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Only the larger pack was available" /></Field>
        </div>
      </Modal>

      <Modal open={receiptOpen} onClose={() => setReceiptOpen(false)} title="Upload proof"
        footer={<Button block onClick={sendReceipt} disabled={!receipt.data_url}>Upload</Button>}>
        <div className="col" style={{ gap: 12 }}>
          <label className="tile center" style={{ cursor: 'pointer', padding: 24 }}>
            <Icon name="camera" size={22} />
            <div className="sub" style={{ marginTop: 6 }}>{receipt.data_url ? 'Photo selected — tap to change' : 'Tap to photograph the receipt'}</div>
            <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => e.target.files[0] && uploadReceipt(e.target.files[0])} />
          </label>
          {receipt.data_url && <img src={assetUrl(receipt.data_url)} alt="receipt" style={{ borderRadius: 12, maxHeight: 200, objectFit: 'contain' }} />}
          <Field label="Amount on receipt (₦)"><Input type="number" value={receipt.amount} onChange={(e) => setReceipt({ ...receipt, amount: e.target.value })} /></Field>
          <Field label="Note"><Input value={receipt.note} onChange={(e) => setReceipt({ ...receipt, note: e.target.value })} placeholder="Store receipt" /></Field>
        </div>
      </Modal>
    </div>
  );
}

function MessagesInline({ orderId, userId }) {
  const [messages, setMessages] = useState([]);
  useEffect(() => {
    api.get(`/api/orders/${orderId}/messages`).then((r) => setMessages(r.messages)).catch(() => {});
  }, [orderId]);
  if (!messages.length) return <div className="sub">No messages yet — say hello.</div>;
  return messages.map((m) => (
    <div key={m.id} style={{ alignSelf: m.sender_id === userId ? 'flex-end' : 'flex-start', background: m.sender_id === userId ? 'var(--green-700)' : '#f1f4f1', color: m.sender_id === userId ? '#fff' : 'inherit', padding: '8px 11px', borderRadius: 11, fontSize: 13 }}>
      {m.body}
    </div>
  ));
}

/* -------------------------------- earnings -------------------------------- */

function Earnings() {
  const [data, setData] = useState(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const load = () => api.get('/api/worker/earnings').then(setData).catch(() => setData(false));
  useEffect(() => { load(); }, []);

  if (data === null) return <Loading />;
  if (data === false) return <Empty icon="wallet" title="Could not load your earnings" body="Check your connection and open this screen again." />;

  const withdraw = async () => {
    setBusy(true);
    try {
      await api.post('/api/worker/payouts', { amount: Number(amount) });
      toast.success('Withdrawal requested — we will pay it to your bank');
      setAmount('');
      load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  // what can actually leave the wallet: earnings minus the cash still in hand
  const withdrawable = data.withdrawable ?? data.balance;
  const skeleton = Number(amount);
  const withdrawEnabled = !data.open_payout && skeleton >= 1000 && skeleton <= withdrawable;

  return (
    <div className="page col" style={{ gap: 16, maxWidth: 760 }}>
      <SectionHead title="Earnings" subtitle="Every job that paid you, and every naira that left" />

      <div className="card" style={{ background: 'linear-gradient(135deg,var(--green-700),var(--green-900))', color: '#fff', border: 'none' }}>
        <div className="tiny" style={{ opacity: 0.7, fontWeight: 700, letterSpacing: '0.08em' }}>AVAILABLE TO WITHDRAW</div>
        <div className="h1 mono" style={{ marginTop: 4 }}>{naira(withdrawable)}</div>
        {data.cash?.outstanding > 0 && (
          <div className="tiny" style={{ opacity: 0.75, marginTop: 2 }}>
            ₦{data.cash.outstanding.toLocaleString()} of your {naira(data.balance)} is cash in hand — see below
          </div>
        )}
        <div className="row wrap" style={{ gap: 22, marginTop: 14 }}>
          <Stat label="Today" value={naira(data.summary.today)} light />
          <Stat label="This week" value={naira(data.summary.week)} light />
          <Stat label="This month" value={naira(data.summary.month)} light />
          <Stat label="Lifetime" value={naira(data.summary.lifetime)} light />
        </div>
      </div>

      {data.cash?.outstanding > 0 && (
        <div className="card col" style={{ gap: 10, borderColor: '#f0dfb4', background: '#FFFBF2' }}>
          <div className="row-between">
            <div className="h3">Cash in hand</div>
            <span className="mono strong" style={{ color: 'var(--orange-ink)' }}>{naira(data.cash.outstanding)}</span>
          </div>
          <p className="tiny muted" style={{ margin: 0 }}>
            You collected this in cash on delivery orders. Your delivery fee is already yours — hand the rest
            to BUYBUDDY when the office asks, and this clears. Withdrawals wait until cash in hand is clear.
          </p>
          <div className="col" style={{ gap: 6 }}>
            {data.cash.records.filter((r) => r.status === 'open').map((r) => (
              <div key={r.id} className="row-between" style={{ fontSize: 13 }}>
                <span className="mono sub">{r.code}</span>
                <span className="mono strong">{naira(r.outstanding)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card col" style={{ gap: 10 }}>
        <div className="row-between">
          <div className="h3">Withdraw to bank</div>
          {data.summary.withdrawn > 0 && <Badge tone="badge-ok">{naira(data.summary.withdrawn)} paid out so far</Badge>}
        </div>

        {data.open_payout ? (
          <div className="card" style={{ background: 'var(--green-50)', boxShadow: 'none' }}>
            <div className="strong">Withdrawal of {naira(data.open_payout.amount)} is {data.open_payout.status}</div>
            <div className="sub" style={{ marginTop: 4 }}>
              Requested {timeAgo(data.open_payout.requested_at)}. It goes to your saved bank account once BUYBUDDY
              finance pays it. You can request the next one after this is paid.
            </div>
          </div>
        ) : (
          <>
            <div className="row" style={{ gap: 8 }}>
              <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount (₦)" />
              <Button onClick={withdraw} disabled={busy || !withdrawEnabled}>{busy ? 'Sending…' : 'Request'}</Button>
            </div>
            <div className="row wrap" style={{ gap: 8 }}>
              <Button size="sm" variant="ghost" onClick={() => setAmount(String(withdrawable))} disabled={withdrawable < 1000}>
                All {naira(withdrawable)}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAmount('5000')} disabled={withdrawable < 5000}>₦5,000</Button>
            </div>
            <p className="tiny muted" style={{ margin: 0 }}>
              Minimum ₦1,000. The money leaves your balance the moment you ask, so it cannot be requested twice —
              finance reviews it and pays it into the account on your profile.
            </p>
            {amount && Number(amount) > withdrawable && (
              <div className="tiny" style={{ color: 'var(--danger)' }}>
                You can withdraw up to {naira(withdrawable)} right now.
              </div>
            )}
            {withdrawable < 1000 && (
              <div className="tiny muted">Finish a job and your share lands here — the moment it passes ₦1,000 you can withdraw.</div>
            )}
          </>
        )}

        {data.payouts.length > 0 && (
          <div className="col" style={{ gap: 6, marginTop: 4 }}>
            {data.payouts.map((p) => (
              <div key={p.id} className="row-between" style={{ fontSize: 13 }}>
                <span className="sub">{timeAgo(p.requested_at)}</span>
                <span className="mono">{naira(p.amount)}</span>
                <StatusBadge status={p.status} />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card card-flush">
        <div style={{ padding: 14 }} className="row-between">
          <span className="h3">Ledger</span>
          {data.summary.jobs > 0 && <span className="tiny muted">{data.summary.jobs} jobs paid</span>}
        </div>
        {data.entries.length === 0 && <Empty icon="wallet" title="No earnings yet" block={false} />}
        {data.entries.map((e) => (
          <div key={e.id} className="row" style={{ gap: 10, padding: '12px 14px', borderTop: '1px solid var(--line)', alignItems: 'flex-start' }}>
            <div className="grow">
              <div className="strong" style={{ fontSize: 13 }}>{e.description}</div>
              <div className="tiny muted">
                {e.created_at ? timeAgo(e.created_at) : ''}
                {e.balance_after != null ? ` · balance ${naira(e.balance_after)}` : ''}
              </div>
            </div>
            <span className="mono strong" style={{ fontSize: 13, color: e.type === 'credit' ? 'var(--ok)' : 'var(--danger)' }}>
              {e.type === 'credit' ? '+' : '−'}{naira(e.amount)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------- account -------------------------------- */

function WorkerAccount() {
  const { user, logout, refresh } = useAuth();
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    api.get('/api/worker/profile').then((r) => {
      setProfile(r.profile);
      setForm({
        vehicle: r.profile.vehicle || '', plate: r.profile.plate || '',
        service_city: r.profile.service_city || 'Lagos', service_areas: r.profile.service_areas || '',
        bank_name: r.profile.bank_name || '', account_name: r.profile.account_name || '', account_number: r.profile.account_number || '',
      });
    }).catch(() => {});
  }, []);

  if (!profile) return <Loading />;

  const save = async () => {
    setBusy(true);
    try {
      await api.patch('/api/worker/profile', form);
      toast.success('Profile saved');
      refresh();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="page col" style={{ gap: 14, maxWidth: 760 }}>
      <SectionHead title="Account" />
      <div className="card row" style={{ gap: 12 }}>
        <div style={{ width: 50, height: 50, borderRadius: 15, background: 'var(--green-100)', display: 'grid', placeItems: 'center', fontWeight: 800, color: 'var(--green-800)' }}>
          {user.name.split(' ').map((n) => n[0]).slice(0, 2).join('')}
        </div>
        <div className="grow">
          <div className="strong">{user.name}</div>
          <div className="sub">{user.phone} · {user.email}</div>
        </div>
        <Badge tone={profile.verified ? 'badge-ok' : 'badge-warn'}>{profile.verified ? 'Verified' : 'Pending'}</Badge>
      </div>

      <div className="card col" style={{ gap: 12 }}>
        <div className="h3">Service details</div>
        <Field label="Role"><Input value={(profile.roles || '').split(',').map(pretty).join(' & ')} disabled /></Field>
        <div className="row" style={{ gap: 10 }}>
          <Field label="Vehicle"><Input value={form.vehicle} onChange={(e) => setForm({ ...form, vehicle: e.target.value })} placeholder="Bike / on foot" /></Field>
          <Field label="Plate number"><Input value={form.plate} onChange={(e) => setForm({ ...form, plate: e.target.value })} placeholder="LAG-123-XY" /></Field>
        </div>
        <Field label="Service city"><Input value={form.service_city} onChange={(e) => setForm({ ...form, service_city: e.target.value })} /></Field>
        <Field label="Service areas" hint="Comma separated, e.g. Lekki, Ikoyi, VI">
          <Input value={form.service_areas} onChange={(e) => setForm({ ...form, service_areas: e.target.value })} />
        </Field>
      </div>

      <div className="card col" style={{ gap: 12 }}>
        <div className="h3">Payout account</div>
        <Field label="Bank"><Input value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} placeholder="GTBank" /></Field>
        <Field label="Account name"><Input value={form.account_name} onChange={(e) => setForm({ ...form, account_name: e.target.value })} /></Field>
        <Field label="Account number"><Input value={form.account_number} onChange={(e) => setForm({ ...form, account_number: e.target.value })} inputMode="numeric" maxLength={10} /></Field>
        <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save details'}</Button>
      </div>

      <Button variant="ghost" onClick={logout}><Icon name="logout" size={16} /> Sign out</Button>
    </div>
  );
}
