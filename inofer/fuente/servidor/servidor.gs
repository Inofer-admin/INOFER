// INOFER_SERVIDOR_OK — lógica del servidor (se carga desde GitHub; NO pegar en Apps Script)
const SPREADSHEET_ID = '1TEVDf0xDjwljzUd7FWaLCA2knkLChHbkBpWrduPlz9U';
const SHEET_NAME = 'BD_Tiempo_Real';
const STATE_SHEET_NAME = 'BD_Sistema_Completo';

function getSs() {
  return SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(SPREADSHEET_ID);
}

function getDbSheet() {
  const ss = getSs();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow([
      'id', 'date', 'machine', 'shift', 'available',
      'parada_maquina', 'setup_molde', 'puesta_punto',
      'mant_preventivo', 'mant_correctivo', 'falta_material',
      'falta_operario', 'otros', 'updated_at', 'cargado_por', 'modificado_por', 'cargado_at', 'paradas'
    ]);
  }
  fechasComoTexto_(sheet);
  if (String(sheet.getRange(1, 18).getValue ? sheet.getRange(1, 18).getValue() : 'paradas') !== 'paradas') {
    sheet.getRange(1, 18, 1, 1).setValues([['paradas']]);
  }
  if (String(sheet.getRange(1, 15).getValue ? sheet.getRange(1, 15).getValue() : 'cargado_por') !== 'cargado_por') {
    sheet.getRange(1, 15, 1, 3).setValues([['cargado_por', 'modificado_por', 'cargado_at']]);
  }
  return sheet;
}
// ---------- Fechas de los partes: siempre como texto AAAA-MM-DD ----------
// Google Sheets convertía "2026-10-29" en fecha con hora y, al leerla con otra zona horaria, la corría un día.
function zonaHoja_() {
  try { const z = getSs().getSpreadsheetTimeZone(); if (z) return z; } catch (e) {}
  return Session.getScriptTimeZone();
}
function fechaTexto_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, zonaHoja_(), 'yyyy-MM-dd');
  const s = String(v == null ? '' : v).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  const m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m2) return m2[3] + '-' + ('0' + m2[2]).slice(-2) + '-' + ('0' + m2[1]).slice(-2);
  return s;
}
// Fecha de una celda: si Sheets la guardó como fecha, se usa lo que MUESTRA la hoja (el Date que da Apps Script
// puede venir corrido un día cuando la zona del script y la de la planilla no coinciden).
function fechaCelda_(v, mostrado) {
  if (v instanceof Date) {
    const t = fechaTexto_(String(mostrado || '').trim());
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    return fechaTexto_(v);
  }
  return fechaTexto_(v);
}
// Escribe una fila de partes con la fecha (col B) como texto, para que Sheets no la convierta
function filaParteTexto_(sheet, fila, vals) {
  sheet.getRange(fila, 2, 1, 1).setNumberFormat('@');
  sheet.getRange(fila, 1, 1, vals.length).setValues([vals]);
}
function agregarFilaParte_(sheet, vals) { filaParteTexto_(sheet, sheet.getLastRow() + 1, vals); }
// Arregla las fechas que hayan quedado como fecha de Sheets: las pasa a texto con el día que muestra la hoja
function repararFechasPartes_(sheet, rows, mostr) {
  try {
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][1] instanceof Date) {
        const t = fechaCelda_(rows[i][1], mostr[i] && mostr[i][0]);
        const c = sheet.getRange(i + 1, 2); c.setNumberFormat('@'); c.setValue(t);
      }
    }
  } catch (e) {}
}
// Una sola vez: pasa la columna de fechas a texto plano para que no se vuelva a convertir
function fechasComoTexto_(sheet) {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('FECHAS_TEXTO_V1') === 'ok') return;
  const n = sheet.getLastRow();
  if (n > 1) {
    const vals = sheet.getRange(2, 2, n - 1, 1).getValues().map(function (r) { return [fechaTexto_(r[0])]; });
    sheet.getRange(2, 2, n - 1, 1).setNumberFormat('@');
    sheet.getRange(2, 2, n - 1, 1).setValues(vals);
  }
  sheet.getRange('B:B').setNumberFormat('@');
  props.setProperty('FECHAS_TEXTO_V1', 'ok');
}
// Usuario que hace el pedido actual (lo completa doPost)
let USUARIO_ACTUAL = '';

function getStateSheet() {
  const ss = getSs();
  let sheet = ss.getSheetByName(STATE_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(STATE_SHEET_NAME);
    sheet.appendRow(['key', 'json_value', 'updated_at']);
  }
  return sheet;
}

// Cada celda de Google Sheets admite hasta 50.000 caracteres: los módulos grandes
// (Gantt, catálogo, órdenes) se guardan partidos en varias columnas (B y D en adelante).
const CHUNK = 45000;

// (12/11/2026) Copia rápida: leer la hoja de módulos es lo más lento de cada carga. Se guarda una copia
// en la caché de Apps Script con una "firma" hecha de las versiones de cada módulo; cuando alguien guarda
// un módulo cambia su versión, la firma ya no coincide y se vuelve a leer la hoja. Partida en pedazos chicos
// porque la caché acepta hasta 100 KB por clave.
const CACHE_MOD_PEDAZO = 30000;
function firmaModulos_() {
  try {
    const v = versiones_(); const ks = Object.keys(v).filter(function (k) { return k !== 'records'; }).sort();
    const txt = ks.map(function (k) { return k + '=' + v[k]; }).join('|');
    const d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, txt, Utilities.Charset.UTF_8);
    return 'inofer_mod_' + d.slice(0, 12).map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
  } catch (e) { return ''; }
}
function leerCacheModulos_(firma) {
  if (!firma) return null;
  try {
    const c = CacheService.getScriptCache(); const n = Number(c.get(firma) || 0); if (!n) return null;
    const ks = []; for (let i = 0; i < n; i++) ks.push(firma + '_' + i);
    const m = c.getAll(ks); let txt = '';
    for (let i = 0; i < n; i++) { if (m[ks[i]] == null) return null; txt += m[ks[i]]; }
    return JSON.parse(txt);
  } catch (e) { return null; }
}
function guardarCacheModulos_(firma, state) {
  if (!firma) return;
  try {
    const txt = JSON.stringify(state); const m = {}; let n = 0;
    for (let p = 0; p < txt.length; p += CACHE_MOD_PEDAZO) m[firma + '_' + (n++)] = txt.substring(p, p + CACHE_MOD_PEDAZO);
    if (n > 400) return; // demasiado grande: se lee siempre de la hoja
    const c = CacheService.getScriptCache(); c.putAll(m, 21600); c.put(firma, String(n), 21600);
  } catch (e) { }
}
function obtenerEstadoModulos() {
  const firma = firmaModulos_();
  const enCache = leerCacheModulos_(firma);
  if (enCache) return enCache;
  const st = leerEstadoModulosHoja_();
  guardarCacheModulos_(firma, st);
  return st;
}
function leerEstadoModulosHoja_() {
  const sheet = getStateSheet();
  const rows = sheet.getDataRange().getValues();
  const state = {};
  for (let i = 1; i < rows.length; i++) {
    const k = String(rows[i][0] || '');
    let val = String(rows[i][1] || '');
    for (let c = 3; c < rows[i].length; c++) val += String(rows[i][c] || '');
    if (k && val) {
      try { state[k] = JSON.parse(val); } catch (e) {}
    }
  }
  return state;
}

function guardarModuloEstado(key, dataObj) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { return guardarModuloSinLock_(key, dataObj); } finally { lock.releaseLock(); }
}
function guardarModuloSinLock_(key, dataObj) {
  {
    const sheet = getStateSheet();
    const rows = sheet.getDataRange().getValues();
    const jsonStr = JSON.stringify(dataObj);
    const nowStr = new Date().toISOString();
    const parts = [];
    for (let p = 0; p < jsonStr.length; p += CHUNK) parts.push(jsonStr.substring(p, p + CHUNK));
    if (!parts.length) parts.push('');
    const rowVals = [String(key), parts[0], nowStr].concat(parts.slice(1));
    let rowIdx = -1;
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === String(key)) { rowIdx = i + 1; break; }
    }
    if (rowIdx === -1) rowIdx = Math.max(sheet.getLastRow(), 1) + 1;
    const lastCol = Math.max(sheet.getLastColumn(), rowVals.length);
    sheet.getRange(rowIdx, 1, 1, lastCol).clearContent();
    sheet.getRange(rowIdx, 1, 1, rowVals.length).setNumberFormat('@').setValues([rowVals]);
    marcarVersion_(key);
    return { status: 'ok' };
  }
}

function obtenerRegistros() {
  const sheet = getDbSheet();
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return [];
  const mostr = sheet.getRange(1, 2, rows.length, 1).getDisplayValues();
  if (rows.some(function (r, i) { return i > 0 && r[1] instanceof Date; })) repararFechasPartes_(sheet, rows, mostr);
  const list = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0]) continue;
    list.unshift({
      id: String(r[0]),
      date: fechaCelda_(r[1], mostr[i] && mostr[i][0]),
      machine: String(r[2]),
      shift: String(r[3]),
      available: Number(r[4]) || 0,
      parada_maquina: Number(r[5]) || 0,
      setup_molde: Number(r[6]) || 0,
      puesta_punto: Number(r[7]) || 0,
      mant_preventivo: Number(r[8]) || 0,
      mant_correctivo: Number(r[9]) || 0,
      falta_material: Number(r[10]) || 0,
      falta_operario: Number(r[11]) || 0,
      otros: Number(r[12]) || 0,
      actualizado: r[13] instanceof Date ? r[13].toISOString() : String(r[13] || ''),
      cargadoPor: String(r[14] || ''),
      modificadoPor: String(r[15] || ''),
      cargadoAt: String(r[16] || ''),
      paradas: leerParadasJson_(r[17])
    });
  }
  return list;
}

// Paradas por código (las mismas de la Orden de Producción) guardadas como JSON en la columna 18
function leerParadasJson_(v) {
  if (!v) return [];
  try { const a = JSON.parse(String(v)); return Array.isArray(a) ? a.slice(0, 40) : []; } catch (e) { return []; }
}
function paradasJson_(entry) {
  const a = Array.isArray(entry && entry.paradas) ? entry.paradas.slice(0, 40).map(function (p) { return { codigo: String(p.codigo || '').slice(0, 80), min: Number(p.min) || 0 }; }) : [];
  return a.length ? JSON.stringify(a) : '';
}

function obtenerTodoElSistema() {
  return {
    records: obtenerRegistros(),
    modules: obtenerEstadoModulos()
  };
}

function guardarRegistro(entry) {
  marcarVersion_('records');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getDbSheet();
    const ahora = new Date().toISOString();
    agregarFilaParte_(sheet, [
      entry.id || ('rec-' + new Date().getTime()),
      fechaTexto_(entry.date), entry.machine, entry.shift,
      Number(entry.available) || 0, Number(entry.parada_maquina) || 0,
      Number(entry.setup_molde) || 0, Number(entry.puesta_punto) || 0,
      Number(entry.mant_preventivo) || 0, Number(entry.mant_correctivo) || 0,
      Number(entry.falta_material) || 0, Number(entry.falta_operario) || 0,
      Number(entry.otros) || 0, ahora, USUARIO_ACTUAL || entry.cargadoPor || '', '', ahora, paradasJson_(entry)
    ]);
    return obtenerRegistros();
  } finally {
    lock.releaseLock();
  }
}

function editarRegistro(entry) {
  marcarVersion_('records');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  let found = false;
  try {
    const sheet = getDbSheet();
    const rows = sheet.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === String(entry.id)) {
        filaParteTexto_(sheet, i + 1, [
          entry.id, fechaTexto_(entry.date), entry.machine, entry.shift,
          Number(entry.available) || 0, Number(entry.parada_maquina) || 0,
          Number(entry.setup_molde) || 0, Number(entry.puesta_punto) || 0,
          Number(entry.mant_preventivo) || 0, Number(entry.mant_correctivo) || 0,
          Number(entry.falta_material) || 0, Number(entry.falta_operario) || 0,
          Number(entry.otros) || 0, new Date().toISOString(),
          String(rows[i][14] || entry.cargadoPor || ''), USUARIO_ACTUAL || entry.modificadoPor || '', String(rows[i][16] || ''), paradasJson_(entry)
        ]);
        found = true;
        break;
      }
    }
    if (!found) {
      const ahora = new Date().toISOString();
      agregarFilaParte_(sheet, [
        entry.id, fechaTexto_(entry.date), entry.machine, entry.shift,
        Number(entry.available) || 0, Number(entry.parada_maquina) || 0,
        Number(entry.setup_molde) || 0, Number(entry.puesta_punto) || 0,
        Number(entry.mant_preventivo) || 0, Number(entry.mant_correctivo) || 0,
        Number(entry.falta_material) || 0, Number(entry.falta_operario) || 0,
        Number(entry.otros) || 0, ahora, entry.cargadoPor || USUARIO_ACTUAL || '', USUARIO_ACTUAL || '', ahora, paradasJson_(entry)
      ]);
    }
    return obtenerRegistros();
  } finally {
    lock.releaseLock();
  }
}

function eliminarRegistro(id) {
  marcarVersion_('records');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getDbSheet();
    const rows = sheet.getDataRange().getValues();
    for (let i = rows.length - 1; i >= 1; i--) {
      if (String(rows[i][0]) === String(id)) {
        sheet.deleteRow(i + 1);
        break;
      }
    }
    return obtenerRegistros();
  } finally {
    lock.releaseLock();
  }
}

function reemplazarRegistros(entries) {
  marcarVersion_('records');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getDbSheet();
    sheet.clearContents();
    sheet.appendRow([
      'id', 'date', 'machine', 'shift', 'available',
      'parada_maquina', 'setup_molde', 'puesta_punto',
      'mant_preventivo', 'mant_correctivo', 'falta_material',
      'falta_operario', 'otros', 'updated_at', 'cargado_por', 'modificado_por', 'cargado_at', 'paradas'
    ]);
    (entries || []).slice().reverse().forEach(entry => {
      agregarFilaParte_(sheet, [
        entry.id || ('rec-' + new Date().getTime()),
        fechaTexto_(entry.date), entry.machine, entry.shift,
        Number(entry.available) || 0, Number(entry.parada_maquina) || 0,
        Number(entry.setup_molde) || 0, Number(entry.puesta_punto) || 0,
        Number(entry.mant_preventivo) || 0, Number(entry.mant_correctivo) || 0,
        Number(entry.falta_material) || 0, Number(entry.falta_operario) || 0,
        Number(entry.otros) || 0, entry.actualizado || new Date().toISOString(),
        entry.cargadoPor || USUARIO_ACTUAL || '', entry.modificadoPor || '', entry.cargadoAt || '', paradasJson_(entry)
      ]);
    });
    return obtenerRegistros();
  } finally {
    lock.releaseLock();
  }
}

// =====================================================================
// USUARIOS Y PERMISOS
// Hoja BD_Usuarios: usuario | nombre | rol | permisos(JSON) | activo | sal | hash | actualizado
// Permisos por área: 'none' (sin acceso) | 'view' (solo ver) | 'edit' (ver y modificar)
// =====================================================================
const USERS_SHEET_NAME = 'BD_Usuarios';
const AREAS = ['partes', 'ordenes', 'catalogo', 'gantt', 'ia', 'indicadores'];
const SESION_DIAS = 30;

function getUsersSheet() {
  const ss = getSs();
  let sheet = ss.getSheetByName(USERS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(USERS_SHEET_NAME);
    sheet.appendRow(['usuario', 'nombre', 'rol', 'permisos', 'activo', 'sal', 'hash', 'actualizado']);
    sheet.getRange('A:H').setNumberFormat('@');
  }
  return sheet;
}

function hashClave(sal, clave) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, sal + ':' + clave, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}
// ===== Seguridad de claves (13/11/2026) =====
// - Clave nueva: mínimo CLAVE_MIN caracteres (las viejas de 4 siguen entrando hasta que se cambien).
// - Se guarda "v2$" + hash repetido HASH_VUELTAS veces (mucho más lento de adivinar si alguien copiara la hoja de usuarios).
//   Las claves viejas (una sola vuelta) se pasan solas a v2 la próxima vez que el usuario entra bien.
// - 5 intentos fallidos seguidos bloquean ese usuario 15 minutos (CacheService).
const CLAVE_MIN = 6, HASH_VUELTAS = 1000, INTENTOS_MAX = 5, BLOQUEO_MIN = 15;
function hashClaveV2_(sal, clave) {
  let h = hashClave(sal, clave);
  for (let i = 1; i < HASH_VUELTAS; i++) h = hashClave(sal, h);
  return 'v2$' + h;
}
function claveCorrecta_(u, clave) {
  if (!u || !u.hash) return false;
  if (String(u.hash).indexOf('v2$') === 0) return hashClaveV2_(u.sal, clave) === u.hash;
  if (hashClave(u.sal, clave) !== u.hash) return false;
  try { u.sal = Utilities.getUuid(); u.hash = hashClaveV2_(u.sal, clave); escribirUsuario(u); } catch (e) { }
  return true;
}
function claveNuevaMala_(clave) {
  clave = String(clave || '');
  if (clave.length < CLAVE_MIN) return 'La clave debe tener al menos ' + CLAVE_MIN + ' caracteres.';
  if (/^(\d)\1+$/.test(clave) || /^(123456|1234567|12345678|654321|abcdef|qwerty|inofer|inofer1234|contraseña|password)$/i.test(clave)) return 'Esa clave es muy fácil de adivinar: elegí otra.';
  return '';
}
function intentosClave_(usuario) { try { return Number(CacheService.getScriptCache().get('intentos_' + usuario) || 0); } catch (e) { return 0; } }
function anotarIntento_(usuario, mal) {
  try {
    const c = CacheService.getScriptCache();
    if (!mal) { c.remove('intentos_' + usuario); return; }
    c.put('intentos_' + usuario, String(intentosClave_(usuario) + 1), BLOQUEO_MIN * 60);
  } catch (e) { }
}

function normalizarPermisos(rol, permisos) {
  const out = {};
  AREAS.forEach(function (a) {
    const v = rol === 'admin' ? 'edit' : (permisos && permisos[a]);
    out[a] = (v === 'edit' || v === 'view') ? v : 'none';
  });
  // permisos detallados dentro de cada pestaña (true/false por acción)
  if (rol !== 'admin' && permisos && permisos.detalle && typeof permisos.detalle === 'object') {
    out.detalle = {};
    Object.keys(permisos.detalle).forEach(function (k) { if (/^[a-z_]{3,30}$/.test(k)) out.detalle[k] = permisos.detalle[k] !== false; });
  }
  return out;
}

function leerUsuarios() {
  const rows = getUsersSheet().getDataRange().getValues();
  const list = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0]) continue;
    let perms = {};
    try { perms = JSON.parse(String(r[3] || '{}')); } catch (e) {}
    list.push({
      fila: i + 1, usuario: String(r[0]).toLowerCase(), nombre: String(r[1] || r[0]),
      rol: String(r[2]) === 'admin' ? 'admin' : 'usuario',
      permisos: normalizarPermisos(String(r[2]), perms),
      activo: String(r[4]) !== 'no', sal: String(r[5] || ''), hash: String(r[6] || '')
    });
  }
  return list;
}

function publico(u) {
  return { usuario: u.usuario, nombre: u.nombre, rol: u.rol, permisos: u.permisos, activo: u.activo };
}

function escribirUsuario(u) {
  const sheet = getUsersSheet();
  const fila = [u.usuario, u.nombre, u.rol, JSON.stringify(u.permisos), u.activo ? 'si' : 'no', u.sal, u.hash, new Date().toISOString()];
  const existentes = leerUsuarios();
  const ex = existentes.filter(function (x) { return x.usuario === u.usuario; })[0];
  if (ex) sheet.getRange(ex.fila, 1, 1, 8).setNumberFormat('@').setValues([fila]);
  else sheet.appendRow(fila);
}

function crearSesion(usuario) {
  const props = PropertiesService.getScriptProperties();
  const token = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
  const exp = Date.now() + SESION_DIAS * 86400000;
  // limpiar sesiones vencidas
  const todas = props.getProperties();
  Object.keys(todas).forEach(function (k) {
    if (k.indexOf('ses_') === 0) {
      try { if (JSON.parse(todas[k]).exp < Date.now()) props.deleteProperty(k); } catch (e) { props.deleteProperty(k); }
    }
  });
  props.setProperty('ses_' + token, JSON.stringify({ u: usuario, exp: exp }));
  return token;
}

/** Devuelve el usuario dueño del token o null. */
function usuarioDeToken(token) {
  if (!token) return null;
  const raw = PropertiesService.getScriptProperties().getProperty('ses_' + token);
  if (!raw) return null;
  let s;
  try { s = JSON.parse(raw); } catch (e) { return null; }
  if (!s || s.exp < Date.now()) return null;
  const u = leerUsuarios().filter(function (x) { return x.usuario === s.u; })[0];
  return (u && u.activo) ? u : null;
}

function puede(u, area, nivel) {
  if (!u) return false;
  if (u.rol === 'admin') return true;
  const v = u.permisos[area];
  return nivel === 'view' ? (v === 'view' || v === 'edit') : v === 'edit';
}

const MODULO_AREA = { orders: 'ordenes', gantt: 'gantt', catalog: 'catalogo', weekly: 'partes', memory: 'ia', config: 'admin', pistones: 'gantt', kpis: 'indicadores', turnos: 'admin', setup: 'gantt', presentacion: 'admin',
  mantenimiento: 'gantt|ordenes', stock: 'ordenes|catalogo', avisos: 'ordenes', informes: 'admin', operarios: 'admin', avisosPush: 'admin', lotes: 'admin', stockPiezas: 'admin', analisis: 'gantt', calidad: 'ordenes', calidadDatos: 'ordenes',
  kpisPrecio: 'indicadores', scrapDet: 'indicadores', scrapCosto: 'indicadores', rebabadoOp: 'indicadores' };
// (12/11/2026) módulos de indicadores con plata: solo a quien ve precios. Rebabado por operario: los nombres solo a quien
// el admin habilitó (permiso detallado kpi_operarios); al resto le llegan como "Operario 1, 2…" y no puede guardar ese módulo.
const MODULOS_PRECIO = { kpisPrecio: true, scrapCosto: true };
function puedeVerOperariosSrv_(u) { return !!u && (u.rol === 'admin' || (puede(u, 'indicadores', 'view') && !!(u.permisos && u.permisos.detalle && u.permisos.detalle.kpi_operarios === true))); }
function anonimizarRebabado_(m) {
  const out = JSON.parse(JSON.stringify(m || {})); const nombres = {}; let n = 0;
  const meses = (out.meses && typeof out.meses === 'object') ? out.meses : {};
  Object.keys(meses).sort().forEach(function (k) {
    (meses[k].f || []).forEach(function (f) { const nom = String(f[4] || ''); if (!nombres[nom]) nombres[nom] = 'Operario ' + (++n); f[4] = nombres[nom]; });
  });
  out.anonimo = true;
  return out;
}
// área 'a|b' = alcanza con tener permiso en cualquiera de las dos
function puedeArea_(u, area, nivel) { return String(area).split('|').some(function (a) { return puede(u, a, nivel); }); }

function modulosVisibles(u) {
  const all = obtenerEstadoModulos();
  const out = {};
  Object.keys(all).forEach(function (k) {
    if (k === 'users') return; // nunca se envía la lista de usuarios por acá
    const area = MODULO_AREA[k];
    if (!area) return;
    if (MODULOS_PRECIO[k] && !puedeVerPreciosSrv_(u)) return;
    if (k === 'turnos' || k === 'presentacion' || k === 'operarios' || k === 'lotes' || (area === 'admin' ? ((k === 'config' && puede(u, 'ia', 'view')) || u.rol === 'admin') : puedeArea_(u, area, 'view'))) out[k] = (k === 'rebabadoOp' && !puedeVerOperariosSrv_(u)) ? anonimizarRebabado_(all[k]) : all[k];
  });
  return out;
}

function respuesta(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function paqueteDatos(u, records) {
  return {
    status: 'ok', auth: publico(u),
    records: puede(u, 'partes', 'view') ? (records || obtenerRegistros()) : [],
    modules: modulosVisibles(u)
  };
}

/** Acciones de cuenta: ingreso, alta inicial y administración de usuarios. */
const ACCIONES_CUENTA = ['authInfo', 'setupAdmin', 'login', 'logout', 'cambiarMiClave', 'listUsers', 'saveUser', 'deleteUser'];

function accionCuenta(body) {
  if (ACCIONES_CUENTA.indexOf(body.action) === -1) return null;
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const usuarios = leerUsuarios();
    if (body.action === 'authInfo') {
      return { status: 'ok', authRequired: true, needsSetup: usuarios.length === 0 };
    }
    if (body.action === 'setupAdmin') {
      if (usuarios.length > 0) return { status: 'error', error: 'Ya existe un administrador.' };
      const usuario = String(body.usuario || '').trim().toLowerCase();
      if (!usuario) return { status: 'error', error: 'Usuario o clave inválidos.' };
      const malaA = claveNuevaMala_(body.clave); if (malaA) return { status: 'error', error: malaA };
      const sal = Utilities.getUuid();
      const u = { usuario: usuario, nombre: String(body.nombre || usuario), rol: 'admin', permisos: normalizarPermisos('admin', {}), activo: true, sal: sal, hash: hashClaveV2_(sal, String(body.clave)) };
      escribirUsuario(u);
      return { status: 'ok', token: crearSesion(usuario), auth: publico(u) };
    }
    if (body.action === 'login') {
      const usuario = String(body.usuario || '').trim().toLowerCase();
      const u = usuarios.filter(function (x) { return x.usuario === usuario; })[0];
      if (intentosClave_(usuario) >= INTENTOS_MAX) {
        Utilities.sleep(800);
        return { status: 'error', error: 'Demasiados intentos con clave equivocada. Esperá ' + BLOQUEO_MIN + ' minutos o pedile al administrador que te cambie la clave.', bloqueado: true };
      }
      if (!u || !u.activo || !claveCorrecta_(u, String(body.clave || ''))) {
        anotarIntento_(usuario, true);
        if (u && intentosClave_(usuario) >= INTENTOS_MAX) try { auditar_(u, 'bloqueado', 'sesión', [INTENTOS_MAX + ' intentos con clave equivocada: bloqueado ' + BLOQUEO_MIN + ' min']); } catch (e) { }
        Utilities.sleep(800);
        return { status: 'error', error: 'Usuario o clave incorrectos.' };
      }
      anotarIntento_(usuario, false);
      auditar_(u, 'ingresó', 'sesión', ['Inició sesión']);
      return { status: 'ok', token: crearSesion(usuario), auth: publico(u) };
    }
    if (body.action === 'logout') {
      if (body.token) PropertiesService.getScriptProperties().deleteProperty('ses_' + body.token);
      return { status: 'ok' };
    }
    const yo = usuarioDeToken(body.token);
    if (!yo) return { status: 'error', error: 'auth' };
    if (body.action === 'cambiarMiClave') {
      if (!claveCorrecta_(yo, String(body.claveActual || ''))) return { status: 'error', error: 'La clave actual no es correcta.' };
      const malaN = claveNuevaMala_(body.claveNueva); if (malaN) return { status: 'error', error: malaN };
      yo.sal = Utilities.getUuid(); yo.hash = hashClaveV2_(yo.sal, String(body.claveNueva));
      escribirUsuario(yo);
      return { status: 'ok' };
    }
    if (yo.rol !== 'admin') return { status: 'error', error: 'Solo el administrador puede gestionar usuarios.' };
    if (body.action === 'listUsers') {
      return { status: 'ok', users: usuarios.map(publico) };
    }
    if (body.action === 'saveUser') {
      const d = body.user || {};
      const usuario = String(d.usuario || '').trim().toLowerCase();
      if (!/^[a-z0-9._-]{3,30}$/.test(usuario)) return { status: 'error', error: 'El usuario debe tener entre 3 y 30 letras o números (sin espacios).' };
      const ex = usuarios.filter(function (x) { return x.usuario === usuario; })[0];
      const rol = d.rol === 'admin' ? 'admin' : 'usuario';
      const activo = d.activo !== false;
      if (ex && ex.rol === 'admin' && (rol !== 'admin' || !activo)) {
        const otrosAdmins = usuarios.filter(function (x) { return x.rol === 'admin' && x.activo && x.usuario !== usuario; });
        if (!otrosAdmins.length) return { status: 'error', error: 'Tiene que quedar al menos un administrador activo.' };
      }
      if (!ex || d.clave) { const malaU = claveNuevaMala_(d.clave); if (malaU) return { status: 'error', error: malaU }; }
      const u = ex || { usuario: usuario, sal: '', hash: '' };
      u.nombre = String(d.nombre || usuario).slice(0, 60);
      u.rol = rol; u.activo = activo;
      u.permisos = normalizarPermisos(rol, d.permisos || {});
      if (d.clave) { u.sal = Utilities.getUuid(); u.hash = hashClaveV2_(u.sal, String(d.clave)); anotarIntento_(u.usuario, false); }
      const permAntes = ex ? JSON.stringify(ex.permisos) : '';
      escribirUsuario(u);
      auditar_(yo, ex ? 'modificó' : 'creó', 'usuarios', [(ex ? 'Usuario ' : 'Creó el usuario ') + usuario + ' (' + u.nombre + ', ' + (rol === 'admin' ? 'administrador' : 'usuario') + (activo ? '' : ', DESACTIVADO') + ')' + (ex && permAntes !== JSON.stringify(u.permisos) ? ' · cambió permisos' : '') + (ex && d.clave ? ' · cambió la clave' : '')]);
      return { status: 'ok', users: leerUsuarios().map(publico) };
    }
    if (body.action === 'deleteUser') {
      const usuario = String(body.usuario || '').toLowerCase();
      if (usuario === yo.usuario) return { status: 'error', error: 'No podés borrar tu propio usuario.' };
      const ex = usuarios.filter(function (x) { return x.usuario === usuario; })[0];
      if (ex) { getUsersSheet().deleteRow(ex.fila); auditar_(yo, 'borró', 'usuarios', ['Borró el usuario ' + usuario]); }
      return { status: 'ok', users: leerUsuarios().map(publico) };
    }
    return null;
  } finally {
    lock.releaseLock();
  }
}

