/**
 * EV8 — учёт работ механика: Telegram-бот → Google Таблица.
 * Временное решение для теста, потом переносится в EV8 Ops.
 * Версия 1.0 · 11.10.2026
 *
 * Как поставить — лист «Инструкция» (его создаёт меню «EV8 бот → 1. Создать листы»).
 */

// ---------------------------------------------------------------- константы

const TZ = 'Asia/Tbilisi';

const SH = {
  HELP: 'Инструкция',
  SETTINGS: 'Настройки',
  MECH: 'Механики',
  CATALOG: 'Справочник работ',
  MOPEDS: 'Мопеды',
  TICKETS: 'Тикеты',
  WORKS: 'Работы',
  PARTS: 'Запчасти по тикетам',
  PAYOUTS: 'К оплате',
  PAYLOG: 'Журнал выплат',
};

const STATUS = { OPEN: 'Открыт', DONE: 'Выполнен', PAID: 'Оплачен', REJECTED: 'Отклонён' };

// Тикеты
const T = { ID: 1, OPENED: 2, MECH: 3, VIN: 4, VIN_OK: 5, REASON: 6, NOTE: 7, STATUS: 8, APPROVED: 9,
  APPROVER: 10, APPROVED_AT: 11, CLOSED: 12, DOWNTIME: 13, SUM: 14, PHOTOS: 15, PAID_AT: 16, PAYOUT: 17 };
const T_HEAD = ['Тикет', 'Открыт', 'Механик', 'VIN', 'VIN в списке', 'Причина', 'Комментарий', 'Статус',
  'Согласовано', 'Согласовал', 'Когда согласовано', 'Закрыт', 'Простой, ч', 'Сумма, GEL', 'Фото', 'Оплачено', 'Выплата'];

// Работы
const W = { TICKET: 1, DATE: 2, MECH: 3, VIN: 4, CODE: 5, NAME: 6, QTY: 7, MIN: 8, RATE: 9, SUM: 10,
  T_STATUS: 11, T_APPROVED: 12, PAYABLE: 13, WEEK: 14 };
const W_HEAD = ['Тикет', 'Дата', 'Механик', 'VIN', 'Код', 'Работа', 'Кол-во', 'Норма, мин/ед', 'Ставка, GEL/ч',
  'Сумма, GEL', 'Статус тикета', 'Согласовано', 'К оплате', 'Неделя (пн)'];

const P_HEAD = ['Тикет', 'Дата', 'Механик', 'VIN', 'Артикул (SKU)', 'Запчасть', 'Кол-во', 'Списано на склад'];
const PAYLOG_HEAD = ['Выплата', 'Дата', 'Механик', 'Сумма, GEL', 'Работ', 'Тикеты', 'Отметил'];
const CAT_HEAD = ['Код', 'Категория', 'Название (ka)', 'Название (ru)', 'Норма, мин', 'Активна', 'Комментарий'];
const MECH_HEAD = ['Имя', 'Telegram user_id', 'Своя ставка, GEL/ч', 'Активен', 'Имя для склада'];
const MOP_HEAD = ['VIN', 'Модель', 'Госномер', 'Активен', 'Заметки'];

const REASONS = [
  ['WEAR', 'ცვეთა', 'Износ'],
  ['ACC', 'ავარია', 'ДТП'],
  ['RENTER', 'მძღოლის ბრალი', 'Вина арендатора'],
  ['WARR', 'საგარანტიო', 'Гарантия'],
  ['PLAN', 'გეგმიური სერვისი', 'Плановое ТО'],
];

const BTN = {
  NEW: '🔧 ახალი რემონტი',
  CLOSE: '✅ რემონტის დასრულება',
  BAL: '💰 ჩემი ბალანსი',
};

const MAX_PHOTOS = 5;

// ---------------------------------------------------------------- меню

function onOpen() {
  SpreadsheetApp.getUi().createMenu('EV8 бот')
    .addItem('1. Создать листы', 'setupSheets')
    .addItem('2. Ввести токен бота', 'promptToken')
    .addItem('3. Подключить бота (после публикации)', 'connectWebhook')
    .addItem('4. Включить отчёт по понедельникам', 'installWeeklyTrigger')
    .addSeparator()
    .addItem('Отчёт к оплате — сейчас', 'weeklyReport')
    .addItem('Проверить подключение', 'checkStatus')
    .addToUi();
}

function promptToken() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('Токен бота', 'Вставьте токен от @BotFather (вид 123456:ABC…).', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const token = r.getResponseText().trim();
  if (!/^\d+:[\w-]{20,}$/.test(token)) { ui.alert('Не похоже на токен бота. Проверьте и вставьте ещё раз.'); return; }
  PropertiesService.getScriptProperties().setProperty('BOT_TOKEN', token);
  const me = tg_('getMe', {});
  if (me && me.ok) {
    setSetting_('BOT_USERNAME', me.result.username);
    ui.alert('Токен сохранён. Бот: @' + me.result.username + '\nДальше: «Начать развёртывание → Веб-приложение», затем пункт 3 меню.');
  } else {
    ui.alert('Telegram не принял токен. Проверьте его в @BotFather.');
  }
}

function connectWebhook() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('Адрес для Telegram',
    'Вставьте адрес посредника Cloudflare (https://….workers.dev).\n' +
    'Прямой адрес веб-приложения (…/exec) Telegram принимает плохо: Google отвечает ему редиректом 302, и очередь сообщений застревает.',
    ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const url = r.getResponseText().trim().replace(/\/+$/, '');
  if (!/^https:\/\/\S+$/.test(url)) { ui.alert('Нужен адрес, начинающийся с https://'); return; }
  if (/script\.google\.com/.test(url) &&
      ui.alert('Это прямой адрес Apps Script', 'С ним бот отвечает только на первое сообщение. Всё равно подключить?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  const res = tg_('setWebhook', { url: url, allowed_updates: ['message', 'callback_query'], drop_pending_updates: true });
  ui.alert(res && res.ok ? 'Бот подключён. Напишите ему /myid, чтобы узнать свой ID.' : 'Ошибка: ' + JSON.stringify(res));
}

function checkStatus() {
  const info = tg_('getWebhookInfo', {});
  const me = tg_('getMe', {});
  const tz = Session.getScriptTimeZone();
  const w = info && info.ok ? info.result : {};
  const err = w.last_error_message
    ? w.last_error_message + ' (' + Utilities.formatDate(new Date(w.last_error_date * 1000), TZ, 'dd.MM HH:mm') + ')'
    : 'нет';
  SpreadsheetApp.getUi().alert(
    'Бот: ' + (me && me.ok ? '@' + me.result.username : 'нет токена') + '\n' +
    'Адрес: ' + (w.url || 'не подключён') + '\n' +
    'Ждут доставки: ' + (w.pending_update_count != null ? w.pending_update_count : '—') + '\n' +
    'Последняя ошибка: ' + err + '\n' +
    'Часовой пояс проекта: ' + tz + (tz === TZ ? '' : '  ⚠️ поставьте Asia/Tbilisi в настройках проекта') +
    (/302/.test(err) ? '\n\n⚠️ 302 — Telegram не принимает ответ Apps Script. Подключите через посредника Cloudflare (пункт 3 меню).' : ''));
}

function installWeeklyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'weeklyReport') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('weeklyReport').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(10).create();
  const tz = Session.getScriptTimeZone();
  SpreadsheetApp.getUi().alert('Готово: отчёт к оплате приходит по понедельникам в 10:00 (' + tz + ').' +
    (tz === TZ ? '' : '\n⚠️ Часовой пояс проекта не Тбилиси — поменяйте в «Настройки проекта».'));
}

// ---------------------------------------------------------------- вебхук

function doPost(e) {
  try {
    const u = JSON.parse(e.postData.contents);
    const cache = CacheService.getScriptCache();
    const key = 'u' + u.update_id;
    if (cache.get(key)) return ok_();           // Telegram повторяет доставку — отбрасываем
    cache.put(key, '1', 21600);
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(25000)) { cache.remove(key); return ok_(); }
    try { handleUpdate_(u); } finally { lock.releaseLock(); }
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
  }
  return ok_();
}

function doGet() { return ContentService.createTextOutput('EV8 bot is running'); }

function ok_() { return ContentService.createTextOutput('ok'); }

function handleUpdate_(u) {
  if (u.callback_query) return handleCallback_(u.callback_query);
  if (u.message) return handleMessage_(u.message);
}

// ---------------------------------------------------------------- сообщения

