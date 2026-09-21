-- EV8 Ops — migration 0024: a sale has a paper too (wave 5 §3.1).
--
-- Until now every PDF belonged to a rental. A sale has one as well — the
-- schedule the buyer signs, and the invoice when there is no schedule — so
-- the file points at the sale instead, and the rule about what a file may
-- belong to is widened by exactly that one case.

ALTER TABLE files ADD COLUMN sale_id uuid REFERENCES sales(id) ON DELETE CASCADE;
CREATE INDEX files_sale_idx ON files(sale_id) WHERE sale_id IS NOT NULL;

ALTER TABLE files DROP CONSTRAINT files_owner;
ALTER TABLE files ADD CONSTRAINT files_owner CHECK (
  (kind = 'act_photo'         AND act_id IS NOT NULL AND customer_id IS NULL) OR
  (kind = 'customer_document' AND customer_id IS NOT NULL AND act_id IS NULL) OR
  (kind = 'service_photo'     AND service_job_id IS NOT NULL) OR
  (kind = 'pdf'               AND doc_kind IS NOT NULL AND (rental_id IS NOT NULL OR sale_id IS NOT NULL))
);
