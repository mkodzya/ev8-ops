# Продажа товаров (issue #11) — грузинские строки: на вычитку

Дата: 23.10.2026. Разработчик. Строки написал не носитель языка; читает Kardu. Источник — `apps/web/src/i18n/goods.ts`
(рядом — русский и английский текст каждой строки), ключи в `en.ts` / `ru.ts` / `ka.ts` (вкладка, действие, вид
платежа, подпись цены склада, отказы сервера), `wave4.ts` (`feedWords` — журнал), `wave6-week.ts` (строка недели) и
текст счёта PDF (`apps/api/src/lib/pdf/goodsInvoice.ts`, английский там мелко рядом). Решение Mika «А» от
23.10.2026 (ADR-0045): цена товара окончательная, НДС внутри — отсюда «დღგ-ს ჩათვლით» [dghg-s chatvlit] в цене и
«მათ შორის დღგ» [mat shoris dghg] в итоге.

Одно понятие — одно слово (issue #9): «Товары» — «საქონელი» [sakoneli] и для вкладки, и для вида платежа, и для строки
недели; запись — «საქონლის გაყიდვა» [sakonlis gaqidva], а «Продать товар» — то же «საქონლის გაყიდვა»: кнопка и запись
называются одинаково, как «მოპედის გაყიდვა» [mopedis gaqidva] у мопеда. Покупатель без карточки — «საცალო მყიდველი»
[satsalo mqidveli]. Остаток на складе — «ნაშთი» [nashti], пересчёт — «ინვენტარიზაცია» [inventarizatsia], как в
«Складе»; зарядка — «დამტენი» [damteni], как в «Батареи и зарядки». Чтение — латиницей, без знаков абруптива.

Вопросы к Kardu:
1. «Продать товар» и запись «Продажа товаров» — одно «საქონლის გაყიდვა». Нужна ли кнопке глагольная форма
   («საქონლის გაყიდვა» → «გაყიდე საქონელი» [gaqide sakoneli])?
2. «Счёт» на бумаге — «ინვოისი» [invoisi]. Или «ანგარიში» [angarishi] / «ანგარიშ-ფაქტურა» [angarish-paktura]? Это не
   налоговая фактура RS.ge — её ведёт Polaris; слово не должно её напоминать.
3. Код компании на счёте — «ს/კ» [s/k], как в шапке договора («ს/ნ» [s/n] там же стоит у компании). Какое сокращение
   верное для идентификационного кода юрлица?
4. «Открыто» в таблице — «გადასახდელი» [gadasakhdeli] («к оплате»). Так понятнее, чем «ღია» [ghia]?

## Экраны (`goods.ts`)

| Ключ | RU | KA | Чтение |
|---|---|---|---|
| `goods.title` | Товары | საქონელი | sakoneli |
| `goods.count(…)` | 2 продажи | 2 გაყიდვა | 2 gaqidva |
| `goods.record` | Продажа товаров | საქონლის გაყიდვა | sakonlis gaqidva |
| `goods.retail` | Розничный покупатель | საცალო მყიდველი | satsalo mqidveli |
| `goods.sell` | Продать товар | საქონლის გაყიდვა | sakonlis gaqidva |
| `goods.awaiting(…)` | Ждут оплаты 2 · 100.00 ₾ | ელოდება გადახდას 2 · 100.00 ₾ | elodeba gadakhdas 2 · 100.00 ₾ |
| `goods.segments.all` | Все | ყველა | qvela |
| `goods.segments.open` | Ждут оплаты | ელოდება გადახდას | elodeba gadakhdas |
| `goods.segments.cancelled` | Отменены | გაუქმებული | gaukmebuli |
| `goods.search` | Номер, покупатель, товар | ნომერი, მყიდველი, საქონელი | nomeri, mqidveli, sakoneli |
| `goods.none` | Товаров ещё не продавали | საქონელი ჯერ არ გაყიდულა | sakoneli jer ar gaqidula |
| `goods.states.paid` | Оплачена | გადახდილია | gadakhdilia |
| `goods.states.waiting_bank` | Ждёт банк | ელოდება ბანკს | elodeba banks |
| `goods.states.owes` | Долг | ვალი | vali |
| `goods.states.cancelled` | Отменена | გაუქმებულია | gaukmebulia |
| `goods.cols.number` | Номер | ნომერი | nomeri |
| `goods.cols.soldOn` | Дата | თარიღი | tarighi |
| `goods.cols.buyer` | Покупатель | მყიდველი | mqidveli |
| `goods.cols.items` | Товары | საქონელი | sakoneli |
| `goods.cols.total` | Итого | ჯამი | jami |
| `goods.cols.open` | Открыто | გადასახდელი | gadasakhdeli |
| `goods.cols.state` | Статус | სტატუსი | statusi |
| `goods.more(…)` | ещё 2 | კიდევ 2 | kidev 2 |
| `goods.wizard.steps[0]` | Что продаём | რას ვყიდით | ras vqidit |
| `goods.wizard.steps[1]` | Кому | ვის | vis |
| `goods.wizard.steps[2]` | Оплата и итог | გადახდა და ჯამი | gadakhda da jami |
| `goods.wizard.find` | Название или артикул | დასახელება ან არტიკული | dasakheleba an artikuli |
| `goods.wizard.charger` | Зарядка | დამტენი | damteni |
| `goods.wizard.inShowroom(…)` | в шоуруме 2 | შოურუმში 2 | shourumshi 2 |
| `goods.wizard.onShelf(…)` | на складе 2 | საწყობში 2 | satsqobshi 2 |
| `goods.wizard.fewer` | На одну меньше | ერთით ნაკლები | ertit naklebi |
| `goods.wizard.more` | На одну больше | ერთით მეტი | ertit meti |
| `goods.wizard.price` | Цена с НДС | ფასი დღგ-ს ჩათვლით | pasi dghg-s chatvlit |
| `goods.wizard.shelfPrice(…)` | по складу 100.00 ₾ | საწყობის ფასი 100.00 ₾ | satsqobis pasi 100.00 ₾ |
| `goods.wizard.noShelfPrice` | На складе цены нет — укажите | საწყობში ფასი არ არის — მიუთითეთ | satsqobshi pasi ar aris — miutitet |
| `goods.wizard.model` | Модель | მოდელი | modeli |
| `goods.wizard.modelHint` | Как написано на ней: 73V6A | როგორც მასზე წერია: 73V6A | rogorts masze tseria: 73V6A |
| `goods.wizard.cost` | Себестоимость штуки | ერთის თვითღირებულება | ertis tvitghirebuleba |
| `goods.wizard.margin(…)` | маржа 100.00 ₾ | მარჟა 100.00 ₾ | marzha 100.00 ₾ |
| `goods.wizard.belowCost` | Цена ниже себестоимости | ფასი თვითღირებულებაზე დაბალია | pasi tvitghirebulebaze dabalia |
| `goods.wizard.remove` | Убрать | ამოღება | amogheba |
| `goods.wizard.shortManager(…)` | На складе 2 — продать сверх остатка может владелец | საწყობში 2 — ნაშთზე მეტის გაყიდვა მხოლოდ მფლობელს შეუძლია | satsqobshi 2 — nashtze metis gaqidva mkholod mplobels sheudzlia |
| `goods.wizard.shortReason` | Почему сверх остатка | რატომ ნაშთზე მეტი | ratom nashtze meti |
| `goods.wizard.countQuestion(…)` | Пересчёт 15.10.2026 уже не видел этот товар? | 15.10.2026-ის ინვენტარიზაციამ ეს საქონელი უკვე ვეღარ ნახა? | 15.10.2026-is inventarizatsiam es sakoneli ukve veghar nakha? |
| `goods.wizard.countYes` | Да — остаток не трогать | კი — ნაშთს არ შევეხოთ | ki — nashts ar shevekhot |
| `goods.wizard.countNo` | Нет — списать с остатка | არა — ნაშთიდან ჩამოვწეროთ | ara — nashtidan chamovtserot |
| `goods.wizard.pickHint` | Выберите, что продаём: позицию склада или зарядку. | აირჩიეთ, რას ვყიდით: საწყობის პოზიცია ან დამტენი. | airchiet, ras vqidit: satsqobis pozitsia an damteni. |
| `goods.wizard.picked(…)` | выбрано 2 | არჩეულია 2 | archeulia 2 |
| `goods.wizard.nothingFound` | На складе такого нет | საწყობში ასეთი არ არის | satsqobshi aseti ar aris |
| `goods.wizard.ours` | Наш клиент | ჩვენი კლიენტი | chveni klienti |
| `goods.wizard.buyerName` | Имя, если назвал | სახელი, თუ თქვა | sakheli, tu tkva |
| `goods.wizard.buyerPhone` | Телефон, если назвал | ტელეფონი, თუ თქვა | teleponi, tu tkva |
| `goods.wizard.findCustomer` | Имя или телефон | სახელი ან ტელეფონი | sakheli an teleponi |
| `goods.wizard.owes(…)` | долг 100.00 ₾ | ვალი 100.00 ₾ | vali 100.00 ₾ |
| `goods.wizard.how.cash` | Наличными | ნაღდით | naghdit |
| `goods.wizard.how.acquiring` | Картой | ბარათით | baratit |
| `goods.wizard.how.transfer` | Переводом | გადარიცხვით | gadaritskhvit |
| `goods.wizard.how.later` | Позже — в долг | მოგვიანებით — ვალად | mogvianebit — valad |
| `goods.wizard.cashAmount` | Наличными получено | ნაღდით მიღებული | naghdit mighebuli |
| `goods.wizard.bankHint` | Владелец привяжет строку банка в «Разобрать». | ბანკის ხაზს მფლობელი მიაბამს «დასახარისხებელში». | bankis khazs mplobeli miabams «dasakhariskhebelshi». |
| `goods.wizard.bankLines` | Банк уже прислал эту сумму | ბანკმა ეს თანხა უკვე გამოგზავნა | bankma es tankha ukve gamogzavna |
| `goods.wizard.itsThis` | Это она | ეს არის | es aris |
| `goods.wizard.notYet` | Ещё не пришла | ჯერ არ მოსულა | jer ar mosula |
| `goods.wizard.retailMustPay` | Розничный покупатель платит сразу или ждёт банк | საცალო მყიდველი იხდის მაშინვე ან ელოდება ბანკს | satsalo mqidveli ikhdis mashinve an elodeba banks |
| `goods.wizard.soldOn` | Дата продажи | გაყიდვის თარიღი | gaqidvis tarighi |
| `goods.wizard.backdateReason` | Почему задним числом | რატომ წინა თარიღით | ratom tsina tarighit |
| `goods.wizard.lines` | Товары | საქონელი | sakoneli |
| `goods.wizard.total(…)` | Итого 100.00 ₾ · в т. ч. НДС 18 % 15.25 ₾ | ჯამი 100.00 ₾ · მათ შორის დღგ 18 % 15.25 ₾ | jami 100.00 ₾ · mat shoris dghg 18 % 15.25 ₾ |
| `goods.wizard.restNone` | Остаток 0 | ნაშთი 0 | nashti 0 |
| `goods.wizard.restDebt(…)` | Долг клиента после продажи 100.00 ₾ | კლიენტის ვალი გაყიდვის შემდეგ 100.00 ₾ | klientis vali gaqidvis shemdeg 100.00 ₾ |
| `goods.wizard.restBank(…)` | Ждёт банк 100.00 ₾ | ელოდება ბანკს 100.00 ₾ | elodeba banks 100.00 ₾ |
| `goods.wizard.confirm(…)` | Продать за 100.00 ₾ | გაყიდვა 100.00 ₾-ად | gaqidva 100.00 ₾-ad |
| `goods.wizard.done(…)` | Продано 2 | გაყიდულია 2 | gaqidulia 2 |
| `goods.card.buyer` | Покупатель | მყიდველი | mqidveli |
| `goods.card.goods` | Товары | საქონელი | sakoneli |
| `goods.card.money` | Деньги | ფული | puli |
| `goods.card.documents` | Документы | დოკუმენტები | dokumentebi |
| `goods.card.feed` | Что было | რა მოხდა | ra mokhda |
| `goods.card.bank` | Строки банка, похожие на эту оплату | ბანკის ხაზები, ამ გადახდის მსგავსი | bankis khazebi, am gadakhdis msgavsi |
| `goods.card.waits(…)` | ждёт 100.00 ₾ | ელოდება 100.00 ₾ | elodeba 100.00 ₾ |
| `goods.card.paidAll(…)` | 100.00 ₾ оплачено | 100.00 ₾ გადახდილია | 100.00 ₾ gadakhdilia |
| `goods.card.byShelf(…)` | по складу 130 ₾ → 100 ₾ | საწყობის ფასი 130 ₾ → 100 ₾ | satsqobis pasi 130 ₾ → 100 ₾ |
| `goods.card.byCount` | Списано пересчётом | ჩამოწერილია ინვენტარიზაციით | chamotserilia inventarizatsiit |
| `goods.card.beyond(…)` | Сверх остатка: … | ნაშთზე მეტი: … | nashtze meti: … |
| `goods.card.cost(…)` | себестоимость 100.00 ₾ | თვითღირებულება 100.00 ₾ | tvitghirebuleba 100.00 ₾ |
| `goods.card.margin(…)` | маржа 100.00 ₾ | მარჟა 100.00 ₾ | marzha 100.00 ₾ |
| `goods.card.noCost` | себестоимость неизвестна | თვითღირებულება უცნობია | tvitghirebuleba utsnobia |
| `goods.card.total` | Итого | ჯამი | jami |
| `goods.card.vat` | в т. ч. НДС 18 % | მათ შორის დღგ 18 % | mat shoris dghg 18 % |
| `goods.card.net` | Без НДС | დღგ-ს გარეშე | dghg-s gareshe |
| `goods.card.paid` | Оплачено | გადახდილი | gadakhdili |
| `goods.card.open` | Открыто | გადასახდელი | gadasakhdeli |
| `goods.card.fates.paid` | Оплачено | გადახდილია | gadakhdilia |
| `goods.card.fates.credit` | Стал авансом | გახდა ავანსი | gakhda avansi |
| `goods.card.fates.voided` | Аннулирован | გაუქმებულია | gaukmebulia |
| `goods.card.noPayments` | Денег пока нет. | ფული ჯერ არ არის. | puli jer ar aris. |
| `goods.card.attach` | Привязать | მიბმა | mibma |
| `goods.card.take` | Принять деньги | ფულის მიღება | pulis migheba |
| `goods.card.invoice` | Счёт PDF | ინვოისი PDF | invoisi PDF |
| `goods.card.menuCancel` | Отменить продажу | გაყიდვის გაუქმება | gaqidvis gaukmeba |
| `goods.card.menuBuyer` | Изменить покупателя | მყიდველის შეცვლა | mqidvelis shetsvla |
| `goods.card.notFound` | Продажа не найдена | გაყიდვა ვერ მოიძებნა | gaqidva ver moidzebna |
| `goods.card.back` | ← Товары | ← საქონელი | ← sakoneli |
| `goods.card.undoneAtOnce` | отменено сразу | გაუქმდა მაშინვე | gaukmda mashinve |
| `goods.card.cancelledOn(…)` | Отменена 15.10.2026 · … | გაუქმდა 15.10.2026 · … | gaukmda 15.10.2026 · … |
| `goods.card.soldBy(…)` | Продал … | გაყიდა … | gaqida … |
| `goods.card.line(…)` | TBC 15.10.2026 · 100.00 ₾ | TBC 15.10.2026 · 100.00 ₾ | TBC 15.10.2026 · 100.00 ₾ |
| `goods.card.notes` | Заметка | შენიშვნა | shenishvna |
| `goods.card.promised(…)` | Остаток придёт картой | ნაშთი მოვა ბარათით | nashti mova baratit |
| `goods.card.promisedHow.acquiring` | картой | ბარათით | baratit |
| `goods.card.promisedHow.transfer` | переводом | გადარიცხვით | gadaritskhvit |
| `goods.cancel.title(…)` | Отменить продажу 2 | 2 გაყიდვის გაუქმება | 2 gaqidvis gaukmeba |
| `goods.cancel.button(…)` | Отменить продажу 2 | 2 გაყიდვის გაუქმება | 2 gaqidvis gaukmeba |
| `goods.cancel.reason` | Почему | რატომ | ratom |
| `goods.cancel.back(…)` | … × 2 вернётся на остаток (3 → 4) | … × 2 დაბრუნდება ნაშთზე (3 → 4) | … × 2 dabrundeba nashtze (3 → 4) |
| `goods.cancel.credit(…)` | 100.00 ₾ станут авансом клиента | 100.00 ₾ გახდება კლიენტის ავანსი | 100.00 ₾ gakhdeba klientis avansi |
| `goods.cancel.creditPays(…)` | и погасят … | და დაფარავს: … | da daparavs: … |
| `goods.cancel.creditLeft(…)` | 100.00 ₾ останутся авансом | 100.00 ₾ დარჩება ავანსად | 100.00 ₾ darcheba avansad |
| `goods.cancel.void(…)` | Платёж 100.00 ₾ картой аннулируется | გადახდა 100.00 ₾ ბარათით გაუქმდება | gadakhda 100.00 ₾ baratit gaukmdeba |
| `goods.cancel.lineBack(…)` | строка TBC 08.10 · 98.50 ₾ вернётся в «Разобрать» | ხაზი TBC 08.10 · 98.50 ₾ დაბრუნდება «დასახარისხებელში» | khazi TBC 08.10 · 98.50 ₾ dabrundeba «dasakhariskhebelshi» |
| `goods.cancel.tillOut(…)` | уйдёт из кассы: … | გავა სალაროდან: … | gava salarodan: … |
| `goods.cancel.refuse` | Этот платёж — часть разнесённой строки банка: сначала отвяжите строку в «Разобрать». | ეს გადახდა ბანკის განაწილებული ხაზის ნაწილია: ჯერ ხაზი მოხსენით «დასახარისხებელში». | es gadakhda bankis ganatsilebuli khazis natsilia: jer khazi mokhsenit «dasakhariskhebelshi». |
| `goods.cancel.done(…)` | 2 отменена | 2 გაუქმდა | 2 gaukmda |
| `goods.edit.title` | Покупатель | მყიდველი | mqidveli |
| `goods.edit.name` | Имя | სახელი | sakheli |
| `goods.edit.phone` | Телефон | ტელეფონი | teleponi |
| `goods.edit.notes` | Заметка | შენიშვნა | shenishvna |
| `goods.edit.hint` | Выданный счёт уйдёт в архив, следующий напечатается с новым именем. | გაცემული ინვოისი არქივში გადავა, შემდეგი ახალი სახელით დაიბეჭდება. | gatsemuli invoisi arkivshi gadava, shemdegi akhali sakhelit daibechdeba. |
| `goods.sort.reason(…)` | 2 · … · ждёт 100.00 ₾ · продано 15.10.2026 · картой | 2 · … · ელოდება 100.00 ₾ · გაიყიდა 15.10.2026 · ბარათით | 2 · … · elodeba 100.00 ₾ · gaiqida 15.10.2026 · baratit |
| `goods.sort.part` | Товары | საქონელი | sakoneli |
| `goods.sort.res(…)` | 130 ₾ — оплата товаров 2. | 130 ₾ — საქონლის 2 გადახდა. | 130 ₾ — sakonlis 2 gadakhda. |
| `goods.sort.retailMode` | Розничные продажи товаров | საქონლის საცალო გაყიდვები | sakonlis satsalo gaqidvebi |
| `goods.sort.retailHint` | Дневная строка карт может быть несколькими покупками | დღის ბარათების ერთი ხაზი შეიძლება რამდენიმე შენაძენი იყოს | dghis baratebis erti khazi sheidzleba ramdenime shenadzeni iqos |
| `goods.sort.retailNone` | Розничных продаж, ждущих денег, нет. | ფულის მომლოდინე საცალო გაყიდვა არ არის. | pulis momlodine satsalo gaqidva ar aris. |
| `goods.sort.more` | + ещё: розничные продажи товаров | + კიდევ: საქონლის საცალო გაყიდვები | + kidev: sakonlis satsalo gaqidvebi |
| `goods.moves.sold(…)` | Продажа 2 | გაყიდვა 2 | gaqidva 2 |
| `goods.moves.returned(…)` | Отмена продажи 2 | 2 გაყიდვის გაუქმება | 2 gaqidvis gaukmeba |
| `goods.moves.found(…)` | Нашлась при продаже 2 | აღმოჩნდა 2 გაყიდვისას | aghmochnda 2 gaqidvisas |
| `goods.part.sell` | Продать | გაყიდვა | gaqidva |
| `goods.part.sales` | Продажи | გაყიდვები | gaqidvebi |
| `goods.part.none` | Ещё не продавалась | ჯერ არ გაყიდულა | jer ar gaqidula |
| `goods.batteries.sell` | Продать зарядку | დამტენის გაყიდვა | damtenis gaqidva |
| `goods.customer.purchases` | Покупки | შენაძენები | shenadzenebi |
| `goods.customer.none` | Покупок нет | შენაძენი არ არის | shenadzeni ar aris |
| `goods.economics.title` | Товары | საქონელი | sakoneli |
| `goods.economics.periods.month` | Этот месяц | ეს თვე | es tve |
| `goods.economics.periods.last` | Прошлый месяц | წინა თვე | tsina tve |
| `goods.economics.periods.all` | Всё время | მთელი დრო | mteli dro |
| `goods.economics.qty` | Продано, шт. | გაყიდულია, ცალი | gaqidulia, tsali |
| `goods.economics.gross` | Выручка с НДС | შემოსავალი დღგ-ით | shemosavali dghg-it |
| `goods.economics.vat` | НДС | დღგ | dghg |
| `goods.economics.net` | Без НДС | დღგ-ს გარეშე | dghg-s gareshe |
| `goods.economics.cost` | Себестоимость | თვითღირებულება | tvitghirebuleba |
| `goods.economics.margin` | Маржа | მარჟა | marzha |
| `goods.economics.item` | Позиция | პოზიცია | pozitsia |
| `goods.economics.unknown(…)` | Без себестоимости: 2 строки на 100.00 ₾ без НДС — в маржу не вошли | თვითღირებულების გარეშე: 2 ხაზი 100.00 ₾-ზე დღგ-ს გარეშე — მარჟაში არ შევიდა | tvitghirebulebis gareshe: 2 khazi 100.00 ₾-ze dghg-s gareshe — marzhashi ar shevida |
| `goods.economics.none` | За этот период товаров не продавали. | ამ პერიოდში საქონელი არ გაყიდულა. | am periodshi sakoneli ar gaqidula. |
| `goods.economics.fee` | Комиссия за карту — расход компании, она видна в неделе. | ბარათის საკომისიო კომპანიის ხარჯია: ის კვირაში ჩანს. | baratis sakomisio kompaniis kharjia: is kvirashi chans. |
| `goods.values.stockFrom.shelf` | со склада | საწყობიდან | satsqobidan |
| `goods.values.stockFrom.count` | пересчётом | ინვენტარიზაციით | inventarizatsiit |
| `goods.values.status.active` | активна | აქტიური | aktiuri |
| `goods.values.status.cancelled` | отменена | გაუქმებული | gaukmebuli |

## Соседние словари

| Ключ | RU | KA | Чтение |
|---|---|---|---|
| `shell.actions.sellGoods` | Продать товар | საქონლის გაყიდვა | sakonlis gaqidva |
| `shell.tabs.goods` | Товары | საქონელი | sakoneli |
| `searchUi.groups.goods` | Товары | საქონელი | sakoneli |
| `searchUi.hint (часть)` | R-, SL-, TS-, PO-, SV-номер | R-, SL-, TS-, PO-, SV-ნომერი | R-, SL-, TS-, PO-, SV-nomeri |
| `money.kinds.goods` | Товары | საქონელი | sakoneli |
| `money.payGoods(…)` | Оплата товаров · TS-00001 | საქონლის გადახდა · TS-00001 | sakonlis gadakhda · TS-00001 |
| `money.closeGoods(…)` | Товары TS-00001 | საქონელი TS-00001 | sakoneli TS-00001 |
| `stock.salePrice` | Цена для клиента с НДС | ფასი კლიენტისთვის, დღგ-ით | pasi klientistvis, dghg-it |
| `paymentPage.acts.rebook` | стал авансом после отмены продажи товаров | გახდა ავანსი საქონლის გაყიდვის გაუქმებისას | gakhda avansi sakonlis gaqidvis gaukmebisas |
| `weekReport.inGoods` | Поступило — товары | შემოსული — საქონელი | shemosuli — sakoneli |
| `feedWords.goods_sale.create` | Проданы товары | საქონელი გაიყიდა | sakoneli gaiqida |
| `feedWords.goods_sale.price` | Цена изменена при продаже | ფასი შეიცვალა გაყიდვისას | pasi sheitsvala gaqidvisas |
| `feedWords.goods_sale.minus` | Продано сверх остатка | გაიყიდა ნაშთზე მეტი | gaiqida nashtze meti |
| `feedWords.goods_sale.update` | Изменён покупатель | მყიდველი შეიცვალა | mqidveli sheitsvala |
| `feedWords.goods_sale.invoice` | Выдан счёт | ინვოისი გაიცა | invoisi gaitsa |
| `feedWords.goods_sale.cancel` | Продажа товаров отменена | საქონლის გაყიდვა გაუქმდა | sakonlis gaqidva gaukmda |
| `feedWords.goods_sale.undo` | Продажа товаров отменена сразу | საქონლის გაყიდვა მაშინვე გაუქმდა | sakonlis gaqidva mashinve gaukmda |
| `feedWords.payment.rebook` | Платёж стал авансом | გადახდა ავანსი გახდა | gadakhda avansi gakhda |

## Отказы сервера (`errors.codes`)

| Код | RU | KA | Чтение |
|---|---|---|---|
| `goods_no_lines` | Укажите, что продаём. | მიუთითეთ, რას ვყიდით. | miutitet, ras vqidit. |
| `goods_too_many_lines` | В одной продаже не больше 20 строк. | ერთ გაყიდვაში არაუმეტეს 20 ხაზისა. | ert gaqidvashi araumetes 20 khazisa. |
| `goods_line_bad` | Строка — это позиция склада или зарядка, что-то одно. | ხაზი არის საწყობის პოზიცია ან დამტენი — ერთ-ერთი. | khazi aris satsqobis pozitsia an damteni — ert-erti. |
| `goods_bad_qty` | Количество — от 1 до 999. | რაოდენობა — 1-დან 999-მდე. | raodenoba — 1-dan 999-mde. |
| `goods_same_item` | Один товар дважды: сведите в одну строку. | ერთი და იგივე საქონელი ორჯერ: გააერთიანეთ ერთ ხაზად. | erti da igive sakoneli orjer: gaaertianet ert khazad. |
| `goods_item_not_found` | Такой позиции нет. | ასეთი პოზიცია არ არის. | aseti pozitsia ar aris. |
| `goods_item_archived` | Позиция в архиве, её не продают. | პოზიცია არქივშია, არ იყიდება. | pozitsia arkivshia, ar iqideba. |
| `goods_item_not_sellable` | Этот товар пока не продаётся. | ეს საქონელი ჯერ არ იყიდება. | es sakoneli jer ar iqideba. |
| `goods_count_answer` | Скажите, видел ли пересчёт этот товар. | თქვით, ნახა თუ არა ინვენტარიზაციამ ეს საქონელი. | tkvit, nakha tu ara inventarizatsiam es sakoneli. |
| `goods_short` | Столько нет. Продать сверх остатка может только владелец. | ამდენი არ არის. ნაშთზე მეტს მხოლოდ მფლობელი ყიდის. | amdeni ar aris. nashtze mets mkholod mplobeli qidis. |
| `retail_must_pay` | Розничный покупатель платит сразу или ждёт банк. | საცალო მყიდველი იხდის მაშინვე ან ელოდება ბანკს. | satsalo mqidveli ikhdis mashinve an elodeba banks. |
| `goods_paid_over` | Это больше, чем стоит продажа. | ეს მეტია, ვიდრე გაყიდვის ღირებულება. | es metia, vidre gaqidvis ghirebuleba. |
| `goods_sale_not_found` | Такой продажи товаров нет. | საქონლის ასეთი გაყიდვა არ არის. | sakonlis aseti gaqidva ar aris. |
| `goods_sale_closed` | Эта продажа товаров отменена. | საქონლის ეს გაყიდვა გაუქმებულია. | sakonlis es gaqidva gaukmebulia. |
| `goods_over_open` | Это больше, чем осталось заплатить за товары. | ეს მეტია, ვიდრე საქონლისთვის დარჩა გადასახდელი. | es metia, vidre sakonlistvis darcha gadasakhdeli. |
| `split_over_goods` | Эта часть больше, чем осталось заплатить за товары. | ეს ნაწილი მეტია, ვიდრე საქონლისთვის დარჩა გადასახდელი. | es natsili metia, vidre sakonlistvis darcha gadasakhdeli. |
| `goods_payment_in_split` | Её платёж — часть разнесённой строки банка: сначала отвяжите строку в «Разобрать». | მისი გადახდა ბანკის განაწილებული ხაზის ნაწილია: ჯერ ხაზი მოხსენით «დასახარისხებელში». | misi gadakhda bankis ganatsilebuli khazis natsilia: jer khazi mokhsenit «dasakhariskhebelshi». |
| `goods_undo_too_late` | Отменить сразу уже поздно: продажу отменит владелец с причиной. | მაშინვე გაუქმება უკვე გვიანია: გაყიდვას მფლობელი გააუქმებს მიზეზით. | mashinve gaukmeba ukve gviania: gaqidvas mplobeli gaaukmebs mizezit. |

## Счёт PDF (`goodsInvoice.ts`)

Грузинский — главный, английский мелко рядом. Русского в счёте нет; русский здесь — только для сверки.

| Где | RU (для сверки) | KA | Чтение |
|---|---|---|---|
| Заголовок | Счёт · Invoice | ინვოისი | invoisi |
| Отменённая продажа | Отменена · Cancelled · dd/mm/yyyy | გაუქმებულია · Cancelled | gaukmebulia · Cancelled |
| Отменена продавцом сразу | Отменена сразу · Undone at once | გაუქმდა მაშინვე | gaukmda mashinve |
| Колонка: продавец | Продавец · Seller | გამყიდველი | gamqidveli |
| Колонка: покупатель | Покупатель · Buyer | მყიდველი | mqidveli |
| Покупатель без карточки | Розничный покупатель · Retail buyer | საცალო მყიდველი | satsalo mqidveli |
| Код компании | ИНН 412785721 | ს/კ 412785721 | s/k 412785721 |
| Директор | Директор: … | დირექტორი: … | direktori: … |
| Таблица: наименование | Наименование · Item | დასახელება | dasakheleba |
| Таблица: единица | Ед. · Unit | ერთ. | ert. |
| Таблица: количество | Кол-во · Qty | რაოდ. | raod. |
| Таблица: цена | Цена с НДС · Price incl. VAT | ფასი დღგ-ს ჩათვლით | pasi dghg-s chatvlit |
| Таблица: сумма | Сумма · Amount | თანხა | tankha |
| Итог без НДС | Итого без НДС · Total excl. VAT | ჯამი დღგ-ს გარეშე | jami dghg-s gareshe |
| НДС | НДС 18% · VAT 18% | დღგ 18% | dghg 18% |
| К оплате | Всего к оплате · Total incl. VAT | სულ გადასახდელი | sul gadasakhdeli |
| Под итогом | Цены включают НДС · Prices include VAT | ფასები მოიცავს დღგ-ს | pasebi moitsavs dghg-s |
| Кто выдал | Выдал · Issued by | გაცემულია | gatsemulia |
