from proto_base import *
from p_today import q, grp, CALL, WA, prim, sec

m_body = ('<div class="date">Четверг, 17 сентября</div>'
  '<div class="nums"><a class="num" href="#"><div class="v">480 ₾</div><div class="l">моя касса сегодня</div></a>'
  '<a class="num" href="#"><div class="v">18</div><div class="l">в аренде</div></a><a class="num" href="#"><div class="v">9</div><div class="l">свободно</div></a></div>' +
  grp('Возвраты сегодня', '2') +
  q('Клиент Пример А', 'XL1200 ···4412 · план сегодня', '', prim('Принять возврат') + CALL) +
  q('Клиент Пример Ж', 'Eagle ···0917 · опаздывает 2 дня', '', prim('Принять возврат') + CALL + WA, 'warn') +
  grp('Просрочены', '4') +
  q('Клиент Пример Б', 'F-150 ···2231 · 15 дней', '300 ₾', prim('Принять наличные') + CALL + WA, 'crit') +
  grp('Ждут оплаты', '1') +
  q('Клиент Пример Е', 'Выдан сегодня в 12:40', '330 ₾', prim('Принять наличные')) +
  grp('Мопед без точки', '1') +
  q('B11 ···3390', 'Вернулся вчера · где стоит — не указано', '', sec('Указать точку')) +
  grp('Касса', '') +
  q('Сдать наличные владельцу', '5 платежей сегодня', '480 ₾', sec('Сдал')))
f1 = phone('<b>Менеджер, телефон.</b> Своя очередь: возвраты, просрочка (только наличные), ждут оплаты, мопед без точки, касса. Нет себестоимости, залогов на руках и денег недели. Панель: Сегодня · Аренды · ＋ · Парк · Касса.',
  head('Сегодня', initial='М'), m_body, tabbar('manager', 'today', 6))

sheet_m = ('<div class="sheet-scrim"></div><div class="sheet"><div class="grab"></div><h4>Что сделать</h4><div class="act-list">'
  f'<a href="#"><span class="ico">{ic("send")}</span>Выдать мопед</a>'
  f'<a href="#"><span class="ico">{ic("return")}</span>Принять возврат</a>'
  f'<a href="#"><span class="ico">{ic("cash")}</span>Принять наличные</a>'
  f'<a href="#"><span class="ico">{ic("user")}</span>Новый клиент</a>'
  f'<a href="#"><span class="ico">{ic("wrench")}</span>Сообщить о поломке</a>'
  '</div></div>')
f2 = phone('<b>«＋» у менеджера.</b> Лист снизу — только действия роли. Закрывается свайпом вниз, крестиком или нажатием мимо.',
  head('Сегодня', initial='М'), m_body, tabbar('manager', 'today', 6), overlay=sheet_m)

sheet_o = ('<div class="sheet-scrim"></div><div class="sheet"><div class="grab"></div><h4>Что сделать</h4><div class="act-list">'
  f'<a href="#"><span class="ico">{ic("send")}</span>Выдать мопед</a>'
  f'<a href="#"><span class="ico">{ic("return")}</span>Принять возврат</a>'
  f'<a href="#"><span class="ico">{ic("money")}</span>Принять деньги</a>'
  f'<a href="#"><span class="ico">{ic("user")}</span>Новый клиент</a>'
  f'<a href="#"><span class="ico">{ic("wrench")}</span>Открыть ремонт</a>'
  f'<a href="#"><span class="ico">{ic("bag")}</span>Продать мопед</a>'
  '</div></div>')
f3 = phone('<b>«＋» у владельца.</b> Шесть действий; «Принять деньги» открывает одну форму денег (приход и расход, любое основание).',
  head('Сегодня'), '<div class="date">Четверг, 17 сентября</div>', tabbar('owner', 'today', 14), overlay=sheet_o)

