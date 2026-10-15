// Words of the Bank of Georgia link (B11-03): the line on the bank's card in
// "Деньги → Выписки" saying that its statement comes by itself and when the
// bank last answered — or why it does not.
//
// The Georgian here was written by a non-native and has not been read by one
// yet (docs/qa/wave-2-ka-strings.md).

type Why = 'unauthorized' | 'forbidden' | 'not_found' | 'rate_limited' | 'http' | 'network' | 'bad_answer' | 'no_account';

export const bogApiEn = {
  bogApi: {
    freshAt: (date: string, time: string) => `The statement comes by itself (Business Online). The bank last answered ${date}, ${time}.`,
    waiting: 'The statement comes by itself (Business Online). The bank’s first answer comes within five minutes.',
    noAccount: 'The Business Online link is not finished: no account is set. Until then, load statements as files.',
    silentSince: (why: string, date: string, time: string) => `Business Online is not answering: ${why}. Last answer ${date}, ${time}.`,
    silentNever: (why: string) => `Business Online is not answering: ${why}. It has not answered once yet.`,
    nightFailed: (why: string) => `The full statement for the night did not come: ${why}. It is asked for again the next night.`,
    why: {
      unauthorized: 'the bank did not accept the keys',
      forbidden: 'the keys have no access to the account',
      not_found: 'the bank does not know the account',
      rate_limited: 'too many requests',
      http: 'the bank answered unexpectedly',
      network: 'no connection to the bank',
      bad_answer: 'the bank answered unexpectedly',
      no_account: 'no account is set',
    } as Record<Why, string>,
  },
};

export const bogApiRu: typeof bogApiEn = {
  bogApi: {
    freshAt: (date, time) => `Выписка приходит сама (Business Online). Банк ответил ${date} в ${time}.`,
    waiting: 'Выписка приходит сама (Business Online). Первый ответ банка — в течение пяти минут.',
    noAccount: 'Подключение к Business Online не закончено: не задан счёт. Пока выписку загружайте файлом.',
    silentSince: (why, date, time) => `Business Online не отвечает: ${why}. Последний ответ — ${date} в ${time}.`,
    silentNever: (why) => `Business Online не отвечает: ${why}. Ответа ещё не было ни разу.`,
    nightFailed: (why) => `Полная выписка за ночь не пришла: ${why}. Система спросит её снова следующей ночью.`,
    why: {
      unauthorized: 'банк не принял ключи',
      forbidden: 'у ключей нет доступа к счёту',
      not_found: 'банк не знает такого счёта',
      rate_limited: 'слишком много запросов',
      http: 'банк ответил не так, как ожидалось',
      network: 'нет связи с банком',
      bad_answer: 'банк ответил не так, как ожидалось',
      no_account: 'не задан счёт',
    },
  },
};

export const bogApiKa: typeof bogApiEn = {
  bogApi: {
    freshAt: (date, time) => `ამონაწერი ავტომატურად მოდის (Business Online). ბანკის ბოლო პასუხი: ${date}, ${time}.`,
    waiting: 'ამონაწერი ავტომატურად მოდის (Business Online). ბანკის პირველი პასუხი — ხუთ წუთში.',
    noAccount: 'Business Online-თან კავშირი ბოლომდე არ არის გამართული: ანგარიში არ არის მითითებული. მანამდე ამონაწერი ფაილით ატვირთეთ.',
    silentSince: (why, date, time) => `Business Online არ პასუხობს: ${why}. ბოლო პასუხი: ${date}, ${time}.`,
    silentNever: (why) => `Business Online არ პასუხობს: ${why}. პასუხი ჯერ არ ყოფილა.`,
    nightFailed: (why) => `ღამის სრული ამონაწერი არ მოვიდა: ${why}. სისტემა მას მომდევნო ღამეს ისევ მოითხოვს.`,
    why: {
      unauthorized: 'ბანკმა გასაღებები არ მიიღო',
      forbidden: 'გასაღებებს ანგარიშზე წვდომა არ აქვს',
      not_found: 'ბანკმა ასეთი ანგარიში არ იცის',
      rate_limited: 'ძალიან ბევრი მოთხოვნა',
      http: 'ბანკმა მოულოდნელად უპასუხა',
      network: 'ბანკთან კავშირი არ არის',
      bad_answer: 'ბანკმა მოულოდნელად უპასუხა',
      no_account: 'ანგარიში არ არის მითითებული',
    },
  },
};
