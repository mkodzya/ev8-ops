# «Заменить мопед» — грузинские строки: на вычитку

Дата: 21.10.2026. Разработчик. Строки написал не носитель языка. Слова взяты из словаря продукта:
«მოპედი» [mopedi] («мопед»), «გაცემა» [gatsema] («выдача»), «დაბრუნება» [dabruneba] («возврат»), «გარბენი»
[garbeni] («пробег»), «ქირა» [kira] («аренда»), «რემონტი» [remonti] («ремонт»), «პირობების შეცვლა»
[pirobebis shetsvla] («Изменить условия»). Источники — `apps/web/src/i18n/rental-swap.ts`, `actKind` в
`ka.ts`, `feedWords` в `wave4.ts`, `errors.codes` в `ka.ts`. Правило — ADR-0040. Рядом с каждой строкой —
русский текст и чтение латиницей в квадратных скобках.

## Новые строки

| Ключ | RU | KA | Чтение | Где видно |
|---|---|---|---|---|
| `swap.menu`, `swap.title`, `swap.finish` | Заменить мопед / Замена мопеда | მოპედის შეცვლა | mopedis shetsvla | пункт меню «⋯» аренды, заголовок мастера, кнопка в итоге |
| `swap.steps.out` | Сдаёт | აბრუნებს | abrunebs | шаг 1 мастера |
| `swap.steps.in` | Берёт | იღებს | ighebs | шаг 2 |
| `swap.steps.where` | Старый мопед | ძველი მოპედი | dzveli mopedi | шаг 3 |
| `swap.steps.summary` | Итог | შეჯამება | shejameba | шаг 4 |
| `swap.has` | Сейчас у клиента | ახლა კლიენტთან | akhla klienttan | шаг 1, строка с текущим мопедом |
| `swap.since(дата)` | с 04.10.2026 | 04.10.2026-დან | -dan | там же |
| `swap.swappedOn` | Дата замены | შეცვლის თარიღი | shetsvlis tarighi | поле даты |
| `swap.reason` | Почему меняем мопед | რატომ იცვლება მოპედი | ratom itsvleba mopedi | поле причины |
| `swap.reasonHint` | Обязательно. Уйдёт в журнал и в историю обоих мопедов — например, «отказали тормоза» или «клиент попросил». | სავალდებულოა. ჩაიწერება ჟურნალში და ორივე მოპედის ისტორიაში — მაგალითად, «მუხრუჭები გაფუჭდა» ან «კლიენტმა ითხოვა». | savaldebuloa. chaitsereba zhurnalshi da orive mopedis istoriashi — magalitad, «mukhruchebi gaputchda» an «klientma itkhova». | подсказка под причиной |
| `swap.outOdometer` | Пробег сдаваемого мопеда, км | დაბრუნებული მოპედის გარბენი, კმ | dabrunebuli mopedis garbeni, km | поле пробега, шаг 1 |
| `swap.outOdometerBelow` | Меньше, чем при выдаче этого мопеда: с таким пробегом замену не оформить. | ამ მოპედის გაცემისას ჩაწერილზე ნაკლებია: ასეთი გარბენით შეცვლა არ ფორმდება. | am mopedis gatsemisas chatserilze naklebia: aseti garbenit shetsvla ar pormdeba. | шаг 1, под пробегом, если он меньше, чем при выдаче |
| `swap.kitHint` | Батареи и зарядки остаются у клиента. Если их число меняется — «Изменить условия». | ბატარეები და დამტენები კლიენტთან რჩება. თუ მათი რაოდენობა იცვლება — «პირობების შეცვლა». | batareebi da damtenebi klienttan rcheba. tu mati raodenoba itsvleba — «pirobebis shetsvla». | под мопедом и ключом |
| `swap.outPhotos` | Фото сдаваемого мопеда | დაბრუნებული მოპედის ფოტო | dabrunebuli mopedis poto | фото, шаг 1 |
| `swap.outCondition` | Состояние сдаваемого мопеда | დაბრუნებული მოპედის მდგომარეობა | dabrunebuli mopedis mdgomareoba | поле, шаг 1 |
| `swap.pick` | Какой мопед берёт клиент | რომელ მოპედს იღებს კლიენტი | romel mopeds ighebs klienti | шаг 2, над списком |
| `swap.inOdometer` | Пробег выдаваемого мопеда, км | გაცემული მოპედის გარბენი, კმ | gatsemuli mopedis garbeni, km | поле пробега, шаг 2 |
| `swap.inPhotos` | Фото выдаваемого мопеда: спереди, сзади, слева, справа | გაცემული მოპედის ფოტო: წინ, უკან, მარცხნივ, მარჯვნივ | gatsemuli mopedis poto: tsin, ukan, martskhniv, marjvniv | фото, шаг 2 |
| `swap.inCondition` | Состояние выдаваемого мопеда, повреждения | გაცემული მოპედის მდგომარეობა, დაზიანებები | gatsemuli mopedis mdgomareoba, dazianebebi | поле, шаг 2 |
| `swap.openJob(№)` | На этом мопеде уже открыт ремонт SV-00001: мопед уходит в него, выбирать не нужно. | ამ მოპედზე უკვე გახსნილია რემონტი SV-00001: მოპედი მასში გადადის, არჩევა საჭირო არ არის. | am mopedze ukve gakhsnilia remonti …: mopedi mashi gadadis, archeva sachiro ar aris. | шаг 3 |
| `swap.stays` | Не меняются: номер аренды, её недели, залог, долг и день оплаты. | არ იცვლება: ქირის ნომერი, მისი კვირები, დეპოზიტი, ვალი და გადახდის დღე. | ar itsvleba: kiris nomeri, misi kvirebi, depoziti, vali da gadakhdis dghe. | итог |
| `swap.contractNote` | Договор будет нарисован заново с новым VIN и снова ждёт подписи клиента; подписанная копия остаётся в архиве, отметка «Подписан в Signify» снимается. | ხელშეკრულება თავიდან შედგება ახალი VIN-ით და კვლავ ელოდება კლიენტის ხელმოწერას; ხელმოწერილი ასლი არქივში რჩება, მონიშვნა „ხელმოწერილია Signify-ში“ იხსნება. | khelshekruleba tavidan shedgeba akhali VIN-it da kvlav elodeba klientis khelmotseras; khelmotserili asli arkivshi rcheba, monishvna „khelmotserilia Signify-shi“ ikhsneba. | итог |
| `swap.sumDate` | Дата | თარიღი | tarighi | итог |
| `swap.sumReason` | Почему | რატომ | ratom | итог |
| `swap.sumOut` | Сдаёт | აბრუნებს | abrunebs | итог |
| `swap.sumIn` | Берёт | იღებს | ighebs | итог |
| `swap.sumWhere` | Старый мопед | ძველი მოპედი | dzveli mopedi | итог |
| `swap.sumKey(сумма)` | Ключ не вернули: 250 ₾ по договору (§6) | გასაღები არ დაბრუნდა: 250 ₾ ხელშეკრულებით (§6) | gasaghebi ar dabrunda: … khelshekrulebit | шаг 1 и итог, если ключ «не вернули» |
| `swap.sumContract` | Договор | ხელშეკრულება | khelshekruleba | итог |
| `swap.done` | Мопед заменён | მოპედი შეიცვალა | mopedi sheitsvala | «Готово» |
| `swap.doneLine(№)` | Аренда R-00001 продолжается на мопеде | ქირა R-00001 გრძელდება მოპედით | kira … grdzeldeba mopedit | «Готово», перед номером и VIN нового мопеда |
| `swap.doneFree(точка)` | Старый мопед свободен · точка | ძველი მოპედი თავისუფალია · … | dzveli mopedi tavisupalia | «Готово» |
| `swap.doneRepair(№)` | Старый мопед в ремонте SV-00001 | ძველი მოპედი რემონტშია: SV-00001 | dzveli mopedi remontshia | «Готово» и итог |
| `swap.photosFailed` | Не все фото дошли до сервера. Замена оформлена, но в актах их нет — перед подписью проверьте §3 договора (фото). | ყველა ფოტო არ აიტვირთა. შეცვლა გაფორმებულია, მაგრამ აქტებში ისინი არ არის — ხელმოწერამდე შეამოწმეთ ხელშეკრულების §3 (ფოტო). | kvela poto ar aitvirta. shetsvla gapormebulia, magram aktebshi isini ar aris — khelmotseramde sheamotsmet khelshekrulebis §3 (poto). | «Готово», над договором, если фото не дошли |
| `swap.openRepair` | Открыть ремонт | რემონტის გახსნა | remontis gakhsna | кнопка «Готово» |
| `swap.contract` | Договор с новым мопедом | ხელშეკრულება ახალ მოპედზე | khelshekruleba akhal mopedze | «Готово», строка договора на подпись |
| `swap.earlier` | Раньше | ადრე | adre | карточка аренды, прежние мопеды |
| `swap.mark` | замена | შეცვლა | shetsvla | карточка мопеда, рядом с датой в списке аренд |
| `swap.changed` | заменён | შეცვლილია | shetsvlilia | карточка мопеда, вместо статуса аренды |
| `swap.editHint` | Мопед идущей аренды меняется через «Заменить мопед» в меню. | მიმდინარე ქირის მოპედი იცვლება მენიუში — «მოპედის შეცვლა». | mimdinare kiris mopedi itsvleba meniushi — «mopedis shetsvla». | «Изменить условия» |
| `rental.actKind.swap_out` | Акт замены: мопед сдан | შეცვლის აქტი: მოპედი დაბრუნდა | shetsvlis akti: mopedi dabrunda | акты и лента аренды |
| `rental.actKind.swap_in` | Акт замены: мопед выдан | შეცვლის აქტი: მოპედი გაიცა | shetsvlis akti: mopedi gaitsa | акты и лента аренды |
| `feedWords['rental.swap']` | Мопед заменён | მოპედი შეიცვალა | mopedi sheitsvala | журнал, история аренды |
| `errors.codes.same_vehicle` | Этот мопед уже у клиента. Выберите другой. | ეს მოპედი უკვე კლიენტთანაა. აირჩიეთ სხვა. | es mopedi ukve klienttanaa. airchiet skhva. | отказ сервера |
| `errors.codes.swap_before_last_event` | Дата замены раньше того, что уже записано в истории одного из мопедов. Выберите дату позже. | შეცვლის თარიღი უფრო ადრეა, ვიდრე ერთ-ერთი მოპედის ისტორიაში უკვე ჩაწერილი. აირჩიეთ უფრო გვიანი თარიღი. | shetsvlis tarighi upro adrea, vidre ert-erti mopedis istoriashi ukve chatserili. airchiet upro gviani tarighi. | отказ сервера |
| `errors.codes.swap_no_vehicle` | У этой аренды ещё нет мопеда. Сначала укажите его в «Изменить условия». | ამ ქირას ჯერ მოპედი არ აქვს. ჯერ მიუთითეთ ის «პირობების შეცვლაში». | am kiras jer mopedi ar akvs. jer miutitet is «pirobebis shetsvlashi». | отказ сервера, мастер без мопеда |

