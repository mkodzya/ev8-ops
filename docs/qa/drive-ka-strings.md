# «Google Drive» — грузинские строки: на вычитку

Дата: 19.10.2026. Разработчик. Строки написал не носитель языка; «ხელშეკრულება» [khelshekruleba],
«დაბრუნების აქტი» [dabrunebis akti], «დეპოზიტი» [depoziti] — из документов Signify и словаря продукта.
Источник — `apps/web/src/i18n/drive.ts` (рядом — русский и английский текст каждой строки). Правило — ADR-0031.

Главные строки экрана «Настройки → Drive»:

| Ключ | RU | KA | Чтение |
|---|---|---|---|
| `drive.returnedThere` | Вернули по Drive, а здесь аренда идёт | Drive-ის მიხედვით დაბრუნებულია, აქ კი ქირაობა გრძელდება | Drive-is mikhedvit dabrunebulia, ak ki kiraoba grdzeldeba |
| `drive.missingHere` | Папка в Drive, а аренды здесь нет | საქაღალდე Drive-შია, აქ კი ქირაობა არ არის | sakaghalde Drive-shia, ak ki kiraoba ar aris |
| `drive.missingThere` | Аренда идёт, а папки в Drive нет | ქირაობა გრძელდება, Drive-ში კი საქაღალდე არ არის | kiraoba grdzeldeba, Drive-shi ki sakaghalde ar aris |
| `drive.readNow` | Прочитать сейчас | ახლავე წაკითხვა | akhlave tsakitkhva |
| `drive.rentalFolder` | Договор в Drive | ხელშეკრულება Drive-ში | khelshekruleba Drive-shi |
| `drive.deposit(…)` | залог 180, удержано 30, возвращено 150 | დეპოზიტი 180, დაკავებული 30, დაბრუნებული 150 | depoziti, dakavebuli, dabrunebuli |
| `today.groups.intake` | Оформить из Kommo и Drive | Kommo-დან და Drive-დან გასაფორმებელი | Kommo-dan da Drive-dan gasaformebeli |
| `today.actions.hand_over_from_drive` | Завести аренду | ქირაობის შეყვანა | kiraobis sheqvana |
| `today.actions.close_from_drive` | Закрыть аренду | ქირაობის დახურვა | kiraobis dakhurva |
| `drive.todayContract(…)` | договор в Drive от 17.10, здесь аренды нет | ხელშეკრულება Drive-ში 17.10, აქ ქირაობა არ არის | khelshekruleba Drive-shi, ak kiraoba ar aris |
| `drive.todayAct(…)` | акт возврата в Drive от 12.10 | დაბრუნების აქტი Drive-ში 12.10 | dabrunebis akti Drive-shi |
| `drive.todayFinished` | папка в Drive — в завершённых | საქაღალდე Drive-ში დასრულებულებშია | sakaghalde Drive-shi dasrulebulebshia |
| `drive.todayPaidBack(…)` | залог вернули 180 ₾ | დეპოზიტი დაბრუნდა 180 ₾ | depoziti dabrunda |
| `drive.returnOnAct(…)` | Дата возврата — из акта в Drive: 12.10. Сверьте залог с актом. | დაბრუნების თარიღი Drive-ის აქტიდანაა: 12.10. დეპოზიტი შეადარეთ აქტს. | dabrunebis tarighi Drive-is aktidanaa; depoziti sheadaret akts |
