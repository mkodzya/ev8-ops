from proto_base import *
from p_today import grp

def steps(i, n, name):
    bars = ''.join('<i class="%s"></i>' % ('done' if k < i else 'cur' if k == i else '') for k in range(1, n + 1))
    return f'<div class="steps">{bars}<span>{i} из {n} · {name}</span></div>'

def wbar(primary, back=True, extra=''):
    b = f'<a class="btn btn-round" href="#">{ic("left")}</a>' if back else ''
    return f'<div class="action-bar bottom">{b}{extra}<a class="btn btn-primary btn-lg" href="#">{primary}</a></div>'

def wphone(caption, title, body, bar, overlay='', sync=''):
    return phone(caption, head(title, left='close', right=''), body, '', bar, overlay, 'bar-only', sync)

def field(label, inner, hint='', err='', cls=''):
    h = f'<div class="hint">{hint}</div>' if hint else ''
    e = f'<div class="ferr">{err}</div>' if err else ''
    return f'<label class="field"><span class="lbl">{label}</span><div class="input {cls}">{inner}</div>{e}{h}</label>'

N = 6
# ---------- PICKUP ----------
p1 = wphone('<b>1. Клиент.</b> Поиск по телефону или имени. Не нашли — «Новый клиент» раскрывается прямо в шаге: телефон (+995 подставлен), имя, личный номер, фото удостоверения; права — если есть (В2, ответы Kardu в книге).',
  'Выдача',
  steps(1, N, 'Клиент') +
  field('Телефон или имя', ic('search','i s') + '595 12', cls='focus') +
  '<a class="lcard" href="#"><div><div class="a">Клиент Пример Н</div><div class="b">+995 595 12 ·· ·· · документы есть</div></div><div class="r b">нет долга</div></a>' +
  '<div class="card" style="border:1px solid var(--accent)"><div class="h3" style="display:flex;gap:8px;align-items:center">' + ic('user','i s') + 'Новый клиент</div>' +
  field('Телефон', '<span class="muted">+995</span> 595 12 34 56') +
  field('Имя и фамилия', 'Клиент Пример Новый', hint='Как в удостоверении; второе написание — позже, в карточке') +
  field('Личный номер', '<span class="ph">как в удостоверении</span>') +
  '<span class="lbl" style="font:var(--text-label);color:var(--muted)">Удостоверение — нужно · права — если есть</span><div class="photos" style="margin-top:6px"><div class="photo">удост.</div><div class="photo add">' + ic('camera') + '<span class="small">права</span></div></div>'
  '</div>',
  wbar('Далее', back=False))

p1b = wphone('<b>1. Клиент с долгом.</b> Предупреждение с суммой. Менеджер дальше не идёт: выдаёт только владелец (В2). Владелец видит то же и кнопку «Выдать всё равно» с причиной.',
  'Выдача',
  steps(1, N, 'Клиент') +
  '<a class="lcard" href="#" style="border:1px solid var(--crit)"><div><div class="a">Клиент Пример Б</div><div class="b">+995 5·· ·· 22 31 · R-00488</div></div><div class="r money crit">долг 300 ₾</div></a>' +
  f'<div class="banner crit">{ic("alert","i s")}<div><b>У клиента долг 300 ₾</b> по аренде R-00488, просрочка 15 дней. Новую выдачу оформляет только владелец.</div></div>' +
  '<a class="btn" href="#" style="width:100%;margin-bottom:8px">Принять оплату долга</a><a class="btn btn-quiet" href="#" style="width:100%">Позвать владельца</a>',
  '<div class="action-bar bottom"><a class="btn btn-primary btn-lg" aria-disabled="true" href="#">Далее</a></div>')

def vrow(model, tail, place, state='available', word='Свободен', note='', off=False):
    style = ' style="opacity:.55"' if off else ''
    n = f'<div class="b crit">{note}</div>' if note else ''
    return f'<a class="lcard" href="#"{style}><div><div class="a">{model}</div><div class="b">{vin(tail)}</div>{n}</div><div class="r">{st(state, word)}<div class="b">{place}</div></div></a>'
