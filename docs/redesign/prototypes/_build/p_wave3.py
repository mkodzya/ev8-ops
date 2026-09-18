from proto_base import *
from p_today import q, grp, prim, sec, CALL, WA
from p_wizards import steps, wbar, wphone, field
from p_return_money import item
from p_wave1 import stabs, lc, money, fld, sheet_form
import proto_base
proto_base.WAVE1 = False

N = 6
def seg(opts, on, cls=''):
    cells = ''.join(f'<span class="{("on " + cls) if o == on else ""}">{o}</span>' for o in opts)
    return f'<div class="seg3" style="grid-template-columns:repeat({len(opts)},1fr)">{cells}</div>'
def vrow(model, tail, place, state='available', word='Свободен', note='', off=False):
    style = ' style="opacity:.55"' if off else ''
    n = f'<div class="b crit">{note}</div>' if note else ''
    return f'<a class="lcard" href="#"{style}><div><div class="a">{model}</div><div class="b">{vin(tail)}</div>{n}</div><div class="r">{st(state, word)}<div class="b">{place}</div></div></a>'

# ================= PICKUP =================
p1 = wphone('<b>1. Клиент.</b> Поиск — имя в любом написании, телефон, последние цифры; ниже — 5 последних. «Новый клиент» раскрывается прямо в шаге. Удостоверение и личный номер обязательны, права — если есть (В2, <code>customer-journey.md</code>). Поставщиков в поиске нет (B3-06).',
  'Выдача', steps(1, N, 'Клиент') +
  field('Телефон или имя', ic('search','i s') + '<span class="ph">имя, телефон, 4 цифры</span>', cls='focus') +
  '<a class="btn" href="#" style="width:100%;margin-bottom:10px">' + ic('user','i s') + 'Новый клиент</a>' +
  grp('Недавние', '') +
  lc('Клиент Пример Н', '+995 595 12 ·· ·· · удостоверение есть', '<div class="b">нет долга</div>') +
  lc('Клиент Пример Б', '+995 5·· ·· 22 31 · R-00488', money('долг 300', 'crit')),
  wbar('Далее', back=False))
p1n = wphone('<b>1. Новый клиент в шаге.</b> Телефон (+995 подставлен; дубль по номеру — «Уже есть: открыть?»), имя как в удостоверении, личный номер, фото удостоверения — обязательно; права — если есть. Второе написание имени — позже, в карточке.',
  'Выдача', steps(1, N, 'Клиент') +
  '<div class="card" style="border:1px solid var(--accent)"><div class="h3">Новый клиент</div>' +
  field('Телефон', '<span class="muted">+995</span> 595 12 34 56') +
  field('Имя и фамилия', 'Клиент Пример Новый', hint='Как в удостоверении') +
  field('Личный номер', '<span class="ph">как в удостоверении</span>', err='Нужен для договора', cls='err') +
  '<span class="lbl" style="font:var(--text-label);color:var(--muted)">Удостоверение — нужно · права — если есть</span><div class="photos" style="margin-top:6px"><div class="photo">удост.</div><div class="photo add">' + ic('camera') + '<span class="small">права</span></div></div></div>',
  wbar('Сохранить и дальше', back=False))
p1d = wphone('<b>1. Клиент с долгом — менеджер.</b> Сумма и аренда; менеджер дальше не идёт — выдаёт только владелец (В2). Можно принять оплату долга и продолжить.',
  'Выдача', steps(1, N, 'Клиент') +
  '<a class="lcard" href="#" style="border:1px solid var(--crit)"><div><div class="a">Клиент Пример Б</div><div class="b">R-00488 · возвращена 10.09</div></div><div class="r money crit">долг 300 ₾</div></a>' +
  f'<div class="banner crit">{ic("alert","i s")}<div><b>Долг 300 ₾</b> по R-00488. Новую выдачу оформляет только владелец.</div></div>' +
  '<a class="btn" href="#" style="width:100%;margin-bottom:8px">Принять наличные 300 ₾</a>',
  '<div class="action-bar bottom"><a class="btn btn-primary btn-lg" aria-disabled="true" href="#">Далее</a></div>')
p1o = wphone('<b>1. Клиент с долгом — владелец.</b> То же предупреждение; «Выдать всё равно» — с причиной, в журнал.',
  'Выдача', steps(1, N, 'Клиент') +
  '<a class="lcard" href="#" style="border:1px solid var(--crit)"><div><div class="a">Клиент Пример Б</div><div class="b">R-00488 · возвращена 10.09</div></div><div class="r money crit">долг 300 ₾</div></a>' +
  f'<div class="banner crit">{ic("alert","i s")}<div><b>Долг 300 ₾</b> по R-00488.</div></div>' +
  field('Почему выдаём', 'Договорились: платит в пятницу', hint='Обязательно; попадёт в журнал'),
  wbar('Выдать всё равно'))
