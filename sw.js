// sw.js · Mis Cuentas 2.0. Funciona sin internet: precachea TODO lo que la app necesita.
// Estrategia: red primero con caída al cache (así siempre ves la versión más nueva si hay señal)
// y cache primero para fuentes e íconos (no cambian). SUBIR el número de CACHE en cada versión nueva.
const CACHE = 'miscuentas-v2';

// Sin estos archivos la app no puede abrir: si alguno falla, la instalación falla y se reintenta.
const CORE = [
  './', 'index.html', 'manifest.json',
  'styles/tokens.css', 'styles/base.css', 'styles/components.css', 'styles/screens.css',
  'fonts/Inter-var-latin.woff2',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'src/app.js', 'src/engine.js', 'src/calendar.js', 'src/store.js', 'src/format.js', 'src/adapter.js', 'src/derive.js', 'src/demo.js',
  'src/ui/dom.js', 'src/ui/nav.js', 'src/ui/router.js', 'src/ui/sheet.js', 'src/ui/toast.js', 'src/ui/components.js', 'src/ui/charts.js', 'src/ui/fields.js',
];
// Pantallas y editores: se precachean si existen (otros archivos de la app se escriben en paralelo).
const SCREENS = [
  'src/ui/editors.js',
  'src/ui/screens/hoy.js', 'src/ui/screens/meses.js', 'src/ui/screens/puedo.js', 'src/ui/screens/deudas.js',
  'src/ui/screens/tarjeta.js', 'src/ui/screens/medeben.js', 'src/ui/screens/mas.js',
  'src/ui/screens/bienvenida.js', 'src/ui/screens/onboarding.js',
];
const EXTRAS = ['icons/icon-maskable.svg', 'icons/icon-maskable-192.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png'];

const STATIC_RE = /\.(woff2?|png|svg|ico|webp)$/i;
const NETWORK_TIMEOUT = 4000; // con señal mala, a los 4 s se usa lo guardado

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const get = (url) => cache.add(new Request(url, { cache: 'reload' }));
    await Promise.all(CORE.map(get));
    await Promise.allSettled([...SCREENS, ...EXTRAS].map(get));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('miscuentas-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// La app avisa "Hay una versión nueva" y, si la persona toca Actualizar, pide activarla.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function fromCache(request) {
  return caches.match(request, { ignoreSearch: true }).then((hit) => hit || (request.mode === 'navigate' ? caches.match('index.html') : undefined));
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await fromCache(request);
  try {
    const net = fetch(request);
    const res = await (cached
      ? Promise.race([net, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), NETWORK_TIMEOUT))])
      : net);
    if (res && res.ok && res.type === 'basic') cache.put(request, res.clone());
    return res;
  } catch (err) {
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request, { ignoreSearch: true });
  if (cached) return cached;
  const res = await fetch(request);
  if (res && res.ok && res.type === 'basic') (await caches.open(CACHE)).put(request, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/dev/')) return; // la galería de componentes no se guarda
  event.respondWith((STATIC_RE.test(url.pathname) && !url.pathname.endsWith('manifest.json') ? cacheFirst : networkFirst)(request));
});
