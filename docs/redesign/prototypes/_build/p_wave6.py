from proto_base import *
from p_today import q, grp, prim, sec, CALL, WA
from p_wave1 import stabs, lc, money, fld, sheet_form
from p_wave3 import seg
from p_wave5 import dl, card
import proto_base
proto_base.WAVE1 = False

RT = ['Неделя', 'Загрузка парка', 'Экономика']
ST = ['Люди', 'Точки', 'Аренда', 'Журнал', 'Перенос', 'Вход']

# ================= REPORTS =================
week_rows = [('Мопедов в аренде', '18', ''), ('Свободных в парке аренды', '9', ''), ('В ремонте', '10 · до 31 дня', ''),
 ('Новые аренды · возвраты', '3 · 2', ''), ('Просрочка', '900,00 ₾ · 4 аренды', 'money crit'),
 ('Поступило — аренда', '1 350,00 ₾', 'money'), ('Поступило — продажи', '300,00 ₾', 'money'),
 ('Получено залогов', '360,00 ₾', 'money'), ('Комиссия эквайринга', '−29,70 ₾', 'money'),
 ('Выдано залогов', '−180,00 ₾', 'money'), ('Удержано из залогов', '130,00 ₾', 'money'),
 ('Залоги на руках', '3 240,00 ₾', 'money'), ('Загрузка парка аренды', '64 %', 'money'),
 ('Батареи: шоурум · курьеры · ремонт', '7 · 34 · 1', ''), ('Неразобранные строки выписок', '5', ''),
 ('Замены батарей', 'нет данных — учёта нет', 'muted')]
w1 = phone('<b>Отчёт «Неделя».</b> Ровно те цифры, что в книге (<code>weekly.md</code> «Какие цифры»), за неделю с понедельника; каждая — ссылка на список, из которого сложена (ux №10). «Замены батарей» честно помечены «нет данных». Печать и PDF — для встречи Mika и Kardu.',
  head('Отчёты'), stabs(RT, 'Неделя') +
  '<div class="chips" style="margin-top:-4px"><span class="chip on">Эта неделя</span><span class="chip">Прошлая</span><span class="chip">Период ▾</span></div>' +
  '<div class="date">Неделя с 14 по 20 сентября</div>' + card('', dl(week_rows)),
  tabbar('owner', '', 14), '<div class="action-bar"><a class="btn btn-lg" href="#">Печать · PDF</a><a class="btn btn-primary btn-lg" href="#">Скопировать в книгу</a></div>', body_cls='with-bar')
w2 = phone('<b>Загрузка парка аренды (B10-01, метрика M-10).</b> Дни «в аренде» ÷ дни в парке аренды за период, в процентах — одна формула для экрана, отчёта и API (<code>docs/metrics.md</code>). По плану это главный риск раунда (<code>finance-plan.md</code>), поэтому цифра есть и по моделям, и по мопедам.',
  head('Отчёты'), stabs(RT, 'Загрузка парка') +
  '<div class="chips" style="margin-top:-4px"><span class="chip">Неделя</span><span class="chip on">Месяц</span><span class="chip">Период ▾</span></div>' +
  '<div class="card"><div class="small muted">Сентябрь · парк аренды</div><div class="hero">64 %</div><div class="small muted">дни в аренде 486 из 756 · 27 мопедов</div></div>' +
  card('По моделям', '<table class="table"><tr><th>Модель</th><th class="r">Мопедов</th><th class="r">Загрузка</th></tr><tr><td>XL1200</td><td class="r">14</td><td class="r money">79 %</td></tr><tr><td>Eagle</td><td class="r">6</td><td class="r money">61 %</td></tr><tr><td>F-150</td><td class="r">7</td><td class="r money">38 %</td></tr></table>') +
  card('Что мешает', dl([('В ремонте весь месяц', '4 мопеда', ''), ('Свободны дольше 14 дней', '3 мопеда', ''), ('Не выходят из ремонта из-за батарей', '2 мопеда', 'crit')])),
  tabbar('owner', '', 14))
