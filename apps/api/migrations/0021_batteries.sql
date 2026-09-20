-- EV8 Ops — migration 0021: the battery count (wave 4 §3.8, D16).
--
-- `batteries.md`: 42 batteries, two with every moped, swapped in the showroom,
-- and a shortage keeps mopeds standing after a repair. They carry no numbers,
-- so this is a count, not a register: an owner's stocktake is the truth of the
-- day, and what happened since is added to it — batteries handed out with the
-- rentals, sent to repair and back, lost on a return.

CREATE TABLE battery_inventories (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  counted_on   date NOT NULL,
  -- Counted by hand in the showroom and in repair; what the couriers hold is
  -- counted from the acts, and any difference needs a reason (§3.8).
  showroom_qty integer NOT NULL CHECK (showroom_qty >= 0),
  repair_qty   integer NOT NULL CHECK (repair_qty >= 0),
  couriers_qty integer NOT NULL CHECK (couriers_qty >= 0),
  total_qty    integer NOT NULL CHECK (total_qty >= 0),
  reason       text,
  created_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE battery_moves (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL CHECK (kind IN ('to_repair', 'from_repair', 'lost', 'found')),
  qty         integer NOT NULL CHECK (qty > 0),
  reason      text,
  rental_id   uuid REFERENCES rentals(id) ON DELETE SET NULL,
  act_id      uuid REFERENCES acts(id) ON DELETE SET NULL,
  occurred_on date NOT NULL,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX battery_moves_when_idx ON battery_moves(occurred_on, created_at);
