# Волна 2 — новые и изменённые грузинские строки: на вычитку

Дата: 18.09.2026. Разработчик. Реестр книги #15. Строки написал разработчик, не носитель языка.
Сравнение словаря `apps/web/src/i18n/ka.ts` с концом волны 1 (`dd7057f`); рядом — русский текст той же строки.

Предложения дизайнера из `wave-2.md` §8: დასახარისხებელი (Разобрать), ჰგავს, უკვე გატარებულია (Похоже, уже записан),
დეპოზიტები (Залоги), «მიბმა … -ზე» (Привязать к …). В словаре так и стоит.

Строк: 248.

| Ключ | RU | KA |
|---|---|---|
| `shell.actions.takeMoney` | 'Принять деньги' | 'ფულის მიღება' |
| `shell.actions.takeCash` | 'Принять наличные' | 'ნაღდის მიღება' |
| `shell.tabs.sort` | 'Разобрать' | 'დასახარისხებელი' |
| `shell.tabs.till` | 'Касса' | 'სალარო' |
| `shell.tabs.deposits` | 'Залоги' | 'დეპოზიტები' |
| `shell.tabs.mine` | 'Мои платежи' | 'ჩემი გადახდები' |
| `money.take` | 'Принять деньги' | 'ფულის მიღება' |
| `money.takeCash` | 'Принять наличные' | 'ნაღდის მიღება' |
| `money.takeFor` | (n: string) => `Принять оплату · ${n}` | (n: string) => `გადახდის მიღება · ${n}` |
| `money.payOutFor` | (n: string) => `Выдать залог · ${n}` | (n: string) => `დეპოზიტის დაბრუნება · ${n}` |
| `money.payInstalment` | (n: string) => `Принять взнос · ${n}` | (n: string) => `შენატანის მიღება · ${n}` |
| `money.paySupplier` | (n: string) => `Оплатить поставщику · ${n}` | (n: string) => `მომწოდებლისთვის გადახდა · ${n}` |
| `money.payService` | (n: string) => `Оплата ремонта · ${n}` | (n: string) => `შეკეთების გადახდა · ${n}` |
| `money.buyBack` | (n: string) => `Выкуп · ${n}` | (n: string) => `უკან გამოსყიდვა · ${n}` |
| `money.in` | 'Приход' | 'შემოსავალი' |
| `money.out` | 'Расход' | 'გასავალი' |
| `money.whoIn` | 'Клиент, телефон, номер записи' | 'კლიენტი, ტელეფონი, ჩანაწერის ნომერი' |
| `money.whoOut` | 'Номер аренды, продажи или закупки' | 'ქირის, გაყიდვის ან შესყიდვის ნომერი' |
| `money.whoHint` | 'Имя, последние цифры телефона или номер: R-…, SL-…, PO-…' | 'სახელი, ტელეფონის ბოლო ციფრები ან ნომერი: R-…, SL-…, PO-…' |
| `money.change` | 'Изменить' | 'შეცვლა' |
| `money.owes` | (n: string) => `Должен ${n}` | (n: string) => `ვალი ${n}` |
| `money.noDebt` | 'Долга нет' | 'ვალი არ აქვს' |
| `money.onAccount` | (n: string) => `На счету ${n}` | (n: string) => `ანგარიშზე ${n}` |
| `money.ahead` | 'Впереди по рассрочке' | 'განვადებით წინ' |
| `money.depositHeld` | 'Залог на руках — не долг' | 'ხელზე არსებული დეპოზიტი — ვალი არ არის' |
| `money.whatFor` | 'За что' | 'რისთვის' |
| `money.toAccount` | 'На счёт клиента' | 'კლიენტის ანგარიშზე' |
| `money.toAccountHint` | 'переплата уйдёт в следующую неделю' | 'ზედმეტი მომდევნო კვირაზე გადავა' |
| `money.amount` | 'Сумма' | 'თანხა' |
| `money.amountCash` | 'Сумма наличными' | 'თანხა ნაღდით' |
| `money.customerPaid` | 'Клиент заплатил' | 'კლიენტმა გადაიხადა' |
| `money.chipDebt` | 'долг' | 'ვალი' |
| `money.chipWeek` | '+ следующая неделя' | '+ მომდევნო კვირა' |
| `money.chipInstalment` | 'взнос' | 'შენატანი' |
| `money.chipToHandBack` | 'к выдаче' | 'დასაბრუნებელი' |
| `money.chipHeld` | 'на руках' | 'ხელზე' |
| `money.card` | (net: string, fee: string) => `Банк зачислит ${net}; комиссия ${fee} — расход компании.` | (net: string, fee: string) => `ბანკი ჩარიცხავს ${net}; საკომისიო ${fee} — კომპანიის ხარჯი.` |
| `money.transferHint` | 'Строка выписки найдёт этот платёж сама.' | 'ამონაწერის ხაზი ამ გადახდას თავად იპოვის.' |
| `money.date` | 'Дата' | 'თარიღი' |
| `money.backdateReason` | 'Почему прошлой датой' | 'რატომ წინა თარიღით' |
| `money.managerDay` | (d: string) => `Сегодня, ${d} · попадёт в вашу кассу` | (d: string) => `დღეს, ${d} · თქვენს სალაროში შევა` |
| `money.closes` | 'Закроет' | 'დახურავს' |
| `money.closeDeposit` | 'Залог' | 'დეპოზიტი' |
| `money.closeWeek` | (from: string, to: string) => `Неделя ${from}–${to}` | (from: string, to: string) => `კვირა ${from}–${to}` |
| `money.closeInstalment` | (seq: number, due: string) => `Взнос ${seq} · ${due}` | (seq: number, due: string) => `შენატანი ${seq} · ${due}` |
| `money.closeService` | (n: string) => `Ремонт ${n}` | (n: string) => `შეკეთება ${n}` |
| `money.closePurchase` | (n: string) => `Оплата ${n}` | (n: string) => `გადახდა ${n}` |
| `money.closeSale` | (n: string) => `${n}: долг по продаже станет 0` | (n: string) => `${n}: გაყიდვაზე ვალი 0 გახდება` |
| `money.ofFull` | (a: string, full: string) => `${a} из ${full}` | (a: string, full: string) => `${a} / ${full}` |
| `money.paidThroughAfter` | (d: string) => `Оплачено будет по ${d}` | (d: string) => `გადახდილი იქნება ${d}-მდე` |
| `money.leftDebt` | (n: string) => `Останется долг ${n}` | (n: string) => `დარჩება ვალი ${n}` |
| `money.leftover` | (n: string) => `Лишнее ${n} — на счёт клиента, уйдёт в следующую неделю` | (n: string) => `ზედმეტი ${n} — კლიენტის ანგარიშზე, მომდევნო კვირაზე გადავა` |
| `money.record` | (n: string) => `Записать ${n}` | (n: string) => `ჩაწერა ${n}` |
| `money.payOut` | (n: string) => `Выдать ${n}` | (n: string) => `დაბრუნება ${n}` |
| `money.recordSupplier` | 'Записать оплату' | 'გადახდის ჩაწერა' |
| `money.buyBackFor` | (n: string) => `Выкупить за ${n}` | (n: string) => `გამოსყიდვა ${n}` |
| `money.recorded` | (n: string, how: string) => `Записано ${n} ${how}` | (n: string, how: string) => `ჩაიწერა ${n} ${how}` |
| `money.paidOut` | (n: string, how: string) => `Выдано ${n} ${how}` | (n: string, how: string) => `დაბრუნდა ${n} ${how}` |
| `money.how` | { cash: 'наличными', acquiring: 'картой', transfer: 'переводом' } | { cash: 'ნაღდით', acquiring: 'ბარათით', transfer: 'გადარიცხვით' } |
| `money.received` | 'Залог получен' | 'მიღებული დეპოზიტი' |
| `money.withheld` | 'Удержано' | 'დაკავებული' |
| `money.toHandBack` | 'К выдаче' | 'დასაბრუნებელი' |
| `money.howBack` | 'Как отдаём' | 'როგორ ვაბრუნებთ' |
| `money.to` | 'Кому' | 'ვის' |
| `money.payer` | (name: string) => `${name} — плательщик` | (name: string) => `${name} — გადამხდელი` |
| `money.other` | 'Другому человеку' | 'სხვა ადამიანს' |
| `money.otherHint` | 'по просьбе клиента, с причиной' | 'კლიენტის თხოვნით, მიზეზით' |
| `money.otherName` | 'Кому именно' | 'ვის კონკრეტულად' |
| `money.otherReason` | 'Почему не плательщику' | 'რატომ არა გადამხდელს' |
| `money.invoice` | 'Инвойс' | 'ინვოისი' |
| `money.paidSoFar` | 'Оплачено' | 'გადახდილია' |
| `money.leftAccount` | 'Ушло со счёта, GEL' | 'ანგარიშიდან გავიდა, GEL' |
| `money.inCurrency` | (c: string) => `Это в валюте инвойса, ${c}` | (c: string) => `ეს ინვოისის ვალუტაში, ${c}` |
| `money.rate` | (r: string, c: string) => `Курс посчитается сам: ${r} GEL/${c}` | (r: string, c: string) => `კურსი თავად დაითვლება: ${r} GEL/${c}` |
| `money.bankFee` | 'Комиссия банка, GEL' | 'ბანკის საკომისიო, GEL' |
| `money.bankFeeHint` | 'если была · расход компании, в себестоимость не входит' | 'თუ იყო · კომპანიის ხარჯი, თვითღირებულებაში არ შედის' |
| `money.toState` | 'Куда мопед' | 'სად მიდის მოპედი' |
| `money.nothingOwed` | 'Долгов нет — сумму введите сами.' | 'ვალი არ არის — თანხა თავად შეიყვანეთ.' |
| `money.kinds` | { rent: 'Аренда', sale: 'Продажа', service: 'Ремонт', on_account: 'На счёт клиента', deposit_payout: 'Выдача залога', buyback: 'Выкуп обратно', supplier: 'Оплата поставщику' } | { rent: 'ქირა', sale: 'გაყიდვა', service: 'შეკეთება', on_account: 'კლიენტის ანგარიშზე', deposit_payout: 'დეპოზიტის დაბრუნება', buyback: 'უკან გამოსყიდვა', supplier: 'მომწოდებლისთვის გადახდა' } |
| `sort.incoming` | 'Поступления' | 'შემოსავლები' |
| `sort.outgoing` | 'Списания' | 'ჩამოწერები' |
| `sort.recordedGroup` | 'Похоже, уже записан' | 'ჰგავს, უკვე გატარებულია' |
| `sort.hintsGroup` | 'Подсказки' | 'ჰგავს' |
| `sort.noneGroup` | 'Без подсказки' | 'მინიშნების გარეშე' |
| `sort.recordedText` | (what: string) => `Уже внесён вручную: ${what}. Строка выписки — это он?` | (what: string) => `უკვე გატარებულია ხელით: ${what}. ეს ის არის?` |
| `sort.recordedOut` | (what: string) => `Похоже на внесённое вручную: ${what}.` | (what: string) => `ჰგავს ხელით გატარებულს: ${what}.` |
| `sort.yes` | 'Да, это он' | 'დიახ, ეს არის' |
| `sort.yesShe` | 'Да, это она' | 'დიახ, ეს არის' |
| `sort.no` | 'Нет, другой платёж' | 'არა, სხვაა' |
| `sort.attachTo` | (n: string) => `Привязать к ${n}` | (n: string) => `მიბმა ${n}-ზე` |
| `sort.attaching` | 'Привязываем…' | 'ვაბამთ…' |
| `sort.attached` | (n: string) => `Привязано к ${n}` | (n: string) => `მიება ${n}-ს` |
| `sort.linked` | 'Связано с внесённым платежом' | 'დაკავშირდა ხელით გატარებულ გადახდასთან' |
| `sort.other` | 'Другое' | 'სხვა' |
| `sort.more` | 'Ещё' | 'კიდევ' |
| `sort.notOurs` | 'Это не наше' | 'ეს ჩვენი არ არის' |
| `sort.notOursTitle` | 'Это не платёж клиента' | 'ეს კლიენტის გადახდა არ არის' |
| `sort.notOursReason` | 'Что это на самом деле' | 'რა არის სინამდვილეში' |
| `sort.notOursHint` | 'Причина обязательна; строка уйдёт из очереди, в журнал — кто и почему.' | 'მიზეზი სავალდებულოა; ხაზი რიგიდან წავა, ჟურნალში — ვინ და რატომ.' |
| `sort.notOursDone` | 'Убрано из очереди' | 'რიგიდან ამოღებულია' |
| `sort.remove` | 'Убрать из очереди' | 'რიგიდან ამოღება' |
| `sort.expense` | 'Расход компании' | 'კომპანიის ხარჯი' |
| `sort.expenseDone` | 'Отмечено как расход компании' | 'მონიშნულია კომპანიის ხარჯად' |
| `sort.bankDeposit` | 'Похоже на внесение наличных — записать «Внёс в банк»?' | 'ჰგავს ნაღდის შეტანას — ჩავწეროთ «ბანკში შევიტანე»?' |
| `sort.bankDepositYes` | 'Да, это взнос наличных' | 'დიახ, ნაღდის შეტანაა' |
| `sort.whereTo` | (n: string) => `Куда привязать ${n}` | (n: string) => `სად მივაბათ ${n}` |
| `sort.whereHint` | 'Поиск: номер записи, имя, телефон. Показаны записи с долгом и «на счёт клиента».' | 'ძებნა: ჩანაწერის ნომერი, სახელი, ტელეფონი. ჩანს ვალიანი ჩანაწერები და «კლიენტის ანგარიშზე».' |
| `sort.empty` | 'Всё разобрано' | 'ყველაფერი დახარისხებულია' |
| `sort.byRules` | (n: number) => `Разобрано правилами за неделю: ${n}` | (n: number) => `წესებმა დაახარისხა კვირაში: ${n}` |
| `sort.check` | 'проверить' | 'შემოწმება' |
| `sort.rulesTitle` | 'Разобрано правилами' | 'წესებით დახარისხებული' |
| `sort.rulesSub` | (n: number) => `За неделю · ${n}` | (n: number) => `კვირაში · ${n}` |
| `sort.unlink` | 'Отвязать' | 'გახსნა' |
| `sort.unlinked` | 'Строка вернулась в «Разобрать»' | 'ხაზი დაბრუნდა «დასახარისხებელში»' |
| `sort.open` | 'Открыть' | 'გახსნა' |
| `sort.reason.name` | (name: string, debt: string, n: string) => `Имя совпало: «${name}». Долг ${debt} по ${n}.` | (name: string, debt: string, n: string) => `სახელი დაემთხვა: «${name}». ვალი ${debt} — ${n}.` |
| `sort.reason.nameOnly` | (name: string) => `Имя совпало: «${name}».` | (name: string) => `სახელი დაემთხვა: «${name}».` |
| `sort.reason.card_pickup` | (net: string, gross: string, n: string, day: string) => `Карта: ${net} = ${gross} − 1,5 %. ${n} выдана ${day}.` | (net: string, gross: string, n: string, day: string) => `ბარათი: ${net} = ${gross} − 1,5 %. ${n} გაიცა ${day}.` |
| `sort.reason.amount_week` | (n: string, debt: string) => `Сумма и неделя: ${n}, долг ${debt}.` | (n: string, debt: string) => `თანხა და კვირა: ${n}, ვალი ${debt}.` |
| `sort.reason.amount` | (n: string, debt: string) => `Сумма совпала с долгом ${debt} по ${n}.` | (n: string, debt: string) => `თანხა ემთხვევა ვალს ${debt} — ${n}.` |
| `sort.reason.recorded` | (n: string) => `Связано с платежом, внесённым вручную${n}.` | (n: string) => `დაკავშირდა ხელით გატარებულ გადახდასთან${n}.` |
| `sort.reason.bank_deposit` | 'Взнос наличных совпал с «Внёс в банк».' | 'ნაღდის შეტანა დაემთხვა «ბანკში შევიტანე»-ს.' |
| `till.today` | 'Сегодня' | 'დღეს' |
| `till.week` | 'Неделя' | 'კვირა' |
| `till.onHandToday` | 'На руках сегодня' | 'დღეს ხელზე' |
| `till.onHand` | 'На руках' | 'ხელზე' |
| `till.cashIn` | 'Принято наличными' | 'მიღებული ნაღდი' |
| `till.cashOut` | 'Выдано' | 'გაცემული' |
| `till.handed` | 'Сдал' | 'ჩააბარა' |
| `till.acceptedFrom` | 'Принято от менеджеров' | 'მენეჯერებისგან მიღებული' |
| `till.toBank` | 'Внесено в банк' | 'ბანკში შეტანილი' |
| `till.short` | 'Расхождение' | 'სხვაობა' |
| `till.handedAt` | (t: string) => `сдал ${t}` | (t: string) => `ჩააბარა ${t}` |
| `till.waiting` | 'ждёт владельца' | 'ელოდება მფლობელს' |
| `till.afterHanding` | 'После сдачи' | 'ჩაბარების შემდეგ' |
| `till.accept` | (n: string) => `Принять ${n}` | (n: string) => `მიღება ${n}` |
| `till.accepted` | (n: string) => `Принято ${n}` | (n: string) => `მიღებულია ${n}` |
| `till.dispute` | 'Не сходится' | 'არ ემთხვევა' |
| `till.disputeTitle` | (who: string) => `Принять кассу · ${who}` | (who: string) => `სალაროს მიღება · ${who}` |
| `till.bySystem` | 'По системе' | 'სისტემით' |
| `till.counted` | 'Пересчитал' | 'დავთვალე' |
| `till.disputeReason` | 'Причина' | 'მიზეზი' |
| `till.disputeHint` | 'Обязательна при расхождении; разница останется за менеджером до разбора.' | 'სავალდებულოა სხვაობისას; სხვაობა მენეჯერზე რჩება გარკვევამდე.' |
| `till.acceptCounted` | (n: string) => `Принять ${n}` | (n: string) => `მიღება ${n}` |
| `till.hand` | (n: string) => `Сдал владельцу ${n}` | (n: string) => `მფლობელს ჩავაბარე ${n}` |
| `till.handedDone` | (n: string) => `Сдано ${n} — ждёт владельца` | (n: string) => `ჩაბარდა ${n} — ელოდება მფლობელს` |
| `till.bank` | 'Внёс в банк' | 'ბანკში შევიტანე' |
| `till.bankTitle` | 'Внёс в банк' | 'ბანკში შევიტანე' |
| `till.bankOnHand` | (who: string) => `На руках у ${who}` | (who: string) => `ხელზე აქვს ${who}` |
| `till.bankAmountHint` | 'Не больше, чем на руках' | 'არაუმეტეს ხელზე არსებულისა' |
| `till.bankRecorded` | (n: string) => `Внесено в банк ${n}` | (n: string) => `ბანკში შეტანილია ${n}` |
| `till.accepted_` | 'принято' | 'მიღებულია' |
| `till.empty` | 'Сегодня наличных не было' | 'დღეს ნაღდი არ ყოფილა' |
| `till.emptyHint` | 'Принятые наличные появятся здесь.' | 'მიღებული ნაღდი აქ გამოჩნდება.' |
| `till.receivedToday` | 'Принято сегодня' | 'დღეს მიღებული' |
| `till.person` | 'Кто' | 'ვინ' |
| `till.periodOf` | (from: string, to: string) => (from === to ? from : `${from} – ${to}`) | (from: string, to: string) => (from === to ? from : `${from} – ${to}`) |
| `deposits.onHand` | 'На руках (получено)' | 'ხელზე (მიღებული)' |
| `deposits.contract` | 'Начислено по договорам' | 'ხელშეკრულებებით დარიცხული' |
| `deposits.held` | 'На руках' | 'ხელზე' |
| `deposits.to_hand_back` | 'К выдаче' | 'დასაბრუნებელი' |
| `deposits.short` | 'Недовнесён' | 'ნაკლებად შეტანილი' |
| `deposits.closed` | 'Закрыты' | 'დახურული' |
| `deposits.returnedOn` | (d: string) => `вернул ${d}` | (d: string) => `დააბრუნა ${d}` |
| `deposits.decidedAll` | 'решено вернуть всё' | 'გადაწყდა სრულად დაბრუნება' |
| `deposits.decidedPart` | (n: string) => `решено вернуть ${n}` | (n: string) => `გადაწყდა დაბრუნება ${n}` |
| `deposits.pickedUp` | (d: string) => `выдан ${d}` | (d: string) => `გაცემულია ${d}` |
| `deposits.shortOf` | (got: string, full: string, left: string) => `${got} из ${full} · недовнесён ${left}` | (got: string, full: string, left: string) => `${got} / ${full} · აკლია ${left}` |
| `deposits.handBack` | 'Выдать' | 'დაბრუნება' |
| `deposits.contractCol` | 'По договору' | 'ხელშეკრულებით' |
| `deposits.receivedCol` | 'Получено' | 'მიღებული' |
| `deposits.withheldCol` | 'Удержано' | 'დაკავებული' |
| `deposits.paidOutCol` | 'Выдано' | 'დაბრუნებული' |
| `deposits.heldCol` | 'На руках' | 'ხელზე' |
| `deposits.none` | 'Залогов здесь нет.' | 'აქ დეპოზიტები არ არის.' |
| `paymentPage.title` | (n: string) => `Платёж ${n}` | (n: string) => `გადახდა ${n}` |
| `paymentPage.customer` | 'Клиент' | 'კლიენტი' |
| `paymentPage.channel` | 'Канал' | 'არხი' |
| `paymentPage.bankCredited` | 'Банк зачислил' | 'ბანკმა ჩარიცხა' |
| `paymentPage.feeExpense` | 'Комиссия — расход' | 'საკომისიო — ხარჯი' |
| `paymentPage.date` | 'Дата' | 'თარიღი' |
| `paymentPage.by` | 'Внёс' | 'შეიყვანა' |
| `paymentPage.closed` | 'Закрыл' | 'დახურა' |
| `paymentPage.line` | 'Строка выписки' | 'ამონაწერის ხაზი' |
| `paymentPage.byRule` | 'привязана правилом' | 'მიბმულია წესით' |
| `paymentPage.byHand` | 'привязана вручную' | 'მიბმულია ხელით' |
| `paymentPage.journal` | 'Журнал' | 'ჟურნალი' |
| `paymentPage.void` | 'Аннулировать' | 'ანულირება' |
| `paymentPage.voidTitle` | (n: string) => `Аннулировать платёж ${n}?` | (n: string) => `გავაუქმოთ ${n} გადახდა?` |
| `paymentPage.voidReason` | 'Причина' | 'მიზეზი' |
| `paymentPage.voidHint` | 'Обязательна. Недели и залог снова станут неоплаченными; строка выписки вернётся в «Разобрать».' | 'სავალდებულოა. კვირები და დეპოზიტი ისევ გადაუხდელი გახდება; ამონაწერის ხაზი «დასახარისხებელში» დაბრუნდება.' |
| `paymentPage.voided` | 'Аннулирован' | 'ანულირებულია' |
| `paymentPage.undone` | 'отменён сразу' | 'მაშინვე გაუქმდა' |
| `paymentPage.voidedToast` | 'Платёж аннулирован' | 'გადახდა ანულირებულია' |
| `paymentPage.backdate` | 'Прошлой датой, потому что' | 'წინა თარიღით, რადგან' |
| `paymentPage.paidTo` | 'Выдан' | 'გადაეცა' |
| `paymentPage.rate` | 'Курс' | 'კურსი' |
| `paymentPage.notFound` | 'Платёж не найден.' | 'ასეთი გადახდა არ არის.' |
| `payList.thisWeek` | 'Эта неделя' | 'ეს კვირა' |
| `payList.lastWeek` | 'Прошлая неделя' | 'წინა კვირა' |
| `payList.month` | 'Этот месяц' | 'ეს თვე' |
| `payList.all` | 'Всё время' | 'მთელი დრო' |
| `payList.allChannels` | 'Все каналы' | 'ყველა არხი' |
| `payList.inOut` | 'Приход и расход' | 'შემოსავალი და გასავალი' |
| `payList.anyKind` | 'Основание' | 'საფუძველი' |
| `payList.anyone` | 'Кто внёс' | 'ვინ შეიყვანა' |
| `payList.totalIn` | 'Приход' | 'შემოსავალი' |
| `payList.totalOut` | 'Расход' | 'გასავალი' |
| `payList.totalFee` | 'Комиссия эквайринга' | 'ეკვაირინგის საკომისიო' |
| `payList.bank` | (n: string) => `банк ${n}` | (n: string) => `ბანკი ${n}` |
| `payList.stated` | 'выписка ✓' | 'ამონაწერი ✓' |
| `payList.mine` | 'Мои платежи' | 'ჩემი გადახდები' |
| `payList.filters` | 'Фильтры' | 'ფილტრები' |
| `statements.through` | (d: string) => `по ${d}` | (d: string) => `${d}-მდე` |
| `statements.lastUpload` | (d: string) => `последняя: ${d}` | (d: string) => `ბოლო: ${d}` |
| `statements.daysAgo` | (n: number) => (n === 0 ? 'сегодня' : `${n} дн. назад`) | (n: number) => (n === 0 ? 'დღეს' : `${n} დღის წინ`) |
| `statements.never` | 'не загружалась' | 'არ ჩატვირთულა' |
| `statements.staleNote` | (n: number) => `Больше ${n} дней без выписки — загрузите свежую.` | (n: number) => `${n} დღეზე მეტია ამონაწერი არ ჩატვირთულა — ჩატვირთეთ ახალი.` |
| `statements.tooBig` | (size: string, limit: string) => `Файл ${size} — больше ${limit}. Выгрузите из банка период короче, например месяц.` | (size: string, limit: string) => `ფაილი ${size}-ია — ${limit}-ზე მეტი. ბანკიდან ჩამოტვირთეთ უფრო მოკლე პერიოდი, მაგალითად თვე.` |
| `statements.notStatement` | 'Это не выписка BOG или TBC. Нужен CSV из интернет-банка: StatementExport.csv — BOG, transactions_history.csv — TBC.' | 'ეს არ არის BOG-ის ან TBC-ის ამონაწერი. საჭიროა CSV ინტერნეტბანკიდან: StatementExport.csv — BOG, transactions_history.csv — TBC.' |
| `statements.allKnown` | 'Все строки этого файла уже загружены. Новых нет.' | 'ამ ფაილის ყველა ხაზი უკვე ჩატვირთულია. ახალი არაფერია.' |
| `statements.previewRecorded` | 'Совпало с внесёнными вручную' | 'დაემთხვა ხელით გატარებულს' |
| `statements.previewRules` | 'Привяжут правила' | 'წესები მიაბამს' |
| `statements.previewQueue` | 'Уйдут в «Разобрать»' | 'წავა «დასახარისხებელში»' |
| `statements.previewInOut` | 'Поступлений · списаний' | 'შემოსავალი · ჩამოწერა' |
| `statements.loadN` | (n: number) => `Загрузить ${n} строк` | (n: number) => `${n} ხაზის ჩატვირთვა` |
| `statements.otherFile` | 'Другой файл' | 'სხვა ფაილი' |
| `statements.doneN` | (n: number) => `Загружено ${n} строк` | (n: number) => `ჩაიტვირთა ${n} ხაზი` |
| `statements.doneSummary` | (r: number, m: number, q: number) => `${r} совпали с внесёнными · ${m} привязаны правилами · ${q} ждут разбора` | (r: number, m: number, q: number) => `${r} დაემთხვა გატარებულს · ${m} წესებით მიება · ${q} ელოდება დახარისხებას` |
| `statements.sortN` | (n: number) => `Разобрать ${n}` | (n: number) => `დახარისხება ${n}` |
| `statements.uploads` | 'Загрузки' | 'ჩატვირთვები' |
| `errors.codes.bad_channel` | 'Залог возвращают наличными или переводом.' | 'დეპოზიტი ბრუნდება ნაღდით ან გადარიცხვით.' |
| `errors.codes.buyback_void` | 'Выкуп вернул мопед в парк — его не аннулируют отсюда.' | 'უკან გამოსყიდვამ მოპედი პარკში დააბრუნა — აქედან არ უქმდება.' |
| `errors.codes.deposit_has_line` | 'У этого взноса в банк уже есть строка выписки.' | 'ბანკში ამ შეტანას უკვე აქვს ამონაწერის ხაზი.' |
| `errors.codes.future_date` | 'Платёж нельзя записать будущей датой.' | 'გადახდას მომავალი თარიღით ვერ ჩაწერთ.' |
| `errors.codes.handover_decided` | 'По этой сдаче кассы уже решено.' | 'ამ ჩაბარებაზე უკვე გადაწყვეტილია.' |
| `errors.codes.handover_not_found` | 'Такой сдачи нет. Обновите кассу.' | 'ასეთი ჩაბარება არ არის. განაახლეთ სალარო.' |
| `errors.codes.incoming_line` | 'Поступление не может быть расходом компании.' | 'შემოსავალი კომპანიის ხარჯი ვერ იქნება.' |
| `errors.codes.not_customer_repair` | 'Этот ремонт за счёт компании, не клиента.' | 'ეს შეკეთება კომპანიის ხარჯზეა და არა კლიენტის.' |
| `errors.codes.not_matched` | 'Эта строка ни к чему не привязана.' | 'ეს ხაზი არაფერს არ არის მიბმული.' |
| `errors.codes.over_held` | 'Вернуть больше, чем залога на руках, нельзя.' | 'ხელზე არსებულ დეპოზიტზე მეტს ვერ დააბრუნებთ.' |
| `errors.codes.over_on_hand` | 'Это больше, чем у вас на руках.' | 'ეს მეტია, ვიდრე ხელზე გაქვთ.' |
| `errors.codes.over_open` | 'Это больше, чем осталось заплатить за ремонт.' | 'ეს მეტია, ვიდრე შეკეთებისთვის დარჩა გადასახდელი.' |
| `errors.codes.owner_only` | 'Это делает только владелец.' | 'ამას მხოლოდ მფლობელი აკეთებს.' |
| `errors.codes.owner_only_backdate` | 'Прошлой датой записывает только владелец. Менеджер записывает сегодняшним днём.' | 'წარსული თარიღით მხოლოდ მფლობელი წერს. მენეჯერი დღევანდელით წერს.' |
| `errors.codes.payment_has_line` | 'У этого платежа уже есть строка выписки.' | 'ამ გადახდას უკვე აქვს ამონაწერის ხაზი.' |
| `errors.codes.service_not_found` | 'Такого ремонта нет.' | 'ასეთი შეკეთება არ არის.' |
| `errors.codes.undo_too_late` | 'Отменить уже нельзя. Владелец может аннулировать платёж с причиной.' | 'გაუქმება უკვე გვიანია. მფლობელს შეუძლია გადახდის ანულირება მიზეზით.' |