p2 = wphone('<b>2. Мопед.</b> 4 последних знака VIN. Показаны свободные мопеды парка аренды и точка, где стоит. Мопед в сервисе или из парка продажи виден, но выбрать нельзя — с причиной.',
  'Выдача',
  steps(2, N, 'Мопед') +
  field('Последние 4 знака VIN', ic('search','i s') + '44', cls='focus') +
  vrow('XL1200 · чёрный', '4410', 'Шоурум Нуцубидзе') +
  vrow('Eagle · белый', '4471', 'Шоурум Нуцубидзе') +
  vrow('F-150 · серый', '4402', 'Мастерская', 'service', 'В сервисе', 'В ремонте SV-00031 — выдать нельзя', True) +
  vrow('S70 Pro Max · красный', '4455', 'Шоурум', 'available', 'Свободен', 'Парк продажи — в аренду не выдаётся (Q9)', True) +
  '<div class="hint">Нет VIN на руках? <a class="ok" href="#">Выдать без VIN с причиной</a> — аренда попадёт в «Без VIN».</div>',
  wbar('Далее'))

p3 = wphone('<b>3. Условия.</b> Тариф и залог подставлены из модели и настроек (R5, B4-05); меняет только владелец. Адрес ночной парковки обязателен (договор п.5). Батареи и зарядки 2 и 2.',
  'Выдача',
  steps(3, N, 'Условия') +
  '<div class="card"><dl class="kv"><dt>Мопед</dt><dd>XL1200 ···4410</dd><dt>Тариф в неделю</dt><dd class="money">150,00 ₾</dd><dt>Залог</dt><dd class="money">180,00 ₾</dd><dt>Выдача</dt><dd>сегодня, 17.09</dd><dt>Оплачено будет по</dt><dd>23.09</dd></dl></div>' +
  field('Адрес ночной парковки', 'Тбилиси, ул. Пример, 1', hint='Мопед ночует только здесь, батарея на ночь снимается') +
  '<div class="field"><span class="lbl">Батареи и зарядки</span><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">'
  '<div class="input" style="justify-content:space-between">' + ic('battery','i s') + '<b>2</b><span class="muted">− +</span></div>'
  '<div class="input" style="justify-content:space-between">зарядки <b>2</b><span class="muted">− +</span></div></div><div class="hint">В шоуруме 7 батарей — после выдачи останется 5</div></div>' +
  field('Плановый возврат', '<span class="ph">не указан</span>', hint='Если указать — опоздание посчитается по договору (Q17)'),
  wbar('Далее'))

p4 = wphone('<b>4. Акт выдачи.</b> Пробег и фото обязательны (B4-06). Фото грузятся в фоне; без связи ждут на телефоне с отметкой часов.',
  'Выдача',
  steps(4, N, 'Акт') +
  field('Пробег, км', '1 234', cls='focus') +
  '<div class="field"><span class="lbl">Фото: спереди, сзади, слева, справа, приборы</span><div class="photos"><div class="photo">✓</div><div class="photo">✓</div><div class="photo">✓</div><div class="photo">' + ic('clock','i s') + '</div><div class="photo add">' + ic('camera') + '</div></div><div class="hint">4 из 5 · одно ждёт связи</div></div>' +
  field('Состояние, повреждения', '<span class="ph">царапина на левом зеркале</span>'),
  wbar('Далее'))

