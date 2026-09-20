from proto_base import *
from p_today import q, grp, prim, sec, CALL, WA
from p_wizards import steps, wbar, wphone, field
from p_wave1 import stabs, lc, money, fld, sheet_form
from p_wave3 import seg
import proto_base
proto_base.WAVE1 = False

def dl(rows):
    return '<dl class="kv">' + ''.join(f'<dt>{a}</dt><dd{(" class=" + chr(34) + c + chr(34)) if c else ""}>{b}</dd>' for a, b, c in rows) + '</dl>'
def card(h, body): return f'<div class="card">{"<div class=h3>" + h + "</div>" if h else ""}{body}</div>'

# ================= SALES =================
N = 5
s1 = wphone('<b>1. Мопед.</b> Свободные парка продажи (и «не решён»), модель, цвет, точка, цена модели. Мопед в аренде и проданный — не показываются; отказ по ссылке — словами про продажу, не «нельзя выдать» (QA-1-07).',
  'Продажа', steps(1, N, 'Мопед') + field('Последние знаки VIN', ic('search','i s') + '90', cls='focus') +
  lc('S70 Pro Max · красный', vin('9051'), money('5 200 ₾') + '<div class="b">Шоурум</div>') +
  lc('MKK Plus · белый', vin('9077'), money('— ₾') + '<div class="b crit">у модели нет цены</div>'),
  wbar('Далее', back=False))
s2 = wphone('<b>2. Покупатель.</b> Поиск только среди клиентов (B3-06), «Новый клиент» в шаге — как в выдаче; должник — предупреждение.',
  'Продажа', steps(2, N, 'Покупатель') + field('Имя или телефон', ic('search','i s') + 'пример к', cls='focus') +
  lc('Клиент Пример К', '+995 5·· ·· 40 12 · аренд нет', '<div class="b">нет долга</div>') +
  '<a class="btn" href="#" style="width:100%">' + ic('user','i s') + 'Новый клиент</a>',
  wbar('Далее'))
sched = ('<table class="table" style="margin-top:8px"><tr><th>№</th><th>Дата</th><th class="r">Сумма</th></tr>'
  '<tr><td>Предоплата</td><td>сегодня</td><td class="r money">1 000,00</td></tr>'
  '<tr><td>1</td><td>18.10</td><td class="r money">1 400,00</td></tr><tr><td>2</td><td>18.11</td><td class="r money">1 400,00</td></tr><tr><td>3</td><td>18.12</td><td class="r money">1 400,00</td></tr></table>')
s3 = wphone('<b>3. Цена и рассрочка.</b> Цена — из модели, правится (SAL-01). Комплектация — строками («вторая батарея»). Рассрочка: предоплата и число месяцев → <b>график виден сразу</b> и правится построчно (B7-03, SAL-02). Гарантия 12 месяцев — сама (<code>sales.md</code>).',
  'Продажа', steps(3, N, 'Цена') +
  card('', dl([('Мопед', 'S70 Pro Max ···9051', ''), ('Цена модели', '5 200,00 ₾ ›', 'money'), ('Гарантия до', '18.09.2027', '')])) +
  field('Комплектация', '<span class="ph">например, вторая батарея — сумма</span>') +
  '<div class="field"><span class="lbl">Оплата</span>' + seg(['Сразу вся', 'Рассрочка'], 'Рассрочка') + '</div>' +
  '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' + field('Предоплата', '1 000,00 ₾') + field('Месяцев', '3') + '</div>' + card('График', sched),
  wbar('Далее'))
s4 = wphone('<b>4. Предоплата.</b> Форма денег волны 2 в шаге: канал, карта с комиссией. «Позже» — нет: продажа без предоплаты — только с причиной у владельца.',
  'Продажа', steps(4, N, 'Предоплата') +
  '<div class="card"><div class="small muted">Предоплата сегодня</div><div class="hero">1 000,00 ₾</div></div>' +
  '<div class="field"><span class="lbl">Как платит</span>' + seg(['Наличные', 'Карта', 'Перевод'], 'Карта') + '</div>' +
  f'<div class="banner info">{ic("money","i s")}<div>Банк зачислит <b class="mono">985,00 ₾</b>; комиссия 15,00 — расход компании.</div></div>',
  wbar('К итогу'))