search_body = ('<div class="input focus" style="margin-bottom:14px">' + ic('search','i s') + '4412<span class="ph" style="margin-left:auto">✕</span></div>'
  + grp('Мопеды', '1') +
  f'<a class="lcard" href="#"><div><div class="a">XL1200 · чёрный</div><div class="b">{vin("4412")}</div></div><div class="r">{st("rented","В аренде")}<div class="b">Клиент Пример А</div></div></a>'
  + grp('Клиенты', '1') +
  '<a class="lcard" href="#"><div><div class="a">Клиент Пример Н</div><div class="b">+995 5·· ·· <b>44 12</b></div></div><div class="r b">нет долга</div></a>'
  + grp('Аренды', '1') +
  '<a class="lcard" href="#"><div><div class="a">R-00497 · Клиент Пример А</div><div class="b">XL1200 ···4412 · оплачено по 22.09</div></div><div class="r">' + st('active','Действует') + '</div></a>'
  + grp('Платежи', '1') +
  '<a class="lcard" href="#"><div><div class="a">+150,00 ₾ · наличные</div><div class="b">14.09 · R-00497</div></div></a>')
f4 = phone('<b>Поиск.</b> Значок в шапке открывает поиск на весь экран. «4412» находит мопед по последним знакам VIN, клиента по цифрам телефона, аренду и платёж — группами. Телефон клиента виден, только если роль его видит.',
  head('Поиск', left='back', right=''), search_body, '', body_cls='no-tabs')

search_empty = ('<div class="input focus" style="margin-bottom:14px">' + ic('search','i s') + '9981</div>'
  f'<div class="empty"><div class="big">{ic("search")}</div><h4>Ничего по «9981»</h4><p>Ищем по 4 последним знакам VIN, имени, телефону и номеру записи.</p><a class="btn" href="#">Новый клиент с номером …9981</a></div>'
  + grp('Недавно открытые', '') +
  '<a class="lcard" href="#"><div><div class="a">R-00512 · Клиент Пример Д</div><div class="b">вчера</div></div></a>')
f5 = phone('<b>Поиск — пусто.</b> Подсказка, где ищем, и действие: новый клиент с этим номером. Ниже — недавно открытые (хранятся на телефоне).',
  head('Поиск', left='back', right=''), search_empty, '', body_cls='no-tabs')

avatar_sheet = ('<div class="sheet-scrim"></div><div class="sheet"><div class="grab"></div>'
  '<div style="display:flex;gap:12px;align-items:center;margin:4px 0 14px"><span class="avatar" style="width:44px;height:44px">K</span><div><div class="q-who">Kardu</div><div class="q-why">владелец</div></div></div>'
  '<div class="field"><span class="lbl">Язык интерфейса</span><div class="lang-row"><span class="on">ქარ</span><span>RU</span><span>EN</span></div><div class="hint">Запоминается за вами на всех устройствах</div></div>'
  '<div class="act-list">'
  f'<a href="#"><span class="ico">{ic("user")}</span>Клиенты</a>'
  f'<a href="#"><span class="ico">{ic("wrench")}</span>Сервис и склад</a>'
  f'<a href="#"><span class="ico">{ic("bag")}</span>Продажи</a>'
  f'<a href="#"><span class="ico">{ic("truck")}</span>Закупки</a>'
  f'<a href="#"><span class="ico">{ic("chart")}</span>Отчёты</a>'
  f'<a href="#"><span class="ico">{ic("gear")}</span>Настройки · Мой вход</a>'
  f'<a href="#" style="color:var(--crit-ink)"><span class="ico" style="background:var(--crit-soft);color:var(--crit-ink)">{ic("lock")}</span>Выйти</a>'
  '</div></div>')
f6 = phone('<b>Меню аватара, владелец.</b> Язык ka / ru / en — переключает каждый сам (решение Mika 17.09.2026). Разделы, которых нет на панели, и «Выйти» последним.',
  head('Сегодня'), '<div class="date">Четверг, 17 сентября</div>', tabbar('owner', 'today', 14), overlay=avatar_sheet)