w3 = phone('<b>Экономика мопеда.</b> Себестоимость, выручка аренды и продаж, ремонты, загрузка — по каждому VIN и по модели. Пока партия оплачена не полностью — пометка «себестоимость предварительная» (волна 5). «Оплачено до переноса» — отдельной строкой, не выручка периода (умолчание Q3).',
  head('Отчёты'), stabs(RT, 'Экономика') +
  '<div class="chips" style="margin-top:-4px"><span class="chip on">За всё время</span><span class="chip">Год</span><span class="chip">Период ▾</span></div>' +
  lc('XL1200 ···4412', 'в парке с 14.03.2025 · загрузка 79 %', money('+1 240 ₾') + '<div class="b">себест. 1 700</div>') +
  lc('S70 Pro Max ···A101', 'принят 18.09 · загрузка —', money('−1 351 ₾', 'crit') + '<div class="b crit">себест. предварительная</div>') +
  card('Итого по парку аренды', dl([('Себестоимость', '47 600,00 ₾', 'money'), ('Выручка аренды', '23 847,05 ₾', 'money'), ('Ремонты', '−2 310,00 ₾', 'money'), ('Оплачено до переноса', '4 200,00 ₾', 'money muted')])),
  tabbar('owner', '', 14))
dw = ('<div class="d-head"><h2>Отчёты</h2><span class="sub">неделя с 14 сентября</span><div class="acts"><a class="btn btn-sm" href="#">Печать · PDF</a></div></div>'
 '<div class="d-tabs"><a class="on" href="#">Неделя</a><a href="#">Загрузка парка</a><a href="#">Экономика</a></div>'
 '<div class="d-body"><div class="cols" style="grid-template-columns:1fr 1fr">'
 + card('Цифры недели', dl(week_rows)) +
 '<div>' + card('Загрузка парка аренды', '<div class="hero">64 %</div><div class="small muted">дни в аренде 486 из 756</div><table class="table" style="margin-top:10px"><tr><th>Модель</th><th class="r">Загрузка</th></tr><tr><td>XL1200</td><td class="r money">79 %</td></tr><tr><td>Eagle</td><td class="r money">61 %</td></tr><tr><td>F-150</td><td class="r money">38 %</td></tr></table>')
 + card('Решения недели', '<div class="small muted">Пишутся в книгу (<code>weekly/</code>), не в систему: система даёт цифры, решения остаются у людей.</div>') + '</div></div></div>')
dW = desk('<b>Отчёты на ноутбуке.</b> Неделя и загрузка рядом — то, что Mika и Kardu смотрят вместе раз в неделю.', rail('reports', 'owner', 14), dw)

page('wave-6-reports.html', 'Волна 6 · Отчёты',
 'Неделя по книге, загрузка парка аренды (главный риск по финплану) и экономика мопеда с честной пометкой предварительной себестоимости.',
 [('Волна', '6 · <code>docs/redesign/wave-6.md</code> §3.1–3.3'), ('Правила', '<code>weekly.md</code> «Какие цифры»; <code>finance-plan.md</code> (загрузка — главный риск); <code>docs/metrics.md</code>'), ('Закрывает', 'B10-01, T4, аудит §7'), ('Данные', 'Пример')],
 [('Телефон', w1 + w2 + w3), ('Ноутбук', dW)])

# ================= SETTINGS =================
s1 = phone('<b>Настройки → Люди.</b> Роль из двух (волна 1), подтверждение смены; «Сбросить пароль» говорит «Пароль задан»; «Закрыть все входы» — если телефон потерян (волна 1, QA-1-01); «Отключить» вместо удаления — записи остаются в журнале.',
  head('Настройки'), stabs(ST, 'Люди') +
  lc('Mika', 'mika@… · вход сегодня 09:12', '<span class="st st-active"><i class="mk"></i>владелец</span>') +
  lc('Kardu', 'kardu@… · вход сегодня 08:40', '<span class="st st-active"><i class="mk"></i>владелец</span>') +
  lc('Менеджер Пример', 'manager@… · вход вчера', '<span class="st st-booked"><i class="mk"></i>менеджер</span>') +
  lc('Менеджер Пример 2', 'manager2@… · не входил', '<span class="st st-sold"><i class="mk"></i>отключён</span>'),
  tabbar('owner', '', 14), '<div class="action-bar"><a class="btn btn-primary btn-lg" href="#">Добавить человека</a></div>', body_cls='with-bar')