## 12.10.2026 — одна новая строка в «Разобрать» (ADR-0018)

Написана не носителем языка. «გადმოტანა» [gadmotana] — слово, которым отчёт «Неделя» уже называет перенос
аренды («გადმოტანამდე გადახდილი» [gadmotanamde gadakhdili]); «გადახდილია» [gadakhdilia] — подпись «Оплачено
по» в карточке аренды.

| Ключ | RU | EN | KA | Чтение |
|---|---|---|---|---|
| `sort.reason.beforeTransfer(день)` | Аренда перенесена 11.10.2026: эта оплата могла уже войти в «Оплачено по». Проверьте, прежде чем привязывать. | The rental was carried over on 11.10.2026: this payment may already be inside “Paid through”. Check before attaching. | ქირაობა გადმოტანილია 11.10.2026: ეს გადახდა შეიძლება უკვე ჩათვლილია „გადახდილია“-ში. მიბმამდე შეამოწმეთ. | kiraoba gadmotanilia …: es gadakhda sheidzleba ukve chatvlilia „gadakhdilia“-shi. mibmamde sheamotsmet. |
| `sort.byCard(сумма, комиссия)` | Оплата картой: клиент заплатил 200.00 ₾, комиссия банка 3.00 ₾. | Card payment: the customer paid 200.00 ₾, the bank kept 3.00 ₾. | ბარათით გადახდა: კლიენტმა გადაიხადა 200.00 ₾, ბანკის საკომისიო 3.00 ₾. | baratit gadakhda: klientma gadaikhada …, bankis sakomisio …. |
| `sort.byCardPlain` | Оплата картой. | Card payment. | ბარათით გადახდა. | baratit gadakhda. |

