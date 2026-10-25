-- EV8 Ops — migration 0070: a card payment the bank listed twice is set aside
-- as a duplicate (ADR-0021, addendum of 25.10.2026).
--
-- The director's issue #16 of 25.10.2026, begun by Mika the same day
-- («начинай 15 и 16»): the later listing of a Bank of Georgia card payment
-- that reached «Разобрать» twice is set aside by «Это дубль», with the line it
-- repeats as its reason (`twin:<day>:<document>`). «Вернуть в очередь» clears
-- it like any line set aside.
--
-- Only an addition: nothing that is stored changes its meaning.

ALTER TABLE statement_lines DROP CONSTRAINT IF EXISTS statement_lines_resolution_check;
ALTER TABLE statement_lines ADD CONSTRAINT statement_lines_resolution_check
  CHECK (resolution IN ('not_ours', 'company_expense', 'bank_deposit', 'legacy', 'own_transfer', 'shareholder', 'founder_equity', 'other_income', 'duplicate'));
