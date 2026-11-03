// INOFER MES — Service Worker: permite abrir la app sin internet.
// Los datos de la nube (Apps Script / Gemini) nunca se guardan en caché.
const CACHE = 'inofer-v10';
const CACHE_PUSH = 'inofer-push'; // dónde pedir los avisos de este equipo (lo guarda la página)
const CORE = ['./', './index.html', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png'];
// Los estilos y Chart.js ya vienen dentro de index.html; solo la librería de Excel se baja aparte
const LIBS = ['https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(async c => {
    await c.addAll(CORE);
    await Promise.all(LIBS.map(u => fetch(u, { mode: 'no-cors' }).then(r => c.put(u, r)).catch(() => {})));
  }).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== CACHE_PUSH).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.pathname.startsWith("/api/")) return; // datos de la app Java
  if (/version\.json$|\.jar$|\.exe$|\.zip$/.test(url.pathname)) return; // control de actualizaciones: siempre de internet
  // Solo se cachea la propia app y las librerías conocidas; todo lo demás va directo a internet
  if (url.origin !== self.location.origin && !LIBS.includes(req.url) && !/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) return;
  if (/script\.google|googleusercontent|generativelanguage/.test(url.hostname)) return; // datos en vivo
  // Otras páginas propias (ficha de lote, privacidad): red primero y se guardan con su propio nombre
  if (req.mode === 'navigate' && /\.html$/.test(url.pathname) && !url.pathname.endsWith('index.html')) {
    e.respondWith(fetch(url.pathname, { cache: 'no-cache' }).then(r => { if (r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(url.pathname, cp)); } return r; })
      .catch(() => caches.match(url.pathname)));
    return;
  }
  const isPage = req.mode === 'navigate' || url.pathname.endsWith('index.html');
  if (isPage) {
    // Red primero (para recibir actualizaciones), caché si no hay internet
    e.respondWith(fetch(url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname, { cache: 'no-cache' }).then(r => { if (r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put('./index.html', cp)); } return r; })
      .catch(() => caches.match('./index.html')));
    return;
  }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => {
    if (r && (r.ok || r.type === 'opaque')) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(req, cp)); }
    return r;
  })));
});

// ---------- Avisos al celular ----------
// El aviso llega vacío: se piden los mensajes de este equipo a la nube y se muestran.
self.addEventListener('push', e => {
  e.waitUntil((async () => {
    let msgs = [];
    try {
      const c = await caches.open(CACHE_PUSH); const r = await c.match('./__inofer_push_cfg');
      const cfg = r ? await r.json() : null;
      if (cfg && cfg.url && cfg.pid) {
        const resp = await fetch(cfg.url + (cfg.url.indexOf('?') >= 0 ? '&' : '?') + 'action=pushPendientes&pid=' + encodeURIComponent(cfg.pid) + '&t=' + Date.now());
        const d = await resp.json(); msgs = (d && d.mensajes) || [];
      }
    } catch (err) { }
    try { if (e.data) { const j = e.data.json(); if (j && j.titulo) msgs.push(j); } } catch (err) { }
    if (!msgs.length) msgs = [{ titulo: 'INOFER', cuerpo: 'Tenés un aviso nuevo. Tocá para verlo.', ir: 'hoy' }];
    await Promise.all(msgs.slice(-4).map(m => self.registration.showNotification(m.titulo || 'INOFER', {
      body: m.cuerpo || '', tag: m.tag || undefined, renotify: !!m.tag, icon: './icons/icon-192.png', badge: './icons/icon-192.png',
      data: { ir: m.ir || 'hoy' }, requireInteraction: m.tipo === 'rotura', vibrate: m.tipo === 'rotura' ? [300, 120, 300, 120, 300] : [200]
    })));
  })());
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const ir = (e.notification.data || {}).ir || 'hoy';
  const url = new URL('./index.html?ir=' + encodeURIComponent(ir), self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
    for (const w of ws) { if (w.url.indexOf(self.registration.scope) === 0 && 'focus' in w) { try { w.postMessage({ inoferIr: ir }); } catch (err) { } return w.focus(); } }
    return self.clients.openWindow(url);
  }));
});
// Si el navegador renueva la suscripción, se avisa a la página la próxima vez que abra
self.addEventListener('pushsubscriptionchange', e => {
  e.waitUntil(caches.open(CACHE_PUSH).then(c => c.put('./__inofer_push_renovar', new Response('1'))));
});
