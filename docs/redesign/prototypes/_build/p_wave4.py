from proto_base import *
from p_today import q, grp, prim, sec, CALL, WA, NUMS
from p_wave1 import stabs, lc, money, fld, sheet_form
import proto_base
proto_base.WAVE1 = False

def nums(items):
    return '<div class="nums">' + ''.join(f'<a class="num" href="#"><div class="v {c}">{v}</div><div class="l">{l}</div></a>' for v, l, c in items) + '</div>'
ON = nums([('18','в аренде',''),('9','свободно',''),('6','в сервисе',''),('900 ₾','просрочка','crit'),('3 240 ₾','залоги на руках',''),('1 980 ₾','за неделю',''),('7 из 42','батарей в шоуруме','')])
one_more = lambda t: f'<a class="q-more" href="#">{t}</a>'

# ================= TODAY =================
owner_q = ('<div class="date">Пятница, 18 сентября</div>' + ON +
  grp('Решить', '2') +
  q('Залог · Клиент Пример Д', 'R-00512 · вернул сегодня · оформил Менеджер Пример', '180 ₾', prim('Решить залог'), 'decide') +
  q('Касса · Менеджер Пример', 'Сдал наличные 17:40', '480 ₾', prim('Принять кассу'), 'decide') +
  grp('Возвраты', '2') +
  q('Клиент Пример А', 'R-00497 · XL1200 ···4412 · план сегодня', '', prim('Принять возврат') + CALL) +
  q('Клиент Пример Ж', 'R-00476 · Eagle ···0917 · опаздывает 2 дня', '', prim('Принять возврат') + CALL + WA, 'warn') +
  grp('Просрочены', '4 · сначала дольше всех') +
  q('Клиент Пример Б', 'R-00488 · F-150 ···2231 · 16 дней', '450 ₾', prim('Принять оплату') + CALL + WA, 'crit') +
  q('Клиент Пример В', 'R-00491 · XL1200 ···1180 · 7 дней', '150 ₾', prim('Принять оплату') + CALL + WA, 'crit') +
  one_more('Ещё 2 · 300 ₾ — все просроченные') +
  grp('Ждут первой оплаты', '1') +
  q('Клиент Пример Е', 'R-00520 · выдан сегодня 12:40', '330 ₾', prim('Принять оплату') + CALL) +
  grp('Деньги', '2') +
  q('5 строк выписки не разобраны', 'BOG — 3 дня назад · TBC — сегодня', '1 040 ₾', prim('Разобрать')) +
  grp('Рассрочки', '1') +
  q('Клиент Пример О', 'SL-00169 · взнос от 01.09', '1 396 ₾', prim('Принять взнос') + CALL + WA, 'crit') +
  grp('Сервис', '1') +
  q('10 мопедов в ремонте', '9 дольше 7 дней · самый долгий 31 день', '', sec('Открыть ремонты'), 'warn') +
  grp('Дозаполнить', '3') +
  q('Договор R-00519 не подписан', 'Выдан вчера 16:05', '', sec('Подписать')) +
  q('2 аренды без VIN · 1 мопед без точки', '', '', sec('Дозаполнить')))
t1 = phone('<b>Владелец, телефон.</b> Очередь — одна функция в <code>shared</code> для экрана и бейджа (план сборки). Группы по порядку §3.1 <code>wave-4.md</code>; в группе до 3 строк и «Ещё N» → отфильтрованный список. Цифры — строкой прокрутки, каждая ведёт в список. Загрузка парка добавится в волне 6.',
  head('Сегодня'), owner_q, tabbar('owner', 'today', 14))

ka_q = ('<div class="date">პარასკევი, 18 სექტემბერი</div>' +
  nums([('18','ქირაშია',''),('9','თავისუფალი',''),('900 ₾','ვადაგადაცილება','crit'),('7 / 42','ბატარეა შოურუმში','')]) +
  grp('გადასაწყვეტი', '2') +
  q('დეპოზიტი · კლიენტი მაგალითი დ', 'R-00512 · დაბრუნდა დღეს · გააფორმა მენეჯერმა', '180 ₾', prim('დეპოზიტის გადაწყვეტა'), 'decide') +
  grp('ვადაგადაცილებული', '4') +
  q('ნინო მაგალითი-ხარაზიშვილი', 'R-00509 · B11 ···3390 · 2 დღე', '150 ₾', prim('გადახდის მიღება') + CALL + WA, 'crit') +
  grp('პირველი გადახდის მოლოდინში', '1') +
  q('კლიენტი მაგალითი ე', 'R-00520 · გაიცა დღეს 12:40', '330 ₾', prim('გადახდის მიღება')))
