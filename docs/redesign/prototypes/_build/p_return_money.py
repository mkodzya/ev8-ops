from proto_base import *
from p_today import grp, q, prim, sec
from p_wizards import steps, wbar, wphone, field

def item(name, on, cls=''):
    opts = [('В порядке', ''), ('Повреждено', 'warn'), ('Нет', 'bad')]
    cells = ''.join(f'<span class="{"on " + c if o == on else ""}">{o}</span>' for o, c in opts)
    return f'<div class="field" style="margin-bottom:10px"><span class="lbl">{name}</span><div class="seg3">{cells}</div></div>'

N = 4
r1 = wphone('<b>1. Акт возврата.</b> Комплект — по одному нажатию на позицию, «В порядке» выбрано заранее. Позиции строятся из выданного: 2 батареи и 2 зарядки (B10-02). Пробег не меньше пробега при выдаче — ошибка словами.',
  'Возврат · R-00512',
  steps(1, N, 'Акт') +
  '<div class="card" style="margin-bottom:12px"><div class="q-who">Клиент Пример Д</div><div class="q-why">XL1200 ···4412 · выдан 02.09 · плановый возврат 16.09</div></div>' +
  field('Пробег, км', '1 200', err='Не меньше 1 234 — столько было при выдаче 02.09', cls='err') +
  item('Мопед', 'В порядке') + item('Ключ', 'Нет') + item('Батарея №1', 'В порядке') + item('Батарея №2', 'В порядке') +
  item('Зарядка №1', 'В порядке') + item('Зарядка №2', 'В порядке') +
  '<div class="field"><span class="lbl">Фото</span><div class="photos"><div class="photo">✓</div><div class="photo">✓</div><div class="photo add">' + ic('camera') + '</div></div></div>',
  wbar('Далее', back=False))

calc = ('<div class="card"><div class="h3">Расчёт по договору</div><dl class="kv">'
  '<dt>Долг по неделям</dt><dd class="money">0,00</dd>'
  '<dt>Опоздание 1 день · 30 ₾/день <span class="small">(п.6)</span></dt><dd class="money">30,00</dd>'
  '<dt>Ключ не возвращён <span class="small">(п.6)</span></dt><dd class="money">250,00</dd>'
  '<dt><b>Претензии</b></dt><dd class="money"><b>280,00 ₾</b></dd></dl><div class="hr"></div>'
  '<dl class="kv"><dt>Залог получен</dt><dd class="money">180,00 ₾</dd></dl></div>')
r2m = wphone('<b>2. Расчёт — менеджер.</b> Санкции подставлены из договора с пунктом (R7). Менеджер решение по залогу не принимает: «Решит владелец» и строка в «Сегодня» владельцев (D8, M6).',
  'Возврат · R-00512',
  steps(2, N, 'Расчёт') + calc +
  f'<div class="banner info">{ic("lock","i s")}<div><b>Залог решит владелец.</b> Возврат оформится сейчас, решение — в «Сегодня» у Kardu и Mika.</div></div>',
  wbar('Далее'))

r2o = wphone('<b>2. Залог — владелец.</b> Удержать можно не больше полученного (B5-02, M7). Основания и суммы подставлены, каждое можно поправить. Остаток претензий 100 ₾ становится долгом клиента — одна цифра долга (D6).',
  'Возврат · R-00512',
  steps(2, N, 'Залог') + calc +
  '<div class="field"><span class="lbl">Залог</span><div class="seg3"><span>Вернуть всё</span><span>Удержать часть</span><span class="on bad">Удержать всё</span></div></div>' +
  '<div class="card"><dl class="kv"><dt>Удержать</dt><dd class="money"><b>180,00 ₾</b></dd><dt>Вернуть клиенту</dt><dd class="money">0,00</dd><dt>Долг клиента после возврата</dt><dd class="money crit">100,00 ₾</dd></dl>'
  '<div class="hint">Основания: опоздание 30 · потеря ключа 150 из 250. Причина — в журнале и в неделе.</div></div>',
  wbar('Далее'))

