# Поступления по категориям (issue #13) — грузинские строки: на вычитку

Дата: 25.10.2026. Разработчик. Строки написал не носитель языка; читает Kardu. Источник —
`apps/web/src/i18n/inbound.ts` (рядом — русский и английский текст каждой строки); вкладка «Поступления» в
`en.ts` / `ru.ts` / `ka.ts` (`shell.tabs.incoming`), отказы сервера (`errors.codes`) и журнал (`wave4.ts`,
`feedWords`) — в таблицах ниже. Решение — ADR-0046.

Одно понятие — одно слово (issue #9): аренда — «ქირაობა» [kiraoba], залог — «დეპოზიტი» [depoziti], начисление —
«დარიცხვა» [daritskhva], разнесение строки на несколько записей — «განაწილება» [ganatsileba], «შეტანა» [shetana] —
только наличные в банк. Деньги учредителя — «პარტნიორისგან» [partniorisgan], зеркало «პარტნიორს» [partniors] у
списаний (ADR-0029: у ООО владельцы по закону партнёры). Плательщик — «გამგზავნი» [gamgzavni], как пишет банк
(«Sender»). Чтение — латиницей, без знаков абруптива; «…» — место, куда встаёт номер, сумма или дата.

Вопросы к Kardu:
1. «Несколько услуг» — «რამდენიმე მომსახურება» [ramdenime momsakhureba]. Так говорят в офисе, или лучше
   «რამდენიმე გადახდა» [ramdenime gadakhda] («несколько оплат»)?
2. «Взнос учредителя» — «პარტნიორისგან» [partniorisgan] («от партнёра»). Не нужно ли длиннее:
   «პარტნიორის შემოტანილი თანხა» [partnioris shemotanili tankha]?
3. «Прочий доход» — «სხვა შემოსავალი» [skhva shemosavali]; вкладка отчёта и настроек «Поступления» — «შემოსავალი»
   [shemosavali]. Не путается ли «поступление» с «доходом»? Если нужно различать — какое слово для вкладки?
4. «Сдача наличных в банк» — «ნაღდის ბანკში შეტანა» [naghdis bankshi shetana], как подсказка «ბანკში შევიტანე» в
   кассе. Верно?

## Экран «Разобрать», панель, отчёт, настройки (`inbound.ts`)

| Ключ | RU | KA | Чтение |
|---|---|---|---|
| `inc.reasonPickupDay` | Сумма и день выдачи: … выдана …. | თანხა და გაცემის დღე: … გაიცა …. | tankha da gatsemis dghe: … gaitsa …. |
| `inc.kinds.rental` | Аренда | ქირაობა | kiraoba |
| `inc.kinds.deposit` | Залог | დეპოზიტი | depoziti |
| `inc.kinds.sale` | Продажа мопеда | მოპედის გაყიდვა | mopedis gaqidva |
| `inc.kinds.goods` | Товары / запчасти | საქონელი / ნაწილები | sakoneli / natsilebi |
| `inc.kinds.repair` | Ремонт / начисление | შეკეთება / დარიცხვა | sheketeba / daritskhva |
| `inc.kinds.customer` | Аванс клиента | კლიენტის ავანსი | klientis avansi |
| `inc.kinds.own` | Между своими счетами | საკუთარ ანგარიშებს შორის | sakutar angarishebs shoris |
| `inc.kinds.founder` | Взнос учредителя | პარტნიორისგან | partniorisgan |
| `inc.kinds.bank` | Сдача наличных в банк | ნაღდის ბანკში შეტანა | naghdis bankshi shetana |
| `inc.kinds.other` | Прочий доход | სხვა შემოსავალი | skhva shemosavali |
| `inc.several` | Несколько услуг | რამდენიმე მომსახურება | ramdenime momsakhureba |
| `inc.severalTitle` | Несколько услуг · … | რამდენიმე მომსახურება · … | ramdenime momsakhureba · … |
| `inc.panelTitle` | … · … | … · … | … · … |
| `inc.search.rental` | Аренда, имя, телефон, EV-016, 4 цифры VIN | ქირაობა, სახელი, ტელეფონი, EV-016, VIN-ის ბოლო 4 | kiraoba, sakheli, teleponi, EV-016, VIN-is bolo 4 |
| `inc.search.deposit` | Аренда, имя, телефон, EV-016, 4 цифры VIN | ქირაობა, სახელი, ტელეფონი, EV-016, VIN-ის ბოლო 4 | kiraoba, sakheli, teleponi, EV-016, VIN-is bolo 4 |
| `inc.search.sale` | Номер продажи, имя, телефон, 4 последних VIN | გაყიდვის ნომერი, სახელი, ტელეფონი, VIN-ის ბოლო 4 | gaqidvis nomeri, sakheli, teleponi, VIN-is bolo 4 |
| `inc.search.goods` | Номер, покупатель, товар | ნომერი, მყიდველი, საქონელი | nomeri, mqidveli, sakoneli |
| `inc.search.repair` | Номер ремонта или аренды, имя, телефон, VIN | შეკეთების ან ქირაობის ნომერი, სახელი, ტელეფონი, VIN | sheketebis an kiraobis nomeri, sakheli, teleponi, VIN |
| `inc.search.customer` | Имя, телефон, номер аренды | სახელი, ტელეფონი, ქირაობის ნომერი | sakheli, teleponi, kiraobis nomeri |
| `inc.search.bank_deposit` | Сумма или кто сдал | თანხა ან ვინ შეიტანა ბანკში | tankha an vin sheitana bankshi |
| `inc.probable` | Вероятные | სავარაუდო | savaraudo |
| `inc.rest` | Остальные | დანარჩენი | danarcheni |
| `inc.whyName` | имя совпало | სახელი დაემთხვა | sakheli daemtkhva |
| `inc.whyRule` | запомнен для «…» | დამახსოვრებულია «…»-თვის | damakhsovrebulia «…»-tvis |
| `inc.owes` | долг … | დავალიანება … | davalianeba … |
| `inc.noDebt` | долга нет | დავალიანება არ აქვს | davalianeba ar akvs |
| `inc.payDay` | день оплаты — … | გადახდის დღე — … | gadakhdis dghe — … |
| `inc.depositLeft` | залог: осталось … | დეპოზიტი: დარჩა … | depoziti: darcha … |
| `inc.nextPayment` | следующий платёж …, … | შემდეგი გადახდა …, … | shemdegi gadakhda …, … |
| `inc.soldOn` | продано … | გაიყიდა … | gaiqida … |
| `inc.chargeFrom` | начислено … | დაირიცხა … | dairitskha … |
| `inc.repairDone` | готов … | მზადაა … | mzadaa … |
| `inc.rentals` | арендует … | ქირაობს … | kiraobs … |
| `inc.bankDepositBy` | …, … | …, … | …, … |
| `inc.newBankDeposit` | Новая запись «Внёс в банк» из этой строки | ახალი «ბანკში შევიტანე» ამ ხაზიდან | akhali «bankshi shevitane» am khazidan |
| `inc.newBankDepositSub` | если её никто не вносил | თუ ბანკში შეტანა არავის ჩაუწერია | tu bankshi shetana aravis chautseria |
| `inc.newGoods` | Новая продажа товаров | საქონლის ახალი გაყიდვა | sakonlis akhali gaqidva |
| `inc.newGoodsSub` | сначала продажа, потом вернитесь к этой строке | ჯერ გაყიდვა, მერე დაბრუნდით ამ ხაზთან | jer gaqidva, mere dabrundit am khaztan |
| `inc.empty` | Здесь пусто. Поиск — по номеру, имени, телефону; или выберите другую категорию. | აქ ცარიელია. ძებნა — ნომრით, სახელით, ტელეფონით; ან აირჩიეთ სხვა კატეგორია. | ak tsarielia. dzebna — nomrit, sakhelit, teleponit; an airchiet skhva kategoria. |
| `inc.choose` | Выберите запись | აირჩიეთ ჩანაწერი | airchiet chanatseri |
| `inc.attach` | Записать на … | ჩაწერა: … | chatsera: … |
| `inc.res.deposit` | … — залог …. | … — დეპოზიტი …. | … — depoziti …. |
| `inc.res.week` | … — аренда …, неделя …. | … — ქირა …, კვირა …. | … — kira …, kvira …. |
| `inc.res.weekPart` | … — аренда …, часть недели …. | … — ქირა …, კვირის ნაწილი …. | … — kira …, kviris natsili …. |
| `inc.res.charge` | … — начисление по …. | … — დარიცხვა …-ზე. | … — daritskhva …-ze. |
| `inc.res.ahead` | … — аренда …, в счёт следующих недель. | … — ქირა …, მომდევნო კვირების ხარჯზე. | … — kira …, momdevno kvirebis kharjze. |
| `inc.res.bank` | … — наличные, сданные в банк; ничей долг не меняется. | … — ბანკში შეტანილი ნაღდი; არავის დავალიანება არ იცვლება. | … — bankshi shetanili naghdi; aravis davalianeba ar itsvleba. |
| `inc.remember` | Запомнить для «…» | დამახსოვრება «…»-თვის | damakhsovreba «…»-tvis |
| `inc.rememberHint` | Следующие строки от него разнесутся сами — на его аренду, если она одна и сумма подходит; иначе подождут человека. | მისი შემდეგი ხაზები თავად განაწილდება — მის ქირაობაზე, თუ ერთია და თანხა ერგება; თორემ ადამიანს დაელოდება. | misi shemdegi khazebi tavad ganatsildeba — mis kiraobaze, tu ertia da tankha ergeba; torem adamians daelodeba. |
| `inc.remembered.customer` | Плательщик запомнен: …. | გამგზავნი დამახსოვრებულია: …. | gamgzavni damakhsovrebulia: …. |
| `inc.remembered.own_transfer` | Плательщик запомнен: между своими счетами. | გამგზავნი დამახსოვრებულია: საკუთარ ანგარიშებს შორის. | gamgzavni damakhsovrebulia: sakutar angarishebs shoris. |
| `inc.remembered.founder_equity` | Плательщик запомнен: взнос учредителя. | გამგზავნი დამახსოვრებულია: პარტნიორისგან. | gamgzavni damakhsovrebulia: partniorisgan. |
| `inc.remembered.other_income` | Плательщик запомнен: прочий доход · …. | გამგზავნი დამახსოვრებულია: სხვა შემოსავალი · …. | gamgzavni damakhsovrebulia: skhva shemosavali · …. |
| `inc.alsoSorted` |  · ещё 2 от этого плательщика |  · კიდევ 2 ამ გამგზავნისგან |  · kidev 2 am gamgzavnisgan |
| `inc.founderDone` | Отмечено: взнос учредителя | მოინიშნა: პარტნიორისგან | moinishna: partniorisgan |
| `inc.otherDone` | Отмечено: прочий доход · … | მოინიშნა: სხვა შემოსავალი · … | moinishna: skhva shemosavali · … |
| `inc.asideFounder` | Взнос учредителя. | პარტნიორისგან შემოსული თანხა. | partniorisgan shemosuli tankha. |
| `inc.asideOther` | Прочий доход: …. | სხვა შემოსავალი: …. | skhva shemosavali: …. |
| `inc.otherWhat` | Что это | რა არის | ra aris |
| `inc.otherSave` | Записать · … | ჩაწერა · … | chatsera · … |
| `inc.nameHint` | По имени: …. Выберите категорию ниже. | სახელით: …. აირჩიეთ კატეგორია ქვემოთ. | sakhelit: …. airchiet kategoria kvemot. |
| `inc.rulesIncoming` | Поступления по запомненным плательщикам | შემოსავალი დამახსოვრებული გამგზავნებით | shemosavali damakhsovrebuli gamgzavnebit |
| `inc.reasonRule` | Запомненный плательщик «…»: …, долг …. | დამახსოვრებული გამგზავნი «…»: …, დავალიანება …. | damakhsovrebuli gamgzavni «…»: …, davalianeba …. |
| `inc.ruleSince` | правило «…», запомнено … | წესი «…», დამახსოვრებულია … | tsesi «…», damakhsovrebulia … |
| `inc.ruleForgotten` | правило забыто | წესი დავიწყებულია | tsesi davitsqebulia |
| `inc.forget` | Забыть правило | წესის დავიწყება | tsesis davitsqeba |
| `inc.forgotten` | Правило забыто: следующая строка от этого плательщика подождёт человека | წესი დავიწყებულია: ამ გამგზავნის შემდეგი ხაზი ადამიანს დაელოდება | tsesi davitsqebulia: am gamgzavnis shemdegi khazi adamians daelodeba |
| `inc.settings.title` | Категории прочего дохода | სხვა შემოსავლის კატეგორიები | skhva shemosavlis kategoriebi |
| `inc.settings.hint` | Что такое поступление, если это не деньги клиента: возврат от поставщика, страховка. Убранная категория остаётся у своих строк; её запомненные плательщики перестают разносить. | რა არის შემოსული თანხა, თუ ის კლიენტის არ არის: მომწოდებლისგან დაბრუნებული თანხა, დაზღვევა. ამოღებული კატეგორია თავის ხაზებთან რჩება; მისი დამახსოვრებული გამგზავნები აღარ ანაწილებენ. | ra aris shemosuli tankha, tu is klientis ar aris: momtsodeblisgan dabrunebuli tankha, dazghveva. amoghebuli kategoria tavis khazebtan rcheba; misi damakhsovrebuli gamgzavnebi aghar anatsileben. |
| `inc.report.title` | Поступления | შემოსავალი | shemosavali |
| `inc.report.sub` | Что пришло на счета, … — … | რა შემოვიდა ანგარიშებზე, … — … | ra shemovida angarishebze, … — … |
| `inc.report.empty` | За этот период на счета ничего не пришло. | ამ პერიოდში ანგარიშებზე არაფერი შემოსულა. | am periodshi angarishebze araperi shemosula. |
| `inc.report.customers` | От клиентов | კლიენტებისგან | klientebisgan |
| `inc.report.rent` | Аренда | ქირა | kira |
| `inc.report.deposits` | Залоги (к возврату) | დეპოზიტები (დასაბრუნებელი) | depozitebi (dasabrunebeli) |
| `inc.report.sales` | Продажи мопедов | მოპედების გაყიდვა | mopedebis gaqidva |
| `inc.report.goods` | Товары | საქონელი | sakoneli |
| `inc.report.repairs` | Ремонт | შეკეთება | sheketeba |
| `inc.report.advance` | Авансы | ავანსები | avansebi |
| `inc.report.customersTotal` | От клиентов всего | კლიენტებისგან სულ | klientebisgan sul |
| `inc.report.otherIncome` | Прочий доход | სხვა შემოსავალი | skhva shemosavali |
| `inc.report.noCategory` | Без категории | კატეგორიის გარეშე | kategoriis gareshe |
| `inc.report.notRevenue` | Пришло, но не выручка | შემოვიდა, მაგრამ შემოსავალი არ არის | shemovida, magram shemosavali ar aris |
| `inc.report.founder` | Взносы учредителей | პარტნიორებისგან | partniorebisgan |
| `inc.report.ownTransfers` | Между своими счетами | საკუთარ ანგარიშებს შორის | sakutar angarishebs shoris |
| `inc.report.bankDeposits` | Наличные, сданные в банк | ბანკში შეტანილი ნაღდი | bankshi shetanili naghdi |
| `inc.report.other` | Прочее | სხვა | skhva |
| `inc.report.unsorted` | Не разобрано строк: 2 | დაუხარისხებელი ხაზი: 2 | daukhariskhebeli khazi: 2 |
| `inc.report.openSort` | Разобрать | დახარისხება | dakhariskheba |
| `inc.report.total` | Пришло всего | სულ შემოვიდა | sul shemovida |
| `inc.report.net` | Суммы — как дошли до счёта: оплата картой без комиссии банка. | თანხები — როგორც ანგარიშზე მივიდა: ბარათით გადახდა ბანკის საკომისიოს გარეშე. | tankhebi — rogorts angarishze mivida: baratit gadakhda bankis sakomisios gareshe. |

## Вкладка, отказы сервера, журнал

| Ключ | RU | KA | Чтение |
|---|---|---|---|
| `shell.tabs.incoming` | Поступления | შემოსავალი | shemosavali |
| `errors.codes.income_category_not_found` | Такой категории дохода нет. | შემოსავლის ასეთი კატეგორია არ არის. | shemosavlis aseti kategoria ar aris. |
| `errors.codes.no_payer` | Банк не назвал плательщика в этой строке — запоминать некого. | ბანკს ამ ხაზში გამგზავნი არ მიუთითებია — დასამახსოვრებელი არავინაა. | banks am khazshi gamgzavni ar miutitebia — dasamakhsovrebeli aravinaa. |
| `errors.codes.not_incoming` | Так отвечают только на поступление. | ასე მხოლოდ შემოსულ თანხას ვპასუხობთ. | ase mkholod shemosul tankhas vpasukhobt. |
| `errors.codes.payer_rule_not_found` | Этого правила уже нет. | ეს წესი უკვე აღარ არის. | es tsesi ukve aghar aris. |
| `errors.codes.remember_rent_only` | Плательщик запоминается только для аренды, залога или аванса. | გამგზავნი მხოლოდ ქირაობისთვის, დეპოზიტისთვის ან ავანსისთვის მახსოვრდება. | gamgzavni mkholod kiraobistvis, depozitistvis an avansistvis makhsovrdeba. |
| `errors.codes.split_over_deposit` | Часть больше, чем осталось внести в залог. | ნაწილი მეტია, ვიდრე დეპოზიტისთვის გადასახდელი დარჩა. | natsili metia, vidre depozitistvis gadasakhdeli darcha. |
| `feedWords.statement.line.founder_equity` | Строка отмечена: взнос учредителя | ხაზი მოინიშნა: პარტნიორის მიერ შემოტანილი თანხა | khazi moinishna: partnioris mier shemotanili tankha |
| `feedWords.statement.line.other_income` | Строка отмечена: прочий доход | ხაზი მოინიშნა: სხვა შემოსავალი | khazi moinishna: skhva shemosavali |
| `feedWords.statement.line.payer_rule` | Строка разобрана запомненным плательщиком | ხაზი განაწილდა დამახსოვრებული გამგზავნის წესით | khazi ganatsilda damakhsovrebuli gamgzavnis tsesit |
| `feedWords.payer.rule.remember` | Запомнен плательщик | გამგზავნი დამახსოვრებულია | gamgzavni damakhsovrebulia |
| `feedWords.payer.rule.forget` | Забыт запомненный плательщик | დამახსოვრებული გამგზავნი დავიწყებულია | damakhsovrebuli gamgzavni davitsqebulia |
| `feedWords.payer.rule.undo` | Отменён запомненный плательщик и разобранные им строки | დამახსოვრებული გამგზავნი გაუქმდა მის მიერ განაწილებულ ხაზებთან ერთად | damakhsovrebuli gamgzavni gaukmda mis mier ganatsilebul khazebtan ertad |
| `feedWords.income.category.add` | Добавлена категория дохода | დაემატა შემოსავლის კატეგორია | daemata shemosavlis kategoria |
| `feedWords.income.category.edit` | Изменена категория дохода | შეიცვალა შემოსავლის კატეგორია | sheitsvala shemosavlis kategoria |

## Категории прочего дохода (миграция 0069)

| RU | KA | Чтение |
|---|---|---|
| Возврат от поставщика | მომწოდებლისგან დაბრუნებული თანხა | momtsodeblisgan dabrunebuli tankha |
| Страховка | დაზღვევა | dazghveva |
| Прочее | სხვა | skhva |
