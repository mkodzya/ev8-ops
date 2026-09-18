from proto_base import *
from p_today import q, grp, prim, sec, CALL, WA
from p_wave1 import stabs, lc, tb, money, fld, sheet_form
import proto_base
proto_base.WAVE1 = False

OT = ['Разобрать 5', 'Платежи', 'Касса 1', 'Выписки', 'Залоги']
def otabs(on): return stabs(OT, on)
MT = ['Касса', 'Мои платежи']

def mcard(amount, meta, text, hint, acts, tone='ok', extra=''):
    h = f'<div class="banner {tone}" style="margin:8px 0 10px">{ic("check" if tone=="ok" else "alert","i s")}<div>{hint}</div></div>' if hint else ''
    return (f'<div class="card"><div style="display:flex;justify-content:space-between;align-items:baseline"><div class="q-sum" style="text-align:left">{amount}</div><div class="small muted">{meta}</div></div>'
            f'<div class="small mono muted" style="margin-top:4px;word-break:break-word">{text}</div>{h}{extra}<div style="display:flex;gap:8px;flex-wrap:wrap">{acts}</div></div>')
chip = lambda t: f'<a class="btn btn-sm" href="#">{t}</a>'
dots = f'<a class="btn btn-sm btn-round" href="#" aria-label="Ещё">{ic("dots","i s")}</a>'

# ================= Разобрать =================
q_body = (otabs('Разобрать 5') +
  '<div class="chips" style="margin-top:-4px"><span class="chip on">Поступления 3</span><span class="chip">Списания 2</span></div>' +
  grp('Похоже, уже записан', '1') +
  mcard('+150,00 ₾', '18.09 · TBC', 'PRIMER KLIENT V 150.00 GEL', '<b>Уже внесён вручную:</b> наличные 150 ₾ от 17.09, Менеджер Пример, R-00491. Строка выписки — это он?',
        prim('Да, это он') + chip('Нет, другой платёж'), 'ok') +
  grp('Подсказки', '2') +
  mcard('+325,05 ₾', '15.09 · BOG', 'Wallet/domestic MC cards 330.00 GEL', '<b>Карта:</b> 325,05 = 330 − 1,5 %. Аренда R-00520 выдана 15.09, ждёт 330 ₾. Имени в строке нет.',
        prim('Привязать к R-00520') + chip('Другое') + dots) +
  mcard('+150,00 ₾', '14.09 · TBC', 'PRIMER KLIENT B — for moped rent', '<b>Имя совпало:</b> «Клиент Пример Б». Долг 300 ₾ по R-00488 (возвращена 10.09).',
        prim('Привязать к R-00488') + chip('SL-00169 · долг 1 396') + dots) +
  '<a class="q-more" href="#">Разобрано правилами за неделю: 5 · проверить</a>')
w1 = phone('<b>Разобрать — владелец.</b> Три группы: «Похоже, уже записан» (сверка с внесёнными ±3 дня, B2-03), «Подсказки» с причиной словами (первая — главной кнопкой, остальные — тихими, B2-05) и «Без подсказки», когда такие строки есть — сразу с поиском записи. Отдельно — поступления и списания.',
  head('Деньги'), q_body, tabbar('owner', 'money', 9))

picker = sheet_form('Куда привязать 150 ₾', '<div class="input focus" style="margin-bottom:10px">' + ic('search','i s') + 'пример б</div>' +
  grp('Клиент Пример Б', 'должен 1 696') +
  lc('Аренда R-00488', 'возвращена 10.09 · 2 недели', money('300 ₾', 'crit')) +
  lc('Продажа SL-00169', 'взнос от 01.09', money('1 396 ₾', 'crit')) +
  lc('На счёт клиента', 'переплата уйдёт в следующий платёж', money('—')) , '<div class="hint">Поиск: номер записи, имя, телефон. Показаны записи с долгом и «на счёт клиента».</div>')
w2 = phone('<b>«Другое» — привязать к другой записи.</b> Поиск по номеру, имени, телефону (не обрезанный список). Можно к аренде (и возвращённой с долгом), к взносу продажи, на счёт клиента (B2-05).',
  head('Деньги'), q_body, tabbar('owner', 'money', 9), overlay=picker)

notours = sheet_form('Это не платёж клиента', '<div class="card" style="background:var(--surface-2)"><div class="q-who">+45,00 ₾ · 16.09 · TBC</div><div class="small mono muted">Refund card fee</div></div>' +
  fld('Что это на самом деле', 'Возврат комиссии банком', hint='Причина обязательна; строка уйдёт из очереди, в журнал — кто и почему') , '<a class="btn btn-primary btn-lg" href="#" style="width:100%">Убрать из очереди</a>')
w3 = phone('<b>«⋯ → Это не наше».</b> Строка уходит из очереди с обязательной причиной. Взнос наличных сюда не попадает: он связывается с записью «Внёс в банк» из кассы (решение Mika 18.09.2026).',
  head('Деньги'), q_body, tabbar('owner', 'money', 9), overlay=notours)

out_body = (otabs('Разобрать 5') +
  '<div class="chips" style="margin-top:-4px"><span class="chip">Поступления 3</span><span class="chip on">Списания 2</span></div>' +
  mcard('−2 000,00 ₾', '11.09 · BOG', 'Transfer to Zhejiang Primer Co. inv DEMO-14', '<b>Похоже на оплату поставщику:</b> PO-00114 «Поставщик Пример 2», внесено вручную 2 000 ₾ от 11.09.',
        prim('Да, это она') + chip('Нет') ) +
  mcard('−109,95 ₾', '31.08 · BOG', 'Service fee for August', '',
        sec('Расход компании') + chip('Оплата поставщику…') + chip('Выдача залога…')))
