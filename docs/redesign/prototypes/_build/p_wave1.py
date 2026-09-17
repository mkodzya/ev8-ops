from proto_base import *
import proto_base
proto_base.WAVE1 = True
from p_today import q, grp, prim, sec, CALL, WA

TABS['manager_ka'] = [('today','დღეს','today'), ('rentals','ქირაობა','rentals'), None, ('fleet','პარკი','fleet'), ('cash','სალარო','cash')]

def stabs(items, on):
    return '<div class="chips">' + ''.join(f'<span class="chip{" on" if t == on else ""}">{t}</span>' for t in items) + '</div>'

OLD = '<div class="banner info" style="margin-top:4px">' + ic('clock','i s') + '<div><b>Содержимое — прежнее до своей волны.</b> Волна 1 меняет только рамку: шапку, панель, поиск, списки и состояния.</div></div>'

def old_today(role='owner'):
    tiles = ('<div class="nums"><div class="num"><div class="v">18</div><div class="l">в аренде</div></div><div class="num"><div class="v">9</div><div class="l">свободно</div></div><div class="num"><div class="v">6</div><div class="l">в сервисе</div></div></div>')
    return ('<div class="date">Четверг, 17 сентября</div>' + tiles +
            grp('Просрочены', '4') +
            '<div class="card"><div class="q-who">Клиент Пример Б</div><div class="q-why">R-00488 · 15 дней · 300 ₾</div></div>'
            '<div class="card"><div class="q-who">Клиент Пример В</div><div class="q-why">R-00491 · 6 дней · 150 ₾</div></div>' + OLD)

# ---------- SHELL ----------
sh1 = phone('<b>Владелец, телефон, RU.</b> Шапка: раздел, поиск, аватар. Панель: Сегодня · Аренды · ＋ · Деньги · Парк. Бейдж «Сегодня» — как сейчас (<code>lib/tasks.ts</code>) до волны 4.',
  head('Сегодня'), old_today(), tabbar('owner', 'today', 7))
sh2 = phone('<b>Тот же экран на грузинском.</b> Подписи панели — значок над словом, 12 px; длинное слово переносится на вторую строку. «ფული» — предложение, вычитать (register #15).',
  head('დღეს'), old_today().replace('Четверг, 17 сентября', 'ხუთშაბათი, 17 სექტემბერი'), tabbar('owner_ka', 'today', 7))
sh3 = phone('<b>Менеджер.</b> Панель: Сегодня · Аренды · ＋ · Парк · Касса. «Касса» до волны 2 открывает «Платежи» с фильтром «мои наличные сегодня».',
  head('Сегодня', initial='М'), old_today('manager'), tabbar('manager', 'today', 4))
sh3ka = phone('<b>Менеджер на грузинском</b> — самая длинная подпись панели «ქირაობა» и «სალარო» (предложение).',
  head('დღეს', initial='М'), old_today('manager').replace('Четверг, 17 сентября', 'ხუთშაბათი, 17 სექტემბერი'), tabbar('manager_ka', 'today', 4))

def plus_sheet(items, note):
    rows = ''.join(f'<a href="#"><span class="ico">{ic(i)}</span><span style="flex:1">{t}<br><span class="small muted" style="font-weight:400">{h}</span></span></a>' for i, t, h in items)
    return (f'<div class="sheet-scrim"></div><div class="sheet"><div class="grab"></div><h4>Что сделать</h4><div class="act-list">{rows}</div>'
            f'<div class="hint" style="margin-top:8px">{note}</div></div>')
sh4 = phone('<b>«＋» владельца в волне 1.</b> Пять действий ведут в текущие мастера и формы. «Принять деньги» добавится в волне 2 (одна форма денег), «Сообщить о поломке» у менеджера — в волне 5.',
  head('Сегодня'), old_today(), tabbar('owner', 'today', 7),
  overlay=plus_sheet([('send','Выдать мопед','мастер выдачи'), ('return','Принять возврат','сначала — чей возврат'), ('user','Новый клиент','форма клиента'), ('wrench','Открыть ремонт','форма ремонта'), ('bag','Продать мопед','форма продажи')], 'Порядок — по частоте: выдача и возврат первыми.'))
sh5 = phone('<b>«＋» менеджера в волне 1.</b> Три действия роли.',
  head('Сегодня', initial='М'), old_today('manager'), tabbar('manager', 'today', 4),
  overlay=plus_sheet([('send','Выдать мопед','мастер выдачи'), ('return','Принять возврат','сначала — чей возврат'), ('user','Новый клиент','форма клиента')], ''))
ret_pick = phone('<b>«Принять возврат» из «＋».</b> Сначала — чей: поиск по действующим арендам (имя, телефон, 4 знака VIN); сверху — плановые на сегодня. Выбор открывает текущий мастер возврата.',
  head('Чей возврат?', left='close', right=''),
  '<div class="input focus" style="margin-bottom:12px">' + ic('search','i s') + '<span class="ph">Имя, телефон или 4 знака VIN</span></div>' +
  grp('Возврат сегодня', '2') +
  '<a class="lcard" href="#"><div><div class="a">Клиент Пример А</div><div class="b">R-00497 · XL1200 ···4412</div></div><div class="r b">план сегодня</div></a>'
  '<a class="lcard" href="#"><div><div class="a">Клиент Пример Ж</div><div class="b">R-00476 · Eagle ···0917</div></div><div class="r b crit">опаздывает 2 дня</div></a>' +
  grp('Все действующие', '18') +
  '<a class="lcard" href="#"><div><div class="a">Клиент Пример Б</div><div class="b">R-00488 · F-150 ···2231</div></div></a>'
  '<a class="lcard" href="#"><div><div class="a">Клиент Пример В</div><div class="b">R-00491 · XL1200 ···1180</div></div></a>',
  '', body_cls='no-tabs')