/**
 * EMERGENCIA: si te olvidás la clave del administrador, en el editor de Apps Script
 * elegí esta función arriba (menú desplegable) y tocá "Ejecutar".
 * Genera una clave TEMPORAL al azar y la muestra en el registro de ejecución (cambiala después de entrar).
 */
function restablecerClaveAdmin() {
  const admin = leerUsuarios().filter(function (x) { return x.rol === 'admin'; })[0];
  if (!admin) { Logger.log('No hay administradores: al abrir INOFER se te va a pedir crear uno.'); return; }
  // (13/11/2026) ya no vuelve a una clave fija conocida: genera una al azar que solo ve quien corre esto en el editor
  const temporal = 'inofer-' + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
  admin.sal = Utilities.getUuid(); admin.hash = hashClaveV2_(admin.sal, temporal); admin.activo = true;
  escribirUsuario(admin); anotarIntento_(admin.usuario, false);
  Logger.log('Listo. Usuario: ' + admin.usuario + '  Clave temporal: ' + temporal + '  (cambiala al entrar: menú del usuario → Cambiar mi clave)');
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.action === 'pushPendientes') {
    const pid = String(p.pid || '');
    if (pid.length < 20) return respuesta({ status: 'error', error: 'pid' });
    const f = leerPush_().filter(function (x) { return x.pid === pid; })[0];
    if (!f) return respuesta({ status: 'ok', mensajes: [] });
    const m = f.cola || []; f.cola = []; f.ultimo = new Date().toISOString(); escribirPush_(f);
    return respuesta({ status: 'ok', mensajes: m });
  }
  if (p.action === 'versiones') {
    const u = usuarioDeToken(p.token);
    if (!u) return respuesta({ status: 'error', error: 'auth', authRequired: true });
    revisarAvisosPush_(false);
    return respuesta({ status: 'ok', auth: publico(u), versiones: versiones_() });
  }
  if (p.action === 'json') {
    const u = usuarioDeToken(p.token);
    if (!u) return respuesta({ status: 'error', error: 'auth', authRequired: true });
    const paq = paqueteDatos(u, p.partes === '0' ? [] : null);
    if (p.partes === '0') { delete paq.records; }
    if (p.solo) { const solo = String(p.solo).split(','); const m = {}; solo.forEach(function (k) { if (paq.modules[k] !== undefined) m[k] = paq.modules[k]; }); paq.modules = m; paq.parcial = true; }
    paq.versiones = versiones_();
    return respuesta(paq);
  }
  return HtmlService.createHtmlOutput('<h3>INOFER - servidor de datos funcionando.</h3>');
}

// =====================================================================
// PAPELERA: todo lo que se elimina queda registrado (quién, cuándo, qué) y el
// administrador lo puede restaurar. Hoja BD_Papelera.
// =====================================================================
const PAPELERA_SHEET_NAME = 'BD_Papelera';
const PAPELERA_TIPOS = { parte: 'Parte de horas', orden: 'Orden de producción', pieza: 'Pieza / molde', semana_gantt: 'Semana del Gantt', item_gantt: 'Pieza programada en el Gantt', cierre_semanal: 'Cierre semanal' };

function getPapeleraSheet() {
  const ss = getSs();
  let sh = ss.getSheetByName(PAPELERA_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(PAPELERA_SHEET_NAME);
    sh.appendRow(['id', 'fecha', 'usuario', 'tipo', 'descripcion', 'datos', 'contexto', 'estado', 'restaurado_por', 'restaurado_fecha']);
    sh.getRange('A:J').setNumberFormat('@');
  }
  return sh;
}

function describirEliminado(tipo, d, ctx) {
  d = d || {}; ctx = ctx || {};
  if (tipo === 'parte') return (d.date || '') + ' · ' + (d.machine || '') + ' · Turno ' + (d.shift || '') + ' (' + (Number(d.available) || 0) + ' h disp.)';
  if (tipo === 'orden') return 'OP ' + (d.ordNumber || d.id || '') + ' · Pieza ' + (d.part || '') + ' · ' + (d.machine || '') + (d.status ? ' · ' + d.status : '');
  if (tipo === 'pieza') return 'Pieza ' + (d.part || '') + ' · Molde ' + (d.mold || '-') + (d.portamolde ? ' · Portamolde ' + d.portamolde : '');
  if (tipo === 'semana_gantt') return 'Semana ' + (d.code || ctx.semana || '') + (d.name ? ' · ' + d.name : '');
  if (tipo === 'item_gantt') return 'Pieza ' + (d.part || '') + ' · Máquina ' + (ctx.maquina || '') + ' · Semana ' + (ctx.semana || '') + ' (' + (Number(d.totalQty) || 0) + ' u.)';
  if (tipo === 'cierre_semanal') return 'Cierre ' + (d.label || d.weekLabel || d.date || '');
  return tipo;
}

function registrarEliminados(u, tipo, lista, ctx) {
  if (!lista || !lista.length) return;
  const sh = getPapeleraSheet();
  const ahora = new Date().toISOString();
  const filas = lista.map(function (d) {
    let json = JSON.stringify(d);
    if (json.length > 45000) json = json.substring(0, 45000);
    return [Utilities.getUuid(), ahora, u.usuario, tipo, describirEliminado(tipo, d, ctx).substring(0, 300), json, JSON.stringify(ctx || {}), 'eliminado', '', ''];
  });
  const inicio = sh.getLastRow() + 1;
  sh.getRange(inicio, 1, filas.length, 10).setNumberFormat('@').setValues(filas);
}

function idsDe(lista) {
  const m = {};
  (lista || []).forEach(function (x) { if (x && x.id != null) m[String(x.id)] = x; });
  return m;
}

/** Compara el estado anterior con el nuevo y registra lo que desapareció. */
function registrarDiferencias(u, clave, anterior, nuevo) {
  if (clave === 'orders' || clave === 'catalog') {
    const tipo = clave === 'orders' ? 'orden' : 'pieza';
    const nuevos = idsDe(nuevo);
    const borrados = (anterior || []).filter(function (x) { return x && x.id != null && !nuevos[String(x.id)]; });
    registrarEliminados(u, tipo, borrados, {});
  } else if (clave === 'weekly') {
    const nuevosTxt = {};
    (nuevo || []).forEach(function (x) { nuevosTxt[JSON.stringify(x)] = true; });
    const borrados = (anterior || []).filter(function (x) { return !nuevosTxt[JSON.stringify(x)]; });
    registrarEliminados(u, 'cierre_semanal', borrados, {});
  } else if (clave === 'gantt') {
    const ant = anterior || {}, nue = nuevo || {};
    Object.keys(ant).forEach(function (code) {
      const semAnt = ant[code];
      if (!nue[code]) { registrarEliminados(u, 'semana_gantt', [Object.assign({ code: code }, semAnt)], { semana: code }); return; }
      const mAnt = (semAnt && semAnt.machines) || {}, mNue = (nue[code] && nue[code].machines) || {};
      Object.keys(mAnt).forEach(function (mach) {
        const restantes = {};
        ((mNue[mach] && mNue[mach].items) || []).forEach(function (it) { const k = JSON.stringify(it); restantes[k] = (restantes[k] || 0) + 1; });
        const borrados = [];
        ((mAnt[mach] && mAnt[mach].items) || []).forEach(function (it) {
          const k = JSON.stringify(it);
          if (restantes[k]) restantes[k]--;
          else borrados.push(it);
        });
        // Un ítem "editado" (cambió la cantidad) no es un borrado: solo se registra si su pieza ya no está en esa máquina
        const piezasQuedan = {};
        ((mNue[mach] && mNue[mach].items) || []).forEach(function (it) { piezasQuedan[String(it.part || '').toLowerCase()] = true; });
        registrarEliminados(u, 'item_gantt', borrados.filter(function (it) { return !piezasQuedan[String(it.part || '').toLowerCase()]; }), { semana: code, maquina: mach });
      });
    });
  }
}

function leerPapelera() {
  const sh = getPapeleraSheet();
  const rows = sh.getDataRange().getValues();
  const out = [];
  for (let i = rows.length - 1; i >= 1 && out.length < 1000; i--) {
    const r = rows[i];
    if (!r[0]) continue;
    out.push({ fila: i + 1, id: String(r[0]), fecha: String(r[1]), usuario: String(r[2]), tipo: String(r[3]), tipoNombre: PAPELERA_TIPOS[String(r[3])] || String(r[3]),
      descripcion: String(r[4]), datos: String(r[5]), contexto: String(r[6] || '{}'), estado: String(r[7] || 'eliminado'), restauradoPor: String(r[8] || ''), restauradoFecha: String(r[9] || '') });
  }
  return out;
}

function restaurarDePapelera(u, id) {
  const item = leerPapelera().filter(function (x) { return x.id === String(id); })[0];
  if (!item) return { status: 'error', error: 'No se encontró ese elemento en la papelera.' };
  if (item.estado === 'restaurado') return { status: 'error', error: 'Ese elemento ya fue restaurado.' };
  let d, ctx;
  try { d = JSON.parse(item.datos); ctx = JSON.parse(item.contexto || '{}'); } catch (e) { return { status: 'error', error: 'Los datos guardados están dañados.' }; }
  const mods = obtenerEstadoModulos();
  if (item.tipo === 'parte') {
    if (obtenerRegistros().some(function (r) { return String(r.id) === String(d.id); })) return { status: 'error', error: 'Ese parte ya existe (no hace falta restaurarlo).' };
    guardarRegistro(d);
  } else if (item.tipo === 'orden' || item.tipo === 'pieza') {
    const clave = item.tipo === 'orden' ? 'orders' : 'catalog';
    const lista = Array.isArray(mods[clave]) ? mods[clave] : [];
    if (lista.some(function (x) { return String(x.id) === String(d.id); })) return { status: 'error', error: 'Ya existe un elemento con ese mismo código.' };
    lista.unshift(d);
    guardarModuloEstado(clave, lista);
  } else if (item.tipo === 'semana_gantt') {
    const g = mods.gantt || {};
    const code = d.code || ctx.semana;
    if (g[code]) return { status: 'error', error: 'La semana ' + code + ' ya existe en el Gantt.' };
    g[code] = d;
    guardarModuloEstado('gantt', g);
  } else if (item.tipo === 'item_gantt') {
    const g = mods.gantt || {};
    const sem = g[ctx.semana];
    if (!sem) return { status: 'error', error: 'La semana ' + ctx.semana + ' ya no existe: restaurá primero la semana.' };
    sem.machines = sem.machines || {};
    const m = sem.machines[ctx.maquina] = sem.machines[ctx.maquina] || { aux: {}, items: [] };
    m.items = m.items || [];
    m.items.push(d);
    guardarModuloEstado('gantt', g);
  } else if (item.tipo === 'cierre_semanal') {
    const w = Array.isArray(mods.weekly) ? mods.weekly : [];
    w.unshift(d);
    guardarModuloEstado('weekly', w);
  } else {
    return { status: 'error', error: 'Tipo desconocido.' };
  }
  getPapeleraSheet().getRange(item.fila, 8, 1, 3).setValues([['restaurado', u.usuario, new Date().toISOString()]]);
  return null; // ok
}

function accionPapelera(u, body) {
  if (u.rol !== 'admin') return { status: 'error', error: 'Solo el administrador puede ver la papelera.' };
  if (body.action === 'listPapelera') {
    return { status: 'ok', papelera: leerPapelera().map(function (x) { const c = Object.assign({}, x); delete c.fila; return c; }) };
  }
  if (body.action === 'restaurarPapelera') {
    const err = restaurarDePapelera(u, body.id);
    if (err) return err;
    const out = paqueteDatos(u);
    out.papelera = leerPapelera().map(function (x) { const c = Object.assign({}, x); delete c.fila; return c; });
    out.restaurado = true;
    return out;
  }
  if (body.action === 'vaciarPapelera') {
    // borra definitivamente: solo los restaurados, o todo si body.todo === true
    const sh = getPapeleraSheet();
    if (body.todo === true) {
      if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
      return { status: 'ok', papelera: [] };
    }
    const rows = sh.getDataRange().getValues();
    for (let i = rows.length - 1; i >= 1; i--) {
      const porId = body.ids && body.ids.indexOf(String(rows[i][0])) !== -1;
      if (body.todo === true || porId || (!body.soloIds && String(rows[i][7]) === 'restaurado')) sh.deleteRow(i + 1);
    }
    return { status: 'ok', papelera: leerPapelera().map(function (x) { const c = Object.assign({}, x); delete c.fila; return c; }) };
  }
  return null;
}

// ===================== MENSAJERÍA: chats privados, grupos y solicitudes al administrador =====================
// Hojas: BD_Chats, BD_Mensajes, BD_Solicitudes. Cada usuario solo recibe lo suyo.
const ACCIONES_MSG = ['msgAdminListar', 'msgAdminLeer', 'msgEstado', 'msgLeer', 'msgEnviar', 'msgCrearChat', 'msgBorrarChat', 'msgBorrarMensaje', 'msgEditarGrupo',
  'solListar', 'solCrear', 'solActualizar', 'solBorrar', 'solVisto'];

function hojaMsg_(nombre, cab) {
  const ss = getSs();
  let sh = ss.getSheetByName(nombre);
  if (!sh) { sh = ss.insertSheet(nombre); sh.appendRow(cab); }
  return sh;
}
function hojaChats_() { return hojaMsg_('BD_Chats', ['id', 'tipo', 'nombre', 'miembros', 'creado_por', 'creado_at', 'ultimo_at', 'leidos']); }
function hojaMensajes_() { return hojaMsg_('BD_Mensajes', ['id', 'chat_id', 'autor', 'nombre', 'texto', 'fecha']); }
function hojaSolicitudes_() { return hojaMsg_('BD_Solicitudes', ['id', 'autor', 'nombre', 'tipo', 'titulo', 'detalle', 'estado', 'respuesta', 'respondido_por', 'fecha', 'actualizado', 'visto_admin', 'visto_autor']); }
function jsonSeguro_(v, def) { try { const x = JSON.parse(String(v || '')); return x == null ? def : x; } catch (e) { return def; } }
function idNuevo_(p) { return p + '-' + new Date().getTime() + '-' + Math.floor(Math.random() * 1e6); }

function leerChats_() {
  const rows = hojaChats_().getDataRange().getValues();
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0]) continue;
    out.push({ fila: i + 1, id: String(r[0]), tipo: String(r[1]), nombre: String(r[2] || ''), miembros: jsonSeguro_(r[3], []), creadoPor: String(r[4] || ''),
      creadoAt: String(r[5] || ''), ultimoAt: String(r[6] || ''), leidos: jsonSeguro_(r[7], {}) });
  }
  return out;
}
function escribirChat_(c) {
  const fila = [c.id, c.tipo, c.nombre, JSON.stringify(c.miembros), c.creadoPor, c.creadoAt, c.ultimoAt, JSON.stringify(c.leidos || {})];
  const sh = hojaChats_();
  if (c.fila) sh.getRange(c.fila, 1, 1, 8).setValues([fila]); else sh.appendRow(fila);
}
function leerMensajes_(chatId) {
  const rows = hojaMensajes_().getDataRange().getValues();
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0] || (chatId && String(r[1]) !== chatId)) continue;
    out.push({ fila: i + 1, id: String(r[0]), chatId: String(r[1]), autor: String(r[2]), nombre: String(r[3] || ''), texto: String(r[4] || ''), fecha: String(r[5] || '') });
  }
  return out;
}
function borrarFilas_(sh, filas) { filas.sort(function (a, b) { return b - a; }).forEach(function (f) { sh.deleteRow(f); }); }
// Permisos de mensajería por usuario (los define el administrador): chat_usar y chat_recibir (por defecto, sí)
function chatPuedeUsar_(u) { return !!u && (u.rol === 'admin' || !(u.permisos && u.permisos.detalle && u.permisos.detalle.chat_usar === false)); }
function chatPuedeRecibir_(u) { return !!u && (u.rol === 'admin' || (chatPuedeUsar_(u) && !(u.permisos && u.permisos.detalle && u.permisos.detalle.chat_recibir === false))); }
function directorio_() {
  return leerUsuarios().filter(function (x) { return x.activo && chatPuedeRecibir_(x); }).map(function (x) { return { usuario: x.usuario, nombre: x.nombre, rol: x.rol }; });
}
function chatPublico_(c, u, msgs) {
  const mios = msgs.filter(function (m) { return m.chatId === c.id; });
  const ult = mios.length ? mios[mios.length - 1] : null;
  const leido = (c.leidos || {})[u.usuario] || '';
  return { id: c.id, tipo: c.tipo, nombre: c.nombre, miembros: c.miembros, creadoPor: c.creadoPor, ultimoAt: c.ultimoAt,
    ultimo: ult ? { texto: ult.texto.slice(0, 120), autor: ult.autor, nombre: ult.nombre, fecha: ult.fecha } : null,
    noLeidos: mios.filter(function (m) { return m.autor !== u.usuario && m.fecha > leido; }).length };
}
function leerSolicitudes_() {
  const rows = hojaSolicitudes_().getDataRange().getValues();
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0]) continue;
    out.push({ fila: i + 1, id: String(r[0]), autor: String(r[1]), nombre: String(r[2] || ''), tipo: String(r[3] || ''), titulo: String(r[4] || ''), detalle: String(r[5] || ''),
      estado: String(r[6] || 'pendiente'), respuesta: String(r[7] || ''), respondidoPor: String(r[8] || ''), fecha: String(r[9] || ''), actualizado: String(r[10] || ''),
      vistoAdmin: String(r[11]) === 'si', vistoAutor: String(r[12]) !== 'no' });
  }
  return out;
}
function escribirSolicitud_(s) {
  const fila = [s.id, s.autor, s.nombre, s.tipo, s.titulo, s.detalle, s.estado, s.respuesta, s.respondidoPor, s.fecha, s.actualizado, s.vistoAdmin ? 'si' : 'no', s.vistoAutor ? 'si' : 'no'];
  const sh = hojaSolicitudes_();
  if (s.fila) sh.getRange(s.fila, 1, 1, 13).setValues([fila]); else sh.appendRow(fila);
}
function solPublica_(s) { const c = Object.assign({}, s); delete c.fila; return c; }
// ver todas las solicitudes: admin, o permiso detalle sol_ver_todas === true (se habilita a mano)
function veTodasSol_(u) { return !!u && (u.rol === 'admin' || !!(u.permisos && u.permisos.detalle && u.permisos.detalle.sol_ver_todas === true)); }
function solicitudesDe_(u) {
  const todas = leerSolicitudes_();
  return (veTodasSol_(u) ? todas : todas.filter(function (s) { return s.autor === u.usuario; })).map(solPublica_).reverse();
}

function accionMensajeria(u, body) {
  if (ACCIONES_MSG.indexOf(body.action) === -1) return null;
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ahora = new Date().toISOString();
    const yo = u.usuario;
    const nombreYo = u.nombre || u.usuario;
    const texto = function (v, max) { return String(v == null ? '' : v).trim().slice(0, max || 2000); };
    const esChat = body.action.indexOf('msg') === 0;

    // Supervisión: el administrador puede leer todos los chats (uso laboral), sin marcarlos como leídos
    if (body.action === 'msgAdminListar' || body.action === 'msgAdminLeer') {
      if (u.rol !== 'admin') return { status: 'error', error: 'Solo el administrador.' };
      const nombres = {}; leerUsuarios().forEach(function (x) { nombres[x.usuario] = x.nombre || x.usuario; });
      if (body.action === 'msgAdminListar') {
        const msgs = leerMensajes_();
        return { status: 'ok', nombres: nombres, chats: leerChats_().map(function (c) {
          const ms = msgs.filter(function (m) { return m.chatId === c.id; }); const ult = ms[ms.length - 1];
          return { id: c.id, tipo: c.tipo, nombre: c.nombre, miembros: c.miembros, creadoPor: c.creadoPor, ultimoAt: c.ultimoAt, cantidad: ms.length,
            ultimo: ult ? { texto: ult.texto.slice(0, 120), nombre: ult.nombre, fecha: ult.fecha } : null };
        }).sort(function (a, b) { return String(b.ultimoAt).localeCompare(String(a.ultimoAt)); }) };
      }
      const c = leerChats_().filter(function (x) { return x.id === String(body.chatId || ''); })[0];
      if (!c) return { status: 'error', error: 'Chat inexistente.' };
      return { status: 'ok', nombres: nombres, chat: { id: c.id, tipo: c.tipo, nombre: c.nombre, miembros: c.miembros, creadoPor: c.creadoPor },
        mensajes: leerMensajes_(c.id).map(function (m) { const x = Object.assign({}, m); delete x.fila; return x; }).slice(-500) };
    }
    if (esChat && !chatPuedeUsar_(u)) {
      if (body.action === 'msgEstado') {
        const sols0 = leerSolicitudes_();
        return { status: 'ok', chats: [], directorio: [], chatBloqueado: true, solicitudesAviso: sols0.filter(function (s) { return s.autor === yo && !s.vistoAutor; }).length, solPendientes: 0 };
      }
      return { status: 'error', error: 'El administrador no te habilitó el chat.' };
    }

    if (body.action === 'msgEstado') {
      const chats = leerChats_().filter(function (c) { return c.miembros.indexOf(yo) !== -1; });
      const msgs = leerMensajes_();
      const sols = leerSolicitudes_();
      const solAviso = u.rol === 'admin'
        ? sols.filter(function (s) { return !s.vistoAdmin; }).length
        : sols.filter(function (s) { return s.autor === yo && !s.vistoAutor; }).length;
      return { status: 'ok', chats: chats.map(function (c) { return chatPublico_(c, u, msgs); }).sort(function (a, b) { return String(b.ultimoAt).localeCompare(String(a.ultimoAt)); }),
        directorio: directorio_(), solicitudesAviso: solAviso, solPendientes: veTodasSol_(u) ? sols.filter(function (s) { return s.estado === 'pendiente'; }).length : 0, solVerTodas: veTodasSol_(u) };
    }

    if (body.action === 'msgCrearChat') {
      const dir = directorio_().map(function (x) { return x.usuario; });
      let miembros = (Array.isArray(body.miembros) ? body.miembros : []).map(function (x) { return String(x).toLowerCase(); }).filter(function (x) { return dir.indexOf(x) !== -1 && x !== yo; });
      if (!miembros.length && (body.miembros || []).length) return { status: 'error', error: 'Esa persona no puede recibir mensajes.' };
      miembros = miembros.filter(function (x, i) { return miembros.indexOf(x) === i; });
      if (!miembros.length) return { status: 'error', error: 'Elegí al menos una persona.' };
      const tipo = body.tipo === 'grupo' ? 'grupo' : 'privado';
      if (tipo === 'privado') {
        miembros = [miembros[0]];
        const ya = leerChats_().filter(function (c) { return c.tipo === 'privado' && c.miembros.length === 2 && c.miembros.indexOf(yo) !== -1 && c.miembros.indexOf(miembros[0]) !== -1; })[0];
        if (ya) return { status: 'ok', chatId: ya.id };
      }
      const nombre = tipo === 'grupo' ? (texto(body.nombre, 60) || 'Grupo') : '';
      const c = { id: idNuevo_('chat'), tipo: tipo, nombre: nombre, miembros: [yo].concat(miembros), creadoPor: yo, creadoAt: ahora, ultimoAt: ahora, leidos: {} };
      c.leidos[yo] = ahora;
      escribirChat_(c);
      return { status: 'ok', chatId: c.id };
    }

    const chatDe = function (id) { return leerChats_().filter(function (c) { return c.id === String(id || ''); })[0]; };

    if (body.action === 'msgLeer' || body.action === 'msgEnviar') {
      const c = chatDe(body.chatId);
      if (!c || c.miembros.indexOf(yo) === -1) return { status: 'error', error: 'Chat inexistente.' };
      if (body.action === 'msgEnviar') {
        if (c.tipo === 'privado') {
          const otro = c.miembros.filter(function (x) { return x !== yo; })[0];
          const uo = leerUsuarios().filter(function (x) { return x.usuario === otro; })[0];
          if (!uo || !uo.activo || !chatPuedeRecibir_(uo)) return { status: 'error', error: 'A esta persona ya no se le pueden mandar mensajes.' };
        }
        const t = texto(body.texto, 2000);
        if (!t) return { status: 'error', error: 'Mensaje vacío.' };
        hojaMensajes_().appendRow([idNuevo_('msg'), c.id, yo, nombreYo, t, ahora]);
        c.ultimoAt = ahora;
        try { enviarPush_('msg', { titulo: c.tipo === 'grupo' ? nombreYo + ' en ' + (c.nombre || 'el grupo') : 'Mensaje de ' + nombreYo, cuerpo: t, ir: 'msg', tag: 'chat-' + c.id }, { usuarios: c.miembros.filter(function (x) { return x !== yo; }) }); } catch (e) {}
      }
      c.leidos = c.leidos || {}; c.leidos[yo] = ahora;
      escribirChat_(c);
      const msgs = leerMensajes_(c.id).map(function (m) { const x = Object.assign({}, m); delete x.fila; return x; });
      return { status: 'ok', chat: chatPublico_(c, u, []), mensajes: msgs.slice(-300) };
    }

    if (body.action === 'msgBorrarMensaje') {
      const m = leerMensajes_().filter(function (x) { return x.id === String(body.id || ''); })[0];
      if (!m) return { status: 'ok' };
      const c = chatDe(m.chatId);
      if (m.autor !== yo && u.rol !== 'admin') return { status: 'error', error: 'Solo podés borrar tus mensajes.' };
      if (!c || (c.miembros.indexOf(yo) === -1 && u.rol !== 'admin')) return { status: 'error', error: 'Chat inexistente.' };
      hojaMensajes_().deleteRow(m.fila);
      return { status: 'ok' };
    }

    if (body.action === 'msgBorrarChat') {
      const c = chatDe(body.chatId);
      if (!c || (c.miembros.indexOf(yo) === -1 && u.rol !== 'admin')) return { status: 'ok' };
      const borraTodo = c.tipo === 'privado' || c.creadoPor === yo || u.rol === 'admin';
      if (!borraTodo || body.salir === true) {
        c.miembros = c.miembros.filter(function (x) { return x !== yo; });
        if (c.miembros.length) { escribirChat_(c); return { status: 'ok', salio: true }; }
      }
      borrarFilas_(hojaMensajes_(), leerMensajes_(c.id).map(function (m) { return m.fila; }));
      hojaChats_().deleteRow(c.fila);
      return { status: 'ok', borrado: true };
    }

    if (body.action === 'msgEditarGrupo') {
      const c = chatDe(body.chatId);
      if (!c || c.tipo !== 'grupo') return { status: 'error', error: 'Grupo inexistente.' };
      if (c.creadoPor !== yo && u.rol !== 'admin') return { status: 'error', error: 'Solo quien creó el grupo lo puede modificar.' };
      const dir = directorio_().map(function (x) { return x.usuario; });
      if (body.nombre != null) c.nombre = texto(body.nombre, 60) || c.nombre;
      if (Array.isArray(body.miembros)) {
        let ms = body.miembros.map(function (x) { return String(x).toLowerCase(); }).filter(function (x) { return dir.indexOf(x) !== -1; });
        if (ms.indexOf(c.creadoPor) === -1) ms.unshift(c.creadoPor);
        c.miembros = ms.filter(function (x, i) { return ms.indexOf(x) === i; });
      }
      escribirChat_(c);
      return { status: 'ok' };
    }

    // ---------- solicitudes al administrador ----------
    if (body.action === 'solListar') return { status: 'ok', solicitudes: solicitudesDe_(u) };
    if (body.action === 'solCrear') {
      const t = texto(body.titulo, 120);
      if (!t) return { status: 'error', error: 'Poné un título.' };
      escribirSolicitud_({ id: idNuevo_('sol'), autor: yo, nombre: nombreYo, tipo: texto(body.tipo, 60) || 'Otro', titulo: t, detalle: texto(body.detalle, 3000),
        estado: 'pendiente', respuesta: '', respondidoPor: '', fecha: ahora, actualizado: ahora, vistoAdmin: u.rol === 'admin', vistoAutor: true });
      try { enviarPush_('msg', { titulo: 'Solicitud de ' + nombreYo, cuerpo: t, ir: 'msg', tag: 'sol' }, { usuarios: leerUsuarios().filter(function (x) { return x.rol === 'admin'; }).map(function (x) { return x.usuario; }), excluir: yo }); } catch (e) {}
      return { status: 'ok', solicitudes: solicitudesDe_(u) };
    }
    const solDe = function (id) { return leerSolicitudes_().filter(function (s) { return s.id === String(id || ''); })[0]; };
    if (body.action === 'solActualizar') {
      if (u.rol !== 'admin') return { status: 'error', error: 'Solo el administrador responde solicitudes.' };
      const s = solDe(body.id);
      if (!s) return { status: 'error', error: 'Solicitud inexistente.' };
      if (['pendiente', 'en curso', 'resuelta', 'rechazada'].indexOf(body.estado) !== -1) s.estado = body.estado;
      if (body.respuesta != null) s.respuesta = texto(body.respuesta, 3000);
      s.respondidoPor = nombreYo; s.actualizado = ahora; s.vistoAdmin = true; s.vistoAutor = s.autor === yo;
      escribirSolicitud_(s);
      try { if (s.autor !== yo) enviarPush_('msg', { titulo: 'Tu solicitud: ' + s.estado, cuerpo: s.titulo + (s.respuesta ? ' — ' + s.respuesta : ''), ir: 'msg', tag: 'sol-' + s.id }, { usuarios: [s.autor] }); } catch (e) {}
      return { status: 'ok', solicitudes: solicitudesDe_(u) };
    }
    if (body.action === 'solVisto') {
      leerSolicitudes_().forEach(function (s) {
        if (u.rol === 'admin' && !s.vistoAdmin) { s.vistoAdmin = true; escribirSolicitud_(s); }
        else if (s.autor === yo && !s.vistoAutor) { s.vistoAutor = true; escribirSolicitud_(s); }
      });
      return { status: 'ok' };
    }
    if (body.action === 'solBorrar') {
      const s = solDe(body.id);
      if (!s) return { status: 'ok', solicitudes: solicitudesDe_(u) };
      if (s.autor !== yo && u.rol !== 'admin') return { status: 'error', error: 'Solo podés borrar tus solicitudes.' };
      hojaSolicitudes_().deleteRow(s.fila);
      return { status: 'ok', solicitudes: solicitudesDe_(u) };
    }
    return null;
  } finally {
    lock.releaseLock();
  }
}