w4 = phone('<b>Списания.</b> Исходящие строки сверяются с оплатами поставщику и выдачами залога. Расходы компании (комиссии банка, аренда, связь) в системе не ведутся: «Расход компании» одним нажатием убирает строку из очереди.',
  head('Деньги'), out_body, tabbar('owner', 'money', 9))

sending = phone('<b>Двойной тап — одна привязка.</b> Первое нажатие — «Привязываем…», карточка тускнеет, второе ничего не делает. Затем карточка уходит, внизу «Привязано к R-00520 · Отменить» на 10 с (B2-02).',
  head('Деньги'),
  otabs('Разобрать 3') + grp('Подсказки', '2') +
  '<div style="opacity:.55">' + mcard('+325,05 ₾', '15.09 · BOG', 'Wallet/domestic MC cards 330.00 GEL', '<b>Карта:</b> 325,05 = 330 − 1,5 %. Аренда R-00520.', '<a class="btn btn-primary sending" href="#">Привязываем…</a>') + '</div>',
  tabbar('owner', 'money', 9), overlay=f'<div class="toast">{ic("check","i s")}Привязано к R-00520 · 330 ₾, комиссия 4,95<a href="#">Отменить</a><span class="drain"></span></div>')

auto = phone('<b>Разобрано правилами.</b> Что правила привязали сами, с причиной; «Отвязать» возвращает строку в очередь (B2-07, ADR-0004). Правила привязывают только по двум признакам и не трогают спорные и паузу (B2-04, Q25).',
  head('Разобрано правилами', left='back', right=''),
  '<div class="date">За неделю с 14.09 · 5 строк</div>' +
  mcard('+150,00 ₾', '16.09 · TBC', 'PRIMER KLIENT A rent', '<b>Имя и сумма:</b> Клиент Пример А, R-00497, неделя 16.09–22.09.', sec('Открыть') + chip('Отвязать')) +
  mcard('+315,20 ₾', '15.09 · BOG', 'Tanxa:GEL 320; sakomisio: GEL 4.80', '<b>Карта в день выдачи:</b> 315,20 = 320 − 1,5 %, R-00518 выдана 15.09.', sec('Открыть') + chip('Отвязать')),
  '', body_cls='no-tabs')

ka_body = (stabs(['დასახარისხებელი 5', 'გადახდები', 'სალარო 1', 'ამონაწერები', 'დეპოზიტები'], 'დასახარისხებელი 5') +
  grp('ჰგავს, უკვე გატარებულია', '1') +
  mcard('+150,00 ₾', '18.09 · თიბისი', 'PRIMER KLIENT V 150.00 GEL', '<b>უკვე გატარებულია ხელით:</b> ნაღდი 150 ₾, 17.09, მენეჯერი მაგალითი, R-00491. ეს ის არის?',
        prim('დიახ, ეს არის') + chip('არა, სხვაა')) +
  grp('ჰგავს', '2') +
  mcard('+325,05 ₾', '15.09 · საქართველოს ბანკი', 'Wallet/domestic MC cards 330.00 GEL', '<b>ბარათი:</b> 325,05 = 330 − 1,5 %. ქირაობა R-00520 გაიცა 15.09, ელოდება 330 ₾-ს.',
        prim('მიბმა R-00520-ზე') + chip('სხვა') + dots))
w_ka = phone('<b>То же на грузинском</b> — длина кнопок и подсказок. Строки «ჰგავს», «ბარათი», «ნაღდი» — из словаря интерфейса; новые («დასახარისხებელი», «ჰგავს, უკვე გატარებულია», «მიბმა … -ზე») — предложение, вычитать (register #15).',
  head('ფული'), ka_body, tabbar('owner_ka', 'money', 9))

w_empty = phone('<b>Пусто.</b> Всё разобрано; свежесть выписок по банкам и что сделали правила.',
  head('Деньги'), otabs('Разобрать') + f'<div class="empty"><div class="big">{ic("check")}</div><h4>Всё разобрано</h4><p>BOG загружена сегодня в 09:12 · TBC — 2 дня назад</p><a class="btn" href="#">Загрузить выписку</a></div><a class="q-more" href="#">Разобрано правилами за неделю: 8 · проверить</a>',
  tabbar('owner', 'money', 5))
w_off = phone('<b>Нет связи.</b> Очередь видна на время загрузки; привязка требует сервера — нажатие даст «Не записалось — повторить», ключ сделает повтор безопасным.',
  head('Деньги'), otabs('Разобрать 5') + mcard('+325,05 ₾', '15.09 · BOG', 'Wallet/domestic MC cards 330.00 GEL', '<b>Карта:</b> R-00520.', '<a class="btn btn-lg failed" href="#" style="flex:1">Не записалось — повторить</a>'),
  tabbar('owner', 'money', 9), sync=f'<div class="syncbar">{ic("cloud","i s")}Нет связи — очередь на 14:02</div>')

dq = ('<div class="d-head"><h2>Деньги</h2><span class="sub">5 строк ждут разбора</span><div class="acts"><a class="btn btn-sm" href="#">Загрузить выписку</a><a class="btn btn-sm btn-primary" href="#">Принять деньги</a></div></div>'
 '<div class="d-tabs"><a class="on" href="#">Разобрать <span class="n">5</span></a><a href="#">Платежи</a><a href="#">Касса <span class="n">1</span></a><a href="#">Выписки</a><a href="#">Залоги</a></div>'
 '<div class="d-body" style="padding-right:460px"><div class="toolbar"><span class="chip on">Поступления 3</span><span class="chip">Списания 2</span><span class="small muted">BOG — 3 дня назад · TBC — сегодня</span></div>'
 '<table class="table"><tr><th>Дата</th><th>Банк</th><th>Текст банка</th><th class="r">Сумма</th><th>Что это</th></tr>'
 '<tr><td>18.09</td><td>TBC</td><td class="mono small">PRIMER KLIENT V 150.00 GEL</td><td class="r money">+150,00</td><td>уже записан?</td></tr>'
 '<tr class="sel"><td>15.09</td><td>BOG</td><td class="mono small">Wallet/domestic MC cards 330.00 GEL</td><td class="r money">+325,05</td><td>R-00520 · карта</td></tr>'
 '<tr><td>14.09</td><td>TBC</td><td class="mono small">PRIMER KLIENT B — for moped rent</td><td class="r money">+150,00</td><td>R-00488 · имя</td></tr></table>'
 '<p class="small muted">↑↓ строка · Enter — привязать к подсказке · / — другая запись · N — не наше</p></div>')