t2 = phone('<b>То же на грузинском.</b> Длинное имя и кнопки в строке. Новые слова («პირველი გადახდის მოლოდინში», «გადახდის მიღება», «ბატარეა შოურუმში») — предложение, вычитать (register #15).',
  head('დღეს'), ka_q, tabbar('owner_ka', 'today', 14))

mgr_q = ('<div class="date">Пятница, 18 сентября</div>' +
  nums([('480 ₾','моя касса сегодня',''),('18','в аренде',''),('9','свободно',''),('7','батарей в шоуруме','')]) +
  grp('Возвраты', '2') + q('Клиент Пример А', 'R-00497 · XL1200 ···4412 · план сегодня', '', prim('Принять возврат') + CALL) +
  grp('Просрочены', '4') + q('Клиент Пример Б', 'R-00488 · F-150 ···2231 · 16 дней', '450 ₾', prim('Принять наличные') + CALL + WA, 'crit') +
  grp('Ждут первой оплаты', '1') + q('Клиент Пример Е', 'R-00520 · выдан сегодня', '330 ₾', prim('Принять наличные')) +
  grp('Дозаполнить', '2') + q('Договор R-00519 не подписан', 'Выдан вчера', '', sec('Подписать')) + q('B11 ···3390 — где стоит?', 'Вернулся вчера', '', sec('Указать точку')) +
  grp('Касса', '') + q('Сдать наличные владельцу', '5 платежей сегодня', '480 ₾', sec('Сдал')))
t3 = phone('<b>Менеджер.</b> Свои группы: возвраты, просрочка (наличные), ждут первой оплаты, дозаполнить, касса. Без залогов на руках, денег недели, закупок и себестоимости.',
  head('Сегодня', initial='М'), mgr_q, tabbar('manager', 'today', 6))

wa = sheet_form('WhatsApp · Клиент Пример Б',
  '<div class="field"><span class="lbl">Шаблон</span><div class="seg3" style="grid-template-columns:1fr 1fr"><span class="on">Просрочка</span><span>Завтра оплата</span></div></div>'
  '<div class="field"><span class="lbl">Язык сообщения</span><div class="lang-row"><span class="on">ქარ</span><span>RU</span><span>EN</span></div></div>'
  '<div class="card" style="background:#e7f6e3;font:var(--text-body-sm)">გამარჯობა, კლიენტი მაგალითი ბ! წერს EV8. ქირაობა R-00488: გადახდილია 02.09-მდე, დავალიანება 450 ₾. გადახდა შეგიძლიათ შოურუმში (ნუცუბიძე 65) ან გადარიცხვით. კითხვები: +995 595 16 55 88</div>'
  '<div class="hint">Откроется WhatsApp с этим текстом; отправляете вы со своего телефона. Шаблоны утверждает Mika; когда будет токен Meta, те же шаблоны уйдут по расписанию.</div>',
  '<a class="btn btn-primary btn-lg" href="#" style="width:100%">' + ic('chat','i s') + 'Открыть WhatsApp</a>')
t4 = phone('<b>WhatsApp из строки</b> (решение Mika В6). Лист с готовым текстом на языке клиента: имя, номер аренды, «оплачено по», долг, телефон компании. Отправляет человек из своего WhatsApp — без API и без оплаты за сообщение. Тексты — на утверждение (§7).',
  head('Сегодня'), owner_q, tabbar('owner', 'today', 14), overlay=wa)
t5 = phone('<b>Пусто.</b> «На сегодня всё» и одно полезное действие; цифры остаются.',
  head('Сегодня'), '<div class="date">Воскресенье, 20 сентября</div>' + ON + f'<div class="empty"><div class="big">{ic("check")}</div><h4>На сегодня всё</h4><p>Просрочек, возвратов и неразобранных денег нет.</p><a class="btn" href="#">Загрузить выписку</a></div>', tabbar('owner', 'today'))
t6 = phone('<b>После действия.</b> «Принять оплату» в строке → форма денег (волна 2) → строка ушла, бейдж −1, «Отменить» 10 с.',
  head('Сегодня'), '<div class="date">Пятница, 18 сентября</div>' + grp('Просрочены', '3') + q('Клиент Пример В', 'R-00491 · 7 дней', '150 ₾', prim('Принять оплату') + CALL + WA, 'crit'),
  tabbar('owner', 'today', 13), overlay=f'<div class="toast">{ic("check","i s")}Записано 450 ₾ · Пример Б<a href="#">Отменить</a><span class="drain"></span></div>')

