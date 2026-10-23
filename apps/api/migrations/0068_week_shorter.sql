-- EV8 Ops — migration 0068: a rental week can be made shorter too (ADR-0041,
-- addendum of 23.10.2026).
--
-- The director's issue #12 of 23.10.2026, Mika's answer «А» the same day: a
-- renter who wants to pay on an earlier weekday has his latest week made 1–6
-- days shorter, for a discount a person types (the form suggests rate ÷ 7 ×
-- days). Until now the database held a week to 7 days plus 0–6 gained.
--
-- No new column: the two a longer week has keep a shorter one, signed.
--
--   * rental_periods.extra_days — the days the week gained, now −6 … 6:
--     below nought the days it lost. The length rule of 0064 stays as it is,
--     ends_on = starts_on + 6 + extra_days, and holds a shorter week too.
--   * rental_periods.extra_tetri — what the move did to the price, with the
--     days' sign: the extra on top for days gained, the discount taken off
--     for days lost (≤ 0). amount_tetri stays the price everything reads: the
--     rate, less a discount, plus this.
--   * rentals.week_shift_days — the days all its weeks gained, may now be
--     below nought: the weeks then run from a weekday before the pickup's.
--
-- Every live row keeps every rule here (extra_days 0–6, extra_tetri ≥ 0
-- beside it): no row changes. Written so that a second run changes nothing.

ALTER TABLE rental_periods DROP CONSTRAINT IF EXISTS rental_periods_extra_days;
ALTER TABLE rental_periods ADD CONSTRAINT rental_periods_extra_days CHECK (extra_days BETWEEN -6 AND 6);

-- The money follows the days: never a discount for days gained, nor an extra for days lost.
ALTER TABLE rental_periods DROP CONSTRAINT IF EXISTS rental_periods_extra_tetri;
ALTER TABLE rental_periods ADD CONSTRAINT rental_periods_extra_tetri
  CHECK ((extra_days >= 0 AND extra_tetri >= 0) OR (extra_days < 0 AND extra_tetri <= 0));

-- A week moved either way says why; a week not moved has no money of a move.
ALTER TABLE rental_periods DROP CONSTRAINT IF EXISTS rental_periods_shift_shape;
ALTER TABLE rental_periods ADD CONSTRAINT rental_periods_shift_shape
  CHECK ((extra_days = 0 AND extra_tetri = 0) OR (extra_days <> 0 AND shift_reason IS NOT NULL));

-- A rental whose week was made shorter starts its weeks earlier than its pickup's weekday.
ALTER TABLE rentals DROP CONSTRAINT IF EXISTS rentals_week_shift_days;