r3 = wphone('<b>3. Куда встал мопед.</b> Точка из списка владельца или «В сервис» — тогда черновик ремонта с фото акта (R8, B5-06). Без ответа мопед будет в «Дозаполнить».',
  'Возврат · R-00512',
  steps(3, N, 'Мопед') +
  '<div class="field"><span class="lbl">Состояние</span><div class="seg3" style="grid-template-columns:1fr 1fr"><span class="on">Свободен</span><span>В сервис</span></div></div>' +
  '<div class="field"><span class="lbl">Точка</span><div style="display:flex;flex-wrap:wrap;gap:8px"><span class="chip on">' + ic('pin','i s') + 'Шоурум Нуцубидзе</span><span class="chip">Мастерская</span><span class="chip">Другая…</span></div></div>' +
  '<div class="hint">Точки ведёт владелец в «Настройки → Точки». Точка «станция» появится с сетью замены.</div>',
  wbar('К итогу'))

r4 = wphone('<b>4. Итог и подтверждение.</b> Удержание — необратимое, поэтому подтверждение словами действия и суммой. Второй владелец его не подтверждает (В1) — оно видно в журнале и в неделе.',
  'Возврат · R-00512',
  steps(4, N, 'Итог') +
  '<div class="card"><dl class="kv"><dt>Пробег</dt><dd>1 312 км ›</dd><dt>Комплект</dt><dd class="crit">ключ — нет ›</dd><dt>Претензии</dt><dd class="money">280,00 ₾ ›</dd><dt>Залог</dt><dd class="money">удержать 180,00 ›</dd><dt>Долг клиента</dt><dd class="money crit">100,00 ₾</dd><dt>Мопед</dt><dd>свободен · шоурум ›</dd></dl></div>',
  '<div class="action-bar bottom"><a class="btn btn-round" href="#">' + ic('left') + '</a><a class="btn btn-primary btn-lg" href="#">Оформить возврат</a></div>',
  overlay='<div class="sheet-scrim"></div><div class="sheet"><div class="grab"></div><h4>Удержать 180 ₾ из залога?</h4><p class="small muted" style="margin:0 0 14px">Клиент Пример Д · опоздание 30 ₾, потеря ключа 150 ₾. Остаток 100 ₾ станет долгом клиента. Отменить нельзя — только новым платежом.</p><div style="display:flex;gap:8px"><a class="btn" href="#" style="flex:1">Отмена</a><a class="btn btn-primary" href="#" style="flex:1">Удержать 180 ₾</a></div></div>')

r5 = phone('<b>Готово.</b> Акт возврата с решением по залогу (без «претензий нет», пока залог не решён — R10) — на подпись без повторного ввода (D17). Батареи вернулись в шоурум: счёт обновился (D16). Если вернуть часть — сразу «Выдать залог»: исходящий платёж с каналом (M11).',
  head('Возврат', left='close', right=''),
  f'<div class="empty" style="padding:28px 12px 16px"><div class="big">{ic("check")}</div><h4>Возврат оформлен</h4><p>R-00512 закрыта · XL1200 ···4412 свободен в шоуруме<br>Удержано 180 ₾ · долг клиента 100 ₾</p></div>' +
  '<div class="card"><a class="lcard" href="#" style="margin:0;padding:10px 0"><div><div class="a">' + ic('file','i s') + ' Акт возврата и расчёта</div><div class="b">ka / en · PDF</div></div><div class="r"><span class="st st-waiting"><i class="mk"></i>не подписан</span></div></a>'
  '<div style="display:flex;gap:8px;margin-top:10px"><a class="btn btn-primary" href="#" style="flex:1">' + ic('send','i s') + 'Отправить на подпись</a><a class="btn" href="#">На экране</a></div></div>' +
  '<a class="btn btn-quiet" href="#" style="width:100%;margin:4px 0">' + ic('chat','i s') + 'Написать клиенту в WhatsApp</a>',
  '', '<div class="action-bar bottom"><a class="btn" href="#">Клиент</a><a class="btn btn-primary btn-lg" href="#">На «Сегодня»</a></div>', body_cls='bar-only')

payout = wphone('<b>Выдать залог.</b> Другой возврат: залог вернуть полностью. Одна форма денег, направление «расход», основание «залог», сумма не больше полученного, канал обязателен.',
  'Выдать залог',
  '<div class="card"><div class="q-who">Клиент Пример А · R-00497</div><div class="q-why">Залог получен 180 ₾ · решено: вернуть всё</div></div>' +
  '<div class="field"><span class="lbl">Как отдаём</span><div class="seg3" style="grid-template-columns:1fr 1fr"><span class="on">Наличные</span><span>Перевод</span></div></div>' +
  field('Сумма', '180,00 ₾', hint='Не больше полученного залога') +
  field('Кому', 'Клиент Пример А — плательщик', hint='Другому человеку — с причиной; попадёт в журнал'),
  '<div class="action-bar bottom"><a class="btn btn-primary btn-lg" href="#">Выдать 180 ₾</a></div>')

