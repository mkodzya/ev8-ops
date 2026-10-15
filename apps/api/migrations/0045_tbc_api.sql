-- EV8 Ops — migration 0045: TBC lines read by its API (B11-03, ADR-0026).
--
-- The same as Bank of Georgia (0041, ADR-0021): every five minutes the stand
-- asks TBC's Business Integration Services for the day's movements, and once
-- a night it reads yesterday whole and checks it against the bank's own sums.
-- The lines go into the queue a CSV upload feeds, under one statement per
-- account and day (`statements.source = 'api'`, as 0041 made it).
--
--   * tbc_sync — one row, as bog_sync: when the bank last answered, when it
--     was last asked and why that failed, which day the nightly reading has
--     reached, and the first day whose movements did not add up to the
--     bank's sums. A reason is a word of ours, never the bank's answer.
--
-- Written so that a second run changes nothing.

CREATE TABLE IF NOT EXISTS tbc_sync (
  id                 boolean PRIMARY KEY DEFAULT true CHECK (id),
  last_ok_at         timestamptz,
  last_try_at        timestamptz,
  last_failure       text,
  last_http_status   integer,
  -- Movements the bank listed for today at the last answer.
  today_count        integer NOT NULL DEFAULT 0,
  -- The last day the nightly reading covered and found adding up, and when it ran.
  night_through      date,
  night_at           timestamptz,
  night_failure      text,
  night_http_status  integer,
  -- The first day whose movements did not add up to the bank's sums at the last reading.
  night_mismatch_on  date,
  -- Lines the last nightly reading added: the day's pull had missed them.
  night_added        integer NOT NULL DEFAULT 0
);
INSERT INTO tbc_sync (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
