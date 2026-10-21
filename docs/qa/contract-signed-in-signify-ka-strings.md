# «Подписан в Signify» — грузинские строки: на вычитку

Дата: 21.10.2026. Разработчик. Строки написал не носитель языка: «ხელშეკრულება» [khelshekruleba] («договор»),
«ხელმოწერილია» [khelmotserilia] («подписан»), «ხელმოუწერელი» [khelmoutsereli] («не подписан»), «ჟურნალი» [zhurnali]
(«журнал») и «რატომ იხსნება» [ratom ikhsneba] («почему снимается») взяты из словаря продукта. Источник —
`apps/web/src/i18n/contract-signed.ts`, ошибки — `errors.codes` в `apps/web/src/i18n/ka.ts`, журнал — `feedWords` в
`apps/web/src/i18n/wave4.ts`. Правило — ADR-0039. Рядом с каждой строкой — русский и английский текст и чтение латиницей.

## Новые строки (в ветке `feature/contract-signed-in-signify`)

| Ключ | RU | EN | KA | Чтение | Где видно |
|---|---|---|---|---|---|
| `signedElsewhere.mark` | Подписан в Signify | Signed in Signify | ხელმოწერილია Signify-ში | khelmotserilia Signify-shi | кнопка рядом с «Подписать на экране» в строке договора |
| `signedElsewhere.state(дата, кто)` | подписан в Signify 21.10 14:32 · кто | signed in Signify 21.10 14:32 · who | ხელმოწერილია Signify-ში 21.10 14:32 · ვინ | khelmotserilia Signify-shi … | состояние договора после отметки, зелёным |
| `signedElsewhere.title` | Договор подписан в Signify | The contract is signed in Signify | ხელშეკრულება ხელმოწერილია Signify-ში | khelshekruleba khelmotserilia Signify-shi | заголовок листа отметки |
| `signedElsewhere.hint` | Клиент подписал договор в Signify или на бумаге. EV8 Ops больше не просит подпись: аренда уходит из «Не подписан» и с «Сегодня». Отметка попадёт в журнал с вашим именем. | The customer signed the contract in Signify or on paper… | კლიენტმა ხელშეკრულებას ხელი მოაწერა Signify-ში ან ქაღალდზე. EV8 Ops აღარ მოითხოვს ხელმოწერას: ქირა აღარ გამოჩნდება „ხელმოუწერელში“ და „დღეს“-ზე. მონიშვნა ჩაიწერება ჟურნალში თქვენი სახელით. | klientma khelshekrulebas kheli moatsera Signify-shi an kaghaldze. EV8 Ops aghar moitkhovs khelmotseras: kira aghar gamochndeba „khelmoutserelshi“ da „dghes“-ze. monishvna chaitsereba zhurnalshi tkveni sakhelit. | пояснение в листе отметки |
| `signedElsewhere.drive` | Открыть договор в Drive | Open the contract in Drive | ხელშეკრულების გახსნა Drive-ში | khelshekrulebis gakhsna Drive-shi | ссылка в листе, если договор в Drive найден |
| `signedElsewhere.note` | Заметка | Note | შენიშვნა | shenishvna | поле в листе отметки |
| `signedElsewhere.noteHint` | Необязательно — например, где лежит подписанный экземпляр. | Optional — for example, where the signed copy is. | არასავალდებულო — მაგალითად, სად ინახება ხელმოწერილი ეგზემპლარი. | arasavaldebulo — magalitad, sad inakheba khelmotserili egzemplari. | подсказка под заметкой |
| `signedElsewhere.submit` | Отметить подписанным | Mark as signed | მონიშვნა ხელმოწერილად | monishvna khelmotserilad | кнопка листа |
| `signedElsewhere.done` | Отмечено: договор подписан в Signify | Marked: the contract is signed in Signify | მოინიშნა: ხელშეკრულება ხელმოწერილია Signify-ში | moinishna: khelshekruleba khelmotserilia Signify-shi | сообщение после отметки |
| `signedElsewhere.undo` | Снять отметку | Remove the mark | მონიშვნის მოხსნა | monishvnis mokhsna | пункт «⋯» у владельца; кнопка листа снятия |
| `signedElsewhere.undoTitle` | Снять отметку «подписан в Signify» | Remove the “signed in Signify” mark | მონიშვნის „ხელმოწერილია Signify-ში“ მოხსნა | monishvnis „khelmotserilia Signify-shi“ mokhsna | заголовок листа снятия |
| `signedElsewhere.undoHint` | Договор снова попросит подпись — в списке и на «Сегодня». В журнале останется, кто и когда его отметил. | The contract will be asked for again… | ხელშეკრულება კვლავ მოითხოვს ხელმოწერას — სიაში და „დღეს“-ზე. ჟურნალში დარჩება, ვინ და როდის მონიშნა. | khelshekruleba kvlav moitkhovs khelmotseras — siashi da „dghes“-ze. zhurnalshi darcheba, vin da rodis monishna. | пояснение в листе снятия |
| `signedElsewhere.reason` | Почему снимаем | Why the mark is removed | რატომ იხსნება | ratom ikhsneba | поле причины |
| `signedElsewhere.reasonHint` | Обязательно. Уйдёт в журнал — например, «отметили не ту аренду». | Required. It goes to the journal… | სავალდებულოა. ჩაიწერება ჟურნალში — მაგალითად, «სხვა ქირა მოინიშნა». | savaldebuloa. chaitsereba zhurnalshi — magalitad, «skhva kira moinishna». | подсказка под причиной |
| `signedElsewhere.undone` | Отметка снята | The mark is removed | მონიშვნა მოიხსნა | monishvna moikhsna | сообщение после снятия |
| `errors.codes.already_signed` | Договор уже подписан — на экране или в Signify. | The contract is already signed — on the screen or in Signify. | ხელშეკრულება უკვე ხელმოწერილია — ეკრანზე ან Signify-ში. | khelshekruleba ukve khelmotserilia — ekranze an Signify-shi. | отказ при второй отметке |
| `errors.codes.contract_not_marked` | Договор не отмечен как подписанный в Signify. Обновите экран. | The contract is not marked as signed in Signify. Refresh the screen. | ხელშეკრულება არ არის მონიშნული Signify-ში ხელმოწერილად. განაახლეთ ეკრანი. | khelshekruleba ar aris monishnuli Signify-shi khelmotserilad. ganaakhlet ekrani. | отказ при снятии, когда отметки уже нет |
| `feedWords['document.signed_elsewhere']` | Договор отмечен подписанным в Signify | Contract marked signed in Signify | ხელშეკრულება მოინიშნა Signify-ში ხელმოწერილად | khelshekruleba moinishna Signify-shi khelmotserilad | лента аренды, журнал |
| `feedWords['document.signed_elsewhere.undo']` | Снята отметка «подписан в Signify» | The “signed in Signify” mark was removed | მოიხსნა მონიშვნა „ხელმოწერილია Signify-ში“ | moikhsna monishvna „khelmotserilia Signify-shi“ | лента аренды, журнал |

## Вопросы к Kardu

1. «მონიშვნა» [monishvna] («отметка») — так ли говорят об отметке в карточке, или лучше «აღნიშვნა» [aghnishvna]?
2. «ხელმოუწერელში» [khelmoutserelshi] — название чипа «ხელმოუწერელი» в местном падеже, в кавычках. Читается ли это как
   «в чипе „Не подписан“», или лучше «სიაში „ხელმოუწერელი“» [siashi „khelmoutsereli“] («в списке „Не подписан“»)?
3. «ეგზემპლარი» [egzemplari] («экземпляр») — или привычнее «ასლი» [asli] («копия»)?