## 13.10.2026 — «Отложено» в «Разобрать»: список и «Вернуть в очередь»

Написано не носителем языка. «გადადებული» [gadadebuli] — от «ხაზი გადაიდო» [khazi gadaido], которым журнал уже
называет отложенную строку.

| Ключ | RU | EN | KA | Чтение |
|---|---|---|---|---|
| `sort.aside(n)` | Отложено за месяц: 3 | Set aside this month: 3 | გადადებული თვეში: 3 | gadadebuli tveshi |
| `sort.show` | показать | show | ჩვენება | chveneba |
| `sort.asideTitle` | Отложенные строки | Set aside | გადადებული ხაზები | gadadebuli khazebi |
| `sort.asideSub(n)` | За месяц · 3 | This month · 3 | თვეში · 3 | tveshi |
| `sort.asideEmpty` | За месяц ничего не отложено. | Nothing has been set aside this month. | ამ თვეში არაფერი გადადებულა. | am tveshi araperi gadadebula |
| `sort.asideNotOurs(причина)` | Это не наше: учтено при переносе | Not ours: counted at the carry-over | ეს ჩვენი არ არის: … | es chveni ar aris |
| `sort.asideExpense` | Расход компании. | Company expense. | კომპანიის ხარჯი. | kompaniis kharji |
| `sort.restore` | Вернуть в очередь | Back to the queue | რიგში დაბრუნება | rigshi dabruneba |
| `sort.restored` | Строка вернулась в «Разобрать» | The line is back in “Sort” | ხაზი დაბრუნდა «დასახარისხებელში» | khazi dabrunda «dasakharisskhebelshi» |
| `errors.codes.not_set_aside` | Эта строка не отложена. Обновите список. | This line is not set aside. Refresh the list. | ეს ხაზი გადადებული არ არის. განაახლეთ სია. | es khazi gadadebuli ar aris. ganaakhlet sia |
| журнал `statement.line.restore` | Строка возвращена в очередь | A line was put back into the queue | ხაზი რიგში დაბრუნდა | khazi rigshi dabrunda |