p2 = wphone('<b>2. Мопед.</b> Свободные парка аренды и «парк не решён», у каждого модель, цвет, точка. Мопеды в сервисе и в аренде не показываются. Парк продажи — под ссылкой; менеджер выбрать не может, владелец — с подтверждением «перейдёт в парк аренды» (умолчание Q9).',
  'Выдача', steps(2, N, 'Мопед') +
  field('Последние знаки VIN', ic('search','i s') + '44', cls='focus') +
  vrow('XL1200 · чёрный', '4410', 'Шоурум') + vrow('Eagle · белый', '4471', 'Шоурум') + vrow('B11 · красный', '4409', '<span class="crit">точка не указана</span>', 'available', 'Парк не решён') +
  '<a class="q-more" href="#">Показать парк продажи · 3</a>' +
  '<div class="hint">Нет VIN на руках? <a class="ok" href="#">Выдать без VIN с причиной</a> — аренда попадёт в «Без VIN».</div>',
  wbar('Далее'))
p3 = wphone('<b>3. Условия.</b> Тариф — из модели (B4-05; быстрые тарифы и залог по умолчанию из «Настроек» — волна 6). Дата выдачи — не позже сегодня. Адрес ночной парковки обязателен (договор п.5). Батареи и зарядки 2 и 2. Плановый возврат — не обязателен (Q17).',
  'Выдача', steps(3, N, 'Условия') +
  '<div class="card"><dl class="kv"><dt>Мопед</dt><dd>XL1200 ···4410</dd><dt>Тариф в неделю</dt><dd class="money">150,00 ₾ ›</dd><dt>Залог</dt><dd class="money">180,00 ₾ ›</dd><dt>Выдача</dt><dd>сегодня, 18.09</dd><dt>Первая неделя</dt><dd>18.09–24.09</dd></dl></div>' +
  field('Адрес ночной парковки', 'Тбилиси, ул. Пример, 1') +
  '<div class="field"><span class="lbl">Батареи и зарядки</span><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><div class="input" style="justify-content:space-between">' + ic('battery','i s') + '<b>2</b><span class="muted">− +</span></div><div class="input" style="justify-content:space-between">зарядки <b>2</b><span class="muted">− +</span></div></div></div>' +
  field('Плановый возврат', '<span class="ph">не указан</span>'),
  wbar('Далее'))
p3t = wphone('<b>3. Перенос действующей аренды — только владелец.</b> Переключатель в «Условиях» (B3-02): дата выдачи в прошлом, «оплачено по», «залог получен до переноса»; акт без фото и пробега допускается. Недели до «оплачено по» — «оплачено до переноса», не выручка периода (умолчание Q3).',
  'Выдача', steps(3, N, 'Условия') +
  '<div class="card" style="display:flex;justify-content:space-between;align-items:center"><div><div class="q-who">Перенос действующей аренды</div><div class="q-why">аренда началась до системы</div></div><span class="chip on">вкл</span></div>' +
  field('Дата выдачи', '20.07.2026') + field('Оплачено по', '13.09.2026', hint='Конец оплаченной недели: 8 недель · оплачено до переноса') +
  field('Залог получен до переноса, GEL', '180,00') +
  '<div class="card" style="background:var(--surface-2)"><dl class="kv"><dt>Недель</dt><dd>9</dd><dt>Оплачено до переноса</dt><dd>8</dd><dt>Долг</dt><dd class="money crit">150,00 ₾ · неделя 14.09–20.09</dd></dl></div>',
  wbar('Далее'))
p4 = wphone('<b>4. Акт выдачи.</b> Пробег обязателен и не меньше последнего акта этого мопеда (меньше — только с причиной). Фото: меньше 4 — через подтверждение (B4-06). Фото ждут связи на телефоне с отметкой часов.',
  'Выдача', steps(4, N, 'Акт') +
  field('Пробег, км', '1 190', err='Меньше, чем в последнем акте (1 234, возврат 10.09). Укажите причину или проверьте пробег.', cls='err focus') +
  field('Причина', '<span class="ph">например, заменили приборную панель</span>') +
  '<div class="field"><span class="lbl">Фото: спереди, сзади, слева, справа</span><div class="photos"><div class="photo">✓</div><div class="photo">✓</div><div class="photo">' + ic('clock','i s') + '</div><div class="photo add">' + ic('camera') + '</div></div><div class="hint">3 из 4 · одно ждёт связи</div></div>' +
  field('Состояние, повреждения', '<span class="ph">царапина на левом зеркале</span>'),
  wbar('Далее'))
