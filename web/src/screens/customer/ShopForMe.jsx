import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { askConfirm } from '../../lib/ask.jsx';
import { api, naira, toDataUrl, assetUrl } from '../../lib/api.js';
import {
  Badge, Button, Field, Icon, Input, Loading, Modal, Select, Textarea, useToast,
} from '../../lib/ui.jsx';

const BLANK = () => ({ description: '', qty: 1, target_price: '', image: null, note: '' });

export default function ShopForMe() {
  const [items, setItems] = useState([BLANK()]);
  const [addresses, setAddresses] = useState([]);
  const [stores, setStores] = useState([]);
  const [form, setForm] = useState({
    address_id: '', store_id: '', service_level: 'standard', payment_method: 'paystack',
    instructions: '', notes: '', budget: '',
  });
  const [busy, setBusy] = useState(false);
  const [savedLists, setSavedLists] = useState([]);
  const [saveOpen, setSaveOpen] = useState(false);
  const [listName, setListName] = useState('');
  const [scheduled, setScheduled] = useState('');
  const [idemKey] = useState(() => (crypto.randomUUID ? crypto.randomUUID() : `sfm-${Date.now()}`));
  const toast = useToast();
  const nav = useNavigate();

  useEffect(() => {
    api.get('/api/addresses').then((r) => {
      setAddresses(r.addresses);
      const def = r.addresses.find((a) => a.is_default) || r.addresses[0];
      if (def) setForm((f) => ({ ...f, address_id: def.id }));
    });
    api.get('/api/stores?limit=50').then((r) => setStores(r.stores)).catch(() => {});
    loadSaved();
  }, []);

  const loadSaved = () => api.get('/api/saved-lists').then((r) => setSavedLists(r.lists)).catch(() => {});

  const applySaved = (id) => {
    const list = savedLists.find((l) => l.id === id);
    if (!list) return;
    setItems(list.items.map((i) => ({ ...BLANK(), ...i, target_price: i.target_price ?? '', image: null })));
    setForm((f) => ({ ...f, budget: String(list.items.reduce((s, i) => s + (i.target_price || 0) * i.qty, 0) || '') }));
    toast.success(`Loaded “${list.name}”`);
  };

  const saveList = async () => {
    const clean = items.filter((i) => i.description.trim());
    if (!clean.length) return toast.error('Add an item first.');
    try {
      await api.post('/api/saved-lists', { name: listName || 'My list', items: clean });
      setSaveOpen(false);
      setListName('');
      loadSaved();
      toast.success('List saved for next time');
    } catch (e) { toast.error(e.message); }
  };

  const deleteSaved = async (id) => {
    await api.del(`/api/saved-lists/${id}`);
    loadSaved();
  };

  const estimated = items.reduce((s, i) => s + (Number(i.target_price || 0) * Number(i.qty || 1)), 0);
  const budget = Number(form.budget || estimated || 0);

  const setItem = (idx, patch) => setItems((p) => p.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  const removeItem = (idx) => setItems((p) => (p.length === 1 ? p : p.filter((_, i) => i !== idx)));
  const addItem = () => setItems((p) => [...p, BLANK()]);

  const upload = async (idx, file) => {
    try {
      const dataUrl = await toDataUrl(file);
      const res = await api.post('/api/uploads', { data_url: dataUrl, file_name: file.name });
      setItem(idx, { image: res.url });
      toast.success('Photo attached');
    } catch (e) { toast.error(e.message); }
  };

  const submit = async () => {
    const clean = items.filter((i) => i.description.trim());
    if (!clean.length) return toast.error('Add at least one item.');
    if (!form.address_id) return toast.error('Choose a delivery address.');
    if (!budget || budget < 1000) return toast.error('Set a budget of at least ₦1,000.');
    if (clean.some((i) => !i.target_price)) {
      const go = await askConfirm({
        title: 'Some prices are missing',
        message: 'Your shopper will find the item and propose a price, and nothing is bought until you approve it.',
        detail: 'You are only charged the delivery and shopping fee to start. If the real basket costs more than your budget, the app asks you again before anything is bought.',
        confirmLabel: 'Continue to shopping list',
      });
      if (!go) return;
    }
    setBusy(true);
    try {
      const res = await api.post('/api/shopping/requests', {
        address_id: form.address_id,
        payment_method: form.payment_method,
        service_level: form.service_level,
        store_id: form.store_id || undefined,
        budget,
        instructions: form.instructions,
        notes: form.notes,
        scheduled_for: scheduled || undefined,
        idempotency_key: idemKey,
        items: clean.map((i) => ({
          description: i.description,
          qty: Number(i.qty || 1),
          target_price: i.target_price ? Number(i.target_price) : undefined,
          image: i.image || undefined,
          note: i.note || undefined,
        })),
      }, { headers: { 'Idempotency-Key': idemKey } });

      if (res.payment?.authorization_url && !res.payment.paid) {
        if (res.payment.sandbox) nav(`/pay/${res.payment.reference}`);
        else window.location.href = res.payment.authorization_url;
        return;
      }
      toast.success('Shopping request submitted!');
      nav(`/orders/${res.order.id}`);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page page-tight col" style={{ gap: 14 }}>
      <div className="hero hero-orange" style={{ padding: 20 }}>
        <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
          <div style={{ width: 52, height: 52, borderRadius: 16, background: 'rgba(255,255,255,0.2)', display: 'grid', placeItems: 'center', flex: 'none' }}>
            <Icon name="bag" size={26} />
          </div>
          <div>
            <div className="h2">Shop for me</div>
            <div style={{ opacity: 0.9, fontSize: 13.5, marginTop: 4, lineHeight: 1.5 }}>
              Send a list or a photo of anything. A verified BUYBUDDY shopper buys it, uploads the receipt,
              and a rider brings it to your door.
            </div>
          </div>
        </div>
      </div>

      {(savedLists.length > 0 || items.some((i) => i.description.trim())) && (
        <div className="card col" style={{ gap: 10 }}>
          <div className="row-between">
            <div className="h3">Saved lists</div>
            <Button size="sm" variant="ghost" onClick={() => setSaveOpen(true)}>
              <Icon name="plus" size={13} /> Save this list
            </Button>
          </div>
          {savedLists.length === 0
            ? <div className="sub">Save a list once and reorder your usual basket in one tap.</div>
            : (
              <div className="col" style={{ gap: 8 }}>
                {savedLists.map((l) => (
                  <div key={l.id} className="row" style={{ gap: 8 }}>
                    <button className="chip grow" style={{ textAlign: 'left' }} onClick={() => applySaved(l.id)}>
                      🧾 {l.name} · {l.items.length} item{l.items.length === 1 ? '' : 's'}
                    </button>
                    <button className="btn btn-ghost btn-icon" onClick={() => deleteSaved(l.id)} aria-label="Delete list">
                      <Icon name="x" size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
        </div>
      )}

      <section className="card col" style={{ gap: 12 }}>
        <div className="row-between">
          <div className="h3">What do you need?</div>
          <Badge>{items.length} item(s)</Badge>
        </div>

        {items.map((it, idx) => (
          <div key={idx} className="tile col" style={{ gap: 10, background: '#fbfcfb' }}>
            <div className="row-between">
              <span className="tiny muted strong">ITEM {idx + 1}</span>
              {items.length > 1 && (
                <button className="btn btn-ghost btn-icon" style={{ padding: 4 }} onClick={() => removeItem(idx)} aria-label="Remove item">
                  <Icon name="x" size={14} />
                </button>
              )}
            </div>
            <Input value={it.description} onChange={(e) => setItem(idx, { description: e.target.value })}
              placeholder="e.g. Cerelac baby cereal 400g, or “the perfume in this photo”" />
            <div className="row" style={{ gap: 8 }}>
              <Field label="Qty"><Input type="number" min="1" value={it.qty} onChange={(e) => setItem(idx, { qty: e.target.value })} style={{ width: 78 }} /></Field>
              <Field label="Expected price (₦)"><Input type="number" min="0" value={it.target_price} onChange={(e) => setItem(idx, { target_price: e.target.value })} placeholder="Optional" /></Field>
              <Field label="Photo">
                <label className="btn btn-ghost" style={{ height: 42 }}>
                  <Icon name="camera" size={16} /> {it.image ? 'Change' : 'Add'}
                  <input type="file" accept="image/*" hidden onChange={(e) => e.target.files[0] && upload(idx, e.target.files[0])} />
                </label>
              </Field>
            </div>
            {it.image && (
              <div className="row" style={{ gap: 8 }}>
                <img src={assetUrl(it.image)} alt="attachment" style={{ width: 54, height: 54, borderRadius: 10, objectFit: 'cover' }} />
                <span className="tiny muted">Photo attached</span>
              </div>
            )}
            <Input value={it.note} onChange={(e) => setItem(idx, { note: e.target.value })} placeholder="Brand/colour/size preference (optional)" />
          </div>
        ))}

        <Button variant="ghost" onClick={addItem}><Icon name="plus" size={15} /> Add another item</Button>
      </section>

      <section className="card col" style={{ gap: 12 }}>
        <div className="h3">Details</div>
        <Field label="Preferred store (optional)" hint="Leave empty and your shopper will choose the best store near you.">
          <Select value={form.store_id} onChange={(e) => setForm({ ...form, store_id: e.target.value })}>
            <option value="">Let my shopper decide</option>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name} — {s.area}</option>)}
          </Select>
        </Field>
        <Field label="Budget (₦)" hint="Your shopper will not buy beyond the approved amount without asking you.">
          <Input type="number" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })}
            placeholder={estimated ? String(estimated) : '15000'} />
        </Field>
        <Field label="Delivery address">
          <Select value={form.address_id} onChange={(e) => setForm({ ...form, address_id: e.target.value })}>
            {addresses.map((a) => <option key={a.id} value={a.id}>{a.label} — {a.line1}, {a.area}</option>)}
          </Select>
        </Field>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Service level">
            <Select value={form.service_level} onChange={(e) => setForm({ ...form, service_level: e.target.value })}>
              <option value="standard">Standard (25–45 min)</option>
              <option value="express">Express (15–25 min)</option>
            </Select>
          </Field>
          <Field label="Payment">
            <Select value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value })}>
              <option value="paystack">Card / transfer</option>
              <option value="wallet">BUYBUDDY wallet</option>
              <option value="cash">Cash on delivery</option>
            </Select>
          </Field>
        </div>
        <Field label="Schedule for later (optional)" hint="At least 1 hour ahead, up to 7 days.">
          <Input type="datetime-local" value={scheduled} onChange={(e) => setScheduled(e.target.value)} />
        </Field>
        <Field label="Instructions for your shopper">
          <Textarea value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })}
            placeholder="e.g. Buy the exact brand; if unavailable, anything under ₦5,000 is fine. Please send photos." />
        </Field>
        <Field label="Note for the rider (optional)">
          <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Call when you reach the gate" />
        </Field>
      </section>

      <section className="card">
        <div className="row-between">
          <div>
            <div className="sub">Estimated items</div>
            <div className="h3 mono">{naira(estimated)}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="sub">Your budget</div>
            <div className="h3 mono">{naira(budget)}</div>
          </div>
        </div>
        <div className="divider" />
        <p className="tiny muted">
          A shopper fee ({naira(300)} + 8%) and delivery are added at checkout. You approve every substitution and
          price change before the shopper buys — nothing is charged without your approval.
        </p>
        <Button size="lg" block style={{ marginTop: 12 }} onClick={submit} disabled={busy}>
          {busy ? 'Sending request…' : 'Submit request & pay'}
        </Button>
      </section>

      <Modal open={saveOpen} onClose={() => setSaveOpen(false)} title="Save this list"
        footer={<Button block onClick={saveList}>Save list</Button>}>
        <Field label="List name">
          <Input value={listName} onChange={(e) => setListName(e.target.value)} placeholder="Weekly groceries" />
        </Field>
        <p className="tiny muted" style={{ marginTop: 10 }}>
          Saved lists keep item names, quantities and expected prices so you can repeat this request in one tap.
        </p>
      </Modal>
    </div>
  );
}
