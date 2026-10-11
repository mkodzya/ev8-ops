// Mock of the Apps Script runtime + Telegram, to drive Code.gs end to end.
const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');

function colToNum(s) { let n = 0; for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64); return n; }

class Sheet {
  constructor(name) { this.name = name; this.cells = {}; this.formulas = {}; this.validations = {}; }
  key(r, c) { return r + ',' + c; }
  get(r, c) { const v = this.cells[this.key(r, c)]; return v === undefined ? '' : v; }
  getLastRow() {
    let m = 0;
    for (const k of Object.keys(this.cells)) { if (this.cells[k] !== '' && this.cells[k] !== undefined) m = Math.max(m, +k.split(',')[0]); }
    for (const k of Object.keys(this.formulas)) if (this.formulas[k]) m = Math.max(m, +k.split(',')[0]);
    return m;
  }
  getRange(r, c, nr, nc) {
    if (typeof r === 'string') {
      const mm = r.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
      const c1 = colToNum(mm[1]), r1 = +mm[2];
      const c2 = mm[3] ? colToNum(mm[3]) : c1, r2 = mm[4] ? +mm[4] : r1;
      return new Range(this, r1, c1, r2 - r1 + 1, c2 - c1 + 1);
    }
    return new Range(this, r, c, nr || 1, nc || 1);
  }
  setFrozenRows() {} setColumnWidth() {} setColumnWidths() {}
  appendRow(v) { const r = this.getLastRow() + 1; v.forEach((x, i) => { this.cells[this.key(r, i + 1)] = x; }); }
}
class Range {
  constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
  each(fn) { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) fn(this.r + i, this.c + j, i, j); }
  setValues(v) {
    if (v.length !== this.nr || v[0].length !== this.nc) throw new Error(`setValues dims ${v.length}x${v[0].length} vs ${this.nr}x${this.nc} on ${this.sh.name}`);
    this.each((r, c, i, j) => { this.sh.cells[this.sh.key(r, c)] = v[i][j]; delete this.sh.formulas[this.sh.key(r, c)]; });
    return this;
  }
  setValue(v) { this.each((r, c) => { this.sh.cells[this.sh.key(r, c)] = v; delete this.sh.formulas[this.sh.key(r, c)]; }); return this; }
  getValues() { const out = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(this.sh.get(this.r + i, this.c + j)); out.push(row); } return out; }
  getValue() { return this.sh.get(this.r, this.c); }
  setFormula(f) { this.each((r, c) => { this.sh.formulas[this.sh.key(r, c)] = f; }); return this; }
  setFormulas(f) { this.each((r, c, i, j) => { this.sh.formulas[this.sh.key(r, c)] = f[i][j]; }); return this; }
  getFormula() { return this.sh.formulas[this.sh.key(this.r, this.c)] || ''; }
  insertCheckboxes() { this.each((r, c) => { this.sh.cells[this.sh.key(r, c)] = false; }); return this; }
  setDataValidation(v) { this.sh.validations[this.r + ':' + this.c] = v; return this; }
  copyTo(dst) {
    const f = this.getFormula();
    if (f) dst.sh.formulas[dst.sh.key(dst.r, dst.c)] = f.replace(/([A-Z])(\d+)/g, (m, col, n) => col + (+n + (dst.r - this.r)));
    else dst.setValue(this.getValue());
  }
}
['setNumberFormat', 'setFontWeight', 'setBackground', 'setWrap', 'setFontSize'].forEach(m => { Range.prototype[m] = function () { return this; }; });

class SS {
  constructor(id) { this.id = id; this.sheets = [new Sheet('Лист1')]; }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  insertSheet(n) { const s = new Sheet(n); this.sheets.push(s); return s; }
  getSheets() { return this.sheets; }
  deleteSheet(s) { this.sheets = this.sheets.filter(x => x !== s); }
  setActiveSheet() {} setSpreadsheetTimeZone(tz) { this.tz = tz; }
  getId() { return this.id; }
}

