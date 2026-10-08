-- EV8 Ops — migration 0033: the Kommo link, step 2 (Mika, 08.10.2026).
--
-- From the day the business runs here, a rental payment is taken in EV8 Ops
-- and nobody types it into Kommo a second time: EV8 Ops writes the note into
-- the deal itself (ADR-0013). This table is the list of what it owes Kommo
-- and what Kommo has taken.
--
--   * One row per payment and kind: a note for the payment, and — if that
--     payment is voided after its note left — a note saying so. The pair
--     (kind, payment) is unique, so a payment never gets two notes of a kind
--     however often the list is walked.
--   * `state` says where the row stands: `pending` — to be sent, and sent
--     again until Kommo takes it; `sent`; `skipped` — never to be sent (the
--     rental names no deal, or this stand writes to test deals only);
--     `refused` — Kommo said no to this one note; `cancelled` — the payment
--     was voided before its note left.
--   * `reason` is one of our own words (`no_deal`, `unauthorized`), never
--     Kommo's answer.
--
-- `kommo_sync.notes_from` is the moment writing last came on on this stand,
-- and `notes_mode` is what the stand's switch said at the last knock — `off`,
-- `on`, or `only:` and its deals. When the switch changes, writing starts
-- from that moment. So a payment made while the stand was not writing is
-- never written to Kommo, however the switch is turned afterwards: what was
-- entered while trying the system out stays here, and so does what the staff
-- still typed into Kommo by hand.

CREATE TABLE kommo_notes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text NOT NULL CHECK (kind IN ('payment', 'payment_void')),
  payment_id    uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  rental_id     uuid REFERENCES rentals(id) ON DELETE SET NULL,
  lead_id       text,
  body          text,
  state         text NOT NULL CHECK (state IN ('pending', 'sent', 'skipped', 'refused', 'cancelled')),
  reason        text,
  http_status   integer,
  attempts      integer NOT NULL DEFAULT 0,
  kommo_note_id text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  sent_at       timestamptz,
  UNIQUE (kind, payment_id)
);
-- The walk asks for what is still to be sent, oldest first.
CREATE INDEX kommo_notes_state_idx ON kommo_notes (state, created_at);

ALTER TABLE kommo_sync ADD COLUMN notes_from timestamptz;
ALTER TABLE kommo_sync ADD COLUMN notes_mode text;
