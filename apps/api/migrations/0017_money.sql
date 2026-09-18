-- EV8 Ops — migration 0017: money in one place (redesign wave 2).
--
-- What a payment is for, said once on the payment instead of guessed from
-- which link happens to be filled; money going out with a channel (a deposit
-- handed back, a moped bought back, a supplier paid); the till by person —
-- a manager hands cash over, an owner accepts it or says it does not add up;
-- cash taken to the bank; and a statement line that can belong to at most one
-- live payment, however many hands tap "attach" at once (B2-02).

-- ---- what a payment is for -------------------------------------------------

CREATE TYPE payment_kind AS ENUM (
  'rent',            -- a rental: its deposit and its weeks
  'sale',            -- a sale's instalments
  'service',         -- a repair charged to the customer
  'on_account',      -- the customer's money, not yet for anything
  'deposit_payout',  -- a deposit handed back
  'buyback',         -- a moped bought back from its buyer
  'supplier'         -- an order paid to a supplier
);

ALTER TABLE payments
  ADD COLUMN kind              payment_kind,
  ADD COLUMN service_job_id    uuid REFERENCES service_jobs(id),
  ADD COLUMN deposit_id        uuid REFERENCES deposits(id),
  -- A deposit handed to someone other than the payer, at the customer's
  -- request: who, and why (rental.md "Возврат и залог").
  ADD COLUMN paid_to           text,
  ADD COLUMN paid_to_reason    text,
  -- An owner may date a payment in the past; the reason stays with it (ux №14).
  ADD COLUMN backdate_reason   text,
  -- A supplier paid in the invoice's currency: what left the account in GEL
  -- is gross_tetri, what the supplier got is this, in minor units.
  ADD COLUMN foreign_minor     bigint,
  ADD COLUMN foreign_currency  text,
  -- 'undo': taken back within seconds by whoever made it; 'void': annulled by
  -- an owner with a reason. Both leave the row; only the word differs.
  ADD COLUMN void_kind         text CHECK (void_kind IN ('undo', 'void'));

UPDATE payments SET kind = CASE
  WHEN direction = 'out' AND purchase_id IS NOT NULL THEN 'supplier'
  WHEN direction = 'out' AND sale_id IS NOT NULL THEN 'buyback'
  WHEN direction = 'out' THEN 'deposit_payout'
  WHEN sale_id IS NOT NULL THEN 'sale'
  WHEN rental_id IS NOT NULL THEN 'rent'
  ELSE 'on_account'
END::payment_kind;
UPDATE payments SET void_kind = 'void' WHERE voided_at IS NOT NULL;

ALTER TABLE payments ALTER COLUMN kind SET NOT NULL;

-- One statement line, one live payment (B2-02). A voided payment lets go of
-- its line, so the line can be attached again.
CREATE UNIQUE INDEX payments_statement_line_live
  ON payments(statement_line_id)
  WHERE statement_line_id IS NOT NULL AND voided_at IS NULL;

CREATE INDEX payments_created_by_idx ON payments(created_by, occurred_on);

-- ---- deposits handed back ----------------------------------------------------
--
-- Until now a return decided what to give back and nothing recorded giving it;
-- from here a payout is a payment going out (B5-03). Deposits decided before
-- this migration were handed back at the counter the day they were decided —
-- that was the practice — and are counted as paid out, so "to hand back" does
-- not open with every old return in it.

ALTER TABLE deposits ADD COLUMN paid_out_before_tetri integer NOT NULL DEFAULT 0;
UPDATE deposits SET paid_out_before_tetri = returned_tetri WHERE returned_tetri > 0;

-- ---- the till ------------------------------------------------------------------

CREATE TYPE handover_status AS ENUM ('pending', 'accepted', 'disputed');

-- A manager hands the cash they took to an owner (money.md, decision В3).
CREATE TABLE cash_handovers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user     uuid NOT NULL REFERENCES users(id),
  amount_tetri  integer NOT NULL CHECK (amount_tetri > 0),
  handed_at     timestamptz NOT NULL DEFAULT now(),
  status        handover_status NOT NULL DEFAULT 'pending',
  -- "Does not add up": what the owner counted, and why.
  counted_tetri integer CHECK (counted_tetri >= 0),
  reason        text,
  decided_by    uuid REFERENCES users(id),
  decided_at    timestamptz
);
CREATE INDEX cash_handovers_from_idx ON cash_handovers(from_user, handed_at);

-- Cash an owner took to the bank (decision of 18.09.2026): out of the till,
-- not a customer's payment; the statement's "cash deposit" line finds it.
CREATE TABLE bank_cash_deposits (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users(id),
  amount_tetri      integer NOT NULL CHECK (amount_tetri > 0),
  bank              bank_name NOT NULL,
  occurred_on       date NOT NULL,
  statement_line_id uuid UNIQUE REFERENCES statement_lines(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  voided_at         timestamptz,
  void_reason       text
);

-- The till counts from the day it existed. Cash in the books before that —
-- the Odoo history — was never handed over or taken to the bank in this
-- system, and would stand as "on hand" for ever.
CREATE TABLE money_settings (
  id          boolean PRIMARY KEY DEFAULT true CHECK (id),
  till_since  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO money_settings DEFAULT VALUES;

-- ---- statement lines -------------------------------------------------------------
--
-- How a line was settled when it did not become a customer's payment: not
-- ours (with a reason), a company expense, cash taken to the bank.

ALTER TABLE statement_lines
  ADD COLUMN resolution         text CHECK (resolution IN ('not_ours', 'company_expense', 'bank_deposit', 'legacy')),
  ADD COLUMN resolution_reason  text,
  ADD COLUMN resolved_by        uuid REFERENCES users(id),
  ADD COLUMN resolved_at        timestamptz;

-- Outgoing lines used to be set aside on import. They stay set aside — they
-- are history — and from here new ones go to "Разобрать → Списания".
UPDATE statement_lines SET resolution = 'legacy' WHERE status = 'ignored';
