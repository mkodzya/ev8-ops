// Words of the accounts in another currency (Mika, 29.10.2026, decision D1
// «А» of docs/spec/usd-accounts-plan.md): on "Деньги → Выписки" each such
// account has a card of its own beside its bank's, and its operations are
// listed apart — read only, in their own currency, in no total in lari. An
// account's name, «Bank of Georgia · USD», is the same in every language and
// is not here. Since 01.11.2026 each line also shows the bank's own sum in
// lari for it and the rate that makes («1 USD = 2.5982 ₾», the same in every
// language), or that the bank sent no lari.
//
// The Georgian here was written by a non-native and has not been read by one
// yet.

export const bankCurrencyEn = {
  bankCurrency: {
    title: 'Operations in foreign currency',
    note: 'Read only: they are not sorted and are in no total in ₾. Each account is summed in its own currency; the sum in ₾ and the rate beside a line are the bank’s.',
    notInGel: 'Not in the totals in ₾',
    in: 'In',
    out: 'Out',
    empty: 'No operations in foreign currency in this period.',
    noGel: 'No sum in ₾ from the bank',
  },
};

export const bankCurrencyRu: typeof bankCurrencyEn = {
  bankCurrency: {
    title: 'Операции в валюте',
    note: 'Только для просмотра: их не разбирают, и они не входят ни в один итог в ₾. Каждый счёт считается в своей валюте; сумма в ₾ и курс у операции — как их посчитал банк.',
    notInGel: 'Не входит в итоги в ₾',
    in: 'Приход',
    out: 'Расход',
    empty: 'За этот период операций в валюте нет.',
    noGel: 'Банк не дал сумму в ₾',
  },
};

export const bankCurrencyKa: typeof bankCurrencyEn = {
  bankCurrency: {
    title: 'ოპერაციები უცხოურ ვალუტაში',
    note: 'მხოლოდ სანახავად: ისინი არ ხარისხდება და ₾-ის არცერთ ჯამში არ შედის. თითოეული ანგარიში თავის ვალუტაში ითვლება; ოპერაციის თანხა ₾-ში და კურსი ბანკის დათვლილია.',
    notInGel: '₾-ის ჯამებში არ შედის',
    in: 'შემოსავალი',
    out: 'გასავალი',
    empty: 'ამ პერიოდში ვალუტაში ოპერაციები არ ყოფილა.',
    noGel: 'ბანკს ₾-ში თანხა არ გადმოუცია',
  },
};