function handleMessage_(m) {
  const chatId = m.chat.id;
  const userId = m.from.id;
  const text = (m.text || '').trim();

  if (/^\/myid/.test(text)) {
    send_(chatId, 'chat_id: <code>' + chatId + '</code>\nuser_id: <code>' + userId + '</code>');
    return;
  }
  if (m.chat.type !== 'private') return;

  const mech = findMechanic_(userId);
  const approver = isApprover_(userId);
  const owner = isOwner_(userId);

  if (text === '/report' && owner) { weeklyReport(); return; }

  if (!mech) {
    if (approver || owner) {
      send_(chatId, 'Вы администратор. Сюда приходят заявки на согласование' + (owner ? ' и отчёт к оплате (/report — прислать сейчас).' : '.'));
      return;
    }
    send_(chatId, 'თქვენ ჯერ არ ხართ დამატებული სისტემაში.\nთქვენი ID: <code>' + userId + '</code>\nგადაეცით ეს ნომერი ადმინისტრატორს.');
    const cache = CacheService.getScriptCache();
    if (!cache.get('unk' + userId)) {
      cache.put('unk' + userId, '1', 21600);
      notify_('👤 Боту пишет незнакомый пользователь: ' + esc_(fullName_(m.from)) + ', user_id <code>' + userId +
        '</code>. Если это механик — впишите ID в лист «Механики».');
    }
    return;
  }

  if (/^\/start/.test(text)) {
    const param = text.split(/\s+/)[1];
    if (param) { startNew_(mech, chatId, param); return; }
    clearState_(chatId);
    send_(chatId, 'გამარჯობა, ' + esc_(mech.name) + '! 👋\nაირჩიეთ მოქმედება ქვემოთ.', mainKb_());
    return;
  }
  if (text === '/cancel' || text === '/stop') {
    clearState_(chatId);
    send_(chatId, 'გაუქმდა.', mainKb_());
    return;
  }
  if (text === BTN.NEW || text === '/new') { startNew_(mech, chatId, null); return; }
  if (text === BTN.CLOSE || text === '/close') { startClose_(mech, chatId); return; }
  if (text === BTN.BAL || text === '/balance') { sendBalance_(mech, chatId); return; }

  const st = getState_(chatId);
  if (!st) { send_(chatId, 'აირჩიეთ მოქმედება ქვემოთ 👇', mainKb_()); return; }

  switch (st.step) {
    case 'vin':
      if (!text) { send_(chatId, 'ჩაწერეთ VIN ტექსტით.'); return; }
      resolveVin_(chatId, st, text);
      return;

    case 'photos_before':
    case 'photos_after':
      if (!m.photo) { send_(chatId, 'გთხოვთ, გამოგზავნოთ ფოტო 📷'); return; }
      if (st.photos.length >= MAX_PHOTOS) { send_(chatId, 'მაქსიმუმ ' + MAX_PHOTOS + ' ფოტო. დააჭირეთ „შემდეგი“.'); return; }
      st.photos.push(m.photo[m.photo.length - 1].file_id);
      setState_(chatId, st);
      send_(chatId, '📷 ფოტო მიღებულია (' + st.photos.length + ').',
        ikb_([[['➡️ შემდეგი', st.step === 'photos_before' ? 'nx:pb' : 'nx:pa']]]));
      return;

    case 'other_work':
      if (m.voice) {
        st.voices.push(m.voice.file_id);
        st.works.push({ code: 'OTHER', ka: '🎤 ხმოვანი აღწერა', ru: 'Работа вне списка (голосовое)', min: 0, qty: 1 });
      } else if (text) {
        st.works.push({ code: 'OTHER', ka: text, ru: 'Вне списка: ' + text, min: 0, qty: 1 });
      } else { send_(chatId, 'აღწერეთ სამუშაო ტექსტით ან ხმოვანით.'); return; }
      st.step = 'works';
      setState_(chatId, st);
      askMoreWorks_(chatId, st);
      return;

    case 'comment':
      if (m.voice) { st.voices.push(m.voice.file_id); st.note = (st.note ? st.note + ' ' : '') + '[голосовое]'; }
      else if (text) st.note = text;
      else { send_(chatId, 'ჩაწერეთ კომენტარი ან დააჭირეთ „გამოტოვება“.'); return; }
      setState_(chatId, st);
      showSummary_(chatId, st, mech);
      return;

    case 'other_part':
      if (!text) { send_(chatId, 'ჩაწერეთ ნაწილის დასახელება ტექსტით.'); return; }
      st.parts.push({ sku: '', name: text, qty: 1 });
      st.step = 'parts';
      setState_(chatId, st);
      askParts_(chatId, st);
      return;

    default:
      send_(chatId, 'გამოიყენეთ ღილაკები ზემოთ ☝️ ან /cancel გასაუქმებლად.');
  }
}

// ---------------------------------------------------------------- кнопки

const STEP_FOR = {
  v: 'vin', vk: 'vin', r: 'reason',
  c: 'works', w: 'works', ow: 'works', cb: 'works', wd: 'works', wm: 'works', wu: 'works',
  q: 'qty', cs: 'comment', ok: 'confirm',
  t: 'pick_ticket', p: 'parts', po: 'parts', pd: 'parts', pu: 'parts', pq: 'pqty', ok2: 'confirm_close',
};

function handleCallback_(cq) {
  const data = cq.data || '';
  const chatId = cq.message.chat.id;
  const msgId = cq.message.message_id;
  const key = data.split(':')[0];

  if (key === 'a' || key === 'x' || key === 'pay' || key === 'noop') return adminCallback_(cq);

  const mech = findMechanic_(cq.from.id);
  if (!mech) { answer_(cq, '—'); return; }

  if (key === 'cn') {                       // отмена с любого шага
    answer_(cq);
    clearKb_(chatId, msgId);
    clearState_(chatId);
    send_(chatId, 'გაუქმდა.', mainKb_());
    return;
  }

  const st = getState_(chatId);
  const need = key === 'nx' ? (data === 'nx:pb' ? 'photos_before' : 'photos_after') : STEP_FOR[key];
  if (!st || !need || st.step !== need) {
    answer_(cq, 'ეს ღილაკი აღარ მოქმედებს.');
    clearKb_(chatId, msgId);
    return;
  }
  const arg = data.slice(key.length + 1);

  // фото: без фото дальше не пускаем, кнопку оставляем
  if (key === 'nx') {
    if (!st.photos.length) { answer_(cq, 'ჯერ გამოგზავნეთ მინიმუმ ერთი ფოტო.', true); return; }
    answer_(cq);
    clearKb_(chatId, msgId);
    if (st.flow === 'new') askReason_(chatId, st); else askParts_(chatId, st);
    return;
  }

  answer_(cq);
  clearKb_(chatId, msgId);

  switch (key) {
    case 'v':
      st.vin = arg; st.vinOk = true;
      askPhotos_(chatId, st, 'photos_before');
      return;
    case 'vk':
      if (arg === '1') { st.vin = st.vinCandidate; st.vinOk = false; askPhotos_(chatId, st, 'photos_before'); }
      else { setState_(chatId, st); send_(chatId, 'ჩაწერეთ VIN თავიდან:'); }
      return;
    case 'r':
      st.reason = arg;
      askCategory_(chatId, st);
      return;
    case 'c': {
      const cat = st.cats[Number(arg)];
      const items = catalog_().filter(function (x) { return x.cat === cat; });
      if (!items.length) { askCategory_(chatId, st); return; }
      const rows = items.map(function (x) { return [[x.ka + ' · ' + fmtMin_(x.min) + ' წთ', 'w:' + x.code]]; });
      rows.push([['⬅️ უკან', 'cb']]);
      setState_(chatId, st);
      send_(chatId, '<b>' + esc_(cat) + '</b>\nაირჩიეთ სამუშაო:', ikb_(rows));
      return;
    }
    case 'cb':
      askCategory_(chatId, st);
      return;
    case 'w': {
      const item = catalog_().filter(function (x) { return x.code === arg; })[0];
      if (!item) { askCategory_(chatId, st); return; }
      st.pending = item; st.step = 'qty';
      setState_(chatId, st);
      send_(chatId, '<b>' + esc_(item.ka) + '</b>\nრამდენჯერ / რამდენი ერთეული?',
        ikb_([[['1', 'q:1'], ['2', 'q:2'], ['3', 'q:3'], ['4', 'q:4']]]));
      return;
    }
    case 'q': {
      const it = st.pending;
      st.works.push({ code: it.code, ka: it.ka, ru: it.ru, min: it.min, qty: Number(arg) || 1 });
      st.pending = null; st.step = 'works';
      setState_(chatId, st);
      askMoreWorks_(chatId, st);
      return;
    }
    case 'ow':
      st.step = 'other_work';
      setState_(chatId, st);
      send_(chatId, 'მოკლედ აღწერეთ სამუშაო (ტექსტით ან ხმოვანი შეტყობინებით).\nნორმას დაადგენს ადმინისტრატორი.');
      return;
    case 'wm':
      askCategory_(chatId, st);
      return;
    case 'wu':
      st.works.pop();
      setState_(chatId, st);
      if (st.works.length) askMoreWorks_(chatId, st); else askCategory_(chatId, st);
      return;
    case 'wd':
      if (!st.works.length) { askCategory_(chatId, st); return; }
      st.step = 'comment';
      setState_(chatId, st);
      send_(chatId, 'დაამატეთ მოკლე კომენტარი (ტექსტით ან ხმოვანით) ან დააჭირეთ „გამოტოვება“.',
        ikb_([[['⏭ გამოტოვება', 'cs']]]));
      return;
    case 'cs':
      showSummary_(chatId, st, mech);
      return;
    case 'ok':
      submitTicket_(mech, chatId, st);
      return;
    case 't':
      beginClose_(mech, chatId, arg);
      return;
    case 'p': {
      const part = st.partsList[Number(arg)];
      if (!part) { askParts_(chatId, st); return; }
      st.ppending = part; st.step = 'pqty';
      setState_(chatId, st);
      send_(chatId, '<b>' + esc_(part[1]) + '</b>\nრამდენი ცალი?',
        ikb_([[['1', 'pq:1'], ['2', 'pq:2'], ['3', 'pq:3'], ['4', 'pq:4']]]));
      return;
    }
    case 'pq':
      st.parts.push({ sku: st.ppending[0], name: st.ppending[1], qty: Number(arg) || 1 });
      st.ppending = null; st.step = 'parts';
      setState_(chatId, st);
      askParts_(chatId, st);
      return;
    case 'po':
      st.step = 'other_part';
      setState_(chatId, st);
      send_(chatId, 'ჩაწერეთ ნაწილის დასახელება და რაოდენობა.');
      return;
    case 'pu':
      st.parts.pop();
      setState_(chatId, st);
      askParts_(chatId, st);
      return;
    case 'pd':
      showCloseSummary_(chatId, st);
      return;
    case 'ok2':
      closeTicket_(mech, chatId, st);
      return;
  }
}