p5 = wphone('<b>5. Оплата.</b> «К оплате сегодня: неделя 150 + залог 180 = 330». Выбор обязателен, умолчания нет (B4-01). Карта — «банк зачислит 325,05». «Позже» — аренда «ждёт оплаты» сегодня, просрочка — с завтра (умолчание Q7). Менеджеру — наличные и карта; перевод — владелец.',
  'Выдача', steps(5, N, 'Оплата') +
  '<div class="card"><div class="small muted">К оплате сегодня</div><div class="hero">330,00 ₾</div><dl class="kv" style="margin-top:8px"><dt>Неделя 18.09–24.09</dt><dd class="money">150,00</dd><dt>Залог</dt><dd class="money">180,00</dd></dl></div>' +
  '<div class="field"><span class="lbl">Как платит</span>' + seg(['Наличные', 'Карта', 'Позже'], 'Карта') + '</div>' +
  f'<div class="banner info">{ic("money","i s")}<div>Банк зачислит <b class="mono">325,05 ₾</b>; комиссия 4,95 — расход компании.</div></div>' +
  field('Клиент заплатил', '330,00 ₾', hint='Меньше — частично: сначала залог, потом неделя (Q6)'),
  wbar('К итогу'))
p6 = wphone('<b>6. Итог.</b> Каждая строка — ссылка на свой шаг. Батареи, зарядки и сумма к оплате видны (B4-06). Кнопка — одна операция: клиент, аренда, платёж, документы — одним ключом (B2-01).',
  'Выдача', steps(6, N, 'Итог') +
  '<div class="card"><dl class="kv"><dt>Клиент</dt><dd>Клиент Пример Новый ›</dd><dt>Мопед</dt><dd>XL1200 ···4410 · Шоурум ›</dd><dt>Тариф · залог</dt><dd>150 · 180 ₾ ›</dd><dt>Ночёвка</dt><dd>ул. Пример, 1 ›</dd><dt>Комплект</dt><dd>2 батареи · 2 зарядки ›</dd><dt>Пробег · фото</dt><dd>1 234 км · 4 фото ›</dd><dt>Оплата</dt><dd><b>330,00 ₾ картой</b> ›</dd></dl></div>',
  wbar('Выдать мопед'))
p7 = phone('<b>7. Готово.</b> Договор и акт собраны из введённого; статус подписи у каждого. «Подписать на экране» — клиент расписывается пальцем; «Отправить на подпись» — через Signify, когда будет ключ API (D17, register #36). Если в договоре пусто — называем что (B4-06).',
  head('Выдача', left='close', right=''),
  f'<div class="empty" style="padding:20px 12px 12px"><div class="big">{ic("check")}</div><h4>Выдано · R-00521</h4><p>XL1200 ···4410 · оплачено по 24.09 · залог 180 получен</p></div>' +
  '<div class="card"><a class="lcard" href="#" style="margin:0;padding:10px 0"><div><div class="a">' + ic('file','i s') + ' Договор аренды</div><div class="b">ka / en · PDF</div></div><div class="r"><span class="st st-waiting"><i class="mk"></i>не подписан</span></div></a><div class="hr" style="margin:0"></div>'
  '<a class="lcard" href="#" style="margin:0;padding:10px 0"><div><div class="a">' + ic('file','i s') + ' Акт выдачи</div><div class="b">ka / en · 4 фото</div></div><div class="r"><span class="st st-waiting"><i class="mk"></i>не подписан</span></div></a>'
  '<div style="display:flex;gap:8px;margin-top:10px"><a class="btn btn-primary" href="#" style="flex:1">Подписать на экране</a><a class="btn" href="#" aria-disabled="true">Signify</a></div><div class="hint">Signify — когда будет ключ API</div></div>' +
  '<a class="btn btn-quiet" href="#" style="width:100%;margin:4px 0">' + ic('chat','i s') + 'Написать клиенту в WhatsApp</a>',
  '', '<div class="action-bar bottom"><a class="btn" href="#">На «Сегодня»</a><a class="btn btn-primary btn-lg" href="#">Открыть аренду</a></div>', body_cls='bar-only')
sign = phone('<b>Подпись на экране.</b> Телефон в руках у клиента: документ крупно (грузинский главный), поле подписи пальцем, «Очистить», «Подписать». Подпись ложится в PDF с датой и временем; в аренде — «подписан 18.09 14:32».',
  head('Подпись клиента', left='close', right=''),
  '<div class="card" style="font:var(--text-label)"><b>ქირაობის ხელშეკრულება · Rental contract</b><br>R-00521 · 18.09.2026<br>მოქირავე / Lessee: Клиент Пример Новый<br>XL1200 · ' + vin('4410') + '<br>150 ₾ / კვირა · დეპოზიტი 180 ₾<div class="hr"></div><span class="muted">… полный текст договора прокручивается …</span></div>' +
  '<div class="field"><span class="lbl">ხელმოწერა / Подпись</span><div style="height:150px;border:1px dashed var(--line-control);border-radius:12px;background:#fff;display:grid;place-items:center;color:var(--muted);font:italic 28px/1 serif">Пример</div></div>' +
  '<label class="field" style="display:flex;gap:10px;align-items:center"><span class="chip on">✓</span><span class="small">ვეთანხმები პირობებს · Согласен с условиями</span></label>',
  '', '<div class="action-bar bottom"><a class="btn" href="#">Очистить</a><a class="btn btn-primary btn-lg" href="#">Подписать</a></div>', body_cls='bar-only')
