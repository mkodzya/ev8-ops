from proto_base import *
from p_today import grp, prim, sec, CALL, WA

def rcard(num, who, veh, paid, right, pill, tone=''):
    return (f'<a class="lcard" href="#" style="{tone}"><div><div class="a">{who}</div><div class="b">{num} · {veh}</div><div class="b">{paid}</div></div>'
            f'<div class="r">{right}<div style="margin-top:6px">{pill}</div></div></a>')

segs = '<div class="chips"><span class="chip">Действуют <span class=n>18</span></span><span class="chip on">Просрочены <span class=n>4</span></span><span class="chip">Ждут оплаты <span class=n>1</span></span><span class="chip">Возврат сегодня <span class=n>2</span></span><span class="chip">Без VIN <span class=n>2</span></span><span class="chip">Спорные <span class=n>0</span></span><span class="chip">Завершены <span class=n>25</span></span></div>'
toolbar = ('<div style="display:flex;gap:8px;margin-bottom:10px"><div class="input" style="flex:1">' + ic('search','i s') + '<span class="ph">№, имя, телефон, 4 знака VIN</span></div>'
           '<a class="btn btn-round" href="#" aria-label="Сортировка">' + ic('sort') + '</a></div>')
listbody = (toolbar + segs +
  '<div class="date">4 аренды · долг 750 ₾ · сначала дольше всех</div>' +
  rcard('R-00488', 'Клиент Пример Б', 'F-150 ···2231', 'оплачено по 02.09', '<div class="money crit" style="font-size:16px">300 ₾</div>', '<span class="st st-overdue"><i class="mk"></i>15 дней</span>') +
  rcard('R-00491', 'Клиент Пример В', 'XL1200 ···1180', 'оплачено по 11.09', '<div class="money crit" style="font-size:16px">150 ₾</div>', '<span class="st st-overdue"><i class="mk"></i>6 дней</span>') +
  rcard('R-00503', 'Клиент Пример Г', 'Eagle ···5530', 'оплачено по 15.09', '<div class="money crit" style="font-size:16px">150 ₾</div>', '<span class="st st-overdue"><i class="mk"></i>2 дня</span>') +
  rcard('R-00509', 'კლიენტი მაგალითი ხარაზიშვილი-ჯაფარიძე', 'B11 ···3390', 'оплачено по 16.09', '<div class="money crit" style="font-size:16px">150 ₾</div>', '<span class="st st-overdue"><i class="mk"></i>1 день</span>'))
l1 = phone('<b>Аренды — телефон.</b> Поиск по номеру, имени, телефону и 4 знакам VIN; сегменты со счётчиками; сортировка кнопкой. Сегмент, поиск и сортировка — в адресе (<code>/rentals?seg=overdue</code>), поэтому строка «Сегодня» ведёт прямо сюда. Длинное грузинское имя переносится, сумма не съезжает.',
  head('Аренды', sub='43'), listbody, tabbar('owner', 'rentals', 14))

sortsheet = ('<div class="sheet-scrim"></div><div class="sheet"><div class="grab"></div><h4>Сортировка</h4><div class="act-list">'
  '<a href="#"><span class="ico">' + ic('check') + '</span>Дольше всех просрочены</a><a href="#"><span class="ico" style="background:none"></span>Больше долг</a>'
  '<a href="#"><span class="ico" style="background:none"></span>Скоро оплата</a><a href="#"><span class="ico" style="background:none"></span>Новые выдачи</a><a href="#"><span class="ico" style="background:none"></span>Имя А → Я</a></div></div>')
l2 = phone('<b>Сортировка на телефоне</b> — выбором в листе, а не заголовками (U17 только на ноутбуке).', head('Аренды', sub='43'), listbody, tabbar('owner', 'rentals', 14), overlay=sortsheet)

l3 = phone('<b>Пустой сегмент.</b> Говорит, что пусто именно здесь, и ведёт туда, где есть работа.',
  head('Аренды', sub='43'),
  toolbar + segs.replace('<span class="chip on">Просрочены <span class=n>4</span></span>', '<span class="chip">Просрочены <span class=n>4</span></span>').replace('<span class="chip">Спорные <span class=n>0</span></span>', '<span class="chip on">Спорные <span class=n>0</span></span>') +
  f'<div class="empty"><div class="big">{ic("check")}</div><h4>Спорных аренд нет</h4><p>Спорная аренда останавливает недели; история сохраняется.</p><a class="btn" href="#">Все действующие · 18</a></div>',
  tabbar('owner', 'rentals', 14))