// ---------------------------------------------------------------- новая заявка

function startNew_(mech, chatId, vinParam) {
  const st = { flow: 'new', step: 'vin', photos: [], works: [], voices: [], note: '' };
  setState_(chatId, st);
  if (vinParam) { resolveVin_(chatId, st, vinParam); return; }
  send_(chatId, 'ჩაწერეთ მოპედის VIN კოდი (სრული ან ბოლო 6 სიმბოლო).', cancelKb_());
}

function resolveVin_(chatId, st, input) {
  const q = String(input).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (q.length < 4) { send_(chatId, 'VIN ძალიან მოკლეა — ჩაწერეთ მინიმუმ 4 სიმბოლო.'); return; }
  const list = mopeds_();
  if (!list.length) {                       // список мопедов ещё пуст — принимаем как есть
    st.vin = q; st.vinOk = false;
    askPhotos_(chatId, st, 'photos_before');
    return;
  }
  let matches = list.filter(function (v) { return v === q; });
  if (!matches.length) matches = list.filter(function (v) { return v.slice(-q.length) === q; });
  if (matches.length === 1) {
    st.vin = matches[0]; st.vinOk = true;
    askPhotos_(chatId, st, 'photos_before');
  } else if (matches.length > 1) {
    setState_(chatId, st);
    send_(chatId, 'რამდენიმე მოპედი ემთხვევა. აირჩიეთ სწორი:',
      ikb_(matches.slice(0, 8).map(function (v) { return [[v, 'v:' + v]]; })));
  } else {
    st.vinCandidate = q;
    setState_(chatId, st);
    send_(chatId, 'VIN <b>' + esc_(q) + '</b> სიაში ვერ მოიძებნა. მაინც გავაგრძელოთ?',
      ikb_([[['✔️ დიახ, გავაგრძელოთ', 'vk:1'], ['✏️ თავიდან', 'vk:0']]]));
  }
}

function askPhotos_(chatId, st, step) {
  st.step = step;
  setState_(chatId, st);
  const head = step === 'photos_before'
    ? 'მოპედი: <b>' + esc_(st.vin) + '</b>\n\nგამოგზავნეთ დაზიანების ფოტო (1–' + MAX_PHOTOS + ').'
    : 'გამოგზავნეთ ფოტო შეკეთების შემდეგ (1–' + MAX_PHOTOS + ').';
  send_(chatId, head + '\nროცა მორჩებით, დააჭირეთ „შემდეგი“.');
}

function askReason_(chatId, st) {
  st.step = 'reason';
  setState_(chatId, st);
  const btns = REASONS.map(function (r) { return [r[1], 'r:' + r[0]]; });
  const rows = [];
  for (let i = 0; i < btns.length; i += 2) rows.push(btns.slice(i, i + 2));
  send_(chatId, 'რა არის დაზიანების მიზეზი?', ikb_(rows));
}

function askCategory_(chatId, st) {
  const cats = [];
  catalog_().forEach(function (x) { if (cats.indexOf(x.cat) < 0) cats.push(x.cat); });
  st.cats = cats; st.step = 'works';
  setState_(chatId, st);
  const rows = cats.map(function (c, i) { return [[c, 'c:' + i]]; });
  rows.push([['📝 სხვა სამუშაო (სიაში არ არის)', 'ow']]);
  if (st.works.length) rows.push([['✔️ სამუშაოები მზადაა', 'wd']]);
  send_(chatId, (st.works.length ? worksText_(st.works) + '\n\n' : '') + 'აირჩიეთ სამუშაოს კატეგორია:', ikb_(rows));
}

function askMoreWorks_(chatId, st) {
  send_(chatId, worksText_(st.works), ikb_([
    [['➕ კიდევ სამუშაო', 'wm']],
    [['↩️ ბოლოს წაშლა', 'wu'], ['✔️ მზადაა', 'wd']],
  ]));
}

function worksText_(works) {
  return '<b>არჩეული სამუშაოები:</b>\n' + works.map(function (w) {
    return '• ' + esc_(w.ka) + (w.qty > 1 ? ' ×' + w.qty : '') + ' — ' +
      (w.code === 'OTHER' ? 'ნორმა მოგვიანებით' : fmtMin_(w.min * w.qty) + ' წთ');
  }).join('\n');
}

function showSummary_(chatId, st, mech) {
  st.step = 'confirm';
  setState_(chatId, st);
  const rate = mechRate_(mech);
  const mins = st.works.reduce(function (s, w) { return s + w.min * w.qty; }, 0);
  const reason = REASONS.filter(function (r) { return r[0] === st.reason; })[0];
  const txt = '📋 <b>შეამოწმეთ რემონტი</b>\n' +
    'მოპედი: <b>' + esc_(st.vin) + '</b>' + (st.vinOk ? '' : ' ⚠️') + '\n' +
    'მიზეზი: ' + (reason ? reason[1] : '—') + '\n\n' +
    worksText_(st.works) + '\n\n' +
    'სულ: ' + fmtMin_(mins) + ' წთ ≈ <b>' + money_(mins / 60 * rate) + ' ₾</b>\n' +
    'ფოტო: ' + st.photos.length + (st.note ? '\nკომენტარი: ' + esc_(st.note) : '');
  send_(chatId, txt, ikb_([[['📤 გაგზავნა', 'ok'], ['❌ გაუქმება', 'cn']]]));
}

function submitTicket_(mech, chatId, st) {
  const ss = SpreadsheetApp.getActive();
  const id = nextTicketId_();
  const now = new Date();
  const rate = mechRate_(mech);
  const reason = REASONS.filter(function (r) { return r[0] === st.reason; })[0];

  let folderUrl = '';
  try {
    const folder = photoRoot_().createFolder(id + ' ' + st.vin);
    st.photos.forEach(function (fid, i) { saveTgFile_(fid, folder, id + '_do_' + (i + 1) + '.jpg'); });
    st.voices.forEach(function (fid, i) { saveTgFile_(fid, folder, id + '_golos_' + (i + 1) + '.ogg'); });
    folderUrl = folder.getUrl();
  } catch (err) { console.error('photos', err); }

  const ts = ss.getSheetByName(SH.TICKETS);
  const r = ts.getLastRow() + 1;
  const row = new Array(T_HEAD.length).fill('');
  row[T.ID - 1] = id; row[T.OPENED - 1] = now; row[T.MECH - 1] = mech.name; row[T.VIN - 1] = st.vin;
  row[T.VIN_OK - 1] = st.vinOk ? 'да' : 'нет'; row[T.REASON - 1] = reason ? reason[2] : '';
  row[T.NOTE - 1] = st.note || ''; row[T.STATUS - 1] = STATUS.OPEN; row[T.APPROVED - 1] = false;
  row[T.PHOTOS - 1] = folderUrl;
  ts.getRange(r, 1, 1, row.length).setValues([row]);
  ts.getRange(r, T.APPROVED).insertCheckboxes();
  ts.getRange(r, T.SUM).setFormula('=SUMIF(\'' + SH.WORKS + '\'!A:A,A' + r + ',\'' + SH.WORKS + '\'!J:J)');

  const ws = ss.getSheetByName(SH.WORKS);
  st.works.forEach(function (w) {
    appendWork_(ws, [id, now, mech.name, st.vin, w.code, w.ru || w.ka, w.qty, w.min, rate]);
  });

  clearState_(chatId);
  send_(chatId, 'რემონტი <b>' + id + '</b> გაგზავნილია დასადასტურებლად ✅\n' +
    'დასრულების შემდეგ დააჭირეთ „' + BTN.CLOSE + '“.', mainKb_());

  // уведомление согласующим
  const mins = st.works.reduce(function (s, w) { return s + w.min * w.qty; }, 0);
  const noNorm = st.works.some(function (w) { return w.code === 'OTHER'; });
  const caption = '🔧 <b>Заявка ' + id + '</b>\n' +
    'Механик: ' + esc_(mech.name) + '\n' +
    'VIN: <code>' + esc_(st.vin) + '</code>' + (st.vinOk ? '' : ' ⚠️ нет в листе «Мопеды»') + '\n' +
    'Причина: ' + (reason ? reason[2] : '—') + '\n' +
    st.works.map(function (w) {
      return '• ' + esc_(w.ru || w.ka) + (w.qty > 1 ? ' ×' + w.qty : '') + ' — ' +
        (w.code === 'OTHER' ? '⚠️ без нормы' : fmtMin_(w.min * w.qty) + ' мин');
    }).join('\n') + '\n' +
    'Итого: ' + fmtMin_(mins) + ' мин = <b>' + money_(mins / 60 * rate) + ' GEL</b>' +
    (noNorm ? '\n⚠️ Есть работа без нормы — впишите минуты в лист «Работы».' : '') +
    (st.note ? '\nКомментарий: ' + esc_(st.note) : '') +
    (folderUrl ? '\n<a href="' + folderUrl + '">📁 Фото</a>' : '');
  const kb = ikb_([[['✅ Согласовать', 'a:' + id], ['❌ Отклонить', 'x:' + id]]]);
  notifyChats_().forEach(function (c) {
    sendPhotos_(c, st.photos, caption, kb);
    st.voices.forEach(function (v) { tg_('sendVoice', { chat_id: c, voice: v }); });
  });
}

