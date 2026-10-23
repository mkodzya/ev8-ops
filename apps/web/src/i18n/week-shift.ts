// Moving the running week of a rental (ADR-0041). One file, so the Georgian
// goes to proofreading as one list (docs/qa/week-shift-ka-strings.md; what
// the addendum of 23.10.2026 changed — a week made shorter, credit — in
// docs/qa/pay-day-in-sort-ka-strings.md).

/** «+3», «−1»: days gained or lost, with a typographic minus. */
const signed = (n: number) => `${n > 0 ? '+' : '−'}${Math.abs(n)}`;

export const weekShiftEn = {
  weekShift: {
    action: 'Move the week',
    title: (seq: number, from: string, to: string) => `Move the week · week ${seq}, ${from}–${to}`,
    intro: 'The week becomes longer by these days and costs the extra — or shorter, for a discount. Every later week and the pay day move with it; money already on earlier weeks stays where it is.',
    nextFrom: 'The next week starts',
    dayOption: (weekday: string, date: string, days: number) => `${weekday}, ${date} · ${signed(days)} d`,
    asBefore: (weekday: string, date: string) => `${weekday}, ${date} · not moved`,
    extra: 'Extra for these days',
    extraHint: (rate: string, days: number, sum: string) => `By the rate: ${rate} ÷ 7 × ${days} = ${sum}. You decide the sum; 0 — the days are free.`,
    /** A week made shorter (addendum of 23.10.2026): what comes off its price. */
    less: 'Discount for these days',
    lessHint: (rate: string, days: number, sum: string) => `By the rate: ${rate} ÷ 7 × ${days} = ${sum}. You decide the sum; 0 — no discount.`,
    /** Paid on the week above its new price: what becomes of it, before it is written. */
    toCredit: (paid: string, sum: string) => `Paid ${paid} — ${sum} more than the new price: that money becomes rent credit and goes to the next week.`,
    reason: 'Reason',
    reasonHint: 'Required: for example, «paid three days late, with the three days».',
    summary: (seq: number, from: string, to: string, days: number, sum: string) => `Week ${seq} becomes ${from}–${to} (${days} days), ${sum}.`,
    next: (date: string, weekday: string, payDay: string) => `The next one from ${date}, ${weekday}; pay day — ${payDay}.`,
    undo: 'Back to 7 days, without the extra or the discount for days.',
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
    shortDays: (days: number) => `${signed(days)} d`,
    shortExtra: (sum: string) => `extra ${sum}`,
    /** A week made shorter: what came off it. */
    shortLess: (sum: string) => `discount ${sum}`,
    /** The journal's line of a move: which week, and each figure by its name. */
    journal: {
      week: (seq: number) => `week ${seq}`,
      endsOn: 'ends',
      amountTetri: 'price',
      extraDays: 'moved by',
      extraTetri: 'extra',
      /** A move's money on a line where a side is a shorter week's discount (below nought). */
      extraOrLess: 'extra / discount',
      /** What the move left above the week's new price, now the customer's credit (addendum rule 6). */
      credit: (sum: string) => `to credit: ${sum}`,
      days: (n: number) => (n === 0 ? 'none' : `${signed(n)} d`),
      payDay: 'pay day',
    },
  },
};

export const weekShiftRu: typeof weekShiftEn = {
  weekShift: {
    action: 'Сдвинуть неделю',
    title: (seq: number, from: string, to: string) => `Сдвинуть неделю · неделя ${seq}, ${from}–${to}`,
    intro: 'Неделя станет длиннее на эти дни и дороже на доплату — или короче, со скидкой. Все следующие недели и день оплаты сдвинутся вместе с ней; деньги прошлых недель останутся на своих местах.',
    nextFrom: 'Следующая неделя начнётся',
    dayOption: (weekday: string, date: string, days: number) => `${weekday}, ${date} · ${signed(days)} дн.`,
    asBefore: (weekday: string, date: string) => `${weekday}, ${date} · без сдвига`,
    extra: 'Доплата за эти дни',
    extraHint: (rate: string, days: number, sum: string) => `По тарифу: ${rate} ÷ 7 × ${days} = ${sum}. Сумму решаете вы; 0 — дни без доплаты.`,
    less: 'Скидка за эти дни',
    lessHint: (rate: string, days: number, sum: string) => `По тарифу: ${rate} ÷ 7 × ${days} = ${sum}. Сумму решаете вы; 0 — без скидки.`,
    toCredit: (paid: string, sum: string) => `Оплачено ${paid} — на ${sum} больше новой цены: эти деньги станут авансом по аренде и уйдут в следующую неделю.`,
    reason: 'Причина',
    reasonHint: 'Обязательна: например, «заплатил на 3 дня позже, с доплатой за дни».',
    summary: (seq: number, from: string, to: string, days: number, sum: string) => `Неделя ${seq} станет ${from}–${to} (${days} дн.), ${sum}.`,
    next: (date: string, weekday: string, payDay: string) => `Следующая — с ${date}, ${weekday}; день оплаты — ${payDay}.`,
    undo: 'Снова 7 дней, без доплаты и скидки за дни.',
    done: 'Неделя сдвинута',
    undoAction: 'Убрать сдвиг',
    undone: 'Сдвиг убран',
    daysHint: 'Предложено столько дней, на сколько он опоздал: следующий день оплаты — через 7 дней от сегодня. Если деньги пришли в другой день, выберите так, чтобы день оплаты был через неделю после него.',
    shortDays: (days: number) => `${signed(days)} дн.`,
    shortExtra: (sum: string) => `доплата ${sum}`,
    shortLess: (sum: string) => `скидка ${sum}`,
    journal: {
      week: (seq: number) => `неделя ${seq}`,
      endsOn: 'конец',
      amountTetri: 'сумма',
      extraDays: 'сдвиг',
      extraTetri: 'доплата',
      extraOrLess: 'доплата / скидка',
      credit: (sum: string) => `в аванс: ${sum}`,
      days: (n: number) => (n === 0 ? 'нет' : `${signed(n)} дн.`),
      payDay: 'день оплаты',
    },
  },
};