dpanel = ('<div class="panel" style="top:130px"><div class="small muted">15.09 · BOG</div><div class="hero">+325,05 ₾</div><div class="mono small muted" style="margin:6px 0 14px">Wallet/domestic MC cards 330.00 GEL</div>'
 f'<div class="banner ok">{ic("check","i s")}<div><b>Карта:</b> 325,05 = 330 − 1,5 %. Аренда R-00520 выдана 15.09 и ждёт 330 ₾ (неделя 150 + залог 180). Имени нет.</div></div>'
 '<dl class="kv" style="margin-bottom:14px"><dt>Клиент заплатил</dt><dd class="money">330,00</dd><dt>Комиссия — расход</dt><dd class="money">4,95</dd><dt>Закроет</dt><dd>залог 180 · неделя 15.09–21.09</dd></dl>'
 '<a class="btn btn-primary" href="#" style="width:100%;margin-bottom:8px">Привязать к R-00520</a>'
 '<div class="input" style="margin-bottom:8px">' + ic('search','i s') + '<span class="ph">Другая запись: номер, имя, телефон</span></div>'
 '<a class="btn btn-quiet" href="#" style="width:100%">Это не наше…</a></div>')
dw = desk('<b>Ноутбук.</b> Таблица и панель строки; клавиши для Mika: стрелки, Enter, «/», N.', rail('money', 'owner', 9), dq, dpanel)

page('wave-2-sort.html', 'Волна 2 · Разобрать выписку',
 'Очередь строк выписки, которые правила не привязали сами: сверка с уже внесёнными, подсказки с причиной, привязка к аренде, продаже или на счёт клиента, списания, «не наше».',
 [('Волна', '2 — деньги · <code>docs/redesign/wave-2.md</code> §3.2'), ('Схема', 'blueprint С4, D4, D12; ux №15'), ('Правила', '<code>money.md</code>: эквайринг без имени, −1,5 %; ADR-0004 EV8 Ops'), ('Закрывает', 'B2-02…B2-07, M2–M5, M9, M10'), ('Данные', 'Пример; тексты банка выдуманы')],
 [('Телефон', w1 + w2 + w3 + w4 + sending + auto), ('Грузинский и состояния', w_ka + w_empty + w_off), ('Ноутбук', dw)])

# ================= Форма денег =================
def mf(title, body, btn):
    return sheet_form(title, body, btn)
seg_dir = '<div class="field"><div class="seg3" style="grid-template-columns:1fr 1fr"><span class="on">' + ic('in','i s') + ' Приход</span><span>' + ic('out','i s') + ' Расход</span></div></div>'
who = ('<div class="input focus" style="margin-bottom:10px">' + ic('search','i s') + '<span class="ph">Клиент, телефон, номер записи</span></div>' +
  grp('Недавно', '') + lc('Клиент Пример В', 'R-00491 · XL1200 ···1180', money('150 ₾', 'crit')) + lc('Клиент Пример К', 'SL-00171 · взнос 4 из 9 — 01.10', money('0 ₾')) + lc('Клиент Пример Е', 'R-00520 · ждёт оплаты', money('330 ₾', 'crit')))
f1 = phone('<b>«＋ → Принять деньги», шаг «От кого».</b> Поиск клиента или записи; сразу видно, кто сколько должен (одна цифра долга).',
  head('Сегодня'), '', tabbar('owner', 'today', 7), overlay=mf('Принять деньги', seg_dir + who, ''))

alloc = ('<div class="card" style="background:var(--surface-2)"><div class="small muted">Закроет</div>'
 '<dl class="kv" style="margin-top:6px"><dt>Неделя 12.09–18.09</dt><dd class="money">150,00</dd></dl><div class="small ok" style="margin-top:6px">Оплачено будет по 18.09 · долг 0</div></div>')
f2 = phone('<b>Сумма и канал.</b> Клиент выбран: его долги по записям; сумма подсказана чипами; ниже — что закроет платёж и новое «оплачено по». Наличные — сразу.',
  head('Сегодня'), '', tabbar('owner', 'today', 7),
  overlay=mf('Принять деньги', '<div class="card"><div class="q-who">Клиент Пример В</div><div class="q-why">Должен 150 ₾ · R-00491, неделя 12.09–18.09</div></div>' +
   '<div class="field"><span class="lbl">Сумма</span><div class="input"><b class="mono">150,00 ₾</b></div><div style="display:flex;gap:6px;margin-top:8px"><span class="chip on">150 · долг</span><span class="chip">300 · + следующая неделя</span></div></div>' +
   '<div class="field"><span class="lbl">Канал</span><div class="seg3"><span class="on">Наличные</span><span>Карта</span><span>Перевод</span></div></div>' + alloc,
   '<a class="btn btn-primary btn-lg" href="#" style="width:100%">Записать 150 ₾</a>'))
