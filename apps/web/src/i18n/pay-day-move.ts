// «Перенос дня оплаты» in «Разнести» (issue #12 of the director, Mika's «А» of
// 23.10.2026; ADR-0041, addendum of 23.10.2026): the renter's latest week
// moved by the pay day he asked for, while his bank line is allocated. One
// file, so the Georgian goes to proofreading as one list
// (docs/qa/pay-day-in-sort-ka-strings.md). The words of the move itself —
// «Доплата за эти дни», «Скидка за эти дни», «Причина» — are the rental
// card's, in week-shift.ts: one move, one vocabulary.

const ruPlural = (n: number, one: string, few: string, many: string): string => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};
/** «+1», «−3»: a typographic minus, as the rest of the product writes it. */
const signed = (n: number) => `${n > 0 ? '+' : '−'}${Math.abs(n)}`;

export const payDayMoveEn = {
  payDayMove: {
    /** The part of «Allocate», beside «Rent» and «Charge». */
    title: 'Pay day moved',
    /** Beside the weekday he pays on today, in the list. */
    now: 'now',
    /** ISO order, Monday first: «moved to Friday». */
    onDay: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
    /** The days a week gains or loses: «+1 day», «−3 days». */
    days: (n: number) => `${signed(n)} ${Math.abs(n) === 1 ? 'day' : 'days'}`,
    option: (day: string, days: string) => `${day} · ${days}`,
    /** A day that would end a shorter week before today: in the list, not to be chosen. */
    tooEarly: (day: string) => `${day} · the week would end before today`,
    plan: (was: string, now: string, days: string, weekday: string, date: string) => `The week ${was} becomes ${now} (${days}); next payment — ${weekday} ${date}.`,
    /** Filled in, and the person may change it. */
    reasonAuto: (day: string, lineDay: string) => `pay day moved to ${day}, paid by the bank line of ${lineDay}`,
    resLonger: (a: string, day: string, days: string, r: string) => `${a} — pay day moved to ${day} (${days}), ${r}.`,
    resShorter: (day: string, days: string, r: string, week: string, off: string) => `Pay day moved to ${day} (${days}), ${r}: the week becomes ${week} and ${off} cheaper.`,
    /** The move with 0 typed — still written, so still said (review of 23.10.2026). */
    resLongerFree: (day: string, days: string, r: string) => `Pay day moved to ${day} (${days}), no extra, ${r}.`,
    resShorterFree: (day: string, days: string, r: string, week: string) => `Pay day moved to ${day} (${days}), ${r}: the week becomes ${week}, no discount.`,
    /** Why the move is shown closed: the line pays an older week (the director's words). */
    olderOpen: 'first pay the current week',
    moved: 'The week is moved already — change its move on the rental card.',
    done: (n: number, day: string) => `Line allocated into ${n} parts; pay day — ${day}`,
    /** The move's reason when the message's «Undo» takes it back with the line. */
    undoReason: 'taken back right after the bank line was allocated',
  },
};

export const payDayMoveRu: typeof payDayMoveEn = {
  payDayMove: {
    title: 'Перенос дня оплаты',
    now: 'сейчас',
    onDay: ['понедельник', 'вторник', 'среду', 'четверг', 'пятницу', 'субботу', 'воскресенье'],
    days: (n: number) => `${signed(n)} ${ruPlural(Math.abs(n), 'день', 'дня', 'дней')}`,
    option: (day: string, days: string) => `${day} · ${days}`,
    tooEarly: (day: string) => `${day} · неделя кончилась бы раньше сегодняшнего дня`,
    plan: (was: string, now: string, days: string, weekday: string, date: string) => `Неделя ${was} станет ${now} (${days}), следующая оплата — ${weekday} ${date}.`,
    reasonAuto: (day: string, lineDay: string) => `перенос дня оплаты на ${day}, оплачено строкой выписки от ${lineDay}`,
    resLonger: (a: string, day: string, days: string, r: string) => `${a} — перенос дня оплаты на ${day} (${days}), ${r}.`,
    resShorter: (day: string, days: string, r: string, week: string, off: string) => `Перенос дня оплаты на ${day} (${days}), ${r}: неделя станет ${week} и дешевле на ${off}.`,
    resLongerFree: (day: string, days: string, r: string) => `Перенос дня оплаты на ${day} (${days}), без доплаты, ${r}.`,
    resShorterFree: (day: string, days: string, r: string, week: string) => `Перенос дня оплаты на ${day} (${days}), ${r}: неделя станет ${week}, без скидки.`,
    olderOpen: 'сначала оплатите текущую неделю',
    moved: 'Неделя уже сдвинута — поправьте сдвиг в карточке аренды.',
    done: (n: number, day: string) => `Строка разнесена, частей: ${n}; день оплаты — ${day}`,
    undoReason: 'отменено сразу после разнесения строки выписки',
  },
};

export const payDayMoveKa: typeof payDayMoveEn = {
  payDayMove: {
    title: 'გადახდის დღის გადაწევა',
    now: 'ახლა',
    onDay: ['ორშაბათზე', 'სამშაბათზე', 'ოთხშაბათზე', 'ხუთშაბათზე', 'პარასკევზე', 'შაბათზე', 'კვირაზე'],
    days: (n: number) => `${signed(n)} დღე`,
    option: (day: string, days: string) => `${day} · ${days}`,
    tooEarly: (day: string) => `${day} · კვირა დღევანდელზე ადრე დასრულდებოდა`,
    plan: (was: string, now: string, days: string, weekday: string, date: string) => `კვირა ${was} გახდება ${now} (${days}), შემდეგი გადახდა — ${weekday} ${date}.`,
    reasonAuto: (day: string, lineDay: string) => `გადახდის დღის გადაწევა ${day}, გადახდილია ${lineDay}-ის ამონაწერის ხაზით`,
    resLonger: (a: string, day: string, days: string, r: string) => `${a} — გადახდის დღის გადაწევა ${day} (${days}), ${r}.`,
    resShorter: (day: string, days: string, r: string, week: string, off: string) => `გადახდის დღის გადაწევა ${day} (${days}), ${r}: კვირა გახდება ${week} და ${off}-ით გაიაფდება.`,
    resLongerFree: (day: string, days: string, r: string) => `გადახდის დღის გადაწევა ${day} (${days}), დამატებითი თანხის გარეშე, ${r}.`,
    resShorterFree: (day: string, days: string, r: string, week: string) => `გადახდის დღის გადაწევა ${day} (${days}), ${r}: კვირა გახდება ${week}, ფასდაკლების გარეშე.`,
    olderOpen: 'ჯერ მიმდინარე კვირა გადაიხადეთ',
    moved: 'კვირა უკვე გადაწეულია — გადაწევა ქირაობის ბარათში შეასწორეთ.',
    done: (n: number, day: string) => `ხაზი განაწილდა ${n} ნაწილად; გადახდის დღე — ${day}`,
    undoReason: 'გაუქმდა ხაზის განაწილებისთანავე',
  },
};
