import { useState } from 'react';
import { api } from '../api.js';
import { Drawer } from './Drawer.js';
import { fmtDate, formatGel } from '../format.js';
import { useT } from '../i18n/index.js';

// WhatsApp from a row (wave 4 §3.2, decision В6): the ready text in the
// customer's language, sent by a person from their own phone. When the Meta
// token arrives (B11-01) the same templates go out on a schedule.

export type WaKind = 'overdue' | 'tomorrow';
export type WaLang = 'ka' | 'ru' | 'en';

export interface WaTarget {
  rentalId: string | null;
  number: string;
  name: string;
  phone: string;
  paidThrough: string | null;
  debtTetri: number;
}

const digits = (s: string) => s.replace(/\D/g, '');

export function WhatsappSheet({ target, onClose }: { target: WaTarget; onClose: () => void }) {
  const t = useT();
  const [kind, setKind] = useState<WaKind>(target.debtTetri > 0 ? 'overdue' : 'tomorrow');
  const [lang, setLang] = useState<WaLang>('ka');
  const text = t.wa.text(lang, kind, {
    name: target.name,
    number: target.number,
    date: fmtDate(target.paidThrough).slice(0, 5),
    amount: formatGel(target.debtTetri, { decimals: false }),
  });

  const open = () => {
    // The row says it happened, even though the message is sent by hand (В6).
    if (target.rentalId) void api.post(`/api/rentals/${target.rentalId}/whatsapp`, { template: kind, lang }).catch(() => undefined);
    window.open(`https://wa.me/${digits(target.phone)}?text=${encodeURIComponent(text)}`, '_blank', 'noreferrer');
    onClose();
  };

  return (
    <Drawer title={t.wa.title(target.name)} onClose={onClose}>
      <span className="lbl">{t.wa.template}</span>
      <div className="chips">
        {(['overdue', 'tomorrow'] as WaKind[]).map((k) => (
          <button key={k} type="button" className={`pill pill-sm ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>
            {k === 'overdue' ? t.wa.overdue : t.wa.tomorrow}
          </button>
        ))}
      </div>
      <span className="lbl">{t.wa.lang}</span>
      <div className="chips">
        {(['ka', 'ru', 'en'] as WaLang[]).map((l) => (
          <button key={l} type="button" className={`pill pill-sm ${lang === l ? 'on' : ''}`} onClick={() => setLang(l)}>
            {t.lang[l]}
          </button>
        ))}
      </div>
      <p className="wa-text">{text}</p>
      <p className="hint muted">{t.wa.note}</p>
      <button type="button" className="pill pill-accent submit-wide" onClick={open}>
        {t.wa.open}
      </button>
    </Drawer>
  );
}
