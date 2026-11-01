// Rent reminders on a schedule, step 1 (issue #20 of the director, 01.11.2026;
// ADR-0052): beside the rows of «К звонку», on a rental's card, the language
// of a customer's messages, and «Сегодня»'s line «Оплаты». Step 1 sends
// nothing — every word here says so where a reminder is named. One file, so
// the Georgian goes to the director as one list
// (docs/qa/payment-reminders-ka-strings.md). The Georgian is the session's;
// the director proofreads it.

export const remEn = {
  rem: {
    /** «Напоминание 12:00, 18:00 (пробно, не отправлено)» beside a row. */
    slots: (slots: string) => `Reminder ${slots}`,
    dryRun: 'trial, not sent',
    sent: 'sent',
    failed: 'did not go',
    call: 'time to call',
    off: 'reminders off',
    templates: { payment_due: 'payment day', overdue_1: '1st day late', overdue_2: '2nd day late — the warning' },
    card: {
      title: 'Rent reminders',
      on: 'On: the payment day at 12:00, the 1st and 2nd day late at 12:00 and 18:00. Not on the hand-over day, not on Georgian Orthodox holidays.',
      dry: 'Trial run for now: who would be written to is decided and kept here, nothing is sent.',
      offWhy: (reason: string) => `Off: ${reason}`,
      offBy: (who: string, day: string) => `${who}, ${day}`,
      switchOff: 'Switch off',
      switchOn: 'Switch on',
      offTitle: 'Switch the reminders off',
      offReason: 'Why',
      offHint: 'A reason is required: it shows on the card and in the journal.',
      offDone: 'Reminders switched off',
      onDone: 'Reminders switched on',
      recent: 'Lately',
      none: 'Nothing decided yet.',
      row: (day: string, slot: string, what: string, sum: string, mode: string) => `${day} ${slot} · ${what} · ${sum} · ${mode}`,
      lang: (lang: string) => `Messages in: ${lang}`,
    },
    lang: {
      label: 'Language of messages',
      hint: 'Russian goes in English: there is no Russian template.',
      names: { ka: 'Georgian', ru: 'Russian (sent in English)', en: 'English' },
    },
    /** «Сегодня»: the third number of «Оплаты». */
    todayCall: (n: number) => `call ${n}`,
  },
};

type Rem = typeof remEn;

export const remRu: Rem = {
  rem: {
    slots: (slots) => `Напоминание ${slots}`,
    dryRun: 'пробно, не отправлено',
    sent: 'отправлено',
    failed: 'не ушло',
    call: 'пора звонить',
    off: 'напоминания выключены',
    templates: { payment_due: 'день оплаты', overdue_1: '1-й день просрочки', overdue_2: '2-й день просрочки — предупреждение' },
    card: {
      title: 'Напоминания об оплате',
      on: 'Включены: день оплаты в 12:00, 1-й и 2-й день просрочки в 12:00 и 18:00. Не в день выдачи и не в православные праздники Грузии.',
      dry: 'Пока пробный режим: кому написать, решается и записывается здесь, ничего не отправляется.',
      offWhy: (reason) => `Выключены: ${reason}`,
      offBy: (who, day) => `${who}, ${day}`,
      switchOff: 'Выключить',
      switchOn: 'Включить',
      offTitle: 'Выключить напоминания',
      offReason: 'Почему',
      offHint: 'Причина обязательна: её видно в карточке и в журнале.',
      offDone: 'Напоминания выключены',
      onDone: 'Напоминания включены',
      recent: 'Последние',
      none: 'Ещё ничего не решалось.',
      row: (day, slot, what, sum, mode) => `${day} ${slot} · ${what} · ${sum} · ${mode}`,
      lang: (lang) => `Язык сообщений: ${lang}`,
    },
    lang: {
      label: 'Язык сообщений',
      hint: 'Русский уходит на английском: русского шаблона нет.',
      names: { ka: 'Грузинский', ru: 'Русский (уходит на английском)', en: 'Английский' },
    },
    todayCall: (n) => `позвонить ${n}`,
  },
};

export const remKa: Rem = {
  rem: {
    slots: (slots) => `შეხსენება ${slots}`,
    dryRun: 'საცდელი, არ გაიგზავნა',
    sent: 'გაიგზავნა',
    failed: 'ვერ გაიგზავნა',
    call: 'დარეკვის დროა',
    off: 'შეხსენებები გამორთულია',
    templates: { payment_due: 'გადახდის დღე', overdue_1: 'ვადაგადაცილების 1-ლი დღე', overdue_2: 'ვადაგადაცილების მე-2 დღე — გაფრთხილება' },
    card: {
      title: 'გადახდის შეხსენებები',
      on: 'ჩართულია: გადახდის დღეს 12:00-ზე, ვადაგადაცილების 1-ლ და მე-2 დღეს 12:00-ზე და 18:00-ზე. არა გაცემის დღეს და არა საქართველოს მართლმადიდებლურ დღესასწაულებზე.',
      dry: 'ჯერ საცდელი რეჟიმია: ვის მივწეროთ, აქ წყდება და იწერება, არაფერი იგზავნება.',
      offWhy: (reason) => `გამორთულია: ${reason}`,
      offBy: (who, day) => `${who}, ${day}`,
      switchOff: 'გამორთვა',
      switchOn: 'ჩართვა',
      offTitle: 'შეხსენებების გამორთვა',
      offReason: 'რატომ',
      offHint: 'მიზეზი სავალდებულოა: ჩანს ბარათზე და ჟურნალში.',
      offDone: 'შეხსენებები გამოირთო',
      onDone: 'შეხსენებები ჩაირთო',
      recent: 'ბოლო',
      none: 'ჯერ არაფერი გადაწყვეტილა.',
      row: (day, slot, what, sum, mode) => `${day} ${slot} · ${what} · ${sum} · ${mode}`,
      lang: (lang) => `შეტყობინებების ენა: ${lang}`,
    },
    lang: {
      label: 'შეტყობინებების ენა',
      hint: 'რუსული ინგლისურად იგზავნება: რუსული შაბლონი არ არის.',
      names: { ka: 'ქართული', ru: 'რუსული (იგზავნება ინგლისურად)', en: 'ინგლისური' },
    },
    todayCall: (n) => `დასარეკი ${n}`,
  },
};
