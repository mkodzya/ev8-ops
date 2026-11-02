# Напоминания об оплате, шаги 1 и 2 (issue #20) — грузинские строки: на вычитку

Дата: 01.11.2026. Разработчик. Строки написал не носитель языка; читает Kardu. Источник —
`apps/web/src/i18n/reminders.ts` (рядом — русский и английский текст каждой строки) и журнал (`wave4.ts`,
`feedWords`) — в таблице ниже. Решения — ADR-0052 (шаг 1) и ADR-0053 (шаг 2, отправка через Kommo; строки дописаны 01.11.2026). Тексты самих шаблонов Meta здесь не переводятся: они твои,
из issue #20.

Слова: напоминание — «შეხსენება» [shekhseneba], день оплаты — «გადახდის დღე» [gadakhdis dghe], просрочка —
«ვადაგადაცილება» [vadagadatsileba], как в графике; «пробный режим» — «საცდელი რეჟიმი» [satsdeli rezhimi]. Чтение —
латиницей, без знаков абруптива; «…» — место, куда встаёт время, сумма или имя.

Вопросы к Kardu:
1. «Пора звонить» — «დარეკვის დროა» [darekvis droa]. Так говорят, или короче «დარეკე» [dareke]?
2. В строке «Сегодня» — «დასარეკი 2» [dasareki 2] («к звонку 2»). Совпадает со словом вкладки «დასარეკი» — не
   путает?
3. Шаг 2: «сделка Kommo» — «გარიგება» [garigeba], как на экране сверки с Kommo. Так говорят в Kommo по-грузински,
   или там «ლიდი» [lidi]?
4. «Поставить на паузу» — «გაგზავნის შეჩერება» [gagzavnis shechereba], «возобновить» — «გაგზავნის განახლება»
   [gagzavnis ganakhleba]. Понятно?

## Экран (`reminders.ts`)