// ---------------------------------------------------------------- закрытие

function startClose_(mech, chatId) {
  const open = tickets_().filter(function (t) { return t.mech === mech.name && t.status === STATUS.OPEN; });
  if (!open.length) { clearState_(chatId); send_(chatId, 'ღია რემონტები არ გაქვთ.', mainKb_()); return; }
  setState_(chatId, { flow: 'close', step: 'pick_ticket' });
  send_(chatId, 'რომელი რემონტი დასრულდა?\n✅ დადასტურებული · ⏳ ელოდება დადასტურებას',
    ikb_(open.slice(-10).map(function (t) {
      return [[t.id + ' · …' + String(t.vin).slice(-6) + ' · ' + (t.approved ? '✅' : '⏳'), 't:' + t.id]];
    })));
}

function beginClose_(mech, chatId, id) {
  const t = tickets_().filter(function (x) { return x.id === id; })[0];
  if (!t || t.status !== STATUS.OPEN) { clearState_(chatId); send_(chatId, 'ეს რემონტი უკვე დახურულია.', mainKb_()); return; }
  const st = { flow: 'close', step: 'photos_after', ticket: id, vin: t.vin, photos: [], parts: [] };
  askPhotos_(chatId, st, 'photos_after');
}

function askParts_(chatId, st) {
  st.partsList = skladParts_();
  st.step = 'parts';
  setState_(chatId, st);
  const rows = [];
  for (let i = 0; i < st.partsList.length; i += 2) {
    rows.push(st.partsList.slice(i, i + 2).map(function (p, j) { return [p[1], 'p:' + (i + j)]; }));
  }
  rows.push([['📝 სხვა ნაწილი', 'po']]);
  if (st.parts.length) rows.push([['↩️ ბოლოს წაშლა', 'pu'], ['✔️ მზადაა', 'pd']]);
  else rows.push([['✔️ ნაწილები არ გამომიყენებია', 'pd']]);
  const head = st.parts.length
    ? '<b>გამოყენებული ნაწილები:</b>\n' + partsText_(st.parts) + '\n\nკიდევ?'
    : 'რომელი ნაწილები გამოიყენეთ?';
  send_(chatId, head, ikb_(rows));
}

function partsText_(parts) {
  return parts.map(function (p) { return '• ' + esc_(p.name) + (p.qty > 1 ? ' ×' + p.qty : ''); }).join('\n');
}

function showCloseSummary_(chatId, st) {
  st.step = 'confirm_close';
  setState_(chatId, st);
  send_(chatId, '📋 <b>რემონტის დასრულება ' + st.ticket + '</b>\n' +
    'მოპედი: ' + esc_(st.vin) + '\nფოტო: ' + st.photos.length + '\n' +
    'ნაწილები: ' + (st.parts.length ? '\n' + partsText_(st.parts) : 'არა'),
    ikb_([[['✅ დასრულება', 'ok2'], ['❌ გაუქმება', 'cn']]]));
}

function closeTicket_(mech, chatId, st) {
  const ss = SpreadsheetApp.getActive();
  const ts = ss.getSheetByName(SH.TICKETS);
  const t = tickets_().filter(function (x) { return x.id === st.ticket; })[0];
  if (!t || t.status !== STATUS.OPEN) { clearState_(chatId); send_(chatId, 'ეს რემონტი უკვე დახურულია.', mainKb_()); return; }
  const now = new Date();

  try {
    const folder = ticketFolder_(t);
    st.photos.forEach(function (fid, i) { saveTgFile_(fid, folder, t.id + '_posle_' + (i + 1) + '.jpg'); });
    if (!t.photos) ts.getRange(t.row, T.PHOTOS).setValue(folder.getUrl());
  } catch (err) { console.error('photos', err); }

  const opened = t.opened instanceof Date ? t.opened : new Date(t.opened);
  const downtime = Math.round((now - opened) / 36e5 * 10) / 10;
  ts.getRange(t.row, T.STATUS).setValue(STATUS.DONE);
  ts.getRange(t.row, T.CLOSED).setValue(now);
  ts.getRange(t.row, T.DOWNTIME).setValue(downtime);

  // запчасти
  const ps = ss.getSheetByName(SH.PARTS);
  const skladRows = st.parts.filter(function (p) { return p.sku; }).map(function (p) {
    return { date: now, sku: p.sku, name: p.name, qty: p.qty, vin: t.vin,
      reason: 'Ремонт ' + t.id + ' (бот механика)', employee: mech.skladName || mech.name };
  });
  const skladResult = writeSklad_(skladRows);
  st.parts.forEach(function (p) {
    ps.getRange(ps.getLastRow() + 1, 1, 1, P_HEAD.length)
      .setValues([[t.id, now, mech.name, t.vin, p.sku, p.name, p.qty, p.sku ? skladResult : 'нет SKU — вручную']]);
  });

  const sum = ticketSum_(t.id);
  clearState_(chatId);
  send_(chatId, 'რემონტი <b>' + t.id + '</b> დასრულებულია ✅\n' + (t.approved
    ? money_(sum) + ' ₾ დაემატა თქვენს ბალანსს.'
    : 'თანხა (' + money_(sum) + ' ₾) დაემატება დადასტურების შემდეგ.'), mainKb_());

  const caption = '✅ <b>Закрыт ' + t.id + '</b>\n' +
    'Механик: ' + esc_(mech.name) + '\nVIN: <code>' + esc_(t.vin) + '</code>\n' +
    'Простой: ' + downtime + ' ч\nСумма: <b>' + money_(sum) + ' GEL</b>\n' +
    'Запчасти: ' + (st.parts.length ? st.parts.map(function (p) { return esc_(p.name) + ' ×' + p.qty; }).join(', ') : 'нет') +
    (skladRows.length && skladResult !== 'да' ? '\n⚠️ Склад: ' + skladResult + ' — спишите вручную.' : '') +
    (t.approved ? '' : '\n⏳ Ещё не согласован.');
  const kb = t.approved ? null : ikb_([[['✅ Согласовать', 'a:' + t.id], ['❌ Отклонить', 'x:' + t.id]]]);
  notifyChats_().forEach(function (c) { sendPhotos_(c, st.photos, caption, kb); });
}

// ---------------------------------------------------------------- баланс

function sendBalance_(mech, chatId) {
  const sums = ticketSums_();
  let payable = 0, nPay = 0, pending = 0, open = 0;
  tickets_().forEach(function (t) {
    if (t.mech !== mech.name) return;
    if (t.status === STATUS.DONE && t.approved) { payable += sums[t.id] || 0; nPay++; }
    else if (t.status === STATUS.DONE) pending += sums[t.id] || 0;
    else if (t.status === STATUS.OPEN) open++;
  });
  send_(chatId, '💰 <b>გადასახდელი:</b> ' + money_(payable) + ' ₾ (' + nPay + ' რემონტი)\n' +
    '⏳ ელოდება დადასტურებას: ' + money_(pending) + ' ₾\n' +
    '🔧 დაუსრულებელი რემონტები: ' + open, mainKb_());
}

// ---------------------------------------------------------------- согласование и выплаты

function adminCallback_(cq) {
  const data = cq.data;
  if (data === 'noop') { answer_(cq); return; }
  const parts = data.split(':');
  const chatId = cq.message.chat.id;
  const msgId = cq.message.message_id;
  const who = fullName_(cq.from);

  if (parts[0] === 'a' || parts[0] === 'x') {
    if (!isApprover_(cq.from.id)) { answer_(cq, 'Нет прав на согласование.', true); return; }
    const t = tickets_().filter(function (x) { return x.id === parts[1]; })[0];
    if (!t) { answer_(cq, 'Тикет не найден.', true); return; }
    if (t.status === STATUS.PAID || t.status === STATUS.REJECTED || t.approved) {
      answer_(cq, 'Уже обработан: ' + t.status + (t.approved ? ', согласован' : ''), true);
      markKb_(chatId, msgId, 'Уже обработан');
      return;
    }
    const ts = SpreadsheetApp.getActive().getSheetByName(SH.TICKETS);
    const mech = mechanicByName_(t.mech);
    if (parts[0] === 'a') {
      ts.getRange(t.row, T.APPROVED).setValue(true);
      ts.getRange(t.row, T.APPROVER).setValue(who);
      ts.getRange(t.row, T.APPROVED_AT).setValue(new Date());
      answer_(cq, 'Согласовано');
      markKb_(chatId, msgId, '✅ Согласовал: ' + who);
      if (mech && mech.tgId) {
        send_(mech.tgId, t.status === STATUS.DONE
          ? '✅ რემონტი <b>' + t.id + '</b> დადასტურებულია. ' + money_(ticketSum_(t.id)) + ' ₾ დაემატა თქვენს ბალანსს.'
          : '✅ რემონტი <b>' + t.id + '</b> დადასტურებულია — შეგიძლიათ დაიწყოთ.');
      }
    } else {
      ts.getRange(t.row, T.STATUS).setValue(STATUS.REJECTED);
      ts.getRange(t.row, T.APPROVER).setValue(who);
      ts.getRange(t.row, T.APPROVED_AT).setValue(new Date());
      answer_(cq, 'Отклонено');
      markKb_(chatId, msgId, '❌ Отклонил: ' + who);
      if (mech && mech.tgId) {
        send_(mech.tgId, '❌ რემონტი <b>' + t.id + '</b> უარყოფილია. დეტალებისთვის დაუკავშირდით ადმინისტრატორს.');
      }
    }
    return;
  }

  if (parts[0] === 'pay') {
    if (!isOwner_(cq.from.id)) { answer_(cq, 'Выплаты отмечает только владелец.', true); return; }
    const mech = mechanicByRow_(Number(parts[1]));
    if (!mech || shortHash_(mech.name) !== parts[3]) { answer_(cq, 'Список механиков изменился — пришлите отчёт заново (/report).', true); return; }
    const cutoff = Number(parts[2]) * 1000;
    const items = payable_(mech.name, cutoff);
    if (!items.length) { answer_(cq, 'Нечего отмечать — уже оплачено?', true); markKb_(chatId, msgId, 'Нечего отмечать'); return; }
    const total = items.reduce(function (s, x) { return s + x.sum; }, 0);
    const works = items.reduce(function (s, x) { return s + x.works; }, 0);
    const payId = 'PAY-' + Utilities.formatDate(new Date(), TZ, 'yyyyMMdd-HHmm');
    const ss = SpreadsheetApp.getActive();
    const ts = ss.getSheetByName(SH.TICKETS);
    const now = new Date();
    items.forEach(function (x) {
      ts.getRange(x.row, T.STATUS).setValue(STATUS.PAID);
      ts.getRange(x.row, T.PAID_AT).setValue(now);
      ts.getRange(x.row, T.PAYOUT).setValue(payId);
    });
    const pl = ss.getSheetByName(SH.PAYLOG);
    pl.getRange(pl.getLastRow() + 1, 1, 1, PAYLOG_HEAD.length)
      .setValues([[payId, now, mech.name, round2_(total), works, items.map(function (x) { return x.id; }).join(', '), who]]);
    answer_(cq, 'Отмечено: ' + money_(total) + ' GEL');
    markKb_(chatId, msgId, '💸 Оплачено ' + money_(total) + ' GEL · ' + who);
    if (mech.tgId) {
      send_(mech.tgId, '💸 გადახდილია <b>' + money_(total) + ' ₾</b>\nრემონტები: ' +
        items.map(function (x) { return x.id; }).join(', ') + '\nმადლობა!');
    }
  }
}

