# Задачи (issue #18, часть A) — грузинские строки: на вычитку

Дата: 28.10.2026. Разработчик. Строки написал не носитель языка. Задача — GitHub issue `mkodzya/ev8-ops#18` директора
(25.10.2026), часть A; Mika 28.10.2026: «А». Правила — ADR-0050 (и дополнения ADR-0033, ADR-0048 того же дня).
Источники: `apps/web/src/i18n/todos.ts` (новые строки), `ka.ts` (`nav.tasks`, `nav.tasksShort`, `errors.codes`), `wave4.ts`
(`feedWords`), `wave3.ts` (§4). Числа, имена и задачи в примерах выдуманы.

Где слово уже было в продукте, взято оно: «ვადაგადაცილებული» — как у «Оплат по графику», «ელოდება დამტკიცებას» и
«მუშავდება» — как у ремонтов, «დღეს» — раздел «Сегодня», «მიბმა / მიაბით» — как в «Разобрать». Новое понятие —
«დავალება» / «დავალებები» (задача, задачи); «ამოცანა» (задача, проблема), которым раньше называли строку решения о
залоге, из продукта ушло (§4).

Вопросы Kardu:

1. «დავალებები» для раздела — подходит, или привычнее другое слово?
2. «შესრულდა» на кнопке «Сделано» и «შესრულებული» для группы закрытых — так говорят?
3. «დაავალა ტესტი» (поставил(а) …) и «დამვალებლის კომენტარი» (комментарий того, кто поставил) — понятно?
4. «ყოველ კვირას, ორშ» / «ყოველ თვეს, 15 რიცხვში» — так пишут повтор?
5. «სტრიქონი რიგში» — вслух о сером числе у «Сегодня» (строки очереди); есть слово лучше?
6. «დავალება» (задача) в нижней панели телефона: «დავალებები» шире пятой части экрана в 375 px и рвалось на «დავალებე /
   ბი». Единственное число на кнопке раздела — так можно, или есть короткое слово лучше (до ~70 px, как «მოპედები»)?
7. «კვირა» — и неделя, и воскресенье: подсказка повтора на воскресенье говорила «ყოველ კვირას» — то же, что кнопка
   «каждую неделю». Теперь «ყოველ კვირა დღეს». Так пишут, или «ყოველ კვირადღეს»? И метка «ყოველ კვირას, კვი» (каждую
   неделю, вс) — читается?

## 1. Новые строки