def drow(who, why, s, acts, tone=''):
    t = ' '.join('t-' + x for x in tone.split())
    return (f'<div class="qrow {t}" style="grid-template-columns:1fr 120px auto;align-items:center"><div><div class="q-who">{who}</div><div class="q-why">{why}</div></div>'
            f'<div class="q-sum" style="grid-row:auto;grid-column:auto">{s}</div><div class="q-acts" style="grid-column:auto;margin:0">{acts}</div></div>')
dm = ('<div class="d-head"><h2>Сегодня</h2><span class="sub">пятница, 18 сентября · 16 дел</span></div><div class="d-body"><div class="cols" style="grid-template-columns:1fr 330px"><div>' +
  grp('Решить', '2') + drow('Залог · Клиент Пример Д', 'R-00512 · вернул сегодня · оформил Менеджер Пример', '180 ₾', prim('Решить залог'), 'decide') + drow('Касса · Менеджер Пример', 'Сдал 17:40', '480 ₾', prim('Принять'), 'decide') +
  grp('Деньги', '2') + drow('5 строк выписки не разобраны', 'BOG — 3 дня назад', '1 040 ₾', prim('Разобрать')) +
  grp('Закупки', '2') + drow('PO-00114 · Поставщик Пример 2', 'Принята 12.09 · оплачено 2 000 GEL из 4 720 CNY', '', sec('Открыть')) + drow('PO-00115 · Поставщик Пример', 'Ждёт первой оплаты', '', sec('Открыть')) +
  grp('Решения', '1') + drow('12 мопедов без парка', 'Аренда или продажа — не решено', '', sec('Решить парк')) +
  grp('Просрочены', '4') + drow('Клиент Пример Б', 'R-00488 · 16 дней', '450 ₾', prim('Принять оплату'), 'crit') +
  '</div><aside><div class="card"><div class="h3">Неделя с 14 сентября</div><dl class="kv">'
  '<dt>Поступило</dt><dd class="money">1 980,00 ₾</dd><dt style="padding-left:12px">аренда</dt><dd class="money">1 350,00</dd><dt style="padding-left:12px">продажи</dt><dd class="money">300,00</dd><dt style="padding-left:12px">залоги (не выручка)</dt><dd class="money">360,00</dd><dt style="padding-left:12px">комиссия эквайринга</dt><dd class="money">−29,70</dd>'
  '<dt>Просрочка</dt><dd class="money crit">900,00 ₾</dd><dt>Залоги на руках</dt><dd class="money">3 240,00 ₾</dd><dt>В аренде · свободно</dt><dd class="money">18 · 9</dd><dt>В ремонте</dt><dd class="money">10 · до 31 дня</dd>'
  '<dt>Батареи: шоурум · курьеры · ремонт</dt><dd class="money">7 · 34 · 1</dd><dt>Выдачи · возвраты</dt><dd class="money">3 · 2</dd><dt>Удержано из залогов</dt><dd class="money">130,00 ₾</dd></dl>'
  '<div class="small muted" style="margin-top:8px">Загрузка парка и «Отчёт недели» — волна 6</div></div></aside></div></div>')
t7 = desk('<b>Mika, ноутбук.</b> Та же очередь, раскладка шире: дела слева, неделя справа (<code>weekly.md</code>). Закупки и «мопеды без парка» — в очереди владельца на обоих устройствах; на телефоне они ниже.', rail('today', 'owner', 16), dm)

page('wave-4-today.html', 'Волна 4 · «Сегодня»',
 '«Сегодня» обеих ролей: очередь дел по правилам из одной функции, действие в строке, цифры недели, WhatsApp с готовым текстом.',
 [('Волна', '4 — «Сегодня» и карточки · <code>docs/redesign/wave-4.md</code> §3.1–3.2'), ('Схема', 'blueprint §2.3, D2, D15; утверждённый прототип <code>02-today-owner.html</code>'), ('Закрывает', 'B6-01, T1–T4, U1, U2'), ('Данные', 'Пример')],
 [('Телефон', t1 + t2 + t3 + t4 + t5 + t6), ('Ноутбук', t7)])

# ================= RENTALS + CARDS =================
segs = '<div class="chips"><span class="chip">Действуют <span class=n>18</span></span><span class="chip">Ждут оплаты <span class=n>1</span></span><span class="chip on">Просрочены <span class=n>4</span></span><span class="chip">Возврат · опаздывают <span class=n>2</span></span><span class="chip">Не подписан <span class=n>1</span></span><span class="chip">Без VIN <span class=n>2</span></span><span class="chip">Пауза · спорные <span class=n>0</span></span><span class="chip">Завершены <span class=n>25</span></span></div>'
toolbar = '<div style="display:flex;gap:8px;margin-bottom:10px"><div class="input" style="flex:1">' + ic('search','i s') + '<span class="ph">№, имя, телефон, 4 знака VIN</span></div><a class="btn btn-round" href="#">' + ic('sort') + '</a></div>'
def rc(num, who, veh, paid, right, pill):
    return f'<a class="lcard" href="#"><div><div class="a">{who}</div><div class="b">{num} · {veh}</div><div class="b">{paid}</div></div><div class="r">{right}<div style="margin-top:6px">{pill}</div></div></a>'
