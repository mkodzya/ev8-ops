import { useState } from 'react';
import { api } from '../api.js';
import { SubmitButton } from '../ds/form/Form.js';
import { useOperation } from '../ds/form/operation.js';
import { useToast } from '../ds/feedback/Toast.js';
import { useT } from '../i18n/index.js';

// The Kommo field on a customer, a rental and a sale (wave 6 §3.10, B10-03).
//
// A link or a deal id, kept as typed, opening in Kommo. The link is one way
// only: Kommo cannot yet call back, because that needs the tariff with
// webhooks (register #5). A moped has no tracker field — no moped has a
// tracker (Kardu, `incidents.md`, Q31).

const looksLikeUrl = (s: string) => /^https?:\/\//i.test(s.trim());

export function KommoField({ url, value, onDone }: { url: string; value: string | null; onDone: () => void }) {
  const t = useT();
  const toast = useToast();
  const op = useOperation();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value ?? '');

  const save = async () => {
    const next = text.trim();
    const res = await op.run((key) => api.patch(url, { kommoRef: next || null }, { key }), `kommo:${next}`);
    if (!res.ok) return;
    setEditing(false);
    op.reset();
    toast({ text: next ? t.kommo.saved : t.kommo.cleared });
    onDone();
  };

  if (!editing) {
    return (
      <span className="inline-form">
        {value ? (
          looksLikeUrl(value) ? (
            <a href={value} target="_blank" rel="noreferrer">
              {t.kommo.open}
            </a>
          ) : (
            <span className="mono">{value}</span>
          )
        ) : (
          <span className="muted">{t.common.dash}</span>
        )}{' '}
        <button type="button" className="pill pill-sm" onClick={() => setEditing(true)}>
          {value ? t.models.edit : t.kommo.label}
        </button>
      </span>
    );
  }

  return (
    <span className="inline-form">
      <input className="input input-inline" value={text} autoFocus aria-label={t.kommo.label} placeholder={t.kommo.hint} onChange={(e) => setText(e.target.value)} />
      <SubmitButton small type="button" state={op.state} label={t.actions.save} onClick={() => void save()} />
      {op.failure && <span className="field-err">{op.failure.fieldText ?? op.failure.text}</span>}
    </span>
  );
}
