// Money coming in, and what it was (issue #13 of the director, 25.10.2026;
// ADR-0046): «Разобрать → Поступления» answered by its kind first, like money
// going out (ADR-0027). One file, so the Georgian goes to the director as one
// list (docs/qa/inbound-sort-ka-strings.md). The Georgian is the session's
// translation; the director proofreads it.

export const incEn = {
  inc: {
    /** A line attached before issue #13 by its sum and a rental's pick-up day, with no card fee: said as what it was. */
    reasonPickupDay: (n: string, day: string) => `Sum and pick-up day: ${n}, handed over ${day}.`,
  },
};

type Inc = typeof incEn;

export const incRu: Inc = {
  inc: {
    reasonPickupDay: (n, day) => `Сумма и день выдачи: ${n} выдана ${day}.`,
  },
};

export const incKa: Inc = {
  inc: {
    reasonPickupDay: (n, day) => `თანხა და გაცემის დღე: ${n} გაიცა ${day}.`,
  },
};
