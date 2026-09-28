from proto_base import *
from p_today import grp
from p_wave1 import stabs, lc, tb, fld, sheet_form, avatar
from p_wave4 import nums
import proto_base
proto_base.WAVE1 = False

# Поставщики (Mika, 28.09.2026): «нормальный экран и путь туда». Three ways
# in, two shapes of the card. Example data only — no real factory, person,
# phone or bank account appears here.

def dl(rows):
    return '<dl class="kv">' + ''.join(f'<dt>{a}</dt><dd{(" class=" + chr(34) + c + chr(34)) if c else ""}>{b}</dd>' for a, b, c in rows) + '</dl>'
def card(h, body): return f'<div class="card">{"<div class=h3>" + h + "</div>" if h else ""}{body}</div>'
def money(v): return f'<div class="money">{v}</div>'
PRE = 'style="white-space:pre-line"'

SUPPLIERS = [
    ('Zhejiang Primer Co.', 'Китай', 'мопеды · 2 заказа', '5 000 CNY', 'crit'),
    ('Primer Chargers Co.', 'Китай', 'зарядные · 3 заказа', '', ''),
    ('Primer Mirrors Ltd', 'Китай', 'зеркала · 1 заказ', '', ''),
    ('Поставщик Пример', 'Грузия', 'нет заказов', '', ''),
]
def srows():
    out = ''
    for n, c, b, d, tone in SUPPLIERS:
        r = money(d) + '<div class="b crit">долг</div>' if d else '<div class="b muted">долга нет</div>'
        out += lc(n, f'{c} · {b}', r)
    return out
def stable():
    rows = ''.join(
        f'<tr><td>{n}</td><td>{c}</td><td class="r">{b.split(" · ")[1].split()[0] if "заказ" in b and "нет" not in b else "0"}</td>'
        f'<td class="r money {tone}">{d or "—"}</td><td>{"18.09" if d else "—"}</td></tr>'
        for n, c, b, d, tone in SUPPLIERS)
    return ('<div class="toolbar"><div class="input">' + ic('search', 'i s') + '<span class="ph">Название, страна, контакт</span></div>'
            '<span class="chip on">Все 4</span><span class="chip">С долгом 1</span></div>'
            '<table class="table"><tr><th>Поставщик ↑</th><th>Страна</th><th class="r">Заказов</th><th class="r">Долг</th><th>Последний заказ</th></tr>' + rows + '</table>')
LIST_TB = tb('Название, страна, контакт', ['Все 4', 'С долгом 1'])

def dmain(title, sub, tabs, on, body, acts):
    t = ('<div class="d-tabs">' + ''.join(f'<a class="{"on" if x == on else ""}" href="#">{x}</a>' for x in tabs) + '</div>') if tabs else ''
    return f'<div class="d-head"><h2>{title}</h2><span class="sub">{sub}</span><div class="acts">{acts}</div></div>{t}<div class="d-body">{body}</div>'

def rail_with(items, on):
    keep = proto_base.RAIL_ITEMS
    proto_base.RAIL_ITEMS = items
    try:
        return rail(on, 'owner', 14)
    finally:
        proto_base.RAIL_ITEMS = keep

# ================= ПУТЬ =================
# A — вкладка в «Закупках», как «Парк → Мопеды · Модели».
a_ph = phone('<b>А. Вкладка в «Закупках» — рекомендую.</b> «Закупки → Заказы · Поставщики», как «Парк → Мопеды · Модели» и «Сервис → Ремонты · Склад». Адрес <code>/purchases/suppliers</code>. Поставщик нужен, когда заказываешь и платишь, — он рядом с заказами. Ничего нового в меню.',
  head('Закупки', sub='4 поставщика'), stabs(['Заказы', 'Поставщики'], 'Поставщики') + LIST_TB + srows(),
  tabbar('owner', '', 14))
a_d = desk('<b>А на ноутбуке.</b> Вкладки строкой под заголовком. «+ Новый поставщик» — на вкладке поставщиков, «Новый заказ» — на вкладке заказов.',
  rail('purchases', 'owner', 14),
  dmain('Закупки', '4 поставщика', ['Заказы', 'Поставщики'], 'Поставщики', stable(), '<a class="btn btn-sm btn-primary" href="#">+ Новый поставщик</a>'))