l4 = phone('<b>Поиск в списке ничего не нашёл</b> — предлагает искать везде (глобальный поиск) и снять сегмент.',
  head('Аренды', sub='43'),
  '<div style="display:flex;gap:8px;margin-bottom:10px"><div class="input focus" style="flex:1">' + ic('search','i s') + '7781</div><a class="btn btn-round" href="#">' + ic('sort') + '</a></div>' + segs +
  f'<div class="empty"><div class="big">{ic("search")}</div><h4>В «Просрочены» нет «7781»</h4><p>Может быть, аренда в другом сегменте или это продажа.</p><a class="btn" href="#">Искать везде</a></div>',
  tabbar('owner', 'rentals', 14))

drows = ''.join(f'<tr><td class="mono">{n}</td><td><b>{w}</b></td><td>{v}</td><td>{p}</td><td class="r money">{t}</td><td class="r money crit">{d}</td><td><span class="st st-overdue"><i class="mk"></i>{s}</span></td><td class="r"><a class="btn btn-sm btn-primary" href="#">Принять оплату</a></td></tr>'
  for n, w, v, p, t, d, s in [('R-00488','Клиент Пример Б','F-150 ···2231','02.09','150','300','15 дней'),('R-00491','Клиент Пример В','XL1200 ···1180','11.09','150','150','6 дней'),('R-00503','Клиент Пример Г','Eagle ···5530','15.09','150','150','2 дня'),('R-00509','Клиент Пример Ж','B11 ···3390','16.09','150','150','1 день')])
dl = ('<div class="d-head"><h2>Аренды</h2><span class="sub">43 аренды</span><div class="acts"><a class="btn btn-sm btn-primary" href="#">+ Выдать мопед</a></div></div>'
 '<div class="d-tabs"><a href="#">Действуют <span class="n">18</span></a><a class="on" href="#">Просрочены <span class="n">4</span></a><a href="#">Ждут оплаты <span class="n">1</span></a><a href="#">Возврат сегодня <span class="n">2</span></a><a href="#">Без VIN <span class="n">2</span></a><a href="#">Спорные <span class="n">0</span></a><a href="#">Завершены <span class="n">25</span></a></div>'
 '<div class="d-body"><div class="toolbar"><div class="input">' + ic('search','i s') + '<span class="ph">№, имя, телефон, 4 знака VIN</span></div><span class="small muted">4 аренды · долг 750 ₾</span></div>'
 '<table class="table"><tr><th>№</th><th>Клиент</th><th>Мопед</th><th>Оплачено по ↑</th><th class="r">Тариф</th><th class="r">Долг</th><th>Статус</th><th></th></tr>' + drows + '</table></div>')
d = desk('<b>Ноутбук.</b> Сегменты — вкладками, таблица сортируется заголовком (U17), главное действие строки — в строке.', rail('rentals', 'owner', 14), dl)

page('07-rentals-list.html', 'Список аренд: поиск и фильтры',
 'Образец для всех списков: поиск, сегменты со счётчиками, сортировка, карточки на телефоне и таблица на ноутбуке. Продажи, ремонты, склад и платежи строятся так же.',
 [('Экран', '«Аренды»'), ('Схема', 'blueprint §3.1 «Правила экранов»; D14; принципы №8, №10'), ('Данные', 'Пример')],
 [('Телефон', l1 + l2 + l3 + l4), ('Ноутбук', d)],
 '<h2>Что закрывает</h2><table><tr><th>ID</th><th>Как</th></tr><tr><td>B6-02, T3</td><td>Сегменты: Действуют · Ждут оплаты · Просрочены · Возврат сегодня · Без VIN · Спорные · Завершены; поиск; всё в адресе</td></tr><tr><td>B6-05, T7</td><td>Карточки на телефоне, сортировка выбором; этот образец — для продаж, закупок, сервиса, склада, клиентов</td></tr><tr><td>аудит §4.4</td><td>Одно слово на статус: «просрочена N дней» и в списке, и в карточке</td></tr></table>')

# ================= VEHICLE CARD =================
def axes(pool, state_pill, place):
    return (f'<div class="card"><dl class="kv"><dt>Парк</dt><dd>{pool}</dd><dt>Состояние</dt><dd>{state_pill}</dd><dt>Где стоит</dt><dd>{place}</dd></dl></div>')