s2 = phone('<b>Точки с типом</b> (B10-02): шоурум · склад · мастерская · станция замены. Логики у станций пока нет — тип нужен, чтобы сеть замены не требовала переделки (решение Mika 17.09.2026). Сейчас по книге: шоурум на Нуцубидзе и мастерская подрядчика.',
  head('Настройки'), stabs(ST, 'Точки'), tabbar('owner', '', 14),
  overlay=sheet_form('Новая точка', fld('Название', 'Ваке · Agrohub') + '<div class="field"><span class="lbl">Тип</span><div style="display:flex;flex-wrap:wrap;gap:6px"><span class="chip">Шоурум</span><span class="chip">Склад</span><span class="chip">Мастерская</span><span class="chip on">Станция замены</span></div></div>' + fld('Адрес', 'пр. Ильи Чавчавадзе, 37მ') + '<div class="hint">Станция появится в списке точек как любая другая; учёт замен — с сетью замены.</div>', '<a class="btn btn-primary btn-lg" href="#" style="width:100%">Создать точку</a>'))
s3 = phone('<b>Настройки → Аренда.</b> Тарифы и залог по умолчанию переезжают из кода в настройки (R5, B4-05): мастер выдачи берёт тариф модели, а эти — как быстрые кнопки. Правит владелец, изменения в журнал. На запуск — один тариф 150 ₾ и залог 180 ₾ (решение Mika 21.09.2026).',
  head('Настройки'), stabs(ST, 'Аренда') +
  card('Тарифы аренды в неделю', '<div style="display:flex;gap:8px;flex-wrap:wrap"><span class="chip on">150 ₾</span><span class="chip">+ добавить</span></div><div class="hint">На запуск — один тариф 150 ₾ (решение Mika 21.09.2026). 140 и 170 у старых аренд сохранены; для особого случая тариф правится в мастере. Тариф модели подставляется первым.</div>') +
  card('', dl([('Залог по умолчанию', '180,00 ₾ ›', 'money'), ('Неделя аренды', '7 дней от выдачи', 'muted'), ('Опоздание по договору', '30 ₾/день · п.6', 'muted')])) +
  '<div class="hint">Серые строки — правила из книги и договора, их нельзя поменять здесь: <code>rental.md</code>.</div>',
  tabbar('owner', '', 14))
s4 = phone('<b>Настройки → Журнал</b> (B9-01, X3). Каждое изменение — «было / стало», кто и когда; входы и неудачные попытки; удалённые строки — архивом, не физически. Фильтры: запись, человек, дата, вид события.',
  head('Настройки'), stabs(ST, 'Журнал') +
  '<div style="display:flex;gap:8px;margin-bottom:10px"><div class="input" style="flex:1">' + ic('search','i s') + '<span class="ph">R-00488, SL-…, имя, VIN</span></div><a class="btn btn-round" href="#">' + ic('sort') + '</a></div>' +
  '<div class="chips"><span class="chip on">Всё</span><span class="chip">Деньги</span><span class="chip">Залоги</span><span class="chip">Состояния</span><span class="chip">Входы</span></div>' +
  '<ul class="tl">'
  '<li><div><b>Удержание залога</b> · R-00512 · 0,00 → 130,00 ₾<div class="when">18.09 15:20 · Kardu · «ключ не вернул»</div></div></li>'
  '<li><div><b>Цена продажи</b> · SL-00169 · 5 188,00 → 5 000,00 ₾<div class="when">18.09 12:03 · Mika · «скидка по договорённости»</div></div></li>'
  '<li><div><b>Неудачный вход</b> · manager@… · 3-я попытка<div class="when">18.09 08:31 · IP 5.…</div></div></li>'
  '<li><div><b>Просмотр личного номера</b> · Клиент Пример Б<div class="when">17.09 19:02 · Kardu</div></div></li></ul>',
  tabbar('owner', '', 14))
