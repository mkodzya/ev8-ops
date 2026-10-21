// Putting a sale's date right (call of 21.10.2026: a sale entered on the wrong
// day had to be cancelled and entered again). One file, so the Georgian goes
// to proofreading as one list (docs/qa/sale-date-ka-strings.md). The sale
// date, the warranty and the debt keep the words they already have
// (`sell.soldOn`, `saleCard.warranty`, `saleCard.debt`).

export const saleDateEn = {
  saleDate: {
    menu: 'Change the sale date',
    title: 'Change the sale date',
    now: (date: string) => `Now: ${date}`,
    changes: 'What changes',
    history: 'Moped history: sold',
    line: (seq: number) => `Instalment #${seq}`,
    stays: 'The schedule stays as it is: a carried-over sale keeps the dates of its paper contract.',
    paperKeeps: (date: string) => `The signed sale document does not change: it keeps the date ${date}.`,
    paperDiffers: (date: string) => `The signed document carries the sale date ${date}.`,
    reason: 'Why the date changes',
    reasonHint: 'Required. It goes to the journal — for example, «entered a day late».',
    save: 'Save the date',
    beforeHistory: (date: string) => `The last event in the moped’s history is on ${date}. Date the sale on that day or later.`,
    unchanged: 'The sale already has this date.',
  },
};

export const saleDateRu: typeof saleDateEn = {
  saleDate: {
    menu: 'Изменить дату продажи',
    title: 'Изменить дату продажи',
    now: (date: string) => `Сейчас: ${date}`,
    changes: 'Что изменится',
    history: 'История мопеда: продан',
    line: (seq: number) => `Взнос №${seq}`,
    stays: 'График не меняется: у перенесённой продажи даты из бумажного договора.',
    paperKeeps: (date: string) => `Подписанный договор продажи не меняется: в нём останется дата ${date}.`,
    paperDiffers: (date: string) => `В подписанном договоре дата продажи ${date}.`,
    reason: 'Почему меняем дату',
    reasonHint: 'Обязательно. Уйдёт в журнал — например, «завели на день позже».',
    save: 'Сохранить дату',
    beforeHistory: (date: string) => `Последнее событие в истории мопеда — ${date}. Продажа — в этот день или позже.`,
    unchanged: 'У продажи уже эта дата.',
  },
};

export const saleDateKa: typeof saleDateEn = {
  saleDate: {
    menu: 'გაყიდვის თარიღის შეცვლა',
    title: 'გაყიდვის თარიღის შეცვლა',
    now: (date: string) => `ახლა: ${date}`,
    changes: 'რა შეიცვლება',
    history: 'მოპედის ისტორია: გაყიდულია',
    line: (seq: number) => `შენატანი №${seq}`,
    stays: 'გრაფიკი არ იცვლება: გადმოტანილ გაყიდვას თარიღები ქაღალდის ხელშეკრულებიდან აქვს.',
    paperKeeps: (date: string) => `ხელმოწერილი ნასყიდობის დოკუმენტი არ იცვლება: მასში დარჩება თარიღი ${date}.`,
    paperDiffers: (date: string) => `ხელმოწერილ დოკუმენტში გაყიდვის თარიღია ${date}.`,
    reason: 'რატომ იცვლება თარიღი',
    reasonHint: 'სავალდებულოა. ჩაიწერება ჟურნალში — მაგალითად, «ერთი დღით გვიან შევიყვანეთ».',
    save: 'თარიღის შენახვა',
    beforeHistory: (date: string) => `მოპედის ისტორიის ბოლო მოვლენა: ${date}. გაყიდვა — ამ დღეს ან უფრო გვიან.`,
    unchanged: 'გაყიდვას უკვე ეს თარიღი აქვს.',
  },
};
