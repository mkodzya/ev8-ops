-- EV8 Ops — migration 0049: the expense categories are the owner's list.
--
-- 0048 added five categories Mika had asked for. He had added his own on
-- production the same day (19.10.2026: «Категории я сам добавил уже») — not
-- the same five, and not spelt the same — so 0048 would have put beside them
-- categories he did not choose, and a second «Обмен валюты». What 0048 added
-- by itself is taken out again: a category nobody created, with one of those
-- five names, made on or after that day, that no line and no remembered payee
-- uses. A category an owner made is never touched.

DELETE FROM expense_categories c
WHERE c.created_by IS NULL
  AND c.created_at >= '2026-10-19'
  AND c.name_ru IN ('Пенсионный фонд', 'Охрана', 'Расчёт по НДС', 'Подоходный налог', 'Обмен валюты')
  AND NOT EXISTS (SELECT 1 FROM statement_lines l WHERE l.expense_category_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM expense_rules r WHERE r.category_id = c.id);
