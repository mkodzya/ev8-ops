// «Пересмотреть решение по залогу» on a returned rental (issue #14,
// ADR-0046). One file, so the Georgian goes to proofreading as one list
// (docs/qa/deposit-revise-ka-strings.md).

export const depositReviseEn = {
  depositRevise: {
    action: 'Revise the decision',
    title: (n: string) => `Revise the deposit decision · ${n}`,
    intro: (on: string) =>
      `The decision is made again: what was kept is taken back, what it paid is owed again, and the deposit is decided as at the return. The decision keeps its day, ${on}.`,
    payouts:
      'Money handed back is not touched here: a deposit handed back in cash or by transfer is put right where it was written. Only what has not been handed back can be kept.',
    why: 'Why it is revised',
    whyHint: 'Required, goes into the journal: for example, «the week was never owed, the deposit went back whole».',
    figures: 'Was → will be',
    counting: 'Counting what changes…',
    rows: { withheld: 'Kept', back: 'Goes back', paidOut: 'Handed back', onHand: 'On hand', debt: 'Rental debt' },
    debtUp: (n: string, sum: string) => `The debt on ${n} becomes ${sum}.`,
    actSigned: 'The signed return act is replaced: a new one is made with the new figures and waits for a signature. A copy of the old one in Google Drive goes to «_Мусор» by hand.',
    actFresh: 'The return act is made again with the new figures.',
    save: 'Revise',
    done: 'Decision revised',
    journal: {
      withheldTetri: 'kept',
      backTetri: 'goes back',
      paidOutTetri: 'handed back',
      onHandTetri: 'on hand',
      debtTetri: 'debt',
    },
  },
};

export type DepositReviseDict = typeof depositReviseEn;

export const depositReviseRu: DepositReviseDict = {
  depositRevise: {
    action: 'Пересмотреть решение',
    title: (n) => `Пересмотр решения по залогу · ${n}`,
    intro: (on) =>
      `Решение принимается заново: прежнее удержание снимается, то, что оно оплатило, снова становится долгом, и залог решается как при возврате. День решения остаётся прежним — ${on}.`,
    payouts:
      'Возвращённые деньги здесь не меняются: возврат наличными и перевод исправляются там, где записаны. Удержать можно только то, что ещё не возвращено.',
    why: 'Почему пересматриваем',
    whyHint: 'Обязательно, попадёт в журнал: например, «неделя не начислялась, залог вернули полностью».',
    figures: 'Было → станет',
    counting: 'Считаю, что изменится…',
    rows: { withheld: 'Удержано', back: 'К возврату', paidOut: 'Возвращено', onHand: 'На руках', debt: 'Долг по аренде' },
    debtUp: (n, sum) => `Долг по ${n} станет ${sum}.`,
    actSigned: 'Подписанный акт возврата будет заменён: новый соберётся по новым цифрам и будет ждать подписи. Копию старого в Google Drive перенесите в «_Мусор» вручную.',
    actFresh: 'Акт возврата соберётся заново по новым цифрам.',
    save: 'Пересмотреть',
    done: 'Решение пересмотрено',
    journal: {
      withheldTetri: 'удержано',
      backTetri: 'к возврату',
      paidOutTetri: 'возвращено',
      onHandTetri: 'на руках',
      debtTetri: 'долг',
    },
  },
};

export const depositReviseKa: DepositReviseDict = {
  depositRevise: {
    action: 'გადაწყვეტილების გადახედვა',
    title: (n) => `დეპოზიტის გადაწყვეტილების გადახედვა · ${n}`,
    intro: (on) =>
      `გადაწყვეტილება ხელახლა მიიღება: წინა დაკავება უქმდება, რაც მან დაფარა, ისევ დავალიანება ხდება, და დეპოზიტი წყდება როგორც დაბრუნებისას. გადაწყვეტილების დღე იგივე რჩება — ${on}.`,
    payouts:
      'დაბრუნებული თანხა აქ არ იცვლება: ნაღდით დაბრუნება და გადარიცხვა სწორდება იქ, სადაც ჩაწერილია. დაკავება შეიძლება მხოლოდ იმის, რაც ჯერ არ დაბრუნებულა.',
    why: 'რატომ ვხედავთ ხელახლა',
    whyHint: 'სავალდებულოა, ჩაიწერება ჟურნალში: მაგალითად, „კვირა არ დარიცხულა, დეპოზიტი სრულად დაბრუნდა“.',
    figures: 'იყო → იქნება',
    counting: 'ვითვლი, რა შეიცვლება…',
    rows: { withheld: 'დაკავებულია', back: 'დასაბრუნებელი', paidOut: 'დაბრუნებულია', onHand: 'ხელზეა', debt: 'ქირის დავალიანება' },
    debtUp: (n, sum) => `${n}-ის დავალიანება გახდება ${sum}.`,
    actSigned: 'ხელმოწერილი დაბრუნების აქტი შეიცვლება: ახალი შედგება ახალი ციფრებით და დაელოდება ხელმოწერას. ძველის ასლი Google Drive-ში ხელით მოათავსეთ „_Мусор“ საქაღალდეში.',
    actFresh: 'დაბრუნების აქტი ხელახლა შედგება ახალი ციფრებით.',
    save: 'გადახედვა',
    done: 'გადაწყვეტილება გადაიხედა',
    journal: {
      withheldTetri: 'დაკავებულია',
      backTetri: 'დასაბრუნებელი',
      paidOutTetri: 'დაბრუნებულია',
      onHandTetri: 'ხელზეა',
      debtTetri: 'დავალიანება',
    },
  },
};