missing = phone('<b>Готово — в договоре пусто.</b> Клиент перенесён из Odoo без личного номера: подписывать нельзя, пока поле не заполнено (B4-06).',
  head('Выдача', left='close', right=''),
  f'<div class="banner warn">{ic("alert","i s")}<div><b>В договоре пусто: личный номер клиента.</b> Заполните — договор соберётся заново.</div></div>' +
  field('Личный номер', '<span class="ph">как в удостоверении</span>', cls='focus') +
  '<a class="btn btn-primary" href="#" style="width:100%">Сохранить и собрать договор</a>',
  '', body_cls='no-tabs')
p_ka = wphone('<b>Шаг 1 на грузинском</b> — длина подписей мастера. Слова из словаря интерфейса (не вычитаны); «ახალი კლიენტი» — есть в словаре.',
  'გაცემა', '<div class="steps"><i class="cur"></i><i></i><i></i><i></i><i></i><i></i><span>ნაბიჯი 1/6 · კლიენტი</span></div>' +
  field('სახელი ან ტელეფონი', ic('search','i s') + '<span class="ph">სახელი, ტელეფონი</span>', cls='focus') +
  '<a class="btn" href="#" style="width:100%;margin-bottom:10px">' + ic('user','i s') + 'ახალი კლიენტი</a>' +
  lc('ნინო მაგალითი-ხარაზიშვილი', '+995 5·· ·· 90 11 · R-00509', money('ვალი 150', 'crit')),
  '<div class="action-bar bottom"><a class="btn btn-primary btn-lg" href="#">შემდეგი</a></div>')

dp = ('<div class="d-head"><h2>Выдача мопеда</h2><span class="sub">шаг 5 из 6 · оплата</span><div class="acts"><a class="btn btn-sm" href="#">Закрыть — черновик сохранится</a></div></div>'
 '<div class="d-body"><div class="cols" style="grid-template-columns:200px 1fr 340px">'
 '<ol style="margin:0;padding-left:18px;font:var(--text-body-sm);line-height:2.2"><li class="ok">Клиент ✓</li><li class="ok">Мопед ✓</li><li class="ok">Условия ✓</li><li class="ok">Акт ✓</li><li><b>Оплата</b></li><li class="muted">Итог</li></ol>'
 '<div class="card" style="padding:20px"><div class="small muted">К оплате сегодня</div><div class="hero">330,00 ₾</div><dl class="kv" style="max-width:360px;margin:8px 0 16px"><dt>Неделя 18.09–24.09</dt><dd class="money">150,00</dd><dt>Залог</dt><dd class="money">180,00</dd></dl>'
 '<div class="field" style="max-width:420px"><span class="lbl">Как платит</span>' + seg(['Наличные', 'Карта', 'Перевод', 'Позже'], 'Перевод') + '</div>'
 f'<div class="banner info" style="max-width:520px">{ic("money","i s")}<div>Перевод: строка выписки найдёт этот платёж сама (волна 2).</div></div>'
 '<div style="display:flex;gap:8px;margin-top:16px"><a class="btn" href="#">Назад</a><a class="btn btn-primary" href="#">К итогу</a></div></div>'
 '<div class="card"><div class="h3">Выдача</div><dl class="kv"><dt>Клиент</dt><dd>Клиент Пример Новый</dd><dt>Мопед</dt><dd>XL1200 ···4410</dd><dt>Тариф</dt><dd class="money">150,00 ₾</dd><dt>Залог</dt><dd class="money">180,00 ₾</dd><dt>Ночёвка</dt><dd>ул. Пример, 1</dd><dt>Комплект</dt><dd>2 + 2</dd><dt>Пробег</dt><dd>1 234 км</dd></dl></div></div></div>')
d1 = desk('<b>Ноутбук, владелец.</b> Шаги слева, шаг в центре, итог справа. У владельца в оплате есть «Перевод».', rail('rentals', 'owner'), dp)

notes_p = ('<h2>Число действий</h2><p>Новый клиент с первой оплатой картой ≈ 18 действий за один заход (С1). Постоянный клиент без долга — ≈ 12.</p>'
  '<h2>Умолчания ТЗ v2 на этой странице</h2><ul><li>Q3 — «оплачено до переноса» не выручка, отдельной строкой.</li><li>Q6 — частичная оплата: сначала залог.</li><li>Q7 — «ждёт оплаты» в день выдачи.</li><li>Q9 — парк продажи: менеджер нет, владелец с подтверждением.</li><li>Q10 — тариф из модели; быстрые тарифы и залог по умолчанию — волна 6.</li><li>Q14 — выдать с недовнесённым залогом можно; возврат не больше полученного.</li><li>Q17 — плановый возврат не обязателен (вопрос о 30 ₾/день — в <code>wave-3.md</code> §7).</li></ul>')
