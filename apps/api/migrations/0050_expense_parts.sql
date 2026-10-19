-- EV8 Ops — migration 0050: one outgoing line, several expenses.
--
-- A single payment out of the account can pay for several things at once —
-- two taxes in one transfer to the treasury, say — and until now a line had
-- one category (Mika, 19.10.2026: «нужно добавить возможность разделить
-- платеж расходный на части»; ADR-0030). A line answered as a company expense
-- may now be split into two to nine parts, each with its category and sum;
-- together the parts are the whole line. A line answered whole keeps its one
-- category on the line, as before.

CREATE TABLE statement_line_expense_parts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_id       uuid NOT NULL REFERENCES statement_lines(id) ON DELETE CASCADE,
  seq           smallint NOT NULL CHECK (seq BETWEEN 1 AND 9),
  amount_tetri  integer NOT NULL CHECK (amount_tetri > 0),
  category_id   uuid NOT NULL REFERENCES expense_categories(id),
  UNIQUE (line_id, seq)
);
CREATE INDEX statement_line_expense_parts_category ON statement_line_expense_parts(category_id);
