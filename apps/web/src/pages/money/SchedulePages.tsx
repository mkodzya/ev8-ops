import {
  calendarCanStep,
  calendarDayRows,
  calendarEntriesOn,
  calendarGrid,
  calendarLimits,
  calendarMonthTotals,
  calendarStep,
  calendarViewOf,
  calendarViewParams,
  calendarWeekOf,
  todayISO,
  type CalendarAnswer,
  type CalendarLate,
  type CalendarRentalCard,
  type ISODate,
} from '@ev8/shared';
import { CalendarDays } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { LoadError } from '../../components/LoadError.js';
import { PageHead } from '../../components/ui.js';
import { WhatsappSheet, type WaKind, type WaTarget } from '../../components/Whatsapp.js';
import { useMoneyForm } from '../../ds/money/MoneyForm.js';
import '../../ds/money/money.css';
import { Skeleton } from '../../ds/state/Skeleton.js';
import { fmtDayMonth } from '../../format.js';
import { useLocale, useT } from '../../i18n/index.js';
import { useLaptop } from '../../lib/breakpoint.js';
import { byName, primaryName } from '../../lib/names.js';
import { useLoad } from '../../lib/use.js';
import { useSession } from '../../session.js';
import {
  DaySection,
  DebtorRow,
  LateSection,
  MonthTable,
  PeriodBar,
  UnsortedNote,
  WeekCard,
  WeekLine,
  gel,
  monthTitle,
  weekdayIn,
  type Actions,
  type LateHead,
} from './CalendarParts.js';

// «Оплаты по графику» (issue #15 of the director, 25.10.2026; ADR-0048):
// what the manager opens in the morning — who is late and who pays today, as
// two lists to call from, the oldest debt first — then the calendar, and for
// the owner the month's figures. «Сегодня» and «Просрочки» read the same
// answer the calendar reads for the month of today, so the three tabs and the
// menu's counters never disagree. A manager's answer carries the rows and no
// sum of several of them (`scheduleOf`): the lists show each row's own money
// and nothing added up.

/** What a row's buttons open: the money form, the WhatsApp sheet. One place for the four screens. */
export function useRowActions(): { actions: Actions; sheet: ReactNode } {
  const { locale } = useLocale();
  const openMoney = useMoneyForm();
  const [wa, setWa] = useState<{ target: WaTarget; kind: WaKind } | null>(null);
  const actions: Actions = {
    // The form sets the date and offers the sum itself; the schedule hands it the rental and nothing else.
    take: (card) => openMoney({ target: { kind: 'rent', rentalId: card.id, number: card.number, customerId: card.customer.id, customer: card.customer.name } }),
    remind: (card, kind, entry) => {
      const phone = card.customer.phone;
      if (!phone) return;
      const target: WaTarget = { rentalId: card.id, number: card.number, name: primaryName(card.customer, locale), phone, paidThrough: card.paidThrough, debtTetri: card.debtTetri };
      // The week the row is about: its day, and the sum the row itself shows as left.
      setWa({ kind, target: entry ? { ...target, dueOn: entry.dueOn, amountTetri: entry.leftTetri } : target });
    },
  };
  const sheet = wa ? <WhatsappSheet target={wa.target} kind={wa.kind} onClose={() => setWa(null)} /> : null;
  return { actions, sheet };
}

/** Two rentals of one day in the order the product's lists sort names, then by number. */
export function useRowOrder(cardOf: Map<string, CalendarRentalCard>): (a: string, b: string) => number {
  const { locale } = useLocale();
  const names = byName(locale);
  return (a, b) => {
    const one = cardOf.get(a);
    const two = cardOf.get(b);
    if (!one || !two) return 0;
    return names(one.customer, two.customer) || (one.number === two.number ? 0 : one.number < two.number ? -1 : 1);
  };
}

/**
 * The answer for the month of today — the calendar's own request for it, so
 * the tabs share one cache entry. The device says which day it is only until
 * the server has.
 */