page('wave-3-pickup.html', 'Волна 3 · Выдача',
 'Мастер выдачи за один заход: клиент (и новый — внутри), мопед, условия, акт, оплата, итог, «Готово» с подписью. Перенос действующей аренды — режим того же мастера у владельца.',
 [('Волна', '3 — выдача и возврат · <code>docs/redesign/wave-3.md</code> §3.1–3.3'), ('Сценарий', 'С1, С9 (перенос аренды)'), ('Правила', '<code>rental.md</code>, <code>customer-journey.md</code> §2–3, <code>money.md</code>, договор п.5'), ('Закрывает', 'B4-01…B4-07, B3-02, R1–R6, R11, M1'), ('Данные', 'Пример')],
 [('Шаги', p1 + p1n + p1d + p1o + p2 + p3 + p3t + p4 + p5 + p6), ('Готово и подпись', p7 + sign + missing), ('Грузинский и ноутбук', p_ka + d1)], notes_p)

# ================= RETURN =================
RN = 5
calc_m = ('<div class="card"><div class="h3">Расчёт</div><dl class="kv">'
  '<dt>Неделя 18.09–24.09 · началась сегодня</dt><dd class="money">150,00</dd>'
  '<dt>Ключ не возвращён <span class="small">(договор п.6)</span></dt><dd class="money">250,00</dd>'
  '<dt>Уже удержано · ремонт SV-00029</dt><dd class="money muted">50,00</dd>'
  '<dt><b>Претензии</b></dt><dd class="money"><b>400,00 ₾</b></dd></dl><div class="hr"></div>'
  '<dl class="kv"><dt>Залог получен</dt><dd class="money">180,00</dd><dt>Осталось в залоге</dt><dd class="money">130,00</dd></dl></div>')
r1 = wphone('<b>1. Акт.</b> Позиции — из выданного: 2 батареи, 2 зарядки (B5-07, B10-02). «В порядке» выбрано заранее. Пробег не меньше пробега выдачи — отказ (B5-05). «Ключ — нет» подставит 250 ₾ в расчёт; «Повреждено» у мопеда — черновик ремонта.',
  'Возврат · R-00512', steps(1, RN, 'Акт') +
  '<div class="card" style="margin-bottom:12px"><div class="q-who">Клиент Пример Д</div><div class="q-why">Eagle ···3318 · выдан 04.09 · оплачено по 17.09</div></div>' +
  field('Пробег, км', '1 190', err='Не меньше 1 234 — пробег при выдаче 04.09', cls='err') +
  item('Мопед', 'В порядке') + item('Ключ', 'Нет') + item('Батарея №1', 'В порядке') + item('Батарея №2', 'В порядке') + item('Зарядка №1', 'В порядке') + item('Зарядка №2', 'В порядке') +
  '<div class="field"><span class="lbl">Фото</span><div class="photos"><div class="photo">✓</div><div class="photo">✓</div><div class="photo add">' + ic('camera') + '</div></div></div>',
  wbar('Далее', back=False))
r1b = wphone('<b>1. Повреждение.</b> «Повреждено» раскрывает: что и фото. После возврата это станет черновиком ремонта за счёт клиента, сумму ремонта определит владелец (договор п.6). Позиция «Нет» у зарядки — основание «потеря зарядки» без суммы: суммы нет в книге (<code>incidents.md</code>).',
  'Возврат · R-00512', steps(1, RN, 'Акт') +
  item('Мопед', 'Повреждено') + field('Что повреждено', 'Треснул передний щиток') + '<div class="photos" style="margin-bottom:12px"><div class="photo">✓</div><div class="photo add">' + ic('camera') + '</div></div>' +
  item('Зарядка №2', 'Нет'),
  wbar('Далее', back=False))
r2m = wphone('<b>2. Расчёт — менеджер.</b> Досрочного нет: вернули на следующий день после «оплачено по» — неделя 18.09–24.09 уже началась и оплачивается целиком (<code>rental.md</code>). Ключ — 250 по договору. Уже удержанное за ремонт — строкой (B5-04). Залог решит владелец.',
  'Возврат · R-00512', steps(2, RN, 'Расчёт') + calc_m +
  f'<div class="banner info">{ic("lock","i s")}<div><b>Залог решит владелец.</b> Возврат оформится сейчас; решение — задачей у владельцев.</div></div>',
  wbar('Далее'))
