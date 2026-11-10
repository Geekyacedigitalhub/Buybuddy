/**
 * In-app prompts.
 *
 * Browser `prompt()` and `confirm()` look like a 1998 error box, they cannot show
 * presets, they cannot explain consequences, and on a phone they are sometimes
 * blocked outright. This gives the app one ask-sheet that looks like the rest of
 * BUYBUDDY and returns a promise, so a screen reads almost exactly as it did:
 *
 *   const reason = await askText({ title: 'Why?', presets: [...] });
 *   if (reason === null) return;   // they changed their mind
 *
 * <AskHost /> is mounted once, next to the toasts.
 */
import React, { useEffect, useState } from 'react';
import { Button, Icon, Modal, Textarea } from './ui.jsx';

let listener = null;
let seq = 0;

function push(request) {
  return new Promise((resolve) => {
    if (!listener) {
      // no host mounted (should never happen) — never leave the caller hanging
      console.warn('[ask] no AskHost mounted');
      resolve(null);
      return;
    }
    listener({ ...request, id: ++seq, resolve });
  });
}

export const askText = (options) => push({ mode: 'text', ...options });
export const askConfirm = (options) => push({ mode: 'confirm', ...options });

export function AskHost() {
  const [req, setReq] = useState(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    listener = (request) => {
      setValue(request.defaultValue == null ? '' : String(request.defaultValue));
      setError('');
      setReq(request);
    };
    return () => { listener = null; };
  }, []);

  if (!req) return null;

  const close = (answer) => {
    req.resolve(answer);
    setReq(null);
    setValue('');
    setError('');
  };

  const submit = () => {
    if (req.mode === 'confirm') return close(true);
    const text = value.trim();
    if (req.required !== false && text.length < (req.min || 3)) {
      return setError(req.errorMessage || 'Type a few words so the other person knows what to do.');
    }
    if (req.inputType === 'number' && !(Number(text) > 0)) {
      return setError('Enter a number greater than zero.');
    }
    close(text);
  };

  const confirmLabel = req.confirmLabel
    || (req.mode === 'confirm' ? 'Yes, continue' : 'Save');

  return (
    <div className="ask-layer">
    <Modal
      open
      onClose={() => close(req.mode === 'confirm' ? false : null)}
      title={req.title || 'One thing before you continue'}
      footer={(
        <div className="col" style={{ gap: 10 }}>
          {error && <div className="tiny" style={{ color: 'var(--danger)' }}>{error}</div>}
          <div className="row" style={{ gap: 8 }}>
            <Button variant="ghost" className="grow" onClick={() => close(req.mode === 'confirm' ? false : null)}>
              {req.cancelLabel || 'Cancel'}
            </Button>
            <Button
              variant={req.danger ? 'danger' : 'primary'}
              className="grow"
              onClick={submit}
              disabled={req.mode === 'text' && req.required !== false && value.trim().length < (req.min || 3)}
            >
              {confirmLabel}
            </Button>
          </div>
        </div>
      )}
    >
      {req.message && <div className="sub" style={{ marginBottom: 12, lineHeight: 1.55 }}>{req.message}</div>}

      {req.mode === 'text' && (
        <>
          {Array.isArray(req.presets) && req.presets.length > 0 && (
            <div className="row wrap" style={{ gap: 6, marginBottom: 8 }}>
              {req.presets.map((r) => (
                <button
                  key={r}
                  type="button"
                  className={`chip ${value === r ? 'active' : ''}`}
                  onClick={() => { setValue(r); setError(''); }}
                >
                  {r}
                </button>
              ))}
            </div>
          )}
          {req.label && <div className="label" style={{ marginBottom: 6 }}>{req.label}</div>}
          {req.multiline === false ? (
            <input
              className="input"
              autoFocus
              type={req.inputType === 'number' ? 'number' : 'text'}
              value={value}
              placeholder={req.placeholder || ''}
              onChange={(e) => { setValue(e.target.value); setError(''); }}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
          ) : (
            <Textarea
              autoFocus
              rows={3}
              value={value}
              placeholder={req.placeholder || ''}
              onChange={(e) => { setValue(e.target.value); setError(''); }}
            />
          )}
        </>
      )}

      {req.mode === 'confirm' && req.detail && (
        <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
          <Icon name="bell" size={16} style={{ color: 'var(--orange-ink)', marginTop: 2 }} />
          <div className="tiny muted" style={{ lineHeight: 1.6 }}>{req.detail}</div>
        </div>
      )}
    </Modal>
    </div>
  );
}
