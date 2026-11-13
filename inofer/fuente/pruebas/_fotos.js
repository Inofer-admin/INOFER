// Red de seguridad de INOFER: pruebas automáticas que corren antes de cada publicación.
// Levanta una nube simulada (el Código.gs real + servidor.js con servicios de Google falsos) y abre la app en Chromium.
// Uso: node fuente/pruebas/suite.js   (sale con código 1 si algo falla)
const fs = require('fs'), path = require('path'), http = require('http'), { spawn } = require('child_process');
const { chromium } = require('playwright');
const RAIZ = '/home/claude/inofer/inofer';           // carpeta inofer/
const FUENTE = path.join(RAIZ, 'fuente');
const PUERTO_NUBE = 18900 + Math.floor(Math.random() * 500), PUERTO_WEB = PUERTO_NUBE + 600;
const NUBE = `http://127.0.0.1:${PUERTO_NUBE}/exec`;
const resultados = [];
const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'inofer-pruebas-'));
fs.writeFileSync(path.join(tmp, 'servidor.js'), fs.readFileSync(path.join(FUENTE, 'servidor', 'servidor.gs'), 'utf8') + '\nreturn { doGet: doGet, doPost: doPost, restablecerClaveAdmin: restablecerClaveAdmin, enviarInformeSemanal: enviarInformeSemanal, copiaDeSeguridad: copiaDeSeguridad, revisarAvisosPush_: revisarAvisosPush_ };\n');
const html = fs.readFileSync(path.join(FUENTE, 'res', 'web', 'index.html'), 'utf8');

