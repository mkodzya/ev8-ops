-- Files: photos on hand-over and return acts (spec §9.2, RNT-04), customer
-- documents (CST-03), later PDFs. Bytes live in Postgres, as in Self
-- Platform: at hundreds of photos a year this is small, and one pg_dump then
-- covers everything the company owns — no second store to back up.
--
-- Deletion does not exist here either: a file is archived, its bytes stay.

CREATE TYPE file_kind AS ENUM ('act_photo', 'customer_document', 'pdf');

CREATE TABLE files (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        file_kind NOT NULL,
  act_id      uuid REFERENCES acts(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES customers(id) ON DELETE CASCADE,
  label       text NOT NULL DEFAULT '',        -- original file name, or "ID card" / "driver licence"
  doc_kind    text,                            -- customer documents: id_card, driver_licence, other
  mime_type   text NOT NULL,
  size_bytes  integer NOT NULL CHECK (size_bytes > 0),
  sha256      text NOT NULL,
  bytes       bytea NOT NULL,
  uploaded_by uuid REFERENCES users(id),
  archived    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT files_owner CHECK (
    (kind = 'act_photo'         AND act_id IS NOT NULL AND customer_id IS NULL) OR
    (kind = 'customer_document' AND customer_id IS NOT NULL AND act_id IS NULL) OR
    (kind = 'pdf')
  )
);
CREATE INDEX files_act_idx ON files(act_id) WHERE act_id IS NOT NULL;
CREATE INDEX files_customer_idx ON files(customer_id) WHERE customer_id IS NOT NULL;

-- Photos were a JSON list of URLs on the act before there was anywhere to
-- put a photo. Nothing wrote to it.
ALTER TABLE acts DROP COLUMN photos;
