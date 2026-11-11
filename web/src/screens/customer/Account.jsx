import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, naira, timeAgo, fmtAddress, pretty, getApiBase, setApiBase, isNativeApp } from '../../lib/api.js';
import { Badge, Button, Empty, Field, Icon, Input, LoadFailed, Loading, Modal, SectionHead, StatusBadge, Textarea, useAuth, useAutoRetry, useToast } from '../../lib/ui.jsx';
import { ProductCard } from './Shop.jsx';
import TextSizeControl from '../../components/TextSizeControl.jsx';

/* -------------------------------- account -------------------------------- */

export function Account() {
  const { user, logout, refresh } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [wallet, setWallet] = useState(null);
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState({ name: user.name, email: user.email || '', area: user.area || '' });
  const [pw, setPw] = useState({ current_password: '', password: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.get('/api/wallet').then(setWallet).catch(() => {}); }, []);

  const save = async () => {
    setBusy(true);
    try {
      await api.patch('/api/me', form);
      await refresh();
      toast.success('Profile updated');
      setEdit(false);
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const changePw = async () => {
    setBusy(true);
    try {
      await api.patch('/api/me', pw);
      toast.success('Password changed — please sign in again');
      setPw({ current_password: '', password: '' });
      setEdit(false);
      setTimeout(logout, 900);
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const links = [
    { to: '/account/rewards', label: 'Points & referrals', sub: 'Earn points, invite friends', icon: 'star' },
    { to: '/account/wallet', label: 'Wallet & payments', sub: 'Top up, view transactions', icon: 'wallet' },
    { to: '/account/addresses', label: 'Saved addresses', sub: 'Home, office and more', icon: 'pin' },
    { to: '/favourites', label: 'Favourites', sub: 'Products you saved', icon: 'heart' },
    { to: '/account/notifications', label: 'Notifications', sub: 'Order updates and offers', icon: 'bell' },
    { to: '/support', label: 'Help & support', sub: 'Chat, tickets and refunds', icon: 'chat' },
  ];

  return (
    <div className="page page-tight col">
      <div className="card row" style={{ gap: 14 }}>
        <div style={{
          width: 58, height: 58, borderRadius: 18, background: 'linear-gradient(140deg,var(--green-600),var(--green-800))',
          display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 800, fontSize: 20, flex: 'none',
        }}>
          {user.name.split(' ').map((n) => n[0]).slice(0, 2).join('')}
        </div>
        <div className="grow">
          <div className="h3">{user.name}</div>
          <div className="sub">{user.email}</div>
          <div className="sub mono">{user.phone}</div>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setEdit(true)}>Edit</Button>
      </div>

      <button className="card" onClick={() => nav('/account/wallet')} style={{ textAlign: 'left', cursor: 'pointer', background: 'linear-gradient(135deg,var(--green-800),var(--green-900))', color: '#fff', border: 'none' }}>
        <div className="row-between">
          <div>
            <div className="tiny" style={{ opacity: 0.7, letterSpacing: '0.08em', fontWeight: 700 }}>BUYBUDDY WALLET</div>
            <div className="h1 mono" style={{ marginTop: 4 }}>{naira(wallet?.balance ?? user.wallet_balance)}</div>
          </div>
          <span className="badge" style={{ background: 'rgba(255,255,255,0.16)', color: '#fff' }}>Top up <Icon name="plus" size={12} /></span>
        </div>
      </button>

      <div className="card card-flush">
        {links.map((l, i) => (
          <Link key={l.to} to={l.to} className="row" style={{ gap: 12, padding: 15, borderTop: i ? '1px solid var(--line)' : 'none' }}>
            <div style={{ width: 38, height: 38, borderRadius: 12, background: 'var(--green-50)', display: 'grid', placeItems: 'center', color: 'var(--green-700)' }}>
              <Icon name={l.icon} size={18} />
            </div>
            <div className="grow">
              <div className="strong" style={{ fontSize: 13.5 }}>{l.label}</div>
              <div className="sub">{l.sub}</div>
            </div>
            <Icon name="right" size={16} style={{ color: 'var(--ink-3)' }} />
          </Link>
        ))}
      </div>

      <div className="card col" style={{ gap: 10 }}>
        <div className="h3">Text size</div>
        <div className="sub">Make everything in the app bigger. It stays this size until you change it.</div>
        <TextSizeControl />
      </div>

      <div className="card col" style={{ gap: 10 }}>
        <div className="h3">Legal</div>
        <a className="row-between legal-row" href="/legal/terms.html" target="_blank" rel="noopener">
          <span>Terms of Service</span><Icon name="right" size={15} style={{ color: 'var(--ink-3)' }} />
        </a>
        <a className="row-between legal-row" href="/legal/privacy.html" target="_blank" rel="noopener">
          <span>Privacy Policy</span><Icon name="right" size={15} style={{ color: 'var(--ink-3)' }} />
        </a>
      </div>

      <div className="card">
        <div className="row-between">
          <div>
            <div className="strong">Sign out</div>
            <div className="sub">You will need your password to sign back in.</div>
          </div>
          <Button variant="ghost" onClick={logout}><Icon name="logout" size={16} /> Sign out</Button>
        </div>
      </div>

      {isNativeApp() && (
        <div className="card col" style={{ gap: 8 }}>
          <div className="h3">Server</div>
          <div className="tiny muted mono" style={{ wordBreak: 'break-all' }}>{getApiBase() || 'not set'}</div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setApiBase(''); window.location.replace('/'); }}
          >
            Change server address
          </Button>
        </div>
      )}

      <p className="tiny muted center">BUYBUDDY v1.0 · Lagos, Nigeria · support@buybuddy.ng</p>

      <Modal open={edit} onClose={() => setEdit(false)} title="Edit profile"
        footer={<Button block onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</Button>}>
        <div className="col" style={{ gap: 12 }}>
          <Field label="Full name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Email"><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="Area"><Input value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} placeholder="Lekki Phase 1" /></Field>
          <div className="divider" />
          <div className="h3">Change password</div>
          <Field label="Current password"><Input type="password" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} /></Field>
          <Field label="New password"><Input type="password" value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} /></Field>
          <Button variant="ghost" onClick={changePw} disabled={busy || !pw.password}>Update password</Button>
        </div>
      </Modal>
    </div>
  );
}

