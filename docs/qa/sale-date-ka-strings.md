# «Дата продажи» — грузинские строки: на вычитку

Дата: 21.10.2026. Разработчик. Строки написал не носитель языка: «გაყიდვის თარიღი» [gaqidvis tarighi] («дата
продажи»), «შენატანი» [shenatani] («взнос»), «ნასყიდობის დოკუმენტი» [nasqidobis dokumenti] («договор
продажи») и «შეყვანა» [sheqvana] («внести в систему») взяты из словаря продукта. Источник —
`apps/web/src/i18n/sale-date.ts`, слово журнала — `apps/web/src/i18n/wave4.ts`, отказы —
`errors.codes` в `apps/web/src/i18n/ka.ts`. Откуда задача — звонок 21.10.2026: продажу с неверной датой
пришлось отменить и завести заново. Рядом с каждой строкой — русский и английский текст и чтение
латиницей в квадратных скобках. Даты в примерах выдуманы.

## Новые строки (в коде с 21.10.2026)

| Ключ | RU | EN | KA | Чтение | Где видно |
|---|---|---|---|---|---|
| `saleDate.menu`, `saleDate.title` | Изменить дату продажи | Change the sale date | გაყიდვის თარიღის შეცვლა | gaqidvis tarighis shetsvla | пункт меню «⋯» на карточке продажи; заголовок листа |
| `saleDate.recorded(дата)` | Записано: 14.10.2026 | Recorded: 14.10.2026 | ჩაწერილია: 14.10.2026 | chatserilia | подсказка под полем даты: какая дата у продажи записана сейчас |
| `saleDate.changes` | Что изменится | What changes | რა შეიცვლება | ra sheitsvleba | заголовок списка «было → стало» в листе |
| `saleDate.history` | История мопеда: продан | Moped history: sold | მოპედის ისტორია: გაყიდულია | mopedis istoria: gaqidulia | строка списка: событие «продан» у мопеда |
| `saleDate.line(№)` | Взнос №2 | Instalment #2 | შენატანი №2 | shenatani | строка списка: какой взнос графика сдвигается |
| `saleDate.stays` | График не меняется: у перенесённой продажи даты из бумажного договора. | The schedule stays as it is: a carried-over sale keeps the dates of its paper contract. | გრაფიკი არ იცვლება: გადმოტანილ გაყიდვას თარიღები ქაღალდის ხელშეკრულებიდან აქვს. | grapiki ar itsvleba: gadmotanil gaqidvas tarighebi kaghaldis khelshekrulebidan akvs. | под списком, у перенесённой продажи |
| `saleDate.paperKeeps(дата)` | Подписанный договор продажи не меняется: в нём останется дата 14.10.2026. | The signed sale document does not change: it keeps the date 14.10.2026. | ხელმოწერილი ნასყიდობის დოკუმენტი არ იცვლება: მასში დარჩება თარიღი 14.10.2026. | khelmotserili nasqidobis dokumenti ar itsvleba: masshi darcheba tarighi | в листе, если договор уже подписан |
| `saleDate.paperDiffers(дата)` | В подписанном договоре дата продажи 14.10.2026. | The signed document carries the sale date 14.10.2026. | ხელმოწერილ დოკუმენტში გაყიდვის თარიღია 14.10.2026. | khelmotseril dokumentshi gaqidvis tarighia | блок «Документы» на карточке, когда даты разошлись |
| `saleDate.reason` | Почему меняем дату | Why the date changes | რატომ იცვლება თარიღი | ratom itsvleba tarighi | поле причины |
| `saleDate.reasonHint` | Обязательно. Уйдёт в журнал — например, «завели на день позже». | Required. It goes to the journal — for example, «entered a day late». | სავალდებულოა. ჩაიწერება ჟურნალში — მაგალითად, «ერთი დღით გვიან შევიყვანეთ». | savaldebuloa. chaitsereba zhurnalshi — magalitad, «erti dghit gvian sheviqvanet». | подсказка под причиной |
| `saleDate.save` | Сохранить дату | Save the date | თარიღის შენახვა | tarighis shenakhva | кнопка листа |
| `saleDate.beforeHistory(дата)` | Последнее событие в истории мопеда — 12.10.2026. Продажа — в этот день или позже. | The last event in the moped’s history is on 12.10.2026. Date the sale on that day or later. | მოპედის ისტორიის ბოლო მოვლენა: 12.10.2026. გაყიდვა — ამ დღეს ან უფრო გვიან. | mopedis istoriis bolo movlena: 12.10.2026. gaqidva — am dghes an upro gvian. | под полем даты, когда день раньше истории мопеда |
| `saleDate.unchanged` | У продажи уже эта дата. | The sale already has this date. | გაყიდვას უკვე ეს თარიღი აქვს. | gaqidvas ukve es tarighi akvs. | сообщение, если дату не меняли |
| `saleDate.linesMoved(n)` | Сдвинуто взносов: 3 | Instalments moved: 3 | გადატანილი შენატანები: 3 | gadatanili shenatanebi | строка журнала и истории продажи: сколько взносов графика легли на другие дни |
| `feedWords['sale.date']` | Изменена дата продажи | The sale date was changed | შეიცვალა გაყიდვის თარიღი | sheitsvala gaqidvis tarighi | строка журнала и истории продажи |
| `errors.codes.sale_before_history` | Продажа не может быть раньше последнего события в истории мопеда. Выберите тот день или позже. | A sale cannot be dated before the last event in the moped’s history. Pick that day or a later one. | გაყიდვა ვერ იქნება მოპედის ისტორიის ბოლო მოვლენამდე. აირჩიეთ ის დღე ან უფრო გვიანდელი. | gaqidva ver iqneba mopedis istoriis bolo movlenamde. airchiet is dghe an upro gviandeli. | отказ, если сервер не назвал дня |
| `errors.codes.sale_date_future` | Продажу нельзя записать будущей датой. | A sale cannot be dated in the future. | გაყიდვას მომავალი თარიღით ვერ ჩაწერთ. | gaqidvas momavali tarighit ver chatsert. | под полем даты: день позже сегодняшнего |

Строка «Дата продажи» в карточке продажи и в итоге мастера продажи — существующая `sell.soldOn`
(«გაყიდვის თარიღი» [gaqidvis tarighi]), новой нет.

## Вопросы к Kardu

1. «მოვლენა» [movlena] («событие») в продукте раньше не встречалось. Так ли говорят о записи в истории
   мопеда (приехал, вернули, выкупили), или лучше «ჩანაწერი» [chanatseri] («запись»)?
2. «შევიყვანეთ» [sheviqvanet] («мы внесли») в примере причины — естественно ли так сказать «завели в
   систему на день позже»?