def avatar(name, role, items, initial):
    rows = ''.join(f'<a href="#"><span class="ico">{ic(i)}</span>{t}</a>' for i, t in items)
    return ('<div class="sheet-scrim"></div><div class="sheet"><div class="grab"></div>'
      f'<div style="display:flex;gap:12px;align-items:center;margin:4px 0 14px"><span class="avatar" style="width:44px;height:44px">{initial}</span><div><div class="q-who">{name}</div><div class="q-why">{role}</div></div></div>'
      '<div class="field"><span class="lbl">Язык</span><div class="lang-row"><span>ქარ</span><span class="on">RU</span><span>EN</span></div></div>'
      f'<div class="act-list">{rows}<a href="#"><span class="ico">{ic("key")}</span>Мой вход · пароль</a>'
      f'<a href="#" style="color:var(--crit-ink)"><span class="ico" style="background:var(--crit-soft);color:var(--crit-ink)">{ic("lock")}</span>Выйти</a></div></div>')
sh6 = phone('<b>Меню аватара, владелец.</b> Язык, разделы, которых нет на панели, Мой вход, Выйти последним. Смена языка запоминается за человеком.',
  head('Сегодня'), old_today(), tabbar('owner', 'today', 7),
  overlay=avatar('Kardu', 'владелец', [('user','Клиенты'), ('wrench','Сервис · Склад'), ('bag','Продажи'), ('truck','Закупки'), ('chart','Отчёты'), ('gear','Настройки')], 'K'))
sh7 = phone('<b>Меню аватара, менеджер.</b> Только разделы, где у менеджера есть работа или просмотр: клиенты, сервис (смотреть), продажи (смотреть).',
  head('Сегодня', initial='М'), old_today('manager'), tabbar('manager', 'today', 4),
  overlay=avatar('Менеджер Пример', 'менеджер', [('user','Клиенты'), ('wrench','Сервис'), ('bag','Продажи')], 'М'))

def dshell(role, on, title, tabs, body, badge):
    t = '<div class="d-tabs">' + ''.join(f'<a class="{"on" if x == tabs[1] else ""}" href="#">{x}</a>' for x in tabs[0]) + '</div>' if tabs else ''
    return rail(on, role, badge), f'<div class="d-head"><h2>{title}</h2><span class="sub">48 мопедов</span><div class="acts"><a class="btn btn-sm btn-primary" href="#">+ Добавить мопед</a></div></div>{t}<div class="d-body">{body}</div>'
fleet_table = ('<div class="toolbar"><div class="input">' + ic('search','i s') + '<span class="ph">4 знака VIN, модель</span></div><span class="chip on">Все 48</span><span class="chip">Свободны 9</span><span class="chip">В аренде 18</span><span class="chip">В сервисе 6</span></div>'
 '<table class="table"><tr><th>VIN</th><th>Модель ↑</th><th>Цвет</th><th>Состояние</th><th>Где</th><th>Оплачено по</th><th class="r">Тишина</th></tr>' +
 ''.join(f'<tr><td>{vin(t)}</td><td>{m}</td><td>{c}</td><td>{st(k,w)}</td><td>{p}</td><td>{d}</td><td class="r">{z}</td></tr>' for t,m,c,k,w,p,d,z in [
   ('4412','XL1200','чёрный','rented','В аренде','у клиента','22.09','—'),('4471','Eagle','белый','available','Свободен','Шоурум','—','2 дня'),('7705','F-150','серый','service','В сервисе','Мастерская','—','9 дней'),('3390','B11','красный','available','Свободен','<span class="crit">не указано</span>','—','1 день')]) + '</table>')
r1, m1 = dshell('owner', 'fleet', 'Парк', (['Мопеды', 'Модели', 'Точки'], 'Мопеды'), fleet_table, 7)
dsh1 = desk('<b>Ноутбук, владелец.</b> Боковая панель: главное действие («Выдать мопед»; у владельца в волне 2 станет «Принять деньги»), поиск «/», три группы, 9 разделов, пользователь внизу — всё помещается на 700 px. Вкладки раздела — строкой под заголовком, в адресе (<code>/fleet/models</code>).', r1, m1)
r2, m2 = dshell('manager', 'fleet', 'Парк', (['Мопеды', 'Модели'], 'Мопеды'), fleet_table, 4)
dsh2 = desk('<b>Ноутбук, менеджер.</b> Две группы, 6 пунктов; главное действие — «Выдать мопед». Закупок, отчётов, настроек нет нигде.', r2, m2.replace('+ Добавить мопед', '+ Выдать мопед'))

redir = ('<table><tr><th>Было</th><th>Стало</th><th>Раздел · вкладка</th></tr>' + ''.join(f'<tr><td><code>{a}</code></td><td><code>{b}</code></td><td>{c}</td></tr>' for a,b,c in [
 ('/', '/', 'Сегодня'), ('/rentals', '/rentals', 'Аренды'), ('/fleet', '/fleet', 'Парк · Мопеды'), ('/models', '/fleet/models', 'Парк · Модели'),
 ('/service', '/service', 'Сервис · Ремонты'), ('/stock', '/service/stock', 'Сервис · Склад'), ('/payments', '/money/payments', 'Деньги · Платежи'),
 ('/statements', '/money/statements', 'Деньги · Выписки'), ('/sales', '/sales', 'Продажи'), ('/purchases', '/purchases', 'Закупки'),
 ('/economics', '/reports/economics', 'Отчёты · Экономика'), ('/customers', '/customers', 'Клиенты (меню аватара)'), ('/settings', '/settings', 'Настройки'),
 ('/profile', '/me', 'Мой вход (меню аватара)'), ('/design', '/design', 'Каталог дизайн-системы (владелец)')]) + '</table>')