p5 = wphone('<b>5. Оплата.</b> Сумма подсказана и разложена. Канал — три крупные кнопки. Карта: сразу видно, сколько зачислит банк и что комиссия — расход компании. «Позже» — аренда «ждёт оплаты» и строка в «Сегодня» (Q7).',
  'Выдача',
  steps(5, N, 'Оплата') +
  '<div class="card"><div class="small muted">К оплате</div><div class="hero">330,00 ₾</div><dl class="kv" style="margin-top:8px"><dt>Неделя 17.09–23.09</dt><dd class="money">150,00</dd><dt>Залог</dt><dd class="money">180,00</dd></dl></div>' +
  '<div class="field"><span class="lbl">Как платит</span><div class="seg3"><span>Наличные</span><span class="on">Карта</span><span>Позже</span></div></div>' +
  f'<div class="banner info">{ic("money","i s")}<div>Банк зачислит <b class="mono">325,05 ₾</b>. Комиссия 4,95 ₾ — расход компании; клиент заплатил 330.</div></div>' +
  field('Сумма', '330,00 ₾', hint='Меньше — частичная оплата: сначала залог, потом неделя, как сейчас (умолчание Q6)'),
  wbar('К итогу'))

p6 = wphone('<b>6. Итог.</b> Каждая строка ведёт на свой шаг. Одна кнопка — одна операция; повторное нажатие ничего не создаёт (B2-01).',
  'Выдача',
  steps(6, N, 'Итог') +
  '<div class="card"><dl class="kv">'
  '<dt>Клиент</dt><dd>Клиент Пример Новый ›</dd><dt>Мопед</dt><dd>XL1200 ···4410 ›</dd><dt>Тариф · залог</dt><dd>150 · 180 ₾ ›</dd>'
  '<dt>Ночёвка</dt><dd>ул. Пример, 1 ›</dd><dt>Комплект</dt><dd>2 батареи · 2 зарядки ›</dd><dt>Пробег · фото</dt><dd>1 234 км · 5 фото ›</dd>'
  '<dt>Оплата</dt><dd><b>330,00 ₾ картой</b> ›</dd></dl></div>'
  '<div class="hint">Договор и акт выдачи — PDF на грузинском и английском, соберутся после подтверждения.</div>',
  '<div class="action-bar bottom"><a class="btn btn-round" href="#">' + ic('left') + '</a><a class="btn btn-primary btn-lg sending" href="#">Записываем…</a></div>')

p7 = phone('<b>7. Готово — следующее действие.</b> Договор и акт собраны из введённого — второй раз в Signify ничего не вводится (В9, D17). «Отправить на подпись» уходит клиенту по SMS через Signify, если его API доступен; иначе — «Подписать на экране». Статус подписи виден здесь и в аренде.',
  head('Выдача', left='close', right=''),
  f'<div class="empty" style="padding:28px 12px 16px"><div class="big">{ic("check")}</div><h4>Выдано · R-00520</h4><p>Клиент Пример Новый · XL1200 ···4410<br>Оплачено по 23.09 · залог 180 ₾ получен</p></div>' +
  '<div class="card"><a class="lcard" href="#" style="margin:0;padding:10px 0"><div><div class="a">' + ic('file','i s') + ' Договор аренды</div><div class="b">ka / en · PDF</div></div><div class="r"><span class="st st-waiting"><i class="mk"></i>не подписан</span></div></a><div class="hr" style="margin:0"></div>'
  '<a class="lcard" href="#" style="margin:0;padding:10px 0"><div><div class="a">' + ic('file','i s') + ' Акт выдачи</div><div class="b">ka / en · PDF · 5 фото</div></div><div class="r"><span class="st st-waiting"><i class="mk"></i>не подписан</span></div></a>'
  '<div style="display:flex;gap:8px;margin-top:10px"><a class="btn btn-primary" href="#" style="flex:1">' + ic('send','i s') + 'Отправить на подпись</a><a class="btn" href="#">На экране</a></div>'
  '<div class="hint">SMS клиенту на +995 595 12 34 56 · через Signify</div></div>' +
  '<a class="btn btn-quiet" href="#" style="width:100%;margin:4px 0">' + ic('chat','i s') + 'Написать клиенту в WhatsApp</a>',
  '', '<div class="action-bar bottom"><a class="btn" href="#">На «Сегодня»</a><a class="btn btn-primary btn-lg" href="#">Открыть аренду</a></div>', body_cls='bar-only')

