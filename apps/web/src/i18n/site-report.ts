// "Отчёты → Сайт": the anonymous counter of ev8.ge (migration 0036; Kardu,
// 11.10.2026). One file, so the Georgian goes to proofreading as one list
// (book, item 15). The quiz's questions and options are the site's own
// words (src/i18n/*.ts in mkodzya/ev8-site), so the report reads the way the
// courier saw it.

export const siteReportEn = {
  siteReport: {
    title: 'Site',
    subtitle: 'ev8.ge, counted without names, phones or addresses: one number per day.',
    week: 'Week',
    month: 'Month',
    from: 'From',
    to: 'To',
    period: (from: string, to: string) => `${from} — ${to}`,
    empty: 'Nothing counted over this period. The site counts from the day ev8.ge moves off WordPress.',

    visits: 'Visits',
    byLang: (ka: number, en: number) => `Georgian ${ka} · English ${en}`,

    funnel: 'From a visit to a request',
    stepVisits: 'Came to the site',
    stepGarage: 'Opened the garage',
    stepBuilder: 'Opened the request form',
    stepWhatsapp: 'Pressed WhatsApp',
    stepRequests: 'Sent a request',
    stepsNote: 'A request is counted when it reached the mailbox. A request that fell back to WhatsApp is counted under WhatsApp.',

    pages: 'Pages',
    page: 'Page',
    opened: 'Opened',
    whatsapp: 'WhatsApp',
    pageNames: {
      home: 'Home',
      models: 'Garage',
      subscription: 'Request form',
      stations: 'Swap stations',
      licence: 'AM licence',
      how: 'How it works',
      faq: 'Questions',
      contacts: 'Contacts',
    },

    answers: 'The three questions',
    answered: (n: number) => `${n} answered all three`,
    noAnswers: 'nobody answered over this period',
    questions: ['Are you already working as a courier?', 'What do you ride now?', 'Do you have a licence?'],
    options: [
      ['Yes', 'Not yet'],
      ['Petrol moped', 'Car', 'Electric moped', 'Nothing'],
      ['No', 'Category AM', 'Category A or B'],
    ],
    segments: 'Who answered',
    segmentNames: {
      petrol: 'Courier on a petrol moped',
      car: 'Courier by car',
      electric: 'Courier on an electric moped',
      other: 'Courier on foot or other',
      novice: 'Not a courier yet',
    },

    byDay: 'By day',
    day: 'Day',
    views: 'Pages opened',
    requests: 'Requests',
  },
};

export const siteReportRu: typeof siteReportEn = {
  siteReport: {
    title: 'Сайт',
    subtitle: 'ev8.ge без имён, телефонов и адресов: одно число в день.',
    week: 'Неделя',
    month: 'Месяц',
    from: 'С',
    to: 'По',
    period: (from: string, to: string) => `${from} — ${to}`,
    empty: 'За этот период ничего не посчитано. Сайт считает с того дня, как ev8.ge уйдёт с WordPress.',

    visits: 'Посещения',
    byLang: (ka: number, en: number) => `по-грузински ${ka} · по-английски ${en}`,

    funnel: 'От посещения до заявки',
    stepVisits: 'Зашли на сайт',
    stepGarage: 'Открыли гараж',
    stepBuilder: 'Открыли форму заявки',
    stepWhatsapp: 'Нажали WhatsApp',
    stepRequests: 'Отправили заявку',
    stepsNote: 'Заявка считается, когда дошла до почты. Заявка, ушедшая в WhatsApp, считается в WhatsApp.',

    pages: 'Страницы',
    page: 'Страница',
    opened: 'Открыли',
    whatsapp: 'WhatsApp',
    pageNames: {
      home: 'Главная',
      models: 'Гараж',
      subscription: 'Форма заявки',
      stations: 'Станции замены',
      licence: 'Права AM',
      how: 'Как это работает',
      faq: 'Вопросы',
      contacts: 'Контакты',
    },

    answers: 'Три вопроса',
    answered: (n: number) => `${n} ответили на все три`,
    noAnswers: 'за период никто не ответил',
    questions: ['Ты уже работаешь курьером?', 'На чём ездишь сейчас?', 'Есть права?'],
    options: [
      ['Да', 'Пока нет'],
      ['Бензиновый мопед', 'Машина', 'Электромопед', 'Ни на чём'],
      ['Нет', 'Категория AM', 'Категория A или B'],
    ],
    segments: 'Кто ответил',
    segmentNames: {
      petrol: 'Курьер на бензиновом мопеде',
      car: 'Курьер на машине',
      electric: 'Курьер на электромопеде',
      other: 'Курьер пешком или на другом',
      novice: 'Ещё не курьер',
    },

    byDay: 'По дням',
    day: 'День',
    views: 'Открыли страниц',
    requests: 'Заявки',
  },
};

