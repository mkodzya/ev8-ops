import {
  addDays,
  calendarCellKind,
  calendarDebtWeeks,
  calendarFold,
  calendarWeekday,
  formatGel,
  paymentsQuery,
  waOffered,
  type CalendarDay,
  type CalendarEntry,
  type CalendarLate,
  type CalendarLateList,
  type CalendarMonthTotals,
  type CalendarRentalCard,
  type CalendarState,
  type CalendarTotals,
  type CalendarWeek,
  type ISODate,
  type Period,
  type Tetri,
} from '@ev8/shared';
import { Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, MessageCircle, Phone } from 'lucide-react';
import type { ReactNode, Ref } from 'react';
import { Link } from 'react-router-dom';
import type { WaKind } from '../../components/Whatsapp.js';
import { useSkeletonDelay } from '../../ds/state/Skeleton.js';
import { fmtDayMonth } from '../../format.js';
import type { Dict } from '../../i18n/en.js';
import { useLocale, useT } from '../../i18n/index.js';
import { primaryName } from '../../lib/names.js';

// The parts of "Деньги → Календарь" (docs/redesign/payments-calendar.md §3).
// Props only: no request and no address in here — CalendarPage owns both.
// Nothing here adds two sums together either: every figure is a field of the
// server's answer, written out.

/**
 * Every sum the page writes goes through this one: «150 ₾», «1 790 ₾»,
 * «74.50 ₾». Bare `formatGel` prints «150.00 ₾», which is the money form's
 * way and not this screen's (§4.8).
 */
export const gel = (tetri: Tetri | null | undefined): string => formatGel(tetri, { decimals: false });

// The names of days and months come from the dictionary, never from the
// device (§4.9). `calendarWeekday` counts from Monday; the two full-name lists
// begin on Sunday.
export const weekdayShort = (t: Dict, day: ISODate): string => t.calendar.wd[calendarWeekday(day)] ?? '';
export const weekdayTitle = (t: Dict, day: ISODate): string => t.today.weekdays[(calendarWeekday(day) + 1) % 7] ?? '';
export const weekdayIn = (t: Dict, day: ISODate): string => t.calendar.weekdaysIn[(calendarWeekday(day) + 1) % 7] ?? '';
export const monthTitle = (t: Dict, day: ISODate): string => t.calendar.monthTitle(t.calendar.months[Number(day.slice(5, 7)) - 1] ?? '', day.slice(0, 4));
export const rangeText = (t: Dict, period: Period): string => t.calendar.range(fmtDayMonth(period.from), fmtDayMonth(period.to));
/**
 * A row of the month's table: «19–25.10» — the table's title names the month,
 * and the short form keeps «Недоплачено» on a 375 px phone (QA after issue #7,
 * 23.10.2026). A row is cut to its month, so both ends share it; one day alone
 * is «31.08». The same in every language, like the dates themselves.
 */
export const monthRowText = (period: Period): string => {
  if (period.from === period.to) return fmtDayMonth(period.to);
  const sameMonth = period.from.slice(0, 7) === period.to.slice(0, 7);
  return `${sameMonth ? period.from.slice(8, 10) : fmtDayMonth(period.from)}–${fmtDayMonth(period.to)}`;
};

/** What a row can do. Both open something the product already has: the money form, the WhatsApp sheet. */
export interface Actions {
  take: (card: CalendarRentalCard) => void;
  /** `week` is the row being reminded about, when it is a week: the message names its day and what it has left. */
  remind: (card: CalendarRentalCard, kind: WaKind, week: CalendarEntry | null) => void;
}

/** The prototype's `svg.i.s`: 18 px under a thumb and under a pointer alike, drawn with the product's 1.75 px line. */
const ICON = { size: 18, strokeWidth: 1.75 } as const;

/** The order the marks stand in inside a laptop cell (§3.3). */
const MARKS: readonly CalendarState[] = ['overdue', 'due_today', 'expected', 'paid', 'paid_ahead'];
/** The order the laptop's legend names them in — as the prototype draws it. */
const LEGEND: readonly CalendarState[] = ['paid', 'paid_ahead', 'due_today', 'expected', 'overdue'];

/**
 * A state as a shape: tick in a disc, tick in a ring, dot, ring, square.
 * Never alone — the state's word stands beside it or in the label (ux №9).
 */
export function StateMark({ state, small }: { state: CalendarState; small?: boolean }) {
  const ticked = state === 'paid' || state === 'paid_ahead';
  return (
    <i className={`cal-mark cal-mark-${state}${small ? ' sm' : ''}`} aria-hidden="true">
      {ticked && <Check aria-hidden="true" />}
    </i>
  );
}

/**
 * A dictionary sentence with its sums in bold. The words around a sum stand
 * in a different order in each language, so the page cannot build the
 * sentence from pieces: it takes it whole and marks the sums it put in.
 * Longest first, so that «150 ₾» does not split «1 150 ₾».
 */
export function Emph({ text, parts }: { text: string; parts: string[] }) {
  const sums = [...new Set(parts)].filter((p) => p !== '').sort((a, b) => b.length - a.length);
  const out: ReactNode[] = [];
  let plain = '';
  let i = 0;
  while (i < text.length) {
    const hit = sums.find((p) => text.startsWith(p, i));
    if (hit === undefined) {
      plain += text[i];
      i += 1;
      continue;
    }
    if (plain !== '') out.push(plain);
    out.push(<b key={i}>{hit}</b>);
    plain = '';
    i += hit.length;
  }
  if (plain !== '') out.push(plain);
  return <>{out}</>;
}

// ---------------------------------------------------------------------------
// The grid
// ---------------------------------------------------------------------------

export function Weekdays() {
  const t = useT();
  // Each cell's own label carries its date; the row above is for the eye.
  return (
    <div className="cal-wd" aria-hidden="true">
      {t.calendar.wd.map((name) => (
        <span key={name}>{name}</span>
      ))}
    </div>
  );
}