page('wave-1-shell.html', 'Волна 1 · Оболочка и навигация',
 'Рамка для всех экранов: шапка, нижняя панель с «＋», боковая панель, меню аватара, вкладки разделов. Старые экраны живут в новой рамке до своей волны.',
 [('Волна', '1 — основа и оболочка · <code>docs/redesign/wave-1.md</code>'), ('Схема', 'blueprint §2.1–2.2, D1, D3; <code>docs/design/ux.md</code> «Навигация»'), ('Данные', 'Пример')],
 [('Телефон: две роли, RU и KA', sh1 + sh2 + sh3 + sh3ka), ('«＋» и меню аватара', sh4 + sh5 + ret_pick + sh6 + sh7), ('Ноутбук', dsh1 + dsh2)],
 '<h2>Адреса и переадресация</h2><p>Старый адрес переадресует на новый, закладки не ломаются (план сборки Р8).</p>' + redir)

# ---------- SEARCH ----------
def sbox(text, ph=False):
    t = f'<span class="ph">{text}</span>' if ph else text
    return f'<div class="input focus" style="margin-bottom:12px">{ic("search","i s")}{t}</div>'
s0 = phone('<b>Открыт поиск.</b> Пусто в поле — последние 5 открытых записей с этого телефона и подсказка, что можно искать.',
  head('Поиск', left='back', right=''), sbox('VIN, имя, телефон, номер, сумма', True) +
  grp('Недавно открытые', '') +
  '<a class="lcard" href="#"><div><div class="a">R-00512 · Клиент Пример Д</div><div class="b">аренда · вчера</div></div></a>'
  '<a class="lcard" href="#"><div><div class="a">XL1200 ···4412</div><div class="b">мопед · сегодня</div></div></a>'
  '<div class="hint">4 последних знака VIN · имя латиницей или по-грузински · цифры телефона · R-, SL-, PO-, SV-номер · сумма платежа</div>',
  '', body_cls='no-tabs')
s1 = phone('<b>Ищет.</b> Со второго символа; пока ждём ответ — скелет групп (после 300 мс).',
  head('Поиск', left='back', right=''), sbox('44') + ('<div class="card"><div class="skel" style="width:50%"></div><div class="skel" style="width:70%"></div></div>' * 3), '', body_cls='no-tabs')
s2 = phone('<b>Результаты владельца.</b> Группы по типу, в каждой до 3 и «ещё N». Совпадение подсвечено. Платёж ищется по сумме.',
  head('Поиск', left='back', right=''), sbox('150') +
  grp('Аренды', '1') + '<a class="lcard" href="#"><div><div class="a">R-00<b>150</b> · Клиент Пример Л</div><div class="b">завершена 12.06</div></div><div class="r">' + st('returned','Возвращена') + '</div></a>' +
  grp('Клиенты', '1') + '<a class="lcard" href="#"><div><div class="a">Клиент Пример М</div><div class="b">+995 5·· <b>150</b> ···</div></div></a>' +
  grp('Платежи', '12') +
  '<a class="lcard" href="#"><div><div class="a">+<b>150</b>,00 ₾ · наличные</div><div class="b">14.09 · R-00497 · Менеджер Пример</div></div></a>'
  '<a class="lcard" href="#"><div><div class="a">+<b>150</b>,00 ₾ · перевод TBC</div><div class="b">28.08 · R-00488</div></div></a>'
  '<a class="q-more" href="#">Ещё 10 платежей</a>', '', body_cls='no-tabs')
s3 = phone('<b>Поиск по-грузински.</b> Интерфейс на KA, имя в грузинском написании находит клиента, записанного и латиницей (второе написание).',
  head('ძებნა', left='back', right=''), sbox('ნინო') +
  grp('კლიენტები', '2') +
  '<a class="lcard" href="#"><div><div class="a"><b>ნინო</b> მაგალითი-ხარაზიშვილი</div><div class="b">Nino Primeri-Kharazishvili · R-00509</div></div></a>'
  '<a class="lcard" href="#"><div><div class="a"><b>ნინო</b> მაგალითი</div><div class="b">Nino Primeri · нет аренд</div></div></a>', '', body_cls='no-tabs')
s4 = phone('<b>Менеджер.</b> Те же группы, кроме закупок и платежей по поставщикам; себестоимости нет. Телефоны клиентов видны — звонить нужно.',
  head('Поиск', left='back', right=''), sbox('2231') +
  grp('Мопеды', '1') + f'<a class="lcard" href="#"><div><div class="a">F-150 · серый</div><div class="b">{vin("2231")}</div></div><div class="r">{st("rented","В аренде")}</div></a>' +
  grp('Клиенты', '1') + '<a class="lcard" href="#"><div><div class="a">Клиент Пример Б</div><div class="b">+995 5·· ·· <b>22 31</b></div></div></a>', '', body_cls='no-tabs')
s5 = phone('<b>Ничего не найдено.</b> Что ищем и действие: новый клиент с этим номером (если роль может создавать клиентов).',
  head('Поиск', left='back', right=''), sbox('9981') +
  f'<div class="empty"><div class="big">{ic("search")}</div><h4>Ничего по «9981»</h4><p>Ищем по 4 знакам VIN, имени, телефону, номеру записи и сумме.</p><a class="btn" href="#">Новый клиент с номером …9981</a></div>', '', body_cls='no-tabs')
s6 = phone('<b>Ошибка и нет связи.</b> Поиск не ответил — «Повторить»; без связи ищем только по недавно открытым на телефоне и говорим об этом.',
  head('Поиск', left='back', right=''), sbox('4412') +
  f'<div class="banner warn">{ic("cloud","i s")}<div>Нет связи — ищем только среди недавно открытых на этом телефоне.</div></div>' +
  f'<a class="lcard" href="#"><div><div class="a">XL1200 ···4412</div><div class="b">мопед · данные на 14:02</div></div></a>' +
  f'<div class="banner crit" style="margin-top:16px">{ic("alert","i s")}<div><b>Поиск не ответил.</b> <span class="small">search_timeout</span></div></div><a class="btn" href="#">Повторить</a>', '', body_cls='no-tabs')