s5 = phone('<b>Настройки → Вход</b> (B9-03, Q30). Срок сессии и выход по бездействию — умолчание 30 и 7 дней; попытки входа считаются в базе по адресу и IP, ответ одинаково быстр и для несуществующего адреса (<code>practices.md</code> §4).',
  head('Настройки'), stabs(ST, 'Вход') +
  card('', dl([('Срок сессии', '30 дней ›', ''), ('Выход по бездействию', '7 дней ›', ''), ('Блокировка после', '10 неудачных попыток ›', ''), ('Демо-учётки на стенде', 'запрещены', 'muted')])) +
  '<div class="hint">Смена своего пароля закрывает остальные входы (блок 1).</div>',
  tabbar('owner', '', 14))
s6 = phone('<b>Настройки → Перенос.</b> Всё начальное состояние в одном месте: действующая аренда, продажа с рассрочкой, остаток склада, долг поставщику (волны 3 и 5) — и разбор того, что пришло из Odoo.',
  head('Настройки'), stabs(ST, 'Перенос') +
  lc('Действующая аренда «с середины»', 'выдача в прошлом, «оплачено по», залог получен ранее', '<div class="b">волна 3 ›</div>') +
  lc('Продажа с рассрочкой', 'график как в договоре, оплачено до переноса', '<div class="b">волна 5 ›</div>') +
  lc('Остаток склада', 'количество и себестоимость, один раз', '<div class="b">волна 5 ›</div>') +
  lc('Долг поставщику', 'оплачено до переноса в GEL и валюте', '<div class="b">волна 5 ›</div>') +
  grp('Разобрать после переноса из Odoo', '3') +
  lc('Залоги без решения', '17 по завершённым арендам (register #23)', money('3 060 ₾') + '<div class="b">разобрать ›</div>') +
  lc('Аренды без VIN', '2 из 43', '<div class="b">дозаполнить ›</div>') +
  lc('Мопеды «в сервисе» без заявок', '6 на 16.09 (register #23)', '<div class="b">разобрать ›</div>'),
  tabbar('owner', '', 14))
s7 = phone('<b>Залоги из Odoo — разбор пачкой</b> (ответ на вопрос волны 3). В «Сегодня» это одна строка, а не 17. Три быстрых ответа на каждый и «Отметить выбранные»; причина обязательна, всё в журнал. После разбора строка из «Сегодня» уходит.',
  head('Залоги из Odoo', left='back', right=''),
  '<div class="card"><div class="small muted">Без решения</div><div class="hero">17</div><div class="small muted">3 060 ₾ числятся на руках по завершённым арендам</div></div>' +
  '<div class="chips"><span class="chip on">Все 17</span><span class="chip">С суммой 180</span><span class="chip">Прочие</span></div>' +
  lc('Клиент Пример Ф · R-00301', 'аренда завершена 26.05 · залог 180', '<span class="chip">вернули</span>') +
  lc('Клиент Пример Х · R-00312', 'аренда завершена 03.06 · залог 180', '<span class="chip">удержали</span>') +
  lc('Клиент Пример Ц · R-00318', 'аренда завершена 11.06 · залог 180', '<span class="chip">нет данных</span>'),
  '', '<div class="action-bar bottom"><a class="btn btn-lg" href="#">Выбрать все</a><a class="btn btn-primary btn-lg" href="#">Отметить: вернули ранее</a></div>', body_cls='bar-only')
s8 = phone('<b>Kommo у записи</b> (B10-03). У клиента, аренды и продажи — поле «Kommo»: вставили ссылку или id сделки, и запись открывается в Kommo. Связи в обе стороны нет — она ждёт тарифа с вебхуками (register #5). Поля «трекер» у мопеда нет: GPS не стоит ни на одном (Kardu, <code>incidents.md</code>; Q31 — нет).',
  head('Клиент Пример Б', left='back', right='dots'), '', tabbar('owner', 'rentals', 14),
  overlay=sheet_form('Kommo · Клиент Пример Б', fld('Ссылка или id сделки', 'https://ev8mopeds.kommo.com/leads/detail/1234567', hint='Ссылка открывается в Kommo; id хранится, чтобы связать записи, когда появятся вебхуки'), '<a class="btn btn-primary btn-lg" href="#" style="width:100%">Сохранить</a>'))
