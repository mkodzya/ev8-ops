// Putting a sale's date right (call of 21.10.2026: a sale entered on the wrong
// day had to be cancelled and entered again). One file, so the Georgian goes
// to proofreading as one list (docs/qa/sale-date-ka-strings.md). The sale
// date, the warranty and the debt keep the words they already have
// (`sell.soldOn`, `saleCard.warranty`, `saleCard.debt`).

export const saleDateEn = {
  saleDate: {
    menu: 'Change the sale date',
    title: 'Change the sale date',
    recorded: (date: string) => `Recorded: ${date}`,
    changes: 'What changes',
    history: 'Moped history: sold',
    line: (seq: number) => `Instalment #${seq}`,
    stays: 'The schedule stays as it is: a sale that began before EV8 Ops keeps the dates of its paper contract.',
    paperKeeps: (date: string) => `The signed sale document does not change: it keeps the date ${date}.`,
    paperDiffers: (date: string) => `The signed document carries the sale date ${date}.`,
    reason: 'Why the date changes',
    reasonHint: 'Required. It goes to the journal — for example, «entered a day late».',
    save: 'Save the date',
    beforeHistory: (date: string) => `The last event in the moped’s history is on ${date}. Date the sale on that day or later.`,
    /** Under the date, beside «Recorded»: the first day the sheet offers, the day the server refuses below (QA, 22.10.2026). */
    notBefore: (date: string) => `not before ${date}`,
    unchanged: 'The sale already has this date.',
    linesMoved: (n: number) => `Instalments moved: ${n}`,
  },
};

export const saleDateRu: typeof saleDateEn = {
  saleDate: {
    menu: 'Изменить дату продажи',
    title: 'Изменить дату продажи',
    recorded: (date: string) => `Записано: ${date}`,
    changes: 'Что изменится',
    history: 'История мопеда: продан',
    line: (seq: number) => `Взнос №${seq}`,
    stays: 'График не меняется: у продажи, начатой до EV8 Ops, даты из бумажного договора.',
    paperKeeps: (date: string) => `Подписанный договор продажи не меняется: в нём останется дата ${date}.`,
    paperDiffers: (date: string) => `В подписанном договоре дата продажи ${date}.`,
    reason: 'Почему меняем дату',
    reasonHint: 'Обязательно. Уйдёт в журнал — например, «завели на день позже».',
    save: 'Сохранить дату',
    beforeHistory: (date: string) => `Последнее событие в истории мопеда — ${date}. Продажа — в этот день или позже.`,
    notBefore: (date: string) => `не раньше ${date}`,
    unchanged: 'У продажи уже эта дата.',
    linesMoved: (n: number) => `Сдвинуто взносов: ${n}`,
  },
};

export const saleDateKa: typeof saleDateEn = {
  saleDate: {
    menu: 'გაყიდვის თარიღის შეცვლა',
    title: 'გაყიდვის თარიღის შეცვლა',
    recorded: (date: string) => `ჩაწერილია: ${date}`,
    changes: 'რა შეიცვლება',
    history: 'მოპედის ისტორია: გაყიდულია',
    line: (seq: number) => `განვადების გადახდა №${seq}`,
    stays: 'გრაფიკი არ იცვლება: EV8 Ops-მდე დაწყებულ გაყიდვას თარიღები ქაღალდის ხელშეკრულებიდან აქვს.',
    paperKeeps: (date: string) => `ხელმოწერილი ნასყიდობის დოკუმენტი არ იცვლება: მასში დარჩება თარიღი ${date}.`,
    paperDiffers: (date: string) => `ხელმოწერილ დოკუმენტში გაყიდვის თარიღია ${date}.`,
    reason: 'რატომ იცვლება თარიღი',
    reasonHint: 'სავალდებულოა. ჩაიწერება ჟურნალში — მაგალითად, «ერთი დღით გვიან შევიყვანეთ».',
    save: 'თარიღის შენახვა',
    beforeHistory: (date: string) => `მოპედის ისტორიის ბოლო მოვლენა: ${date}. გაყიდვა — ამ დღეს ან უფრო გვიან.`,
    notBefore: (date: string) => `არა უადრეს ${date}`,
    unchanged: 'გაყიდვას უკვე ეს თარიღი აქვს.',
    linesMoved: (n: number) => `გადაწეული განვადების გადახდები: ${n}`,
  },
};