palette = ('<div style="position:absolute;inset:0;background:var(--scrim-soft)"></div>'
  '<div style="position:absolute;top:60px;left:50%;transform:translateX(-50%);width:640px;background:#fff;border-radius:16px;box-shadow:var(--shadow);padding:14px">'
  '<div class="input focus" style="margin-bottom:10px">' + ic('search','i s') + 'пример б</div>'
  '<table class="table"><tr><th colspan="3">Клиенты · 1</th></tr>'
  '<tr class="sel"><td><b>Клиент Пример Б</b></td><td>+995 5·· ·· 22 31</td><td class="r">R-00488</td></tr>'
  '<tr><th colspan="3">Аренды · 2</th></tr>'
  f'<tr><td>R-00488</td><td>F-150 ···2231</td><td class="r">{st("overdue","15 дней")}</td></tr>'
  f'<tr><td>R-00301</td><td>Eagle ···0917</td><td class="r">{st("returned","Возвращена")}</td></tr>'
  '</table><div class="small muted" style="margin-top:8px">↑↓ выбрать · Enter открыть · Esc закрыть · / из любого места</div></div>')
dsearch = desk('<b>Ноутбук.</b> «/» или поле в боковой панели открывает поиск поверх страницы; стрелки и Enter без мыши.', rail('fleet', 'owner', 7), m1, palette)

page('wave-1-search.html', 'Волна 1 · Глобальный поиск',
 'Один поиск на весь продукт: с любого экрана за два действия. Все состояния, две роли, грузинский.',
 [('Волна', '1 · <code>docs/redesign/wave-1.md</code> «Поиск»'), ('Схема', 'D9; ux.md №8'), ('Закрывает', 'B6-05, T6'), ('Данные', 'Пример')],
 [('Телефон', s0 + s1 + s2 + s3 + s4 + s5 + s6), ('Ноутбук', dsearch)])

# ---------- LISTS ----------
def lc(a, b, r='', b2=''):
    bb = f'<div class="b">{b2}</div>' if b2 else ''
    return f'<a class="lcard" href="#"><div><div class="a">{a}</div><div class="b">{b}</div>{bb}</div><div class="r">{r}</div></a>'
def tb(ph, chips):
    return ('<div style="display:flex;gap:8px;margin-bottom:10px"><div class="input" style="flex:1">' + ic('search','i s') + f'<span class="ph">{ph}</span></div><a class="btn btn-round" href="#">' + ic('sort') + '</a></div>' +
            '<div class="chips">' + ''.join(f'<span class="chip{" on" if i == 0 else ""}">{c}</span>' for i, c in enumerate(chips)) + '</div>')
money = lambda v, cls='': f'<div class="money {cls}" style="font-size:16px">{v}</div>'

l_fleet = phone('<b>Парк · Мопеды.</b> Модель и цвет; VIN с 4 знаками; справа — состояние и где стоит. Фильтры состояний — чипами со счётчиками, как сейчас.',
  head('Парк', sub='48'), stabs(['Мопеды', 'Модели', 'Точки'], 'Мопеды') + tb('4 знака VIN, модель', ['Все 48', 'Свободны 9', 'В аренде 18', 'В сервисе 6', 'Без парка 12']) +
  lc('XL1200 · чёрный', vin('4412'), st('rented','В аренде') + '<div class="b">у клиента</div>') +
  lc('Eagle · белый', vin('4471'), st('available','Свободен') + '<div class="b">Шоурум</div>') +
  lc('F-150 · серый', vin('7705'), st('service','В сервисе') + '<div class="b">9 дней</div>') +
  lc('B11 · красный', vin('3390'), st('available','Свободен') + '<div class="b crit">где — не указано</div>'),
  tabbar('owner', 'fleet', 7))
l_models = phone('<b>Парк · Модели.</b> Модель и бренд; в парке и в заказе; справа — тариф и цена. Себестоимость — только владельцам.',
  head('Парк', sub='11 моделей'), stabs(['Мопеды', 'Модели', 'Точки'], 'Модели') + tb('Модель', ['Все 11', 'Flybrother 6', 'Luyuan 5']) +
  lc('XL1200', 'Flybrother · в парке 14', money('150 ₾/нед') + '<div class="b">себест. 1 700 ₾</div>') +
  lc('S70 Pro Max', 'Luyuan · в парке 3 · в заказе 0', money('— /нед') + '<div class="b">продажа 5 188 ₾</div>') +
  lc('MB5 Plus', 'Luyuan · в парке 0', '<div class="b crit">без цен</div>'),
  tabbar('owner', 'fleet', 7))
l_sales = phone('<b>Продажи.</b> Покупатель; номер, мопед, дата; справа — остаток и статус. Просроченный взнос — красным.',
  head('Продажи', sub='14'), tb('Покупатель, №, 4 знака VIN', ['Все 14', 'С рассрочкой 5', 'Просрочен взнос 1', 'Выкуплены 1']) +
  lc('Клиент Пример К', 'SL-00171 · S70 Pro Max ···9051', money('остаток 5 584 ₾') + '<div style="margin-top:6px">' + st('active','Активна') + '</div>', 'продана 02.07 · взнос 3 из 9') +
  lc('Клиент Пример О', 'SL-00169 · MKK Plus ···1203', money('долг 1 396 ₾', 'crit') + '<div style="margin-top:6px">' + st('overdue','взнос 12 дн.') + '</div>', 'продана 15.06') +
  lc('Клиент Пример П', 'SL-00160 · S90 Pro Max ···7781', money('0 ₾') + '<div style="margin-top:6px">' + st('returned','Оплачена') + '</div>', 'продана 03.05'),
  tabbar('owner', '', 7))
