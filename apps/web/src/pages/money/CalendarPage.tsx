import {
  CALENDAR_LATE_SHOWN,
  addDays,
  calendarCanStep,
  calendarCells,
  calendarDayRows,
  calendarEntriesOn,
  calendarGrid,
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
  // The day whose paid rows are unfolded.
  const [paidOpen, setPaidOpen] = useState<ISODate | null>(null);
  const [wa, setWa] = useState<{ target: WaTarget; kind: WaKind } | null>(null);
  // The last answer, whatever month it was for. Who is late, the earliest
  // hand-over and the unsorted lines are about now, so they stay on screen
  // while another month loads — `useLoad` keeps nothing across a new address.
  const kept = useRef<PaymentsCalendarAnswer | null>(null);
  // The device says which month to ask for only until the first answer.
  const clock = kept.current ? kept.current.today : todayISO();
  const read = (key: 'm' | 'd' | 'all') => params.get(key);
  const asked = calendarViewOf(read, clock);
  const grid = calendarGrid(asked.day);
  // `from` and `to` always, the current month too: one month is one cache key.
  const { data, failure, reload } = useLoad<PaymentsCalendarAnswer>(`/api/money/calendar?from=${grid.from}&to=${grid.to}`);
  if (data) kept.current = data;

  const now = kept.current;
  const today = now ? now.today : clock;
  const head = <PageHead title={t.shell.tabs.calendar} sub={t.calendar.todayIs(weekdayIn(t, today), fmtDayMonth(today))} />;

  if (!now) {
    return (
      <>
        {head}
        {failure ? <LoadError failure={failure} onRetry={reload} /> : <CalendarSkeleton dense={laptop} part="all" />}
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

  // Once the server has said what day it is, that is the day.
  const view = today === clock ? asked : calendarViewOf(read, today);
  const tomorrow = addDays(today, 1);
  const by = laptop || view.all ? 'month' : 'week';
  const cells = calendarCells(view.day, by);
  const limits = calendarLimits(today, now.firstPickupOn);

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
  const days = new Map<ISODate, CalendarDay>((data ? data.days : []).map((day) => [day.date, day]));
  // The order of two rentals in a day: by the name on screen, as the product's lists sort names, then by number.
  const names = byName(locale);
  const compare = (a: string, b: string): number => {
    const one = cardOf.get(a);
    const two = cardOf.get(b);
    if (!one || !two) return 0;
    return names(one.customer, two.customer) || (one.number === two.number ? 0 : one.number < two.number ? -1 : 1);
  };
  const rowsOf = (day: ISODate) => (data ? calendarDayRows(calendarEntriesOn(data, day), data.late.rentals, compare) : []);

  // The totals are the chosen day's Monday–Sunday; the red line is always about now.
  const week = data ? calendarWeekOf(data, view.day) : null;
  const isCurrent = week !== null && week.from === weekOf(today).from;
  const received = week ? calendarReceivedPeriod(week, today) : null;
  const heaviestDay = week && week.heaviest ? week.heaviest.date : null;
  const legend = calendarLegend(cells, today);
  const title = monthTitle(t, view.day);
  const gridLabel = by === 'week' ? rangeText(t, weekOf(view.day)) : title;

  const actions: Actions = {
    // The form sets the date and offers the sum itself; the calendar hands it the rental and nothing else.
    take: (card) => openMoney({ target: { kind: 'rent', rentalId: card.id, number: card.number, customerId: card.customer.id, customer: card.customer.name } }),
    remind: (card, kind, dueOn) => {
      const phone = card.customer.phone;
      if (!phone) return;
      setWa({ kind, target: { rentalId: card.id, number: card.number, name: primaryName(card.customer, locale), phone, paidThrough: card.paidThrough, debtTetri: card.debtTetri, dueOn } });
    },
  };
  // Drawn in the answer's order — the oldest debt first; nothing here sorts it.
  const debtor = (late: CalendarLate) => {
    const card = cardOf.get(late.rentalId);
    return card ? <DebtorRow key={late.rentalId} late={late} card={card} dense={laptop} actions={actions} /> : null;
  };
  const pick = (day: ISODate) => go(day, view.all);
  const toToday = () => go(today, view.all);
  const togglePaid = (day: ISODate) => () => setPaidOpen(paidOpen === day ? null : day);
  const sheet = wa ? <WhatsappSheet target={wa.target} kind={wa.kind} onClose={() => setWa(null)} /> : null;
  const failed = failure ? <LoadError failure={failure} onRetry={reload} /> : null;

  if (!laptop) {
    return (
      <>
        {head}
        <div className="cal">
          <section className="cal-sum-card">
            <WeekLine week={week} isCurrent={isCurrent} />
            <LateLine late={now.late} open={lateOpen} onToggle={() => setLateOpen(!lateOpen)}>
              {now.late.rentals.map(debtor)}
              <UnsortedNote count={now.unsortedIn} />
            </LateLine>
          </section>
          <PeriodBar dense={false} title={title} prev={arrow(-1)} next={arrow(1)} onToday={toToday} fold={{ open: view.all, toggle: () => go(view.day, !view.all) }} todayKey={legend.today} />
          {data && (
            <>
              <Weekdays />
              <CalendarGrid cells={cells} days={days} today={today} selected={view.day} size="compact" onPick={pick} label={gridLabel} />
              <CalendarLegend variant={view.all ? 'month' : 'week'} shows={legend} />
              <DaySection
                date={view.day}
                day={days.get(view.day)}
                rows={rowsOf(view.day)}
                today={today}
                dense={false}
                heaviest={heaviestDay === view.day}
                paidOpen={paidOpen === view.day}
                onPaidToggle={togglePaid(view.day)}
                cardOf={cardOf}
                lateOf={lateOf}
                actions={actions}
              />
              {view.day === today && <TomorrowLine date={tomorrow} day={days.get(tomorrow)} onPick={() => pick(tomorrow)} />}
              {week && received && <ReceivedLine period={received} tetri={week.receivedTetri} dense={false} />}
            </>
          )}
          {!data && (failed ?? <CalendarSkeleton dense={false} part="body" />)}
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
        <WeekCard week={week} isCurrent={isCurrent} late={now.late} received={received} />
        <div className="cal-desk">
          <div className="cal-left">
            <PeriodBar dense title={title} prev={arrow(-1)} next={arrow(1)} onToday={toToday} />
            {data && (
              <>
                <Weekdays />
                <CalendarGrid cells={cells} days={days} today={today} selected={view.day} size="big" onPick={pick} label={gridLabel} />
                <CalendarLegend variant="desk" shows={legend} />
              </>
            )}
            {!data && (failed ?? <CalendarSkeleton dense part="grid" />)}
          </div>
          <aside className="cal-side">
            <LateSection late={now.late} hidden={lateRows.hidden} whole={wholeList} onToggle={() => setLateOpen(!lateOpen)} note={<UnsortedNote count={now.unsortedIn} />}>
              {lateRows.shown.map(debtor)}
            </LateSection>
            {data && (
              <DaySection
                date={view.day}
                day={days.get(view.day)}
                rows={rowsOf(view.day)}
                today={today}
                dense
                paidOpen={paidOpen === view.day}
                onPaidToggle={togglePaid(view.day)}
                cardOf={cardOf}
                lateOf={lateOf}
                actions={actions}
              />
            )}
            {/* The third list is always the real tomorrow; chosen itself, it is the second list already. */}
            {data && view.day !== tomorrow && (
              <DaySection
                date={tomorrow}
                day={days.get(tomorrow)}
                rows={rowsOf(tomorrow)}
                today={today}
                dense
                asTomorrow
                paidOpen={paidOpen === tomorrow}
                onPaidToggle={togglePaid(tomorrow)}
                cardOf={cardOf}
                lateOf={lateOf}
                actions={actions}
              />
            )}
            {!data && !failure && <CalendarSkeleton dense part="rows" />}
          </aside>
        </div>
      </div>
      {sheet}
    </>
  );
}