r1 = phone('<b>Аренды — сегменты.</b> Действуют · Ждут оплаты · Просрочены · Возврат и опаздывают · Не подписан · Без VIN · Пауза и спорные · Завершены — со счётчиками, в адресе (B6-02). Поиск: №, имя, телефон, 4 знака VIN. Основа — утверждённый <code>07-rentals-list.html</code>.',
  head('Аренды', sub='43'), toolbar + segs +
  '<div class="date">4 аренды · долг 900 ₾ · сначала дольше всех</div>' +
  rc('R-00488', 'Клиент Пример Б', 'F-150 ···2231', 'оплачено по 02.09', money('450 ₾', 'crit'), st('overdue', '16 дней')) +
  rc('R-00491', 'Клиент Пример В', 'XL1200 ···1180', 'оплачено по 11.09', money('150 ₾', 'crit'), st('overdue', '7 дней')) +
  rc('R-00509', 'ნინო მაგალითი-ხარაზიშვილი', 'B11 ···3390', 'оплачено по 16.09', money('150 ₾', 'crit'), st('overdue', '2 дня')),
  tabbar('owner', 'rentals', 14))

strip = '<div class="strip"><i class="s-paid">1</i><i class="s-paid">2</i><i class="s-late">3</i><i class="s-late">4</i><i class="s-cur">5</i><i class="s-ahead">6</i></div><div style="display:flex;justify-content:space-between;margin-top:4px" class="small muted"><span>20.08</span><span>сегодня</span><span>30.09</span></div>'
def rcard(title, top, hero, strip_html, blocks, bar, tab='rentals', badge=14, role='owner'):
    return phone(title, head(top[0], left='back', right='dots'),
      f'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><div><div class="q-who">{top[1]}</div><div class="q-why">{top[2]}</div></div>{top[3]}</div>' +
      f'<div class="card">{hero}{strip_html}</div>' + blocks, tabbar(role, tab, badge), f'<div class="action-bar">{bar}</div>', body_cls='with-bar')
hero2 = lambda a, av, b, bv, bc='': f'<div style="display:flex;justify-content:space-between;align-items:baseline"><div><div class="small muted">{a}</div><div class="hero">{av}</div></div><div style="text-align:right"><div class="small muted">{b}</div><div class="hero {bc}">{bv}</div></div></div>'
cond = '<div class="card"><div class="h3">Условия</div><dl class="kv"><dt>Тариф</dt><dd class="money">150,00 ₾/нед</dd><dt>Ночёвка</dt><dd>ул. Пример, 7</dd><dt>Комплект</dt><dd>2 батареи · 2 зарядки</dd><dt>Плановый возврат</dt><dd>—</dd></dl></div>'
dep = '<div class="card"><div class="h3">Залог</div><dl class="kv"><dt>Получено</dt><dd class="money">180,00</dd><dt>Удержано</dt><dd class="money">0,00</dd><dt>На руках</dt><dd class="money">180,00</dd></dl></div>'
docs_ok = '<div class="card"><div class="h3">Документы</div><dl class="kv"><dt>Договор</dt><dd>подписан 20.08 ›</dd><dt>Акт выдачи</dt><dd>подписан 20.08 ›</dd></dl></div>'
feed = ('<div class="grp"><h3>Лента</h3><span class="cnt">все ▾</span></div><ul class="tl"><li><div><b>WhatsApp: напоминание о долге</b><div class="when">сегодня 10:12 · Kardu</div></div></li>'
        '<li><div><b>Оплата 150 ₾</b> · перевод TBC · неделя 2<div class="when">28.08 · привязал Kardu</div></div></li><li><div><b>Выдан</b> · акт подписан<div class="when">20.08 · Менеджер Пример</div></div></li></ul>')