// ===================== IA (Gemini) a través del servidor: la clave queda guardada en la nube =====================
const ACCIONES_IA = ['iaInfo', 'iaConfig', 'iaGenerar'];
// Probados con una clave AQ del plan gratuito (29/10/2026): 3.5-flash, 3-flash-preview y 3.1-flash-lite responden en 1-3 s;
// 3.7/3.8-flash quedaban colgados y 2.5-flash ya no está disponible para cuentas nuevas.
const IA_MODELOS_BASE = ['gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite', 'gemini-flash-latest', 'gemini-flash-lite-latest'];
// Descubre qué modelos "flash" tiene habilitados la clave (Google los va cambiando); se guarda 1 día
function iaModelos_(clave) {
  const props = PropertiesService.getScriptProperties();
  try {
    const c = JSON.parse(props.getProperty('IA_MODELOS_CACHE2') || 'null');
    if (c && c.t > Date.now() - 24 * 3600 * 1000 && c.k === String(clave).slice(-6) && c.m && c.m.length) return c.m;
  } catch (e) {}
  let lista = [];
  try {
    let r = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { muteHttpExceptions: true, headers: { 'x-goog-api-key': clave } });
    if (r.getResponseCode() !== 200) r = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=' + encodeURIComponent(clave), { muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) r = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + clave } });
    if (r.getResponseCode() === 200) {
      const d = JSON.parse(r.getContentText());
      lista = (d.models || []).filter(function (m) {
        return (m.supportedGenerationMethods || []).indexOf('generateContent') !== -1 && /gemini-[\d.]+-flash$|gemini-flash-latest$/.test(m.name || '');
      }).map(function (m) { return String(m.name).replace(/^models\//, ''); });
      const ver = function (n) { const x = n.match(/gemini-([\d.]+)-flash/); return x ? parseFloat(x[1]) : 0; };
      lista.sort(function (a, b) { return ((b === 'gemini-flash-latest') - (a === 'gemini-flash-latest')) || (ver(b) - ver(a)); });
    }
  } catch (e) {}
  // primero los modelos probados que la clave tiene habilitados; los demás solo como último recurso
  const probados = lista.length ? IA_MODELOS_BASE.filter(function (x) { return lista.indexOf(x) !== -1; }) : IA_MODELOS_BASE.slice();
  const m = probados.concat(lista.length ? [] : []).filter(function (x, i, arr) { return arr.indexOf(x) === i; });
  if (!m.length) m.push('gemini-flash-latest');
  if (lista.length) props.setProperty('IA_MODELOS_CACHE2', JSON.stringify({ t: Date.now(), k: String(clave).slice(-6), m: m }));
  return m;
}
function iaClave_() { const p = PropertiesService.getScriptProperties(); return p.getProperty('IA_KEY') || p.getProperty('GEMINI_KEY') || ''; }
function iaProveedor_(clave) { return /^sk-ant-/.test(String(clave || '')) ? 'claude' : 'gemini'; }
// Claude (Anthropic): convierte el pedido con formato Gemini al de la API de Claude
const CLAUDE_MODELOS = ['claude-sonnet-5-5', 'claude-haiku-5-5'];
function iaLlamarClaude_(clave, cuerpo) {
  const sistema = cuerpo.systemInstruction && cuerpo.systemInstruction.parts ? cuerpo.systemInstruction.parts.map(function (p) { return p.text || ''; }).join('\n') : '';
  const msgs = [];
  (cuerpo.contents || []).forEach(function (c) {
    const rol = c.role === 'model' ? 'assistant' : 'user';
    const t = (c.parts || []).map(function (p) { return p.text || ''; }).join('\n');
    if (!t) return;
    if (msgs.length && msgs[msgs.length - 1].role === rol) msgs[msgs.length - 1].content += '\n' + t; else msgs.push({ role: rol, content: t });
  });
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  const gc = cuerpo.generationConfig || {};
  let sys = sistema;
  if (gc.responseMimeType === 'application/json') sys += '\nDevolvé únicamente JSON válido, sin texto antes ni después.';
  let ultimo = 'sin respuesta';
  for (let i = 0; i < CLAUDE_MODELOS.length; i++) {
    const payload = { model: CLAUDE_MODELOS[i], max_tokens: Math.min(4096, Number(gc.maxOutputTokens) || 2048), messages: msgs };
    if (sys) payload.system = sys;
    if (gc.temperature != null) payload.temperature = Number(gc.temperature);
    const r = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true,
      headers: { 'x-api-key': clave, 'anthropic-version': '2023-06-01' }
    });
    const code = r.getResponseCode();
    let d = {};
    try { d = JSON.parse(r.getContentText()); } catch (e) {}
    if (code === 200) {
      const t = (d.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('').trim();
      if (t) return { ok: true, texto: t };
      ultimo = 'respuesta vacía'; continue;
    }
    const msg = String((d.error && d.error.message) || code);
    if (code === 401) return { ok: false, error: 'la clave de Claude no es válida' };
    if (code === 400 && /credit|billing/i.test(msg)) return { ok: false, error: 'la cuenta de Claude no tiene saldo (cargá crédito en console.anthropic.com)' };
    ultimo = msg;
  }
  return { ok: false, error: ultimo };
}
// Formas de mandar la clave a Google: las claves nuevas (AQ.…) no funcionan igual en todas las cuentas
const IA_AUTH_MODOS = ['header', 'query', 'bearer', 'openai'];
function iaPedirGemini_(clave, modo, modelo, cuerpo) {
  const base = 'https://generativelanguage.googleapis.com/v1beta/';
  if (modo === 'openai') {
    // endpoint compatible con OpenAI (Authorization: Bearer)
    const msgs = [];
    const sis = cuerpo.systemInstruction && cuerpo.systemInstruction.parts ? cuerpo.systemInstruction.parts.map(function (p) { return p.text || ''; }).join('\n') : '';
    const gc = cuerpo.generationConfig || {};
    if (sis || gc.responseMimeType === 'application/json') msgs.push({ role: 'system', content: sis + (gc.responseMimeType === 'application/json' ? '\nDevolvé únicamente JSON válido.' : '') });
    (cuerpo.contents || []).forEach(function (c) { msgs.push({ role: c.role === 'model' ? 'assistant' : 'user', content: (c.parts || []).map(function (p) { return p.text || ''; }).join('\n') }); });
    const pl = { model: modelo, messages: msgs };
    if (gc.temperature != null) pl.temperature = gc.temperature;
    if (gc.maxOutputTokens) pl.max_tokens = gc.maxOutputTokens;
    const r = UrlFetchApp.fetch(base + 'openai/chat/completions', { method: 'post', contentType: 'application/json', payload: JSON.stringify(pl), muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + clave } });
    let d = {}; try { d = JSON.parse(r.getContentText()); } catch (e) {}
    if (Array.isArray(d)) d = d[0] || {};
    const t = r.getResponseCode() === 200 ? String((((d.choices || [])[0] || {}).message || {}).content || '').trim() : '';
    return { code: r.getResponseCode(), texto: t, msg: String((d.error && d.error.message) || r.getResponseCode()) };
  }
  const url = base + 'models/' + modelo + ':generateContent' + (modo === 'query' ? '?key=' + encodeURIComponent(clave) : '');
  const op = { method: 'post', contentType: 'application/json', payload: JSON.stringify(cuerpo), muteHttpExceptions: true };
  if (modo === 'header') op.headers = { 'x-goog-api-key': clave };
  if (modo === 'bearer') op.headers = { Authorization: 'Bearer ' + clave };
  const r = UrlFetchApp.fetch(url, op);
  let d = {}; try { d = JSON.parse(r.getContentText()); } catch (e) {}
  const partes = (((d.candidates || [])[0] || {}).content || {}).parts || [];
  return { code: r.getResponseCode(), texto: r.getResponseCode() === 200 ? partes.filter(function (p) { return !p.thought; }).map(function (p) { return p.text || ''; }).join('').trim() : '', msg: String((d.error && d.error.message) || r.getResponseCode()) };
}
function iaLlamar_(clave, cuerpo) {
  if (iaProveedor_(clave) === 'claude') return iaLlamarClaude_(clave, cuerpo);
  const props = PropertiesService.getScriptProperties();
  const recordado = props.getProperty('IA_AUTH_MODO') || '';
  const modos = recordado ? [recordado].concat(IA_AUTH_MODOS.filter(function (m) { return m !== recordado; })) : IA_AUTH_MODOS.slice();
  const IA_MODELOS = iaModelos_(clave);
  let ultimo = 'sin respuesta', primero = '', clave_mala = false;
  for (let mi = 0; mi < modos.length; mi++) {
    const modo = modos[mi];
    let authFallo = false;
    for (let i = 0; i < IA_MODELOS.length; i++) {
      const r = iaPedirGemini_(clave, modo, IA_MODELOS[i], cuerpo);
      if (r.code === 200 && r.texto) { if (modo !== recordado) props.setProperty('IA_AUTH_MODO', modo); return { ok: true, texto: r.texto }; }
      if (r.code === 200) { ultimo = 'respuesta vacía'; continue; }
      if (r.code === 429 && i === IA_MODELOS.length - 1) return { ok: false, error: 'se alcanzó el límite gratuito de Gemini, probá en un rato' };
      if (r.code === 429 || r.code >= 500) { ultimo = IA_MODELOS[i] + ': ' + r.msg; continue; }
      const authErr = r.code === 401 || r.code === 403 || (r.code === 400 && /api key|credential|authenticat|token/i.test(r.msg));
      if (authErr) { authFallo = true; clave_mala = clave_mala || /api key not valid|API_KEY_INVALID/i.test(r.msg); ultimo = modo + ': ' + r.msg; break; }
      ultimo = IA_MODELOS[i] + ': ' + r.msg;
      if (!primero && r.code !== 404 && !/no longer available|not found|not supported/i.test(r.msg)) primero = ultimo;
    }
    if (!authFallo) break; // la clave anduvo pero ningún modelo respondió: no tiene sentido otra forma de autenticar
  }
  if (!primero && clave_mala) return { ok: false, error: 'Google dice que la clave no es válida (' + ultimo.slice(0, 140) + ')' };
  return { ok: false, error: primero || ultimo };
}
function accionIA(u, body) {
  if (ACCIONES_IA.indexOf(body.action) === -1) return null;
  if (body.action === 'iaInfo') return { status: 'ok', configurada: !!iaClave_(), proveedor: iaClave_() ? iaProveedor_(iaClave_()) : '' };
  if (body.action === 'iaConfig') {
    if (u.rol !== 'admin') return { status: 'error', error: 'Solo el administrador configura la IA.' };
    const k = String(body.clave || '').trim();
    if (!k) { PropertiesService.getScriptProperties().deleteProperty('GEMINI_KEY'); PropertiesService.getScriptProperties().deleteProperty('IA_KEY'); return { status: 'ok', configurada: false }; }
    const prueba = iaLlamar_(k, { contents: [{ role: 'user', parts: [{ text: 'Respondé solamente: OK' }] }] }); // sin límite de tokens: los modelos nuevos "piensan" antes de responder
    if (!prueba.ok) return { status: 'error', error: prueba.error };
    PropertiesService.getScriptProperties().setProperty('IA_KEY', k);
    PropertiesService.getScriptProperties().deleteProperty('GEMINI_KEY');
    auditar_(u, 'modificó', 'IA', ['Configuró la clave de la IA (' + iaProveedor_(k) + ')']);
    return { status: 'ok', configurada: true, proveedor: iaProveedor_(k) };
  }
  if (body.action === 'iaGenerar') {
    const k = iaClave_();
    if (!k) return { status: 'error', error: 'La IA no está configurada (falta la clave de Gemini).' };
    const c = body.cuerpo || {};
    const cuerpo = { contents: Array.isArray(c.contents) ? c.contents.slice(-20) : [] };
    if (c.systemInstruction) cuerpo.systemInstruction = c.systemInstruction;
    if (c.generationConfig) cuerpo.generationConfig = c.generationConfig;
    const r = iaLlamar_(k, cuerpo);
    return r.ok ? { status: 'ok', texto: r.texto } : { status: 'error', error: r.error };
  }
  return null;
}

// =====================================================================
// REGISTRO DE CAMBIOS (auditoría): quién cambió qué y cuándo
// Hoja BD_Auditoria: fecha | usuario | accion | modulo | detalle
// =====================================================================
const AUD_MAX_FILAS = 25000;
function hojaAuditoria_() {
  const ss = getSs();
  let sh = ss.getSheetByName('BD_Auditoria');
  if (!sh) {
    sh = ss.insertSheet('BD_Auditoria');
    sh.appendRow(['fecha', 'usuario', 'accion', 'modulo', 'detalle']);
    sh.getRange('A:E').setNumberFormat('@');
  }
  return sh;
}
function etiquetaUsuario_(u) { return u ? (u.nombre ? u.nombre + ' (@' + u.usuario + ')' : u.usuario) : ''; }
function auditar_(u, accion, modulo, detalle) {
  try {
    const lineas = [].concat(detalle || []).filter(function (x) { return x; });
    if (!lineas.length) return;
    const sh = hojaAuditoria_();
    const ahora = new Date().toISOString();
    const filas = lineas.slice(0, 40).map(function (d) { return [ahora, etiquetaUsuario_(u), String(accion), String(modulo || ''), String(d).slice(0, 900)]; });
    if (lineas.length > 40) filas.push([ahora, etiquetaUsuario_(u), String(accion), String(modulo || ''), '… y ' + (lineas.length - 40) + ' cambios más']);
    sh.getRange(sh.getLastRow() + 1, 1, filas.length, 5).setNumberFormat('@').setValues(filas);
    const n = sh.getLastRow();
    if (n > AUD_MAX_FILAS) sh.deleteRows(2, n - AUD_MAX_FILAS + 2000);
  } catch (e) {}
}
function porId_(lista) { const o = {}; (lista || []).forEach(function (x) { if (x && x.id != null) o[String(x.id)] = x; }); return o; }
function igual_(a, b) { try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return false; } }
function num_(v) { const n = Number(v); return isNaN(n) ? 0 : n; }
function fmtN_(v) { return String(Math.round(num_(v) * 100) / 100).replace('.', ','); }
const NOMBRE_CAMPO_ = { qtyTarget: 'cantidad', status: 'estado', part: 'pieza', machine: 'máquina', ordNumber: 'N°', date: 'fecha', precio: 'precio', unitsPerHour: 'u/h', loteMin: 'lote mínimo',
  portamolde: 'portamolde', machines: 'máquinas', material: 'material', weightWithSprueKg: 'peso c/colada', cavities: 'bocas', mold: 'molde', desc: 'descripción', pistonMm: 'pistón' };
function camposCambiados_(a, b, ignorar) {
  const out = [];
  const ks = {}; Object.keys(a || {}).forEach(function (k) { ks[k] = 1; }); Object.keys(b || {}).forEach(function (k) { ks[k] = 1; });
  Object.keys(ks).forEach(function (k) {
    if (ignorar && ignorar.indexOf(k) !== -1) return;
    if (igual_((a || {})[k], (b || {})[k])) return;
    const va = (a || {})[k], vb = (b || {})[k];
    const vacio = function (v) { return v == null || v === '' || v === 0 || v === false; };
    if (vacio(va) && vacio(vb)) return;
    const simple = function (v) { return v == null || typeof v !== 'object'; };
    out.push((NOMBRE_CAMPO_[k] || k) + (simple(va) && simple(vb) ? ': ' + (va == null || va === '' ? '—' : String(va).slice(0, 40)) + ' → ' + (vb == null || vb === '' ? '—' : String(vb).slice(0, 40)) : ''));
  });
  return out;
}
const NOMBRE_MODULO_ = { orders: 'Órdenes', gantt: 'Gantt', catalog: 'Base de datos', weekly: 'Cierres semanales', memory: 'IA', config: 'Configuración', pistones: 'Pistones', kpis: 'Indicadores',
  turnos: 'Turnos', setup: 'Set-up y máquinas', presentacion: 'Presentación', mantenimiento: 'Mantenimiento', stock: 'Stock', avisos: 'Avisos', informes: 'Informe semanal', calidad: 'Causas de rechazo', calidadDatos: 'Calidad' };