function DayCell({ date, day, today, selected, big, onPick }: { date: ISODate; day: CalendarDay | undefined; today: ISODate; selected: boolean; big: boolean; onPick: (day: ISODate) => void }) {
  const t = useT();
  const kind = calendarCellKind(date, today);
  const ddmm = fmtDayMonth(date);
  const isToday = date === today;
  const count = day ? day.due.count : 0;
  const lateCount = day ? day.states.overdue : 0;
  const hasLate = lateCount !== 0;
  const number = Number(date.slice(8));

  const classes = ['cal-cell', kind === 'current' ? 'week' : kind];
  if (isToday) classes.push('today');
  if (count === 0) classes.push('none');
  // Today stays lime whoever is late; the square or the mark says it there.
  if (hasLate && !isToday) classes.push('late');
  if (selected) classes.push('on');
  const className = classes.join(' ');

  // A day nobody pays on is not a button. It can still be the chosen day —
  // today by default, after an arrow, by a link — and is then outlined.
  if (!day || count === 0) {
    const dash = big ? 'cal-cell-total' : 'cal-cell-count';
    return (
      <span className={className} aria-current={isToday ? 'date' : undefined}>
        <span className={big ? 'cal-cell-top' : undefined} aria-hidden="true">
          <span className="cal-n">{number}</span>
        </span>
        {kind === 'current' && (
          <span className={dash} aria-hidden="true">
            —
          </span>
        )}
        {/* The laptop's today says so in a word, payments or none (§3.3). */}
        {big && isToday && <span className="cal-cell-tag">{t.calendar.todayLow}</span>}
        <span className="cal-sr">{t.calendar.cell.none(ddmm)}</span>
      </span>
    );
  }

  const sum = gel(day.due.tetri);
  const allPaid = day.paidCount === day.due.count;
  const states = day.states;
  let label: string;
  let inner: ReactNode;
  if (kind === 'past') {
    // An earlier week: only how the day ended.
    const mark = <StateMark state={hasLate ? 'overdue' : 'paid'} small />;
    label = hasLate ? t.calendar.cell.pastLate(ddmm) : t.calendar.cell.pastPaid(ddmm);
    inner = big ? (
      <span className="cal-cell-top">
        <span className="cal-n">{number}</span>
        {mark}
      </span>
    ) : (
      <>
        <span className="cal-n">{number}</span>
        {mark}
      </>
    );
  } else if (kind === 'ahead') {
    // A week ahead is a calculation: the number alone.
    label = t.calendar.cell.ahead(ddmm, t.calendar.pays(count));
    inner = big ? (
      <span className="cal-cell-top">
        <span className="cal-n">{number}</span>
      </span>
    ) : (
      <span className="cal-n">{number}</span>
    );
  } else if (big) {
    // This week on a laptop: the day's sum and every mark with its count.
    const marks = MARKS.filter((state) => states[state] !== 0);
    label = t.calendar.cell.marks(ddmm, sum, marks.map((state) => `${t.calendar.said[state]} ${states[state]}`).join(', '));
    inner = (
      <>
        <span className="cal-cell-top">
          <span className="cal-n">{number}</span>
        </span>
        <span className="cal-cell-total">{sum}</span>
        <span className="cal-cell-marks">
          {marks.map((state) => (
            <span key={state} className={`cal-cell-mark cal-st-${state}`}>
              <StateMark state={state} small />
              {states[state]}
            </span>
          ))}
        </span>
        {isToday && <span className="cal-cell-tag">{t.calendar.todayLow}</span>}
      </>
    );
  } else {
    // This week on a phone: the sum, how many of its payments are in, a red square if somebody is late.
    label = t.calendar.cell.week(ddmm, sum, day.paidCount, day.due.count) + (hasLate ? t.calendar.cell.weekLate(lateCount) : '');
    inner = (
      <>
        <span className="cal-n">{number}</span>
        <span className="cal-cell-sum">{sum}</span>
        <span className={`cal-cell-count${allPaid ? ' all' : ''}`}>{t.calendar.countOf(day.paidCount, day.due.count)}</span>
        {hasLate && <i className="cal-flag" />}
      </>
    );
  }

  return (
    <button type="button" className={className} aria-pressed={selected} aria-current={isToday ? 'date' : undefined} aria-label={label} onClick={() => onPick(date)}>
      {inner}
    </button>
  );
}

/**
 * One grid for every case: a phone's week and a phone's month differ only in
 * `cells`, the laptop only in `size`. A null cell is a neighbouring month's
 * day — drawn empty, so the month keeps its shape.
 */
export function CalendarGrid({
  cells,
  days,
  today,
  selected,
  size,
  onPick,
  label,
}: {
  cells: (ISODate | null)[];
  days: Map<ISODate, CalendarDay>;
  today: ISODate;
  selected: ISODate;
  size: 'compact' | 'big';
  onPick: (day: ISODate) => void;
  /** What the group is, for a screen reader: the week's dates or the month's name. */
  label: string;
}) {
  const big = size === 'big';
  return (
    <div className={`cal-grid${big ? ' big' : ''}`} role="group" aria-label={label}>
      {cells.map((date, i) =>
        date === null ? (
          <span key={`off-${i}`} className="cal-cell off" aria-hidden="true" />
        ) : (
          <DayCell key={date} date={date} day={days.get(date)} today={today} selected={date === selected} big={big} onPick={onPick} />
        ),
      )}
    </div>
  );
}

/** The lime square and the word for it. */
function TodayKey({ word }: { word: string }) {
  return (
    <span>
      <i className="cal-swatch" />
      {word}
    </span>
  );
}

/**
 * The legend names only what the cells on screen show (§3.5.6). The laptop's
 * five marks are always there — its lists beside the grid use every one,
 * whatever month is open — in the states' short words, so they keep one line:
 * «заранее» alone, it stands right after «оплачено». No lime key there: the
 * laptop's cell says «сегодня» in a word. The sentence about the figures only
 * while the current week, which has them, is in the grid.
 */
