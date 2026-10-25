import { addDays, todayISO, utilisationPath, weekOf } from '@ev8/shared';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { LoadError } from '../components/LoadError.js';
import { Loading, PageHead } from '../components/ui.js';
import { fmtDate, formatGel } from '../format.js';
import { useLocale, useT } from '../i18n/index.js';
import { repairHoursText, type RepairHours } from '../lib/maintenance.js';
import { useLoad } from '../lib/use.js';

// "Отчёты → Неделя" (wave 6 §3.1): the figures of the book on one screen,
// for the Monday meeting. Three things hold this screen together.
//
//   * Every figure is a link to the list it is made of (ux №10). Where a list
//     cannot yet be filtered down to exactly this week — the fleet has no
//     filter in its address — the link goes to the list itself rather than to
//     a filter that would answer a different question.
//   * A figure nobody keeps is written out in words. "Замены батарей" reads
//     "нет данных — учёта нет", never 0 (crit. 2, CLAUDE.md rule 1), and the
//     battery count says out loud that it is today's.
//   * The period is in the address, so a week can be sent to somebody.
//
// "Скопировать в книгу" hands over the same rows as text: the decisions of
// the week live in `weekly/ГГГГ-ММ-ДД.md` and not here (`weekly.md`).

interface Week {
  from: string;
  to: string;
  asOf: string;
  today: string;
  fleet: { rented: number; freeInRentPool: number; inService: number; serviceLongestDays: number | null; repairs?: RepairHours };
  rentals: { started: number; returned: number; overdueCount: number; overdueTetri: number };
  money: {
    totalTetri: number;
    rentTetri: number;
    serviceTetri: number;
    /** Goods sold over the counter (ADR-0045); absent while an older API answers. */
    goodsTetri?: number;
    saleTetri: number;
    depositsInTetri: number;
    acquiringFeeTetri: number;
    depositsOutTetri: number;
    withheldTetri: number;
    heldTetri: number;
    paidBeforeTransferTetri: number;
  };
  utilisation: { percent: number | null; rentedDays: number; poolDays: number; unassigned: number };
  batteries: { showroom: number; couriers: number; repair: number; total: number };
  unmatchedLines: number;
  batterySwaps: null;
}

interface Figure {
  key: string;
  label: string;
  /** What the eye reads. */
  text: string;
  to?: string;
  negative?: boolean;
  /** The figure the rows under it break down. */
  strong?: boolean;
  /** Not a number at all: quiet, so nobody takes it for one. */
  absent?: boolean;
  note?: string;
}

const money = (tetri: number) => formatGel(tetri);

