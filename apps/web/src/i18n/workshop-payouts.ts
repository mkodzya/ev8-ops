// Paying the mechanic (stage 5 of the mechanic plan; prototype
// docs/redesign/prototypes/mechanic-payouts-options.html, variants A and A,
// chosen by Mika on 20.10.2026; ADR-0037). One file, so the Georgian goes to
// proofreading as one list. The Georgian is the session's translation; the
// director proofreads it. Words EV8 Ops already had — ნორმის გარეშე,
// ელოდება დამტკიცებას, მუშავდება, ქვითარი, ფული, დასახარისხებელი, ხარჯი —
// are taken from there; გადასახდელი, გადახდები and ბალანსი are new.

export const workshopPayoutsEn = {
  wpay: {
    sub: (people: number, jobs: number, sum: string) => `${people} ${people === 1 ? 'mechanic' : 'mechanics'} · ${jobs} ${jobs === 1 ? 'repair' : 'repairs'} · ${sum}`,
    rate: (gel: string) => `${gel} an hour of norm`,
    roles: { mechanic: 'mechanic', chief_mechanic: 'chief mechanic' } as Record<string, string>,
    closed: (day: string) => `closed ${day}`,
    receipt: 'receipt',
    workCol: 'Work',
    otherJob: (number: string) => `in ${number}`,
    work: (jobs: number, time: string) => `Work · ${jobs} ${jobs === 1 ? 'repair' : 'repairs'} · ${time}`,
    receipts: (n: number) => `Receipts · ${n}`,
    total: 'Total',
    more: (n: number) => `${n} more ${n === 1 ? 'repair' : 'repairs'}`,
    pay: (sum: string) => `Paid · ${sum}`,
    confirmTitle: (who: string, sum: string) => `Mark ${who} paid — ${sum}?`,
    confirmWhat: (jobs: number, work: string, receipts: string | null) =>
      `${jobs} ${jobs === 1 ? 'repair becomes' : 'repairs become'} «Paid» and ${jobs === 1 ? 'is' : 'are'} not changed any more: work ${work}${receipts ? `, receipts ${receipts}` : ''}.`,
    confirmNote: 'This is a mark, not a payment: nothing appears in Money. Sort the transfer to the mechanic in «Sort» as «Expense ▸».',
    marked: (who: string, sum: string) => `${who}: payout ${sum} marked`,
    none: 'Nothing to pay. A closed repair comes here once every work on it has a norm.',
    heldHead: 'Not to pay yet',
    held: { unnormed: 'no norm', waiting: 'waits for approval', open: 'in work' } as Record<string, string>,
    payoutsHead: 'Payouts',
    payoutsNone: 'No payouts yet.',
    jobsN: (n: number) => `${n} ${n === 1 ? 'repair' : 'repairs'}`,
    markedBy: (who: string) => `marked by ${who}`,
    voided: (reason: string) => `cancelled: ${reason}`,
    void: 'Cancel the payout',
    voidTitle: (day: string, who: string, sum: string) => `Cancel the payout of ${day} — ${who}, ${sum}?`,
    voidReason: 'Reason — it shows in the journal',
    voidNote: (jobs: number) =>
      `${jobs} ${jobs === 1 ? 'repair goes' : 'repairs go'} back to «To pay» and can be changed again. This does not bring the money back — it takes the mark away.`,
    voidDone: 'Payout cancelled',
    paid: 'Paid',
    paidIn: (day: string, who: string) => `${day} · marked by ${who}. The repair is not changed any more.`,
    reimbursed: 'paid back',
    worksCost: 'Mechanic’s work by the norm',
    // The mechanic's balance (variant A: its own screen, a button on «Ремонт»).
    balanceLink: (sum: string) => `Balance · ${sum}`,
    toPay: 'To pay',
    toPaySub: (jobs: number, work: string, receipts: string) => `${jobs} ${jobs === 1 ? 'repair' : 'repairs'} · work ${work} + receipts ${receipts} · paid once a week`,
    waiting: 'Waits for approval',
    inWork: 'In work',
    inWorkNote: 'to pay once closed',
    unnormed: 'No norm',
    unnormedNote: 'waits for a norm from the chief mechanic',
    payBack: (sum: string) => `receipt ${sum} comes back to you`,
    nothingYet: 'Nothing to pay yet: a repair comes here once it is closed.',
  },
};

