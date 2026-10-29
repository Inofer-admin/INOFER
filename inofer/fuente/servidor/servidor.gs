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
  try {
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
    return { status: 'ok' };
  } finally {
    lock.releaseLock();
  }
}

function obtenerRegistros() {
  const sheet = getDbSheet();
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return [];
  const list = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0]) continue;
    list.unshift({
      id: String(r[0]),
      date: fechaTexto_(r[1]),
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
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getDbSheet();
    const ahora = new Date().toISOString();
    sheet.appendRow([
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
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  let found = false;
  try {
    const sheet = getDbSheet();
    const rows = sheet.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === String(entry.id)) {
        sheet.getRange(i + 1, 1, 1, 18).setValues([[
          entry.id, fechaTexto_(entry.date), entry.machine, entry.shift,
          Number(entry.available) || 0, Number(entry.parada_maquina) || 0,
          Number(entry.setup_molde) || 0, Number(entry.puesta_punto) || 0,
          Number(entry.mant_preventivo) || 0, Number(entry.mant_correctivo) || 0,
          Number(entry.falta_material) || 0, Number(entry.falta_operario) || 0,
          Number(entry.otros) || 0, new Date().toISOString(),
          String(rows[i][14] || entry.cargadoPor || ''), USUARIO_ACTUAL || entry.modificadoPor || '', String(rows[i][16] || ''), paradasJson_(entry)
        ]]);
        found = true;
        break;
      }
    }
    if (!found) {
      const ahora = new Date().toISOString();
      sheet.appendRow([
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
      sheet.appendRow([
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

const MODULO_AREA = { orders: 'ordenes', gantt: 'gantt', catalog: 'catalogo', weekly: 'partes', memory: 'ia', config: 'admin', pistones: 'gantt', kpis: 'indicadores', turnos: 'admin', setup: 'gantt', presentacion: 'admin' };

function modulosVisibles(u) {
  const all = obtenerEstadoModulos();
  const out = {};
  Object.keys(all).forEach(function (k) {
    if (k === 'users') return; // nunca se envía la lista de usuarios por acá
    const area = MODULO_AREA[k];
    if (!area) return;
    if (k === 'turnos' || k === 'presentacion' || (area === 'admin' ? (k === 'config' && puede(u, 'ia', 'view')) : puede(u, area, 'view'))) out[k] = all[k];
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
      escribirUsuario(u);
      return { status: 'ok', users: leerUsuarios().map(publico) };
    }
    if (body.action === 'deleteUser') {
      const usuario = String(body.usuario || '').toLowerCase();
      if (usuario === yo.usuario) return { status: 'error', error: 'No podés borrar tu propio usuario.' };
      const ex = usuarios.filter(function (x) { return x.usuario === usuario; })[0];
      if (ex) getUsersSheet().deleteRow(ex.fila);
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
  if (p.action === 'json') {
    const u = usuarioDeToken(p.token);
    if (!u) return respuesta({ status: 'error', error: 'auth', authRequired: true });
    return respuesta(paqueteDatos(u));
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
const ACCIONES_MSG = ['msgEstado', 'msgLeer', 'msgEnviar', 'msgCrearChat', 'msgBorrarChat', 'msgBorrarMensaje', 'msgEditarGrupo',
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
function directorio_() {
  return leerUsuarios().filter(function (x) { return x.activo; }).map(function (x) { return { usuario: x.usuario, nombre: x.nombre, rol: x.rol }; });
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
      if (!c || c.miembros.indexOf(yo) === -1) return { status: 'error', error: 'Chat inexistente.' };
      hojaMensajes_().deleteRow(m.fila);
      return { status: 'ok' };
    }

    if (body.action === 'msgBorrarChat') {
      const c = chatDe(body.chatId);
      if (!c || c.miembros.indexOf(yo) === -1) return { status: 'ok' };
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

  if (['listPapelera', 'restaurarPapelera', 'vaciarPapelera'].indexOf(body.action) !== -1) {
    return respuesta(accionPapelera(u, body) || { status: 'error', error: 'Acción desconocida' });
  }

  USUARIO_ACTUAL = u.nombre ? (u.nombre + ' (@' + u.usuario + ')') : u.usuario;
  let records = null;
  const sinPermiso = function (area) { return respuesta({ status: 'error', error: 'permiso', area: area, auth: publico(u) }); };
  if (['add', 'edit', 'delete', 'replace'].indexOf(body.action) !== -1) {
    if (!puede(u, 'partes', 'edit')) return sinPermiso('partes');
    if (body.action === 'add') records = guardarRegistro(body.entry);
    else if (body.action === 'edit') records = editarRegistro(body.entry);
    else if (body.action === 'delete') {
      try { registrarEliminados(u, 'parte', obtenerRegistros().filter(function (r) { return String(r.id) === String(body.id); }), {}); } catch (e) {}
      records = eliminarRegistro(body.id);
    } else {
      try {
        const nuevos = idsDe(body.records);
        registrarEliminados(u, 'parte', obtenerRegistros().filter(function (r) { return !nuevos[String(r.id)]; }), {});
      } catch (e) {}
      records = reemplazarRegistros(body.records);
    }
  } else if (body.action === 'saveModule') {
    const area = MODULO_AREA[body.moduleKey];
    if (!area || body.moduleKey === 'users') return sinPermiso('desconocida');
    const ok = area === 'admin' ? u.rol === 'admin' : puede(u, area, 'edit');
    if (!ok) return sinPermiso(area);
    try { registrarDiferencias(u, body.moduleKey, obtenerEstadoModulos()[body.moduleKey], body.moduleData); } catch (e) {}
    guardarModuloEstado(body.moduleKey, body.moduleData);
  }
  return respuesta(paqueteDatos(u, records));
}