f3 = phone('<b>Карта.</b> Клиент заплатил 330 — банк зачислит 325,05, комиссия 4,95 — расход компании; долг гасится по 330 (<code>money.md</code>). Так же для продаж (M12).',
  head('Аренда R-00520', left='back', right='dots'), '', tabbar('owner', 'rentals', 7),
  overlay=mf('Принять оплату · R-00520', '<div class="field"><span class="lbl">Клиент заплатил</span><div class="input"><b class="mono">330,00 ₾</b></div><div style="display:flex;gap:6px;margin-top:8px"><span class="chip on">330 · неделя + залог</span></div></div>' +
   '<div class="field"><span class="lbl">Канал</span><div class="seg3"><span>Наличные</span><span class="on">Карта</span><span>Перевод</span></div></div>' +
   f'<div class="banner info">{ic("money","i s")}<div>Банк зачислит <b class="mono">325,05 ₾</b>; комиссия <b class="mono">4,95 ₾</b> — расход компании. Строка выписки найдёт этот платёж сама.</div></div>' +
   '<div class="card" style="background:var(--surface-2)"><div class="small muted">Закроет</div><dl class="kv" style="margin-top:6px"><dt>Залог</dt><dd class="money">180,00</dd><dt>Неделя 15.09–21.09</dt><dd class="money">150,00</dd></dl></div>',
   '<a class="btn btn-primary btn-lg" href="#" style="width:100%">Записать 330 ₾</a>'))
f4 = phone('<b>Частично и сверх долга.</b> 100 из 330: сначала залог, потом неделя — умолчание Q6, «как сейчас». Больше долга — лишнее «на счёт клиента, уйдёт в следующую неделю» (<code>rental.md</code>).',
  head('Аренда R-00520', left='back', right='dots'), '', tabbar('owner', 'rentals', 7),
  overlay=mf('Принять оплату · R-00520', '<div class="field"><span class="lbl">Клиент заплатил</span><div class="input"><b class="mono">100,00 ₾</b></div></div>' +
   '<div class="field"><span class="lbl">Канал</span><div class="seg3"><span class="on">Наличные</span><span>Карта</span><span>Перевод</span></div></div>' +
   '<div class="card" style="background:var(--surface-2)"><div class="small muted">Закроет</div><dl class="kv" style="margin-top:6px"><dt>Залог</dt><dd class="money">100,00 из 180</dd><dt>Неделя 15.09–21.09</dt><dd class="money crit">0 из 150</dd></dl><div class="small crit" style="margin-top:6px">Останется долг 230 ₾</div></div>',
   '<a class="btn btn-primary btn-lg" href="#" style="width:100%">Записать 100 ₾</a>'))
f5 = phone('<b>Менеджер.</b> Только приход наличными сегодня: канала и даты нет, они фиксированы. Карту и перевод вносит владелец (как в блоке 1).',
  head('Сегодня', initial='М'), '', tabbar('manager', 'today', 4),
  overlay=mf('Принять наличные', '<div class="card"><div class="q-who">Клиент Пример В</div><div class="q-why">Должен 150 ₾ · R-00491</div></div>' +
   '<div class="field"><span class="lbl">Сумма наличными</span><div class="input"><b class="mono">150,00 ₾</b></div><div style="display:flex;gap:6px;margin-top:8px"><span class="chip on">150 · долг</span></div></div>' + alloc +
   '<div class="hint">Сегодня, 17.09 · попадёт в вашу кассу</div>', '<a class="btn btn-primary btn-lg" href="#" style="width:100%">Записать 150 ₾</a>'))
f6 = phone('<b>Расход: выдать залог.</b> Из «Залоги → К выдаче» или из аренды. Основание и сумма подставлены, не больше полученного; канал обязателен; другому человеку — с причиной (решает один владелец, В1).',
  head('Деньги'), '', tabbar('owner', 'money', 9),
  overlay=mf('Выдать залог · R-00497', '<div class="field"><div class="seg3" style="grid-template-columns:1fr 1fr"><span>' + ic('in','i s') + ' Приход</span><span class="on">' + ic('out','i s') + ' Расход</span></div></div>' +
   '<div class="card"><dl class="kv"><dt>Залог получен</dt><dd class="money">180,00</dd><dt>Удержано</dt><dd class="money">0,00</dd><dt>К выдаче</dt><dd class="money"><b>180,00 ₾</b></dd></dl></div>' +
   '<div class="field"><span class="lbl">Как отдаём</span><div class="seg3" style="grid-template-columns:1fr 1fr"><span class="on">Наличные</span><span>Перевод</span></div></div>' +
   fld('Кому', 'Клиент Пример А — плательщик', hint='Другому человеку — по просьбе клиента, с причиной (<code>rental.md</code>)'),
   '<a class="btn btn-primary btn-lg" href="#" style="width:100%">Выдать 180 ₾</a>'))
f7 = phone('<b>Расход: оплата поставщику.</b> Из закупки. GEL со счёта, сумма в валюте инвойса и комиссия банка — чтобы потом сверить с контрактом. Пересчёт себестоимости после приёмки — волна 5.',
  head('PO-00115', left='back', right='dots'), '', '',
  overlay=mf('Оплатить поставщику · PO-00115', '<div class="card"><dl class="kv"><dt>Инвойс</dt><dd class="money">6 000 CNY</dd><dt>Оплачено</dt><dd class="money">0 GEL</dd></dl></div>' +
   fld('Ушло со счёта, GEL', '<b class="mono">2 541,42</b>') + fld('Это в валюте инвойса', '<b class="mono">6 000,00 CNY</b>', hint='Курс посчитается сам: 0,42357 GEL/CNY') +
   fld('Комиссия банка, GEL', '<span class="ph">если была</span>', hint='Расход компании, в себестоимость не входит') +
   '<div class="field"><span class="lbl">Канал</span><div class="seg3" style="grid-template-columns:1fr"><span class="on">Перевод</span></div></div>',
   '<a class="btn btn-primary btn-lg" href="#" style="width:100%">Записать оплату</a>'), body_cls='no-tabs')
