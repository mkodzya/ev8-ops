-- EV8 Ops — migration 0069: money coming in says what it was (ADR-0046).
--
-- The director's issue #13 of 25.10.2026, accepted by Mika the same day
-- («делай все»): a line coming in is answered by its kind first, the way money
-- going out has been since 0046 — rent, a deposit, a moped sale, goods, a
-- repair or a charge, a customer's advance, money between the company's own
-- accounts, a founder's contribution, cash taken to the bank, other income
-- with its category, or not ours. A payer can be remembered: the next line
-- from him is sorted by itself and listed under «Разобрано правилами».
--
-- Only additions: nothing that is stored changes its meaning.

-- «Прочий доход ▸»: what an owner keeps, like the categories of expenses
-- (0046). The two the director named, and «Прочее» for the rest.
CREATE TABLE income_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name_ru     text NOT NULL CHECK (btrim(name_ru) <> ''),
  name_ka     text,
  name_en     text,
  sort_order  integer NOT NULL DEFAULT 0,
  archived    boolean NOT NULL DEFAULT false,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX income_categories_name_idx ON income_categories(lower(btrim(name_ru))) WHERE NOT archived;

INSERT INTO income_categories (name_ru, name_ka, name_en, sort_order) VALUES
  ('Возврат от поставщика', 'მომწოდებლისგან დაბრუნებული თანხა', 'Refund from a supplier', 1),
  ('Страховка', 'დაზღვევა', 'Insurance', 2),
  ('Прочее', 'სხვა', 'Other', 3);

-- «Запомнить для „…“»: the payer as the bank writes it, normalised
-- (`payerKey`, apps/api/src/lib/statements/payers.ts), and what his money is.
--   customer        — his money goes on that customer's open rental, in the
--                     usual order, when it can do so without a doubt;
--   own_transfer    — money between the company's own accounts;
--   founder_equity  — a founder's contribution, not revenue;
--   other_income    — other income of that category.
-- One live rule a payer; remembering him again replaces the old one.
CREATE TABLE payer_rules (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payer_key    text NOT NULL CHECK (btrim(payer_key) <> ''),
  kind         text NOT NULL CHECK (kind IN ('customer', 'own_transfer', 'founder_equity', 'other_income')),
  customer_id  uuid REFERENCES customers(id),
  category_id  uuid REFERENCES income_categories(id),
  created_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  archived_at  timestamptz,
  archived_by  uuid REFERENCES users(id),
  CONSTRAINT payer_rules_customer CHECK ((kind = 'customer') = (customer_id IS NOT NULL)),
  CONSTRAINT payer_rules_category CHECK ((kind = 'other_income') = (category_id IS NOT NULL))
);
CREATE UNIQUE INDEX payer_rules_live_idx ON payer_rules(payer_key) WHERE archived_at IS NULL;

-- A line's other income has its category; a line a remembered payer sorted
-- names the rule — attached to a rental, or set aside as one of the answers above.
ALTER TABLE statement_lines
  ADD COLUMN income_category_id uuid REFERENCES income_categories(id),
  ADD COLUMN payer_rule_id      uuid REFERENCES payer_rules(id);

-- Two answers of their own for money coming in.
ALTER TABLE statement_lines DROP CONSTRAINT IF EXISTS statement_lines_resolution_check;
ALTER TABLE statement_lines ADD CONSTRAINT statement_lines_resolution_check
  CHECK (resolution IN ('not_ours', 'company_expense', 'bank_deposit', 'legacy', 'own_transfer', 'shareholder', 'founder_equity', 'other_income'));