## Изменённая строка

| Ключ | Было (KA) | Стало (KA) | Чтение | RU |
|---|---|---|---|---|
| `errors.codes.vehicle_already_set` | ამ იჯარას მოპედი უკვე აქვს. | ამ იჯარას მოპედი უკვე აქვს. მის შესაცვლელად — «მოპედის შეცვლა» მენიუში. | am ijaras mopedi ukve akvs. mis shesatsvlelad — «mopedis shetsvla» meniushi. | У этой аренды уже есть мопед. Сменить его — «Заменить мопед» в меню. |

## Вопросы к Kardu

1. «Аренда» в продукте пишется и «ქირა» [kira] (меню, статус), и «იჯარა» [ijara] (часть отказов сервера). Здесь —
   «ქირა», кроме строки, которая уже была с «იჯარა». Какое слово правильное для «аренды мопеда»?
2. «Ремонт» — «რემონტი» [remonti], как в «Ремонт открыт черновиком» при возврате; в отказах сервера встречается
   «შეკეთება» [sheketeba]. Какое привычнее механику и менеджеру?
3. «Сдаёт» и «берёт» в шагах — «აბრუნებს» [abrunebs] («возвращает») и «იღებს» [ighebs] («получает»). Понятно ли с
   телефона без пояснения, что это про клиента?

