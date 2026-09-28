from proto_base import *
from p_wave4 import nums
import proto_base
proto_base.WAVE1 = False

# Заметки поставщика (Mika, 28.09.2026): «не видно, что заметки свёрнуты —
# нужна кнопка». Three ways, each drawn closed and open. Each closed frame
# also opens by a tap — <details>, no script — where the viewer allows it.
# Example data only.

def dl(rows):
    return '<dl class="kv">' + ''.join(f'<dt>{a}</dt><dd>{b}</dd>' for a, b in rows) + '</dl>'
def card(h, body): return f'<div class="card">{"<div class=h3>" + h + "</div>" if h else ""}{body}</div>'

NOTE = ('Поставщик контроллеров 1500–2000W (Alibaba.com). Заказ 25.06.2026: 5 шт. '
        'Оплата шла через Alibaba.com Singapore E-Commerce Pte Ltd (в банке проходит как merchant '
        '«Alibaba.com», MCC 5311), карта ···0000.')
EXTRA_CSS = '''<style>
.nt summary { list-style: none; cursor: pointer; }
.nt summary::-webkit-details-marker { display: none; }
.nt .chev { display: inline-block; transition: transform .15s; }
.nt[open] .chev { transform: rotate(180deg); }
.nt .when-open { display: none; } .nt[open] .when-open { display: inline; } .nt[open] .when-closed { display: none; }
.nt-text { font: var(--text-body-sm); white-space: pre-line; margin-top: 8px; }
.fade { position: relative; max-height: 3.9em; overflow: hidden; }
.fade::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 1.6em; background: linear-gradient(transparent, var(--surface)); }
.nt[open] .fade { max-height: none; } .nt[open] .fade::after { display: none; }
.cnt { font: 500 12px/1 var(--mono); background: var(--surface-2); padding: 3px 7px; border-radius: 999px; color: var(--muted); }
</style>'''

HEAD = head('Anhui Primer Co.', sub='Китай', left='back', right='dots')
STRIP = nums([('—', 'долга нет', ''), ('1', 'заказ', ''), ('25.06', 'последний заказ', '')])
ABOUT_ROWS = dl([('Что поставляет', '—'), ('Адрес', 'Room 1, Primer Road, Hefei'), ('Банк', '—')])
CHEV = '<span class="chev">▾</span>'

# A — кнопка во всю ширину под блоком «О поставщике».
def a_block(open_=False):
    o = ' open' if open_ else ''
    return (card('О поставщике', ABOUT_ROWS +
      f'<details class="nt"{o}><summary class="btn btn-sm" style="width:100%;margin-top:10px">'
      f'<span class="when-closed">Показать заметки</span><span class="when-open">Скрыть заметки</span>{CHEV}</summary>'
      f'<div class="nt-text">{NOTE}</div></details>'))

# B — начало текста видно, дальше «Показать всё». <details> always shows its <summary>,
# so the faded start of the text sits inside the summary, with the button under it.
def b_block(open_=False):
    o = ' open' if open_ else ''
    return (card('О поставщике', ABOUT_ROWS) +
      f'<div class="card"><div class="h3">Заметки</div><details class="nt"{o}>'
      f'<summary style="display:block"><div class="fade nt-text" style="margin-top:0">{NOTE}</div>'
      f'<span class="btn btn-sm btn-quiet" style="padding:0;margin-top:6px">'
      f'<span class="when-closed">Показать всё</span><span class="when-open">Свернуть</span>{CHEV}</span></summary></details></div>')

# C — своя строка-ссылка с числом строк, открывает лист снизу.
def c_block():
    return (card('О поставщике', ABOUT_ROWS) +
      '<a class="lcard" href="#"><div><div class="a">Заметки</div><div class="b">3 строки · из Odoo</div></div>'
      f'<div class="r">{ic("right")}</div></a>')
C_SHEET = (f'<div class="sheet-scrim"></div><div class="sheet" style="top:180px"><div class="grab"></div>'
           f'<h4>Заметки · Anhui Primer Co.</h4><div class="nt-text">{NOTE}</div>'
           f'<a class="btn btn-lg" href="#" style="width:100%;margin-top:16px">Изменить</a></div>')

def ph(caption, body, overlay=''):
    return phone(caption, HEAD, STRIP + body, '', '<div class="action-bar bottom"><a class="btn btn-lg" href="#">Изменить</a><a class="btn btn-primary btn-lg" href="#">Новый заказ</a></div>',
                 overlay=overlay, body_cls='bar-only')

