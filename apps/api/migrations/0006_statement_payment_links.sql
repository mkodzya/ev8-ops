-- A payment and the statement line it came from point at each other, and
-- neither foreign key said what to do when the other side goes. So neither
-- could be removed at all: deleting the payment was blocked by the line, and
-- deleting the line was blocked by the payment.
--
-- In the product that never came up, because nothing here is deleted — a
-- payment is voided, a line is ignored. It came up in the test teardown,
-- which silently failed and left every run's rows behind; the suites then
-- started matching a payer name against a customer an earlier run had left,
-- found two of them, and stopped matching. A test that fails because of
-- yesterday's data is worse than no test.
--
-- The link is a cross-reference, not ownership: when one side goes the other
-- keeps its meaning, so both drop to NULL.

ALTER TABLE statement_lines DROP CONSTRAINT statement_lines_payment_id_fkey;
ALTER TABLE statement_lines
  ADD CONSTRAINT statement_lines_payment_id_fkey
  FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE SET NULL;

ALTER TABLE payments DROP CONSTRAINT payments_statement_line_id_fkey;
ALTER TABLE payments
  ADD CONSTRAINT payments_statement_line_id_fkey
  FOREIGN KEY (statement_line_id) REFERENCES statement_lines(id) ON DELETE SET NULL;
