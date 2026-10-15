-- EV8 Ops — migration 0043: every moped gets its own number, EV-007.
--
-- Meeting of Mika and Kardu, 14.10.2026: "each moped gets an internal number
-- and a QR code so the mechanic knows it"; the form EV-007 chosen by Mika on
-- 15.10.2026. Until now a moped was known only by its VIN.
--
-- The number is given in the order the mopeds came to the company — the day
-- they arrived, then the day they were entered, then the VIN — to every moped
-- not archived. It never changes and never passes to another moped: a sold
-- one keeps it, and a new moped takes the next from the sequence. The screen
-- writes it EV- and three digits (packages/shared/src/fleet.ts).
--
-- The telephone printed on the sticker for a customer with a breakdown lives
-- in the rental settings; until an owner fills it in, the sticker leaves that
-- line out (Mika, 15.10.2026: «телефон потом скажу»).

CREATE SEQUENCE vehicles_fleet_no_seq;
ALTER TABLE vehicles ADD COLUMN fleet_no integer UNIQUE;

UPDATE vehicles v SET fleet_no = n.no
FROM (
  SELECT id, row_number() OVER (ORDER BY arrived_on NULLS LAST, created_at, vin) AS no
  FROM vehicles WHERE NOT archived
) n
WHERE v.id = n.id;

SELECT setval('vehicles_fleet_no_seq', COALESCE((SELECT max(fleet_no) FROM vehicles), 0) + 1, false);
ALTER TABLE vehicles ALTER COLUMN fleet_no SET DEFAULT nextval('vehicles_fleet_no_seq');
ALTER SEQUENCE vehicles_fleet_no_seq OWNED BY vehicles.fleet_no;

ALTER TABLE rental_settings ADD COLUMN sticker_phone text;