c1 = rcard('<b>Аренда просрочена.</b> Сверху — «оплачено по» и долг; полоса недель; залог строками; документы со статусом подписи; лента с фильтром. Главное действие по статусу — «Принять оплату»; «Возврат» — второй. Основа — утверждённый <code>09-rental-customer.html</code>.',
  ('R-00488', 'Клиент Пример Б', 'F-150 ···2231 · выдан 20.08', st('overdue', '16 дней')), hero2('Оплачено по', '02.09', 'Долг', '450 ₾', 'crit'), '<div class="hr"></div>' + strip,
  f'<div style="display:flex;gap:8px;margin:0 0 8px">{CALL}{WA}<a class="btn" href="#" style="flex:1">Клиент</a></div>' + dep + cond + docs_ok + feed,
  '<a class="btn" href="#">Возврат</a><a class="btn btn-primary btn-lg" href="#">Принять оплату</a>')
c2 = rcard('<b>Ждёт первой оплаты.</b> Пилюля без заливки; залог «получено 0 из 180»; главное — «Принять оплату 330».',
  ('R-00520', 'Клиент Пример Е', 'XL1200 ···4410 · выдан сегодня 12:40', st('waiting', 'Ждёт оплаты')), hero2('К оплате сегодня', '330 ₾', 'Залог', '0 из 180'), '',
  '<div class="card"><div class="h3">Документы</div><dl class="kv"><dt>Договор</dt><dd class="crit">не подписан ›</dd><dt>Акт выдачи</dt><dd class="crit">не подписан ›</dd></dl></div>',
  '<a class="btn btn-primary btn-lg" href="#">Принять оплату 330 ₾</a>')
c3 = rcard('<b>Вернули, залог ждёт решения.</b> Для владельца главное — «Решить залог» (волна 3); для менеджера — строка «Залог решит владелец» и «Принять долг».',
  ('R-00512', 'Клиент Пример Д', 'Eagle ···3318 · вернул сегодня', st('returned', 'Возвращена')), hero2('Долг', '150 ₾', 'Залог', '180 ждёт', 'crit'), '',
  '<div class="card"><div class="small muted">Акт возврата: решение по залогу не принято · оформил Менеджер Пример</div></div>',
  '<a class="btn" href="#">Принять долг</a><a class="btn btn-primary btn-lg" href="#">Решить залог</a>')

cust = phone('<b>Клиент — владелец.</b> Одна строка итога: должен / на счету / нет долга; из чего сложено — раскрывается (волна 2). Контакты: телефон, второе написание, «откуда пришёл» (§3.5). Аренды и продажи; лента с фильтром: аренды, продажи, выкупы, платежи, документы, заметки (B7-04). Документы — только владельцам, открытие — в журнал.',
  head('Клиент Пример Б', left='back', right='dots'),
  '<div class="card"><div class="small muted">Должен</div><div class="hero crit">1 846 ₾</div><div class="small muted">аренда R-00488 · 450 · продажа SL-00169 · 1 396 · залог на руках 180 — не долг</div></div>'
  f'<div style="display:flex;gap:8px;margin:0 0 8px">{CALL}{WA}<a class="btn btn-primary" href="#" style="flex:1">Принять деньги</a></div>'
  '<div class="card"><dl class="kv"><dt>Телефон</dt><dd class="mono">+995 5·· ·· 22 31</dd><dt>Второе написание</dt><dd>Primer Klient B</dd><dt>Личный номер</dt><dd>•••• 2231 · показать</dd><dt>Откуда пришёл</dt><dd>myauto.ge</dd></dl></div>' +
  grp('Аренды и продажи', '3') + lc('R-00488 · F-150 ···2231', 'с 20.08 · оплачено по 02.09', st('overdue', '16 дней')) + lc('SL-00169 · MKK Plus ···1203', 'рассрочка · взнос 3 из 9', st('overdue', 'взнос 17 дн.')) +
  '<div class="grp"><h3>Лента</h3><span class="cnt">все ▾</span></div><div class="chips"><span class="chip on">Все</span><span class="chip">Аренды</span><span class="chip">Продажи</span><span class="chip">Платежи</span><span class="chip">Документы</span><span class="chip">Заметки</span></div>' +
  '<ul class="tl"><li><div><b>Взнос 1 396 ₾</b> · перевод · SL-00169<div class="when">01.08</div></div></li><li><div><b>Удостоверение добавлено</b><div class="when">20.08 · Менеджер Пример</div></div></li></ul>',
  tabbar('owner', 'rentals', 14))