| Ключ | RU | KA | Чтение |
|---|---|---|---|
| `rem.slots` | Напоминание … | შეხსენება … | shekhseneba … |
| `rem.dryRun` | пробно, не отправлено | საცდელი, არ გაიგზავნა | satsdeli, ar gaigzavna |
| `rem.sending` | отправляется | იგზავნება | igzavneba |
| `rem.sent` | отправлено | გაიგზავნა | gaigzavna |
| `rem.failed` | не ушло | ვერ გაიგზავნა | ver gaigzavna |
| `rem.failures.no_deal` | нет сделки в Kommo | Kommo-ში გარიგება არ არის | Kommo-shi garigeba ar aris |
| `rem.failures.shared_deal` | у другой аренды та же сделка Kommo | სხვა ქირაობას იგივე Kommo-ს გარიგება აქვს | skhva kiraobas igive Kommo-s garigeba akvs |
| `rem.failures.no_bot` | нет бота для этого шаблона | ამ შაბლონისთვის ბოტი არ არის | am shablonistvis boti ar aris |
| `rem.failures.no_field` | в Kommo нет поля «Amount due» | Kommo-ში ველი «Amount due» არ არის | Kommo-shi veli «Amount due» ar aris |
| `rem.failures.not_written` | сумма не записалась в сделку | თანხა გარიგებაში არ ჩაიწერა | tankha garigebashi ar chaitsera |
| `rem.failures.deal_gone` | сделки больше нет в Kommo | გარიგება Kommo-ში აღარ არის | garigeba Kommo-shi aghar aris |
| `rem.failures.kommo_off` | Kommo не подключён | Kommo არ არის დაკავშირებული | Kommo ar aris dakavshirebuli |
| `rem.failures.interrupted` | отправка прервалась | გაგზავნა შუაში შეწყდა | gagzavna shuashi shetsqda |
| `rem.failures.unauthorized` | Kommo не принял токен | Kommo-მ ტოკენი არ მიიღო | Kommo-m tokeni ar miigho |
| `rem.failures.rate_limited` | Kommo: слишком много запросов | Kommo: ზედმეტად ბევრი მოთხოვნა | Kommo: zedmetad bevri motkhovna |
| `rem.failures.http` | Kommo отказал | Kommo-მ უარი თქვა | Kommo-m uari tkva |
| `rem.failures.network` | Kommo не ответил | Kommo არ პასუხობს | Kommo ar pasukhobs |
| `rem.failures.bad_answer` | Kommo ответил непонятно | Kommo-მ გაუგებრად უპასუხა | Kommo-m gaugebrad upasukha |
| `rem.noDeal` | нет сделки в Kommo | Kommo-ში გარიგება არ არის | Kommo-shi garigeba ar aris |
| `rem.call` | пора звонить | დარეკვის დროა | darekvis droa |
| `rem.off` | напоминания выключены | შეხსენებები გამორთულია | shekhsenebebi gamortulia |
| `rem.templates.payment_due` | день оплаты | გადახდის დღე | gadakhdis dghe |
| `rem.templates.overdue_1` | 1-й день просрочки | ვადაგადაცილების 1-ლი დღე | vadagadatsilebis 1-li dghe |
| `rem.templates.overdue_2` | 2-й день просрочки — предупреждение | ვადაგადაცილების მე-2 დღე — გაფრთხილება | vadagadatsilebis me-2 dghe — gaprtkhileba |
| `rem.card.title` | Напоминания об оплате | გადახდის შეხსენებები | gadakhdis shekhsenebebi |
| `rem.card.on` | Включены: день оплаты в 12:00, 1-й и 2-й день просрочки в 12:00 и 18:00. Не в день выдачи и не в православные праздники Грузии. | ჩართულია: გადახდის დღეს 12:00-ზე, ვადაგადაცილების 1-ლ და მე-2 დღეს 12:00-ზე და 18:00-ზე. არა გაცემის დღეს და არა საქართველოს მართლმადიდებლურ დღესასწაულებზე. | chartulia: gadakhdis dghes 12:00-ze, vadagadatsilebis 1-l da me-2 dghes 12:00-ze da 18:00-ze. ara gatsemis dghes da ara sakartvelos martlmadideblur dghesastsaulebze. |
| `rem.card.sending.off` | Пока пробный режим: кому написать, решается и записывается здесь, ничего не отправляется. | ჯერ საცდელი რეჟიმია: ვის მივწეროთ, აქ წყდება და იწერება, არაფერი იგზავნება. | jer satsdeli rezhimia: vis mivtserot, ak tsqdeba da itsereba, araperi igzavneba. |
| `rem.card.sending.test` | Тест: сообщения уходят только на тестовые сделки из «Настройки → Напоминания». | ტესტი: შეტყობინებები მიდის მხოლოდ სატესტო გარიგებებზე «პარამეტრები → შეხსენებები»-დან. | testi: shetqobinebebi midis mkholod satesto garigebebze «parametrebi → shekhsenebebi»-dan. |
| `rem.card.sending.on` | Уходят в WhatsApp через Kommo, сумма — отсюда. | იგზავნება WhatsApp-ში Kommo-ს გავლით, თანხა — აქედან. | igzavneba WhatsApp-shi Kommo-s gavlit, tankha — akedan. |
| `rem.card.sending.paused` | Отправка на паузе в «Настройки → Напоминания». | გაგზავნა შეჩერებულია «პარამეტრები → შეხსენებები»-ში. | gagzavna shecherebulia «parametrebi → shekhsenebebi»-shi. |
| `rem.card.noDeal` | Ни у аренды, ни у клиента нет сделки Kommo: отправить нельзя. Укажите в аренде ссылку на сделку. | არც ქირაობას და არც კლიენტს Kommo-ს გარიგება არ აქვთ: გაგზავნა შეუძლებელია. მიუთითეთ ქირაობაში გარიგების ბმული. | arts kiraobas da arts klients Kommo-s garigeba ar akvt: gagzavna sheudzlebelia. miutitet kiraobashi garigebis bmuli. |
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
| `rem.card.row` | … … · … · … · … | … … · … · … · … | … … · … · … · … |
| `rem.card.lang` | Язык сообщений: … | შეტყობინებების ენა: … | shetqobinebebis ena: … |
| `rem.lang.label` | Язык сообщений | შეტყობინებების ენა | shetqobinebebis ena |
| `rem.lang.hint` | Русский уходит на английском: русского шаблона нет. | რუსული ინგლისურად იგზავნება: რუსული შაბლონი არ არის. | rusuli inglisurad igzavneba: rusuli shabloni ar aris. |
| `rem.lang.names.ka` | Грузинский | ქართული | kartuli |
| `rem.lang.names.ru` | Русский (уходит на английском) | რუსული (იგზავნება ინგლისურად) | rusuli (igzavneba inglisurad) |
| `rem.lang.names.en` | Английский | ინგლისური | inglisuri |
| `rem.todayCall` | позвонить 2 | დასარეკი 2 | dasareki 2 |
| `rem.set.mode` | Отправка на этом стенде | გაგზავნა ამ სტენდზე | gagzavna am stendze |
| `rem.set.modes.off` | Выключена: решается и записывается, ничего не уходит | გამორთულია: წყდება და იწერება, არაფერი იგზავნება | gamortulia: tsqdeba da itsereba, araperi igzavneba |
| `rem.set.modes.test` | Тест: только на тестовые сделки ниже | ტესტი: მხოლოდ ქვემოთ მითითებულ სატესტო გარიგებებზე | testi: mkholod kvemot mititebul satesto garigebebze |
| `rem.set.modes.on` | Включена: всем клиентам | ჩართულია: ყველა კლიენტს | chartulia: qvela klients |
| `rem.set.modeHint` | Меняется на сервере одной командой — её даёт разработчик. | იცვლება სერვერზე ერთი ბრძანებით — მას დეველოპერი გაძლევთ. | itsvleba serverze erti brdzanebit — mas developeri gadzlevt. |
| `rem.set.noKommo` | На этом стенде Kommo не подключён: отправить ничего нельзя. | ამ სტენდზე Kommo არ არის დაკავშირებული: გაგზავნა შეუძლებელია. | am stendze Kommo ar aris dakavshirebuli: gagzavna sheudzlebelia. |
| `rem.set.paused` | На паузе: ничего не уходит, пока отправку не возобновят. | შეჩერებულია: არაფერი იგზავნება, სანამ გაგზავნას არ განაახლებენ. | shecherebulia: araperi igzavneba, sanam gagzavnas ar ganaakhleben. |
| `rem.set.pause` | Поставить на паузу | გაგზავნის შეჩერება | gagzavnis shechereba |
| `rem.set.resume` | Возобновить отправку | გაგზავნის განახლება | gagzavnis ganakhleba |
| `rem.set.pausedDone` | Отправка на паузе | გაგზავნა შეჩერდა | gagzavna shecherda |
| `rem.set.resumedDone` | Отправка возобновлена | გაგზავნა განახლდა | gagzavna ganakhlda |
| `rem.set.field` | Перед каждым сообщением сумма вписывается в поле сделки «…» и проверяется. Не вписалась — сообщение не уходит: с пустым полем Kommo отправит сумму-пример из шаблона. | ყოველი შეტყობინების წინ თანხა იწერება გარიგების ველში «…» და მოწმდება. თუ არ ჩაიწერა — შეტყობინება არ იგზავნება: ცარიელი ველით Kommo შაბლონის სანიმუშო თანხას გააგზავნის. | qoveli shetqobinebis tsin tankha itsereba garigebis velshi «…» da motsmdeba. tu ar chaitsera — shetqobineba ar igzavneba: tsarieli velit Kommo shablonis sanimusho tankhas gaagzavnis. |
| `rem.set.bots` | Боты Kommo | Kommo-ს ბოტები | Kommo-s botebi |
| `rem.set.botsHint` | Один бот на шаблон и язык. Номер бота — в адресе его страницы в Kommo. | თითო ბოტი თითო შაბლონსა და ენაზე. ბოტის ნომერი მისი გვერდის მისამართშია Kommo-ში. | tito boti tito shablonsa da enaze. botis nomeri misi gverdis misamartshia Kommo-shi. |
| `rem.set.langs.ka` | Грузинский | ქართული | kartuli |
| `rem.set.langs.en` | Английский | ინგლისური | inglisuri |
| `rem.set.testLeads` | Тестовые сделки | სატესტო გარიგებები | satesto garigebebi |
| `rem.set.testHint` | Номера или ссылки сделок Kommo через запятую. В тестовом режиме сообщения уходят только на них. | Kommo-ს გარიგებების ნომრები ან ბმულები, მძიმით გამოყოფილი. სატესტო რეჟიმში შეტყობინებები მხოლოდ მათზე მიდის. | Kommo-s garigebebis nomrebi an bmulebi, mdzimit gamoqopili. satesto rezhimshi shetqobinebebi mkholod matze midis. |
| `rem.set.saved` | Сохранено | შენახულია | shenakhulia |
| `rem.set.today` | Сегодня | დღეს | dghes |
| `rem.set.counts` | отправлено … · не ушло … · пробно … | გაიგზავნა … · ვერ გაიგზავნა … · საცდელი … | gaigzavna … · ver gaigzavna … · satsdeli … |
| `rem.set.by` | Изменил(а): …, … | შეცვალა: …, … | shetsvala: …, … |

## Журнал

| Ключ | RU | KA | Чтение |
|---|---|---|---|
| `feedWords.rental.reminders.off` | Напоминания об оплате выключены | გადახდის შეხსენებები გამოირთო | gadakhdis shekhsenebebi gamoirto |
| `feedWords.rental.reminders.on` | Напоминания об оплате снова включены | გადახდის შეხსენებები ხელახლა ჩაირთო | gadakhdis shekhsenebebi khelakhla chairto |
| `feedWords.settings.reminders` | Изменены настройки отправки напоминаний | შეიცვალა შეხსენებების გაგზავნის პარამეტრები | sheitsvala shekhsenebebis gagzavnis parametrebi |
