from proto_base import *
from p_today import q, grp, prim, sec, CALL, WA

def sw(name, var, hexv, ratio, note=''):
    return (f'<div class="card" style="width:210px;padding:0;overflow:hidden"><div style="height:64px;background:var({var});border-bottom:1px solid var(--line-soft)"></div>'
            f'<div style="padding:10px 12px"><div class="q-who" style="font-size:14px">{name}</div><div class="small mono muted">{var} · {hexv}</div><div class="small">{ratio}</div><div class="small muted">{note}</div></div></div>')

colors = ''.join([
 sw('Текст', '--ink', '#0b0b0b', '19,7:1 на белом'),
 sw('Вторичный текст', '--muted', '#5d5d5d', '6,4:1 на фоне'),
 sw('Главная кнопка, ссылки', '--accent', '#557553', 'белый по нему 5,18:1'),
 sw('Наведение', '--accent-hover', '#628767', 'белый 4,05:1', 'только наведение на ноутбуке'),
 sw('Лайм — один акцент', '--lime', '#e0ffa2', 'текст по нему 17,8:1'),
 sw('Граница поля — предложение', '--line-control', '#7a7a7a', '4,29:1 · нужно ≥ 3', 'было --line 1,3:1'),
 sw('Тихая линия', '--line', '#dbe4de', '1,3:1', 'только разделители, не поля'),
 sw('Критичное', '--crit', '#c8402f', '4,96:1'),
 sw('В аренде', '--rented', '#598eeb', 'только фигура и заливка'),
 sw('В сервисе', '--service', '#fe5d02', 'белый 3,1:1 — не для кнопок', 'оранжевая кнопка уходит'),
 sw('Фон', '--bg', '#fbfbfb', '—'),
 sw('Сообщение — предложение', '--toast', '#0b0b0b', 'лайм по нему 17,8:1'),
])

types = ('<div class="card" style="width:560px">'
 '<div style="font:var(--text-h1-phone)">Название раздела 22 · დღეს</div><div class="small muted mono">--text-h1-phone</div><div class="hr"></div>'
 '<div class="hero">330,00 ₾</div><div class="small muted mono">--text-display · цифра экрана</div><div class="hr"></div>'
 '<div style="font:var(--text-money-lg)">1 040 ₾</div><div class="small muted mono">--text-money-lg · предложение · сумма в строке</div><div class="hr"></div>'
 '<div style="font:var(--text-body)">Клиент Пример Б · კლიენტი მაგალითი ბ</div><div class="small muted mono">--text-body 15</div><div class="hr"></div>'
 '<div style="font:var(--text-label);color:var(--muted)">F-150 ···2231 · 15 дней · оплачено по 02.09</div><div class="small muted mono">--text-label 13</div><div class="hr"></div>'
 f'<div>{vin("4412")}</div><div class="small muted mono">--text-mono · 4 знака на лайме</div></div>')

buttons = ('<div class="card" style="width:560px"><div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center">'
 '<a class="btn btn-primary" href="#">Принять оплату</a><a class="btn" href="#">Открыть</a><a class="btn btn-quiet" href="#">Отмена</a>'
 f'<a class="btn btn-round" href="#">{ic("phone")}</a><a class="btn btn-sm" href="#">Малая</a></div><div class="hr"></div>'
 '<div class="small muted" style="margin-bottom:8px">Кнопка отправки — четыре вида</div>'
 '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">'
 '<a class="btn btn-primary" href="#">Записать 150 ₾</a><a class="btn btn-primary sending" href="#">Записываем…</a>'
 f'<a class="btn btn-primary" href="#">{ic("check","i s")}Записано</a><a class="btn failed" href="#">Не записалось — повторить</a></div>'
 '<div class="hr"></div><div class="small muted" style="margin-bottom:8px">Громкое действие экрана — 52 px, в липкой полосе</div><div style="display:flex"><a class="btn btn-primary btn-lg" href="#">Принять возврат</a></div></div>')

pills = ('<div class="card" style="width:560px"><div class="small muted" style="margin-bottom:8px">Мопед</div><div style="display:flex;flex-wrap:wrap;gap:8px">' +
 st('available','Свободен') + st('rented','В аренде') + st('service','В сервисе') + st('out','Списан') + st('sold','Продан') +
 '</div><div class="hr"></div><div class="small muted" style="margin-bottom:8px">Аренда</div><div style="display:flex;flex-wrap:wrap;gap:8px">' +
 st('booked','Бронь') + st('active','Действует') + st('waiting','Ждёт оплаты') + st('overdue','15 дней') + st('paused','Пауза') + st('disputed','Спорная') + st('returned','Возвращена') +
 '</div><div class="small muted" style="margin-top:8px">«Ждёт оплаты» — новая: без заливки, контур и пустой круг. Новых цветов не вводит.</div>'
 '<div class="hr"></div><div class="small muted" style="margin-bottom:8px">Фильтры</div><div style="display:flex;gap:8px"><span class="chip on">Просрочены <span class=n>4</span></span><span class="chip">Без VIN <span class=n>2</span></span></div></div>')

# six states on one component
def mini(title, body, sync=''):
    return phone(title, head('Аренды', sub='43'), body, tabbar('owner', 'rentals', 14), sync=sync)
