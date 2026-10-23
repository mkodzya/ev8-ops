# Продажа товаров, правки после QA (ветка `feature/goods-polish`) — грузинские строки: на вычитку

Дата: 23.10.2026. Разработчик. Только строки, которые эта ветка добавила или изменила; остальные грузинские строки
продажи товаров — в [`goods-sales-ka-strings.md`](goods-sales-ka-strings.md). Строки написал не носитель языка;
читает Kardu. Источник — `apps/web/src/i18n/goods.ts` (рядом — русский и английский текст каждой строки) и
`apps/web/src/i18n/ka.ts` (`stock.negativeHint`). Чтение — латиницей, без знаков абруптива. Суммы и номера в
примерах выдуманы.

Без новых грузинских слов, повторно использованы: «კლიენტის დავალიანება: იყო …, გახდება …» [klientis davalianeba:
iqo …, gakhdeba …] (долг клиента после продажи в долг — та же строка, что в «Разнести»), «ერთის თვითღირებულება»
[ertis tvitghirebuleba] (на карточке позиции в минусе), «განაწილება» [ganatsileba] (кнопка «Разнести»), «საცალო
მყიდველი» [satsalo mqidveli] (плательщик розничной продажи в «Платежах»).

Вопросы к Kardu:
1. «Пойдут в погашение» — «წავა დასაფარად» [tsava dasaparad] («пойдёт на погашение»). Аванс гасит неделю часто только
   частично, поэтому не «დაფარავს» [daparavs] («погасит», значит целиком). Естественно ли так? Или «მოხმარდება
   დაფარვას» [mokhmardeba daparvas]?
2. Причина отмены продажи в журнале — «TS-00004 გაყიდვა გაუქმდა: …» [gaqidva gaukmda]: номер перед словом, как в
   «TS-00004 გაყიდვის გაუქმება» у движения склада. Так читается?
3. «Больше, чем ждёт TS-00003» — «ვიდრე TS-00003 ელოდება» [vidre … elodeba]. «Ждёт» о продаже, которая ждёт денег,
   как «ელოდება ბანკს» [elodeba banks] в статусе. Понятно ли без «გადახდას» [gadakhdas]?

## Мастер «Продать товар» и карточка продажи

| Ключ | RU | EN | KA | Чтение |
|---|---|---|---|---|
| `goods.wizard.margin(…)`, `goods.card.margin(…)` — изменена | маржа 53.93 ₾ за 2 шт. | margin 53.93 ₾ on 2 | მარჟა 53.93 ₾ 2 ცალზე | marzha 53.93 ₾ 2 tsalze |
| `goods.wizard.restOpen(…)` — новая | Открыто 10.00 ₾ | Open 10.00 ₾ | გადასახდელი 10.00 ₾ | gadasakhdeli 10.00 ₾ |
| `goods.wizard.restDebt(…)` — изменена | Долг по этой продаже 100.00 ₾ | Owed on this sale 100.00 ₾ | ამ გაყიდვის ვალი 100.00 ₾ | am gaqidvis vali 100.00 ₾ |
| `goods.card.cost(…)` — изменена | себестоимость 15.41 ₾ за шт. | cost 15.41 ₾ each | თვითღირებულება 15.41 ₾ ცალზე | tvitghirebuleba 15.41 ₾ tsalze |

При одной штуке маржа пишется как раньше: «მარჟა 53.93 ₾» [marzha].

## Лист «Отменить продажу»

| Ключ | RU | EN | KA | Чтение |
|---|---|---|---|---|
| `goods.cancel.creditPays(…)` — изменена | и пойдут в погашение: … | and goes towards: … | და წავა დასაფარად: … | da tsava dasaparad: … |
| `goods.cancel.paysWeek(…)` — новая | неделя 02.10–08.10 — 30.00 ₾ | week 02.10–08.10 — 30.00 ₾ | კვირა 02.10–08.10 — 30.00 ₾ | kvira 02.10–08.10 — 30.00 ₾ |
| `goods.cancel.paysDeposit(…)` — новая | залог — 30.00 ₾ | deposit — 30.00 ₾ | დეპოზიტი — 30.00 ₾ | depoziti — 30.00 ₾ |

