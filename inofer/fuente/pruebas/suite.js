// Red de seguridad de INOFER: pruebas automáticas que corren antes de cada publicación.
// Levanta una nube simulada (el Código.gs real + servidor.js con servicios de Google falsos) y abre la app en Chromium.
// Uso: node fuente/pruebas/suite.js   (sale con código 1 si algo falla)
const fs = require('fs'), path = require('path'), http = require('http'), { spawn } = require('child_process');
const { chromium } = require('playwright');
const RAIZ = path.resolve(__dirname, '..', '..');           // carpeta inofer/
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
  const srv = spawn(process.execPath, [path.join(__dirname, 'nube_simulada.js'), path.join(RAIZ, 'Codigo.gs'), String(PUERTO_NUBE)], { env: Object.assign({}, process.env, { SRV_FILE: path.join(tmp, 'servidor.js') }), stdio: 'ignore' });
  const w = web();
  await new Promise(r => setTimeout(r, 1200));
  const b = await chromium.launch();
  let A, B;
  try {
    console.log('Pruebas de INOFER');
    await prueba('Abre la app y crea el administrador', async () => { A = await equipo(b); await ingresar(A, 'admin', 'abcd'); });
    await prueba('Estilos y gráficos incluidos (sin internet)', async () => {
      const r = await A.evaluate(() => ({ css: !!document.getElementById('inoferEstilos'), chart: typeof window.Chart === 'function', bg: getComputedStyle(document.body).backgroundColor }));
      ok(r.css && r.chart, 'faltan estilos o Chart.js dentro de la página'); ok(r.bg !== 'rgba(0, 0, 0, 0)', 'la página no tiene estilos aplicados');
    });
    await prueba('Todas las pestañas abren sin errores', async () => {
      for (const t of ['dashboard', 'records', 'orders', 'gantt', 'kpi', 'mant', 'stock', 'aud', 'ai']) { await A.evaluate(t => switchTab(t), t); await A.waitForTimeout(350); }
      ok(!A._errs.length, 'errores: ' + A._errs.slice(0, 3).join(' | '));
    });
    await prueba('Menú del encabezado: grupos visibles para el admin', async () => {
      const g = await A.evaluate(() => [...document.querySelectorAll('.nb-grupo')].map(b => b.dataset.g).join(','));
      ok(g === 'prod,plan,ana,ia,adm', 'grupos: ' + g);
    });
    await prueba('Carga rápida: crear orden y guardar un turno (llega a la nube)', async () => {
      await A.evaluate(async () => {
        inoferCargaRapida.abrir({ maq: '200V' }); await new Promise(r => setTimeout(r, 300));
        if (!document.getElementById('crNuevaForm')) document.getElementById('crNuevaBtn').click();
        await new Promise(r => setTimeout(r, 200));
        document.getElementById('crPieza').value = 'PRUEBA-1'; document.getElementById('crCantidad').value = '1000';
        document.getElementById('crNuevaForm').requestSubmit(); await new Promise(r => setTimeout(r, 300));
        document.getElementById('crOk').value = '150'; document.getElementById('crTurnoForm').requestSubmit();
      });
      await A.waitForTimeout(3000);
      const d = await nube(A);
      const o = (d.modules.orders || []).find(x => x.part === 'PRUEBA-1');
      ok(o && o.logs && o.logs.length === 1 && Number(o.logs[0].okPcs) === 150, 'el turno no está en la nube');
    });
    await prueba('Dos equipos cargan a la vez y no se pisan', async () => {
      await A.waitForTimeout(8500);
      B = await equipo(b); await ingresar(B, 'admin', 'abcd'); await B.waitForTimeout(2500);
      await Promise.all([
        A.evaluate(() => { const o = productionOrders.find(x => x.part === 'PRUEBA-1'); o.logs.push({ id: 'lg-sA', date: '2026-01-05', turno: 'Tarde', startTime: '14:00', endTime: '22:00', okPcs: 10, operator: 'A' }); saveProductionOrders(); }),
        B.evaluate(() => { const o = productionOrders.find(x => x.part === 'PRUEBA-1'); o.logs.push({ id: 'lg-sB', date: '2026-01-05', turno: 'Noche', startTime: '22:00', endTime: '06:00', okPcs: 20, operator: 'B' }); saveProductionOrders(); })
      ]);
      await A.waitForTimeout(3000);
      const o = (await nube(A)).modules.orders.find(x => x.part === 'PRUEBA-1');
      const ids = o.logs.map(l => l.id);
      ok(ids.includes('lg-sA') && ids.includes('lg-sB'), 'se perdió un turno: ' + ids.join(','));
    });
    await prueba('Borrar una orden no la revive una copia vieja', async () => {
      await A.evaluate(() => { productionOrders.unshift({ id: 'ord-borrar', ordNumber: '99999', part: 'BORRAR', machine: 'H-50', qtyTarget: 1, status: 'En Proceso', logs: [] }); saveProductionOrders(); });
      await A.waitForTimeout(9000); await B.waitForTimeout(500);
      await A.evaluate(() => { productionOrders = productionOrders.filter(o => o.id !== 'ord-borrar'); saveProductionOrders(); });
      await A.waitForTimeout(2000);
      await B.evaluate(() => { const o = productionOrders.find(x => x.part === 'PRUEBA-1'); o.qtyTarget = 1200; saveProductionOrders(); });
      await B.waitForTimeout(2500);
      const d = await nube(A);
      ok(!d.modules.orders.some(o => o.id === 'ord-borrar'), 'la orden borrada volvió');
      ok(d.modules.orders.find(o => o.part === 'PRUEBA-1').qtyTarget === 1200, 'no se guardó el cambio del otro equipo');
    });
    await prueba('Sin internet: guarda en el equipo y sube al volver', async () => {
      SIN_NUBE = true;
      await A.evaluate(() => { const o = productionOrders.find(x => x.part === 'PRUEBA-1'); o.logs.push({ id: 'lg-off', date: '2026-01-06', turno: 'Mañana', startTime: '06:00', endTime: '14:00', okPcs: 33, operator: 'Offline' }); saveProductionOrders(); });
      await A.waitForTimeout(1500);
      const pend = await A.evaluate(() => inoferModsPendientes());
      ok(pend.includes('orders'), 'no quedó pendiente');
      await A.reload(); await A.waitForTimeout(3000);
      ok(await A.evaluate(() => productionOrders.some(o => (o.logs || []).some(l => l.id === 'lg-off'))), 'se perdió al recargar sin internet');
      SIN_NUBE = false;
      await A.evaluate(() => window.dispatchEvent(new Event('online'))); await A.waitForTimeout(4000);
      const o = (await nube(A)).modules.orders.find(x => x.part === 'PRUEBA-1');
      ok(o.logs.some(l => l.id === 'lg-off'), 'no subió al volver internet');
      ok(o.logs.some(l => l.id === 'lg-sB'), 'al subir pisó el turno del otro equipo');
    });
    await prueba('Asistente del Gantt aplica un pedido simple', async () => {
      const r = await A.evaluate(async () => {
        const cat = partsCatalog.find(c => (c.machines || []).includes('200N') && !/-R$/.test(c.part));
        const t = await inoferGanttEjecutar(`poné 300 de la ${cat.part} en la 200N el miércoles`);
        const w = ganttWeeksData[activeGanttWeekCode];
        return { t: String(t), ok: ((w.machines['200N'] || {}).items || []).some(it => it.part === cat.part && Number(it.dailyQty[3]) >= 300) };
      });
      ok(r.ok, 'no se aplicó: ' + r.t.slice(0, 120));
    });
    await prueba('Permisos: operario sin carga manual ni Admin', async () => {
      await A.evaluate(() => inoferCloudPost({ action: 'saveUser', token: inoferAuthToken(), user: { usuario: 'operario', nombre: 'Operario', clave: '1111', rol: 'usuario', permisos: { partes: 'edit', ordenes: 'edit', catalogo: 'none', gantt: 'view', ia: 'none', indicadores: 'none' } } }));
      const O = await equipo(b); await ingresar(O, 'operario', '1111'); await O.waitForTimeout(1500);
      const r = await O.evaluate(async () => ({ g: [...document.querySelectorAll('.nb-grupo')].map(b => b.dataset.g).join(','), add: (await inoferCloudPost({ action: 'add', token: inoferAuthToken(), entry: { id: 'rec-x', date: '2026-01-05', machine: 'H-50', shift: 'Mañana', available: 8 } })).error, aud: (await inoferCloudPost({ action: 'audListar', token: inoferAuthToken() })).error }));
      ok(!r.g.includes('adm') && !r.g.includes('ia'), 've menús que no debe: ' + r.g);
      ok(r.add === 'permiso', 'pudo cargar un parte manual sin estar habilitado');
      ok(!!r.aud, 'pudo leer el registro de cambios');
      ok(!O._errs.length, 'errores: ' + O._errs.slice(0, 2).join(' | '));
    });
    await prueba('Informe semanal y registro de cambios', async () => {
      const r = await A.evaluate(async () => ({ inf: await inoferCloudPost({ action: 'informeSemanal', token: inoferAuthToken(), semana: '2026-01-05' }), aud: await inoferCloudPost({ action: 'audListar', token: inoferAuthToken() }) }));
      ok(r.inf.status === 'ok' && /Informe semanal/.test(r.inf.html), 'el informe no se armó');
      ok(r.aud.status === 'ok' && r.aud.filas.some(f => /PRUEBA-1/.test(f.detalle)), 'el registro no tiene los cambios');
    });
    await prueba('Editar la fecha de un parte no la corre un día', async () => {
      const r = await A.evaluate(async () => {
        const t = inoferAuthToken(), e = { id: 'rec-fecha', date: '2026-10-25', machine: 'H-50', shift: 'Mañana', available: 8 };
        await inoferCloudPost({ action: 'add', token: t, entry: e });
        const ed = await inoferCloudPost({ action: 'edit', token: t, entry: Object.assign({}, e, { date: '2026-10-27' }) });
        const rep = await inoferCloudPost({ action: 'replace', token: t, records: [Object.assign({}, e, { id: 'rec-fecha2', date: '2026-10-28' })], borrados: [] });
        const n = await (await fetch(cloudApiUrl + '?action=json&t=' + Date.now() + inoferTokenParam())).json();
        const L = n.records || n.registros || [];
        const f = id => (L.find(x => x.id === id) || {}).date;
        await inoferCloudPost({ action: 'replace', token: t, records: [], borrados: ['rec-fecha', 'rec-fecha2'] });
        return { a: f('rec-fecha'), b: f('rec-fecha2'), ed: ed.status || ed.error };
      });
      ok(r.a === '2026-10-27' && r.b === '2026-10-28', 'la fecha cambió: ' + JSON.stringify(r));
    });
    await prueba('Informe por mail: día, hora y remitente configurables', async () => {
      const r = await A.evaluate(async () => {
        const w = ms => new Promise(r => setTimeout(r, ms));
        inoferInformeSemanal('2026-01-05'); await w(300);
        document.querySelector('#infMailCfg').click(); await w(200);
        const dia = document.querySelector('#infDia'), hora = document.querySelector('#infHora');
        const antes = { dia: dia && dia.value, hora: hora && hora.value };
        document.querySelector('#infEmails').value = 'a@b.com';
        dia.value = '5'; hora.value = '15'; document.querySelector('#infAlias').value = 'inofer.informes@gmail.com';
        document.querySelector('#infMailSave').click(); await w(1500);
        const c = inoferModLocal('informes') || {};
        return { antes, dia: c.dia, hora: c.hora, alias: c.alias, emails: c.emails };
      });
      const env = await A.evaluate(async () => {
        const w = ms => new Promise(r => setTimeout(r, ms));
        const b = document.querySelector('#infEnviar'); if (!b) return { boton: false };
        b.click(); await w(2500);
        const t = document.getElementById('toastNotification');
        return { boton: true, toast: t ? t.textContent : '', ult: (await inoferCloudPost({ action: 'respaldoInfo', token: inoferAuthToken() })).informe };
      });
      ok(env.boton && /Informe enviado a a@b\.com/.test(env.toast) && env.ult && /a mano/.test(env.ult.como), 'no envió el informe en el momento: ' + JSON.stringify(env));
      ok(r.antes.dia === '1' && r.antes.hora === '7', 'el horario por defecto no es lunes 7: ' + JSON.stringify(r.antes));
      ok(r.dia === 5 && r.hora === 15 && r.alias === 'inofer.informes@gmail.com' && r.emails.join() === 'a@b.com', 'no guardó el horario: ' + JSON.stringify(r));
      await A.evaluate(() => { const m = document.getElementById('inoferPlantaModal'); if (m) m.remove(); });
    });
    await prueba('Órdenes desde el Gantt: propone, aprueba, ajusta y borra', async () => {
      const r = await A.evaluate(async () => {
        const w = ms => new Promise(r => setTimeout(r, ms));
        const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        const hoy = iso(new Date());
        let wk = Object.values(ganttWeeksData).find(x => [0, 1, 2, 3, 4, 5, 6].some(d => inoferFechaDia(x, d) === hoy));
        if (!wk) { const l = new Date(); l.setDate(l.getDate() - ((l.getDay() + 6) % 7)); wk = { code: 'SEM-PR', name: 'Prueba', startDate: iso(l), machines: {} }; ganttWeeksData['SEM-PR'] = wk; }
        const d = [0, 1, 2, 3, 4, 5, 6].find(x => inoferFechaDia(wk, x) === hoy);
        wk.machines['Z30'] = wk.machines['Z30'] || { aux: {}, items: [] };
        const q = [0, 0, 0, 0, 0, 0, 0]; q[d] = 777;
        wk.machines['Z30'].items.push({ id: 'gi-pr', part: 'GANTT-PR', dailyQty: q, stdRate: 100, totalQty: 777 });
        saveGanttWeeks(); await w(600);
        const p1 = inoferPropuestasGantt().filter(p => p.x && p.x.part === 'GANTT-PR').map(p => p.tipo);
        inoferRevisarGantt(); await w(200);
        document.querySelector('#inoferPlantaModal .gp-ok').click(); await w(800);
        const o = productionOrders.find(o => o.part === 'GANTT-PR');
        const creada = !!o && o.qtyTarget === 777 && !!o.gantt;
        wk.machines['Z30'].items.find(i => i.id === 'gi-pr').dailyQty[d] = 900; saveGanttWeeks(); await w(600);
        const p2 = inoferPropuestasGantt().filter(p => p.o === o).map(p => p.tipo + ':' + p.qty);
        inoferRevisarGantt(); await w(200); document.querySelector('#inoferPlantaModal .gp-ok').click(); await w(500);
        wk.machines['Z30'].items = wk.machines['Z30'].items.filter(i => i.id !== 'gi-pr'); saveGanttWeeks(); await w(600);
        const p3 = inoferPropuestasGantt().filter(p => p.o && p.o.part === 'GANTT-PR').map(p => p.tipo);
        inoferRevisarGantt(); await w(200); document.querySelector('#inoferPlantaModal .gp-ok').click(); await w(500);
        return { p1, creada, p2, qty: o && o.qtyTarget, p3, borrada: !productionOrders.some(x => x.part === 'GANTT-PR') };
      });
      ok(r.p1.includes('nueva') && r.creada, 'no creó la orden: ' + JSON.stringify(r));
      ok(r.p2[0] === 'ajuste:900' && r.qty === 900, 'no ajustó la cantidad: ' + JSON.stringify(r));
      ok(r.p3[0] === 'borrar' && r.borrada, 'no la borró al sacarla del Gantt: ' + JSON.stringify(r));
    });
    await prueba('Turno en 3 toques con operarios y parada frecuente', async () => {
      const r = await A.evaluate(async () => {
        const w = ms => new Promise(r => setTimeout(r, ms));
        inoferCargaRapida.abrir({ maq: '200V' }); await w(300);
        document.getElementById('crOperCfgBtn').click(); await w(150);
        const ta = document.querySelector('#crOperCfg .cro-txt[data-m="200V"]'); ta.value = 'Juan\nPedro'; ta.dispatchEvent(new Event('change', { bubbles: true })); await w(200);
        const o = productionOrders.find(x => x.part === 'PRUEBA-1');
        inoferCargaRapida.abrir({ maq: '200V', ordId: o.id }); await w(400);
        const sugerido = Number(document.getElementById('crOk').value);
        document.querySelector('.cr-delta[data-d="-10"]').click();
        const chip = document.querySelector('.cr-pchip'); chip.click(); await w(100);
        document.querySelector('#crParadasList .cr-prow:last-child .cr-padd[data-m="30"]').click();
        [...document.querySelectorAll('.cr-oper')].find(b => b.dataset.n === 'Pedro').click();
        const antes = o.logs.length;
        document.getElementById('crTurnoForm').requestSubmit(); await w(300);
        // otra prueba ya cargó este turno en la 200V: aparece el aviso de horarios pisados → "Guardar igual"
        const pis = document.querySelector('#crPisada [data-p="igual"]'); if (pis) { pis.click(); await w(400); }
        const l = o.logs[o.logs.length - 1];
        return { sugerido, n: o.logs.length - antes, ok: l.okPcs, op: l.operator, par: (l.paradas || []).map(p => p.codigo + ':' + p.min).join(','), chip: chip.dataset.cod };
      });
      ok(r.sugerido > 0, 'no vino la cantidad sugerida');
      ok(r.n === 1 && r.ok === r.sugerido - 10 && r.op === 'Pedro' && r.par === r.chip + ':30', 'el turno no quedó bien: ' + JSON.stringify(r));
    });
    await prueba('Pantalla Hoy y OEE', async () => {
      const r = await A.evaluate(async () => {
        switchTab('hoy'); await new Promise(r => setTimeout(r, 400));
        const t = document.getElementById('viewHoy').innerText;
        const reg = [{ fromOrder: true, ordId: 'x', part: 'NOEXISTE', machine: 'H-50', available: 8, okPcs: 900, scrapPcs: 100, parada_maquina: 2 }];
        const o = inoferOEE(reg);
        switchTab('dashboard'); await new Promise(r => setTimeout(r, 400));
        return { hoy: /Hoy ·/.test(t) && /Producido hoy/i.test(t) && /200V/.test(t), D: o.D, C: o.C, tablero: !!document.getElementById('oeeTablero') };
      });
      ok(r.hoy, 'la pantalla Hoy no se dibujó');
      ok(Math.abs(r.D - 0.75) < 1e-9 && Math.abs(r.C - 0.9) < 1e-9, 'el OEE calcula mal: ' + JSON.stringify(r));
      ok(r.tablero, 'falta el OEE en el tablero');
    });
    await prueba('Avisar rotura con foto: para la máquina, avisa y se resuelve', async () => {
      const r = await A.evaluate(async () => {
        const w = ms => new Promise(r => setTimeout(r, ms));
        const c = document.createElement('canvas'); c.width = 40; c.height = 30; c.getContext('2d').fillRect(0, 0, 20, 20);
        const foto = c.toDataURL('image/jpeg', 0.6);
        const d = await inoferCloudPost({ action: 'avisarRotura', token: inoferAuthToken(), maquina: 'H50', motivo: '4-Rotura hidráulica', descripcion: 'pierde aceite', parada: true, foto });
        applyCloudModules(d.modules); await w(300);
        const parada = !inoferMaquinaEstado('H50').activa;
        const rot = (d.modules.mantenimiento.roturas || []).find(x => x.maquina === 'H50' && x.estado === 'abierta');
        const f = await inoferCloudPost({ action: 'fotoLeer', token: inoferAuthToken(), id: rot.fotoId });
        const sol = await inoferCloudPost({ action: 'solListar', token: inoferAuthToken() });
        switchTab('mant'); await w(500);
        const seccion = !!document.getElementById('mantRoturas') && /pierde aceite/.test(document.getElementById('mantRoturas').innerText);
        const d2 = await inoferCloudPost({ action: 'roturaResolver', token: inoferAuthToken(), id: rot.id, nota: 'cambio de manguera', habilitar: true });
        applyCloudModules(d2.modules); await w(25000);
        return { parada, foto: (f.foto || '').startsWith('data:image/jpeg'), sol: (sol.solicitudes || []).some(s => /Rotura en la H50/.test(s.titulo)), seccion, habilitada: inoferMaquinaEstado('H50').activa, trabajo: (d2.modules.mantenimiento.trabajos || []).some(t => t.roturaId === rot.id) };
      });
      ok(r.parada && r.foto && r.sol, 'el aviso no hizo todo: ' + JSON.stringify(r));
      ok(r.seccion, 'no aparece en Mantenimiento');
      ok(r.habilitada && r.trabajo, 'al resolver no habilitó la máquina o no registró el trabajo: ' + JSON.stringify(r));
    });
    await prueba('Modo tablet "Mi máquina"', async () => {
      const T = await equipo(b, { width: 800, height: 1100 }); await ingresar(T, 'admin', 'abcd');
      await T.goto(`http://127.0.0.1:${PUERTO_WEB}/index.html?mimaquina=200V`); await T.waitForTimeout(4500);
      const r = await T.evaluate(() => ({ vis: !document.getElementById('viewMiMaq').classList.contains('hidden'), txt: document.getElementById('viewMiMaq').innerText }));
      ok(r.vis && /200V/.test(r.txt) && /CARGAR TURNO/.test(r.txt), 'no entró a la pantalla de la máquina');
      await T.evaluate(() => document.getElementById('mmCargar').click()); await T.waitForTimeout(500);
      const r2 = await T.evaluate(() => ({ cr: !document.getElementById('orderSubViewRapida').classList.contains('hidden'), maq: inoferCargaRapida.estado.maq, volver: !document.getElementById('mmVolver').classList.contains('hidden') }));
      ok(r2.cr && r2.maq === '200V' && r2.volver, 'el botón Cargar turno no llevó a la carga: ' + JSON.stringify(r2));
      ok(!T._errs.length, 'errores: ' + T._errs.slice(0, 2).join(' | '));
    });
    await prueba('Copia de seguridad descargable', async () => {
      const [dl] = await Promise.all([A.waitForEvent('download', { timeout: 15000 }), A.evaluate(async () => { inoferAlmacenamiento(); await new Promise(r => setTimeout(r, 1500)); document.getElementById('almBajar').click(); })]);
      const p = await dl.path(); const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      ok(j.app === 'INOFER' && j.modulos && Array.isArray(j.modulos.orders), 'la copia no tiene los datos');
      await A.evaluate(() => document.getElementById('inoferPlantaModal') && document.getElementById('inoferPlantaModal').remove());
    });
    await prueba('Gráfico de facturación de la semana en el Gantt', async () => {
      const r = await A.evaluate(async () => {
        const w = getActiveGanttWeek(); const it = Object.values(w.machines).flatMap(m => m.items || []).find(i => (i.dailyQty || []).some(q => Number(q) > 0));
        const c = partsCatalog.find(x => x.part === it.part) || (partsCatalog.push({ id: 'cat-pr', part: it.part, machines: [] }), partsCatalog[partsCatalog.length - 1]); c.precio = 1000;
        switchTab('gantt'); await new Promise(r => setTimeout(r, 300)); inoferGraficoFacturacion(); await new Promise(r => setTimeout(r, 300));
        const i = document.getElementById('gfMeta'); i.value = '1.000.000'; i.dispatchEvent(new Event('change', { bubbles: true })); await new Promise(r => setTimeout(r, 300));
        return { card: !!document.getElementById('ganttFactCard'), canvas: !!document.getElementById('gfCanvas'), meta: getActiveGanttWeek().metaFacturacion, txt: document.getElementById('ganttFactCard').innerText };
      });
      ok(r.card && r.canvas && r.meta === 1000000 && /% de la meta/.test(r.txt), 'el gráfico de facturación no quedó bien: ' + JSON.stringify(r).slice(0, 200));
    });
    await prueba('Importar el Gantt de Excel y que el automático lo respete', async () => {
      const r = await A.evaluate(async () => {
        const H = ['Máquina', 'INYECCIÓN', 'Unid.\nTOTALES', 'Material', 'STD\n[Unid./h]', 'Hs', 'Unid.', 'Hs', 'Unid.', 'Hs', 'Unid.', 'Hs', 'Unid.', 'Hs', 'Unid.', 'Hs', 'Unid.', 'Hs', 'Unid.'];
        const fila = (a, b, c, d, e, dias) => { const f = [a, b, c, d, e]; for (let i = 0; i < 7; i++) { const x = dias ? dias[i] : null; f.push(x && x.h != null ? x.h : null, x && x.u != null ? x.u : null); } return f; };
        const filas = [['PLANTA INOFER, SEM 45'], ['Versión:', new Date(2026, 9, 30), null, null, 6, 'Domingo', null, null, new Date(2026, 10, 2), null, new Date(2026, 10, 3)], H,
          ['200V', 'UTILIZACIÓN', 0.2], ['zamac', 'HS TOTALES', 51], ['CMO', 'CAMBIO DE MOLDE', 3, null, 0.2, null, null, 5, 1, 5, 1],
          fila('PZA-XLS-1', 'PIEZA DE PRUEBA', 450, 'alsi', 56, [null, { h: 8, u: 450 }]),
          ['200N', 'UTILIZACIÓN', 0], fila('PZA-XLS-2', 'SIN DIAS', 900, 'alsi', 75)];
        const sem = inoferLeerGanttExcel.leerHoja(filas);
        const res = inoferAplicarGanttExcel(sem, { reemplazar: true, fijo: true });
        const w = ganttWeeksData['SEM-45'];
        const v = w.machines['200V'].items.find(i => i.part === 'PZA-XLS-1'), n = w.machines['200N'].items.find(i => i.part === 'PZA-XLS-2');
        let sigue = false;
        try { scheduleOneMonthIntoGanttWeeks(0, 44, '2026-10-26', 'Prueba'); sigue = (ganttWeeksData['SEM-45'].machines['200V'].items || []).some(i => i.part === 'PZA-XLS-1' && i.fijo && i.dailyQty[1] === 450); } catch (e) { sigue = 'error ' + e.message; }
        return { lunes: sem[0] && sem[0].lunes, v: v && v.dailyQty.join('/'), cmo: w.machines['200V'].aux.CMO.join('/'), n: n && n.dailyQty.reduce((a, b) => a + b, 0), fijo: !!(v && v.fijo), sigue, piezas: res.piezas };
      });
      ok(r.lunes === '2026-11-02' && r.v === '0/450/0/0/0/0/0' && r.cmo === '0/5/5/0/0/0/0', 'no leyó bien el Excel: ' + JSON.stringify(r));
      ok(r.n === 900 && r.fijo, 'no repartió la pieza sin días o no quedó fija: ' + JSON.stringify(r));
      ok(r.sigue === true, 'el Gantt automático movió o borró lo importado: ' + JSON.stringify(r));
    });
    await prueba('Gantt opción C: barra, tarjetas, menú y asistente flotante', async () => {
      const r = await A.evaluate(async () => {
        const w = ms => new Promise(r => setTimeout(r, ms));
        switchTab('gantt'); await w(800);
        const bar = document.getElementById('gtBar'), vg = document.getElementById('viewGantt');
        const selEnBarra = !!bar && bar.contains(document.getElementById('ganttWeekSelect'));
        const tiles = (document.getElementById('gtTiles') || {}).innerText || '';
        const chatEnVentana = document.getElementById('gtDrawer').contains(document.getElementById('inoferGanttChat'));
        const fab = !document.getElementById('gtFab').classList.contains('gt-cerrado');
        document.getElementById('gtFab').click(); await w(100);
        const abierto = !document.getElementById('gtDrawer').classList.contains('gt-cerrado');
        document.getElementById('gtFab').click();
        document.getElementById('gtMas').click(); await w(100);
        const items = [...document.querySelectorAll('#gtMenu button')].map(b => b.textContent);
        const sec = document.querySelector('#gtMenu [data-gt-sec="autoGanttMonthPanel"]'); if (sec) sec.click(); await w(100);
        const analizador = !document.getElementById('autoGanttMonthPanel').classList.contains('gt-cerrado') && document.getElementById('gtExtras').contains(document.getElementById('autoGanttMonthPanel'));
        window.inoferGanttVista.abrirSeccion('autoGanttMonthPanel');
        const sel = document.getElementById('ganttWeekSelect'), i0 = sel.selectedIndex; document.getElementById('gtNext').click(); await w(200);
        const avanzo = sel.selectedIndex === Math.min(i0 + 1, sel.options.length - 1);
        switchTab('dashboard'); await w(200);
        const fabFuera = document.getElementById('gtFab').classList.contains('gt-cerrado');
        return { selEnBarra, tiles, chatEnVentana, fab, abierto, items: items.join('|'), analizador, avanzo, fabFuera, grilla: !!document.getElementById('ganttWeeklyContainer') && vg.contains(document.getElementById('ganttWeeklyContainer')) };
      });
      ok(r.selEnBarra && /programadas/.test(r.tiles) && /utilización/.test(r.tiles), 'no armó la barra o las tarjetas: ' + JSON.stringify(r));
      ok(r.chatEnVentana && r.fab && r.abierto && r.fabFuera, 'el asistente flotante no anda: ' + JSON.stringify(r));
      ok(/Nueva semana/.test(r.items) && /Analizador/.test(r.items) && r.analizador && r.avanzo && r.grilla, 'menú/secciones/flechas: ' + JSON.stringify(r));
    });
    await prueba('Rotura de molde: la orden sale del Gantt y vuelve sola al reprogramarla', async () => {
      const r = await A.evaluate(async () => {
        const w = ms => new Promise(r => setTimeout(r, ms));
        const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        const hoy = new Date(); const dow = hoy.getDay();
        const nom = m => GANTT_MACHINES_CONFIG.find(c => c.id === m).name;
        ganttWeeksData['SEM-ROT'] = { code: 'SEM-ROT', name: 'Semana rotura', startDate: iso(hoy), machines: { '200V': { aux: {}, items: [{ id: 'gi-rot', part: 'PZA-ROT', desc: 'PIEZA ROTURA', totalQty: 700, mat: 'alsi', stdRate: 100, dailyQty: [100, 100, 100, 100, 100, 100, 100] }] }, '200N': { aux: {}, items: [] } } };
        productionOrders.push({ id: 'ord-rot', ordNumber: '9901', part: 'PZA-ROT', machine: nom('200V'), status: 'En Proceso', qtyTarget: 700, logs: [], gantt: { key: 'pza-rot|200V', desde: iso(hoy) } });
        saveProductionOrders(); saveGanttWeeks(); await w(2500);
        inoferAvisarRotura('200V'); await w(300);
        const m = document.querySelector('#inoferPlantaModal') || document.body;
        const mot = [...document.querySelectorAll('.ar-mot')].find(b => /^10-/.test(b.dataset.c)); mot.click(); await w(100);
        const ordBoxVisible = !document.getElementById('arOrdBox').classList.contains('hidden');
        document.getElementById('arOrd').value = 'ord-rot';
        document.getElementById('arEnviar').click(); await w(3000);
        const o = productionOrders.find(x => x.id === 'ord-rot');
        const it = (ganttWeeksData['SEM-ROT'].machines['200V'].items || []).find(i => i.part === 'PZA-ROT');
        const quedan = it ? it.dailyQty.slice() : [];
        const mt = inoferModLocal('mantenimiento') || {}; const rot = (mt.roturas || []).find(x => x.ordId === 'ord-rot') || {};
        const maqActiva = !((inoferModLocal('setup') || {}).maquinas || {})['200V'] || ((inoferModLocal('setup') || {}).maquinas['200V'].activa !== false);
        const enCarga = inoferCargaRapida.abierta(o);
        const det = { ordBoxVisible, status: o.status, quedan, tipo: rot.tipo, paro: rot.paro, maqActiva, enCarga };
        // la pieza vuelve a aparecer en el Gantt (en otra máquina)
        ganttWeeksData['SEM-ROT'].machines['200N'].items.push({ id: 'gi-rot2', part: 'PZA-ROT', desc: 'PIEZA ROTURA', totalQty: 300, mat: 'alsi', stdRate: 100, dailyQty: [0, 0, 0, 0, 0, 0, 0].map((x, i) => i >= dow ? 50 : 0) });
        saveGanttWeeks(); await w(300);
        return Object.assign(det, { despues: o.status, maq: inoferCargaRapida.maqDeOrden(o), hist: (o.roturasHist || []).length });
      });
      const hoyIdx = new Date().getDay();
      ok(r.ordBoxVisible && r.tipo === 'molde' && r.paro === false && r.maqActiva, 'la rotura de molde no quedó bien: ' + JSON.stringify(r));
      ok(r.status === 'Detenida por rotura' && r.enCarga === false, 'la orden no quedó detenida: ' + JSON.stringify(r));
      ok(r.quedan.length === 0 || r.quedan.every((q, i) => i < hoyIdx ? q === 100 : q === 0), 'no sacó bien la pieza del Gantt desde hoy: ' + JSON.stringify(r));
      ok(r.despues === 'En Proceso' && r.maq === '200N' && r.hist === 1, 'no volvió sola al reprogramarla: ' + JSON.stringify(r));
    });
    await prueba('Cronómetro de paradas y cierre de turno de todas las máquinas', async () => {
      const r = await A.evaluate(async () => {
        const w = ms => new Promise(r => setTimeout(r, ms));
        const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        const hoy = new Date(), nom = m => GANTT_MACHINES_CONFIG.find(c => c.id === m).name;
        const T = inoferCargaRapida.turnos(), am = t => { const p = t.split(':'); return +p[0] * 60 + +p[1]; }, ah = hoy.getHours() * 60 + hoy.getMinutes();
        const t = T[0], fecha = iso(new Date(Date.now() - 3 * 86400000));
        const it = (id, part, q) => ({ id, part, desc: part, totalQty: q * 7, mat: 'alsi', stdRate: 100, dailyQty: [q, q, q, q, q, q, q] });
        ganttWeeksData['SEM-CT'] = { code: 'SEM-CT', name: 'Semana cierre', startDate: fecha, machines: { '200V': { aux: {}, items: [it('c1', 'PZA-CT1', 900)] }, '200N': { aux: {}, items: [it('c2', 'PZA-CT2', 600)] }, '180': { aux: {}, items: [] }, 'H50': { aux: {}, items: [] }, 'Z30': { aux: {}, items: [] } } };
        productionOrders.push({ id: 'ct-1', ordNumber: '9801', part: 'PZA-CT1', machine: nom('200V'), status: 'En Proceso', qtyTarget: 50000, logs: [] });
        productionOrders.push({ id: 'ct-2', ordNumber: '9802', part: 'PZA-CT2', machine: nom('200N'), status: 'En Proceso', qtyTarget: 50000, logs: [] });
        saveProductionOrders(); saveGanttWeeks(); await w(2500);
        // cronómetro en la tablet de la 200N
        const crono = document.createElement('div'); crono.innerHTML = inoferCronoBloque('200N'); document.body.appendChild(crono);
        crono.querySelector('.cro-ini').click(); await w(200);
        document.querySelector('#croElegir .cro-cod').click(); await w(200);
        const act = inoferCronoActiva('200N'); const empezo = !!act;
        const fin = document.createElement('div'); fin.innerHTML = inoferCronoBloque('200N'); document.body.appendChild(fin);
        fin.querySelector('.cro-fin').click(); await w(200); crono.remove(); fin.remove();
        const terminado = !inoferCronoActiva('200N');
        const b0 = new Date(fecha + 'T' + t.ini + ':00').getTime(); act.desde = new Date(b0 + 60 * 60000).toISOString(); act.hasta = new Date(b0 + 90 * 60000).toISOString();
        // la OP puesta en cada máquina (modo tablet) manda sobre lo que sugiere el Gantt
        [['200V', 'ct-1'], ['200N', 'ct-2']].forEach(([m, id]) => { const o = inoferPonerOp(m, id); if (o && o.montada) o.montada.desde = fecha + 'T00:00:00.000Z'; });
        inoferCierreTurno({ fecha, turno: t.id }); await w(400);
        const filas = [...document.querySelectorAll('#ctModal .ct-row')].map(x => x.dataset.m);
        const ok200V = document.querySelector('#ctModal .ct-row[data-m="200V"] .ct-ok').value;
        const cronoChip = !!document.querySelector('#ctModal .ct-row[data-m="200N"] .ct-pc.crono');
        const z = document.querySelector('#ctModal .ct-row[data-m="Z30"]').className;
        // las demás máquinas (de otras pruebas) se completan para poder guardar todo junto
        document.querySelectorAll('#ctModal .ct-row').forEach(row => {
          if (['200V', '200N'].includes(row.dataset.m)) { const op = row.querySelector('.ct-oper'); if (op && !op.value) { op.value = 'Prueba'; op.dispatchEvent(new Event('input', { bubbles: true })); } return; }
          const ord = row.querySelector('.ct-ord'); if (ord && !ord.value && ord.options[0] && ord.options[0].value) { ord.value = ord.options[0].value; ord.dispatchEvent(new Event('change', { bubbles: true })); }
        });
        for (const m of ['180', 'H50', 'Z30']) { const no = document.querySelector(`#ctModal .ct-row[data-m="${m}"] .ct-no`); if (no) no.click(); }
        for (const m of ['180', 'H50', 'Z30']) { const sel = document.querySelector(`#ctModal .ct-row[data-m="${m}"] .ct-motivo-no`); if (sel) { sel.value = sel.options[1].value; sel.dispatchEvent(new Event('change', { bubbles: true })); } }
        document.querySelector('#ctModal .ct-guardar').click(); await w(800);
        const o1 = productionOrders.find(o => o.id === 'ct-1'), o2 = productionOrders.find(o => o.id === 'ct-2');
        const l2 = (o2.logs || [])[0] || {};
        const listo = document.querySelectorAll('#ctModal .ct-row.listo').length; const toastTxt = document.getElementById('toastNotification').textContent;
        const usada = ((inoferModLocal('mantenimiento') || {}).cronoParadas || []).some(x => x.maq === '200N' && x.usada);
        document.getElementById('ctModal').remove();
        ['ct-1', 'ct-2'].forEach(id => { const o = productionOrders.find(x => x.id === id); if (o) delete o.montada; });
        return { empezo, terminado, filas: filas.join(','), ok200V, cronoChip, z, l1: (o1.logs || []).length, ok1: ((o1.logs || [])[0] || {}).okPcs, par2: (l2.paradas || []).map(p => p.min).join(','), origen: l2.origen, listo, usada, toastTxt };
      });
      ok(r.empezo && r.terminado, 'el cronómetro no anduvo: ' + JSON.stringify(r));
      ok(r.filas.startsWith('200V,200N') && Number(r.ok200V) > 0 && r.cronoChip, 'el cierre no se precargó bien: ' + JSON.stringify(r));
      ok(r.l1 === 1 && r.ok1 === Number(r.ok200V) && Number(r.par2) === 30 && r.origen === 'cierre' && r.listo >= 2 && r.usada, 'no guardó el cierre: ' + JSON.stringify(r));
    });
    await prueba('Presentación para pendrive: imágenes JPG en un ZIP', async () => {
      const r = await A.evaluate(async () => await inoferPresPendrive({ soloProbar: true }));
      ok(r && r.primeros.join(',') === '80,75,3,4', 'no armó el ZIP: ' + JSON.stringify(r));
      const jpgs = r.archivos.filter(a => /\.jpg$/.test(a));
      ok(jpgs.length >= 3 && r.tamanos.slice(0, jpgs.length).every(t => t > 15000) && !r.fallas.length && r.archivos.some(a => /LEEME/.test(a)), 'imágenes vacías o faltantes: ' + JSON.stringify(r));
    });
    await prueba('Presentación: todos los gráficos se pueden elegir y se dibujan', async () => {
      const r = await A.evaluate(() => {
        const P = inoferPresInterna, tipos = Object.keys(P.tipos), out = {};
        tipos.forEach(t => { const c = document.createElement('div'); c.style.cssText = 'width:1600px;height:900px;display:flex;flex-direction:column'; document.body.appendChild(c); try { P.render({ tipo: t, opciones: { periodo: '30d', maquina: 'ALL', kpi: 'recuento', texto: 'Hola' } }, c); out[t] = c.innerText.trim().length > 0 || !!c.querySelector('canvas'); } catch (e) { out[t] = 'ERROR ' + e.message; } c.remove(); });
        inoferPresentacionConfig(); const opts = [...document.querySelectorAll('#presNuevoTipo option')].map(o => o.value); const m = document.getElementById('presCfg'); if (m) { m.classList.add('hidden'); m.classList.remove('flex'); }
        return { out, opts };
      });
      const malos = Object.keys(r.out).filter(k => r.out[k] !== true);
      ok(!malos.length, 'diapositivas que fallan: ' + malos.map(k => k + '=' + r.out[k]).join(', '));
      ok(['kpi:recuento', 'kpi:rebabado', 'kpi:scrap', 'kpi:inyeccion', 'estado', 'produccion', 'codigos', 'kpis4', 'stock'].every(x => r.opts.includes(x)), 'faltan opciones para agregar: ' + r.opts.join(','));
    });
    await prueba('Lista para tiendas: manifest, capturas, privacidad y botón Instalar', async () => {
      const path = require('path'), fs = require('fs');
      const m = JSON.parse(fs.readFileSync(path.join(FUENTE, 'res', 'web', 'manifest.webmanifest'), 'utf8'));
      ok(m.name && m.short_name === 'INOFER' && m.id && m.start_url && m.display === 'standalone' && m.icons.some(i => i.sizes === '512x512' && i.purpose === 'maskable'), 'manifest incompleto');
      ok(m.shortcuts.length >= 3 && m.screenshots.filter(x => x.form_factor === 'wide').length >= 3, 'faltan accesos o capturas');
      m.screenshots.forEach(x => ok(fs.existsSync(path.join(FUENTE, x.src)), 'falta la captura ' + x.src));
      ok(fs.existsSync(path.join(FUENTE, 'tienda', 'privacidad.html')), 'falta la política de privacidad');
      const r = await A.evaluate(() => ({ btn: !!document.getElementById('inoferInstalarApp'), fn: typeof inoferInstalarApp }));
      ok(r.btn && r.fn === 'function', 'no aparece el botón Instalar: ' + JSON.stringify(r));
    });
    await prueba('Velocidad con un año de datos y archivo automático de órdenes viejas', async () => {
      const r = await A.evaluate(async () => {
        const guard = productionOrders.slice();
        const espera = () => new Promise(res => requestAnimationFrame(() => setTimeout(res, 0)));
        for (let i = 0; i < 400; i++) { const logs = []; for (let j = 0; j < 25; j++) logs.push({ id: 'vl' + i + '_' + j, date: '2026-0' + (1 + j % 9) + '-1' + (j % 9), turno: 'Mañana', startTime: '06:00', endTime: '14:00', okPcs: 300, scrapPcs: 5, operator: 'Op' }); productionOrders.push({ id: 'vo' + i, ordNumber: String(70000 + i), part: 'VPZA-' + (i % 120), machine: 'H-50', qtyTarget: 5000, status: i < 350 ? 'Completada' : 'En Proceso', logs }); }
        const t = {};
        for (const tab of ['records', 'orders', 'dashboard', 'stock']) { const a = performance.now(); switchTab(tab); try { if (tab === 'records') renderRecordsTable(getFilteredRecords()); } catch (e) { } await espera(); t[tab] = Math.round(performance.now() - a); }
        switchTab('records'); renderRecordsTable(getFilteredRecords()); await espera();
        const filas = document.querySelectorAll('#recordsTableBody tr').length, mas = !!document.getElementById('recVerMas');
        document.getElementById('recVerMas')?.click(); await espera();
        const filas2 = document.querySelectorAll('#recordsTableBody tr').length;
        productionOrders.length = 0; guard.forEach(o => productionOrders.push(o));
        // orden vieja completada → el archivo automático la saca de la lista pero sigue contando
        productionOrders.push({ id: 'ord-vieja', ordNumber: '88888', part: 'VIEJA-1', machine: 'H-50', qtyTarget: 10, status: 'Completada', logs: [{ id: 'lg-vieja', date: '2025-01-10', turno: 'Mañana', startTime: '06:00', endTime: '14:00', okPcs: 10 }] });
        saveProductionOrders(); await new Promise(res => setTimeout(res, 4000));
        const cfg = await inoferCloudPost({ action: 'archivoAutoConfig', token: inoferAuthToken(), activo: true, meses: 3 });
        const a1 = await inoferCloudPost({ action: 'archivoAutoRevisar', token: inoferAuthToken() });
        const a2 = await inoferCloudPost({ action: 'archivoAutoRevisar', token: inoferAuthToken() });
        const n = await (await fetch(cloudApiUrl + '?action=json&t=' + Date.now() + inoferTokenParam())).json();
        const enLista = ((n.modules || {}).orders || []).some(o => o.id === 'ord-vieja');
        const reg = await inoferCloudPost({ action: 'archivoRegistros', token: inoferAuthToken() });
        await inoferCloudPost({ action: 'archivoRestaurar', token: inoferAuthToken(), id: 'ord-vieja' });
        try { lastLocalChangeAt = 0; pendingCloudOps = 0; fetchCloudRecords(true); } catch (e) { } await new Promise(res => setTimeout(res, 2500));
        productionOrders = productionOrders.filter(o => o.id !== 'ord-vieja'); saveProductionOrders(); await new Promise(res => setTimeout(res, 2500));
        inoferAlmacenamiento(); await new Promise(res => setTimeout(res, 2500));
        const auto = !!document.getElementById('almAuto') && document.getElementById('almAuto').checked;
        document.querySelectorAll('.fixed.inset-0').forEach(x => { if (x.querySelector('#almCuerpo')) x.remove(); });
        return { auto, e1: a1.error, t, filas, mas, filas2, cfg: cfg.status, a1: a1.archivadas, a2: a2.archivadas, enLista, sigue: (reg.records || []).some(x => x.ordId === 'ord-vieja') };
      });
      Object.entries(r.t).forEach(([k, v]) => ok(v < 3000, `la pestaña ${k} tardó ${v} ms`));
      ok(r.filas <= 152 && r.mas && r.filas2 > r.filas, 'historial por tandas: ' + JSON.stringify([r.filas, r.mas, r.filas2]));
      ok(r.cfg === 'ok' && r.a1 >= 1 && r.a2 === 0, 'archivo automático: ' + JSON.stringify(r));
      ok(r.auto, 'falta la casilla de archivo automático en Almacenamiento');
      ok(!r.enLista && r.sigue, 'la orden archivada debe salir de la lista y seguir contando: ' + JSON.stringify(r));
    });
    await prueba('Avisos al celular: suscribir, firmar (VAPID), mandar, filtrar y pedir pendientes', async () => {
      const pedir = ruta => new Promise((res, rej) => http.get(`http://127.0.0.1:${PUERTO_NUBE}` + ruta, r => { let b = ''; r.on('data', c => b += c); r.on('end', () => res(b)); }).on('error', rej));
      const estado = async () => JSON.parse(await pedir('/__state')).push || [];
      const sub = (ep, prefs) => A.evaluate(([ep, prefs]) => inoferCloudPost({ action: 'pushSuscribir', token: inoferAuthToken(), sub: { endpoint: ep, keys: { p256dh: 'x', auth: 'y' } }, prefs, equipo: 'Prueba' }), [ep, prefs]);
      const prefs = { tipos: { stock: true, rotura: true, parada: true, msg: true }, maqs: { '200V': true, 'H50': false }, silencio: false };
      const info = await A.evaluate(() => inoferCloudPost({ action: 'pushInfo', token: inoferAuthToken() }));
      ok(info.status === 'ok' && /^[A-Za-z0-9_-]{87}$/.test(info.clave || ''), 'clave pública: ' + JSON.stringify(info).slice(0, 200));
      const s1 = await sub('https://push.prueba/equipo1', prefs);
      const s2 = await sub('https://push.prueba/vencida', prefs);
      ok(s1.pid && s2.pid && s1.pid !== s2.pid, 'suscripción: ' + JSON.stringify([s1, s2]));
      const antes = (await estado()).length;
      const pr = await A.evaluate(pid => inoferCloudPost({ action: 'pushProbar', token: inoferAuthToken(), pid }), s1.pid);
      ok(pr.enviados === 1, 'probar: ' + JSON.stringify(pr));
      const env = (await estado()).slice(antes);
      ok(env.length === 1 && env[0].url === 'https://push.prueba/equipo1', 'envío de prueba: ' + JSON.stringify(env).slice(0, 200));
      // la firma VAPID (ES256) tiene que verificar con la clave pública
      const crypto = require('crypto');
      const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(env[0].headers.Authorization || '');
      ok(m && m[4] === info.clave, 'encabezado VAPID: ' + (env[0].headers.Authorization || '').slice(0, 60));
      const pub = Buffer.from(m[4], 'base64url');
      const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') }, format: 'jwk' });
      ok(crypto.verify('sha256', Buffer.from(m[1] + '.' + m[2]), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(m[3], 'base64url')), 'la firma VAPID no verifica');
      ok(JSON.parse(Buffer.from(m[2], 'base64url')).aud === 'https://push.prueba', 'aud del JWT');
      const pend = await A.evaluate(async pid => { const g = async () => (await (await fetch(cloudApiUrl + '?action=pushPendientes&pid=' + pid)).json()).mensajes; return [await g(), await g()]; }, s1.pid);
      ok(pend[0].length === 1 && pend[0][0].titulo === 'Prueba de INOFER' && pend[1].length === 0, 'pendientes: ' + JSON.stringify(pend));
      // evento de stock: llega; la suscripción vencida (410) se borra
      const n0 = (await estado()).length;
      const ev = await A.evaluate(() => inoferCloudPost({ action: 'pushEvento', token: inoferAuthToken(), tipo: 'stock', clave: 'ALSI|rojo|x', titulo: 'Stock bajo · ALSI', cuerpo: 'Quedan 100 kg', ir: 'stock' }));
      const ev2 = await A.evaluate(() => inoferCloudPost({ action: 'pushEvento', token: inoferAuthToken(), tipo: 'stock', clave: 'ALSI|rojo|x', titulo: 'Stock bajo · ALSI', cuerpo: 'Quedan 100 kg' }));
      ok(ev.enviados === 1 && ev2.ya === true, 'evento stock (una sola vez): ' + JSON.stringify([ev, ev2]));
      ok((await estado()).length === n0 + 2, 'debía intentar los 2 equipos');
      const eqs = await A.evaluate(() => inoferCloudPost({ action: 'pushInfo', token: inoferAuthToken() }));
      ok(eqs.equipos.length === 1, 'la suscripción vencida debía borrarse: ' + eqs.equipos.length);
      // filtro de máquina del equipo y tabla del administrador
      const fm = await A.evaluate(() => inoferCloudPost({ action: 'pushEvento', token: inoferAuthToken(), tipo: 'prev', clave: 'h50|1', maq: 'H50', titulo: 'Preventivo', cuerpo: 'x' }));
      ok(fm.enviados === 0, 'H50 apagada en el equipo: ' + JSON.stringify(fm));
      await A.evaluate(() => inoferCloudPost({ action: 'saveModule', token: inoferAuthToken(), moduleKey: 'avisosPush', moduleData: { usuarios: { admin: { stock: false } }, minParada: 30, minTurno: 30 } }));
      const fa = await A.evaluate(() => inoferCloudPost({ action: 'pushEvento', token: inoferAuthToken(), tipo: 'stock', clave: 'ZAMAC|rojo|x', titulo: 'Stock', cuerpo: 'x' }));
      ok(fa.enviados === 0, 'el admin sacó el stock en la tabla: ' + JSON.stringify(fa));
      const tp = await A.evaluate(() => inoferCloudPost({ action: 'pushEvento', token: inoferAuthToken(), tipo: 'turno', clave: '200V|hoy|Noche', fin: Date.now() - 5 * 60000, titulo: 'Turno', cuerpo: 'x' }));
      ok(tp.pronto === true, 'turno recién terminado espera los minutos elegidos: ' + JSON.stringify(tp));
      // máquina parada hace más de 30 min (cronómetro)
      await A.evaluate(() => inoferCloudPost({ action: 'saveModule', token: inoferAuthToken(), moduleKey: 'mantenimiento', moduleData: Object.assign({}, (window.inoferModLocal && inoferModLocal('mantenimiento')) || {}, { cronoParadas: [{ id: 'cp-push', maq: '200V', codigo: 30, desde: new Date(Date.now() - 40 * 60000).toISOString(), hasta: '', por: 'Prueba' }] }) }));
      const n1 = (await estado()).length;
      await pedir('/__run?f=' + encodeURIComponent('(function(){ inoferServidor_().revisarAvisosPush_(true); })'));
      const par = await A.evaluate(async pid => (await (await fetch(cloudApiUrl + '?action=pushPendientes&pid=' + pid)).json()).mensajes, s1.pid);
      ok((await estado()).length === n1 + 1 && par.some(x => /200V parada hace 4\d min/.test(x.titulo)), 'parada larga: ' + JSON.stringify(par));
      // pantallas
      const ui = await A.evaluate(async () => {
        inoferAvisosCelular(); await new Promise(r => setTimeout(r, 2500));
        const m = document.getElementById('inoferPushModal'); const t1 = m ? m.textContent : ''; if (m) m.remove();
        inoferAvisosAdmin(); await new Promise(r => setTimeout(r, 2500));
        const a = document.getElementById('inoferPushModal'); const filas = a ? a.querySelectorAll('tbody tr').length : 0; const t2 = a ? a.textContent : ''; if (a) a.remove();
        return { t1: /QUÉ ME AVISA/.test(t1) && /DE QUÉ MÁQUINAS/.test(t1) && /Activar en este equipo|bloqueados|no permite/.test(t1), txt: t1.slice(0, 200), filas, t2: /PARADA LARGA/.test(t2) };
      });
      ok(ui.t1, 'ventana del celular: ' + ui.txt);
      ok(ui.filas >= 1 && ui.t2, 'tabla del administrador: ' + JSON.stringify(ui));
      await A.evaluate(() => inoferCloudPost({ action: 'saveModule', token: inoferAuthToken(), moduleKey: 'avisosPush', moduleData: {} }));
    });
    await prueba('Indicadores: se elige el tipo de gráfico y se guarda para todos', async () => {
      const r = await A.evaluate(async () => {
        switchTab('kpi'); await new Promise(res => setTimeout(res, 300));
        const k = INOFER_KPI_DEF[0].key; const o = inoferKpiData(k);
        if (o.datos.length < 4) { ['2026-05', '2026-06', '2026-07', '2026-08'].forEach((mes, i) => o.datos.push({ mes, valor: 95 + i })); }
        inoferKpiActual = k; inoferRenderKpi(); await new Promise(res => setTimeout(res, 300));
        const tipos = {};
        for (const [t] of INOFER_KPI_GRAFICOS) {
          const sel = document.getElementById('kpiTipoGraf'); sel.value = t; sel.dispatchEvent(new Event('change')); await new Promise(res => setTimeout(res, 250));
          const ch = inoferKpiCharts.main; tipos[t] = ch ? [ch.data.datasets[0].type || 'line', ch.data.datasets.length] : null;
        }
        const guardado = inoferKpiData(k).grafico;
        const sel = document.getElementById('kpiTipoGraf'); sel.value = 'linea'; sel.dispatchEvent(new Event('change'));
        return { tipos, guardado };
      });
      ok(r.tipos.barras && r.tipos.barras[0] === 'bar' && r.tipos.semaforo[0] === 'bar' && r.tipos.linea[0] === 'line' && r.tipos.tendencia[1] === 3, 'tipos: ' + JSON.stringify(r.tipos));
      ok(r.guardado === 'tendencia', 'no se guardó el tipo: ' + r.guardado);
    });
    await prueba('Stock por fardos: ingreso con análisis, suma y retiro de un fardo elegido', async () => {
      const r = await A.evaluate(async () => {
        const esperar = ms => new Promise(res => setTimeout(res, ms));
        switchTab('stock'); await esperar(300);
        const v = document.getElementById('viewStock');
        v.querySelector('.st-nuevo[data-t="fardos"]').click(); await esperar(100);
        let f = v.querySelector('.st-form-fardos');
        f.querySelector('[name="clave"]').value = 'alsi-prueba'; f.querySelector('[name="analisis"]').value = 'AN-77';
        const n = f.querySelector('[name="n"]'); n.value = '3'; n.dispatchEvent(new Event('input', { bubbles: true }));
        const dist = f.querySelector('[name="distinto"]'); dist.checked = true; dist.dispatchEvent(new Event('change', { bubbles: true }));
        f.querySelectorAll('.st-fkgi').forEach((i, j) => { i.value = String(1000 + j * 10); }); f.querySelector('.st-fkgi').dispatchEvent(new Event('input', { bubbles: true }));
        const total = f.querySelector('.st-ftotal').textContent;
        f.requestSubmit(); await esperar(200);
        // segundo ingreso: 1 fardo de 500 kg con otro análisis
        v.querySelector('.st-nuevo[data-t="fardos"]').click(); await esperar(100);
        f = v.querySelector('.st-form-fardos'); const r2 = f.querySelector('[name="origen"][value="r2"]'); r2.checked = true; r2.dispatchEvent(new Event('change', { bubbles: true }));
        const anOpc = !f.querySelector('[name="analisis"]').required;
        f.querySelector('[name="clave"]').value = 'ALSI-PRUEBA'; f.querySelector('[name="analisis"]').value = 'AN-78'; f.querySelector('[name="kg"]').value = '500'; f.requestSubmit(); await esperar(200);
        const d = D => inoferModLocal('stock').materiales['ALSI-PRUEBA'];
        const antes = { n: d().fardos.length, nums: d().fardos.map(x => x.numero).join(','), movs: d().movimientos.map(m => m.kg).join(',') };
        const fila = [...v.querySelectorAll('.st-fardos')].find(b => b.dataset.k === 'ALSI-PRUEBA'); const celda = fila ? fila.textContent.replace(/\s+/g, ' ') : '';
        // retirar el fardo N° 2
        v.querySelector('.st-nuevo[data-t="retiro"]').click(); await esperar(100);
        const fr = v.querySelector('.st-form-retiro'); const sel = fr.querySelector('.st-rmat'); sel.value = 'ALSI-PRUEBA'; sel.dispatchEvent(new Event('change', { bubbles: true })); await esperar(100);
        const fr2 = v.querySelector('.st-form-retiro'); const f2 = d().fardos.find(x => x.numero === 2);
        fr2.querySelector(`[name="fardo"][value="${f2.id}"]`).checked = true; fr2.querySelector('[name="maquina"]').value = '200V'; fr2.requestSubmit(); await esperar(200);
        const fila2 = [...v.querySelectorAll('.st-fardos')].find(b => b.dataset.k === 'ALSI-PRUEBA'); const celda2 = fila2 ? fila2.textContent.replace(/\s+/g, ' ') : '';
        inoferVerFardos('ALSI-PRUEBA'); await esperar(100); const modalTxt = (document.getElementById('inoferPlantaModal') || {}).textContent || ''; document.getElementById('inoferPlantaModal')?.remove();
        const ret = d().fardos.find(x => x.numero === 2).retiro;
        const inf = inoferInformeFardos({ material: 'ALSI-PRUEBA' });
        inoferImprimirFardos(); await esperar(200); const pm = (document.querySelector('.stp-res') || {}).textContent || ''; document.getElementById('inoferPlantaModal')?.remove();
        const rec = { anOpc, f4: d().fardos.find(x => x.numero === 4), nuevo: d().fardos.find(x => x.numero === 1).origen, celda: celda, html: /Recuperado 2°/.test(inf.html) && /Nuevo y recuperado/.test(inf.html) };
        const informe = { ing: inf.d.ing.length, ret: inf.d.ret.length, dep: inf.d.dep.length, maq: Object.keys(inf.d.porMaq).join(','), html: /Fardos que se retiraron \(1\)/.test(inf.html) && /AN-77/.test(inf.html) && /<b>200V<\/b>/.test(inf.html), pm };
        const S = inoferModLocal('stock'); delete S.materiales['ALSI-PRUEBA']; inoferModGuardar('stock');
        return { rec, informe, total, antes, celda, celda2, ret, modal: /Análisis AN-77/.test(modalTxt) && /En depósito: 3 fardos/.test(modalTxt) };
      });
      ok(/3 fardos · 3[.,]030 kg/.test(r.total), 'total en vivo: ' + r.total);
      ok(r.antes.n === 4 && r.antes.nums === '1,2,3,4' && r.antes.movs === '3030,500', 'ingresos: ' + JSON.stringify(r.antes));
      ok(/4 fardos/.test(r.celda) && /3[.,]530 kg/.test(r.celda), 'en depósito: ' + r.celda);
      ok(r.ret && r.ret.maquina === '200V' && /3 fardos/.test(r.celda2) && /2[.,]520 kg/.test(r.celda2), 'retiro: ' + JSON.stringify(r));
      ok(r.modal, 'ventana de fardos');
      ok(r.rec.anOpc && r.rec.f4 && r.rec.f4.origen === 'recuperado' && r.rec.f4.grado === 2 && r.rec.nuevo === 'nuevo' && /recup\. · 500 kg/.test(r.rec.celda) && r.rec.html, 'material recuperado: ' + JSON.stringify(r.rec));
      ok(r.informe.ing === 4 && r.informe.ret === 1 && r.informe.dep === 3 && r.informe.maq === '200V' && r.informe.html && /1 retirado/.test(r.informe.pm), 'listado para imprimir: ' + JSON.stringify(r.informe));
    });
    await prueba('Gantt automático: elegir las semanas tocándolas (1 a 8, por fecha)', async () => {
      const r = await A.evaluate(async () => {
        const esperar = ms => new Promise(res => setTimeout(res, ms));
        switchTab('gantt'); await esperar(300);
        try { window.inoferGanttVista && inoferGanttVista.abrirSeccion('autoGanttMonthPanel'); } catch (e) { }
        for (let i = 0; i < 6 && !document.getElementById('gsBox'); i++) await esperar(500);
        const box = document.getElementById('gsBox'); if (!box) return { sinBox: true };
        const chips = box.querySelectorAll('[data-gs]').length;
        // elegir la 3ª semana y 2 semanas
        const ch = box.querySelectorAll('[data-gs]')[3]; const lunes = ch.dataset.gs; ch.click();
        box.querySelector('[data-gsn="2"]').click();
        const resumen = box.textContent;
        const cod = inoferCodigoSemana(lunes), cod2 = inoferCodigoSemana(new Date(new Date(lunes + 'T12:00:00').getTime() + 7 * 86400000).toISOString().slice(0, 10));
        window.__inoferSinConfirmar = true;
        const res = inoferArmarPorSemanas('M1', document.getElementById('autoGanttSemanaInicio').value, Number(document.getElementById('autoGanttCantSemanas').value));
        window.__inoferSinConfirmar = false;
        const w1 = ganttWeeksData[res.semanas[0]], w2 = ganttWeeksData[res.semanas[1]];
        // una semana que ya existe para esa fecha se reutiliza (no se duplica)
        const otra = inoferCodigoSemana(lunes);
        return { chips, lunes, cods: res.semanas, esperado: [cod.code, cod2.code], start1: w1 && w1.startDate, start2: w2 && w2.startDate, nombre: w1 && w1.name, mismo: otra.code === res.semanas[0] && otra.existe, resumen: /Se arma de la Sem \d+ a la Sem \d+/.test(resumen), dia: new Date(lunes + 'T12:00:00').getDay() };
      });
      ok(!r.sinBox, 'no apareció el selector de semanas');
      ok(r.chips === 10 && r.dia === 1, 'chips: ' + JSON.stringify(r));
      ok(r.cods.length === 2 && r.cods[0] === r.esperado[0] && r.start1 === r.lunes && r.start2 > r.start1 && /^Semana \d+ · /.test(r.nombre), 'semanas armadas: ' + JSON.stringify(r));
      ok(r.mismo && r.resumen, 'reutiliza la semana por fecha y muestra el resumen: ' + JSON.stringify(r));
    });
    await prueba('Modo tablet: elegir qué OP está puesta en la máquina', async () => {
      const r = await A.evaluate(async () => {
        const esperar = ms => new Promise(res => setTimeout(res, ms));
        const nom = id => (GANTT_MACHINES_CONFIG.find(x => x.id === id) || {}).name || id;
        productionOrders.push({ id: 'ord-mt1', ordNumber: '7701', part: 'PZA-MT1', machine: nom('H50'), status: 'En Proceso', qtyTarget: 500, logs: [] });
        productionOrders.push({ id: 'ord-mt2', ordNumber: '7702', part: 'PZA-MT2', machine: nom('H50'), status: 'En Proceso', qtyTarget: 500, logs: [] });
        productionOrders.push({ id: 'ord-mt3', ordNumber: '7703', part: 'PZA-MT3', machine: nom('Z30'), status: 'En Proceso', qtyTarget: 500, logs: [] });
        const traza = []; traza.push('pre' + productionOrders.some(o => o.id === 'ord-mt2'));
        saveProductionOrders(); traza.push('post' + productionOrders.some(o => o.id === 'ord-mt2'));
        for (let i = 0; i < 6; i++) { await esperar(300); traza.push(i + ':' + productionOrders.some(o => o.id === 'ord-mt2') + '/' + productionOrders.length); }
        let enNube = false; for (let i = 0; i < 16 && !enNube; i++) { await esperar(500); const n = await (await fetch(cloudApiUrl + '?action=json&partes=0&t=' + Date.now() + inoferTokenParam())).json(); enNube = ((n.modules || {}).orders || []).some(o => o.id === 'ord-mt2'); }
        let local = productionOrders.some(o => o.id === 'ord-mt2');
        for (let i = 0; i < 20 && !local; i++) { if (i === 0) { try { lastLocalChangeAt = 0; pendingCloudOps = 0; fetchCloudRecords(true); } catch (e) { } } await esperar(500); local = productionOrders.some(o => o.id === 'ord-mt2'); }
        if (!enNube || !local) return { sinTarjeta: true, traza, enNube, local, pend: typeof pendingCloudOps !== 'undefined' ? pendingCloudOps : '?' };
        localStorage.setItem('tablero_inyectoras_mimaquina_v1', 'H50'); switchTab('mimaq'); await esperar(400); try { inoferPintarHoy(); } catch (e) { } await esperar(300);
        const bOp = document.getElementById('mmOp'); if (!bOp) return { sinBoton: true, vis: !document.getElementById('viewMiMaq').classList.contains('hidden'), txt: document.getElementById('viewMiMaq').innerText.slice(0, 300) };
        bOp.click(); await esperar(200);
        if (!document.querySelector('.mo-elegir[data-o="ord-mt2"]')) return { sinTarjeta: true, modal: ((document.getElementById('inoferPlantaModal') || {}).innerText || 'SIN MODAL').slice(0, 400), maqs: productionOrders.filter(o => /^ord-mt/.test(o.id)).map(o => o.machine + '>' + (inoferCargaRapida.maqDeOrden ? inoferCargaRapida.maqDeOrden(o) : '?')) };
        const tarjetas = document.querySelectorAll('.mo-elegir[data-o]').length;
        document.querySelector('.mo-elegir[data-o="ord-mt2"]').click(); await esperar(300);
        const txt = document.getElementById('viewMiMaq').textContent;
        const m1 = inoferOpMontada('H50');
        // pasar una OP de otra máquina
        inoferPonerOp('H50', 'ord-mt3'); await esperar(100);
        const m2 = inoferOpMontada('H50'), viejaLibre = !productionOrders.find(o => o.id === 'ord-mt2').montada, z30 = productionOrders.find(o => o.id === 'ord-mt3').machine;
        productionOrders = productionOrders.filter(o => !/^ord-mt/.test(o.id)); saveProductionOrders();
        localStorage.removeItem('tablero_inyectoras_mimaquina_v1'); switchTab('hoy');
        return { tarjetas, txt: /PZA-MT2/.test(txt) && /OP puesta en la máquina/.test(txt), m1: m1 && m1.id, m2: m2 && m2.id, viejaLibre, z30 };
      });
      ok(!r.sinTarjeta, 'tarjetas: ' + JSON.stringify(r));
      ok(!r.sinBoton, 'no aparece el botón Cambiar OP: ' + JSON.stringify(r));
      ok(r.tarjetas >= 2 && r.txt && r.m1 === 'ord-mt2', 'elegir OP: ' + JSON.stringify(r));
      ok(r.m2 === 'ord-mt3' && r.viejaLibre && /H-?50/i.test(r.z30), 'cambiar a una OP de otra máquina: ' + JSON.stringify(r));
    });
    await prueba('Recuperar el Gantt desde una copia', async () => {
      const pedir = ruta => new Promise((res, rej) => http.get(`http://127.0.0.1:${PUERTO_NUBE}` + ruta, r => { let b = ''; r.on('data', c => b += c); r.on('end', () => res(b)); }).on('error', rej));
      await pedir('/__run?f=' + encodeURIComponent("(function(){ PropertiesService.getScriptProperties().setProperty('RESPALDOS', JSON.stringify([{ id: 'copia-prueba', fecha: new Date().toISOString(), nombre: 'INOFER respaldo prueba' }])); })"));
      const r = await A.evaluate(async () => {
        const esperar = ms => new Promise(res => setTimeout(res, ms));
        const n = await (await fetch(cloudApiUrl + '?action=json&partes=0&t=' + Date.now() + inoferTokenParam())).json();
        const nube = (n.modules || {}).gantt || {}; const code = Object.keys(nube).find(c => Object.values((nube[c] || {}).machines || {}).some(m => (m.items || []).length));
        if (!code) return { sinSemana: true };
        const antes = JSON.stringify(nube[code].machines);
        ganttWeeksData[code].machines = {}; // se "rompe" la semana en este equipo
        ganttWeeksData['SEM-RG-NUEVA'] = { code: 'SEM-RG-NUEVA', name: 'nueva', startDate: '2030-01-07', machines: {} };
        inoferRecuperarGantt(); await esperar(800);
        const f = document.querySelector('#inoferRecGantt .rg-f:not([data-f="0"])') || document.querySelector('#inoferRecGantt .rg-f'); f.click(); await esperar(800);
        const chk = document.querySelector(`#inoferRecGantt .rg-c[data-c="${code}"]`); const marcada = chk && chk.checked;
        const bor = document.querySelector('#inoferRecGantt .rg-b[data-c="SEM-RG-NUEVA"]'); if (bor) bor.checked = true;
        document.querySelector('#inoferRecGantt .rg-ok').click(); await esperar(500);
        const vuelta = JSON.stringify(ganttWeeksData[code].machines) === antes, borrada = !ganttWeeksData['SEM-RG-NUEVA'];
        const local = JSON.parse(localStorage.getItem('tablero_inyectoras_gantt_antes_v1') || 'null');
        return { code, marcada, vuelta, borrada, guardoAntes: !!(local && local.semanas && local.semanas['SEM-RG-NUEVA']) };
      });
      ok(!r.sinSemana, 'no había semana con piezas en la nube');
      ok(r.marcada && r.vuelta && r.borrada && r.guardoAntes, 'recuperar: ' + JSON.stringify(r));
    });
    await prueba('Semanas: ordenar la numeración, mover y asistente que entiende "semana N"', async () => {
      const r = await A.evaluate(async () => {
        const esperar = ms => new Promise(res => setTimeout(res, ms));
        switchTab('gantt'); await esperar(300);
        const lunesN = n => { const y = new Date().getFullYear(); const j4 = new Date(y, 0, 4, 12); j4.setDate(j4.getDate() - ((j4.getDay() + 6) % 7) + (n - 1) * 7); return j4.getFullYear() + '-' + String(j4.getMonth() + 1).padStart(2, '0') + '-' + String(j4.getDate()).padStart(2, '0'); };
        const cat = partsCatalog.find(c => (c.machines || []).includes('200V') && !/-R$/.test(c.part));
        const it = { id: 'gi-ord', part: cat.part, desc: 'x', totalQty: 500, stdRate: 100, dailyQty: [0, 100, 100, 100, 100, 100, 0] };
        // SEM-20 con las fechas de la semana 21 (como el armado viejo)
        ganttWeeksData['SEM-20'] = { code: 'SEM-20', name: 'Semana 20 vieja', startDate: lunesN(21), machines: { '200V': { aux: {}, items: [JSON.parse(JSON.stringify(it))] } } };
        const corr = inoferSemanasCorridas().filter(x => x.code === 'SEM-20');
        inoferOrdenarSemanas(['SEM-20']);
        const ordenada = ganttWeeksData['SEM-20'].startDate === lunesN(20) && inoferSemanaInfo('SEM-20').num === 20;
        // mover todo de la 20 a la 22 (se crea por fecha)
        const mv = inoferMoverSemana('20', '22', { modo: 'mover' });
        const c22 = inoferResolverSemana('22', false);
        const movio = mv.ok && !!c22 && (ganttWeeksData[c22].machines['200V'].items || []).some(x => x.part === cat.part) && !(ganttWeeksData['SEM-20'].machines['200V'].items || []).length;
        // el asistente entiende la semana en la frase (sin elegirla)
        const ops1 = inoferGanttInterpretar('pasá todo lo de la semana 22 a la semana 23');
        const ops2 = inoferGanttInterpretar('cuántas horas libres tiene la 200V en la semana 22');
        const ops3 = inoferGanttInterpretar(`donde está programada la ${cat.part}`);
        const sem = inoferSemanasEnTexto('del 16 al 21 de noviembre y la semana que viene');
        // cambio grande: primero muestra y espera "Aplicar"
        const t = await inoferGanttChat('pasá todo lo de la semana 22 a la semana 23');
        const log = document.getElementById('inoferGanttChatLog'); const conBoton = !!(log && log.querySelector('.gc-aplicar'));
        const sigueEn22 = (ganttWeeksData[c22].machines['200V'].items || []).some(x => x.part === cat.part);
        inoferGanttAplicarPendiente(); await esperar(200);
        const c23 = inoferResolverSemana('23', false);
        const aplicado = !!c23 && (ganttWeeksData[c23].machines['200V'].items || []).some(x => x.part === cat.part);
        const etiqueta = /Sem 2[23] · /.test(t);
        // chico: directo y con la semana dicha
        const t2 = await inoferGanttChat(`poné 200 de la ${cat.part} en la 200V el martes de la semana 23`);
        const dia = ((ganttWeeksData[c23].machines['200V'].items || []).find(x => x.part === cat.part) || {}).dailyQty || [];
        ['SEM-20', c22, c23].forEach(c => { delete ganttWeeksData[c]; }); saveGanttWeeks(); renderGanttView();
        return { corr: corr.length, ordenada, movio, ops1: ops1[0], ops2: ops2[0] && ops2[0].op, ops3: ops3[0] && ops3[0].op, sem: sem.map(x => x.num), conBoton, sigueEn22, aplicado, etiqueta, t: String(t).slice(0, 200), martes: dia[2], t2: String(t2).slice(0, 160) };
      });
      ok(r.corr === 1 && r.ordenada, 'ordenar semanas: ' + JSON.stringify(r));
      ok(r.movio, 'mover semana: ' + JSON.stringify(r));
      ok(r.ops1 && r.ops1.op === 'move_week' && r.ops1.from === '22' && r.ops1.to === '23' && r.ops2 === 'free' && r.ops3 === 'donde' && r.sem.length === 2, 'parser: ' + JSON.stringify(r));
      ok(r.conBoton && r.sigueEn22 && r.aplicado && r.etiqueta, 'vista previa y aplicar: ' + JSON.stringify(r));
      ok(Number(r.martes) === 200, 'pedido con semana dicha: ' + JSON.stringify(r));
    });
    await prueba('Armado del Gantt en 3 pasos: semanas, qué cargo, vista previa, aplicar, deshacer y 📌', async () => {
      const r = await A.evaluate(async () => {
        const esperar = ms => new Promise(res => setTimeout(res, ms));
        switchTab('gantt'); await esperar(400);
        const filasAntes = document.querySelectorAll('#viewGantt .gantt-item-qty-input').length;
        const bA = document.getElementById('gtAuto'); if (!bA) return { sinBoton: true };
        bA.click(); await esperar(200);
        const w = document.getElementById('inoferArmado'); if (!w) return { sinVentana: true };
        const tiles = w.querySelectorAll('[data-l]').length;
        w.querySelectorAll('[data-l]')[2].click(); await esperar(50);
        document.querySelector('#inoferArmado [data-n="2"]').click(); await esperar(50);
        const p1 = /Se arma de la Sem \d+ a la Sem \d+/.test(document.getElementById('inoferArmado').textContent);
        document.querySelector('#inoferArmado [data-a="ir2"]').click(); await esperar(50);
        const pris = document.querySelectorAll('#inoferArmado [data-r]').length;
        document.querySelector('#inoferArmado [data-r="cambios"]').click(); await esperar(50);
        const st = inoferArmado3.estado();
        const antesTxt = JSON.stringify(ganttWeeksData), antesOrd = JSON.stringify(productionOrders);
        const P = inoferArmado3.previa();
        const intacto = JSON.stringify(ganttWeeksData) === antesTxt && JSON.stringify(productionOrders) === antesOrd && !window.__inoferPrioridad;
        st.paso = 3; document.querySelector('#inoferArmado [data-a="avanzado"]') ; // (sigue abierta)
        inoferArmado3.aplicar(); await esperar(500); renderGanttView(); await esperar(300);
        const franja = !!document.getElementById('inoferArmadoFranja') && /Armado aplicado/.test(document.getElementById('inoferArmadoFranja').textContent);
        const aplicoSemanas = P.r.semanas.length === 2 && P.r.semanas.every(c => !!ganttWeeksData[c]);
        // pines y colores en la grilla de siempre
        activeGanttWeekCode = P.r.semanas[0]; renderGanttView(); await esperar(300);
        let pin = document.querySelector('#viewGantt .inofer-pin'), fijo = null;
        if (!pin) { const m = Object.keys(ganttWeeksData[activeGanttWeekCode].machines || {})[0] || '200V'; const W = ganttWeeksData[activeGanttWeekCode]; W.machines[m] = W.machines[m] || { aux: {}, items: [] }; W.machines[m].items.push({ part: 'PZA-PIN', desc: 'x', stdRate: 100, dailyQty: [0, 100, 0, 0, 0, 0, 0] }); renderGanttView(); await esperar(300); pin = document.querySelector('#viewGantt .inofer-pin'); }
        if (pin) { const m = pin.getAttribute('data-pin-mach'), i = Number(pin.getAttribute('data-pin-idx')); pin.click(); await esperar(100); fijo = !!ganttWeeksData[activeGanttWeekCode].machines[m].items[i].fijo; ganttWeeksData[activeGanttWeekCode].machines[m].items[i].fijo = false; }
        inoferArmado3.colorearUtil();
        const util = [...document.querySelectorAll('#viewGantt td[colspan="2"]')].some(td => /%/.test(td.textContent) && td.style.background);
        const filasDespues = document.querySelectorAll('#viewGantt .gantt-item-qty-input').length;
        const c0 = window.confirm; window.confirm = () => true; inoferArmado3.deshacer(); window.confirm = c0; await esperar(300);
        const volvio = JSON.stringify(ganttWeeksData) === antesTxt && !document.getElementById('inoferArmadoFranja');
        return { tiles, p1, pris, intacto, franja, aplicoSemanas, pin: !!pin, fijo, util, volvio, filasAntes, filasDespues, prio: st.prioridad, filas: (P.filas || []).length };
      });
      ok(!r.sinBoton && !r.sinVentana && r.tiles === 6 && r.p1 && r.pris === 3 && r.prio === 'cambios', 'pasos 1 y 2: ' + JSON.stringify(r));
      ok(r.intacto && r.filas >= 5, 'la vista previa no toca el Gantt: ' + JSON.stringify(r));
      ok(r.franja && r.aplicoSemanas, 'aplicar + franja: ' + JSON.stringify(r));
      ok(r.pin && r.fijo === true && r.util, '📌 y colores de utilización: ' + JSON.stringify(r));
      ok(r.volvio, 'deshacer el armado: ' + JSON.stringify(r));
    });
    await prueba('Gantt: escribir el número entero en la celda y ningún día de más de 24 h (se reparte)', async () => {
      const prep = await A.evaluate(async () => {
        const esperar = ms => new Promise(res => setTimeout(res, ms));
        switchTab('gantt'); await esperar(300);
        const pad = n => String(n).padStart(2, '0'); const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 7);
        const lunes = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
        const code = inoferSemanaDeLunes(lunes, true);
        const W = ganttWeeksData[code]; W.machines = { '200V': { aux: {}, items: [{ id: 'gi-24', part: 'PZA-24H', desc: 'x', stdRate: 100, dailyQty: [0, 0, 0, 0, 0, 0, 0], totalQty: 0 }] } };
        activeGanttWeekCode = code; renderGanttView(); await esperar(300);
        return { code };
      });
      const sel = '#viewGantt .gantt-item-qty-input[data-mach="200V"][data-item-idx="0"][data-day="1"]';
      await A.click(sel); await A.keyboard.press('Control+A'); await A.keyboard.type('3000', { delay: 60 });
      const enFoco = await A.evaluate(s => document.activeElement === document.querySelector(s) && document.activeElement.value, sel);
      await A.keyboard.press('Enter'); await A.waitForTimeout(600);
      const r = await A.evaluate(async code => {
        const W = ganttWeeksData[code], it = W.machines['200V'].items.find(x => x.part === 'PZA-24H');
        const h = [0, 1, 2, 3, 4, 5, 6].map(d => inoferRepartir24.horasDia(W.machines['200V'], d));
        // pieza de 50 h en un solo día (como si viniera del asistente o de mover semanas)
        it.dailyQty = [0, 0, 5000, 0, 0, 0, 0]; saveGanttWeeks(); await new Promise(res => setTimeout(res, 300));
        const h2 = [0, 1, 2, 3, 4, 5, 6].map(d => inoferRepartir24.horasDia(W.machines['200V'], d));
        const total = W.machines['200V'].items.filter(x => x.part === 'PZA-24H').reduce((s, x) => s + x.dailyQty.reduce((a, b) => a + b, 0), 0);
        const q = it.dailyQty.slice();
        delete ganttWeeksData[code]; saveGanttWeeks(); renderGanttView();
        return { lunes: q[1], h, h2, total, q };
      }, prep.code);
      ok(enFoco === '3000', 'se pierde el foco al escribir: ' + enFoco);
      ok(r.h[1] <= 24.01 && r.h[1] > 23 && Math.abs(r.h[2] - 6) < 0.01, 'lo escrito (3000 = 30 h el lunes) no quedó lunes 24 h + martes 6 h: ' + JSON.stringify(r));
      ok(Math.max(...r.h2) <= 24.01 && r.total === 5000 && r.q[2] > 0 && r.q[3] > 0, 'reparto en días siguientes: ' + JSON.stringify(r));
    });
    await prueba('Etiquetas de lote: lote fecha-máquina, una por cajón y QR a la ficha sin ingreso', async () => {
      const r = await A.evaluate(async () => {
        const esperar = ms => new Promise(res => setTimeout(res, ms));
        const nom = id => (GANTT_MACHINES_CONFIG.find(x => x.id === id) || {}).name || id;
        const cat = partsCatalog.find(c => !/-R$/.test(c.part)); const embAntes = cat.embalaje;
        productionOrders.push({ id: 'ord-lote', ordNumber: '8801', part: cat.part, machine: nom('200V'), status: 'En Proceso', qtyTarget: 5000, material: 'ALSI', logs: [{ id: 'lg-lote', date: '2026-11-03', turno: 'Mañana', operator: 'Pedro', okPcs: 1000, startTime: '06:00', endTime: '14:00' }] });
        inoferEtiquetasLote({ ordId: 'ord-lote' }); await esperar(100);
        const w = document.getElementById('inoferLotes'); if (!w) return { sinVentana: true };
        const pc = w.querySelector('[data-k="porCajon"]'); pc.value = '300'; pc.dispatchEvent(new Event('change', { bubbles: true })); await esperar(50);
        const ets = inoferLotes.etiquetas(inoferLotes.estado());
        const txt = document.getElementById('inoferLotes').textContent;
        document.querySelector('#inoferLotes [data-tipo="c"]').click(); await esperar(50);
        const etsC = inoferLotes.etiquetas(inoferLotes.estado());
        const dec = u => JSON.parse(decodeURIComponent(escape(atob(u.split('#d=')[1].replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((u.split('#d=')[1].length + 3) % 4)))));
        const dP = dec(ets[0].url), dC = dec(etsC[0].url);
        const hoja = inoferLotes.htmlHoja(ets, 'a4');
        const menu = typeof GRUPOS === 'undefined';
        document.querySelector('#inoferLotes [data-a="cerrar"]').click();
        productionOrders = productionOrders.filter(o => o.id !== 'ord-lote'); cat.embalaje = embAntes;
        return { n: ets.length, qs: ets.map(e => e.q), lt: ets[0].lt, cj: ets[3] && ets[3].cj + '/' + ets[3].ncj, url: ets[0].url, dP, dC, txt: /4 cajones/.test(txt), svgs: (hoja.match(/<svg/g) || []).length };
      });
      ok(!r.sinVentana, 'no se abrió la ventana');
      ok(r.n === 4 && r.qs.join(',') === '300,300,300,100' && r.cj === '4/4' && r.txt, 'cajones: ' + JSON.stringify(r));
      ok(r.lt === '031126-200V' && /lote\.html#d=/.test(r.url) && r.dP.opr === 'Pedro' && r.dP.op === '8801' && r.dP.tu === 'Mañana', 'lote y ficha completa: ' + JSON.stringify(r));
      ok(r.dC.t === 'c' && !r.dC.opr && !r.dC.an && r.dC.lt === '031126-200V' && r.dC.q === 300, 'ficha cliente sin datos internos: ' + JSON.stringify(r.dC));
      ok(r.svgs === 4, 'QR en cada etiqueta: ' + r.svgs);
      // la ficha pública abre sola, sin ingresar
      const p = await A.context().newPage();
      await p.goto('file://' + path.join(FUENTE, 'tienda', 'lote.html') + '#d=' + r.url.split('#d=')[1]);
      const ficha = await p.evaluate(() => document.body.innerText);
      await p.close();
      ok(/031126-200V/.test(ficha) && /Pedro/.test(ficha) && /8801/.test(ficha), 'ficha pública: ' + ficha.slice(0, 200));
    });
    await prueba('Carga rápida: varias piezas en el mismo turno (sigue el horario y avisa si se pisan)', async () => {
      const r = await A.evaluate(async () => {
        const esperar = ms => new Promise(res => setTimeout(res, ms));
        const $ = id => document.getElementById(id);
        const nom = id => (GANTT_MACHINES_CONFIG.find(x => x.id === id) || {}).name || id;
        const F = '2026-10-20';
        const T = inoferCargaRapida.turnos()[0];
        productionOrders.push({ id: 'ord-vp1', ordNumber: '9901', part: 'PZA-VP1', machine: nom('Z30'), status: 'En Proceso', qtyTarget: 5000, unitsPerHour: 100, logs: [] });
        productionOrders.push({ id: 'ord-vp2', ordNumber: '9902', part: 'PZA-VP2', machine: nom('Z30'), status: 'En Proceso', qtyTarget: 5000, unitsPerHour: 100, logs: [] });
        const mitad = (() => { const a = T.ini.split(':').map(Number); const m = a[0] * 60 + a[1] + 240; return String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); })();
        const cargar = async (ini, fin, ok) => { $('crIni').value = ini; $('crFin').value = fin; $('crOk').value = String(ok); $('crOperario').value = 'Prueba'; $('crTurnoForm').requestSubmit(); await esperar(250); };
        inoferCargaRapida.abrir({ maq: 'Z30', ordId: 'ord-vp1', fecha: F, turnoNombre: T.nombre }); await esperar(300);
        await cargar(T.ini, mitad, 400);
        const btn = $('crOtraPieza'); if (!btn) return { sinBoton: true, html: ($('inoferCR') || {}).innerText };
        const sigue = btn.dataset.i;
        btn.click(); await esperar(150);
        document.querySelector('.cr-ord[data-id="ord-vp2"]').click(); await esperar(200);
        const iniPuesto = $('crIni').value, finPuesto = $('crFin').value, banner = /Otra pieza en el mismo turno/.test($('inoferCR').textContent);
        const sinAvisoOtraOp = !(inoferControlTurno(productionOrders.find(o => o.id === 'ord-vp2'), { ok: 400, fecha: F, ini: iniPuesto, fin: finPuesto, turno: T.nombre, paradasMin: 0 }) || []).some(x => /otra orden/.test(x));
        await cargar(iniPuesto, finPuesto, 400);
        const guardada2 = (productionOrders.find(o => o.id === 'ord-vp2').logs || []).length === 1;
        const completo = /turno completo/.test($('inoferCR').textContent) && !$('crOtraPieza');
        // ahora una carga que se pisa
        inoferCargaRapida.abrir({ maq: 'Z30', ordId: 'ord-vp1', fecha: F, turnoNombre: T.nombre }); await esperar(300);
        await cargar(T.ini, mitad, 100);
        const modal = !!$('crPisada'); const noGuardo = productionOrders.find(o => o.id === 'ord-vp1').logs.length === 1;
        const correr = !!document.querySelector('#crPisada [data-p="correr"]');
        document.querySelector('#crPisada [data-p="igual"]').click(); await esperar(300);
        const guardoIgual = productionOrders.find(o => o.id === 'ord-vp1').logs.length === 2;
        productionOrders = productionOrders.filter(o => !/^ord-vp/.test(o.id)); saveProductionOrders();
        return { sigue, mitad, iniPuesto, finPuesto, finT: T.fin, banner, sinAvisoOtraOp, guardada2, completo, modal, noGuardo, correr, guardoIgual };
      });
      ok(!r.sinBoton, 'no aparece "Hice otra pieza": ' + JSON.stringify(r).slice(0, 300));
      ok(r.sigue === r.mitad && r.iniPuesto === r.mitad && r.finPuesto === r.finT && r.banner, 'la segunda pieza no sigue el horario: ' + JSON.stringify(r));
      ok(r.sinAvisoOtraOp && r.guardada2 && r.completo, 'guardar la segunda pieza: ' + JSON.stringify(r));
      ok(r.modal && r.noGuardo && !r.correr && r.guardoIgual, 'aviso de horarios pisados: ' + JSON.stringify(r));
    });
    await prueba('Carga rápida: cambio de molde en el turno y horarios automáticos por pieza', async () => {
      const r = await A.evaluate(async () => {
        const esperar = ms => new Promise(res => setTimeout(res, ms));
        const $ = id => document.getElementById(id);
        const nom = id => (GANTT_MACHINES_CONFIG.find(x => x.id === id) || {}).name || id;
        const F = '2026-10-21', T = inoferCargaRapida.turnos()[0];
        productionOrders.push({ id: 'ord-cm1', ordNumber: '9911', part: 'PZA-CM1', machine: nom('H50'), status: 'En Proceso', qtyTarget: 9000, unitsPerHour: 100, logs: [] });
        productionOrders.push({ id: 'ord-cm2', ordNumber: '9912', part: 'PZA-CM2', machine: nom('H50'), status: 'En Proceso', qtyTarget: 9000, unitsPerHour: 100, logs: [] });
        inoferCargaRapida.abrir({ maq: 'H50', ordId: 'ord-cm1', fecha: F, turnoNombre: T.nombre }); await esperar(300);
        const sinHoras = !document.querySelector('#crTurnoForm input[type="time"]');
        $('crOk').value = '300'; $('crOk').dispatchEvent(new Event('input', { bubbles: true }));
        $('crOperario').value = 'Prueba';
        $('crAddCambio').click(); await esperar(100);
        const su = inoferSetupDe('H50'); const c0 = inoferCargaRapida.estado.cambios[0];
        const sel = document.querySelector('.cr-cop[data-i="0"]'); sel.value = 'ord-cm2'; sel.dispatchEvent(new Event('change', { bubbles: true }));
        const ok2 = document.querySelector('.cr-cok[data-i="0"]'); ok2.value = '200'; ok2.dispatchEvent(new Event('input', { bubbles: true })); await esperar(50);
        const operSigue = $('crOk').value === '300' && $('crOperario').value === 'Prueba';
        const barra = ($('crReparto') || {}).textContent || '';
        $('crTurnoForm').requestSubmit(); await esperar(300);
        const pis = document.querySelector('#crPisada [data-p="igual"]'); if (pis) { pis.click(); await esperar(300); }
        const l1 = productionOrders.find(o => o.id === 'ord-cm1').logs[0], l2 = productionOrders.find(o => o.id === 'ord-cm2').logs[0];
        const pantalla = ($('inoferCR') || {}).textContent || '';
        productionOrders = productionOrders.filter(o => !/^ord-cm/.test(o.id)); saveProductionOrders();
        return { sinHoras, cmo: su.cmo, alis: su.alis, baj: c0.bajada, sub: c0.subida, operSigue, barra: /Así queda el turno/.test(barra), l1: l1 && [l1.startTime, l1.endTime, l1.okPcs], l2: l2 && [l2.startTime, l2.endTime, l2.okPcs, (l2.paradas || [])[0] && l2.paradas[0].codigo, l2.stopMinutes], Tini: T.ini, Tfin: T.fin, pantalla: /Cambio de molde/.test(pantalla) && /Turno guardado/i.test(pantalla) };
      });
      const aM = h => { const [a, b] = h.split(':').map(Number); return a * 60 + b; };
      ok(r.sinHoras && r.operSigue && r.barra, 'pantalla del turno: ' + JSON.stringify(r));
      ok(r.baj + r.sub === Math.round((r.cmo + r.alis) * 60 / 15) * 15 || r.baj + r.sub >= 30, 'tiempos sugeridos del set-up: ' + JSON.stringify(r));
      ok(r.l1 && r.l2 && r.l1[0] === r.Tini && r.l2[1] === r.Tfin && r.l1[1] === r.l2[0] && r.l1[2] === 300 && r.l2[2] === 200, 'horarios por pieza: ' + JSON.stringify(r));
      ok(/^1\s*-/.test(r.l2[3]) && r.l2[4] === r.baj + r.sub, 'cambio de molde como parada en la segunda OP: ' + JSON.stringify(r));
      // el tiempo de cada pieza es proporcional a lo que produjo (300 y 200 a 100 u/h) dentro de lo que dejó el cambio
      const libre = ((aM(r.Tfin) - aM(r.Tini) + 1440) % 1440 || 1440) - r.l2[4];
      const t1 = (aM(r.l1[1]) - aM(r.l1[0]) + 1440) % 1440;
      ok(Math.abs(t1 - libre * 0.6) <= 5 && r.pantalla, 'reparto proporcional: ' + JSON.stringify({ t1, libre }));
    });
    await prueba('Sin errores en la consola', async () => { ok(!A._errs.length && !(B && B._errs.length), 'errores: ' + A._errs.concat(B ? B._errs : []).slice(0, 3).join(' | ')); });
  } finally {
    await b.close(); w.close(); srv.kill();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { }
  }
  const mal = resultados.filter(r => !r.ok);
  console.log(mal.length ? `\n✗ ${mal.length} prueba(s) fallaron: NO se publica.` : `\n✓ ${resultados.length} pruebas OK`);
  process.exit(mal.length ? 1 : 0);
})().catch(e => { console.error('Error en las pruebas: ' + e.message); process.exit(1); });