s_empty = mini('<b>Пусто</b> — что пусто и что сделать.', f'<div class="empty"><div class="big">{ic("check")}</div><h4>Просрочек нет</h4><p>Все действующие аренды оплачены.</p><a class="btn" href="#">Загрузить выписку</a></div>')
s_load = mini('<b>Загрузка</b> — скелет формы карточек, через 300 мс.', ''.join('<div class="lcard"><div><div class="skel" style="width:140px"></div><div class="skel" style="width:90px"></div></div><div class="skel" style="width:50px"></div></div>' for _ in range(5)))
s_err = mini('<b>Ошибка</b> — причина, код мелко, «Повторить».', f'<div class="empty"><div class="big" style="background:var(--crit-soft);color:var(--crit-ink)">{ic("alert")}</div><h4>Не загрузилось</h4><p>Сервер не ответил за 10 секунд.<br><span class="mono">rentals_timeout</span></p><a class="btn btn-primary" href="#">Повторить</a></div>')
s_off = mini('<b>Нет связи</b> — данные на время, работа продолжается.', '<a class="lcard" href="#"><div><div class="a">Клиент Пример Б</div><div class="b">R-00488 · F-150 ···2231</div></div><div class="r money crit">300 ₾</div></a>'*3, sync=f'<div class="syncbar">{ic("cloud","i s")}Нет связи — показаны данные на 14:02</div>')
s_noacc = phone('<b>Нет прав</b> — прямая ссылка менеджера на «Закупки».', head('Закупки', initial='М'), f'<div class="empty"><div class="big" style="background:var(--surface-2);color:var(--muted)">{ic("lock")}</div><h4>Это видят владельцы</h4><p>Закупки ведут Mika и Kardu.</p><a class="btn" href="#">На «Сегодня»</a></div>', tabbar('manager', '', 6))
s_ok = phone('<b>Успех</b> — сообщение снизу, «Отменить» 10 с или «Открыть».', head('Аренды', sub='43'), '<a class="lcard" href="#" style="background:var(--accent-soft)"><div><div class="a">Клиент Пример Новый</div><div class="b">R-00520 · XL1200 ···4410</div></div><div class="r">' + st('active','Действует') + '</div></a>', tabbar('owner', 'rentals', 14),
  overlay=f'<div class="toast">{ic("check","i s")}Выдано · R-00520<a href="#">Открыть</a></div>')

nav = ('<div class="card" style="width:395px;padding:0;overflow:hidden;position:relative;height:64px">' + tabbar('owner', 'today', 14) + '</div>'
  '<div class="card" style="width:395px;padding:0;overflow:hidden;position:relative;height:64px">' + tabbar('owner_ka', 'today', 14) + '</div>'
  '<div class="card" style="width:395px;padding:0;overflow:hidden;position:relative;height:64px">' + tabbar('manager', 'rentals', 6) + '</div>')

comps = ('<div style="width:395px">' + grp('Строка очереди', '') +
  q('Клиент Пример Б', 'F-150 ···2231 · 15 дней · оплачено по 02.09', '300 ₾', prim('Принять оплату') + CALL + WA, 't-crit'.replace('t-','')) +
  q('Залог · Клиент Пример Д', 'Возврат оформил менеджер', '180 ₾', prim('Решить залог'), 'decide') +
  grp('Карточка списка', '') +
  '<a class="lcard" href="#"><div><div class="a">Клиент Пример В</div><div class="b">R-00491 · XL1200 ···1180</div><div class="b">оплачено по 11.09</div></div><div class="r"><div class="money crit" style="font-size:16px">150 ₾</div><div style="margin-top:6px">' + st('overdue','6 дней') + '</div></div></a>' +
  grp('Поле', '') +
  '<label class="field"><span class="lbl">Пробег, км</span><div class="input err">1 200</div><div class="ferr">Не меньше 1 234 — столько было при выдаче</div></label>'
  '<label class="field"><span class="lbl">Телефон</span><div class="input focus"><span class="muted">+995</span> 595 12 34 56</div></label>' +
  grp('Позиция акта', '') +
  '<div class="seg3"><span class="on">В порядке</span><span>Повреждено</span><span>Нет</span></div>' +
  '</div>')

index_notes = ('<h2>Откуда цифры контраста</h2><p>Посчитаны по формуле WCAG 2.1 17.09.2026 (blueprint §3.3). Токены помеченные «предложение» — в blueprint §3.4, в коде их нет.</p>'
 '<h2>Значки</h2><p>Линейные 24 px, линия 1,75. Здесь нарисованы вручную как заглушки; в продукте — один набор (например, Lucide, лицензия ISC) — решает разработчик в плане сборки.</p>')

page('01-system.html', 'Дизайн-система',
 'Цвета с измеренным контрастом, шрифты, кнопки, пилюли, панели, шесть состояний и основные компоненты. Всё на токенах из <code>tokens.css</code> и блока «предложение».',
 [('Схема', 'blueprint А3: §3.2 состояния, §3.3 визуальный язык, §3.4 токены, §3.5 компоненты'), ('Бренд', '<code>docs/design/brand.md</code>, ADR-0002 (одна светлая тема)')],
 [('Цвета', colors), ('Шрифты, кнопки, пилюли', types + buttons + pills), ('Нижняя панель: владелец RU и KA, менеджер', nav),
  ('Шесть состояний', s_empty + s_load + s_err + s_off + s_noacc + s_ok), ('Компоненты', comps)], index_notes)
print('ok system')