function web() {
  return http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    if (u === '/' || u === '/index.html') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); return; }
    const f = path.join(FUENTE, 'res', 'web', u.replace(/\.\./g, ''));
    if (fs.existsSync(f) && fs.statSync(f).isFile()) { res.end(fs.readFileSync(f)); return; }
    res.statusCode = 404; res.end('');
  }).listen(PUERTO_WEB);
}
async function prueba(nombre, fn) {
  const t0 = Date.now();
  try { await fn(); resultados.push({ nombre, ok: true, ms: Date.now() - t0 }); console.log('  ✓ ' + nombre); }
  catch (e) { resultados.push({ nombre, ok: false, error: e.message }); console.log('  ✗ ' + nombre + ' → ' + e.message); }
}
const ok = (c, m) => { if (!c) throw new Error(m); };
let SIN_NUBE = false;
async function equipo(b, vp) {
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: vp || { width: 1366, height: 900 } });
  const p = await ctx.newPage();
  p._errs = []; p.on('pageerror', e => p._errs.push(e.message)); p.on('dialog', d => d.accept(p._respuesta || ''));
  await p.route(/fonts\.g|xlsx\.full/, r => r.fulfill({ body: '', contentType: 'text/css' }));
  await p.route(/cdn\.|jsdelivr|unpkg|cdnjs/, r => r.abort());
  await p.route(/script\.google\.com/, async r => {
    if (SIN_NUBE) { try { await r.abort('internetdisconnected'); } catch (e) { } return; }
    try { const u = new URL(r.request().url()); const resp = await r.fetch({ url: NUBE + u.search }); await r.fulfill({ response: resp, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' } }); } catch (e) { try { await r.abort(); } catch (er) { } }
  });
  await p.goto(`http://127.0.0.1:${PUERTO_WEB}/index.html`); await p.waitForTimeout(1500);
  return p;
}
async function ingresar(p, u, c) {
  await p.evaluate(([u, c]) => { document.getElementById('inoferInstallSkip')?.click(); document.getElementById('inoferSetupName').value = 'Admin'; document.getElementById('inoferLoginUser').value = u; document.getElementById('inoferLoginPass').value = c; const s2 = document.getElementById('inoferSetupPass2'); if (s2) s2.value = c; document.getElementById('inoferLoginBtn').click(); }, [u, c]);
  await p.waitForTimeout(3500);
  ok(await p.evaluate(() => !!(window.inoferSession || (typeof inoferSession !== 'undefined' && inoferSession))), 'no pudo iniciar sesión ' + u);
}
const nube = p => p.evaluate(async () => (await (await fetch(cloudApiUrl + '?action=json&t=' + Date.now() + inoferTokenParam())).json()));

(async () => {
  const srv = spawn(process.execPath, [path.join(FUENTE,'pruebas','nube_simulada.js'), path.join(RAIZ, 'Codigo.gs'), String(PUERTO_NUBE)], { env: Object.assign({}, process.env, { SRV_FILE: path.join(tmp, 'servidor.js') }), stdio: 'ignore' });
  const w = web();
  await new Promise(r => setTimeout(r, 1200));
  const b = await chromium.launch();
  let A, B;
  try {


    const OUT = '/home/claude/instructivo/img/';
    const marcar = async (p, L) => p.evaluate(L => {
      document.querySelectorAll('.zz-marca').forEach(x => x.remove());
      L.forEach(([sel, n, idx]) => {
        let els;
        if (sel.startsWith('txt:')) { const [t, q] = sel.slice(4).split('@'); els = [...document.querySelectorAll(q || 'button,label,a,summary')].filter(e => e.textContent.includes(t) && e.getClientRects().length).sort((a, b) => a.textContent.length - b.textContent.length); }
        else els = [...document.querySelectorAll(sel)].filter(e => e.offsetParent !== null || e.getClientRects().length);
        const el = els[idx || 0]; if (!el) { console.log('NO ' + sel); return; }
        const r = el.getBoundingClientRect();
        const box = document.createElement('div'); box.className = 'zz-marca';
        box.style.cssText = `position:fixed;left:${r.left - 4}px;top:${r.top - 4}px;width:${r.width + 8}px;height:${r.height + 8}px;border:3px solid #ff2d55;border-radius:10px;z-index:2147483646;pointer-events:none;box-shadow:0 0 0 2px rgba(255,255,255,.6)`;
        const c = document.createElement('div'); c.className = 'zz-marca'; c.textContent = n;
        const x = Math.max(4, r.left - 16), y = Math.max(4, r.top - 16);
        c.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:30px;height:30px;border-radius:50%;background:#ff2d55;color:#fff;font:900 17px Arial;display:flex;align-items:center;justify-content:center;z-index:2147483647;box-shadow:0 2px 6px rgba(0,0,0,.5);border:2px solid #fff`;
        document.body.appendChild(box); document.body.appendChild(c);
      });
    }, L);
    const foto = async (p, nombre, L) => { if (L) await marcar(p, L); await p.waitForTimeout(250); await p.screenshot({ path: OUT + nombre + '.png' }); await p.evaluate(() => document.querySelectorAll('.zz-marca').forEach(x => x.remove())); console.log('foto', nombre); };
    const ev = (p, f, a) => p.evaluate(f, a);
    // ---- login
    A = await equipo(b, { width: 1280, height: 800 });
    await foto(A, '00_login');
    await ingresar(A, 'admin', 'abcd12');
    // ---- datos de prueba
    await ev(A, async () => {
      const w = ms => new Promise(r => setTimeout(r, ms));
      partsCatalog = [
        { id: 'c1', part: '10101', desc: 'SOPORTE MOTOR', mold: '10101', cavities: 1, unitsPerHour: 90, machines: ['200V', '200N'], machine: SHORT_TO_FULL_MACHINE['200V'], material: 'ALSI', weightWithSprueKg: 0.176, weightOkGrs: 68.2, pistonMm: 55, embalaje: 120 },
        { id: 'c2', part: '10202', desc: 'TAPA LATERAL', mold: '10202', cavities: 2, unitsPerHour: 140, machines: ['200N'], machine: SHORT_TO_FULL_MACHINE['200N'], material: 'ALSI', weightWithSprueKg: 0.22, weightOkGrs: 113.2, pistonMm: 50, embalaje: 80 },
        { id: 'c3', part: '20303', desc: 'MANIJA', mold: '20303', cavities: 1, unitsPerHour: 200, machines: ['Z30'], machine: SHORT_TO_FULL_MACHINE['Z30'], material: 'ZAMAC', weightWithSprueKg: 0.13, weightOkGrs: 92.4, embalaje: 200 }];
      savePartsCatalog();
      const nom = id => (GANTT_MACHINES_CONFIG.find(x => x.id === id) || {}).name || id;
      const d0 = new Date(), f = d0.getFullYear() + '-' + String(d0.getMonth() + 1).padStart(2, '0') + '-' + String(d0.getDate()).padStart(2, '0');
      const ay = new Date(Date.now() - 86400000), fa = ay.getFullYear() + '-' + String(ay.getMonth() + 1).padStart(2, '0') + '-' + String(ay.getDate()).padStart(2, '0');
      productionOrders.push(
        { id: 'o1', ordNumber: '5101', part: '10101', machine: nom('200V'), qtyTarget: 3000, unitsPerHour: 90, status: 'En Proceso', weightWithSprueKg: 0.176, material: 'ALSI', logs: [{ id: 'l1', date: fa, turno: 'Mañana', startTime: '06:00', endTime: '14:00', okPcs: 640, scrapPcs: 12, lowStartPcs: 5, operator: 'Juan' }, { id: 'l2', date: fa, turno: 'Tarde', startTime: '14:00', endTime: '22:00', okPcs: 610, scrapPcs: 9, operator: 'Pedro' }] },
        { id: 'o2', ordNumber: '5102', part: '10202', machine: nom('200N'), qtyTarget: 2000, unitsPerHour: 140, status: 'En Proceso', weightWithSprueKg: 0.22, material: 'ALSI', logs: [{ id: 'l3', date: fa, turno: 'Mañana', startTime: '06:00', endTime: '14:00', okPcs: 980, scrapPcs: 20, operator: 'Luis' }] },
        { id: 'o3', ordNumber: '5103', part: '20303', machine: nom('Z30'), qtyTarget: 4000, unitsPerHour: 200, status: 'En Proceso', weightWithSprueKg: 0.13, material: 'ZAMAC', logs: [{ id: 'l4', date: fa, turno: 'Mañana', startTime: '06:00', endTime: '14:00', okPcs: 1450, scrapPcs: 30, operator: 'Ana' }] });
      saveProductionOrders(); inoferPonerOp('200V', 'o1'); inoferPonerOp('200N', 'o2'); inoferPonerOp('Z30', 'o3'); await w(300);
      // un control de calidad anterior (para que los parámetros vengan cargados)
      const Q = inoferCalidad.datos();
      Q.liberaciones.push({ id: 'x0', maq: '200N', pieza: '10202', ordId: 'o2', op: '5102', tipo: 'primera', fecha: f, hora: '06:30', at: new Date(Date.now() - 3 * 3600000).toISOString(), por: 'Luis', res: 'liberada', v: [['h-colada', 219.8, true], ['h-neto', 113.6, true], ['h-pulm', 13.1, true], ['h-temp', 701, true], ['h-taco', 20.6, true], ['h-muestras', 5, true]], par: { v1: 30, v2: 80, vm: 60, cpm: 40, pm: 250, c2: 120, cm: 10, sol: 6, pis: 50, ciclo: 45 } });
      inoferCalidad.guardar();
    });
    // ---- Mi máquina (tablet)
    await A.setViewportSize({ width: 810, height: 1080 });
    await ev(A, async () => { localStorage.setItem('tablero_inyectoras_mimaquina_v1', '200V'); switchTab('mimaq'); await new Promise(r => setTimeout(r, 800)); });
    await foto(A, '01_mimaquina', [['#mmOp', 1], ['#calMmBtn', 2], ['#mmCargar', 3], ['#mmRotura', 4]]);
    const crono = await ev(A, () => { const b = [...document.querySelectorAll('#viewMiMaq button')].find(x => /PARÓ/.test(x.textContent)); if (b) { b.id = 'zzCrono'; return true; } return false; });
    if (crono) await foto(A, '01b_mimaquina_crono', [['#zzCrono', 1]]);
    // ---- Carga rápida
    await A.setViewportSize({ width: 810, height: 1700 });
    await ev(A, async () => { inoferCargaRapida.abrir({ maq: '200V', ordId: 'o1' }); await new Promise(r => setTimeout(r, 800)); const d = document.getElementById('crMas'); if (d) d.open = true; const b = document.getElementById('mmVolver'); if (b) b.style.display = 'none'; const t = document.getElementById('inoferCR'); if (t) t.scrollIntoView(); const fm = [...document.querySelectorAll('#inoferCR button')].find(x => /Falta de material/.test(x.textContent)); if (fm) fm.parentElement.id = 'zzParadas'; });
    await foto(A, '02_carga_rapida', [['txt:Mañana', 1], ['#crOk', 2], ['#zzParadas', 3], ['#crMas', 4], ['#crOperario', 5], ['txt:Guardar turno', 6]]);
    // ---- desktop
    await A.setViewportSize({ width: 1280, height: 860 });
    await ev(A, async () => { localStorage.removeItem('tablero_inyectoras_mimaquina_v1'); switchTab('orders'); await new Promise(r => setTimeout(r, 600)); });
    await foto(A, '02b_ordenes', [['txt:Carga rápida@#ordNav button', 1], ['txt:Órdenes@#ordNav button', 2], ['txt:Del Gantt', 3]]);
    // cierre de turno
    await ev(A, async () => { inoferCierreTurno(); await new Promise(r => setTimeout(r, 800)); });
    await foto(A, '03_cierre_turno', [['#ctModal input[type="date"]', 1], ['#ctModal select', 2], ['txt:No trabajó', 3], ['txt:cambió de pieza', 4], ['txt:Guardar 3', 5]]);
    await ev(A, () => { const m = document.getElementById('ctModal'); if (m) m.remove(); });
    // ---- Calidad
    await A.setViewportSize({ width: 810, height: 1080 });
    await ev(A, async () => { inoferCalidad.abrirLiberacion({ maq: '200N' }); await new Promise(r => setTimeout(r, 400));
      const put = (s, v) => { const el = document.querySelector(s); if (!el) return; el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
      put('[data-lb-num="h-colada"]', '235,5'); put('[data-lb-num="h-neto"]', '114,7'); put('[data-lb-num="h-pulm"]', '13,2'); put('[data-lb-num="h-temp"]', '697'); });
    await foto(A, '04_calidad_liberacion', [['[data-lb-mot]', 1], ['[data-lb-num="h-neto"]', 2], ['#calLbE_h-neto', 3]]);
    await ev(A, async () => { const put = (s, v) => { const el = document.querySelector(s); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }; put('[data-lb-num="h-taco"]', '24,6'); put('[data-lb-num="h-muestras"]', '5'); put('[data-lb-par="pm"]', '260'); document.getElementById('calLib').scrollTo(0, 99999); });
    await foto(A, '04b_calidad_parametros', [['[data-lb-par="pm"]', 1], ['[data-lb="retener"]', 2], ['#calLbLiberar', 3]]);
    await ev(A, () => document.querySelector('[data-lb="cerrar"]').click());
    await A.setViewportSize({ width: 1280, height: 860 });
    await ev(A, async () => { inoferCalidad.estado().sub = 'tablero'; switchTab('calidad'); await new Promise(r => setTimeout(r, 600)); });
    await foto(A, '04c_calidad_tablero', [['[data-cal="liberar"]', 1], ['#calHoy', 2], ['[data-cal="hojasDesc"]', 3]]);
    await ev(A, async () => { inoferCalidad.estado().sub = 'planes'; switchTab('calidad'); await new Promise(r => setTimeout(r, 500)); });
    await foto(A, '04d_calidad_planes', [['#calPlanBuscar', 1], ['#calHjCada', 2], ['#calHjTol', 3]]);
    // ---- Stock
    await ev(A, async () => {
      const w = ms => new Promise(r => setTimeout(r, ms));
      switchTab('stock'); await w(400);
      const v = document.getElementById('viewStock');
      v.querySelector('.st-nuevo[data-t="fardos"]').click(); await w(150);
      const f = v.querySelector('.st-form-fardos'); f.querySelector('[name="clave"]').value = 'ZAMAC'; f.querySelector('[name="analisis"]').value = 'ZN-2611'; f.querySelector('[name="n"]').value = '3'; f.querySelector('[name="kg"]').value = '976'; f.querySelector('[name="nota"]').value = 'Remito 0001-2345'; f.requestSubmit(); await w(200);
      v.querySelector('.st-nuevo[data-t="fardos"]').click(); await w(150);
      const g = v.querySelector('.st-form-fardos'); g.querySelector('[name="clave"]').value = 'ALSI'; g.querySelector('[name="analisis"]').value = 'AL-7781'; g.querySelector('[name="n"]').value = '4'; g.querySelector('[name="kg"]').value = '1000'; g.requestSubmit(); await w(200);
      v.querySelector('.st-nuevo[data-t="fardos"]').click(); await w(200);
      const h = v.querySelector('.st-form-fardos'); h.querySelector('[name="clave"]').value = 'ZAMAC'; h.querySelector('[name="analisis"]').value = 'ZN-2612'; h.querySelector('[name="kg"]').value = '980';
    });
    await foto(A, '05_stock_ingreso', [['.st-nuevo[data-t="fardos"]', 1], ['.st-form-fardos [name="origen"]', 2], ['.st-form-fardos [name="analisis"]', 3], ['.st-form-fardos [name="kg"]', 4]]);
    await ev(A, async () => { const v = document.getElementById('viewStock'); v.querySelector('.st-cancel').click(); await new Promise(r => setTimeout(r, 200)); });
    await foto(A, '05b_stock_tabla', [['.st-fardos', 1], ['.st-nuevo[data-t="retiro"]', 2], ['.st-min', 3]]);
    await ev(A, async () => { inoferVerFardos('ZAMAC'); await new Promise(r => setTimeout(r, 200)); });
    await foto(A, '05c_stock_fardos', [['.stf-editar', 1], ['.stf-parcial', 2], ['.stf-retirar', 3]]);
    await ev(A, async () => { document.querySelector('.stf-parcial').click(); await new Promise(r => setTimeout(r, 200)); const fp = document.querySelector('.stfp-form'); fp.kg.value = '406'; fp.kg.dispatchEvent(new Event('input', { bubbles: true })); fp.otro.value = 'Otra planta'; });
    await foto(A, '05d_stock_parcial', [['.stfp-kg', 1], ['.stfp-dest', 2], ['.stfp-desc', 3]]);
    await ev(A, () => document.getElementById('inoferPlantaModal') && document.getElementById('inoferPlantaModal').remove());
    // ---- Mantenimiento
    await ev(A, async () => { switchTab('mant'); await new Promise(r => setTimeout(r, 600)); window.scrollTo(0, 0); });
    await foto(A, '06_mantenimiento', [['txt:Registrar trabajo', 1], ['txt:Preventivo', 2], ['txt:Cargar planilla', 3], ['txt:Poner fuera de servicio', 4]]);
    await ev(A, async () => { inoferAvisarRotura('200V'); await new Promise(r => setTimeout(r, 500)); });
    await foto(A, '06b_rotura', [['txt:200V@.fixed button', 1], ['txt:Arrastre por material', 2], ['txt:Sacar o elegir', 3], ['txt:El molde', 4], ['txt:Avisar a mantenimiento', 5]]);
    await ev(A, () => { document.querySelectorAll('[id*="otura"], #inoferPlantaModal').forEach(x => { if (x.classList && x.classList.contains('fixed')) x.remove(); }); const m = document.getElementById('inoferPlantaModal'); if (m) m.remove(); });
    // ---- Etiquetas
    await ev(A, async () => { document.querySelectorAll('.fixed.inset-0').forEach(x => x.remove()); inoferEtiquetasLote({ ordId: 'o1' }); await new Promise(r => setTimeout(r, 600)); });
    await foto(A, '07_etiquetas', [['.fixed select', 1], ['.fixed select', 2, 1], ['.fixed input[type="number"]', 3, 1], ['txt:Ficha completa', 4], ['txt:Imprimir 6', 5]]);
    await ev(A, () => document.querySelectorAll('.fixed.inset-0').forEach(x => x.remove()));
    // ---- Gantt
    await ev(A, async () => { switchTab('gantt'); await new Promise(r => setTimeout(r, 800)); window.scrollTo(0, 0); });
    await foto(A, '08_gantt', [['#gtAuto', 1], ['#gtFab', 2]]);
    await ev(A, async () => { try { inoferArmado3.abrir(); } catch (e) { document.getElementById('gtAuto') && document.getElementById('gtAuto').click(); } await new Promise(r => setTimeout(r, 700)); });
    await foto(A, '08b_gantt_armado');
    await ev(A, () => { const m = document.getElementById('inoferArmado'); if (m) m.remove(); });
    // ---- Indicadores
    await ev(A, async () => {
      const meses = []; const h = new Date(); for (let i = 11; i >= 0; i--) { const d = new Date(h.getFullYear(), h.getMonth() - i, 1); meses.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')); }
      const val = (b, a) => meses.map((m, i) => ({ mes: m, valor: Math.round((b + Math.sin(i * 1.3) * a) * 100) / 100 }));
      inoferKpis.scrap = { meta: 3, datos: val(3.4, 0.9) }; inoferKpis.rebabado = { meta: 95, datos: val(93, 4) }; inoferKpis.recuento = { meta: 98, datos: val(97.5, 1.5) }; inoferKpis.inyeccion = { meta: 85, datos: val(82, 6) };
      try { localStorage.setItem('tablero_inyectoras_kpis_v1', JSON.stringify(inoferKpis)); } catch (e) { }
      switchTab('kpi'); await new Promise(r => setTimeout(r, 1200)); window.scrollTo(0, 0);
    });
    await foto(A, '08c_indicadores', [['#kpiSubirBtn', 1]]);
    // ---- menú
    await ev(A, async () => { switchTab('hoy'); await new Promise(r => setTimeout(r, 500)); const b = [...document.querySelectorAll('#nbNav button')].find(x => /Producción/.test(x.textContent)); if (b) b.click(); await new Promise(r => setTimeout(r, 300)); });
    await foto(A, '00b_menu', [['#inoferAvisosBtn', 1]]);
    console.log('errores', A._errs);
  } finally { await b.close(); w.close(); srv.kill(); }
})();