vt = ('<ul class="tl">'
  '<li><div><b>Выдан</b> · R-00497 · Клиент Пример А<div class="when">02.09 · Менеджер Пример · пробег 1 234</div></div></li>'
  '<li><div><b>Вернулся из сервиса</b> · SV-00027 · тормоза<div class="when">28.08 · Kardu · шоурум</div></div></li>'
  '<li><div><b>Переведён в парк аренды</b> · «решили сдавать»<div class="when">12.08 · Mika</div></div></li>'
  '<li><div><b>Пришёл</b> · PO-DEMO01 · себестоимость 1 700,00 ₾ (пример)<div class="when">14.03.2025</div></div></li></ul>')
v1 = phone('<b>Мопед в аренде.</b> Шапка: модель, цвет, VIN с выделенными 4 знаками, пилюля. Три вопроса ADR-0005 — парк, состояние, точка. Текущая аренда с цифрой «оплачено по». Главное действие по состоянию — «Принять возврат». Лента событий внизу. Себестоимость и экономика — только владельцам.',
  head('XL1200 · чёрный', left='back', right='dots'),
  f'<div style="margin:2px 0 10px">{vin("4412")}</div>' +
  axes('Аренда', st('rented', 'В аренде'), 'у клиента') +
  '<div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><div><div class="small muted">Аренда R-00497</div><div class="q-who">Клиент Пример А</div></div>' + st('active', 'Действует') + '</div>'
  '<div class="hr"></div><div style="display:flex;justify-content:space-between;align-items:baseline"><div><div class="small muted">Оплачено по</div><div class="hero" style="font-size:24px">22.09</div></div><div style="text-align:right"><div class="small muted">Долг</div><div class="money" style="font-size:18px">нет</div></div></div>'
  f'<div style="display:flex;gap:8px;margin-top:10px">{CALL}{WA}<a class="btn" href="#" style="flex:1">Открыть аренду</a></div></div>' +
  '<div class="card"><div class="h3">Экономика · владельцам</div><dl class="kv"><dt>Себестоимость</dt><dd class="money">1 700,00 ₾</dd><dt>Выручка аренды</dt><dd class="money">3 150,00 ₾</dd><dt>Ремонты</dt><dd class="money">−210,00 ₾</dd><dt>Загрузка за 90 дней</dt><dd class="money">71 %</dd></dl></div>' +
  grp('История', '14 событий') + vt,
  tabbar('owner', 'fleet', 14), '<div class="action-bar"><a class="btn btn-primary btn-lg" href="#">Принять возврат</a></div>', body_cls='with-bar')

v2 = phone('<b>Мопед свободен.</b> Главное действие — «Выдать» (мастер откроется сразу с этим мопедом). Нет точки — это видно и исправляется в одно нажатие.',
  head('Eagle · белый', left='back', right='dots'),
  f'<div style="margin:2px 0 10px">{vin("4471")}</div>' +
  axes('Аренда', st('available', 'Свободен'), '<a class="ok" href="#">Указать точку ›</a>') +
  f'<div class="banner warn">{ic("pin","i s")}<div>Где стоит — не указано с 15.09. Точки ведёт владелец.</div></div>' +
  '<div class="card"><div class="h3">Простой</div><dl class="kv"><dt>Без движения</dt><dd>2 дня</dd><dt>Последняя аренда</dt><dd>R-00476 · до 15.09</dd></dl></div>' +
  grp('История', '9 событий') + '<ul class="tl"><li><div><b>Вернулся</b> · R-00476 · комплект в порядке<div class="when">15.09 · Менеджер Пример</div></div></li></ul>',
  tabbar('owner', 'fleet', 14), '<div class="action-bar"><a class="btn btn-primary btn-lg" href="#">Выдать</a></div>', body_cls='with-bar')

v3 = phone('<b>Мопед в сервисе, вид менеджера.</b> Ремонт видно, закрывает владелец. Экономики нет. Менеджер открывает ремонт только посмотреть.',
  head('F-150 · серый', left='back', right=''),
  f'<div style="margin:2px 0 10px">{vin("7705")}</div>' +
  axes('Аренда', st('service', 'В сервисе'), 'Мастерская') +
  '<div class="card"><div class="small muted">Ремонт SV-00031 · 9 дней</div><div class="q-who">Не заводится после дождя</div><div class="q-why">за счёт компании · 2 фото · запчасти: контроллер (нет на складе)</div></div>' +
  f'<div class="banner info">{ic("lock","i s")}<div>Ремонт ведёт владелец.</div></div>' +
  grp('История', '11 событий') + '<ul class="tl"><li><div><b>В сервис</b> · SV-00031<div class="when">08.09 · Kardu</div></div></li></ul>',
  tabbar('manager', 'fleet', 6), '<div class="action-bar"><a class="btn btn-lg" href="#">Открыть ремонт</a></div>', body_cls='with-bar')

