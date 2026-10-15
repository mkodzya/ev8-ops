// Words of the money form when the bank has sent the money already (B11-03):
// a transfer or a card payment typed in by hand, and a bank line of the same
// sum within ±3 days — still in «Разобрать», to be attached instead, or
// already the customer's payment.
//
// The Georgian here was written by a non-native and has not been read by one
// yet (docs/qa/wave-2-ka-strings.md).

export const inBankEn = {
  inBank: {
    title: 'The bank has already sent this sum',
    credited: (net: string) => `the bank credited ${net}`,
    paidAs: (n: string) => `Already recorded: the payment for ${n}`,
    paidAsPlain: 'Already recorded as this customer’s payment',
    waits: 'Waiting in “Sort”',
    attach: 'Attach this line',
    pick: 'This one',
    another: 'This is another transfer — record it',
    choose: 'Choose which line to attach.',
    attached: (sum: string, n: string) => `Bank line attached: ${sum} · ${n}`,
  },
};

export const inBankRu: typeof inBankEn = {
  inBank: {
    title: 'Банк уже прислал эту сумму',
    credited: (net) => `банк зачислил ${net}`,
    paidAs: (n) => `Уже записано: платёж по ${n}`,
    paidAsPlain: 'Уже записано платежом этого клиента',
    waits: 'Ждёт в «Разобрать»',
    attach: 'Привязать эту строку',
    pick: 'Эту',
    another: 'Это другой перевод — записать',
    choose: 'Выберите, какую строку привязать.',
    attached: (sum, n) => `Строка банка привязана: ${sum} · ${n}`,
  },
};

export const inBankKa: typeof inBankEn = {
  inBank: {
    title: 'ბანკმა ეს თანხა უკვე გამოგზავნა',
    credited: (net) => `ბანკმა ჩარიცხა ${net}`,
    paidAs: (n) => `უკვე გატარებულია: ${n}-ის გადახდა`,
    paidAsPlain: 'უკვე გატარებულია ამ კლიენტის გადახდად',
    waits: 'ელოდება «დასახარისხებელში»',
    attach: 'ამ ხაზის მიბმა',
    pick: 'ეს',
    another: 'ეს სხვა გადარიცხვაა — ჩაწერა',
    choose: 'აირჩიეთ, რომელი ხაზი მივაბათ.',
    attached: (sum, n) => `ბანკის ხაზი მიება: ${sum} · ${n}`,
  },
};