## 14.10.2026 — Bank of Georgia по API: строка на карточке банка в «Выписках»

Написано не носителем языка. «ამონაწერი» [amonatseri] — слово, которым экран «Выписки» уже называет выписку;
«ხაზი» [khazi] — строка выписки, как в «Разобрать». Причины отказа подставляются в строки `silentSince`,
`silentNever` и `nightFailed` после двоеточия.

| Ключ | RU | EN | KA | Чтение |
|---|---|---|---|---|
| `bogApi.freshAt(дата, время)` | Выписка приходит сама (Business Online). Банк ответил 14.10.2026 в 14:05. | The statement comes by itself (Business Online). The bank last answered 14.10.2026, 14:05. | ამონაწერი ავტომატურად მოდის (Business Online). ბანკის ბოლო პასუხი: 14.10.2026, 14:05. | amonatseri avtomaturad modis … bankis bolo pasukhi |
| `bogApi.waiting` | Выписка приходит сама (Business Online). Первый ответ банка — в течение пяти минут. | … The bank’s first answer comes within five minutes. | … ბანკის პირველი პასუხი — ხუთ წუთში. | bankis pirveli pasukhi — khut tsutshi |
| `bogApi.noAccount` | Подключение к Business Online не закончено: не задан счёт. Пока выписку загружайте файлом. | The Business Online link is not finished: no account is set. Until then, load statements as files. | Business Online-თან კავშირი ბოლომდე არ არის გამართული: ანგარიში არ არის მითითებული. მანამდე ამონაწერი ფაილით ატვირთეთ. | … kavshiri bolomde ar aris gamartuli: angarishi ar aris mititebuli. manamde amonatseri pailit atvirtet |
| `bogApi.silentSince(причина, дата, время)` | Business Online не отвечает: … Последний ответ — 14.10.2026 в 14:05. | Business Online is not answering: … Last answer 14.10.2026, 14:05. | Business Online არ პასუხობს: … ბოლო პასუხი: 14.10.2026, 14:05. | ar pasukhobs … bolo pasukhi |
| `bogApi.silentNever(причина)` | Business Online не отвечает: … Ответа ещё не было ни разу. | … It has not answered once yet. | Business Online არ პასუხობს: … პასუხი ჯერ არ ყოფილა. | pasukhi jer ar qopila |
| `bogApi.nightFailed(причина)` | Полная выписка за ночь не пришла: … Система спросит её снова следующей ночью. | The full statement for the night did not come: … It is asked for again the next night. | ღამის სრული ამონაწერი არ მოვიდა: … სისტემა მას მომდევნო ღამეს ისევ მოითხოვს. | ghamis sruli amonatseri ar movida … momdevno ghames isev moitkhovs |
| `bogApi.why.unauthorized` | банк не принял ключи | the bank did not accept the keys | ბანკმა გასაღებები არ მიიღო | bankma gasaghebebi ar miigho |
| `bogApi.why.forbidden` | у ключей нет доступа к счёту | the keys have no access to the account | გასაღებებს ანგარიშზე წვდომა არ აქვს | gasaghebebs angarishze tsvdoma ar akvs |
| `bogApi.why.not_found` | банк не знает такого счёта | the bank does not know the account | ბანკმა ასეთი ანგარიში არ იცის | bankma aseti angarishi ar itsis |
| `bogApi.why.rate_limited` | слишком много запросов | too many requests | ძალიან ბევრი მოთხოვნა | dzalian bevri motkhovna |
| `bogApi.why.http`, `bad_answer` | банк ответил не так, как ожидалось | the bank answered unexpectedly | ბანკმა მოულოდნელად უპასუხა | bankma moulodnelad upasukha |
| `bogApi.why.network` | нет связи с банком | no connection to the bank | ბანკთან კავშირი არ არის | banktan kavshiri ar aris |
| `bogApi.why.no_account` | не задан счёт | no account is set | ანგარიში არ არის მითითებული | angarishi ar aris mititebuli |
| журнал `statement.pull` | Строки Bank of Georgia пришли сами | Bank of Georgia lines came in by themselves | Bank of Georgia-ს ხაზები ავტომატურად შემოვიდა | … khazebi avtomaturad shemovida |