l_purch = phone('<b>Закупки — только владельцы.</b> Поставщик; номер, инвойс, дата; справа — сумма в валюте и статус; оплачено в процентах.',
  head('Закупки', sub='12'), tb('Поставщик, №, инвойс', ['Все 12', 'Ждут оплаты 1', 'Ждут приёмки 1', 'Пришли 10']) +
  lc('Поставщик Пример', 'PO-00115 · инвойс DEMO-15', money('6 000 CNY') + '<div class="b">оплачено 0 %</div>', 'заказан 10.09') +
  lc('Поставщик Пример 2', 'PO-00114 · инвойс DEMO-14', money('11 200 CNY') + '<div class="b">оплачено 60 %</div>', 'принят 12.09'),
  tabbar('owner', '', 7))
l_service = phone('<b>Сервис · Ремонты.</b> Мопед и что сломалось; номер и мастерская; справа — дни и за чей счёт.',
  head('Сервис', sub='10 открыто'), stabs(['Ремонты', 'Склад'], 'Ремонты') + tb('№, 4 знака VIN, причина', ['Открыты 10', 'Закрыты 27', 'Все']) +
  lc('F-150 ···7705', 'SV-00031 · не заводится после дождя', '<div class="money" style="font-size:16px">9 дней</div><div class="b">компания</div>', 'Avtos workshop') +
  lc('XL1200 ···1180', 'SV-00033 · сгорел мотор', '<div class="money" style="font-size:16px">31 день</div><div class="b">компания</div>', 'мастерская не указана'),
  tabbar('owner', '', 7))
l_stock = phone('<b>Сервис · Склад.</b> Запчасть на языке интерфейса, артикул; справа — остаток (минус — красным) и стоимость (только владельцам).',
  head('Сервис', sub='64 позиции'), stabs(['Ремонты', 'Склад'], 'Склад') + tb('Название, артикул', ['Все 64', 'Меньше нормы 5', 'В минусе 1']) +
  lc('Контроллер 60V', 'DEMO-CTRL-60 · держать ≥ 2', money('−1 шт', 'crit') + '<div class="b">—</div>') +
  lc('Тормозные колодки', 'DEMO-BRK-01 · держать ≥ 10', money('4 шт') + '<div class="b">48,00 ₾</div>') +
  lc('Датчик Холла', 'DEMO-HALL-01', money('12 шт') + '<div class="b">96,00 ₾</div>'),
  tabbar('owner', '', 7))
l_cust = phone('<b>Клиенты.</b> Имя на языке интерфейса, второе написание серым; телефон; справа — действующие аренды и долг (одна цифра — с волны 2).',
  head('Клиенты', sub='72'), tb('Имя, телефон, личный номер', ['Все 72', 'С арендой 18', 'Должны 4', 'Покупатели 14']) +
  lc('Клиент Пример Б', '+995 5·· ·· 22 31 · Primer Klient B', money('300 ₾', 'crit') + '<div class="b">1 аренда</div>') +
  lc('ნინო მაგალითი-ხარაზიშვილი', '+995 5·· ·· 90 11 · Nino Primeri-Kharazishvili', money('150 ₾', 'crit') + '<div class="b">1 аренда</div>') +
  lc('Клиент Пример Н', '+995 595 12 ·· ··', money('0 ₾') + '<div class="b">нет аренд</div>'),
  tabbar('owner', '', 7))
l_pay = phone('<b>Деньги · Платежи (до волны 2).</b> Карточки со знаком: кто, основание; справа — сумма и канал. «Аннулировать» — в меню записи, не в строке.',
  head('Деньги', sub=''), stabs(['Платежи', 'Выписки'], 'Платежи') + tb('Клиент, сумма, №', ['Эта неделя', 'Все каналы ▾']) +
  lc('Клиент Пример В', 'аренда · R-00491', money('+150,00', 'in') + '<div class="b">наличные</div>', '17.09 · Менеджер Пример') +
  lc('Клиент Пример Новый', 'аренда и залог · R-00520', money('+330,00', 'in') + '<div class="b">карта · банк 325,05</div>', '17.09'),
  tabbar('owner', 'money', 7))
l_mgr = phone('<b>Парк глазами менеджера.</b> Та же карточка; фильтра «Без парка» и себестоимости нет. API не отдаёт себестоимость менеджеру вовсе (план Р7).',
  head('Парк', sub='48', initial='М'), stabs(['Мопеды', 'Модели'], 'Мопеды') + tb('4 знака VIN, модель', ['Все 48', 'Свободны 9', 'В аренде 18', 'В сервисе 6']) +
  lc('XL1200 · чёрный', vin('4412'), st('rented','В аренде') + '<div class="b">у клиента</div>') +
  lc('Eagle · белый', vin('4471'), st('available','Свободен') + '<div class="b">Шоурум</div>'),
  tabbar('manager', 'fleet', 4))

sortsheet = ('<div class="sheet-scrim"></div><div class="sheet"><div class="grab"></div><h4>Сортировка</h4><div class="act-list">'
  '<a href="#"><span class="ico">' + ic('check') + '</span>Дольше без движения</a><a href="#"><span class="ico" style="background:none"></span>Модель А → Я</a>'
  '<a href="#"><span class="ico" style="background:none"></span>Новые поступления</a><a href="#"><span class="ico" style="background:none"></span>Последние 4 знака VIN</a></div></div>')
st_sort = phone('<b>Сортировка на телефоне</b> — выбором в листе; варианты — те же, что колонки таблицы на ноутбуке. Выбор — в адресе.',
  head('Парк', sub='48'), stabs(['Мопеды', 'Модели', 'Точки'], 'Мопеды') + tb('4 знака VIN, модель', ['Все 48', 'Свободны 9']), tabbar('owner', 'fleet', 7), overlay=sortsheet)
