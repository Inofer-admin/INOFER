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

function obtenerEstadoModulos() {
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
  mantenimiento: 'gantt|ordenes', stock: 'ordenes|catalogo', avisos: 'ordenes', informes: 'admin', operarios: 'admin' };
// área 'a|b' = alcanza con tener permiso en cualquiera de las dos
function puedeArea_(u, area, nivel) { return String(area).split('|').some(function (a) { return puede(u, a, nivel); }); }

function modulosVisibles(u) {
  const all = obtenerEstadoModulos();
  const out = {};
  Object.keys(all).forEach(function (k) {
    if (k === 'users') return; // nunca se envía la lista de usuarios por acá
    const area = MODULO_AREA[k];
    if (!area) return;
    if (k === 'turnos' || k === 'presentacion' || k === 'operarios' || (area === 'admin' ? ((k === 'config' && puede(u, 'ia', 'view')) || u.rol === 'admin') : puedeArea_(u, area, 'view'))) out[k] = all[k];
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
      if (!usuario || String(body.clave || '').length < 4) return { status: 'error', error: 'Usuario o clave inválidos.' };
      const sal = Utilities.getUuid();
      const u = { usuario: usuario, nombre: String(body.nombre || usuario), rol: 'admin', permisos: normalizarPermisos('admin', {}), activo: true, sal: sal, hash: hashClave(sal, String(body.clave)) };
      escribirUsuario(u);
      return { status: 'ok', token: crearSesion(usuario), auth: publico(u) };
    }
    if (body.action === 'login') {
      const usuario = String(body.usuario || '').trim().toLowerCase();
      const u = usuarios.filter(function (x) { return x.usuario === usuario; })[0];
      if (!u || !u.activo || hashClave(u.sal, String(body.clave || '')) !== u.hash) {
        Utilities.sleep(800);
        return { status: 'error', error: 'Usuario o clave incorrectos.' };
      }
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
      if (hashClave(yo.sal, String(body.claveActual || '')) !== yo.hash) return { status: 'error', error: 'La clave actual no es correcta.' };
      if (String(body.claveNueva || '').length < 4) return { status: 'error', error: 'La clave nueva debe tener al menos 4 caracteres.' };
      yo.sal = Utilities.getUuid(); yo.hash = hashClave(yo.sal, String(body.claveNueva));
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
      if (!ex && String(d.clave || '').length < 4) return { status: 'error', error: 'La clave debe tener al menos 4 caracteres.' };
      const u = ex || { usuario: usuario, sal: '', hash: '' };
      u.nombre = String(d.nombre || usuario).slice(0, 60);
      u.rol = rol; u.activo = activo;
      u.permisos = normalizarPermisos(rol, d.permisos || {});
      if (d.clave) { u.sal = Utilities.getUuid(); u.hash = hashClave(u.sal, String(d.clave)); }
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
 * La clave del primer administrador pasa a ser: inofer1234  (cambiala después de entrar).
 */
function restablecerClaveAdmin() {
  const admin = leerUsuarios().filter(function (x) { return x.rol === 'admin'; })[0];
  if (!admin) { Logger.log('No hay administradores: al abrir INOFER se te va a pedir crear uno.'); return; }
  admin.sal = Utilities.getUuid(); admin.hash = hashClave(admin.sal, 'inofer1234'); admin.activo = true;
  escribirUsuario(admin);
  Logger.log('Listo. Usuario: ' + admin.usuario + '  Clave: inofer1234');
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.action === 'versiones') {
    const u = usuarioDeToken(p.token);
    if (!u) return respuesta({ status: 'error', error: 'auth', authRequired: true });
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
function solicitudesDe_(u) {
  const todas = leerSolicitudes_();
  return (u.rol === 'admin' ? todas : todas.filter(function (s) { return s.autor === u.usuario; })).map(solPublica_).reverse();
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
        directorio: directorio_(), solicitudesAviso: solAviso, solPendientes: u.rol === 'admin' ? sols.filter(function (s) { return s.estado === 'pendiente'; }).length : 0 };
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
  turnos: 'Turnos', setup: 'Set-up y máquinas', presentacion: 'Presentación', mantenimiento: 'Mantenimiento', stock: 'Stock', avisos: 'Avisos', informes: 'Informe semanal' };
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
    if (!out.length) out.push('Cambió mínimos o datos del stock');
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
  4: 'mant_correctivo', 10: 'mant_correctivo', 11: 'mant_correctivo', 14: 'mant_correctivo', 17: 'mant_correctivo', 18: 'mant_preventivo', 29: 'mant_preventivo', 31: 'mant_preventivo', 30: 'falta_material', 19: 'falta_operario', 15: 'otros', 22: 'otros' };
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
      const ok = num_(l.okPcs), sc = num_(l.scrapPcs), bj = num_(l.lowStartPcs), h = horasEntre_(l.startTime, l.endTime);
      R.ok += ok; R.scrap += sc; R.baja += bj; R.disp += h; R.turnos++;
      if (!R.maq[m]) R.maq[m] = { ok: 0, scrap: 0, disp: 0, paradas: 0, correctivo: 0 };
      R.maq[m].ok += ok; R.maq[m].scrap += sc; R.maq[m].disp += h;
      const pz = R.piezas[o.part] = R.piezas[o.part] || { ok: 0, scrap: 0, maq: m };
      pz.ok += ok; pz.scrap += sc;
      const precio = num_(c.precio || o.precio);
      if (precio) R.facturado += ok * precio; else if (ok) R.sinPrecio += ok;
      const kgp = num_(c.weightWithSprueKg || o.weightWithSprueKg), mat = String(c.material || o.material || '').toUpperCase();
      if (kgp && mat) R.kg[mat] = (R.kg[mat] || 0) + (ok + sc + bj) * kgp;
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
  // mantenimiento
  const mant = mods.mantenimiento || {};
  R.trabajos = (mant.trabajos || []).filter(function (t) { return enSem(t.fecha); });
  R.preventivosVencidos = (mant.planes || []).filter(function (p) { return p.ultimo && num_(p.cadaDias) && sumarDias_(p.ultimo, num_(p.cadaDias)) < sumarDias_(dom, 1); });
  return R;
}
function htmlInforme_(R, P, verPrecios, extra) {
  const e = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  const n0 = function (v) { return Math.round(num_(v)).toLocaleString('es-AR'); };
  const n1 = function (v) { return (Math.round(num_(v) * 10) / 10).toLocaleString('es-AR'); };
  const plata = function (v) { return '$ ' + Math.round(num_(v)).toLocaleString('es-AR'); };
  const fd = function (iso) { const p = iso.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; };
  const delta = function (a, b, inv, suf) { if (!b) return ''; const d = (a - b) / Math.abs(b) * 100; if (!isFinite(d) || Math.abs(d) < 0.5) return '<span style="color:#64748b">= sem. anterior</span>'; const bueno = inv ? d < 0 : d > 0; return '<span style="color:' + (bueno ? '#059669' : '#dc2626') + '">' + (d > 0 ? '▲ ' : '▼ ') + n1(Math.abs(d)) + '%' + (suf || '') + '</span>'; };
  const tile = function (t, v, s) { return '<td style="padding:10px 12px;border:1px solid #e2e8f0;border-radius:8px;vertical-align:top;width:25%"><div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.04em">' + t + '</div><div style="font-size:22px;font-weight:800;color:#0f172a;margin:2px 0">' + v + '</div><div style="font-size:11px">' + (s || '') + '</div></td>'; };
  const th = 'style="text-align:left;padding:6px 8px;background:#f1f5f9;font-size:11px;color:#334155;border-bottom:1px solid #cbd5e1"';
  const td = 'style="padding:5px 8px;font-size:12px;border-bottom:1px solid #e2e8f0"';
  const tdr = 'style="padding:5px 8px;font-size:12px;border-bottom:1px solid #e2e8f0;text-align:right"';
  let h = '<div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;max-width:860px;margin:0 auto">';
  h += '<div style="display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #0891b2;padding-bottom:8px;margin-bottom:14px"><div><div style="font-size:26px;font-weight:900;letter-spacing:.06em;color:#0891b2">INOFER</div><div style="font-size:15px;font-weight:700">Informe semanal de producción</div></div><div style="text-align:right;font-size:12px;color:#475569">Semana del ' + fd(R.lunes) + ' al ' + fd(R.domingo) + '<br>Generado el ' + e(extra.generado) + '</div></div>';
  h += '<table style="width:100%;border-collapse:separate;border-spacing:6px;margin:0 -6px"><tr>' +
    tile('Piezas buenas', n0(R.ok), delta(R.ok, P.ok)) + tile('Scrap', n1(R.scrapPct) + '%', n0(R.scrap) + ' u · ' + delta(R.scrapPct, P.scrapPct, true)) +
    tile('Utilización', n1(R.util) + '%', n1(R.disp) + ' h disponibles · ' + delta(R.util, P.util)) +
    (verPrecios ? tile('Facturación producida', plata(R.facturado), delta(R.facturado, P.facturado) + (R.sinPrecio ? '<br><span style="color:#b45309">' + n0(R.sinPrecio) + ' u sin precio</span>' : '')) : tile('Turnos cargados', n0(R.turnos), delta(R.turnos, P.turnos))) + '</tr></table>';
  const cumpl = R.programado ? Math.min(999, R.ok / R.programado * 100) : 0;
  h += '<h3 style="font-size:14px;margin:18px 0 6px">Cumplimiento del plan (Gantt)</h3>';
  h += R.programado ? '<div style="font-size:12px;margin-bottom:6px">Programado <b>' + n0(R.programado) + '</b> u · producido <b>' + n0(R.ok) + '</b> u · cumplimiento <b style="color:' + (cumpl >= 90 ? '#059669' : (cumpl >= 70 ? '#b45309' : '#dc2626')) + '">' + n1(cumpl) + '%</b>' + (verPrecios && R.facturaProg ? ' · facturación programada ' + plata(R.facturaProg) : '') + '</div>' : '<div style="font-size:12px;color:#64748b">No había nada programado en el Gantt para esta semana.</div>';
  const piezas = {}; Object.keys(R.progPiezas).forEach(function (p) { piezas[p] = 1; }); Object.keys(R.piezas).forEach(function (p) { piezas[p] = 1; });
  const lista = Object.keys(piezas).map(function (p) { return { p: p, prog: R.progPiezas[p] || 0, ok: (R.piezas[p] || {}).ok || 0, sc: (R.piezas[p] || {}).scrap || 0 }; }).sort(function (a, b) { return (b.prog + b.ok) - (a.prog + a.ok); }).slice(0, 25);
  if (lista.length) {
    h += '<table style="width:100%;border-collapse:collapse"><tr><th ' + th + '>Pieza</th><th ' + th + ' style="text-align:right">Programado</th><th ' + th + ' style="text-align:right">Producido</th><th ' + th + ' style="text-align:right">Scrap</th><th ' + th + ' style="text-align:right">Cumpl.</th></tr>';
    lista.forEach(function (x) { const c = x.prog ? x.ok / x.prog * 100 : null; h += '<tr><td ' + td + '>' + e(x.p) + '</td><td ' + tdr + '>' + (x.prog ? n0(x.prog) : '—') + '</td><td ' + tdr + '>' + n0(x.ok) + '</td><td ' + tdr + '>' + (x.sc ? n0(x.sc) : '') + '</td><td ' + tdr + '>' + (c == null ? 'fuera de plan' : '<b style="color:' + (c >= 90 ? '#059669' : (c >= 70 ? '#b45309' : '#dc2626')) + '">' + n1(c) + '%</b>') + '</td></tr>'; });
    h += '</table>';
  }
  h += '<h3 style="font-size:14px;margin:18px 0 6px">Por máquina</h3><table style="width:100%;border-collapse:collapse"><tr><th ' + th + '>Máquina</th><th ' + th + ' style="text-align:right">Buenas</th><th ' + th + ' style="text-align:right">Scrap</th><th ' + th + ' style="text-align:right">Horas disp.</th><th ' + th + ' style="text-align:right">Paradas</th><th ' + th + ' style="text-align:right">Utilización</th><th ' + th + ' style="text-align:right">Roturas</th></tr>';
  Object.keys(R.maq).forEach(function (m) { const x = R.maq[m]; const u = x.disp ? Math.max(0, (x.disp - x.paradas) / x.disp * 100) : 0; h += '<tr><td ' + td + '><b>' + e(m) + '</b></td><td ' + tdr + '>' + n0(x.ok) + '</td><td ' + tdr + '>' + n0(x.scrap) + '</td><td ' + tdr + '>' + n1(x.disp) + ' h</td><td ' + tdr + '>' + n1(x.paradas) + ' h</td><td ' + tdr + '>' + (x.disp ? n1(u) + '%' : '—') + '</td><td ' + tdr + '>' + (x.correctivo ? n1(x.correctivo) + ' h' : '') + '</td></tr>'; });
  h += '</table>';
  const cods = Object.keys(R.codigos).map(function (k) { return [k, R.codigos[k]]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 8);
  h += '<h3 style="font-size:14px;margin:18px 0 6px">Paradas</h3><table style="width:100%;border-collapse:collapse"><tr><td style="vertical-align:top;width:50%;padding-right:8px"><table style="width:100%;border-collapse:collapse"><tr><th ' + th + '>Categoría</th><th ' + th + ' style="text-align:right">Horas</th></tr>';
  CATS_SRV.forEach(function (c) { if (R.cat[c[0]]) h += '<tr><td ' + td + '>' + c[1] + '</td><td ' + tdr + '>' + n1(R.cat[c[0]]) + ' h</td></tr>'; });
  h += '<tr><td ' + td + '><b>Total</b></td><td ' + tdr + '><b>' + n1(R.paradas) + ' h</b> ' + delta(R.paradas, P.paradas, true) + '</td></tr></table></td><td style="vertical-align:top;width:50%"><table style="width:100%;border-collapse:collapse"><tr><th ' + th + '>Principales motivos</th><th ' + th + ' style="text-align:right">Horas</th></tr>';
  cods.forEach(function (c) { h += '<tr><td ' + td + '>' + e(c[0]) + '</td><td ' + tdr + '>' + n1(c[1]) + ' h</td></tr>'; });
  if (!cods.length) h += '<tr><td ' + td + ' colspan="2" style="color:#64748b">Sin paradas con código.</td></tr>';
  h += '</table></td></tr></table>';
  const kgs = Object.keys(R.kg);
  if (kgs.length) h += '<h3 style="font-size:14px;margin:18px 0 6px">Material consumido</h3><div style="font-size:12px">' + kgs.map(function (k) { return '<b>' + e(k) + '</b>: ' + n1(R.kg[k]) + ' kg'; }).join(' · ') + '</div>';
  if (extra.stockBajo && extra.stockBajo.length) h += '<div style="margin-top:8px;font-size:12px;color:#b45309">⚠️ Stock bajo: ' + extra.stockBajo.map(e).join(' · ') + '</div>';
  h += '<h3 style="font-size:14px;margin:18px 0 6px">Órdenes y mantenimiento</h3><div style="font-size:12px;line-height:1.6">Órdenes completadas en la semana: <b>' + R.opCompletadas + '</b> · abiertas ahora: <b>' + R.opAbiertas + '</b><br>';
  h += 'Trabajos de mantenimiento: <b>' + R.trabajos.length + '</b>' + (R.trabajos.length ? ' (' + R.trabajos.slice(0, 6).map(function (t) { return e(t.maquina + ': ' + (t.tarea || t.descripcion || t.tipo)); }).join('; ') + ')' : '') + '<br>';
  if (R.preventivosVencidos.length) h += '<span style="color:#dc2626">Preventivos vencidos: ' + R.preventivosVencidos.map(function (p) { return e(p.maquina + ' · ' + p.tarea); }).join('; ') + '</span><br>';
  if (extra.fueraServicio && extra.fueraServicio.length) h += '<span style="color:#dc2626">Máquinas fuera de servicio: ' + extra.fueraServicio.map(e).join('; ') + '</span>';
  h += '</div><div style="margin-top:22px;border-top:1px solid #e2e8f0;padding-top:6px;font-size:10px;color:#94a3b8">INOFER · Informe generado automáticamente con los turnos de las Órdenes de Producción y los partes de horas cargados. La semana anterior se usa como comparación.</div></div>';
  return h;
}
function textoInforme_(R, P, verPrecios) {
  const n0 = function (v) { return Math.round(num_(v)).toLocaleString('es-AR'); };
  const n1 = function (v) { return (Math.round(num_(v) * 10) / 10).toLocaleString('es-AR'); };
  const fd = function (iso) { const p = iso.split('-'); return p[2] + '/' + p[1]; };
  const cods = Object.keys(R.codigos).map(function (k) { return [k, R.codigos[k]]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 3);
  let t = '*INOFER · Semana ' + fd(R.lunes) + ' al ' + fd(R.domingo) + '*\n';
  t += '✅ Piezas buenas: ' + n0(R.ok) + (P.ok ? ' (sem. ant. ' + n0(P.ok) + ')' : '') + '\n';
  t += '❌ Scrap: ' + n1(R.scrapPct) + '% (' + n0(R.scrap) + ' u)\n';
  t += '⚙️ Utilización: ' + n1(R.util) + '%\n';
  if (R.programado) t += '📅 Cumplimiento del Gantt: ' + n1(R.ok / R.programado * 100) + '%\n';
  if (verPrecios && R.facturado) t += '💰 Facturación producida: $ ' + n0(R.facturado) + '\n';
  t += '⏱️ Paradas: ' + n1(R.paradas) + ' h' + (cods.length ? ' · principales: ' + cods.map(function (c) { return c[0].split('-').slice(1).join('-').trim() || c[0]; }).map(function (x, i) { return x + ' ' + n1(cods[i][1]) + ' h'; }).join(', ') : '') + '\n';
  t += '📋 Órdenes completadas: ' + R.opCompletadas + ' · abiertas: ' + R.opAbiertas;
  return t;
}
function puedeVerPreciosSrv_(u) { return !!u && (u.rol === 'admin' || (puede(u, 'catalogo', 'view') && !(u.permisos && u.permisos.detalle && u.permisos.detalle.precios_ver === false))); }
function armarInforme_(u, lunes) {
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
  return { status: 'ok', semana: lunes, html: htmlInforme_(R, P, verPrecios, { generado: generado, fueraServicio: fueraServicio, stockBajo: stockBajo }), texto: textoInforme_(R, P, verPrecios), resumen: { ok: R.ok, scrapPct: R.scrapPct, util: R.util, facturado: verPrecios ? R.facturado : null, programado: R.programado } };
}
function accionInforme(u, body) {
  if (body.action !== 'informeSemanal') return null;
  if (!(u.rol === 'admin' || puede(u, 'indicadores', 'view') || puede(u, 'ordenes', 'view'))) return { status: 'error', error: 'Tu usuario no puede ver el informe.' };
  const hoy = isoDia_(new Date());
  const lunes = /^\d{4}-\d{2}-\d{2}$/.test(String(body.semana || '')) ? lunesDe_(String(body.semana)) : sumarDias_(lunesDe_(hoy), -7);
  return armarInforme_(u, lunes);
}
// Lo llama el disparador semanal de Apps Script (función inoferInformeSemanal del Código.gs)
// El disparador del informe corre cada hora y el servidor decide si toca mandar (día y hora elegidos en INOFER)
function ajustarDisparadores_() {
  try {
    const p = PropertiesService.getScriptProperties();
    const uid = p.getProperty('DISPARADOR_INFORME_UID');
    const ts = ScriptApp.getProjectTriggers();
    const inf = ts.filter(function (t) { return t.getHandlerFunction() === 'inoferInformeSemanal'; });
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
function enviarInformeSemanal(forzar) {
  ajustarDisparadores_();
  const mods = obtenerEstadoModulos();
  const cfg = mods.informes || {};
  const props = PropertiesService.getScriptProperties();
  const emails = (cfg.emails || []).filter(function (x) { return /@/.test(String(x)); });
  if (!emails.length) return 'No hay mails cargados en INOFER (Informe semanal → Enviar por mail).';
  if (cfg.activo === false && !forzar) return 'El envío por mail está desactivado.';
  const ahora = new Date(), tz = zonaHoja_();
  const h = horarioInforme_(cfg);
  if (!forzar) {
    const dow = Number(Utilities.formatDate(ahora, tz, 'u')) % 7, hora = Number(Utilities.formatDate(ahora, tz, 'H'));
    if (dow !== h.dia || hora < h.hora) return 'Todavía no es el día y la hora elegidos.';
  }
  const hoy = isoDia_(ahora);
  const lunes = sumarDias_(lunesDe_(hoy), -7);
  if (!forzar && props.getProperty('INFORME_ENVIADO_' + lunes)) return 'El informe de esa semana ya se envió.';
  const admin = { rol: 'admin', usuario: 'sistema', nombre: 'Informe automático', permisos: {} };
  const inf = armarInforme_(admin, lunes);
  const p = lunes.split('-');
  const asunto = 'INOFER · Informe semanal ' + p[2] + '/' + p[1] + '/' + p[0];
  const html = '<div style="background:#fff;padding:12px">' + inf.html + '</div>', texto = inf.texto.replace(/\*/g, '');
  const alias = String(cfg.alias || '').trim();
  let como = '';
  try {
    // Con un alias de "Enviar como" configurado en Gmail, el informe sale desde esa dirección y no desde la cuenta personal
    if (alias) {
      const al = GmailApp.getAliases();
      if (al.indexOf(alias) === -1) throw new Error('El alias ' + alias + ' no está configurado en "Enviar como" de Gmail.');
      GmailApp.sendEmail(emails.join(','), asunto, texto, { htmlBody: html, name: 'INOFER', from: alias, replyTo: alias });
      como = ' (desde ' + alias + ')';
    } else {
      MailApp.sendEmail({ to: emails.join(','), subject: asunto, htmlBody: html, body: texto, name: 'INOFER' });
    }
    props.deleteProperty('INFORME_ERROR');
  } catch (e) {
    props.setProperty('INFORME_ERROR', String(e.message || e).slice(0, 300));
    if (!alias) throw e;
    MailApp.sendEmail({ to: emails.join(','), subject: asunto, htmlBody: html, body: texto, name: 'INOFER' });
    como = ' (sin el alias: ' + e.message + ')';
  }
  props.setProperty('INFORME_ENVIADO_' + lunes, ahora.toISOString());
  props.setProperty('INFORME_ULTIMO', JSON.stringify({ fecha: ahora.toISOString(), a: emails.length, como: como }));
  auditar_(admin, 'mail', 'informes', ['Informe semanal enviado a ' + emails.join(', ') + como]);
  return 'Informe enviado a ' + emails.join(', ') + como;
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
function totalBuenas_(o) { return (o.logs || []).reduce(function (s, l) { return s + num_(l.okPcs); }, 0); }
// Turnos de las órdenes archivadas, en el mismo formato que usa el tablero
function registrosArchivados_() {
  const out = [];
  leerArchivo_(true).forEach(function (x) {
    const o = x.o; if (!o) return;
    (o.logs || []).forEach(function (l) {
      const r = { id: 'op-' + o.id + '-' + l.id, fromOrder: true, archivada: true, ordId: o.id, logId: l.id, date: String(l.date || ''), machine: o.machine, shift: l.turno || 'Turno',
        available: Math.round(horasEntre_(l.startTime, l.endTime) * 100) / 100, part: o.part, ordNumber: o.ordNumber, okPcs: num_(l.okPcs), scrapPcs: num_(l.scrapPcs), operator: l.operator || '' };
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
function accionAlmacen(u, body) {
  const A = ['almacenUso', 'archivarOrdenes', 'archivoListar', 'archivoRestaurar', 'archivoRegistros'];
  if (A.indexOf(body.action) === -1) return null;
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
    return { status: 'ok', uso: uso };
  }
  if (body.action === 'archivoListar') {
    return { status: 'ok', archivadas: leerArchivo_(true).map(function (x) { return { id: x.id, ordNumber: x.ordNumber, part: x.part, machine: x.machine, ultima: x.ultima, at: x.at, por: x.por, qty: x.o ? num_(x.o.qtyTarget) : 0, ok: x.o ? totalBuenas_(x.o) : 0, turnos: x.o ? (x.o.logs || []).length : 0 }; }).reverse() };
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const mods = obtenerEstadoModulos();
    if (body.action === 'archivarOrdenes') {
      const c = candidatasArchivo_(mods, body.meses);
      if (!c.lista.length) return { status: 'ok', archivadas: 0, corte: c.corte };
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
      return { status: 'ok', archivadas: c.lista.length, corte: c.corte };
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
  const A = ['avisarRotura', 'fotoLeer', 'roturaResolver', 'respaldoInfo'];
  if (A.indexOf(body.action) === -1) return null;
  if (body.action === 'fotoLeer') return { status: 'ok', foto: leerFoto_(body.id) };
  if (body.action === 'respaldoInfo') {
    if (u.rol !== 'admin') return { status: 'error', error: 'Solo el administrador.' };
    const p = PropertiesService.getScriptProperties();
    return { status: 'ok', ultimo: p.getProperty('RESPALDO_ULTIMO') || '', lista: jsonSeguro_(p.getProperty('RESPALDOS'), []), error: p.getProperty('RESPALDO_ERROR') || '', informe: jsonSeguro_(p.getProperty('INFORME_ULTIMO'), null), informeError: p.getProperty('INFORME_ERROR') || '', horario: !!p.getProperty('DISPARADOR_INFORME_UID') };
  }
  if (!(u.rol === 'admin' || puede(u, 'ordenes', 'edit') || puede(u, 'gantt', 'edit'))) return { status: 'error', error: 'Tu usuario no puede avisar roturas.' };
  if (body.action === 'roturaResolver' && !puedeMantSrv_(u)) return { status: 'error', error: 'Tu usuario no puede cerrar roturas.' };
  const fotoId = body.action === 'avisarRotura' && body.foto ? guardarFoto_(u, body.foto) : '';
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
      const r = { id: idNuevo_('rot'), maquina: m, fecha: fecha, hora: hora, motivo: motivo, descripcion: desc, fotoId: fotoId, paro: body.parada !== false, por: etiquetaUsuario_(u), estado: 'abierta', avisadaAt: ahora.toISOString() };
      mant.roturas.push(r);
      guardarModuloSinLock_('mantenimiento', mant);
      if (r.paro) {
        setup.maquinas[m] = Object.assign({}, setup.maquinas[m] || {}, { activa: false, motivo: 'Rotura: ' + motivo, desde: '', hasta: '' });
        guardarModuloSinLock_('setup', setup);
      }
      try {
        const id = idNuevo_('sol'), f = ahora.toISOString();
        escribirSolicitud_({ id: id, autor: u.usuario, nombre: u.nombre || u.usuario, tipo: 'rotura', titulo: '🔧 Rotura en la ' + m + ': ' + motivo, detalle: (desc ? desc + ' · ' : '') + (r.paro ? 'La máquina quedó PARADA.' : 'La máquina sigue andando.') + (fotoId ? ' (con foto, ver en Mantenimiento)' : ''), estado: 'pendiente', respuesta: '', respondidoPor: '', fecha: f, actualizado: f, vistoAdmin: false, vistoAutor: true });
      } catch (e) {}
      auditar_(u, 'avisó', 'mantenimiento', ['Rotura en la ' + m + ': ' + motivo + (r.paro ? ' (máquina parada)' : '') + (fotoId ? ' · con foto' : '')]);
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
  const paq = paqueteDatos(u, null); paq.versiones = versiones_();
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
function fusionarMant_(stored, incoming, base) {
  const S = stored || {}, I = incoming || {}, B = base || {};
  const out = Object.assign({}, S, I);
  ['planes', 'trabajos', 'roturas'].forEach(function (k) {
    if (!Array.isArray(S[k]) && !Array.isArray(I[k])) return;
    out[k] = fusionarLista_('x', S[k] || [], I[k] || [], B[k] || {}).datos;
  });
  return { datos: out, conflictos: 0 };
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
          if (fusion) body.moduleData = fusion.datos;
        } catch (e) { fusion = null; }
      }
      if (!igual_(anterior, body.moduleData)) {
        try { registrarDiferencias(u, body.moduleKey, anterior, body.moduleData); } catch (e) {}
        try { auditar_(u, 'modificó', body.moduleKey, resumenCambio_(body.moduleKey, anterior, body.moduleData)); } catch (e) {}
        guardarModuloSinLock_(body.moduleKey, body.moduleData);
      }
    } finally { lockM.releaseLock(); }
    const paqM = paqueteDatos(u, records);
    paqM.versiones = versiones_();
    if (fusion) paqM.fusion = { modulo: body.moduleKey, conflictos: fusion.conflictos || 0, deOtros: fusion.deOtros || 0 };
    return respuesta(paqM);
  }
  return respuesta(paqueteDatos(u, records));
}
