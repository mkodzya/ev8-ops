// GitHub issue #18 of the director, part B — the simplifications of the audit
// (28.10.2026): a manager sells a moped (B8). One file, so the Georgian goes
// to proofreading as one list (docs/qa/issue-18-b-simplify-ka-strings.md).

export const simpleEn = {
  simple: {
    /** The sale wizard, for whoever enters no bank money: a card or a transfer arrives as a line to sort (B8). */
    sale: {
      viaBank: 'A card or a transfer reaches the bank: sort that line to this sale in «Sort».',
    },
  },
};

export const simpleRu: typeof simpleEn = {
  simple: {
    sale: {
      viaBank: 'Карта и перевод приходят в банк: эту строку привяжите к продаже в «Разобрать».',
    },
  },
};

export const simpleKa: typeof simpleEn = {
  simple: {
    sale: {
      viaBank: 'ბარათი და გადარიცხვა ბანკში შემოდის: ეს ხაზი ამ გაყიდვას «დასახარისხებელში» მიაბით.',
    },
  },
};
