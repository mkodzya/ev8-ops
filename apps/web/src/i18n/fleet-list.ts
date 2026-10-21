// The fleet list's own words since the call of 21.10.2026 (ADR-0005, addendum
// 21.10.2026). One file, so the Georgian goes to proofreading as one list
// (docs/qa/fleet-list-reason-and-sale-ka-strings.md). The reason column takes
// its heading and its five kinds from the workshop (`wjob.reason`,
// `wjob.reasons`), and "Sell a moped" from the sales (`sales.newSale`): one
// word for one thing.

export const fleetListEn = {
  fleetList: {
    /** The sale park as the list says it: a chip, and a line under the state. */
    forSale: 'For sale',
  },
};

export const fleetListRu: typeof fleetListEn = {
  fleetList: {
    forSale: 'На продажу',
  },
};

export const fleetListKa: typeof fleetListEn = {
  fleetList: {
    forSale: 'იყიდება',
  },
};
