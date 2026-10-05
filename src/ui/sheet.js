// sheet.js · hojas inferiores con <dialog>. En celular suben desde abajo; en escritorio (>=1024px) son un
// diálogo centrado de 560px. Foco atrapado (showModal), foco devuelto al disparador, Esc / toque en el fondo /
// botón "Cerrar" / swipe del handle para cerrar, y el botón Atrás del celular cierra la hoja (no la pantalla).
// Nada de confirm()/alert(): para confirmar usá sheet.confirm().

import { h, icon, reducedMotion, announce } from './dom.js';
import { btn, txt } from './components.js';

const stack = [];            // hojas abiertas, la última es la de arriba
const routeEntries = new Map(); // hojas "de ruta" (viven en la URL, ej. #/meses/2026-12): clave -> entrada
let seq = 0;
let pendingBacks = 0;        // history.back()/go() que nosotros mismos pedimos y todavía no terminaron
let waiters = [];

const rootEl = () => document.getElementById('sheet-root') || document.body;
const histCount = () => stack.filter((s) => !s.route && !s.closing).length;

function afterSettled(fn) {
  if (!pendingBacks) fn();
  else waiters.push(fn);
}
function flushWaiters() {
  const w = waiters; waiters = [];
  w.forEach((f) => f());
}
function requestBack(n = 1) {
  pendingBacks++;
  try { n === 1 ? history.back() : history.go(-n); } catch { pendingBacks--; return; }
  setTimeout(() => { if (pendingBacks) { pendingBacks = 0; flushWaiters(); } }, 500);
}

addEventListener('popstate', () => {
  if (pendingBacks) {
    pendingBacks--;
    if (!pendingBacks) flushWaiters();
    return;
  }
  const sd = (history.state && history.state.sd) || 0;
  while (histCount() > sd) {
    const top = [...stack].reverse().find((s) => !s.route && !s.closing);
    if (!top) break;
    if (top.opts.dirty && top.opts.dirty()) {            // cambios sin guardar: no se cierra
      try { history.pushState({ sd: histCount() }, ''); } catch { /* sin historial */ }
      showGuard(top);
      break;
    }
    finish(top, undefined, { fromPop: true });
  }
  if (sd > histCount()) { try { history.replaceState(histCount() ? { sd: histCount() } : null, ''); } catch { /* nada */ } }
});

/**
 * Abre una hoja.
 * opts: {
 *   title,                       // string. Obligatorio (accesibilidad: aria-labelledby)
 *   render(body, close),         // llena `body` (div scrolleable); close(result) cierra
 *   footer,                      // Node | (close, handle) => Node | array. Barra fija abajo (botón Guardar, etc.)
 *   onClose(result),             // se llama al cerrar (cualquier camino)
 *   size: 'auto' | 'tall',       // tall = 85% de alto (detalle de un mes)
 *   dirty: () => boolean,        // si devuelve true, cerrar pide confirmación en la misma hoja
 *   focus: 'selector',           // qué enfocar al abrir (por defecto el título; con [autofocus] se respeta)
 *   route: true,                 // la hoja "vive" en la URL actual (ej. #/meses/2026-12): no empuja historial
 *   onDismiss(),                 // solo con route:true: qué hacer cuando la persona la cierra (ej. router.back)
 *   closeLabel: 'Cerrar',
 *   cls: 'clase-extra',
 * }
 * Devuelve { el, body, close(result), setTitle(t), setFooter(node), closed: Promise<result> }.
 */
