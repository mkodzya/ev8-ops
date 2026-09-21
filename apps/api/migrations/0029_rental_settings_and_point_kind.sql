-- EV8 Ops — migration 0029: rates, the deposit and what a point is (wave 6 §3.5).
--
-- Two things the code decided and the owner could not:
--
--   * the deposit was a constant in `packages/shared` (180 ₾) and the weekly
--     rates were nowhere at all — a hand-over typed them every time. R5 asks
--     for both to be settings an owner edits without a developer.
--   * a point was only a name. B10-02 gives it a kind — showroom, store,
--     workshop, swap station — so that a swap network does not need the
--     table rebuilt when it arrives. Nothing behaves differently by kind
--     yet, and that is deliberate (Mika, 17.09.2026).
--
-- On launch the settings hold one quick rate, 150 ₾, and a deposit of 180 ₾
-- (Mika, 21.09.2026, wave 6 §7). 140 and 170 are not created: the rentals
-- that carry them keep their own figure, which lives on the rental, not here.

CREATE TABLE rental_settings (
  -- One row, as `money_settings` does it.
  id             boolean PRIMARY KEY DEFAULT true CHECK (id),
  deposit_tetri  integer NOT NULL DEFAULT 18000 CHECK (deposit_tetri >= 0),
  updated_by     uuid REFERENCES users(id),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
INSERT INTO rental_settings (id) VALUES (true);

-- The buttons a hand-over offers beside the model's own rate, which is still
-- what it proposes first (§3.5).
CREATE TABLE quick_rates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_tetri  integer NOT NULL CHECK (rate_tetri > 0),
  sort_order  integer NOT NULL DEFAULT 0,
  archived    boolean NOT NULL DEFAULT false,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX quick_rates_rate_idx ON quick_rates(rate_tetri) WHERE NOT archived;
INSERT INTO quick_rates (rate_tetri, sort_order) VALUES (15000, 1);

CREATE TYPE location_kind AS ENUM ('showroom', 'store', 'workshop', 'swap');
-- What is there today, by the book: a showroom on Nutsubidze and the
-- contractor's workshop (`places.md`). Everything else is named by hand, so
-- the rest start as a showroom and are corrected on the screen.
ALTER TABLE locations ADD COLUMN kind location_kind NOT NULL DEFAULT 'showroom';
UPDATE locations SET kind = 'workshop' WHERE name ILIKE '%мастерск%' OR name ILIKE '%workshop%';