export function WeekPage() {
  const t = useT();
  const { locale } = useLocale();
  const [params, setParams] = useSearchParams();
  const [copied, setCopied] = useState<'' | 'ok' | 'failed'>('');
  const today = todayISO();
  const thisWeek = weekOf(today);
  const lastWeek = weekOf(addDays(thisWeek.from, -1));

  const from = params.get('from') ?? thisWeek.from;
  const to = params.get('to') ?? thisWeek.to;
  const which = from === thisWeek.from && to === thisWeek.to ? 'thisWeek' : from === lastWeek.from && to === lastWeek.to ? 'lastWeek' : 'custom';
  const q = `from=${from}&to=${to}`;
  const { data, failure, reload } = useLoad<Week>(`/api/reports/week?${q}`);

  const pick = (next: { from: string; to: string }) => {
    setCopied('');
    setParams(new URLSearchParams(next), { replace: true });
  };

  if (failure) return <LoadError failure={failure} onRetry={reload} />;
  if (!data) return <Loading />;
  const w = data;
  const list = `?from=${w.from}&to=${w.to}`;

  const figures: Figure[] = [
    { key: 'rented', label: t.weekReport.rented, text: String(w.fleet.rented), to: '/fleet' },
    { key: 'free', label: t.weekReport.free, text: String(w.fleet.freeInRentPool), to: '/fleet' },
    {
      key: 'service',
      label: t.weekReport.inService,
      text: w.fleet.serviceLongestDays == null ? String(w.fleet.inService) : `${w.fleet.inService} · ${t.weekReport.serviceDays(w.fleet.serviceLongestDays)}`,
      to: '/service',
    },
    // Downtime of the week's repairs in hours, waiting for approval within it (ADR-0038).
    ...(w.fleet.repairs ? [{ key: 'repair-hours', label: t.wmaint.repairsLine, text: repairHoursText(w.fleet.repairs, t, locale), to: '/service' }] : []),
    { key: 'moves', label: t.weekReport.startedReturned, text: `${w.rentals.started} · ${w.rentals.returned}`, to: '/rentals' },
    {
      key: 'overdue',
      label: t.weekReport.overdue,
      text: `${money(w.rentals.overdueTetri)} · ${t.weekReport.overdueRentals(w.rentals.overdueCount)}`,
      to: '/rentals?s=overdue',
      negative: w.rentals.overdueTetri > 0,
    },
    // The total stands above the breakdown and is worked out straight off the
    // payments: it is the figure a person checks against the bank statement
    // and the till, and the rows under it answer the other question — what the
    // money came in for (designer, 22.09.2026).
    { key: 'total', label: t.weekReport.inTotal, text: money(w.money.totalTetri), to: `/money/payments${list}&direction=in`, strong: true },
    // By row, not by kind of payment: one hand-over is rent and a deposit at
    // once, and a list filtered by kind would show the whole 330 ₾ under rent
    // and disagree with the figure it came from (QA-W6-01, ux №10).
    { key: 'rent', label: t.weekReport.inRent, text: money(w.money.rentTetri), to: `/money/payments${list}&row=rent` },
    { key: 'sales', label: t.weekReport.inSales, text: money(w.money.saleTetri), to: `/money/payments${list}&row=sale` },
    { key: 'depIn', label: t.weekReport.depositsIn, text: money(w.money.depositsInTetri), to: `/money/payments${list}&row=deposits` },
    { key: 'repairs', label: t.weekReport.inRepairs, text: money(w.money.serviceTetri), to: `/money/payments${list}&row=service` },
    { key: 'goods', label: t.weekReport.inGoods, text: money(w.money.goodsTetri ?? 0), to: `/money/payments${list}&row=goods` },
    {
      key: 'fee',
      label: t.weekReport.acquiringFee,
      // Nothing taken is nothing, not minus nothing (QA-W6-04).
      text: w.money.acquiringFeeTetri === 0 ? money(0) : `−${money(w.money.acquiringFeeTetri)}`,
      to: `/money/payments${list}&channel=acquiring`,
      negative: true,
    },
    {
      key: 'depOut',
      label: t.weekReport.depositsOut,
      text: w.money.depositsOutTetri === 0 ? money(0) : `−${money(w.money.depositsOutTetri)}`,
      to: `/money/payments${list}&kind=deposit_payout`,
      negative: true,
    },
    { key: 'withheld', label: t.weekReport.withheld, text: money(w.money.withheldTetri), to: '/money/deposits' },
    {
      key: 'held',
      label: t.weekReport.held,
      text: money(w.money.heldTetri),
      // Deposits still with us is a figure of today, not of the week that
      // ended: what a deposit became is worked out from the deposit itself,
      // which keeps no history of its own (QA-W6-03). Said out loud here
      // rather than left to be read as the week's.
      note: w.asOf !== w.today ? t.weekReport.heldToday : undefined,
      to: '/money/deposits',
    },
    {
      key: 'util',
      label: t.weekReport.utilisation,
      text: w.utilisation.percent == null ? t.weekReport.noRecord : `${w.utilisation.percent} %`,
      absent: w.utilisation.percent == null,
      // The figure leads to the screen it is made of, over this same week
      // (ux №10, crit. 1). The address is built by the shared rule, so the
      // period cannot be lost between the link and the request (QA-W6-05).
      to: utilisationPath({ from: w.from, to: w.to }),
      note: w.utilisation.percent == null ? undefined : t.weekReport.basis(w.utilisation.rentedDays, w.utilisation.poolDays),
    },
    {
      key: 'batteries',
      label: t.weekReport.batteries,
      text: `${w.batteries.showroom} · ${w.batteries.couriers} · ${w.batteries.repair}`,
      to: '/fleet/batteries',
      note: t.weekReport.batteriesToday,
    },
    { key: 'unmatched', label: t.weekReport.unmatched, text: String(w.unmatchedLines), to: '/sort' },
    // The one figure nobody keeps (`batteries.md`): said in words, not as 0.
    { key: 'swaps', label: t.weekReport.swaps, text: t.weekReport.noRecord, absent: true },
  ];

  /** The same rows as plain text, to paste into `weekly/ГГГГ-ММ-ДД.md`. */
  const bookText = [
    t.weekReport.period(fmtDate(w.from), fmtDate(w.to)),
    ...figures.map((f) => `${f.label}: ${f.text}`),
    `${t.weekReport.beforeTransfer}: ${money(w.money.paidBeforeTransferTetri)}`,
  ].join('\n');

  const copy = () => {
    navigator.clipboard?.writeText(bookText).then(
      () => setCopied('ok'),
      () => setCopied('failed'),
    );
  };

  return (
    <>
      <PageHead
        wrap
        title={t.weekReport.title}
        sub={t.weekReport.period(fmtDate(w.from), fmtDate(w.to))}
        note={t.weekReport.subtitle}
      >
        <a className="pill pill-sm" href={`/api/reports/week.pdf?${q}`} target="_blank" rel="noreferrer">
          {t.weekReport.print}
        </a>
        <button type="button" className="pill pill-sm pill-accent" onClick={copy}>
          {copied === 'ok' ? t.weekReport.copied : t.weekReport.copy}
        </button>
      </PageHead>

      <div className="chips week-period">
        <button type="button" className={`chip ${which === 'thisWeek' ? 'on' : ''}`} onClick={() => pick(thisWeek)}>
          {t.weekReport.thisWeek}
        </button>
        <button type="button" className={`chip ${which === 'lastWeek' ? 'on' : ''}`} onClick={() => pick(lastWeek)}>
          {t.weekReport.lastWeek}
        </button>
        <input
          className="chip chip-date"
          type="date"
          aria-label={t.weekReport.from}
          value={from}
          max={to}
          onChange={(e) => e.target.value && pick({ from: e.target.value, to })}
        />
        <input
          className="chip chip-date"
          type="date"
          aria-label={t.weekReport.to}
          value={to}
          min={from}
          onChange={(e) => e.target.value && pick({ from, to: e.target.value })}
        />
      </div>

      {w.asOf !== w.to && <p className="hint">{t.weekReport.asOf(fmtDate(w.asOf))}</p>}

      <section className="card week-card">
        <dl className="figures">
          {figures.map((f) => (
            <div className={`figure ${f.strong ? 'figure-total' : ''}`} key={f.key}>
              <dt>
                {f.label}
                {f.note && <span className="hint">{f.note}</span>}
              </dt>
              <dd className={f.absent ? 'muted' : f.negative ? 'mono crit-text' : 'mono'}>
                {f.to && !f.absent ? <Link to={f.to}>{f.text}</Link> : f.text}
              </dd>
            </div>
          ))}
          {/* Not a week's takings and never counted as one (crit. 9, Q3). */}
          <div className="figure figure-apart">
            <dt>
              {t.weekReport.beforeTransfer}
              <span className="hint">{t.weekReport.beforeTransferNote}</span>
            </dt>
            <dd className="mono muted">{money(w.money.paidBeforeTransferTetri)}</dd>
          </div>
        </dl>
        {w.utilisation.unassigned > 0 && <p className="hint">{t.weekReport.unassigned(w.utilisation.unassigned)}</p>}
      </section>

      {copied === 'failed' && <pre className="wa-text">{bookText}</pre>}

      <section className="card">
        <p className="t-h3">{t.weekReport.decisions}</p>
        <p className="hint">{t.weekReport.decisionsNote}</p>
      </section>
    </>
  );
}
