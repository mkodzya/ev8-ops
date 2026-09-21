// Wave 6 words: "Отчёты → Неделя" (docs/redesign/wave-6.md §3.1). One file,
// so the Georgian goes to proofreading as one list.

const ruPlural = (n: number, one: string, few: string, many: string): string => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};

export const wave6weekEn = {
  weekReport: {
    rowTotals: {
      rent: 'Of these, rent for the week',
      sale: 'Of these, sales for the week',
      deposits: 'Of these, deposits for the week',
      service: 'Of these, repairs for the week',
    } as Record<string, string>,
    title: 'The week',
    subtitle: 'The figures of the book, for the week that starts on Monday. Every one of them leads to the list it is made of.',
    thisWeek: 'This week',
    lastWeek: 'Last week',
    custom: 'Period',
    from: 'From',
    to: 'To',
    period: (from: string, to: string) => `Week ${from} — ${to}`,
    asOf: (day: string) => `figures as at ${day}`,

    rented: 'Mopeds out with customers',
    free: 'Free in the rental park',
    inService: 'In repair',
    serviceDays: (n: number) => `up to ${n} ${n === 1 ? 'day' : 'days'}`,
    startedReturned: 'New rentals · returns',
    overdue: 'Overdue rent',
    overdueRentals: (n: number) => `${n} ${n === 1 ? 'rental' : 'rentals'}`,

    inTotal: 'Received in all',
    inRent: 'Received — rent',
    inSales: 'Received — sales',
    depositsIn: 'Deposits received',
    inRepairs: 'Received — repairs',
    acquiringFee: 'Acquiring fee',
    depositsOut: 'Deposits handed back',
    withheld: 'Kept out of deposits',
    held: 'Deposits held',

    utilisation: 'Rental fleet utilisation',
    basis: (rented: number, pool: number) => `${rented} days out of ${pool} in the park`,
    unassigned: (n: number) => `${n} ${n === 1 ? 'moped is' : 'mopeds are'} outside the figure: no park has claimed ${n === 1 ? 'it' : 'them'}`,

    batteries: 'Batteries: showroom · couriers · repair',
    batteriesToday: 'The battery count is today’s, not the week’s.',
    heldToday: 'Deposits still with us: today’s figure, not the end of that week.',
    unmatched: 'Statement lines not sorted',
    swaps: 'Battery swaps',
    noRecord: 'no data — no record is kept',

    beforeTransfer: 'Paid before the transfer',
    beforeTransferNote: 'Not part of the week’s takings: this money carries neither a day nor a payment.',

    print: 'Print · PDF',
    copy: 'Copy for the book',
    copied: 'Copied',
    copyFailed: 'Could not copy — the text is below',
    decisions: 'The week’s decisions',
    decisionsNote: 'They go into the book (weekly/), not into the system: the system gives the figures, the decisions stay with people.',
  },
};

export const wave6weekRu: typeof wave6weekEn = {
  weekReport: {
    rowTotals: {
      rent: 'Из них в «аренду» за неделю',
      sale: 'Из них в «продажи» за неделю',
      deposits: 'Из них в «залоги» за неделю',
      service: 'Из них в «ремонт» за неделю',
    },
    title: 'Неделя',
    subtitle: 'Цифры книги за неделю с понедельника. Каждая ведёт в список, из которого сложена.',
    thisWeek: 'Эта неделя',
    lastWeek: 'Прошлая',
    custom: 'Период',
    from: 'С',
    to: 'По',
    period: (from: string, to: string) => `Неделя ${from} — ${to}`,
    asOf: (day: string) => `данные на ${day}`,

    rented: 'Мопедов в аренде',
    free: 'Свободных в парке аренды',
    inService: 'В ремонте',
    serviceDays: (n: number) => `до ${n} ${ruPlural(n, 'дня', 'дней', 'дней')}`,
    startedReturned: 'Новые аренды · возвраты',
    overdue: 'Просрочка',
    overdueRentals: (n: number) => `${n} ${ruPlural(n, 'аренда', 'аренды', 'аренд')}`,

    inTotal: 'Поступило всего',
    inRent: 'Поступило — аренда',
    inSales: 'Поступило — продажи',
    depositsIn: 'Получено залогов',
    inRepairs: 'Поступило — ремонт',
    acquiringFee: 'Комиссия эквайринга',
    depositsOut: 'Выдано залогов',
    withheld: 'Удержано из залогов',
    held: 'Залоги на руках',

    utilisation: 'Загрузка парка аренды',
    basis: (rented: number, pool: number) => `дни в аренде ${rented} из ${pool}`,
    unassigned: (n: number) => `${n} ${ruPlural(n, 'мопед', 'мопеда', 'мопедов')} без парка не в счёте`,

    batteries: 'Батареи: шоурум · курьеры · ремонт',
    batteriesToday: 'Количество батарей — на сегодня, а не на конец недели.',
    heldToday: 'Залоги на руках — на сегодня, а не на конец той недели.',
    unmatched: 'Неразобранные строки выписок',
    swaps: 'Замены батарей',
    noRecord: 'нет данных — учёта нет',

    beforeTransfer: 'Оплачено до переноса',
    beforeTransferNote: 'В поступления недели не входит: у этих денег нет ни дня, ни платежа.',

    print: 'Печать · PDF',
    copy: 'Скопировать в книгу',
    copied: 'Скопировано',
    copyFailed: 'Не удалось скопировать — текст ниже',
    decisions: 'Решения недели',
    decisionsNote: 'Пишутся в книгу (weekly/), не в систему: система даёт цифры, решения остаются у людей.',
  },
};