function useScheduleNow() {
  const [serverDay, setServerDay] = useState<ISODate | null>(null);
  const today = serverDay ?? todayISO();
  const grid = calendarGrid(today);
  const { data, failure, reload } = useLoad<CalendarAnswer>(`/api/money/calendar?from=${grid.from}&to=${grid.to}`);
  // Only ever forward, as the calendar does: two months in the cache can disagree about today just after midnight.
  if (data && (serverDay === null || data.today > serverDay)) setServerDay(data.today);
  return { data, failure, reload, today: data?.today ?? today };
}

/** No rental runs: nothing is scheduled, and the one thing to do is hand a moped over. */
function NothingRuns() {
  const t = useT();
  const { can } = useSession();
  return (
    <div className="state-empty">
      <span className="state-empty-icon">
        <CalendarDays size={24} strokeWidth={1.75} aria-hidden="true" />
      </span>
      <h2 className="state-empty-title">{t.returnPick.none}</h2>
      {can('rental.create') && (
        <Link className="pill pill-sm" to="/rentals/new">
          {t.today.handOver}
        </Link>
      )}
    </div>
  );
}

/**
 * Who is late, oldest debt first — the answer's own order. On a laptop the
 * calendar's right-hand list, whole; on a phone a heading and a card. The debt
 * of them all is said for whoever reads Money.
 */
function LateList({ late, dense, note, children }: { late: LateHead; dense: boolean; note: ReactNode; children: ReactNode }) {
  const t = useT();
  if (dense) {
    return (
      <LateSection late={late} hidden={0} whole={false} onToggle={() => undefined} note={note}>
        {children}
      </LateSection>
    );
  }
  return (
    <>
      <div className="cal-day-head">
        <div className="cal-day-title">
          <h2 className={late.count > 0 ? 'cal-st-overdue' : undefined}>{late.count > 0 ? t.calendar.lateListTitle(late.count) : t.calendar.noLate}</h2>
        </div>
        {!!late.debtTetri && <span className="cal-day-total cal-st-overdue">{t.calendar.debt(gel(late.debtTetri))}</span>}
      </div>
      {late.count > 0 && <div className="cal-list">{children}</div>}
      {note}
    </>
  );
}

/** «Сегодня»: who is late, then who pays today — the morning's calls, with WhatsApp, a call and «Провести вручную». */
export function ScheduleDuePage() {
  const t = useT();
  const laptop = useLaptop();
  const { data, failure, reload, today } = useScheduleNow();
  const { actions, sheet } = useRowActions();
  const [paidOpen, setPaidOpen] = useState(false);
  const cardOf = new Map<string, CalendarRentalCard>((data?.rentals ?? []).map((card) => [card.id, card]));
  const compare = useRowOrder(cardOf);
  const head = <PageHead title={t.nav.schedule} sub={t.calendar.todayIs(weekdayIn(t, today), fmtDayMonth(today))} />;

  if (!data) return <>{head}{failure ? <LoadError failure={failure} onRetry={reload} /> : <Skeleton rows={5} />}</>;
  if (data.firstPickupOn === null) return <>{head}<NothingRuns /></>;

  const lateOf = new Map<string, CalendarLate>(data.late.rentals.map((late) => [late.rentalId, late]));
  const debtor = (late: CalendarLate) => {
    const card = cardOf.get(late.rentalId);
    return card ? <DebtorRow key={late.rentalId} late={late} card={card} dense={laptop} actions={actions} /> : null;
  };
  const day = data.days.find((d) => d.date === today);
  const rows = calendarDayRows(calendarEntriesOn(data, today), data.late.rentals, compare);
  const lists = (
    <>
      <LateList late={data.late} dense={laptop} note={<UnsortedNote count={data.unsortedIn} />}>
        {data.late.rentals.map(debtor)}
      </LateList>
      <DaySection date={today} day={day} rows={rows} today={today} dense={laptop} paidOpen={paidOpen} onPaidToggle={() => setPaidOpen(!paidOpen)} cardOf={cardOf} lateOf={lateOf} actions={actions} />
    </>
  );
  return (
    <>
      {head}
      <div className="cal sched">{laptop ? <aside className="cal-side">{lists}</aside> : lists}</div>
      {sheet}
    </>
  );
}

