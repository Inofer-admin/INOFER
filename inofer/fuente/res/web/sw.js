// INOFER MES — Service Worker: permite abrir la app sin internet.
// Los datos de la nube (Apps Script / Gemini) nunca se guardan en caché.
const CACHE = 'inofer-v7';
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
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
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
