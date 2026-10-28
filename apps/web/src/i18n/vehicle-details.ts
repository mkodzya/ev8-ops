// «Изменить данные» on a moped's card (issue #19 of the director, item 2): the
// colour, the year and the day it came, put right by an owner. The fields keep
// the words the form that adds a moped already uses (`models.color`,
// `models.year`, `models.arrivedOn`); here is what the sheet says besides. One
// file, so the Georgian goes to proofreading as one list
// (docs/qa/issue-19-stock-section-and-two-fixes-ka-strings.md).

export const vehicleDetailsEn = {
  vdetails: {
    /** The «⋯» menu item and the sheet's title. */
    title: 'Edit the details',
    /** Under «Arrived on»: the latest day it may say, and what sets it. */
    latestToday: 'Not after today.',
    latestHistory: (day: string) => `Not after ${day}: that is the first day in the moped’s history.`,
    /** Under «Year». */
    yearRange: (min: number, max: number) => `From ${min} to ${max}.`,
    /** Asked only when the day it came changes: a date put right says why (ux №14). */
    reason: 'Why the arrival date changes',
    reasonHint: 'It goes into the moped’s history beside the old and the new date.',
    /** The toast when the sheet was saved with nothing changed. */
    same: 'Nothing changed',
  },
};

export const vehicleDetailsRu: typeof vehicleDetailsEn = {
  vdetails: {
    title: 'Изменить данные',
    latestToday: 'Не позже сегодняшнего дня.',
    latestHistory: (day) => `Не позже ${day}: это первый день в истории мопеда.`,
    yearRange: (min, max) => `От ${min} до ${max}.`,
    reason: 'Почему меняется дата прихода',
    reasonHint: 'Попадёт в историю мопеда рядом со старой и новой датой.',
    same: 'Ничего не изменилось',
  },
};

export const vehicleDetailsKa: typeof vehicleDetailsEn = {
  vdetails: {
    title: 'მონაცემების შეცვლა',
    latestToday: 'არა უგვიანეს დღევანდელი დღისა.',
    latestHistory: (day) => `არა უგვიანეს ${day}: ეს მოპედის ისტორიის პირველი დღეა.`,
    yearRange: (min, max) => `${min}-დან ${max}-მდე.`,
    reason: 'რატომ იცვლება მოსვლის თარიღი',
    reasonHint: 'ჩაიწერება მოპედის ისტორიაში ძველი და ახალი თარიღის გვერდით.',
    same: 'არაფერი შეცვლილა',
  },
};