s5 = phone('<b>Готово.</b> Мопед «продан», выбыл из парков. Договор или счёт продажи PDF (ka / en) и подпись на экране (D17). «Открыть продажу» — главной (после создания — в запись, B4-07).',
  head('Продажа', left='close', right=''),
  f'<div class="empty" style="padding:20px 12px 12px"><div class="big">{ic("check")}</div><h4>Продано · SL-00172</h4><p>S70 Pro Max ···9051 · Клиент Пример К<br>Предоплата 1 000 · 3 взноса по 1 400 · гарантия до 18.09.2027</p></div>' +
  '<div class="card"><a class="lcard" href="#" style="margin:0;padding:10px 0"><div><div class="a">' + ic('file','i s') + ' Договор продажи</div><div class="b">ka / en · PDF · с графиком</div></div><div class="r"><span class="st st-waiting"><i class="mk"></i>не подписан</span></div></a><a class="btn btn-primary" href="#" style="width:100%;margin-top:10px">Подписать на экране</a></div>',
  '', '<div class="action-bar bottom"><a class="btn btn-primary btn-lg" href="#">Открыть продажу</a></div>', body_cls='bar-only')
s6 = wphone('<b>Перенос действующей продажи — владелец</b> (B3-03). Дата продажи в прошлом, график как в договоре — даты и суммы правятся построчно; «оплачено до переноса» гасит взносы от старого к новому. Графиков из Odoo нет — одна строка на дату продажи, если договора под рукой нет (умолчание Q4).',
  'Продажа', steps(3, N, 'Цена') +
  '<div class="card" style="display:flex;justify-content:space-between;align-items:center"><div class="q-who">Перенос действующей продажи</div><span class="chip on">вкл</span></div>' +
  field('Дата продажи', '15.06.2026') +
  card('График как в договоре', '<table class="table"><tr><th>Дата</th><th class="r">Сумма</th><th>Оплачено</th></tr><tr><td>15.06</td><td class="r money">1 000,00</td><td class="ok">до переноса</td></tr><tr><td>15.07</td><td class="r money">1 396,00</td><td class="ok">до переноса</td></tr><tr><td>15.08</td><td class="r money">1 396,00</td><td class="crit">нет</td></tr><tr><td>15.09</td><td class="r money">1 396,00</td><td class="crit">нет</td></tr></table>') +
  field('Оплачено до переноса, GEL', '2 396,00'),
  wbar('Далее'))

sc = phone('<b>Карточка продажи.</b> Сверху — долг (просроченные взносы) и остаток по графику отдельно; график с отметками; гарантия; документы; лента. Главное — «Принять взнос» (форма денег, карта с комиссией); «⋯» — выкупить обратно, отменить продажу (без денег, с причиной).',
  head('SL-00169', left='back', right='dots'),
  '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><div><div class="q-who">Клиент Пример О</div><div class="q-why">MKK Plus ···1203 · продана 15.06</div></div>' + st('overdue', 'взнос 34 дн.') + '</div>' +
  '<div class="card"><div style="display:flex;justify-content:space-between"><div><div class="small muted">Долг</div><div class="hero crit">2 792 ₾</div></div><div style="text-align:right"><div class="small muted">Впереди</div><div class="hero">0 ₾</div></div></div></div>' +
  card('График', '<table class="table"><tr><th>Дата</th><th class="r">Сумма</th><th>Статус</th></tr><tr><td>15.06</td><td class="r money">1 000,00</td><td class="ok">оплачен</td></tr><tr><td>15.07</td><td class="r money">1 396,00</td><td class="ok">оплачен</td></tr><tr><td>15.08</td><td class="r money">1 396,00</td><td class="crit">просрочен 34 дн.</td></tr><tr><td>15.09</td><td class="r money">1 396,00</td><td class="crit">просрочен 3 дн.</td></tr></table>') +
  card('', dl([('Цена', '5 188,00 ₾', 'money'), ('Гарантия до', '15.06.2027', ''), ('Договор', 'подписан 15.06 ›', '')])),
  tabbar('owner', '', 14), f'<div class="action-bar">{CALL}{WA}<a class="btn btn-primary btn-lg" href="#">Принять взнос</a></div>', body_cls='with-bar')
