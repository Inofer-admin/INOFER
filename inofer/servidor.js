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
      'falta_operario', 'otros', 'updated_at', 'cargado_por', 'modificado_por', 'cargado_at'
    ]);
  }
  if (String(sheet.getRange(1, 15).getValue ? sheet.getRange(1, 15).getValue() : 'cargado_por') !== 'cargado_por') {
    sheet.getRange(1, 15, 1, 3).setValues([['cargado_por', 'modificado_por', 'cargado_at']]);
  }
  return sheet;
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
      otros: Number(r[12]) || 0,
      actualizado: r[13] instanceof Date ? r[13].toISOString() : String(r[13] || ''),
      cargadoPor: String(r[14] || ''),
      modificadoPor: String(r[15] || ''),
      cargadoAt: String(r[16] || '')
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
    const ahora = new Date().toISOString();
    sheet.appendRow([
      entry.id || ('rec-' + new Date().getTime()),
      entry.date, entry.machine, entry.shift,
      Number(entry.available) || 0, Number(entry.parada_maquina) || 0,
      Number(entry.setup_molde) || 0, Number(entry.puesta_punto) || 0,
      Number(entry.mant_preventivo) || 0, Number(entry.mant_correctivo) || 0,
      Number(entry.falta_material) || 0, Number(entry.falta_operario) || 0,
      Number(entry.otros) || 0, ahora, USUARIO_ACTUAL || entry.cargadoPor || '', '', ahora
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
        sheet.getRange(i + 1, 1, 1, 17).setValues([[
          entry.id, entry.date, entry.machine, entry.shift,
          Number(entry.available) || 0, Number(entry.parada_maquina) || 0,
          Number(entry.setup_molde) || 0, Number(entry.puesta_punto) || 0,
          Number(entry.mant_preventivo) || 0, Number(entry.mant_correctivo) || 0,
          Number(entry.falta_material) || 0, Number(entry.falta_operario) || 0,
          Number(entry.otros) || 0, new Date().toISOString(),
          String(rows[i][14] || entry.cargadoPor || ''), USUARIO_ACTUAL || entry.modificadoPor || '', String(rows[i][16] || '')
        ]]);
        found = true;
        break;
      }
    }
    if (!found) {
      const ahora = new Date().toISOString();
      sheet.appendRow([
        entry.id, entry.date, entry.machine, entry.shift,
        Number(entry.available) || 0, Number(entry.parada_maquina) || 0,
        Number(entry.setup_molde) || 0, Number(entry.puesta_punto) || 0,
        Number(entry.mant_preventivo) || 0, Number(entry.mant_correctivo) || 0,
        Number(entry.falta_material) || 0, Number(entry.falta_operario) || 0,
        Number(entry.otros) || 0, ahora, entry.cargadoPor || USUARIO_ACTUAL || '', USUARIO_ACTUAL || '', ahora
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
      'falta_operario', 'otros', 'updated_at', 'cargado_por', 'modificado_por', 'cargado_at'
    ]);
    (entries || []).slice().reverse().forEach(entry => {
      sheet.appendRow([
        entry.id || ('rec-' + new Date().getTime()),
        entry.date, entry.machine, entry.shift,
        Number(entry.available) || 0, Number(entry.parada_maquina) || 0,
        Number(entry.setup_molde) || 0, Number(entry.puesta_punto) || 0,
        Number(entry.mant_preventivo) || 0, Number(entry.mant_correctivo) || 0,
        Number(entry.falta_material) || 0, Number(entry.falta_operario) || 0,
        Number(entry.otros) || 0, entry.actualizado || new Date().toISOString(),
        entry.cargadoPor || USUARIO_ACTUAL || '', entry.modificadoPor || '', entry.cargadoAt || ''
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

const MODULO_AREA = { orders: 'ordenes', gantt: 'gantt', catalog: 'catalogo', weekly: 'partes', memory: 'ia', config: 'admin', pistones: 'gantt', kpis: 'indicadores' };

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

function doPost(e) {
  const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  const cuenta = accionCuenta(body);
  if (cuenta) return respuesta(cuenta);

  const u = usuarioDeToken(body.token);
  if (!u) return respuesta({ status: 'error', error: 'auth', authRequired: true });

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

return { doGet: doGet, doPost: doPost, restablecerClaveAdmin: restablecerClaveAdmin };