/** Отчёт к оплате: по одному сообщению на механика, кнопка «Оплачено» у владельца. */
function weeklyReport() {
  const cutoffSec = Math.ceil(Date.now() / 1000);   // вверх: тикет, закрытый в эту же секунду, не выпадает
  const sums = ticketSums_();
  const all = tickets_();
  const owners = ownerIds_();
  if (!owners.length) { console.warn('OWNER_IDS пуст — отчёт некому отправить'); return; }
  let any = false;
  mechanics_().forEach(function (m) {
    const items = payable_(m.name, cutoffSec * 1000);
    const waiting = all.filter(function (t) { return t.mech === m.name && t.status === STATUS.DONE && !t.approved; });
    if (!items.length && !waiting.length) return;
    any = true;
    const total = items.reduce(function (s, x) { return s + x.sum; }, 0);
    let txt = '💰 <b>К оплате — ' + esc_(m.name) + '</b>\n';
    txt += items.length ? items.map(function (x) {
      return x.id + ' · ' + fmtDate_(x.closed) + ' · ' + (x.vin && x.vin !== '—' ? '…' + String(x.vin).slice(-6) : 'без VIN') + ' · ' + money_(x.sum) + ' GEL' +
        (x.noNorm ? ' ⚠️ без нормы' : '');
    }).join('\n') + '\n<b>Итого: ' + money_(total) + ' GEL</b> · тикетов: ' + items.length : 'Согласованных к оплате нет.';
    if (waiting.length) {
      const w = waiting.reduce(function (s, t) { return s + (sums[t.id] || 0); }, 0);
      txt += '\n⏳ Закрыты, но не согласованы: ' + waiting.length + ' на ' + money_(w) + ' GEL';
    }
    const kb = items.length ? ikb_([[['💸 Оплачено ' + money_(total) + ' GEL', 'pay:' + m.row + ':' + cutoffSec + ':' + shortHash_(m.name)]]]) : null;
    owners.forEach(function (c) { send_(c, txt, kb); });
  });
  if (!any) owners.forEach(function (c) { send_(c, 'На этой неделе к оплате ничего нет.'); });
}

function payable_(mechName, cutoffMs) {
  const sums = ticketSums_();
  const minsZero = ticketsWithoutNorm_();
  return tickets_().filter(function (t) {
    return t.mech === mechName && t.status === STATUS.DONE && t.approved &&
      t.closed instanceof Date && t.closed.getTime() <= cutoffMs;
  }).map(function (t) {
    t.sum = sums[t.id] || 0;
    t.works = worksCount_(t.id);
    t.noNorm = !!minsZero[t.id];
    return t;
  });
}

// ---------------------------------------------------------------- данные

function tickets_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(SH.TICKETS);
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, T_HEAD.length).getValues().map(function (r, i) {
    return { row: i + 2, id: String(r[T.ID - 1]), opened: r[T.OPENED - 1], mech: String(r[T.MECH - 1]),
      vin: String(r[T.VIN - 1]), status: String(r[T.STATUS - 1]), approved: truthy_(r[T.APPROVED - 1]),
      closed: r[T.CLOSED - 1], photos: String(r[T.PHOTOS - 1]) };
  }).filter(function (t) { return t.id; });
}

function worksRows_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(SH.WORKS);
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, W.RATE).getValues();
}

/** Сумма по тикету считается здесь, а не из формул: кол-во × мин / 60 × ставка. */
function ticketSums_() {
  const out = {};
  worksRows_().forEach(function (r) {
    const id = String(r[W.TICKET - 1]);
    if (!id) return;
    out[id] = (out[id] || 0) + num_(r[W.QTY - 1]) * num_(r[W.MIN - 1]) / 60 * num_(r[W.RATE - 1]);
  });
  return out;
}
function ticketSum_(id) { return ticketSums_()[id] || 0; }
function worksCount_(id) { return worksRows_().filter(function (r) { return String(r[0]) === id; }).length; }
function ticketsWithoutNorm_() {
  const out = {};
  worksRows_().forEach(function (r) { if (r[0] && !num_(r[W.MIN - 1])) out[String(r[0])] = true; });
  return out;
}

function appendWork_(ws, v) {
  const r = ws.getLastRow() + 1;
  ws.getRange(r, 1, 1, 9).setValues([v]);
  const tk = '\'' + SH.TICKETS + '\'!$A:$Q';
  const look = function (col) { return 'VLOOKUP($A' + r + ',' + tk + ',' + col + ',FALSE)'; };
  ws.getRange(r, W.SUM, 1, 5).setFormulas([[
    '=IF(G' + r + '="","",G' + r + '*H' + r + '/60*I' + r + ')',
    '=IFERROR(' + look(T.STATUS) + ',"")',
    '=IFERROR(' + look(T.APPROVED) + ',FALSE)',
    '=AND(K' + r + '="' + STATUS.DONE + '",L' + r + '=TRUE)',
    '=IFERROR(IF(' + look(T.CLOSED) + '="","",INT(' + look(T.CLOSED) + ')-WEEKDAY(' + look(T.CLOSED) + ',3)),"")',
  ]]);
}

function nextTicketId_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(SH.TICKETS);
  const last = sh.getLastRow();
  let max = 0;
  if (last >= 2) sh.getRange(2, 1, last - 1, 1).getValues().forEach(function (r) {
    const m = String(r[0]).match(/^R-(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  });
  return 'R-' + ('000' + (max + 1)).slice(-4);
}

function catalog_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(SH.CATALOG);
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, CAT_HEAD.length).getValues()
    .filter(function (r) { return r[0] && r[2] && r[5] !== false && String(r[5]).toUpperCase() !== 'FALSE'; })
    .map(function (r) {
      return { code: String(r[0]).trim(), cat: String(r[1] || 'სხვა').trim(), ka: String(r[2]).trim(),
        ru: String(r[3] || r[2]).trim(), min: num_(r[4]) };
    });
}

function mopeds_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(SH.MOPEDS);
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, 4).getValues()
    .filter(function (r) { return r[0] && r[3] !== false && String(r[3]).toUpperCase() !== 'FALSE'; })
    .map(function (r) { return String(r[0]).toUpperCase().replace(/[^A-Z0-9]/g, ''); });
}

function mechanics_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(SH.MECH);
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, MECH_HEAD.length).getValues().map(function (r, i) {
    return { row: i + 2, name: String(r[0]).trim(), tgId: String(r[1]).trim(), rate: num_(r[2]),
      active: r[3] !== false && String(r[3]).toUpperCase() !== 'FALSE', skladName: String(r[4] || '').trim() };
  }).filter(function (m) { return m.name; });
}
function findMechanic_(userId) {
  return mechanics_().filter(function (m) { return m.active && m.tgId && m.tgId === String(userId); })[0] || null;
}
function mechanicByName_(name) { return mechanics_().filter(function (m) { return m.name === name; })[0] || null; }
function mechanicByRow_(row) { return mechanics_().filter(function (m) { return m.row === row; })[0] || null; }
function mechRate_(mech) { return (mech && mech.rate) || num_(getSettings_().RATE_GEL_HOUR) || 50; }

// ---------------------------------------------------------------- склад (EV8_sklad_ucheta)