## 15.10.2026 — форма денег: «Банк уже прислал эту сумму» (B11-03)

Написано не носителем языка. «გატარებულია» [gatarebulia] — слово, которым «Разобрать» уже называет записанный
платёж («ჰგავს, უკვე გატარებულია»); «მიბმა» [mibma] — «привязать», как в «მიბმა … -ზე»; «ხაზი» [khazi] — строка
выписки; «გადარიცხვა» [gadaritskhva] — перевод.

| Ключ | RU | EN | KA | Чтение |
|---|---|---|---|---|
| `inBank.title` | Банк уже прислал эту сумму | The bank has already sent this sum | ბანკმა ეს თანხა უკვე გამოგზავნა | bankma es tankha ukve gamogzavna |
| `inBank.credited(сумма)` | банк зачислил 315.20 ₾ | the bank credited 315.20 ₾ | ბანკმა ჩარიცხა 315.20 ₾ | bankma charitskha |
| `inBank.paidAs(номер)` | Уже записано: платёж по R-00491 | Already recorded: the payment for R-00491 | უკვე გატარებულია: R-00491-ის გადახდა | ukve gatarebulia: …-is gadakhda |
| `inBank.paidAsPlain` | Уже записано платежом этого клиента | Already recorded as this customer’s payment | უკვე გატარებულია ამ კლიენტის გადახდად | ukve gatarebulia am klientis gadakhdad |
| `inBank.waits` | Ждёт в «Разобрать» | Waiting in “Sort” | ელოდება «დასახარისხებელში» | elodeba «dasakharisskhebelshi» |
| `inBank.attach` | Привязать эту строку (главная кнопка) | Attach this line | ამ ხაზის მიბმა | am khazis mibma |
| `inBank.another` | Это другой перевод — записать (кнопка) | This is another transfer — record it | ეს სხვა გადარიცხვაა — ჩაწერა | es skhva gadaritskhvaa — chatsera |
| `inBank.pick` | Эту (из нескольких строк — какую привязать) | This one | ეს | es |
| `inBank.choose` | Выберите, какую строку привязать. | Choose which line to attach. | აირჩიეთ, რომელი ხაზი მივაბათ. | airchiet, romeli khazi mivabat |
| `inBank.attached(сумма, номер)` | Строка банка привязана: 320.00 ₾ · R-00491 | Bank line attached: 320.00 ₾ · R-00491 | ბანკის ხაზი მიება: 320.00 ₾ · R-00491 | bankis khazi mieba |
| `errors.codes.bank_line_exists` | Банк уже прислал эту сумму. Привяжите его строку или отметьте, что это другой перевод. | The bank has already sent this sum. Attach its line, or mark that this is another transfer. | ბანკმა ეს თანხა უკვე გამოგზავნა. მიაბით მისი ხაზი ან მონიშნეთ, რომ ეს სხვა გადარიცხვაა. | … miabit misi khazi an monishnet, rom es skhva gadaritskhvaa |