Целиком: «30.00 ₾ გახდება კლიენტის ავანსი და წავა დასაფარად: კვირა 02.10–08.10 — 30.00 ₾» [30.00 ₾ gakhdeba klientis
avansi da tsava dasaparad: kvira …] — «30.00 ₾ станут авансом клиента и пойдут в погашение: неделя 02.10–08.10 — 30.00 ₾».

## Причина отмены — журнал, платёж, «Что было»

| Ключ | RU | EN | KA | Чтение |
|---|---|---|---|---|
| `goods.notes.cancelled(…)` — новая | Продажа TS-00004 отменена: покупатель вернул товар | Sale TS-00004 cancelled: … | TS-00004 გაყიდვა გაუქმდა: … | TS-00004 gaqidva gaukmda: … |
| `goods.notes.undone(…)` — новая | Продажа TS-00006 отменена сразу | Sale TS-00006 undone at once | TS-00006 გაყიდვა გაუქმდა მაშინვე | TS-00006 gaqidva gaukmda mashinve |

Слова того, кто отменил, после двоеточия остаются как набраны и не переводятся.

## «Разобрать»: «Куда привязать» и «Разнести»

| Ключ | RU | EN | KA | Чтение |
|---|---|---|---|---|
| `goods.sort.lessThanLine` — новая | меньше строки | less than the line | ხაზზე ნაკლები | khazze naklebi |
| `goods.sort.overOpen(…)` — новая | TS-00003 ждёт 22.30 ₾, а строка — 150.00 ₾: целиком её не привязать. Разнесите строку. | TS-00003 waits for 22.30 ₾, the line is 150.00 ₾: it cannot be attached whole. Allocate the line. | TS-00003 ელოდება: 22.30 ₾; ხაზი: 150.00 ₾. მთლიანად ვერ მიებმება — გაანაწილეთ ხაზი. | TS-00003 elodeba: 22.30 ₾; khazi: 150.00 ₾. mtlianad ver miebmeba — gaanatsilet khazi. |
| `goods.sort.partOver(…)` — новая | Больше, чем ждёт: 22.30 ₾ | More than it waits for: 22.30 ₾ | მეტია, ვიდრე ელოდება: 22.30 ₾ | metia, vidre elodeba: 22.30 ₾ |
| `goods.sort.fixOver` — новая | Часть больше долга не запишется: исправьте её. | A part above what is owed will not be written: correct it. | ვალზე მეტი ნაწილი არ ჩაიწერება: შეასწორეთ. | valze meti natsili ar chaitsereba: sheastsoret. |
| `goods.refusals.goods_over_open(…)` — новая | Это больше, чем ждёт TS-00003: осталось заплатить 22.30 ₾. | That is more than TS-00003 waits for: 22.30 ₾ is left to pay. | ეს მეტია, ვიდრე TS-00003 ელოდება: დარჩა გადასახდელი 22.30 ₾. | es metia, vidre TS-00003 elodeba: darcha gadasakhdeli 22.30 ₾. |
| `goods.refusals.split_over_goods(…)` — новая | Эта часть больше, чем ждёт TS-00003: осталось заплатить 22.30 ₾. | That part is more than TS-00003 waits for: 22.30 ₾ is left to pay. | ეს ნაწილი მეტია, ვიდრე TS-00003 ელოდება: დარჩა გადასახდელი 22.30 ₾. | es natsili metia, vidre TS-00003 elodeba: darcha gadasakhdeli 22.30 ₾. |

В `overOpen` нет падежного окончания на сумме («₾-ს» [₾-s]): строка могла бы переноситься на его дефисе.

## Склад

| Ключ | RU | EN | KA | Чтение |
|---|---|---|---|---|
| `stock.negativeHint` — изменена | Со склада ушло больше, чем на нём было, — в ремонт или в продажу. Нужна инвентаризация. | More left the shelf than it held — taken by a repair or sold. Count it. | საწყობიდან იმაზე მეტი გავიდა, ვიდრე იყო — შეკეთებაზე ან გაყიდვით. საჭიროა ინვენტარიზაცია. | satsqobidan imaze meti gavida, vidre iqo — sheketebaze an gaqidvit. sachiroa inventarizatsia. |

Было: «შეკეთებამ ჩამოწერა ნაწილები, რომლებიც საწყობში არ იყო» [sheketebam chamotsera natsilebi, romlebits
satsqobshi ar iqo] — «Ремонт списал запчасти, которых на складе не было»; в минус уводит и продажа сверх остатка.
