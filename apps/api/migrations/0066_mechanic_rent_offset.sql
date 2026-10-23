-- EV8 Ops — migration 0066: a mechanic who also rents a moped (ADR-0043:
-- the director's request of 22.10.2026, decided by Mika the same day, «А»).
--
-- A mechanic may rent a moped from the company. What the company owes him for
-- his repairs and what he owes for his rent are settled against each other:
-- when the owner marks a payout, as much of it as his begun weeks owe now goes
-- into the rent — automatically, never more than the debt, never into the
-- deposit (that is handed back in cash one day) — and only the rest is
-- handed over. When the rent owes more than the payout, what is left stays his
-- rent debt and he pays it as any customer does.
--
--   * `users.customer_id` — the mechanic's own card as a customer: the one his
--     rental is written to. One card for one person, and empty for everybody
--     who rents nothing.
--   * `payment_channel 'offset'` — money that changed no hands: rent closed by
--     work. It is not cash in a till and not a line in a bank, so neither the
--     till nor «Разобрать» waits for it, and «Пришло денег» does not count it.
--     It is rent all the same: the weeks it closes are paid, and «Экономика»
--     sees it as the moped's rent; the mechanic's work is already in the
--     repair's cost (ADR-0037), so nothing is counted twice.
--   * `mechanic_payouts.offset_tetri` / `offset_payment_id` — how much of a
--     payout went into rent, and the payment that carried it. Voiding the
--     payout voids that payment, and the weeks are owed again.
--
-- New enum values are only added here; nothing in this file uses them (the
-- file runs in one transaction, and a value added in it is not usable there).

ALTER TYPE payment_channel ADD VALUE IF NOT EXISTS 'offset';

-- A card deleted lets go of its mechanic; he simply rents nothing any more.
ALTER TABLE users ADD COLUMN IF NOT EXISTS customer_id uuid UNIQUE REFERENCES customers(id) ON DELETE SET NULL;

ALTER TABLE mechanic_payouts ADD COLUMN IF NOT EXISTS offset_tetri integer NOT NULL DEFAULT 0;
ALTER TABLE mechanic_payouts ADD COLUMN IF NOT EXISTS offset_payment_id uuid REFERENCES payments(id);
ALTER TABLE mechanic_payouts DROP CONSTRAINT IF EXISTS mechanic_payouts_offset_ck;
ALTER TABLE mechanic_payouts ADD CONSTRAINT mechanic_payouts_offset_ck
  CHECK (offset_tetri >= 0 AND offset_tetri <= labour_tetri + reimburse_tetri AND (offset_tetri = 0) = (offset_payment_id IS NULL));