| Ключ | RU | KA | Чтение | Где видно |
|---|---|---|---|---|
| `nav.tasks` | Задачи | დავალებები | davalebebi | меню, заголовок раздела, кнопка планшета |
| `nav.tasksShort` | Задачи | დავალება | davaleba | нижняя панель телефона (вопрос 6) |
| `todos.add` | Задача | დავალება | davaleba | кнопка «＋ Задача» в разделе |
| `todos.give` | Поручить | დავალების მიცემა | davalebis mitsema | «⋯» в карточке мопеда, аренды, клиента |
| `todos.count` | 6 открыто · 2 просрочено | 6 ღიაა · 2 ვადაგადაცილებულია | 6 ghiaa · 2 vadagadatsilebulia | под заголовком раздела |
| `todos.mine` | Мои | ჩემი | chemi | первый фильтр у владельца |
| `todos.groups.overdue` | Просрочено | ვადაგადაცილებული | vadagadatsilebuli | группа списка; слово — как у «Оплат по графику» |
| `todos.groups.today` | Сегодня | დღეს | dghes | группа списка |
| `todos.groups.tomorrow` | Завтра | ხვალ | khval | группа списка |
| `todos.groups.week` | Эта неделя | ამ კვირაში | am k'virashi | группа списка |
| `todos.groups.later` | Позже | მოგვიანებით | mogvianebit | группа списка |
| `todos.done` | Сделано | შესრულებული | shesrulebuli | группа закрытых |
| `todos.doneSub` | за 7 дней · 9 | 7 დღეში · 9 | 7 dgheshi · 9 | рядом с «Сделано» |
| `todos.moreDone` | Ещё 8 сделанных — показать | კიდევ 8 შესრულებული — ჩვენება | k'idev 8 shesrulebuli — chveneba | под первой закрытой |
| `todos.empty` | Задач нет | დავალებები არ არის | davalebebi ar aris | пустой список |
| `todos.emptySub` | Сюда попадают задачи, поставленные вручную: декларация каждый месяц, обход парковки по понедельникам. То, что «Сегодня» находит само, остаётся там. | აქ ხვდება ხელით მიცემული დავალებები: დეკლარაცია ყოველ თვეს, პარკინგის შემოვლა ორშაბათობით. რასაც «დღეს» თვითონ პოულობს, იქვე რჩება. | ak khvdeba khelit mitsemuli davalebebi: dek'laratsia q'ovel tves, p'ark'ingis shemovla orshabatobit. rasats «dghes» tviton p'oulobs, ikve rcheba. | пустой список «Мои» |
| `todos.emptyOther` | Здесь открытых задач нет. | აქ ღია დავალებები არ არის. | ak ghia davalebebi ar aris. | пустой список другого человека |
| `todos.lateBy` | −10 дн. | −10 დღე | −10 dghe | срок просроченной строки |
| `todos.weekly` | каждую неделю, Пн | ყოველ კვირას, ორშ | q'ovel k'viras, orsh | метка повтора «↻»; день — `calendar.wd` |
| `todos.monthly` | каждый месяц, 15-го | ყოველ თვეს, 15 რიცხვში | q'ovel tves, 15 ritskhvshi | метка повтора «↻» |
| `todos.fileTag` | нужно фото или файл | საჭიროა ფოტო ან ფაილი | sach'iroa pot'o an paili | метка строки |
| `todos.setBy` | поставил(а) Тест | დაავალა ტესტი | daavala t'est'i | строка задачи, когда поставил другой («Тест» — выдуманное имя) |
| `todos.self` | Себе | ჩემთვის | chemtvis | выбор «Кому» |
| `todos.shownFrom` | на «Сегодня» с 12.11.2026 — за 3 дня | «დღეს»-ში 12.11.2026-დან — 3 დღით ადრე | «dghes»-shi 12.11.2026-dan — 3 dghit adre | лист задачи, показанной заранее |
| `todos.closedBy` | закрыл(а) Тест 19.10.2026 в 10:42 | დახურა ტესტი 19.10.2026, 10:42 | dakhura t'est'i 19.10.2026, 10:42 | лист закрытой задачи |
| `todos.closedByRecord.rental` | закрылась сама: аренда возвращена | თავისით დაიხურა: ქირაობა დაბრუნდა | tavisit daikhura: kiraoba dabrunda | лист задачи, закрытой вместе с арендой |
| `todos.closedByRecord.vehicle` | закрылась сама: мопед выбыл из парка | თავისით დაიხურა: მოპედი პარკიდან გავიდა | tavisit daikhura: mop'edi p'ark'idan gavida | то же для мопеда |
| `todos.files` | 3 файла | 3 ფაილი | 3 paili | файлы задачи |
| `todos.linkKinds` | Мопед · Аренда · Клиент | მოპედი · ქირაობა · კლიენტი | mop'edi · kiraoba · k'lient'i | привязка |
| `todos.repeats` | Нет · Каждую неделю · Каждый месяц | არა · ყოველ კვირას · ყოველ თვეს | ara · q'ovel k'viras · q'ovel tves | выбор «Повтор» |
| `todos.form.newTitle` | Новая задача | ახალი დავალება | akhali davaleba | заголовок листа |
| `todos.form.editTitle` | Изменить задачу | დავალების შეცვლა | davalebis shetsvla | заголовок листа |
| `todos.form.text` | Что сделать | რა უნდა გაკეთდეს | ra unda gak'etdes | поле |
| `todos.form.assignee` | Кому | ვის | vis | поле |
| `todos.form.due` | Срок | ვადა | vada | поле |
| `todos.form.lead` | Показать заранее | წინასწარ ჩვენება | ts'inasts'ar chveneba | поле |
| `todos.form.leadNone` | Нет | არა | ara | вариант поля |
| `todos.form.leadDays` | за 3 дня | 3 დღით ადრე | 3 dghit adre | вариант поля |
| `todos.form.repeat` | Повтор | გამეორება | gameoreba | поле |
| `todos.form.everyWeekday` | Каждый понедельник … Каждое воскресенье | ყოველ ორშაბათს … ყოველ კვირა დღეს | q'ovel orshabats … q'ovel k'vira dghes | подсказка повтора; все семь — в `todos.ts`; воскресенье — вопрос 7 |
| `todos.form.weeklyHint` | Каждый понедельник. Следующая появится сама, даже если эту не закроют. | ყოველ ორშაბათს. შემდეგი თავისით გამოჩნდება, ეს რომ არ დაიხუროს, მაინც. | q'ovel orshabats. shemdegi tavisit gamochndeba, es rom ar daikhuros, maints. | под выбором повтора |
| `todos.form.monthlyHint` | Каждый месяц, 15-го (в коротком месяце — в последний день). Следующая появится сама, даже если эту не закроют. | ყოველ თვეს, 15 რიცხვში (მოკლე თვეში — ბოლო დღეს). შემდეგი თავისით გამოჩნდება, ეს რომ არ დაიხუროს, მაინც. | q'ovel tves, 15 ritskhvshi (mok'le tveshi — bolo dghes). shemdegi tavisit gamochndeba, es rom ar daikhuros, maints. | под выбором повтора |
| `todos.form.leadHint` | На «Сегодня» с 12.11.2026. | «დღეს»-ში 12.11.2026-დან. | «dghes»-shi 12.11.2026-dan. | под сроком |
| `todos.form.needsFile` | Нужно фото или файл, чтобы закрыть | დასახურად საჭიროა ფოტო ან ფაილი | dasakhurad sach'iroa pot'o an paili | флажок |
| `todos.form.link` | Привязать (необязательно) | მიბმა (არასავალდებულო) | mibma (arasavaldebulo) | поле |
| `todos.form.linkFind` | Мопед, аренда или клиент — номер или имя | მოპედი, ქირაობა ან კლიენტი — ნომერი ან სახელი | mop'edi, kiraoba an k'lient'i — nomeri an sakheli | подсказка в поле поиска |
| `todos.form.linkMechanic` | Задачу механику можно привязать только к мопеду. | მექანიკოსის დავალება მხოლოდ მოპედს შეიძლება მიება. | mekanik'osis davaleba mkholod mop'eds sheidzleba mieba. | под привязкой |
| `todos.form.linkRemove` | Убрать | მოხსნა | mokhsna | кнопка у привязки |
| `todos.form.linkNothing` | Ничего не нашлось | ვერაფერი მოიძებნა | veraperi moidzebna | поиск привязки |
| `todos.form.note` | Комментарий | კომენტარი | k'oment'ari | поле |
| `todos.form.noteHint` | Например: скрин подтверждения | მაგალითად: დადასტურების სქრინი | magalitad: dadast'urebis skrini | под полем |
| `todos.form.submit` | Поставить задачу | დავალების მიცემა | davalebis mitsema | кнопка листа |
| `todos.form.save` | Сохранить | შენახვა | shenakhva | кнопка листа |
| `todos.form.rules` | Изменить или удалить задачу может тот, кто её поставил. Исполнитель закрывает и пишет комментарий. | დავალებას ცვლის ან შლის ის, ვინც მისცა. შემსრულებელი ხურავს და წერს კომენტარს. | davalebas tsvlis an shlis is, vints mistsa. shemsrulebeli khuravs da ts'ers k'oment'ars. | низ листа у владельца |
| `todos.card.title` | Задача | დავალება | davaleba | заголовок листа задачи |
| `todos.card.dueOn` | срок 15.10.2026 | ვადა 15.10.2026 | vada 15.10.2026 | лист задачи |
| `todos.card.lateBy` | просрочена на 10 дней | ვადა გადაცილებულია 10 დღით | vada gadatsilebulia 10 dghit | лист задачи |
| `todos.card.setNote` | Комментарий того, кто поставил | დამვალებლის კომენტარი | damvaleblis k'oment'ari | лист задачи |
| `todos.card.fileNeeded` | Нужно фото или файл, чтобы закрыть. | დასახურად საჭიროა ფოტო ან ფაილი. | dasakhurad sach'iroa pot'o an paili. | место для файла |
| `todos.card.addFile` | Сфотографировать или выбрать файл | გადაიღეთ ფოტო ან აირჩიეთ ფაილი | gadaighet pot'o an airchiet paili | место для файла |
| `todos.card.adding` | Добавляем… | ემატება… | emat'eba… | пока файл готовится |
| `todos.card.cannotRead` | Не удалось прочитать photo.heic | ვერ წავიკითხეთ photo.heic | ver ts'avik'itkhet photo.heic | файл не открылся |
| `todos.card.yourNote` | Ваш комментарий | თქვენი კომენტარი | tkveni k'oment'ari | поле закрытия |
| `todos.card.optional` | Необязательно | არასავალდებულო | arasavaldebulo | под полем |
| `todos.card.done` | Сделано | შესრულდა | shesrulda | кнопка закрытия, кнопка строки на «Сегодня» |
| `todos.card.closedNote` | Комментарий | კომენტარი | k'oment'ari | лист закрытой задачи |
| `todos.card.edit` | Изменить | შეცვლა | shetsvla | кнопка |
| `todos.card.remove` | Удалить | წაშლა | ts'ashla | кнопка |
| `todos.card.removeAsk` | Удалить задачу? Из списка она уйдёт, журнал её сохранит. | წავშალოთ დავალება? სიიდან გაქრება, ჟურნალი შეინახავს. | ts'avshalot davaleba? siidan gakreba, zhurnali sheinakhavs. | вопрос перед удалением |
| `todos.card.removeRepeat` | Повтор останется: следующая появится сама — если не остановить его. | გამეორება რჩება: შემდეგი თავისით გამოჩნდება — თუ არ შეაჩერებთ. | gameoreba rcheba: shemdegi tavisit gamochndeba — tu ar sheacherebt. | там же, у повторяющейся |
| `todos.card.removeOne` | Удалить эту | მხოლოდ ამის წაშლა | mkholod amis ts'ashla | кнопка |
| `todos.card.removeStop` | Удалить и не повторять | წაშლა და გამეორების შეჩერება | ts'ashla da gameorebis shechereba | кнопка |
| `todos.card.reopen` | Вернуть в работу | ხელახლა გახსნა | khelakhla gakhsna | кнопка закрытой задачи |
| `todos.card.openCard` | Открыть карточку | ბარათის გახსნა | baratis gakhsna | кнопка: мопед, аренда, клиент |
| `todos.toast.set` | Задача поставлена | დავალება მიცემულია | davaleba mitsemulia | сообщение |
| `todos.toast.saved` | Задача изменена | დავალება შეიცვალა | davaleba sheitsvala | сообщение |
| `todos.toast.done` | Сделано: Обход парковки | შესრულდა: პარკინგის შემოვლა | shesrulda: p'ark'ingis shemovla | сообщение с «Отменить» |
| `todos.toast.removed` | Задача удалена | დავალება წაიშალა | davaleba ts'aishala | сообщение |
| `todos.toast.reopened` | Задача снова в работе | დავალება ხელახლა ღიაა | davaleba khelakhla ghiaa | сообщение |
| `todos.today.all` | все задачи → | ყველა დავალება → | q'vela davaleba → | блок на «Сегодня» |
| `todos.journal` | Что сделать · Комментарий · Срок · Показать заранее · Фото или файл · Кому · Привязка · Повтор | რა უნდა გაკეთდეს · კომენტარი · ვადა · წინასწარ ჩვენება · ფოტო ან ფაილი · ვის · მიბმა · გამეორება | ra unda gak'etdes · k'oment'ari · vada · ts'inasts'ar chveneba · pot'o an paili · vis · mibma · gameoreba | журнал: «было → стало» |
| `todos.journalLink` | мопед · аренда · клиент | მოპედი · ქირაობა · კლიენტი | mop'edi · kiraoba · k'lient'i | журнал |
| `todos.journalRepeat` | без повтора · каждую неделю · каждый месяц | გამეორების გარეშე · ყოველ კვირას · ყოველ თვეს | gameorebis gareshe · q'ovel k'viras · q'ovel tves | журнал |
| `todos.workshop.repairs` | Мои ремонты | ჩემი რემონტები | chemi remont'ebi | «Сегодня» механика |
| `todos.workshop.waiting` | Ждут согласования · 1 | ელოდება დამტკიცებას · 1 | elodeba damt'k'itsebas · 1 | там же; слово — как у ремонтов |
| `todos.workshop.working` | В работе · 2 | მუშავდება · 2 | mushavdeba · 2 | там же; слово — как у ремонтов |
| `todos.workshop.noRepairs` | Открытых ремонтов у вас нет. | ღია რემონტი არ გაქვთ. | ghia remont'i ar gakvt. | там же |
| `todos.workshop.toApprove` | Согласовать | დასამტკიცებელი | dasamt'k'itsebeli | у главного механика |
| `todos.workshop.toApproveN` | 2 ремонта ждут согласования | 2 რემონტი ელოდება დამტკიცებას | 2 remont'i elodeba damt'k'itsebas | там же |
| `todos.workshop.maintenance` | Плановое ТО | გეგმიური ტექმომსახურება | gegmiuri t'ekmomsakhureba | у главного механика |
| `todos.workshop.maintenanceDue` | Пора на ТО · 2 мопеда | ტექმომსახურების დროა · 2 მოპედი | t'ekmomsakhurebis droa · 2 mop'edi | там же |
| `todos.workshop.maintenanceLate` | из них просрочено · 1 | მათგან ვადაგადაცილებული · 1 | matgan vadagadatsilebuli · 1 | там же |
| `todos.workshop.maintenanceNone` | Пора на ТО — ни одного мопеда. | ტექმომსახურების დრო არც ერთ მოპედს არ აქვს. | t'ekmomsakhurebis dro arts ert mop'eds ar akvs. | там же |
| `todos.workshop.payout` | Моя выплата | ჩემი ანაზღაურება | chemi anazghaureba | «Сегодня» механика |
| `todos.workshop.payoutNow` | К оплате сейчас: 120,00 ₾ | ახლა გადასახდელი: 120,00 ₾ | akhla gadasakhdeli: 120,00 ₾ | там же (сумма выдумана) |
| `todos.workshop.payoutNone` | Сейчас к оплате ничего. | ახლა გადასახდელი არაფერია. | akhla gadasakhdeli araperia. | там же |
| `todos.workshop.all` | все → | ყველა → | q'vela → | ссылки карточек |
| `todos.queueSaid` | строк в очереди | სტრიქონი რიგში | st'rikoni rigshi | бейдж «Сегодня», вслух; вместо «дела» |
| `todos.saidLate` | задач просрочено | ვადაგადაცილებული დავალება | vadagadatsilebuli davaleba | красный счётчик «Задач», вслух |
| `todos.saidToday` | задач на сегодня | დღევანდელი დავალება | dghevandeli davaleba | серый счётчик «Задач», вслух |