## 15.10.2026 — штраф на аренде и «Разделить» на неделю, учтённую при переносе (ADR-0023)

Написано не носителем языка. «ჯარიმა» [jarima] — штраф; «გადმოტანა» [gadmotana] — перенос, как в «Неделе».

| Ключ | RU | EN | KA | Чтение |
|---|---|---|---|---|
| `rentalMoney.charges.fine` | Штраф | Fine | ჯარიმა | jarima |
| `rental.fine` | Начислить штраф | Charge a fine | ჯარიმის დარიცხვა | jarimis daritskhva |
| `rental.fineAmount` | Сумма | Amount | თანხა | tankha |
| `rental.fineReason` | За что | What for | რისთვის | ristvis |
| `rental.fineReasonHint` | Обязательно: например, «повреждение мопеда» или «грязный мопед». | … | სავალდებულოა: მაგალითად, «მოპედის დაზიანება» ან «ჭუჭყიანი მოპედი». | savaldebuloa … mopedis dazianeba an chuchkiani mopedi |
| `rental.fineHint` | Штраф войдёт в долг клиента. Оплатить его — «Принять деньги» или «Разделить» строку банка. | … | ჯარიმა კლიენტის დავალიანებას დაემატება. მისი გადახდა — «ფულის მიღება» ან ბანკის ხაზის «გაყოფა». | jarima klientis davalianebas daemateba … |
| `rental.fineDone` | Штраф начислен | Fine charged | ჯარიმა დაერიცხა | jarima daeritskha |
| `rental.fineVoid` | Снять штраф | Take the fine back | ჯარიმის მოხსნა | jarimis mokhsna |
| `rental.fineVoidReason` | Почему снимаете | Why it is taken back | რატომ იხსნება | ratom ikhsneba |
| `rental.fineVoidDone` | Штраф снят | Fine taken back | ჯარიმა მოიხსნა | jarima moikhsna |
| ошибки `charge_not_found`, `week_not_carried`, `week_has_bank_money`, `split_over_charge`, `split_carried_week`, `fine_paid` | см. `ru.ts` | see `en.ts` | см. `ka.ts` | — |
| журнал `rental.charge.add` / `.void` | Начислен штраф / Штраф снят | A fine was charged / taken back | ჯარიმა დაერიცხა / მოიხსნა | — |

