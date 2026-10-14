-- EV8 Ops — migration 0039: one bank line can pay several records.
--
-- A customer sends one transfer for a rental week and a repair together
-- (meeting of Mika and Kardu, 14.10.2026: 350 GEL = rent 150 + repair 200).
-- Until now a line made exactly one payment, so half of it was always on the
-- wrong record. From here a line may be split into parts, each its own
-- payment; the parts are numbered, and the line's live payments must have
-- different numbers. A line attached whole is part 1, as every line so far.
--
-- The unique index stays the second lock behind claiming the line (B2-02):
-- two hands attaching the same line whole both write part 1, and one fails.

ALTER TABLE payments ADD COLUMN statement_part smallint NOT NULL DEFAULT 1 CHECK (statement_part BETWEEN 1 AND 9);

DROP INDEX payments_statement_line_live;
CREATE UNIQUE INDEX payments_statement_line_live
  ON payments(statement_line_id, statement_part)
  WHERE statement_line_id IS NOT NULL AND voided_at IS NULL;
