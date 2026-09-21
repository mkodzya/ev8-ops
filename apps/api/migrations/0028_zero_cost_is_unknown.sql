-- EV8 Ops — migration 0028: a cost of zero is not a cost (QA-W5-29).
--
-- A shipment received before anybody paid for it was recosted at nothing:
-- every moped of it was written 0.00 ₾, and the model's own figure — the one
-- a sale price is set from — was overwritten with that zero, wiping what an
-- earlier, paid shipment had taught it.
--
-- The recost no longer writes a zero: what a unit cost is unknown until money
-- moves, and unknown is empty here, not nought (`Мопед без себестоимости не
-- получает итога; незаполненное — не ноль`). This undoes the zeroes already
-- written, on both stands and on any copy of them. It cannot lose a real
-- figure: nothing in this business costs nothing.

UPDATE vehicles SET cost_tetri = NULL, updated_at = now() WHERE cost_tetri = 0;
UPDATE vehicle_models SET cost_tetri = NULL, updated_at = now() WHERE cost_tetri = 0;
