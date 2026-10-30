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
fs.writeFileSync(path.join(tmp, 'servidor.js'), fs.readFileSync(path.join(FUENTE, 'servidor', 'servidor.gs'), 'utf8') + '\nreturn { doGet: doGet, doPost: doPost, restablecerClaveAdmin: restablecerClaveAdmin, enviarInformeSemanal: enviarInformeSemanal, copiaDeSeguridad: copiaDeSeguridad };\n');
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
        document.getElementById('crTurnoForm').requestSubmit(); await w(600);
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
        return { empezo, terminado, filas: filas.join(','), ok200V, cronoChip, z, l1: (o1.logs || []).length, ok1: ((o1.logs || [])[0] || {}).okPcs, par2: (l2.paradas || []).map(p => p.min).join(','), origen: l2.origen, listo, usada, toastTxt };
      });
      ok(r.empezo && r.terminado, 'el cronómetro no anduvo: ' + JSON.stringify(r));
      ok(r.filas.startsWith('200V,200N') && Number(r.ok200V) > 0 && r.cronoChip, 'el cierre no se precargó bien: ' + JSON.stringify(r));
      ok(r.l1 === 1 && r.ok1 === Number(r.ok200V) && Number(r.par2) === 30 && r.origen === 'cierre' && r.listo >= 2 && r.usada, 'no guardó el cierre: ' + JSON.stringify(r));
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
