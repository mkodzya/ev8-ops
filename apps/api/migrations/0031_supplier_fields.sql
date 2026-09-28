-- EV8 Ops — migration 0031: a supplier's card in fields (Mika, 28.09.2026).
--
-- The card had three fields: a country kept in `address`, a phone, and one
-- free text kept in `notes`. What Odoo knows about a factory arrived as one
-- paragraph there, and Mika found it "too much information in one towel".
-- Option 2 of docs/redesign/prototypes/suppliers-options.html: each thing
-- its own line.
--
--   * country          — where the factory is; no longer borrowed `address`
--   * contact_person   — who answers
--   * channel          — where we agree: Alibaba, WeChat, e-mail
--   * goods            — what they supply
--   * bank             — where the money goes
--   * address          — the street again, as for everybody else
--   * notes            — what is left over, shown folded
--
-- The columns live on `customers`, where a supplier already is (B3-06); a
-- client simply leaves them empty.

ALTER TABLE customers
  ADD COLUMN country        text,
  ADD COLUMN contact_person text,
  ADD COLUMN channel        text,
  ADD COLUMN goods          text,
  ADD COLUMN bank           text;

-- A supplier made in the product kept its country in `address` by design:
-- it moves to where it now belongs.
UPDATE customers
   SET country = address, address = NULL
 WHERE record_kind = 'supplier' AND odoo_partner_id IS NULL AND address IS NOT NULL;

-- A supplier carried over from Odoo that nobody has corrected since is
-- emptied of the old one-text shape, so the next run of the transfer
-- (tools/migrate_stage1.py --only suppliers) lays it out in the new fields.
-- One a person has corrected — the journal says so — is left as it is:
-- its country moves over like any other, and its text stays in the notes.
UPDATE customers c
   SET country = NULL, address = NULL, notes = NULL
 WHERE c.record_kind = 'supplier' AND c.odoo_partner_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.entity_id = c.id::text AND a.action = 'supplier.update');
UPDATE customers c
   SET country = address, address = NULL
 WHERE c.record_kind = 'supplier' AND c.odoo_partner_id IS NOT NULL AND c.country IS NULL AND c.address IS NOT NULL;