## 15.10.2026, вечер — «Разделить» проще: аренда с выбором для старого платежа, штраф прямо в окне

Написано не носителем языка. Строки `sort.splitCarried…` из записи выше заменены этими.

| Ключ | RU | EN | KA | Чтение |
|---|---|---|---|---|
| `sort.splitRent(R)` | R-00002 · аренда | R-00002 · rent | R-00002 · ქირა | kira |
| `sort.splitFineNew(R)` | R-00002 · штраф | R-00002 · fine | R-00002 · ჯარიმა | jarima |
| `sort.splitFineReason` | За что штраф | What the fine is for | რისთვისაა ჯარიმა | ristvisaa jarima |
| `sort.splitOldQ(дата)` | Платёж от 08.10.2026 пришёл до переноса аренды. Эти деньги — | This payment of … came before the rental was carried over. The money is: | 08.10.2026-ის გადახდა ქირაობის გადმოტანამდე მოვიდა. ეს თანხა — | … gadakhda kiraobis gadmotanamde movida. es tankha — |
| `sort.splitOldCarried(с, по)` | за неделю 08.10.2026–14.10.2026: она уже отмечена оплаченной при переносе | for the week …, already marked paid at the carry-over | კვირისთვისაა …: ის გადმოტანისას უკვე გადახდილად მოინიშნა | kviristvisaa …: is gadmotanisas ukve gadakhdilad moinishna |
| `sort.splitOldNew` | новая оплата: закроет то, что клиент должен сейчас | new money — it pays what the customer owes now | ახალი გადახდაა: დაფარავს იმას, რაც კლიენტს ახლა მართებს | akhali gadakhdaa: dapharavs imas, rats kliens akhla martebs |
| `sort.splitOldPick` | Отметьте, за что деньги аренды: … | Mark what the rent money is: … | მონიშნეთ, რისთვისაა ქირის თანხა: … | monishnet, ristvisaa kiris tankha |

