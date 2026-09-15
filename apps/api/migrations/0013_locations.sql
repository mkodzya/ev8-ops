-- Points: where a moped physically is.
--
-- Until now a moped answered three different questions with one field.
-- `state` said what is happening to it, and that quietly stood in for both
-- what it is for and where it stands. Asked "where is HH8…2016 right now",
-- the system had nothing to say.
--
-- A point is the third answer, and it is deliberately the smallest thing
-- that works: a name the company already says out loud. No addresses, no
-- capacity, no map — those are guesses, and none of them exist in Odoo,
-- where `location` is empty on all 31 fleet cards and the only warehouse is
-- the default "WH/Stock". The list starts empty and the owner fills it.
--
-- Two of the three answers stay derived, as everywhere else here: a moped
-- out on rent is at its customer, and one nobody has placed is honestly
-- unplaced. Only a moped standing on company ground carries a point, which
-- is why the check below exists — "at the customer" is not a point, and
-- writing one there would be a second truth about the same moped.

CREATE TABLE locations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL CHECK (length(btrim(name)) > 0),
  -- What to know before sending someone there: a gate code, whose key it is.
  note       text,
  -- The order Kardu reads them in, not alphabetical: the yard he uses ten
  -- times a day should not sit under the container he opens twice a year.
  sort_order integer NOT NULL DEFAULT 0,
  archived   boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One point per place. "Склад" and "склад " are the same yard, and two rows
-- would split the fleet across a spelling.
CREATE UNIQUE INDEX locations_name_unique ON locations(lower(btrim(name)));

ALTER TABLE vehicles
  ADD COLUMN location_id uuid REFERENCES locations(id),
  ADD CONSTRAINT vehicle_rented_has_no_point
    CHECK (state <> 'rented' OR location_id IS NULL);

CREATE INDEX vehicles_location ON vehicles(location_id) WHERE location_id IS NOT NULL;
