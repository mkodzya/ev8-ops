// The day of the week a rental's rent is due (ADR-0022). One file, so the
// Georgian goes to proofreading as one list (docs/qa/pay-day-ka-strings.md).

export const payDayEn = {
  payDay: {
    label: 'Pay day',
    /** ISO order: Monday first. */
    days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
    asPickup: 'as the pickup day',
    agreed: 'by agreement',
    next: (date: string) => `next on ${date}`,
    pickupMark: (day: string) => `${day} — the pickup day`,
    hint: "The weeks stay as they are, from the pickup day. Only the day a week's rent is due moves; the renter is late from the day after it.",
    reason: 'Why the day changes',
    reasonHint: 'Required. It goes to the journal — for example, «agreed with the customer».',
  },
};

export const payDayRu: typeof payDayEn = {
  payDay: {
    label: 'День оплаты',
    days: ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'],
    asPickup: 'как день выдачи',
    agreed: 'по договорённости',
    next: (date: string) => `следующая ${date}`,
    pickupMark: (day: string) => `${day} — день выдачи`,
    hint: 'Недели остаются прежними — от дня выдачи. Меняется только день, в который за неделю платят; просрочка — со следующего дня.',
    reason: 'Почему меняем день',
    reasonHint: 'Обязательно. Уйдёт в журнал — например, «так договорились с клиентом».',
  },
};

export const payDayKa: typeof payDayEn = {
  payDay: {
    label: 'გადახდის დღე',
    days: ['ორშაბათი', 'სამშაბათი', 'ოთხშაბათი', 'ხუთშაბათი', 'პარასკევი', 'შაბათი', 'კვირა'],
    asPickup: 'როგორც გაცემის დღე',
    agreed: 'შეთანხმებით',
    next: (date: string) => `შემდეგი ${date}`,
    pickupMark: (day: string) => `${day} — გაცემის დღე`,
    hint: 'კვირები იგივე რჩება — გაცემის დღიდან. იცვლება მხოლოდ დღე, როდესაც კვირის ქირა იხდება; დაგვიანება — მომდევნო დღიდან.',
    reason: 'რატომ იცვლება დღე',
    reasonHint: 'სავალდებულოა. ჩაიწერება ჟურნალში — მაგალითად, «კლიენტთან შევთანხმდით».',
  },
};
