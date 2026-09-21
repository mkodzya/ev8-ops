// Wave 6 words: "Отчёты → Загрузка парка аренды" (docs/redesign/wave-6.md
// §3.2). One file, so the Georgian goes to proofreading as one list.
//
// Two of these lines exist because a figure must not lie quietly. The one
// about mopeds with no park says what the percentage left out; the one about
// batteries says that nothing in the data ties a repair to a missing
// battery, instead of showing a 0 nobody counted (CLAUDE.md rule 1).

export const wave6utilEn = {
  utilisationReport: {
    title: 'Rental fleet utilisation',
    subtitle: 'Days the mopeds were out, against the days they stood in the rental park.',
    week: 'Week',
    month: 'Month',
    from: 'From',
    to: 'To',
    period: (from: string, to: string) => `${from} — ${to}`,

    basis: (rented: number, pool: number) => `${rented} days out with customers of ${pool} in the park`,
    vehicles: (n: number) => `${n} ${n === 1 ? 'moped' : 'mopeds'}`,
    noFigure: 'no figure: no moped stood in the rental park over this period',
    unassigned: (n: number) => `${n} ${n === 1 ? 'moped is' : 'mopeds are'} outside the figure: no park has claimed ${n === 1 ? 'it' : 'them'}`,
    unassignedLink: 'Show them',

    byModel: 'By model',
    model: 'Model',
    count: 'Mopeds',
    load: 'Utilisation',

    blockers: 'What is in the way',
    inRepairAllPeriod: 'In repair the whole period',
    freeTooLong: (days: number) => `Free for longer than ${days} days`,
    batteries: 'Held in repair by batteries',
    none: 'none',
    noRecord: 'no data — nothing ties a repair to a battery',
    days: (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`,
  },
};

export const wave6utilRu: typeof wave6utilEn = {
  utilisationReport: {
    title: 'Загрузка парка аренды',
    subtitle: 'Дни, когда мопеды были в аренде, против дней, когда они стояли в парке аренды.',
    week: 'Неделя',
    month: 'Месяц',
    from: 'С',
    to: 'По',
    period: (from: string, to: string) => `${from} — ${to}`,

    basis: (rented: number, pool: number) => `дни в аренде ${rented} из ${pool}`,
    vehicles: (n: number) => `${n} ${ruPlural(n, 'мопед', 'мопеда', 'мопедов')}`,
    noFigure: 'цифры нет: в парке аренды за этот период не стояло ни одного мопеда',
    unassigned: (n: number) => `${n} ${ruPlural(n, 'мопед', 'мопеда', 'мопедов')} без парка не в счёте`,
    unassignedLink: 'Показать',

    byModel: 'По моделям',
    model: 'Модель',
    count: 'Мопедов',
    load: 'Загрузка',

    blockers: 'Что мешает',
    inRepairAllPeriod: 'В ремонте весь период',
    freeTooLong: (days: number) => `Свободны дольше ${days} дней`,
    batteries: 'Не выходят из ремонта из-за батарей',
    none: 'нет',
    noRecord: 'нет данных — связи ремонта с батареями не ведётся',
    days: (n: number) => `${n} ${ruPlural(n, 'день', 'дня', 'дней')}`,
  },
};

export const wave6utilKa: typeof wave6utilEn = {
  utilisationReport: {
    title: 'საქირავო პარკის დატვირთვა',
    subtitle: 'დღეები, როცა მოპედები ქირაში იყო, იმ დღეებთან შედარებით, როცა საქირავო პარკში იდგა.',
    week: 'კვირა',
    month: 'თვე',
    from: 'დან',
    to: 'მდე',
    period: (from: string, to: string) => `${from} — ${to}`,

    basis: (rented: number, pool: number) => `${rented} დღე ქირაში ${pool}-დან`,
    vehicles: (n: number) => `${n} მოპედი`,
    noFigure: 'ციფრი არ არის: ამ პერიოდში საქირავო პარკში არცერთი მოპედი არ მდგარა',
    unassigned: (n: number) => `${n} მოპედი პარკის გარეშე — ანგარიშში არ შედის`,
    unassignedLink: 'ჩვენება',

    byModel: 'მოდელების მიხედვით',
    model: 'მოდელი',
    count: 'მოპედი',
    load: 'დატვირთვა',

    blockers: 'რა უშლის ხელს',
    inRepairAllPeriod: 'რემონტშია მთელი პერიოდის განმავლობაში',
    freeTooLong: (days: number) => `თავისუფალია ${days} დღეზე მეტი ხნის განმავლობაში`,
    batteries: 'ბატარეების გამო რემონტიდან ვერ გამოდის',
    none: 'არ არის',
    noRecord: 'მონაცემები არ არის — შეკეთება ბატარეას არ უკავშირდება',
    days: (n: number) => `${n} დღე`,
  },
};

/** The Russian three forms; the same rule as in `wave6-week.ts`. */
function ruPlural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
