const assert = require('assert');
const { load } = require('./harness');
const env = load();
const { api, main, sklad, calls, props } = env;

let upd = 1;
const post = (u) => api.doPost({ postData: { contents: JSON.stringify(Object.assign({ update_id: upd++ }, u)) } });
const msg = (uid, extra) => post({ message: Object.assign({ message_id: 1, chat: { id: uid, type: 'private' }, from: { id: uid, first_name: 'U' + uid } }, extra) });
const text = (uid, t) => msg(uid, { text: t });
const photo = (uid, fid) => msg(uid, { photo: [{ file_id: fid + '_s' }, { file_id: fid }] });
const cb = (uid, data, name) => post({ callback_query: { id: 'q' + upd, data, from: { id: uid, first_name: name || 'U' + uid }, message: { message_id: 55, chat: { id: uid } } } });
const sent = (from) => calls.slice(from).filter(c => ['sendMessage', 'sendPhoto'].includes(c.method));
const lastText = () => { const s = sent(0); const m = s[s.length - 1]; return m.payload.text || m.payload.caption; };
const sheet = (n) => main.getSheetByName(n);
const rows = (n) => { const s = sheet(n); return s.getRange(2, 1, Math.max(s.getLastRow() - 1, 1), 17).getValues().filter(r => r[0] !== ''); };
const buttons = (m) => (m.payload.reply_markup && m.payload.reply_markup.inline_keyboard || []).flat().map(b => b.callback_data);

// 1. setup
api.setupSheets();
const names = main.getSheets().map(s => s.name);
console.log('sheets:', names.join(' | '));
assert(!names.includes('Лист1'));
const cat = rows('Справочник работ');
assert.strictEqual(cat.length, 34);
assert(cat.every(r => r[5] === true), 'catalog must be active');
assert(rows('Механики').every(r => r[3] === true), 'mechanics active');
const hist = rows('Тикеты');
assert.strictEqual(hist.length, 7);
assert(hist.every(r => r[8] === true && r[7] === 'Выполнен'));
const works = rows('Работы');
assert.strictEqual(works.length, 11);
const histSum = works.reduce((s, r) => s + r[6] * r[7] / 60 * r[8], 0);
console.log('history: 7 tickets, 11 works, minutes', works.reduce((s, r) => s + r[6] * r[7], 0), 'sum', histSum.toFixed(2));
assert.strictEqual(sheet('Работы').getRange(2, 10).getFormula(), '=IF(G2="","",G2*H2/60*I2)');
// setup is idempotent
api.setupSheets();
assert.strictEqual(rows('Тикеты').length, 7);

// configure: owner 100, chief mechanic Giorgi 200 (mechanic + approver), Temuri 300
const st = sheet('Настройки');
const setKey = (k, v) => { for (let r = 2; r <= st.getLastRow(); r++) if (st.get(r, 1) === k) st.getRange(r, 2).setValue(v); };
setKey('OWNER_IDS', '100'); setKey('APPROVER_IDS', '200');
sheet('Механики').getRange(2, 2).setValue('200');
sheet('Механики').getRange(3, 2).setValue(300);   // numeric id typed into the cell
props.BOT_TOKEN = '123:abc';

// 2. unknown user
let c0 = calls.length;
text(999, '/start');
assert(sent(c0).some(m => m.payload.chat_id === 999 && /ID/.test(m.payload.text)));
assert(sent(c0).some(m => m.payload.chat_id === '100' && /незнакомый/.test(m.payload.text)), 'owner notified about unknown');

