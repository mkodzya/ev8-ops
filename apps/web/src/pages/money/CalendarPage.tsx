import {
  CALENDAR_LATE_SHOWN,
  addDays,
  calendarCanStep,
  calendarCells,
  calendarDayRows,
  calendarEntriesOn,
  calendarGrid,
  calendarHoldsWeek,
  calendarLateShown,
  calendarLegend,
  calendarLimits,
  calendarReceivedPeriod,
  calendarStep,
  calendarViewOf,
  calendarViewParams,
  calendarWeekOf,
  todayISO,
  weekOf,
  type CalendarDay,
  type CalendarLate,
  type CalendarRentalCard,
  type ISODate,
  type PaymentsCalendarAnswer,
} from '@ev8/shared';
import { CalendarDays } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { LoadError } from '../../components/LoadError.js';
import { PageHead } from '../../components/ui.js';
import { WhatsappSheet, type WaKind, type WaTarget } from '../../components/Whatsapp.js';
import { useMoneyForm } from '../../ds/money/MoneyForm.js';
import '../../ds/money/money.css';
import { fmtDayMonth } from '../../format.js';
import { useLocale, useT } from '../../i18n/index.js';
import { useLaptop } from '../../lib/breakpoint.js';
import { byName, primaryName } from '../../lib/names.js';
import { useLoad } from '../../lib/use.js';
import { useSession } from '../../session.js';
import {
  CalendarGrid,
  CalendarLegend,
  CalendarSkeleton,
  DaySection,
  DebtorRow,
  LateLine,
  LateSection,
  PeriodBar,
  ReceivedLine,
  TomorrowLine,
  UnsortedNote,
  WeekCard,
  WeekLine,
  Weekdays,
  monthTitle,
  rangeText,
  weekdayIn,
  type Actions,
} from './CalendarParts.js';

