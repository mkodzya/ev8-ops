import { addDays } from '@ev8/shared';
import { useState } from 'react';
import { api } from '../api.js';
import { Drawer } from './Drawer.js';
import { fmtDate, formatGel } from '../format.js';
import { useT } from '../i18n/index.js';
import { useLoad } from '../lib/use.js';

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
  /**
   * The day the week being reminded about begins, when the caller knows it —
   * the payments calendar does. Without it "tomorrow" is the day after
   * paid-through, which is another day behind an older unpaid week.
   */
  dueOn?: string | null;
  /**
   * What that week still asks for, when the caller's row shows it — the sum
   * "tomorrow" names. Without it the sum is the rental's weekly rate: nought
   * until the rental has loaded, and the whole week even when part of it is
   * paid already.
   */
  amountTetri?: number | null;
}

/** What each template puts into the text: a template about the next week is not about the debt (QA-W4-02). */
interface Rental {
  rental: { paidThrough: string | null; weeklyRateTetri: number; debtTetri: number };
}

const digits = (s: string) => s.replace(/\D/g, '');

/**
 * `kind` opens the sheet on a template the caller's button has already named
 * ("remind: payment tomorrow"). Without it the debt chooses, as before.
 */
export function WhatsappSheet({ target, onClose, kind: opensOn }: { target: WaTarget; onClose: () => void; kind?: WaKind }) {
  const t = useT();
  const [kind, setKind] = useState<WaKind>(opensOn ?? (target.debtTetri > 0 ? 'overdue' : 'tomorrow'));
  const [lang, setLang] = useState<WaLang>('ka');
  // The rental itself answers what the next week costs and when it starts;
  // the row that opened this sheet only knows the debt.
  const card = useLoad<Rental>(target.rentalId ? `/api/rentals/${target.rentalId}` : null);
  const paidThrough = card.data?.rental.paidThrough ?? target.paidThrough;
  const debtTetri = card.data?.rental.debtTetri ?? target.debtTetri;
  const weekTetri = card.data?.rental.weeklyRateTetri ?? 0;
  const text = t.wa.text(lang, kind, {
    name: target.name,
    number: target.number,
    // "Overdue" is about the day it was paid through; "tomorrow" about the day the new week starts.
    date: fmtDate(kind === 'overdue' ? paidThrough : (target.dueOn ?? (paidThrough ? addDays(paidThrough, 1) : null))).slice(0, 5),
    amount: formatGel(kind === 'overdue' ? debtTetri : (target.amountTetri ?? weekTetri), { decimals: false }),
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
