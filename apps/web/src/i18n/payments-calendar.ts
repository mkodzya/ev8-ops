// Words of the payments calendar, "Деньги → Календарь"
// (docs/redesign/payments-calendar.md §5). One file, so the Georgian goes to
// proofreading as one list. The tab's own name is in `shell.tabs.calendar`,
// where the shell reads it.
//
// The Georgian here was written by a non-native and has not been read by one
// yet. Two things for whoever reads it: «კვირა» is both "week" and "Sunday",
// and it stands for both on this screen; and the screen holds two words for a
// rental — the empty state reuses `returnPick.none`, which says «იჯარა», while
// the new lines below say «ქირაობა». Both live in the product; one of them is
// the native reader's to choose.
//
// `state`, `said` and `channels` are keyed by the shared enums' own members,
// so the screen looks a word up by the state itself and a state added in
// shared without a word fails the build here.
import type { CalendarChannel, CalendarState } from '@ev8/shared';

const ruPlural = (n: number, one: string, few: string, many: string): string => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};

// A count keeps its word on its line (\u00a0) — days, weeks, payments — as a sum
// keeps its lari sign. «за 2 недели» goes to the next line whole, never as «за 2» / «недели».

/** One date when the period is one day (§4.6). The same in every language, like the dates themselves. */
const range = (from: string, to: string): string => (from === to ? from : `${from} – ${to}`);
/** Either half may be missing — its sum is nought — and then one stands alone, with no comma. */
const halves = (a: string | null, b: string | null): string => [a, b].filter((s) => s !== null).join(', ');

const stateEn: Record<CalendarState, string> = { paid: 'Paid', paid_ahead: 'Paid ahead', due_today: 'Due today', expected: 'Expected', overdue: 'Overdue' };
const saidEn: Record<CalendarState, string> = { paid: 'paid', paid_ahead: 'paid ahead', due_today: 'due today', expected: 'expected', overdue: 'overdue' };
const channelsEn: Record<CalendarChannel, string> = { cash: 'cash', acquiring: 'card', transfer: 'transfer', deposit: 'from the deposit', offset: 'offset against repairs' };

