-- EV8 Ops — migration 0018: hand-over and return (redesign wave 3).
--
-- What a return can charge on top of the weeks — a lost key, days of delay —
-- as rows a payment can close; what is kept from a deposit as rows too, a
-- repair's and a return's side by side instead of one overwriting the other
-- (B5-04); an existing rental brought over from Odoo with the weeks it had
-- already paid and the deposit it had already received (B3-02); a document
-- signed on the screen (D17).

-- ---- charges beyond the weeks ------------------------------------------------

-- New enum values are only added here; nothing in this file uses them.
ALTER TYPE allocation_target ADD VALUE IF NOT EXISTS 'charge';
-- Money that was the customer's deposit and is kept to pay what they owe:
-- a payment of its own kind, never cash in anyone's hands, never a bank line.
ALTER TYPE payment_channel ADD VALUE IF NOT EXISTS 'deposit';
ALTER TYPE payment_source ADD VALUE IF NOT EXISTS 'deposit';

CREATE TABLE rental_charges (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_id    uuid NOT NULL REFERENCES rentals(id) ON DELETE CASCADE,
  -- key: the contract's 250 for a key not brought back; late: days past the
  -- planned return at 30 a day (contract §6); withheld: what an owner kept
  -- from the deposit beyond the weeks and the other charges (damage, cleaning…).
  kind         text NOT NULL CHECK (kind IN ('key', 'late', 'withheld', 'other')),
  amount_tetri integer NOT NULL CHECK (amount_tetri > 0),
  note         text,
  created_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  voided_at    timestamptz
);
CREATE INDEX rental_charges_rental_idx ON rental_charges(rental_id);

ALTER TABLE payment_allocations ADD COLUMN charge_id uuid REFERENCES rental_charges(id) ON DELETE CASCADE;

-- ---- what is kept from a deposit, line by line ---------------------------------

CREATE TABLE deposit_withholdings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deposit_id     uuid NOT NULL REFERENCES deposits(id) ON DELETE CASCADE,
  source         text NOT NULL CHECK (source IN ('return', 'service')),
  rental_id      uuid REFERENCES rentals(id) ON DELETE CASCADE,
  service_job_id uuid REFERENCES service_jobs(id) ON DELETE SET NULL,
  amount_tetri   integer NOT NULL CHECK (amount_tetri > 0),
  grounds        text[] NOT NULL DEFAULT '{}',
  reason         text NOT NULL,
  -- The payment the kept money became (channel 'deposit'): what it closed.
  payment_id     uuid REFERENCES payments(id) ON DELETE SET NULL,
  created_by     uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  voided_at      timestamptz
);
CREATE INDEX deposit_withholdings_deposit_idx ON deposit_withholdings(deposit_id);

-- What was kept before this migration, as rows: a repair's from the job, a
-- return's as the rest of what the deposit says was kept.
INSERT INTO deposit_withholdings (deposit_id, source, rental_id, service_job_id, amount_tetri, grounds, reason, created_at)
SELECT d.id, 'service', j.rental_id, j.id, j.withheld_tetri, ARRAY['moped_damage'], j.number || ': ' || j.reason, j.updated_at
FROM service_jobs j JOIN deposits d ON d.rental_id = j.rental_id
WHERE j.withheld_tetri > 0;

INSERT INTO deposit_withholdings (deposit_id, source, rental_id, amount_tetri, grounds, reason, created_at)
SELECT d.id, 'return', d.rental_id,
       d.withheld_tetri - COALESCE((SELECT SUM(w.amount_tetri) FROM deposit_withholdings w WHERE w.deposit_id = d.id), 0),
       d.withheld_grounds, COALESCE(d.withheld_reason, 'before the return wizard'), d.updated_at
FROM deposits d
WHERE d.withheld_tetri > COALESCE((SELECT SUM(w.amount_tetri) FROM deposit_withholdings w WHERE w.deposit_id = d.id), 0);

-- ---- an existing rental brought over ------------------------------------------

ALTER TABLE rental_periods ADD COLUMN paid_before_transfer boolean NOT NULL DEFAULT false;
ALTER TABLE deposits ADD COLUMN received_before_transfer_tetri integer NOT NULL DEFAULT 0 CHECK (received_before_transfer_tetri >= 0);
ALTER TABLE rentals
  ADD COLUMN transferred_at       timestamptz,
  ADD COLUMN transferred_by       uuid REFERENCES users(id),
  -- An owner handing a moped to a customer who owes, and why (decision В2).
  ADD COLUMN debt_override_reason text;

-- ---- acts ----------------------------------------------------------------------

ALTER TABLE acts
  -- A mileage below the last act's, and why (B4-06).
  ADD COLUMN odometer_reason text,
  -- Where the moped stood after the return (B5-06).
  ADD COLUMN location_id uuid REFERENCES locations(id),
  -- The return's settlement as it was shown: weeks, charges, the choice
  -- between a week and days of delay — so a cancelled return can put back
  -- exactly what it changed.
  ADD COLUMN settlement jsonb;

-- ---- documents signed on the screen --------------------------------------------

ALTER TABLE files
  ADD COLUMN signed_at timestamptz,
  ADD COLUMN signed_by text;
