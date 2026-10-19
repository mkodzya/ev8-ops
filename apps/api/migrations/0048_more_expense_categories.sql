-- EV8 Ops — migration 0048: five more expense categories (Mika, 19.10.2026).
--
-- «Пенсионный фонд», «Охрана», «Расчёт по НДС», «Подоходный налог», «Обмен
-- валюты» — asked for by Mika, added here so that nobody types them on a
-- stand. A name an owner already added stays as it is: a category with the
-- same Russian name is not added twice. They follow the first twelve, as a
-- category an owner adds does.

INSERT INTO expense_categories (name_ru, name_ka, name_en, sort_order)
SELECT v.name_ru, v.name_ka, v.name_en, v.sort_order
FROM (VALUES
  ('Пенсионный фонд', 'საპენსიო ფონდი', 'Pension fund', 13),
  ('Охрана', 'დაცვა', 'Security', 14),
  ('Расчёт по НДС', 'დღგ-ის ანგარიშსწორება', 'VAT settlement', 15),
  ('Подоходный налог', 'საშემოსავლო გადასახადი', 'Personal income tax', 16),
  ('Обмен валюты', 'ვალუტის გაცვლა', 'Currency exchange', 17)
) AS v(name_ru, name_ka, name_en, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM expense_categories c WHERE lower(btrim(c.name_ru)) = lower(btrim(v.name_ru)) AND NOT c.archived
);