// 3. Temuri new repair
c0 = calls.length;
text(300, '/start');
assert(/გამარჯობა, მექანიკოსი 2/.test(lastText()));
text(300, api.BTN.NEW);
text(300, 'vb2121990');                         // mopeds list empty → accepted
assert(/VB2121990/.test(lastText()));
cb(300, 'nx:pb');                               // no photo yet → alert, stays
assert(calls[calls.length - 1].method === 'answerCallbackQuery' && calls[calls.length - 1].payload.show_alert);
photo(300, 'P1'); photo(300, 'P2');
cb(300, 'nx:pb');
assert(/მიზეზი/.test(lastText()));
cb(300, 'r:RENTER');
let m = sent(0).pop();
assert(buttons(m).includes('c:1'));
cb(300, 'c:1');                                 // brakes
assert(/მუხრუჭები/.test(lastText()));
cb(300, 'w:BR-01');
cb(300, 'q:2');
assert(/×2 — 60 წთ/.test(lastText()));
cb(300, 'wm'); cb(300, 'c:0'); cb(300, 'w:DG-01'); cb(300, 'q:1');
cb(300, 'ow'); text(300, 'ძარის გაწმენდა');
assert(/ნორმა მოგვიანებით/.test(lastText()));
cb(300, 'wd');
text(300, 'სარკეც გატეხილია');
const summary = lastText();
console.log('--- mechanic summary ---\n' + summary);
assert(/75 წთ ≈ <b>62.50 ₾/.test(summary));
cb(300, 'r:WEAR');                              // stale button
assert(/აღარ მოქმედებს/.test(calls.filter(c => c.method === 'answerCallbackQuery').pop().payload.text));
c0 = calls.length;
cb(300, 'ok');
const t8 = rows('Тикеты').find(r => r[0] === 'R-0008');
assert(t8 && t8[2] === 'მექანიკოსი 2' && t8[3] === 'VB2121990' && t8[4] === 'нет' && t8[5] === 'Вина арендатора' && t8[7] === 'Открыт' && t8[8] === false);
assert(/folders/.test(t8[14]));
const w8 = rows('Работы').filter(r => r[0] === 'R-0008');
assert.strictEqual(w8.length, 3);
assert(w8.find(r => r[4] === 'OTHER' && r[7] === 0));
const notif = sent(c0).filter(x => x.payload.chat_id === '100' || x.payload.chat_id === '200');
assert(notif.length >= 2, 'owner and approver notified');
const media = calls.slice(c0).filter(c => c.method === 'sendMediaGroup');
assert.strictEqual(media.length, 2);
console.log('--- approver notice ---\n' + notif[0].payload.text);
assert(buttons(notif[0]).includes('a:R-0008'));

// 4. approvals: Temuri can't, Giorgi can
c0 = calls.length;
cb(300, 'a:R-0008');
assert(/Нет прав/.test(calls.slice(c0).find(c => c.method === 'answerCallbackQuery').payload.text));
cb(200, "a:R-0008", "Giorgi");
const t8b = rows('Тикеты').find(r => r[0] === 'R-0008');
assert(t8b[8] === true && t8b[9] === 'Giorgi');
assert(sent(c0).some(x => String(x.payload.chat_id) === '300' && /დადასტურებულია/.test(x.payload.text)));
cb(200, 'a:R-0008', 'Giorgi');                  // double press
assert(/Уже обработан/.test(calls.filter(c => c.method === 'answerCallbackQuery').pop().payload.text));

// 5. close with parts
text(300, api.BTN.CLOSE);
m = sent(0).pop();
assert(buttons(m).includes('t:R-0008'), 'open ticket listed');
cb(300, 't:R-0008');
photo(300, 'A1');
cb(300, 'nx:pa');
m = sent(0).pop();
console.log('parts buttons:', buttons(m).join(' '));
assert(!m.payload.reply_markup.inline_keyboard.flat().some(b => b.text === 'Архивная'), 'archived part hidden');
cb(300, 'p:0'); cb(300, 'pq:2');
cb(300, 'po'); text(300, 'ჭანჭიკი 2 ც');
cb(300, 'pd');
c0 = calls.length;
cb(300, 'ok2');
const t8c = rows('Тикеты').find(r => r[0] === 'R-0008');
assert(t8c[7] === 'Выполнен' && Object.prototype.toString.call(t8c[11]) === '[object Date]' && typeof t8c[12] === 'number');
const parts = rows('Запчасти по тикетам');
assert.strictEqual(parts.length, 2);
assert.strictEqual(parts[0][7], 'да');
assert(/вручную/.test(parts[1][7]));
const mv = sklad.getSheetByName('Движения');
const r19 = mv.getRange(19, 1, 1, 11).getValues()[0];
console.log('sklad row 19:', JSON.stringify(r19.map((v, i) => i === 0 ? 'date' : v)), 'D formula:', mv.getRange(19, 4).getFormula());
assert(r19[1] === 'Расход (ремонт)' && r19[2] === 'ACCEL-HANDLE' && r19[4] === 2 && r19[6] === 'VB2121990' && r19[9] === 'მექანიკოსი 2');
assert(mv.getRange(19, 4).getFormula(), 'name formula kept');
assert(/62.50 ₾ დაემატა/.test(sent(c0).find(x => String(x.payload.chat_id) === '300').payload.text));

