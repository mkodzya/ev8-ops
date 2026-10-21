# «Мастерские» в «Настройки → Ремонт» — грузинские строки: на вычитку

Дата: 21.10.2026. Разработчик. Строки написал не носитель языка. Источник — `apps/web/src/i18n/workshops.ts`
(рядом — русский и английский текст каждой строки) и два новых отказа в `errors.codes` (`ka.ts`). Решение —
владелец, 21.10.2026: список мастерских ведёт только владелец, «удалить» значит «убрать из списка».

Слово для мастерской — «სახელოსნო» [sakhelosno], как в журнале («დაემატა სახელოსნო») и в отказах
(«ამ სახელით სახელოსნო უკვე სიაშია»). Старая подпись поля в окне ремонта — «ხელოსნები» [khelosnebi,
«мастера»] (`wave5-service.ts`, `repair.workshop` и `repair.workshopPick`) — не тронута: выровнять её со
«სახელოსნო» или оставить — решение Kardu при вычитке. «სიიდან მოხსნა» [siidan mokhsna] — как у категорий
расходов («მოხსნა») и у точек.

| Ключ | RU | KA | Чтение |
|---|---|---|---|
| `wshop.title` | Мастерские | სახელოსნოები | sakhelosnoebi |
| `wshop.count(…)` | 2 в списке | სიაში 2 | siashi 2 |
| `wshop.hint` | Кто делает ремонты. Этот список — в «Открыть ремонт». | ვინ აკეთებს შეკეთებებს. ეს სია ჩანს «შეკეთების გახსნაში». | vin aketebs sheketebebs. es sia chans «sheketebis gakhsnashi» |
| `wshop.add` | + Мастерская | + სახელოსნო | sakhelosno |
| `wshop.addTitle` | Новая мастерская | ახალი სახელოსნო | akhali sakhelosno |
| `wshop.editTitle` | Мастерская | სახელოსნო | sakhelosno |
| `wshop.name` | Название | დასახელება | dasakheleba |
| `wshop.phone` | Телефон | ტელეფონი | telefoni |
| `wshop.note` | Заметка | შენიშვნა | shenishvna |
| `wshop.renameHint` | Новое имя увидят все ремонты этой мастерской. Другая мастерская — добавьте новую. | ახალ სახელს დაინახავს ამ სახელოსნოს ყველა შეკეთება. სხვა სახელოსნოა — დაამატეთ ახალი. | akhal sakhels dainakhavs am sakhelosnos qvela sheketeba. skhva sakhelosnoa — daamatet akhali |
| `wshop.jobs(0)` | ремонтов ещё нет | შეკეთებები ჯერ არ არის | sheketebebi jer ar aris |
| `wshop.jobs(3)` | 3 ремонта | 3 შეკეთება | 3 sheketeba |
| `wshop.edit` | Изменить | შეცვლა | shetsvla |
| `wshop.archive` | Убрать из списка | სიიდან მოხსნა | siidan mokhsna |
| `wshop.restore` | Вернуть | დაბრუნება | dabruneba |
| `wshop.archived` | убрана | მოხსნილია | mokhsnilia |
| `wshop.archivedToast(…)` | «ТЕСТ мастерская» убрана из списка. 2 открытых ремонта остаются за ней | «ТЕСТ мастерская» სიიდან მოიხსნა. 2 ღია შეკეთება მასთან რჩება | … siidan moikhsna. 2 ghia sheketeba mastan rcheba |
| `wshop.restoredToast(…)` | «…» снова в списке | «…» ისევ სიაშია | isev siashia |
| `wshop.added(…)` | «…» в списке | «…» სიაშია | siashia |
| `wshop.empty` | Мастерских пока нет. Добавьте первую — её можно будет выбрать в «Открыть ремонт». | სახელოსნოები ჯერ არ არის. დაამატეთ პირველი — ის «შეკეთების გახსნაში» გამოჩნდება. | sakhelosnoebi jer ar aris. daamatet pirveli — is «sheketebis gakhsnashi» gamochndeba |
| `wshop.editList` | Изменить список | სიის შეცვლა | siis shetsvla |
| `errors.codes.workshop_archived` | Эта мастерская убрана из списка. Выберите другую или верните её в «Настройки → Ремонт». | ეს სახელოსნო სიიდან მოხსნილია. აირჩიეთ სხვა ან დააბრუნეთ «პარამეტრები → შეკეთება»-ში. | es sakhelosno siidan mokhsnilia. airchiet skhva an daabrunet «parametrebi → sheketeba»-shi |
| `errors.codes.workshop_archived_exists` | Мастерская с таким названием убрана из списка. Верните её: «…» → «Вернуть». | ამ სახელით სახელოსნო სიიდან მოხსნილია. დააბრუნეთ ის: «…» → «დაბრუნება». | am sakhelit sakhelosno siidan mokhsnilia. daabrunet is: «…» → «dabruneba» |

Название «ТЕСТ мастерская» в примере выдумано; настоящие мастерские в репозитории не пишутся.
