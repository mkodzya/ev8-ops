// A moped whose rental is open while its status says otherwise (GitHub issue
// #17, item 1; ADR-0049): the line on its card and in the list, and the one
// state an owner may give it back. One file, so the Georgian goes to
// proofreading as one list (docs/qa/issue-17-rented-free-and-four-fixes-ka-strings.md).

export const rentedFreeEn = {
  stray: {
    /** The pill in «Change status», and the card's main button for an owner. */
    rentedBy: (n: string) => `Rented under ${n}`,
    /** Under the pill: why it is the only choice. */
    sheetHint: (n: string) => `Rental ${n} is open, but the status says otherwise. Give the moped its «Rented» back; the reason goes into its history.`,
    /** On the card, for everybody. */
    card: (n: string, state: string) => `Rental ${n} is open, but the status is «${state}».`,
    /** After it, for whoever may not fix it. */
    ownerFixes: 'An owner puts the status right.',
    /** A quiet line in the fleet list. */
    list: (n: string) => `rental ${n} is open`,
  },
};

export const rentedFreeRu: typeof rentedFreeEn = {
  stray: {
    rentedBy: (n: string) => `В аренде по ${n}`,
    sheetHint: (n: string) => `Аренда ${n} открыта, а статус другой. Верните мопеду «В аренде»; причина попадёт в его историю.`,
    card: (n: string, state: string) => `Аренда ${n} открыта, а статус — «${state}».`,
    ownerFixes: 'Статус исправит владелец.',
    list: (n: string) => `аренда ${n} открыта`,
  },
};

export const rentedFreeKa: typeof rentedFreeEn = {
  stray: {
    rentedBy: (n: string) => `ქირაშია — ${n}`,
    sheetHint: (n: string) => `ქირაობა ${n} ღიაა, სტატუსი კი სხვაა. მოპედს დაუბრუნეთ «ქირაშია»; მიზეზი მის ისტორიაში ჩაიწერება.`,
    card: (n: string, state: string) => `ქირაობა ${n} ღიაა, სტატუსი კი — «${state}».`,
    ownerFixes: 'სტატუსს მფლობელი გაასწორებს.',
    list: (n: string) => `ქირაობა ${n} ღიაა`,
  },
};