# desktop return
dr = ('<div class="d-head"><h2>Возврат · R-00512</h2><span class="sub">Клиент Пример Д · XL1200 ···4412</span><div class="acts"><a class="btn btn-sm" href="#">Черновик</a></div></div>'
 '<div class="d-body"><div class="cols" style="grid-template-columns:1fr 380px">'
 '<div class="card" style="padding:20px"><div class="h3">Акт</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:0 20px">' +
 field('Пробег, км', '1 312', hint='При выдаче 1 234') + field('Дата и время', '17.09.2026, 15:10') +
 item('Мопед', 'В порядке') + item('Ключ', 'Нет') + item('Батарея №1', 'В порядке') + item('Батарея №2', 'В порядке') + item('Зарядка №1', 'В порядке') + item('Зарядка №2', 'В порядке') +
 '</div><div class="field"><span class="lbl">Фото</span><div class="photos"><div class="photo">✓</div><div class="photo">✓</div><div class="photo add">' + ic('camera') + '</div></div></div>'
 '<div class="field"><span class="lbl">Куда встал</span><div style="display:flex;gap:8px"><span class="chip on">Свободен · Шоурум Нуцубидзе</span><span class="chip">В сервис</span></div></div></div>'
 '<div>' + calc +
 '<div class="card"><div class="field"><span class="lbl">Залог</span><div class="seg3"><span>Вернуть всё</span><span>Удержать часть</span><span class="on bad">Удержать всё</span></div></div>'
 '<dl class="kv"><dt>Удержать</dt><dd class="money">180,00</dd><dt>Долг клиента</dt><dd class="money crit">100,00 ₾</dd></dl><div class="hr"></div>'
 '<a class="btn btn-primary" href="#" style="width:100%">Оформить возврат</a></div></div>'
 '</div></div>')
d = desk('<b>Ноутбук.</b> Возврат одним экраном: акт слева, расчёт и залог справа.', rail('rentals', 'owner'), dr)

notes = ('<h2>Что закрывает</h2><table><tr><th>ID</th><th>Как</th></tr>'
 '<tr><td>B5-01, M6</td><td>Возврат менеджера не блокируется, залог уходит владельцам задачей</td></tr>'
 '<tr><td>B5-02, M7</td><td>Удержание и возврат — от полученного; «вернуть всё» больше не выбрано по умолчанию</td></tr>'
 '<tr><td>B5-03, M11</td><td>«Выдать залог» — исходящий платёж с каналом</td></tr>'
 '<tr><td>B5-05, R7</td><td>Опоздание и ключ — из договора с пунктом</td></tr>'
 '<tr><td>B5-06, R8</td><td>Куда встал мопед; «в сервис» → черновик ремонта</td></tr>'
 '<tr><td>B5-07, R10</td><td>Акт возврата с решением по залогу</td></tr>'
 '<tr><td>B5-08</td><td>Остаток претензий — долг клиента, одна цифра</td></tr>'
 '<tr><td>R6</td><td>Пробег не меньше пробега выдачи</td></tr></table>'
 '<h2>Решения и умолчания</h2><ul><li><b>В1 (Mika)</b> — удержание решает один владелец, второго подтверждения нет (D18).</li>'
 '<li>Q17 — опоздание по 30 ₾/день считается, только если указан плановый возврат.</li>'
 '<li>Потеря ключа 250 ₾ по договору; в примере владелец удержал из неё 150 — сумма правится, причина в журнале.</li></ul>')

page('05-return.html', 'Возврат и залог',
 'Мастер из четырёх шагов: акт, расчёт и залог, куда встал мопед, итог. Менеджер оформляет, залог решает владелец — без тупиков.',
 [('Сценарий', 'С3 — возврат с удержанием'), ('Схема', 'blueprint §2.4 С3, D7, D8; принципы №7, №14'), ('Правила', 'договор п.3, п.6 (опоздание 30 ₾/день, ключ 250 ₾); <code>rental.md</code> «Возврат и залог»'), ('Данные', 'Пример')],
 [('Шаги', r1 + r2m + r2o + r3 + r4 + r5 + payout), ('Ноутбук', d)], notes)

