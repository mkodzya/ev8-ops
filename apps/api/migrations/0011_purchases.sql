-- Buying mopeds and parts (PUR-01, PUR-02, PUR-03).
--
-- An order is an invoice from a factory or a marketplace: lines in the
-- seller's own currency, paid in another, landed in a third. Nothing here
-- stores a rate, because a rate is not a fact — the payments are. What a
-- unit cost is worked out from what actually left the bank (see
-- packages/shared/src/purchases.ts), and it is written onto the VIN when
-- the shipment arrives, so the moped carries its own cost for the rest of
-- its life (DSH-03).

CREATE TYPE purchase_status AS ENUM ('ordered', 'received', 'cancelled');

CREATE SEQUENCE purchase_number_seq;

-- A supplier is a party like any other: Kachara sold the company a moped
-- and bought one back, and Odoo held both roles on one contact.
ALTER TABLE customers ADD COLUMN is_supplier boolean NOT NULL DEFAULT false;

CREATE TABLE purchases (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number          text NOT NULL UNIQUE DEFAULT 'PO-' || lpad(nextval('purchase_number_seq')::text, 5, '0'),
  supplier_id     uuid NOT NULL REFERENCES customers(id),
  invoice_no      text,
  invoice_date    date,
  currency        text NOT NULL DEFAULT 'CNY' CHECK (currency ~ '^[A-Z]{3}$'),
  ordered_on      date NOT NULL,
  received_on     date,
  status          purchase_status NOT NULL DEFAULT 'ordered',
  -- What the shipment cost to bring in and clear, in GEL, with the refunded
  -- import VAT already taken out. Split evenly over the units on arrival.
  extras_tetri    integer NOT NULL DEFAULT 0 CHECK (extras_tetri >= 0),
  extras_note     text,
  notes           text,
  odoo_order_id   integer UNIQUE,
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchases_received_shape CHECK ((status = 'received') = (received_on IS NOT NULL))
);
CREATE INDEX purchases_supplier_idx ON purchases(supplier_id);

CREATE TABLE purchase_lines (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id      uuid NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  model_id         uuid REFERENCES vehicle_models(id),
  part_name        text,
  qty              integer NOT NULL CHECK (qty > 0),
  -- The seller's price for one, in the invoice currency's minor unit.
  unit_price_minor integer NOT NULL CHECK (unit_price_minor >= 0),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_line_shape CHECK (
    (model_id IS NOT NULL AND part_name IS NULL) OR
    (model_id IS NULL AND part_name IS NOT NULL)
  )
);
CREATE INDEX purchase_lines_purchase_idx ON purchase_lines(purchase_id);

ALTER TABLE payments ADD COLUMN purchase_id uuid REFERENCES purchases(id);
CREATE INDEX payments_purchase_idx ON payments(purchase_id) WHERE purchase_id IS NOT NULL;

-- What this particular moped cost to land, and which shipment it came in.
ALTER TABLE vehicles ADD COLUMN cost_tetri integer CHECK (cost_tetri IS NULL OR cost_tetri >= 0);
ALTER TABLE vehicles ADD COLUMN purchase_id uuid REFERENCES purchases(id);
CREATE INDEX vehicles_purchase_idx ON vehicles(purchase_id) WHERE purchase_id IS NOT NULL;