## 15.10.2026, поздно — «Разделить», вариант «В» (подробный итог словами)

Написано не носителем языка. Строки `sort.splitRent`, `splitFineNew`, `splitFineReason`, `splitOldQ`, `splitOldCarried`,
`splitOldNew`, `splitFine`, `splitHint`, `splitRest` из записей выше удалены — их заменили эти.

| Ключ | RU | KA | Чтение |
|---|---|---|---|
| `sort.splitFrom` | перевод от 08.10.2026 · TBC | გადარიცხვა 08.10.2026 · TBC | gadaritskhva |
| `sort.splitRentTitle` / `splitFineTitle` / `splitFineFor` | Аренда / Штраф / За что | ქირა / ჯარიმა / რისთვის | kira / jarima / ristvis |
| `sort.splitWhichWeek` | За какую неделю? | რომელი კვირისთვისაა? | romeli kviristvisaa |
| `sort.splitWeekCarried` | уже отмечена оплаченной при переносе — эти деньги и есть её оплата | გადმოტანისას უკვე გადახდილად მოინიშნა — ეს თანხა სწორედ მისი გადახდაა | … |
| `sort.splitWeekOpen` | к оплате сейчас | ახლა გადასახდელი | akhla gadasakhdeli |
| `sort.splitWeekNewTitle` / `Sub` | Новая оплата / пойдёт в следующие недели | ახალი გადახდა / მომდევნო კვირებში წავა | … |
| `sort.splitOldPick` | Отметьте, за какую неделю аренда. | მონიშნეთ, რომელი კვირის ქირაა. | … |
| `sort.splitMore` | + ещё: ремонт, на счёт клиента | + კიდევ: შეკეთება, კლიენტის ანგარიში | kidev: shekheteba |
| `sort.splitAllPlaced` | всё разнесено ✓ | ყველაფერი განაწილდა ✓ | qvelaperi ganatsilda |
| `sort.resTitle` | Что запишется | რა ჩაიწერება | ra chaitsereba |
| `sort.resCarried` | 150 ₾ — оплата недели 08.10–14.10 по R-00002. Неделя и так была оплаченной, теперь у неё есть платёж из банка. | … კვირა ისედაც გადახდილი იყო, ახლა მას ბანკის გადახდა აქვს. | … |
| `sort.resRent` / `resRentAhead` | 150 ₾ — аренда R-…, начиная с недели … / в счёт следующих недель | ქირა …, კვირიდან … / მომდევნო კვირების ანგარიშში | … |
| `sort.resFine` | 200 ₾ — штраф «поломка» по R-…, сразу оплачен. | ჯარიმა «…», …, მაშინვე გადახდილი. | … |
| `sort.resCharge` / `resRepair` / `resSale` / `resAccount` | … / оплата ремонта … / оплата продажи … / на счёт клиента: уйдёт в следующие недели | … | … |
| `sort.resDebtSame` / `resDebt` | Долг клиента не изменится: 150 ₾. / Долг клиента: было …, станет … | კლიენტის დავალიანება არ შეიცვლება / იყო …, გახდება … | … |