bb = phone('<b>Выкупить обратно.</b> Панель показывает оплачено, остаток графика, сумму выкупа и итог к выплате; канал обязателен. Остаток графика списывается, выкуп — отдельный расход (умолчание Q20); долг клиента по продаже — 0 (B7-01, M8). Мопед — в парк «свободен» или «в сервис», с точкой.',
  head('SL-00169', left='back', right='dots'), '', tabbar('owner', '', 14),
  overlay=sheet_form('Выкупить обратно · SL-00169', card('', dl([('Оплачено по продаже', '2 396,00', 'money'), ('Остаток графика — спишется', '2 792,00', 'money muted')])) +
  field('Сумма выкупа', '<b class="mono">1 500,00 ₾</b>') + '<div class="field"><span class="lbl">Как платим</span>' + seg(['Наличные', 'Перевод'], 'Перевод') + '</div>' +
  '<div class="field"><span class="lbl">Мопед после выкупа</span>' + seg(['Свободен', 'В сервис'], 'В сервис') + '</div>',
  '<a class="btn btn-primary btn-lg" href="#" style="width:100%">Выкупить за 1 500 ₾</a>'))

dsale = ('<div class="d-head"><h2>SL-00169</h2><span class="sub">Клиент Пример О · MKK Plus ···1203</span>' + st('overdue', 'взнос 34 дн.') + '<div class="acts"><a class="btn btn-sm" href="#">⋯</a><a class="btn btn-sm btn-primary" href="#">Принять взнос</a></div></div>'
 '<div class="d-body"><div class="cols" style="grid-template-columns:1.3fr 1fr"><div><div class="card" style="padding:20px"><div style="display:flex;gap:48px"><div><div class="small muted">Цена</div><div class="hero">5 188 ₾</div></div><div><div class="small muted">Оплачено</div><div class="hero">2 396 ₾</div></div><div><div class="small muted">Долг</div><div class="hero crit">2 792 ₾</div></div></div></div>'
 '<table class="table"><tr><th>№</th><th>Дата</th><th class="r">Сумма</th><th class="r">Оплачено</th><th>Статус</th></tr><tr><td>—</td><td>15.06</td><td class="r money">1 000,00</td><td class="r money">1 000,00</td><td class="ok">оплачен</td></tr><tr><td>1</td><td>15.07</td><td class="r money">1 396,00</td><td class="r money">1 396,00</td><td class="ok">оплачен</td></tr><tr><td>2</td><td>15.08</td><td class="r money">1 396,00</td><td class="r money">0,00</td><td class="crit">просрочен</td></tr><tr><td>3</td><td>15.09</td><td class="r money">1 396,00</td><td class="r money">0,00</td><td class="crit">просрочен</td></tr></table></div>'
 '<div>' + card('', dl([('Гарантия до', '15.06.2027', ''), ('Договор', 'подписан 15.06', ''), ('Мопед', 'MKK Plus ···1203', '')])) + '<div class="card"><div class="h3">Лента</div><ul class="tl"><li><div><b>Взнос 1 396 ₾</b> · перевод<div class="when">15.07</div></div></li><li><div><b>Продано</b><div class="when">15.06 · Kardu</div></div></li></ul></div></div></div></div>')
dS = desk('<b>Продажа на ноутбуке.</b> Цифры, график таблицей, гарантия и лента.', rail('sales', 'owner', 14), dsale)

