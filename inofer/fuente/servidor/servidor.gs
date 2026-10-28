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
      'falta_operario', 'otros', 'updated_at'
    ]);
  }
  return sheet;
}

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
      date: r[1] instanceof Date ? Utilities.formatDate(r[1], Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(r[1]),
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
      otros: Number(r[12]) || 0
    });
  }
  return list;
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
    sheet.appendRow([
      entry.id || ('rec-' + new Date().getTime()),
      entry.date, entry.machine, entry.shift,
      Number(entry.available) || 0, Number(entry.parada_maquina) || 0,
      Number(entry.setup_molde) || 0, Number(entry.puesta_punto) || 0,
      Number(entry.mant_preventivo) || 0, Number(entry.mant_correctivo) || 0,
      Number(entry.falta_material) || 0, Number(entry.falta_operario) || 0,
      Number(entry.otros) || 0, new Date().toISOString()
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
        sheet.getRange(i + 1, 1, 1, 14).setValues([[
          entry.id, entry.date, entry.machine, entry.shift,
          Number(entry.available) || 0, Number(entry.parada_maquina) || 0,
          Number(entry.setup_molde) || 0, Number(entry.puesta_punto) || 0,
          Number(entry.mant_preventivo) || 0, Number(entry.mant_correctivo) || 0,
          Number(entry.falta_material) || 0, Number(entry.falta_operario) || 0,
          Number(entry.otros) || 0, new Date().toISOString()
        ]]);
        found = true;
        break;
      }
    }
    if (!found) {
      sheet.appendRow([
        entry.id, entry.date, entry.machine, entry.shift,
        Number(entry.available) || 0, Number(entry.parada_maquina) || 0,
        Number(entry.setup_molde) || 0, Number(entry.puesta_punto) || 0,
        Number(entry.mant_preventivo) || 0, Number(entry.mant_correctivo) || 0,
        Number(entry.falta_material) || 0, Number(entry.falta_operario) || 0,
        Number(entry.otros) || 0, new Date().toISOString()
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
      'falta_operario', 'otros', 'updated_at'
    ]);
    (entries || []).slice().reverse().forEach(entry => {
      sheet.appendRow([
        entry.id || ('rec-' + new Date().getTime()),
        entry.date, entry.machine, entry.shift,
        Number(entry.available) || 0, Number(entry.parada_maquina) || 0,
        Number(entry.setup_molde) || 0, Number(entry.puesta_punto) || 0,
        Number(entry.mant_preventivo) || 0, Number(entry.mant_correctivo) || 0,
        Number(entry.falta_material) || 0, Number(entry.falta_operario) || 0,
        Number(entry.otros) || 0, new Date().toISOString()
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
const AREAS = ['partes', 'ordenes', 'catalogo', 'gantt', 'ia'];
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

const MODULO_AREA = { orders: 'ordenes', gantt: 'gantt', catalog: 'catalogo', weekly: 'partes', memory: 'ia', config: 'admin' };

function modulosVisibles(u) {
  const all = obtenerEstadoModulos();
  const out = {};
  Object.keys(all).forEach(function (k) {
    if (k === 'users') return; // nunca se envía la lista de usuarios por acá
    const area = MODULO_AREA[k];
    if (!area) return;
    if (area === 'admin' ? (k === 'config' && puede(u, 'ia', 'view')) : puede(u, area, 'view')) out[k] = all[k];
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

function doPost(e) {
  const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  const cuenta = accionCuenta(body);
  if (cuenta) return respuesta(cuenta);

  const u = usuarioDeToken(body.token);
  if (!u) return respuesta({ status: 'error', error: 'auth', authRequired: true });

  let records = null;
  const sinPermiso = function (area) { return respuesta({ status: 'error', error: 'permiso', area: area, auth: publico(u) }); };
  if (['add', 'edit', 'delete', 'replace'].indexOf(body.action) !== -1) {
    if (!puede(u, 'partes', 'edit')) return sinPermiso('partes');
    if (body.action === 'add') records = guardarRegistro(body.entry);
    else if (body.action === 'edit') records = editarRegistro(body.entry);
    else if (body.action === 'delete') records = eliminarRegistro(body.id);
    else records = reemplazarRegistros(body.records);
  } else if (body.action === 'saveModule') {
    const area = MODULO_AREA[body.moduleKey];
    if (!area || body.moduleKey === 'users') return sinPermiso('desconocida');
    const ok = area === 'admin' ? u.rol === 'admin' : puede(u, area, 'edit');
    if (!ok) return sinPermiso(area);
    guardarModuloEstado(body.moduleKey, body.moduleData);
  }
  return respuesta(paqueteDatos(u, records));
}