s9 = phone('<b>История изменений в карточке.</b> Тот же журнал, отфильтрованный по записи: в аренде, продаже, мопеде, клиенте. Видит владелец.',
  head('R-00488', left='back', right='dots'),
  grp('История изменений', '6') +
  '<ul class="tl"><li><div><b>Тариф</b> · 140,00 → 150,00 ₾<div class="when">01.08 · Kardu · «перезаключили договор»</div></div></li>'
  '<li><div><b>Адрес ночёвки</b> · «ул. Пример, 7» → «ул. Пример, 12»<div class="when">28.08 · Менеджер Пример</div></div></li>'
  '<li><div><b>Статус</b> · действует → спорная<div class="when">10.09 · Mika · «клиент не выходит на связь»</div></div></li></ul>',
  tabbar('owner', 'rentals', 14))

ds = ('<div class="d-head"><h2>Настройки</h2><span class="sub">журнал</span><div class="acts"><a class="btn btn-sm" href="#">Выгрузить CSV</a></div></div>'
 '<div class="d-tabs"><a href="#">Люди</a><a href="#">Точки</a><a href="#">Аренда</a><a class="on" href="#">Журнал</a><a href="#">Перенос</a><a href="#">Вход</a></div>'
 '<div class="d-body"><div class="toolbar"><div class="input">' + ic('search','i s') + '<span class="ph">запись, имя, VIN</span></div><span class="chip on">Всё</span><span class="chip">Деньги</span><span class="chip">Залоги</span><span class="chip">Входы</span><span class="small muted">18.09 — 21.09</span></div>'
 '<table class="table"><tr><th>Когда</th><th>Кто</th><th>Что</th><th>Запись</th><th>Было</th><th>Стало</th><th>Причина</th></tr>'
 '<tr><td>18.09 15:20</td><td>Kardu</td><td>Удержание залога</td><td>R-00512</td><td class="money">0,00</td><td class="money">130,00</td><td>ключ не вернул</td></tr>'
 '<tr><td>18.09 12:03</td><td>Mika</td><td>Цена продажи</td><td>SL-00169</td><td class="money">5 188,00</td><td class="money">5 000,00</td><td>скидка по договорённости</td></tr>'
 '<tr><td>18.09 08:31</td><td>manager@…</td><td>Неудачный вход</td><td>—</td><td>—</td><td>—</td><td>3-я попытка · IP 5.…</td></tr>'
 '<tr><td>17.09 19:02</td><td>Kardu</td><td>Просмотр личного номера</td><td>Клиент Пример Б</td><td>—</td><td>—</td><td>умолчание Q27</td></tr></table></div>')
dS = desk('<b>Журнал на ноутбуке.</b> Таблица с «было / стало» и причиной; фильтры и выгрузка для разбора.', rail('settings', 'owner', 14), ds)

page('wave-6-settings.html', 'Волна 6 · Настройки, журнал, перенос',
 'Люди и роли, точки с типом, тарифы и залог из настроек, журнал «было / стало», перенос начального состояния и разбор того, что пришло из Odoo, поля Kommo.',
 [('Волна', '6 · <code>docs/redesign/wave-6.md</code> §3.4–3.8'), ('Правила', '<code>rental.md</code>, <code>pricing.md</code> (тарифы), <code>places.md</code> (точки), ТЗ v1.1 §8 (журнал)'), ('Закрывает', 'B9-01, B9-03, B10-02, B10-03, B1-03 (остаток), R5, X3, X5'), ('Данные', 'Пример')],
 [('Телефон', s1 + s2 + s3 + s4 + s5 + s6 + s7 + s8 + s9), ('Ноутбук', dS)])
print('ok wave6')