// 6. balance
text(300, api.BTN.BAL);
console.log('--- balance ---\n' + lastText());
assert(/გადასახდელი:<\/b> 62.50/.test(lastText()));

// 7. Giorgi opens one and leaves it unapproved+done → shows as waiting
text(200, api.BTN.NEW); text(200, 'AB1234567'); photo(200, 'G1'); cb(200, 'nx:pb'); cb(200, 'r:WEAR');
cb(200, 'c:0'); cb(200, 'w:DG-02'); cb(200, 'q:1'); cb(200, 'wd'); cb(200, 'cs'); cb(200, 'ok');
text(200, api.BTN.CLOSE); cb(200, 't:R-0009'); photo(200, 'G2'); cb(200, 'nx:pa'); cb(200, 'pd'); cb(200, 'ok2');

// 8. weekly report and payout
c0 = calls.length;
api.weeklyReport();
const rep = sent(c0);
rep.forEach(x => console.log('--- report to', x.payload.chat_id, '---\n' + x.payload.text));
assert(rep.every(x => x.payload.chat_id === '100'));
const giorgiRep = rep.find(x => /მექანიკოსი 1/.test(x.payload.text));
assert(/Итого: 235.42 GEL/.test(giorgiRep.payload.text) && /не согласованы: 1 на 25.00/.test(giorgiRep.payload.text));
const temRep = rep.find(x => /მექანიკოსი 2/.test(x.payload.text));
const payData = buttons(temRep)[0];
cb(200, payData, 'Giorgi');                     // approver can't mark payouts
assert(/только владелец/.test(calls.filter(c => c.method === 'answerCallbackQuery').pop().payload.text));
c0 = calls.length;
cb(100, payData, 'Kardu');
const t8d = rows('Тикеты').find(r => r[0] === 'R-0008');
assert(t8d[7] === 'Оплачен' && /^PAY-/.test(t8d[16]));
const log = rows('Журнал выплат');
assert(log.length === 1 && log[0][2] === 'მექანიკოსი 2' && log[0][3] === 62.5 && log[0][4] === 3);
assert(sent(c0).some(x => String(x.payload.chat_id) === '300' && /გადახდილია <b>62.50/.test(x.payload.text)));
cb(100, payData, 'Kardu');                      // double press
assert(/Нечего/.test(calls.filter(c => c.method === 'answerCallbackQuery').pop().payload.text));

// 9. duplicate delivery of the same update is ignored
const before = rows('Тикеты').length;
const dup = { update_id: 777, message: { message_id: 1, chat: { id: 300, type: 'private' }, from: { id: 300 }, text: api.BTN.NEW } };
c0 = calls.length;
api.doPost({ postData: { contents: JSON.stringify(dup) } });
const n1 = calls.length - c0;
api.doPost({ postData: { contents: JSON.stringify(dup) } });
assert.strictEqual(calls.length - c0, n1, 'duplicate ignored');
assert.strictEqual(rows('Тикеты').length, before);

// 10. VIN matching once the mopeds list is filled
sheet('Мопеды').getRange(2, 1, 2, 4).setValues([['LUYS70AAA00123456', 'S70', '', true], ['LUYS70AAA00987654', 'S70', '', true]]);
text(300, '/cancel'); text(300, api.BTN.NEW); text(300, '123456');
assert(/LUYS70AAA00123456/.test(lastText()), 'last-6 match');
text(300, '/cancel'); text(300, api.BTN.NEW); text(300, '9999');
assert(/ვერ მოიძებნა/.test(lastText()));
text(300, '/cancel');
text(300, '/start LUYS70AAA00987654');          // QR deep link
assert(/LUYS70AAA00987654/.test(lastText()));

console.log('\nALL CHECKS PASSED');