st_load = phone('<b>Загрузка списка.</b> Скелеты карточек; поиск и фильтры уже работают.',
  head('Продажи', sub=''), tb('Покупатель, №, 4 знака VIN', ['Все', 'С рассрочкой']) + ''.join('<div class="lcard"><div><div class="skel" style="width:150px"></div><div class="skel" style="width:110px"></div></div><div class="skel" style="width:60px"></div></div>' for _ in range(5)),
  tabbar('owner', '', 7))
st_err = phone('<b>Не загрузилось.</b> Причина и «Повторить» вместо вечной «Загрузки» (QA-1-02).',
  head('Сервис', sub=''), stabs(['Ремонты', 'Склад'], 'Ремонты') + f'<div class="empty"><div class="big" style="background:var(--crit-soft);color:var(--crit-ink)">{ic("alert")}</div><h4>Не загрузилось</h4><p>Сервер не ответил за 10 секунд.<br><span class="mono">service_timeout</span></p><a class="btn btn-primary" href="#">Повторить</a></div>',
  tabbar('owner', '', 7))
st_off = phone('<b>Нет связи.</b> Показан последний загруженный список с временем; обновится сам, когда связь вернётся.',
  head('Клиенты', sub='72'), tb('Имя, телефон', ['Все 72', 'Должны 4']) +
  lc('Клиент Пример Б', '+995 5·· ·· 22 31', money('300 ₾', 'crit')) + lc('Клиент Пример В', '+995 5·· ·· 11 80', money('150 ₾', 'crit')),
  tabbar('owner', '', 7), sync=f'<div class="syncbar">{ic("cloud","i s")}Нет связи — список на 14:02</div>')
st_empty = phone('<b>Пусто в разделе.</b> Что здесь будет и первое действие.',
  head('Закупки', sub='0'), f'<div class="empty"><div class="big">{ic("truck")}</div><h4>Заказов пока нет</h4><p>Заказ поставщику — в валюте инвойса; мопеды появятся в парке при приёмке.</p><a class="btn btn-primary" href="#">Новый заказ</a></div>',
  tabbar('owner', '', 7))
st_none = phone('<b>Фильтр и поиск ничего не дали.</b> Говорим, что именно, и снимаем фильтр одним нажатием.',
  head('Сервис', sub='64 позиции'), stabs(['Ремонты', 'Склад'], 'Склад') + tb('Название, артикул', ['Меньше нормы 5', 'Все 64']).replace('<span class="ph">Название, артикул</span>', 'зеркало') +
  f'<div class="empty"><div class="big">{ic("search")}</div><h4>«зеркало» среди «меньше нормы» нет</h4><p>Может быть, в остальных позициях.</p><a class="btn" href="#">Искать во всех 64</a></div>',
  tabbar('owner', '', 7))

stock_table = ('<div class="toolbar"><div class="input">' + ic('search','i s') + '<span class="ph">Название, артикул</span></div><span class="chip on">Все 64</span><span class="chip">Меньше нормы 5</span><span class="chip">В минусе 1</span></div>'
 '<table class="table"><tr><th>Артикул</th><th>Название ↑</th><th>Для моделей</th><th class="r">Остаток</th><th class="r">Держать ≥</th><th class="r">Средняя цена</th><th class="r">Стоимость</th></tr>' +
 ''.join(f'<tr><td class="mono small">{a}</td><td><b>{n}</b></td><td>{m}</td><td class="r money {c}">{o}</td><td class="r">{k}</td><td class="r money">{p}</td><td class="r money">{v}</td></tr>' for a,n,m,o,k,p,v,c in [
  ('DEMO-BRK-01','Тормозные колодки','все Flybrother','4','10','12,00','48,00',''),('DEMO-CTRL-60','Контроллер 60V','XL1200, Eagle','−1','2','—','—','crit'),('DEMO-HALL-01','Датчик Холла','все','12','—','8,00','96,00','')]) + '</table>')
dl = desk('<b>Ноутбук: таблица.</b> Тот же список таблицей (U17): заголовок сортирует, строка кликается целиком, фильтры — чипами над таблицей, всё в адресе.',
  rail('service', 'owner', 7), '<div class="d-head"><h2>Сервис</h2><span class="sub">64 позиции</span><div class="acts"><a class="btn btn-sm btn-primary" href="#">+ Новая запчасть</a></div></div><div class="d-tabs"><a href="#">Ремонты <span class="n">10</span></a><a class="on" href="#">Склад</a></div><div class="d-body">' + stock_table + '</div>')

page('wave-1-lists.html', 'Волна 1 · Списки всех разделов',
 'На телефоне все списки — карточками без прокрутки вбок: поиск, фильтры со счётчиками, сортировка выбором. На ноутбуке — таблица. Состояния одинаковые везде.',
 [('Волна', '1 · <code>docs/redesign/wave-1.md</code> «Списки»'), ('Схема', 'D14; ux.md «Списки»'), ('Закрывает', 'B6-05, T5 (карточки), T7'), ('Данные', 'Пример; артикулы DEMO')],
 [('Карточки по разделам', l_fleet + l_models + l_sales + l_purch + l_service + l_stock + l_cust + l_pay + l_mgr), ('Сортировка и состояния', st_sort + st_load + st_err + st_off + st_empty + st_none), ('Ноутбук', dl)],
 '<h2>Правило карточки</h2><table><tr><th>Место</th><th>Что</th></tr><tr><td>Первая строка</td><td>Кто или что: клиент, модель, поставщик, запчасть</td></tr><tr><td>Вторая строка (тихая)</td><td>Номер записи, 4 знака VIN, телефон, артикул</td></tr><tr><td>Третья (если нужна)</td><td>Дата или место</td></tr><tr><td>Справа</td><td>Сумма или остаток, под ней — пилюля или короткая подпись</td></tr></table>'
 '<p>Сегменты «Аренд» (Просрочены, Ждут оплаты, Без VIN…) — волна 4; в волне 1 у «Аренд» поиск, сортировка и нынешние фильтры.</p>')

