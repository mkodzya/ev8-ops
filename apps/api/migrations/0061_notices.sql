-- EV8 Ops — migration 0061: the notices to the workshop's Telegram group
-- (stage 6 of docs/spec/mechanic-in-erp-plan.md; ADR-0038 §6–7, decided by
-- Mika on 21.10.2026).
--
-- The API tells one group of the workshop, through the owner's own bot, that
-- a repair waits for approval, was approved, refused or closed, that a moped
-- is due for its planned maintenance, and that a part fell below its minimum.
-- It only sends (ADR-0032 §2): nothing comes back from Telegram.
--
--   * **A notice is written in the same transaction as its event** and sent
--     right after it; one Telegram did not take is tried again by the worker.
--     A notice exists only if the change it tells of was committed.
--   * **Nothing about the event is copied here**: the text is written from
--     the record's id when it is sent, so a repair no longer waiting is not
--     announced as waiting. A row holds what was asked, when it went or why
--     it did not — a reason is a word of ours (`network`, `forbidden`), never
--     Telegram's answer.
--   * **`dedupe_key` is the second lock** after the operation keys: the same
--     closing told twice, the same maintenance mark or the same shortage
--     since the same restock, is one row.

CREATE TABLE notices (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind             text NOT NULL CHECK (kind IN ('job_waiting', 'job_approved', 'job_rejected', 'job_closed', 'maintenance_due', 'stock_low')),
  dedupe_key       text NOT NULL UNIQUE,
  -- The repair, the moped or the part the notice is about.
  entity_id        uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  next_try_at      timestamptz NOT NULL DEFAULT now(),
  attempts         integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  sent_at          timestamptz,
  -- Not sent and not to be: refused for good, out of date, or over a day old.
  gave_up_at       timestamptz,
  last_failure     text,
  last_http_status integer
);
-- What waits to go: the worker reads it every minute.
CREATE INDEX notices_waiting ON notices (next_try_at) WHERE sent_at IS NULL AND gave_up_at IS NULL;