r2o = wphone('<b>2. Залог — владелец.</b> Выбор обязателен, умолчания нет (B5-02). Удержать — не больше, чем осталось в залоге; основания и причина обязательны. Остаток претензий — долг клиента. Решает один владелец (D18).',
  'Возврат · R-00512', steps(2, RN, 'Залог') + calc_m +
  '<div class="field"><span class="lbl">Залог</span>' + seg(['Вернуть всё', 'Удержать часть', 'Удержать всё'], 'Удержать всё', 'bad') + '</div>' +
  '<div class="card"><dl class="kv"><dt>Удержать</dt><dd class="money"><b>130,00 ₾</b></dd><dt>Основания</dt><dd>долг по аренде · потеря ключа</dd><dt>Вернуть клиенту</dt><dd class="money">0,00</dd><dt>Долг клиента после</dt><dd class="money crit">270,00 ₾</dd></dl></div>' +
  field('Причина', 'Ключ не вернул, неделя не оплачена'),
  wbar('Далее'))

r2l = wphone('<b>2. Расчёт — пропущена плановая дата</b> (решение Mika по Q17). Плановый возврат 16.09, вернули 18.09: два варианта, одно вместо другого — начатая неделя целиком или «опоздание 2 дня × 30 ₾» по договору п.6. Выбрано меньшее; решает владелец. Без плановой даты — только неделя.',
  'Возврат · R-00514', steps(2, RN, 'Расчёт') +
  '<div class="card"><div class="h3">За дни после «оплачено по 17.09»</div>' +
  '<div class="seg3" style="grid-template-columns:1fr;gap:0"><span style="justify-content:space-between;display:flex;padding:0 12px">Неделя 18.09–24.09 целиком <b class="mono">150,00</b></span><span class="on" style="justify-content:space-between;display:flex;padding:0 12px">Опоздание 2 дня × 30 ₾ (п.6) <b class="mono">60,00</b></span></div>' +
  '<div class="hint">Плановый возврат был 16.09. Одно из двух — не оба.</div></div>',
  wbar('Далее'))
r3 = wphone('<b>3. Где встал мопед.</b> Точка из списка, подставлена последняя; «В сервис» — если в акте повреждение (B5-06). Точек нет — подсказка владельцу.',
  'Возврат · R-00512', steps(3, RN, 'Мопед') +
  '<div class="field"><span class="lbl">Состояние</span>' + seg(['Свободен', 'В сервис'], 'Свободен') + '</div>' +
  '<div class="field"><span class="lbl">Точка</span><div style="display:flex;flex-wrap:wrap;gap:8px"><span class="chip on">' + ic('pin','i s') + 'Шоурум</span><span class="chip">Мастерская</span></div></div>',
  wbar('К итогу'))
r4 = wphone('<b>4. Итог.</b> Удержание необратимо — подтверждение словами и суммой.',
  'Возврат · R-00512', steps(4, RN, 'Итог') +
  '<div class="card"><dl class="kv"><dt>Пробег</dt><dd>1 312 км ›</dd><dt>Комплект</dt><dd class="crit">ключ — нет ›</dd><dt>Претензии</dt><dd class="money">400,00 ›</dd><dt>Залог</dt><dd class="money">удержать 130 ›</dd><dt>Долг клиента</dt><dd class="money crit">270,00 ₾</dd><dt>Мопед</dt><dd>свободен · шоурум ›</dd></dl></div>',
  wbar('Оформить возврат'),
  overlay='<div class="sheet-scrim"></div><div class="sheet"><div class="grab"></div><h4>Удержать 130 ₾ из залога?</h4><p class="small muted" style="margin:0 0 14px">Клиент Пример Д · долг по аренде и потеря ключа. Остаток 270 ₾ станет долгом клиента.</p><div style="display:flex;gap:8px"><a class="btn" href="#" style="flex:1">Отмена</a><a class="btn btn-primary" href="#" style="flex:1">Удержать 130 ₾</a></div></div>')
r5 = phone('<b>5. Готово.</b> Акт возврата с решением по залогу и причиной; позиции — по выданному. Подпись на экране. Если решено вернуть — «Выдать залог» открывает форму денег (волна 2). Повреждение — «Ремонт SV-… открыт черновиком».',
  head('Возврат', left='close', right=''),
  f'<div class="empty" style="padding:20px 12px 12px"><div class="big">{ic("check")}</div><h4>Возврат оформлен</h4><p>R-00512 закрыта · Eagle ···3318 свободен в шоуруме<br>Удержано 130 ₾ · долг 270 ₾</p></div>' +
  '<div class="card"><a class="lcard" href="#" style="margin:0;padding:10px 0"><div><div class="a">' + ic('file','i s') + ' Акт возврата и расчёта</div><div class="b">ka / en · PDF</div></div><div class="r"><span class="st st-waiting"><i class="mk"></i>не подписан</span></div></a>'
  '<a class="btn btn-primary" href="#" style="width:100%;margin-top:10px">Подписать на экране</a></div>',
  '', '<div class="action-bar bottom"><a class="btn" href="#">Клиент</a><a class="btn btn-primary btn-lg" href="#">Принять долг 270 ₾</a></div>', body_cls='bar-only')