function resumenCambio_(clave, ant, nue) {
  if (igual_(ant, nue)) return [];
  const out = [];
  const vacioM = function (v) { return v == null || (Array.isArray(v) ? !v.length : (typeof v === 'object' && !Object.keys(v).length)); };
  if (clave === 'memory') {
    const la = (ant && ant.learnedNotes) || [], ln = (nue && nue.learnedNotes) || [];
    if (igual_(la, ln)) return [];
    return ['Cambió lo que la IA tiene aprendido (' + (Array.isArray(ln) ? ln.length : 0) + ' notas)'];
  }
  if (vacioM(ant)) return ['Cargó por primera vez ' + (NOMBRE_MODULO_[clave] || clave) + (Array.isArray(nue) ? ' (' + nue.length + ' elementos)' : '')];
  if (clave === 'orders') {
    const A = porId_(ant), N = porId_(nue);
    Object.keys(N).forEach(function (id) {
      const o = N[id], v = A[id];
      const nom = 'OP ' + (o.ordNumber || '') + ' · ' + (o.part || '');
      if (!v) { out.push('Creó la ' + nom + ' (' + fmtN_(o.qtyTarget) + ' u, ' + (o.machine || '') + ')'); return; }
      if (igual_(o, v)) return;
      const LA = porId_(v.logs), LN = porId_(o.logs);
      Object.keys(LN).forEach(function (lid) {
        const l = LN[lid], la = LA[lid];
        const t = (l.date || '') + ' ' + (l.turno || ((l.startTime || '') + '-' + (l.endTime || '')));
        if (!la) out.push(nom + ': cargó turno ' + t + ' · ' + fmtN_(l.okPcs) + ' buenas' + (num_(l.scrapPcs) ? ', ' + fmtN_(l.scrapPcs) + ' scrap' : '') + (l.operator ? ' · ' + l.operator : ''));
        else if (!igual_(l, la)) { const c = camposCambiados_(la, l, ['modificadoPor', 'modificadoAt', 'obs', 'paradas', 'stopCode']); if (!igual_(la.paradas, l.paradas)) c.push('paradas'); if (c.length) out.push(nom + ': corrigió turno ' + t + ' (' + c.join('; ').slice(0, 300) + ')'); }
      });
      Object.keys(LA).forEach(function (lid) { if (!LN[lid]) { const l = LA[lid]; out.push(nom + ': borró turno ' + (l.date || '') + ' ' + (l.turno || '') + ' (' + fmtN_(l.okPcs) + ' buenas)'); } });
      const c = camposCambiados_(v, o, ['logs', 'back', 'autoCompletada']);
      if (!igual_(v.back, o.back)) c.push('dorso de la orden');
      if (c.length) out.push(nom + ': ' + c.join('; ').slice(0, 400));
    });
    Object.keys(A).forEach(function (id) { if (!N[id]) out.push('Borró la OP ' + (A[id].ordNumber || '') + ' · ' + (A[id].part || '')); });
  } else if (clave === 'catalog') {
    const A = porId_(ant), N = porId_(nue);
    Object.keys(N).forEach(function (id) {
      const p = N[id], v = A[id];
      if (!v) { out.push('Agregó la pieza ' + (p.part || '')); return; }
      const c = camposCambiados_(v, p, ['precioAt', 'updatedAt', 'armada']);
      if (!igual_(v.armada, p.armada)) c.push(p.armada ? 'marcada como montada' : 'desmarcada como montada');
      if (c.length) out.push('Pieza ' + (p.part || '') + ': ' + c.join('; ').slice(0, 400));
    });
    Object.keys(A).forEach(function (id) { if (!N[id]) out.push('Borró la pieza ' + (A[id].part || '')); });
  } else if (clave === 'gantt') {
    const A = ant || {}, N = nue || {};
    const tot = function (it) { return (it.dailyQty || []).reduce(function (s, x) { return s + num_(x); }, 0); };
    Object.keys(N).forEach(function (code) {
      if (!A[code]) { out.push('Creó la semana ' + code); return; }
      if (igual_(A[code], N[code])) return;
      const mA = A[code].machines || {}, mN = N[code].machines || {};
      const ms = {}; Object.keys(mA).forEach(function (m) { ms[m] = 1; }); Object.keys(mN).forEach(function (m) { ms[m] = 1; });
      Object.keys(ms).forEach(function (m) {
        const pa = {}, pn = {};
        ((mA[m] || {}).items || []).forEach(function (it) { if (!it.isSharedCompanion) pa[it.part] = (pa[it.part] || 0) + tot(it); });
        ((mN[m] || {}).items || []).forEach(function (it) { if (!it.isSharedCompanion) pn[it.part] = (pn[it.part] || 0) + tot(it); });
        const cambios = [];
        const ps = {}; Object.keys(pa).forEach(function (p) { ps[p] = 1; }); Object.keys(pn).forEach(function (p) { ps[p] = 1; });
        Object.keys(ps).forEach(function (p) {
          if (pa[p] === pn[p]) return;
          if (pa[p] == null) cambios.push('agregó ' + p + ' (' + fmtN_(pn[p]) + ' u)');
          else if (pn[p] == null) cambios.push('sacó ' + p);
          else cambios.push(p + ' ' + fmtN_(pa[p]) + ' → ' + fmtN_(pn[p]) + ' u');
        });
        if (!cambios.length && !igual_((mA[m] || {}).items, (mN[m] || {}).items)) cambios.push('cambió el reparto por día');
        if (!igual_((mA[m] || {}).aux, (mN[m] || {}).aux)) cambios.push('cambió horas auxiliares (set-up, limpieza…)');
        if (cambios.length) out.push(code + ' · ' + m + ': ' + cambios.join('; ').slice(0, 500));
      });
    });
    Object.keys(A).forEach(function (code) { if (!N[code]) out.push('Borró la semana ' + code); });
  } else if (clave === 'setup') {
    const mA = (ant && ant.maquinas) || {}, mN = (nue && nue.maquinas) || {};
    Object.keys(mN).forEach(function (m) {
      const a = mA[m] || {}, b = mN[m] || {};
      if ((a.activa !== false) !== (b.activa !== false)) out.push(m + ': ' + (b.activa === false ? 'FUERA DE SERVICIO' + (b.motivo ? ' (' + b.motivo + ')' : '') : 'habilitada de nuevo'));
      const c = camposCambiados_(a, b, ['activa']); if (c.length) out.push(m + ': ' + c.join('; '));
    });
  } else if (clave === 'stock') {
    const movs = function (s) { const o = {}; ['materiales', 'terminado'].forEach(function (g) { Object.keys((s && s[g]) || {}).forEach(function (k) { ((s[g][k] || {}).movimientos || []).forEach(function (mv) { o[mv.id] = { g: g, k: k, mv: mv }; }); }); }); return o; };
    const A = movs(ant), N = movs(nue);
    Object.keys(N).forEach(function (id) { if (!A[id]) { const x = N[id]; out.push((x.g === 'materiales' ? 'Material ' : 'Pieza ') + x.k + ': ' + x.mv.tipo + ' ' + fmtN_(x.mv.kg != null ? x.mv.kg : x.mv.cant) + (x.g === 'materiales' ? ' kg' : ' u') + (x.mv.nota ? ' (' + x.mv.nota + ')' : '')); } });
    Object.keys(A).forEach(function (id) { if (!N[id]) { const x = A[id]; out.push((x.g === 'materiales' ? 'Material ' : 'Pieza ') + x.k + ': borró movimiento ' + x.mv.tipo + ' del ' + (x.mv.fecha || '')); } });
    const fardos = function (st) { const o = {}; Object.keys((st && st.materiales) || {}).forEach(function (k) { ((st.materiales[k] || {}).fardos || []).forEach(function (f) { o[f.id] = { k: k, f: f }; }); }); return o; };
    const FA = fardos(ant), FN = fardos(nue);
    Object.keys(FN).forEach(function (id) {
      const a = FA[id], x = FN[id];
      if (x.f.retiro && !(a && a.f.retiro)) out.push('Material ' + x.k + ': retiró el fardo N° ' + x.f.numero + (x.f.analisis ? ' (análisis ' + x.f.analisis + ')' : '') + ' de ' + fmtN_(x.f.kg) + ' kg' + (x.f.retiro.maquina ? ' → ' + x.f.retiro.maquina : ''));
      if (a && a.f.retiro && !x.f.retiro) out.push('Material ' + x.k + ': el fardo N° ' + x.f.numero + ' volvió al depósito');
      const pa = {}; ((a && a.f.parciales) || []).forEach(function (p) { pa[p.id] = p; });
      const pn = {}; (x.f.parciales || []).forEach(function (p) { pn[p.id] = p; if (!pa[p.id]) out.push('Material ' + x.k + ': sacó ' + fmtN_(p.kg) + ' kg del fardo N° ' + x.f.numero + (p.destino ? ' → ' + p.destino : '') + (p.descuenta ? ' (descontado del stock)' : '')); });
      Object.keys(pa).forEach(function (id) { if (!pn[id]) out.push('Material ' + x.k + ': anuló el retiro de ' + fmtN_(pa[id].kg) + ' kg del fardo N° ' + x.f.numero); });
      if (a && x.f.modificadoAt && x.f.modificadoAt !== a.f.modificadoAt) {
        const cam = [];
        if (Number(a.f.kg) !== Number(x.f.kg)) cam.push('kg ' + fmtN_(a.f.kg) + ' → ' + fmtN_(x.f.kg));
        if (String(a.f.analisis || '') !== String(x.f.analisis || '')) cam.push('análisis ' + (a.f.analisis || '—') + ' → ' + (x.f.analisis || '—'));
        if (Number(a.f.numero) !== Number(x.f.numero)) cam.push('N° ' + a.f.numero + ' → ' + x.f.numero);
        if (String(a.f.fecha || '') !== String(x.f.fecha || '')) cam.push('fecha ' + (a.f.fecha || '') + ' → ' + (x.f.fecha || ''));
        out.push('Material ' + x.k + ': corrigió el fardo N° ' + x.f.numero + (cam.length ? ' (' + cam.join(', ') + ')' : ''));
      }
    });
    Object.keys(FA).forEach(function (id) { if (!FN[id]) out.push('Material ' + FA[id].k + ': borró el fardo N° ' + FA[id].f.numero); });
    if (!out.length) out.push('Cambió mínimos o datos del stock');
  } else if (clave === 'calidadDatos') {
    const LA = porId_(ant && ant.liberaciones), LN = porId_(nue && nue.liberaciones), NA = porId_(ant && ant.ncs), NN = porId_(nue && nue.ncs), PA = porId_(ant && ant.planes), PN = porId_(nue && nue.planes);
    Object.keys(LN).forEach(function (id) { if (LA[id]) return; const l = LN[id]; out.push((l.tipo === 'primera' ? 'Primera pieza ' : (l.tipo === 'concesion' ? 'Liberó con concesión ' : 'Control en proceso ')) + (l.pieza || '') + ' en la ' + (l.maq || '') + ': ' + (l.res === 'retenida' ? 'RETENIDA' : 'OK') + (l.nota ? ' (' + l.nota + ')' : '')); });
    Object.keys(NN).forEach(function (id) { const n = NN[id]; if (!NA[id]) out.push('Abrió la no conformidad ' + (n.num || '') + ': ' + (n.titulo || '')); else if (n.cierre && !NA[id].cierre) out.push('Cerró la no conformidad ' + (n.num || '')); else if (!igual_(NA[id], n)) out.push('Actualizó la no conformidad ' + (n.num || '')); });
    Object.keys(NA).forEach(function (id) { if (!NN[id]) out.push('Borró la no conformidad ' + (NA[id].num || '')); });
    Object.keys(PN).forEach(function (id) { if (!PA[id]) out.push('Plan de control nuevo: ' + (PN[id].pieza || '')); else if (!igual_(PA[id], PN[id])) out.push('Cambió el plan de control de ' + (PN[id].pieza || '') + ' (v' + (PN[id].version || '') + (PN[id].motivo ? ': ' + PN[id].motivo : '') + ')'); });
    Object.keys(PA).forEach(function (id) { if (!PN[id]) out.push('Borró el plan de control de ' + (PA[id].pieza || '')); });
    if (!out.length) out.push('Modificó instrumentos de medición');
  } else if (clave === 'mantenimiento') {
    const A = porId_(ant && ant.trabajos), N = porId_(nue && nue.trabajos), PA = porId_(ant && ant.planes), PN = porId_(nue && nue.planes);
    Object.keys(N).forEach(function (id) { if (!A[id]) { const t = N[id]; out.push('Registró ' + (t.tipo || 'trabajo') + ' en la ' + (t.maquina || '') + ': ' + (t.tarea || t.descripcion || '') + ' (' + (t.fecha || '') + ')'); } else if (!igual_(A[id], N[id])) out.push('Corrigió un trabajo de la ' + (N[id].maquina || '') + ' (' + (N[id].fecha || '') + ')'); });
    Object.keys(A).forEach(function (id) { if (!N[id]) out.push('Borró un trabajo de la ' + (A[id].maquina || '') + ' (' + (A[id].fecha || '') + ')'); });
    Object.keys(PN).forEach(function (id) { if (!PA[id]) out.push('Nuevo preventivo: ' + (PN[id].tarea || '') + ' en la ' + (PN[id].maquina || '') + ' cada ' + (PN[id].cadaDias || '?') + ' días'); else if (!igual_(PA[id], PN[id]) && PA[id].ultimo === PN[id].ultimo) out.push('Modificó el preventivo ' + (PN[id].tarea || '')); });
    Object.keys(PA).forEach(function (id) { if (!PN[id]) out.push('Borró el preventivo ' + (PA[id].tarea || '')); });
  } else {
    const ks = {}; Object.keys(ant || {}).forEach(function (k) { ks[k] = 1; }); Object.keys(nue || {}).forEach(function (k) { ks[k] = 1; });
    const cambiadas = Object.keys(ks).filter(function (k) { return !igual_((ant || {})[k], (nue || {})[k]); });
    out.push('Modificó ' + (NOMBRE_MODULO_[clave] || clave) + (cambiadas.length && cambiadas.length < 8 && !Array.isArray(nue) ? ' (' + cambiadas.join(', ') + ')' : ''));
  }
  return out;
}
function resumenParte_(e) { return 'Parte ' + fechaTexto_(e && e.date) + ' · ' + ((e && e.machine) || '') + ' · ' + ((e && e.shift) || '') + ' · ' + fmtN_(e && e.available) + ' h'; }
function accionAuditoria(u, body) {
  if (body.action !== 'audListar') return null;
  if (u.rol !== 'admin') return { status: 'error', error: 'Solo el administrador ve el registro de cambios.' };
  const sh = hojaAuditoria_();
  const n = sh.getLastRow();
  if (n < 2) return { status: 'ok', filas: [] };
  const limite = Math.min(Number(body.limite) || 1500, 5000);
  const desde = String(body.desde || ''), hasta = String(body.hasta || '');
  const tomar = Math.min(n - 1, desde ? 20000 : limite * 3);
  const vals = sh.getRange(n - tomar + 1, 1, tomar, 5).getValues();
  const out = [];
  for (let i = vals.length - 1; i >= 0 && out.length < limite; i--) {
    const f = String(vals[i][0] || ''), dia = f.slice(0, 10);
    if (desde && dia < desde) continue;
    if (hasta && dia > hasta) continue;
    out.push({ fecha: f, usuario: String(vals[i][1] || ''), accion: String(vals[i][2] || ''), modulo: String(vals[i][3] || ''), detalle: String(vals[i][4] || '') });
  }
  return { status: 'ok', filas: out };
}

// =====================================================================
// INFORME SEMANAL (se arma en el servidor con los datos de la planta)
// =====================================================================
const COD_CAT_SRV = { 1: 'setup_molde', 23: 'setup_molde', 24: 'setup_molde', 20: 'puesta_punto', 21: 'puesta_punto', 28: 'puesta_punto',
  2: 'parada_maquina', 3: 'parada_maquina', 5: 'parada_maquina', 6: 'parada_maquina', 7: 'parada_maquina', 8: 'parada_maquina', 9: 'parada_maquina', 12: 'parada_maquina', 13: 'parada_maquina', 16: 'parada_maquina', 25: 'parada_maquina', 26: 'parada_maquina', 27: 'parada_maquina',
  4: 'mant_correctivo', 10: 'mant_correctivo', 11: 'mant_correctivo', 14: 'mant_correctivo', 17: 'mant_correctivo', 18: 'mant_preventivo', 29: 'mant_preventivo', 31: 'mant_preventivo', 32: 'puesta_punto', 33: 'mant_preventivo', 34: 'mant_preventivo', 35: 'mant_preventivo', 36: 'puesta_punto', 37: 'puesta_punto', 30: 'falta_material', 19: 'falta_operario', 15: 'otros', 22: 'otros' };