export function open(opts) {
  const entry = { id: ++seq, opts, route: !!opts.route || !!opts.routeKey, routeKey: opts.routeKey || null, fresh: true, closing: false, trigger: document.activeElement };
  if (entry.routeKey) routeEntries.set(entry.routeKey, entry);
  const titleId = `sheet-title-${entry.id}`;
  let resolveClosed;
  const closed = new Promise((r) => { resolveClosed = r; });
  entry.resolve = resolveClosed;

  const titleEl = h('h2', { class: 't-sheet sheet-title', id: titleId, tabindex: '-1' }, txt(opts.title || ''));
  const body = h('div', { class: 'sheet-body' });
  const foot = h('footer', { class: 'sheet-foot', hidden: true });
  const closeBtn = h('button', { class: 'sheet-close', type: 'button', onclick: () => dismiss(entry) },
    icon('x'), h('span', null, opts.closeLabel || 'Cerrar'));
  const grab = h('div', { class: 'sheet-grab' }, h('span', { class: 'sheet-handle', 'aria-hidden': 'true' }));
  const panel = h('div', { class: ['sheet-panel', opts.size === 'tall' && 'tall', opts.cls] }, grab,
    h('header', { class: 'sheet-head' }, titleEl, closeBtn), body, foot);
  const dlg = h('dialog', { class: 'sheet', 'aria-labelledby': titleId }, panel);
  entry.dlg = dlg; entry.panel = panel; entry.body = body; entry.foot = foot; entry.titleEl = titleEl;

  const handle = {
    el: dlg,
    body,
    closed,
    close: (result) => { dismissWith(entry, result); },
    setTitle: (t) => { titleEl.replaceChildren(...[].concat(txt(t)).map((n) => (n instanceof Node ? n : document.createTextNode(String(n))))); },
    setFooter: (f) => setFoot(entry, f, handle),
  };
  entry.handle = handle;

  // eventos del <dialog>
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); if (stack[stack.length - 1] === entry) dismiss(entry); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dismiss(entry); });
  enableSwipe(entry, grab);

  rootEl().appendChild(dlg);
  stack.push(entry);
  document.body.classList.add('sheet-open');
  try { dlg.showModal(); } catch { dlg.setAttribute('open', ''); }

  // historial: una entrada por hoja (salvo hojas "de ruta")
  if (!entry.route) {
    afterSettled(() => {
      if (entry.closing) return;
      try { history.pushState({ sd: histCount() }, ''); entry.pushed = true; } catch { /* sin historial */ }
    });
  }

  if (opts.render) opts.render(body, handle.close);
  if (opts.footer) setFoot(entry, opts.footer, handle);

  // foco: título (lectores de pantalla) salvo que haya algo con autofocus
  requestAnimationFrame(() => {
    const target = (opts.focus && body.querySelector(opts.focus)) || body.querySelector('[autofocus]') || titleEl;
    try { target.focus({ preventScroll: true }); } catch { /* nada */ }
  });
  return handle;
}

function setFoot(entry, f, handle) {
  const node = typeof f === 'function' ? f(handle.close, handle) : f;
  entry.foot.replaceChildren();
  const list = Array.isArray(node) ? node : [node];
  list.filter(Boolean).forEach((n) => entry.foot.appendChild(n));
  entry.foot.hidden = !entry.foot.childNodes.length;
}

/** Intento de cierre por la persona (X, Esc, fondo, swipe). Respeta `dirty` y `onDismiss`. */
function dismiss(entry) {
  if (entry.closing) return;
  if (entry.opts.dirty && entry.opts.dirty()) { showGuard(entry); return; }
  if (entry.route && entry.opts.onDismiss) { entry.opts.onDismiss(); return; }
  finish(entry, undefined, {});
}
function dismissWith(entry, result) {
  if (entry.closing) return;
  finish(entry, result, {});
}