r5m = phone('<b>Готово — менеджер.</b> Акт без строки «претензий нет»: «решение по залогу не принято» (B5-07). Строка ушла владельцам.',
  head('Возврат', left='close', right=''),
  f'<div class="empty" style="padding:20px 12px 12px"><div class="big">{ic("check")}</div><h4>Возврат оформлен</h4><p>Залог решит владелец — ему пришла задача</p></div>' +
  '<div class="card"><div class="small">Акт возврата: <b>решение по залогу не принято</b></div><a class="btn btn-primary" href="#" style="width:100%;margin-top:10px">Подписать на экране</a></div>',
  '', '<div class="action-bar bottom"><a class="btn btn-primary btn-lg" href="#">На «Сегодня»</a></div>', body_cls='bar-only')
dec = phone('<b>Решить залог позже.</b> Возврат оформил менеджер — у владельцев в «Сегодня» строка и в «Деньги → Залоги» сегмент «Ждут решения». Решение — одной панелью: то же, что шаг 2 мастера.',
  head('Аренда R-00512', left='back', right='dots'), '<div class="card"><div class="q-who">Возвращена 18.09 · Менеджер Пример</div></div>', tabbar('owner', 'rentals', 8),
  overlay=sheet_form('Решить залог · R-00512', calc_m.replace('<div class="h3">Расчёт</div>', '') + '<div class="field"><span class="lbl">Залог</span>' + seg(['Вернуть всё', 'Удержать часть', 'Удержать всё'], '') + '</div><div class="hint">Выберите — умолчания нет</div>', '<a class="btn btn-primary btn-lg" aria-disabled="true" href="#" style="width:100%">Решить</a>'))

dr = ('<div class="d-head"><h2>Возврат · R-00512</h2><span class="sub">Клиент Пример Д · Eagle ···3318</span></div><div class="d-body"><div class="cols" style="grid-template-columns:1fr 380px">'
 '<div class="card" style="padding:20px"><div class="h3">Акт</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:0 20px">' + field('Пробег, км', '1 312', hint='При выдаче 1 234') + field('Дата', '18.09.2026, 15:10') +
 item('Мопед', 'В порядке') + item('Ключ', 'Нет') + item('Батарея №1', 'В порядке') + item('Батарея №2', 'В порядке') + item('Зарядка №1', 'В порядке') + item('Зарядка №2', 'В порядке') +
 '</div><div class="field"><span class="lbl">Где встал</span><div style="display:flex;gap:8px"><span class="chip on">Свободен · Шоурум</span><span class="chip">В сервис</span></div></div></div>'
 '<div>' + calc_m + '<div class="card"><div class="field"><span class="lbl">Залог</span>' + seg(['Вернуть всё', 'Удержать часть', 'Удержать всё'], 'Удержать всё', 'bad') + '</div><dl class="kv"><dt>Удержать</dt><dd class="money">130,00</dd><dt>Долг после</dt><dd class="money crit">270,00</dd></dl><div class="hr"></div><a class="btn btn-primary" href="#" style="width:100%">Оформить возврат</a></div></div></div></div>')
d2 = desk('<b>Ноутбук.</b> Возврат одним экраном: акт слева, расчёт и залог справа.', rail('rentals', 'owner', 8), dr)

page('wave-3-return.html', 'Волна 3 · Возврат и залог',
 'Мастер возврата: акт по выданному комплекту, расчёт по договору с уже удержанным, залог владельцем (менеджер — задачей), где встал мопед, итог и подпись. Решение по залогу позже — той же панелью.',
 [('Волна', '3 · <code>docs/redesign/wave-3.md</code> §3.4–3.6'), ('Сценарий', 'С3'), ('Правила', 'договор п.3, п.6; <code>rental.md</code> «Возврат и залог», «Досрочный возврат»; <code>incidents.md</code>'), ('Закрывает', 'B5-01, B5-02, B5-04…B5-07, M6, M7, M14, R6–R8, R10'), ('Данные', 'Пример')],
 [('Шаги', r1 + r1b + r2m + r2l + r2o + r3 + r4), ('Готово и решение позже', r5 + r5m + dec), ('Ноутбук', d2)])

# ================= RENTAL ACTIONS =================
card_top = ('<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><div><div class="q-who">Клиент Пример В</div><div class="q-why">XL1200 ···1180 · выдан 04.09</div></div>' + st('overdue', '7 дней') + '</div>')
e1 = phone('<b>Правка аренды.</b> «⋯ → Изменить условия»: адрес ночёвки, батареи, зарядки, плановый возврат — может и менеджер; журнал «было / стало» (B4-08). Тариф не меняется (умолчание Q12).',
  head('R-00491', left='back', right='dots'), card_top, tabbar('owner', 'rentals', 8),
  overlay=sheet_form('Изменить условия · R-00491', field('Адрес ночной парковки', 'Тбилиси, ул. Пример, 12') + '<div class="field"><span class="lbl">Батареи и зарядки</span><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><div class="input">батареи <b style="margin-left:auto">2</b></div><div class="input">зарядки <b style="margin-left:auto">2</b></div></div></div>' + field('Плановый возврат', '30.09.2026') + '<div class="hint">Тариф 150 ₾ в неделю в открытой аренде не меняется.</div>', '<a class="btn btn-primary btn-lg" href="#" style="width:100%">Сохранить</a>'))
