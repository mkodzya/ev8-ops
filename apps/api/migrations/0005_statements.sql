-- Bank statements (PAY-01, PAY-03).
--
-- A line is kept exactly as it arrived, in `raw`, so the parse can be redone
-- when a rule turns out to be wrong — which it will, because the matching
-- rules are the part of this system most likely to be corrected.
--
-- Uploading the same file twice, or two files whose periods overlap, must
-- not create the payment twice (PAY-01 acceptance). Each line therefore
-- carries a natural key: TBC's own transaction id, and for BOG a hash of the
-- row plus how many identical rows came before it in the file.

CREATE TYPE bank_name AS ENUM ('bog', 'tbc', 'credo');
CREATE TYPE statement_line_status AS ENUM ('unmatched', 'matched', 'ignored');

CREATE TABLE statements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank        bank_name NOT NULL,
  file_name   text NOT NULL,
  file_sha256 text NOT NULL,
  account     text,
  period_from date,
  period_to   date,
  line_count  integer NOT NULL DEFAULT 0,
  new_lines   integer NOT NULL DEFAULT 0,
  matched     integer NOT NULL DEFAULT 0,
  uploaded_by uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE statement_lines (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  statement_id uuid NOT NULL REFERENCES statements(id) ON DELETE CASCADE,
  bank         bank_name NOT NULL,
  natural_key  text NOT NULL,
  occurred_on  date NOT NULL,
  direction    payment_direction NOT NULL,
  amount_tetri integer NOT NULL CHECK (amount_tetri > 0),
  gross_tetri  integer,      -- a card line: what the customer paid, when stated
  fee_tetri    integer,      -- a card line: what the acquirer kept
  payer        text,
  purpose      text,
  raw          text NOT NULL,
  status       statement_line_status NOT NULL DEFAULT 'unmatched',
  matched_rule text,
  payment_id   uuid REFERENCES payments(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bank, natural_key)
);
CREATE INDEX statement_lines_statement_idx ON statement_lines(statement_id);
CREATE INDEX statement_lines_status_idx ON statement_lines(status) WHERE status = 'unmatched';

ALTER TABLE payments ADD COLUMN statement_line_id uuid REFERENCES statement_lines(id);
