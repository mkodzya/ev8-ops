// Words of the Kommo link (ADR-0012): the list that lays Kommo's
// "rented" stage beside the rentals running here. The row in "Today" that
// opens it has its words with the other rows, in wave4.ts.
//
// The Georgian here and in the four `kommo…` lines of wave4.ts was written
// by a non-native and has not been read by one yet.

export const kommoLinkEn = {
  kommoLink: {
    title: 'Kommo and the rentals here',
    subtitle: 'Who rents according to Kommo, and who rents according to EV8 Ops.',
    off: 'The Kommo link is not switched on.',
    waiting: 'Kommo has not been asked yet. The first answer comes within five minutes.',
    freshAt: (date: string, time: string) => `Kommo as of ${date}, ${time}`,
    silentSince: (date: string, time: string) => `Kommo is not answering. Below is what it said on ${date} at ${time}.`,
    silentNever: 'Kommo is not answering, and it has not answered once yet.',
    summary: (leads: number, matched: number) => `Rented in Kommo: ${leads}. Matched with a rental here: ${matched}.`,
    rentedThere: 'Rented in Kommo, no rental here',
    rentedThereNote: 'Enter the rental here — or the deal stands in the wrong stage in Kommo.',
    rentedHere: 'Rented here, not in Kommo',
    rentedHereNote: 'The deal is not in the rented stage in Kommo, or the rental and its customer carry no Kommo link.',
    contact: (name: string) => `contact: ${name}`,
    unnamed: 'A deal with no name',
    card: (name: string) => `card here: ${name}`,
    noCard: 'no customer card here',
    notRented: 'the deal is not in the rented stage',
    noLink: 'no Kommo link',
    nothing: 'Nothing disagrees.',
  },
};

export const kommoLinkRu: typeof kommoLinkEn = {
  kommoLink: {
    title: 'Сверка с Kommo',
    subtitle: 'Кто в аренде по Kommo и кто — по EV8 Ops.',
    off: 'Связь с Kommo не включена.',
    waiting: 'Kommo ещё не опрошен. Первый ответ придёт в течение пяти минут.',
    freshAt: (date, time) => `Данные Kommo на ${date}, ${time}`,
    silentSince: (date, time) => `Kommo не отвечает. Ниже — то, что он ответил ${date} в ${time}.`,
    silentNever: 'Kommo не отвечает, и ответа от него ещё не было ни разу.',
    summary: (leads, matched) => `В аренде по Kommo: ${leads}. Совпало с арендами здесь: ${matched}.`,
    rentedThere: 'В Kommo в аренде, здесь аренды нет',
    rentedThereNote: 'Аренду нужно завести здесь — или сделка в Kommo стоит не на том этапе.',
    rentedHere: 'Здесь в аренде, а в Kommo нет',
    rentedHereNote: 'Сделка в Kommo не на этапе аренды, или у аренды и её клиента нет ссылки на Kommo.',
    contact: (name) => `контакт: ${name}`,
    unnamed: 'Сделка без названия',
    card: (name) => `карточка здесь: ${name}`,
    noCard: 'карточки клиента здесь нет',
    notRented: 'сделка не на этапе аренды',
    noLink: 'нет ссылки на Kommo',
    nothing: 'Расхождений нет.',
  },
};

export const kommoLinkKa: typeof kommoLinkEn = {
  kommoLink: {
    title: 'შედარება Kommo-სთან',
    subtitle: 'ვინ ქირაობს Kommo-ს მიხედვით და ვინ — EV8 Ops-ის მიხედვით.',
    off: 'Kommo-სთან კავშირი ჩართული არ არის.',
    waiting: 'Kommo-სთვის ჯერ არ გვიკითხავს. პირველი პასუხი ხუთ წუთში მოვა.',
    freshAt: (date, time) => `Kommo-ს მონაცემები: ${date}, ${time}`,
    silentSince: (date, time) => `Kommo არ პასუხობს. ქვემოთ არის ის, რაც მან ${date}, ${time}-ზე გვიპასუხა.`,
    silentNever: 'Kommo არ პასუხობს და ჯერ ერთხელაც არ უპასუხია.',
    summary: (leads, matched) => `Kommo-ში გაქირავებულია: ${leads}. აქაურ ქირაობას დაემთხვა: ${matched}.`,
    rentedThere: 'Kommo-ში გაქირავებულია, აქ ქირაობა არ არის',
    rentedThereNote: 'ქირაობა აქ უნდა შეიყვანოთ — ან გარიგება Kommo-ში არასწორ ეტაპზე დგას.',
    rentedHere: 'აქ ქირაობაშია, Kommo-ში კი არა',
    rentedHereNote: 'გარიგება Kommo-ში გაქირავების ეტაპზე არ არის, ან ქირაობას და მის კლიენტს Kommo-ს ბმული არ აქვთ.',
    contact: (name) => `კონტაქტი: ${name}`,
    unnamed: 'გარიგება სახელის გარეშე',
    card: (name) => `ბარათი აქ: ${name}`,
    noCard: 'კლიენტის ბარათი აქ არ არის',
    notRented: 'გარიგება გაქირავების ეტაპზე არ არის',
    noLink: 'Kommo-ს ბმული არ არის',
    nothing: 'შეუსაბამობა არ არის.',
  },
};