/** Cierra de verdad. */
function finish(entry, result, { fromPop = false, silent = false } = {}) {
  if (entry.closing) return;
  entry.closing = true;
  if (entry.routeKey && routeEntries.get(entry.routeKey) === entry) routeEntries.delete(entry.routeKey);
  const i = stack.indexOf(entry);
  if (i >= 0) stack.splice(i, 1);
  if (!entry.route && !fromPop && entry.pushed) requestBack(1);
  const done = () => {
    try { entry.dlg.close(); } catch { /* ya cerrada */ }
    entry.dlg.remove();
    if (!stack.length) document.body.classList.remove('sheet-open');
    const t = entry.trigger;
    if (t && t.isConnected && typeof t.focus === 'function') { try { t.focus({ preventScroll: true }); } catch { /* nada */ } }
    else document.getElementById('view')?.focus({ preventScroll: true });
    entry.resolve(result);
    if (!silent) entry.opts.onClose?.(result);
  };
  if (reducedMotion()) { entry.dlg.classList.add('closing'); setTimeout(done, 80); }
  else { entry.dlg.classList.add('closing'); setTimeout(done, 210); }
}

/** Aviso interno "Tenés cambios sin guardar". */
function showGuard(entry) {
  if (entry.panel.querySelector('.sheet-guard')) return;
  const keep = btn({ label: 'Seguir editando', variant: 'primary', onClick: () => g.remove() });
  const leave = btn({ label: 'Salir sin guardar', variant: 'danger', onClick: () => { g.remove(); entry.opts.dirty = null; if (entry.route && entry.opts.onDismiss) entry.opts.onDismiss(); else finish(entry, undefined, {}); } });
  const g = h('div', { class: 'sheet-guard', role: 'alertdialog', 'aria-labelledby': `guard-t-${entry.id}` },
    h('div', { class: 'sheet-guard-card stack-3' },
      h('h3', { class: 't-h2', id: `guard-t-${entry.id}` }, 'Tenés cambios sin guardar'),
      h('p', { class: 'muted' }, 'Si salís ahora, se pierde lo que cambiaste.'),
      keep, leave));
  entry.panel.appendChild(g);
  keep.focus();
}

/** Swipe hacia abajo del handle. Siempre hay botón "Cerrar" equivalente. */
function enableSwipe(entry, grab) {
  let startY = 0; let lastY = 0; let lastT = 0; let v = 0; let dragging = false;
  grab.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    dragging = true; startY = lastY = e.clientY; lastT = e.timeStamp; v = 0;
    grab.setPointerCapture?.(e.pointerId);
    entry.panel.classList.add('dragging');
  });
  grab.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dy = Math.max(0, e.clientY - startY);
    const dt = Math.max(1, e.timeStamp - lastT);
    v = (e.clientY - lastY) / dt; lastY = e.clientY; lastT = e.timeStamp;
    entry.panel.style.setProperty('--drag', dy + 'px');
  });
  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    entry.panel.classList.remove('dragging');
    const dy = Math.max(0, e.clientY - startY);
    entry.panel.style.removeProperty('--drag');
    if (dy > 110 || v > 0.7) dismiss(entry);
  };
  grab.addEventListener('pointerup', end);
  grab.addEventListener('pointercancel', end);
}

/**
 * Hoja de confirmación con consecuencias (reemplaza confirm()). Devuelve Promise<boolean>.
 * confirm({ title:'¿Borrar el préstamo de $17.000?', message:'Dejás de pagarlo en la proyección...',
 *           confirmLabel:'Borrar', cancelLabel:'Cancelar', tone:'bad' | 'brand' })
 * `message` puede ser string o Node. Borrar siempre con tone:'bad'; después mostrá toast "Borrado. Deshacer".
 */
export function confirm({ title, message, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', tone = 'brand', icon: ic } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const answer = (v, close) => { answered = true; resolve(v); close(v); };
    open({
      title,
      cls: 'sheet-confirm',
      render(body) {
        body.appendChild(h('div', { class: 'stack-3' },
          ic ? h('div', { class: ['icon-tile', `tone-bg-${tone === 'bad' ? 'bad' : 'brand'}`] }, icon(ic)) : null,
          message instanceof Node ? message : h('p', { class: 't-body' }, txt(message || ''))));
      },
      footer: (close) => [
        btn({ label: confirmLabel, variant: tone === 'bad' ? 'danger' : 'primary', onClick: () => answer(true, close) }),
        btn({ label: cancelLabel, variant: 'text', onClick: () => answer(false, close) }),
      ],
      onClose: () => { if (!answered) resolve(false); },
    });
  });
}

