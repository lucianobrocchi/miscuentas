// app.js · arranque de Mis Cuentas 2.0: carga el estado, arma el contexto (ctx) que reciben las pantallas,
// el router por hash, la barra inferior / riel de escritorio, la privacidad, el tema y el service worker.
// Las pantallas viven en src/ui/screens/<nombre>.js y se cargan bajo demanda (ver ROUTES).
// Contrato de pantalla: export default { id, title, mount(root, ctx, params) } -> opcionalmente devuelve unmount().

import { load, save } from './store.js';
import { createRouter } from './ui/router.js';
import * as sheet from './ui/sheet.js';
import { toast } from './ui/toast.js';
import * as ui from './ui/components.js';
import * as fields from './ui/fields.js';
import * as charts from './ui/charts.js';
import { NAV, buildNav, paintNav as paintNavActive } from './ui/nav.js';
import { h, icon, fmt, announce, lsGet } from './ui/dom.js';

const VERSION = '2.0.0';

// ---------------------------------------------------------------- tabla de rutas (contrato E)
// path: ':param' obligatorio · ':param?' opcional. screen = archivo en src/ui/screens/. tab = destino activo de la barra.
// parent: a dónde vuelve el botón "Volver" de las pantallas hijas (función de la ruta o string).
const ROUTES = [
  { name: 'hoy', path: '/hoy', screen: 'hoy', tab: 'hoy', title: 'Hoy' },
  { name: 'meses', path: '/meses/:key?', screen: 'meses', tab: 'meses', title: 'Meses' },
  { name: 'puedo', path: '/puedo', screen: 'puedo', tab: 'puedo', title: 'Probá antes de gastar' },
  { name: 'tarjeta', path: '/deudas/tarjeta', screen: 'tarjeta', tab: 'deudas', title: 'Tarjeta', parent: '#/deudas' },
  { name: 'medeben', path: '/deudas/medeben/:personId?', screen: 'medeben', tab: 'deudas', title: 'Me deben', parent: (r) => (r.params.personId ? '#/deudas/medeben' : null) },
  { name: 'deudas', path: '/deudas', screen: 'deudas', tab: 'deudas', title: 'Deudas' },
  { name: 'mas', path: '/mas/:sec?', screen: 'mas', tab: 'mas', title: 'Más', parent: (r) => (r.params.sec ? '#/mas' : null) },
  { name: 'bienvenida', path: '/bienvenida', screen: 'bienvenida', notabs: true, title: 'Bienvenida' },
  { name: 'armar', path: '/armar/:step', screen: 'onboarding', notabs: true, title: 'Armá tu panorama' },
];

// ---------------------------------------------------------------- fecha de "hoy" (inyectable: ?hoy=2026-10-04)
const hoyParam = (() => { try { return new URLSearchParams(location.search).get('hoy'); } catch { return null; } })();
const today = () => (hoyParam && /^\d{4}-\d{2}-\d{2}$/.test(hoyParam) ? new Date(`${hoyParam}T12:00:00`) : new Date());

// ---------------------------------------------------------------- estado
let state = load(undefined, { today: today() });
let derive = {};
let formatMod = fmt;
let router = null;
let renderToken = 0;
let unmountCurrent = null;
let currentScreenName = null;
let headerSet = false;
let badges = { mas: false, deudas: false };

const clone = (o) => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));
const hasData = (s) => !!(s && ((s.incomes || []).length || (s.expenses || []).length || (s.debts || []).length || (s.receivables || []).length));
const defaultHash = () => (state.settings?.onboarded || hasData(state) ? '#/hoy' : '#/bienvenida');

// ---------------------------------------------------------------- preferencias visibles (tema, letra, privacidad)
const metaOrig = new Map();
function applyPrefs() {
  const s = state.settings || {};
  const root = document.documentElement;
  if (s.theme === 'light' || s.theme === 'dark') root.setAttribute('data-theme', s.theme); else root.removeAttribute('data-theme');
  if (s.fontSize === 'grande' || s.fontSize === 'masgrande') root.setAttribute('data-fontsize', s.fontSize); else root.removeAttribute('data-fontsize');
  if (s.privacy) root.setAttribute('data-privacy', 'on'); else root.removeAttribute('data-privacy');
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    if (!metaOrig.has(m)) metaOrig.set(m, m.getAttribute('content'));
    // tema forzado: el color de la barra del navegador es el fondo (--bg) del tema elegido; en automático se restauran los de index.html
    const forced = s.theme === 'dark' || s.theme === 'light' ? getComputedStyle(root).getPropertyValue('--bg').trim() : '';
    m.setAttribute('content', forced || metaOrig.get(m));
  });
  // espejo para el script de index.html (evita el destello al abrir)
  ui.setKnownNames(state.people);   // para que el ojo también oculte los nombres que aparecen dentro de las frases
  paintEye();
}

