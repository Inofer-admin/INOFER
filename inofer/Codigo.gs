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

function doGet(e) {
  if (e && e.parameter && e.parameter.action === 'json') {
    const full = obtenerTodoElSistema();
    return ContentService.createTextOutput(JSON.stringify({ status: 'ok', records: full.records, modules: full.modules }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Tablero de Mando - Inyectoras (En Vivo)')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  const body = JSON.parse(e.postData.contents || '{}');
  let records = [];
  if (body.action === 'add') {
    records = guardarRegistro(body.entry);
  } else if (body.action === 'edit') {
    records = editarRegistro(body.entry);
  } else if (body.action === 'delete') {
    records = eliminarRegistro(body.id);
  } else if (body.action === 'replace') {
    records = reemplazarRegistros(body.records);
  } else if (body.action === 'saveModule') {
    guardarModuloEstado(body.moduleKey, body.moduleData);
    records = obtenerRegistros();
  } else {
    records = obtenerRegistros();
  }
  return ContentService.createTextOutput(JSON.stringify({ status: 'ok', records: records, modules: obtenerEstadoModulos() }))
    .setMimeType(ContentService.MimeType.JSON);
}