# B — свой раздел.
RAIL_B = [
 ('Работа', [('today','Сегодня','today'),('rentals','Аренды','rentals'),('fleet','Парк','fleet'),('service','Сервис','wrench')]),
 ('Деньги', [('money','Деньги','money'),('sales','Продажи','bag'),('purchases','Закупки','truck'),('suppliers','Поставщики','user')]),
 ('Управление', [('reports','Отчёты','chart'),('settings','Настройки','gear')]),
]
b_ph = phone('<b>Б. Свой раздел «Поставщики».</b> Отдельный пункт в меню. Быстрее найти, но на телефоне — ещё одна строка в меню аватара, а разделов уже десять; поставщиков сейчас восемь, открывают их редко.',
  head('Сегодня'), '', tabbar('owner', 'today', 14),
  overlay=avatar('Kardu', 'владелец', [('user', 'Клиенты'), ('wrench', 'Сервис · Склад'), ('bag', 'Продажи'), ('truck', 'Закупки'), ('user', '<b>Поставщики</b>'), ('chart', 'Отчёты'), ('gear', 'Настройки')], 'K'))
b_d = desk('<b>Б на ноутбуке.</b> Пункт «Поставщики» в группе «Деньги», под «Закупками».',
  rail_with(RAIL_B, 'suppliers'),
  dmain('Поставщики', '4 поставщика', None, None, stable(), '<a class="btn btn-sm btn-primary" href="#">+ Новый поставщик</a>'))

# C — рядом с клиентами.
c_ph = phone('<b>В. Рядом с клиентами: «Клиенты · Поставщики».</b> Все, с кем работаем, в одном месте. Но у менеджера «Клиенты» есть, а поставщиков ему видеть нельзя — вкладка будет только у владельца, и раздел станет разным для двух ролей. Поставщиков из клиентов убрали нарочно (волна 5, B3-06).',
  head('Клиенты', sub='64 клиента'), stabs(['Клиенты', 'Поставщики'], 'Поставщики') + LIST_TB + srows(),
  tabbar('owner', '', 14))

# ================= КАРТОЧКА =================
HISTORY = ('<ul class="tl"><li><div><b>Страна</b> · полный адрес → Китай<div class="when">28.09 · Kardu</div></div></li>'
           '<li><div><b>Оплата поставщику</b> · 1 000 CNY<div class="when">18.09 · Mika</div></div></li>'
           '<li><div><b>Заказ PO-00116</b> создан<div class="when">18.09 · Mika</div></div></li></ul>')
ORDERS = (lc('PO-00116', 'инвойс DEMO-16 · 18.09', money('6 000 CNY') + '<div class="b crit">долг 5 000</div>') +
          lc('PO-00109', 'инвойс DEMO-09 · 02.07', money('3 200 CNY') + '<div class="b">оплачено</div>'))
STRIP = nums([('5 000 CNY', 'долг', 'crit'), ('2', 'заказа', ''), ('18.09', 'последний заказ', '')])
CALL = '<a class="btn btn-sm" href="#">' + ic('phone', 'i s') + 'Позвонить</a>'

# 1 — одно поле «Контакт», как сейчас (ничего в базе не меняется).
c1 = phone('<b>Карточка 1. Одно поле «Контакт» — рекомендую сейчас.</b> Сверху — что должны и сколько заказов, ниже — как связаться: телефон с кнопкой и свободный текст в несколько строк (кто отвечает, где договариваемся, адрес, банк). Из Odoo туда уже переносятся заметки. «Изменить» и «Новый заказ» — в «⋯» и внизу. Внизу — история изменений, как в других карточках.',
  head('Zhejiang Primer Co.', sub='Китай', left='back', right='dots'),
  STRIP +
  card('Как связаться', dl([('Телефон', '+86 ··· ··· 0000 ' + CALL, '')]) +
       f'<div class="small" {PRE}>Jack Primer · Alibaba, магазин Primer\nRoom 1, Primer Road, Yongkang\nБанк: Primer Bank, SWIFT DEMOCNXX</div>') +
  grp('Заказы', '2') + ORDERS + grp('История изменений', '3') + card('', HISTORY),
  '', '<div class="action-bar bottom"><a class="btn btn-lg" href="#">Изменить</a><a class="btn btn-primary btn-lg" href="#">Новый заказ</a></div>', body_cls='bar-only')

