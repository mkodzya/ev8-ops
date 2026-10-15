// Words of a bank read by its API (B11-03): the line on the bank's card in
// "Деньги → Выписки" saying that its statement comes by itself and when the
// bank last answered — or why it does not. Bank of Georgia (ADR-0021) and
// TBC (ADR-0026) share them; `service` is each bank's own name for its API.
//
// The Georgian here was written by a non-native and has not been read by one
// yet (docs/qa/wave-2-ka-strings.md).

type Why = 'unauthorized' | 'forbidden' | 'not_found' | 'user_inactive' | 'rate_limited' | 'http' | 'network' | 'bad_answer' | 'no_account' | 'mismatch';

/** The banks' own names for their APIs: the same in every language. */
const service = { bog: 'Business Online', tbc: 'Business Integration Services' };

export const bankApiEn = {
  bankApi: {
    service,
    freshAt: (service: string, date: string, time: string) => `The statement comes by itself (${service}). The bank last answered ${date}, ${time}.`,
    waiting: (service: string) => `The statement comes by itself (${service}). The bank’s first answer comes within five minutes.`,
    noAccount: (service: string) => `The ${service} link is not finished: no account is set. Until then, load statements as files.`,
    silentSince: (service: string, why: string, date: string, time: string) => `${service} is not answering: ${why}. Last answer ${date}, ${time}.`,
    silentNever: (service: string, why: string) => `${service} is not answering: ${why}. It has not answered once yet.`,
    nightFailed: (why: string) => `The full statement for the night did not come: ${why}. It is asked for again within the hour.`,
    nightMismatch: (date: string) => `The night check for ${date} does not add up: the bank’s sums for the day differ from the lines that came. The day is read again within the hour.`,
    why: {
      unauthorized: 'the bank did not accept the keys',
      forbidden: 'the keys have no access to the account',
      not_found: 'the bank does not know the account',
      user_inactive: 'the internet-bank user the keys belong to is not active',
      rate_limited: 'too many requests',
      http: 'the bank answered unexpectedly',
      network: 'no connection to the bank',
      bad_answer: 'the bank answered unexpectedly',
      no_account: 'no account is set',
      mismatch: 'the night check does not add up',
    } as Record<Why, string>,
  },
};

export const bankApiRu: typeof bankApiEn = {
  bankApi: {
    service,
    freshAt: (service, date, time) => `Выписка приходит сама (${service}). Банк ответил ${date} в ${time}.`,
    waiting: (service) => `Выписка приходит сама (${service}). Первый ответ банка — в течение пяти минут.`,
    noAccount: (service) => `Подключение к ${service} не закончено: не задан счёт. Пока выписку загружайте файлом.`,
    silentSince: (service, why, date, time) => `${service} не отвечает: ${why}. Последний ответ — ${date} в ${time}.`,
    silentNever: (service, why) => `${service} не отвечает: ${why}. Ответа ещё не было ни разу.`,
    nightFailed: (why) => `Полная выписка за ночь не пришла: ${why}. Система спросит её снова в течение часа.`,
    nightMismatch: (date) => `Ночная сверка за ${date} не сошлась: суммы банка за день не равны пришедшим строкам. Система перечитает день в течение часа.`,
    why: {
      unauthorized: 'банк не принял ключи',
      forbidden: 'у ключей нет доступа к счёту',
      not_found: 'банк не знает такого счёта',
      user_inactive: 'пользователь интернет-банка, к которому привязаны ключи, не активен',
      rate_limited: 'слишком много запросов',
      http: 'банк ответил не так, как ожидалось',
      network: 'нет связи с банком',
      bad_answer: 'банк ответил не так, как ожидалось',
      no_account: 'не задан счёт',
      mismatch: 'ночная сверка не сошлась',
    },
  },
};

export const bankApiKa: typeof bankApiEn = {
  bankApi: {
    service,
    freshAt: (service, date, time) => `ამონაწერი ავტომატურად მოდის (${service}). ბანკის ბოლო პასუხი: ${date}, ${time}.`,
    waiting: (service) => `ამონაწერი ავტომატურად მოდის (${service}). ბანკის პირველი პასუხი — ხუთ წუთში.`,
    noAccount: (service) => `${service}-თან კავშირი ბოლომდე არ არის გამართული: ანგარიში არ არის მითითებული. მანამდე ამონაწერი ფაილით ატვირთეთ.`,
    silentSince: (service, why, date, time) => `${service} არ პასუხობს: ${why}. ბოლო პასუხი: ${date}, ${time}.`,
    silentNever: (service, why) => `${service} არ პასუხობს: ${why}. პასუხი ჯერ არ ყოფილა.`,
    nightFailed: (why) => `ღამის სრული ამონაწერი არ მოვიდა: ${why}. სისტემა მას ერთი საათის განმავლობაში ისევ მოითხოვს.`,
    nightMismatch: (date) => `${date}-ის ღამის შედარება არ დაემთხვა: ბანკის დღის ჯამები მოსულ ხაზებს არ ემთხვევა. სისტემა დღეს ერთი საათის განმავლობაში ხელახლა წაიკითხავს.`,
    why: {
      unauthorized: 'ბანკმა გასაღებები არ მიიღო',
      forbidden: 'გასაღებებს ანგარიშზე წვდომა არ აქვს',
      not_found: 'ბანკმა ასეთი ანგარიში არ იცის',
      user_inactive: 'ინტერნეტბანკის მომხმარებელი, რომელზეც გასაღებებია მიბმული, აქტიური არ არის',
      rate_limited: 'ძალიან ბევრი მოთხოვნა',
      http: 'ბანკმა მოულოდნელად უპასუხა',
      network: 'ბანკთან კავშირი არ არის',
      bad_answer: 'ბანკმა მოულოდნელად უპასუხა',
      no_account: 'ანგარიში არ არის მითითებული',
      mismatch: 'ღამის შედარება არ დაემთხვა',
    },
  },
};