const CATS_SRV = [['parada_maquina', 'Parada de máquina'], ['setup_molde', 'Cambio de molde'], ['puesta_punto', 'Puesta a punto'], ['mant_preventivo', 'Mant. preventivo'], ['mant_correctivo', 'Mant. correctivo'], ['falta_material', 'Falta de material'], ['falta_operario', 'Falta de operario'], ['otros', 'Otros']];
const MAQ_SRV = [['200V', 'Italpresse 200 Tn (V)'], ['200N', 'Italpresse 200 Tn (N)'], ['180', 'Italpresse 180 Tn'], ['H50', 'H-50'], ['Z30', 'Italpresse 30 Tn (Z-30)']];
function maqId_(txt) {
  const t = String(txt || '').toLowerCase().replace(/\s+/g, ' ').trim();
  for (let i = 0; i < MAQ_SRV.length; i++) if (t === MAQ_SRV[i][0].toLowerCase() || t === MAQ_SRV[i][1].toLowerCase()) return MAQ_SRV[i][0];
  if (/\(v\)/.test(t)) return '200V'; if (/\(n\)/.test(t)) return '200N'; if (/180/.test(t)) return '180'; if (/h-?50/.test(t)) return 'H50'; if (/z-?30|30 tn/.test(t)) return 'Z30';
  return String(txt || '');
}
function isoDia_(d) { return Utilities.formatDate(d, zonaHoja_(), 'yyyy-MM-dd'); }
function sumarDias_(iso, n) { const p = iso.split('-').map(Number); const d = new Date(p[0], p[1] - 1, p[2] + n, 12); return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd'); }
function lunesDe_(iso) { const p = iso.split('-').map(Number); const d = new Date(Date.UTC(p[0], p[1] - 1, p[2], 12)); const dow = (d.getUTCDay() + 6) % 7; return sumarDias_(iso, -dow); }
function horasEntre_(a, b) { const m = function (h) { const x = String(h || '0:0').split(':'); return (Number(x[0]) || 0) * 60 + (Number(x[1]) || 0); }; const d = ((m(b) - m(a)) + 1440) % 1440; return (d || 1440) / 60; }
const DEMO_ORD_SRV = { 'ord-406': 1 };
const DEMO_REC_SRV = { 'rec-1': 1, 'rec-2': 1, 'rec-3': 1, 'rec-4': 1, 'rec-5': 1, 'rec-6': 1 };
// Rechazos en control de calidad (12/11/2026): o.rechazos [{id, fecha, cant, causa, logId, nota, por, at, borrado}].
// Buenas reales = cargadas − rechazadas; con turno de origen pasan a scrap de ese turno.
function rechazosOrden_(o) { return ((o && o.rechazos) || []).filter(function (r) { return r && !r.borrado && num_(r.cant) > 0; }); }
function rechLog_(o, l) { if (!o || !o.rechazos || !l) return 0; const id = String(l.id); return rechazosOrden_(o).reduce(function (a, r) { return a + (r.logId != null && String(r.logId) === id ? num_(r.cant) : 0); }, 0); }
function okLog_(o, l) { return Math.max(0, num_(l.okPcs) - rechLog_(o, l)); }
function scrapLog_(o, l) { return num_(l.scrapPcs) + Math.min(num_(l.okPcs), rechLog_(o, l)); }
function okReal_(o) { return Math.max(0, (o.logs || []).reduce(function (s, l) { return s + num_(l.okPcs); }, 0) - rechazosOrden_(o).reduce(function (s, r) { return s + num_(r.cant); }, 0)); }
function datosSemana_(mods, registros, lunes) {
  const dom = sumarDias_(lunes, 6);
  const enSem = function (f) { return f && f >= lunes && f <= dom; };
  const catalogo = {}; (mods.catalog || []).forEach(function (c) { if (c && c.part) catalogo[String(c.part).toLowerCase()] = c; });
  const R = { lunes: lunes, domingo: dom, ok: 0, scrap: 0, baja: 0, disp: 0, cat: {}, codigos: {}, maq: {}, piezas: {}, turnos: 0, facturado: 0, sinPrecio: 0, kg: {} };
  CATS_SRV.forEach(function (c) { R.cat[c[0]] = 0; });
  MAQ_SRV.forEach(function (m) { R.maq[m[0]] = { ok: 0, scrap: 0, disp: 0, paradas: 0, correctivo: 0 }; });
  (mods.orders || []).forEach(function (o) {
    if (DEMO_ORD_SRV[o.id]) return;
    const m = maqId_(o.machine); const c = catalogo[String(o.part || '').toLowerCase()] || {};
    (o.logs || []).forEach(function (l) {
      if (!enSem(String(l.date || ''))) return;
      const ok = okLog_(o, l), sc = scrapLog_(o, l), bj = num_(l.lowStartPcs), h = horasEntre_(l.startTime, l.endTime);
      R.ok += ok; R.scrap += sc; R.baja += bj; R.disp += h; R.turnos++;
      if (!R.maq[m]) R.maq[m] = { ok: 0, scrap: 0, disp: 0, paradas: 0, correctivo: 0 };
      R.maq[m].ok += ok; R.maq[m].scrap += sc; R.maq[m].disp += h;
      const pz = R.piezas[o.part] = R.piezas[o.part] || { ok: 0, scrap: 0, baja: 0, kg: 0, mat: '', maq: m };
      pz.ok += ok; pz.scrap += sc; pz.baja += bj;
      const uph = num_(o.unitsPerHour || c.unitsPerHour);
      if (uph) R.maq[m].std = (R.maq[m].std || 0) + (ok + sc) / uph;
      const precio = num_(c.precio || o.precio);
      if (precio) R.facturado += ok * precio; else if (ok) R.sinPrecio += ok;
      const kgp = num_(c.weightWithSprueKg || o.weightWithSprueKg), mat = String(c.material || o.material || '').toUpperCase();
      if (kgp && mat) R.kg[mat] = (R.kg[mat] || 0) + (ok + sc + bj) * kgp;
      if (kgp) { pz.kg += (ok + sc + bj) * kgp; pz.kgp = kgp; } if (mat) pz.mat = mat;
      const ps = (l.paradas && l.paradas.length) ? l.paradas : (l.stopCode ? [{ codigo: l.stopCode, min: l.stopMinutes }] : []);
      ps.forEach(function (p) {
        const cod = parseInt(String(p.codigo || ''), 10), hh = num_(p.min) / 60, cat = COD_CAT_SRV[cod] || 'otros';
        R.cat[cat] += hh; R.maq[m].paradas += hh; if (cat === 'mant_correctivo') R.maq[m].correctivo += hh;
        const k = String(p.codigo || 'Sin código'); R.codigos[k] = (R.codigos[k] || 0) + hh;
      });
    });
  });
  (registros || []).forEach(function (r) {
    if (DEMO_REC_SRV[r.id] || !enSem(r.date)) return;
    const m = maqId_(r.machine);
    if (!R.maq[m]) R.maq[m] = { ok: 0, scrap: 0, disp: 0, paradas: 0, correctivo: 0 };
    R.disp += num_(r.available); R.maq[m].disp += num_(r.available); R.turnos++;
    CATS_SRV.forEach(function (c) { const h = num_(r[c[0]]); R.cat[c[0]] += h; R.maq[m].paradas += h; if (c[0] === 'mant_correctivo') R.maq[m].correctivo += h; });
    (r.paradas || []).forEach(function (p) { const k = String(p.codigo || 'Sin código'); R.codigos[k] = (R.codigos[k] || 0) + num_(p.min) / 60; });
  });
  R.paradas = CATS_SRV.reduce(function (s, c) { return s + R.cat[c[0]]; }, 0);
  R.util = R.disp ? Math.max(0, (R.disp - R.paradas) / R.disp * 100) : 0;
  R.scrapPct = (R.ok + R.scrap) ? R.scrap / (R.ok + R.scrap) * 100 : 0;
  // Gantt: lo programado para esa semana
  R.programado = 0; R.progPiezas = {}; R.facturaProg = 0;
  Object.keys(mods.gantt || {}).forEach(function (code) {
    const w = mods.gantt[code]; if (!w || !w.startDate) return;
    const p = w.startDate.split('-').map(Number); const base = new Date(Date.UTC(p[0], p[1] - 1, p[2], 12)); const dow = base.getUTCDay();
    Object.keys(w.machines || {}).forEach(function (m) {
      ((w.machines[m] || {}).items || []).forEach(function (it) {
        if (it.isSharedCompanion) return;
        (it.dailyQty || []).forEach(function (q, d) {
          const f = sumarDias_(w.startDate, d - dow); if (!enSem(f) || !num_(q)) return;
          R.programado += num_(q); R.progPiezas[it.part] = (R.progPiezas[it.part] || 0) + num_(q);
          const c = catalogo[String(it.part || '').toLowerCase()] || {}; R.facturaProg += num_(q) * num_(c.precio);
        });
      });
    });
  });
  // órdenes
  R.opCompletadas = (mods.orders || []).filter(function (o) { return !DEMO_ORD_SRV[o.id] && o.status === 'Completada' && (o.logs || []).some(function (l) { return enSem(l.date); }); }).length;
  R.opAbiertas = (mods.orders || []).filter(function (o) { return !DEMO_ORD_SRV[o.id] && o.status !== 'Completada'; }).length;
  const hecho = function (o) { return okReal_(o); };
  const ultimoLog = function (o) { return (o.logs || []).reduce(function (s, l) { return String(l.date || '') > s ? String(l.date || '') : s; }, ''); };
  const ficha = function (o) { const h = hecho(o), obj = num_(o.qtyTarget); return { num: o.ordNumber || '', pieza: o.part || '', maq: maqId_(o.machine), hecho: h, objetivo: obj, pct: obj ? Math.min(999, h / obj * 100) : 0, semana: (o.logs || []).reduce(function (s, l) { return s + (enSem(String(l.date || '')) ? num_(l.okPcs) : 0); }, 0), ultimo: ultimoLog(o) }; };
  const ords = (mods.orders || []).filter(function (o) { return o && !DEMO_ORD_SRV[o.id]; });
  R.ordCompl = ords.filter(function (o) { return o.status === 'Completada' && (o.logs || []).some(function (l) { return enSem(l.date); }); }).map(ficha);
  R.ordAbiertas = ords.filter(function (o) { return o.status !== 'Completada' && o.status !== 'Detenida por rotura'; }).map(ficha).sort(function (a, b) { return b.pct - a.pct; });
  R.ordDetenidas = ords.filter(function (o) { return o.status === 'Detenida por rotura'; }).map(function (o) { const f = ficha(o); f.motivo = (o.rotura && o.rotura.motivo) || ''; f.desde = (o.rotura && o.rotura.desde) || ''; return f; });
  // rechazos en control cargados en la semana (por fecha del control)
  R.rechazos = [];
  ords.forEach(function (o) { rechazosOrden_(o).forEach(function (r) { if (enSem(String(r.fecha || ''))) R.rechazos.push({ num: o.ordNumber || '', pieza: o.part || '', maq: maqId_(o.machine), cant: num_(r.cant), causa: r.causa || '', fecha: r.fecha, conTurno: r.logId != null }); }); });
  // mantenimiento
  const mant = mods.mantenimiento || {};
  R.trabajos = (mant.trabajos || []).filter(function (t) { return enSem(t.fecha); });
  const corte = sumarDias_(dom, 1);
  R.preventivosVencidos = (mant.planes || []).filter(function (p) { return p.ultimo && num_(p.cadaDias) && sumarDias_(p.ultimo, num_(p.cadaDias)) < corte; })
    .map(function (p) { const v = sumarDias_(p.ultimo, num_(p.cadaDias)); return { maquina: p.maquina, tarea: p.tarea, vence: v, dias: Math.round((new Date(corte + 'T12:00:00Z') - new Date(v + 'T12:00:00Z')) / 864e5) }; });
  R.prevProximos = (mant.planes || []).filter(function (p) { if (!p.ultimo || !num_(p.cadaDias)) return false; const v = sumarDias_(p.ultimo, num_(p.cadaDias)); return v >= corte && v <= sumarDias_(corte, 7); })
    .map(function (p) { return { maquina: p.maquina, tarea: p.tarea, vence: sumarDias_(p.ultimo, num_(p.cadaDias)) }; }).sort(function (a, b) { return a.vence < b.vence ? -1 : 1; });
  R.roturasAbiertas = (mant.roturas || []).filter(function (x) { return x && x.estado !== 'resuelta'; });
  return R;
}
// ===== Informes por mail (11/11/2026): tres informes separados, cada uno con sus mails, día y hora =====
// prod = producción (piezas, plan, máquinas, paradas, material por pieza) · mant = mantenimiento · ord = órdenes de producción
const INF_TIPOS = { prod: { nombre: 'producción', titulo: 'Informe semanal de producción', color: '#0f172a', acento: '#67e8f9', boton: '#22d3ee', botonTxt: '#083344', ir: '' },
  mant: { nombre: 'mantenimiento', titulo: 'Mantenimiento', color: '#7c2d12', acento: '#fdba74', boton: '#fdba74', botonTxt: '#431407', ir: '?ir=mant' },
  ord: { nombre: 'órdenes de producción', titulo: 'Órdenes de producción', color: '#1e3a8a', acento: '#93c5fd', boton: '#93c5fd', botonTxt: '#172554', ir: '' } };
const INF_APP = 'https://inofer-admin.github.io/INOFER/inofer/';
function hInf_() {
  const e = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  const n0 = function (v) { return Math.round(num_(v)).toLocaleString('es-AR'); };
  const n1 = function (v) { return (Math.round(num_(v) * 10) / 10).toLocaleString('es-AR'); };
  const fd = function (iso) { if (!iso) return ''; const p = String(iso).split('-'); return p[2] + '/' + p[1]; };
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const rango = function (l, d) { const a = l.split('-').map(Number), b = d.split('-').map(Number); return 'lunes ' + a[2] + (a[1] !== b[1] ? ' de ' + MESES[a[1] - 1] : '') + ' al domingo ' + b[2] + ' de ' + MESES[b[1] - 1]; };
  const semIso = function (l) { const p = l.split('-').map(Number); const d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + 3)); const y = new Date(Date.UTC(d.getUTCFullYear(), 0, 4)); return 1 + Math.round(((d - y) / 864e5 - 3 + ((y.getUTCDay() + 6) % 7)) / 7); };
  const barra = function (pct, color, ancho) { const w = Math.max(0, Math.min(100, Math.round(num_(pct)))); return '<table role="presentation" style="width:' + (ancho || '100%') + ';border-collapse:collapse"><tr><td style="padding:0;background:#e2e8f0;border-radius:7px;height:12px"><div style="width:' + w + '%;height:12px;background:' + color + ';border-radius:7px"></div></td></tr></table>'; };
  const titulo = function (t, sub) { return '<tr><td style="padding:22px 28px 8px"><table role="presentation" style="width:100%;border-collapse:collapse"><tr><td style="font-size:16px;font-weight:800;color:#0f172a">' + t + '</td><td style="text-align:right;font-size:12px;color:#475569">' + (sub || '') + '</td></tr></table></td></tr>'; };
  const tile = function (t, v, s, tono) { const fondo = tono === 'mal' ? '#fef2f2' : (tono === 'bien' ? '#ecfdf5' : '#ffffff'), borde = tono === 'mal' ? '#fecaca' : (tono === 'bien' ? '#a7f3d0' : '#e2e8f0'), col = tono === 'mal' ? '#b91c1c' : (tono === 'bien' ? '#047857' : '#0f172a'); return '<td style="padding:4px;width:25%;vertical-align:top"><div style="border:1px solid ' + borde + ';background:' + fondo + ';border-radius:10px;padding:10px 12px"><div style="font-size:10px;font-weight:700;color:#475569;letter-spacing:.04em">' + t + '</div><div style="font-size:21px;font-weight:900;color:' + col + ';margin:2px 0">' + v + '</div><div style="font-size:11px;color:#475569">' + (s || '') + '</div></div></td>'; };
  const marco = function (tipo, R, cuerpo, pie) {
    const T = INF_TIPOS[tipo];
    return '<div style="background:#f1f5f9;padding:16px 8px;font-family:Arial,Helvetica,sans-serif;color:#0f172a"><table role="presentation" style="max-width:720px;width:100%;margin:0 auto;border-collapse:collapse;background:#ffffff;border-radius:14px;overflow:hidden">' +
      '<tr><td style="background:' + T.color + ';padding:20px 28px"><table role="presentation" style="width:100%;border-collapse:collapse"><tr><td><div style="font-size:12px;font-weight:800;letter-spacing:3px;color:' + T.acento + '">INOFER</div><div style="font-size:21px;font-weight:800;color:#ffffff;margin-top:2px">' + T.titulo + '</div><div style="font-size:13px;color:#e2e8f0;margin-top:2px">Semana ' + semIso(R.lunes) + ' · ' + rango(R.lunes, R.domingo) + '</div></td>' +
      '<td style="text-align:right;vertical-align:bottom"><a href="' + INF_APP + T.ir + '" style="display:inline-block;padding:10px 14px;border-radius:10px;background:' + T.boton + ';color:' + T.botonTxt + ';font-weight:800;font-size:13px;text-decoration:none">Abrir en INOFER</a></td></tr></table></td></tr>' +
      cuerpo + '<tr><td style="padding:18px 28px 20px"><div style="border-top:1px solid #e2e8f0;padding-top:8px;font-size:11px;color:#64748b">' + pie + '</div></td></tr></table></div>';
  };
  return { e: e, n0: n0, n1: n1, fd: fd, rango: rango, semIso: semIso, barra: barra, titulo: titulo, tile: tile, marco: marco };
}
// ---------- PRODUCCIÓN ----------
function htmlInforme_(R, P, verPrecios, extra) {
  const H = hInf_(), e = H.e, n0 = H.n0, n1 = H.n1;
  extra = extra || {};
  const plata = function (v) { return '$ ' + Math.round(num_(v)).toLocaleString('es-AR'); };
  const vs = function (a, b, inv) { if (!b) return ''; const d = (a - b) / Math.abs(b) * 100; if (!isFinite(d) || Math.abs(d) < 0.5) return '= semana anterior'; const bueno = inv ? d < 0 : d > 0; return '<span style="color:' + (bueno ? '#047857' : '#b91c1c') + ';font-weight:700">' + (d > 0 ? '▲ ' : '▼ ') + n1(Math.abs(d)) + '% vs anterior</span>'; };
  const metaScrap = num_(extra.metaScrap) || 0;
  const cumpl = R.programado ? Math.min(999, R.ok / R.programado * 100) : 0;
  const fuera = {}; (extra.fueraIds || []).forEach(function (m) { fuera[m] = 1; });
  // orden fijo de la planta (las claves numéricas como '180' JS las pone primero)
  const orden = MAQ_SRV.map(function (x) { return x[0]; }); Object.keys(R.maq).forEach(function (m) { if (orden.indexOf(m) < 0) orden.push(m); });
  const maqs = orden.filter(function (m) { const x = R.maq[m]; return x && (x.disp || x.ok || fuera[m]); });
  const utilDe = function (x) { return x.disp ? Math.max(0, (x.disp - x.paradas) / x.disp * 100) : 0; };
  const oeeDe = function (x) { if (!x.disp || !x.std) return null; const run = Math.max(0, x.disp - x.paradas), q = (x.ok + x.scrap) ? x.ok / (x.ok + x.scrap) : 0; return Math.min(run, x.std) / x.disp * q * 100; };
  // --- la semana en 3 líneas
  const lineas = [];
  lineas.push((R.ok >= (P.ok || 0) ? '✔' : '✖') + ' Se hicieron <b>' + n0(R.ok) + ' piezas buenas</b>' + (P.ok ? ', ' + n1(Math.abs((R.ok - P.ok) / P.ok * 100)) + '% ' + (R.ok >= P.ok ? 'más' : 'menos') + ' que la semana anterior' : '') + '.');
  const peor = maqs.filter(function (m) { return R.maq[m].disp > 0; }).sort(function (a, b) { return R.maq[b].paradas - R.maq[a].paradas; })[0];
  const cods = Object.keys(R.codigos).map(function (k) { return [k, R.codigos[k]]; }).sort(function (a, b) { return b[1] - a[1]; });
  const nomCod = function (c) { return String(c).split('-').slice(1).join('-').trim() || String(c); };
  if (peor && R.maq[peor].paradas > 0) lineas.push('✖ La <b>' + e(peor) + '</b> fue la que más paró: <b>' + n1(R.maq[peor].paradas) + ' h</b>' + (cods.length ? '. Lo que más tiempo se llevó en la planta: <b>' + e(nomCod(cods[0][0]).toLowerCase()) + '</b>' : '') + '.');
  const piezasAll = {}; Object.keys(R.progPiezas).forEach(function (p) { piezasAll[p] = 1; }); Object.keys(R.piezas).forEach(function (p) { piezasAll[p] = 1; });
  const plan = Object.keys(piezasAll).map(function (p) { const prog = R.progPiezas[p] || 0, ok = (R.piezas[p] || {}).ok || 0; return { p: p, prog: prog, ok: ok, c: prog ? ok / prog * 100 : null }; });
  const abajo = plan.filter(function (x) { return x.c != null && x.c < 70; }).length;
  if (R.programado) lineas.push('● Se cumplió el <b>' + n1(cumpl) + '%</b> de lo programado' + (abajo ? '; ' + abajo + ' pieza' + (abajo > 1 ? 's quedaron' : ' quedó') + ' abajo del 70%' : '') + '.');
  let c = '<tr><td style="padding:18px 28px 0"><div style="font-size:11px;font-weight:800;letter-spacing:1px;color:#475569;margin-bottom:6px">LA SEMANA EN ' + lineas.length + ' LÍNEA' + (lineas.length > 1 ? 'S' : '') + '</div><div style="border:1px solid #e2e8f0;background:#f8fafc;border-radius:10px;padding:12px 14px;font-size:14px;line-height:1.6;color:#1e293b">' + lineas.join('<br>') + '</div></td></tr>';
  // --- cuadros
  const malScrap = metaScrap ? R.scrapPct > metaScrap : false;
  c += '<tr><td style="padding:12px 24px 0"><table role="presentation" style="width:100%;border-collapse:collapse"><tr>' +
    H.tile('PIEZAS BUENAS', n0(R.ok), vs(R.ok, P.ok), '') +
    H.tile('SCRAP', n1(R.scrapPct) + '%', (metaScrap ? 'meta ' + n1(metaScrap) + '% · ' : '') + n0(R.scrap) + ' u', metaScrap ? (malScrap ? 'mal' : 'bien') : '') +
    H.tile('UTILIZACIÓN', n1(R.util) + '%', n1(R.disp) + ' h disponibles', R.util >= 80 ? 'bien' : (R.util < 60 && R.disp ? 'mal' : '')) +
    (verPrecios ? H.tile('FACTURACIÓN', plata(R.facturado), vs(R.facturado, P.facturado) + (R.sinPrecio ? '<br><span style="color:#b45309">' + n0(R.sinPrecio) + ' u sin precio</span>' : ''), '') : H.tile('TURNOS CARGADOS', n0(R.turnos), vs(R.turnos, P.turnos), '')) +
    '</tr></table></td></tr>';
  // --- cumplimiento del plan
  c += H.titulo('Cumplimiento del plan', R.programado ? 'programado ' + n0(R.programado) + ' · producido ' + n0(R.ok) + ' · <b>' + n1(cumpl) + '%</b>' : '');
  const conPlan = plan.filter(function (x) { return x.prog; }).sort(function (a, b) { return a.c - b.c; });
  const fueraPlan = plan.filter(function (x) { return !x.prog && x.ok; });
  if (!conPlan.length && !fueraPlan.length) c += '<tr><td style="padding:0 28px;font-size:13px;color:#475569">No hubo nada programado ni producido esta semana.</td></tr>';
  else {
    c += '<tr><td style="padding:0 28px"><table role="presentation" style="width:100%;border-collapse:collapse;font-size:13px">';
    conPlan.slice(0, 12).forEach(function (x) { const col = x.c >= 90 ? '#059669' : (x.c >= 70 ? '#d97706' : '#dc2626'), txt = x.c >= 90 ? '#047857' : (x.c >= 70 ? '#b45309' : '#b91c1c'); c += '<tr><td style="padding:4px 8px 4px 0;width:120px;font-weight:700">' + e(x.p) + '</td><td style="padding:4px 0">' + H.barra(Math.min(100, x.c), col) + '</td><td style="padding:4px 0 4px 8px;width:120px;text-align:right;color:#475569;font-size:12px">' + n0(x.ok) + ' / ' + n0(x.prog) + '</td><td style="padding:4px 0 4px 8px;width:50px;text-align:right;font-weight:800;color:' + txt + '">' + n0(x.c) + '%</td></tr>'; });
    c += '</table>';
    if (conPlan.length > 12) c += '<div style="font-size:12px;color:#475569;margin-top:4px">… y ' + (conPlan.length - 12) + ' piezas más, todas por encima de las de la lista.</div>';
    if (fueraPlan.length) c += '<div style="font-size:12px;color:#475569;margin-top:6px">Fuera del plan: ' + fueraPlan.map(function (x) { return '<b>' + e(x.p) + '</b> ' + n0(x.ok); }).join(' · ') + '</div>';
    c += '</td></tr>';
  }
  // --- por máquina
  c += H.titulo('Por máquina', '');
  c += '<tr><td style="padding:0 28px"><table role="presentation" style="width:100%;border-collapse:collapse;font-size:13px"><tr style="background:#f1f5f9;color:#334155;font-size:11px;text-align:left"><th style="padding:7px 8px">Máquina</th><th style="padding:7px 8px;text-align:right">Buenas</th><th style="padding:7px 8px;text-align:right">Scrap</th><th style="padding:7px 8px">Utilización</th><th style="padding:7px 8px;text-align:right">Paradas</th><th style="padding:7px 8px;text-align:right">OEE</th></tr>';
  maqs.forEach(function (m) {
    const x = R.maq[m];
    if (fuera[m] && !x.disp && !x.ok) { c += '<tr style="border-top:1px solid #e2e8f0;color:#475569"><td style="padding:7px 8px;font-weight:800">' + e(m) + '</td><td style="padding:7px 8px" colspan="5">Fuera de servicio</td></tr>'; return; }
    const u = utilDe(x), o = oeeDe(x), sp = (x.ok + x.scrap) ? x.scrap / (x.ok + x.scrap) * 100 : 0, malo = x.disp && u < 60;
    c += '<tr style="border-top:1px solid #e2e8f0' + (malo ? ';background:#fef2f2' : '') + '"><td style="padding:7px 8px;font-weight:800">' + e(m) + '</td><td style="padding:7px 8px;text-align:right">' + n0(x.ok) + '</td><td style="padding:7px 8px;text-align:right">' + n1(sp) + '%</td>' +
      '<td style="padding:7px 8px"><table role="presentation" style="border-collapse:collapse"><tr><td style="padding:0;width:90px">' + H.barra(u, malo ? '#dc2626' : '#0891b2', '90px') + '</td><td style="padding:0 0 0 6px;font-size:12px">' + n0(u) + '%</td></tr></table></td>' +
      '<td style="padding:7px 8px;text-align:right">' + n1(x.paradas) + ' h</td><td style="padding:7px 8px;text-align:right;font-weight:800;color:' + (o == null ? '#475569' : (o >= 75 ? '#047857' : (o < 50 ? '#b91c1c' : '#0f172a'))) + '">' + (o == null ? '—' : n0(o) + '%') + '</td></tr>';
  });
  c += '</table></td></tr>';
  // --- paradas
  c += H.titulo('Paradas: en qué se fue el tiempo', 'total ' + n1(R.paradas) + ' h' + (P.paradas ? ' · ' + vs(R.paradas, P.paradas, true) : ''));
  const top = cods.slice(0, 8), max = top.length ? top[0][1] : 0;
  if (!top.length) c += '<tr><td style="padding:0 28px;font-size:13px;color:#475569">Sin paradas con código esta semana.</td></tr>';
  else {
    c += '<tr><td style="padding:0 28px"><table role="presentation" style="width:100%;border-collapse:collapse;font-size:13px">';
    top.forEach(function (x, i) { c += '<tr><td style="padding:4px 8px 4px 0;width:210px">' + e(nomCod(x[0])) + '</td><td style="padding:4px 0">' + H.barra(max ? x[1] / max * 100 : 0, i === 0 ? '#f97316' : '#fdba74') + '</td><td style="padding:4px 0 4px 8px;width:60px;text-align:right;font-weight:700">' + n1(x[1]) + ' h</td></tr>'; });
    c += '</table></td></tr>';
  }
  // --- material y piezas inyectadas
  const kgs = Object.keys(R.kg).sort(function (a, b) { return R.kg[b] - R.kg[a]; });
  c += H.titulo('Material consumido', kgs.length ? kgs.map(function (k) { return '<b>' + e(k) + '</b> ' + n0(R.kg[k]) + ' kg'; }).join(' · ') : '');
  const pzs = Object.keys(R.piezas).map(function (p) { const x = R.piezas[p]; return { p: p, x: x }; }).filter(function (o) { return o.x.ok || o.x.scrap || o.x.baja; }).sort(function (a, b) { return (b.x.kg || 0) - (a.x.kg || 0) || (b.x.ok - a.x.ok); });
  if (pzs.length) {
    c += '<tr><td style="padding:0 28px"><table role="presentation" style="width:100%;border-collapse:collapse;font-size:12px"><tr style="background:#f1f5f9;color:#334155;font-size:11px;text-align:left"><th style="padding:7px 8px">Pieza inyectada</th><th style="padding:7px 8px">Máq.</th><th style="padding:7px 8px">Aleación</th><th style="padding:7px 8px;text-align:right">Buenas</th><th style="padding:7px 8px;text-align:right">Scrap + baja</th><th style="padding:7px 8px;text-align:right">kg/pieza</th><th style="padding:7px 8px;text-align:right">kg</th></tr>';
    pzs.forEach(function (o) { const x = o.x; c += '<tr style="border-top:1px solid #e2e8f0"><td style="padding:6px 8px;font-weight:700">' + e(o.p) + '</td><td style="padding:6px 8px">' + e(x.maq || '') + '</td><td style="padding:6px 8px">' + e(x.mat || '—') + '</td><td style="padding:6px 8px;text-align:right">' + n0(x.ok) + '</td><td style="padding:6px 8px;text-align:right">' + n0(x.scrap + x.baja) + '</td><td style="padding:6px 8px;text-align:right">' + (x.kgp ? (Math.round(x.kgp * 1000) / 1000).toLocaleString('es-AR') : '—') + '</td><td style="padding:6px 8px;text-align:right;font-weight:800">' + (x.kg ? n1(x.kg) : '—') + '</td></tr>'; });
    c += '</table><div style="font-size:11px;color:#64748b;margin-top:4px">kg = (buenas + scrap + baja) × peso con colada de la pieza. Las piezas sin peso o sin aleación en la base de datos muestran "—".</div></td></tr>';
  }
  // --- rechazos en control de calidad de la semana
  if (R.rechazos && R.rechazos.length) {
    const tot = R.rechazos.reduce(function (a, r) { return a + r.cant; }, 0), porCausa = {};
    R.rechazos.forEach(function (r) { const k = r.causa || 'Sin causa'; porCausa[k] = (porCausa[k] || 0) + r.cant; });
    c += H.titulo('Rechazos en control de calidad: ' + n0(tot) + ' piezas', Object.keys(porCausa).sort(function (a, b) { return porCausa[b] - porCausa[a]; }).map(function (k) { return '<b>' + e(k) + '</b> ' + n0(porCausa[k]); }).join(' · '));
    c += '<tr><td style="padding:0 28px;font-size:12px;color:#334155">' + R.rechazos.map(function (r) { return 'OP ' + e(r.num) + ' · ' + e(r.pieza) + ' (' + e(r.maq) + '): ' + n0(r.cant) + ' · ' + e(r.causa || '') + ' · ' + e(H.fd(r.fecha)); }).join('<br>') + '<div style="font-size:11px;color:#64748b;margin-top:4px">Se descuentan de las piezas buenas. Si se sabe de qué turno salieron, cuentan como scrap de ese turno.</div></td></tr>';
  }
  if (extra.stockBajo && extra.stockBajo.length) c += '<tr><td style="padding:8px 28px 0;font-size:13px;color:#b45309;font-weight:700">⚠ Stock bajo: ' + extra.stockBajo.map(e).join(' · ') + '</td></tr>';
  return H.marco('prod', R, c, 'INOFER · Hecho con los turnos de las órdenes y los partes de horas. Se compara con la semana anterior.' + (extra.generado ? ' Generado el ' + e(extra.generado) + '.' : ''));
}
function textoInforme_(R, P, verPrecios) {
  const H = hInf_(), n0 = H.n0, n1 = H.n1;
  const cods = Object.keys(R.codigos).map(function (k) { return [k, R.codigos[k]]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 3);
  let t = '*INOFER · Producción · Semana ' + H.semIso(R.lunes) + ' (' + H.fd(R.lunes) + ' al ' + H.fd(R.domingo) + ')*\n';
  t += '✅ Piezas buenas: ' + n0(R.ok) + (P.ok ? ' (sem. ant. ' + n0(P.ok) + ')' : '') + '\n';
  t += '❌ Scrap: ' + n1(R.scrapPct) + '% (' + n0(R.scrap) + ' u)\n';
  t += '⚙️ Utilización: ' + n1(R.util) + '%\n';
  if (R.programado) t += '📅 Cumplimiento del plan: ' + n1(R.ok / R.programado * 100) + '%\n';
  if (verPrecios && R.facturado) t += '💰 Facturación producida: $ ' + n0(R.facturado) + '\n';
  if (R.rechazos && R.rechazos.length) t += '🔍 Rechazos en control: ' + n0(R.rechazos.reduce(function (a, r) { return a + r.cant; }, 0)) + ' piezas\n';
  const kgs = Object.keys(R.kg); if (kgs.length) t += '🧱 Material: ' + kgs.map(function (k) { return k + ' ' + n0(R.kg[k]) + ' kg'; }).join(' · ') + '\n';
  t += '⏱️ Paradas: ' + n1(R.paradas) + ' h' + (cods.length ? ' · principales: ' + cods.map(function (c) { return (c[0].split('-').slice(1).join('-').trim() || c[0]) + ' ' + n1(c[1]) + ' h'; }).join(', ') : '');
  return t;
}
// ---------- MANTENIMIENTO ----------
function htmlMant_(R, extra) {
  const H = hInf_(), e = H.e, n0 = H.n0, n1 = H.n1;
  extra = extra || {};
  let c = '';
  const fuera = extra.fueraDet || [];
  c += '<tr><td style="padding:18px 28px 0">' + (fuera.length
    ? '<div style="border:2px solid #dc2626;background:#fef2f2;border-radius:10px;padding:12px 14px"><div style="font-size:11px;font-weight:800;letter-spacing:1px;color:#b91c1c">MÁQUINAS FUERA DE SERVICIO</div>' + fuera.map(function (f) { return '<div style="font-size:15px;font-weight:800;margin-top:4px">' + e(f.m) + (f.motivo ? ' · ' + e(f.motivo) : '') + '</div>' + (f.desde ? '<div style="font-size:12px;color:#7f1d1d">Parada desde el ' + e(H.fd(f.desde)) + (f.dias != null ? ' · ' + f.dias + ' día' + (f.dias === 1 ? '' : 's') : '') + '</div>' : ''); }).join('') + '</div>'
    : '<div style="border:1px solid #a7f3d0;background:#ecfdf5;border-radius:10px;padding:10px 14px;font-size:14px;font-weight:700;color:#047857">✔ Todas las máquinas en servicio.</div>') + '</td></tr>';
  // trabajos sin repetir (misma máquina + misma tarea en la semana = una fila con ×N)
  const vistos = {}, trabajos = [];
  R.trabajos.slice().sort(function (a, b) { return String(a.fecha) < String(b.fecha) ? -1 : 1; }).forEach(function (t) {
    const tarea = String(t.tarea || t.descripcion || t.tipo || '').replace(/^Revisar:\s*/i, '');
    const k = String(t.maquina) + '|' + tarea.toLowerCase().replace(/\s+/g, ' ').trim();
    if (vistos[k]) { vistos[k].veces++; return; }
    vistos[k] = { maquina: t.maquina, tarea: tarea, tipo: t.tipo || 'correctivo', fecha: t.fecha, horas: num_(t.horas), veces: 1, por: t.hecho_por || t.proveedor || '' };
    trabajos.push(vistos[k]);
  });
  const corr = trabajos.filter(function (t) { return t.tipo === 'correctivo'; }).length, prev = trabajos.filter(function (t) { return t.tipo === 'preventivo'; }).length;
  c += '<tr><td style="padding:12px 24px 0"><table role="presentation" style="width:100%;border-collapse:collapse"><tr>' +
    H.tile('TRABAJOS', String(trabajos.length), corr + ' correctivo' + (corr === 1 ? '' : 's') + ' · ' + prev + ' preventivo' + (prev === 1 ? '' : 's'), '') +
    H.tile('HS. PARADA POR ROTURA', n1(R.cat.mant_correctivo || 0) + ' h', 'de los turnos cargados', (R.cat.mant_correctivo || 0) > 8 ? 'mal' : '') +
    H.tile('PREVENTIVOS VENCIDOS', String(R.preventivosVencidos.length), R.prevProximos.length + ' vencen esta semana', R.preventivosVencidos.length ? 'mal' : 'bien') +
    H.tile('ROTURAS ABIERTAS', String(R.roturasAbiertas.length), R.roturasAbiertas.length ? 'sin resolver' : 'ninguna', R.roturasAbiertas.length ? 'mal' : 'bien') +
    '</tr></table></td></tr>';
  c += H.titulo('Trabajos de la semana', '');
  if (!trabajos.length) c += '<tr><td style="padding:0 28px;font-size:13px;color:#475569">No se cargaron trabajos de mantenimiento esta semana.</td></tr>';
  else {
    c += '<tr><td style="padding:0 28px"><table role="presentation" style="width:100%;border-collapse:collapse;font-size:13px"><tr style="background:#f1f5f9;color:#334155;font-size:11px;text-align:left"><th style="padding:7px 8px">Máquina</th><th style="padding:7px 8px">Trabajo</th><th style="padding:7px 8px">Tipo</th><th style="padding:7px 8px">Día</th></tr>';
    const colTipo = { correctivo: '#b91c1c', preventivo: '#047857', mejora: '#1d4ed8' };
    trabajos.forEach(function (t) { c += '<tr style="border-top:1px solid #e2e8f0"><td style="padding:7px 8px;font-weight:800">' + e(t.maquina) + '</td><td style="padding:7px 8px">' + e(t.tarea) + (t.veces > 1 ? ' <span style="color:#475569">(×' + t.veces + ')</span>' : '') + (t.horas ? ' <span style="color:#475569">· ' + n1(t.horas) + ' h</span>' : '') + '</td><td style="padding:7px 8px;font-weight:700;color:' + (colTipo[t.tipo] || '#475569') + '">' + e(t.tipo.charAt(0).toUpperCase() + t.tipo.slice(1)) + '</td><td style="padding:7px 8px">' + e(H.fd(t.fecha)) + '</td></tr>'; });
    c += '</table></td></tr>';
  }
  if (R.roturasAbiertas.length) {
    c += H.titulo('Roturas sin resolver', '');
    c += '<tr><td style="padding:0 28px;font-size:13px">' + R.roturasAbiertas.map(function (x) { return '<div style="border-radius:8px;background:#fef2f2;padding:8px 12px;margin-bottom:6px"><b>' + e(x.maquina) + '</b> · ' + e(x.motivo || x.descripcion || 'Rotura') + ' <span style="color:#7f1d1d">· desde el ' + e(H.fd(x.fecha)) + '</span></div>'; }).join('') + '</td></tr>';
  }
  c += H.titulo('Preventivos', '');
  if (!R.preventivosVencidos.length && !R.prevProximos.length) c += '<tr><td style="padding:0 28px;font-size:13px;color:#047857;font-weight:700">✔ No hay preventivos vencidos ni por vencer esta semana.</td></tr>';
  else {
    c += '<tr><td style="padding:0 28px;font-size:13px">';
    R.preventivosVencidos.forEach(function (p) { c += '<table role="presentation" style="width:100%;border-collapse:collapse;background:#fef2f2;border-radius:8px;margin-bottom:6px"><tr><td style="padding:8px 12px"><b>' + e(p.maquina) + '</b> · ' + e(String(p.tarea || '').replace(/^Revisar:\s*/i, '')) + '</td><td style="padding:8px 12px;text-align:right;white-space:nowrap;font-weight:800;color:#b91c1c">vencido hace ' + p.dias + ' día' + (p.dias === 1 ? '' : 's') + '</td></tr></table>'; });
    R.prevProximos.forEach(function (p) { c += '<table role="presentation" style="width:100%;border-collapse:collapse;background:#fffbeb;border-radius:8px;margin-bottom:6px"><tr><td style="padding:8px 12px"><b>' + e(p.maquina) + '</b> · ' + e(String(p.tarea || '').replace(/^Revisar:\s*/i, '')) + '</td><td style="padding:8px 12px;text-align:right;white-space:nowrap;font-weight:800;color:#b45309">vence el ' + e(H.fd(p.vence)) + '</td></tr></table>'; });
    c += '</td></tr>';
  }
  return H.marco('mant', R, c, 'INOFER · Sale de Mantenimiento (trabajos, roturas y plan preventivo) y de las paradas por rotura cargadas en los turnos.' + (extra.generado ? ' Generado el ' + e(extra.generado) + '.' : ''));
}
function textoMant_(R, extra) {
  const H = hInf_();
  let t = '*INOFER · Mantenimiento · Semana ' + H.semIso(R.lunes) + ' (' + H.fd(R.lunes) + ' al ' + H.fd(R.domingo) + ')*\n';
  const fuera = (extra && extra.fueraDet) || [];
  t += fuera.length ? '⛔ Fuera de servicio: ' + fuera.map(function (f) { return f.m + (f.motivo ? ' (' + f.motivo + ')' : ''); }).join('; ') + '\n' : '✅ Todas las máquinas en servicio\n';
  t += '🔧 Trabajos: ' + R.trabajos.length + '\n';
  if (R.preventivosVencidos.length) t += '⚠️ Preventivos vencidos: ' + R.preventivosVencidos.map(function (p) { return p.maquina + ' · ' + String(p.tarea || '').replace(/^Revisar:\s*/i, ''); }).join('; ') + '\n';
  if (R.prevProximos.length) t += '📅 Vencen esta semana: ' + R.prevProximos.length + '\n';
  if (R.roturasAbiertas.length) t += '🚨 Roturas sin resolver: ' + R.roturasAbiertas.length;
  return t.trim();
}
// ---------- ÓRDENES ----------
function htmlOrd_(R, extra) {
  const H = hInf_(), e = H.e, n0 = H.n0;
  extra = extra || {};
  let c = '';
  const atrasadas = R.ordAbiertas.filter(function (o) { return !o.semana; });
  c += '<tr><td style="padding:18px 24px 0"><table role="presentation" style="width:100%;border-collapse:collapse"><tr>' +
    H.tile('COMPLETADAS', String(R.ordCompl.length), 'en la semana', R.ordCompl.length ? 'bien' : '') +
    H.tile('ABIERTAS', String(R.ordAbiertas.length), 'ahora', '') +
    H.tile('SIN AVANCE EN LA SEMANA', String(atrasadas.length), 'abiertas sin turnos', atrasadas.length ? 'mal' : '') +
    H.tile('DETENIDAS POR ROTURA', String(R.ordDetenidas.length), R.ordDetenidas.length ? 'esperando el molde' : 'ninguna', R.ordDetenidas.length ? 'mal' : '') +
    '</tr></table></td></tr>';
  const tabla = function (lista, conAvance) {
    let h = '<tr><td style="padding:0 28px"><table role="presentation" style="width:100%;border-collapse:collapse;font-size:13px"><tr style="background:#f1f5f9;color:#334155;font-size:11px;text-align:left"><th style="padding:7px 8px">OP</th><th style="padding:7px 8px">Pieza</th><th style="padding:7px 8px">Máq.</th>' + (conAvance ? '<th style="padding:7px 8px">Avance</th><th style="padding:7px 8px;text-align:right">Esta semana</th>' : '<th style="padding:7px 8px;text-align:right">Hechas</th><th style="padding:7px 8px;text-align:right">Terminó</th>') + '</tr>';
    lista.forEach(function (o) {
      h += '<tr style="border-top:1px solid #e2e8f0"><td style="padding:7px 8px;font-weight:800">' + e(o.num) + '</td><td style="padding:7px 8px">' + e(o.pieza) + '</td><td style="padding:7px 8px">' + e(o.maq) + '</td>' +
        (conAvance ? '<td style="padding:7px 8px"><table role="presentation" style="border-collapse:collapse"><tr><td style="padding:0;width:100px">' + H.barra(o.pct, o.pct >= 100 ? '#059669' : '#2563eb', '100px') + '</td><td style="padding:0 0 0 6px;font-size:12px;white-space:nowrap">' + n0(o.pct) + '% · ' + n0(o.hecho) + ' / ' + n0(o.objetivo) + '</td></tr></table></td><td style="padding:7px 8px;text-align:right;' + (o.semana ? '' : 'color:#b91c1c;font-weight:700') + '">' + (o.semana ? n0(o.semana) : 'sin avance') + '</td>'
          : '<td style="padding:7px 8px;text-align:right">' + n0(o.hecho) + (o.objetivo ? ' / ' + n0(o.objetivo) : '') + '</td><td style="padding:7px 8px;text-align:right">' + e(H.fd(o.ultimo)) + '</td>') + '</tr>';
    });
    return h + '</table></td></tr>';
  };
  c += H.titulo('Completadas en la semana', '');
  c += R.ordCompl.length ? tabla(R.ordCompl, false) : '<tr><td style="padding:0 28px;font-size:13px;color:#475569">Ninguna orden se completó esta semana.</td></tr>';
  c += H.titulo('Abiertas', 'de la más avanzada a la menos');
  c += R.ordAbiertas.length ? tabla(R.ordAbiertas, true) : '<tr><td style="padding:0 28px;font-size:13px;color:#475569">No hay órdenes abiertas.</td></tr>';
  if (R.ordDetenidas.length) {
    c += H.titulo('Detenidas por rotura de molde', '');
    c += '<tr><td style="padding:0 28px;font-size:13px">' + R.ordDetenidas.map(function (o) { return '<div style="border-radius:8px;background:#fef2f2;padding:8px 12px;margin-bottom:6px"><b>OP ' + e(o.num) + '</b> · ' + e(o.pieza) + ' · ' + e(o.maq) + (o.motivo ? ' · ' + e(o.motivo) : '') + (o.desde ? ' <span style="color:#7f1d1d">· desde el ' + e(H.fd(o.desde)) + '</span>' : '') + '</div>'; }).join('') + '</td></tr>';
  }
  return H.marco('ord', R, c, 'INOFER · Sale de las órdenes de producción y de los turnos cargados en ellas.' + (extra.generado ? ' Generado el ' + e(extra.generado) + '.' : ''));
}
function textoOrd_(R) {
  const H = hInf_(), n0 = H.n0;
  let t = '*INOFER · Órdenes · Semana ' + H.semIso(R.lunes) + ' (' + H.fd(R.lunes) + ' al ' + H.fd(R.domingo) + ')*\n';
  t += '✅ Completadas: ' + (R.ordCompl.length ? R.ordCompl.map(function (o) { return 'OP ' + o.num + ' ' + o.pieza; }).join(', ') : 'ninguna') + '\n';
  t += '🔄 Abiertas: ' + R.ordAbiertas.length + (R.ordAbiertas.length ? ' (' + R.ordAbiertas.slice(0, 6).map(function (o) { return 'OP ' + o.num + ' ' + n0(o.pct) + '%'; }).join(', ') + ')' : '') + '\n';
  if (R.ordDetenidas.length) t += '🔧 Detenidas por rotura: ' + R.ordDetenidas.map(function (o) { return 'OP ' + o.num + ' ' + o.pieza; }).join(', ');
  return t.trim();
}
function puedeVerPreciosSrv_(u) { return !!u && (u.rol === 'admin' || (puede(u, 'catalogo', 'view') && !(u.permisos && u.permisos.detalle && u.permisos.detalle.precios_ver === false))); }
function armarInforme_(u, lunes, tipo) {
  tipo = INF_TIPOS[tipo] ? tipo : 'prod';
  const mods = obtenerEstadoModulos();
  try { const arch = leerArchivo_(true).map(function (x) { return x.o; }).filter(function (o) { return o; }); if (arch.length) mods.orders = (mods.orders || []).concat(arch); } catch (e) {}
  const regs = obtenerRegistros();
  const R = datosSemana_(mods, regs, lunes), P = datosSemana_(mods, regs, sumarDias_(lunes, -7));
  const verPrecios = puedeVerPreciosSrv_(u);
  const setup = (mods.setup && mods.setup.maquinas) || {};
  const fueraServicio = Object.keys(setup).filter(function (m) { return setup[m] && setup[m].activa === false; }).map(function (m) { return m + (setup[m].motivo ? ' (' + setup[m].motivo + ')' : ''); });
  const stockBajo = [];
  Object.keys(((mods.stock || {}).materiales) || {}).forEach(function (k) { const s = mods.stock.materiales[k]; if (s && s.ultimoCalculo != null && num_(s.minimo) && num_(s.ultimoCalculo) < num_(s.minimo)) stockBajo.push(k + ' ' + Math.round(num_(s.ultimoCalculo)) + ' kg'); });
  const generado = Utilities.formatDate(new Date(), zonaHoja_(), 'dd/MM/yyyy HH:mm');
  const hoyIso = isoDia_(new Date());
  const fueraIds = Object.keys(setup).filter(function (m) { return setup[m] && setup[m].activa === false; });
  const fueraDet = fueraIds.map(function (m) { const d = setup[m].desde || ''; return { m: m, motivo: setup[m].motivo || '', desde: d, dias: d ? Math.max(0, Math.round((new Date(hoyIso + 'T12:00:00Z') - new Date(d + 'T12:00:00Z')) / 864e5)) : null }; });
  const metaScrap = mods.kpis && mods.kpis.scrap && num_(mods.kpis.scrap.meta);
  const extra = { generado: generado, fueraServicio: fueraServicio, fueraIds: fueraIds, fueraDet: fueraDet, stockBajo: stockBajo, metaScrap: metaScrap };
  const html = tipo === 'mant' ? htmlMant_(R, extra) : (tipo === 'ord' ? htmlOrd_(R, extra) : htmlInforme_(R, P, verPrecios, extra));
  const texto = tipo === 'mant' ? textoMant_(R, extra) : (tipo === 'ord' ? textoOrd_(R) : textoInforme_(R, P, verPrecios));
  return { status: 'ok', semana: lunes, tipo: tipo, html: html, texto: texto, resumen: { ok: R.ok, scrapPct: R.scrapPct, util: R.util, facturado: verPrecios ? R.facturado : null, programado: R.programado } };
}
function accionInforme(u, body) {
  if (body.action === 'informeEnviarAhora') {
    if (u.rol !== 'admin') return { status: 'error', error: 'Solo el administrador puede enviar el informe por mail.' };
    const sem = /^\d{4}-\d{2}-\d{2}$/.test(String(body.semana || '')) ? lunesDe_(String(body.semana)) : '';
    try {
      const r = enviarInformeSemanal(true, { semana: sem, manual: true, por: u, tipo: INF_TIPOS[body.tipo] ? body.tipo : 'prod' });
      return { status: /^Informe enviado/.test(r) ? 'ok' : 'error', mensaje: r, error: /^Informe enviado/.test(r) ? '' : r };
    } catch (e) {
      const m = String(e.message || e);
      const permiso = /permiso|permission|authoriz|autoriz|scope/i.test(m);
      return { status: 'error', error: permiso ? 'Google no dejó mandar el mail desde INOFER: falta autorizar el envío. En Apps Script ejecutá una vez "activarAutomaticos" y aceptá los permisos. (' + m + ')' : 'No se pudo enviar: ' + m };
    }
  }
  if (body.action !== 'informeSemanal') return null;
  if (!(u.rol === 'admin' || puede(u, 'indicadores', 'view') || puede(u, 'ordenes', 'view'))) return { status: 'error', error: 'Tu usuario no puede ver el informe.' };
  const hoy = isoDia_(new Date());
  const lunes = /^\d{4}-\d{2}-\d{2}$/.test(String(body.semana || '')) ? lunesDe_(String(body.semana)) : sumarDias_(lunesDe_(hoy), -7);
  return armarInforme_(u, lunes, body.tipo);
}
// Lo llama el disparador semanal de Apps Script (función inoferInformeSemanal del Código.gs)
// El disparador del informe corre cada hora y el servidor decide si toca mandar (día y hora elegidos en INOFER)
function ajustarDisparadores_() {
  try {
    const p = PropertiesService.getScriptProperties();
    const uid = p.getProperty('DISPARADOR_INFORME_UID');
    const exactos = {}; ['', '_MANT', '_ORD'].forEach(function (x) { const v = p.getProperty('INFORME_AT_UID' + x); if (v) exactos[v] = 1; });
    const ts = ScriptApp.getProjectTriggers();
    // los disparadores "exactos" del día y hora de cada informe (programarInforme_) no se tocan
    const inf = ts.filter(function (t) { return t.getHandlerFunction() === 'inoferInformeSemanal' && !exactos[t.getUniqueId()]; });
    if (uid && inf.length === 1 && inf[0].getUniqueId() === uid) return;
    inf.forEach(function (t) { ScriptApp.deleteTrigger(t); });
    const nuevo = ScriptApp.newTrigger('inoferInformeSemanal').timeBased().everyHours(1).create();
    p.setProperty('DISPARADOR_INFORME_UID', nuevo.getUniqueId());
  } catch (e) {}
}
function horarioInforme_(cfg) {
  const dia = cfg && cfg.dia != null && cfg.dia !== '' ? Math.max(0, Math.min(6, Number(cfg.dia))) : 1;
  const hora = cfg && cfg.hora != null && cfg.hora !== '' ? Math.max(0, Math.min(23, Number(cfg.hora))) : 7;
  return { dia: dia, hora: hora };
}
// Envío a la hora exacta: un disparador de una sola vez en el día y la hora elegidos (zona horaria de la planilla).
// El disparador de cada hora queda solo de respaldo y únicamente manda dentro de las 2 horas siguientes al horario.
const INFORME_MARGEN_H = 2;
function proximoEnvioInforme_(cfg, desde) {
  const tz = zonaHoja_(), h = horarioInforme_(cfg);
  desde = desde || new Date();
  const hoy = isoDia_(desde);
  for (let i = 0; i <= 8; i++) {
    const dia = sumarDias_(hoy, i);
    const f = Utilities.parseDate(dia + ' ' + (h.hora < 10 ? '0' : '') + h.hora + ':00', tz, 'yyyy-MM-dd HH:mm');
    const dow = Number(Utilities.formatDate(f, tz, 'u')) % 7;
    if (dow === h.dia && f.getTime() > desde.getTime() + 60000) return f;
  }
  return null;
}
// Config de cada informe: 'prod' usa los campos de siempre del módulo informes; 'mant' y 'ord' van en informes.tipos[tipo]
function cfgTipoInforme_(cfg, tipo) {
  cfg = cfg || {};
  if (tipo === 'prod') return { emails: cfg.emails || [], activo: cfg.activo !== false, dia: cfg.dia, hora: cfg.hora };
  const t = (cfg.tipos && cfg.tipos[tipo]) || {};
  return { emails: t.emails || [], activo: t.activo !== false, dia: t.igual ? cfg.dia : t.dia, hora: t.igual ? cfg.hora : t.hora };
}
function sfxInforme_(tipo) { return tipo === 'prod' ? '' : '_' + String(tipo).toUpperCase(); }
function programarInforme_(soloTipo) {
  const p = PropertiesService.getScriptProperties();
  let primero = null;
  let cfg = {};
  try { cfg = obtenerEstadoModulos().informes || {}; } catch (e) { p.setProperty('INFORME_PROG_ERROR', String(e.message || e).slice(0, 300)); return null; }
  Object.keys(INF_TIPOS).forEach(function (tipo) {
    if (soloTipo && soloTipo !== tipo) return;
    const sfx = sfxInforme_(tipo);
    try {
      const c = cfgTipoInforme_(cfg, tipo);
      const atUid = p.getProperty('INFORME_AT_UID' + sfx);
      ScriptApp.getProjectTriggers().forEach(function (t) { if (atUid && t.getUniqueId() === atUid) ScriptApp.deleteTrigger(t); });
      p.deleteProperty('INFORME_AT_UID' + sfx); p.deleteProperty('INFORME_PROXIMO' + sfx);
      const emails = (c.emails || []).filter(function (x) { return /@/.test(String(x)); });
      if (c.activo === false || !emails.length) return;
      const f = proximoEnvioInforme_(c);
      if (!f) return;
      const t = ScriptApp.newTrigger('inoferInformeSemanal').timeBased().at(f).create();
      p.setProperty('INFORME_AT_UID' + sfx, t.getUniqueId());
      p.setProperty('INFORME_PROXIMO' + sfx, f.toISOString());
      if (tipo === 'prod') primero = f;
      p.deleteProperty('INFORME_PROG_ERROR');
    } catch (e) { p.setProperty('INFORME_PROG_ERROR', String(e.message || e).slice(0, 300)); }
  });
  return primero;
}
function enviarInformeSemanal(forzar, opc) {
  opc = opc || {};
  if (!opc.manual) ajustarDisparadores_();
  if (!opc.manual) { try { archivoAutomatico_(); } catch (e) {} try { revisarAvisosPush_(true); } catch (e) {} }
  // a mano (o "forzar"): un solo informe; el disparador: revisa los tres y manda los que tocan
  if (forzar) return enviarInformeTipo_(INF_TIPOS[opc.tipo] ? opc.tipo : 'prod', true, opc);
  return Object.keys(INF_TIPOS).map(function (t) { return enviarInformeTipo_(t, false, opc); }).join(' | ');
}
function enviarInformeTipo_(tipo, forzar, opc) {
  const T = INF_TIPOS[tipo], sfx = sfxInforme_(tipo), clave = tipo === 'prod' ? 'Informe' : 'Informe de ' + T.nombre;
  const mods = obtenerEstadoModulos();
  const cfg = mods.informes || {}, ct = cfgTipoInforme_(cfg, tipo);
  const props = PropertiesService.getScriptProperties();
  const emails = (ct.emails || []).filter(function (x) { return /@/.test(String(x)); });
  if (!emails.length) return clave + ': no hay mails cargados en INOFER (Informe semanal → Envío automático).';
  if (ct.activo === false && !forzar) return clave + ': el envío por mail está desactivado.';
  const ahora = new Date(), tz = zonaHoja_();
  const h = horarioInforme_(ct);
  if (!forzar) {
    const dow = Number(Utilities.formatDate(ahora, tz, 'u')) % 7, hora = Number(Utilities.formatDate(ahora, tz, 'H'));
    // si el disparador exacto ya pasó (o no existe), se programa el próximo
    const prox = props.getProperty('INFORME_PROXIMO' + sfx);
    if (!prox || new Date(prox).getTime() < ahora.getTime() - 5 * 60000) programarInforme_(tipo);
    const enHora = dow === h.dia && hora >= h.hora && hora < h.hora + INFORME_MARGEN_H;
    props.setProperty('INFORME_CHEQUEO', JSON.stringify({ at: ahora.toISOString(), tz: tz, local: Utilities.formatDate(ahora, tz, 'EEE dd/MM HH:mm'), enHora: enHora }));
    if (!enHora) return clave + ': no es el día y la hora elegidos.';
  }
  const hoy = isoDia_(ahora);
  const lunes = opc.semana || sumarDias_(lunesDe_(hoy), -7);
  const marca = 'INFORME_ENVIADO_' + (sfx ? sfx.slice(1) + '_' : '') + lunes;
  if (!forzar && props.getProperty(marca)) return clave + ': el de esa semana ya se envió.';
  // el disparador exacto y el de cada hora pueden coincidir: que mande uno solo
  let lockInf = null;
  if (!forzar) { lockInf = LockService.getScriptLock(); if (!lockInf.tryLock(30000)) return 'Otro envío en curso.'; if (props.getProperty(marca)) { lockInf.releaseLock(); return clave + ': el de esa semana ya se envió.'; } }
  const admin = { rol: 'admin', usuario: 'sistema', nombre: 'Informe automático', permisos: {} };
  const quien = opc.por ? (opc.por.nombre || opc.por.usuario) : '';
  const inf = armarInforme_(admin, lunes, tipo);
  const Hs = hInf_();
  const asunto = 'INOFER · ' + (tipo === 'prod' ? 'Producción' : T.titulo) + ' · semana ' + Hs.semIso(lunes) + ' (' + Hs.fd(lunes) + ' al ' + Hs.fd(sumarDias_(lunes, 6)) + ')';
  const html = inf.html, texto = inf.texto.replace(/\*/g, '');
  const alias = String(cfg.alias || '').trim();
  let como = '';
  try {
    // Con un alias de "Enviar como" configurado en Gmail, el informe sale desde esa dirección y no desde la cuenta personal
    if (alias) {
      const al = GmailApp.getAliases();
      if (al.indexOf(alias) === -1) throw new Error('El mail ' + alias + ' no está configurado en "Enviar como" de tu Gmail (Configuración → Cuentas e importación). Mientras tanto sale desde la cuenta dueña.');
      GmailApp.sendEmail(emails.join(','), asunto, texto, { htmlBody: html, name: 'INOFER', from: alias, replyTo: alias });
      como = ' (desde ' + alias + ')';
    } else {
      MailApp.sendEmail({ to: emails.join(','), subject: asunto, htmlBody: html, body: texto, name: 'INOFER' });
    }
    props.deleteProperty('INFORME_ERROR');
  } catch (e) {
    const m0 = String(e.message || e);
    const sinPermiso = alias && !/no está configurado/.test(m0) && /mail\.google\.com|googleapis\.com\/auth\/gmail|permiss|permiso/i.test(m0);
    const m = sinPermiso ? 'Para mandar desde ' + alias + ' falta dar permiso de Gmail: en Apps Script agregá "https://mail.google.com/" en oauthScopes de appsscript.json y ejecutá activarAutomaticos. Mientras tanto sale desde la cuenta dueña de la planilla. (O borrá el "Enviar desde" en INOFER.)' : m0;
    props.setProperty('INFORME_ERROR', m.slice(0, 400));
    if (!alias) throw e;
    MailApp.sendEmail({ to: emails.join(','), subject: asunto, htmlBody: html, body: texto, name: 'INOFER' });
    como = sinPermiso ? ' (desde la cuenta dueña: falta el permiso de Gmail para el alias)' : ' (sin el alias: ' + m0 + ')';
  }
  // el envío a mano no cuenta como el automático (el programado sale igual en su día y hora)
  if (!opc.manual) props.setProperty(marca, ahora.toISOString());
  if (lockInf) { try { lockInf.releaseLock(); } catch (e) {} }
  if (!opc.manual) programarInforme_(tipo);
  if (tipo === 'prod') try { enviarPush_('informe', { titulo: 'Informe semanal listo', cuerpo: 'Ya salió por mail el informe de la semana del ' + lunes.split('-').reverse().join('/') + '.', ir: 'hoy', tag: 'informe' }); } catch (e) {}
  props.setProperty('INFORME_ULTIMO' + sfx, JSON.stringify({ fecha: ahora.toISOString(), a: emails.length, como: como + (opc.manual ? ' · enviado a mano' + (quien ? ' por ' + quien : '') : ''), semana: lunes }));
  auditar_(opc.por || admin, 'mail', 'informes', [clave + ' (semana del ' + lunes.split('-').reverse().join('/') + ') enviado' + (opc.manual ? ' a mano' : '') + ' a ' + emails.join(', ') + como]);
  return (tipo === 'prod' ? 'Informe enviado a ' : clave + ' enviado a ') + emails.join(', ') + como;
}

// =====================================================================
// ALMACENAMIENTO Y ARCHIVO DE ÓRDENES VIEJAS (solo administrador)
// Hoja BD_Archivo_Ordenes: id | ordNumber | pieza | maquina | ultima_fecha | archivada_at | archivada_por | json (partido desde la col H)
// =====================================================================
const LIMITE_CELDAS = 10000000;
const LIMITE_PROPS = 500 * 1024;
function hojaArchivo_() {
  const ss = getSs();
  let sh = ss.getSheetByName('BD_Archivo_Ordenes');
  if (!sh) {
    sh = ss.insertSheet('BD_Archivo_Ordenes');
    sh.appendRow(['id', 'ordNumber', 'pieza', 'maquina', 'ultima_fecha', 'archivada_at', 'archivada_por', 'json']);
    sh.getRange('A:G').setNumberFormat('@');
  }
  return sh;
}
function leerArchivo_(conDatos) {
  const sh = getSs().getSheetByName('BD_Archivo_Ordenes');
  if (!sh) return [];
  const rows = sh.getDataRange().getValues();
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0]) continue;
    const x = { fila: i + 1, id: String(r[0]), ordNumber: String(r[1] || ''), part: String(r[2] || ''), machine: String(r[3] || ''), ultima: fechaTexto_(r[4]), at: String(r[5] || ''), por: String(r[6] || '') };
    if (conDatos) { let j = ''; for (let c = 7; c < r.length; c++) j += String(r[c] || ''); try { x.o = JSON.parse(j); } catch (e) { x.o = null; } }
    out.push(x);
  }
  return out;
}
function idsArchivadas_() {
  const cache = CacheService.getScriptCache();
  const c = cache.get('inofer_arch_ids');
  if (c) { try { return JSON.parse(c); } catch (e) {} }
  const o = {}; leerArchivo_(false).forEach(function (x) { o[x.id] = 1; });
  try { cache.put('inofer_arch_ids', JSON.stringify(o), 600); } catch (e) {}
  return o;
}
function olvidarIdsArchivo_() { try { CacheService.getScriptCache().remove('inofer_arch_ids'); } catch (e) { try { CacheService.getScriptCache().put('inofer_arch_ids', 'x', 1); } catch (er) {} } }
function ultimaFechaOrden_(o) { let f = String(o.date || ''); (o.logs || []).forEach(function (l) { if (String(l.date || '') > f) f = String(l.date); }); return f; }
function totalBuenas_(o) { return okReal_(o); }
// Turnos de las órdenes archivadas, en el mismo formato que usa el tablero
function registrosArchivados_() {
  const out = [];
  leerArchivo_(true).forEach(function (x) {
    const o = x.o; if (!o) return;
    (o.logs || []).forEach(function (l) {
      const r = { id: 'op-' + o.id + '-' + l.id, fromOrder: true, archivada: true, ordId: o.id, logId: l.id, date: String(l.date || ''), machine: o.machine, shift: l.turno || 'Turno',
        available: Math.round(horasEntre_(l.startTime, l.endTime) * 100) / 100, part: o.part, ordNumber: o.ordNumber, okPcs: okLog_(o, l), scrapPcs: scrapLog_(o, l), operator: l.operator || '' };
      CATS_SRV.forEach(function (c) { r[c[0]] = 0; });
      const ps = (l.paradas && l.paradas.length) ? l.paradas : (l.stopCode ? [{ codigo: l.stopCode, min: l.stopMinutes }] : []);
      ps.forEach(function (p) { const cat = COD_CAT_SRV[parseInt(String(p.codigo || ''), 10)] || 'otros'; r[cat] = Math.round((r[cat] + num_(p.min) / 60) * 100) / 100; });
      out.push(r);
    });
  });
  return out;
}
function usoNube_() {
  const ss = getSs();
  const hojas = ss.getSheets ? ss.getSheets() : [];
  let celdas = 0; const detalle = [];
  hojas.forEach(function (sh) {
    let filas, cols;
    try { filas = sh.getMaxRows(); cols = sh.getMaxColumns(); } catch (e) { filas = sh.getLastRow(); cols = sh.getLastColumn(); }
    const n = filas * cols; celdas += n;
    detalle.push({ hoja: sh.getName ? sh.getName() : sh.name, filas: sh.getLastRow(), celdas: n });
  });
  detalle.sort(function (a, b) { return b.celdas - a.celdas; });
  let props = 0;
  try { const p = PropertiesService.getScriptProperties().getProperties(); Object.keys(p).forEach(function (k) { props += k.length + String(p[k]).length; }); } catch (e) {}
  const mods = obtenerEstadoModulos(); const tam = {};
  Object.keys(mods).forEach(function (k) { if (k !== 'users') tam[k] = JSON.stringify(mods[k]).length; });
  const ordenes = (mods.orders || []).filter(function (o) { return !DEMO_ORD_SRV[o.id]; });
  return { celdas: celdas, limiteCeldas: LIMITE_CELDAS, hojas: detalle.slice(0, 12), props: props, limiteProps: LIMITE_PROPS, modulos: tam,
    ordenes: ordenes.length, turnos: ordenes.reduce(function (s, o) { return s + (o.logs || []).length; }, 0), partes: Math.max(0, getDbSheet().getLastRow() - 1), archivadas: leerArchivo_(false).length };
}
function candidatasArchivo_(mods, meses) {
  const corte = sumarDias_(isoDia_(new Date()), -Math.round(Math.max(1, num_(meses) || 6) * 30.44));
  return { corte: corte, lista: (mods.orders || []).filter(function (o) { return o && !DEMO_ORD_SRV[o.id] && o.status === 'Completada' && ultimaFechaOrden_(o) && ultimaFechaOrden_(o) < corte; }) };
}
// Archivo automático: una vez por día pasa al archivo las OP completadas de hace más de N meses (lo elige el admin)
function archivoAutoCfg_() {
  let c = null; try { c = JSON.parse(PropertiesService.getScriptProperties().getProperty('ARCHIVO_AUTO') || 'null'); } catch (e) { c = null; }
  c = c || {};
  return { activo: c.activo !== false, meses: Math.max(1, num_(c.meses) || 3) };
}
function archivarCore_(u, meses) {
  const mods = obtenerEstadoModulos();
  const c = candidatasArchivo_(mods, meses);
  if (!c.lista.length) return { archivadas: 0, corte: c.corte };
  const sh = hojaArchivo_();
  const ahora = new Date().toISOString(), por = etiquetaUsuario_(u);
  c.lista.forEach(function (o) {
    const j = JSON.stringify(o); const partes = [];
    for (let p = 0; p < j.length; p += CHUNK) partes.push(j.substring(p, p + CHUNK));
    const fila = [String(o.id), String(o.ordNumber || ''), String(o.part || ''), String(o.machine || ''), ultimaFechaOrden_(o), ahora, por].concat(partes);
    sh.getRange(sh.getLastRow() + 1, 1, 1, fila.length).setNumberFormat('@').setValues([fila]);
  });
  const quitar = {}; c.lista.forEach(function (o) { quitar[String(o.id)] = 1; });
  guardarModuloSinLock_('orders', (mods.orders || []).filter(function (o) { return !quitar[String(o.id)]; }));
  olvidarIdsArchivo_();
  auditar_(u, 'archivó', 'orders', ['Archivó ' + c.lista.length + ' órdenes completadas con último turno antes del ' + c.corte + ' (' + c.lista.slice(0, 15).map(function (o) { return o.ordNumber; }).join(', ') + (c.lista.length > 15 ? '…' : '') + ')']);
  return { archivadas: c.lista.length, corte: c.corte };
}
function archivoAutomatico_() {
  const cfg = archivoAutoCfg_();
  if (!cfg.activo) return { archivadas: 0, apagado: true };
  const props = PropertiesService.getScriptProperties();
  const hoy = isoDia_(new Date());
  let ult = null; try { ult = JSON.parse(props.getProperty('ARCHIVO_AUTO_ULTIMO') || 'null'); } catch (e) { }
  if (ult && ult.dia === hoy) return { archivadas: 0, yaHoy: true };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { archivadas: 0 };
  try {
    try { ult = JSON.parse(props.getProperty('ARCHIVO_AUTO_ULTIMO') || 'null'); } catch (e) { }
    if (ult && ult.dia === hoy) return { archivadas: 0, yaHoy: true };
    const r = archivarCore_({ usuario: 'automático', nombre: 'Archivo automático' }, cfg.meses);
    props.setProperty('ARCHIVO_AUTO_ULTIMO', JSON.stringify({ dia: hoy, at: new Date().toISOString(), archivadas: r.archivadas, meses: cfg.meses }));
    return r;
  } finally { lock.releaseLock(); }
}
function accionAlmacen(u, body) {
  const A = ['almacenUso', 'archivarOrdenes', 'archivoListar', 'archivoRestaurar', 'archivoRegistros', 'archivoAutoRevisar', 'archivoAutoConfig'];
  if (A.indexOf(body.action) === -1) return null;
  if (body.action === 'archivoAutoRevisar') { // lo pide cualquier equipo al abrir; solo hace algo una vez por día
    try { const r = archivoAutomatico_(); return { status: 'ok', archivadas: r.archivadas || 0 }; } catch (e) { return { status: 'ok', archivadas: 0, error: String(e && e.message || e) }; }
  }
  if (body.action === 'archivoRegistros') {
    if (!(puede(u, 'partes', 'view') || puede(u, 'indicadores', 'view') || puede(u, 'ordenes', 'view'))) return { status: 'ok', records: [] };
    return { status: 'ok', records: registrosArchivados_() };
  }
  if (u.rol !== 'admin') return { status: 'error', error: 'Solo el administrador ve el almacenamiento.' };
  if (body.action === 'almacenUso') {
    const uso = usoNube_();
    const c = candidatasArchivo_(obtenerEstadoModulos(), body.meses);
    uso.candidatas = c.lista.length; uso.corte = c.corte;
    uso.turnosCandidatas = c.lista.reduce(function (s, o) { return s + (o.logs || []).length; }, 0);
    uso.bytesCandidatas = JSON.stringify(c.lista).length;
    uso.auto = archivoAutoCfg_();
    try { uso.autoUltimo = JSON.parse(PropertiesService.getScriptProperties().getProperty('ARCHIVO_AUTO_ULTIMO') || 'null'); } catch (e) { uso.autoUltimo = null; }
    return { status: 'ok', uso: uso };
  }
  if (body.action === 'archivoAutoConfig') {
    const cfg = { activo: !!body.activo, meses: Math.max(1, Math.min(60, num_(body.meses) || 3)) };
    PropertiesService.getScriptProperties().setProperty('ARCHIVO_AUTO', JSON.stringify(cfg));
    PropertiesService.getScriptProperties().deleteProperty('ARCHIVO_AUTO_ULTIMO');
    auditar_(u, 'configuró', 'orders', ['Archivo automático ' + (cfg.activo ? 'activado: órdenes completadas de hace más de ' + cfg.meses + ' meses' : 'apagado')]);
    return { status: 'ok', auto: cfg };
  }
  if (body.action === 'archivoListar') {
    return { status: 'ok', archivadas: leerArchivo_(true).map(function (x) { return { id: x.id, ordNumber: x.ordNumber, part: x.part, machine: x.machine, ultima: x.ultima, at: x.at, por: x.por, qty: x.o ? num_(x.o.qtyTarget) : 0, ok: x.o ? totalBuenas_(x.o) : 0, turnos: x.o ? (x.o.logs || []).length : 0 }; }).reverse() };
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const mods = obtenerEstadoModulos();
    if (body.action === 'archivarOrdenes') {
      const r = archivarCore_(u, body.meses);
      return { status: 'ok', archivadas: r.archivadas, corte: r.corte };
    }
    if (body.action === 'archivoRestaurar') {
      const x = leerArchivo_(true).filter(function (a) { return a.id === String(body.id); })[0];
      if (!x || !x.o) return { status: 'error', error: 'No encontré esa orden en el archivo.' };
      const ords = (mods.orders || []).filter(function (o) { return String(o.id) !== x.id; });
      ords.unshift(x.o);
      getSs().getSheetByName('BD_Archivo_Ordenes').deleteRow(x.fila);
      olvidarIdsArchivo_();
      guardarModuloSinLock_('orders', ords);
      auditar_(u, 'restauró', 'orders', ['Sacó del archivo la OP ' + x.ordNumber + ' · ' + x.part]);
      return { status: 'ok' };
    }
  } finally { lock.releaseLock(); }
  return null;
}