## 2. Отказы сервера (`errors.codes`)

| Код | RU | KA | Чтение |
|---|---|---|---|
| `todo_assignee_refused` | Задачу ставят себе. Владелец ставит и менеджеру или главному механику. | დავალებას საკუთარ თავს აძლევენ. მფლობელი აძლევს მენეჯერს ან მთავარ მექანიკოსსაც. | davalebas sak'utar tavs adzleven. mplobeli adzlevs menejers an mtavar mekanik'ossats. |
| `todo_closed` | Задача закрыта. Сначала верните её в работу. | დავალება დახურულია. ჯერ ხელახლა გახსენით. | davaleba dakhurulia. jer khelakhla gakhsenit. |
| `todo_due_bad` | Срок — это дата. | ვადა თარიღით ჩაწერეთ. | vada tarighit chats'eret. |
| `todo_due_past` | Этот день прошёл. Выберите сегодня или день впереди. | ეს დღე გავიდა. აირჩიეთ დღეს ან მომავალი დღე. | es dghe gavida. airchiet dghes an momavali dghe. |
| `todo_lead_bad` | Показать заранее можно не больше чем за 30 дней. | წინასწარ ჩვენება — არაუმეტეს 30 დღით ადრე. | ts'inasts'ar chveneba — araumet'es 30 dghit adre. |
| `todo_link_ended` | Эта запись закончилась — аренда возвращена или мопед выбыл из парка. Привяжите задачу к клиенту. | ეს ჩანაწერი დასრულდა — ქირაობა დაბრუნდა ან მოპედი პარკიდან გავიდა. დავალება კლიენტს მიაბით. | es chanats'eri dasrulda — kiraoba dabrunda an mop'edi p'ark'idan gavida. davaleba k'lient's miabit. |
| `todo_link_not_found` | Запись не найдена. | ჩანაწერი ვერ მოიძებნა. | chanats'eri ver moidzebna. |
| `todo_link_refused` | Задачу механику привязывают только к мопеду, а привязывает тот, кто видит парк. | მექანიკოსის დავალება მხოლოდ მოპედს ებმის, და მიაბამს ის, ვინც პარკს ხედავს. | mekanik'osis davaleba mkholod mop'eds ebmis, da miabams is, vints p'ark's khedavs. |
| `todo_needs_file` | Эта задача закрывается с фото или файлом. Добавьте его и нажмите «Сделано». | ეს დავალება ფოტოთი ან ფაილით იხურება. დაამატეთ და დააჭირეთ «შესრულდა». | es davaleba pot'oti an pailit ikhureba. daamat'et da daach'iret «shesrulda». |
| `todo_not_found` | Такой задачи нет. | ასეთი დავალება არ არის. | aseti davaleba ar aris. |
| `todo_not_yours` | Изменить или удалить задачу может тот, кто её поставил; закрывает исполнитель. | დავალებას ცვლის ან შლის ის, ვინც მისცა; ხურავს შემსრულებელი. | davalebas tsvlis an shlis is, vints mistsa; khuravs shemsrulebeli. |
| `todo_note_long` | Комментарий слишком длинный: до 2 000 знаков. | კომენტარი ძალიან გრძელია: 2 000 სიმბოლომდე. | k'oment'ari dzalian grdzelia: 2 000 simbolomde. |
| `todo_record_ended` | Запись, к которой привязана задача, закончилась, поэтому задача остаётся закрытой. Если дело осталось — поставьте новую. | ჩანაწერი, რომელსაც დავალება ებმოდა, დასრულდა, ამიტომ დავალება დახურული რჩება. თუ საქმე დარჩა — ახალი დავალება მიეცით. | chanats'eri, romelsats davaleba ebmoda, dasrulda, amit'om davaleba dakhuruli rcheba. tu sakme darcha — akhali davaleba mietsit. |
| `todo_text_long` | Слишком длинно: до 300 знаков. Остальное — в комментарий. | ძალიან გრძელია: 300 სიმბოლომდე. დანარჩენი — კომენტარში. | dzalian grdzelia: 300 simbolomde. danarcheni — k'oment'arshi. |
| `todo_text_missing` | Напишите, что сделать. | ჩაწერეთ, რა უნდა გაკეთდეს. | chats'eret, ra unda gak'etdes. |
| `todos_not_yours` | Вам видны только ваши задачи. | თქვენ მხოლოდ თქვენს დავალებებს ხედავთ. | tkven mkholod tkvens davalebebs khedavt. |