export const siteReportKa: typeof siteReportEn = {
  siteReport: {
    title: 'საიტი',
    subtitle: 'ev8.ge სახელების, ტელეფონებისა და მისამართების გარეშე: ერთი რიცხვი დღეში.',
    week: 'კვირა',
    month: 'თვე',
    from: 'დან',
    to: 'მდე',
    period: (from: string, to: string) => `${from} — ${to}`,
    empty: 'ამ პერიოდში არაფერი დათვლილა. საიტი დათვლას იწყებს იმ დღიდან, როცა ev8.ge WordPress-ს დატოვებს.',

    visits: 'ვიზიტები',
    byLang: (ka: number, en: number) => `ქართულად ${ka} · ინგლისურად ${en}`,

    funnel: 'ვიზიტიდან განაცხადამდე',
    stepVisits: 'შემოვიდნენ საიტზე',
    stepGarage: 'გახსნეს გარაჟი',
    stepBuilder: 'გახსნეს განაცხადის ფორმა',
    stepWhatsapp: 'დააჭირეს WhatsApp-ს',
    stepRequests: 'გამოგზავნეს განაცხადი',
    stepsNote: 'განაცხადი ითვლება, როცა ფოსტამდე მივიდა. WhatsApp-ში გადასული განაცხადი WhatsApp-ში ითვლება.',

    pages: 'გვერდები',
    page: 'გვერდი',
    opened: 'გახსნეს',
    whatsapp: 'WhatsApp',
    pageNames: {
      home: 'მთავარი',
      models: 'გარაჟი',
      subscription: 'განაცხადის ფორმა',
      stations: 'გამოცვლის სადგურები',
      licence: 'AM მართვის მოწმობა',
      how: 'როგორ მუშაობს',
      faq: 'კითხვები',
      contacts: 'კონტაქტები',
    },

    answers: 'სამი კითხვა',
    answered: (n: number) => `${n}-მა უპასუხა სამივეს`,
    noAnswers: 'ამ პერიოდში არავის უპასუხია',
    questions: ['უკვე მუშაობ კურიერად?', 'რით დადიხარ ახლა?', 'გაქვს მართვის მოწმობა?'],
    options: [
      ['დიახ', 'ჯერ არა'],
      ['ბენზინის მოპედით', 'მანქანით', 'ელექტრო მოპედით', 'არაფრით'],
      ['არა', 'AM კატეგორია', 'A ან B კატეგორია'],
    ],
    segments: 'ვინ უპასუხა',
    segmentNames: {
      petrol: 'კურიერი ბენზინის მოპედით',
      car: 'კურიერი მანქანით',
      electric: 'კურიერი ელექტრო მოპედით',
      other: 'კურიერი ფეხით ან სხვა',
      novice: 'ჯერ არ არის კურიერი',
    },

    byDay: 'დღეების მიხედვით',
    day: 'დღე',
    views: 'გახსნილი გვერდები',
    requests: 'განაცხადები',
  },
};
