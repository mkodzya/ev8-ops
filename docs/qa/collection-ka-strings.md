# «Взыскание» (ADR-0054) — грузинские строки: на вычитку

Дата: 03.11.2026. Разработчик. Строки написал не носитель языка; читает Kardu. Источник —
`apps/web/src/i18n/collection.ts` (рядом — русский и английский текст каждой строки), группа «Сегодня»
(`wave4.ts`, `today.groups.collection`), журнал (`feedWords`) и ответы API (`errors.codes`) — в таблицах ниже.
Чтение — латиницей, без знаков абруптива; «…» — место, куда встаёт число, дата или сумма.

Вопросы к Kardu:
1. «Взыскание» — «დავალიანების ამოღება» [davalianebis amogheba] («взыскание долга»). Так говорят, или проще
   «ვალები» [valebi] («долги»)?
2. «Забрать мопед» — «მოპედის წამოყვანა» [mopedis tsamoqvana]. Подходит, или «მოპედის ჩამორთმევა»
   [mopedis chamortmeva] («изъятие»)?
3. «Обещал оплатить до…» — «დაჰპირდა გადახდას …-მდე» [dachpirda gadakhdas …-mde]: «…-მდე» после даты читается?

## Экран (`collection.ts`)

| Ключ | RU | KA | Чтение |
|---|---|---|---|
| `coll.title` | Взыскание | დავალიანების ამოღება | davalianebis amogheba |
| `coll.row.call` | …-й день · дозвониться и проверить GPS | ვადაგადაცილების …-ე დღე · დარეკვა და GPS-ის შემოწმება | vadagadatsilebis …-e dghe · darekva da GPS-is shemotsmeba |
| `coll.row.block` | не вышел на связь — заблокировать и забрать | არ გამოეხმაურა — დაბლოკვა და წამოყვანა | ar gamoekhmaura — dablokva da tsamoqvana |
| `coll.row.pickup` | заблокирован 2 — забрать мопед | დაიბლოკა 2 — მოპედის წამოყვანა | daibloka 2 — mopedis tsamoqvana |
| `coll.row.unblock` | оплачено — снять блок в трекере | გადახდილია — ბლოკის მოხსნა ტრეკერში | gadakhdilia — blokis mokhsna trekershi |
| `coll.act.call` | Записать звонок | ზარის ჩაწერა | zaris chatsera |
| `coll.act.block` | Заблокирован | დაბლოკილია | dablokilia |
| `coll.act.pickup` | Оформить возврат | დაბრუნების გაფორმება | dabrunebis gapormeba |
| `coll.act.unblock` | Блок снят | ბლოკი მოხსნილია | bloki mokhsnilia |
| `coll.card.late` | … дн. просрочки · … | … დღე ვადაგადაცილება · … | … dghe vadagadatsileba · … |
| `coll.card.step.call` | Позвоните клиенту и посмотрите в приложении трекера, где мопед. | დაურეკეთ კლიენტს და ნახეთ ტრეკერის აპლიკაციაში, სადაა მოპედი. | daureket klients da nakhet trekeris aplikatsiashi, sadaa mopedi. |
| `coll.card.step.waiting` | Обещал оплатить до 2: до этого дня ничего делать не нужно. | დაჰპირდა გადახდას 2-მდე: მანამდე არაფრის გაკეთება არ არის საჭირო. | dahpirda gadakhdas 2-mde: manamde arapris gaketeba ar aris sachiro. |
| `coll.card.step.block` | После последнего звонка не вышел на связь: заблокируйте мопед в приложении трекера и заберите его. | ბოლო ზარის შემდეგ არ გამოეხმაურა: დაბლოკეთ მოპედი ტრეკერის აპლიკაციაში და წამოიყვანეთ. | bolo zaris shemdeg ar gamoekhmaura: dabloket mopedi trekeris aplikatsiashi da tsamoiqvanet. |
| `coll.card.step.pickup` | Заблокирован 2. Заберите мопед и оформите акт возврата: долг остаётся на клиенте. | დაიბლოკა 2. წამოიყვანეთ მოპედი და გააფორმეთ დაბრუნების აქტი: ვალი კლიენტზე რჩება. | daibloka 2. tsamoiqvanet mopedi da gaapormet dabrunebis akti: vali klientze rcheba. |
| `coll.card.step.unblock` | Заблокирован 2, с тех пор оплачено: снимите блок в приложении трекера. | დაიბლოკა 2, მას შემდეგ გადაიხადა: მოხსენით ბლოკი ტრეკერის აპლიკაციაში. | daibloka 2, mas shemdeg gadaikhada: mokhsenit bloki trekeris aplikatsiashi. |
| `coll.card.none` | Сейчас ничего делать не нужно. | ახლა არაფრის გაკეთება არ არის საჭირო. | akhla arapris gaketeba ar aris sachiro. |
| `coll.card.tracker` | Трекер ···… | ტრეკერი ···… | trekeri ···… |
| `coll.card.noTracker` | У этого мопеда нет трекера в EV8 Ops. | ამ მოპედს EV8 Ops-ში ტრეკერი არ აქვს. | am mopeds EV8 Ops-shi trekeri ar akvs. |
| `coll.card.written` | Записано | ჩაწერილია | chatserilia |
| `coll.card.call` | Записать звонок | ზარის ჩაწერა | zaris chatsera |
| `coll.card.block` | Заблокирован в трекере | დაბლოკილია ტრეკერში | dablokilia trekershi |
| `coll.card.unblock` | Блок снят | ბლოკი მოხსნილია | bloki mokhsnilia |
| `coll.card.takeBack` | Оформить возврат | დაბრუნების გაფორმება | dabrunebis gapormeba |
| `coll.outcome.paid_today` | Заплатил / заплатит сегодня | გადაიხადა / გადაიხდის დღეს | gadaikhada / gadaikhdis dghes |
| `coll.outcome.promised` | Обещал оплатить до… | დაჰპირდა გადახდას…-მდე | dahpirda gadakhdas…-mde |
| `coll.outcome.refuses` | Дозвонился — отказывается | დავუკავშირდი — უარს ამბობს | davukavshirdi — uars ambobs |
| `coll.outcome.no_answer` | Не дозвонился | ვერ დავუკავშირდი | ver davukavshirdi |
| `coll.outcomeHint.paid_today` | Ждём до конца дня. | ველოდებით დღის ბოლომდე. | velodebit dghis bolomde. |
| `coll.outcomeHint.promised` | Ждём до этого дня, потом снова звонок. | ველოდებით ამ დღემდე, მერე ისევ ზარი. | velodebit am dghemde, mere isev zari. |
| `coll.outcomeHint.refuses` | Завтра — блокировка. | ხვალ — დაბლოკვა. | khval — dablokva. |
| `coll.outcomeHint.no_answer` | Завтра — блокировка, если не перезвонит. | ხვალ — დაბლოკვა, თუ არ გადმორეკავს. | khval — dablokva, tu ar gadmorekavs. |
| `coll.gps.still` | стоит | დგას | dgas |
| `coll.gps.moving` | ездит | მოძრაობს | modzraobs |
| `coll.gps.unseen` | не видно | არ ჩანს | ar chans |
| `coll.form.callTitle` | Звонок | ზარი | zari |
| `coll.form.outcome` | Чем закончился | რით დასრულდა | rit dasrulda |
| `coll.form.promisedOn` | До какого дня | რომელ დღემდე | romel dghemde |
| `coll.form.gps` | Что показал трекер | რა აჩვენა ტრეკერმა | ra achvena trekerma |
| `coll.form.gpsHint` | Где мопед — смотрите в приложении трекера. | სადაა მოპედი — ნახეთ ტრეკერის აპლიკაციაში. | sadaa mopedi — nakhet trekeris aplikatsiashi. |
| `coll.form.note` | Комментарий | კომენტარი | komentari |
| `coll.form.save` | Записать | ჩაწერა | chatsera |
| `coll.form.callDone` | Звонок записан | ზარი ჩაიწერა | zari chaitsera |
| `coll.form.blockTitle` | Заблокирован в трекере | დაბლოკილია ტრეკერში | dablokilia trekershi |
| `coll.form.blockHint` | Сначала заблокируйте мопед в приложении трекера, потом отметьте здесь: EV8 Ops сам не блокирует. | ჯერ დაბლოკეთ მოპედი ტრეკერის აპლიკაციაში, მერე მონიშნეთ აქ: EV8 Ops თავად არ ბლოკავს. | jer dabloket mopedi trekeris aplikatsiashi, mere monishnet ak: EV8 Ops tavad ar blokavs. |
| `coll.form.place` | Где мопед | სადაა მოპედი | sadaa mopedi |
| `coll.form.placeHint` | Адрес или ссылка на карту из приложения трекера — для того, кто поедет. | მისამართი ან რუკის ბმული ტრეკერის აპლიკაციიდან — ვინც წავა, მისთვის. | misamarti an rukis bmuli trekeris aplikatsiidan — vints tsava, mistvis. |
| `coll.form.blockSave` | Отметить блокировку | დაბლოკვის მონიშვნა | dablokvis monishvna |
| `coll.form.blockDone` | Отмечено: заблокирован | მონიშნულია: დაბლოკილია | monishnulia: dablokilia |
| `coll.form.unblockTitle` | Блок снят | ბლოკი მოხსნილია | bloki mokhsnilia |
| `coll.form.unblockHint` | Сначала снимите блок в приложении трекера, потом отметьте здесь. | ჯერ მოხსენით ბლოკი ტრეკერის აპლიკაციაში, მერე მონიშნეთ აქ. | jer mokhsenit bloki trekeris aplikatsiashi, mere monishnet ak. |
| `coll.form.unblockSave` | Отметить, что блок снят | ბლოკის მოხსნის მონიშვნა | blokis mokhsnis monishvna |
| `coll.form.unblockDone` | Отмечено: блок снят | მონიშნულია: ბლოკი მოხსნილია | monishnulia: bloki mokhsnilia |
| `coll.event.call` | Звонок: … | ზარი: … | zari: … |
| `coll.event.promised` | обещал до 2 | დაჰპირდა 2-მდე | dahpirda 2-mde |
| `coll.event.gps` | GPS: … | GPS: … | GPS: … |
| `coll.event.blocked` | Заблокирован в трекере | დაბლოკილია ტრეკერში | dablokilia trekershi |
| `coll.event.unblocked` | Блок снят | ბლოკი მოხსნილია | bloki mokhsnilia |

