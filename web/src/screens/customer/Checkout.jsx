import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, naira, fmtAddress, pretty, assetUrl } from '../../lib/api.js';
import {
  Badge, Button, Empty, Field, Icon, Input, Loading, Modal, SectionHead, Select, Textarea,
  useAuth, useCart, useToast,
} from '../../lib/ui.jsx';

const uuid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);

/*
 * Two minimums can apply at once: the store's own minimum, and the platform
 * minimum order value. ₦950 in a store with a ₦1,000 minimum, inside a ₦1,500
 * platform minimum, needs ₦550 more — not ₦50. So the screen speaks with the
 * larger gap; otherwise the customer adds ₦50 and walks straight into a wall.
 */
function cartBlocker(cart) {
  const issues = cart?.issues || [];
  const minimums = issues
    .filter((i) => (i.type === 'min_order' || i.type === 'platform_min_order') && i.shortfall > 0)
    .sort((a, b) => b.shortfall - a.shortfall);
  return {
    worst: minimums[0] || null,
    closed: issues.find((i) => i.type === 'store_closed') || null,
    others: issues.filter((i) => !['min_order', 'platform_min_order', 'store_closed'].includes(i.type)),
  };
}

/* ---------------------------------- cart --------------------------------- */

export function Cart() {
  const { cart, reload } = useCart();
  const nav = useNavigate();
  const toast = useToast();

  const setQty = async (item, qty) => {
    try {
      await api.patch(`/api/cart/${item.id}`, { qty });
      await reload();
    } catch (e) { toast.error(e.message); }
  };
  const remove = async (item) => {
    await api.del(`/api/cart/${item.id}`);
    await reload();
    toast.success('Removed');
  };

  if (!cart.items.length) {
    return (
      <div className="page">
        <Empty icon="bag" title="Your cart is empty"
          body="Browse the marketplace or send a shopper a photo of exactly what you need."
          action={<div className="row" style={{ gap: 8 }}>
            <Button onClick={() => nav('/browse')}>Browse products</Button>
            <Button variant="accent" onClick={() => nav('/shop-for-me')}>Shop for me</Button>
          </div>} />
      </div>
    );
  }

  return (
    <div className="page page-tight col">
      <SectionHead title="Your cart" subtitle={cart.store ? `From ${cart.store.name}` : ''} />

      {(() => {
        const { worst, closed, others } = cartBlocker(cart);
        const lines = [];
        if (closed) lines.push(closed.message);
        if (worst) lines.push(`${worst.message} — add ${naira(worst.shortfall)} more and you can check out.`);
        for (const o of others) lines.push(o.message);
        if (!lines.length) return null;
        return (
          <div className="card" style={{ background: 'var(--warn-soft)', borderColor: '#f0dfb4' }}>
            {lines.map((line, idx) => (
              <div key={idx} className="row" style={{ gap: 8, fontSize: 13 }}>
                <Icon name="x" size={14} style={{ color: 'var(--warn)' }} /> <span>{line}</span>
              </div>
            ))}
          </div>
        );
      })()}

      <div className="card card-flush">
        {cart.items.map((item, i) => (
          <div key={item.id} className="row" style={{ gap: 12, padding: 14, borderTop: i ? '1px solid var(--line)' : 'none' }}>
            <img src={assetUrl(item.image)} alt="" style={{ width: 62, height: 62, borderRadius: 12, objectFit: 'cover', background: 'var(--green-50)' }} />
            <div className="grow">
              <div className="strong" style={{ fontSize: 13.5, lineHeight: 1.3 }}>{item.name}</div>
              <div className="tiny muted">{naira(item.price)} each</div>
              <div className="row" style={{ gap: 6, marginTop: 6 }}>
                <button className="btn btn-ghost btn-icon" style={{ padding: 4 }} onClick={() => setQty(item, item.qty - 1)} aria-label="Decrease"><Icon name="minus" size={13} /></button>
                <span className="mono strong" style={{ width: 22, textAlign: 'center', fontSize: 13 }}>{item.qty}</span>
                <button className="btn btn-ghost btn-icon" style={{ padding: 4 }} onClick={() => setQty(item, item.qty + 1)} aria-label="Increase"><Icon name="plus" size={13} /></button>
              </div>
            </div>
            <div className="col" style={{ alignItems: 'flex-end', gap: 6 }}>
              <span className="price mono">{naira(item.price * item.qty)}</span>
              <button className="btn btn-ghost btn-icon" style={{ padding: 4 }} onClick={() => remove(item)} aria-label="Remove"><Icon name="x" size={13} /></button>
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="row-between"><span className="sub">Subtotal ({cart.count} items)</span><span className="mono strong">{naira(cart.subtotal)}</span></div>
        <div className="divider" />
        <div className="row-between"><span className="sub">Service & delivery</span><span className="sub">Calculated at checkout</span></div>
        {(() => {
          /*
           * A disabled button that says nothing is a dead end — the customer is
           * left tapping a green button and reading a rule. So the button carries
           * the one number that matters: how much more to add.
           */
          const { worst, closed } = cartBlocker(cart);
          const label = closed
            ? 'This store is closed'
            : worst
              ? `Add ${naira(worst.shortfall)} more to check out`
              /* the subtotal is not the total — delivery and service fees are
                 added on the next screen, so the button must not promise one */
              : 'Go to checkout';
          return (
            <Button size="lg" block style={{ marginTop: 14 }} onClick={() => nav('/checkout')} disabled={Boolean(closed || worst)}>
              {label}
            </Button>
          );
        })()}
        <button className="btn btn-ghost btn-sm btn-block" style={{ marginTop: 8 }} onClick={() => nav('/browse')}>Add more items</button>
      </div>
    </div>
  );
}

/* -------------------------------- checkout -------------------------------- */

export function Checkout() {
  const { cart, reload } = useCart();
  const { config } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [addresses, setAddresses] = useState([]);
  const [addressId, setAddressId] = useState('');
  const [serviceLevel, setServiceLevel] = useState('standard');
  const [promoCode, setPromoCode] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('paystack');
  const [notes, setNotes] = useState('');
  const [quote, setQuote] = useState(null);
  const [rewards, setRewards] = useState(null);
  const [points, setPoints] = useState('');
  const [scheduled, setScheduled] = useState('');
  const [placing, setPlacing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [newAddr, setNewAddr] = useState({ label: 'Home', line1: '', area: '', city: 'Lagos' });
  const [idemKey] = useState(uuid);

  useEffect(() => {
    api.get('/api/me/rewards').then(setRewards).catch(() => setRewards(null));
  }, []);

  useEffect(() => {
    api.get('/api/addresses').then((r) => {
      setAddresses(r.addresses);
      const def = r.addresses.find((a) => a.is_default) || r.addresses[0];
      if (def) setAddressId(def.id);
      else setAddOpen(true);
    });
  }, []);

  useEffect(() => {
    if (!cart.items.length) return;
    api.post('/api/cart/quote', {
      address_id: addressId || undefined,
      service_level: serviceLevel,
      promo_code: promoCode || undefined,
      loyalty_points: points ? Number(points) : undefined,
      scheduled_for: scheduled || undefined,
    }).then(setQuote).catch(() => setQuote(null));
  }, [cart.items.length, cart.subtotal, addressId, serviceLevel, promoCode, points, scheduled]);

  const saveAddress = async () => {
    try {
      const r = await api.post('/api/addresses', newAddr);
      setAddresses((p) => [...p, r.address]);
      setAddressId(r.address.id);
      setAddOpen(false);
      toast.success('Address saved');
    } catch (e) { toast.error(e.message); }
  };

  const placeOrder = async () => {
    if (!addressId) return toast.error('Choose a delivery address.');
    setPlacing(true);
    try {
      const res = await api.post('/api/orders/checkout', {
        address_id: addressId,
        payment_method: paymentMethod,
        service_level: serviceLevel,
        promo_code: promoCode || undefined,
        loyalty_points: points ? Number(points) : undefined,
        scheduled_for: scheduled || undefined,
        notes,
        idempotency_key: idemKey,
      }, { headers: { 'Idempotency-Key': idemKey } });
      await reload();
      if (res.payment?.authorization_url && !res.payment.paid) {
        if (res.payment.sandbox) nav(`/pay/${res.payment.reference}?order=${res.order.id}`);
        else window.location.href = res.payment.authorization_url;
        return;
      }
      toast.success('Order placed!');
      nav(`/orders/${res.order.id}`);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setPlacing(false);
    }
  };

  if (!cart.items.length) return <div className="page"><Empty icon="bag" title="Nothing to check out" action={<Button onClick={() => nav('/browse')}>Browse</Button>} /></div>;

  const methods = [
    { id: 'paystack', label: 'Card, transfer or OPay', sub: quote?.payment_methods?.card ? 'Paystack — card, bank transfer, USSD, OPay' : 'Unavailable', icon: 'card' },
    ...(config?.wallet_enabled !== false ? [{ id: 'wallet', label: 'BUYBUDDY wallet', sub: 'Instant, no card needed', icon: 'wallet' }] : []),
    ...(config?.cod_enabled !== false ? [{ id: 'cash', label: 'Cash on delivery', sub: 'Pay the rider on arrival', icon: 'truck' }] : []),
  ];

  return (
    <div className="page page-tight col" style={{ gap: 14 }}>
      <div className="row">
        <button className="btn btn-ghost btn-icon" onClick={() => nav('/cart')}><Icon name="left" /></button>
        <div className="h2">Checkout</div>
      </div>

      <section className="card col" style={{ gap: 10 }}>
        <div className="row-between">
          <div className="h3">Delivery address</div>
          <button className="btn btn-ghost btn-sm" onClick={() => setAddOpen(true)}>+ New</button>
        </div>
        {addresses.length === 0 && <div className="sub">Add an address to continue.</div>}
        {addresses.map((a) => (
          <button key={a.id} onClick={() => setAddressId(a.id)} className="tile row" style={{
            gap: 10, textAlign: 'left', cursor: 'pointer',
            border: `1.5px solid ${addressId === a.id ? 'var(--green-600)' : 'var(--line)'}`,
            background: addressId === a.id ? 'var(--green-50)' : '#fff',
          }}>
            <Icon name="pin" size={18} style={{ color: 'var(--green-700)' }} />
            <div className="grow">
              <div className="strong" style={{ fontSize: 13.5 }}>{a.label} · {fmtAddress(a)}</div>
              <div className="sub">{a.notes || a.recipient}</div>
            </div>
            {addressId === a.id && <Icon name="check" size={16} style={{ color: 'var(--green-700)' }} />}
          </button>
        ))}
      </section>

      <section className="card col" style={{ gap: 10 }}>
        <div className="h3">Delivery speed</div>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {[
            { id: 'standard', title: 'Standard', sub: '25–40 min', extra: 0 },
            { id: 'express', title: 'Express', sub: '15–25 min', extra: config?.express_fee || 900 },
          ].map((o) => (
            <button key={o.id} onClick={() => setServiceLevel(o.id)} className="tile" style={{
              textAlign: 'left', cursor: 'pointer',
              border: `1.5px solid ${serviceLevel === o.id ? 'var(--green-600)' : 'var(--line)'}`,
              background: serviceLevel === o.id ? 'var(--green-50)' : '#fff',
            }}>
              <div className="strong" style={{ fontSize: 13.5 }}>{o.title}</div>
              <div className="sub">{o.sub}</div>
              <div className="tiny" style={{ color: 'var(--orange)', fontWeight: 700, marginTop: 4 }}>
                {o.extra ? `+${naira(o.extra)}` : 'No extra fee'}
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="card col" style={{ gap: 10 }}>
        <div className="h3">Payment</div>
        {methods.map((m) => (
          <button key={m.id} onClick={() => setPaymentMethod(m.id)} className="tile row" style={{
            gap: 12, textAlign: 'left', cursor: 'pointer',
            border: `1.5px solid ${paymentMethod === m.id ? 'var(--green-600)' : 'var(--line)'}`,
            background: paymentMethod === m.id ? 'var(--green-50)' : '#fff',
          }}>
            <Icon name={m.icon} size={18} style={{ color: 'var(--green-700)' }} />
            <div className="grow">
              <div className="strong" style={{ fontSize: 13.5 }}>{m.label}</div>
              <div className="sub">{m.sub}</div>
            </div>
            {paymentMethod === m.id && <Icon name="check" size={16} style={{ color: 'var(--green-700)' }} />}
          </button>
        ))}
        {paymentMethod === 'paystack' && (
          <div className="tiny muted" style={{ lineHeight: 1.55 }}>
            On the next screen choose <b>Card</b>, <b>Bank transfer</b> (a one-off account number you transfer
            into from any bank app), <b>Pay with Bank</b> for your <b>OPay</b>, PalmPay or Kuda wallet, or <b>USSD</b>.
          </div>
        )}
        <Field label="Promo code">
          <div className="row" style={{ gap: 8 }}>
            <Input value={promoCode} onChange={(e) => setPromoCode(e.target.value.toUpperCase())} placeholder="WELCOME10" />
            <Button variant="ghost" onClick={() => setPromoCode((c) => c.trim())}>Apply</Button>
          </div>
        </Field>
        <Field label="Schedule this delivery (optional)" hint="Leave empty for delivery as soon as possible. At least 1 hour ahead, up to 7 days.">
          <Input type="datetime-local" value={scheduled} onChange={(e) => setScheduled(e.target.value)} />
        </Field>
        {scheduled && quote?.scheduled?.error && (
          <div className="tiny" style={{ color: 'var(--danger)' }}>{quote.scheduled.error}</div>
        )}
        {rewards?.loyalty?.enabled && rewards.points >= rewards.loyalty.min_redeem && (
          <Field label={`Use loyalty points (${rewards.points} available)`}
            hint={`${rewards.loyalty.naira_per_point} point = ₦${rewards.loyalty.naira_per_point}. Minimum ${rewards.loyalty.min_redeem} points, up to ${rewards.loyalty.max_redeem_percent}% of the basket.`}>
            <div className="row" style={{ gap: 8 }}>
              <Input type="number" value={points} onChange={(e) => setPoints(e.target.value)} placeholder={String(rewards.loyalty.min_redeem)} />
              <Button variant="ghost" onClick={() => setPoints(String(Math.min(rewards.points, Math.floor((cart.subtotal * rewards.loyalty.max_redeem_percent) / 100))))}>
                Max
              </Button>
            </div>
          </Field>
        )}
        {quote?.loyalty?.error && <div className="tiny" style={{ color: 'var(--danger)' }}>{quote.loyalty.error}</div>}
        <Field label="Notes for the store or rider (optional)">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Call when you reach the gate." />
        </Field>
      </section>

      <section className="card">
        <div className="h3" style={{ marginBottom: 10 }}>Order summary</div>
        <Row label={`Items (${cart.count})`} value={naira(quote?.subtotal ?? cart.subtotal)} />
        <Row label="Service fee" value={naira(quote?.serviceFee || 0)} />
        <Row label="Delivery fee" value={naira(quote?.deliveryFee || 0)} />
        <Row label={`VAT (${config?.vat_percent ?? 7.5}%)`} value={naira(quote?.tax || 0)} />
        {quote?.discount > 0 && <Row label="Promo discount" value={`− ${naira(quote.discount)}`} tone="var(--green-700)" />}
        {quote?.loyalty?.discount > 0 && <Row label={`Loyalty points (${quote.loyalty.points})`} value={`− ${naira(quote.loyalty.discount)}`} tone="var(--green-700)" />}
        <div className="divider" />
        <div className="row-between">
          <span className="h3">Total</span>
          <span className="h2 mono">{naira(quote?.total ?? cart.subtotal)}</span>
        </div>
        {(() => {
          const { worst, closed } = cartBlocker(cart);
          const label = closed
            ? 'This store is closed right now'
            : worst
              ? `Add ${naira(worst.shortfall)} more to order`
              : `Place order · ${naira(quote?.total ?? cart.subtotal)}`;
          return (
            <Button size="lg" block style={{ marginTop: 14 }} disabled={placing || !addressId || Boolean(closed || worst)} onClick={placeOrder}>
              {placing ? 'Placing order…' : label}
            </Button>
          );
        })()}
        {cartBlocker(cart).worst && (
          <button className="btn btn-ghost btn-sm btn-block" style={{ marginTop: 8 }} onClick={() => nav('/cart')}>
            Back to cart to add more
          </button>
        )}
        <div className="tiny muted center" style={{ marginTop: 10 }}>
          <Icon name="check" size={11} style={{ verticalAlign: -1 }} /> Payments are verified on our servers, never in the app.
        </div>
      </section>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add delivery address"
        footer={<Button block onClick={saveAddress}>Save address</Button>}>
        <div className="col" style={{ gap: 12 }}>
          <Field label="Label"><Input value={newAddr.label} onChange={(e) => setNewAddr({ ...newAddr, label: e.target.value })} placeholder="Home / Office" /></Field>
          <Field label="Street address"><Input value={newAddr.line1} onChange={(e) => setNewAddr({ ...newAddr, line1: e.target.value })} placeholder="14 Admiralty Way" /></Field>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <Field label="Area"><Input value={newAddr.area} onChange={(e) => setNewAddr({ ...newAddr, area: e.target.value })} placeholder="Lekki Phase 1" /></Field>
            <Field label="City"><Input value={newAddr.city} onChange={(e) => setNewAddr({ ...newAddr, city: e.target.value })} /></Field>
          </div>
        </div>
      </Modal>
    </div>
  );
}

const Row = ({ label, value, tone }) => (
  <div className="row-between" style={{ marginBottom: 6 }}>
    <span className="sub">{label}</span>
    <span className="mono" style={{ fontSize: 13.5, color: tone || 'inherit' }}>{value}</span>
  </div>
);

/* ------------------------------ sandbox pay ------------------------------- */

export function SandboxPay() {
  const { reference } = useParams();
  const [params] = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState(null);
  const toast = useToast();
  const nav = useNavigate();

  useEffect(() => {
    api.get('/api/me').then((r) => setInfo(r)).catch(() => {});
  }, []);

  const pay = async () => {
    setBusy(true);
    try {
      const res = await api.post(`/api/dev/payments/${reference}/approve`, {});
      toast.success('Payment approved');
      nav(`/payment/return?reference=${reference}`);
    } catch (e) {
      toast.error(e.message);
      setBusy(false);
    }
  };

  return (
    <div className="page page-tight" style={{ maxWidth: 460, paddingTop: 40 }}>
      <div className="card card-pad-lg">
        <div className="row-between">
          <span className="badge badge-warn">Sandbox gateway</span>
          <span className="tiny muted mono">{reference}</span>
        </div>
        <div className="h1" style={{ marginTop: 14 }}>Complete your payment</div>
        <p className="sub" style={{ marginTop: 6 }}>
          Paystack keys are not configured, so BUYBUDDY is using its built-in test gateway.
          No real money moves. In production this screen is replaced by Paystack's secure checkout.
        </p>

        <div className="tile" style={{ marginTop: 16, background: 'var(--green-50)', border: 'none' }}>
          <div className="row-between"><span className="sub">Amount</span><span className="h2 mono">Test mode</span></div>
          <div className="row-between" style={{ marginTop: 6 }}><span className="sub">Card</span><span className="mono strong">4084 0840 8408 4081</span></div>
          <div className="row-between" style={{ marginTop: 6 }}><span className="sub">Expiry / CVV</span><span className="mono strong">12/29 · 408</span></div>
        </div>

        <Button size="lg" block style={{ marginTop: 18 }} onClick={pay} disabled={busy}>
          {busy ? 'Processing…' : 'Approve test payment'}
        </Button>
        <button className="btn btn-ghost btn-block btn-sm" style={{ marginTop: 8 }} onClick={() => nav('/orders')}>Cancel and pay later</button>
      </div>
    </div>
  );
}

export function PaymentReturn() {
  const [params] = useSearchParams();
  const reference = params.get('reference') || params.get('reference') || '';
  const nav = useNavigate();
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    if (!reference) return setState({ loading: false, error: 'No payment reference supplied.' });

    let tries = 0;
    let stop = false;
    const check = async () => {
      try {
        const r = await api.post(`/api/payments/${reference}/verify`, {});
        if (stop) return;
        setState({ loading: false, result: r });
        if (r.status === 'success' && r.order) {
          setTimeout(() => nav(`/orders/${r.order.id}`), 1200);
          return;
        }
        /**
         * A transfer is not instant: the money leaves their bank and lands a
         * little later. Nothing is wrong yet, so keep asking quietly for two
         * minutes instead of announcing a failure that has not happened.
         */
        if (r.status === 'pending' && tries < 24) {
          tries += 1;
          setTimeout(check, 5000);
        }
      } catch (e) {
        if (!stop) setState({ loading: false, error: e.message });
      }
    };
    check();
    return () => { stop = true; };
  }, [reference]);

  return (
    <div className="page page-tight center" style={{ maxWidth: 460, paddingTop: 60 }}>
      {state.loading && <Loading label="Verifying your payment…" />}
      {state.error && (
        <div className="card">
          <div className="h2">We could not confirm this payment</div>
          <p className="sub" style={{ marginTop: 6 }}>{state.error}</p>
          <Button block style={{ marginTop: 14 }} onClick={() => nav('/orders')}>Go to my orders</Button>
        </div>
      )}
      {state.result && state.result.status === 'pending' && (
        <div className="card">
          <div className="h2">Waiting for your bank</div>
          <p className="sub" style={{ marginTop: 6 }}>
            {state.result.message || 'We are waiting for your bank to confirm the transfer.'}
          </p>
          <p className="sub" style={{ marginTop: 6 }}>
            Keep this page open — it updates itself. You can also close it; your order is saved and will
            confirm on its own the moment the money lands.
          </p>
          <Button block style={{ marginTop: 16 }} onClick={() => nav(state.result.order ? `/orders/${state.result.order.id}` : '/orders')}>
            View my order
          </Button>
        </div>
      )}
      {state.result && state.result.topup && state.result.status === 'success' && (
        <div className="card">
          <div style={{ width: 56, height: 56, borderRadius: 999, background: 'var(--green-50)', border: '1px solid var(--green-200)', display: 'grid', placeItems: 'center', color: 'var(--green-700)' }}>
            <Icon name="check" size={28} />
          </div>
          <div className="h2" style={{ marginTop: 10 }}>Wallet topped up</div>
          <p className="sub" style={{ marginTop: 6 }}>
            {naira(state.result.balance)} is in your wallet now.
          </p>
          <Button block style={{ marginTop: 16 }} onClick={() => nav('/account/wallet')}>Back to my wallet</Button>
        </div>
      )}
      {state.result && !state.result.topup && state.result.status !== 'pending' && (
        <div className="card">
          <div style={{ width: 56, height: 56, borderRadius: 999, background: 'var(--green-50)', border: '1px solid var(--green-200)', display: 'grid', placeItems: 'center', color: 'var(--green-700)' }}>
            <Icon name="check" size={28} />
          </div>
          <div className="h2" style={{ marginTop: 10 }}>Payment confirmed</div>
          <p className="sub" style={{ marginTop: 6 }}>
            {state.result.order?.code ? `Order ${state.result.order.code} is confirmed.` : 'Your payment was verified.'}
          </p>
          {state.result.order && <Badge tone="badge-green" className="mono">{(state.result.order.status || '').replace(/_/g, ' ')}</Badge>}
          <Button block style={{ marginTop: 16 }} onClick={() => nav(state.result.order ? `/orders/${state.result.order.id}` : '/orders')}>
            Track my order
          </Button>
        </div>
      )}
    </div>
  );
}
