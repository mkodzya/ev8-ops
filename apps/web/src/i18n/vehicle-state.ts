// The sheet that changes a moped's state by hand (21.10.2026): the state it is
// in now, then the ones it may go to. One file, so the Georgian goes to
// proofreading as one list (docs/qa/vehicle-state-sheet-ka-strings.md).

export const vehicleStateEn = {
  stateSheet: {
    /** Beside the badge of the state the moped is in, ahead of the ones it may go to. */
    now: 'now',
  },
};

export const vehicleStateRu: typeof vehicleStateEn = {
  stateSheet: {
    now: 'сейчас',
  },
};

export const vehicleStateKa: typeof vehicleStateEn = {
  stateSheet: {
    now: 'ახლა',
  },
};