# ---------- FORMS AND STATES ----------
def fld(label, inner, hint='', err='', cls=''):
    h = f'<div class="hint">{hint}</div>' if hint else ''
    e = f'<div class="ferr">{err}</div>' if err else ''
    return f'<label class="field"><span class="lbl">{label}</span><div class="input {cls}">{inner}</div>{e}{h}</label>'
def sheet_form(title, body, btn):
    return f'<div class="sheet-scrim"></div><div class="sheet" style="top:110px;overflow:auto"><div class="grab"></div><h4>{title}</h4>{body}{btn}</div>'
base_list = tb('Название, артикул', ['Все 64', 'Меньше нормы 5'])
form_body = fld('Название', 'Зеркало левое') + fld('Название по-грузински', 'მარცხენა სარკე') + fld('Артикул', 'DEMO-MIR-L') + fld('Держать не меньше', '4')
f1 = phone('<b>Форма в листе — покой.</b> Короткая форма (до 6 полей) — лист снизу. Ключ операции создаётся при открытии листа.',
  head('Сервис', sub='Склад'), base_list, tabbar('owner','',7), overlay=sheet_form('Новая запчасть', form_body, '<a class="btn btn-primary btn-lg" href="#" style="width:100%">Добавить запчасть</a>'))
f2 = phone('<b>Записываем…</b> Кнопка неактивна, второе нажатие ничего не делает; тот же ключ при повторе вернёт ту же запись (QA-1-03).',
  head('Сервис', sub='Склад'), base_list, tabbar('owner','',7), overlay=sheet_form('Новая запчасть', form_body, '<a class="btn btn-primary btn-lg sending" href="#" style="width:100%">Записываем…</a>'))
f3 = phone('<b>Не записалось — связь.</b> Ошибка — внутри этой формы, а не над страницей (QA-1-06). Введённое на месте, «Повторить» безопасен благодаря ключу.',
  head('Сервис', sub='Склад'), base_list, tabbar('owner','',7),
  overlay=sheet_form('Новая запчасть', f'<div class="banner crit">{ic("cloud","i s")}<div><b>Не записалось:</b> нет связи с сервером. Черновик сохранён на телефоне.</div></div>' + form_body, '<a class="btn btn-lg failed" href="#" style="width:100%">Не записалось — повторить</a>'))
f4 = phone('<b>Отказ по полю.</b> Сервер назвал поле — ошибка под ним на языке экрана, фокус на нём (QA-1-08).',
  head('Сервис', sub='Склад'), base_list, tabbar('owner','',7),
  overlay=sheet_form('Новая запчасть', fld('Название', 'Зеркало левое') + fld('Артикул', 'DEMO-MIR-L', err='Такой артикул уже есть: «Зеркало левое (старое)». Откройте его или задайте другой.', cls='err focus') + fld('Держать не меньше', '4'), '<a class="btn btn-primary btn-lg" href="#" style="width:100%">Добавить запчасть</a>'))
f5 = phone('<b>Записано.</b> Лист закрылся, новая запись в списке подсвечена 2 секунды, сообщение «Открыть» — после создания ведём в запись (ux №4).',
  head('Сервис', sub='Склад'), base_list + '<a class="lcard" href="#" style="background:var(--accent-soft)"><div><div class="a">Зеркало левое</div><div class="b">DEMO-MIR-L · держать ≥ 4</div></div><div class="r"><div class="money" style="font-size:16px">0 шт</div></div></a>',
  tabbar('owner','',7), overlay=f'<div class="toast">{ic("check","i s")}Запчасть добавлена<a href="#">Открыть</a></div>')
f6 = phone('<b>Черновик.</b> Форма или мастер, закрытые не отправленными, предлагают продолжить. Черновик живёт на телефоне до выхода из системы.',
  head('Сервис', sub='Склад'), base_list, tabbar('owner','',7),
  overlay=sheet_form('Новая запчасть', f'<div class="banner ok">{ic("clock","i s")}<div><b>Черновик от 14:20</b> · «Зеркало левое»</div></div>', '<a class="btn btn-primary btn-lg" href="#" style="width:100%;margin-bottom:8px">Продолжить</a><a class="btn btn-quiet" href="#" style="width:100%">Начать заново</a>'))
f7 = phone('<b>Закрыть с введёнными данными.</b> Свайп вниз, крестик или нажатие мимо по заполненной форме спрашивают.',
  head('Сервис', sub='Склад'), base_list, tabbar('owner','',7),
  overlay='<div class="sheet-scrim"></div><div class="sheet"><div class="grab"></div><h4>Закрыть форму?</h4><p class="small muted" style="margin:0 0 14px">Введённое останется черновиком на этом телефоне.</p><div style="display:flex;gap:8px"><a class="btn" href="#" style="flex:1">Вернуться</a><a class="btn btn-primary" href="#" style="flex:1">Закрыть</a></div></div>')

p_noacc = phone('<b>Нет прав.</b> Менеджер открыл ссылку на закупку: раздела у него нет. Не «403», а что это и куда идти.',
  head('Закупки', initial='М', right='avatar'), f'<div class="empty"><div class="big" style="background:var(--surface-2);color:var(--muted)">{ic("lock")}</div><h4>Это видят владельцы</h4><p>Закупки ведут Mika и Kardu.</p><a class="btn" href="#">На «Сегодня»</a></div>', tabbar('manager', '', 4))
