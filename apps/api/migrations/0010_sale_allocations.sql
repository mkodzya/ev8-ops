-- Postgres will not let the enum value added in 0009 be used in the same
-- transaction that added it, so the column and its check live here.
ALTER TABLE payment_allocations ADD COLUMN instalment_id uuid REFERENCES sale_instalments(id) ON DELETE CASCADE;

ALTER TABLE payment_allocations DROP CONSTRAINT allocation_shape;
ALTER TABLE payment_allocations ADD CONSTRAINT allocation_shape CHECK (
  (target = 'period'     AND period_id     IS NOT NULL AND deposit_id IS NULL AND instalment_id IS NULL) OR
  (target = 'deposit'    AND deposit_id    IS NOT NULL AND period_id  IS NULL AND instalment_id IS NULL) OR
  (target = 'instalment' AND instalment_id IS NOT NULL AND period_id  IS NULL AND deposit_id    IS NULL)
);
CREATE INDEX payment_allocations_instalment_idx ON payment_allocations(instalment_id) WHERE instalment_id IS NOT NULL;
