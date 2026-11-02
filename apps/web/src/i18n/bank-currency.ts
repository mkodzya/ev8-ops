// Words of the accounts in another currency (Mika, 29.10.2026, decision D1
// «А» of docs/spec/usd-accounts-plan.md): on "Деньги → Выписки" each such
// account has a card of its own beside its bank's, and its operations are
// listed apart — read only, in their own currency, in no total in lari. An
// account's name, «Bank of Georgia · USD», is the same in every language and
// is not here. Since 01.11.2026 each line also shows the bank's own sum in
// lari for it and the rate that makes («1 USD = 2.5982 ₾», the same in every
// language), or that the bank sent no lari. The bank's lari are the dollars at
// the National Bank of Georgia's official rate of the line's day: so for all 15
// lines in dollars on the test stand, read against nbg.gov.ge on 01.11.2026.
// A card payment the bank listed twice says which line it repeats, and is in
// no sum.
//
// Since 02.11.2026 (stage 5, migration 0076) an owner sorts such a line in
// «Разобрать»: in a group of its own, with the bank's lari in a field he may
// correct, and the answers that are no customer's money — «Обмен валюты»
// among them. The `sort…` words are that card's.
//
// The Georgian here was written by a non-native and has not been read by one
// yet.

export const bankCurrencyEn = {
  bankCurrency: {
    title: 'Operations in foreign currency',
    note: 'Each account is summed in its own currency. They are sorted in «Sort»: a sorted operation counts in the reports in ₾ at the sum it was sorted at, one still waiting is in no total in ₾. A line’s sum in ₾ is the bank’s, at the National Bank of Georgia’s official rate of its day.',
    notInGel: 'Sums in the account’s currency',
    in: 'In',
    out: 'Out',
    empty: 'No operations in foreign currency in this period.',
    noGel: 'No sum in ₾ from the bank',
    twinOf: (day: string) => `The bank sent this card payment a second time: it repeats the one of ${day} and is in no sum.`,
    waiting: 'Waits in «Sort»',
    sortGroup: 'In foreign currency',
    sortInLari: 'Sum in ₾',
    sortBankSum: 'The bank’s, at the National Bank’s rate of the day',
    sortCorrected: (bank: string) => `Corrected: the bank’s was ${bank}`,
    sortNoBank: 'The bank sent no sum in ₾: enter it',
    sortBadSum: 'Enter the sum in ₾',
    sortExchange: 'Currency exchange',
    sortExchangeDone: 'Recorded as a currency exchange',
    sortAsideExchange: 'Currency exchange',
    sortCountsAt: (gel: string) => `counts as ${gel}`,
    reportSorted: 'Sorted — and its lari in the rows above',
    reportNote: 'An operation in foreign currency counts above at the lari it was sorted at; one still waiting is in no total in ₾.',
  },
};

export const bankCurrencyRu: typeof bankCurrencyEn = {
  bankCurrency: {
    title: 'Операции в валюте',
    note: 'Каждый счёт считается в своей валюте. Операции разбирают в «Разобрать»: разобранная входит в отчёты в ₾ суммой, по которой её разобрали, неразобранная — ни в один итог в ₾. Сумма в ₾ у операции — от банка, по официальному курсу Нацбанка Грузии на её день.',
    notInGel: 'Суммы — в валюте счёта',
    in: 'Приход',
    out: 'Расход',
    empty: 'За этот период операций в валюте нет.',
    noGel: 'Банк не дал сумму в ₾',
    twinOf: (day: string) => `Банк прислал эту оплату картой второй раз: она повторяет операцию от ${day} и в суммы не входит.`,
    waiting: 'Ждёт в «Разобрать»',
    sortGroup: 'В валюте',
    sortInLari: 'Сумма в ₾',
    sortBankSum: 'От банка, по курсу Нацбанка на день операции',
    sortCorrected: (bank: string) => `Исправлено: у банка было ${bank}`,
    sortNoBank: 'Банк не дал сумму в ₾: впишите её',
    sortBadSum: 'Впишите сумму в ₾',
    sortExchange: 'Обмен валюты',
    sortExchangeDone: 'Записано как обмен валюты',
    sortAsideExchange: 'Обмен валюты',
    sortCountsAt: (gel: string) => `считается как ${gel}`,
    reportSorted: 'Разобрано — и в ₾ в строках выше',
    reportNote: 'Операция в валюте считается выше суммой в ₾, по которой её разобрали; неразобранная — ни в один итог в ₾ не входит.',
  },
};

export const bankCurrencyKa: typeof bankCurrencyEn = {
  bankCurrency: {
    title: 'ოპერაციები უცხოურ ვალუტაში',
    note: 'თითოეული ანგარიში თავის ვალუტაში ითვლება. ოპერაციები «დასახარისხებელში» ხარისხდება: დახარისხებული ₾-ის ანგარიშებში იმ თანხით შედის, რომლითაც დაახარისხეს, დაუხარისხებელი — ₾-ის არცერთ ჯამში. ოპერაციის თანხა ₾-ში ბანკისაა, ეროვნული ბანკის ოფიციალური კურსით ოპერაციის დღეს.',
    notInGel: 'თანხები ანგარიშის ვალუტაშია',
    in: 'შემოსავალი',
    out: 'გასავალი',
    empty: 'ამ პერიოდში ვალუტაში ოპერაციები არ ყოფილა.',
    noGel: 'ბანკს ₾-ში თანხა არ გადმოუცია',
    twinOf: (day: string) => `ბანკმა ეს ბარათით გადახდა მეორედ გამოგზავნა: ის იმეორებს ${day}-ის ოპერაციას და ჯამებში არ შედის.`,
    waiting: 'ელოდება «დასახარისხებელში»',
    sortGroup: 'უცხოურ ვალუტაში',
    sortInLari: 'თანხა ₾-ში',
    sortBankSum: 'ბანკისაა, ეროვნული ბანკის კურსით ოპერაციის დღეს',
    sortCorrected: (bank: string) => `შესწორებულია: ბანკისა იყო ${bank}`,
    sortNoBank: 'ბანკს ₾-ში თანხა არ გადმოუცია: ჩაწერეთ',
    sortBadSum: 'ჩაწერეთ თანხა ₾-ში',
    sortExchange: 'ვალუტის გაცვლა',
    sortExchangeDone: 'ჩაიწერა ვალუტის გაცვლად',
    sortAsideExchange: 'ვალუტის გაცვლა',
    sortCountsAt: (gel: string) => `ითვლება როგორც ${gel}`,
    reportSorted: 'დახარისხებულია — და ₾-ში ზემოთ ხაზებში',
    reportNote: 'ვალუტის ოპერაცია ზემოთ იმ ₾-ის თანხით ითვლება, რომლითაც დაახარისხეს; დაუხარისხებელი ₾-ის არცერთ ჯამში არ შედის.',
  },
};