/** «Просрочки»: every late rental, the oldest debt first, nothing folded. */
export function ScheduleLatePage() {
  const t = useT();
  const laptop = useLaptop();
  const { data, failure, reload, today } = useScheduleNow();
  const { actions, sheet } = useRowActions();
  const head = <PageHead title={t.shell.tabs.late} sub={t.calendar.todayIs(weekdayIn(t, today), fmtDayMonth(today))} />;

  if (!data) return <>{head}{failure ? <LoadError failure={failure} onRetry={reload} /> : <Skeleton rows={5} />}</>;
  if (data.firstPickupOn === null) return <>{head}<NothingRuns /></>;

  const cardOf = new Map<string, CalendarRentalCard>(data.rentals.map((card) => [card.id, card]));
  const list = (
    <LateList late={data.late} dense={laptop} note={<UnsortedNote count={data.unsortedIn} />}>
      {data.late.rentals.map((late) => {
        const card = cardOf.get(late.rentalId);
        return card ? <DebtorRow key={late.rentalId} late={late} card={card} dense={laptop} actions={actions} /> : null;
      })}
    </LateList>
  );
  return (
    <>
      {head}
      <div className="cal sched">{laptop ? <aside className="cal-side">{list}</aside> : list}</div>
      {sheet}
    </>
  );
}

/**
 * «Месяц» — an owner's (issue #15; the director's «Неделя | Месяц» of
 * 22.10.2026 moved to a tab of its own): the month's figures and the month
 * week by week. A week's row opens the calendar on its first day.
 */
export function ScheduleMonthPage() {
  const t = useT();
  const laptop = useLaptop();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [serverDay, setServerDay] = useState<ISODate | null>(null);
  // The last answer whatever month it was for: who is late and the first hand-over are about now.
  const kept = useRef<CalendarAnswer | null>(null);
  const today = serverDay ?? todayISO();
  const view = calendarViewOf((key) => params.get(key), today);
  const grid = calendarGrid(view.day);
  const { data, failure, reload } = useLoad<CalendarAnswer>(`/api/money/calendar?from=${grid.from}&to=${grid.to}`);
  if (data) kept.current = data;
  if (data && (serverDay === null || data.today > serverDay)) setServerDay(data.today);
  const title = monthTitle(t, view.day);
  const head = <PageHead title={t.shell.tabs.month} sub={title} />;

  const now = kept.current;
  if (!now) return <>{head}{failure ? <LoadError failure={failure} onRetry={reload} /> : <Skeleton rows={5} />}</>;
  if (now.firstPickupOn === null) return <>{head}<NothingRuns /></>;

  const limits = calendarLimits(today, now.firstPickupOn);
  const go = (day: ISODate) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(calendarViewParams({ day, all: false }, today))) if (value) next.set(key, value);
    setParams(next, { replace: true });
  };
  const arrow = (dir: 1 | -1) => {
    const to = calendarStep(view.day, dir, 'month');
    return { label: monthTitle(t, to), disabled: !calendarCanStep(view.day, dir, 'month', limits), go: () => go(to) };
  };
  // A week of the table opens the calendar on that week's first day.
  const openWeek = (day: ISODate) => {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(calendarViewParams({ day, all: false }, today))) if (value) q.set(key, value);
    const query = q.toString();
    navigate(`/schedule/calendar${query ? `?${query}` : ''}`);
  };
  // This month's own answer only — never another month kept on screen; and the sums only in an owner's answer.
  const sums = data && data.totals ? data : null;
  const month = sums ? calendarMonthTotals(sums, view.day, today) : null;
  const week = sums ? calendarWeekOf(sums, view.day) : null;

  return (
    <>
      {head}
      <div className="cal">
        <PeriodBar dense={laptop} title={title} prev={arrow(-1)} next={arrow(1)} onToday={() => go(today)} />
        {!sums && failure && <LoadError failure={failure} onRetry={reload} />}
        {!sums && !failure && <Skeleton rows={4} />}
        {sums && month && week && (
          <>
            {laptop ? (
              <WeekCard week={week} isCurrent={false} late={sums.late} received={null} failed={false} scope="month" month={month} monthName={title} />
            ) : (
              <section className="cal-sum-card">
                <WeekLine week={week} isCurrent={false} failed={false} scope="month" month={month} monthName={title} />
              </section>
            )}
            <MonthTable totals={month} title={title} today={today} onPick={openWeek} />
          </>
        )}
      </div>
    </>
  );
}
