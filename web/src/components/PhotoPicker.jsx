import React, { useRef, useState } from 'react';
import { Icon } from '../lib/ui.jsx';
import { uploadPhoto } from '../lib/photos.js';
import { assetUrl } from '../lib/api.js';

/**
 * Pick a photo — camera or gallery — and get a URL back.
 *
 * Deliberately not a URL text box: the person listing stock in a Lagos market
 * has photos on their phone, not links. On Android the file input opens the
 * camera directly, which is how a shopkeeper actually adds a new item.
 */
export default function PhotoPicker({
  value,
  onChange,
  label = 'Photo',
  hint = 'Take a photo of the item, or choose one from your gallery.',
  aspect = '1 / 1',
  size = 132,
  doneHint = 'Looks right? It appears on the product page straight away.',
  onError,
}) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');

  const pick = () => input.current?.click();

  const handle = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // choosing the same file twice should still work
    if (!file) return;
    setBusy(true);
    setProgress('Preparing…');
    try {
      const url = await uploadPhoto(file);
      onChange(url);
    } catch (err) {
      onError?.(err.message || 'That photo could not be uploaded.');
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

  const clear = () => onChange('');

  return (
    <div className="field">
      <span className="label">{label}</span>
      <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
        <button
          type="button"
          onClick={pick}
          disabled={busy}
          className="photo-slot"
          style={{ width: size, height: aspect === '1 / 1' ? size : undefined, aspectRatio: aspect }}
          aria-label={value ? 'Replace photo' : 'Add photo'}
        >
          {value ? (
            <img src={assetUrl(value)} alt="" />
          ) : (
            <span className="photo-slot-empty">
              <Icon name={busy ? 'clock' : 'camera'} size={22} />
              <span>{busy ? progress || 'Uploading…' : 'Add photo'}</span>
            </span>
          )}
          {busy && <span className="photo-slot-busy" />}
        </button>

        <div className="col" style={{ gap: 6, flex: 1 }}>
          {value ? (
            <>
              <div className="row" style={{ gap: 8 }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={pick} disabled={busy}>
                  <Icon name="camera" size={14} /> Replace
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={clear} disabled={busy}>
                  <Icon name="x" size={14} /> Remove
                </button>
              </div>
              <span className="hint">{doneHint}</span>
            </>
          ) : (
            <span className="hint">{busy ? progress || 'Uploading…' : hint}</span>
          )}
        </div>
      </div>

      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handle}
        style={{ display: 'none' }}
      />
    </div>
  );
}
