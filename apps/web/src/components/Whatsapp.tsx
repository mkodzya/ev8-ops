import { addDays, todayISO, waOffered, waTemplatesOf, type WaTemplate } from '@ev8/shared';
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

export type WaKind = WaTemplate;
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
   * paid-through, which is another day behind an older unpaid week. "Today"
   * does not read it: its day is today.
   */
  dueOn?: string | null;
  /**
   * What that week still asks for, when the caller's row shows it — the sum
   * "tomorrow" and "today" name. Without it "tomorrow" names the rental's
   * weekly rate — the whole week even when part of it is paid already — and
   * "today" what the rental itself says is awaited today; both are read from
   * the rental, and the sheet waits for it.
   */
  amountTetri?: number | null;
}

/** What each template puts into the text: a template about the next week is not about the debt (QA-W4-02). */
interface Rental {
  rental: { status: string; pickedUpOn: string | null; paidThrough: string | null; weeklyRateTetri: number; debtTetri: number; dueTodayTetri: number };
}

const digits = (s: string) => s.replace(/\D/g, '');

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
  // to go out with a week at 0 ₾, or with «оплачено по —» for a rental that
  // does have a paid week. (A rental never paid has no such day at all: its
  // «Просрочка» still reads «оплачено по —», as before — a wording for it is
  // the owner's to approve, note §7.)
  const ready = !target.rentalId || card.data != null;
  const rental = card.data?.rental ?? null;
  const today = todayISO();
  // Is there a ready message for this rental today — the shared rule, the one
  // the buttons that open this sheet are drawn by: none on the day it was
  // handed over. Reached by another door (a stale list), the sheet says so.
  const offered = !rental || waOffered(rental.status, rental.pickedUpOn, today);
  // The state answers only when it is a state of the rent: a rental due today
  // has «Сегодня оплата» and nothing else, a late one opens on «Просрочка».
  // For every other rental the debt chooses, as before — a returned, paused or
  // disputed one with a debt, or a deposit not paid in. The shared rule.
  const templates = waTemplatesOf(rental?.status ?? null, target.debtTetri);
  // A chip pressed, then the template the caller's button named, then the
  // rule — and never one the rental's state does not offer today.
  const kind = [picked, opensOn].find((k): k is WaKind => !!k && templates.all.includes(k)) ?? templates.first;
  const names: Record<WaKind, string> = { overdue: t.wa.overdue, tomorrow: t.wa.tomorrow, today: t.wa.today };
  const paidThrough = rental?.paidThrough ?? target.paidThrough;
  const debtTetri = rental?.debtTetri ?? target.debtTetri;
  const weekTetri = rental?.weeklyRateTetri ?? 0;
  // "Today": what is left of the week that began today — the rent awaited
  // today, without the deposit, as «Завтра оплата» names the week alone.
  const todayTetri = rental && rental.dueTodayTetri > 0 ? rental.dueTodayTetri : weekTetri;
  const text = t.wa.text(lang, kind, {
    name: target.name,
    number: target.number,
    // "Overdue" is about the day it was paid through; "tomorrow" about the day the new week starts; "today" about today.
    date: fmtDate(kind === 'overdue' ? paidThrough : kind === 'today' ? today : (target.dueOn ?? (paidThrough ? addDays(paidThrough, 1) : null))).slice(0, 5),
    amount: formatGel(kind === 'overdue' ? debtTetri : (target.amountTetri ?? (kind === 'today' ? todayTetri : weekTetri)), { decimals: false }),
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
            {templates.all.map((k) => (
              <button key={k} type="button" className={`pill pill-sm ${kind === k ? 'on' : ''}`} onClick={() => setPicked(k)}>
                {names[k]}
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
