// The moped card's own words since the QA walk of 21–22.10.2026: a swap in its
// history and in its mileage line, and the first day the tracker sheet
// offers. One file, so the Georgian goes to proofreading as one list
// (docs/qa/fleet-polish-ka-strings.md). The swap keeps the rental's word for
// it (`swap.mark`, «замена» / შეცვლა); «not before» is said the way the sale
// date sheet says it (`saleDate.notBefore`).

export const vehicleCardEn = {
  vcard: {
    /** In the history, instead of «Returned»: the moped given back in a swap — the rental went on with another (ADR-0040). */
    swappedOut: 'Swapped out of rental',
    /** In the history, instead of «Handed out»: the moped a swap brought into a running rental. */
    swappedIn: 'Swapped into rental',
    /** Where the card's mileage was read, when it was one of a swap's two acts: «mileage 1 150 (return in a swap, 22.10.2026)». */
    swapSources: { pickup: 'pickup in a swap', return: 'return in a swap' } as Record<string, string>,
    /** Under «On the moped since», and under it again when the day is earlier. */
    trackerFromArrival: (day: string) => `Not before ${day}: the moped came that day.`,
    trackerFromRemoved: (day: string) => `Not before ${day}: the last tracker came off that day.`,
  },
};

export const vehicleCardRu: typeof vehicleCardEn = {
  vcard: {
    swappedOut: 'Заменён в аренде',
    swappedIn: 'Выдан на замену в аренде',
    swapSources: { pickup: 'выдача при замене', return: 'возврат при замене' },
    trackerFromArrival: (day) => `Не раньше ${day}: в этот день мопед пришёл.`,
    trackerFromRemoved: (day) => `Не раньше ${day}: в этот день снят прежний трекер.`,
  },
};

export const vehicleCardKa: typeof vehicleCardEn = {
  vcard: {
    swappedOut: 'შეიცვალა ქირაში',
    swappedIn: 'გაიცა შესაცვლელად ქირაში',
    swapSources: { pickup: 'გაცემა შეცვლისას', return: 'დაბრუნება შეცვლისას' },
    trackerFromArrival: (day) => `არა უადრეს ${day}: ამ დღეს მოპედი მოვიდა.`,
    trackerFromRemoved: (day) => `არა უადრეს ${day}: ამ დღეს წინა ტრეკერი მოიხსნა.`,
  },
};
