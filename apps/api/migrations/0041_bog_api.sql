-- EV8 Ops — migration 0041: Bank of Georgia lines read by its API (B11-03).
--
-- Mika, 14.10.2026 (book register, item 8): the stand asks Business Online
-- for the day's operations every five minutes and, once a night, reads the
-- full statement of the day before, so nothing is lost. The lines go into
-- the same queue a CSV upload feeds (ADR-0021).
--
--   * statements.source — 'file' for an upload, 'api' for a day the bank was
--     asked about. The API keeps one statement per account and day and adds
--     to it as the day goes on.
--   * statement_lines.doc_no — the bank's document number ("sabuTis #" in
--     the CSV, DocNo / EntryDocumentNumber in the API). It is how one
--     operation is known when it comes from two sources: the CSV keys a line
--     by a hash of its text, the API by the bank's own entry id, and those
--     two never meet. The lines already loaded from Bank of Georgia files get
--     it from their stored text, where it is the second field.
--   * bog_sync — one row: when the bank last answered, when it was last
--     asked and why that failed, and which day the nightly reading has
--     reached. A reason is a word of ours, never the bank's answer: answers
--     carry names and account numbers.
--
-- Written so that a second run changes nothing: the file was first numbered
-- 0040, and a laptop's test database may have had it under that name.

ALTER TABLE statements ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'file' CHECK (source IN ('file', 'api'));

ALTER TABLE statement_lines ADD COLUMN IF NOT EXISTS doc_no text;
UPDATE statement_lines SET doc_no = NULLIF(btrim(split_part(raw, ' | ', 2)), '') WHERE bank = 'bog' AND doc_no IS NULL;

CREATE INDEX IF NOT EXISTS statement_lines_bank_day ON statement_lines (bank, occurred_on);

CREATE TABLE IF NOT EXISTS bog_sync (
  -- One row, as `kommo_sync` does it.
  id                 boolean PRIMARY KEY DEFAULT true CHECK (id),
  last_ok_at         timestamptz,
  last_try_at        timestamptz,
  last_failure       text,
  last_http_status   integer,
  -- Operations the bank listed for today at the last answer.
  today_count        integer NOT NULL DEFAULT 0,
  -- The last day the nightly reading covered, and when it ran.
  night_through      date,
  night_at           timestamptz,
  night_failure      text,
  night_http_status  integer,
  -- Lines the last nightly reading added: the day's pull had missed them.
  night_added        integer NOT NULL DEFAULT 0
);
INSERT INTO bog_sync (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