// =====================================================================
// GUARDADO SIN PISARSE: fusión de 3 vías (lo que tenía el equipo, lo que hay en la nube y lo nuevo)
// El equipo manda junto con los datos un resumen ("base") de la versión de la nube que conocía.
// Así se sabe qué cambió ese equipo y qué cambiaron otros mientras tanto, y no se pierde nada.
// =====================================================================
function hashTxt_(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36) + '.' + s.length.toString(36); }
function hashObj_(o) { return hashTxt_(JSON.stringify(o === undefined ? null : o)); }
function marcaLog_(l) { return String((l && (l.modificadoAt || l.cargadoAt)) || ''); }
function fusionarOrden_(S, I, b) {
  const out = Object.assign({}, I);
  const LS = porId_(S.logs), baseLogs = {};
  ((b && b.l) || []).forEach(function (id) { baseLogs[String(id)] = 1; });
  const logs = [];
  const vistos = {};
  (I.logs || []).forEach(function (l) {
    const id = String(l.id); vistos[id] = 1;
    const s = LS[id];
    if (!s) { logs.push(l); return; }
    logs.push(marcaLog_(s) > marcaLog_(l) ? s : l);
  });
  (S.logs || []).forEach(function (l) {
    const id = String(l.id); if (vistos[id]) return;
    if (baseLogs[id]) return; // ese equipo lo borró a propósito
    logs.push(l);           // lo cargó otro equipo mientras tanto
  });
  out.logs = logs;
  // rechazos de control: se unen por id (se borran marcándolos, así ninguno revive ni se pierde)
  if ((S.rechazos && S.rechazos.length) || (I.rechazos && I.rechazos.length)) {
    const RS = porId_(S.rechazos), RI = porId_(I.rechazos), rec = [], vr = {};
    (I.rechazos || []).forEach(function (r) { const id = String(r.id); vr[id] = 1; const s2 = RS[id]; rec.push(s2 && (s2.borrado && !r.borrado || String(s2.at || '') > String(r.at || '')) ? s2 : r); });
    (S.rechazos || []).forEach(function (r) { if (!vr[String(r.id)]) rec.push(r); });
    out.rechazos = rec;
  }
  if (S.status === 'Completada' && I.status !== 'Completada' && !I.autoCompletada && S.autoCompletada === false) out.status = S.status;
  return out;
}
function fusionarLista_(clave, stored, incoming, base) {
  const S = porId_(stored), I = porId_(incoming), B = base || {};
  const out = [], usados = {};
  let conflictos = 0;
  (incoming || []).forEach(function (it) {
    if (!it || it.id == null) { out.push(it); return; }
    const id = String(it.id); usados[id] = 1;
    const s = S[id], b = B[id];
    if (!s) { if (b) return; out.push(it); return; } // si estaba en la base y ya no está en la nube, otro lo borró o archivó
    const hI = hashObj_(it), hS = hashObj_(s);
    if (hI === hS) { out.push(s); return; }
    if (b && hI === b.h) { out.push(s); return; }   // este equipo no lo tocó: queda lo de la nube
    if (b && hS === b.h) { out.push(it); return; }  // solo lo cambió este equipo
    conflictos++;
    out.push(clave === 'orders' ? fusionarOrden_(s, it, b) : it);
  });
  const nuevosDeOtros = [];
  (stored || []).forEach(function (s) {
    if (!s || s.id == null) return;
    const id = String(s.id); if (usados[id]) return;
    const b = B[id];
    if (b && hashObj_(s) === b.h) return; // este equipo lo borró y nadie lo había tocado
    nuevosDeOtros.push(s);                // lo agregó (o lo cambió) otro equipo: se conserva
  });
  return { datos: nuevosDeOtros.concat(out), conflictos: conflictos, deOtros: nuevosDeOtros.length };
}
function fusionarGantt_(stored, incoming, base) {
  const S = stored || {}, I = incoming || {}, B = base || {};
  const out = {};
  let conflictos = 0;
  Object.keys(I).forEach(function (w) {
    const s = S[w], it = I[w], b = B[w];
    if (!s) { if (b) return; out[w] = it; return; }
    const hI = hashObj_(it), hS = hashObj_(s);
    if (hI === hS || (b && hI === b.h)) { out[w] = s; return; }
    if (b && hS === b.h) { out[w] = it; return; }
    conflictos++;
    // los dos cambiaron la semana: se resuelve máquina por máquina
    const r = Object.assign({}, it, { machines: {} });
    const mS = s.machines || {}, mI = it.machines || {}, mB = (b && b.m) || {};
    const ms = {}; Object.keys(mS).forEach(function (m) { ms[m] = 1; }); Object.keys(mI).forEach(function (m) { ms[m] = 1; });
    Object.keys(ms).forEach(function (m) {
      const xs = mS[m], xi = mI[m], hb = mB[m];
      if (xi === undefined) { if (xs !== undefined && !(hb && hashObj_(xs) === hb)) r.machines[m] = xs; return; }
      if (xs === undefined) { if (!hb) r.machines[m] = xi; return; }
      const hi = hashObj_(xi);
      r.machines[m] = (hb && hi === hb) ? xs : xi;
    });
    out[w] = r;
  });
  Object.keys(S).forEach(function (w) {
    if (out[w] !== undefined || I[w] !== undefined) return;
    const b = B[w];
    if (b && hashObj_(S[w]) === b.h) return;
    out[w] = S[w];
  });
  return { datos: out, conflictos: conflictos };
}
// Partes de horas: agrega o actualiza por id; solo borra los que el equipo pidió borrar (o todo, si es "vaciar")
function fusionarRegistros_(entries, borrados) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sheet = getDbSheet();
    const rows = sheet.getDataRange().getValues();
    const mostrF = rows.length ? sheet.getRange(1, 2, rows.length, 1).getDisplayValues() : [];
    const fila = {};
    for (let i = 1; i < rows.length; i++) if (rows[i][0] !== '' && rows[i][0] != null) fila[String(rows[i][0])] = i + 1;
    const fBorrar = [];
    (borrados || []).forEach(function (id) { if (fila[String(id)]) fBorrar.push(fila[String(id)]); });
    const ahora = new Date().toISOString();
    const nuevos = [];
    (entries || []).forEach(function (entry) {
      if (!entry || !entry.id) return;
      const f = fila[String(entry.id)];
      const vals = [String(entry.id), fechaTexto_(entry.date), entry.machine, entry.shift,
        Number(entry.available) || 0, Number(entry.parada_maquina) || 0, Number(entry.setup_molde) || 0, Number(entry.puesta_punto) || 0,
        Number(entry.mant_preventivo) || 0, Number(entry.mant_correctivo) || 0, Number(entry.falta_material) || 0, Number(entry.falta_operario) || 0,
        Number(entry.otros) || 0, entry.actualizado || ahora, entry.cargadoPor || USUARIO_ACTUAL || '', entry.modificadoPor || '', entry.cargadoAt || ahora, paradasJson_(entry)];
      if (f) {
        const v = rows[f - 1];
        const igual = vals.every(function (x, j) { return j === 13 || String(x) === String(v[j] == null ? '' : (j === 1 ? fechaCelda_(v[j], mostrF[f - 1] && mostrF[f - 1][0]) : v[j])); });
        if (!igual) filaParteTexto_(sheet, f, vals);
      } else nuevos.push(vals);
    });
    if (nuevos.length) { const f0 = sheet.getLastRow() + 1; sheet.getRange(f0, 2, nuevos.length, 1).setNumberFormat('@'); sheet.getRange(f0, 1, nuevos.length, 18).setValues(nuevos.slice().reverse()); }
    fBorrar.sort(function (a, b) { return b - a; }).forEach(function (f) { sheet.deleteRow(f); });
    marcarVersion_('records');
    return obtenerRegistros();
  } finally { lock.releaseLock(); }
}

