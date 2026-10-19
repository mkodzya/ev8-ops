-- EV8 Ops — migration 0047: money taken out by a shareholder is its own answer.
--
-- A shareholder taking money out of the company is not an expense: written as
-- one, it would make the company look as if it had spent more than it did
-- (Mika, 19.10.2026, variant A; ADR-0029). An outgoing line gets the answer
-- «Акционеру», counted in the expenses report apart from the expenses, beside
-- money between the company's own accounts.

ALTER TABLE statement_lines DROP CONSTRAINT IF EXISTS statement_lines_resolution_check;
ALTER TABLE statement_lines ADD CONSTRAINT statement_lines_resolution_check
  CHECK (resolution IN ('not_ours', 'company_expense', 'bank_deposit', 'legacy', 'own_transfer', 'shareholder'));