page('wave-5-sales.html', 'Волна 5 · Продажа и рассрочка',
 'Мастер продажи: мопед, покупатель, цена и график сразу, предоплата, «Готово» с договором и подписью. Карточка продажи с графиком; выкуп обратно закрывает рассрочку; перенос действующей продажи.',
 [('Волна', '5 · <code>docs/redesign/wave-5.md</code> §3.1–3.3'), ('Сценарий', 'С5, С9'), ('Правила', '<code>sales.md</code>, <code>pricing.md</code> «Продажа»'), ('Закрывает', 'B7-01, B7-03, B3-03, S6, M8, QA-1-07'), ('Данные', 'Пример; цены — пример, действующие цены живут в «Моделях»')],
 [('Мастер', s1 + s2 + s3 + s4 + s5 + s6), ('Карточка и выкуп', sc + bb), ('Ноутбук', dS)])

# ================= PURCHASES =================
po_new = phone('<b>Новый заказ.</b> Поставщик — поиск среди поставщиков или «+ Новый поставщик» в том же поле (название, страна, контакт) — B3-04, S1. Инвойс: номер, дата, валюта. Строки: модель или запчасть из каталога, новая модель — из строки (ADR-0011). Строка без каталога — «не попадёт на склад — выберите запчасть».',
  head('Новый заказ', left='close', right=''),
  field('Поставщик', ic('search','i s') + 'primer co', cls='focus') +
  '<div class="card" style="border:1px solid var(--accent)"><div class="h3">+ Новый поставщик</div>' + field('Название', 'Zhejiang Primer Co.') + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' + field('Страна', 'Китай') + field('Контакт', 'Alibaba · Primer') + '</div></div>' +
  '<div style="display:grid;grid-template-columns:1fr 1fr 80px;gap:8px">' + field('Инвойс №', 'DEMO-16') + field('Дата', '18.09.2026') + field('Валюта', 'CNY') + '</div>' +
  card('Строки', '<table class="table"><tr><th>Что</th><th class="r">Кол.</th><th class="r">Цена</th></tr><tr><td>S70 Pro Max</td><td class="r">2</td><td class="r money">2 600</td></tr><tr><td>Датчик Холла</td><td class="r">20</td><td class="r money">40</td></tr><tr><td class="crit">«зеркала» — не из каталога</td><td class="r">4</td><td class="r money">15</td></tr></table><div class="small crit" style="margin-top:6px">«зеркала» не попадут на склад — выберите запчасть или создайте</div>'),
  '', '<div class="action-bar bottom"><a class="btn btn-primary btn-lg" href="#">Создать заказ · 6 060 CNY</a></div>', body_cls='bar-only')
po = phone('<b>Карточка заказа.</b> Инвойс в валюте; оплачено в GEL и в валюте, процент и фактический курс; долг поставщику в валюте (B3-04, B8-01). Логистика правится (B8-03). Себестоимость единицы — «предварительно, оплачено 17 %» до полной оплаты (B8-02). «Оплатить поставщику» доступно, пока есть долг — и после приёмки.',
  head('PO-00116', left='back', right='dots'),
  '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><div><div class="q-who">Zhejiang Primer Co.</div><div class="q-why">инвойс DEMO-16 · 18.09</div></div>' + st('waiting', 'ждёт оплаты') + '</div>' +
  '<div class="card"><div style="display:flex;justify-content:space-between"><div><div class="small muted">Инвойс</div><div class="hero">6 000 CNY</div></div><div style="text-align:right"><div class="small muted">Долг поставщику</div><div class="hero crit">5 000 CNY</div></div></div>' +
  dl([('Оплачено', '423,57 GEL = 1 000 CNY · 17 %', ''), ('Курс по оплатам', '0,42357 GEL/CNY', ''), ('Логистика и растаможка', '500,00 GEL ›', '')]) + '</div>' +
  card('Строки и себестоимость', '<table class="table"><tr><th>Что</th><th class="r">Кол.</th><th class="r">За единицу</th></tr><tr><td>S70 Pro Max</td><td class="r">2</td><td class="r money">≈ 1 351,28</td></tr><tr><td>Датчик Холла</td><td class="r">20</td><td class="r money">≈ 16,94</td></tr></table><div class="small muted" style="margin-top:6px">Предварительно: оплачено 17 %. Логистика — только на мопеды (умолчание Q24).</div>'),
  '', '<div class="action-bar bottom"><a class="btn btn-lg" href="#">Принять партию</a><a class="btn btn-primary btn-lg" href="#">Оплатить поставщику</a></div>', body_cls='bar-only')
