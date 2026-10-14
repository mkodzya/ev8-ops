-- EV8 Ops — migration 0040: a rental week can be discounted, with a reason.
--
-- A moped stood a day in the workshop and the customer paid 125 instead of
-- 150 for the week (meeting of Mika and Kardu, 14.10.2026). Until now the
-- week stayed at 150 and the 25 showed as debt for good. An owner may now
-- take an amount off one week: amount_tetri is what the week costs after the
-- discount — the figure every debt, the calendar and "paid through" already
-- read — and discount_tetri is what was taken off, so the full price is
-- their sum and the card can say why.

ALTER TABLE rental_periods
  ADD COLUMN discount_tetri  integer NOT NULL DEFAULT 0 CHECK (discount_tetri >= 0),
  ADD COLUMN discount_reason text,
  ADD COLUMN discounted_by   uuid REFERENCES users(id),
  ADD COLUMN discounted_at   timestamptz;