type WorkshopPayouts = typeof workshopPayoutsEn;

export const workshopPayoutsRu: WorkshopPayouts = {
  wpay: {
    sub: (people, jobs, sum) => `${people} ${people === 1 ? 'механик' : people < 5 ? 'механика' : 'механиков'} · ${jobs} ${ruJobs(jobs)} · ${sum}`,
    rate: (gel) => `${gel} за час нормы`,
    roles: { mechanic: 'механик', chief_mechanic: 'главный механик' },
    closed: (day) => `закрыта ${day}`,
    receipt: 'чек',
    workCol: 'Работа',
    otherJob: (number) => `в ${number}`,
    work: (jobs, time) => `Работа · ${jobs} ${ruJobs(jobs)} · ${time}`,
    receipts: (n) => `Чеки · ${n}`,
    total: 'Итого',
    more: (n) => `ещё ${n} ${ruJobs(n)}`,
    pay: (sum) => `Оплачено · ${sum}`,
    confirmTitle: (who, sum) => `Отметить выплату ${who} — ${sum}?`,
    confirmWhat: (jobs, work, receipts) =>
      `${jobs} ${ruJobs(jobs)} ${jobs === 1 ? 'станет' : 'станут'} «Оплачено», и ${jobs === 1 ? 'её' : 'их'} больше нельзя будет править: работа ${work}${receipts ? `, чеки ${receipts}` : ''}.`,
    confirmNote: 'Это отметка, не платёж: в «Деньгах» ничего не появится. Перевод механику разбери в «Разобрать» как «Расход ▸».',
    marked: (who, sum) => `${who}: выплата ${sum} отмечена`,
    none: 'К оплате ничего нет. Закрытая заявка приходит сюда, когда у всех её работ есть норма.',
    heldHead: 'Пока не к оплате',
    held: { unnormed: 'без нормы', waiting: 'ждёт согласования', open: 'в работе' },
    payoutsHead: 'Выплаты',
    payoutsNone: 'Выплат пока нет.',
    jobsN: (n) => `${n} ${ruJobs(n)}`,
    markedBy: (who) => `отметка: ${who}`,
    voided: (reason) => `отменена: ${reason}`,
    void: 'Отменить выплату',
    voidTitle: (day, who, sum) => `Отменить выплату ${day} — ${who}, ${sum}?`,
    voidReason: 'Причина — её видно в журнале',
    voidNote: (jobs) =>
      `${jobs} ${ruJobs(jobs)} снова ${jobs === 1 ? 'станет' : 'станут'} «К оплате» и снова ${jobs === 1 ? 'правится' : 'правятся'}. Деньги эта кнопка не возвращает — она убирает отметку.`,
    voidDone: 'Выплата отменена',
    paid: 'Оплачено',
    paidIn: (day, who) => `${day} · отметка: ${who}. Заявку больше не правят.`,
    reimbursed: 'возмещено',
    worksCost: 'Работа механика по норме',
    balanceLink: (sum) => `Баланс · ${sum}`,
    toPay: 'К оплате',
    toPaySub: (jobs, work, receipts) => `${jobs} ${ruJobs(jobs)} · работа ${work} + чеки ${receipts} · выплата раз в неделю`,
    waiting: 'Ждёт согласования',
    inWork: 'В работе',
    inWorkNote: 'к оплате после закрытия',
    unnormed: 'Без нормы',
    unnormedNote: 'ждёт нормы от главного механика',
    payBack: (sum) => `чек ${sum} вернётся тебе`,
    nothingYet: 'К оплате пока ничего: заявка приходит сюда, когда закрыта.',
  },
};

/** 1 заявка, 2 заявки, 5 заявок, 21 заявка. */
function ruJobs(n: number): string {
  const ten = n % 10;
  const hundred = n % 100;
  if (ten === 1 && hundred !== 11) return 'заявка';
  if (ten >= 2 && ten <= 4 && (hundred < 12 || hundred > 14)) return 'заявки';
  return 'заявок';
}