## Группа «Сегодня», журнал, ошибки

| Ключ | RU | KA | Чтение |
|---|---|---|---|
| `today.groups.collection` | Взыскание | დავალიანების ამოღება | davalianebis amogheba |
| `feedWords.rental.collection.call` | Записан звонок по долгу | ჩაიწერა ზარი ვალის შესახებ | chaitsera zari valis shesakheb |
| `feedWords.rental.collection.blocked` | Мопед отмечен заблокированным в трекере | მოპედი მოინიშნა დაბლოკილად ტრეკერში | mopedi moinishna dablokilad trekershi |
| `feedWords.rental.collection.unblocked` | Отмечено, что блок мопеда снят | მოინიშნა, რომ მოპედის ბლოკი მოხსნილია | moinishna, rom mopedis bloki mokhsnilia |
| `errors.codes.collection_not_running` | Звонки и блокировку записывают только у идущей аренды. | ზარები და დაბლოკვა იწერება მხოლოდ მიმდინარე ქირაობაზე. | zarebi da dablokva itsereba mkholod mimdinare kiraobaze. |
| `errors.codes.already_blocked` | Мопед уже отмечен заблокированным. | მოპედი უკვე მონიშნულია დაბლოკილად. | mopedi ukve monishnulia dablokilad. |
| `errors.codes.not_blocked` | Мопед не отмечен заблокированным. | მოპედი არ არის მონიშნული დაბლოკილად. | mopedi ar aris monishnuli dablokilad. |