function skladParts_() {
  const id = getSettings_().SKLAD_SHEET_ID;
  if (!id) return [];
  const cache = CacheService.getScriptCache();
  const hit = cache.get('sklad_parts');
  if (hit) return JSON.parse(hit);
  try {
    const sh = SpreadsheetApp.openById(id).getSheetByName('Справочник');
    const last = sh.getLastRow();
    if (last < 2) return [];
    const list = sh.getRange(2, 1, last - 1, 7).getValues()
      .filter(function (r) { return r[0] && !truthy_(r[6]); })
      .map(function (r) { return [String(r[0]), String(r[2] || r[0])]; });
    cache.put('sklad_parts', JSON.stringify(list), 600);
    return list;
  } catch (err) { console.error('sklad parts', err); return []; }
}

/** Пишет «Расход (ремонт)» в журнал «Движения». Формулы в строке не трогает. */
function writeSklad_(rows) {
  if (!rows.length) return 'да';
  const id = getSettings_().SKLAD_SHEET_ID;
  if (!id) return 'выключено';
  try {
    const sh = SpreadsheetApp.openById(id).getSheetByName('Движения');
    if (!sh) return 'нет листа «Движения»';
    rows.forEach(function (x) {
      const r = firstFreeRow_(sh);
      sh.getRange(r, 1).setValue(x.date);
      sh.getRange(r, 2).setValue('Расход (ремонт)');
      sh.getRange(r, 3).setValue(x.sku);
      sh.getRange(r, 5).setValue(x.qty);
      sh.getRange(r, 7).setValue(x.vin);
      sh.getRange(r, 8).setValue(x.reason);
      sh.getRange(r, 10).setValue(x.employee);
      [4, 6].forEach(function (c) {             // Название и Кол-во со знаком — обычно формулы
        const cell = sh.getRange(r, c);
        if (cell.getFormula() || cell.getValue() !== '') return;
        const prev = sh.getRange(r - 1, c);
        if (r > 2 && prev.getFormula()) prev.copyTo(cell);
        else if (c === 4) cell.setValue(x.name);
        else cell.setValue(-x.qty);
      });
    });
    return 'да';
  } catch (err) { console.error('sklad write', err); return 'ошибка доступа'; }
}

function firstFreeRow_(sh) {
  const last = Math.max(sh.getLastRow(), 1);
  const vals = sh.getRange(2, 1, last, 3).getValues();
  for (let i = 0; i < vals.length; i++) {
    if (vals[i][0] === '' && vals[i][1] === '' && vals[i][2] === '') return i + 2;
  }
  return last + 1;
}

// ---------------------------------------------------------------- фото

function photoRoot_() {
  const s = getSettings_();
  if (s.PHOTO_FOLDER_ID) {
    try { return DriveApp.getFolderById(s.PHOTO_FOLDER_ID); } catch (err) { /* создадим заново */ }
  }
  const file = DriveApp.getFileById(SpreadsheetApp.getActive().getId());
  const parents = file.getParents();
  const parent = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  const folder = parent.createFolder('EV8 — фото ремонтов');
  setSetting_('PHOTO_FOLDER_ID', folder.getId());
  return folder;
}

function ticketFolder_(t) {
  const m = String(t.photos || '').match(/folders\/([\w-]+)/);
  if (m) { try { return DriveApp.getFolderById(m[1]); } catch (err) { /* нет доступа — новая */ } }
  return photoRoot_().createFolder(t.id + ' ' + t.vin);
}

function saveTgFile_(fileId, folder, name) {
  const f = tg_('getFile', { file_id: fileId });
  if (!f || !f.ok) return null;
  const url = 'https://api.telegram.org/file/bot' + token_() + '/' + f.result.file_path;
  const blob = UrlFetchApp.fetch(url).getBlob().setName(name);
  return folder.createFile(blob);
}

// ---------------------------------------------------------------- Telegram

function token_() { return PropertiesService.getScriptProperties().getProperty('BOT_TOKEN'); }

function tg_(method, payload) {
  const token = token_();
  if (!token) return null;
  const res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/' + method, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true,
  });
  let j = null;
  try { j = JSON.parse(res.getContentText()); } catch (err) { /* не JSON */ }
  if (!j || !j.ok) console.warn('tg ' + method + ': ' + res.getContentText());
  return j;
}

function send_(chatId, text, kb) {
  const p = { chat_id: chatId, text: text, parse_mode: 'HTML', disable_web_page_preview: true };
  if (kb) p.reply_markup = kb;
  return tg_('sendMessage', p);
}

/** Одно фото — с подписью и кнопками; несколько — альбом, потом текст с кнопками. */
function sendPhotos_(chatId, photos, caption, kb) {
  const cap = caption.length > 1000 ? caption.slice(0, 990) + '…' : caption;
  if (photos.length === 1) {
    const p = { chat_id: chatId, photo: photos[0], caption: cap, parse_mode: 'HTML' };
    if (kb) p.reply_markup = kb;
    const r = tg_('sendPhoto', p);
    if (r && r.ok) return;
  } else if (photos.length > 1) {
    tg_('sendMediaGroup', { chat_id: chatId, media: photos.slice(0, 10).map(function (f) { return { type: 'photo', media: f }; }) });
  }
  send_(chatId, caption, kb);
}

function answer_(cq, text, alert) {
  tg_('answerCallbackQuery', { callback_query_id: cq.id, text: text || '', show_alert: !!alert });
}
function clearKb_(chatId, msgId) {
  tg_('editMessageReplyMarkup', { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [] } });
}
function markKb_(chatId, msgId, label) {
  tg_('editMessageReplyMarkup', { chat_id: chatId, message_id: msgId, reply_markup: ikb_([[[label, 'noop']]]) });
}

function ikb_(rows) {
  return { inline_keyboard: rows.map(function (row) {
    return row.map(function (b) { return { text: b[0], callback_data: b[1] }; });
  }) };
}
function mainKb_() {
  return { keyboard: [[{ text: BTN.NEW }], [{ text: BTN.CLOSE }], [{ text: BTN.BAL }]], resize_keyboard: true };
}
function cancelKb_() { return ikb_([[['❌ გაუქმება', 'cn']]]); }

function notify_(text) { notifyChats_().forEach(function (c) { send_(c, text); }); }

// ---------------------------------------------------------------- настройки и роли

function getSettings_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(SH.SETTINGS);
  const out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (r) {
    if (r[0]) out[String(r[0]).trim()] = typeof r[1] === 'string' ? r[1].trim() : r[1];
  });
  return out;
}
function setSetting_(key, value) {
  const sh = SpreadsheetApp.getActive().getSheetByName(SH.SETTINGS);
  const vals = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 1).getValues();
  for (let i = 0; i < vals.length; i++) {
    if (String(vals[i][0]).trim() === key) { sh.getRange(i + 1, 2).setValue(value); return; }
  }
  sh.appendRow([key, value, '']);
}
function idList_(v) { return String(v || '').split(/[,;\s]+/).map(function (s) { return s.trim(); }).filter(Boolean); }
function ownerIds_() { return idList_(getSettings_().OWNER_IDS); }
function approverIds_() { return idList_(getSettings_().APPROVER_IDS); }
function isOwner_(id) { return ownerIds_().indexOf(String(id)) >= 0; }
function isApprover_(id) { return isOwner_(id) || approverIds_().indexOf(String(id)) >= 0; }
function notifyChats_() {
  const s = getSettings_();
  if (s.NOTIFY_CHAT_ID) return [String(s.NOTIFY_CHAT_ID)];
  const ids = ownerIds_().concat(approverIds_());
  return ids.filter(function (x, i) { return ids.indexOf(x) === i; });
}

// ---------------------------------------------------------------- состояние диалога

function getState_(chatId) {
  const v = PropertiesService.getScriptProperties().getProperty('st_' + chatId);
  return v ? JSON.parse(v) : null;
}
function setState_(chatId, st) { PropertiesService.getScriptProperties().setProperty('st_' + chatId, JSON.stringify(st)); }
function clearState_(chatId) { PropertiesService.getScriptProperties().deleteProperty('st_' + chatId); }

// ---------------------------------------------------------------- мелочи

function esc_(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function num_(v) { const n = Number(String(v).replace(',', '.')); return isFinite(n) ? n : 0; }
function round2_(x) { return Math.round(x * 100) / 100; }
function money_(x) { return round2_(x).toFixed(2); }
function fmtMin_(m) { return String(round2_(m)).replace(/\.0+$/, ''); }
function fmtDate_(d) { return d instanceof Date ? Utilities.formatDate(d, TZ, 'dd.MM') : ''; }
function truthy_(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }
function fullName_(u) { return [u.first_name, u.last_name].filter(Boolean).join(' ') || (u.username ? '@' + u.username : String(u.id)); }
function shortHash_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s, Utilities.Charset.UTF_8)
    .slice(0, 3).map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}

// ================================================================ создание листов

