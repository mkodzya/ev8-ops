// The day of the week a rental's rent is due (ADR-0022). One file, so the
// Georgian goes to proofreading as one list (docs/qa/pay-day-ka-strings.md;
// the words for a rental whose weeks were moved, ADR-0041 —
// docs/qa/week-shift-ka-strings.md).

export const payDayEn = {
  payDay: {
    label: 'Pay day',
    /** ISO order: Monday first. */
    days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
    asPickup: 'as the pickup day',
    /** No pay day of its own, on a rental whose weeks were moved (ADR-0041): the weekday they start on now. */
    asWeekStart: 'as the week’s first day',
    agreed: 'by agreement',
    next: (date: string) => `next on ${date}`,
    pickupMark: (day: string) => `${day} — the pickup day`,
    weekStartMark: (day: string) => `${day} — the week’s first day`,
    hint: "The weeks stay as they are. Only the day a week's rent is due moves; the renter is late from the day after it. To move the weeks themselves — «Move the week» in the last week's menu.",
    reason: 'Why the day changes',
    reasonHint: 'Required. It goes to the journal — for example, «agreed with the customer».',
  },
};

export const payDayRu: typeof payDayEn = {
  payDay: {
    label: 'День оплаты',
    days: ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'],
    asPickup: 'как день выдачи',
    asWeekStart: 'как начало недели',
    agreed: 'по договорённости',
    next: (date: string) => `следующая ${date}`,
    pickupMark: (day: string) => `${day} — день выдачи`,
    weekStartMark: (day: string) => `${day} — начало недели`,
    hint: 'Недели остаются прежними. Меняется только день, в который за неделю платят; просрочка — со следующего дня. Сдвинуть сами недели — «Сдвинуть неделю» в меню последней недели.',
    reason: 'Почему меняем день',
    reasonHint: 'Обязательно. Уйдёт в журнал — например, «так договорились с клиентом».',
  },
};

export const payDayKa: typeof payDayEn = {
  payDay: {
    label: 'გადახდის დღე',
    days: ['ორშაბათი', 'სამშაბათი', 'ოთხშაბათი', 'ხუთშაბათი', 'პარასკევი', 'შაბათი', 'კვირა'],
    asPickup: 'როგორც გაცემის დღე',
    asWeekStart: 'როგორც კვირის დასაწყისი',
    agreed: 'შეთანხმებით',
    next: (date: string) => `შემდეგი ${date}`,
    pickupMark: (day: string) => `${day} — გაცემის დღე`,
    weekStartMark: (day: string) => `${day} — კვირის დასაწყისი`,
    hint: 'კვირები იგივე რჩება. იცვლება მხოლოდ დღე, როდესაც კვირის ქირა იხდება; დაგვიანება — მომდევნო დღიდან. თვითონ კვირების გადასაწევად — «კვირის გადაწევა» ბოლო კვირის მენიუში.',
    reason: 'რატომ იცვლება დღე',
    reasonHint: 'სავალდებულოა. ჩაიწერება ჟურნალში — მაგალითად, «კლიენტთან შევთანხმდით».',
  },
};