function setPrivacy(on) {
  state = { ...state, settings: { ...state.settings, privacy: !!on } };
  save(state);
  applyPrefs();
  render({ keepScroll: true });
  announce(on ? 'Montos ocultos' : 'Montos visibles');
}

// ---------------------------------------------------------------- update con Deshacer
/**
 * update(fn, { undoLabel })  aplica fn(borrador) sobre una copia del estado, guarda, re-renderiza.
 * fn puede mutar el borrador o devolver un estado nuevo completo. Con undoLabel muestra un toast con "Deshacer".
 * Devuelve el estado nuevo.
 */
function update(fn, { undoLabel, rerender = true, onUndo } = {}) {
  const before = state;
  const draft = clone(state);
  const out = fn(draft);
  state = out && typeof out === 'object' ? out : draft;
  save(state);
  applyPrefs();
  if (rerender) render({ keepScroll: true });
  if (undoLabel) {
    toast(undoLabel, {
      actionLabel: 'Deshacer',
      onAction: () => {
        state = before;
        save(state);
        applyPrefs();
        render({ keepScroll: true });
        onUndo?.();
        toast('Listo, volvió a como estaba.');
      },
    });
  }
  return state;
}

// ---------------------------------------------------------------- navegación
async function nav(hash, opts) {
  if (sheet.isOpen()) await sheet.closeAll();
  router.go(hash, opts);
}
const back = (fallback) => router.back(fallback);

// ---------------------------------------------------------------- editores (lazy)
let editorsMod = null;
let editorsInit = false;
const editors = {
  async open(kind, id, opts) {
    try {
      editorsMod ||= await import('./ui/editors.js');
    } catch (e) {
      console.error('editors.js no se pudo cargar', e);
      toast('Esta opción se está terminando de construir.');
      return undefined;
    }
    const api = editorsMod.default && typeof editorsMod.default === 'object' ? editorsMod.default : editorsMod;
    if (!editorsInit) { editorsInit = true; (editorsMod.init || api.init)?.(ctx); }
    const open = api.open || editorsMod.open;
    if (typeof open !== 'function') throw new Error('src/ui/editors.js debe exportar open(kind, id, opts)');
    return open.length >= 4 ? open(ctx, kind, id, opts) : open(kind, id, opts);
  },
};

// ---------------------------------------------------------------- contexto para las pantallas
const ctx = {
  get state() { return state; },
  update,
  get derive() { return derive; },
  get format() { return formatMod; },
  nav,
  back,
  sheet,
  toast,
  ui: { ...ui, fields, fmt, h, icon },
  charts,
  editors,
  today,
  /** Encabezado de la pantalla: header({ eyebrow:'Domingo 4 de octubre', title:'Hola, Ana', back:true | '#/deudas' }) · header(false) lo oculta. */
  header(cfg) { headerSet = true; renderTopbar(cfg); },
  /** Puntos ámbar de la barra: setBadges({ mas:true, deudas:false }) */
  setBadges(b) { badges = { ...badges, ...b }; paintBadges(); },
  /** Cambia el modo visual del <body> (p. ej. 'revelacion' para el fondo oscuro). screenMode(null) vuelve al de la ruta. */
  screenMode(name) { document.body.dataset.screen = name || router.current()?.name || ''; },
  /** Re-dibuja la pantalla actual (sin tocar el estado). */
  rerender: () => render({ keepScroll: true }),
  isPrivate: () => document.documentElement.dataset.privacy === 'on',
  setPrivacy,
  route: () => router.current(),
  version: VERSION,
};