export const calendarEn = {
  calendar: {
    todayIs: (weekday: string, date: string) => `today is ${weekday}, ${date}`,
    /** Monday first — the grid's own order. */
    wd: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    /** Inside a sentence; Sunday first, like `today.weekdays`. */
    weekdaysIn: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    monthTitle: (month: string, year: string) => `${month} ${year}`,
    range,
    dayTitle: (weekday: string, date: string) => `${weekday}, ${date}`,
    todayLow: 'today',
    tomorrowLow: 'tomorrow',
    tomorrow: 'Tomorrow',

    weekThis: (period: string) => `This week · ${period}`,
    weekOf: (period: string) => `Week ${period}`,
    paidOf: (paid: string, all: string) => `Paid ${paid} of ${all}`,
    left: (sum: string) => `${sum} left`,
    noneThisWeek: 'No payments this week',
    toCome: 'to come in',
    paidLabel: 'paid',
    leftLabel: 'left',
    pays: (n: number) => `${n}\u00a0${n === 1 ? 'payment' : 'payments'}`,
    dayTotal: (pays: string, sum: string) => `${pays} · ${sum}`,
    heaviest: (weekday: string, sum: string) => `The biggest day — ${weekday}, ${sum}`,
    heaviestOfWeek: 'the biggest day of the week',
    came: (period: string) => `Money received ${period}`,
    cameAria: 'Open the payments of these days',
    late: (n: number) => `Overdue · ${n}`,
    /** The heading of the overdue list only (director, 22.10.2026); the card above keeps `late`. */
    lateListTitle: (n: number) => `Overdue in total · ${n}`,
    /** The row's button: a payment the bank did not bring — cash, or a transfer to record by hand (director, 22.10.2026). */
    recordByHand: 'Record by hand',
    // The month and its weeks, counted by the day each week is due (director, 22.10.2026).
    scopeWeek: 'Week',
    scopeMonth: 'Month',
    scopeAria: 'Totals for',
    shortLabel: 'short',
    waitingLabel: 'still to come',
    noneThisMonth: 'No payments this month',
    monthTable: (month: string) => `${month} by week`,
    colWeek: 'Week',
    colDue: 'To come in',
    colPaid: 'Paid',
    colShort: 'Short',
    colWaiting: 'Still to come',
    monthTotal: 'Month in total',
    /** Under an edge row of the month's table: its figures are the month's days only. */
    partWeek: 'part of the week',
    /**
     * Under the month's table (QA after issue #7, 23.10.2026): what «short» counts, so that the red figure above —
     * which counts today too — is not read as the same thing.
     */
    monthShortNote: 'Short: payments whose day has passed. Today’s and later ones are still to come.',
    debt: (sum: string) => `debt ${sum}`,
    debtLabel: 'debt',
    // The red figure's week is today's, Monday through today — today's payment of a rental already late included —
    // whatever week the card shows (QA after issue #7, 23.10.2026): not «this week», which read as the week chosen.
    ofThemThisWeek: (sum: string) => `of these ${sum} — Monday through today`,
    lateSplit: (week: string | null, earlier: string | null) => halves(week && `${week} — Monday through today`, earlier && `${earlier} — earlier`),
    lateWholeDebt: (n: number) => `Overdue · the whole debt on ${n} ${n === 1 ? 'rental' : 'rentals'}`,
    noLate: 'Nobody is overdue',
    show: 'Show',
    hide: 'Hide',
    lateSince: (days: number, weeks: number, date: string) => `${days}\u00a0${days === 1 ? 'day' : 'days'} · ${weeks}\u00a0${weeks === 1 ? 'week' : 'weeks'}, since ${date}`,
    lateDueWas: (days: number, date: string) => `${days}\u00a0${days === 1 ? 'day' : 'days'} · was due ${date}`,
    unsorted: (n: number) =>
      n === 1 ? '“Sort” holds 1 incoming line — it may be a rent payment.' : `“Sort” holds ${n} incoming lines — rent payments may be among them.`,

    wholeMonth: 'Whole month',
    collapse: 'Collapse',
    countOf: (n: number, m: number) => `${n} of ${m}`,
    legendCount: '— paid',
    legendAllPaid: 'all paid',
    legendLate: 'overdue',
    legendAhead: 'Weeks ahead are a calculation while the rental runs',
    legendHow: 'The figure by a mark is the number of payments; the sum is what should come in that day.',
    /**
     * «Paid ahead» among the laptop legend's keys, where it stands right after «paid»: short, so the five keep one line.
     * Not «ahead» alone — on this screen that word is the weeks to come (`legendAhead`).
     */
    legendPaidAhead: 'in advance',

    state: stateEn,
    /** The same words inside a sentence read aloud — and the keys of the laptop's legend. */
    said: saidEn,
    withPayment: (word: string, when: string, how: string) => `${word} · ${when}, ${how}`,
    channels: channelsEn,
    /** `debt` is null when the rental's debt figure is nought: then it is not written at all (§3.5.10). */
    overdueLine: (days: string, debt: string | null) => `Overdue · ${days}${debt === null ? '' : ` · debt ${debt}`}`,
    daysShort: (n: number) => `${n}\u00a0${n === 1 ? 'day' : 'days'}`,
    forWeeks: (n: number) => `for\u00a0${n}\u00a0${n === 1 ? 'week' : 'weeks'}`,
    partPaid: (paid: string, all: string) => `${paid} of ${all} paid in`,
    paidFold: (n: number) => `Paid · ${n}`,
    noneThisDay: 'No payments on this day.',
    tomorrowLine: (weekday: string, date: string) => `Tomorrow, ${weekday} ${date}`,
    remind: 'Remind',
    remindAria: (template: string) => `Remind on WhatsApp: ${template.toLowerCase()}`,

    /** What a cell says to a screen reader (§3.3 rule 6). */
    cell: {
      week: (date: string, sum: string, n: number, m: number) => `${date}: ${sum}, paid ${n} of ${m}`,
      /** The tail of `week` when somebody is late. */
      weekLate: (n: number) => `, overdue ${n}`,
      marks: (date: string, sum: string, list: string) => `${date}: ${sum}: ${list}`,
      pastLate: (date: string) => `${date}: something is overdue`,
      pastPaid: (date: string) => `${date}: all paid`,
      ahead: (date: string, pays: string) => `${date}: ${pays} by calculation`,
      none: (date: string) => `${date}: no payments`,
    },
  },
};

