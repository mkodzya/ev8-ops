# Напоминания об оплате, шаг 1 (issue #20) — грузинские строки: на вычитку

Дата: 01.11.2026. Разработчик. Строки написал не носитель языка; читает Kardu. Источник —
`apps/web/src/i18n/reminders.ts` (рядом — русский и английский текст каждой строки) и журнал (`wave4.ts`,
`feedWords`) — в таблице ниже. Решение — ADR-0052. Тексты самих шаблонов Meta здесь не переводятся: они твои,
из issue #20.

Слова: напоминание — «შეხსენება» [shekhseneba], день оплаты — «გადახდის დღე» [gadakhdis dghe], просрочка —
«ვადაგადაცილება» [vadagadatsileba], как в графике; «пробный режим» — «საცდელი რეჟიმი» [satsdeli rezhimi]. Чтение —
латиницей, без знаков абруптива; «…» — место, куда встаёт время, сумма или имя.

Вопросы к Kardu:
1. «Пора звонить» — «დარეკვის დროა» [darekvis droa]. Так говорят, или короче «დარეკე» [dareke]?
2. В строке «Сегодня» — «დასარეკი 2» [dasareki 2] («к звонку 2»). Совпадает со словом вкладки «დასარეკი» — не
   путает?

## Экран (`reminders.ts`)

| Ключ | RU | KA | Чтение |
|---|---|---|---|
| `rem.slots` | Напоминание … | შეხსენება … | shekhseneba … |
| `rem.dryRun` | пробно, не отправлено | საცდელი, არ გაიგზავნა | satsdeli, ar gaigzavna |
| `rem.sent` | отправлено | გაიგზავნა | gaigzavna |
| `rem.failed` | не ушло | ვერ გაიგზავნა | ver gaigzavna |
| `rem.call` | пора звонить | დარეკვის დროა | darekvis droa |
| `rem.off` | напоминания выключены | შეხსენებები გამორთულია | shekhsenebebi gamortulia |
| `rem.templates.payment_due` | день оплаты | გადახდის დღე | gadakhdis dghe |
| `rem.templates.overdue_1` | 1-й день просрочки | ვადაგადაცილების 1-ლი დღე | vadagadatsilebis 1-li dghe |
| `rem.templates.overdue_2` | 2-й день просрочки — предупреждение | ვადაგადაცილების მე-2 დღე — გაფრთხილება | vadagadatsilebis me-2 dghe — gaprtkhileba |
| `rem.card.title` | Напоминания об оплате | გადახდის შეხსენებები | gadakhdis shekhsenebebi |
| `rem.card.on` | Включены: день оплаты в 12:00, 1-й и 2-й день просрочки в 12:00 и 18:00. Не в день выдачи и не в православные праздники Грузии. | ჩართულია: გადახდის დღეს 12:00-ზე, ვადაგადაცილების 1-ლ და მე-2 დღეს 12:00-ზე და 18:00-ზე. არა გაცემის დღეს და არა საქართველოს მართლმადიდებლურ დღესასწაულებზე. | chartulia: gadakhdis dghes 12:00-ze, vadagadatsilebis 1-l da me-2 dghes 12:00-ze da 18:00-ze. ara gatsemis dghes da ara sakartvelos martlmadideblur dghesastsaulebze. |
| `rem.card.dry` | Пока пробный режим: кому написать, решается и записывается здесь, ничего не отправляется. | ჯერ საცდელი რეჟიმია: ვის მივწეროთ, აქ წყდება და იწერება, არაფერი იგზავნება. | jer satsdeli rezhimia: vis mivtserot, ak tsqdeba da itsereba, araperi igzavneba. |
| `rem.card.offWhy` | Выключены: 2 | გამორთულია: 2 | gamortulia: 2 |
| `rem.card.offBy` | …, … | …, … | …, … |
| `rem.card.switchOff` | Выключить | გამორთვა | gamortva |
| `rem.card.switchOn` | Включить | ჩართვა | chartva |
| `rem.card.offTitle` | Выключить напоминания | შეხსენებების გამორთვა | shekhsenebebis gamortva |
| `rem.card.offReason` | Почему | რატომ | ratom |
| `rem.card.offHint` | Причина обязательна: её видно в карточке и в журнале. | მიზეზი სავალდებულოა: ჩანს ბარათზე და ჟურნალში. | mizezi savaldebuloa: chans baratze da zhurnalshi. |
| `rem.card.offDone` | Напоминания выключены | შეხსენებები გამოირთო | shekhsenebebi gamoirto |
| `rem.card.onDone` | Напоминания включены | შეხსენებები ჩაირთო | shekhsenebebi chairto |
| `rem.card.recent` | Последние | ბოლო | bolo |
| `rem.card.none` | Ещё ничего не решалось. | ჯერ არაფერი გადაწყვეტილა. | jer araperi gadatsqvetila. |
| `rem.card.row` | … … · … · … · undefined | … … · … · … · undefined | … … · … · … · undefined |
| `rem.card.lang` | Язык сообщений: … | შეტყობინებების ენა: … | shetqobinebebis ena: … |
| `rem.lang.label` | Язык сообщений | შეტყობინებების ენა | shetqobinebebis ena |
| `rem.lang.hint` | Русский уходит на английском: русского шаблона нет. | რუსული ინგლისურად იგზავნება: რუსული შაბლონი არ არის. | rusuli inglisurad igzavneba: rusuli shabloni ar aris. |
| `rem.lang.names.ka` | Грузинский | ქართული | kartuli |
| `rem.lang.names.ru` | Русский (уходит на английском) | რუსული (იგზავნება ინგლისურად) | rusuli (igzavneba inglisurad) |
| `rem.lang.names.en` | Английский | ინგლისური | inglisuri |
| `rem.todayCall` | позвонить 2 | დასარეკი 2 | dasareki 2 |

## Журнал

| Ключ | RU | KA | Чтение |
|---|---|---|---|
| `feedWords.rental.reminders.off` | Напоминания об оплате выключены | გადახდის შეხსენებები გამოირთო | gadakhdis shekhsenebebi gamoirto |
| `feedWords.rental.reminders.on` | Напоминания об оплате снова включены | გადახდის შეხსენებები ხელახლა ჩაირთო | gadakhdis shekhsenebebi khelakhla chairto |