function makeSklad() {
  const ss = new SS('1cdpJ33fBc26IXI7UlhkT3SVJm8muX3fBSwtnJN9CqIU');
  ss.sheets = [];
  const sp = ss.insertSheet('Справочник');
  sp.getRange(1, 1, 1, 8).setValues([['Артикул (SKU)', 'Категория', 'Название', 'Ед.', 'Мин. остаток', 'Цена', 'В архиве', 'Заметки']]);
  const items = [['ACCEL-HANDLE', 'Ручка газа (акселератор)'], ['MOTOR-1200W', 'Мотор-колесо'], ['CTRL-1500W', 'Контроллер'], ['OLD-ONE', 'Архивная']];
  items.forEach((it, i) => sp.getRange(i + 2, 1, 1, 8).setValues([[it[0], 'Запчасть', it[1], 'шт', 1, '', it[0] === 'OLD-ONE', '']]));
  const mv = ss.insertSheet('Движения');
  mv.getRange(1, 1, 1, 11).setValues([['Дата', 'Тип операции', 'Артикул (SKU)', 'Название', 'Количество', 'Кол-во со знаком', 'VIN мопеда', 'Причина', 'Себестоимость', 'Сотрудник', 'Заметки']]);
  for (let r = 2; r <= 18; r++) mv.getRange(r, 1, 1, 3).setValues([['01.07.2026', 'Приход', 'CHRG-60V5A']]);
  for (let r = 2; r <= 61; r++) {
    mv.getRange(r, 4).setFormula(`=IF(C${r}="","",VLOOKUP(C${r},Справочник!A:C,3,0))`);
    mv.getRange(r, 6).setFormula(`=IF(E${r}="","",IF(LEFT(B${r},6)="Расход",-E${r},E${r}))`);
  }
  return ss;
}

function load() {
  const main = new SS('MAIN');
  const sklad = makeSklad();
  const props = {}, cache = {};
  const calls = [];
  let msgId = 1000;
  const folders = {};
  const mkFolder = (name) => {
    const id = 'F' + Object.keys(folders).length;
    const f = { id, name, files: [], getId: () => id, getUrl: () => 'https://drive.google.com/drive/folders/' + id,
      createFolder: (n) => mkFolder(n), createFile: (b) => { f.files.push(b.name); return { getUrl: () => 'x' }; } };
    folders[id] = f; return f;
  };
  const root = mkFolder('root');
  const g = {
    console,
    SpreadsheetApp: {
      getActive: () => main,
      openById: (id) => { if (id === sklad.id) return sklad; throw new Error('no access'); },
      newDataValidation: () => { const b = { requireValueInList: () => b, setAllowInvalid: () => b, build: () => ({}) }; return b; },
      getUi: () => { throw new Error('Cannot call getUi from this context'); },
    },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: (k) => { delete props[k]; } }) },
    CacheService: { getScriptCache: () => ({ get: (k) => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = v; }, remove: (k) => { delete cache[k]; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    UrlFetchApp: { fetch: (url, opt) => {
      if (url.includes('/file/bot')) return { getBlob: () => ({ name: '', setName(n) { this.name = n; return this; } }) };
      const method = url.split('/').pop();
      const payload = opt && opt.payload ? JSON.parse(opt.payload) : {};
      calls.push({ method, payload });
      let result = { message_id: ++msgId };
      if (method === 'getFile') result = { file_path: 'photos/' + payload.file_id + '.jpg' };
      if (method === 'getMe') result = { username: 'ev8_service_bot' };
      return { getContentText: () => JSON.stringify({ ok: true, result }) };
    } },
    DriveApp: {
      getFolderById: (id) => { if (folders[id]) return folders[id]; throw new Error('no folder'); },
      getFileById: () => ({ getParents: () => { let done = false; return { hasNext: () => !done, next: () => { done = true; return root; } }; } }),
      getRootFolder: () => root,
    },
    Utilities: {
      formatDate: (d, tz, f) => {
        const p = (n) => String(n).padStart(2, '0');
        return f.replace('yyyy', d.getFullYear()).replace('MM', p(d.getMonth() + 1)).replace('dd', p(d.getDate()))
          .replace('HH', p(d.getHours())).replace('mm', p(d.getMinutes()));
      },
      computeDigest: (alg, s) => Array.from(crypto.createHash('md5').update(s, 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)),
      DigestAlgorithm: { MD5: 'MD5' }, Charset: { UTF_8: 'UTF-8' },
    },
    ContentService: { createTextOutput: (t) => ({ t }) },
    Session: { getScriptTimeZone: () => 'Asia/Tbilisi' },
    ScriptApp: {},
  };
  vm.createContext(g);
  vm.runInContext(fs.readFileSync(__dirname + '/../Code.gs', 'utf8') + '\n;globalThis.__api = { doPost, setupSheets, weeklyReport, SH, STATUS, T, W, BTN };', g);
  return { g, api: g.__api, main, sklad, props, cache, calls, folders };
}

module.exports = { load };