# ================= MONEY =================
def mtabs(on):
    tabs = [('Разобрать', '3'), ('Платежи', ''), ('Касса', '1'), ('Выписки', ''), ('Залоги', '')]
    return '<div class="chips">' + ''.join(f'<span class="chip{" on" if t == on else ""}">{t}{(" <span class=n>" + n + "</span>") if n else ""}</span>' for t, n in tabs) + '</div>'

def match(amount, date, bank, text, reason, acts, tone=''):
    return (f'<div class="card" style="{tone}"><div style="display:flex;justify-content:space-between;align-items:baseline"><div class="q-sum" style="text-align:left" >{amount}</div><div class="small muted">{date} · {bank}</div></div>'
            f'<div class="small mono muted" style="margin:4px 0 10px;word-break:break-word">{text}</div>'
            f'<div class="banner ok" style="margin-bottom:10px">{ic("check","i s")}<div>{reason}</div></div>'
            f'<div style="display:flex;gap:8px">{acts}</div></div>')

m1 = phone('<b>Разобрать.</b> Строки выписки, которые правила не привязали. У подсказки — причина словами. «Похоже, уже записан» — сверка с внесённым руками (B2-03). Двойной тап — одна привязка (B2-02).',
  head('Деньги'),
  mtabs('Разобрать') +
  match('+325,05 ₾', '15.09', 'BOG', 'Wallet/domestic MC cards 330.00 GEL', '<b>Карта:</b> 325,05 = 330 − 1,5 %. Аренда R-00520 выдана 15.09 и ждёт 330 ₾. Имени в строке нет.',
        prim('Привязать к R-00520') + sec('Другое')) +
  match('+150,00 ₾', '14.09', 'TBC', 'PRIMER KLIENT B — for moped rent', '<b>Имя:</b> «PRIMER KLIENT B» похоже на «Клиент Пример Б». Долг по R-00488 — 300 ₾.',
        prim('Привязать к R-00488') + sec('Другое')) +
  match('+150,00 ₾', '13.09', 'BOG', 'Transfer 150.00 GEL', '<b>Похоже, уже записан:</b> наличные 150 ₾ от 13.09, Kardu, R-00497. Это он?',
        prim('Да, это он') + sec('Нет, другой')) +
  '<a class="q-more" href="#">Разобрано правилами за неделю: 5 · проверить</a>',
  tabbar('owner', 'money', 14))

m2 = phone('<b>Принять деньги — одна форма.</b> Направление, основание, запись, сумма с подсказками, канал. Карта показывает нетто. Для менеджера — только «Приход · наличные» (D5).',
  head('Деньги'), mtabs('Разобрать'), tabbar('owner', 'money', 14),
  overlay=('<div class="sheet-scrim"></div><div class="sheet" style="top:70px;overflow:auto"><div class="grab"></div><h4>Принять деньги</h4>'
   '<div class="field"><div class="seg3" style="grid-template-columns:1fr 1fr"><span class="on">' + ic('in','i s') + ' Приход</span><span>' + ic('out','i s') + ' Расход</span></div></div>'
   '<div class="field"><span class="lbl">Основание</span><div style="display:flex;flex-wrap:wrap;gap:6px"><span class="chip on">Аренда</span><span class="chip">Залог</span><span class="chip">Продажа</span><span class="chip">Ремонт</span></div></div>' +
   field('Клиент и запись', 'Клиент Пример В · R-00491<span class="ph" style="margin-left:auto">долг 150</span>') +
   '<div class="field"><span class="lbl">Сумма</span><div class="input"><b class="mono">150,00 ₾</b></div><div style="display:flex;gap:6px;margin-top:8px"><span class="chip on">150 · долг</span><span class="chip">300 · две недели</span></div><div class="hint">Оплачено будет по 25.09</div></div>'
   '<div class="field"><span class="lbl">Канал</span><div class="seg3"><span class="on">Наличные</span><span>Карта</span><span>Перевод</span></div></div>'
   '<a class="btn btn-primary btn-lg" href="#" style="width:100%">Записать 150 ₾</a></div>'))

