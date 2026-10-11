-- EV8 Ops — migration 0037: the price of petrol for ev8.ge's calculator
-- (Kardu, 11.10.2026: the comparison must use today's price, read
-- automatically once a day).
--
-- One row. The worker knocks once a day; the API reads the chains' price
-- boards (lib/fuelPrice.ts) and keeps the median of regular petrol (92/93) in
-- tetri, how many chains it was taken from, where, and when. A reading that
-- fails keeps the last good price and its date untouched and writes only when
-- it tried and why it failed, so the site never shows a price it did not read.

CREATE TABLE fuel_price (
  id              boolean     PRIMARY KEY DEFAULT true CHECK (id),
  per_litre_tetri integer     CHECK (per_litre_tetri BETWEEN 200 AND 800),
  chains          integer,
  source          text,
  as_of           timestamptz,
  last_try_at     timestamptz,
  last_failure    text
);