export const calendarRu: typeof calendarEn = {
  calendar: {
    todayIs: (weekday, date) => `сегодня ${weekday}, ${date}`,
    wd: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'],
    // Lower-case: in Russian a weekday inside a sentence is not capitalised.
    weekdaysIn: ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'],
    // Nominative: `today.months` holds the genitive, for «18 сентября».
    months: ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'],
    monthTitle: (month, year) => `${month} ${year}`,
    range,
    dayTitle: (weekday, date) => `${weekday}, ${date}`,
    todayLow: 'сегодня',
    tomorrowLow: 'завтра',
    tomorrow: 'Завтра',

    weekThis: (period) => `Эта неделя · ${period}`,
    weekOf: (period) => `Неделя ${period}`,
    paidOf: (paid, all) => `Оплачено ${paid} из ${all}`,
    left: (sum) => `осталось ${sum}`,
    noneThisWeek: 'На этой неделе оплат нет',
    toCome: 'должно прийти',
    paidLabel: 'оплачено',
    leftLabel: 'осталось',
    pays: (n) => `${n}\u00a0${ruPlural(n, 'оплата', 'оплаты', 'оплат')}`,
    dayTotal: (pays, sum) => `${pays} · ${sum}`,
    heaviest: (weekday, sum) => `Самый большой день — ${weekday}, ${sum}`,
    heaviestOfWeek: 'самый большой день недели',
    came: (period) => `Пришло денег ${period}`,
    cameAria: 'Открыть платежи за эти дни',
    late: (n) => `Просрочено · ${n}`,
    lateListTitle: (n) => `Всего просрочек · ${n}`,
    recordByHand: 'Провести вручную',
    scopeWeek: 'Неделя',
    scopeMonth: 'Месяц',
    scopeAria: 'Итоги за',
    shortLabel: 'недоплачено',
    waitingLabel: 'ещё ждём',
    noneThisMonth: 'В этом месяце оплат нет',
    monthTable: (month) => `${month} по неделям`,
    colWeek: 'Неделя',
    colDue: 'Должно прийти',
    colPaid: 'Оплачено',
    colShort: 'Недоплачено',
    colWaiting: 'Ещё ждём',
    monthTotal: 'Итого за месяц',
    partWeek: 'часть недели',
    monthShortNote: 'Недоплачено — оплаты, чей день уже прошёл. Сегодняшние и следующие — «ещё ждём».',
    debt: (sum) => `долг ${sum}`,
    debtLabel: 'долг',
    // «по сегодня» — today included, as «по» says in Russian.
    ofThemThisWeek: (sum) => `из них ${sum} — с понедельника по сегодня`,
    lateSplit: (week, earlier) => halves(week && `${week} — с понедельника по сегодня`, earlier && `${earlier} — раньше`),
    lateWholeDebt: (n) => `Просрочено · весь долг по ${n} ${ruPlural(n, 'аренде', 'арендам', 'арендам')}`,
    noLate: 'Просрочек нет',
    show: 'Показать',
    hide: 'Скрыть',
    // Nominative after the number: «2 недели, с 07.10», «21 неделя».
    lateSince: (days, weeks, date) => `${days}\u00a0дн. · ${weeks}\u00a0${ruPlural(weeks, 'неделя', 'недели', 'недель')}, с ${date}`,
    lateDueWas: (days, date) => `${days}\u00a0дн. · срок был ${date}`,
    // One line has a sentence of its own: «среди них» does not fit a single one.
    unsorted: (n) =>
      n === 1
        ? 'В «Разобрать» 1 поступление — возможно, это оплата аренды.'
        : `В «Разобрать» ${n} ${ruPlural(n, 'поступление', 'поступления', 'поступлений')} — среди них могут быть оплаты аренды.`,

    wholeMonth: 'Весь месяц',
    collapse: 'Свернуть',
    countOf: (n, m) => `${n} из ${m}`,
    legendCount: '— оплачено',
    legendAllPaid: 'всё оплачено',
    legendLate: 'просрочено',
    legendAhead: 'Недели впереди — расчёт, пока аренда идёт',
    legendHow: 'Цифра у отметки — число оплат, сумма — сколько должно прийти за день.',
    legendPaidAhead: 'заранее',

    state: { paid: 'Оплачено', paid_ahead: 'Оплачено заранее', due_today: 'Ждём сегодня', expected: 'Ожидается', overdue: 'Просрочено' },
    said: { paid: 'оплачено', paid_ahead: 'оплачено заранее', due_today: 'ждём сегодня', expected: 'ожидается', overdue: 'просрочено' },
    withPayment: (word, when, how) => `${word} · ${when}, ${how}`,
    channels: { cash: 'наличные', acquiring: 'карта', transfer: 'перевод', deposit: 'из залога', offset: 'зачёт работ' },
    overdueLine: (days, debt) => `Просрочено · ${days}${debt === null ? '' : ` · долг ${debt}`}`,
    daysShort: (n) => `${n}\u00a0дн.`,
    // Accusative after «за»: «за 2 недели», «за 5 недель», «за 21 неделю».
    forWeeks: (n) => `за\u00a0${n}\u00a0${ruPlural(n, 'неделю', 'недели', 'недель')}`,
    partPaid: (paid, all) => `внесено ${paid} из ${all}`,
    paidFold: (n) => `Оплачено · ${n}`,
    noneThisDay: 'В этот день оплат нет.',
    tomorrowLine: (weekday, date) => `Завтра, ${weekday} ${date}`,
    remind: 'Напомнить',
    remindAria: (template) => `Напомнить в WhatsApp: ${template.toLowerCase()}`,

    cell: {
      week: (date, sum, n, m) => `${date}: ${sum}, оплачено ${n} из ${m}`,
      weekLate: (n) => `, просрочено ${n}`,
      marks: (date, sum, list) => `${date}: ${sum}: ${list}`,
      pastLate: (date) => `${date}: есть просрочка`,
      pastPaid: (date) => `${date}: всё оплачено`,
      ahead: (date, pays) => `${date}: по расчёту ${pays}`,
      none: (date) => `${date}: оплат нет`,
    },
  },
};

