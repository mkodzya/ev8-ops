# Трекер в карточке мопеда — грузинские строки: на вычитку

Дата: 21.10.2026. Разработчик. Строки написал не носитель языка: «ტრეკერი» [trekeri] («трекер»), «ჩაწერა» [chatsera]
(«записать») и «შეკეთება» [sheketeba] («ремонт») взяты из словаря продукта (`workshop-parts.ts`, этап 4). Источник —
`apps/web/src/i18n/workshop-parts.ts` (блок `wparts`), код ошибки — `ka.ts` (`errors.codes`), слова журнала — `wave4.ts`
(`feedWords`). Правило — ADR-0036, дополнение 21.10.2026. Рядом с каждой строкой — русский и английский текст и чтение
латиницей в квадратных скобках. Строки видит только владелец: менеджеру номера трекера не показываются.

## Новые строки (в коде с 21.10.2026)

| Ключ | RU | EN | KA | Чтение | Где видно |
|---|---|---|---|---|---|
| `wparts.trackerRow` | GPS-трекер | GPS tracker | GPS ტრეკერი | GPS trekeri | строка карточки мопеда, когда трекера нет |
| `wparts.imeiRow` | IMEI трекера | Tracker IMEI | ტრეკერის IMEI | trekeris IMEI | строка карточки с номером IMEI |
| `wparts.simRow` | SIM трекера | Tracker SIM | ტრეკერის SIM | trekeris SIM | строка карточки с номером SIM |
| `wparts.trackerUnset` | не записан | not written | არ არის ჩაწერილი | ar aris chatserili | значение строки «GPS-трекер» |
| `wparts.writeTracker` | Записать трекер | Write the tracker | ტრეკერის ჩაწერა | trekeris chatsera | кнопка в строке; заголовок листа |
| `wparts.fixTracker` | Исправить | Correct | შესწორება | shestsoreba | кнопка у номера SIM |
| `wparts.fixTitle` | Исправить трекер | Correct the tracker | ტრეკერის შესწორება | trekeris shestsoreba | заголовок листа исправления |
| `wparts.fittedOn` | Стоит с | On the moped since | რა დღიდან დგას | ra dghidan dgas | поле даты в листе «Записать трекер» |
| `wparts.fittedOnHint` | Не знаешь дня — оставь сегодня: в этот день трекер точно стоял. | Don’t know the day — leave today… | დღე არ იცი — დატოვე დღევანდელი: ამ დღეს ტრეკერი ნამდვილად იდგა. | dghe ar itsi — datove dghevandeli: am dghes trekeri namdvilad idga. | подсказка под датой |
| `wparts.fixNote` | Исправление переписывает номера этого трекера. Поставили другой трекер — сними этот в ремонте. | This rewrites the numbers of this tracker… | შესწორება ამ ტრეკერის ნომრებს გადაწერს. სხვა ტრეკერი დააყენეს — ეს შეკეთებაში მოხსენი. | shestsoreba am trekeris nomrebs gadatsers. skhva trekeri daayenes — es sheketebashi mokhseni. | подсказка в листе исправления |
| `wparts.onSince(дата)` | стоит с 21.10.2026 | on since 21.10.2026 | დგას 21.10.2026-დან | dgas 21.10.2026-dan | под номером IMEI |
| `wparts.onBy(дата)` | уже стоял 21.10.2026 | already on as of 21.10.2026 | 21.10.2026-ისთვის უკვე იდგა | 21.10.2026-istvis ukve idga | под номером IMEI у трекера, записанного в карточке: день не день установки |
| `wparts.trackerOffNoShelf` | Закроется на мопеде; на полку не пойдёт: его записали в карточке, с полки не брали. | It is closed on the moped and does not go to the shelf: it was written on the card, not taken off a shelf. | მოპედზე დაიხურება; თაროზე არ მივა: ბარათში ჩაიწერა, თაროდან არ აუღიათ. | mopedze daikhureba; taroze ar miva: baratshi chaitsera, tarodan ar aughiat. | ремонт, «Снять трекер», ответ «рабочий» у трекера, записанного в карточке |
| `wparts.byCard` | записан в карточке | written on the card | ჩაწერილია ბარათში | chatserilia baratshi | под IMEI, когда трекер записан без ремонта |
| `wparts.trackerWritten(···1234)` | Трекер ···1234 записан | Tracker ···1234 written | ტრეკერი ···1234 ჩაიწერა | trekeri ···1234 chaitsera | сообщение после записи |
| `wparts.trackerCorrected` | Трекер исправлен | Tracker corrected | ტრეკერი შესწორდა | trekeri shestsorda | сообщение после исправления |
| `wparts.trackerSame` | Номера те же — исправлять нечего | The numbers are the same: nothing to correct | ნომრები იგივეა — შესასწორებელი არაფერია | nomrebi igivea — shesastsorebeli araferia | сообщение, когда номера не поменялись |
| `wparts.trackersEarlier` | Прежние трекеры | Earlier trackers | წინა ტრეკერები | tsina trekerebi | блок снятых трекеров в карточке |
| `errors.codes.tracker_date_bad` | День, когда трекер стоял: не позже сегодня, не раньше прихода мопеда и снятия прежнего трекера. Не уверен — оставь сегодня. | A day the tracker was on the moped… | დღე, როცა ტრეკერი იდგა: არა დღევანდელზე გვიან, არა მოპედის მოსვლამდე და წინა ტრეკერის მოხსნამდე. არ ხარ დარწმუნებული — დატოვე დღევანდელი. | dghe, rotsa trekeri idga: ara dghevandelze gvian, ara mopedis mosvlamde da tsina trekeris mokhsnamde. ar khar dartsmunebuli — datove dghevandeli. | под полем даты, если день не подходит |
| `feedWords['tracker.write']` | Записан трекер, который уже стоит на мопеде | A tracker already on the moped was written in | ჩაიწერა მოპედზე უკვე დაყენებული ტრეკერი | chaitsera mopedze ukve dayenebuli trekeri | история мопеда, журнал |
| `feedWords['tracker.correct']` | Исправлены номера трекера | The tracker’s numbers were corrected | ტრეკერის ნომრები შესწორდა | trekeris nomrebi shestsorda | история мопеда, журнал |

## Убраны (больше нигде не показываются)

Старый блок «Трекер» под историей ремонтов заменён строками в первом блоке карточки и блоком «Прежние трекеры». Ушли:
`wparts.trackerBlock` «ტრეკერი», `wparts.trackerSince` «დაყენებულია» [dayenebulia], `wparts.trackerEarlier` «ადრე: …»
[adre], `wparts.noTrackerCard` «ტრეკერი არ არის» [trekeri ar aris], `wparts.imeiLabel`, `wparts.simLabel`.

## Вопросы к Kardu

1. «Стоит с» переведено как «რა დღიდან დგას» [ra dghidan dgas] («с какого дня стоит»). Так говорят, или короче —
   «დგას» [dgas] с датой, или прежнее «დაყენებულია» [dayenebulia] («установлен»)? Смысл важен: это день, когда трекер точно
   стоял, а не обязательно день установки.
2. «Записать трекер» — «ტრეკერის ჩაწერა» [trekeris chatsera], как «ჩაწერა» на кнопках этапа 4. Не читается ли это как
   «записать на трекер»?
3. «Уже стоял 21.10.2026» — «21.10.2026-ისთვის უკვე იდგა» [21.10.2026-istvis ukve idga] («к 21.10.2026 уже стоял»). Понятно
   ли, что это день, когда трекер точно был на мопеде, а не день, когда его поставили?