edit = phone('<b>«⋯ → Изменить» клиента.</b> Лист с проверкой дублей по телефону и личному номеру (B7-04). Менеджер правит телефон, имя, второе написание, «откуда пришёл»; личный номер не видит и не правит. Журнал «было / стало».',
  head('Клиент Пример Б', left='back', right='dots'), '', tabbar('manager', 'rentals', 6),
  overlay=sheet_form('Изменить · Клиент Пример Б', fld('Телефон', '<span class="muted">+995</span> 555 00 22 31', err='Этот номер уже у «Клиент Пример Н». Открыть его карточку?', cls='err') + fld('Имя и фамилия', 'Клиент Пример Б') + fld('Второе написание', 'Primer Klient B') +
  '<div class="field"><span class="lbl">Откуда пришёл</span><div style="display:flex;flex-wrap:wrap;gap:6px"><span class="chip on">myauto.ge</span><span class="chip">Знакомые</span><span class="chip">Соцсети</span><span class="chip">Сайт ev8.ge</span><span class="chip">Другое</span></div></div>',
  '<a class="btn btn-primary btn-lg" href="#" style="width:100%">Сохранить</a>'))

veh = phone('<b>Мопед — владелец.</b> Три вопроса ADR-0005; текущая аренда; экономика (владельцам; загрузка — волна 6); лента. Главное действие по состоянию. Основа — утверждённый <code>08-vehicle.html</code>.',
  head('XL1200 · чёрный', left='back', right='dots'),
  f'<div style="margin:2px 0 10px">{vin("4412")}</div><div class="card"><dl class="kv"><dt>Парк</dt><dd>Аренда</dd><dt>Состояние</dt><dd>{st("rented","В аренде")}</dd><dt>Где стоит</dt><dd>у клиента</dd></dl></div>'
  '<div class="card"><div class="small muted">Аренда R-00497 · Клиент Пример А</div><div style="display:flex;justify-content:space-between;margin-top:6px"><div><div class="small muted">Оплачено по</div><div class="hero" style="font-size:24px">24.09</div></div><div style="text-align:right"><div class="small muted">Долг</div><div class="money" style="font-size:18px">нет</div></div></div></div>'
  '<div class="card"><div class="h3">Экономика</div><dl class="kv"><dt>Себестоимость</dt><dd class="money">1 700,00</dd><dt>Выручка аренды</dt><dd class="money">3 150,00</dd><dt>Ремонты</dt><dd class="money">−210,00</dd></dl></div>' +
  '<ul class="tl"><li><div><b>Выдан</b> · R-00497<div class="when">04.09 · Менеджер Пример</div></div></li></ul>',
  tabbar('owner', 'fleet', 14), '<div class="action-bar"><a class="btn btn-primary btn-lg" href="#">Принять возврат</a></div>', body_cls='with-bar')
state_m = phone('<b>Сменить состояние — менеджер.</b> Только «свободен ↔ в сервисе», с причиной (B7-05). «Продан» — только продажей, «продан → свободен» — только выкупом; «списан» — владелец с причиной (умолчание Q22 — решено ролями).',
  head('Eagle · белый', left='back', right='dots'), '', tabbar('manager', 'fleet', 6),
  overlay=sheet_form('Состояние · Eagle ···4471', '<div class="seg3" style="grid-template-columns:1fr 1fr;margin-bottom:12px"><span>Свободен</span><span class="on warn">В сервис</span></div>' + fld('Причина', 'Не заряжается, клиент вернул раньше') + '<div class="hint">Лучше — «Сообщить о поломке»: откроет ремонт (волна 5). «Продан» и «списан» здесь не ставятся.</div>', '<a class="btn btn-primary btn-lg" href="#" style="width:100%">Перевести в сервис</a>'))
state_o = phone('<b>Сменить состояние — владелец.</b> Плюс «Списан» — с причиной и подтверждением; у проданных и списанных «тишина» не показывается.',
  head('F-150 · серый', left='back', right='dots'), '', tabbar('owner', 'fleet', 14),
  overlay=sheet_form('Состояние · F-150 ···9920', '<div class="seg3" style="margin-bottom:12px"><span>Свободен</span><span>В сервис</span><span class="on bad">Списан</span></div>' + fld('Причина', 'После аварии, мотор переставлен на другой мопед') + '<div class="hint">Продан — только продажей; вернуть проданный — только выкупом.</div>', '<a class="btn btn-primary btn-lg" href="#" style="width:100%">Списать</a>'))