// "Деньги → Календарь" (docs/redesign/payments-calendar.md): who pays today,
// who pays tomorrow, who is late, what the week should bring. A month as a
// grid; on a phone it opens as one row — the week — with the chosen day's
// payers under it, on a laptop the whole month stands beside three lists.
//
// One request per month shown. Choosing a day, stepping a week inside the
// month, opening the month on a phone are lookups in the answer already here.
// The chosen day and the open month live in the address (`m`, `d`, `all`) and
// every choice REPLACES the history entry: Back leaves the screen, and Back
// from a rental's card returns to the same day.
export function CalendarPage() {
  const t = useT();
  const { locale } = useLocale();
  const { can } = useSession();
  const laptop = useLaptop();
  const openMoney = useMoneyForm();
  const [params, setParams] = useSearchParams();
  // On a phone: the debtors' list is open. On a laptop it is always on screen, and this says "whole".
  const [lateOpen, setLateOpen] = useState(false);
  // The days whose paid rows are unfolded. A laptop shows two days' lists at once, and each folds on its own.
  const [paidOpen, setPaidOpen] = useState<ReadonlySet<ISODate>>(() => new Set());
  const [wa, setWa] = useState<{ target: WaTarget; kind: WaKind } | null>(null);
  // The server's day, once an answer has said it. State and not a ref: the
  // request below is made from it, and a ref written while rendering would
  // leave the request one render behind the cells — over a month's last
  // midnight that is November's grid drawn from October's answer.
  const [serverDay, setServerDay] = useState<ISODate | null>(null);
  // The last answer, whatever month it was for. Who is late, the earliest
  // hand-over and the unsorted lines are about now, so they stay on screen
  // while another month loads — `useLoad` keeps nothing across a new address.
  const kept = useRef<PaymentsCalendarAnswer | null>(null);
  // The device says which day it is only until the first answer.
  const today = serverDay ?? todayISO();
  const read = (key: 'm' | 'd' | 'all') => params.get(key);
  const view = calendarViewOf(read, today);
  const grid = calendarGrid(view.day);
  // `from` and `to` always, the current month too: one month is one cache key.
  const { data, failure, reload } = useLoad<PaymentsCalendarAnswer>(`/api/money/calendar?from=${grid.from}&to=${grid.to}`);
  if (data) kept.current = data;
  // Set while rendering, so React runs this again before it paints and the
  // request follows the day in the same pass. Only ever forward: two months in
  // the cache can disagree about today just after midnight, and following
  // each in turn would swing the request between them.
  if (data && (serverDay === null || data.today > serverDay)) setServerDay(data.today);

  const now = kept.current;
  const by = laptop || view.all ? 'month' : 'week';
  const cells = calendarCells(view.day, by);
  const head = <PageHead title={t.shell.tabs.calendar} sub={t.calendar.todayIs(weekdayIn(t, today), fmtDayMonth(today))} />;

  if (!now) {
    return (
      <>
        {head}
        {failure ? <LoadError failure={failure} onRetry={reload} /> : <CalendarSkeleton dense={laptop} part="all" cells={cells.length} />}
      </>
    );
  }
  // No rental is running — whatever month was asked. Nothing to schedule: no totals, no bar, no grid.
  if (now.firstPickupOn === null) {
    return (
      <>
        {head}
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
      </>
    );
  }

  const tomorrow = addDays(today, 1);
  const limits = calendarLimits(today, now.firstPickupOn);
  // What the grid and the lists are drawn from: the answer for this month —
  // or, on a phone showing one week, the answer already here when it holds
  // that week whole. A week on the edge of two months is in both months'
  // answers, so a tap across the edge changes the request and nothing else:
  // the row just tapped does not blank and come back.
  const body = data ?? (by === 'week' && calendarHoldsWeek(now, view.day) ? now : null);

  const go = (day: ISODate, all: boolean) => {
    const next = new URLSearchParams(params);
    for (const key of ['m', 'd', 'all']) next.delete(key);
    for (const [key, value] of Object.entries(calendarViewParams({ day, all }, today))) {
      if (value) next.set(key, value);
    }
    setParams(next, { replace: true });
  };
  // An arrow moves the chosen day: a week while a phone shows one week, a month otherwise.
  const arrow = (dir: 1 | -1) => {
    const to = calendarStep(view.day, dir, by);
    return {
      label: by === 'week' ? t.calendar.weekOf(rangeText(t, weekOf(to))) : monthTitle(t, to),
      disabled: !calendarCanStep(view.day, dir, by, limits),
      go: () => go(to, view.all),
    };
  };

  const cardOf = new Map<string, CalendarRentalCard>(now.rentals.map((card) => [card.id, card]));
  const lateOf = new Map<string, CalendarLate>(now.late.rentals.map((late) => [late.rentalId, late]));
  const days = new Map<ISODate, CalendarDay>((body ? body.days : []).map((day) => [day.date, day]));
  // The order of two rentals in a day: by the name on screen, as the product's lists sort names, then by number.
  const names = byName(locale);
  const compare = (a: string, b: string): number => {
    const one = cardOf.get(a);
    const two = cardOf.get(b);
    if (!one || !two) return 0;
    return names(one.customer, two.customer) || (one.number === two.number ? 0 : one.number < two.number ? -1 : 1);
  };
  const rowsOf = (day: ISODate) => (body ? calendarDayRows(calendarEntriesOn(body, day), body.late.rentals, compare) : []);

  // The totals are the chosen day's Monday–Sunday; the red line is always about now.
  const week = body ? calendarWeekOf(body, view.day) : null;
  const isCurrent = week !== null && week.from === weekOf(today).from;
  const received = week ? calendarReceivedPeriod(week, today) : null;
  const heaviestDay = week && week.heaviest ? week.heaviest.date : null;
  const legend = calendarLegend(cells, today);
  const title = monthTitle(t, view.day);
  const gridLabel = by === 'week' ? rangeText(t, weekOf(view.day)) : title;

  const actions: Actions = {
    // The form sets the date and offers the sum itself; the calendar hands it the rental and nothing else.
    take: (card) => openMoney({ target: { kind: 'rent', rentalId: card.id, number: card.number, customerId: card.customer.id, customer: card.customer.name } }),
    remind: (card, kind, entry) => {
      const phone = card.customer.phone;
      if (!phone) return;
      const target: WaTarget = { rentalId: card.id, number: card.number, name: primaryName(card.customer, locale), phone, paidThrough: card.paidThrough, debtTetri: card.debtTetri };
      // The week the row is about: its day, and the sum the row itself shows as left.
      setWa({ kind, target: entry ? { ...target, dueOn: entry.dueOn, amountTetri: entry.leftTetri } : target });
    },
  };
  // Drawn in the answer's order — the oldest debt first; nothing here sorts it.
  const debtor = (late: CalendarLate) => {
    const card = cardOf.get(late.rentalId);
    return card ? <DebtorRow key={late.rentalId} late={late} card={card} dense={laptop} actions={actions} /> : null;
  };
  const pick = (day: ISODate) => go(day, view.all);
  const toToday = () => go(today, view.all);
  const togglePaid = (day: ISODate) => () => {
    const next = new Set(paidOpen);
    if (!next.delete(day)) next.add(day);
    setPaidOpen(next);
  };
  const sheet = wa ? <WhatsappSheet target={wa.target} kind={wa.kind} onClose={() => setWa(null)} /> : null;
  // Nothing to draw the month from, and the request for it failed.
  const failed = !body && failure ? <LoadError failure={failure} onRetry={reload} /> : null;
  // The names of the weekdays are no answer's: they stay through a load, and go only when the error stands in the grid's place.
  const weekdays = failed ? null : <Weekdays />;

  if (!laptop) {
    return (
      <>
        {head}
        <div className="cal">
          <section className="cal-sum-card">
            <WeekLine week={week} isCurrent={isCurrent} failed={failed !== null} />
            <LateLine late={now.late} open={lateOpen} onToggle={() => setLateOpen(!lateOpen)}>
              {now.late.rentals.map(debtor)}
              <UnsortedNote count={now.unsortedIn} />
            </LateLine>
          </section>
          <PeriodBar dense={false} title={title} prev={arrow(-1)} next={arrow(1)} onToday={toToday} fold={{ open: view.all, toggle: () => go(view.day, !view.all) }} todayKey={legend.today} />
          {weekdays}
          {body && (
            <>
              <CalendarGrid cells={cells} days={days} today={today} selected={view.day} size="compact" onPick={pick} label={gridLabel} />
              <CalendarLegend variant={view.all ? 'month' : 'week'} shows={legend} />
              <DaySection
                date={view.day}
                day={days.get(view.day)}
                rows={rowsOf(view.day)}
                today={today}
                dense={false}
                heaviest={heaviestDay === view.day}
                paidOpen={paidOpen.has(view.day)}
                onPaidToggle={togglePaid(view.day)}
                cardOf={cardOf}
                lateOf={lateOf}
                actions={actions}
              />
              {view.day === today && <TomorrowLine date={tomorrow} day={days.get(tomorrow)} onPick={() => pick(tomorrow)} />}
              {week && received && <ReceivedLine period={received} tetri={week.receivedTetri} dense={false} />}
            </>
          )}
          {!body && (failed ?? <CalendarSkeleton dense={false} part="body" cells={cells.length} />)}
        </div>
        {sheet}
      </>
    );
  }

  // Up to five debtors there is nothing to fold, whatever the button's state was on a phone.
  const lateRows = calendarLateShown(now.late.rentals, lateOpen);
  const wholeList = lateOpen && now.late.rentals.length > CALENDAR_LATE_SHOWN;
  return (
    <>
      {head}
      <div className="cal">
        <WeekCard week={week} isCurrent={isCurrent} late={now.late} received={received} failed={failed !== null} />
        <div className="cal-desk">
          <div className="cal-left">
            <PeriodBar dense title={title} prev={arrow(-1)} next={arrow(1)} onToday={toToday} />
            {weekdays}
            {body && (
              <>
                <CalendarGrid cells={cells} days={days} today={today} selected={view.day} size="big" onPick={pick} label={gridLabel} />
                <CalendarLegend variant="desk" shows={legend} />
              </>
            )}
            {!body && (failed ?? <CalendarSkeleton dense part="grid" cells={cells.length} />)}
          </div>
          <aside className="cal-side">
            <LateSection late={now.late} hidden={lateRows.hidden} whole={wholeList} onToggle={() => setLateOpen(!lateOpen)} note={<UnsortedNote count={now.unsortedIn} />}>
              {lateRows.shown.map(debtor)}
            </LateSection>
            {body && (
              <DaySection
                date={view.day}
                day={days.get(view.day)}
                rows={rowsOf(view.day)}
                today={today}
                dense
                paidOpen={paidOpen.has(view.day)}
                onPaidToggle={togglePaid(view.day)}
                cardOf={cardOf}
                lateOf={lateOf}
                actions={actions}
              />
            )}
            {/* The third list is always the real tomorrow; chosen itself, it is the second list already. */}
            {body && view.day !== tomorrow && (
              <DaySection
                date={tomorrow}
                day={days.get(tomorrow)}
                rows={rowsOf(tomorrow)}
                today={today}
                dense
                asTomorrow
                paidOpen={paidOpen.has(tomorrow)}
                onPaidToggle={togglePaid(tomorrow)}
                cardOf={cardOf}
                lateOf={lateOf}
                actions={actions}
              />
            )}
            {!body && !failed && <CalendarSkeleton dense part="rows" cells={cells.length} />}
          </aside>
        </div>
      </div>
      {sheet}
    </>
  );
}
