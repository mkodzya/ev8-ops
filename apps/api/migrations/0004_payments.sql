-- Money coming in (spec §4 «Платёж», PAY-02…06).
--
-- Three facts are kept apart on purpose, because Odoo kept them together
-- and that is where the confusion came from:
--   gross  — what the customer paid (320);
--   fee    — what the acquirer kept (4.80), a company expense;
--   net    — what the bank credited (315.20).
-- A debt is closed by the GROSS. A customer who paid 320 by card does not
-- owe 4.80 (PAY-04).
--
-- Nothing is ever deleted. A payment entered by mistake is voided with a
-- reason; its allocations go and the periods are recomputed.

CREATE TYPE payment_channel   AS ENUM ('transfer', 'acquiring', 'cash');
CREATE TYPE payment_direction AS ENUM ('in', 'out');
CREATE TYPE payment_source    AS ENUM ('manual', 'statement', 'log');
CREATE TYPE allocation_target AS ENUM ('period', 'deposit');

CREATE TABLE payments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_on  date NOT NULL,
  direction    payment_direction NOT NULL DEFAULT 'in',
  channel      payment_channel NOT NULL,
  gross_tetri  integer NOT NULL CHECK (gross_tetri > 0),
  fee_tetri    integer NOT NULL DEFAULT 0 CHECK (fee_tetri >= 0),
  net_tetri    integer NOT NULL,
  customer_id  uuid REFERENCES customers(id),
  rental_id    uuid REFERENCES rentals(id),
  bank_text    text,                      -- the statement line as it arrived
  source       payment_source NOT NULL DEFAULT 'manual',
  note         text,
  created_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  voided_at    timestamptz,
  void_reason  text,
  voided_by    uuid REFERENCES users(id),
  odoo_payment_id integer UNIQUE,
  CONSTRAINT payments_net   CHECK (net_tetri = gross_tetri - fee_tetri),
  CONSTRAINT payments_voided CHECK (voided_at IS NULL OR void_reason IS NOT NULL)
);
CREATE INDEX payments_customer_idx ON payments(customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX payments_rental_idx   ON payments(rental_id)   WHERE rental_id IS NOT NULL;
CREATE INDEX payments_date_idx     ON payments(occurred_on);

-- What a payment closed. Oldest period first (PAY-02); the deposit first of
-- all, because the first payment of a rental is rent plus deposit.
CREATE TABLE payment_allocations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id   uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  target       allocation_target NOT NULL,
  period_id    uuid REFERENCES rental_periods(id) ON DELETE CASCADE,
  deposit_id   uuid REFERENCES deposits(id) ON DELETE CASCADE,
  amount_tetri integer NOT NULL CHECK (amount_tetri > 0),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT allocation_shape CHECK (
    (target = 'period'  AND period_id  IS NOT NULL AND deposit_id IS NULL) OR
    (target = 'deposit' AND deposit_id IS NOT NULL AND period_id  IS NULL)
  )
);
CREATE INDEX payment_allocations_payment_idx ON payment_allocations(payment_id);
CREATE INDEX payment_allocations_period_idx  ON payment_allocations(period_id) WHERE period_id IS NOT NULL;

-- A deposit is money we hold, so how much of it actually arrived matters
-- (RNT-05 acceptance: deposits on the balance equal deposits of live rentals).
ALTER TABLE deposits ADD COLUMN paid_tetri integer NOT NULL DEFAULT 0 CHECK (paid_tetri >= 0);
