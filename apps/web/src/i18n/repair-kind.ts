// The kind of a repair picked in the office and changed by the owner (Mika,
// 21.10.2026, answer A). The five kinds themselves are the tablet's words,
// `wjob.reasons`, and the field is its `wjob.reason` — no second vocabulary.
// What is here is the few words around them. One file, so the Georgian goes to
// proofreading as one list (docs/qa/repair-reason-kind-ka-strings.md); the
// Georgian is the session's translation from words EV8 Ops already has —
// მითითებული არ არის, გეგმიური მომსახურება, გარბენი, დაითვლება.

export const repairKindEn = {
  rkind: {
    /** The sheet on a repair that sets or changes its kind. */
    pick: 'Reason for the repair',
    /** No kind given: in the sheet, on the card, in the journal. */
    none: 'not given',
    /** Under «Плановое ТО» picked in the office: what the pick sets going (ADR-0038 §2). */
    plannedNote: 'The next planned service is counted from the mileage written at closing.',
  },
};

type RepairKind = typeof repairKindEn;

export const repairKindRu: RepairKind = {
  rkind: {
    pick: 'Причина ремонта',
    none: 'не указана',
    plannedNote: 'Следующее ТО отсчитается от пробега при закрытии.',
  },
};

export const repairKindKa: RepairKind = {
  rkind: {
    pick: 'შეკეთების მიზეზი',
    none: 'მითითებული არ არის',
    plannedNote: 'შემდეგი გეგმიური მომსახურება დაითვლება დახურვისას ჩაწერილი გარბენიდან.',
  },
};