export const wave6weekKa: typeof wave6weekEn = {
  weekReport: {
    rowTotals: {
      rent: 'აქედან „ქირაში“ კვირის განმავლობაში',
      sale: 'აქედან „გაყიდვებში“ კვირის განმავლობაში',
      deposits: 'აქედან „გირაოში“ კვირის განმავლობაში',
      service: 'აქედან „რემონტში“ კვირის განმავლობაში',
    },
    title: 'კვირა',
    subtitle: 'წიგნის ციფრები ორშაბათიდან დაწყებულ კვირაზე. თითოეული მიგიყვანთ იმ სიასთან, რისგანაც შედგება.',
    thisWeek: 'ეს კვირა',
    lastWeek: 'წინა',
    custom: 'პერიოდი',
    from: 'დან',
    to: 'მდე',
    period: (from: string, to: string) => `კვირა ${from} — ${to}`,
    asOf: (day: string) => `მონაცემები ${day}-ის მდგომარეობით`,

    rented: 'მოპედი ქირაშია',
    free: 'თავისუფალია საქირავო პარკში',
    inService: 'რემონტშია',
    serviceDays: (n: number) => `${n} დღემდე`,
    startedReturned: 'ახალი ქირაობა · დაბრუნება',
    overdue: 'ვადაგადაცილება',
    overdueRentals: (n: number) => `${n} ქირაობა`,

    inTotal: 'სულ შემოსული',
    inRent: 'შემოსული — ქირა',
    inSales: 'შემოსული — გაყიდვები',
    depositsIn: 'მიღებული დეპოზიტები',
    inRepairs: 'შემოსული — შეკეთება',
    acquiringFee: 'ექვაირინგის საკომისიო',
    depositsOut: 'დაბრუნებული დეპოზიტები',
    withheld: 'დეპოზიტიდან დაკავებული',
    held: 'დეპოზიტები ხელზე',

    utilisation: 'საქირავო პარკის დატვირთვა',
    basis: (rented: number, pool: number) => `${rented} დღე ქირაში ${pool}-დან`,
    unassigned: (n: number) => `${n} მოპედი პარკის გარეშე — ანგარიშში არ შედის`,

    batteries: 'ბატარეები: შოურუმი · კურიერები · რემონტი',
    batteriesToday: 'ბატარეების რაოდენობა დღევანდელი მდგომარეობითაა, არა კვირის ბოლოს.',
    heldToday: 'გირაოები ხელზე — დღევანდელი ციფრი, და არა იმ კვირის ბოლოს.',
    unmatched: 'ამონაწერის დაუხარისხებელი ხაზები',
    swaps: 'ბატარეის შეცვლა',
    noRecord: 'მონაცემები არ არის — აღრიცხვა არ იწარმოება',

    beforeTransfer: 'გადმოტანამდე გადახდილი',
    beforeTransferNote: 'კვირის შემოსავალში არ შედის: ამ ფულს არც დღე აქვს და არც გადახდა.',

    print: 'ბეჭდვა · PDF',
    copy: 'წიგნში კოპირება',
    copied: 'დაკოპირდა',
    copyFailed: 'კოპირება ვერ მოხერხდა — ტექსტი ქვემოთაა',
    decisions: 'კვირის გადაწყვეტილებები',
    decisionsNote: 'იწერება წიგნში (weekly/), არა სისტემაში: სისტემა იძლევა ციფრებს, გადაწყვეტილებები ხალხთან რჩება.',
  },
};