// ---------------------------------------------------------------- barra superior
function renderTopbar(cfg) {
  const bar = document.getElementById('topbar');
  if (!bar) return;
  if (cfg === false) { bar.hidden = true; return; }
  bar.hidden = false;
  const route = router.current();
  const c = typeof cfg === 'object' && cfg ? cfg : {};
  let backHash = c.back;
  if (backHash === true || backHash === undefined) {
    const def = route && ROUTES.find((r) => r.name === route.name)?.parent;
    const p = typeof def === 'function' ? def(route) : def;
    backHash = backHash === true ? (p || '#/hoy') : p || null;
  }
  const eye = h('button', {
    type: 'button', class: 'icon-btn eye-top', id: 'eye-btn', 'aria-label': ctx.isPrivate() ? 'Mostrar montos' : 'Ocultar montos',
    'aria-pressed': String(ctx.isPrivate()), onclick: () => setPrivacy(!ctx.isPrivate()),
  }, icon(ctx.isPrivate() ? 'ojo-tachado' : 'ojo'));
  bar.replaceChildren(
    h('div', { class: 'topbar-main' },
      backHash ? h('button', { type: 'button', class: 'icon-btn back', 'aria-label': 'Volver', onclick: () => back(backHash) }, icon('volver')) : null,
      h('div', { class: 'topbar-text' },
        c.eyebrow ? h('span', { class: 'topbar-eyebrow' }, c.eyebrow) : null,
        c.title ? h('span', { class: 'topbar-title' }, c.title) : null)),
    h('div', { class: 'topbar-actions' }, c.actions || null, eye));
}
function paintEye() {
  const on = document.documentElement.dataset.privacy === 'on';
  const b = document.getElementById('eye-btn');
  if (b) {
    b.setAttribute('aria-label', on ? 'Mostrar montos' : 'Ocultar montos');
    b.setAttribute('aria-pressed', String(on));
    b.replaceChildren(icon(on ? 'ojo-tachado' : 'ojo'));
  }
  const r = document.getElementById('rail-eye');
  if (r) {
    r.setAttribute('aria-pressed', String(on));
    r.replaceChildren(icon(on ? 'ojo-tachado' : 'ojo'), h('span', null, on ? 'Mostrar montos' : 'Ocultar montos'));
  }
}

// ---------------------------------------------------------------- barra inferior y riel
function buildShellNav() {
  buildNav({ tabbar: document.getElementById('tabbar-in'), rail: document.getElementById('rail'), onClick: tabClick, onEye: () => setPrivacy(!ctx.isPrivate()) });
}
function tabClick(e, n) {
  const r = router.current();
  if (r && r.tab === n.id && r.hash === n.href) { e.preventDefault(); window.scrollTo({ top: 0 }); return; }
  if (sheet.isOpen()) { e.preventDefault(); nav(n.href); }
}
function paintNav(route) {
  paintNavActive(route?.tab || null, badges);
  document.body.toggleAttribute('data-notabs', !!route?.notabs);
}
function paintBadges() { paintNavActive(router?.current()?.tab || null, badges); }

// ---------------------------------------------------------------- avisos fijos (ejemplo, sin internet)
function paintBanners() {
  const box = document.getElementById('banners');
  if (!box) return;
  box.replaceChildren();
  if (state.settings?.demo) {
    box.appendChild(ui.ribbon({ text: 'Esto es un ejemplo, no son tus números', actionLabel: 'Cargar lo mío', onClick: loadMine }));
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    box.appendChild(ui.pill('Sin internet no pasa nada: todo está guardado en tu celular.', 'pill-offline-box'));
  }
}
async function loadMine() {
  const ok = await sheet.confirm({
    title: '¿Cargar lo tuyo?',
    message: 'Se borra el ejemplo y empezás con tus propios datos. El ejemplo no se puede recuperar, pero siempre lo podés volver a ver desde la bienvenida si todavía no cargaste nada.',
    confirmLabel: 'Sí, cargar lo mío',
    cancelLabel: 'Seguir mirando el ejemplo',
  });
  if (!ok) return;
  const store = await import('./store.js');
  const prefs = { theme: state.settings?.theme, fontSize: state.settings?.fontSize, privacy: state.settings?.privacy };
  update(() => { const e = store.emptyState(today()); Object.assign(e.settings, Object.fromEntries(Object.entries(prefs).filter(([, v]) => v !== undefined))); return e; }, { rerender: false });
  paintBanners();
  nav('#/armar/1');
}

// ---------------------------------------------------------------- render de pantallas
const moduleCache = new Map();
async function loadScreen(name) {
  if (moduleCache.has(name)) return moduleCache.get(name);
  try {
    const mod = await import(`./ui/screens/${name}.js`);
    const def = mod.default || mod;
    moduleCache.set(name, def);
    return def;
  } catch (e) {
    console.warn(`[Mis Cuentas] pantalla "${name}" no disponible todavía`, e);
    moduleCache.set(name, null);
    return null;
  }
}

function placeholder(root, title, text, retry) {
  root.replaceChildren(ui.empty({
    title, text, art: 'obra',
    // en Hoy un "Volver a Hoy" no lleva a ningún lado: ahí no se ofrece acción
    action: retry ? { label: 'Probar de nuevo', onClick: retry } : (router.current()?.name === 'hoy' ? undefined : { label: 'Volver a Hoy', href: '#/hoy' }),
  }));
}