a1 = ph('<b>А. Кнопка «Показать заметки ▾» — рекомендую.</b> Во всю ширину, под полями «О поставщике», в виде обычной кнопки — видно, что за ней что-то есть. Нажал — текст раскрывается тут же, кнопка становится «Скрыть заметки ▴».', a_block())
a2 = ph('<b>А, открыто.</b>', a_block(True))
b1 = ph('<b>Б. Начало текста и «Показать всё».</b> Первые две строки видны и гаснут книзу, под ними «Показать всё ▾». Сразу понятно, о чём заметка, но блок занимает место, даже когда он не нужен.', b_block())
b2 = ph('<b>Б, открыто.</b>', b_block(True))
c1 = ph('<b>В. Строка «Заметки · 3 строки ›».</b> Как строка списка: нажал — лист снизу с текстом и «Изменить». Карточка самая короткая, но текст уходит в отдельное окно.', c_block())
c2 = ph('<b>В, открыто.</b> Лист снизу.', c_block(), overlay=C_SHEET)

# ---- laptop: the card as on the test stand — orders on the left, the
# fields on the right, the notes in the right-hand column.
REACH = card('Как связаться', dl([('Контактное лицо', '—'), ('Телефон', '—'), ('Где договариваемся', 'Alibaba.com')]))
ORDERS = ('<table class="table"><tr><th>Заказ</th><th>Инвойс</th><th>Дата ↓</th><th class="r">Сумма</th><th class="r">Оплачено</th></tr>'
          '<tr><td class="mono">PO-00121</td><td>DEMO-21</td><td>25.06</td><td class="r money">113 USD</td><td class="r">100 %</td></tr></table>')
def dcard(right, extra=''):
    main = ('<div class="d-head"><h2>Anhui Primer Co.</h2><span class="sub">Китай · поставщик</span>'
            '<div class="acts"><a class="btn btn-sm" href="#">Изменить</a><a class="btn btn-sm btn-primary" href="#">Новый заказ</a></div></div>'
            '<div class="d-body"><div class="cols" style="grid-template-columns:1.4fr 1fr"><div>' + STRIP + ORDERS + '</div>'
            f'<div>{REACH}{right}</div></div></div>')
    return rail('purchases', 'owner', 14), main, extra
def dk(caption, right, extra=''):
    r, m, e = dcard(right, extra)
    return desk(caption, r, m, e)
C_PANEL = (f'<div class="panel"><div style="display:flex;justify-content:space-between;align-items:center">'
           f'<div class="h3" style="margin:0">Заметки · Anhui Primer Co.</div><a class="icon-btn" href="#">{ic("x")}</a></div>'
           f'<div class="nt-text">{NOTE}</div><a class="btn" href="#" style="margin-top:16px">Изменить</a></div>')
da1 = dk('<b>А на ноутбуке.</b> Кнопка под полями в правой колонке; текст раскрывается там же.', a_block())
da2 = dk('<b>А на ноутбуке, открыто.</b>', a_block(True))
db1 = dk('<b>Б на ноутбуке.</b> Начало заметки в своём блоке под «О поставщике».', b_block())
db2 = dk('<b>Б на ноутбуке, открыто.</b>', b_block(True))
dc1 = dk('<b>В на ноутбуке.</b> Строка «Заметки ›» в правой колонке.', c_block())
dc2 = dk('<b>В на ноутбуке, открыто.</b> Вместо листа снизу — панель справа.', c_block(), C_PANEL)

page('supplier-notes-options.html', 'Заметки поставщика · как показать',
 'Заметки в карточке поставщика свёрнуты, но этого не видно. Три способа показать, что там есть текст, — каждый на телефоне и на ноутбуке, закрытым и открытым. Закрытые рамки А и Б раскрываются нажатием.',
 [('Запрос', 'Mika, 28.09.2026: «не видно, что заметки свёрнуты — надо добавить кнопку»'),
  ('Где', 'Закупки → Поставщики → карточка, блок «О поставщике»'),
  ('Данные', 'Пример')],
 [('А. Кнопка — телефон', a1 + a2), ('А. Кнопка — ноутбук', da1 + da2),
  ('Б. Начало текста — телефон', b1 + b2), ('Б. Начало текста — ноутбук', db1 + db2),
  ('В. Отдельная строка — телефон', c1 + c2), ('В. Отдельная строка — ноутбук', dc1 + dc2)],
 '<h2>Что выбрать</h2><p><b>А</b> — обычная кнопка, какие уже есть в продукте: видно сразу, места почти не занимает, текст раскрывается там же, где читали. '
 '<b>Б</b> — если важно видеть начало заметки не нажимая. <b>В</b> — если заметки станут длинными (больше экрана).</p>')

# The page's own styles for the fold, after the shared ones.
out = OUT / 'supplier-notes-options.html'
out.write_text(out.read_text().replace('</head>', EXTRA_CSS + '</head>', 1))
assert '<script' not in out.read_text()