recv = phone('<b>Принять партию — вставкой списка VIN.</b> Из CMR — один VIN на строку; проверка: 17 знаков без I, O, Q (в прототипе VIN начинаются с DEMO — это пометка примера); VIN, который уже есть в парке, останавливает приход (<code>purchasing.md</code>, B3-06). Цвет (из шести), год, парк и точка — одним значением на всех, с правкой по строке (B8-02). Запчасти каталога — на склад (B8-03).',
  head('Принять · PO-00116', left='close', right=''),
  field('VIN из CMR — по одному в строке', '<span class="mono small">DEMO000000000A101<br>DEMO000000000A12</span>', err='Строка 2: 16 знаков — в VIN их 17. Проверьте по CMR', cls='err') +
  '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' + field('Цвет всем', 'красный ▾') + field('Год всем', '2026') + field('Парк', 'аренда ▾') + field('Точка', 'Шоурум ▾') + '</div>' +
  card('Итог приёмки', dl([('Мопедов', '2 из 2', ''), ('Датчик Холла на склад', '20', ''), ('Себестоимость', 'предварительно, оплачено 17 % — пересчитается доплатой', 'crit')])),
  '', '<div class="action-bar bottom"><a class="btn btn-primary btn-lg" href="#">Принять 2 мопеда</a></div>', body_cls='bar-only')
recalc = phone('<b>Доплата после приёмки.</b> Приёмка раньше полной оплаты — решение Mika по Q23 (18.09.2026): каждая оплата и правка логистики пересчитывают себестоимость VIN и модели событием в журнале; до 100 % — «предварительно».',
  head('PO-00116', left='back', right='dots'),
  f'<div class="banner ok">{ic("check","i s")}<div><b>Оплачено 100 %.</b> Себестоимость пересчитана: S70 Pro Max ···A101, ···A102 — 1 351,28 → 1 350,06 ₾ (фактический курс 0,42310). В журнале — «пересчёт по оплате 25.09».</div></div>' +
  card('', dl([('Инвойс', '6 000 CNY', ''), ('Оплачено', '2 538,60 GEL · 100 %', ''), ('Курс по оплатам', '0,42310', ''), ('Долг поставщику', '0', '')])),
  '', body_cls='no-tabs')
supp = phone('<b>Поставщик.</b> Тип записи «поставщик» (B3-06): в выдаче и продаже его нет. Заказы и общий долг в валюте; «Новый заказ».',
  head('Zhejiang Primer Co.', left='back', right='dots'),
  '<div class="card"><div class="small muted">Долг поставщику</div><div class="hero crit">5 000 CNY</div><div class="small muted">по 1 заказу</div></div>' +
  card('', dl([('Страна', 'Китай', ''), ('Контакт', 'Alibaba · Primer', '')])) + grp('Заказы', '2') +
  lc('PO-00116', 'инвойс DEMO-16 · 18.09', money('6 000 CNY') + '<div class="b">оплачено 17 %</div>') + lc('PO-00109', 'инвойс DEMO-09 · 02.07', money('3 200 CNY') + '<div class="b">оплачено 100 %</div>'),
  '', '<div class="action-bar bottom"><a class="btn btn-primary btn-lg" href="#">Новый заказ</a></div>', body_cls='bar-only')
tr = phone('<b>Перенос: оплачено до переноса.</b> В заказе — сумма в GEL и в валюте инвойса и дата; долг поставщику = инвойс − оплаченное в валюте (B3-04).',
  head('PO-00101', left='back', right='dots'), '', '',
  overlay=sheet_form('Оплачено до переноса', fld('Ушло со счёта, GEL', '<b class="mono">420,00</b>') + fld('Это в валюте инвойса', '<b class="mono">1 000,00 CNY</b>', hint='Курс 0,42') + fld('Дата', '12.05.2026'), '<a class="btn btn-primary btn-lg" href="#" style="width:100%">Записать</a>'), body_cls='no-tabs')

