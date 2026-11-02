-- EV8 Ops — migration 0076: a line in another currency is sorted in «Разобрать»,
-- and counts in lari at the sum it was sorted at.
--
-- Stage 5 of docs/spec/usd-accounts-plan.md (Mika, 02.11.2026: «Да, начинай»).
-- Until now a line of the account in dollars was parked from the moment it was
-- written (0073, decision D1). The director's ask of 01.11.2026: the dollar
-- lines go into «Разобрать», parts bought in China into the parts' cost in
-- lari, ad spend into the expenses — the whole cash flow seen. Mika's decision
-- D2 the same day: a sorted line counts in lari at the sum Bank of Georgia sent
-- for it (bank_gel_tetri, the National Bank of Georgia's official rate of its
-- day), which the owner may correct; D3 dropped, so there are no loan answers.
--
--   * statement_lines.gel_tetri — the sum in lari a line in another currency
--     was sorted at: what the reports in lari count for it. Empty for a line in
--     GEL (its amount_tetri is lari) and for a line not sorted, or sorted as
--     nobody's money (not ours, a duplicate).
--   * resolution 'fx_exchange' — «Обмен валюты»: one leg of a currency
--     exchange, neither spent nor earned. Either leg may be answered so, the
--     dollars or the lari.
--   * statement_lines_foreign_parked goes; in its place a line in GEL never
--     has gel_tetri and is never 'foreign', and a line in another currency
--     sorted as money has its sum in lari.
--   * The lines parked so far go back to the queue, as if never answered.
--
-- A line in GEL changes in nothing. Rolling the code back to 1.22.0 after this
-- migration is not clean: that code shows the dollar lines waiting in the queue
-- in lari, to a manager too.
--
-- Written so that a second run changes nothing, and so that it passes on any
-- data.

ALTER TABLE statement_lines ADD COLUMN IF NOT EXISTS gel_tetri integer CHECK (gel_tetri > 0);
COMMENT ON COLUMN statement_lines.gel_tetri IS 'A line in another currency, sorted as money: the sum in lari it counts at in the reports (0076) — the bank''s lari or the owner''s correction. Null for a line in GEL and for one not sorted.';
COMMENT ON COLUMN statement_lines.currency IS 'GEL, or the currency of the account the line is of (0073). A line not in GEL is sorted by an owner and counts in lari at gel_tetri (0076).';

ALTER TABLE statement_lines DROP CONSTRAINT IF EXISTS statement_lines_resolution_check;
ALTER TABLE statement_lines ADD CONSTRAINT statement_lines_resolution_check
  CHECK (resolution IN ('not_ours', 'company_expense', 'bank_deposit', 'legacy', 'own_transfer', 'shareholder', 'founder_equity', 'other_income', 'duplicate', 'foreign', 'fx_exchange'));

ALTER TABLE statement_lines DROP CONSTRAINT IF EXISTS statement_lines_foreign_parked;

-- Back to the queue: nobody answered them, so nothing else is undone.
UPDATE statement_lines
   SET status = 'unmatched', matched_rule = NULL, resolution = NULL, resolution_reason = NULL, resolved_by = NULL, resolved_at = NULL
 WHERE currency <> 'GEL' AND resolution = 'foreign';

ALTER TABLE statement_lines DROP CONSTRAINT IF EXISTS statement_lines_foreign_in_lari;
ALTER TABLE statement_lines ADD CONSTRAINT statement_lines_foreign_in_lari
  CHECK (
    (currency = 'GEL' AND gel_tetri IS NULL AND resolution IS DISTINCT FROM 'foreign')
    OR (
      currency <> 'GEL'
      -- coalesce: an attached line has no resolution, and a NULL here would let the check pass.
      AND (
        status = 'unmatched'
        OR coalesce(resolution, '') IN ('not_ours', 'duplicate', 'foreign')
        OR gel_tetri IS NOT NULL
      )
    )
  );
