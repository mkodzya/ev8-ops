-- EV8 Ops — migration 0075: rent reminders go out through Kommo (ADR-0053).
--
-- Step 2 of the director's issue #20 (Mika, 01.11.2026: «ок» to the narrow
-- exception from ADR-0014 p.1): before a reminder goes, EV8 Ops writes the
-- sum into the deal's «Amount due» field, reads it back, and starts the
-- Kommo bot that sends the template. How far a stand sends — off, test deals
-- only, everyone — is the stand's own (REMINDERS_SEND in its env file), so a
-- copy of production's data on the test stand never sends to a customer.
--
-- Only additions.

-- `sending`: handed to Kommo, the answer not yet written. A row left in it
-- means the run stopped half-way: nobody can say whether that one went.
ALTER TABLE rent_reminders DROP CONSTRAINT IF EXISTS rent_reminders_mode_check;
ALTER TABLE rent_reminders
  ADD CONSTRAINT rent_reminders_mode_check CHECK (mode IN ('dry_run', 'sending', 'sent', 'failed')),
  -- The deal it went to, and when Kommo took it.
  ADD COLUMN lead_id text CHECK (lead_id ~ '^[0-9]+$'),
  ADD COLUMN sent_at timestamptz,
  ADD CONSTRAINT rent_reminders_sent_shape CHECK ((mode = 'sent') = (sent_at IS NOT NULL)),
  ADD CONSTRAINT rent_reminders_failed_shape CHECK ((mode = 'failed') = (failure IS NOT NULL));

-- One row: the owner's side of sending. The bots are Kommo's numbers, one a
-- template and a language; the test deals are where a stand in `test` sends.
-- `paused` stops every stand at once from the screen, without the server.
CREATE TABLE reminder_settings (
  id          boolean PRIMARY KEY DEFAULT true CHECK (id),
  paused      boolean NOT NULL DEFAULT false,
  bots        jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(bots) = 'object'),
  test_leads  text[] NOT NULL DEFAULT '{}',
  updated_by  uuid REFERENCES users(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO reminder_settings (id) VALUES (true) ON CONFLICT DO NOTHING;