e2 = phone('<b>Пауза и спорная — только владелец, с причиной.</b> Недели за время статуса не начисляются (умолчание Q11); снятие статуса не досоздаёт их задним числом.',
  head('R-00491', left='back', right='dots'), card_top, tabbar('owner', 'rentals', 8),
  overlay=sheet_form('Статус аренды', seg(['Действует', 'Пауза', 'Спорная'], 'Спорная', 'bad') + '<div style="height:12px"></div>' + field('Причина', 'Клиент говорит, что мопед украли; ждём полицию', hint='Обязательно. Пока статус стоит, недели не начисляются, автопривязка выписки не трогает аренду.'), '<a class="btn btn-primary btn-lg" href="#" style="width:100%">Поставить «Спорная»</a>'))
e3 = phone('<b>Отменить ошибочный возврат</b> — владелец, в течение 24 часов, с причиной (B5-08). Мопед снова в аренде, удержание и выдача залога отменяются вместе с возвратом; в журнал.',
  head('R-00512', left='back', right='dots'), '<div class="card"><div class="q-who">Возвращена 18.09 15:10</div></div>', tabbar('owner', 'rentals', 8),
  overlay=sheet_form('Отменить возврат R-00512?', field('Причина', 'Оформили не ту аренду') + '<div class="hint">Возможно до 19.09 15:10. Удержание 130 ₾ отменится; аренда снова действует с «оплачено по 17.09».</div>', '<a class="btn btn-primary btn-lg" href="#" style="width:100%">Отменить возврат</a>'))
e4 = phone('<b>Возвращена с долгом.</b> «Принять оплату» есть и после возврата; гасит недели и претензии, не залог (B5-08). Оплаченное наперёд после досрочного возврата — «переплата клиента» (умолчание Q18).',
  head('R-00512', left='back', right='dots'),
  '<div class="card"><div style="display:flex;justify-content:space-between"><div><div class="small muted">Возвращена</div><div class="hero">18.09</div></div><div style="text-align:right"><div class="small muted">Долг</div><div class="hero crit">270 ₾</div></div></div>'
  '<dl class="kv" style="margin-top:10px"><dt>Неделя 18.09–24.09</dt><dd class="money">150,00</dd><dt>Потеря ключа · остаток</dt><dd class="money">120,00</dd></dl></div>'
  '<div class="card"><div class="h3">Залог</div><dl class="kv"><dt>Получено</dt><dd class="money">180,00</dd><dt>Удержано · ремонт SV-00029</dt><dd class="money">50,00</dd><dt>Удержано · возврат</dt><dd class="money">130,00</dd><dt>На руках</dt><dd class="money">0,00</dd></dl></div>',
  tabbar('owner', 'rentals', 8), '<div class="action-bar"><a class="btn btn-primary btn-lg" href="#">Принять оплату</a></div>', body_cls='with-bar')
e5 = phone('<b>Залоги — «Ждут решения».</b> Новый сегмент в «Деньги → Залоги»: возвраты менеджеров без решения, дни ожидания. Та же строка — в «Сегодня» владельцев (сейчас прежнее «Сегодня», волна 4 — новое).',
  head('Деньги'), stabs(['Разобрать', 'Платежи', 'Касса', 'Выписки', 'Залоги'], 'Залоги') +
  '<div class="chips"><span class="chip on">Ждут решения 1</span><span class="chip">На руках 17</span><span class="chip">К выдаче 0</span></div>' +
  lc('Клиент Пример Д', 'R-00512 · вернул 18.09 · оформил Менеджер Пример', money('180 ₾') + '<div style="margin-top:6px"><a class="btn btn-sm btn-primary" href="#">Решить</a></div>'),
  tabbar('owner', 'money', 8))

page('wave-3-rental-actions.html', 'Волна 3 · Правка аренды, статусы, отмена возврата',
 'Что можно сделать с арендой после выдачи: поправить условия, поставить паузу или «спорную», отменить ошибочный возврат, принять долг после возврата; где владелец видит нерешённые залоги.',
 [('Волна', '3 · <code>docs/redesign/wave-3.md</code> §3.7'), ('Правила', '<code>rental.md</code>: «спорная аренда останавливает периоды», «досрочный возврат — неделя целиком»'), ('Закрывает', 'B4-08, B5-08, R9, B5-01 (где видно)'), ('Данные', 'Пример')],
 [('Телефон', e1 + e2 + e3 + e4 + e5)])
print('ok wave3')
