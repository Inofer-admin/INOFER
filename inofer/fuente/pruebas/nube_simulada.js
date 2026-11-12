// Ejecuta el Codigo.gs real con servicios de Google simulados, como servidor HTTP local.
const http = require('http'), fs = require('fs'), vm = require('vm'), crypto = require('crypto');
const code = fs.readFileSync(process.argv[2], 'utf8');
const port = Number(process.argv[3] || 8900);

// Imita a Google Sheets con la columna de fechas de los partes: si la celda no tiene formato texto, convierte
// "AAAA-MM-DD" en fecha; Apps Script la devuelve corrida un día (zonas distintas) pero la hoja MUESTRA bien el día.
const ES_PARTES = n => n === 'BD_Tiempo_Real';
function aFechaSheets(v) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v)); if (!m) return v; const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]) - 3 * 3600000); d._mostrar = (+m[3]) + '/' + (+m[2]) + '/' + m[1]; return d; }
function makeSheet(name) {
  const data = [];
  const texto = new Set();
  const sh = {
    name,
    _data: data,
    getName() { return name; },
    appendRow(row) { const f = data.length + 1; data.push(row.map((v, j) => (ES_PARTES(name) && j === 1 && !texto.has(f) ? aFechaSheets(v) : v))); },
    getDataRange() { return { getValues: () => data.map(r => r.slice()) }; },
    getLastRow() { return data.length; },
    getLastColumn() { return data.reduce((m, r) => Math.max(m, r.length), 0); },
    deleteRow(i) { data.splice(i - 1, 1); const t = [...texto]; texto.clear(); t.forEach(f => { if (f < i) texto.add(f); else if (f > i) texto.add(f - 1); }); },
    deleteRows(i, n) { data.splice(i - 1, n); },
    clearContents() { data.length = 0; texto.clear(); },
    getRange(a, b, c, d) {
      if (typeof a === 'string') return { setNumberFormat() { return this; } };
      const row = a, col = b, nr = c || 1, nc = d || 1;
      const r = {
        setNumberFormat(fmt) { if (fmt === '@' && col <= 2 && col + nc - 1 >= 2) for (let i = 0; i < nr; i++) texto.add(row + i); return r; },
        getDisplayValues() { return r.getValues().map(f => f.map(v => (v instanceof Date ? (v._mostrar || v.toISOString().slice(0, 10)) : String(v)))); },
        setValue(v) { return r.setValues([[v]]); },
        getValues() { const out = []; for (let i = 0; i < nr; i++) { const rr = data[row - 1 + i] || []; const o = []; for (let j = 0; j < nc; j++) o.push(rr[col - 1 + j] == null ? '' : rr[col - 1 + j]); out.push(o); } return out; },
        clearContent() { for (let i = 0; i < nr; i++) { const rr = data[row - 1 + i] || (data[row - 1 + i] = []); for (let j = 0; j < nc; j++) rr[col - 1 + j] = ''; } return r; },
        setValues(vals) { for (let i = 0; i < nr; i++) { const rr = data[row - 1 + i] || (data[row - 1 + i] = []); for (let j = 0; j < nc; j++) { const c = col + j; rr[c - 1] = (ES_PARTES(name) && c === 2 && !texto.has(row + i)) ? aFechaSheets(vals[i][j]) : vals[i][j]; } } return r; }
      };
      return r;
    }
  };
  return sh;
}
const sheets = {};
const ss = { getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = makeSheet(n)), getSheets: () => Object.values(sheets) };
const props = {};
const cacheStore = {};
const ctx = {
  globalThis: null,
  UrlFetchApp: { fetchAll: reqs => reqs.map(r => ctx.UrlFetchApp.fetch(r.url, r)), fetch: (u, opts) => { if (/^https:\/\/push\.prueba\//.test(u)) { (ctx.__push = ctx.__push || []).push({ url: u, headers: (opts && opts.headers) || {} }); const code = /vencida/.test(u) ? 410 : 201; return { getResponseCode: () => code, getContentText: () => '' }; } if (/generativelanguage/.test(u)) { delete require.cache[require.resolve('' + require('path').join(__dirname, 'gemini_simulado.js') + '')]; const fn = require('' + require('path').join(__dirname, 'gemini_simulado.js') + ''); const t = fn(JSON.parse((opts && opts.payload) || '{}'), u); return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }] }) }; } const f = process.env.SRV_FILE; let txt = ''; let code = 404; try { txt = fs.readFileSync(f, 'utf8'); code = 200; } catch (e) {} return { getResponseCode: () => code, getContentText: () => txt }; } },
  CacheService: { getScriptCache: () => { const chk = (k, v) => { if (Buffer.byteLength(String(v), 'utf8') > 100 * 1024) throw new Error('Argument too large: ' + k); }; return {
    get: k => cacheStore[k] || null, put: (k, v) => { chk(k, v); cacheStore[k] = String(v); }, remove: k => { delete cacheStore[k]; },
    getAll: ks => { const o = {}; ks.forEach(k => { if (k in cacheStore) o[k] = cacheStore[k]; }); return o; },
    putAll: (m) => { Object.keys(m).forEach(k => chk(k, m[k])); Object.keys(m).forEach(k => { cacheStore[k] = String(m[k]); }); ctx.__cachePuts = (ctx.__cachePuts || 0) + 1; } }; } },
  SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ss },
  PropertiesService: { getScriptProperties: () => ({
    getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: k => { delete props[k]; }, getProperties: () => ({ ...props }) }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, tryLock() { return true; }, releaseLock() {} }) },
  Utilities: {
    DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
    computeDigest: (alg, s) => Array.from(crypto.createHash('sha256').update(String(s), 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)),
    getUuid: () => crypto.randomUUID(), sleep() {},
    // como el de Apps Script: respeta la zona horaria y los formatos que usa el servidor
    formatDate: (d, tz, fmt) => {
      if (!fmt) return d.toISOString().slice(0, 10);
      const o = {}; new Intl.DateTimeFormat('en-US', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short', hourCycle: 'h23' }).formatToParts(d).forEach(p => { o[p.type] = p.value; });
      const u = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[o.weekday];
      return fmt.replace(/yyyy|MM|dd|HH|H|mm|ss|EEE|u/g, t => ({ yyyy: o.year, MM: o.month, dd: o.day, HH: o.hour, H: String(Number(o.hour)), mm: o.minute, ss: o.second, EEE: o.weekday, u: String(u) })[t]);
    },
    parseDate: (str, tz, fmt) => {
      const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(str); if (!m) return new Date(NaN);
      const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
      const ver = ctx.Utilities.formatDate(new Date(guess), tz, 'yyyy-MM-dd HH:mm');
      const v = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(ver);
      const off = Date.UTC(+v[1], +v[2] - 1, +v[3], +v[4], +v[5]) - guess;
      return new Date(guess - off);
    }
  },
  Session: { getScriptTimeZone: () => 'America/Buenos_Aires' },
  MailApp: { sendEmail: o => { (globalThis.__mails = globalThis.__mails || []).push(o); }, getRemainingDailyQuota: () => 100 },
  GmailApp: { getAliases: () => [], sendEmail: (to, a, b, o) => { (globalThis.__mails = globalThis.__mails || []).push(Object.assign({ to, subject: a }, o)); } },
  ScriptApp: (() => {
    let trig = [], n = 0;
    const nuevo = (fn, info) => ({ create: () => { const id = 't' + (++n); const t = { getUniqueId: () => id, getHandlerFunction: () => fn, info }; trig.push(t); ctx.__triggers = trig; return t; } });
    return {
      getProjectTriggers: () => trig.slice(),
      deleteTrigger(t) { trig = trig.filter(x => x.getUniqueId() !== t.getUniqueId()); ctx.__triggers = trig; },
      newTrigger: fn => ({ timeBased: () => ({ everyHours: h => nuevo(fn, { cada: h }), everyDays: () => ({ atHour: h => nuevo(fn, { diaria: h }) }), at: f => nuevo(fn, { at: f.toISOString() }) }) })
    };
  })(),
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ s, setMimeType() { return this; } }) },
  HtmlService: { createHtmlOutput: s => ({ s }) },
  Logger: { log: (...a) => console.log('[GAS]', ...a) },
  console, JSON, Date, Math
};
vm.createContext(ctx); ctx.globalThis = ctx;
vm.runInContext(code, ctx);

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/__state') { res.end(JSON.stringify({ sheets: Object.fromEntries(Object.entries(sheets).map(([k, v]) => [k, v._data])), props, push: ctx.__push || [] })); return; }
  if (url.pathname === '/__run') { vm.runInContext(url.searchParams.get('f') + '()', ctx); res.end('ok'); return; }
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    try {
      let out;
      if (req.method === 'POST') out = ctx.doPost({ postData: { contents: body } });
      else out = ctx.doGet({ parameter: Object.fromEntries(url.searchParams) });
      res.setHeader('Content-Type', 'application/json');
      res.end(out.s);
    } catch (e) { console.error(e); res.statusCode = 500; res.end(String(e)); }
  });
}).listen(port, () => console.log('mock GAS on', port));
