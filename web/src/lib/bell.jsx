import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, timeAgo } from './api.js';
import { Button, Empty, Icon, Loading, Modal, useToast } from './ui.jsx';

/*
 * The bell in the topbar.
 *
 * Why this exists: a shopper proposes a substitute, or the office issues a
 * refund, and the customer had no way to learn about it unless they happened to
 * open the app and read a list. There is no push service yet (that needs a
 * Firebase project in the owner's own account), so this is the honest version of
 * the same idea: while the app is open it asks the server every 20 seconds, the
 * bell carries a count, and the moment something new arrives it says so out loud
 * with a toast. Closed app, no push — stated plainly in the sheet footer.
 */
const POLL_MS = 20000;

export function NotificationsBell({ role = 'customer' }) {
  const [summary, setSummary] = useState({ unread: 0, newest: null });
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState(false);
  const seenNewest = useRef(null);
  const firstRun = useRef(true);
  const toast = useToast();
  const nav = useNavigate();

  const loadSummary = useCallback(async () => {
    try {
      const s = await api.get('/api/notifications/summary');
      setSummary(s);
      const id = s.newest?.id || null;
      if (seenNewest.current && id && id !== seenNewest.current && !s.newest.read) {
        toast.push(`${s.newest.title} — ${s.newest.body}`.slice(0, 140));
      }
      seenNewest.current = id;
    } catch {
      /* offline or logged out — the bell simply keeps its last count */
    }
  }, [toast]);

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      loadSummary();
    }
    const tick = () => {
      if (document.hidden) return; // no point polling a screen nobody is looking at
      loadSummary();
    };
    const timer = setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [loadSummary]);

  const openSheet = async () => {
    setOpen(true);
    setItems(null);
    try {
      const r = await api.get('/api/notifications');
      setItems(r.notifications || []);
    } catch {
      setItems([]);
    }
  };

  const go = async (n) => {
    setBusy(true);
    try {
      if (!n.read) {
        await api.post('/api/notifications/read', { id: n.id });
        setItems((p) => (p || []).map((x) => (x.id === n.id ? { ...x, read: true } : x)));
        loadSummary();
      }
      if (n.order_id) {
        setOpen(false);
        nav(role === 'customer' ? `/orders/${n.order_id}` : `/worker/task/${n.order_id}`);
      }
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const markAll = async () => {
    setBusy(true);
    try {
      await api.post('/api/notifications/read', {});
      setItems((p) => (p || []).map((x) => ({ ...x, read: true })));
      loadSummary();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const unread = summary.unread || 0;

  return (
    <>
      <button
        className="btn btn-ghost btn-icon"
        style={{ position: 'relative' }}
        onClick={openSheet}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
      >
        <Icon name="bell" size={18} />
        {unread > 0 && (
          <span
            style={{
              position: 'absolute', top: -4, right: -4, background: '#b4551c', color: '#fff',
              borderRadius: 999, fontSize: 10, fontWeight: 800, minWidth: 17, height: 17,
              display: 'grid', placeItems: 'center', padding: '0 4px',
            }}
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Notifications"
        footer={unread > 0 ? <Button variant="ghost" block onClick={markAll} disabled={busy}>Mark all as read</Button> : null}
      >
        {items === null && <Loading label="Checking…" />}
        {items && items.length === 0 && (
          <Empty icon="bell" title="Nothing yet" body="Order updates, approvals and refunds show up here." />
        )}
        {items && items.length > 0 && (
          <div className="col" style={{ gap: 8 }}>
            {items.map((n) => (
              <button
                key={n.id}
                onClick={() => go(n)}
                className="card"
                style={{
                  textAlign: 'left', cursor: 'pointer', border: 'none', width: '100%',
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
            <div className="tiny muted" style={{ marginTop: 4, lineHeight: 1.5 }}>
              The bell checks while the app is open. For an alert when it is closed, BUYBUDDY needs a push-notification
              project in your own Firebase account — that is a setup step, not a bug.
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
