// Arma la pantalla publicada (fuente/res/web/index.html) a partir de las partes de fuente/web/.
// - Une las partes en orden (00_pagina.html, 01_…, 02_…).
// - Reemplaza Tailwind (que se bajaba de internet) por el CSS ya generado, dentro de la página.
// - Mete Chart.js dentro de la página.
// Así la app abre más rápido y funciona 100% sin internet. Uso: node fuente/herramientas/armar_web.js
const fs = require('fs'), path = require('path');
const FUENTE = path.resolve(__dirname, '..');
const DIR = path.join(FUENTE, 'web');
const SALIDA = path.join(FUENTE, 'res', 'web', 'index.html');
const TW_TAG = '<script src="https://cdn.tailwindcss.com/3.4.17"></script>';
const CHART_TAG = '<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>';
const COLORES = ['slate', 'gray', 'zinc', 'neutral', 'stone', 'red', 'rose', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink'];

function unir() {
  const partes = fs.readdirSync(DIR).filter(f => /^\d\d_.*\.html$/.test(f)).sort();
  return partes.map(f => fs.readFileSync(path.join(DIR, f), 'utf8')).join('');
}
function candidatas(html) {
  const out = new Set();
  html.split(/[\s"'`<>=;{}]+/).forEach(t => { if (t && t.length < 120 && /^[!\-]?[a-z0-9@:\[\]\(\)\.\/%#,_+\-]+$/i.test(t) && /[a-z]/.test(t)) out.add(t); });
  // clases armadas con colores variables: border-${c}-400 → border-rose-400, border-amber-400…
  const re = /([a-z0-9:\-\[\]\/]*?-)\$\{[^}]*\}(-\d{2,3}(?:\/\d{1,3})?)/g; let m;
  while ((m = re.exec(html))) COLORES.forEach(c => out.add(m[1] + c + m[2]));
  return [...out];
}
async function generarCss(html) {
  const { chromium } = require('playwright');
  const play = fs.readFileSync(path.join(FUENTE, 'vendor', 'tailwind-play-3.4.17.js'), 'utf8');
  const b = await chromium.launch();
  try {
    const p = await b.newPage();
    await p.setContent('<!doctype html><html><head></head><body><div id="x"></div></body></html>');
    await p.addScriptTag({ content: play });
    const lista = candidatas(html);
    await p.evaluate(lista => { const x = document.getElementById('x'); for (let i = 0; i < lista.length; i += 400) { const d = document.createElement('div'); d.className = lista.slice(i, i + 400).join(' '); x.appendChild(d); } }, lista);
    await p.waitForTimeout(2500);
    const css = await p.evaluate(() => [...document.querySelectorAll('style')].map(s => s.textContent).join('\n'));
    if (css.length < 20000) throw new Error('El CSS generado es demasiado chico (' + css.length + ')');
    return css;
  } finally { await b.close(); }
}
(async () => {
  let html = unir();
  if (!html.includes(TW_TAG) || !html.includes(CHART_TAG)) throw new Error('No encontré las etiquetas de Tailwind o Chart.js en 00_pagina.html');
  const css = await generarCss(html);
  const chart = fs.readFileSync(path.join(FUENTE, 'vendor', 'chart-4.4.1.umd.js'), 'utf8');
  html = html.replace(TW_TAG, () => '<style id="inoferEstilos">' + css.replace(/<\/style/gi, '<\\/style') + '</style>')
             .replace(CHART_TAG, () => '<script>/* Chart.js v4.4.1 (MIT) */\n' + chart.replace(/<\/script/gi, '<\\/script') + '\n</script>');
  fs.writeFileSync(SALIDA, html);
  console.log('armado: ' + path.relative(process.cwd(), SALIDA) + ' (' + Math.round(html.length / 1024) + ' KB, CSS ' + Math.round(css.length / 1024) + ' KB)');
})().catch(e => { console.error('ERROR armando la pantalla: ' + e.message); process.exit(1); });