// Georgian keeps the noun singular after a number: 2 მექანიკოსი, 8 შეკეთება.
export const workshopPayoutsKa: WorkshopPayouts = {
  wpay: {
    sub: (people, jobs, sum) => `${people} მექანიკოსი · ${jobs} შეკეთება · ${sum}`,
    rate: (gel) => `${gel} ნორმა-საათში`,
    roles: { mechanic: 'მექანიკოსი', chief_mechanic: 'მთავარი მექანიკოსი' },
    closed: (day) => `დაიხურა ${day}`,
    receipt: 'ქვითარი',
    workCol: 'სამუშაო',
    otherJob: (number) => `${number}-ში`,
    work: (jobs, time) => `სამუშაო · ${jobs} შეკეთება · ${time}`,
    receipts: (n) => `ქვითრები · ${n}`,
    total: 'სულ',
    more: (n) => `კიდევ ${n} შეკეთება`,
    pay: (sum) => `გადახდილია · ${sum}`,
    confirmTitle: (who, sum) => `${who}: გადახდის მონიშვნა — ${sum}?`,
    confirmWhat: (jobs, work, receipts) => `${jobs} შეკეთება გახდება „გადახდილი“ და მეტად აღარ შეიცვლება: სამუშაო ${work}${receipts ? `, ქვითრები ${receipts}` : ''}.`,
    confirmNote: 'ეს მონიშვნაა და არა გადახდა: „ფულში“ არაფერი გაჩნდება. მექანიკოსისთვის გადარიცხვა „დასახარისხებელში“ მონიშნე როგორც „ხარჯი ▸“.',
    marked: (who, sum) => `${who}: გადახდა ${sum} მონიშნულია`,
    none: 'გადასახდელი არაფერია. დახურული შეკეთება აქ მოდის, როცა მის ყველა სამუშაოს ნორმა აქვს.',
    heldHead: 'ჯერ არ არის გადასახდელი',
    held: { unnormed: 'ნორმის გარეშე', waiting: 'ელოდება დამტკიცებას', open: 'მუშავდება' },
    payoutsHead: 'გადახდები',
    payoutsNone: 'გადახდები ჯერ არ არის.',
    jobsN: (n) => `${n} შეკეთება`,
    markedBy: (who) => `მონიშნა: ${who}`,
    voided: (reason) => `გაუქმდა: ${reason}`,
    void: 'გადახდის გაუქმება',
    voidTitle: (day, who, sum) => `გაუქმდეს ${day}-ის გადახდა — ${who}, ${sum}?`,
    voidReason: 'მიზეზი — ჩანს ჟურნალში',
    voidNote: (jobs) => `${jobs} შეკეთება ისევ „გადასახდელი“ გახდება და ისევ შეიცვლება. ფულს ეს ღილაკი არ აბრუნებს — მხოლოდ მონიშვნას აუქმებს.`,
    voidDone: 'გადახდა გაუქმდა',
    paid: 'გადახდილია',
    paidIn: (day, who) => `${day} · მონიშნა: ${who}. შეკეთება მეტად აღარ იცვლება.`,
    reimbursed: 'დაბრუნებულია',
    worksCost: 'მექანიკოსის სამუშაო ნორმით',
    balanceLink: (sum) => `ბალანსი · ${sum}`,
    toPay: 'გადასახდელი',
    toPaySub: (jobs, work, receipts) => `${jobs} შეკეთება · სამუშაო ${work} + ქვითრები ${receipts} · გადახდა კვირაში ერთხელ`,
    waiting: 'ელოდება დამტკიცებას',
    inWork: 'მუშავდება',
    inWorkNote: 'გადასახდელი გახდება დახურვის შემდეგ',
    unnormed: 'ნორმის გარეშე',
    unnormedNote: 'ელოდება ნორმას მთავარი მექანიკოსისგან',
    payBack: (sum) => `ქვითარი ${sum} დაგიბრუნდება`,
    nothingYet: 'გადასახდელი ჯერ არაფერია: შეკეთება აქ მოდის, როცა დაიხურება.',
  },
};