const CATALOG_SEED = [
  // код, категория (ka), название (ka), название (ru), минуты, комментарий
  ['DG-01', 'დიაგნოსტიკა და სერვისი', 'დიაგნოსტიკა', 'Диагностика', 15, ''],
  ['DG-02', 'დიაგნოსტიკა და სერვისი', 'სრული უსაფრთხოების შემოწმება (PDI)', 'Полная проверка безопасности (PDI)', 30, ''],
  ['DG-03', 'დიაგნოსტიკა და სერვისი', 'დაგეგმილი ფლოტის მომსახურება (მუხრუჭები+საბურავები+ჭანჭიკები+აკუმულატორის შემოწმება)', 'Плановое ТО флота (тормоза, шины, болты, проверка АКБ)', 75, ''],
  ['BR-01', 'მუხრუჭები', 'სამუხრუჭე ხუნდების შეცვლა (თითო თვალზე, დისკზე)', 'Замена колодок, дисковый тормоз (одно колесо)', 30, ''],
  ['BR-02', 'მუხრუჭები', 'დოლური სამუხრუჭე ხუნდების შეცვლა (თითო თვალზე)', 'Замена колодок, барабанный тормоз (одно колесо)', 40, ''],
  ['BR-03', 'მუხრუჭები', 'სამუხრუჭე ბაგირის/სახელურის შეცვლა', 'Замена тормозного троса/ручки', 60, ''],
  ['BR-04', 'მუხრუჭები', 'სამუხრუჭე ბაგირის/სახელურის რეგულირება', 'Регулировка тормозного троса/ручки', 20, ''],
  ['BR-05', 'მუხრუჭები', 'სამუხრუჭე დისკის (როტორის) შეცვლა', 'Замена тормозного диска', 40, ''],
  ['BR-06', 'მუხრუჭები', 'სამუხრუჭე სუპორტის შეცვლა/რემონტი', 'Замена/ремонт суппорта', 40, ''],
  ['BR-07', 'მუხრუჭები', 'ჰიდრავლიკური მუხრუჭის სისტემის გაფრქვევა (bleed)', 'Прокачка гидравлических тормозов', 30, ''],
  ['WH-01', 'ბორბლები და საბურავები', 'ბორბლის მოხსნა/დაყენება (საბურავზე მუშაობის გარეშე)', 'Снятие/установка колеса (без работ с шиной)', 20, ''],
  ['WH-02', 'ბორბლები და საბურავები', 'საბურავის/კამერის შეცვლა', 'Замена шины/камеры', 40, ''],
  ['WH-03', 'ბორბლები და საბურავები', 'საბურავის პუნქციის შეკეთება (plug/patch)', 'Ремонт прокола', 10, ''],
  ['MT-01', 'ძრავი და კონტროლერი', 'ძრავის შემოწმება სახელოსნოში (დაშლით)', 'Проверка мотора в мастерской (с разборкой)', 40, ''],
  ['MT-02', 'ძრავი და კონტროლერი', 'ძრავის რემონტი/გადახვევა', 'Ремонт/перемотка мотора', 240, ''],
  ['MT-03', 'ძრავი და კონტროლერი', 'ჰოლის სენსორის შეცვლა', 'Замена датчика Холла', 60, 'В черновике: 60 в списке работ, 75 в тарифах — проверить'],
  ['MT-04', 'ძრავი და კონტროლერი', 'კონტროლერის დიაგნოსტიკა', 'Диагностика контроллера', 30, ''],
  ['MT-05', 'ძრავი და კონტროლერი', 'კონტროლერის შეცვლა', 'Замена контроллера', 45, ''],
  ['MT-06', 'ძრავი და კონტროლერი', 'გაზის სახელურის/სენსორის შეცვლა', 'Замена ручки/датчика газа', 30, ''],
  ['EL-01', 'ელექტროობა', 'დისპლეის შეცვლა', 'Замена дисплея', 30, ''],
  ['EL-02', 'ელექტროობა', 'გაყვანილობის ლოკალური შეკეთება', 'Локальный ремонт проводки', 45, ''],
  ['EL-03', 'ელექტროობა', 'ფარის/სტოპ სინათლის/მოსახვევის ნათურის ან ბლოკის შეცვლა', 'Замена фары/стоп-сигнала/поворотника (лампа или блок)', 60, ''],
  ['EL-04', 'ელექტროობა', 'საყვირის შეცვლა', 'Замена клаксона', 30, ''],
  ['EL-05', 'ელექტროობა', 'ბლანტის/რელეს შეცვლა', 'Замена реле поворотов', 30, ''],
  ['EL-06', 'ელექტროობა', 'დამტენის პორტის (charging port) შეკეთება', 'Ремонт порта зарядки', 30, ''],
  ['EL-07', 'ელექტროობა', 'დამტენის (charger) დიაგნოსტიკა/შეცვლა', 'Диагностика/замена зарядного устройства', 20, ''],
  ['BT-01', 'აკუმულატორი', 'აკუმულატორის დიაგნოსტიკა (BMS-ის შემოწმება)', 'Диагностика АКБ (проверка BMS)', 30, ''],
  ['BT-02', 'აკუმულატორი', 'აკუმულატორის შეცვლა (მხოლოდ ჩანაცვლება)', 'Замена АКБ (только замена)', 45, ''],
  ['SS-01', 'სავალი ნაწილი და საჭე', 'წინა ამორტიზატორის (ვილკის) სერვისი/სალინის შეცვლა', 'Обслуживание вилки / замена сальников', 60, ''],
  ['SS-02', 'სავალი ნაწილი და საჭე', 'უკანა ამორტიზატორის შეცვლა', 'Замена заднего амортизатора', 50, ''],
  ['SS-03', 'სავალი ნაწილი და საჭე', 'საჭის სვეტის საკისრების სერვისი/საჭის გასწორება', 'Подшипники рулевой колонки / выравнивание руля', 100, ''],
  ['LK-01', 'საკეტები და უსაფრთხოება', 'გასაღების/საკეტის ბლოკის შეცვლა', 'Замена замка/блока ключа', 30, ''],
  ['LK-02', 'საკეტები და უსაფრთხოება', 'სიგნალიზაციის/იმობილაიზერის დიაგნოსტიკა', 'Диагностика сигнализации/иммобилайзера', 20, ''],
  ['OT-01', 'სხვა', 'სარკის რეგულირება', 'Регулировка зеркала', 2.5, ''],
];

// Записи из черновика «სამუშაოს ჟურნალი» (до бота): дата, код, кол-во
const HISTORY_SEED = [
  ['2026-07-10', [['DG-02', 1]]],
  ['2026-07-11', [['BR-04', 1]]],
  ['2026-07-12', [['BR-04', 1]]],
  ['2026-07-14', [['OT-01', 3]]],
  ['2026-08-01', [['BR-03', 1]]],
  ['2026-09-17', [['MT-06', 1]]],
  ['2026-09-18', [['DG-01', 1], ['BR-04', 1], ['WH-01', 1], ['BR-06', 1], ['BR-04', 1]]],
];
const HISTORY_MECH = 'მექანიკოსი 1';

const HELP_TEXT = [
  ['EV8 — учёт работ механика (бот → таблица)'],
  ['Временное решение для теста. Потом переносится в EV8 Ops.'],
  [''],
  ['УСТАНОВКА (один раз)'],
  ['1. Меню «EV8 бот → 1. Создать листы» — уже сделано, раз вы это читаете.'],
  ['2. В Telegram откройте @BotFather → /newbot → получите токен. Меню «EV8 бот → 2. Ввести токен бота».'],
  ['3. «Расширения → Apps Script» → «Начать развёртывание» → «Новое развёртывание» → тип «Веб-приложение»: выполнять от «Меня», доступ «Все». Скопируйте URL (…/exec).'],
  ['4. Посредник Cloudflare (файл worker.js): в коде впишите URL из шага 3, опубликуйте, скопируйте адрес …workers.dev. Меню «EV8 бот → 3. Подключить бота» → вставьте адрес посредника, не …/exec.'],
  ['5. Каждый (вы, Гиорги, механики) пишет боту /myid. ID вписать: механиков — в «Механики», согласующих — в «Настройки» → APPROVER_IDS, владельца — OWNER_IDS.'],
  ['6. Меню «EV8 бот → 4. Включить отчёт по понедельникам».'],
  [''],
  ['СПРАВОЧНИК РАБОТ — правьте свободно'],
  ['Поменять норму — исправьте минуты. Уже записанные работы не пересчитаются: норма фиксируется в момент заявки.'],
  ['Новая работа — новая строка с новым кодом (код не меняйте и не используйте повторно). Категория — как у соседних, тогда она попадёт в ту же кнопку.'],
  ['Убрать работу — снимите галочку «Активна». Не удаляйте строку: на неё ссылается история.'],
  ['Бот читает справочник при каждом нажатии — изменения видны сразу.'],
  [''],
  ['КАК ИДЁТ РАБОТА'],
  ['Механик: «ახალი რემონტი» → VIN → фото → причина → работы из справочника → отправить. Заявка приходит Гиорги и владельцу с кнопками «Согласовать / Отклонить».'],
  ['После ремонта: «რემონტის დასრულება» → фото «после» → запчасти (из склада EV8_sklad_ucheta, списываются туда автоматически с VIN) → готово.'],
  ['К оплате идут тикеты «Выполнен» + «Согласовано». По понедельникам в 10:00 владельцу приходит отчёт с кнопкой «Оплачено» — тикеты получают статус «Оплачен», выплата пишется в «Журнал выплат», механику уходит уведомление.'],
  ['Работа «вне списка» приходит без нормы — впишите минуты в лист «Работы» (столбец «Норма, мин/ед»), сумма пересчитается.'],
  ['Простой мопеда = от открытия до закрытия тикета, в часах (лист «Тикеты»).'],
  [''],
  ['QR НА МОПЕД'],
  ['Ссылка https://t.me/<имя_бота>?start=<VIN> открывает бота сразу с этим мопедом. Сделайте из неё QR-наклейку на раму.'],
];

