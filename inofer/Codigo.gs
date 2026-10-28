/**
 * INOFER — CARGADOR DEL SERVIDOR (Google Apps Script)
 * ----------------------------------------------------
 * Este archivo se pega UNA SOLA VEZ en Apps Script y no hace falta volver a tocarlo.
 * La lógica del servidor (usuarios, permisos, partes, órdenes, Gantt...) se descarga sola
 * desde la app publicada en GitHub, así que cada mejora se aplica automáticamente.
 * Si GitHub no responde, se usa la última versión guardada en la hoja "BD_Servidor".
 * Para autorizar o probar: elegí "doGet" en el menú de funciones y tocá Ejecutar.
 */
const INOFER_SERVIDOR_URLS = [
  'https://raw.githubusercontent.com/Inofer-admin/INOFER/main/inofer/servidor.js',
  'https://inofer-admin.github.io/INOFER/inofer/servidor.js'
];
const INOFER_CACHE_SEGUNDOS = 120;

function inoferServidor_() {
  if (globalThis.__inoferSrv) return globalThis.__inoferSrv;
  const cache = CacheService.getScriptCache();
  let code = cache.get('inofer_srv');
  const errores = [];
  if (!code) {
    for (let i = 0; i < INOFER_SERVIDOR_URLS.length && !code; i++) {
      try {
        const r = UrlFetchApp.fetch(INOFER_SERVIDOR_URLS[i] + '?t=' + Date.now(), { muteHttpExceptions: true, followRedirects: true });
        const txt = r.getResponseCode() === 200 ? r.getContentText() : '';
        if (txt.indexOf('INOFER_SERVIDOR_OK') !== -1) code = txt;
        else errores.push(INOFER_SERVIDOR_URLS[i] + ' -> HTTP ' + r.getResponseCode());
      } catch (e) {
        errores.push(INOFER_SERVIDOR_URLS[i] + ' -> ' + e.message);
      }
    }
    if (code) {
      try { cache.put('inofer_srv', code, INOFER_CACHE_SEGUNDOS); } catch (e) {}
      inoferGuardarCopia_(code);
    } else {
      code = inoferLeerCopia_();
    }
  }
  if (!code) throw new Error('No se pudo cargar el servidor de INOFER. Detalle: ' + errores.join(' | '));
  globalThis.__inoferSrv = new Function(code)();
  return globalThis.__inoferSrv;
}

function inoferHojaCopia_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName('BD_Servidor') || ss.insertSheet('BD_Servidor');
}
function inoferGuardarCopia_(code) {
  try {
    const sh = inoferHojaCopia_();
    const partes = [];
    for (let i = 0; i < code.length; i += 45000) partes.push(code.substring(i, i + 45000));
    const actual = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].join('');
    if (actual === code) return;
    sh.clearContents();
    sh.getRange(1, 1, 1, partes.length).setNumberFormat('@').setValues([partes]);
  } catch (e) {}
}
function inoferLeerCopia_() {
  try {
    const sh = inoferHojaCopia_();
    if (sh.getLastColumn() < 1) return '';
    return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].join('');
  } catch (e) { return ''; }
}

function doGet(e) { return inoferServidor_().doGet(e); }
function doPost(e) { return inoferServidor_().doPost(e); }

/**
 * EMERGENCIA: si te olvidás la clave del administrador, elegí esta función en el menú
 * de arriba y tocá "Ejecutar". La clave del primer administrador pasa a ser: inofer1234
 */
function restablecerClaveAdmin() { return inoferServidor_().restablecerClaveAdmin(); }
