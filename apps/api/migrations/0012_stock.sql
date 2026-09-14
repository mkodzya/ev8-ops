-- Parts on the shelf, and mopeds counted by model.
--
-- The spec puts parts stock outside v1 (§2). The owner asked for it, so it
-- is here — deliberately, and deliberately small: a catalogue, a ledger of
-- movements, and nothing else.
--
-- How many are on the shelf is never stored. It is the sum of the ledger,
-- the same way "paid through" and landed cost are worked out rather than
-- kept, so a corrected receipt or a removed repair line changes the count
-- at once and no second copy can drift away from the first.
--
-- Mopeds need no table of their own: a moped is a VIN with a state, so the
-- moped side of the warehouse is a count over `vehicles` and over the lines
-- of orders that have not arrived yet.

CREATE TABLE parts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The supplier's article number when there is one. Nothing is generated:
  -- an invented code is worse than none.
  sku              text UNIQUE,
  name             text NOT NULL CHECK (length(btrim(name)) > 0),
  name_ka          text,
  unit             text NOT NULL DEFAULT 'pcs',
  -- Below this many, the shelf is reported as short. 0 means nobody said.
  min_qty          integer NOT NULL DEFAULT 0 CHECK (min_qty >= 0),
  -- What a customer is usually charged for one; the repair line may differ.
  sale_price_tetri integer CHECK (sale_price_tetri IS NULL OR sale_price_tetri >= 0),
  notes            text,
  archived         boolean NOT NULL DEFAULT false,
  created_by       uuid REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
-- One shelf per part: the same thing written twice is two counts, each wrong.
CREATE UNIQUE INDEX parts_name_unique ON parts(lower(btrim(name)));

CREATE TYPE stock_move_kind AS ENUM ('receipt', 'issue', 'adjust');

CREATE TABLE stock_moves (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id          uuid NOT NULL REFERENCES parts(id),
  kind             stock_move_kind NOT NULL,
  -- Signed, always: in is positive, out is negative, and a stock-take is
  -- whichever it turns out to be. A movement of nothing is not a movement.
  qty              integer NOT NULL CHECK (qty <> 0),
  -- What one cost to land, on a receipt. An issue takes no cost of its own:
  -- what a part was worth when it left is worked out from the receipts.
  unit_cost_tetri  integer CHECK (unit_cost_tetri IS NULL OR unit_cost_tetri >= 0),
  occurred_on      date NOT NULL,
  purchase_line_id uuid REFERENCES purchase_lines(id) ON DELETE SET NULL,
  service_part_id  uuid REFERENCES service_parts(id) ON DELETE SET NULL,
  reason           text,
  created_by       uuid REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_move_direction CHECK (
    (kind = 'receipt' AND qty > 0) OR
    (kind = 'issue' AND qty < 0) OR
    kind = 'adjust'
  ),
  -- A count that changed by hand says why. This is the only place a number
  -- here is a person's word rather than a document's.
  CONSTRAINT stock_move_adjust_reason CHECK (kind <> 'adjust' OR length(btrim(coalesce(reason, ''))) > 0)
);
CREATE INDEX stock_moves_part_idx ON stock_moves(part_id, occurred_on);
-- A shipment line lands once and a repair line takes its parts once, however
-- many times the request is repeated.
CREATE UNIQUE INDEX stock_moves_purchase_line_unique ON stock_moves(purchase_line_id) WHERE purchase_line_id IS NOT NULL;
CREATE UNIQUE INDEX stock_moves_service_part_unique ON stock_moves(service_part_id) WHERE service_part_id IS NOT NULL;

-- A shipment line and a repair line may now name a part from the catalogue.
-- Both stay nullable: a line typed as free text is still a line, and the
-- company has years of them.
ALTER TABLE purchase_lines ADD COLUMN part_id uuid REFERENCES parts(id);
CREATE INDEX purchase_lines_part_idx ON purchase_lines(part_id) WHERE part_id IS NOT NULL;

ALTER TABLE service_parts ADD COLUMN part_id uuid REFERENCES parts(id);
CREATE INDEX service_parts_part_idx ON service_parts(part_id) WHERE part_id IS NOT NULL;