m3 = phone('<b>Касса.</b> Наличные по людям за день (В3): принято, выдано, на руках. Менеджер нажал «Сдал» — у владельца «Принять»; не сошлось — сумма и причина.',
  head('Деньги'),
  mtabs('Касса') +
  '<div class="date">Сегодня, 17 сентября</div>' +
  '<div class="card"><div style="display:flex;justify-content:space-between"><div class="q-who">Менеджер Пример</div><span class="st st-waiting"><i class="mk"></i>сдал 17:40</span></div>'
  '<dl class="kv" style="margin-top:8px"><dt>Принято наличными · 5</dt><dd class="money">480,00</dd><dt>Выдано</dt><dd class="money">0,00</dd><dt><b>Сдаёт</b></dt><dd class="money"><b>480,00 ₾</b></dd></dl>'
  '<div style="display:flex;gap:8px;margin-top:12px"><a class="btn btn-primary" href="#" style="flex:1">Принять 480 ₾</a><a class="btn" href="#">Не сходится</a></div></div>' +
  '<div class="card"><div class="q-who">Kardu</div><dl class="kv" style="margin-top:8px"><dt>Принято наличными · 3</dt><dd class="money">540,00</dd><dt>Выдано · залог R-00497</dt><dd class="money">−180,00</dd><dt>Принято от менеджеров</dt><dd class="money">0,00</dd><dt><b>На руках</b></dt><dd class="money"><b>360,00 ₾</b></dd></dl></div>' +
  '<a class="q-more" href="#">Другой день или период</a>',
  tabbar('owner', 'money', 14))

def pay(sign, amount, who, meta, ch):
    cls = 'in' if sign == '+' else 'out'
    return f'<a class="lcard" href="#"><div><div class="a">{who}</div><div class="b">{meta}</div></div><div class="r"><div class="money {cls}" style="font-size:16px">{sign}{amount}</div><div class="b">{ch}</div></div></a>'
m4 = phone('<b>Платежи.</b> Карточки со знаком и направлением, основание словами. Фильтры в адресе, итог над списком (B6-03). «Аннулировать» — в меню записи, с причиной.',
  head('Деньги'),
  mtabs('Платежи') +
  '<div class="chips" style="margin-top:-4px"><span class="chip on">Эта неделя</span><span class="chip">Все каналы ▾</span><span class="chip">Приход и расход ▾</span><span class="chip">Основание ▾</span></div>' +
  '<div class="card"><dl class="kv"><dt>Приход</dt><dd class="money in">+1 980,00</dd><dt>Расход</dt><dd class="money">−180,00</dd><dt>Комиссия эквайринга</dt><dd class="money">−29,70</dd></dl></div>' +
  grp('Сегодня', '') +
  pay('+', '330,00', 'Клиент Пример Новый', 'аренда 150 + залог 180 · R-00520', 'карта · банк 325,05') +
  pay('−', '180,00', 'Клиент Пример А', 'выдача залога · R-00497', 'наличные') +
  pay('+', '150,00', 'Клиент Пример В', 'аренда · R-00491', 'наличные · Менеджер') +
  grp('Вчера', '') +
  pay('−', '2 000,00', 'Поставщик Пример', 'оплата заказа PO-00114 · 4 720 CNY', 'перевод BOG') +
  pay('+', '1 396,00', 'Клиент Пример К', 'взнос 3 из 9 · SL-00171', 'перевод TBC'),
  tabbar('owner', 'money', 14))

m5 = phone('<b>Разобрать — пусто.</b> Всё привязано. Свежесть выписок и что сделали правила — чтобы можно было проверить.',
  head('Деньги'),
  mtabs('Разобрать').replace('<span class=n>3</span>', '') +
  f'<div class="empty"><div class="big">{ic("check")}</div><h4>Всё разобрано</h4><p>BOG загружена сегодня в 09:12 · TBC — 2 дня назад</p><a class="btn" href="#">Загрузить выписку</a></div>' +
  '<a class="q-more" href="#">Разобрано правилами за неделю: 8 · проверить</a>',
  tabbar('owner', 'money', 11))