// =====================================================================
// VERSIONES: cada sección guarda cuándo cambió, así los equipos bajan solo lo nuevo
// =====================================================================
function marcarVersion_(clave) { try { PropertiesService.getScriptProperties().setProperty('VER_' + clave, String(Date.now()) + '-' + Math.floor(Math.random() * 1000)); } catch (e) {} }
function versiones_() {
  const p = PropertiesService.getScriptProperties().getProperties();
  const out = {};
  Object.keys(p).forEach(function (k) { if (k.indexOf('VER_') === 0) out[k.slice(4)] = p[k]; });
  return out;
}

// =====================================================================
// ROTURAS AVISADAS DESDE LA MÁQUINA (con foto) Y COPIAS DE SEGURIDAD
// Fotos: hoja BD_Fotos (id | fecha | autor | dataURL partido desde la col D)
// =====================================================================
function hojaFotos_() {
  const ss = getSs();
  let sh = ss.getSheetByName('BD_Fotos');
  if (!sh) { sh = ss.insertSheet('BD_Fotos'); sh.appendRow(['id', 'fecha', 'autor', 'foto']); sh.getRange('A:C').setNumberFormat('@'); }
  return sh;
}
function guardarFoto_(u, dataUrl) {
  const s = String(dataUrl || '');
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(s) || s.length > 1500000) return '';
  const id = idNuevo_('foto');
  const partes = []; for (let p = 0; p < s.length; p += CHUNK) partes.push(s.substring(p, p + CHUNK));
  const sh = hojaFotos_();
  const fila = [id, new Date().toISOString(), etiquetaUsuario_(u)].concat(partes);
  sh.getRange(sh.getLastRow() + 1, 1, 1, fila.length).setNumberFormat('@').setValues([fila]);
  return id;
}
function leerFoto_(id) {
  const sh = getSs().getSheetByName('BD_Fotos'); if (!sh) return '';
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) if (String(rows[i][0]) === String(id)) { let s = ''; for (let c = 3; c < rows[i].length; c++) s += String(rows[i][c] || ''); return s; }
  return '';
}
function puedeMantSrv_(u) { return u.rol === 'admin' || ((puede(u, 'gantt', 'edit') || puede(u, 'ordenes', 'edit')) && !(u.permisos && u.permisos.detalle && u.permisos.detalle.mant_editar === false)); }
function accionRotura(u, body) {
  const A = ['avisarRotura', 'fotoLeer', 'fotoGuardar', 'roturaResolver', 'respaldoInfo'];
  if (A.indexOf(body.action) === -1) return null;
  if (body.action === 'fotoLeer') return { status: 'ok', foto: leerFoto_(body.id) };
  // foto suelta (calidad: liberación de primera pieza); queda en BD_Fotos y se guarda solo el id
  if (body.action === 'fotoGuardar') {
    if (!(u.rol === 'admin' || puede(u, 'ordenes', 'edit'))) return { status: 'error', error: 'Tu usuario no puede subir fotos.' };
    const idF = guardarFoto_(u, body.foto);
    return idF ? { status: 'ok', id: idF } : { status: 'error', error: 'La foto no es válida o es muy grande.' };
  }
  if (body.action === 'respaldoInfo') {
    if (u.rol !== 'admin') return { status: 'error', error: 'Solo el administrador.' };
    const p = PropertiesService.getScriptProperties();
    return { status: 'ok', ultimo: p.getProperty('RESPALDO_ULTIMO') || '', lista: jsonSeguro_(p.getProperty('RESPALDOS'), []), error: p.getProperty('RESPALDO_ERROR') || '', informe: jsonSeguro_(p.getProperty('INFORME_ULTIMO'), null), informeError: p.getProperty('INFORME_ERROR') || '', horario: !!p.getProperty('DISPARADOR_INFORME_UID'), proximo: p.getProperty('INFORME_PROXIMO') || '', tipos: { prod: { proximo: p.getProperty('INFORME_PROXIMO') || '', ultimo: jsonSeguro_(p.getProperty('INFORME_ULTIMO'), null) }, mant: { proximo: p.getProperty('INFORME_PROXIMO_MANT') || '', ultimo: jsonSeguro_(p.getProperty('INFORME_ULTIMO_MANT'), null) }, ord: { proximo: p.getProperty('INFORME_PROXIMO_ORD') || '', ultimo: jsonSeguro_(p.getProperty('INFORME_ULTIMO_ORD'), null) } }, chequeo: jsonSeguro_(p.getProperty('INFORME_CHEQUEO'), null), zona: zonaHoja_(), progError: p.getProperty('INFORME_PROG_ERROR') || '' };
  }
  if (!(u.rol === 'admin' || puede(u, 'ordenes', 'edit') || puede(u, 'gantt', 'edit'))) return { status: 'error', error: 'Tu usuario no puede avisar roturas.' };
  if (body.action === 'roturaResolver' && !puedeMantSrv_(u)) return { status: 'error', error: 'Tu usuario no puede cerrar roturas.' };
  const fotoId = body.action === 'avisarRotura' && body.foto ? guardarFoto_(u, body.foto) : '';
  let roturaNueva = '';
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const mods = obtenerEstadoModulos();
    const mant = mods.mantenimiento && typeof mods.mantenimiento === 'object' ? mods.mantenimiento : { planes: [], trabajos: [] };
    mant.roturas = Array.isArray(mant.roturas) ? mant.roturas : [];
    mant.trabajos = Array.isArray(mant.trabajos) ? mant.trabajos : [];
    const setup = mods.setup && typeof mods.setup === 'object' ? mods.setup : { maquinas: {} };
    setup.maquinas = setup.maquinas || {};
    const ahora = new Date();
    const fecha = isoDia_(ahora), hora = Utilities.formatDate(ahora, zonaHoja_(), 'HH:mm');
    if (body.action === 'avisarRotura') {
      const m = String(body.maquina || '').slice(0, 20);
      if (!m) return { status: 'error', error: 'Falta la máquina.' };
      const motivo = String(body.motivo || 'Rotura').slice(0, 120), desc = String(body.descripcion || '').slice(0, 600);
      const esMolde = body.tipo === 'molde';
      const r = { id: idNuevo_('rot'), maquina: m, fecha: fecha, hora: hora, motivo: motivo, descripcion: desc, fotoId: fotoId, paro: !esMolde && body.parada !== false, tipo: esMolde ? 'molde' : 'maquina', ordId: String(body.ordId || '').slice(0, 60), pieza: String(body.pieza || '').slice(0, 60), ordNumber: String(body.ordNumber || '').slice(0, 30), por: etiquetaUsuario_(u), estado: 'abierta', avisadaAt: ahora.toISOString() };
      roturaNueva = r.id;
      mant.roturas.push(r);
      guardarModuloSinLock_('mantenimiento', mant);
      if (r.paro) {
        setup.maquinas[m] = Object.assign({}, setup.maquinas[m] || {}, { activa: false, motivo: 'Rotura: ' + motivo, desde: '', hasta: '' });
        guardarModuloSinLock_('setup', setup);
      }
      try {
        const id = idNuevo_('sol'), f = ahora.toISOString();
        escribirSolicitud_({ id: id, autor: u.usuario, nombre: u.nombre || u.usuario, tipo: 'rotura', titulo: (esMolde ? '🧩 Rotura de molde en la ' : '🔧 Rotura en la ') + m + ': ' + motivo, detalle: (desc ? desc + ' · ' : '') + (esMolde ? 'Molde ' + (r.pieza || '') + (r.ordNumber ? ' (OP ' + r.ordNumber + ')' : '') + ' fuera del Gantt; la máquina sigue trabajando con otra pieza.' : (r.paro ? 'La máquina quedó PARADA.' : 'La máquina sigue andando.')) + (fotoId ? ' (con foto, ver en Mantenimiento)' : ''), estado: 'pendiente', respuesta: '', respondidoPor: '', fecha: f, actualizado: f, vistoAdmin: false, vistoAutor: true });
      } catch (e) {}
      auditar_(u, 'avisó', 'mantenimiento', [(esMolde ? 'Rotura de molde ' + (r.pieza || '') + (r.ordNumber ? ' (OP ' + r.ordNumber + ')' : '') + ' en la ' : 'Rotura en la ') + m + ': ' + motivo + (r.paro ? ' (máquina parada)' : '') + (fotoId ? ' · con foto' : '')]);
    } else {
      const r = mant.roturas.filter(function (x) { return x.id === String(body.id); })[0];
      if (!r) return { status: 'error', error: 'No encontré esa rotura.' };
      r.estado = 'resuelta'; r.resueltaPor = etiquetaUsuario_(u); r.resueltaAt = ahora.toISOString(); r.nota = String(body.nota || '').slice(0, 600);
      mant.trabajos.push({ id: 'mt-' + ahora.getTime(), maquina: r.maquina, fecha: fecha, tipo: 'correctivo', tarea: 'Reparación: ' + r.motivo, descripcion: r.nota, horas: Number(body.horas) || 0, hecho_por: u.nombre || u.usuario, roturaId: r.id, cargadoPor: etiquetaUsuario_(u), cargadoAt: ahora.toISOString() });
      guardarModuloSinLock_('mantenimiento', mant);
      if (body.habilitar !== false && setup.maquinas[r.maquina] && setup.maquinas[r.maquina].activa === false) {
        const c = setup.maquinas[r.maquina]; c.activa = true; delete c.motivo; delete c.desde; delete c.hasta;
        guardarModuloSinLock_('setup', setup);
      }
      auditar_(u, 'resolvió', 'mantenimiento', ['Rotura de la ' + r.maquina + ' (' + r.motivo + ') reparada' + (r.nota ? ': ' + r.nota : '')]);
    }
  } finally { lock.releaseLock(); }
  if (roturaNueva) {
    try {
      const r = ((obtenerEstadoModulos().mantenimiento || {}).roturas || []).filter(function (x) { return x.id === roturaNueva; })[0];
      if (r) enviarPush_('rotura', { titulo: (r.tipo === 'molde' ? 'Rotura de molde · ' : 'Rotura · ') + r.maquina + (r.paro ? ' (parada)' : ''), cuerpo: r.motivo + (r.pieza ? ' · pieza ' + r.pieza : '') + (r.ordNumber ? ' (OP ' + r.ordNumber + ')' : '') + (r.tipo === 'molde' ? '. La máquina sigue operativa.' : '') + ' Avisó ' + (u.nombre || u.usuario) + (r.fotoId ? ', con foto.' : '.'), maq: r.maquina, ir: 'mant', tag: 'rotura-' + r.id }, { excluir: u.usuario });
    } catch (e) {}
  }
  const paq = paqueteDatos(u, null); paq.versiones = versiones_(); if (roturaNueva) paq.roturaId = roturaNueva;
  return paq;
}
// Copia diaria de toda la planilla en Google Drive (la llama el disparador inoferRespaldoDiario del Código.gs)
function copiaDeSeguridad() {
  ajustarDisparadores_();
  const p = PropertiesService.getScriptProperties();
  try {
    const ss = getSs();
    const archivo = DriveApp.getFileById(ss.getId());
    const it = DriveApp.getFoldersByName('INOFER respaldos');
    const carpeta = it.hasNext() ? it.next() : DriveApp.createFolder('INOFER respaldos');
    const nombre = 'INOFER respaldo ' + Utilities.formatDate(new Date(), zonaHoja_(), 'yyyy-MM-dd HH.mm');
    const copia = archivo.makeCopy(nombre, carpeta);
    const lista = jsonSeguro_(p.getProperty('RESPALDOS'), []);
    lista.unshift({ fecha: new Date().toISOString(), nombre: nombre, id: copia.getId(), url: copia.getUrl() });
    while (lista.length > 30) { const v = lista.pop(); try { DriveApp.getFileById(v.id).setTrashed(true); } catch (e) {} }
    p.setProperty('RESPALDOS', JSON.stringify(lista));
    p.setProperty('RESPALDO_ULTIMO', new Date().toISOString());
    p.deleteProperty('RESPALDO_ERROR');
    return 'Copia guardada en Drive: ' + nombre;
  } catch (e) {
    p.setProperty('RESPALDO_ERROR', String(e.message || e).slice(0, 300));
    return 'No se pudo hacer la copia: ' + e.message;
  }
}
// Fusión de 3 vías para set-up (por máquina) y mantenimiento (listas por id)
function fusionarSetup_(stored, incoming, base) {
  const S = (stored && stored.maquinas) || {}, I = (incoming && incoming.maquinas) || {}, B = base || {};
  const out = Object.assign({}, incoming, { maquinas: {} });
  const ms = {}; Object.keys(S).forEach(function (m) { ms[m] = 1; }); Object.keys(I).forEach(function (m) { ms[m] = 1; });
  Object.keys(ms).forEach(function (m) {
    const s = S[m], it = I[m], b = B[m];
    if (it === undefined) { if (s !== undefined) out.maquinas[m] = s; return; }
    if (s === undefined) { out.maquinas[m] = it; return; }
    out.maquinas[m] = (b && hashObj_(it) === b.h) ? s : it;
  });
  return { datos: out, conflictos: 0 };
}
function fusionarMant_(stored, incoming, base) { return fusionarListas_(stored, incoming, base, ['planes', 'trabajos', 'roturas', 'cronoParadas']); }
// Calidad (12/11/2026): planes de control, liberaciones, no conformidades e instrumentos, todas listas por id
function fusionarListas_(stored, incoming, base, listas) {
  const S = stored || {}, I = incoming || {}, B = base || {};
  const out = Object.assign({}, S, I);
  listas.forEach(function (k) {
    if (!Array.isArray(S[k]) && !Array.isArray(I[k])) return;
    out[k] = fusionarLista_('x', S[k] || [], I[k] || [], B[k] || {}).datos;
  });
  return { datos: out, conflictos: 0 };
}

