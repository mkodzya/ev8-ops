-- Selling a moped (SAL-01, SAL-02, SAL-03).
--
-- A sale is one VIN leaving the fleet for one customer on one day, at a
-- price that starts from the model's but is edited as often as not. Paying
-- for it may be one payment or a schedule: a deposit and N monthly
-- instalments, which is how the company sells today (0 % over four months,
-- longer through Credo).
--
-- Buying the moped back is not a separate kind of document: it is the same
-- sale, ended the other way round, with money going out and the VIN
-- returning to the fleet. That way the VIN's own history holds both events,
-- which is what the acceptance for SAL-03 asks to see.

CREATE TYPE sale_status AS ENUM ('active', 'cancelled', 'bought_back');

CREATE SEQUENCE sale_number_seq;

CREATE TABLE sales (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number         text NOT NULL UNIQUE DEFAULT 'SL-' || lpad(nextval('sale_number_seq')::text, 5, '0'),
  customer_id    uuid NOT NULL REFERENCES customers(id),
  vehicle_id     uuid REFERENCES vehicles(id),
  vin_note       text,                    -- what the papers say when the VIN is not ours
  sold_on        date NOT NULL,
  price_tetri    integer NOT NULL CHECK (price_tetri > 0),   -- VAT included, as the site quotes it
  extras         text,                    -- a second battery and the like
  warranty_until date,
  status         sale_status NOT NULL DEFAULT 'active',
  bought_back_on date,
  notes          text,
  odoo_order_id  integer UNIQUE,
  created_by     uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_vin_or_note CHECK (vehicle_id IS NOT NULL OR vin_note IS NOT NULL),
  CONSTRAINT sales_bought_back_shape CHECK ((status = 'bought_back') = (bought_back_on IS NOT NULL))
);
CREATE INDEX sales_customer_idx ON sales(customer_id);
CREATE INDEX sales_vehicle_idx ON sales(vehicle_id) WHERE vehicle_id IS NOT NULL;

-- The schedule (SAL-02). A sale paid in one go has a single instalment due
-- on the day of the sale, so "what is owed" is one question, not two.
CREATE TABLE sale_instalments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id      uuid NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  seq          integer NOT NULL CHECK (seq >= 1),
  due_on       date NOT NULL,
  amount_tetri integer NOT NULL CHECK (amount_tetri > 0),
  paid_tetri   integer NOT NULL DEFAULT 0 CHECK (paid_tetri >= 0),
  pay_status   period_pay_status NOT NULL DEFAULT 'unpaid',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sale_id, seq)
);
CREATE INDEX sale_instalments_due_idx ON sale_instalments(due_on) WHERE pay_status <> 'paid';

ALTER TYPE allocation_target ADD VALUE 'instalment';
ALTER TABLE payments ADD COLUMN sale_id uuid REFERENCES sales(id);
CREATE INDEX payments_sale_idx ON payments(sale_id) WHERE sale_id IS NOT NULL;