f8 = phone('<b>Записано.</b> Лист закрылся, в карточке — новое «оплачено по». 10 секунд — «Отменить» (тот же человек, без причины; в журнал — «отменено сразу»). Потом — только «Аннулировать» с причиной у владельца.',
  head('Аренда R-00491', left='back', right='dots'),
  '<div class="card"><div style="display:flex;justify-content:space-between"><div><div class="small muted">Оплачено по</div><div class="hero">18.09</div></div><div style="text-align:right"><div class="small muted">Долг</div><div class="hero">0 ₾</div></div></div></div>',
  tabbar('owner', 'rentals', 6), overlay=f'<div class="toast">{ic("check","i s")}Записано 150 ₾ наличными<a href="#">Отменить</a><span class="drain"></span></div>')

dmf = desk('<b>Ноутбук.</b> Та же форма — панелью справа поверх карточки продажи: взнос по рассрочке картой, с комиссией.',
  rail('sales', 'owner', 9), '<div class="d-head"><h2>SL-00171</h2><span class="sub">Клиент Пример К · S70 Pro Max ···9051</span></div><div class="d-body" style="opacity:.4"><div class="card">Рассрочка: 9 взносов по 1 396 ₾, оплачено 3</div></div>',
  '<div class="panel"><div class="h3">Принять взнос · SL-00171</div>' + fld('Клиент заплатил', '<b class="mono">1 396,00 ₾</b>') +
  '<div class="field"><span class="lbl">Канал</span><div class="seg3"><span>Наличные</span><span class="on">Карта</span><span>Перевод</span></div></div>' +
  f'<div class="banner info">{ic("money","i s")}<div>Банк зачислит <b class="mono">1 375,06 ₾</b>; комиссия 20,94 ₾ — расход компании.</div></div>' +
  '<div class="card" style="background:var(--surface-2)"><div class="small muted">Закроет</div><dl class="kv"><dt>Взнос 4 из 9 · 01.10</dt><dd class="money">1 396,00</dd></dl></div><a class="btn btn-primary" href="#" style="width:100%">Записать 1 396 ₾</a></div>')

page('wave-2-money-form.html', 'Волна 2 · Одна форма денег',
 'Любые деньги — одной формой: приход и расход, аренда, залог, продажа, ремонт, поставщик, выкуп. Сумма подсказана, видно, что закроет платёж; карта считает комиссию везде.',
 [('Волна', '2 · <code>docs/redesign/wave-2.md</code> §3.1'), ('Схема', 'D5, D6; ux №5; С2'), ('Правила', '<code>money.md</code> (эквайринг, наличные, залог — обязательство); <code>rental.md</code> (гашение, переплата)'), ('Закрывает', 'B5-03, B7-03 (платёж), M11, M12, R1-часть «сумма к оплате»'), ('Данные', 'Пример')],
 [('Приход', f1 + f2 + f3 + f4 + f5), ('Расход и результат', f6 + f7 + f8), ('Ноутбук', dmf)])

# ================= Платежи и касса =================
def pay(sign, amount, who, meta, ch):
    cls = 'in' if sign == '+' else 'out'
    return f'<a class="lcard" href="#"><div><div class="a">{who}</div><div class="b">{meta}</div></div><div class="r"><div class="money {cls}" style="font-size:16px">{sign}{amount}</div><div class="b">{ch}</div></div></a>'
p1 = phone('<b>Платежи.</b> Со знаком и направлением; основание словами; фильтры в адресе — период, направление, канал, основание, кто внёс; итог над списком (B6-03).',
  head('Деньги'), otabs('Платежи') +
  '<div class="chips" style="margin-top:-4px"><span class="chip on">Эта неделя</span><span class="chip">Все каналы ▾</span><span class="chip">Приход и расход ▾</span><span class="chip">Основание ▾</span><span class="chip">Кто внёс ▾</span></div>' +
  '<div class="card"><dl class="kv"><dt>Приход</dt><dd class="money in">+1 980,00</dd><dt>Расход</dt><dd class="money">−2 180,00</dd><dt>Комиссия эквайринга</dt><dd class="money">−29,70</dd></dl></div>' +
  grp('Сегодня', '') + pay('+', '320,00', 'Клиент Пример С', 'залог 180 + неделя 140 · R-00518', 'карта · банк 315,20') + pay('−', '180,00', 'Клиент Пример А', 'выдача залога · R-00497', 'наличные · Kardu') +
  grp('11.09', '') + pay('−', '2 000,00', 'Поставщик Пример 2', 'оплата PO-00114 · 4 720 CNY', 'перевод · выписка ✓'),
  tabbar('owner', 'money', 9))
p2 = phone('<b>Страница платежа.</b> Что закрыл (распределение), строка выписки, кто и когда внёс. «⋯» — «Аннулировать» с причиной, только владелец; строка выписки возвращается в очередь (B2-07).',
  head('Платёж +320 ₾', left='back', right='dots'),
  '<div class="card"><div class="hero in">+320,00 ₾</div><dl class="kv" style="margin-top:8px"><dt>Клиент</dt><dd>Клиент Пример С ›</dd><dt>Канал</dt><dd>карта</dd><dt>Банк зачислил</dt><dd class="money">315,20</dd><dt>Комиссия — расход</dt><dd class="money">4,80</dd><dt>Дата</dt><dd>15.09.2026</dd><dt>Внёс</dt><dd>Менеджер Пример, 12:44</dd></dl></div>' +
  '<div class="card"><div class="h3">Закрыл</div><dl class="kv"><dt>Залог · R-00518</dt><dd class="money">180,00</dd><dt>Неделя 15.09–21.09</dt><dd class="money">140,00</dd></dl></div>' +
  '<div class="card"><div class="h3">Строка выписки</div><div class="small mono muted">BOG · 15.09 · Tanxa:GEL 320; sakomisio: GEL 4.80 · 315,20 · привязана правилом</div></div>',
  '', overlay='<div class="sheet-scrim"></div><div class="sheet"><div class="grab"></div><h4>Аннулировать платёж 320 ₾?</h4>' + fld('Причина', 'Записан дважды', hint='Обязательна. Недели и залог снова станут неоплаченными; строка выписки вернётся в «Разобрать».') + '<div style="display:flex;gap:8px"><a class="btn" href="#" style="flex:1">Отмена</a><a class="btn btn-primary" href="#" style="flex:1">Аннулировать</a></div></div>', body_cls='no-tabs')