// =====================================================================
// AVISOS AL CELULAR (Web Push sin contenido + VAPID firmado con P-256 acá mismo)
// El aviso viaja vacío: el celular se despierta, pide sus mensajes con su "pid" (pushPendientes) y los muestra.
// Hoja BD_Push: pid | usuario | endpoint | prefs JSON | creado | ultimo | cola JSON | equipo
// =====================================================================
const PUSH_TIPOS = ['rotura', 'parada', 'turno', 'prev', 'stock', 'msg', 'informe'];
// Se arma recién cuando hace falta (si BigInt no existiera, solo fallan los avisos, no todo el servidor)
let P256C_ = null;
function p256_() { if (!P256C_) P256C_ = armarP256_(); return P256C_; }
function armarP256_() {
  const B = BigInt, Z = B(0), U = B(1), DOS = B(2), TRES = B(3), OCHO = B(8), CUATRO = B(4);
  const P = B('0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff');
  const N = B('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
  const G = [B('0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296'), B('0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5')];
  const md = function (a, m) { const r = a % m; return r < Z ? r + m : r; };
  const pot = function (b, e, m) { let r = U; b = md(b, m); while (e > Z) { if (e & U) r = r * b % m; b = b * b % m; e >>= U; } return r; };
  const inv = function (a, m) { return pot(a, m - DOS, m); };
  function dbl(Q) {
    if (!Q || Q[1] === Z) return null;
    const X = Q[0], Y = Q[1], Zc = Q[2];
    const delta = Zc * Zc % P, gamma = Y * Y % P, beta = X * gamma % P;
    const alpha = TRES * md(X - delta, P) % P * ((X + delta) % P) % P;
    const X3 = md(alpha * alpha - OCHO * beta, P);
    const Z3 = md((Y + Zc) * (Y + Zc) - gamma - delta, P);
    const Y3 = md(alpha * md(CUATRO * beta - X3, P) - OCHO * gamma % P * gamma, P);
    return [X3, Y3, Z3];
  }
  function sum(A, Bp) {
    if (!A) return Bp; if (!Bp) return A;
    const z1z1 = A[2] * A[2] % P, z2z2 = Bp[2] * Bp[2] % P;
    const u1 = A[0] * z2z2 % P, u2 = Bp[0] * z1z1 % P;
    const s1 = A[1] * Bp[2] % P * z2z2 % P, s2 = Bp[1] * A[2] % P * z1z1 % P;
    if (u1 === u2) return s1 === s2 ? dbl(A) : null;
    const h = md(u2 - u1, P), r = md(s2 - s1, P), h2 = h * h % P, h3 = h * h2 % P, u1h2 = u1 * h2 % P;
    const X3 = md(r * r - h3 - DOS * u1h2, P);
    const Y3 = md(r * md(u1h2 - X3, P) - s1 * h3, P);
    const Z3 = h * A[2] % P * Bp[2] % P;
    return [X3, Y3, Z3];
  }
  function mul(k, pt) {
    let R = null; const Q = [pt[0], pt[1], U];
    const bits = k.toString(2);
    for (let i = 0; i < bits.length; i++) { R = dbl(R); if (bits[i] === '1') R = sum(R, Q); }
    if (!R) return null;
    const zi = inv(R[2], P), zi2 = zi * zi % P;
    return [R[0] * zi2 % P, R[1] * zi2 % P * zi % P];
  }
  const aBig = function (bytes) { let h = '0x'; bytes.forEach(function (b) { h += ('0' + (b & 255).toString(16)).slice(-2); }); return B(h === '0x' ? '0x0' : h); };
  const aBytes = function (x, n) { let h = x.toString(16); while (h.length < n * 2) h = '0' + h; const o = []; for (let i = 0; i < n * 2; i += 2) o.push(parseInt(h.substr(i, 2), 16)); return o; };
  return {
    N: N, aBig: aBig, aBytes: aBytes,
    publica: function (d) { const Q = mul(d, G); return [4].concat(aBytes(Q[0], 32), aBytes(Q[1], 32)); },
    firmar: function (hashBytes, d, azar) {
      const e = aBig(hashBytes);
      for (let i = 0; i < 20; i++) {
        const k = md(aBig(azar()), N - U) + U;
        const R = mul(k, G); const r = md(R[0], N); if (r === Z) continue;
        const s = md(inv(k, N) * ((e + r * d) % N), N); if (s === Z) continue;
        return aBytes(r, 32).concat(aBytes(s, 32));
      }
      throw new Error('No se pudo firmar');
    }
  };
}
function b64u_(bytes) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'; let o = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] & 255, b = i + 1 < bytes.length ? bytes[i + 1] & 255 : 0, c = i + 2 < bytes.length ? bytes[i + 2] & 255 : 0;
    const n = (a << 16) | (b << 8) | c;
    o += A[(n >> 18) & 63] + A[(n >> 12) & 63] + (i + 1 < bytes.length ? A[(n >> 6) & 63] : '') + (i + 2 < bytes.length ? A[n & 63] : '');
  }
  return o;
}
function ascii_(s) { const o = []; const t = unescape(encodeURIComponent(String(s))); for (let i = 0; i < t.length; i++) o.push(t.charCodeAt(i)); return o; }
function azar32_() { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Utilities.getUuid() + Date.now() + Math.random()).map(function (b) { return b & 255; }); }
function vapid_() {
  const props = PropertiesService.getScriptProperties();
  let d = props.getProperty('VAPID_D'), pub = props.getProperty('VAPID_PUB');
  if (!d || !pub) {
    const x = p256_().aBig(azar32_()) % (p256_().N - BigInt(1)) + BigInt(1);
    d = x.toString(16); pub = b64u_(p256_().publica(x));
    props.setProperty('VAPID_D', d); props.setProperty('VAPID_PUB', pub);
  }
  return { d: BigInt('0x' + d), pub: pub };
}
function vapidJwt_(endpoint) {
  const aud = String(endpoint).match(/^https?:\/\/[^\/]+/)[0];
  const cache = CacheService.getScriptCache(); const ck = 'inofer_vapid_' + aud.replace(/[^a-z0-9]/gi, '').slice(-60);
  const c = cache.get(ck); if (c) return c;
  const v = vapid_();
  const ent = b64u_(ascii_(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))) + '.' + b64u_(ascii_(JSON.stringify({ aud: aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'https://inofer-admin.github.io/INOFER/inofer/' })));
  const firma = p256_().firmar(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, ent).map(function (b) { return b & 255; }), v.d, azar32_);
  const auth = 'vapid t=' + ent + '.' + b64u_(firma) + ', k=' + v.pub;
  try { cache.put(ck, auth, 5 * 3600); } catch (e) {}
  return auth;
}
function hojaPush_() {
  const ss = getSs(); let sh = ss.getSheetByName('BD_Push');
  if (!sh) { sh = ss.insertSheet('BD_Push'); sh.appendRow(['pid', 'usuario', 'endpoint', 'prefs', 'creado', 'ultimo', 'cola', 'equipo']); }
  return sh;
}
function leerPush_() {
  const rows = hojaPush_().getDataRange().getValues(); const out = [];
  for (let i = 1; i < rows.length; i++) { const r = rows[i]; if (!r[0]) continue; out.push({ fila: i + 1, pid: String(r[0]), usuario: String(r[1] || ''), endpoint: String(r[2] || ''), prefs: jsonSeguro_(r[3], {}), creado: String(r[4] || ''), ultimo: String(r[5] || ''), cola: jsonSeguro_(r[6], []), equipo: String(r[7] || '') }); }
  return out;
}
function escribirPush_(x) {
  const fila = [x.pid, x.usuario, x.endpoint, JSON.stringify(x.prefs || {}), x.creado, x.ultimo, JSON.stringify((x.cola || []).slice(-10)), x.equipo || ''];
  const sh = hojaPush_();
  if (x.fila) sh.getRange(x.fila, 1, 1, fila.length).setNumberFormat('@').setValues([fila]);
  else sh.getRange(sh.getLastRow() + 1, 1, 1, fila.length).setNumberFormat('@').setValues([fila]);
}
function pushCfg_() { const m = obtenerEstadoModulos().avisosPush; return m && typeof m === 'object' ? m : {}; }
// Lo que el administrador marcó en la tabla; si no marcó nada para ese usuario, según sus permisos
function pushPermitido_(cfg, u, tipo) {
  const c = cfg.usuarios && cfg.usuarios[u.usuario];
  if (c && typeof c[tipo] === 'boolean') return c[tipo];
  if (u.rol === 'admin') return true;
  const det = function (k) { return !(u.permisos && u.permisos.detalle && u.permisos.detalle[k] === false); };
  if (tipo === 'msg') return true;
  if (tipo === 'rotura' || tipo === 'parada') return puedeMantSrv_(u) && det('mant_ver');
  if (tipo === 'prev') return puedeMantSrv_(u) && det('mant_ver');
  if (tipo === 'turno') return puede(u, 'ordenes', 'edit') && det('ord_editar_turnos') && det('avisos_carga');
  if (tipo === 'stock') return (puede(u, 'ordenes', 'view') || puede(u, 'catalogo', 'view')) && det('stock_ver');
  return false;
}
function horaLocal_() { const h = parseInt(Utilities.formatDate(new Date(), zonaHoja_(), 'H'), 10); return isNaN(h) || h > 23 ? new Date().getHours() : h; }
// Manda un aviso: ev = {titulo, cuerpo, maq, ir, tag}; opc = {usuarios: [solo estos], excluir: usuario, pid: solo ese equipo}
function enviarPush_(tipo, ev, opc) {
  opc = opc || {};
  let filas; try { filas = leerPush_(); } catch (e) { return 0; }
  if (!filas.length) return 0;
  const cfg = pushCfg_(), usuarios = {}; leerUsuarios().forEach(function (x) { usuarios[x.usuario] = x; });
  const h = horaLocal_(), noche = h >= 22 || h < 6;
  const ahora = new Date().toISOString(), envios = [], destinos = [];
  filas.forEach(function (f) {
    if (opc.pid && f.pid !== opc.pid) return;
    const u = usuarios[f.usuario]; if (!u || u.activo === false) return;
    if (!opc.pid) {
      if (opc.excluir && f.usuario === opc.excluir) return;
      if (opc.usuarios && opc.usuarios.indexOf(f.usuario) === -1) return;
      if (!pushPermitido_(cfg, u, tipo)) return;
      const pr = f.prefs || {};
      if (pr.tipos && pr.tipos[tipo] === false) return;
      if (ev.maq && pr.maqs && pr.maqs[ev.maq] === false) return;
      if (noche && pr.silencio !== false && tipo !== 'rotura') return;
    }
    f.cola = (f.cola || []).concat([{ tipo: tipo, titulo: String(ev.titulo || 'INOFER').slice(0, 90), cuerpo: String(ev.cuerpo || '').slice(0, 240), ir: ev.ir || 'hoy', tag: ev.tag || '', at: ahora }]).slice(-10);
    escribirPush_(f);
    destinos.push(f);
    try { envios.push({ url: f.endpoint, method: 'post', payload: '', muteHttpExceptions: true, headers: { Authorization: vapidJwt_(f.endpoint), TTL: '86400', Urgency: tipo === 'rotura' ? 'high' : 'normal' } }); } catch (e) { envios.push(null); }
  });
  if (!envios.length) return 0;
  let resp = [];
  try { resp = UrlFetchApp.fetchAll(envios.filter(function (x) { return x; })); } catch (e) { resp = []; }
  let ok = 0, j = 0; const borrar = [];
  envios.forEach(function (x, i) {
    if (!x) return; const r = resp[j++]; const code = r ? r.getResponseCode() : 0;
    if (code >= 200 && code < 300) ok++;
    else if (code === 404 || code === 410) borrar.push(destinos[i].fila);
  });
  if (borrar.length) { try { borrar.sort(function (a, b) { return b - a; }).forEach(function (fl) { hojaPush_().deleteRow(fl); }); } catch (e) {} }
  return ok;
}
// Avisos que se mandan una sola vez (clave → fecha); se olvidan a los 4 días
function pushYaAvisado_(clave) {
  const props = PropertiesService.getScriptProperties();
  const m = jsonSeguro_(props.getProperty('PUSH_EVENTOS'), {});
  if (m[clave]) return true;
  const corte = new Date(Date.now() - 4 * 86400000).toISOString();
  Object.keys(m).forEach(function (k) { if (m[k] < corte) delete m[k]; });
  const ks = Object.keys(m); if (ks.length > 250) ks.sort(function (a, b) { return m[a] < m[b] ? -1 : 1; }).slice(0, ks.length - 250).forEach(function (k) { delete m[k]; });
  m[clave] = new Date().toISOString();
  props.setProperty('PUSH_EVENTOS', JSON.stringify(m));
  return false;
}
// Máquinas paradas hace más de N minutos (cronómetro de paradas). Corre cada 5 min como mucho.
function revisarAvisosPush_(forzar) {
  const cache = CacheService.getScriptCache();
  if (!forzar && cache.get('inofer_push_rev')) return;
  try { cache.put('inofer_push_rev', '1', 300); } catch (e) {}
  try {
    if (!leerPush_().length) return;
    const mods = obtenerEstadoModulos(), cfg = mods.avisosPush || {}, min = Math.max(5, num_(cfg.minParada) || 30);
    const cron = ((mods.mantenimiento || {}).cronoParadas || []).filter(function (c) { return c && !c.hasta && c.desde; });
    cron.forEach(function (c) {
      const mins = Math.floor((Date.now() - new Date(c.desde).getTime()) / 60000);
      if (!(mins >= min) || mins > 24 * 60) return;
      if (pushYaAvisado_('parada|' + c.id)) return;
      enviarPush_('parada', { titulo: c.maq + ' parada hace ' + mins + ' min', cuerpo: 'Motivo: código ' + (c.codigo || '—') + (c.por ? ' · cronómetro de ' + c.por : '') + '.', maq: c.maq, ir: 'hoy', tag: 'parada-' + c.maq });
    });
  } catch (e) {}
}
function accionPush(u, body) {
  const A = ['pushInfo', 'pushSuscribir', 'pushPrefs', 'pushBaja', 'pushProbar', 'pushEvento', 'pushAdminInfo'];
  if (A.indexOf(body.action) === -1) return null;
  const mios = function () { return leerPush_().filter(function (f) { return f.usuario === u.usuario; }); };
  if (body.action === 'pushInfo') {
    const cfg = pushCfg_();
    return { status: 'ok', clave: vapid_().pub, equipos: mios().map(function (f) { return { pid: f.pid, equipo: f.equipo, creado: f.creado, prefs: f.prefs }; }), permitidos: PUSH_TIPOS.filter(function (t) { return pushPermitido_(cfg, u, t); }) };
  }
  if (body.action === 'pushSuscribir') {
    const sub = body.sub || {}; const ep = String(sub.endpoint || '');
    if (!/^https:\/\//.test(ep) || ep.length > 1200) return { status: 'error', error: 'Suscripción inválida.' };
    const ya = leerPush_().filter(function (f) { return f.endpoint === ep || (body.pid && f.pid === String(body.pid)); })[0];
    const ahora = new Date().toISOString();
    const x = ya || { pid: Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8), creado: ahora, cola: [] };
    x.usuario = u.usuario; x.endpoint = ep; x.ultimo = ahora; x.equipo = String(body.equipo || '').slice(0, 60);
    x.prefs = body.prefs && typeof body.prefs === 'object' ? body.prefs : (x.prefs || {});
    escribirPush_(x);
    auditar_(u, 'activó', 'avisos', ['Avisos al celular activados en ' + (x.equipo || 'un equipo')]);
    return { status: 'ok', pid: x.pid };
  }
  const mio = mios().filter(function (f) { return f.pid === String(body.pid || ''); })[0];
  if (body.action === 'pushPrefs') { if (!mio) return { status: 'error', error: 'Este equipo no tiene los avisos activados.' }; mio.prefs = body.prefs || {}; escribirPush_(mio); return { status: 'ok' }; }
  if (body.action === 'pushBaja') { if (mio) hojaPush_().deleteRow(mio.fila); return { status: 'ok' }; }
  if (body.action === 'pushProbar') {
    if (!mio) return { status: 'error', error: 'Este equipo no tiene los avisos activados.' };
    const n = enviarPush_('msg', { titulo: 'Prueba de INOFER', cuerpo: 'Así te van a llegar los avisos. Tocá para abrir la app.', ir: 'hoy', tag: 'prueba' }, { pid: mio.pid });
    return { status: 'ok', enviados: n };
  }
  if (body.action === 'pushEvento') { // avisos que calcula la app (turno sin cargar, preventivo, stock): una sola vez cada uno
    const tipo = String(body.tipo || '');
    if (['turno', 'prev', 'stock'].indexOf(tipo) === -1) return { status: 'error', error: 'Tipo desconocido.' };
    const clave = tipo + '|' + String(body.clave || '').slice(0, 120);
    if (tipo === 'turno' && num_(body.fin) && Date.now() - num_(body.fin) < Math.max(10, num_(pushCfg_().minTurno) || 30) * 60000) return { status: 'ok', pronto: true };
    if (pushYaAvisado_(clave)) return { status: 'ok', ya: true };
    const n = enviarPush_(tipo, { titulo: body.titulo, cuerpo: body.cuerpo, maq: body.maq ? String(body.maq).slice(0, 20) : '', ir: String(body.ir || 'hoy').slice(0, 20), tag: tipo + '-' + String(body.clave || '').slice(0, 40) });
    return { status: 'ok', enviados: n };
  }
  if (body.action === 'pushAdminInfo') {
    if (u.rol !== 'admin') return { status: 'error', error: 'Solo el administrador.' };
    const filas = leerPush_(), cfg = pushCfg_();
    return { status: 'ok', tipos: PUSH_TIPOS, cfg: cfg, usuarios: leerUsuarios().filter(function (x) { return x.activo !== false; }).map(function (x) {
      const per = {}; PUSH_TIPOS.forEach(function (t) { per[t] = pushPermitido_(cfg, x, t); });
      return { usuario: x.usuario, nombre: x.nombre || x.usuario, rol: x.rol, equipos: filas.filter(function (f) { return f.usuario === x.usuario; }).length, permitidos: per };
    }) };
  }
  return null;
}

// =====================================================================
// RESTAURAR EL GANTT DESDE UNA COPIA DE SEGURIDAD (solo administrador)
// Lee el módulo gantt de una copia diaria de Drive (RESPALDOS) y lo devuelve; el equipo elige qué semanas recuperar.
// =====================================================================
function ganttDeHoja_(ss) {
  const sh = ss.getSheetByName(STATE_SHEET_NAME); if (!sh) return null;
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0] || '') !== 'gantt') continue;
    let val = String(rows[i][1] || ''); for (let c = 3; c < rows[i].length; c++) val += String(rows[i][c] || '');
    try { return JSON.parse(val); } catch (e) { return null; }
  }
  return null;
}
// Stock de piezas ya inyectadas (módulo stockPiezas, SOLO lo recibe el admin). Para el armado del Gantt de otros usuarios
// la nube devuelve cuánto descontar por pieza, topeado a lo que pide la planilla (no manda el stock completo).
function accionStockGantt_(u, body) {
  if (body.action !== 'stockGantt') return null;
  if (u.rol !== 'admin' && !puede(u, 'gantt', 'edit')) return { status: 'error', error: 'Sin permiso.' };
  const sp = obtenerEstadoModulos().stockPiezas || {}, P = sp.piezas || {};
  const norm = function (x) { return String(x == null ? '' : x).trim().toUpperCase(); };
  const idx = {}; Object.keys(P).forEach(function (k) { idx[norm(k)] = P[k]; });
  const pedidas = body.partes && typeof body.partes === 'object' ? body.partes : {};
  const cap = {};
  Object.keys(pedidas).slice(0, 3000).forEach(function (k) {
    const kk = norm(k); const e = idx[kk] || idx[/\/1$/.test(kk) ? kk.replace(/\/1$/, '') : kk + '/1']; if (!e) return;
    const st = Math.max(0, (Number(e.iny) || 0) + (Number(e.reb) || 0)), tot = Math.max(0, Number(pedidas[k]) || 0);
    const c = Math.min(st, tot); if (c > 0) cap[k] = c;
  });
  return { status: 'ok', cap: cap, hay: !!Object.keys(P).length, fecha: sp.fecha || '' };
}
function accionGanttCopias(u, body) {
  if (['ganttCopias', 'ganttDeCopia'].indexOf(body.action) === -1) return null;
  if (u.rol !== 'admin') return { status: 'error', error: 'Solo el administrador puede recuperar copias.' };
  const lista = jsonSeguro_(PropertiesService.getScriptProperties().getProperty('RESPALDOS'), []);
  if (body.action === 'ganttCopias') return { status: 'ok', copias: lista.map(function (x) { return { id: x.id, fecha: x.fecha, nombre: x.nombre }; }) };
  const c = lista.filter(function (x) { return x.id === String(body.id || ''); })[0];
  if (!c) return { status: 'error', error: 'No encontré esa copia.' };
  let g = null;
  try { g = ganttDeHoja_(SpreadsheetApp.openById(c.id)); } catch (e) { return { status: 'error', error: 'No se pudo abrir la copia: ' + (e.message || e) }; }
  if (!g) return { status: 'error', error: 'Esa copia no tiene Gantt guardado.' };
  return { status: 'ok', copia: { id: c.id, fecha: c.fecha, nombre: c.nombre }, gantt: g };
}

function doPost(e) {
  const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  const cuenta = accionCuenta(body);
  if (cuenta) return respuesta(cuenta);

  const u = usuarioDeToken(body.token);
  if (!u) return respuesta({ status: 'error', error: 'auth', authRequired: true });

  const ia = accionIA(u, body);
  if (ia) return respuesta(ia);
  const msg = accionMensajeria(u, body);
  if (msg) return respuesta(msg);
  const aud = accionAuditoria(u, body);
  if (aud) return respuesta(aud);
  const inf = accionInforme(u, body);
  if (inf) return respuesta(inf);
  const alm = accionAlmacen(u, body);
  if (alm) return respuesta(alm);
  const rot = accionRotura(u, body);
  if (rot) return respuesta(rot);
  const psh = accionPush(u, body);
  if (psh) return respuesta(psh);
  const gcp = accionGanttCopias(u, body);
  if (gcp) return respuesta(gcp);
  const stg = accionStockGantt_(u, body);
  if (stg) return respuesta(stg);

  if (['listPapelera', 'restaurarPapelera', 'vaciarPapelera'].indexOf(body.action) !== -1) {
    const resP = accionPapelera(u, body) || { status: 'error', error: 'Acción desconocida' };
    if (body.action !== 'listPapelera' && resP.status === 'ok') auditar_(u, body.action === 'restaurarPapelera' ? 'restauró' : 'vació', 'papelera', [body.action === 'restaurarPapelera' ? 'Restauró un elemento de la papelera' : 'Vació la papelera' + (body.ids ? ' (elementos sueltos)' : '')]);
    return respuesta(resP);
  }

  USUARIO_ACTUAL = u.nombre ? (u.nombre + ' (@' + u.usuario + ')') : u.usuario;
  let records = null;
  const sinPermiso = function (area) { return respuesta({ status: 'error', error: 'permiso', area: area, auth: publico(u) }); };
  if (['add', 'edit', 'delete', 'replace'].indexOf(body.action) !== -1) {
    if (!puede(u, 'partes', 'edit')) return sinPermiso('partes');
    // la carga manual de partes es solo para el administrador y los usuarios que él habilita
    const det = function (k) { return u.rol === 'admin' || !!(u.permisos && u.permisos.detalle && u.permisos.detalle[k] === true); };
    const okManual = body.action === 'add' ? det('partes_cargar') : (body.action === 'edit' ? det('partes_editar') : (body.action === 'delete' ? det('partes_borrar') : (det('partes_cargar') || det('partes_editar') || det('partes_borrar'))));
    if (!okManual) return sinPermiso('partes');
    if (body.action === 'add') { records = guardarRegistro(body.entry); auditar_(u, 'cargó', 'partes', [resumenParte_(body.entry)]); }
    else if (body.action === 'edit') {
      try { const ant = obtenerRegistros().filter(function (r) { return String(r.id) === String(body.entry && body.entry.id); })[0]; const c = ant ? camposCambiados_(ant, body.entry, ['actualizado', 'cargadoPor', 'modificadoPor', 'cargadoAt', 'paradas', 'id']).filter(function (x) { return !/: (0|—) → (0|—)$/.test(x); }) : []; if (ant && !igual_(ant.paradas || [], body.entry.paradas || [])) c.push('paradas'); auditar_(u, 'corrigió', 'partes', [resumenParte_(body.entry) + (c.length ? ' (' + c.join('; ') + ')' : '')]); } catch (e) {}
      records = editarRegistro(body.entry);
    }
    else if (body.action === 'delete') {
      try { const b = obtenerRegistros().filter(function (r) { return String(r.id) === String(body.id); }); registrarEliminados(u, 'parte', b, {}); if (b[0]) auditar_(u, 'borró', 'partes', [resumenParte_(b[0])]); } catch (e) {}
      records = eliminarRegistro(body.id);
    } else if (body.todo !== true) {
      try {
        const viejos = idsDe(obtenerRegistros());
        const alta = (body.records || []).filter(function (r) { return r && !viejos[String(r.id)]; });
        const bor = obtenerRegistros().filter(function (r) { return (body.borrados || []).map(String).indexOf(String(r.id)) !== -1; });
        if (bor.length) registrarEliminados(u, 'parte', bor, {});
        auditar_(u, 'sincronizó', 'partes', alta.map(function (r) { return 'Cargó ' + resumenParte_(r); }).concat(bor.map(function (r) { return 'Borró ' + resumenParte_(r); })));
      } catch (e) {}
      records = fusionarRegistros_(body.records, body.borrados);
    } else {
      if (u.rol !== 'admin') return sinPermiso('partes');
      try {
        const nuevos = idsDe(body.records);
        const actuales = obtenerRegistros();
        const borr = actuales.filter(function (r) { return !nuevos[String(r.id)]; });
        registrarEliminados(u, 'parte', borr, {});
        const viejos = idsDe(actuales);
        const alta = (body.records || []).filter(function (r) { return r && !viejos[String(r.id)]; });
        auditar_(u, 'sincronizó', 'partes', alta.map(function (r) { return 'Cargó ' + resumenParte_(r); }).concat(borr.map(function (r) { return 'Borró ' + resumenParte_(r); })));
      } catch (e) {}
      records = reemplazarRegistros(body.records);
    }
  } else if (body.action === 'saveModule') {
    const area = MODULO_AREA[body.moduleKey];
    if (!area || body.moduleKey === 'users') return sinPermiso('desconocida');
    const ok = area === 'admin' ? u.rol === 'admin' : puedeArea_(u, area, 'edit');
    if (!ok) return sinPermiso(area);
    if (MODULOS_PRECIO[body.moduleKey] && !puedeVerPreciosSrv_(u)) return sinPermiso('precios');
    if (body.moduleKey === 'rebabadoOp' && !puedeVerOperariosSrv_(u)) return sinPermiso('operarios');
    // las órdenes archivadas no vuelven aunque un equipo tenga una copia vieja
    if (body.moduleKey === 'orders' && Array.isArray(body.moduleData)) { try { const arch = idsArchivadas_(); body.moduleData = body.moduleData.filter(function (o) { return !(o && arch[String(o.id)]); }); } catch (e) {} }
    const lockM = LockService.getScriptLock();
    lockM.waitLock(20000);
    let fusion = null;
    try {
      let anterior = null;
      try { anterior = obtenerEstadoModulos()[body.moduleKey]; } catch (e) {}
      if (body.base && typeof body.base === 'object' && anterior != null) {
        try {
          if (body.moduleKey === 'gantt' && body.moduleData && typeof body.moduleData === 'object') fusion = fusionarGantt_(anterior, body.moduleData, body.base);
          else if ((body.moduleKey === 'orders' || body.moduleKey === 'catalog') && Array.isArray(body.moduleData) && Array.isArray(anterior)) fusion = fusionarLista_(body.moduleKey, anterior, body.moduleData, body.base);
          else if (body.moduleKey === 'setup' && body.moduleData && body.moduleData.maquinas) fusion = fusionarSetup_(anterior, body.moduleData, body.base);
          else if (body.moduleKey === 'mantenimiento' && body.moduleData && typeof body.moduleData === 'object') fusion = fusionarMant_(anterior, body.moduleData, body.base);
          else if (body.moduleKey === 'calidadDatos' && body.moduleData && typeof body.moduleData === 'object') fusion = fusionarListas_(anterior, body.moduleData, body.base, ['planes', 'liberaciones', 'ncs', 'instrumentos']);
          if (fusion) body.moduleData = fusion.datos;
        } catch (e) { fusion = null; }
      }
      if (!igual_(anterior, body.moduleData)) {
        try { registrarDiferencias(u, body.moduleKey, anterior, body.moduleData); } catch (e) {}
        try { auditar_(u, 'modificó', body.moduleKey, resumenCambio_(body.moduleKey, anterior, body.moduleData)); } catch (e) {}
        guardarModuloSinLock_(body.moduleKey, body.moduleData);
      }
    } finally { lockM.releaseLock(); }
    // cambió el día/hora o los mails del informe → se reprograma el envío exacto
    if (body.moduleKey === 'informes') { try { programarInforme_(); } catch (e) {} }
    const paqM = paqueteDatos(u, records);
    paqM.versiones = versiones_();
    if (fusion) paqM.fusion = { modulo: body.moduleKey, conflictos: fusion.conflictos || 0, deOtros: fusion.deOtros || 0 };
    return respuesta(paqM);
  }
  return respuesta(paqueteDatos(u, records));
}
