// toast.js · aviso breve sobre la barra inferior, con acción opcional ("Deshacer"). Uno a la vez.
// Vive en la capa superior (popover) para verse también cuando hay una hoja abierta.

import { h, reducedMotion } from './dom.js';

let current = null;

function container() {
  let c = document.getElementById('toast-root');
  if (!c) { c = h('div', { id: 'toast-root' }); document.body.appendChild(c); }
  if (!c.hasAttribute('role')) {
    c.setAttribute('role', 'status');
    c.setAttribute('aria-live', 'polite');
    c.setAttribute('aria-atomic', 'true');
  }
  return c;
}

/**
 * toast('Borrado.', { actionLabel:'Deshacer', onAction: () => ..., duration: 6000, tone:'ok'|'warn' })
 * Mensaje corto, en español rioplatense, con el efecto: "Anotado. Hijo ahora te debe $350.000."
 * Devuelve { dismiss() }.
 */
export function toast(message, { actionLabel, onAction, duration = 6000, tone } = {}) {
  if (current) current.remove(true);
  const root = container();
  let timer;
  let paused = false;
  let removed = false;

  const msg = h('span', { class: 'toast-msg' }, message);
  const action = actionLabel
    ? h('button', { class: 'toast-action', type: 'button', onclick: () => { api.remove(); onAction?.(); } }, actionLabel)
    : null;
  const el = h('div', { class: ['toast', tone && `toast-${tone}`], popover: 'manual' }, msg, action);

  const api = {
    el,
    remove(immediate = false) {
      if (removed) return;
      removed = true;
      clearTimeout(timer);
      if (current === api) current = null;
      const kill = () => { try { el.hidePopover?.(); } catch { /* ya oculto */ } el.remove(); };
      if (immediate || reducedMotion()) kill();
      else { el.classList.add('out'); setTimeout(kill, 180); }
    },
    dismiss() { api.remove(); },
  };
  current = api;
  root.appendChild(el);
  try { el.showPopover?.(); } catch { /* sin popover: queda visible igual por CSS */ }

  const arm = () => {
    clearTimeout(timer);
    if (duration > 0) timer = setTimeout(() => { if (!paused) api.remove(); else arm(); }, duration);
  };
  el.addEventListener('pointerenter', () => { paused = true; });
  el.addEventListener('pointerleave', () => { paused = false; arm(); });
  el.addEventListener('focusin', () => { paused = true; });
  el.addEventListener('focusout', () => { paused = false; arm(); });
  arm();
  return api;
}

export const dismissToast = () => { current?.remove(true); };