# desktop money
dm = ('<div class="d-head"><h2>Деньги</h2><span class="sub">3 строки ждут разбора</span><div class="acts"><a class="btn btn-sm" href="#">Загрузить выписку</a><a class="btn btn-sm btn-primary" href="#">Принять деньги</a></div></div>'
 '<div class="d-tabs"><a class="on" href="#">Разобрать <span class="n">3</span></a><a href="#">Платежи</a><a href="#">Касса <span class="n">1</span></a><a href="#">Выписки</a><a href="#">Залоги</a></div>'
 '<div class="d-body" style="padding-right:460px"><table class="table"><tr><th>Дата</th><th>Банк</th><th>Текст банка</th><th class="r">Сумма</th><th>Подсказка</th></tr>'
 '<tr class="sel"><td>15.09</td><td>BOG</td><td class="mono small">Wallet/domestic MC cards 330.00 GEL</td><td class="r money">+325,05</td><td>R-00520 · карта −1,5 %</td></tr>'
 '<tr><td>14.09</td><td>TBC</td><td class="mono small">PRIMER KLIENT B — for moped rent</td><td class="r money">+150,00</td><td>R-00488 · имя</td></tr>'
 '<tr><td>13.09</td><td>BOG</td><td class="mono small">Transfer 150.00 GEL</td><td class="r money">+150,00</td><td>уже записан?</td></tr></table>'
 '<p class="small muted" style="margin-top:12px">Выписка BOG загружена 6 дней назад · TBC — 2 дня назад · разобрано правилами за неделю: 5</p></div>')
panel = ('<div class="panel" style="top:130px"><div class="small muted">15.09 · BOG</div><div class="hero">+325,05 ₾</div><div class="mono small muted" style="margin:6px 0 14px">Wallet/domestic MC cards 330.00 GEL</div>'
 f'<div class="banner ok">{ic("check","i s")}<div><b>Карта:</b> 325,05 = 330 − 1,5 %. Аренда R-00520 выдана 15.09 и ждёт 330 ₾ (неделя 150 + залог 180). Имени в строке нет.</div></div>'
 '<dl class="kv" style="margin-bottom:14px"><dt>Долг клиента гасится</dt><dd class="money">330,00</dd><dt>Комиссия — расход</dt><dd class="money">4,95</dd></dl>'
 '<a class="btn btn-primary" href="#" style="width:100%;margin-bottom:8px">Привязать к R-00520</a>'
 '<div class="input" style="margin-bottom:8px">' + ic('search','i s') + '<span class="ph">Другая запись: имя, телефон, номер</span></div>'
 '<a class="btn btn-quiet" href="#" style="width:100%">Это не наше</a></div>')
dmd = desk('<b>Ноутбук.</b> Таблица строк и панель справа: подсказка с причиной, привязка одной клавишей, поиск другой записи.', rail('money', 'owner'), dm, panel)

notes = ('<h2>Что закрывает</h2><table><tr><th>ID</th><th>Как</th></tr>'
 '<tr><td>B6-04, Q19 (В4)</td><td>Один раздел «Деньги»: Разобрать · Платежи · Касса · Выписки · Залоги</td></tr>'
 '<tr><td>B2-02, M2</td><td>Одна привязка на строку при двойном тапе</td></tr>'
 '<tr><td>B2-03, M3</td><td>«Похоже, уже записан — это он?»</td></tr>'
 '<tr><td>B2-04, B2-05, M4, M5</td><td>Подсказка с причиной; привязка к аренде, продаже или клиенту; автопривязки видны и проверяемы</td></tr>'
 '<tr><td>B2-06, M9</td><td>«Wallet/domestic MC cards» читается картой, нетто показано</td></tr>'
 '<tr><td>B6-03, T5</td><td>Платежи карточками со знаком, фильтры, итог</td></tr>'
 '<tr><td>B5-03, M11, В3</td><td>Касса по людям, «сдал» / «принял», выдача залога — расход</td></tr>'
 '<tr><td>M12, B7-03</td><td>Одна форма денег для всех оснований, карта с комиссией и для продаж</td></tr></table>'
 '<h2>ИИ — после волны 2</h2><p>Та же карточка «Разобрать»: строка причины может прийти от модели, которая читает текст банка (транслитерация, «for moped»). Привязывает всегда человек; отправка текста с именами во внешнюю модель — решение Mika (Q27-b).</p>')

page('06-money.html', 'Деньги',
 'Один раздел про деньги: разобрать выписку, принять деньги одной формой, касса по людям, платежи со знаком. Строки выписок — выдуманные.',
 [('Сценарии', 'С2 — приём оплаты, С4 — разбор поступлений'), ('Схема', 'blueprint §2.1 D4, D5, D6; принципы №5, №15'), ('Правила', '<code>money.md</code>: эквайринг −1,5 %, комиссия — расход; залог — обязательство; ADR-0004 EV8 Ops'), ('Данные', 'Пример')],
 [('Телефон', m1 + m2 + m3 + m4 + m5), ('Ноутбук', dmd)], notes)
print('ok return money')
