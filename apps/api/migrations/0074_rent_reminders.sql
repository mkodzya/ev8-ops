-- EV8 Ops — migration 0074: reminders of the rent, decided on a schedule (ADR-0052).
--
-- The director's issue #20 of 01.11.2026, Mika's «давай пошагово» the same
-- day: step 1 decides who is reminded, of what and when — the due day at
-- 12:00, the 1st and 2nd day overdue at 12:00 and 18:00, a Georgian Orthodox
-- holiday moving the chain a day — and writes it down without sending
-- (`mode = 'dry_run'`). Sending, by Kommo, is step 2.
--
-- Only additions.

-- The language a customer's messages go in. Russian has no template of its
-- own and goes in English (the director, 01.11.2026); the choice is kept as
-- said, the template's language is read from it.
ALTER TABLE customers
  ADD COLUMN message_lang text NOT NULL DEFAULT 'ka' CHECK (message_lang IN ('ka', 'ru', 'en'));

-- Reminders switched off for one rental, with the reason it must have (MSG-02).
ALTER TABLE rentals
  ADD COLUMN reminders_off_reason text,
  ADD COLUMN reminders_off_at     timestamptz,
  ADD COLUMN reminders_off_by     uuid REFERENCES users(id),
  ADD CONSTRAINT rentals_reminders_off_shape CHECK ((reminders_off_at IS NULL) = (reminders_off_reason IS NULL));

-- One reminder a rental, a day and a slot: the job may run twice, it writes once.
CREATE TABLE rent_reminders (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_id    uuid NOT NULL REFERENCES rentals(id) ON DELETE CASCADE,
  day          date NOT NULL,
  slot         text NOT NULL CHECK (slot IN ('12:00', '18:00')),
  template     text NOT NULL CHECK (template IN ('payment_due', 'overdue_1', 'overdue_2')),
  lang         text NOT NULL CHECK (lang IN ('ka', 'en')),
  amount_tetri integer NOT NULL CHECK (amount_tetri > 0),
  -- dry_run: decided and not sent (step 1); sent / failed: step 2.
  mode         text NOT NULL CHECK (mode IN ('dry_run', 'sent', 'failed')),
  failure      text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rental_id, day, slot)
);
CREATE INDEX rent_reminders_day_idx ON rent_reminders(day);