dv = ('<div class="d-head"><h2>XL1200 · чёрный</h2><span class="sub">' + vin('4412') + '</span>' + st('rented', 'В аренде') + '<div class="acts"><a class="btn btn-sm" href="#">⋯</a><a class="btn btn-sm btn-primary" href="#">Принять возврат</a></div></div>'
 '<div class="d-body"><div class="cols" style="grid-template-columns:1fr 1fr 1fr">'
 '<div>' + axes('Аренда · <a class="ok" href="#">перевести</a>', st('rented', 'В аренде'), 'у клиента') + '<div class="card"><div class="h3">Паспорт</div><dl class="kv"><dt>Модель</dt><dd>XL1200 · Flybrother</dd><dt>Цвет</dt><dd>შავი / Black</dd><dt>Пробег</dt><dd>1 234 км на 02.09</dd><dt>Пришёл</dt><dd>PO-DEMO01 · 14.03.2025</dd></dl></div></div>'
 '<div><div class="card"><div class="small muted">Аренда R-00497</div><div class="q-who">Клиент Пример А</div><div class="hr"></div><dl class="kv"><dt>Оплачено по</dt><dd><b>22.09</b></dd><dt>Долг</dt><dd>нет</dd><dt>Тариф</dt><dd class="money">150,00 ₾</dd><dt>Залог получен</dt><dd class="money">180,00 ₾</dd></dl></div>'
 '<div class="card"><div class="h3">Экономика</div><dl class="kv"><dt>Себестоимость</dt><dd class="money">1 700,00</dd><dt>Выручка аренды</dt><dd class="money">3 150,00</dd><dt>Ремонты</dt><dd class="money">−210,00</dd><dt>Загрузка 90 дней</dt><dd class="money">71 %</dd></dl></div></div>'
 '<div class="card"><div class="h3">История · 14</div>' + vt + '</div>'
 '</div></div>')
d2 = desk('<b>Ноутбук.</b> Три колонки: оси и паспорт, текущая аренда и экономика, лента событий.', rail('fleet', 'owner', 14), dv)

page('08-vehicle.html', 'Карточка мопеда',
 'Мопед отвечает на три вопроса — парк, состояние, где стоит — и показывает одно главное действие по состоянию.',
 [('Экран', 'Карточка мопеда'), ('Схема', 'ADR-0005; blueprint §3.1 «Карточка записи»; принципы №3, №9'), ('Правила', '<code>fleet.md</code>: состояние выводится из событий; цвет на двух языках'), ('Данные', 'Пример; мопед и суммы выдуманные')],
 [('Телефон', v1 + v2 + v3), ('Ноутбук', d2)],
 '<h2>Что закрывает</h2><table><tr><th>ID</th><th>Как</th></tr><tr><td>B7-05, S7</td><td>Ручная смена состояния — в меню «⋯», только владелец и с причиной; «продан» и «списан» руками недоступны менеджеру</td></tr><tr><td>R8</td><td>«Где стоит — не указано» видно и исправляется</td></tr><tr><td>B10-01</td><td>Загрузка мопеда за 90 дней</td></tr><tr><td>ux №7</td><td>Лента событий вместо вкладок</td></tr></table>')