dpo = ('<div class="d-head"><h2>PO-00116</h2><span class="sub">Zhejiang Primer Co. · инвойс DEMO-16</span>' + st('waiting', 'ждёт оплаты') + '<div class="acts"><a class="btn btn-sm" href="#">Принять партию</a><a class="btn btn-sm btn-primary" href="#">Оплатить поставщику</a></div></div>'
 '<div class="d-body"><div class="cols" style="grid-template-columns:1.3fr 1fr"><div><table class="table"><tr><th>Что</th><th class="r">Кол.</th><th class="r">Цена, CNY</th><th class="r">Сумма, CNY</th><th class="r">Себестоимость ед., GEL</th></tr>'
 '<tr><td>S70 Pro Max</td><td class="r">2</td><td class="r money">2 600</td><td class="r money">5 200</td><td class="r money">≈ 1 351,28</td></tr><tr><td>Датчик Холла</td><td class="r">20</td><td class="r money">40</td><td class="r money">800</td><td class="r money">≈ 16,94</td></tr></table></div>'
 '<div>' + card('Деньги', dl([('Инвойс', '6 000 CNY', ''), ('Оплачено', '423,57 GEL · 1 000 CNY · 17 %', ''), ('Курс', '0,42357', ''), ('Логистика', '500,00 GEL ›', ''), ('Долг поставщику', '5 000 CNY', 'crit')])) + '<div class="card"><div class="h3">Лента</div><ul class="tl"><li><div><b>Оплата 423,57 GEL</b> · 1 000 CNY<div class="when">18.09 · Mika</div></div></li><li><div><b>Заказ создан</b><div class="when">18.09 · Mika</div></div></li></ul></div></div></div></div>')
dP = desk('<b>Закупка на ноутбуке</b> — Mika ведёт закупки: строки таблицей, деньги и лента справа.', rail('purchases', 'owner', 14), dpo)

page('wave-5-purchases.html', 'Волна 5 · Закупка и приёмка',
 'Поставщик заводится в заказе; оплаты в GEL и валюте с курсом и долгом; логистика правится; приёмка вставкой списка VIN; себестоимость — предварительная до полной оплаты и пересчитывается доплатой.',
 [('Волна', '5 · <code>docs/redesign/wave-5.md</code> §3.4–3.6'), ('Сценарий', 'С7'), ('Правила', '<code>purchasing.md</code>: курс = ушедшие GEL / инвойс, логистика поровну на единицы, приёмка по CMR'), ('Закрывает', 'B3-04, B3-06, B8-01…B8-03, S1–S5'), ('Данные', 'Пример; поставщик и инвойс выдуманы')],
 [('Телефон', po_new + po + recv + recalc + supp + tr), ('Ноутбук', dP)])

# ================= SERVICE + STOCK =================
brk = phone('<b>Сообщить о поломке — менеджер.</b> Из «＋» или карточки мопеда: мопед (4 знака), что случилось, фото. Ремонт открывается черновиком у владельцев, мопед — «в сервисе», если стоит в шоуруме; у арендатора — остаётся у него (<code>service.md</code>).',
  head('Сегодня', initial='М'), '', tabbar('manager', 'today', 6),
  overlay=sheet_form('Сообщить о поломке', fld('Мопед', ic('search','i s') + 'B11 ···3390') + fld('Что случилось', 'Не заводится, горит ошибка') + '<div class="photos" style="margin-bottom:12px"><div class="photo">✓</div><div class="photo add">' + ic('camera') + '</div></div>', '<a class="btn btn-primary btn-lg" href="#" style="width:100%">Сообщить</a>'))