dr = ('<div class="d-head"><h2>R-00488</h2><span class="sub">Клиент Пример Б · F-150 ···2231</span>' + st('overdue', 'просрочена 16 дней') + '<div class="acts"><a class="btn btn-sm" href="#">⋯</a><a class="btn btn-sm" href="#">Возврат</a><a class="btn btn-sm btn-primary" href="#">Принять оплату</a></div></div>'
 '<div class="d-body"><div class="cols" style="grid-template-columns:1.3fr 1fr"><div><div class="card" style="padding:20px"><div style="display:flex;gap:48px"><div><div class="small muted">Оплачено по</div><div class="hero">02.09</div></div><div><div class="small muted">Долг</div><div class="hero crit">450 ₾</div></div><div><div class="small muted">Залог на руках</div><div class="hero">180 ₾</div></div></div><div class="hr"></div>' + strip + '</div>'
 '<table class="table"><tr><th>Неделя</th><th>Период</th><th class="r">Сумма</th><th class="r">Оплачено</th><th>Статус</th></tr>'
 '<tr><td>5</td><td>17.09–23.09</td><td class="r money">150,00</td><td class="r money">0,00</td><td class="crit">к оплате, началась</td></tr>'
 '<tr><td>4</td><td>10.09–16.09</td><td class="r money">150,00</td><td class="r money">0,00</td><td class="crit">просрочена</td></tr>'
 '<tr><td>3</td><td>03.09–09.09</td><td class="r money">150,00</td><td class="r money">0,00</td><td class="crit">просрочена</td></tr>'
 '<tr><td>2</td><td>27.08–02.09</td><td class="r money">150,00</td><td class="r money">150,00</td><td class="ok">оплачена</td></tr></table></div>'
 '<div>' + cond + docs_ok + '<div class="card">' + feed + '</div></div></div></div>')
d = desk('<b>Аренда на ноутбуке.</b> Цифры сверху, недели таблицей, условия, документы и лента справа; действия по статусу — в шапке.', rail('rentals', 'owner', 14), dr)

page('wave-4-cards.html', 'Волна 4 · Аренды и карточки',
 'Список аренд с сегментами и новые карточки: аренда (по статусу), клиент (одна строка итога, лента, правка с проверкой дублей), мопед (действие по состоянию, смена состояния по правам).',
 [('Волна', '4 · <code>docs/redesign/wave-4.md</code> §3.3–3.6'), ('Схема', 'утверждённые прототипы <code>07</code>, <code>08</code>, <code>09</code>; ux №3, №7, №9'), ('Закрывает', 'B6-02, B7-04, B7-05, T3, S7, U3–U6, U9'), ('Данные', 'Пример')],
 [('Аренды', r1 + c1 + c2 + c3), ('Клиент', cust + edit), ('Мопед', veh + state_m + state_o), ('Ноутбук', d)])

# ================= FLEET + BATTERIES =================
fl = phone('<b>Парк · Мопеды на общем списке.</b> Отклонение волны 1 закрыто: тот же список, что везде; состояние, где стоит, дни без движения; «перевести в парк» — в меню мопеда с «Отменить» 10 с.',
  head('Парк', sub='48'), stabs(['Мопеды', 'Модели', 'Точки', 'Батареи'], 'Мопеды') +
  '<div style="display:flex;gap:8px;margin-bottom:10px"><div class="input" style="flex:1">' + ic('search','i s') + '<span class="ph">4 знака VIN, модель</span></div><a class="btn btn-round" href="#">' + ic('sort') + '</a></div>' +
  '<div class="chips"><span class="chip on">Все 48</span><span class="chip">Свободны 9</span><span class="chip">В аренде 18</span><span class="chip">В сервисе 10</span><span class="chip">Без парка 12</span><span class="chip">Без точки 1</span></div>' +
  lc('XL1200 · чёрный', vin('4412'), st('rented', 'В аренде') + '<div class="b">у клиента</div>') +
  lc('Eagle · белый', vin('4471'), st('available', 'Свободен') + '<div class="b">Шоурум · 2 дня</div>') +
  lc('B11 · красный', vin('3390'), st('available', 'Свободен') + '<div class="b crit">где — не указано</div>'),
  tabbar('owner', 'fleet', 14))
pts = phone('<b>Парк · Точки.</b> Список точек владельца со счётчиком мопедов; добавить — лист. Тип точки (шоурум, мастерская, станция) — волна 6 (B10-02). По книге сейчас: шоурум на Нуцубидзе и мастерская подрядчика (<code>places.md</code>).',
  head('Парк', sub='2 точки'), stabs(['Мопеды', 'Модели', 'Точки', 'Батареи'], 'Точки') +
  lc('Шоурум', 'Нуцубидзе, 65', money('20 мопедов')) + lc('Мастерская', 'Avtos workshop', money('9 мопедов')) +
  '<div class="hint">У клиентов: 18 · без точки: 1 — <a class="ok" href="#">показать</a></div>',
  tabbar('owner', 'fleet', 14), '<div class="action-bar"><a class="btn btn-primary btn-lg" href="#">Новая точка</a></div>', body_cls='with-bar')
