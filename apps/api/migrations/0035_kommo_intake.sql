-- EV8 Ops — migration 0035: a deal Kommo has won comes in as a customer and
-- a task (Mika, 08.10.2026; ADR-0015).
--
-- Until now the link kept one list — the deals standing in the rental
-- pipeline's "rented" stage — and compared it with the rentals here. Now a
-- deal that reaches that stage, or is closed as won in the sales pipeline,
-- also brings its contact: the card is made here from the contact's name and
-- phone (or the deal is tied to the card that already has that phone), and
-- "Today" asks for the hand-over or the sale to be entered. Nothing of the
-- rental or the sale itself is taken from Kommo: it does not hold the moped,
-- the dates or the money. Nothing is written to Kommo (ADR-0014).
--
-- So the list learns which pipeline a deal is of, the contact's phone, when a
-- won deal was closed, and the card it was tied to. The poll remembers when
-- this stand began taking deals in: a sale closed before that is history,
-- not a task.

ALTER TABLE kommo_leads ADD COLUMN kind text NOT NULL DEFAULT 'rent' CHECK (kind IN ('rent', 'sale'));
ALTER TABLE kommo_leads ADD COLUMN contact_phone text;
ALTER TABLE kommo_leads ADD COLUMN closed_at timestamptz;
ALTER TABLE kommo_leads ADD COLUMN customer_id uuid REFERENCES customers(id) ON DELETE SET NULL;
CREATE INDEX kommo_leads_customer_idx ON kommo_leads (customer_id);

ALTER TABLE kommo_sync ADD COLUMN intake_from timestamptz;
