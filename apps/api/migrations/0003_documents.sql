-- Everything the company's own contract and return act ask for, so a
-- generated PDF has no blank left to fill in by hand (RNT-08).
--
-- Read from the signed originals in Google Drive on 14.09.2026:
-- `ქირაობის ხელშეკრულება` (contract + annex 1, the hand-over act) and
-- `დაბრუნებისა და საბოლოო ანგარიშსწორების აქტი`. Nothing here is invented:
-- every column below is a field that template asks a human to fill.

-- The contract prints the renter's home address (clause 1).
ALTER TABLE customers ADD COLUMN address text;

-- Clause 5 and annex 1 item 4: the moped may only spend the night at one
-- stated address, and the fine for breaking that rule is in the contract.
ALTER TABLE rentals ADD COLUMN night_parking_address text;
-- Annex 1 item 1: how many batteries and chargers actually went with it.
ALTER TABLE rentals ADD COLUMN batteries integer CHECK (batteries IS NULL OR batteries >= 0);
ALTER TABLE rentals ADD COLUMN chargers  integer CHECK (chargers  IS NULL OR chargers  >= 0);

-- Return act item 4: each item comes back in order, damaged, or not at all.
-- Shape: {"moped":{"state":"ok"},"battery_1":{"state":"damaged","note":"…"}}
ALTER TABLE acts ADD COLUMN items jsonb;

-- Return act item 7: the grounds are checkboxes on the paper form, so they
-- are a list of codes here and the free text stays in withheld_reason.
ALTER TABLE deposits ADD COLUMN withheld_grounds text[] NOT NULL DEFAULT '{}';

-- A generated PDF belongs to its rental. The bytes are kept, not the recipe:
-- what the customer signed must still be readable after a tariff is edited.
ALTER TABLE files ADD COLUMN rental_id uuid REFERENCES rentals(id) ON DELETE CASCADE;
CREATE INDEX files_rental_idx ON files(rental_id) WHERE rental_id IS NOT NULL;

ALTER TABLE files DROP CONSTRAINT files_owner;
ALTER TABLE files ADD CONSTRAINT files_owner CHECK (
  (kind = 'act_photo'         AND act_id IS NOT NULL AND customer_id IS NULL) OR
  (kind = 'customer_document' AND customer_id IS NOT NULL AND act_id IS NULL) OR
  (kind = 'pdf'               AND rental_id IS NOT NULL AND doc_kind IS NOT NULL)
);