async function render({ keepScroll = false } = {}) {
  const route = router.current();
  if (!route) return;
  const token = ++renderToken;
  const view = document.getElementById('view');
  const sameScreen = currentScreenName === route.screen;
  const scrollY = keepScroll || sameScreen ? window.scrollY : 0;

  const def = await loadScreen(route.screen);
  if (token !== renderToken) return;

  try { unmountCurrent?.(); } catch (e) { console.error('unmount', e); }
  unmountCurrent = null;

  const root = h('div', { class: 'screen', dataset: { screen: route.screen } });
  view.replaceChildren(root);
  currentScreenName = route.screen;
  document.body.dataset.screen = route.name;
  headerSet = false;
  const meta = ROUTES.find((r) => r.name === route.name) || {};
  const title = (def && typeof def.title === 'function' ? def.title(ctx, route.params) : def?.title) || meta.title || 'Mis Cuentas';
  document.title = route.name === 'hoy' ? 'Mis Cuentas' : `${title} · Mis Cuentas`;
  renderTopbar({ title: route.name === 'hoy' ? '' : title, back: undefined });
  paintNav(route);
  paintBanners();

  sheet.beginRender();
  if (!def || typeof def.mount !== 'function') {
    placeholder(root, 'Esta pantalla se está construyendo', 'Mientras tanto podés seguir usando el resto de la app.');
  } else {
    try {
      const res = await def.mount(root, ctx, route.params, route);
      if (token !== renderToken) { try { typeof res === 'function' && res(); } catch { /* nada */ } return; }
      if (typeof res === 'function') unmountCurrent = res;
    } catch (e) {
      console.error(`[Mis Cuentas] error en la pantalla "${route.screen}"`, e);
      placeholder(root, 'Algo no salió como esperábamos', 'Tus datos están a salvo. Probá de nuevo; si sigue igual, volvé a Hoy.', () => render());
    }
  }
  sheet.endRender();
  paintBadges();
  window.scrollTo({ top: scrollY });
}

function onRoute(route, { kind }) {
  paintNav(route);
  render({ keepScroll: false }).then(() => {
    if (kind === 'push' || kind === 'pop') {
      document.getElementById('view')?.focus({ preventScroll: true });
      announce(document.title);
    }
  });
}

// ---------------------------------------------------------------- arranque
async function loadLogic() {
  const [d, f] = await Promise.all([
    import('./derive.js').catch((e) => { console.warn('[Mis Cuentas] derive.js todavía no está disponible', e); return null; }),
    import('./format.js').catch(() => null),
  ]);
  derive = d || {};
  formatMod = f || fmt;
}

function wireGlobalEvents() {
  addEventListener('online', paintBanners);
  addEventListener('offline', paintBanners);
  // atajos de escritorio: 1-5 para ir a cada destino
  addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (sheet.isOpen()) return;
    const i = '12345'.indexOf(e.key);
    if (i >= 0 && matchMedia('(min-width: 1024px)').matches && !router.current()?.notabs) nav(NAV[i].href);
  });
}

function registerSW() {
  if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol) || new URLSearchParams(location.search).has('nosw')) return;
  let updating = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (updating) location.reload(); });
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const notify = () => toast('Hay una versión nueva', {
      actionLabel: 'Actualizar', duration: 0,
      onAction: () => { updating = true; reg.waiting?.postMessage({ type: 'SKIP_WAITING' }); setTimeout(() => location.reload(), 1500); },
    });
    if (reg.waiting && navigator.serviceWorker.controller) notify();
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) notify(); });
    });
  }).catch(() => { /* sin service worker la app anda igual */ });
}

function warmCache() {
  const idle = window.requestIdleCallback || ((f) => setTimeout(f, 2500));
  idle(() => {
    const files = [...new Set(ROUTES.map((r) => `./ui/screens/${r.screen}.js`)), './ui/editors.js', './derive.js', './adapter.js', './demo.js'];
    files.forEach((f) => fetch(new URL(f, import.meta.url)).catch(() => {}));
  });
}

function boot() {
  router = createRouter({
    routes: ROUTES, fallback: defaultHash(), onChange: onRoute,
  });
  applyPrefs();
  buildShellNav();
  paintEye();
  wireGlobalEvents();
  if (!location.hash || location.hash === '#' || location.hash === '#/') history.replaceState(null, '', defaultHash());
  loadLogic().then(() => {
    router.start();
    registerSW();
    warmCache();
    try { if (matchMedia('(display-mode: standalone)').matches) navigator.storage?.persist?.(); } catch { /* nada */ }
  });
}

window.miscuentas = { ctx, ROUTES, version: VERSION };
boot();
void lsGet;
