// A moped whose rental is open while its status says otherwise (GitHub issue
// #17, item 1; ADR-0049): the line on its card and in the list, the one state
// an owner may give it back, and what a repair's end says of such a moped. One file, so the Georgian goes to
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
  /** A repair that took in a moped whose rental is open gives it back to that customer, not to the yard. */
  repairBack: {
    /**
     * The closing's foot and the owner's closing sheet, then `rented` in bold —
     * so it ends on the separator the refusal puts between the rental and the
     * status (QA before 1.17.0: «… по R-00511 «В аренде»» ran the two together).
     */
    toRenter: (v: string, n: string) => `${v} goes back to the renter on ${n},`,
    rented: '«Rented»',
    /** Refusing such a repair. */
    reject: (v: string, n: string) => `The repair becomes «Refused». ${v} goes back to the renter on ${n}, «Rented». No pay for the mechanic on it.`,
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
  repairBack: {
    toRenter: (v: string, n: string) => `${v} вернётся арендатору по ${n} —`,
    rented: '«В аренде»',
    reject: (v: string, n: string) => `Заявка станет «Отклонена». ${v} вернётся арендатору по ${n} — «В аренде». Оплаты механику по ней не будет.`,
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
  repairBack: {
    toRenter: (v: string, n: string) => `${v} დაბრუნდება მოქირავესთან — ${n},`,
    rented: '«ქირაშია»',
    reject: (v: string, n: string) => `შეკეთება გახდება „უარყოფილი“. ${v} დაბრუნდება მოქირავესთან — ${n}, «ქირაშია». მექანიკოსს ამაში ანაზღაურება არ ექნება.`,
  },
};