## Заменено issue #9 (23.10.2026)

Терминология интерфейса выровнена по issue #9: одно понятие — одно слово (слова Kardu, патч принят Mika
23.10.2026; список и правило — `docs/qa/issue-9-one-word-one-thing-ka-strings.md`). Строки выше, которые
изменились:

| Ключ | Было | Стало | Чтение | RU |
|---|---|---|---|---|
| `swap.outCondition` | დაბრუნებული მოპედის მდგომარეობა | დაბრუნებული მოპედის ტექნიკური მდგომარეობა | dabrunebuli mop'edis t'eknik'uri mdgomareoba | Техсостояние сдаваемого мопеда |
| `swap.inCondition` | გაცემული მოპედის მდგომარეობა, დაზიანებები | გაცემული მოპედის ტექნიკური მდგომარეობა, დაზიანებები | gatsemuli mop'edis t'eknik'uri mdgomareoba, dazianebebi | Техсостояние выдаваемого мопеда, повреждения |
| `errors.codes.vehicle_already_set` | ამ იჯარას მოპედი უკვე აქვს. … | ამ ქირაობას მოპედი უკვე აქვს. მის შესაცვლელად — «მოპედის შეცვლა» მენიუში. | am kiraobas mop'edi uk've akvs. … | (без изменений) |

Вопрос 1 закрыт: аренда — «ქირაობა» [kiraoba], «იჯარა» не используется нигде (п. 41).