/* -------------------------------- rewards -------------------------------- */

export function Rewards() {
  const [data, setData] = useState(null);
  const [copied, setCopied] = useState(false);
  const toast = useToast();

  const [error, setError] = useState(null);
  const load = () => {
    setError(null);
    Promise.all([api.get('/api/loyalty'), api.get('/api/referrals'), api.get('/api/me/rewards')])
      .then(([loyalty, referral, me]) => setData({ loyalty, referral, me }))
      .catch(setError);
  };
  useEffect(() => { load(); }, []);
  useAutoRetry(load, Boolean(error));

  if (data === null && error) return <LoadFailed what="your rewards" error={error} onRetry={load} />;
  if (data === null) return <Loading />;

  const { loyalty, referral } = data;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(referral.code);
      setCopied(true);
      toast.success('Referral code copied');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Copy failed — long-press the code to copy it.');
    }
  };

  return (
    <div className="page page-tight col" style={{ gap: 14 }}>
      <SectionHead title="Points & referrals" subtitle="Earn on every order, and get paid when friends shop" />

      <div className="card" style={{ background: 'linear-gradient(135deg,var(--green-800),var(--green-900))', color: '#fff', border: 'none' }}>
        <div className="tiny" style={{ opacity: 0.7, letterSpacing: '0.08em', fontWeight: 700 }}>BUYBUDDY POINTS</div>
        <div className="h1 mono" style={{ marginTop: 4 }}>{loyalty.balance.toLocaleString()}</div>
        <div className="sub" style={{ color: 'rgba(255,255,255,0.75)', marginTop: 2 }}>
          Worth {naira(loyalty.balance * loyalty.rules.naira_per_point)} at checkout
        </div>
        <div className="row" style={{ gap: 18, marginTop: 14 }}>
          <div>
            <div className="tiny" style={{ opacity: 0.6, fontWeight: 700 }}>EARNED</div>
            <div className="mono strong">{loyalty.lifetime_earned.toLocaleString()}</div>
          </div>
          <div>
            <div className="tiny" style={{ opacity: 0.6, fontWeight: 700 }}>REDEEMED</div>
            <div className="mono strong">{loyalty.lifetime_redeemed.toLocaleString()}</div>
          </div>
          <div>
            <div className="tiny" style={{ opacity: 0.6, fontWeight: 700 }}>RATE</div>
            <div className="mono strong">{loyalty.rules.points_per_1000} pts / ₦1,000</div>
          </div>
        </div>
      </div>

      <div className="card col" style={{ gap: 12 }}>
        <div className="row-between">
          <div className="h3">Invite friends</div>
          <Badge tone="badge-orange">₦{referral.reward_referrer.toLocaleString()} each</Badge>
        </div>
        <p className="sub">
          Share your code. When your friend completes their first order, you get
          {naira(referral.reward_referrer)} and they get {naira(referral.reward_referee)}.
        </p>
        <button onClick={copy} className="tile row" style={{ justifyContent: 'space-between', cursor: 'pointer', border: '1.5px dashed var(--green-600)', background: 'var(--green-50)' }}>
          <span className="mono" style={{ fontSize: 20, fontWeight: 800, letterSpacing: 2 }}>{referral.code}</span>
          <span className="badge badge-green">{copied ? 'Copied' : 'Copy'}</span>
        </button>
        <Button
          variant="ghost"
          onClick={() => {
            const text = referral.share_text;
            if (navigator.share) navigator.share({ title: 'BUYBUDDY', text }).catch(() => {});
            else {
              navigator.clipboard?.writeText(text);
              toast.success('Invite message copied');
            }
          }}
        >
          <Icon name="chat" size={15} /> Share invite
        </Button>
        <div className="row" style={{ gap: 20 }}>
          <div><div className="kpi-label">Invited</div><div className="strong mono">{referral.invited}</div></div>
          <div><div className="kpi-label">Qualified</div><div className="strong mono">{referral.qualified}</div></div>
          <div><div className="kpi-label">Earned</div><div className="strong mono">{naira(referral.earned)}</div></div>
        </div>
      </div>

      <div className="card card-flush">
        <div style={{ padding: 14 }} className="h3">Points activity</div>
        {loyalty.entries.length === 0 && <Empty icon="star" title="No points yet" body="You earn points automatically when an order is completed." />}
        {loyalty.entries.map((e) => (
          <div key={e.id} className="row" style={{ gap: 10, padding: '12px 14px', borderTop: '1px solid var(--line)' }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: e.points > 0 ? 'var(--ok-soft)' : 'var(--orange-soft)', display: 'grid', placeItems: 'center', color: e.points > 0 ? 'var(--ok)' : 'var(--orange-ink)', fontSize: 13, fontWeight: 800 }}>
              {e.points > 0 ? '+' : '−'}
            </div>
            <div className="grow">
              <div className="strong" style={{ fontSize: 13 }}>{e.description}</div>
              <div className="tiny muted">{timeAgo(e.created_at)} · balance {e.balance_after}</div>
            </div>
            <span className="mono strong" style={{ fontSize: 13, color: e.points > 0 ? 'var(--ok)' : 'var(--danger)' }}>
              {e.points > 0 ? '+' : ''}{e.points}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* --------------------------------- wallet -------------------------------- */

export function Wallet() {
  const [data, setData] = useState(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const [error, setError] = useState(null);
  const load = () => {
    setError(null);
    return api.get('/api/wallet').then(setData).catch(setError);
  };
  useEffect(() => { load(); }, []);
  useAutoRetry(load, Boolean(error));

  const topup = async () => {
    setBusy(true);
    try {
      const r = await api.post('/api/wallet/topup', { amount: Number(amount) });
      if (r.authorization_url) {
        // real money: the wallet is credited only after Paystack confirms
        window.location.href = r.authorization_url;
        return;
      }
      toast.success(`Wallet topped up to ${naira(r.balance)}`);
      setAmount('');
      load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  if (!data && error) {
    return (
      <div className="page page-tight col">
        <SectionHead title="Wallet" subtitle="Pay for orders instantly, and receive refunds here." />
        <LoadFailed what="your wallet" error={error} onRetry={load} />
      </div>
    );
  }
  if (!data) return <Loading />;

  return (
    <div className="page page-tight col">
      <SectionHead title="Wallet" subtitle="Pay for orders instantly, and receive refunds here." />
      <div className="card" style={{ background: 'linear-gradient(135deg,var(--green-800),var(--green-900))', color: '#fff', border: 'none' }}>
        <div className="tiny" style={{ opacity: 0.7, letterSpacing: '0.08em', fontWeight: 700 }}>AVAILABLE BALANCE</div>
        <div className="h1 mono" style={{ marginTop: 6 }}>{naira(data.balance)}</div>
      </div>
      <div className="card col" style={{ gap: 10 }}>
        <div className="h3">Top up</div>
        <div className="row" style={{ gap: 8 }}>
          <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount (₦)" />
          <Button onClick={topup} disabled={busy || !amount}>Top up</Button>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          {[2000, 5000, 10000, 20000].map((a) => (
            <button key={a} className="chip" onClick={() => setAmount(String(a))}>{naira(a)}</button>
          ))}
        </div>
        <p className="tiny muted">
          You are taken to Paystack to pay by card, transfer, USSD or your bank app. The money appears
          in your wallet the moment Paystack confirms it — usually straight away.
        </p>
      </div>

      <div className="card card-flush">
        <div style={{ padding: 14 }} className="h3">Transactions</div>
        {data.entries.length === 0 && <Empty icon="wallet" title="No transactions yet" />}
        {data.entries.map((e, i) => (
          <div key={e.id} className="row" style={{ gap: 12, padding: '12px 14px', borderTop: '1px solid var(--line)' }}>
            <div style={{ width: 34, height: 34, borderRadius: 11, background: e.type === 'credit' ? 'var(--ok-soft)' : 'var(--orange-soft)', display: 'grid', placeItems: 'center', color: e.type === 'credit' ? 'var(--ok)' : 'var(--orange-ink)' }}>
              <Icon name={e.type === 'credit' ? 'plus' : 'minus'} size={15} />
            </div>
            <div className="grow">
              <div className="strong" style={{ fontSize: 13 }}>{e.description}</div>
              <div className="tiny muted">{timeAgo(e.created_at)} · balance {naira(e.balance_after)}</div>
            </div>
            <span className="mono strong" style={{ color: e.type === 'credit' ? 'var(--ok)' : 'inherit', fontSize: 13 }}>
              {e.type === 'credit' ? '+' : '−'}{naira(e.amount)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------- favourites ------------------------------- */

export function Favourites() {
  const [items, setItems] = useState(null);
  const nav = useNavigate();
  const { user } = useAuth();
  /* A signed-out visitor has no saved list at all — telling them "nothing saved
     yet" hides the real reason and leaves them tapping hearts that go nowhere. */
  const [error, setError] = useState(null);
  const load = () => {
    if (!user) return setItems([]);
    setError(null);
    return api.get('/api/favourites').then((r) => setItems(r.favourites)).catch(setError);
  };
  useEffect(() => { load(); }, [user]);
  useAutoRetry(load, Boolean(error));
  if (items === null && error) {
    return (
      <div className="page page-tight col">
        <SectionHead title="Favourites" />
        <LoadFailed what="your favourites" error={error} onRetry={load} />
      </div>
    );
  }
  if (!items) return <Loading />;
  if (!user) {
    return (
      <div className="page page-tight col">
        <SectionHead title="Favourites" />
        <Empty
          icon="heart"
          title="Sign in to keep a favourites list"
          body="Hearts you tap are saved to your account, so they are waiting for you on any phone you sign in on."
          action={<Button onClick={() => nav('/login')}>Sign in</Button>}
        />
      </div>
    );
  }
  return (
    <div className="page page-tight col">
      <SectionHead title="Favourites" />
      {items.length === 0
        ? <Empty icon="heart" title="Nothing saved yet" body="Tap the heart on any product to save it here." action={<Button onClick={() => nav('/browse')}>Browse products</Button>} />
        : <div className="prod-grid">{items.map((p) => <ProductCard key={p.id} product={p} />)}</div>}
    </div>
  );
}

/* -------------------------------- addresses ------------------------------- */

export function Addresses() {
  const [list, setList] = useState(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ label: 'Home', line1: '', area: '', city: 'Lagos', notes: '' });
  const toast = useToast();

  const load = () => api.get('/api/addresses').then((r) => setList(r.addresses));
  useEffect(() => { load(); }, []);

  const save = async () => {
    try {
      await api.post('/api/addresses', form);
      setOpen(false);
      setForm({ label: 'Home', line1: '', area: '', city: 'Lagos', notes: '' });
      toast.success('Address added');
      load();
    } catch (e) { toast.error(e.message); }
  };
  const del = async (id) => {
    await api.del(`/api/addresses/${id}`);
    toast.success('Address removed');
    load();
  };

  if (!list) return <Loading />;

  return (
    <div className="page page-tight col">
      <SectionHead title="Saved addresses" action={<Button size="sm" onClick={() => setOpen(true)}><Icon name="plus" size={14} /> Add</Button>} />
      {list.length === 0 && <Empty icon="pin" title="No addresses yet" body="Add the address where you want your orders delivered." action={<Button onClick={() => setOpen(true)}>Add address</Button>} />}
      <div className="col" style={{ gap: 10 }}>
        {list.map((a) => (
          <div key={a.id} className="card row" style={{ gap: 12 }}>
            <Icon name="pin" size={18} style={{ color: 'var(--green-700)' }} />
            <div className="grow">
              <div className="row" style={{ gap: 6 }}>
                <span className="strong">{a.label}</span>
                {a.is_default && <Badge tone="badge-green">Default</Badge>}
              </div>
              <div className="sub">{fmtAddress(a)}</div>
              {a.notes && <div className="tiny muted">{a.notes}</div>}
            </div>
            <button className="btn btn-ghost btn-icon" onClick={() => del(a.id)} aria-label="Delete"><Icon name="x" size={14} /></button>
          </div>
        ))}
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Add address" footer={<Button block onClick={save}>Save address</Button>}>
        <div className="col" style={{ gap: 12 }}>
          <Field label="Label"><Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} /></Field>
          <Field label="Street address"><Input value={form.line1} onChange={(e) => setForm({ ...form, line1: e.target.value })} placeholder="14 Admiralty Way" /></Field>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <Field label="Area"><Input value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} /></Field>
            <Field label="City"><Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></Field>
          </div>
          <Field label="Landmark / note"><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Blue gate, call on arrival" /></Field>
        </div>
      </Modal>
    </div>
  );
}

/* ------------------------------ notifications ----------------------------- */

export function Notifications() {
  const [data, setData] = useState(null);
  const nav = useNavigate();
  const toast = useToast();

  /*
   * Opening this screen used to mark everything read before the customer had
   * read a word of it, so the badge cleared and the unread mark was a lie. Now a
   * row is marked read when it is opened, and "Mark all as read" is a decision
   * the customer makes.
   */
  const [error, setError] = useState(null);
  const load = () => {
    setError(null);
    return api.get('/api/notifications').then(setData).catch(setError);
  };
  useEffect(() => { load(); }, []);
  useAutoRetry(load, Boolean(error));

  const openOne = async (n) => {
    try {
      if (!n.read) {
        await api.post('/api/notifications/read', { id: n.id });
        setData((d) => ({ ...d, notifications: d.notifications.map((x) => (x.id === n.id ? { ...x, read: true } : x)) }));
      }
      if (n.order_id) nav(`/orders/${n.order_id}`);
    } catch (e) { toast.error(e.message); }
  };

  const markAll = async () => {
    try {
      await api.post('/api/notifications/read', {});
      setData((d) => ({ ...d, notifications: d.notifications.map((x) => ({ ...x, read: true })) }));
      toast.success('All marked as read');
    } catch (e) { toast.error(e.message); }
  };

  if (!data && error) {
    return (
      <div className="page page-tight col">
        <SectionHead title="Notifications" />
        <LoadFailed what="your notifications" error={error} onRetry={load} />
      </div>
    );
  }
  if (!data) return <Loading />;
  const unread = data.notifications.filter((n) => !n.read).length;
  return (
    <div className="page page-tight col">
      <SectionHead
        title="Notifications"
        subtitle={unread ? `${unread} you have not opened` : 'Nothing waiting'}
        action={unread ? <Button size="sm" variant="ghost" onClick={markAll}>Mark all as read</Button> : null}
      />
      {data.notifications.length === 0 && <Empty icon="bell" title="All caught up" body="Order updates will show up here." />}
      <div className="col" style={{ gap: 8 }}>
        {data.notifications.map((n) => (
          <button
            key={n.id}
            className="card"
            onClick={() => openOne(n)}
            style={{
              textAlign: 'left', cursor: n.order_id ? 'pointer' : 'default', border: 'none', width: '100%',
              borderLeft: `3px solid ${n.read ? 'var(--line)' : n.kind === 'action' ? 'var(--orange)' : 'var(--green-600)'}`,
            }}
          >
            <div className="row-between" style={{ gap: 8 }}>
              <span className="strong" style={{ fontSize: 13.5 }}>{n.title}</span>
              <span className="tiny muted">{timeAgo(n.created_at)}</span>
            </div>
            <div className="sub" style={{ marginTop: 3 }}>{n.body}</div>
            {n.order_id && (
              <div className="tiny" style={{ marginTop: 6, color: 'var(--green-700)', fontWeight: 700 }}>
                Open the order <Icon name="right" size={11} style={{ verticalAlign: -1 }} />
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

/* --------------------------------- support -------------------------------- */

export function Support() {
  const [tickets, setTickets] = useState(null);
  const [orders, setOrders] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ subject: '', message: '', category: 'order', order_id: '' });
  const [reply, setReply] = useState({});
  const toast = useToast();

  const load = () => api.get('/api/support/tickets').then((r) => setTickets(r.tickets));
  useEffect(() => {
    load();
    api.get('/api/orders?limit=10').then((r) => setOrders(r.orders)).catch(() => {});
  }, []);

  const create = async () => {
    try {
      await api.post('/api/support/tickets', form);
      toast.success('Ticket created — we will reply shortly');
      setOpen(false);
      setForm({ subject: '', message: '', category: 'order', order_id: '' });
      load();
    } catch (e) { toast.error(e.message); }
  };

  const send = async (id) => {
    if (!reply[id]?.trim()) return;
    await api.post(`/api/support/tickets/${id}/messages`, { body: reply[id] });
    setReply({ ...reply, [id]: '' });
    load();
  };

  if (!tickets) return <Loading />;

  return (
    <div className="page page-tight col">
      <SectionHead title="Help & support" action={<Button size="sm" onClick={() => setOpen(true)}>New ticket</Button>} />
      <div className="card" style={{ background: 'var(--green-50)', borderColor: 'var(--green-100)' }}>
        <div className="row" style={{ gap: 12 }}>
          <Icon name="chat" size={22} style={{ color: 'var(--green-700)' }} />
          <div className="grow">
            <div className="strong">Need something urgently?</div>
            <div className="sub">Call +234 700 289 2899 or email support@buybuddy.ng</div>
          </div>
        </div>
      </div>

      {tickets.length === 0 && <Empty icon="chat" title="No tickets yet" body="Open a ticket if something goes wrong with an order." action={<Button onClick={() => setOpen(true)}>Contact support</Button>} />}

      <div className="col" style={{ gap: 10 }}>
        {tickets.map((t) => (
          <div key={t.id} className="card">
            <div className="row-between">
              <div>
                <div className="strong" style={{ fontSize: 13.5 }}>{t.subject}</div>
                <div className="tiny muted">{pretty(t.category)} · {timeAgo(t.created_at)}</div>
              </div>
              <StatusBadge status={t.status} />
            </div>
            <div className="col" style={{ gap: 6, marginTop: 10 }}>
              {t.messages.map((m) => (
                <div key={m.id} style={{ background: m.sender_role === 'admin' ? 'var(--green-50)' : '#f6f8f6', padding: '8px 11px', borderRadius: 10, fontSize: 13 }}>
                  <div className="tiny muted strong">{m.sender_role === 'admin' ? 'BUYBUDDY support' : 'You'} · {timeAgo(m.created_at)}</div>
                  {m.body}
                </div>
              ))}
            </div>
            {t.status !== 'resolved' && (
              <div className="row" style={{ gap: 8, marginTop: 10 }}>
                <Input value={reply[t.id] || ''} onChange={(e) => setReply({ ...reply, [t.id]: e.target.value })} placeholder="Add a reply…" />
                <Button size="sm" onClick={() => send(t.id)}>Send</Button>
              </div>
            )}
          </div>
        ))}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Contact support" footer={<Button block onClick={create}>Submit ticket</Button>}>
        <div className="col" style={{ gap: 12 }}>
          <Field label="Subject"><Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Issue with my order" /></Field>
          <Field label="Category">
            <select className="select" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              <option value="order">Order issue</option>
              <option value="payment">Payment or refund</option>
              <option value="delivery">Delivery</option>
              <option value="account">Account</option>
              <option value="general">Something else</option>
            </select>
          </Field>
          <Field label="Related order (optional)">
            <select className="select" value={form.order_id} onChange={(e) => setForm({ ...form, order_id: e.target.value })}>
              <option value="">None</option>
              {orders.map((o) => <option key={o.id} value={o.id}>{o.code} — {naira(o.total)}</option>)}
            </select>
          </Field>
          <Field label="How can we help?"><Textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></Field>
        </div>
      </Modal>
    </div>
  );
}