/** Hoja informativa simple (glosario, "Qué supone esta fecha"): título, contenido y un botón de cierre. */
export function info({ title, content, actionLabel = 'Entendido' }) {
  return open({
    title,
    render: (body) => { body.appendChild(content instanceof Node ? content : h('p', { class: 't-body' }, txt(content))); },
    footer: (close) => btn({ label: actionLabel, variant: 'secondary', onClick: () => close() }),
  });
}

/** Cantidad de hojas abiertas. */
export const count = () => stack.length;
export const isOpen = () => stack.length > 0;

/**
 * Cierra todas las hojas (también sus entradas de historial) y resuelve cuando el historial se asentó.
 * Úsalo antes de navegar desde adentro de una hoja: await closeAll(); nav('#/deudas/tarjeta').
 * ctx.nav() ya lo hace solo.
 */
export function closeAll() {
  if (!stack.length) return Promise.resolve();
  const n = histCount();
  const pushedCount = stack.filter((s) => !s.route && s.pushed).length;
  [...stack].reverse().forEach((s) => { s.closing = true; });
  const all = [...stack];
  stack.length = 0;
  all.forEach((entry) => {
    entry.dlg.classList.add('closing');
    setTimeout(() => {
      try { entry.dlg.close(); } catch { /* nada */ }
      entry.dlg.remove();
      entry.resolve(undefined);
      entry.opts.onClose?.(undefined);
    }, reducedMotion() ? 0 : 120);
  });
  document.body.classList.remove('sheet-open');
  if (pushedCount) {
    return new Promise((res) => { pendingBacks++; waiters.push(res); try { history.go(-pushedCount); } catch { pendingBacks--; flushWaiters(); } setTimeout(() => { if (pendingBacks) { pendingBacks = 0; flushWaiters(); } }, 500); });
  }
  void n;
  return Promise.resolve();
}

/**
 * Hoja de ruta: una hoja que "vive" en la URL (ej. el detalle de un mes en #/meses/2026-12).
 * Se declara desde mount() de la pantalla y es IDEMPOTENTE: si app.js vuelve a montar la pantalla (cambió el estado),
 * openRoute con la misma clave NO abre otra hoja: vuelve a llenar la que está abierta (conserva el scroll).
 * Si la ruta cambia y la nueva pantalla no la declara, app.js la cierra sola. No empuja historial.
 * opts: los de open() más onDismiss() (qué hacer cuando la persona la cierra: ej. () => ctx.back('#/meses')).
 */
export function openRoute(key, opts) {
  const ex = routeEntries.get(key);
  if (ex && !ex.closing) {
    ex.fresh = true;
    ex.opts = { ...ex.opts, ...opts };
    ex.handle.setTitle(opts.title || '');
    const keep = ex.body.scrollTop;
    ex.body.replaceChildren();
    opts.render?.(ex.body, ex.handle.close);
    ex.body.scrollTop = keep;
    if (opts.footer) setFoot(ex, opts.footer, ex.handle);
    return ex.handle;
  }
  return open({ ...opts, routeKey: key, route: true });
}

/** Lo usa app.js alrededor de cada mount(): las hojas de ruta no re-declaradas durante el mount se cierran al terminar. */
export function beginRender() { routeEntries.forEach((e) => { e.fresh = false; }); }
export function endRender() {
  [...routeEntries.values()].filter((e) => !e.fresh && !e.closing).forEach((e) => finish(e, undefined, { silent: false }));
}

/** Cierra todas las hojas de ruta sin disparar onDismiss. */
export function closeRouteSheets() {
  [...routeEntries.values()].forEach((s) => finish(s, undefined, { silent: false }));
}

export { announce };