c1 = phone('<b>Касса — владелец.</b> Наличные по людям за день: принято, выдано, сдано. Менеджер сдал — «Принять»; не сходится — сумма и причина (В3, <code>money.md</code>). У владельца — «Внёс в банк» (решение Mika 18.09.2026).',
  head('Деньги'), otabs('Касса 1') + '<div class="chips" style="margin-top:-4px"><span class="chip on">Сегодня</span><span class="chip">Неделя</span><span class="chip">Период ▾</span></div>' +
  '<div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><div class="q-who">Менеджер Пример</div><span class="st st-waiting"><i class="mk"></i>сдал 17:40</span></div>'
  '<dl class="kv" style="margin-top:8px"><dt>Принято наличными · 5</dt><dd class="money">480,00</dd><dt>Выдано</dt><dd class="money">0,00</dd><dt><b>Сдаёт</b></dt><dd class="money"><b>480,00 ₾</b></dd></dl>'
  '<div style="display:flex;gap:8px;margin-top:12px"><a class="btn btn-primary" href="#" style="flex:1">Принять 480 ₾</a><a class="btn" href="#">Не сходится</a></div></div>'
  '<div class="card"><div class="q-who">Kardu</div><dl class="kv" style="margin-top:8px"><dt>Принято наличными · 3</dt><dd class="money">540,00</dd><dt>Выдано · залог R-00497</dt><dd class="money">−180,00</dd><dt>Принято от менеджеров</dt><dd class="money">0,00</dd><dt>Внесено в банк</dt><dd class="money">0,00</dd><dt><b>На руках</b></dt><dd class="money"><b>360,00 ₾</b></dd></dl>'
  '<a class="btn" href="#" style="width:100%;margin-top:12px">' + ic('out','i s') + 'Внёс в банк</a></div>',
  tabbar('owner', 'money', 9))
c2 = phone('<b>Не сходится.</b> Сколько пересчитал владелец — и причина; расхождение видно в кассе и в журнале.',
  head('Деньги'), otabs('Касса 1'), tabbar('owner', 'money', 9),
  overlay=sheet_form('Принять кассу · Менеджер Пример', '<div class="card"><dl class="kv"><dt>По системе</dt><dd class="money">480,00</dd></dl></div>' + fld('Пересчитал', '<b class="mono">470,00 ₾</b>') + fld('Причина', 'Сдача клиенту 10 ₾ не записана', hint='Обязательна при расхождении; −10 ₾ останутся за менеджером до разбора'), '<a class="btn btn-primary btn-lg" href="#" style="width:100%">Принять 470 ₾</a>'))
c3 = phone('<b>Касса — менеджер.</b> Своё за сегодня: кто и сколько отдал наличными. «Сдал владельцу» — одной кнопкой; после этого сумма ждёт владельца.',
  head('Касса', initial='М'), stabs(MT, 'Касса') +
  '<div class="card"><div class="small muted">На руках сегодня</div><div class="hero">480,00 ₾</div></div>' +
  grp('Принято сегодня', '5') + pay('+', '150,00', 'Клиент Пример В', 'R-00491 · 12:10', 'наличные') + pay('+', '150,00', 'Клиент Пример Г', 'R-00503 · 11:02', 'наличные') + '<a class="q-more" href="#">Ещё 3</a>',
  tabbar('manager', 'cash', 4), '<div class="action-bar"><a class="btn btn-primary btn-lg" href="#">Сдал владельцу 480 ₾</a></div>', body_cls='with-bar')
c4 = phone('<b>Сдано — ждёт владельца.</b> Сумма закреплена, новые наличные после сдачи копятся отдельно.',
  head('Касса', initial='М'), stabs(MT, 'Касса') +
  '<div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><div class="small muted">Сдал 17:40</div><span class="st st-waiting"><i class="mk"></i>ждёт владельца</span></div><div class="hero">480,00 ₾</div></div>' +
  '<div class="card"><div class="small muted">После сдачи</div><div class="hero">0,00 ₾</div></div>', tabbar('manager', 'cash', 4))
c5 = phone('<b>Касса пуста.</b> Наличных сегодня не было.',
  head('Касса', initial='М'), stabs(MT, 'Касса') + f'<div class="empty"><div class="big">{ic("cash")}</div><h4>Сегодня наличных не было</h4><p>Принятые вами наличные появятся здесь.</p><a class="btn" href="#">Принять наличные</a></div>', tabbar('manager', 'cash', 4))


c6 = phone('<b>Внёс в банк.</b> Расход из кассы владельца, не больше «на руках». Строка выписки «взнос наличных» найдёт эту запись сама (±3 дня), и касса сойдётся с банком.',
  head('Деньги'), otabs('Касса 1'), tabbar('owner', 'money', 9),
  overlay=sheet_form('Внёс в банк', '<div class="card"><dl class="kv"><dt>На руках у Kardu</dt><dd class="money">1 700,00</dd></dl></div>' + fld('Сумма', '<b class="mono">1 000,00 ₾</b>', hint='Не больше, чем на руках') + '<div class="field"><span class="lbl">Банк</span><div class="seg3"><span class="on">BOG</span><span>TBC</span><span>Credo</span></div></div>' + fld('Дата', 'сегодня, 18.09'), '<a class="btn btn-primary btn-lg" href="#" style="width:100%">Записать 1 000 ₾</a>'))