export function CalendarLegend({ variant, shows }: { variant: 'week' | 'month' | 'desk'; shows: { counts: boolean; allPaid: boolean; late: boolean; today: boolean; aheadOnly: boolean } }) {
  const t = useT();
  if (variant === 'desk') {
    return (
      <div className="cal-legend desk">
        <div className="cal-legend-marks">
          {LEGEND.map((state) => (
            <span key={state}>
              <StateMark state={state} small />
              {state === 'paid_ahead' ? t.calendar.legendPaidAhead : t.calendar.said[state]}
            </span>
          ))}
        </div>
        {shows.counts && <p>{t.calendar.legendHow}</p>}
        {shows.aheadOnly && <p>{t.calendar.legendAhead}</p>}
      </div>
    );
  }
  if (shows.aheadOnly) {
    return (
      <div className="cal-legend">
        <p>{t.calendar.legendAhead}</p>
      </div>
    );
  }
  return (
    <div className="cal-legend">
      {shows.counts && (
        <span>
          <b>{t.calendar.countOf(1, 3)}</b>
          {t.calendar.legendCount}
        </span>
      )}
      {shows.allPaid && (
        <span>
          <StateMark state="paid" small />
          {t.calendar.legendAllPaid}
        </span>
      )}
      {shows.late && (
        <span>
          <StateMark state="overdue" small />
          {t.calendar.legendLate}
        </span>
      )}
      {/* With the month open the key stands in the line of the month's name. */}
      {variant === 'week' && shows.today && <TodayKey word={t.calendar.todayLow} />}
    </div>
  );
}

interface Arrow {
  /** Where it leads — «Неделя 05.10 – 11.10», «Сентябрь 2026»: the button's name for a screen reader. */
  label: string;
  disabled: boolean;
  go: () => void;
}

/**
 * Back, forward, today — and on a phone the month by a button. `dense` is the
 * laptop's bar: the month is always open there, so its name stands inside the
 * bar and there is nothing to fold.
 */
