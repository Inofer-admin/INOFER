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
  UrlFetchApp: { fetch: (u, opts) => { if (/generativelanguage/.test(u)) { delete require.cache[require.resolve('' + require('path').join(__dirname, 'gemini_simulado.js') + '')]; const fn = require('' + require('path').join(__dirname, 'gemini_simulado.js') + ''); const t = fn(JSON.parse((opts && opts.payload) || '{}'), u); return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }] }) }; } const f = process.env.SRV_FILE; let txt = ''; let code = 404; try { txt = fs.readFileSync(f, 'utf8'); code = 200; } catch (e) {} return { getResponseCode: () => code, getContentText: () => txt }; } },
  CacheService: { getScriptCache: () => ({ get: k => cacheStore[k] || null, put: (k, v) => { cacheStore[k] = v; } }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ss },
  PropertiesService: { getScriptProperties: () => ({
    getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: k => { delete props[k]; }, getProperties: () => ({ ...props }) }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  Utilities: {
    DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
    computeDigest: (alg, s) => Array.from(crypto.createHash('sha256').update(String(s), 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)),
    getUuid: () => crypto.randomUUID(), sleep() {}, formatDate: d => d.toISOString().slice(0, 10)
  },
  Session: { getScriptTimeZone: () => 'America/Buenos_Aires' },
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
  if (url.pathname === '/__state') { res.end(JSON.stringify({ sheets: Object.fromEntries(Object.entries(sheets).map(([k, v]) => [k, v._data])), props })); return; }
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