## 3. Строки журнала (`feedWords`)

| Действие | RU | KA | Чтение |
|---|---|---|---|
| `todo.create` | Поставлена задача | დავალება მიეცა | davaleba mietsa |
| `todo.update` | Задача изменена | დავალება შეიცვალა | davaleba sheitsvala |
| `todo.delete` | Задача удалена | დავალება წაიშალა | davaleba ts'aishala |
| `todo.close` | Сделано | შესრულდა | shesrulda |
| `todo.close.record` | Задача закрылась сама: запись закончилась | დავალება თავისით დაიხურა: ჩანაწერი დასრულდა | davaleba tavisit daikhura: chanats'eri dasrulda |
| `todo.reopen` | Задача возвращена в работу | დავალება ხელახლა გაიხსნა | davaleba khelakhla gaikhsna |
| `todo.file.add` | К задаче добавлено фото или файл | დავალებას დაემატა ფოტო ან ფაილი | davalebas daemat'a pot'o an paili |
| `todo.repeat.stop` | Повтор остановлен | გამეორება შეჩერდა | gameoreba shecherda |

## 4. Строки, где сменилось слово

Залог, который ждёт решения владельца, — строка на «Сегодня», а не задача: слово «Задачи» / «დავალებები» теперь у раздела, а «ამოცანა» (задача, проблема) в продукте больше не встречается.

