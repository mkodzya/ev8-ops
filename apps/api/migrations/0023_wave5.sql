-- EV8 Ops — migration 0023: sales, purchases, repairs and the shelf (wave 5).
--
-- What this adds, and why each column is a fact somebody stated rather than
-- a number the system could work out for itself:
--
--   * a contact is of one kind (B3-06). A supplier is not a customer with a
--     tick on it: the hand-over and the sale look for people, the order looks
--     for factories, and neither should have to filter the other out.
--   * two records for one person are merged by an owner, and the duplicate
--     keeps a line home to where it went (§3.9).
--   * repairs are done by a workshop from a list the owner keeps — until now
--     the workshop was free text and no two spellings matched (`service.md`).
--   * work is counted in minutes at a rate, so "1.5 hours × 50 ₾" can be read
--     back off the job instead of a lump sum nobody can take apart.
--   * a sale and an order carried over from the old way of working say what
--     had been paid by the day of the move — the payments themselves happened
--     before this system existed and are not invented here (B3-03, B3-04).

-- 1. What kind of record a contact is (B3-06, §3.9).
ALTER TABLE customers ADD COLUMN record_kind text NOT NULL DEFAULT 'client'
  CHECK (record_kind IN ('client', 'supplier', 'employee', 'other'));
UPDATE customers SET record_kind = 'supplier' WHERE is_supplier;
CREATE INDEX customers_record_kind_idx ON customers(record_kind) WHERE archived = false;

-- 2. Two records for one person (§3.9): the duplicate goes to the archive and
--    says where its life continues.
ALTER TABLE customers ADD COLUMN merged_into uuid REFERENCES customers(id);
CREATE INDEX customers_merged_into_idx ON customers(merged_into) WHERE merged_into IS NOT NULL;

-- 3. The workshops that do the repairs (`service.md`, §3.7).
CREATE TABLE workshops (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  phone      text,
  note       text,
  sort_order integer NOT NULL DEFAULT 0,
  archived   boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX workshops_name_idx ON workshops(lower(name));

-- The two that exist today, named by the owner in `service.md`. A workshop is
-- a fact of the business, not seed data: these two do the company's repairs.
INSERT INTO workshops (name, sort_order) VALUES ('Avtos workshop', 1), ('კურიერ-ოსტატი', 2);

ALTER TABLE service_jobs ADD COLUMN workshop_id uuid REFERENCES workshops(id);
-- What was typed into `done_by` before there was a list stays where it is: it
-- is what somebody wrote, and a guess at which workshop they meant would be
-- exactly the invention the house rules forbid.

-- 4. Work by the hour (`service.md`: 50 ₾/hour; the norms per job are
--    register #33 and are not here yet).
ALTER TABLE service_jobs ADD COLUMN labour_minutes integer NOT NULL DEFAULT 0 CHECK (labour_minutes >= 0);
ALTER TABLE service_jobs ADD COLUMN labour_rate_tetri integer NOT NULL DEFAULT 5000 CHECK (labour_rate_tetri >= 0);
-- Jobs that already carry a sum keep it: minutes are left at zero rather than
-- divided back out of money, because the hours behind an old figure are not
-- recorded anywhere.

-- Where the moped stood when the repair closed (B5-06) and what its odometer
-- read: both are asked for at closing, and neither was stored.
ALTER TABLE service_jobs ADD COLUMN closed_location_id uuid REFERENCES locations(id);
ALTER TABLE service_jobs ADD COLUMN odometer_km integer CHECK (odometer_km >= 0);
-- What the customer owes for this repair after whatever was kept from the
-- deposit (Q26): the line is named after the job on every screen.
ALTER TABLE service_jobs ADD COLUMN charged_tetri integer NOT NULL DEFAULT 0 CHECK (charged_tetri >= 0);

-- A repair line remembers what the part cost the company, beside what it was
-- put on the line at: the same part is 12.50 to the company and 30.00 to a
-- customer (B8-04), and a margin nobody can see is a margin nobody can check.
ALTER TABLE service_parts ADD COLUMN unit_cost_tetri integer;

-- 5. A sale carried over (B3-03) and an order carried over (B3-04).
ALTER TABLE sales ADD COLUMN paid_before_tetri integer NOT NULL DEFAULT 0 CHECK (paid_before_tetri >= 0);
ALTER TABLE sales ADD COLUMN transferred boolean NOT NULL DEFAULT false;

ALTER TABLE purchases ADD COLUMN paid_before_tetri integer NOT NULL DEFAULT 0 CHECK (paid_before_tetri >= 0);
ALTER TABLE purchases ADD COLUMN paid_before_minor bigint NOT NULL DEFAULT 0 CHECK (paid_before_minor >= 0);
ALTER TABLE purchases ADD COLUMN paid_before_on date;
-- A shipment received before it is paid for (Mika, Q23): its costs are
-- preliminary and every later payment recomputes them, so the order remembers
-- when it was last costed.
ALTER TABLE purchases ADD COLUMN costed_at timestamptz;

-- 6. The shelf. A first count of a part that has never moved is a fact of its
--    own (B3-05): it is a receipt with a cost and a date, and it may happen
--    once, which is what this index says.
CREATE UNIQUE INDEX stock_moves_initial_idx ON stock_moves(part_id) WHERE reason = 'initial';
