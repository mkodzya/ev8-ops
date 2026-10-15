-- EV8 Ops — migration 0042: a bank line can be the money of a week carried
-- over, and a running rental can be fined (Mika, 15.10.2026, «А»; ADR-0023).
--
-- One transfer of 350 on 08.10.2026: 150 for the week 08–14.10, which the
-- carry-over of 11.10 already marked paid, and 200 for damage. "Разделить"
-- could put the 150 only on the oldest unpaid week — the next one — and so
-- count the same money twice, and had nothing to put the 200 on.
--
--   * rental_periods.carried_payment_id — the bank's payment that a week
--     carried over as paid turned out to be. The week stays paid as it was
--     (paid_before_transfer is history and stays true); the payment's money
--     is placed on that week, so it is neither the customer's credit nor
--     counted a second time, and the week's report reads it as takings of its
--     day instead of "paid before the transfer". Voiding the payment empties
--     the column, and the week is carried as before. One payment, one week.
--   * rental_charges.kind 'fine' — what an owner charges a running rental
--     with a reason (damage, a dirty moped), until now only a return could.

ALTER TABLE rental_periods ADD COLUMN carried_payment_id uuid REFERENCES payments(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX rental_periods_carried_payment ON rental_periods(carried_payment_id) WHERE carried_payment_id IS NOT NULL;

ALTER TABLE rental_charges DROP CONSTRAINT rental_charges_kind_check;
ALTER TABLE rental_charges ADD CONSTRAINT rental_charges_kind_check CHECK (kind IN ('key', 'late', 'withheld', 'other', 'fine'));
