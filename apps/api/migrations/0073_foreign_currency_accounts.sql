-- EV8 Ops — migration 0073: a statement and its lines say their currency, and
-- a line in another currency is parked outside the lari.
--
-- The company has opened an account in dollars at Bank of Georgia and one at
-- TBC (Mika, 29.10.2026), to be read by the banks' APIs next to the accounts
-- in lari. Mika's decision D1 «А» the same day (docs/spec/usd-accounts-plan.md):
-- their operations are read, kept and shown apart, not sorted, and outside
-- every sum in lari. Until now every amount was lari by assumption.
--
--   * statements.currency, statement_lines.currency — GEL for everything
--     stored so far. Which currencies an account may be in is the code's to
--     say (GEL, USD, EUR); the database only keeps it a currency code.
--   * A line's amount_tetri, gross_tetri and fee_tetri are in the minor units
--     of its currency: tetri for GEL, cents for USD and EUR.
--   * statement_lines.bank_gel_tetri — what Bank of Georgia itself says a line
--     in another currency is in lari. For reference only, never summed: it is
--     kept so that a later decision about the rate needs nothing read from the
--     bank again. TBC gives none.
--   * resolution 'foreign', and statement_lines_foreign_parked: a line not in
--     GEL is set aside as 'foreign' from the moment it is written, and stays
--     so — the queue, the answers and the reports in lari never meet it. A
--     line in GEL is never 'foreign'.
--   * bank_api_accounts — one row an account and currency the API reads: when
--     it last answered and why it failed, and how far its nightly reading
--     has come, so that a pair the bank refuses is seen on its own. The rows
--     of bog_sync and tbc_sync stay what the lari account's cards and «Сегодня»
--     read. A reason is a word of ours, never the bank's answer.
--
-- No guard that stops the migration: migrate.mjs runs when the api container
-- starts, and a migration that fails would keep the API down on production.
-- A Bank of Georgia file of an account in another currency, uploaded before
-- such files were refused, would be read here as lari; that there is none is
-- checked by reading production before the release, not here.
--
-- Written so that a second run changes nothing, and so that it passes on any
-- data: whatever is stored is in GEL, and nothing is 'foreign' yet.

ALTER TABLE statements ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'GEL'
  CONSTRAINT statements_currency_check CHECK (currency ~ '^[A-Z]{3}$');

ALTER TABLE statement_lines ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'GEL'
  CONSTRAINT statement_lines_currency_check CHECK (currency ~ '^[A-Z]{3}$');
ALTER TABLE statement_lines ADD COLUMN IF NOT EXISTS bank_gel_tetri integer;

COMMENT ON COLUMN statement_lines.currency IS 'GEL, or the currency of the account the line is of (0073). A line not in GEL is parked: status ignored, resolution foreign.';
COMMENT ON COLUMN statement_lines.amount_tetri IS 'In minor units of the line''s currency: tetri for GEL, cents for USD and EUR (0073). The same for gross_tetri and fee_tetri.';
COMMENT ON COLUMN statement_lines.bank_gel_tetri IS 'What Bank of Georgia says a line in another currency is in lari (0073): for reference, never summed. Null at TBC.';

ALTER TABLE statement_lines DROP CONSTRAINT IF EXISTS statement_lines_resolution_check;
ALTER TABLE statement_lines ADD CONSTRAINT statement_lines_resolution_check
  CHECK (resolution IN ('not_ours', 'company_expense', 'bank_deposit', 'legacy', 'own_transfer', 'shareholder', 'founder_equity', 'other_income', 'duplicate', 'foreign'));

ALTER TABLE statement_lines DROP CONSTRAINT IF EXISTS statement_lines_foreign_parked;
ALTER TABLE statement_lines ADD CONSTRAINT statement_lines_foreign_parked
  CHECK (
    (currency = 'GEL' AND resolution IS DISTINCT FROM 'foreign')
    OR (currency <> 'GEL' AND status = 'ignored' AND resolution = 'foreign')
  );

-- The list of operations in another currency on «Деньги → Выписки».
CREATE INDEX IF NOT EXISTS statement_lines_foreign_idx ON statement_lines (occurred_on) WHERE currency <> 'GEL';

CREATE TABLE IF NOT EXISTS bank_api_accounts (
  bank               bank_name NOT NULL,
  -- The bare IBAN, as statements.account of a day read by the API has it: the currency is its own column.
  account            text NOT NULL CHECK (account ~ '^GE[0-9]{2}[A-Z]{2}[0-9]{16}$'),
  currency           text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  -- The first day the stand reads this pair from: a new pair reads back once,
  -- up to a month. Empty for an account in lari read since before this table.
  read_from          date,
  last_ok_at         timestamptz,
  last_try_at        timestamptz,
  last_failure       text,
  last_http_status   integer,
  -- Operations the bank listed for today at the last answer.
  today_count        integer NOT NULL DEFAULT 0,
  -- The last day the nightly reading covered (and, at TBC, found adding up), and when it ran.
  night_through      date,
  night_at           timestamptz,
  night_failure      text,
  night_http_status  integer,
  -- TBC: the first day whose movements did not add up to the bank's sums at the last reading.
  night_mismatch_on  date,
  -- Lines the last nightly reading added: the day's pull had missed them.
  night_added        integer NOT NULL DEFAULT 0,
  PRIMARY KEY (bank, account, currency)
);
