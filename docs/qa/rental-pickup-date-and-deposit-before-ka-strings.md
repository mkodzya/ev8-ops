# «Дата выдачи» и «Залог получен раньше» — грузинские строки: на вычитку

Дата: 23.10.2026. Разработчик. Строки написал не носитель языка. Слова «გაცემის თარიღი» [gatsemis tarighi] («дата
выдачи»), «კვირა» [kvira] («неделя»), «დეპოზიტი» [depoziti] («залог»), «დავალიანება» [davalianeba] («долг»),
«გადახდილია» [gadakhdilia] («оплачено по»), «ქირის ავანსი» [kiris avansi] («аванс по аренде»), «დაკავებულია»
[dakavebulia] («удержано»), «მიზეზი» [mizezi] («причина»), «სავალდებულოა» [savaldebuloa] («обязательно») взяты из
словаря продукта; «ადრე მიღებული» [adre mighebuli] («получен раньше») и «მოიხსნება» [moikhsneba] («уйдёт», о неделе)
— новые. Источники — `apps/web/src/i18n/pickup-date.ts`, `errors.codes` в `apps/web/src/i18n/ka.ts`, `feedWords` в
`apps/web/src/i18n/wave4.ts`. Правило — ADR-0044. Рядом с каждой строкой — русский текст и чтение латиницей в
квадратных скобках. Примеры в строках выдуманы: аренда R-…, выдача 11.10 → 15.10, тариф 150 ₾, залог 180 ₾.

