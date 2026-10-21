-- EV8 Ops — migration 0064: a rental week can be made longer (ADR-0041).
--
-- A courier paid for his week three days late and paid for the three days on
-- top (call of Mika and Kardu, 21.10.2026). Mika's answer the same day, «А»:
-- an owner makes the running week of the rental 1–6 days longer, with a
-- reason; the extra sum is typed by a person; every later week and the pay
-- day start as many days later; money already on earlier weeks stays there.
-- Until now the database itself held a week to exactly seven days.
--
--   * rental_periods.extra_days — the days this week gained, 0–6. The week
--     ends on starts_on + 6 + extra_days: the seven-day rule of 0001 becomes
--     this one, and every live row (extra_days 0) already keeps it.
--   * rental_periods.extra_tetri — what the extra days cost. amount_tetri
--     stays the week's price everything reads (the debt, the calendar, "paid
--     through"): the rate, less a discount, plus this.
--   * shift_reason, shifted_by, shifted_at — why, who and when; the journal
--     has it too (`rental.week.shift`).
--   * rentals.week_shift_days — the days all its weeks gained, a stored
--     derived fact like paid_through: written only by recomputeRental, mended
--     by the nightly run. The day the weeks start on, and so the pay day, is
--     counted from the pickup plus it without reading the week rows.
--
-- No row changes today. Written so that a second run changes nothing.

ALTER TABLE rental_periods
  ADD COLUMN IF NOT EXISTS extra_days   smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extra_tetri  integer  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shift_reason text,
  ADD COLUMN IF NOT EXISTS shifted_by   uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS shifted_at   timestamptz;

ALTER TABLE rental_periods DROP CONSTRAINT IF EXISTS rental_periods_extra_days;
ALTER TABLE rental_periods ADD CONSTRAINT rental_periods_extra_days CHECK (extra_days BETWEEN 0 AND 6);
ALTER TABLE rental_periods DROP CONSTRAINT IF EXISTS rental_periods_extra_tetri;
ALTER TABLE rental_periods ADD CONSTRAINT rental_periods_extra_tetri CHECK (extra_tetri >= 0);
-- A week made longer says why; a week not made longer costs nothing extra.
ALTER TABLE rental_periods DROP CONSTRAINT IF EXISTS rental_periods_shift_shape;
ALTER TABLE rental_periods ADD CONSTRAINT rental_periods_shift_shape
  CHECK ((extra_days = 0 AND extra_tetri = 0) OR (extra_days > 0 AND shift_reason IS NOT NULL));

ALTER TABLE rental_periods DROP CONSTRAINT IF EXISTS rental_periods_seven_days;
ALTER TABLE rental_periods DROP CONSTRAINT IF EXISTS rental_periods_length;
ALTER TABLE rental_periods ADD CONSTRAINT rental_periods_length CHECK (ends_on = starts_on + (6 + extra_days));

ALTER TABLE rentals ADD COLUMN IF NOT EXISTS week_shift_days integer NOT NULL DEFAULT 0;
ALTER TABLE rentals DROP CONSTRAINT IF EXISTS rentals_week_shift_days;
ALTER TABLE rentals ADD CONSTRAINT rentals_week_shift_days CHECK (week_shift_days >= 0);