logout_off = ('<div class="sheet-scrim"></div><div class="sheet"><div class="grab"></div>'
  f'<div class="banner warn">{ic("cloud","i s")}<div><b>Нет связи с сервером.</b> Телефон забыл вход, но сессия на сервере закроется только при связи. Попросите владельца завершить её в «Настройки → Люди».</div></div>'
  '<a class="btn btn-primary btn-lg" href="#" style="width:100%">Понятно</a></div>')
f7 = phone('<b>Выход без связи</b> (QA-1-01). Честно говорим, что сессия на сервере осталась, и что делать.',
  head('Вход', right=''), '<div class="empty"><h4>EV8 Ops</h4><p>Войдите своей почтой и паролем.</p></div>', '', overlay=logout_off, body_cls='no-tabs')

# desktop search palette
d_main = ('<div class="d-head"><h2>Сегодня</h2><span class="sub">четверг, 17 сентября</span></div><div class="d-body" style="opacity:.35">'
  + grp('Просрочены', '4') + q('Клиент Пример Б', 'F-150 ···2231 · 15 дней', '300 ₾', prim('Принять оплату'), 'crit') + '</div>')
palette = ('<div style="position:absolute;inset:0;background:var(--scrim-soft)"></div>'
  '<div style="position:absolute;top:60px;left:50%;transform:translateX(-50%);width:640px;background:#fff;border-radius:16px;box-shadow:var(--shadow);padding:14px">'
  '<div class="input focus" style="margin-bottom:10px">' + ic('search','i s') + 'пример а</div>'
  '<table class="table"><tr><th colspan="3">Клиенты</th></tr>'
  '<tr class="sel"><td><b>Клиент Пример А</b></td><td>+995 5·· ·· 12 34</td><td class="r">нет долга</td></tr>'
  '<tr><th colspan="3">Аренды</th></tr>'
  f'<tr><td>R-00497</td><td>XL1200 ···4412</td><td class="r">{st("active","Действует")}</td></tr>'
  '<tr><th colspan="3">Продажи</th></tr><tr><td>SL-00171</td><td>Клиент Пример А2</td><td class="r">рассрочка 3/9</td></tr>'
  '</table><div class="small muted" style="margin-top:8px">↑↓ выбрать · Enter открыть · Esc закрыть</div></div>')
d = desk('<b>Поиск на ноутбуке.</b> «/» из любого места открывает поиск поверх страницы; стрелки и Enter без мыши. Имя ищется в любом написании (латиница и грузинский).',
  rail('today', 'owner', 16), d_main, palette)

notes = ('<h2>Что закрывает</h2><table><tr><th>ID</th><th>Как</th></tr>'
 '<tr><td>B1-05, T8, D3</td><td>Панель по роли и «＋» с действиями роли</td></tr>'
 '<tr><td>B6-05, T6, ux №8</td><td>Глобальный поиск на телефоне и ноутбуке</td></tr>'
 '<tr><td>B1-01, QA-1-01</td><td>«Выйти» в меню аватара; выход без связи сообщает правду</td></tr>'
 '<tr><td>В3</td><td>Касса менеджера: «Сдал» → у владельца «Принять кассу»</td></tr>'
 '<tr><td>В7</td><td>Язык ka / ru / en в меню аватара</td></tr></table>')

page('03-manager-plus-search.html', '«Сегодня» менеджера, «＋», поиск, меню',
 'Как менеджер начинает смену, где живут действия и как найти любую запись за два нажатия.',
 [('Экраны', '«Сегодня» менеджера, лист «＋», поиск, меню аватара'), ('Схема', 'blueprint §2.2, §2.3; D3, D9; принципы №3, №8, №12'), ('Данные', 'Пример')],
 [('Менеджер и «＋»', f1 + f2 + f3), ('Поиск и меню', f4 + f5 + f6 + f7), ('Ноутбук', d)], notes)
print('ok')