dc = ('<div class="d-head"><h2>Деньги</h2><span class="sub">касса за неделю с 14.09</span></div><div class="d-tabs"><a href="#">Разобрать <span class="n">5</span></a><a href="#">Платежи</a><a class="on" href="#">Касса <span class="n">1</span></a><a href="#">Выписки</a><a href="#">Залоги</a></div>'
 '<div class="d-body"><table class="table"><tr><th>Кто</th><th class="r">Принято</th><th class="r">Выдано</th><th class="r">Сдал</th><th class="r">Принял владелец</th><th class="r">Расхождение</th><th class="r">В банк</th><th class="r">На руках</th><th></th></tr>'
 '<tr><td><b>Менеджер Пример</b></td><td class="r money">1 230,00</td><td class="r money">0,00</td><td class="r money">1 230,00</td><td class="r money">750,00</td><td class="r money">0,00</td><td class="r">—</td><td class="r money">480,00</td><td class="r"><a class="btn btn-sm btn-primary" href="#">Принять 480</a></td></tr>'
 '<tr><td><b>Менеджер Пример 2</b></td><td class="r money">600,00</td><td class="r money">0,00</td><td class="r money">600,00</td><td class="r money">590,00</td><td class="r money crit">−10,00</td><td class="r">—</td><td class="r money">0,00</td><td></td></tr>'
 '<tr><td><b>Kardu</b></td><td class="r money">540,00</td><td class="r money">−180,00</td><td class="r">—</td><td class="r money">1 340,00</td><td class="r">—</td><td class="r money">0,00</td><td class="r money">1 700,00</td><td class="r"><a class="btn btn-sm" href="#">Внёс в банк</a></td></tr></table></div>')
dcd = desk('<b>Ноутбук.</b> Касса за период по людям с итогом: принято − выдано − сдано = на руках; у владельца — плюс принятое от менеджеров.', rail('money', 'owner', 9), dc)

page('wave-2-payments-cash.html', 'Волна 2 · Платежи и касса',
 'Все платежи со знаком, страница платежа с распределением и аннулированием; касса наличных по людям: менеджер «сдал», владелец «принял».',
 [('Волна', '2 · <code>docs/redesign/wave-2.md</code> §3.3–3.4'), ('Правила', '<code>money.md</code> «Каналы денег» — касса по людям (решение Mika В3)'), ('Закрывает', 'B6-03, B2-07, B5-03, M10, M11, T5'), ('Данные', 'Пример')],
 [('Платежи', p1 + p2), ('Касса', c1 + c2 + c6 + c3 + c4 + c5), ('Ноутбук', dcd)])

# ================= Выписки и залоги =================
def bank(name, when, lines, tone=''):
    return lc(name, f'последняя: {when}', f'<div class="money {tone}" style="font-size:15px">{lines}</div>')
s1 = phone('<b>Выписки.</b> По банку: когда загружена последняя и за какой период; больше 7 дней — предупреждение (сигнал свежести, <code>practices.md</code>). Ниже — загрузки.',
  head('Деньги'), otabs('Выписки') +
  bank('Bank of Georgia', '15.09, по 14.09', '3 дня назад') + bank('TBC', '18.09, по 17.09', 'сегодня') + bank('Credo', 'не загружалась', 'нет файла', 'muted') +
  grp('Загрузки', '') + lc('BOG · StatementExport.csv', '01.09–14.09 · Mika · 15.09', '<div class="b">58 строк · 53 разобрано</div>'),
  tabbar('owner', 'money', 9), '<div class="action-bar"><a class="btn btn-primary btn-lg" href="#">Загрузить выписку</a></div>', body_cls='with-bar')
s2 = phone('<b>Предпросмотр загрузки.</b> До записи: банк и период, новые и уже загруженные, приход и расход; сколько совпало с внесёнными руками, сколько привяжут правила, сколько уйдёт в очередь (B2-03).',
  head('Загрузить выписку', left='close', right=''),
  '<div class="card"><div class="q-who">Bank of Georgia · 15.09–18.09</div><div class="q-why">StatementExport.csv · 214 КБ</div></div>' +
  '<div class="card"><dl class="kv"><dt>Новых строк</dt><dd class="money">12</dd><dt>Уже загружено раньше</dt><dd class="money">3</dd><dt>Поступлений · списаний</dt><dd class="money">10 · 2</dd><div class="hr" style="grid-column:1/-1"></div>'
  '<dt>Совпало с внесёнными вручную</dt><dd class="money ok">4</dd><dt>Привяжут правила</dt><dd class="money ok">5</dd><dt>Уйдут в «Разобрать»</dt><dd class="money">3</dd></dl></div>',
  '', '<div class="action-bar bottom"><a class="btn" href="#">Другой файл</a><a class="btn btn-primary btn-lg" href="#">Загрузить 12 строк</a></div>', body_cls='bar-only')
s3 = phone('<b>Готово.</b> Итог и переход к очереди.',
  head('Загрузить выписку', left='close', right=''), f'<div class="empty"><div class="big">{ic("check")}</div><h4>Загружено 12 строк</h4><p>4 совпали с внесёнными · 5 привязаны правилами · 3 ждут разбора</p><a class="btn btn-primary" href="#">Разобрать 3</a></div>', '', body_cls='no-tabs')
s4 = phone('<b>Файл не подошёл.</b> Слишком большой (QA-1-05), не выписка банка или всё уже загружено — сказать до отправки и что делать.',
  head('Загрузить выписку', left='close', right=''),
  f'<div class="banner crit">{ic("alert","i s")}<div><b>Файл 14,2 МБ — больше 10 МБ.</b> Выгрузите из банка период короче, например месяц.</div></div>'
  f'<div class="banner crit">{ic("alert","i s")}<div><b>Это не выписка BOG или TBC.</b> Нужен CSV из интернет-банка: StatementExport.csv — BOG, transactions_history.csv — TBC.</div></div>'
  f'<div class="banner info">{ic("check","i s")}<div><b>Все 58 строк уже загружены</b> 15.09. Новых нет.</div></div>', '', body_cls='no-tabs')

def dep(who, meta, right, pill):
    return lc(who, meta, right + f'<div style="margin-top:6px">{pill}</div>')
