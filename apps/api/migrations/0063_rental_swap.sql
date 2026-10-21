-- EV8 Ops — migration 0063: a running rental can change its moped (ADR-0040).
--
-- Until now a rental had one moped for its whole life: `rentals.vehicle_id`,
-- and its acts had none of their own — the mileage in an act was silently the
-- rental's moped's. A swap keeps the rental (its number, weeks, deposit, debt
-- and pay day) and changes the moped in it: the moped given back gets an act
-- of its own, the moped handed out another, and each says which moped it was
-- about. Which moped the rental had on a given day is read from these acts,
-- the way a moped's state is read from its events — no table of its own.
--
--   * `swap_out` — the act of the moped the customer gives back at a swap;
--     `swap_in` — the act of the moped handed out in its place.
--   * `acts.vehicle_id` — the moped of the act. Before this migration an act
--     could only be about its rental's moped, so the existing acts take it.
--     A rental handed over without a VIN and given its moped later through
--     «Изменить условия» gets that moped on its hand-over act too: it is the
--     moped the mileage was read off, and the one maintenance already read it
--     as.
--
-- New enum values are only added here; nothing in this file uses them (the
-- file runs in one transaction, and a value added in it is not usable there).

ALTER TYPE act_kind ADD VALUE IF NOT EXISTS 'swap_out';
ALTER TYPE act_kind ADD VALUE IF NOT EXISTS 'swap_in';

ALTER TABLE acts ADD COLUMN IF NOT EXISTS vehicle_id uuid REFERENCES vehicles(id);
CREATE INDEX IF NOT EXISTS acts_vehicle_idx ON acts(vehicle_id);

UPDATE acts a
SET vehicle_id = r.vehicle_id
FROM rentals r
WHERE r.id = a.rental_id
  AND a.vehicle_id IS NULL
  AND r.vehicle_id IS NOT NULL;
