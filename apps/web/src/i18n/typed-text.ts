// Typed text in the reader's language (ADR-0042; Mika, 21.10.2026). What a
// person typed about a moped or a repair is shown translated, with a mark
// that says so; one tap shows the original. One file, so the Georgian goes to
// proofreading as one list (docs/qa/typed-text-translation-ka-strings.md).
// The Georgian is the session's translation; the director proofreads it.

export const typedTextEn = {
  typed: {
    /** The mark beside a translation. */
    translated: 'translated',
    /** The mark beside the original, once it is shown. */
    original: 'original',
    from: { ka: 'from Georgian', ru: 'from Russian', en: 'from English', other: 'from another language' } as Record<string, string>,
    writtenIn: { ka: 'in Georgian', ru: 'in Russian', en: 'in English', other: 'in another language' } as Record<string, string>,
    showOriginal: (from: string) => `Translated ${from}. Show the original`,
    showTranslation: (inLang: string) => `The original, ${inLang}. Show the translation`,
    /** Beside a translation inside a link: the record it opens shows the original. */
    quietHint: (from: string) => `Translated ${from}; the record shows the original`,
  },
};

type TypedText = typeof typedTextEn;

export const typedTextRu: TypedText = {
  typed: {
    translated: 'перевод',
    original: 'оригинал',
    from: { ka: 'с грузинского', ru: 'с русского', en: 'с английского', other: 'с другого языка' },
    writtenIn: { ka: 'на грузинском', ru: 'на русском', en: 'на английском', other: 'на другом языке' },
    showOriginal: (from) => `Переведено ${from}. Показать оригинал`,
    showTranslation: (inLang) => `Оригинал ${inLang}. Показать перевод`,
    quietHint: (from) => `Переведено ${from}; оригинал — в записи`,
  },
};

export const typedTextKa: TypedText = {
  typed: {
    translated: 'თარგმანი',
    original: 'ორიგინალი',
    from: { ka: 'ქართულიდან', ru: 'რუსულიდან', en: 'ინგლისურიდან', other: 'სხვა ენიდან' },
    writtenIn: { ka: 'ქართულად', ru: 'რუსულად', en: 'ინგლისურად', other: 'სხვა ენაზე' },
    showOriginal: (from) => `ნათარგმნია ${from}. ორიგინალის ჩვენება`,
    showTranslation: (inLang) => `ორიგინალი ${inLang}. თარგმანის ჩვენება`,
    quietHint: (from) => `ნათარგმნია ${from}; ორიგინალი — ჩანაწერში`,
  },
};
