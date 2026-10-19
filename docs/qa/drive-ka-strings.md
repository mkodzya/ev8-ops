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