p_draft = wphone('<b>Черновик.</b> Мастер открыт снова после перезагрузки или выхода из сети — «Продолжить?». Черновик живёт на телефоне до выхода из системы (B4-02).',
  'Выдача',
  f'<div class="banner ok">{ic("clock","i s")}<div><b>Незаконченная выдача от 14:20</b><br>Клиент Пример Новый · XL1200 ···4410 · шаг 4 из 6</div></div>'
  '<a class="btn btn-primary btn-lg" href="#" style="width:100%;margin-bottom:8px">Продолжить</a><a class="btn btn-quiet" href="#" style="width:100%">Начать заново</a>',
  '')
p_fail = wphone('<b>Не записалось.</b> Сервер отказал: мопед уже выдал другой менеджер. Причина словами и действие. Введённое не теряется.',
  'Выдача',
  steps(6, N, 'Итог') +
  f'<div class="banner crit">{ic("alert","i s")}<div><b>XL1200 ···4410 уже в аренде</b> — его выдал Менеджер Пример в 14:31 (R-00519). Выберите другой мопед, остальное сохранится.</div></div>'
  '<div class="card"><dl class="kv"><dt>Клиент</dt><dd>Клиент Пример Новый</dd><dt>Мопед</dt><dd class="crit">XL1200 ···4410 ›</dd><dt>Оплата</dt><dd>330,00 ₾ картой</dd></dl></div>',
  '<div class="action-bar bottom"><a class="btn btn-round" href="#">' + ic('left') + '</a><a class="btn btn-lg failed" href="#">Выбрать другой мопед</a></div>')
p_off = wphone('<b>Нет связи на подтверждении.</b> Операция сохранена на телефоне с ключом и уйдёт сама; в «Сегодня» — «Ждут отправки». Если очередь в волне 1 дорога — минимум: черновик и «Повторить» (blueprint §3.2).',
  'Выдача',
  steps(6, N, 'Итог') +
  '<div class="card"><dl class="kv"><dt>Клиент</dt><dd>Клиент Пример Новый</dd><dt>Мопед</dt><dd>XL1200 ···4410</dd><dt>Оплата</dt><dd>330,00 ₾ наличными</dd></dl></div>',
  '<div class="action-bar bottom"><a class="btn btn-lg" href="#">' + ic('clock','i s') + 'Уйдёт при связи</a></div>',
  sync=f'<div class="syncbar">{ic("cloud","i s")}Нет связи — выдача сохранена на телефоне</div>')

# desktop pickup
dp = ('<div class="d-head"><h2>Выдача мопеда</h2><span class="sub">шаг 5 из 6 · оплата</span><div class="acts"><a class="btn btn-sm" href="#">Сохранить черновик и закрыть</a></div></div>'
 '<div class="d-body"><div class="cols" style="grid-template-columns:220px 1fr 340px">'
 '<ol style="margin:0;padding-left:18px;font:var(--text-body-sm);line-height:2.2"><li class="ok">Клиент ✓</li><li class="ok">Мопед ✓</li><li class="ok">Условия ✓</li><li class="ok">Акт ✓</li><li><b>Оплата</b></li><li class="muted">Итог</li></ol>'
 '<div class="card" style="padding:20px"><div class="small muted">К оплате</div><div class="hero">330,00 ₾</div>'
 '<dl class="kv" style="max-width:360px;margin:8px 0 16px"><dt>Неделя 17.09–23.09</dt><dd class="money">150,00</dd><dt>Залог</dt><dd class="money">180,00</dd></dl>'
 '<div class="field" style="max-width:420px"><span class="lbl">Как платит</span><div class="seg3"><span>Наличные</span><span class="on">Карта</span><span>Позже</span></div></div>'
 f'<div class="banner info" style="max-width:520px">{ic("money","i s")}<div>Банк зачислит <b class="mono">325,05 ₾</b>. Комиссия 4,95 ₾ — расход компании.</div></div>'
 '<div style="display:flex;gap:8px;margin-top:16px"><a class="btn" href="#">Назад</a><a class="btn btn-primary" href="#">К итогу</a></div></div>'
 '<div class="card"><div class="h3">Выдача</div><dl class="kv"><dt>Клиент</dt><dd>Клиент Пример Новый</dd><dt>Мопед</dt><dd>XL1200 ···4410</dd><dt>Точка</dt><dd>Шоурум</dd><dt>Тариф</dt><dd class="money">150,00 ₾</dd><dt>Залог</dt><dd class="money">180,00 ₾</dd><dt>Ночёвка</dt><dd>ул. Пример, 1</dd><dt>Комплект</dt><dd>2 + 2</dd><dt>Пробег</dt><dd>1 234 км</dd></dl></div>'
 '</div></div>')
