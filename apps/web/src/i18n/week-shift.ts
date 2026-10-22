// Moving the running week of a rental (ADR-0041). One file, so the Georgian
// goes to proofreading as one list (docs/qa/week-shift-ka-strings.md).

export const weekShiftEn = {
  weekShift: {
    action: 'Move the week',
    title: (seq: number, from: string, to: string) => `Move the week · week ${seq}, ${from}–${to}`,
    intro: 'The week becomes longer by these days and costs the extra. Every later week and the pay day move with it; money already on earlier weeks stays where it is.',
    nextFrom: 'The next week starts',
    dayOption: (weekday: string, date: string, days: number) => `${weekday}, ${date} · +${days} d`,
    asBefore: (weekday: string, date: string) => `${weekday}, ${date} · not moved`,
    extra: 'Extra for these days',
    extraHint: (rate: string, days: number, sum: string) => `By the rate: ${rate} ÷ 7 × ${days} = ${sum}. You decide the sum; 0 — the days are free.`,
    reason: 'Reason',
    reasonHint: 'Required: for example, «paid three days late, with the three days».',
    summary: (seq: number, from: string, to: string, days: number, sum: string) => `Week ${seq} becomes ${from}–${to} (${days} days), ${sum}.`,
    next: (date: string, weekday: string, payDay: string) => `The next one from ${date}, ${weekday}; pay day — ${payDay}.`,
    undo: 'Back to 7 days, without the extra.',
    done: 'Week moved',
    /** Taking a move back has its own words, not those of making one. */
    undoAction: 'Take the move back',
    undone: 'Move taken back',
    /** Why the sheet offers the days it offers (ux.md №15). */
    daysHint: 'Offered: the days he is late, so the next pay day is a week from today. If the money came on another day, choose so the pay day falls a week after it.',
    /**
     * Beside the price of a week made longer, in the table of weeks: two pieces
     * that never break inside, wrapping between them in a narrow column (QA 21.10.2026).
     */
    shortDays: (days: number) => `+${days} d`,
    shortExtra: (sum: string) => `extra ${sum}`,
    /** The journal's line of a move: which week, and each figure by its name. */
    journal: {
      week: (seq: number) => `week ${seq}`,
      endsOn: 'ends',
      amountTetri: 'price',
      extraDays: 'moved by',
      extraTetri: 'extra',
      days: (n: number) => (n === 0 ? 'none' : `+${n} d`),
      payDay: 'pay day',
    },
  },
};

export const weekShiftRu: typeof weekShiftEn = {
  weekShift: {
    action: 'Сдвинуть неделю',
    title: (seq: number, from: string, to: string) => `Сдвинуть неделю · неделя ${seq}, ${from}–${to}`,
    intro: 'Неделя станет длиннее на эти дни и дороже на доплату. Все следующие недели и день оплаты сдвинутся вместе с ней; деньги прошлых недель останутся на своих местах.',
    nextFrom: 'Следующая неделя начнётся',
    dayOption: (weekday: string, date: string, days: number) => `${weekday}, ${date} · +${days} дн.`,
    asBefore: (weekday: string, date: string) => `${weekday}, ${date} · без сдвига`,
    extra: 'Доплата за эти дни',
    extraHint: (rate: string, days: number, sum: string) => `По тарифу: ${rate} ÷ 7 × ${days} = ${sum}. Сумму решаете вы; 0 — дни без доплаты.`,
    reason: 'Причина',
    reasonHint: 'Обязательна: например, «заплатил на 3 дня позже, с доплатой за дни».',
    summary: (seq: number, from: string, to: string, days: number, sum: string) => `Неделя ${seq} станет ${from}–${to} (${days} дн.), ${sum}.`,
    next: (date: string, weekday: string, payDay: string) => `Следующая — с ${date}, ${weekday}; день оплаты — ${payDay}.`,
    undo: 'Снова 7 дней, без доплаты.',
    done: 'Неделя сдвинута',
    undoAction: 'Убрать сдвиг',
    undone: 'Сдвиг убран',
    daysHint: 'Предложено столько дней, на сколько он опоздал: следующий день оплаты — через 7 дней от сегодня. Если деньги пришли в другой день, выберите так, чтобы день оплаты был через неделю после него.',
    shortDays: (days: number) => `+${days} дн.`,
    shortExtra: (sum: string) => `доплата ${sum}`,
    journal: {
      week: (seq: number) => `неделя ${seq}`,
      endsOn: 'конец',
      amountTetri: 'сумма',
      extraDays: 'сдвиг',
      extraTetri: 'доплата',
      days: (n: number) => (n === 0 ? 'нет' : `+${n} дн.`),
      payDay: 'день оплаты',
    },
  },
};

export const weekShiftKa: typeof weekShiftEn = {
  weekShift: {
    action: 'კვირის გადაწევა',
    title: (seq: number, from: string, to: string) => `კვირის გადაწევა · კვირა ${seq}, ${from}–${to}`,
    intro: 'კვირა ამ დღეებით გაგრძელდება და დამატებითი თანხით გაძვირდება. ყველა შემდეგი კვირა და გადახდის დღე მასთან ერთად გადაიწევა; წინა კვირების თანხა თავის ადგილზე რჩება.',
    nextFrom: 'შემდეგი კვირა დაიწყება',
    dayOption: (weekday: string, date: string, days: number) => `${weekday}, ${date} · +${days} დღე`,
    asBefore: (weekday: string, date: string) => `${weekday}, ${date} · გადაწევის გარეშე`,
    extra: 'დამატებითი თანხა ამ დღეებისთვის',
    extraHint: (rate: string, days: number, sum: string) => `ტარიფით: ${rate} ÷ 7 × ${days} = ${sum}. თანხას თქვენ წყვეტთ; 0 — დღეები დამატებითი თანხის გარეშე.`,
    reason: 'მიზეზი',
    reasonHint: 'სავალდებულოა: მაგალითად, «3 დღით გვიან გადაიხადა, დღეების დამატებით».',
    summary: (seq: number, from: string, to: string, days: number, sum: string) => `კვირა ${seq} გახდება ${from}–${to} (${days} დღე), ${sum}.`,
    next: (date: string, weekday: string, payDay: string) => `შემდეგი — ${date}-დან, ${weekday}; გადახდის დღე — ${payDay}.`,
    undo: 'ისევ 7 დღე, დამატებითი თანხის გარეშე.',
    done: 'კვირა გადაიწია',
    undoAction: 'გადაწევის გაუქმება',
    undone: 'გადაწევა გაუქმდა',
    daysHint: 'შემოთავაზებულია დაგვიანების დღეები: შემდეგი გადახდის დღე — დღეიდან 7 დღეში. თუ თანხა სხვა დღეს შემოვიდა, აირჩიეთ ისე, რომ გადახდის დღე ამ დღიდან ერთი კვირის შემდეგ იყოს.',
    shortDays: (days: number) => `+${days} დღე`,
    shortExtra: (sum: string) => `დამატებით ${sum}`,
    journal: {
      week: (seq: number) => `კვირა ${seq}`,
      endsOn: 'დასასრული',
      amountTetri: 'თანხა',
      extraDays: 'გადაწევა',
      extraTetri: 'დამატებით',
      days: (n: number) => (n === 0 ? 'არა' : `+${n} დღე`),
      payDay: 'გადახდის დღე',
    },
  },
};
