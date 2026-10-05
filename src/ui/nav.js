// nav.js · destinos de la barra inferior (celular) y del riel izquierdo (escritorio). Los usan app.js y dev/kit.html.
// Etiquetas: Hoy · Meses · ¿Me alcanza? · Deudas · Más. El del medio va siempre relleno (es la acción de más valor).

import { h, icon } from './dom.js';

export const NAV = [
  { id: 'hoy', label: 'Hoy', icon: 'home', href: '#/hoy' },
  { id: 'meses', label: 'Meses', icon: 'calendario', href: '#/meses' },
  { id: 'puedo', label: '¿Me alcanza?', icon: 'ayuda-circulo', href: '#/puedo', mid: true },
  { id: 'deudas', label: 'Deudas', icon: 'tarjeta', href: '#/deudas' },
  { id: 'mas', label: 'Más', icon: 'mas-puntos', href: '#/mas' },
];

/**
 * Arma la barra inferior (#tabbar-in) y el riel de escritorio (#rail).
 * buildNav({ tabbar, rail, onClick:(e, item)=>..., onEye:()=>... })
 */
export function buildNav({ tabbar, rail, onClick, onEye } = {}) {
  const click = (n) => (e) => onClick?.(e, n);
  tabbar?.replaceChildren(...NAV.map((n) => h('a', { class: ['tab', n.mid && 'mid'], href: n.href, dataset: { tab: n.id }, onclick: click(n) },
    h('span', { class: 'cap' }, icon(n.icon)), h('span', { class: 'lbl' }, n.label), h('span', { class: 'dot', hidden: true, 'aria-hidden': 'true' }))));
  rail?.replaceChildren(
    h('div', { class: 'rail-brand' }, h('svg', { class: 'brandmark', viewBox: '0 0 64 64', 'aria-hidden': 'true', focusable: 'false' }, h('use', { href: '#i-marca' })), h('b', null, 'Mis Cuentas')),
    h('nav', { 'aria-label': 'Menú principal' }, NAV.map((n, i) => h('a', { class: ['rail-item', n.mid && 'mid'], href: n.href, dataset: { tab: n.id }, title: `Atajo: tecla ${i + 1}`, onclick: click(n) },
      icon(n.icon), h('span', null, n.label), h('span', { class: 'dot', hidden: true, 'aria-hidden': 'true' })))),
    h('div', { class: 'rail-foot' },
      h('button', { type: 'button', class: 'rail-eye', id: 'rail-eye', 'aria-pressed': 'false', onclick: () => onEye?.() }, icon('ojo'), h('span', null, 'Ocultar montos')),
      h('p', { class: 'rail-note' }, 'Tus datos quedan en este equipo.')));
}

/** Marca el destino activo (aria-current) y, si se pasa, qué destinos llevan punto ámbar. */
export function paintNav(activeId, badges = {}) {
  document.querySelectorAll('[data-tab]').forEach((a) => {
    if (a.dataset.tab === activeId) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    const dot = a.querySelector('.dot');
    if (dot) {
      const on = !!badges[a.dataset.tab];
      dot.hidden = !on;
      const base = NAV.find((n) => n.id === a.dataset.tab)?.label || '';
      if (on) a.setAttribute('aria-label', `${base}, hay algo para completar`); else a.removeAttribute('aria-label');
    }
  });
}
