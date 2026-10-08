-- EV8 Ops — migration 0032: the Kommo link, step 1 (Mika, 07.10.2026).
--
-- Kommo is where the day's work is written (handoff §2а), so EV8 Ops reads
-- it and says where the two disagree. It reads by asking every few minutes:
-- the account's plan has no webhooks (ADR-0012). Two tables hold what that
-- asking brought back.
--
--   * kommo_leads — the deals standing in the rental pipeline's "rented"
--     stage at the last poll that worked. A poll that fails changes nothing
--     here: yesterday's list with its time on it is worth more than an empty
--     one that looks like "nobody rents".
--   * kommo_sync  — one row: when Kommo last answered, when it was last
--     asked, and why the last asking failed. A reason is a word of ours
--     (`unauthorized`, `network`), never Kommo's answer: answers carry names.
--
-- A lead id is kept as text. It is somebody else's identifier, nothing is
-- ever computed from it, and it is compared with what a person pasted into
-- the Kommo field of a customer or a rental.

CREATE TABLE kommo_leads (
  lead_id       text PRIMARY KEY,
  name          text NOT NULL,
  contact_name  text,
  status_id     bigint NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  seen_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE kommo_sync (
  -- One row, as `rental_settings` does it.
  id               boolean PRIMARY KEY DEFAULT true CHECK (id),
  last_ok_at       timestamptz,
  last_try_at      timestamptz,
  last_failure     text,
  last_http_status integer,
  leads            integer NOT NULL DEFAULT 0
);
INSERT INTO kommo_sync (id) VALUES (true);
