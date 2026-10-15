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
    another: 'This is another transfer — record it',
    choose: 'Choose: attach the bank’s line, or record another transfer.',
    submitAttach: 'Attach the bank’s line',
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
    another: 'Это другой перевод — записать',
    choose: 'Выберите: привязать строку банка или записать другой перевод.',
    submitAttach: 'Привязать строку банка',
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
    another: 'ეს სხვა გადარიცხვაა — ჩაწერა',
    choose: 'აირჩიეთ: ბანკის ხაზის მიბმა ან სხვა გადარიცხვის ჩაწერა.',
    submitAttach: 'ბანკის ხაზის მიბმა',
    attached: (sum, n) => `ბანკის ხაზი მიება: ${sum} · ${n}`,
  },
};
