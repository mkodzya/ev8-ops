import { addDays, todayISO } from '@ev8/shared';
import { useState } from 'react';
import { api } from '../api.js';
import { Skeleton } from '../ds/state/Skeleton.js';
import { Drawer } from './Drawer.js';
import { LoadError } from './LoadError.js';
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
   * "tomorrow" names. Without it the sum is the rental's weekly rate, read
   * from the rental itself — the sheet waits for it — and the whole week even
   * when part of it is paid already.
   */
  amountTetri?: number | null;
}

/** What each template puts into the text: a template about the next week is not about the debt (QA-W4-02). */
interface Rental {
  rental: { status: string; pickedUpOn: string | null; paidThrough: string | null; weeklyRateTetri: number; debtTetri: number };
}

const digits = (s: string) => s.replace(/\D/g, '');

/**
 * Is there a ready message for a rental in this state today (ADR-0017)? For
 * one that is due today there is none: «Просрочка» calls a week that began
 * this morning a debt, «Завтра оплата» says "tomorrow" with today's date, and
 * a text for the due day itself goes to a customer only after the owner has
 * read it. So the buttons that open this sheet are not drawn for such a
 * rental, and the sheet says so when it is reached by another door.
 * The pickup day and today are asked for already: with the owner's text the
 * rule narrows to the hand-over day, and no caller changes.
 */
export function waOffered(status: string, pickedUpOn: string | null, today: string): boolean {
  return status !== 'due_today';
}

/**
 * `kind` opens the sheet on a template the caller's button has already named
 * ("remind: payment tomorrow"). Without it the rental's state chooses.
 */
export function WhatsappSheet({ target, onClose, kind: opensOn }: { target: WaTarget; onClose: () => void; kind?: WaKind }) {
  const t = useT();
  // Null until somebody presses a chip: before that the rule below chooses.
  const [picked, setPicked] = useState<WaKind | null>(null);
  const [lang, setLang] = useState<WaLang>('ka');
  // The rental itself answers what the next week costs, how far it is paid
  // and what it is called today; the row that opened this sheet only knows
  // the debt.
  const card = useLoad<Rental>(target.rentalId ? `/api/rentals/${target.rentalId}` : null);
  // The sheet waits for the rental (ADR-0017). Until it has loaded there is
  // nothing to choose and nothing to send: on a slow connection the text used
  // to go out with «оплачено по —» or a week at 0 ₾.
  const ready = !target.rentalId || card.data != null;
  const rental = card.data?.rental ?? null;
  const offered = !rental || waOffered(rental.status, rental.pickedUpOn, todayISO());
  // The state answers only when it is a state of the rent: a late rental opens
  // on «Просрочка». For every other rental the debt chooses, as before — a
  // returned, paused or disputed one with a debt, or a deposit not paid in.
  const byRule: WaKind = rental?.status === 'overdue' || target.debtTetri > 0 ? 'overdue' : 'tomorrow';
  const kind = picked ?? opensOn ?? byRule;
  const paidThrough = rental?.paidThrough ?? target.paidThrough;
  const debtTetri = rental?.debtTetri ?? target.debtTetri;
  const weekTetri = rental?.weeklyRateTetri ?? 0;
  const text = t.wa.text(lang, kind, {
    name: target.name,
    number: target.number,
    // "Overdue" is about the day it was paid through; "tomorrow" about the day the new week starts.
    date: fmtDate(kind === 'overdue' ? paidThrough : (target.dueOn ?? (paidThrough ? addDays(paidThrough, 1) : null))).slice(0, 5),
    amount: formatGel(kind === 'overdue' ? debtTetri : (target.amountTetri ?? weekTetri), { decimals: false }),
  });

  const open = () => {
    if (!ready || !offered) return;
    // The row says it happened, even though the message is sent by hand (В6).
    if (target.rentalId) void api.post(`/api/rentals/${target.rentalId}/whatsapp`, { template: kind, lang }).catch(() => undefined);
    window.open(`https://wa.me/${digits(target.phone)}?text=${encodeURIComponent(text)}`, '_blank', 'noreferrer');
    onClose();
  };

  // The rental did not load: say so and offer to try again. Nothing to send.
  if (!ready && card.failure) {
    return (
      <Drawer title={t.wa.title(target.name)} onClose={onClose}>
        <LoadError failure={card.failure} onRetry={card.reload} />
      </Drawer>
    );
  }
  // No ready message for this rental today: one line, no template, no button.
  if (ready && !offered) {
    return (
      <Drawer title={t.wa.title(target.name)} onClose={onClose}>
        <p className="muted">{t.wa.noneToday}</p>
      </Drawer>
    );
  }

  return (
    <Drawer title={t.wa.title(target.name)} onClose={onClose}>
      {ready ? (
        <>
          <span className="lbl">{t.wa.template}</span>
          <div className="chips">
            {(['overdue', 'tomorrow'] as WaKind[]).map((k) => (
              <button key={k} type="button" className={`pill pill-sm ${kind === k ? 'on' : ''}`} onClick={() => setPicked(k)}>
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
        </>
      ) : (
        // Bars in place of the templates and the text: the chips are not drawn
        // before the rental is known, so they never switch under a finger.
        <Skeleton rows={3} />
      )}
      <button type="button" className="pill pill-accent submit-wide" onClick={open} disabled={!ready}>
        {t.wa.open}
      </button>
    </Drawer>
  );
}