job = phone('<b>Ремонт — владелец.</b> Мастерская из списка (Avtos workshop, курьер-мастер — список ведёт владелец). Строки: запчасти со склада — за счёт компании по себестоимости, за счёт клиента по розничной (B8-04); работа — часы × 50 ₾ (<code>service.md</code>; нормы времени появятся, когда будут в книге — register #33). Итог и «за чей счёт».',
  head('SV-00034', left='back', right='dots'),
  '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><div><div class="q-who">F-150 ···7705</div><div class="q-why">Не заводится после дождя · открыт 09.09</div></div>' + st('service', '9 дней') + '</div>' +
  card('', dl([('Мастерская', 'Avtos workshop ›', ''), ('За чей счёт', 'компании ›', '')])) +
  card('Строки', '<table class="table"><tr><th>Что</th><th class="r">Кол.</th><th class="r">Сумма</th></tr><tr><td>Датчик Холла · себестоимость</td><td class="r">1</td><td class="r money">8,00</td></tr><tr><td>Работа · 1,5 ч × 50 ₾</td><td class="r">1,5</td><td class="r money">75,00</td></tr><tr><td><b>Итог</b></td><td></td><td class="r money"><b>83,00</b></td></tr></table><div style="display:flex;gap:8px;margin-top:10px"><a class="btn btn-sm" href="#">+ Запчасть</a><a class="btn btn-sm" href="#">+ Работа</a></div>') +
  '<div class="photos"><div class="photo">фото</div><div class="photo">фото</div></div>',
  tabbar('owner', '', 14), '<div class="action-bar"><a class="btn btn-primary btn-lg" href="#">Закрыть ремонт</a></div>', body_cls='with-bar')
cl = phone('<b>Закрыть ремонт.</b> Дата, пробег, где встал мопед (B8-04, B5-06). За счёт клиента без удержания — долг клиента строкой «Ремонт SV-…» (умолчание Q26); удержать из залога — не больше стоимости ремонта и остатка залога (<code>service.md</code>).',
  head('SV-00035', left='back', right='dots'), '', tabbar('owner', '', 14),
  overlay=sheet_form('Закрыть · SV-00035', card('', dl([('За счёт', 'клиента · Клиент Пример Д', ''), ('Итог ремонта', '70,00 ₾', 'money'), ('Залог на руках', '0,00', 'money')])) +
  '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' + fld('Дата', 'сегодня') + fld('Пробег', '1 312') + '</div>' + '<div class="field"><span class="lbl">Где встал</span>' + seg(['Шоурум', 'Мастерская'], 'Шоурум') + '</div>' +
  f'<div class="banner info">{ic("money","i s")}<div>Залога нет — <b>70 ₾ станут долгом клиента</b> «Ремонт SV-00035».</div></div>', '<a class="btn btn-primary btn-lg" href="#" style="width:100%">Закрыть ремонт</a>'))
cancel = phone('<b>Отменить ремонт</b> — с причиной; запчасти возвращаются на склад движением (B8-04).',
  head('SV-00036', left='back', right='dots'), '', tabbar('owner', '', 14),
  overlay=sheet_form('Отменить ремонт SV-00036?', fld('Причина', 'Открыли по ошибке — поломки нет') + '<div class="hint">2 запчасти вернутся на склад: Тормозные колодки × 2.</div>', '<a class="btn btn-primary btn-lg" href="#" style="width:100%">Отменить ремонт</a>'))
stk = phone('<b>Склад.</b> Таблица «Мопеды по моделям» убрана — она в «Парк → Модели» (отклонение 3 волны 1). Ниже минимума — сверху; «Добавить в заказ» — черновик заказа поставщику со строкой (B8-05).',
  head('Сервис', sub='64 позиции'), stabs(['Ремонты', 'Склад'], 'Склад') +
  '<div class="chips"><span class="chip on">Ниже минимума 5</span><span class="chip">Все 64</span><span class="chip">В минусе 1</span></div>' +
  lc('Контроллер 60V', 'DEMO-CTRL-60 · держать ≥ 2', money('−1 шт', 'crit') + '<div style="margin-top:6px"><a class="btn btn-sm" href="#">В заказ</a></div>') +
  lc('Тормозные колодки', 'DEMO-BRK-01 · держать ≥ 10', money('4 шт') + '<div style="margin-top:6px"><a class="btn btn-sm" href="#">В заказ</a></div>'),
  tabbar('owner', '', 14))
