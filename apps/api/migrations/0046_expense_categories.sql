-- EV8 Ops — migration 0046: money going out says what it was for.
--
-- Until now a line leaving the account was either "a company expense", with
-- no word on what for, or "not ours". Mika chose on 15.10.2026 (variant A,
-- `docs/redesign/prototypes/expense-sort-options.html`, "по рекомендации"):
-- every outgoing line is first what it is — an expense, a deposit handed
-- back, a supplier paid, money between the company's own accounts, or not
-- ours — and an expense has a category. A payee can be remembered: the next
-- line from it is sorted by itself and listed under «Разобрано правилами».
--
-- The twelve categories to begin with were read off the real queue of
-- 15.10.2026 and accepted by Mika («категории ок»); an owner adds, renames
-- and archives them. A category archived keeps the lines it already holds.

CREATE TABLE expense_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name_ru     text NOT NULL CHECK (btrim(name_ru) <> ''),
  name_ka     text,
  name_en     text,
  sort_order  integer NOT NULL DEFAULT 0,
  archived    boolean NOT NULL DEFAULT false,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX expense_categories_name_idx ON expense_categories(lower(btrim(name_ru))) WHERE NOT archived;

INSERT INTO expense_categories (name_ru, name_ka, name_en, sort_order) VALUES
  ('Налоги', 'გადასახადები', 'Taxes', 1),
  ('Взносы за сотрудников', 'შენატანები თანამშრომლებზე', 'Employee contributions', 2),
  ('Зарплаты и подотчёт', 'ხელფასები და ანგარიშვალდებული თანხები', 'Salaries and advances', 3),
  ('Аренда помещения', 'ფართის იჯარა', 'Premises rent', 4),
  ('Коммунальные', 'კომუნალური', 'Utilities', 5),
  ('Связь и интернет', 'კავშირი და ინტერნეტი', 'Phone and internet', 6),
  ('Банк и терминал', 'ბანკი და ტერმინალი', 'Bank and terminal', 7),
  ('Подписки и сервисы', 'გამოწერები და სერვისები', 'Subscriptions and services', 8),
  ('Запчасти и ремонт', 'სათადარიგო ნაწილები და შეკეთება', 'Parts and repairs', 9),
  ('Топливо и доставка', 'საწვავი და მიწოდება', 'Fuel and delivery', 10),
  ('Реклама', 'რეკლამა', 'Advertising', 11),
  ('Прочее', 'სხვა', 'Other', 12);

-- "Remember this payee": the payee as the bank writes it, normalised
-- (`expenseKey`, apps/api/src/lib/statements/expenses.ts); one live rule a payee.
CREATE TABLE expense_rules (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payee_key    text NOT NULL,
  category_id  uuid NOT NULL REFERENCES expense_categories(id),
  created_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  archived_at  timestamptz,
  archived_by  uuid REFERENCES users(id)
);
CREATE UNIQUE INDEX expense_rules_live_idx ON expense_rules(payee_key) WHERE archived_at IS NULL;

ALTER TABLE statement_lines
  ADD COLUMN expense_category_id uuid REFERENCES expense_categories(id),
  ADD COLUMN expense_rule_id     uuid REFERENCES expense_rules(id);

-- Money between the company's own accounts, or taken out into the till, is
-- neither an expense nor somebody else's: it gets its own answer.
ALTER TABLE statement_lines DROP CONSTRAINT IF EXISTS statement_lines_resolution_check;
ALTER TABLE statement_lines ADD CONSTRAINT statement_lines_resolution_check
  CHECK (resolution IN ('not_ours', 'company_expense', 'bank_deposit', 'legacy', 'own_transfer'));
