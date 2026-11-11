import React, { useEffect, useState } from 'react';
import { TEXT_SIZES, applyTextSize, getTextSize } from '../lib/textsize.js';

/*
 * A three-way size switch that shows the customer the result as they press it —
 * the sample sentence is rendered at the chosen size in a card of its own, so
 * nobody has to save and go back to find out what "Extra large" means.
 */
export default function TextSizeControl({ compact = false }) {
  const [size, setSize] = useState(() => getTextSize());

  useEffect(() => {
    const sync = (e) => setSize(e.detail || getTextSize());
    window.addEventListener('bb:textsize', sync);
    return () => window.removeEventListener('bb:textsize', sync);
  }, []);

  const choose = (id) => setSize(applyTextSize(id));

  return (
    <div className="col" style={{ gap: 10 }}>
      <div role="group" aria-label="Text size" className="textsize-switch">
        {TEXT_SIZES.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`textsize-option${size === t.id ? ' active' : ''}`}
            aria-pressed={size === t.id}
            onClick={() => choose(t.id)}
          >
            <span className="strong">{t.label}</span>
            <span className="tiny muted">{t.hint}</span>
          </button>
        ))}
      </div>
      {!compact && (
        <div className="textsize-sample" aria-live="polite">
          <div className="strong">A bag of rice, 5 kg — ₦9,400</div>
          <div className="sub">Free delivery over ₦15,000 in Lekki Phase 1.</div>
        </div>
      )}
    </div>
  );
}
