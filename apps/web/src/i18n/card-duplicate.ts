// A Bank of Georgia card payment the bank sent twice (issue #16, ADR-0021,
// addendum of 25.10.2026): the mark on the later line in «Разобрать», its one
// answer, and how «Убранные из очереди» names it. One file, so the Georgian
// goes to proofreading as one list (docs/qa/bog-card-dup-and-refund-hint-ka-strings.md).

export const dupEn = {
  dup: {
    /** The day and the bank's number of the line this one repeats. */
    looksLike: (day: string, doc: string) => `Looks like a duplicate of the line of ${day}${doc ? ` (No. ${doc})` : ''}: the bank sent this card payment twice.`,
    yes: 'It is a duplicate',
    done: 'Set aside as a duplicate',
    aside: (day: string, doc: string) => `Duplicate of the line of ${day}${doc ? ` (No. ${doc})` : ''}.`,
  },
};

export type DupDict = typeof dupEn;

export const dupRu: DupDict = {
  dup: {
    looksLike: (day, doc) => `Похоже на дубль строки от ${day}${doc ? ` (№${doc})` : ''}: банк прислал эту оплату картой дважды.`,
    yes: 'Это дубль',
    done: 'Убрано как дубль',
    aside: (day, doc) => `Дубль строки от ${day}${doc ? ` (№${doc})` : ''}.`,
  },
};

export const dupKa: DupDict = {
  dup: {
    looksLike: (day, doc) => `ჰგავს ${day}-ის ხაზის დუბლიკატს${doc ? ` (№${doc})` : ''}: ბანკმა ეს ბარათით გადახდა ორჯერ გამოგზავნა.`,
    yes: 'ეს დუბლიკატია',
    done: 'ამოღებულია როგორც დუბლიკატი',
    aside: (day, doc) => `${day}-ის ხაზის დუბლიკატი${doc ? ` (№${doc})` : ''}.`,
  },
};