Правило «одно понятие — одно слово» (issue #9) соблюдено: залог возвращают, а не «выдают» — поэтому вопрос мастера
выдачи говорит «после начала аренды» («ქირაობის დაწყების შემდეგ»), а не «после выдачи», как было в задаче: строка о
залоге со словом «გაცემა» не проходит `npm run guard:words`.

## Лист «Дата выдачи» (`pickupDate`)

| Ключ | RU | KA | Чтение | Где видно |
|---|---|---|---|---|
| `action` | Дата выдачи | გაცემის თარიღი | gatsemis tarighi | пункт меню «⋯» карточки аренды; поле даты |
| `title(R-…)` | Дата выдачи · R-… | გაცემის თარიღი · R-… | gatsemis tarighi | заголовок листа |
| `intro` | Недели посчитаются заново от новой даты. У каждой недели остаются её номер и деньги на ней; неделя, которая по новой дате ещё не началась, уйдёт, а её деньги лягут по общему правилу. Акт выдачи и история мопеда получат новую дату. | კვირები ახალი თარიღიდან თავიდან დაითვლება. ყოველ კვირას რჩება თავისი ნომერი და მასზე არსებული თანხა; კვირა, რომელიც ახალი თარიღით ჯერ არ დაწყებულა, მოიხსნება, მისი თანხა კი საერთო წესით განაწილდება. გაცემის აქტი და მოპედის ისტორია ახალ თარიღს მიიღებს. | kvirebi akhali tarighidan tavidan daitvleba. qovel kviras rcheba tavisi nomeri da masze arsebuli tankha; kvira, romelits akhali tarighit jer ar datsqebula, moikhsneba, misi tankha ki saerto tsesit ganatsildeba. gatsemis akti da mopedis istoria akhal tarighs miighebs. | подсказка в начале листа |
| `dateHint(11.10.2026)` | Сейчас 11.10.2026. Не позже сегодня. | ახლა 11.10.2026. არაუგვიანეს დღევანდელი დღისა. | akhla 11.10.2026. araugvianes dghevandeli dghisa. | подсказка под датой |
| `paidBefore` | Оплачено до EV8 Ops по | EV8 Ops-მდე გადახდილია | EV8 Ops-mde gadakhdilia | поле у аренды, начатой до EV8 Ops |
| `paidBeforeHint(17.10.2026)` | Было 17.10.2026: выберите конец недели по новым датам. | იყო 17.10.2026: აირჩიეთ კვირის ბოლო ახალი თარიღებით. | iqo 17.10.2026: airchiet kviris bolo akhali tarighebit. | подсказка под этим полем |
| `choose` | Выберите | აირჩიეთ | airchiet | пустой выбор |
| `notPaid` | Ничего не оплачено | არაფერია გადახდილი | araperia gadakhdili | вариант выбора |
| `reason` | Причина | მიზეზი | mizezi | поле причины |
| `reasonHint` | Обязательна: например, «мопед выдан 15-го, а не 11-го». | სავალდებულოა: მაგალითად, «მოპედი 15-ში გაიცა და არა 11-ში». | savaldebuloa: magalitad, «mopedi 15-shi gaitsa da ara 11-shi». | подсказка под причиной |
| `save` | Изменить дату | თარიღის შეცვლა | tarighis shetsvla | кнопка листа |
| `done` | Дата выдачи изменена | გაცემის თარიღი შეიცვალა | gatsemis tarighi sheitsvala | сообщение после записи |
| `counting` | Считаем, что изменится… | ვითვლით, რა შეიცვლება… | vitvlit, ra sheitsvleba… | пока сервер считает предпросмотр |
| `week(2)` | Неделя 2 | კვირა 2 | kvira 2 | строка недели в предпросмотре |
| `goes` | уйдёт: по новой дате ещё не началась | მოიხსნება: ახალი თარიღით ჯერ არ დაწყებულა | moikhsneba: akhali tarighit jer ar datsqebula | у недели, которой больше нет |
| `opens(18.10–24.10)` | откроется: 18.10–24.10 | გაიხსნება: 18.10–24.10 | gaikhsneba | у недели, которая откроется сразу |
| `noMoves` | Платежи не переедут: деньги остаются на тех же неделях. | გადახდები არ გადაადგილდება: თანხა იმავე კვირებზე რჩება. | gadakhdebi ar gadaadgildeba: tankha imave kvirebze rcheba. | предпросмотр, когда деньги не двигаются |
| `debt` | Долг | დავალიანება | davalianeba | строка «было → стало» |
| `payDay` | День оплаты | გადახდის დღე | gadakhdis dghe | строка под предпросмотром |
| `target.deposit(150 ₾)` | залог: 150 ₾ | დეპოზიტი: 150 ₾ | depoziti | куда легли деньги платежа |
| `target.week(1, 150 ₾)` | неделя 1: 150 ₾ | კვირა 1: 150 ₾ | kvira | то же; двоеточие — чтобы «1» и «150» не читались как 1 150 |
| `target.charge(ключ, 200 ₾)` | ключ: 200 ₾ | (слово вида начисления из словаря продукта): 200 ₾ | — | то же: начисление названо, как на карточке, — видом и примечанием |
| `target.anyCharge` | начисление | დარიცხვა | daritskhva | то же, если начисление не нашлось на карточке |
| `target.credit(150 ₾)` | аванс по аренде: 150 ₾ | ქირის ავანსი: 150 ₾ | kiris avansi | то же: деньги ещё никуда не легли |
| `journal.pickedUpOn` | выдача | გაცემა | gatsema | строка журнала, подпись пары |
| `journal.weeks` | недель | კვირები | kvirebi | то же |
| `journal.paidThrough` | оплачено по | გადახდილია | gadakhdilia | то же |
| `journal.debtTetri` | долг | დავალიანება | davalianeba | то же |
| `journal.paidBeforeThrough` | оплачено до EV8 Ops по | EV8 Ops-მდე გადახდილია | EV8 Ops-mde gadakhdilia | то же |

## Лист «Залог получен раньше» (`depositBefore`)

| Ключ | RU | KA | Чтение | Где видно |
|---|---|---|---|---|
| `action` | Получен раньше… | ადრე მიღებული… | adre mighebuli… | «⋯» в блоке «Залог» |
| `title(R-…)` | Залог получен раньше · R-… | დეპოზიტი ადრე იყო მიღებული · R-… | depoziti adre iqo mighebuli | заголовок листа |
| `intro` | Для залога, который пришёл до EV8 Ops — с прошлым мопедом, до того как аренду завели. Это не платёж: в «Пришло денег» и в кассу он не попадает, а при возврате возвращается, как и остальной залог. Что платежи положили на залог сверх его суммы, ляжет на недели, самые старые первыми. | დეპოზიტისთვის, რომელიც EV8 Ops-მდე მოვიდა — წინა მოპედთან ერთად, სანამ ქირაობა ჩაიწერებოდა. ეს გადახდა არ არის: «შემოსულ ფულში» და სალაროში არ ხვდება, დაბრუნებისას კი სხვა დეპოზიტის მსგავსად ბრუნდება. რაც გადახდებმა დეპოზიტზე მის თანხაზე მეტი დადო, კვირებზე გადავა, ყველაზე ძველიდან. | depozitistvis, romelits EV8 Ops-mde movida — tsina mopedtan ertad, sanam kiraoba chaitsereboda. es gadakhda ar aris: «shemosul pulshi» da salaroshi ar khvdeba, dabrunebisas ki skhva depozitis msgavsad brundeba. rats gadakhdebma depozitze mis tankhaze meti dado, kvirebze gadava, qvelaze dzvelidan. | подсказка в начале листа |
| `amount` | Получено раньше, GEL | ადრე მიღებული, GEL | adre mighebuli, GEL | поле суммы |
| `amountHint(180 ₾)` | Не больше залога, 180 ₾. 0 — снять отметку. | არაუმეტეს დეპოზიტისა, 180 ₾. 0 — აღნიშვნის მოხსნა. | araumetes depozitisa, 180 ₾. 0 — aghnishvnis mokhsna. | подсказка под суммой |
| `reason` | Причина | მიზეზი | mizezi | поле причины |
| `reasonHint` | Обязательна: например, «перенесён с прошлого мопеда». | სავალდებულოა: მაგალითად, «გადმოვიდა წინა მოპედიდან». | savaldebuloa: magalitad, «gadmovida tsina mopedidan». | подсказка под причиной |
| `save` | Отметить полученным раньше | ადრე მიღებულად მონიშვნა | adre mighebulad monishvna | кнопка листа |
| `undoAction` | Снять отметку | აღნიშვნის მოხსნა | aghnishvnis mokhsna | кнопка листа при сумме 0 |
| `done` | Залог отмечен полученным раньше | დეპოზიტი მონიშნულია ადრე მიღებულად | depoziti monishnulia adre mighebulad | сообщение после записи |
| `undone` | Отметка снята | აღნიშვნა მოიხსნა | aghnishvna moikhsna | сообщение после снятия |
| `freed(150 ₾)` | Из залога освободится 150 ₾ платежей — они лягут на недели, самые старые первыми. | დეპოზიტიდან გადახდების 150 ₾ თავისუფლდება და კვირებზე გადავა, ყველაზე ძველიდან. | depozitidan gadakhdebis 150 ₾ tavisupldeba da kvirebze gadava, qvelaze dzvelidan. | предпросмотр |
| `owedAgain` | Залог снова к оплате: аванс клиента и следующий платёж погасят его первым. | დეპოზიტი ისევ გადასახდელია: კლიენტის ავანსი და შემდეგი გადახდა მას პირველ რიგში დაფარავს. | depoziti isev gadasakhdelia: klientis avansi da shemdegi gadakhda mas pirvel rigshi daparavs. | предпросмотр при снятии отметки |
| `row` | Из них получено раньше | მათ შორის ადრე მიღებული | mat shoris adre mighebuli | строка в блоке «Залог» |
| `journal.receivedBeforeTetri` | получен раньше | ადრე მიღებული | adre mighebuli | строка журнала, подпись пары |
| `journal.paidTetri` | получено | მიღებული | mighebuli | то же |
| `journal.debtTetri` | долг | დავალიანება | davalianeba | то же |

## Мастер выдачи, перенос (`depositEarlier`)

| Ключ | RU | KA | Чтение | Где видно |
|---|---|---|---|---|
| `tick` | Залог получен раньше | დეპოზიტი ადრე იყო მიღებული | depoziti adre iqo mighebuli | галочка на шаге «Условия» |
| `tickHint` | только если он пришёл раньше: с прошлым мопедом или до EV8 Ops | მხოლოდ თუ ადრე მოვიდა: წინა მოპედთან ერთად ან EV8 Ops-მდე | mkholod tu adre movida: tsina mopedtan ertad an EV8 Ops-mde | рядом с галочкой |
| `ask` | Залог пришёл уже после начала аренды (банковским переводом или наличными)? | დეპოზიტი ქირაობის დაწყების შემდეგ მოვიდა (ბანკით ან ნაღდით)? | depoziti kiraobis datsqebis shemdeg movida (bankit an naghdit)? | вопрос, если выдача была не больше 21 дня назад |
| `askWhy` | Аренда началась меньше трёх недель назад — залог мог прийти с первыми деньгами. | ქირაობა სამ კვირაზე ნაკლები ხნის წინ დაიწყო — დეპოზიტი შესაძლოა პირველ თანხასთან ერთად მოვიდა. | kiraoba sam kviraze naklebi khnis tsin daitsqo — depoziti shesadzloa pirvel tankhastan ertad movida. | под вопросом |
| `cameAfter` | Да, пришёл позже | დიახ, მოგვიანებით მოვიდა | diakh, mogvianebit movida | кнопка ответа |
| `cameBefore` | Нет, получен раньше | არა, ადრე იყო მიღებული | ara, adre iqo mighebuli | кнопка ответа |
| `afterHint` | Тогда не отмечайте его, а проведите деньги платежом: строку банка — в «Разобрать», наличные — «Принять деньги». Залог погасится первым. | მაშინ არ მონიშნოთ და თანხა გადახდად ჩაწერეთ: ბანკის ხაზი — «დასახარისხებელში», ნაღდი — «ფულის მიღებით». დეპოზიტი პირველი დაიფარება. | mashin ar monishnot da tankha gadakhdad chatseret: bankis khazi — «dasakharisebelshi», naghdi — «pulis mighebit». depoziti pirveli daipareba. | после ответа «Да, пришёл позже» |

## Отказы сервера (`errors.codes`)

| Код | RU | KA | Чтение |
|---|---|---|---|
| `pickup_date_future` | Дата выдачи — не позже сегодня. | გაცემის თარიღი არ შეიძლება იყოს დღევანდელზე გვიან. | gatsemis tarighi ar sheidzleba iqos dghevandelze gvian. |
| `pickup_date_same` | У аренды уже эта дата выдачи. Выберите другую. | ქირაობას უკვე ეს გაცემის თარიღი აქვს. აირჩიეთ სხვა. | kiraobas ukve es gatsemis tarighi akvs. airchiet skhva. |
| `pickup_date_week_shifted` | По новой дате удлинённая неделя ещё не началась бы. Сначала отмените сдвиг недели. | ახალი თარიღით გადაწეული კვირა ჯერ არ დაიწყებოდა. ჯერ კვირის გადაწევა გააუქმეთ. | akhali tarighit gadatseuli kvira jer ar daitsqeboda. jer kviris gadatseva gaaukmet. |
| `pickup_date_week_discounted` | По новой дате неделя со скидкой ещё не началась бы. Сначала уберите скидку (0 в «Скидке на неделю»). | ახალი თარიღით ფასდაკლებიანი კვირა ჯერ არ დაიწყებოდა. ჯერ ფასდაკლება მოხსენით (0 «კვირის ფასდაკლებაში»). | akhali tarighit pasdaklebiani kvira jer ar daitsqeboda. jer pasdakleba mokhsenit (0 «kviris pasdaklebashi»). |
| `transfer_paid_through_week_end` | «Оплачено по» до EV8 Ops по новым датам уже не конец недели. Выберите его заново. | EV8 Ops-მდე «გადახდილია» ახალი თარიღებით კვირის ბოლო აღარ არის. აირჩიეთ თავიდან. | EV8 Ops-mde «gadakhdilia» akhali tarighebit kviris bolo aghar aris. airchiet tavidan. |
| `pickup_before_arrival` | Мопед пришёл позже этой даты. Выдача не может быть раньше его прихода. | მოპედი ამ თარიღის შემდეგ შემოვიდა. გაცემა მის შემოსვლამდე ვერ იქნება. | mopedi am tarighis shemdeg shemovida. gatsema mis shemosvlamde ver ikneba. |
| `pickup_after_swap` | Мопед заменили раньше этой даты. Выдача — до замены. | მოპედი ამ თარიღამდე შეიცვალა. გაცემა შეცვლამდეა. | mopedi am tarighamde sheitsvala. gatsema shetsvlamdea. |
| `pickup_date_history` | Дата пересекает то, что уже записано в истории мопеда. Выберите дату ближе к нынешней. | თარიღი კვეთს იმას, რაც მოპედის ისტორიაში უკვე ჩაწერილია. აირჩიეთ ახლანდელთან უფრო ახლოს მყოფი თარიღი. | tarighi kvets imas, rats mopedis istoriashi ukve chatserilia. airchiet akhlandeltan upro akhlos mqopi tarighi. |
| `deposit_before_over` | Получено раньше не может быть больше самого залога. | ადრე მიღებული თანხა დეპოზიტზე მეტი ვერ იქნება. | adre mighebuli tankha depozitze meti ver ikneba. |
| `deposit_before_same` | У залога уже отмечено, что столько получено раньше. | დეპოზიტზე უკვე აღნიშნულია, რომ ამდენი ადრე იყო მიღებული. | depozitze ukve aghnishnulia, rom amdeni adre iqo mighebuli. |
| `deposit_before_held` | Из залога уже удержано за ремонт — он не может стать меньше удержанного. | დეპოზიტიდან უკვე დაკავებულია რემონტისთვის — ის დაკავებულზე ნაკლები ვერ გახდება. | depozitidan ukve dakavebulia remontistvis — is dakavebulze naklebi ver gakhdeba. |

## Строки журнала (`feedWords`)

| Действие | RU | KA | Чтение |
|---|---|---|---|
| `rental.pickup.date` | Изменена дата выдачи | გაცემის თარიღი შეიცვალა | gatsemis tarighi sheitsvala |
| `deposit.before` | Залог отмечен полученным раньше | დეპოზიტი მონიშნულია ადრე მიღებულად | depoziti monishnulia adre mighebulad |
| `deposit.before.undo` | Снята отметка «залог получен раньше» | მოიხსნა აღნიშვნა «დეპოზიტი ადრე მიღებულია» | moikhsna aghnishvna «depoziti adre mighebulia» |

## Вопросы к Kardu

1. «ადრე მიღებული» [adre mighebuli] — «получен раньше». В мастере выдачи сумма давно подписана «EV8 Ops-მდე
   მიღებული დეპოზიტი» [EV8 Ops-mde mighebuli depoziti] («залог, полученный до EV8 Ops»). Оставить два выражения или
   одно?
2. «მოიხსნება» [moikhsneba] — о неделе, которая по новой дате ещё не началась и уходит из аренды. Понятно ли?
3. «შესაძლოა … მოვიდა» [shesadzloa … movida] в `askWhy` — правильная ли форма глагола, или нужно «მოსულიყო» [mosuliqo]?
4. «რემონტისთვის» [remontistvis] в `deposit_before_held` — как в строке залога «დაკავებულია · რემონტი»; или
   «შეკეთებისთვის» [sheketebistvis], как в остальном продукте (реестр книги, п. 120)?
5. `ask` — вопрос с ответами «Да» / «Нет»: «დეპოზიტი ქირაობის დაწყების შემდეგ მოვიდა (ბანკით ან ნაღდით)?»
   [depoziti kiraobis datsqebis shemdeg movida (bankit an naghdit)?] («Залог пришёл уже после начала аренды (банком
   или наличными)?»). Читается ли он как вопрос «да или нет», а не «банком или наличными»? Прежняя форма с тире
   («… მოვიდა — ბანკით გადარიცხვით ან ნაღდით?») читалась как выбор из двух, а кнопки отвечают «Да» и «Нет».
