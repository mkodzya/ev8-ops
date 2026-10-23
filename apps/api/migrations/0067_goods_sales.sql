-- EV8 Ops — migration 0067: goods sold over the counter (issue #11, ADR-0045;
-- Mika 23.10.2026 «А»). Parts off the shelf and chargers from the count are
-- sold to a customer or to a retail buyer with no card; the shelf and the
-- count go down by themselves; the price is final with VAT inside (an
-- exception to «VAT on top», which stays for rent). A goods sale's money is a
-- payment of its own kind tied to the sale the way a repair's is — no
-- allocation: what is open is the lines' total less its live payments.
--
-- The enum value is only added here; nothing in this file uses it (the file
-- runs in one transaction). The pairing kind = 'goods' ⇔ goods_sale_id is the
-- code's to keep, as 0066 keeps 'offset'; a cancelled own customer's payment
-- keeps goods_sale_id after it became his credit (on_account).

ALTER TYPE payment_kind ADD VALUE IF NOT EXISTS 'goods';

CREATE SEQUENCE IF NOT EXISTS goods_sale_number_seq;

CREATE TABLE IF NOT EXISTS goods_sales (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number           text NOT NULL UNIQUE DEFAULT ('TS-' || lpad(nextval('goods_sale_number_seq')::text, 5, '0')),
  sold_on          date NOT NULL,
  -- NULL: a retail buyer with no card; a name and a phone may be said.
  customer_id      uuid REFERENCES customers(id),
  buyer_name       text,
  buyer_phone      text,
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  -- What was not paid at the counter comes from the bank (ADR-0045 §6).
  promised_channel text CHECK (promised_channel IN ('acquiring', 'transfer')),
  backdate_reason  text,
  notes            text,
  created_by       uuid REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  cancelled_at     timestamptz,
  cancelled_by     uuid REFERENCES users(id),
  cancel_reason    text,
  CONSTRAINT goods_sales_buyer_ck CHECK (customer_id IS NULL OR (buyer_name IS NULL AND buyer_phone IS NULL)),
  CONSTRAINT goods_sales_cancel_ck CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL AND btrim(coalesce(cancel_reason, '')) <> ''))
);
CREATE INDEX IF NOT EXISTS goods_sales_customer_idx ON goods_sales(customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS goods_sales_sold_idx ON goods_sales(sold_on DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS goods_sale_lines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id           uuid NOT NULL REFERENCES goods_sales(id) ON DELETE CASCADE,
  seq               smallint NOT NULL CHECK (seq BETWEEN 1 AND 20),
  part_id           uuid REFERENCES parts(id),
  counted_item      text CHECK (counted_item IN ('charger', 'battery')),
  -- As sold, for the invoice: the part's names that day, or «Зарядка 73V6A».
  name              text NOT NULL CHECK (btrim(name) <> ''),
  name_ka           text,
  -- A counted item's model as the seller typed it ("73V6A").
  spec              text,
  qty               integer NOT NULL CHECK (qty BETWEEN 1 AND 999),
  -- Final, VAT inside (ADR-0045).
  unit_price_tetri  integer NOT NULL CHECK (unit_price_tetri > 0),
  -- What the shelf offered; differs from the price — the price was edited (journal).
  shelf_price_tetri integer CHECK (shelf_price_tetri >= 0),
  -- One unit's cost that day: the shelf's average, the last paid receipt, the owner's figure; NULL — unknown.
  unit_cost_tetri   integer CHECK (unit_cost_tetri >= 0),
  -- 'shelf': this sale took it off; 'count': a stocktake already saw it gone.
  stock_from        text NOT NULL DEFAULT 'shelf' CHECK (stock_from IN ('shelf', 'count')),
  -- Sold beyond the count: the owner's words.
  short_reason      text,
  CONSTRAINT goods_sale_lines_seq UNIQUE (sale_id, seq),
  CONSTRAINT goods_sale_lines_one_item CHECK ((part_id IS NULL) <> (counted_item IS NULL)),
  CONSTRAINT goods_sale_lines_spec CHECK (spec IS NULL OR counted_item IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS goods_sale_lines_part_once ON goods_sale_lines(sale_id, part_id) WHERE part_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS goods_sale_lines_item_once ON goods_sale_lines(sale_id, counted_item, lower(coalesce(spec, ''))) WHERE counted_item IS NOT NULL;
CREATE INDEX IF NOT EXISTS goods_sale_lines_part_idx ON goods_sale_lines(part_id) WHERE part_id IS NOT NULL;

ALTER TABLE payments ADD COLUMN IF NOT EXISTS goods_sale_id uuid REFERENCES goods_sales(id);
CREATE INDEX IF NOT EXISTS payments_goods_sale_idx ON payments(goods_sale_id) WHERE goods_sale_id IS NOT NULL;

-- The shelf: an issue at the sale, a return at its cancellation — one of each per line.
ALTER TABLE stock_moves ADD COLUMN IF NOT EXISTS goods_sale_line_id uuid REFERENCES goods_sale_lines(id);
ALTER TABLE stock_moves DROP CONSTRAINT IF EXISTS stock_moves_goods_shape;
ALTER TABLE stock_moves ADD CONSTRAINT stock_moves_goods_shape
  CHECK (goods_sale_line_id IS NULL OR (kind IN ('issue', 'return') AND service_part_id IS NULL AND purchase_line_id IS NULL));
CREATE UNIQUE INDEX IF NOT EXISTS stock_moves_goods_line_unique ON stock_moves(goods_sale_line_id, kind) WHERE goods_sale_line_id IS NOT NULL;

-- The count: sold, back after a cancellation, and 'found' when an owner sells beyond the count.
ALTER TABLE battery_moves DROP CONSTRAINT IF EXISTS battery_moves_kind_check;
ALTER TABLE battery_moves ADD CONSTRAINT battery_moves_kind_check
  CHECK (kind IN ('to_repair', 'from_repair', 'lost', 'found', 'sold', 'sale_cancelled'));
ALTER TABLE battery_moves ADD COLUMN IF NOT EXISTS goods_sale_line_id uuid REFERENCES goods_sale_lines(id);
ALTER TABLE battery_moves DROP CONSTRAINT IF EXISTS battery_moves_goods_shape;
ALTER TABLE battery_moves ADD CONSTRAINT battery_moves_goods_shape
  CHECK (kind NOT IN ('sold', 'sale_cancelled') OR goods_sale_line_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS battery_moves_goods_line_unique ON battery_moves(goods_sale_line_id, kind) WHERE goods_sale_line_id IS NOT NULL;

-- The invoice, kept as issued (ADR-0003).
ALTER TABLE files ADD COLUMN IF NOT EXISTS goods_sale_id uuid REFERENCES goods_sales(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS files_goods_sale_idx ON files(goods_sale_id) WHERE goods_sale_id IS NOT NULL;
-- A PDF belongs to a rental, a sale — or now a goods sale (0024's rule, widened).
ALTER TABLE files DROP CONSTRAINT IF EXISTS files_owner;
ALTER TABLE files ADD CONSTRAINT files_owner CHECK (
  (kind = 'act_photo'         AND act_id IS NOT NULL AND customer_id IS NULL) OR
  (kind = 'customer_document' AND customer_id IS NOT NULL AND act_id IS NULL) OR
  (kind = 'service_photo'     AND service_job_id IS NOT NULL) OR
  (kind = 'pdf'               AND doc_kind IS NOT NULL AND (rental_id IS NOT NULL OR sale_id IS NOT NULL OR goods_sale_id IS NOT NULL))
);