function setupSheets() {
  const ss = SpreadsheetApp.getActive();
  ss.setSpreadsheetTimeZone(TZ);
  const created = {};
  const ensure = function (name, head) {
    let sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      created[name] = true;
      if (head) {
        sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#eef2f7').setWrap(true);
        sh.setFrozenRows(1);
      }
    }
    return sh;
  };

  // Инструкция
  const help = ensure(SH.HELP, null);
  if (created[SH.HELP]) {
    help.getRange(1, 1, HELP_TEXT.length, 1).setValues(HELP_TEXT).setWrap(true);
    help.setColumnWidth(1, 900);
    help.getRange(1, 1).setFontSize(14).setFontWeight('bold');
    [4, 12, 18, 25].forEach(function (r) { help.getRange(r, 1).setFontWeight('bold'); });
  }

  // Настройки
  const st = ensure(SH.SETTINGS, ['Ключ', 'Значение', 'Что это']);
  if (created[SH.SETTINGS]) {
    st.getRange(2, 1, 7, 3).setValues([
      ['RATE_GEL_HOUR', 50, 'Ставка за нормо-час, GEL — если у механика не указана своя'],
      ['OWNER_IDS', '', 'Telegram user_id владельца (через запятую). Получает отчёт к оплате, отмечает выплаты, может согласовывать'],
      ['APPROVER_IDS', '', 'Telegram user_id согласующих (главный механик Гиорги). Узнать ID: написать боту /myid'],
      ['NOTIFY_CHAT_ID', '', 'Необязательно: chat_id группы для заявок (добавьте бота в группу, напишите там /myid). Пусто — заявки в личку согласующим и владельцу'],
      ['SKLAD_SHEET_ID', '1cdpJ33fBc26IXI7UlhkT3SVJm8muX3fBSwtnJN9CqIU', 'Таблица склада EV8_sklad_ucheta: запчасти из бота списываются туда как «Расход (ремонт)». Очистите, чтобы не списывать'],
      ['PHOTO_FOLDER_ID', '', 'Папка Google Drive для фото — создаётся сама рядом с этой таблицей'],
      ['BOT_USERNAME', '', 'Заполняется сам при вводе токена'],
    ]);
    st.setColumnWidth(1, 160); st.setColumnWidth(2, 340); st.setColumnWidth(3, 620);
    st.getRange(2, 3, 7, 1).setWrap(true);
  }

  // Механики
  const me = ensure(SH.MECH, MECH_HEAD);
  if (created[SH.MECH]) {
    me.getRange(2, 1, 2, MECH_HEAD.length).setValues([
      ['მექანიკოსი 1', '', '', true, 'მექანიკოსი 1'],
      ['მექანიკოსი 2', '', '', true, 'მექანიკოსი 2'],
    ]);
    me.getRange(2, 4, 2, 1).insertCheckboxes().setValue(true);   // insertCheckboxes сбрасывает в FALSE
    me.setColumnWidths(1, MECH_HEAD.length, 170);
  }

  // Справочник
  const cat = ensure(SH.CATALOG, CAT_HEAD);
  if (created[SH.CATALOG]) {
    const rows = CATALOG_SEED.map(function (r) { return [r[0], r[1], r[2], r[3], r[4], true, r[5]]; });
    cat.getRange(2, 1, rows.length, CAT_HEAD.length).setValues(rows);
    cat.getRange(2, 6, rows.length, 1).insertCheckboxes().setValue(true);
    cat.setColumnWidth(1, 70); cat.setColumnWidth(2, 200); cat.setColumnWidth(3, 380); cat.setColumnWidth(4, 340);
    cat.setColumnWidth(5, 90); cat.setColumnWidth(6, 70); cat.setColumnWidth(7, 300);
  }

  // Мопеды
  const mo = ensure(SH.MOPEDS, MOP_HEAD);
  if (created[SH.MOPEDS]) mo.setColumnWidth(1, 200);

  // Тикеты
  const ts = ensure(SH.TICKETS, T_HEAD);
  if (created[SH.TICKETS]) {
    ts.getRange(2, T.STATUS, 999, 1).setDataValidation(SpreadsheetApp.newDataValidation()
      .requireValueInList([STATUS.OPEN, STATUS.DONE, STATUS.PAID, STATUS.REJECTED], true).setAllowInvalid(false).build());
    ts.getRange(2, T.OPENED, 999, 1).setNumberFormat('dd.MM.yyyy HH:mm');
    ts.getRange(2, T.APPROVED_AT, 999, 1).setNumberFormat('dd.MM.yyyy HH:mm');
    ts.getRange(2, T.CLOSED, 999, 1).setNumberFormat('dd.MM.yyyy HH:mm');
    ts.getRange(2, T.PAID_AT, 999, 1).setNumberFormat('dd.MM.yyyy');
    ts.getRange(2, T.SUM, 999, 1).setNumberFormat('0.00');
    ts.setColumnWidth(T.VIN, 170); ts.setColumnWidth(T.NOTE, 220);
  }

  // Работы
  const ws = ensure(SH.WORKS, W_HEAD);
  if (created[SH.WORKS]) {
    ws.getRange(2, W.DATE, 999, 1).setNumberFormat('dd.MM.yyyy');
    ws.getRange(2, W.SUM, 999, 1).setNumberFormat('0.00');
    ws.getRange(2, W.WEEK, 999, 1).setNumberFormat('dd.MM.yyyy');
    ws.setColumnWidth(W.NAME, 320); ws.setColumnWidth(W.VIN, 170);
  }

  // Запчасти по тикетам
  const ps = ensure(SH.PARTS, P_HEAD);
  if (created[SH.PARTS]) ps.getRange(2, 2, 999, 1).setNumberFormat('dd.MM.yyyy');

  // Журнал выплат
  const pl = ensure(SH.PAYLOG, PAYLOG_HEAD);
  if (created[SH.PAYLOG]) { pl.getRange(2, 2, 999, 1).setNumberFormat('dd.MM.yyyy'); pl.getRange(2, 4, 999, 1).setNumberFormat('0.00'); }

  // К оплате (сводка формулами)
  const po = ensure(SH.PAYOUTS, null);
  if (created[SH.PAYOUTS]) {
    const W_ = '\'' + SH.WORKS + '\'!A2:N';
    po.getRange('A1').setValue('К оплате сейчас — выполнено и согласовано, ещё не оплачено').setFontWeight('bold');
    po.getRange('A2').setFormula('=IFERROR(QUERY(' + W_ + ',"select C, count(A), sum(J) where M = TRUE group by C label C \'Механик\', count(A) \'Работ\', sum(J) \'К оплате, GEL\'",0),"Пока ничего")');
    po.getRange('E1').setValue('Начислено по неделям (неделя закрытия тикета, с понедельника)').setFontWeight('bold');
    po.getRange('E2').setFormula('=IFERROR(QUERY(' + W_ + ',"select N, C, sum(J) where N is not null and K <> \'' + STATUS.REJECTED + '\' group by N, C order by N desc label N \'Неделя с\', C \'Механик\', sum(J) \'Начислено, GEL\'",0),"Пока ничего")');
    po.getRange('E3:E200').setNumberFormat('dd.MM.yyyy');
    po.getRange('C3:C200').setNumberFormat('0.00');
    po.getRange('G3:G200').setNumberFormat('0.00');
    po.setColumnWidth(1, 180); po.setColumnWidth(5, 110); po.setColumnWidth(6, 180);
  }

  // История из черновика — один раз, в пустую таблицу
  if (created[SH.TICKETS] && created[SH.WORKS]) importHistory_(ts, ws);

  // Лишний пустой лист по умолчанию
  ['Лист1', 'Sheet1', 'ფურცელი1'].forEach(function (n) {
    const s = ss.getSheetByName(n);
    if (s && s.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s);
  });
  ss.setActiveSheet(help);

  try {
    SpreadsheetApp.getUi().alert(Object.keys(created).length
      ? 'Листы созданы. Дальше — пункт 2 меню (токен бота). Порядок — на листе «Инструкция».'
      : 'Все листы уже есть — ничего не менял.');
  } catch (err) { /* запуск не из таблицы */ }
}

function importHistory_(ts, ws) {
  const byCode = {};
  CATALOG_SEED.forEach(function (r) { byCode[r[0]] = r; });
  const rate = 50;
  HISTORY_SEED.forEach(function (h, i) {
    const id = 'R-' + ('000' + (i + 1)).slice(-4);
    const p = h[0].split('-');
    const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 12, 0, 0);
    const r = ts.getLastRow() + 1;
    const row = new Array(T_HEAD.length).fill('');
    row[T.ID - 1] = id; row[T.OPENED - 1] = d; row[T.MECH - 1] = HISTORY_MECH; row[T.VIN - 1] = '—';
    row[T.VIN_OK - 1] = 'нет'; row[T.NOTE - 1] = 'Перенесено из черновика нормативов (до бота), VIN не записан';
    row[T.STATUS - 1] = STATUS.DONE; row[T.APPROVED - 1] = true; row[T.APPROVER - 1] = 'перенос';
    row[T.CLOSED - 1] = d; row[T.DOWNTIME - 1] = '';
    ts.getRange(r, 1, 1, row.length).setValues([row]);
    ts.getRange(r, T.APPROVED).insertCheckboxes().setValue(true);
    ts.getRange(r, T.SUM).setFormula('=SUMIF(\'' + SH.WORKS + '\'!A:A,A' + r + ',\'' + SH.WORKS + '\'!J:J)');
    h[1].forEach(function (w) {
      const c = byCode[w[0]];
      appendWork_(ws, [id, d, HISTORY_MECH, '—', c[0], c[3], w[1], c[4], rate]);
    });
  });
}