part = phone('<b>Карточка запчасти.</b> Остаток, средняя себестоимость, стоимость (владельцам); «Начальный остаток» — один раз, пока нет движений: количество, себестоимость, дата (B3-05). Позже — «Приход без закупки» с себестоимостью и причиной. Инвентаризация — владелец, с причиной.',
  head('Датчик Холла', left='back', right='dots'),
  '<div class="card"><div style="display:flex;justify-content:space-between"><div><div class="small muted">Остаток</div><div class="hero">0 шт</div></div><div style="text-align:right"><div class="small muted">Держать не меньше</div><div class="hero">5</div></div></div></div>' +
  f'<div class="banner info">{ic("box","i s")}<div>Движений ещё нет — можно завести <b>начальный остаток</b> с себестоимостью.</div></div>',
  tabbar('owner', '', 14),
  overlay=sheet_form('Начальный остаток', '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' + fld('Количество', '10') + fld('Себестоимость штуки, ₾', '8,00') + '</div>' + fld('На дату', '15.09.2026') + '<div class="hint">Стоимость склада станет 80,00 ₾. Доступно один раз.</div>', '<a class="btn btn-primary btn-lg" href="#" style="width:100%">Записать остаток</a>'))
td = phone('<b>«Сегодня» владельца — новое в волне 5.</b> В группе «Сервис»: поломка от менеджера → «Открыть ремонт»; запчасти ниже минимума → «В заказ» (черновик поставщику).',
  head('Сегодня'), '<div class="date">Пятница, 18 сентября</div>' + grp('Сервис', '3') +
  q('Поломка от менеджера', 'B11 ···3390 · «не заводится, горит ошибка» · 2 фото', '', prim('Открыть ремонт')) +
  q('10 мопедов в ремонте', '9 дольше 7 дней · самый долгий 31 день', '', sec('Открыть ремонты'), 'warn') +
  q('5 запчастей ниже минимума', 'Контроллер 60V: −1 · Тормозные колодки: 4 из 10', '', sec('В заказ')),
  tabbar('owner', 'today', 14))

dj = ('<div class="d-head"><h2>Сервис</h2><span class="sub">10 открыто</span><div class="acts"><a class="btn btn-sm btn-primary" href="#">+ Открыть ремонт</a></div></div><div class="d-tabs"><a class="on" href="#">Ремонты <span class="n">10</span></a><a href="#">Склад</a></div>'
 '<div class="d-body"><table class="table"><tr><th>№</th><th>Мопед</th><th>Что</th><th>Мастерская</th><th>За чей счёт</th><th class="r">Итог</th><th class="r">Дней ↓</th></tr>'
 '<tr><td>SV-00033</td><td>XL1200 ···1180</td><td>сгорел мотор</td><td class="crit">не указана</td><td>компании</td><td class="r money">0,00</td><td class="r">31</td></tr>'
 '<tr><td>SV-00034</td><td>F-150 ···7705</td><td>не заводится после дождя</td><td>Avtos workshop</td><td>компании</td><td class="r money">83,00</td><td class="r">9</td></tr>'
 '<tr><td>SV-00035</td><td>Eagle ···3318</td><td>треснул щиток</td><td>Avtos workshop</td><td>клиента</td><td class="r money">70,00</td><td class="r">0</td></tr></table></div>')
dJ = desk('<b>Ремонты на ноутбуке.</b> Таблица: мастерская, за чей счёт, итог, дней открыт.', rail('service', 'owner', 14), dj)

page('wave-5-service-stock.html', 'Волна 5 · Сервис и склад',
 '«Сообщить о поломке» у менеджера, ремонт с мастерской и работой по часам, закрытие с долгом клиента, отмена с возвратом запчастей, склад с нехваткой и начальным остатком.',
 [('Волна', '5 · <code>docs/redesign/wave-5.md</code> §3.7–3.9'), ('Сценарий', 'С6'), ('Правила', '<code>service.md</code>: мастерские, 50 ₾/час, кто платит, склад — скользящее среднее, нехватка не запрещает ремонт'), ('Закрывает', 'B8-04, B8-05, B3-05, M15, S8, S9'), ('Данные', 'Пример; цены запчастей — пример')],
 [('Телефон', brk + job + cl + cancel + stk + part + td), ('Ноутбук', dJ)])
print('ok wave5')