export function PeriodBar({
  dense,
  title,
  prev,
  next,
  onToday,
  fold,
  todayKey,
}: {
  dense: boolean;
  title: string;
  prev: Arrow;
  next: Arrow;
  onToday: () => void;
  fold?: { open: boolean; toggle: () => void };
  /** Today is among the cells: its key goes beside the month's name. */
  todayKey?: boolean;
}) {
  const t = useT();
  const sm = dense ? ' pill-sm' : '';
  return (
    <>
      <div className={`cal-bar${dense ? ' dense' : ''}`}>
        <button type="button" className={`pill${sm} cal-round`} aria-label={prev.label} disabled={prev.disabled} onClick={prev.go}>
          <ChevronLeft {...ICON} aria-hidden="true" />
        </button>
        <button type="button" className={`pill${sm} cal-round`} aria-label={next.label} disabled={next.disabled} onClick={next.go}>
          <ChevronRight {...ICON} aria-hidden="true" />
        </button>
        {dense && <div className="cal-title">{title}</div>}
        <button type="button" className={`pill${sm} cal-now`} onClick={onToday}>
          {t.today.title}
        </button>
        {fold && (
          <button type="button" className="pill cal-all" aria-expanded={fold.open} onClick={fold.toggle}>
            {fold.open ? t.calendar.collapse : t.calendar.wholeMonth}
            {fold.open ? <ChevronUp {...ICON} size={14} aria-hidden="true" /> : <ChevronDown {...ICON} size={14} aria-hidden="true" />}
          </button>
        )}
      </div>
      {fold?.open && (
        <div className="cal-title-row">
          <div className="cal-title">{title}</div>
          {todayKey && (
            <div className="cal-legend">
              <TodayKey word={t.calendar.todayLow} />
            </div>
          )}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// The week's totals and who is late
// ---------------------------------------------------------------------------

/** «Эта неделя · 12.10 – 18.10» for the week of today, «Неделя 05.10 – 11.10» for any other (§3.5.5). */
const weekName = (t: Dict, week: CalendarWeek, isCurrent: boolean): string => (isCurrent ? t.calendar.weekThis(rangeText(t, week)) : t.calendar.weekOf(rangeText(t, week)));

/**
 * The week's totals while another month loads: nothing for the product's
 * 300 ms, then a grey bar — a fast answer never flashes one. The bar's place
 * is held from the first moment, so the card keeps its height.
 */
function WeekSkel({ shape }: { shape: 'line' | 'figs' }) {
  const shown = useSkeletonDelay();
  return <span className={`cal-skel-${shape}${shown ? ' skel' : ''}`} />;
}

/** What the totals are about: the chosen day's week, or its whole month (director, 22.10.2026). */
export type TotalsScope = 'week' | 'month';

/** «Неделя | Месяц» — two pills, the chosen one filled; the address is not touched. */
export function ScopeSwitch({ scope, onScope }: { scope: TotalsScope; onScope: (s: TotalsScope) => void }) {
  const t = useT();
  return (
    <span className="cal-scope" role="group" aria-label={t.calendar.scopeAria}>
      {(['week', 'month'] as const).map((s) => (
        <button key={s} type="button" className={`pill pill-sm${scope === s ? ' on' : ''}`} aria-pressed={scope === s} onClick={() => onScope(s)}>
          {s === 'week' ? t.calendar.scopeWeek : t.calendar.scopeMonth}
        </button>
      ))}
    </span>
  );
}

/** The month's three figures in the card's own shape: what should come in, what is paid, what is short — and what is still awaited under it. */
function MonthFigs({ total }: { total: CalendarTotals }) {
  const t = useT();
  if (total.due.count === 0) return <p className="cal-none">{t.calendar.noneThisMonth}</p>;
  return (
    <>
      <div className="cal-fig">
        <span className="cal-fig-v">{gel(total.due.tetri)}</span>
        <span className="cal-fig-l">
          {t.calendar.toCome} · {t.calendar.pays(total.due.count)}
        </span>
      </div>
      <div className="cal-fig">
        <span className="cal-fig-v">{gel(total.paid.tetri)}</span>
        <span className="cal-fig-l">
          <StateMark state="paid" small />
          {t.calendar.paidLabel} · {t.calendar.pays(total.paid.count)}
        </span>
      </div>
      <div className="cal-fig">
        <span className="cal-fig-v">{gel(total.short.tetri)}</span>
        <span className="cal-fig-l">
          {total.short.tetri !== 0 && <StateMark state="overdue" small />}
          {t.calendar.shortLabel} · {t.calendar.pays(total.short.count)}
        </span>
        {total.waiting.tetri !== 0 && (
          <span className="cal-fig-s">
            {t.calendar.waitingLabel} · {gel(total.waiting.tetri)}
          </span>
        )}
      </div>
    </>
  );
}

/**
 * The month week by week, under the grid (director, 22.10.2026): one row a
 * week, cut to the month, and the month's line at the foot. Weeks are counted
 * by the day they are due, as the card above counts them. A row picks its
 * first day and turns the card to that week (the page does both); a row cut
 * to the month says it is part of a week, since the card shows all seven days.
 */
export function MonthTable({ totals, title, today, onPick }: { totals: CalendarMonthTotals; title: string; today: ISODate; onPick: (day: ISODate) => void }) {
  const t = useT();
  const cells = (x: CalendarTotals) => (
    <>
      <td className="num">{gel(x.due.tetri)}</td>
      <td className="num">{gel(x.paid.tetri)}</td>
      <td className={`num${x.short.tetri !== 0 ? ' cal-short' : ''}`}>{gel(x.short.tetri)}</td>
      <td className="num muted cal-wait">{gel(x.waiting.tetri)}</td>
    </>
  );
  return (
    <section className="cal-month">
      <h3 className="cal-month-title">{t.calendar.monthTable(title)}</h3>
      <div className="table-wrap">
        <table className="table cal-month-table">
          <thead>
            <tr>
              <th>{t.calendar.colWeek}</th>
              <th className="num">{t.calendar.colDue}</th>
              <th className="num">{t.calendar.colPaid}</th>
              <th className="num">{t.calendar.colShort}</th>
              <th className="num cal-wait">{t.calendar.colWaiting}</th>
            </tr>
          </thead>
          <tbody>
            {totals.weeks.map((w) => (
              <tr key={w.from} className={w.from <= today && today <= w.to ? 'cal-month-now' : undefined}>
                <td className="cal-month-wk">
                  <button type="button" className="cal-month-pick" onClick={() => onPick(w.from)}>
                    <span>{monthRowText(w)}</span>
                    {/* An edge row holds the month's days only; the card it opens shows the whole week. */}
                    {w.part && <small>{t.calendar.partWeek}</small>}
                  </button>
                </td>
                {cells(w)}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">{t.calendar.monthTotal}</th>
              {cells(totals.total)}
            </tr>
          </tfoot>
        </table>
      </div>
      {/* «Недоплачено» stops at yesterday; the red figure above counts today too — this says which is which. */}
      <p className="cal-month-note">{t.calendar.monthShortNote}</p>
    </section>
  );
}

/**
 * The phone's line of the week. Text, not a link: no list in "Платежи" adds
 * up to these sums — they count weeks by the day they are due, the list
 * counts money by the day it came (§8.1). `week` is null while another month
 * loads, and after it failed to: then there is no line at all — the message
 * under the bar speaks for the screen, and nothing here pretends to load.
 */
export function WeekLine({
  week,
  isCurrent,
  failed,
  scope,
  onScope,
  month,
  monthName,
}: {
  week: CalendarWeek | null;
  isCurrent: boolean;
  failed: boolean;
  scope: TotalsScope;
  onScope: (s: TotalsScope) => void;
  month: CalendarMonthTotals | null;
  monthName: string;
}) {
  const t = useT();
  if (scope === 'month' && month) {
    const m = month.total;
    const paid = gel(m.paid.tetri);
    const all = gel(m.due.tetri);
    const short = gel(m.short.tetri);
    return (
      <div className="cal-week">
        <div className="cal-week-text">
          <span className="cal-over">
            {monthName} <ScopeSwitch scope={scope} onScope={onScope} />
          </span>
          {m.due.count === 0 ? (
            <span className="cal-week-line">{t.calendar.noneThisMonth}</span>
          ) : (
            <span className="cal-week-line">
              <span>
                <Emph text={t.calendar.paidOf(paid, all)} parts={[paid, all]} />
              </span>
              <span>
                · {t.calendar.shortLabel} <b>{short}</b>
              </span>
              {m.waiting.tetri !== 0 && (
                <span>
                  · {t.calendar.waitingLabel} {gel(m.waiting.tetri)}
                </span>
              )}
            </span>
          )}
        </div>
      </div>
    );
  }
  if (!week) {
    if (failed) return null;
    return (
      <div className="cal-week" aria-busy="true">
        <WeekSkel shape="line" />
      </div>
    );
  }
  const paid = gel(week.paid.tetri);
  const all = gel(week.expected.tetri);
  const left = gel(week.left.tetri);
  return (
    <div className="cal-week">
      <div className="cal-week-text">
        <span className="cal-over">
          {weekName(t, week, isCurrent)} <ScopeSwitch scope="week" onScope={onScope} />
        </span>
        {week.expected.count === 0 ? (
          <span className="cal-week-line">{t.calendar.noneThisWeek}</span>
        ) : (
          // Two pieces that never break inside: the second goes down whole.
          <span className="cal-week-line">
            <span>
              <Emph text={t.calendar.paidOf(paid, all)} parts={[paid, all]} />
            </span>
            <span>
              · <Emph text={t.calendar.left(left)} parts={[left]} />
            </span>
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * The phone's red line: how many rentals are late and what they owe — about
 * now, whatever day is chosen. «Показать» opens the list under it, whole.
 * With nobody late it is a quiet line of the same height.
 */
export function LateLine({ late, open, onToggle, children }: { late: CalendarLateList; open: boolean; onToggle: () => void; children: ReactNode }) {
  const t = useT();
  if (late.count === 0) {
    return (
      <div className="cal-late none">
        <div className="cal-late-in">
          <StateMark state="paid" />
          <span className="cal-late-text">
            <b>{t.calendar.noLate}</b>
          </span>
        </div>
      </div>
    );
  }
  // A debt of nought is not written at all — as "Аренды" does not write one (§3.5.10).
  const debt = late.debtTetri !== 0 ? t.calendar.debt(gel(late.debtTetri)) : null;
  const thisWeek = late.thisWeekTetri !== 0 ? t.calendar.ofThemThisWeek(gel(late.thisWeekTetri)) : null;
  return (
    <div className="cal-late">
      <div className="cal-late-in">
        <StateMark state="overdue" />
        <span className="cal-late-text">
          {/* The space stands between the two pieces, not inside one: each is `nowrap`, and the line breaks only there. */}
          <b>
            <span>{t.calendar.late(late.count)}</span>
            {debt && (
              <>
                {' '}
                <span>· {debt}</span>
              </>
            )}
          </b>
          {thisWeek && <span>{thisWeek}</span>}
        </span>
        <button type="button" className="pill pill-sm cal-toggle" aria-expanded={open} aria-controls="cal-late-list" onClick={onToggle}>
          {open ? t.calendar.hide : t.calendar.show}
          {open ? <ChevronUp {...ICON} size={14} aria-hidden="true" /> : <ChevronDown {...ICON} size={14} aria-hidden="true" />}
        </button>
      </div>
      {open && <div id="cal-late-list">{children}</div>}
    </div>
  );
}

/** «В „Разобрать“ 5 поступлений…» — under a list of debtors, and only while something waits to be sorted (§8.7). */
export function UnsortedNote({ count }: { count: number }) {
  const t = useT();
  if (count === 0) return null;
  return <p className="cal-note">{t.calendar.unsorted(count)}</p>;
}

/**
 * «Пришло денег 12.10 – 14.10 · 590 ₾» — the one sum on the screen that IS a
 * list elsewhere, so the one link to "Платежи": the same days, the row
 * "аренда" (§4.6).
 */
export function ReceivedLine({ period, tetri, dense }: { period: Period; tetri: Tetri; dense: boolean }) {
  const t = useT();
  const asked: Record<string, string> = { from: period.from, to: period.to, row: 'rent' };
  const to = `/money/payments?${paymentsQuery((key) => asked[key])}`;
  const words = t.calendar.came(rangeText(t, period));
  const sum = gel(tetri);
  const label = `${words} · ${sum} — ${t.calendar.cameAria}`;
  if (dense) {
    return (
      <Link className="cal-came-d" to={to} aria-label={label}>
        {words} · <b className="cal-link">{sum}</b>
      </Link>
    );
  }
  return (
    <Link className="cal-came" to={to} aria-label={label}>
      <span>
        {words} · <b className="cal-link">{sum}</b>
      </span>
      <ChevronRight className="cal-go" aria-hidden="true" />
    </Link>
  );
}

/**
 * The laptop's card of the week: three figures, the red figure, what came in,
 * the heaviest day. The three figures are the chosen day's week; the red block
 * is always about now. All of them text (§8.1) — the list the red figure is
 * made of stands on the same screen, to the right. With no week — another
 * month is loading, or `failed` to — the red block stays: grey bars beside it
 * while it loads, nothing beside it after a failure.
 */
export function WeekCard({
  week,
  isCurrent,
  late,
  received,
  failed,
  scope,
  onScope,
  month,
  monthName,
  cardRef,
}: {
  week: CalendarWeek | null;
  isCurrent: boolean;
  late: CalendarLateList;
  received: Period | null;
  failed: boolean;
  scope: TotalsScope;
  onScope: (s: TotalsScope) => void;
  month: CalendarMonthTotals | null;
  monthName: string;
  /** The card itself, for the page to bring into view when a week is picked in the month's table. */
  cardRef?: Ref<HTMLElement>;
}) {
  const t = useT();
  // The month needs the month's answer; while it loads, the card shows the week it has, as before.
  const byMonth = scope === 'month' && month !== null;
  const heaviest = week?.heaviest ? gel(week.heaviest.tetri) : null;
  const split = t.calendar.lateSplit(late.thisWeekTetri !== 0 ? gel(late.thisWeekTetri) : null, late.earlierTetri !== 0 ? gel(late.earlierTetri) : null);
  const pending = !week && !failed;
  return (
    <section className="cal-card" ref={cardRef}>
      {byMonth && (
        <div className="cal-card-head">
          <span>
            {monthName} <ScopeSwitch scope={scope} onScope={onScope} />
          </span>
        </div>
      )}
      {week && !byMonth && (
        <div className="cal-card-head">
          <span>
            {/* The week is what is shown — also while the month asked for is still loading. */}
            {weekName(t, week, isCurrent)} <ScopeSwitch scope="week" onScope={onScope} />
          </span>
          <span className="cal-card-side">
            {received && <ReceivedLine period={received} tetri={week.receivedTetri} dense />}
            {week.heaviest && heaviest && (
              <span>
                <Emph text={t.calendar.heaviest(weekdayIn(t, week.heaviest.date), heaviest)} parts={[heaviest]} />
              </span>
            )}
          </span>
        </div>
      )}
      {pending && (
        <div className="cal-card-head" aria-busy="true">
          <WeekSkel shape="line" />
        </div>
      )}
      <div className="cal-figs">
        {pending && <WeekSkel shape="figs" />}
        {byMonth && <MonthFigs total={month.total} />}
        {week && !byMonth && week.expected.count === 0 && <p className="cal-none">{t.calendar.noneThisWeek}</p>}
        {week && !byMonth && week.expected.count !== 0 && (
          <>
            <div className="cal-fig">
              <span className="cal-fig-v">{gel(week.expected.tetri)}</span>
              <span className="cal-fig-l">
                {t.calendar.toCome} · {t.calendar.pays(week.expected.count)}
              </span>
            </div>
            <div className="cal-fig">
              <span className="cal-fig-v">{gel(week.paid.tetri)}</span>
              <span className="cal-fig-l">
                <StateMark state="paid" small />
                {t.calendar.paidLabel} · {t.calendar.pays(week.paid.count)}
              </span>
            </div>
            <div className="cal-fig">
              <span className="cal-fig-v">{gel(week.left.tetri)}</span>
              <span className="cal-fig-l">
                {t.calendar.leftLabel} · {t.calendar.pays(week.left.count)}
              </span>
            </div>
          </>
        )}
        {late.count === 0 ? (
          <div className="cal-fig debt none">
            <span className="cal-fig-l">
              <StateMark state="paid" small />
              {t.calendar.noLate}
            </span>
          </div>
        ) : (
          <div className="cal-fig debt">
            {late.debtTetri !== 0 && <span className="cal-fig-v">{gel(late.debtTetri)}</span>}
            <span className="cal-fig-l">
              <StateMark state="overdue" small />
              {late.debtTetri !== 0 ? t.calendar.lateWholeDebt(late.count) : t.calendar.late(late.count)}
            </span>
            {split !== '' && <span className="cal-fig-s">{split}</span>}
          </div>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/**
 * A row's buttons. «Провести вручную» (was «Принять оплату», 22.10.2026) is an outline pill — the screen has no
 * filled button (§3.0). The reminder is a round icon, except on the laptop's
 * row of somebody who pays tomorrow, where it carries its word and the call
 * is left out, as the frame draws it. No phone — neither a call nor WhatsApp.
 */
function RowActions({ card, remind, week, dense, worded, actions }: { card: CalendarRentalCard; remind: WaKind | null; week: CalendarEntry | null; dense: boolean; worded: boolean; actions: Actions }) {
  const t = useT();
  const sm = dense ? ' pill-sm' : '';
  const phone = card.customer.phone;
  const reminds = remind !== null && !!phone;
  const template = remind === 'overdue' ? t.wa.overdue : remind === 'today' ? t.wa.today : t.wa.tomorrow;
  const ask = () => {
    if (remind !== null) actions.remind(card, remind, week);
  };
  return (
    <>
      <button type="button" className={`pill${sm} cal-take`} onClick={() => actions.take(card)}>
        {t.calendar.recordByHand}
      </button>
      {reminds && worded && (
        <button type="button" className={`pill${sm} cal-remind`} aria-label={t.calendar.remindAria(template)} onClick={ask}>
          <MessageCircle {...ICON} aria-hidden="true" />
          {t.calendar.remind}
        </button>
      )}
      {reminds && !worded && (
        <button type="button" className={`pill${sm} cal-round`} aria-label={t.calendar.remindAria(template)} onClick={ask}>
          <MessageCircle {...ICON} aria-hidden="true" />
        </button>
      )}
      {phone && !(reminds && worded) && (
        <a className={`pill${sm} cal-round`} href={`tel:${phone}`} aria-label={t.today.call}>
          <Phone {...ICON} aria-hidden="true" />
        </a>
      )}
    </>
  );
}

/** What a week's row says under the name (§3.4). */
function payerWords(t: Dict, entry: CalendarEntry, late: CalendarLate | undefined, today: ISODate): string {
  let words = t.calendar.state[entry.state];
  // The date and the channel of the payment that completed the week; a week
  // paid before the transfer has neither and keeps the bare word.
  if ((entry.state === 'paid' || entry.state === 'paid_ahead') && entry.paidOn && entry.channel) {
    words = t.calendar.withPayment(words, entry.paidOn === today ? t.calendar.todayLow : fmtDayMonth(entry.paidOn), t.calendar.channels[entry.channel]);
  }
  if (entry.state === 'overdue' && late) {
    // The days and the debt are the rental's, not this week's.
    words = t.calendar.overdueLine(t.calendar.daysShort(late.days), late.debtTetri !== 0 ? gel(late.debtTetri) : null);
    const weeks = calendarDebtWeeks(late);
    if (weeks !== null) words = `${words} ${t.calendar.forWeeks(weeks)}`;
  }
  // Partly paid: the state of its date, and what is in already.
  if (entry.leftTetri !== 0 && entry.paidTetri !== 0) words = `${words} · ${t.calendar.partPaid(gel(entry.paidTetri), gel(entry.amountTetri))}`;
  return words;
}

/** One week of one rental in a day's list. The name leads to the rental's card. */
export function PayerRow({
  entry,
  card,
  late,
  today,
  dense,
  showActions,
  actions,
}: {
  entry: CalendarEntry;
  card: CalendarRentalCard;
  late: CalendarLate | undefined;
  today: ISODate;
  dense: boolean;
  /** False for a paid week, and for an overdue one on a laptop — its buttons are in "Просрочено" above. */
  showActions: boolean;
  actions: Actions;
}) {
  const t = useT();
  const { locale } = useLocale();
  const name = primaryName(card.customer, locale);
  const model = card.vehicle ? card.vehicle.model : null;
  const words = payerWords(t, entry, late, today);
  const part = entry.leftTetri !== 0 && entry.paidTetri !== 0;
  const sum = gel(part ? entry.leftTetri : entry.amountTetri);
  const paysTomorrow = entry.state === 'expected' && entry.dueOn === addDays(today, 1);
  // «Сегодня оплата» to who pays today — but not on the day the moped was handed over: the shared rule (ADR-0017).
  const paysToday = entry.state === 'due_today' && waOffered('due_today', card.pickedUpOn, today);
  // «Просрочка» to the late, «Сегодня оплата» and «Завтра оплата» to who pays today and tomorrow.
  const remind: WaKind | null = entry.state === 'overdue' ? 'overdue' : paysToday ? 'today' : paysTomorrow ? 'tomorrow' : null;
  // The last two are about this week: their message carries what the row says is left of it, «Завтра оплата» its day too.
  const buttons = showActions ? <RowActions card={card} remind={remind} week={paysToday || paysTomorrow ? entry : null} dense={dense} worded={dense && paysTomorrow} actions={actions} /> : null;

  if (dense) {
    return (
      <div className="cal-drow">
        <StateMark state={entry.state} />
        <Link className={`cal-dwho${buttons ? '' : ' wide'}`} to={`/rentals/${card.id}`}>
          <span className="cal-dname">{name}</span>
          <span className="cal-dsub">
            {model && `${model} · `}
            <span className={`cal-st-${entry.state}`}>{words}</span>
          </span>
        </Link>
        {buttons && <span className="cal-dacts">{buttons}</span>}
        <span className="cal-damt">
          {part && <small>{t.calendar.leftLabel}</small>}
          {sum}
        </span>
      </div>
    );
  }
  return (
    <div className="cal-row">
      <Link className={`cal-row-main${part ? ' part' : ''}`} to={`/rentals/${card.id}`}>
        <StateMark state={entry.state} />
        <span className="cal-who">
          {name}
          {model && <span> · {model}</span>} <ChevronRight className="cal-go" aria-hidden="true" />
        </span>
        <span className="cal-amt">
          {part && <small>{t.calendar.leftLabel}</small>}
          {sum}
        </span>
        <span className={`cal-words cal-st-${entry.state}`}>{words}</span>
      </Link>
      {buttons && <div className="cal-acts">{buttons}</div>}
    </div>
  );
}

/** One late rental in "Просрочено": how long, how many weeks, the rental's whole debt. */
export function DebtorRow({ late, card, dense, actions }: { late: CalendarLate; card: CalendarRentalCard; dense: boolean; actions: Actions }) {
  const t = useT();
  const { locale } = useLocale();
  const name = primaryName(card.customer, locale);
  const model = card.vehicle ? card.vehicle.model : null;
  const since = fmtDayMonth(late.sinceOn);
  // The count of weeks lives here whatever the debt is made of (§3.4).
  const words = late.weeks === 1 ? t.calendar.lateDueWas(late.days, since) : t.calendar.lateSince(late.days, late.weeks, since);
  const owes = late.debtTetri !== 0;
  const buttons = <RowActions card={card} remind="overdue" week={null} dense={dense} worded={false} actions={actions} />;

  if (dense) {
    return (
      <div className="cal-drow">
        <StateMark state="overdue" />
        <Link className="cal-dwho" to={`/rentals/${card.id}`}>
          <span className="cal-dname">{name}</span>
          <span className="cal-dsub">
            {model && `${model} · `}
            {words}
          </span>
        </Link>
        <span className="cal-dacts">{buttons}</span>
        <span className="cal-damt late">
          {owes && <small>{t.calendar.debtLabel}</small>}
          {owes && gel(late.debtTetri)}
        </span>
      </div>
    );
  }
  return (
    <div className="cal-row">
      <Link className="cal-row-main debt" to={`/rentals/${card.id}`}>
        <StateMark state="overdue" />
        <span className="cal-who">
          {name}
          {model && <span> · {model}</span>} <ChevronRight className="cal-go" aria-hidden="true" />
        </span>
        {owes && (
          <span className="cal-amt late">
            <small>{t.calendar.debtLabel}</small>
            {gel(late.debtTetri)}
          </span>
        )}
        <span className="cal-words cal-st-overdue">{words}</span>
      </Link>
      <div className="cal-acts">{buttons}</div>
    </div>
  );
}

/** «Оплачено · 8» and a button: the paid rows of a long day, folded (§3.5.8). */
export function PaidFold({ id, count, open, onToggle, children }: { id: string; count: number; open: boolean; onToggle: () => void; children: ReactNode }) {
  const t = useT();
  return (
    <>
      <div className="cal-fold">
        <span className="cal-fold-title">
          <StateMark state="paid" />
          {t.calendar.paidFold(count)}
        </span>
        <button type="button" className="pill pill-sm" aria-expanded={open} aria-controls={id} onClick={onToggle}>
          {open ? t.calendar.hide : t.calendar.show}
        </button>
      </div>
      {open && <div id={id}>{children}</div>}
    </>
  );
}

/**
 * A day: its heading and its payers. On a phone a heading and one card; on a
 * laptop a section of the right-hand card. `asTomorrow` is the laptop's third
 * list, named «Завтра · четверг, 15.10».
 */
export function DaySection({
  date,
  day,
  rows,
  today,
  dense,
  asTomorrow,
  heaviest,
  paidOpen,
  onPaidToggle,
  cardOf,
  lateOf,
  actions,
}: {
  date: ISODate;
  day: CalendarDay | undefined;
  /** The day's weeks, already in the order they are read (calendarDayRows). */
  rows: CalendarEntry[];
  today: ISODate;
  dense: boolean;
  asTomorrow?: boolean;
  /** This is the week's heaviest day: said under the heading on a phone. */
  heaviest?: boolean;
  paidOpen: boolean;
  onPaidToggle: () => void;
  cardOf: Map<string, CalendarRentalCard>;
  lateOf: Map<string, CalendarLate>;
  actions: Actions;
}) {
  const t = useT();
  const { shown, folded } = calendarFold(rows);
  const ddmm = fmtDayMonth(date);
  const tag = date === today ? t.calendar.todayLow : date === addDays(today, 1) ? t.calendar.tomorrowLow : null;
  // What should come in for the day — the sum of the rows under the heading. Text, not a link (§8.1).
  const total = day && day.due.count !== 0 ? t.calendar.dayTotal(t.calendar.pays(day.due.count), gel(day.due.tetri)) : null;
  const row = (entry: CalendarEntry) => {
    const card = cardOf.get(entry.rentalId);
    if (!card) return null;
    const owed = entry.leftTetri !== 0;
    const here = owed && !(dense && entry.state === 'overdue');
    return <PayerRow key={`${entry.rentalId}:${entry.seq}`} entry={entry} card={card} late={lateOf.get(entry.rentalId)} today={today} dense={dense} showActions={here} actions={actions} />;
  };
  const list = (
    <>
      {shown.map(row)}
      {folded.length !== 0 && (
        <PaidFold id={`cal-paid-${date}`} count={folded.length} open={paidOpen} onToggle={onPaidToggle}>
          {folded.map(row)}
        </PaidFold>
      )}
    </>
  );
  const none = rows.length === 0;

  if (dense) {
    return (
      <div className="cal-sec">
        <div className="cal-sec-head">
          {asTomorrow ? (
            <h3>
              {t.calendar.tomorrow}
              <span>· {t.calendar.dayTitle(weekdayIn(t, date), ddmm)}</span>
            </h3>
          ) : (
            <h3>
              {t.calendar.dayTitle(weekdayTitle(t, date), ddmm)}
              {tag && <span>· {tag}</span>}
            </h3>
          )}
          {total && <span className="cal-sec-total">{total}</span>}
        </div>
        {none ? <p className="cal-none">{t.calendar.noneThisDay}</p> : list}
      </div>
    );
  }
  return (
    <>
      <div className="cal-day-head">
        <div className="cal-day-title">
          <h2>
            {t.calendar.dayTitle(weekdayTitle(t, date), ddmm)}
            {tag && <span> · {tag}</span>}
          </h2>
          {heaviest && <small>{t.calendar.heaviestOfWeek}</small>}
        </div>
        {total && <span className="cal-day-total">{total}</span>}
      </div>
      {none ? <p className="cal-none">{t.calendar.noneThisDay}</p> : <div className="cal-list">{list}</div>}
    </>
  );
}

/** The phone's «Завтра, Чт 15.10 · 2 оплаты · 300 ₾»: choosing it chooses tomorrow, whose list this sum is. */
export function TomorrowLine({ date, day, onPick }: { date: ISODate; day: CalendarDay | undefined; onPick: () => void }) {
  const t = useT();
  const count = day ? day.due.count : 0;
  const pays = t.calendar.pays(count);
  return (
    <button type="button" className="cal-next" onClick={onPick}>
      <span>
        {t.calendar.tomorrowLine(weekdayShort(t, date), fmtDayMonth(date))} · <b>{day && count !== 0 ? t.calendar.dayTotal(pays, gel(day.due.tetri)) : pays}</b>
      </span>
      <ChevronRight className="cal-go" aria-hidden="true" />
    </button>
  );
}

/**
 * The laptop's first list, always on screen. Past five rows it shows five and
 * «Показать ещё (7)» — fifteen debtors would push the chosen day's list off
 * the screen, and a click on a cell would look like nothing happened
 * (§3.5.10). The heading is always about all of them.
 */
export function LateSection({ late, hidden, whole, onToggle, note, children }: { late: CalendarLateList; hidden: number; whole: boolean; onToggle: () => void; note: ReactNode; children: ReactNode }) {
  const t = useT();
  if (late.count === 0) {
    return (
      <div className="cal-sec">
        <div className="cal-sec-head">
          <h3>
            <StateMark state="paid" />
            {t.calendar.noLate}
          </h3>
        </div>
      </div>
    );
  }
  const folds = hidden !== 0 || whole;
  return (
    <div className="cal-sec">
      <div className="cal-sec-head late">
        <h3>
          <StateMark state="overdue" />
          {t.calendar.lateListTitle(late.count)}
        </h3>
        {late.debtTetri !== 0 && <span className="cal-sec-total">{t.calendar.debt(gel(late.debtTetri))}</span>}
      </div>
      <div id="cal-late-list">{children}</div>
      {folds && (
        <div className="cal-more">
          <button type="button" className="pill pill-sm" aria-expanded={whole} aria-controls="cal-late-list" onClick={onToggle}>
            {whole ? t.calendar.collapse : t.lists.showMore(hidden)}
          </button>
        </div>
      )}
      {note}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

const blocks = (n: number, className: string): ReactNode[] => Array.from({ length: n }, (_, i) => <span key={i} className={`skel ${className}`} />);

/**
 * The screen's own shape in grey, after the product's 300 ms of nothing.
 * 'all' is the first load; 'body' a phone changing month, when the totals and
 * the bar stay; 'grid' and 'rows' are the same for the laptop's two columns.
 * `cells` is how many the grid it stands for has — a week's seven, or the
 * 28, 35 or 42 of the month being opened — so the page below does not jump
 * when the answer lands.
 */
export function CalendarSkeleton({ dense, part, cells }: { dense: boolean; part: 'all' | 'body' | 'grid' | 'rows'; cells: number }) {
  const shown = useSkeletonDelay();
  if (!shown) return <div className="skeleton-wait" aria-busy="true" />;
  const all = part === 'all';
  // A phone's week row stands at the height of the current week's cells; the rows of an open month at the plain one.
  const grid = <div className={`cal-grid${dense ? ' big' : ''}`}>{blocks(cells, cells > 7 ? 'cal-skel-cell low' : 'cal-skel-cell')}</div>;
  const rows = blocks(dense ? 6 : 3, 'cal-skel-row');
  if (!dense) {
    return (
      <div className="skeleton cal-skel" aria-busy="true" aria-live="polite">
        {all && <span className="skel cal-skel-card" />}
        {all && (
          <div className="cal-skel-bar">
            {blocks(2, 'cal-skel-pill')}
            {blocks(2, 'cal-skel-pill wide')}
          </div>
        )}
        {grid}
        {rows}
      </div>
    );
  }
  if (part === 'grid') {
    return (
      <div className="skeleton cal-skel" aria-busy="true" aria-live="polite">
        {grid}
      </div>
    );
  }
  if (part === 'rows') {
    return (
      <div className="skeleton cal-skel" aria-busy="true" aria-live="polite">
        {rows}
      </div>
    );
  }
  return (
    <div className="skeleton cal-skel" aria-busy="true" aria-live="polite">
      <span className="skel cal-skel-card" />
      <div className="cal-desk">
        <div className="cal-left">{grid}</div>
        <div className="cal-skel">{rows}</div>
      </div>
    </div>
  );
}