bat = phone('<b>Парк · Батареи — счёт без номеров</b> (D16, решение Mika В10). Всего — по инвентаризации владельца; у курьеров — по актам выдачи и возврата; в ремонте и неисправные — отметкой; в шоуруме — остаток. Движения — лентой. Замена в шоуруме «одна на одну» счёт не меняет.',
  head('Парк', sub='42 батареи'), stabs(['Мопеды', 'Модели', 'Точки', 'Батареи'], 'Батареи') +
  '<div class="card"><div class="small muted">В шоуруме, на замену и выдачу</div><div class="hero">7</div>'
  '<dl class="kv" style="margin-top:10px"><dt>У курьеров · по актам</dt><dd class="money">34</dd><dt>В ремонте, неисправные</dt><dd class="money">1</dd><dt><b>Всего</b> · инвентаризация 15.09</dt><dd class="money"><b>42</b></dd></dl></div>' +
  '<div class="grp"><h3>Движение</h3><span class="cnt">неделя</span></div><ul class="tl">'
  '<li><div><b>−2 выдано</b> · R-00520<div class="when">сегодня 12:40 · Менеджер Пример</div></div></li>'
  '<li><div><b>+2 вернулось</b> · R-00476<div class="when">вчера · Kardu</div></div></li>'
  '<li><div><b>−1 потеряна</b> · акт возврата R-00471: «батарея №2 — нет»<div class="when">16.09</div></div></li>'
  '<li><div><b>Инвентаризация</b>: 43 → 42 · «одну списали, вздулась»<div class="when">15.09 · Mika</div></div></li></ul>',
  tabbar('owner', 'fleet', 14), '<div class="action-bar"><a class="btn btn-lg" href="#">В ремонт · из ремонта</a><a class="btn btn-primary btn-lg" href="#">Инвентаризация</a></div>', body_cls='with-bar')
inv = phone('<b>Инвентаризация батарей — владелец.</b> Пересчитал в шоуруме и в ремонте; у курьеров система считает по актам. Расхождение — с причиной, в журнал.',
  head('Парк', sub='42 батареи'), stabs(['Мопеды', 'Модели', 'Точки', 'Батареи'], 'Батареи'), tabbar('owner', 'fleet', 14),
  overlay=sheet_form('Инвентаризация батарей', '<div class="card"><dl class="kv"><dt>У курьеров по актам</dt><dd class="money">34</dd></dl></div>' + fld('В шоуруме — пересчитал', '<b class="mono">6</b>', hint='По системе 7') + fld('В ремонте, неисправные', '<b class="mono">1</b>') + fld('Причина расхождения', 'Одна у мастера, забыли отметить', hint='Обязательна, если не сошлось. Всего станет 41') , '<a class="btn btn-primary btn-lg" href="#" style="width:100%">Записать: всего 41</a>'))
pk = phone('<b>Выдача — сколько останется.</b> В шаге «Условия» (волна 3) подсказка из счёта: «В шоуруме 7 — после выдачи останется 5». Батарей меньше, чем выдаём, — предупреждение «счёт разошёлся — проверьте, инвентаризация», выдать можно.',
  head('Выдача', left='close', right=''),
  '<div class="steps"><i class="done"></i><i class="done"></i><i class="cur"></i><i></i><i></i><i></i><span>3 из 6 · Условия</span></div>'
  '<div class="field"><span class="lbl">Батареи и зарядки</span><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><div class="input" style="justify-content:space-between">' + ic('battery','i s') + '<b>2</b><span class="muted">− +</span></div><div class="input" style="justify-content:space-between">зарядки <b>2</b><span class="muted">− +</span></div></div><div class="hint">В шоуруме 7 батарей — после выдачи останется 5</div></div>'
  f'<div class="banner warn">{ic("alert","i s")}<div>Другой пример: в шоуруме по счёту 1, выдаёте 2 — счёт разошёлся. Выдать можно; проверьте инвентаризацией.</div></div>',
  '', '<div class="action-bar bottom"><a class="btn btn-round" href="#">' + ic('left') + '</a><a class="btn btn-primary btn-lg" href="#">Далее</a></div>', body_cls='bar-only')

page('wave-4-fleet.html', 'Волна 4 · Парк, точки, батареи',
 '«Парк» на общем списке, точки со счётчиком мопедов, счёт батарей без номеров: шоурум, у курьеров, в ремонте, движение и инвентаризация.',
 [('Волна', '4 · <code>docs/redesign/wave-4.md</code> §3.7–3.8'), ('Правила', '<code>batteries.md</code> (42 батареи, 2 с мопедом, замена в шоуруме, дефицит); <code>places.md</code>; ADR-0005'), ('Закрывает', 'D16 (В10), register #34, R8, U3'), ('Данные', 'Пример')],
 [('Телефон', fl + pts + bat + inv + pk)])
print('ok wave4')