# 2 — поля по отдельности (нужна миграция; из Odoo поля не разложить).
c2 = phone('<b>Карточка 2. Отдельные поля.</b> Контактное лицо, где договариваемся, что поставляет, адрес, банк — каждое своей строкой. Читать легче, искать можно по полю. Цена: новые поля в базе, а из Odoo это приходит одним текстом — разложить по полям придётся руками у всех восьми.',
  head('Zhejiang Primer Co.', sub='Китай', left='back', right='dots'),
  STRIP +
  card('Как связаться', dl([('Контактное лицо', 'Jack Primer', ''), ('Телефон', '+86 ··· ··· 0000 ' + CALL, ''), ('Где договариваемся', 'Alibaba · магазин Primer', '')])) +
  card('О поставщике', dl([('Что поставляет', 'мопеды Primer', ''), ('Адрес', 'Room 1, Primer Road, Yongkang', ''), ('Банк', 'Primer Bank · SWIFT DEMOCNXX', '')])) +
  grp('Заказы', '2') + ORDERS,
  '', '<div class="action-bar bottom"><a class="btn btn-lg" href="#">Изменить</a><a class="btn btn-primary btn-lg" href="#">Новый заказ</a></div>', body_cls='bar-only')

edit = phone('<b>«Изменить» — лист снизу.</b> Те же поля, что при создании. Сохранение пишет в журнал «было → стало». Уже работает на тестовом стенде (для карточки 1).',
  head('Zhejiang Primer Co.', sub='Китай', left='back', right='dots'), STRIP, '',
  overlay=sheet_form('Изменить · Zhejiang Primer Co.',
    fld('Название', 'Zhejiang Primer Co.') +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' + fld('Страна', 'Китай') + fld('Телефон', '<span class="mono">+86 ··· 0000</span>') + '</div>' +
    fld('Контакт', f'<span {PRE}>Jack Primer · Alibaba, магазин Primer\nRoom 1, Primer Road, Yongkang</span>', hint='Где и с кем договариваемся: Alibaba, WeChat, имя.'),
    '<a class="btn btn-primary btn-lg" href="#" style="width:100%">Сохранить</a>'),
  body_cls='no-tabs')

dcard = dmain('Zhejiang Primer Co.', 'Китай · поставщик', None, None,
  '<div class="cols" style="grid-template-columns:1.3fr 1fr"><div>' + STRIP +
  '<table class="table"><tr><th>Заказ</th><th>Инвойс</th><th>Дата ↓</th><th class="r">Сумма</th><th class="r">Долг</th></tr>'
  '<tr><td class="mono">PO-00116</td><td>DEMO-16</td><td>18.09</td><td class="r money">6 000 CNY</td><td class="r money crit">5 000 CNY</td></tr>'
  '<tr><td class="mono">PO-00109</td><td>DEMO-09</td><td>02.07</td><td class="r money">3 200 CNY</td><td class="r">—</td></tr></table></div>'
  '<div>' + card('Как связаться', dl([('Телефон', '+86 ··· ··· 0000', '')]) +
                 f'<div class="small" {PRE}>Jack Primer · Alibaba, магазин Primer\nRoom 1, Primer Road, Yongkang\nБанк: Primer Bank, SWIFT DEMOCNXX</div>') +
  card('История изменений', HISTORY) + '</div></div>',
  '<a class="btn btn-sm" href="#">Изменить</a><a class="btn btn-sm btn-primary" href="#">Новый заказ</a>')
d_card = desk('<b>Карточка 1 на ноутбуке.</b> Заказы таблицей слева, как связаться и история — справа.', rail('purchases', 'owner', 14), dcard)

page('suppliers-options.html', 'Поставщики · путь и экран',
 'Где живут поставщики и как выглядит их карточка. Три пути (А, Б, В) и две карточки (1, 2). Рекомендация — А + 1: без новых пунктов меню и без изменений в базе.',
 [('Запрос', 'Mika, 28.09.2026: «нормальный экран и путь туда»'),
  ('Сейчас', 'кнопка «Поставщики» в шапке «Закупок» и «Изменить» в карточке — временное, уже на тесте'),
  ('Правила', 'поставщик — отдельный тип записи, в выдаче и продаже его нет (B3-06); видит и правит только владелец'),
  ('Данные', 'Пример: фабрики, имена, телефоны и банк выдуманы')],
 [('Путь: где искать поставщиков', a_ph + b_ph + c_ph), ('Путь на ноутбуке', a_d + b_d),
  ('Карточка поставщика', c1 + c2 + edit), ('Карточка на ноутбуке', d_card)],
 '<h2>Что выбрать</h2><p><b>А + 1</b> — поставщики вкладкой в «Закупках», карточка с одним полем «Контакт». '
 'Меню не растёт, база не меняется, всё перенесённое из Odoo сразу на месте. '
 '<b>Карточку 2</b> стоит брать, если по полям будут искать или считать (например, «все, кто поставляет зарядные»); '
 'тогда разложить восемь карточек по полям придётся один раз руками.</p>')
