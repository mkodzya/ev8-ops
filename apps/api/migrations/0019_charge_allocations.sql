-- EV8 Ops — migration 0019: a payment can close a return's charge (wave 3).
--
-- 0018 added the enum value 'charge'; a value added in a transaction cannot
-- be used in that same transaction, so the allocation's shape learns it here.

ALTER TABLE payment_allocations DROP CONSTRAINT allocation_shape;
ALTER TABLE payment_allocations ADD CONSTRAINT allocation_shape CHECK (
  (target = 'period'     AND period_id     IS NOT NULL AND deposit_id IS NULL AND instalment_id IS NULL AND charge_id IS NULL) OR
  (target = 'deposit'    AND deposit_id    IS NOT NULL AND period_id  IS NULL AND instalment_id IS NULL AND charge_id IS NULL) OR
  (target = 'instalment' AND instalment_id IS NOT NULL AND period_id  IS NULL AND deposit_id    IS NULL AND charge_id IS NULL) OR
  (target = 'charge'     AND charge_id     IS NOT NULL AND period_id  IS NULL AND deposit_id    IS NULL AND instalment_id IS NULL)
);
CREATE INDEX payment_allocations_charge_idx ON payment_allocations(charge_id) WHERE charge_id IS NOT NULL;