export const calendarKa: typeof calendarEn = {
  calendar: {
    todayIs: (weekday, date) => `დღეს — ${weekday}, ${date}`,
    wd: ['ორშ', 'სამ', 'ოთხ', 'ხუთ', 'პარ', 'შაბ', 'კვი'],
    weekdaysIn: ['კვირა', 'ორშაბათი', 'სამშაბათი', 'ოთხშაბათი', 'ხუთშაბათი', 'პარასკევი', 'შაბათი'],
    months: ['იანვარი', 'თებერვალი', 'მარტი', 'აპრილი', 'მაისი', 'ივნისი', 'ივლისი', 'აგვისტო', 'სექტემბერი', 'ოქტომბერი', 'ნოემბერი', 'დეკემბერი'],
    monthTitle: (month, year) => `${month} ${year}`,
    range,
    dayTitle: (weekday, date) => `${weekday}, ${date}`,
    todayLow: 'დღეს',
    tomorrowLow: 'ხვალ',
    tomorrow: 'ხვალ',

    weekThis: (period) => `ეს კვირა · ${period}`,
    weekOf: (period) => `კვირა ${period}`,
    paidOf: (paid, all) => `გადახდილია ${paid} / ${all}`,
    left: (sum) => `დარჩა ${sum}`,
    noneThisWeek: 'ამ კვირაში გადახდები არ არის',
    toCome: 'მისაღები',
    paidLabel: 'გადახდილია',
    leftLabel: 'დარჩა',
    // No plural after a number in Georgian.
    pays: (n) => `${n}\u00a0გადახდა`,
    dayTotal: (pays, sum) => `${pays} · ${sum}`,
    heaviest: (weekday, sum) => `ყველაზე დიდი დღე — ${weekday}, ${sum}`,
    heaviestOfWeek: 'კვირის ყველაზე დიდი დღე',
    came: (period) => `შემოსული ფული ${period}`,
    cameAria: 'ამ დღეების გადახდების გახსნა',
    late: (n) => `ვადაგადაცილებულია · ${n}`,
    lateListTitle: (n) => `სულ ვადაგადაცილებული · ${n}`,
    recordByHand: 'ხელით გატარება',
    scopeWeek: 'კვირა',
    scopeMonth: 'თვე',
    scopeAria: 'ჯამი',
    shortLabel: 'აკლია',
    waitingLabel: 'მოსალოდნელი',
    noneThisMonth: 'ამ თვეში გადახდები არ არის',
    monthTable: (month) => `${month} კვირების მიხედვით`,
    colWeek: 'კვირა',
    colDue: 'მისაღები',
    colPaid: 'გადახდილია',
    colShort: 'აკლია',
    colWaiting: 'მოსალოდნელი',
    monthTotal: 'სულ თვეში',
    partWeek: 'კვირის ნაწილი',
    monthShortNote: 'აკლია — გადახდები, რომელთა დღეც უკვე გავიდა. დღევანდელი და მომდევნო — „მოსალოდნელი“.',
    debt: (sum) => `ვალი ${sum}`,
    debtLabel: 'ვალი',
    // «ორშაბათიდან დღევანდელის ჩათვლით» — from Monday, today's included.
    ofThemThisWeek: (sum) => `აქედან ${sum} — ორშაბათიდან დღევანდელის ჩათვლით`,
    lateSplit: (week, earlier) => halves(week && `${week} — ორშაბათიდან დღევანდელის ჩათვლით`, earlier && `${earlier} — უფრო ადრე`),
    lateWholeDebt: (n) => `ვადაგადაცილებულია · მთელი ვალი ${n} ქირაობაზე`,
    noLate: 'ვადაგადაცილება არ არის',
    show: 'ჩვენება',
    hide: 'დამალვა',
    lateSince: (days, weeks, date) => `${days}\u00a0დღე · ${weeks}\u00a0კვირა, ${date}-დან`,
    lateDueWas: (days, date) => `${days}\u00a0დღე · ვადა იყო ${date}`,
    unsorted: (n) =>
      n === 1
        ? '„დასახარისხებელში“ 1 შემოსული სტრიქონია — შესაძლოა, ეს ქირის გადახდაა.'
        : `„დასახარისხებელში“ ${n} შემოსული სტრიქონია — მათ შორის შეიძლება ქირის გადახდებიც იყოს.`,

    wholeMonth: 'მთელი თვე',
    collapse: 'დაკეცვა',
    countOf: (n, m) => `${n} / ${m}`,
    legendCount: '— გადახდილია',
    legendAllPaid: 'ყველაფერი გადახდილია',
    legendLate: 'ვადაგადაცილებულია',
    legendAhead: 'მომდევნო კვირები — გათვლაა, სანამ ქირაობა გრძელდება',
    legendHow: 'ნიშანთან ციფრი — გადახდების რაოდენობაა, თანხა — რამდენი უნდა შემოვიდეს ამ დღეს.',
    // The first word of `said.paid_ahead`.
    legendPaidAhead: 'წინასწარ',

    state: { paid: 'გადახდილია', paid_ahead: 'წინასწარ გადახდილია', due_today: 'დღეს ველოდებით', expected: 'მოსალოდნელია', overdue: 'ვადაგადაცილებულია' },
    said: { paid: 'გადახდილია', paid_ahead: 'წინასწარ გადახდილია', due_today: 'დღეს ველოდებით', expected: 'მოსალოდნელია', overdue: 'ვადაგადაცილებულია' },
    withPayment: (word, when, how) => `${word} · ${when}, ${how}`,
    channels: { cash: 'ნაღდი', acquiring: 'ბარათი', transfer: 'გადარიცხვა', deposit: 'დეპოზიტიდან', offset: 'სამუშაოს ჩათვლა' },
    overdueLine: (days, debt) => `ვადაგადაცილებულია · ${days}${debt === null ? '' : ` · ვალი ${debt}`}`,
    daysShort: (n) => `${n}\u00a0დღე`,
    forWeeks: (n) => `${n}\u00a0კვირისთვის`,
    partPaid: (paid, all) => `გადახდილია ${paid} / ${all}`,
    paidFold: (n) => `გადახდილია · ${n}`,
    noneThisDay: 'ამ დღეს გადახდები არ არის.',
    tomorrowLine: (weekday, date) => `ხვალ, ${weekday} ${date}`,
    remind: 'შეხსენება',
    remindAria: (template) => `შეხსენება WhatsApp-ით: ${template}`,

    cell: {
      week: (date, sum, n, m) => `${date}: ${sum}, გადახდილია ${n} / ${m}`,
      weekLate: (n) => `, ვადაგადაცილებულია ${n}`,
      marks: (date, sum, list) => `${date}: ${sum}: ${list}`,
      pastLate: (date) => `${date}: არის ვადაგადაცილება`,
      pastPaid: (date) => `${date}: ყველაფერი გადახდილია`,
      ahead: (date, pays) => `${date}: გათვლით ${pays}`,
      none: (date) => `${date}: გადახდები არ არის`,
    },
  },
};