# ================= RENTAL + CUSTOMER =================
strip = '<div class="strip"><i class="s-paid">1</i><i class="s-paid">2</i><i class="s-late">3</i><i class="s-late">4</i><i class="s-cur">5</i><i class="s-ahead">6</i></div><div style="display:flex;justify-content:space-between;margin-top:4px" class="small muted"><span>20.08</span><span>сегодня</span><span>30.09</span></div>'
rc1 = phone('<b>Карточка аренды, просрочена.</b> Сверху — одна цифра: оплачено по и долг. Полоса недель: оплачена / просрочена / текущая. Главное действие по состоянию — «Принять оплату» в липкой полосе (раньше было в самом низу).',
  head('R-00488', left='back', right='dots'),
  '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><div><div class="q-who">Клиент Пример Б</div><div class="q-why">F-150 ···2231 · выдан 20.08</div></div>' + st('overdue', '15 дней') + '</div>'
  '<div class="card"><div style="display:flex;justify-content:space-between;align-items:baseline"><div><div class="small muted">Оплачено по</div><div class="hero">02.09</div></div><div style="text-align:right"><div class="small muted">Долг</div><div class="hero crit">300 ₾</div></div></div><div class="hr"></div>' + strip + '</div>'
  f'<div style="display:flex;gap:8px;margin:0 0 8px">{CALL}{WA}<a class="btn" href="#" style="flex:1">Клиент</a></div>'
  '<div class="card"><div class="h3">Условия</div><dl class="kv"><dt>Тариф</dt><dd class="money">150,00 ₾/нед</dd><dt>Залог</dt><dd class="money">180,00 · получен</dd><dt>Ночёвка</dt><dd>ул. Пример, 7</dd><dt>Комплект</dt><dd>2 батареи · 2 зарядки</dd><dt>Плановый возврат</dt><dd>—</dd></dl></div>'
  '<div class="card"><div class="h3">Документы</div><div class="small">Договор · акт выдачи — PDF ka / en ›</div></div>' +
  grp('История', '') + '<ul class="tl"><li><div><b>Оплата 150 ₾</b> · перевод TBC · неделя 2<div class="when">28.08 · из выписки, привязал Kardu</div></div></li><li><div><b>Выдан</b><div class="when">20.08 · Менеджер Пример</div></div></li></ul>',
  tabbar('owner', 'rentals', 14),
  '<div class="action-bar"><a class="btn" href="#">Возврат</a><a class="btn btn-primary btn-lg" href="#">Принять оплату</a></div>', body_cls='with-bar')

cc1 = phone('<b>Карточка клиента.</b> Первая строка — одна цифра долга, та же, что в аренде и «Сегодня» (D6): просроченное по арендам + просроченные взносы + неоплаченный ремонт. Из чего сложена — раскрывается. Все аренды и продажи клиента списком. Документы — только владельцам, открытие пишется в журнал.',
  head('Клиент Пример Б', left='back', right='dots'),
  '<div class="card"><div class="small muted">Должен</div><div class="hero crit">300 ₾</div>'
  '<details style="margin-top:6px"><summary class="small ok" style="cursor:pointer">Из чего сложено</summary><dl class="kv" style="margin-top:8px"><dt>R-00488 · 2 недели просрочки</dt><dd class="money">300,00</dd><dt>Залоги на руках (не долг)</dt><dd class="money muted">180,00</dd></dl></details></div>'
  f'<div style="display:flex;gap:8px;margin:0 0 8px">{CALL}{WA}<a class="btn btn-primary" href="#" style="flex:1">Принять оплату</a></div>'
  '<div class="card"><dl class="kv"><dt>Телефон</dt><dd class="mono">+995 5·· ·· 22 31</dd><dt>Личный номер</dt><dd>•••• 2231 · показать</dd><dt>Второе написание</dt><dd>კლიენტი მაგალითი ბ</dd><dt>Kommo</dt><dd><a class="ok" href="#">сделка ›</a></dd></dl></div>' +
  grp('Аренды и продажи', '2') +
  '<a class="lcard" href="#"><div><div class="a">R-00488 · F-150 ···2231</div><div class="b">с 20.08 · оплачено по 02.09</div></div><div class="r">' + st('overdue', '15 дней') + '</div></a>'
  '<a class="lcard" href="#"><div><div class="a">R-00301 · Eagle ···0917</div><div class="b">05.05–26.05 · залог возвращён</div></div><div class="r">' + st('returned', 'Возвращена') + '</div></a>' +
  grp('Документы', 'владельцам') + '<div class="photos"><div class="photo">удост.</div><div class="photo">права</div><div class="photo add">' + ic('camera') + '</div></div>',
  tabbar('owner', 'rentals', 14))

cc2 = phone('<b>Тот же клиент глазами менеджера.</b> Долг и телефон видны (звонить нужно), личный номер и документы — нет; «Решит владелец» не показывается, раз действий нет.',
  head('Клиент Пример Б', left='back', right=''),
  '<div class="card"><div class="small muted">Должен</div><div class="hero crit">300 ₾</div></div>'
  f'<div style="display:flex;gap:8px;margin:0 0 8px">{CALL}{WA}<a class="btn btn-primary" href="#" style="flex:1">Принять наличные</a></div>'
  '<div class="card"><dl class="kv"><dt>Телефон</dt><dd class="mono">+995 5·· ·· 22 31</dd><dt>Второе написание</dt><dd>კლიენტი მაგალითი ბ</dd></dl></div>' +
  grp('Аренды', '2') + '<a class="lcard" href="#"><div><div class="a">R-00488 · F-150 ···2231</div><div class="b">оплачено по 02.09</div></div><div class="r">' + st('overdue', '15 дней') + '</div></a>',
  tabbar('manager', 'rentals', 6))