p_404 = phone('<b>Запись не найдена.</b> Неверный или удалённый адрес — сказать и дать путь к списку (блок 1, в новой рамке).',
  head('Продажи', left='back', right='search avatar'), f'<div class="empty"><div class="big" style="background:var(--surface-2);color:var(--muted)">{ic("search")}</div><h4>Продажа не найдена</h4><p>Возможно, ссылка устарела или продажу отменили.</p><a class="btn" href="#">Все продажи</a></div>', tabbar('owner', '', 7))
p_sess = phone('<b>Сессия закончилась.</b> Вход поверх страницы; после входа — та же страница и черновик формы.',
  head('Вход', right=''), '<div class="banner info">' + ic('lock','i s') + '<div>Вход закончился. Войдите снова — вернём на <b>«Аренда R-00488»</b>, введённое сохранено.</div></div>' +
  fld('Почта', 'kardu@example.ge') + fld('Пароль', '••••••••') + '<div class="lang-row" style="margin:6px 0 14px"><span>ქარ</span><span class="on">RU</span><span>EN</span></div>',
  '', '<div class="action-bar bottom"><a class="btn btn-primary btn-lg" href="#">Войти</a></div>', body_cls='bar-only')
p_logout = phone('<b>Выход без связи (QA-1-01).</b> Телефон забывает вход сразу; сервер закроет сессию при первой связи. Говорим об этом честно.',
  head('Вход', right=''), '<div class="empty" style="padding-top:24px"><h4>EV8 Ops</h4><p>Войдите своей почтой и паролем.</p></div>', '',
  overlay=f'<div class="sheet-scrim"></div><div class="sheet"><div class="grab"></div><div class="banner warn">{ic("cloud","i s")}<div><b>Вы вышли на этом телефоне.</b> Сервер закроет вход, когда появится связь. Если телефон потерян — владелец завершит вход в «Настройки → Люди».</div></div><a class="btn btn-primary btn-lg" href="#" style="width:100%">Понятно</a></div>', body_cls='no-tabs')
p_back = phone('<b>Связь вернулась.</b> Полоса на 3 секунды: «Связь есть — обновили», данные перечитаны.',
  head('Клиенты', sub='72'), tb('Имя, телефон', ['Все 72', 'Должны 4']) + lc('Клиент Пример Б', '+995 5·· ·· 22 31', money('300 ₾', 'crit')),
  tabbar('owner', '', 7), sync=f'<div class="syncbar" style="background:var(--accent-soft);color:var(--accent-ink)">{ic("check","i s")}Связь есть — обновили в 14:09</div>')
p_roles = phone('<b>Две роли в «Настройки → Люди».</b> Роль — из двух: владелец или менеджер; смена — с подтверждением (как в блоке 1). После миграции учётка директора становится владельцем.',
  head('Настройки', left='back', right=''),
  grp('Люди', '6') +
  lc('Mika', 'mika@… · вход сегодня', '<span class="st st-active"><i class="mk"></i>владелец</span>') +
  lc('Kardu', 'kardu@… · вход сегодня', '<span class="st st-active"><i class="mk"></i>владелец</span>') +
  lc('Менеджер Пример', 'manager@… · вход вчера', '<span class="st st-booked"><i class="mk"></i>менеджер</span>'),
  '', overlay='<div class="sheet-scrim"></div><div class="sheet"><div class="grab"></div><h4>Роль · Менеджер Пример</h4><div class="seg3" style="grid-template-columns:1fr 1fr;margin-bottom:10px"><span>Владелец</span><span class="on">Менеджер</span></div><p class="small muted" style="margin:0 0 14px">Владелец видит деньги, себестоимость, закупки, отчёты и настройки. Менеджер — выдача, возврат, клиенты, наличные.</p><a class="btn btn-primary btn-lg" href="#" style="width:100%">Готово</a></div>', body_cls='no-tabs')

dform = desk('<b>Ноутбук: форма в панели справа.</b> Те же четыре вида кнопки и ошибка внутри панели; Esc, крестик, клик мимо.',
  rail('service', 'owner', 7), '<div class="d-head"><h2>Сервис</h2><span class="sub">64 позиции</span></div><div class="d-tabs"><a href="#">Ремонты</a><a class="on" href="#">Склад</a></div><div class="d-body" style="opacity:.4">' + stock_table + '</div>',
  '<div class="panel"><div style="display:flex;align-items:center;margin-bottom:12px"><div class="h3" style="margin:0;flex:1">Новая запчасть</div>' + ic('x') + '</div>' + fld('Название', 'Зеркало левое') + fld('Название по-грузински', 'მარცხენა სარკე') + fld('Артикул', 'DEMO-MIR-L', err='Такой артикул уже есть: «Зеркало левое (старое)».', cls='err') + fld('Держать не меньше', '4') + '<a class="btn btn-primary" href="#" style="width:100%">Добавить запчасть</a></div>')

page('wave-1-forms-states.html', 'Волна 1 · Формы, отправка и состояния',
 'Одна механика для всех форм: ключ операции, кнопка в четырёх видах, ошибка внутри формы, черновик. И общие экраны: нет прав, нет записи, сессия закончилась, выход без связи, связь вернулась, две роли.',
 [('Волна', '1 · <code>docs/redesign/wave-1.md</code> «Формы и состояния»'), ('Схема', 'ux.md «Шесть состояний», «Кнопка отправки»; план сборки Р4–Р7'), ('Закрывает', 'B2-01 (интерфейс), B4-02 (механизм), B9-02, X2, QA-1-01, -02, -03, -06, -08'), ('Данные', 'Пример')],
 [('Отправка формы', f1 + f2 + f3 + f4 + f5 + f6 + f7), ('Общие состояния', p_noacc + p_404 + p_sess + p_logout + p_back + p_roles), ('Ноутбук', dform)])
print('ok wave1')
