import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { askConfirm } from '../../lib/ask.jsx';
import { api, naira, pretty, statusTone, timeAgo, clockTime, fmtAddress, assetUrl, downloadAndSave } from '../../lib/api.js';
/* Leaflet is ~45 kB of map code that only one screen needs, so it loads on
   demand: the rest of the app stays light and the map still appears instantly. */
const DeliveryMap = React.lazy(() => import('../../components/DeliveryMap.jsx'));
import PhotoPicker from '../../components/PhotoPicker.jsx';
import {
  Badge, Button, Empty, Field, Icon, Input, Loading, Modal, SectionHead, StatusBadge, Textarea,
  useAuth, useToast,
} from '../../lib/ui.jsx';

const ACTIVE = ['pending_payment', 'paid', 'accepted', 'preparing', 'ready_for_pickup', 'open_for_shoppers',
  'shopper_assigned', 'shopping', 'awaiting_approval', 'approved', 'purchased', 'ready_for_delivery',
  'rider_assigned', 'picked_up', 'in_transit', 'delivered'];

export function Orders() {
  const [tab, setTab] = useState('active');
  const [orders, setOrders] = useState(null);
  const nav = useNavigate();

  useEffect(() => {
    api.get('/api/orders?limit=50').then((r) => setOrders(r.orders)).catch(() => setOrders([]));
  }, []);

  if (!orders) return <Loading />;
  const list = orders.filter((o) => (tab === 'active' ? ACTIVE.includes(o.status) : !ACTIVE.includes(o.status)));

  return (
    <div className="page page-tight col">
      <SectionHead title="Your orders" />
      <div className="chips">
        <button className={`chip ${tab === 'active' ? 'active' : ''}`} onClick={() => setTab('active')}>Active</button>
        <button className={`chip ${tab === 'past' ? 'active' : ''}`} onClick={() => setTab('past')}>Past</button>
      </div>

      {list.length === 0 && (
        <Empty icon="receipt" title={tab === 'active' ? 'No active orders' : 'No past orders yet'}
          body="Your orders and receipts will appear here."
          action={<Button onClick={() => nav('/browse')}>Start shopping</Button>} />
      )}

      <div className="col" style={{ gap: 10 }}>
        {list.map((o) => (
          <button key={o.id} className="card row" style={{ gap: 12, textAlign: 'left', cursor: 'pointer' }} onClick={() => nav(`/orders/${o.id}`)}>
            <div style={{ width: 46, height: 46, borderRadius: 13, background: 'var(--green-50)', display: 'grid', placeItems: 'center', fontSize: 20, flex: 'none' }}>
              {o.type === 'personal'
                ? <Icon name="bag" size={21} style={{ color: 'var(--green-700)' }} />
                : (o.store?.logo
                  ? <img src={assetUrl(o.store.logo)} alt="" style={{ width: 46, height: 46, borderRadius: 13, objectFit: 'cover' }} />
                  : <Icon name="shop" size={21} style={{ color: 'var(--green-700)' }} />)}
            </div>
            <div className="grow">
              <div className="row-between">
                <span className="strong" style={{ fontSize: 13.5 }}>{o.type === 'personal' ? 'Personal shopping' : o.store?.name}</span>
                <span className="mono strong" style={{ fontSize: 13 }}>{naira(o.total)}</span>
              </div>
              <div className="sub" style={{ marginTop: 2 }}>
                {o.item_count} item{o.item_count === 1 ? '' : 's'} · {timeAgo(o.created_at)} · {o.code}
              </div>
              <div className="row" style={{ gap: 6, marginTop: 6 }}>
                <StatusBadge status={o.status} />
                {o.payment_status === 'pending' && <Badge tone="badge-warn">Payment pending</Badge>}
                {o.scheduled_for && <Badge tone="badge-orange"><Icon name="clock" size={11} /> {new Date(o.scheduled_for).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</Badge>}
              </div>
            </div>
            <Icon name="right" size={16} style={{ color: 'var(--ink-3)' }} />
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------ order detail ------------------------------ */

const STEPS_MERCHANT = ['paid', 'accepted', 'preparing', 'ready_for_pickup', 'rider_assigned', 'picked_up', 'in_transit', 'delivered', 'completed'];
const STEPS_PERSONAL = ['paid', 'open_for_shoppers', 'shopper_assigned', 'shopping', 'awaiting_approval', 'approved', 'purchased', 'ready_for_delivery', 'rider_assigned', 'picked_up', 'in_transit', 'delivered', 'completed'];

export function OrderDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [tracking, setTracking] = useState(null);
  const [tab, setTab] = useState('summary');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [report, setReport] = useState({ category: 'order', message: '', items: [], amount: '', photo: null });
  const [reportSent, setReportSent] = useState(false);
  const [rateOpen, setRateOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const chatRef = useRef(null);
  const { user } = useAuth();
  const toast = useToast();
  const nav = useNavigate();

  const load = () => api.get(`/api/orders/${id}`).then(setData).catch(() => setData(null));
  useEffect(() => { load(); }, [id]);
  useEffect(() => {
    const t = setInterval(() => {
      api.get(`/api/orders/${id}/tracking`).then(setTracking).catch(() => {});
    }, 6000);
    api.get(`/api/orders/${id}/tracking`).then(setTracking).catch(() => {});
    return () => clearInterval(t);
  }, [id]);
  useEffect(() => { chatRef.current?.scrollTo({ top: 99999 }); }, [data?.messages?.length, tab]);

  if (!data) return <Loading />;
  const { order, messages, receipts, payment } = data;
  const steps = order.type === 'personal' ? STEPS_PERSONAL : STEPS_MERCHANT;
  const currentIdx = steps.indexOf(order.status);
  const progress = currentIdx < 0 ? (order.status === 'cancelled' || order.status === 'refunded' ? 100 : 0) : ((currentIdx + 1) / steps.length) * 100;
  const pendingApprovals = (order.shopping_items || []).filter((i) => i.status === 'proposed');

  /*
   * A receipt the customer can keep as a file — for an expense claim, a refund
   * argument, or just to know what the shop actually charged. Built by the
   * server from the order itself, so it cannot disagree with what is on screen.
   */
  const downloadReceipt = async () => {
    setPdfBusy(true);
    try {
      await downloadAndSave(`/api/orders/${order.id}/receipt.pdf`, `BUYBUDDY-${order.code}.pdf`);
      toast.success('Receipt saved to your downloads');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setPdfBusy(false);
    }
  };

  const sendReport = async () => {
    setBusy(true);
    try {
      const claim = Number(report.amount || 0);
      await api.post('/api/support/tickets', {
        subject: report.items.length
          ? `${report.items.map((i) => i.name).join(', ')} — ${order.code}`
          : `Problem with ${order.code}`,
        message: report.message,
        category: report.category,
        order_id: order.id,
        ...(claim > 0 ? { claim_amount: claim, claim_items: report.items.map((i) => i.id) } : {}),
        ...(report.photo ? { photo: report.photo } : {}),
      });
      setReportSent(true);
      toast.success('Support has your report');
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const act = async (fn, label) => {
    setBusy(true);
    try {
      await fn();
      await load();
      toast.success(label);
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const cancel = async () => {
    const yes = await askConfirm({
      title: `Cancel ${order.code}?`,
      message: order.payment_status === 'paid'
        ? `Anything you paid goes back where it came from — ${order.payment_method === 'cash' ? 'a cash order needs no refund' : 'to your wallet, or to your card for a card payment'}.`
        : 'This order has not been paid, so there is nothing to refund.',
      detail: 'The store and any rider on the way are told straight away. You can order the same items again at any time.',
      confirmLabel: 'Cancel this order',
      cancelLabel: 'Keep my order',
      danger: true,
    });
    if (!yes) return;
    act(() => api.post(`/api/orders/${order.id}/cancel`, { reason: 'Changed my mind' }), 'Order cancelled');
  };

  const decision = (itemId, action) =>
    act(() => api.post(`/api/orders/${order.id}/approvals`, { items: [{ id: itemId, action }] }), action === 'approve' ? 'Item approved' : 'Item rejected');

  const sendMsg = async (e) => {
    e.preventDefault();
    if (!msg.trim()) return;
    await api.post(`/api/orders/${order.id}/messages`, { body: msg });
    setMsg('');
    load();
  };

  const submitRating = async () => {
    await act(() => api.post(`/api/orders/${order.id}/review`, { rating, comment }), 'Thanks for your feedback');
    setRateOpen(false);
  };

  const reorder = () => act(async () => {
    await api.post(`/api/orders/${order.id}/reorder`, {});
  }, 'Items added to your cart').then(() => nav('/cart'));

  const isActive = ACTIVE.includes(order.status);

  return (
    <div className="page page-tight col" style={{ gap: 14 }}>
      <div className="row">
        <button className="btn btn-ghost btn-icon" onClick={() => nav('/orders')}><Icon name="left" /></button>
        <div className="grow">
          <div className="h2">{order.type === 'personal' ? 'Personal shopping' : order.store?.name || 'Order'}</div>
          <div className="sub mono">{order.code} · {timeAgo(order.created_at)}</div>
          {order.scheduled_for && (
            <div className="tiny" style={{ color: 'var(--orange)', fontWeight: 700, marginTop: 2 }}>
              {order.released_at ? 'Booked for ' : 'Booked for '}
              {new Date(order.scheduled_for).toLocaleString('en-NG', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              {!order.released_at && ' — work starts about an hour before'}
            </div>
          )}
        </div>
        <div className="col" style={{ alignItems: 'flex-end', gap: 6 }}>
          <StatusBadge status={order.status} />
          {!['pending_payment', 'cancelled'].includes(order.status) && (
            <button
              className="btn btn-ghost btn-sm"
              style={{ fontSize: 12, padding: '4px 8px' }}
              onClick={() => { setReportSent(false); setReport({ category: 'order', message: '', items: [], amount: '', photo: null }); setReportOpen(true); }}
            >
              <Icon name="chat" size={13} /> Report a problem
            </button>
          )}
        </div>
      </div>

      {/* progress + map */}
      <div className="card">
        <div className="row-between" style={{ marginBottom: 8 }}>
          <div className="h3">
            {order.status === 'delivered'
              ? 'Delivered — confirm to complete'
              : order.scheduled_for && !order.released_at && ['paid', 'paid_cash'].includes(order.status)
                ? 'Booked — the shop starts about an hour before'
                : pretty(order.status)}
          </div>
          {tracking?.eta_minutes && <Badge tone="badge-green"><Icon name="clock" size={12} /> {tracking.eta_minutes} min away</Badge>}
        </div>
        <div className="progress"><div style={{ width: `${Math.min(100, progress)}%` }} /></div>

        {tracking?.active && (
          <div style={{ marginTop: 14 }}>
            <React.Suspense fallback={<MapSvg from={tracking.pickup} to={tracking.destination} pos={tracking.rider_position} />}>
              <DeliveryMap
                pickup={tracking.pickup}
                destination={tracking.destination}
                rider={tracking.rider_position}
                trail={tracking.trail}
                fallback={<MapSvg from={tracking.pickup} to={tracking.destination} pos={tracking.rider_position} />}
              />
            </React.Suspense>
            <div className="row-between" style={{ marginTop: 8, gap: 8 }}>
              <span className="tiny muted">
                {tracking.rider?.name} · {tracking.pickup.label} → {tracking.destination.label}
              </span>
              <Badge tone="badge-green">{(tracking.progress || 0) > 0.5 ? 'Arriving' : 'On the way'}</Badge>
            </div>
            <div className="row wrap" style={{ gap: 8, marginTop: 6 }}>
              {tracking.position_source === 'gps' ? (
                <Badge tone="badge-green">
                  <span className="loc-dot" data-on="yes" /> Live GPS
                  {tracking.last_fix_seconds_ago != null ? ` · ${tracking.last_fix_seconds_ago}s ago` : ''}
                </Badge>
              ) : (
                <Badge tone="badge-muted">
                  {/* Honesty beats a confident wrong dot. */}
                  <Icon name="pin" size={11} /> Estimated position
                </Badge>
              )}
              {tracking.distance_km != null && (
                <span className="tiny muted">{tracking.distance_km} km to go</span>
              )}
            </div>
          </div>
        )}

        {order.status === 'delivered' && (
          <div className="row" style={{ gap: 8, marginTop: 12 }}>
            <Button onClick={() => act(() => api.post(`/api/orders/${order.id}/confirm-delivery`, {}), 'Order completed 🎉')} className="grow">
              <Icon name="check" size={16} /> Confirm delivery
            </Button>
            <Button variant="ghost" onClick={() => setRateOpen(true)}>Rate</Button>
          </div>
        )}
        {['completed', 'delivered'].includes(order.status) && (
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <Button variant="ghost" size="sm" onClick={reorder} className="grow">Reorder</Button>
            <Button variant="ghost" size="sm" onClick={() => nav('/support')}>Report a problem</Button>
          </div>
        )}
      </div>

      {/* approvals */}
      {pendingApprovals.length > 0 && order.status === 'awaiting_approval' && (
        <div className="card" style={{ border: '1.5px solid var(--orange)' }}>
          <div className="row-between">
            <div className="h3">Approve your basket</div>
            <Badge tone="badge-orange">{pendingApprovals.length} item(s)</Badge>
          </div>
          <p className="sub" style={{ marginTop: 4 }}>
            Your shopper found the items below. Approve or reject each one — you will never be charged for something you did not approve.
          </p>
          <div className="col" style={{ gap: 10, marginTop: 12 }}>
            {(order.shopping_items || []).map((it) => (
              <div key={it.id} className="tile">
                <div className="row-between">
                  <div className="grow">
                    <div className="strong" style={{ fontSize: 13.5 }}>{it.proposed_name || it.description}</div>
                    <div className="sub">
                      Requested: {it.description} × {it.qty}
                      {it.proposed_price ? ` · Found at ${naira(it.proposed_price)}` : ''}
                    </div>
                    {it.note && <div className="tiny" style={{ color: 'var(--orange)', marginTop: 3 }}>{it.note}</div>}
                  </div>
                  <StatusBadge status={it.status} />
                </div>
                {it.status === 'proposed' && (
                  <div className="row" style={{ gap: 8, marginTop: 10 }}>
                    <Button size="sm" onClick={() => decision(it.id, 'approve')} disabled={busy} className="grow">
                      <Icon name="check" size={14} /> Approve {it.proposed_price ? naira(it.proposed_price * (it.proposed_qty || it.qty)) : ''}
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => decision(it.id, 'reject')} disabled={busy}>Reject</Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {order.payment_status === 'pending' && order.status !== 'cancelled' && (
        <div className="card" style={{ background: 'var(--warn-soft)', borderColor: '#f0dfb4' }}>
          <div className="row-between wrap" style={{ gap: 10 }}>
            <div style={{ maxWidth: 340 }}>
              <div className="strong">
                {order.amount_paid > 0 ? `Pay the difference — ${naira(order.amount_due)}` : 'Payment required'}
              </div>
              <div className="sub">
                {order.amount_paid > 0
                  ? `You have paid ${naira(order.amount_paid)} of ${naira(order.total)}. Pay the rest and your shopper carries on straight away.`
                  : 'Complete payment so your order can proceed.'}
              </div>
            </div>
            <Button size="sm" onClick={() => act(async () => {
              const r = await api.post(`/api/orders/${order.id}/pay`, { payment_method: 'paystack' });
              if (r.payment?.sandbox) nav(`/pay/${r.payment.reference}`);
              else if (r.payment?.authorization_url) window.location.href = r.payment.authorization_url;
            }, 'Payment started')}>
              Pay {naira(order.amount_due || order.total)}
            </Button>
          </div>
          {order.amount_paid > 0 && (
            <p className="tiny muted" style={{ marginTop: 10, marginBottom: 0 }}>
              Only the difference is charged — you are never asked to pay for the same items twice.
            </p>
          )}
        </div>
      )}

      {/* tabs */}
      <div className="chips">
        {[['summary', 'Summary'], ['items', order.type === 'personal' ? 'Shopping list' : 'Items'], ['timeline', 'Timeline'], ['chat', `Chat${messages.length ? ` (${messages.length})` : ''}`]].map(([k, l]) => (
          <button key={k} className={`chip ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'summary' && (
        <div className="card col" style={{ gap: 10 }}>
          <div className="row-between"><span className="sub">Subtotal</span><span className="mono">{naira(order.subtotal)}</span></div>
          <div className="row-between"><span className="sub">{order.type === 'personal' ? 'Shopper fee' : 'Service fee'}</span><span className="mono">{naira(order.service_fee)}</span></div>
          <div className="row-between"><span className="sub">Delivery fee</span><span className="mono">{naira(order.delivery_fee)}</span></div>
          <div className="row-between"><span className="sub">VAT</span><span className="mono">{naira(order.tax)}</span></div>
          {order.discount > 0 && <div className="row-between"><span className="sub">Discount {order.promo_code && `(${order.promo_code})`}</span><span className="mono" style={{ color: 'var(--green-700)' }}>− {naira(order.discount)}</span></div>}
          <div className="divider" style={{ margin: '4px 0' }} />
          <div className="row-between"><span className="h3">Total</span><span className="h3 mono">{naira(order.total)}</span></div>
          {(() => {
            /*
             * "paid cash · cash" is what the raw fields say, and it reads like a
             * database row on the screen a customer looks at most.
             */
            const method = order.payment_method === 'cash' ? 'cash on delivery' : order.payment_method;
            const settled = order.payment_status === 'paid' || order.payment_status === 'paid_cash';
            const tone = settled ? 'badge-ok' : 'badge-warn';
            const text = order.payment_method === 'cash'
              ? (settled ? 'cash on delivery' : 'pay the rider')
              : order.payment_status === 'pending'
                ? `unpaid · ${method}`
                : `paid · ${method}`;
            return (
              <div className="row-between">
                <span className="sub">Payment</span>
                <Badge tone={tone}>{text}</Badge>
              </div>
            );
          })()}

          {['paid', 'paid_cash', 'refunded'].includes(order.payment_status) && (
            <div className="row-between">
              <div>
                <div className="label">Receipt</div>
                <div className="tiny muted">A PDF with the items, fees and what you paid.</div>
              </div>
              <Button size="sm" variant="ghost" onClick={downloadReceipt} disabled={pdfBusy}>
                <Icon name="receipt" size={14} /> {pdfBusy ? 'Preparing…' : 'Download PDF'}
              </Button>
            </div>
          )}

          <div className="divider" />
          <div>
            <div className="label">Delivery address</div>
            <div className="sub" style={{ marginTop: 3 }}>{fmtAddress(order.address)}</div>
            {order.notes && <div className="sub" style={{ marginTop: 4 }}><strong>Note:</strong> {order.notes}</div>}
          </div>

          {order.delivery_pin && isActive && (
            <div className="tile" style={{ background: 'var(--green-50)', border: 'none' }}>
              <div className="row-between">
                <div>
                  <div className="label">Delivery PIN</div>
                  <div className="sub">Give this to your rider when the order arrives.</div>
                </div>
                <div className="mono" style={{ fontSize: 22, fontWeight: 800, letterSpacing: 3 }}>{order.delivery_pin}</div>
              </div>
            </div>
          )}

          {(order.shopper || order.rider) && (
            <div className="col" style={{ gap: 8 }}>
              <div className="label">Your buddy</div>
              {[order.shopper, order.rider].filter(Boolean).map((w) => (
                <div key={w.id} className="row" style={{ gap: 10 }}>
                  <div style={{ width: 34, height: 34, borderRadius: 11, background: 'var(--green-100)', display: 'grid', placeItems: 'center', fontWeight: 800, color: 'var(--green-800)' }}>
                    {w.name.split(' ').map((n) => n[0]).slice(0, 2).join('')}
                  </div>
                  <div className="grow">
                    <div className="strong" style={{ fontSize: 13 }}>{w.name}</div>
                    <div className="tiny muted">{w.area || 'BUYBUDDY verified'}</div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setTab('chat')}><Icon name="chat" size={14} /> Message</Button>
                </div>
              ))}
            </div>
          )}

          {receipts?.length > 0 && (
            <>
              <div className="divider" />
              <div className="label">Receipts & proof</div>
              <div className="row wrap" style={{ gap: 8 }}>
                {receipts.map((r) => (
                  <a key={r.id} href={r.data_url || '#'} target="_blank" rel="noreferrer" className="chip">
                    <Icon name="receipt" size={13} /> {r.note || r.file_name} {r.amount ? `· ${naira(r.amount)}` : ''}
                  </a>
                ))}
              </div>
            </>
          )}

          {isActive && ['pending_payment', 'paid', 'open_for_shoppers', 'accepted', 'shopper_assigned', 'shopping', 'awaiting_approval', 'ready_for_pickup'].includes(order.status) && (
            <Button variant="danger" size="sm" onClick={cancel} disabled={busy}>Cancel order</Button>
          )}
        </div>
      )}

      {tab === 'items' && (
        <div className="card card-flush">
          {order.type === 'personal'
            ? (order.shopping_items || []).map((it, i) => (
              <div key={it.id} className="row" style={{ gap: 12, padding: 14, borderTop: i ? '1px solid var(--line)' : 'none' }}>
                <img src={assetUrl(it.image)} alt="" style={{ width: 46, height: 46, borderRadius: 11, objectFit: 'cover', background: 'var(--green-50)' }} />
                <div className="grow">
                  <div className="strong" style={{ fontSize: 13.5 }}>{it.description} × {it.qty}</div>
                  {it.proposed_name && <div className="sub">Found: {it.proposed_name}{it.proposed_price ? ` — ${naira(it.proposed_price)}` : ''}</div>}
                  {it.note && <div className="tiny muted">{it.note}</div>}
                </div>
                <StatusBadge status={it.status} />
              </div>
            ))
            : (order.items || []).map((it, i) => (
              <div key={it.id} className="row" style={{ gap: 12, padding: 14, borderTop: i ? '1px solid var(--line)' : 'none' }}>
                <img src={assetUrl(it.image)} alt="" style={{ width: 46, height: 46, borderRadius: 11, objectFit: 'cover', background: 'var(--green-50)' }} />
                <div className="grow">
                  <div className="strong" style={{ fontSize: 13.5 }}>{it.name}</div>
                  <div className="sub">{naira(it.price)} × {it.qty}</div>
                </div>
                <span className="mono strong" style={{ fontSize: 13 }}>{naira(it.price * it.qty)}</span>
              </div>
            ))}
        </div>
      )}

      {tab === 'timeline' && (
        <div className="card">
          <div className="timeline">
            {(order.timeline || []).slice().reverse().map((e, i) => (
              <div className="tl-item" key={i}>
                <div className="tl-rail"><div className="tl-dot done" /><div className="tl-line" /></div>
                <div className="tl-body">
                  <div className="strong" style={{ fontSize: 13.5 }}>{e.message || pretty(e.type)}</div>
                  <div className="tiny muted">{e.actor_role ? `${pretty(e.actor_role)} · ` : ''}{clockTime(e.at)} · {timeAgo(e.at)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'chat' && (
        <div className="card" style={{ padding: 0 }}>
          <div ref={chatRef} style={{ maxHeight: 340, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {messages.length === 0 && <div className="sub center" style={{ padding: 20 }}>No messages yet. Say hello to your buddy 👋</div>}
            {messages.map((m) => {
              const mine = m.sender_id === user.id;
              return (
                <div key={m.id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '82%' }}>
                  <div style={{
                    background: mine ? 'var(--green-700)' : '#f1f4f1', color: mine ? '#fff' : 'var(--ink)',
                    padding: '9px 12px', borderRadius: 14, fontSize: 13.5, lineHeight: 1.4,
                    borderBottomRightRadius: mine ? 4 : 14, borderBottomLeftRadius: mine ? 14 : 4,
                  }}>{m.body}</div>
                  <div className="tiny muted" style={{ marginTop: 3, textAlign: mine ? 'right' : 'left' }}>
                    {m.sender_name} · {clockTime(m.created_at)}
                  </div>
                </div>
              );
            })}
          </div>
          <form onSubmit={sendMsg} className="row" style={{ gap: 8, padding: 10, borderTop: '1px solid var(--line)' }}>
            <Input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Type a message…" />
            <Button type="submit"><Icon name="chat" size={16} /></Button>
          </form>
        </div>
      )}

            <Modal open={reportOpen} onClose={() => setReportOpen(false)} title={`Problem with ${order.code}`}>
        {reportSent ? (
          <div className="col" style={{ gap: 12 }}>
            <div
              style={{
                padding: '12px 14px', borderRadius: 12, background: 'var(--green-50)',
                border: '1px solid var(--green-200)', fontSize: 13, lineHeight: 1.6,
              }}
            >
              <strong>Support has it.</strong> They can see this order and everything on it — totals, the shopper,
              the rider and the receipt. Reply to them from <strong>Help &amp; support</strong> and you will get an
              answer in the app and by SMS.
              {Number(report.amount) > 0 && (
                <>
                  <br /><br />
                  You asked for <strong>{naira(Number(report.amount))}</strong> back. Support checks it against the
                  order and pays it to the same place you paid from. You do not need to chase it.
                </>
              )}
            </div>
            <Button block onClick={() => setReportOpen(false)}>Close</Button>
          </div>
        ) : (
          <div className="col" style={{ gap: 12 }}>
            <p className="sub" style={{ margin: 0 }}>
              Tell us what went wrong and we will look at this order with you. Nothing is charged for reporting.
            </p>
            <Field label="What went wrong?">
              <select className="select" value={report.category} onChange={(e) => setReport({ ...report, category: e.target.value })}>
                <option value="order">Wrong, missing or damaged item</option>
                <option value="delivery">Late or not delivered</option>
                <option value="payment">I was charged wrongly, or a refund is missing</option>
                <option value="general">Something else</option>
              </select>
            </Field>

            {['delivered', 'completed'].includes(order.status) && (order.items || []).length > 0 && (
              <Field label="Which items?" hint="Tap the ones with the problem. Leave empty if it is the whole order.">
                <div className="col" style={{ gap: 6 }}>
                  {(order.items || []).map((it) => {
                    const on = report.items.some((x) => x.id === it.id);
                    return (
                      <button
                        key={it.id}
                        type="button"
                        className={`tile ${on ? 'active' : ''}`}
                        style={{ textAlign: 'left', border: on ? '1.5px solid var(--green-600)' : '1px solid var(--line)', background: on ? 'var(--green-50)' : '#fff', cursor: 'pointer' }}
                        onClick={() => {
                          const items = on ? report.items.filter((x) => x.id !== it.id) : [...report.items, { id: it.id, name: it.name, value: it.price * it.qty }];
                          const amount = items.reduce((sum, x) => sum + x.value, 0);
                          setReport({ ...report, items, amount: amount ? String(amount) : '' });
                        }}
                      >
                        <div className="row-between">
                          <span className="strong" style={{ fontSize: 13 }}>{it.qty} × {it.name}</span>
                          <span className="mono">{naira(it.price * it.qty)}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </Field>
            )}

            {['delivered', 'completed'].includes(order.status) && (
              <Field label="How much should come back? (₦)" hint="We prefill it from the items you picked. Support checks it and pays the same way you paid.">
                <Input
                  type="number"
                  value={report.amount}
                  onChange={(e) => setReport({ ...report, amount: e.target.value })}
                  placeholder={String(order.total)}
                />
              </Field>
            )}

            <Field label="In your words" hint="The more detail, the faster we can fix it.">
              <Textarea
                rows={4}
                value={report.message}
                onChange={(e) => setReport({ ...report, message: e.target.value })}
                placeholder="For example: the rice came open and the milk was missing."
              />
            </Field>

            <PhotoPicker
              value={report.photo}
              onChange={(url) => setReport({ ...report, photo: url })}
              label="Photo"
              hint="A picture of the bag or the item settles it fastest."
              size={96}
              onError={(m) => toast.error(m)}
            />

            <Button block disabled={busy || report.message.trim().length < 5} onClick={sendReport}>
              {busy ? 'Sending…' : Number(report.amount) > 0 ? `Ask for ${naira(Number(report.amount))} back` : 'Send to support'}
            </Button>
          </div>
        )}
      </Modal>

<Modal open={rateOpen} onClose={() => setRateOpen(false)} title="Rate this order"
        footer={<Button block onClick={submitRating}>Submit rating</Button>}>
        <div className="col center" style={{ gap: 12, alignItems: 'center' }}>
          <div className="row" style={{ gap: 6 }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} onClick={() => setRating(n)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 30, opacity: n <= rating ? 1 : 0.28 }}>⭐</button>
            ))}
          </div>
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Tell us how it went (optional)" />
        </div>
      </Modal>
    </div>
  );
}

/* ------------------------------- mini map -------------------------------- */

export function MapSvg({ from, to, pos }) {
  return (
    <svg viewBox="0 0 400 230" width="100%" height="100%" style={{ display: 'block' }} aria-label="Delivery map">
      <defs>
        <pattern id="grid" width="26" height="26" patternUnits="userSpaceOnUse">
          <path d="M26 0H0v26" fill="none" stroke="#dfe7e1" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="400" height="230" fill="#eef3ef" />
      <rect width="400" height="230" fill="url(#grid)" />
      <path d="M-10 150 Q 90 120 150 160 T 320 130 T 420 150" stroke="#cfe0d6" strokeWidth="16" fill="none" />
      <path d="M60 -10 Q 90 80 40 160 T 90 250" stroke="#cfe0d6" strokeWidth="12" fill="none" />
      <path d="M0 60 L400 40" stroke="#e6eee9" strokeWidth="9" />
      <circle cx="330" cy="70" r="26" fill="#dcebe1" />
      <path d="M84 168 C 150 140, 190 96, 300 84" stroke="#176B55" strokeWidth="3.5" strokeDasharray="7 6" fill="none" />
      <circle cx="84" cy="168" r="7" fill="#176B55" />
      <circle cx="300" cy="84" r="7" fill="#E4792F" />
      <text x="60" y="192" fontSize="10" fill="#4b5a53" fontFamily="sans-serif">{from?.label || 'Store'}</text>
      <text x="258" y="70" fontSize="10" fill="#4b5a53" fontFamily="sans-serif">You</text>
    </svg>
  );
}