dr = ('<div class="d-head"><h2>R-00488</h2><span class="sub">Клиент Пример Б · F-150 ···2231</span>' + st('overdue', 'просрочена 15 дней') + '<div class="acts"><a class="btn btn-sm" href="#">⋯</a><a class="btn btn-sm" href="#">Возврат</a><a class="btn btn-sm btn-primary" href="#">Принять оплату</a></div></div>'
 '<div class="d-body"><div class="cols" style="grid-template-columns:1.3fr 1fr">'
 '<div><div class="card" style="padding:20px"><div style="display:flex;gap:48px"><div><div class="small muted">Оплачено по</div><div class="hero">02.09</div></div><div><div class="small muted">Долг</div><div class="hero crit">300 ₾</div></div><div><div class="small muted">Залог получен</div><div class="hero">180 ₾</div></div></div><div class="hr"></div>' + strip + '</div>'
 '<table class="table"><tr><th>Неделя</th><th>Период</th><th class="r">Сумма</th><th class="r">Оплачено</th><th>Статус</th></tr>'
 '<tr><td>5</td><td>17.09–23.09</td><td class="r money">150,00</td><td class="r money">0,00</td><td>текущая</td></tr>'
 '<tr><td>4</td><td>10.09–16.09</td><td class="r money">150,00</td><td class="r money">0,00</td><td class="crit">просрочена</td></tr>'
 '<tr><td>3</td><td>03.09–09.09</td><td class="r money">150,00</td><td class="r money">0,00</td><td class="crit">просрочена</td></tr>'
 '<tr><td>2</td><td>27.08–02.09</td><td class="r money">150,00</td><td class="r money">150,00</td><td class="ok">оплачена</td></tr></table></div>'
 '<div><div class="card"><div class="h3">Условия</div><dl class="kv"><dt>Тариф</dt><dd class="money">150,00 ₾/нед</dd><dt>Ночёвка</dt><dd>ул. Пример, 7</dd><dt>Комплект</dt><dd>2 + 2</dd><dt>Плановый возврат</dt><dd>—</dd></dl></div>'
 '<div class="card"><div class="h3">История</div><ul class="tl"><li><div><b>Оплата 150 ₾</b> · перевод TBC<div class="when">28.08 · привязал Kardu</div></div></li><li><div><b>Выдан</b><div class="when">20.08 · Менеджер Пример</div></div></li></ul></div></div>'
 '</div></div>')
d3 = desk('<b>Ноутбук.</b> Цифры сверху, недели таблицей, условия и лента справа. Главное действие по состоянию — в шапке справа.', rail('rentals', 'owner', 14), dr)

page('09-rental-customer.html', 'Карточки аренды и клиента',
 'Одна цифра долга везде; главное действие по состоянию; что видит владелец и что — менеджер.',
 [('Экраны', 'Карточка аренды, карточка клиента'), ('Схема', 'D6; blueprint §3.1 «Карточка записи»; принципы №5, №10'), ('Правила', '<code>rental.md</code>: «оплачено по», просрочка; документы клиента видят только владельцы (CST-03)'), ('Данные', 'Пример')],
 [('Аренда', rc1), ('Клиент: владелец и менеджер', cc1 + cc2), ('Ноутбук', d3)],
 '<h2>Что закрывает</h2><table><tr><th>ID</th><th>Как</th></tr><tr><td>B7-02, M16</td><td>Одна цифра долга, раскрывается «из чего сложено»; залоги — не долг</td></tr><tr><td>B7-04</td><td>Карточка клиента: долг, аренды и продажи, документы, второе написание, Kommo</td></tr><tr><td>аудит §4.2</td><td>«Принять оплату» — главное у просроченной, «Возврат» один раз</td></tr><tr><td>B10-03</td><td>Ссылка Kommo у клиента</td></tr><tr><td>Q21</td><td>Долг = просроченное (умолчание ТЗ), а не весь будущий остаток</td></tr></table>')
print('ok records')
