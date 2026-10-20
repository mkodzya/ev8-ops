-- EV8 Ops — migration 0059: paying the mechanic (stage 5 of
-- docs/spec/mechanic-in-erp-plan.md; ADR-0037; decided by Mika on 20.10.2026).
--
--   * **A payout is a mark, not a payment.** The owner says a mechanic was
--     paid: the day, the work, the receipts paid back, who marked it. Money
--     leaves as it leaves — no payment row, no expense, nothing in «Деньги».
--     The total is the sum of the two, never a stored number.
--   * **A paid repair is a closed one that names its payout.** The status
--     stays `done`, so everything that reads «closed» keeps reading it; a
--     repair names one payout only, so it cannot be paid twice — and only a
--     payout of its own mechanic.
--   * **A receipt is paid back to whoever paid it.** A part the chief mechanic
--     bought for another mechanic's repair is reimbursed to the chief (ADR-0036),
--     so a bought line names the payout that paid it back on its own, and only
--     a payout of the person it is owed to.
--   * **A payout marked by mistake is voided with its reason**; its repairs
--     let go of it and are payable again (ADR-0037 §5).
--
-- Nothing old changes: no repair and no line names a payout.

CREATE TABLE mechanic_payouts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mechanic_id      uuid NOT NULL REFERENCES users(id),
  -- The Tbilisi day it was marked.
  paid_on          date NOT NULL,
  -- The approved work of its repairs, each repair rounded once (ADR-0037 §8).
  labour_tetri     integer NOT NULL CHECK (labour_tetri >= 0),
  -- The receipts it paid back, to the tetri.
  reimburse_tetri  integer NOT NULL CHECK (reimburse_tetri >= 0),
  marked_by        uuid NOT NULL REFERENCES users(id),
  marked_at        timestamptz NOT NULL DEFAULT now(),
  voided_at        timestamptz,
  voided_by        uuid REFERENCES users(id),
  void_reason      text,
  CONSTRAINT mechanic_payout_voided_shape CHECK (
    (voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL)
    OR (voided_at IS NOT NULL AND voided_by IS NOT NULL AND btrim(coalesce(void_reason, '')) <> '')
  ),
  -- What a repair or a line points at: a payout and whose it is.
  CONSTRAINT mechanic_payout_of_mechanic UNIQUE (id, mechanic_id)
);
CREATE INDEX mechanic_payouts_mechanic_idx ON mechanic_payouts (mechanic_id, paid_on DESC);

ALTER TABLE service_jobs
  ADD COLUMN paid_in_payout_id uuid,
  -- Its own mechanic's payout, never another's.
  ADD CONSTRAINT service_paid_in_payout FOREIGN KEY (paid_in_payout_id, mechanic_id)
    REFERENCES mechanic_payouts (id, mechanic_id),
  -- Only a closed repair of a mechanic is paid; a paid one stays closed.
  ADD CONSTRAINT service_paid_shape CHECK (
    paid_in_payout_id IS NULL OR (status = 'done' AND mechanic_id IS NOT NULL)
  );
CREATE INDEX service_jobs_paid_in_payout_idx ON service_jobs (paid_in_payout_id) WHERE paid_in_payout_id IS NOT NULL;

ALTER TABLE service_parts
  ADD COLUMN paid_in_payout_id uuid,
  -- Paid back in the payout of the person it is owed to.
  ADD CONSTRAINT service_part_paid_in_payout FOREIGN KEY (paid_in_payout_id, reimburse_to)
    REFERENCES mechanic_payouts (id, mechanic_id),
  -- Only a bought line, approved and not refused, is paid back.
  ADD CONSTRAINT service_part_paid_shape CHECK (
    paid_in_payout_id IS NULL
    OR (kind = 'bought' AND approved_at IS NOT NULL AND rejected_at IS NULL AND reimburse_to IS NOT NULL)
  );
CREATE INDEX service_parts_paid_in_payout_idx ON service_parts (paid_in_payout_id) WHERE paid_in_payout_id IS NOT NULL;