export const weekShiftKa: typeof weekShiftEn = {
  weekShift: {
    action: 'კვირის გადაწევა',
    title: (seq: number, from: string, to: string) => `კვირის გადაწევა · კვირა ${seq}, ${from}–${to}`,
    intro: 'კვირა ამ დღეებით გაგრძელდება და დამატებითი თანხით გაძვირდება — ან შემოკლდება, ფასდაკლებით. ყველა შემდეგი კვირა და გადახდის დღე მასთან ერთად გადაიწევა; წინა კვირების თანხა თავის ადგილზე რჩება.',
    nextFrom: 'შემდეგი კვირა დაიწყება',
    dayOption: (weekday: string, date: string, days: number) => `${weekday}, ${date} · ${signed(days)} დღე`,
    asBefore: (weekday: string, date: string) => `${weekday}, ${date} · გადაწევის გარეშე`,
    extra: 'დამატებითი თანხა ამ დღეებისთვის',
    extraHint: (rate: string, days: number, sum: string) => `ტარიფით: ${rate} ÷ 7 × ${days} = ${sum}. თანხას თქვენ წყვეტთ; 0 — დღეები დამატებითი თანხის გარეშე.`,
    less: 'ფასდაკლება ამ დღეებისთვის',
    lessHint: (rate: string, days: number, sum: string) => `ტარიფით: ${rate} ÷ 7 × ${days} = ${sum}. თანხას თქვენ წყვეტთ; 0 — ფასდაკლების გარეშე.`,
    toCredit: (paid: string, sum: string) => `გადახდილია ${paid} — ახალ ფასზე ${sum}-ით მეტი: ეს თანხა ქირის ავანსი გახდება და მომდევნო კვირაში წავა.`,
    reason: 'მიზეზი',
    reasonHint: 'სავალდებულოა: მაგალითად, «3 დღით გვიან გადაიხადა, დღეების დამატებით».',
    summary: (seq: number, from: string, to: string, days: number, sum: string) => `კვირა ${seq} გახდება ${from}–${to} (${days} დღე), ${sum}.`,
    next: (date: string, weekday: string, payDay: string) => `შემდეგი — ${date}-დან, ${weekday}; გადახდის დღე — ${payDay}.`,
    undo: 'ისევ 7 დღე, დამატებითი თანხისა და დღეების ფასდაკლების გარეშე.',
    done: 'კვირა გადაიწია',
    undoAction: 'გადაწევის გაუქმება',
    undone: 'გადაწევა გაუქმდა',
    daysHint: 'შემოთავაზებულია დაგვიანების დღეები: შემდეგი გადახდის დღე — დღეიდან 7 დღეში. თუ თანხა სხვა დღეს შემოვიდა, აირჩიეთ ისე, რომ გადახდის დღე ამ დღიდან ერთი კვირის შემდეგ იყოს.',
    shortDays: (days: number) => `${signed(days)} დღე`,
    shortExtra: (sum: string) => `დამატებით ${sum}`,
    shortLess: (sum: string) => `ფასდაკლება ${sum}`,
    journal: {
      week: (seq: number) => `კვირა ${seq}`,
      endsOn: 'დასასრული',
      amountTetri: 'თანხა',
      extraDays: 'გადაწევა',
      extraTetri: 'დამატებით',
      extraOrLess: 'დამატებით / ფასდაკლება',
      credit: (sum: string) => `ავანსში: ${sum}`,
      days: (n: number) => (n === 0 ? 'არა' : `${signed(n)} დღე`),
      payDay: 'გადახდის დღე',
    },
  },
};