d1 = desk('<b>Ноутбук.</b> Тот же мастер: шаги слева, текущий шаг в центре, итог справа всегда виден. Главное действие справа внизу шага.', rail('rentals', 'owner'), dp)

notes = ('<h2>Число действий</h2><p>≈ 18 действий, один заход, цель ≤ 2 минут (С1). Сейчас: мастер 5 шагов + 4 действия оплаты в карточке + новый клиент отдельной страницей из 10 полей.</p>'
 '<h2>Что закрывает</h2><table><tr><th>ID</th><th>Как</th></tr>'
 '<tr><td>B4-01, R1</td><td>Оплата — шаг мастера; «позже» = «ждёт оплаты», а не «просрочена»</td></tr>'
 '<tr><td>B4-02, R2</td><td>Черновик на телефоне, «Продолжить?»</td></tr>'
 '<tr><td>B4-03, R3</td><td>Поиск клиента, новый клиент внутри шага, долг — предупреждение, выдаёт только владелец</td></tr>'
 '<tr><td>B4-04, R4</td><td>Только свободные парка аренды, точка видна, недоступные — с причиной</td></tr>'
 '<tr><td>B4-05, R5</td><td>Тариф и залог из модели и настроек</td></tr>'
 '<tr><td>B4-06, R6</td><td>Пробег и фото обязательны; адрес ночёвки обязателен</td></tr>'
 '<tr><td>B4-07, R11</td><td>«Готово» с договором, WhatsApp и переходом в аренду</td></tr>'
 '<tr><td>B2-01, M1</td><td>Кнопка «Записываем…», одна операция; «Не записалось» с причиной</td></tr></table>'
 '<h2>Решения Mika</h2><ul><li><b>В9 — подпись без двойного ввода.</b> PDF собирает EV8 Ops, на подпись уходит из «Готово»: через API Signify (доступность на тарифе и ключ — Mika) или на экране телефона.</li><li><b>В10 — батареи.</b> В шаге «Условия» видно, сколько батарей останется в шоуруме.</li></ul><h2>Умолчания ТЗ v2</h2><ul><li>Q6 порядок гашения при частичной оплате — в прототипе умолчание ТЗ: сначала залог, потом неделя.</li><li>Q9 Luyuan в аренду — в прототипе умолчание: нельзя.</li><li>Q17 плановая дата возврата — не обязательна.</li></ul>')

page('04-pickup.html', 'Выдача мопеда',
 'Мастер из шести шагов на телефоне: клиент, мопед, условия, акт, оплата, итог — и «Готово» со следующим действием. Всё за один заход.',
 [('Сценарий', 'С1 — выдача новому клиенту с первым платежом, менеджер, телефон'), ('Схема', 'blueprint §2.4 С1, D7, D10, D11; принципы №4–№6'), ('Правила', 'книга <code>rental.md</code> (выдача, VIN из парка), <code>money.md</code> (эквайринг −1,5 %), договор п.5 (ночёвка)'), ('Данные', 'Пример; адрес ночёвки — выдуманный')],
 [('Шаги', p1 + p1b + p2 + p3 + p4 + p5 + p6 + p7), ('Состояния', p_draft + p_fail + p_off), ('Ноутбук', d1)], notes)
if __name__ == '__main__': print('ok pickup')
