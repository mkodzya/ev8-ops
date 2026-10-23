import type { MoneyChange, MoneyTarget } from '@ev8/shared';
import { fmtDate, fmtDayMonth, formatGel } from '../format.js';
import { useT } from '../i18n/index.js';
import { chargeWords } from '../lib/charges.js';
import { Row } from './Wizard.js';

/** A payment the change moves, as a person knows it: the day, the sum, how it came. */
export interface MovedPayment {
  id: string;
  occurredOn: string | null;
  grossTetri: number;
  channel: string;
}

/** A charge of the rental as its card names it: its kind, and its note. */
export interface ChargeName {
  id: string;
  kind: string;
  note: string | null;
}

const gel = (tetri: number) => formatGel(tetri, { decimals: false });

/**
 * What a correction of a rental does to its money, before it is written
 * (ADR-0044; ux.md №14, №15): the weeks — their days before and after, what
 * is paid on each — the deposit, every payment whose money lands elsewhere,
 * the debt and «оплачено по» before and after. The sheet of a new hand-over
 * date shows the weeks' days; the deposit's sheet only the weeks whose money moves.
 */
export function MoneyChangeView({ change, payments, charges, days }: { change: MoneyChange; payments: MovedPayment[]; charges: ChargeName[]; days: boolean }) {
  const t = useT();
  const w = t.pickupDate;
  const span = (d: { startsOn: string; endsOn: string }) => w.span(fmtDayMonth(d.startsOn), fmtDayMonth(d.endsOn));
  // A charge by its kind and note, as the card names it.
  const chargeName = (id: string | undefined) => {
    const c = charges.find((x) => x.id === id);
    return c ? chargeWords(t, c.kind, c.note) : w.target.anyCharge;
  };
  const target = (x: MoneyTarget) =>
    x.kind === 'deposit' ? w.target.deposit(gel(x.amountTetri)) : x.kind === 'week' ? w.target.week(x.seq ?? 0, gel(x.amountTetri)) : x.kind === 'charge' ? w.target.charge(chargeName(x.chargeId), gel(x.amountTetri)) : w.target.credit(gel(x.amountTetri));
  const targets = (list: MoneyTarget[]) => (list.length > 0 ? list.map(target).join(', ') : t.common.dash);
  const channels = t.payments.channels as Record<string, string>;
  const paymentLabel = (id: string) => {
    const p = payments.find((x) => x.id === id);
    return p ? w.payment(fmtDate(p.occurredOn), gel(p.grossTetri), channels[p.channel] ?? p.channel) : t.common.dash;
  };
  const weeks = days ? change.weeks : change.weeks.filter((x) => x.paidWas !== x.paidNow);
  const d = change.deposit;
  return (
    <section className="card settle">
      {weeks.map((x) => {
        // Its days on each side: moved, gone, or opened now.
        const when = !days ? null : x.was && x.now ? `${span(x.was)} → ${span(x.now)}` : x.was ? `${span(x.was)} · ${w.goes}` : x.now ? w.opens(span(x.now)) : null;
        const paid = x.paidWas !== x.paidNow ? `${gel(x.paidWas)} → ${w.paidOf(gel(x.paidNow), gel(x.amountTetri))}` : w.paidOf(gel(x.paidNow), gel(x.amountTetri));
        return <Row key={x.seq} k={when ? `${w.week(x.seq)} · ${when}` : w.week(x.seq)} v={<span className="mono">{paid}</span>} />;
      })}
      {d && d.paidWas !== d.paidNow && (
        <Row k={t.rentals.deposit} v={<span className="mono">{`${gel(d.paidWas)} → ${w.paidOf(gel(d.paidNow), gel(d.amountTetri))}`}</span>} />
      )}
      {change.moves.length === 0 ? (
        <p className="hint muted">{w.noMoves}</p>
      ) : (
        change.moves.map((m) => <Row key={m.paymentId} k={paymentLabel(m.paymentId)} v={<span className="mono">{`${targets(m.was)} → ${targets(m.now)}`}</span>} />)
      )}
      <Row k={w.debt} v={<span className="mono">{`${formatGel(change.owes.was)} → ${formatGel(change.owes.now)}`}</span>} />
      <Row k={t.rentals.paidThrough} v={<span className="mono">{`${fmtDate(change.paidThrough.was)} → ${fmtDate(change.paidThrough.now)}`}</span>} />
    </section>
  );
}