| Ключ | Было (RU) | Стало (RU) | Было (KA) | Стало (KA) | Чтение (стало) |
|---|---|---|---|---|---|
| `back.ownerDecides` | Залог решит владелец. Возврат оформится сейчас; решение — задачей у владельцев. | Залог решит владелец. Возврат оформится сейчас; решение ждёт владельцев на «Сегодня». | დეპოზიტს გადაწყვეტს მფლობელი. დაბრუნება ახლა გაფორმდება; გადაწყვეტილება — მფლობელების ამოცანად. | დეპოზიტს გადაწყვეტს მფლობელი. დაბრუნება ახლა გაფორმდება; გადაწყვეტილება მფლობელებს «დღეს»-ში ელოდება. | dep'ozit's gadats'q'vet's mplobeli. dabruneba akhla gapormdeba; gadats'q'vet'ileba mplobelebs «dghes»-shi elodeba. |
| `back.managerDone` | Залог решит владелец — ему пришла задача. | Залог решит владелец — решение ждёт его на «Сегодня». | დეპოზიტს გადაწყვეტს მფლობელი — მას მიუვიდა ამოცანა. | დეპოზიტს გადაწყვეტს მფლობელი — გადაწყვეტილება მას «დღეს»-ში ელოდება. | dep'ozit's gadats'q'vet's mplobeli — gadats'q'vet'ileba mas «dghes»-shi elodeba. |