d1 = phone('<b>Залоги.</b> На руках — по полученному (умолчание Q16), начисленное — строкой ниже. Сегменты: на руках, к выдаче (решено вернуть, не выдано), недовнесён, закрыты. «К выдаче» → «Выдать» (форма денег, расход).',
  head('Деньги'), otabs('Залоги') +
  '<div class="card"><dl class="kv"><dt>На руках (получено)</dt><dd class="money"><b>3 240,00 ₾</b></dd><dt>Начислено по договорам</dt><dd class="money muted">3 420,00</dd></dl></div>' +
  '<div class="chips"><span class="chip">На руках 18</span><span class="chip on">К выдаче 1</span><span class="chip">Недовнесён 1</span><span class="chip">Закрыты 25</span></div>' +
  dep('Клиент Пример А', 'R-00497 · вернул 17.09 · решено вернуть всё', money('180 ₾'), '<a class="btn btn-sm btn-primary" href="#">Выдать</a>'),
  tabbar('owner', 'money', 9))
d2 = phone('<b>Недовнесён.</b> Залог по договору 180, получено 100 — долг клиента 80 входит в одну цифру долга.',
  head('Деньги'), otabs('Залоги') + '<div class="chips"><span class="chip">На руках 18</span><span class="chip">К выдаче 1</span><span class="chip on">Недовнесён 1</span></div>' +
  dep('Клиент Пример Е', 'R-00520 · выдан 15.09', money('100 из 180'), st('waiting', 'недовнесён 80')), tabbar('owner', 'money', 9))

bl = phone('<b>Одна цифра долга — в карточке клиента.</b> «Должен» = просрочено по арендам + просроченные взносы + неоплаченный ремонт за счёт клиента. Будущие взносы и залог — отдельными строками, не долг (B7-02, Q21). Та же цифра — в «Сегодня», аренде, продаже, поиске.',
  head('Клиент Пример Б', left='back', right='dots'),
  '<div class="card"><div class="small muted">Должен</div><div class="hero crit">1 696 ₾</div>'
  '<dl class="kv" style="margin-top:10px"><dt>Аренда R-00488 · 2 недели</dt><dd class="money">300,00</dd><dt>Продажа SL-00169 · взнос от 01.09</dt><dd class="money">1 396,00</dd></dl><div class="hr"></div>'
  '<dl class="kv"><dt class="muted">Впереди по рассрочке</dt><dd class="money muted">2 792,00</dd><dt class="muted">Залог на руках — не долг</dt><dd class="money muted">180,00</dd></dl></div>'
  f'<div style="display:flex;gap:8px">{CALL}{WA}<a class="btn btn-primary" href="#" style="flex:1">Принять деньги</a></div>',
  tabbar('owner', 'rentals', 9))
bl2 = phone('<b>Выкуплен обратно — долга нет.</b> После выкупа остаток графика закрыт, клиент больше не «должник» (M8; как именно закрывается остаток — умолчание Q20, волна 5).',
  head('Клиент Пример Р', left='back', right='dots'),
  '<div class="card"><div class="small muted">Долга нет</div><div class="hero">0 ₾</div><dl class="kv" style="margin-top:10px"><dt>SL-00168 · выкуплен обратно 12.09</dt><dd class="money muted">график закрыт</dd></dl></div>',
  tabbar('owner', 'rentals', 9))

dsd = ('<div class="d-head"><h2>Деньги</h2><span class="sub">залоги</span></div><div class="d-tabs"><a href="#">Разобрать <span class="n">5</span></a><a href="#">Платежи</a><a href="#">Касса</a><a href="#">Выписки</a><a class="on" href="#">Залоги</a></div>'
 '<div class="d-body"><div class="toolbar"><span class="chip on">На руках 18</span><span class="chip">К выдаче 1</span><span class="chip">Недовнесён 1</span><span class="chip">Закрыты 25</span><span class="small muted">на руках 3 240,00 ₾ · начислено 3 420,00</span></div>'
 '<table class="table"><tr><th>Аренда</th><th>Клиент</th><th class="r">По договору</th><th class="r">Получено</th><th class="r">Удержано</th><th class="r">Выдано</th><th class="r">На руках</th></tr>'
 '<tr><td>R-00488</td><td>Клиент Пример Б</td><td class="r money">180,00</td><td class="r money">180,00</td><td class="r money">0,00</td><td class="r money">0,00</td><td class="r money">180,00</td></tr>'
 '<tr><td>R-00520</td><td>Клиент Пример Е</td><td class="r money">180,00</td><td class="r money">100,00</td><td class="r money">0,00</td><td class="r money">0,00</td><td class="r money">100,00</td></tr>'
 '<tr><td>R-00512</td><td>Клиент Пример Д</td><td class="r money">180,00</td><td class="r money">180,00</td><td class="r money">180,00</td><td class="r money">0,00</td><td class="r money">0,00</td></tr></table></div>')
ddd = desk('<b>Ноутбук.</b> Залоги таблицей: по договору, получено, удержано, выдано, на руках.', rail('money', 'owner', 9), dsd)

page('wave-2-statements-deposits.html', 'Волна 2 · Выписки, залоги, одна цифра долга',
 'Загрузка выписки с предпросмотром и свежестью по банкам; залоги с «к выдаче»; одна цифра долга клиента.',
 [('Волна', '2 · <code>docs/redesign/wave-2.md</code> §3.5–3.7'), ('Правила', '<code>money.md</code>: залог — обязательство; <code>sales.md</code>: гашение взносов; <code>practices.md</code>: сигнал свежести'), ('Закрывает', 'B2-03 (предпросмотр), B7-02, M8, M16, QA-1-05'), ('Данные', 'Пример')],
 [('Выписки', s1 + s2 + s3 + s4), ('Залоги и долг', d1 + d2 + bl + bl2), ('Ноутбук', ddd)])
print('ok wave2')
