// _install.js · "Instalala en tu pantalla de inicio" (Bienvenida, antes de pedir datos, y hoja de la segunda visita) y detección del entorno.
// Lo que se carga en el navegador de WhatsApp o en Safari NO es lo mismo que lo que se carga en la app instalada: por eso se avisa ANTES.

import { h } from './dom.js';
import { estilos } from './_ed-style.js';

/** Qué navegador es: { ios, android, enApp (navegador interno de WhatsApp, Facebook, etc.), instalada, escritorio }. */
export function detectarEntorno(nav = typeof navigator !== 'undefined' ? navigator : {}, win = typeof window !== 'undefined' ? window : {}) {
  const ua = nav.userAgent || '';
  const ios = /iPhone|iPad|iPod/.test(ua) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
  const android = /Android/.test(ua);
  const marcaInterna = /FBAN|FBAV|FB_IAB|Instagram|WhatsApp|Line\/|Snapchat|MicroMessenger|Twitter/i.test(ua);
  const webviewAndroid = android && /; wv\)/.test(ua);
  const webviewIos = ios && !/Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  let instalada = false;
  try { instalada = nav.standalone === true || !!win.matchMedia?.('(display-mode: standalone)').matches; } catch { /* nada */ }
  let escritorio = false;
  try { escritorio = !!win.matchMedia?.('(hover: hover) and (pointer: fine)').matches && !ios && !android; } catch { /* nada */ }
  return { ios, android, enApp: marcaInterna || webviewAndroid || webviewIos, instalada, escritorio };
}

const pasos = (lista, cls) => h('ol', { class: ['pasos', cls] }, lista.map((t, i) => h('li', { class: 'paso' }, h('span', { class: 'paso-n', 'aria-hidden': 'true' }, String(i + 1)), h('span', null, t))));

export const PASOS_IPHONE = [
  'Abrí esta página en Safari y tocá el botón Compartir (el cuadrado con una flecha hacia arriba).',
  'Elegí “Agregar a inicio” y después “Agregar”. Listo: la abrís desde tu pantalla de inicio.',
];
export const PASOS_ANDROID = [
  'Abrí esta página en Chrome y tocá los tres puntos de arriba a la derecha.',
  'Elegí “Instalar app” o “Agregar a la pantalla principal”. Listo: la abrís desde tu pantalla de inicio.',
];
export const PASOS_NAVEGADOR_INTERNO = [
  'Tocá los tres puntos (o el ícono de compartir) de esta ventana.',
  'Elegí “Abrir en el navegador” (en iPhone, “Abrir en Safari”). Después seguí los pasos de instalar.',
];

/**
 * Caja "Primero instalala en tu pantalla de inicio" para la Bienvenida (fondo oscuro). Devuelve null si ya está instalada o es una computadora.
 * onCopia: si ya hay datos cargados en este navegador, ofrece "Copia para llevarte a la app".
 */
export function cajaInstalar(ctx, { entorno = detectarEntorno(), onCopia = null } = {}) {
  estilos();
  if (entorno.instalada || entorno.escritorio) return null;
  let solapa = entorno.ios ? 'ios' : 'android';
  const caja = h('section', { class: 'install-box', 'aria-labelledby': 'install-t' });
  const pintar = () => {
    caja.replaceChildren(...[
      h('h2', { id: 'install-t' }, 'Primero instalala en tu pantalla de inicio'),
      h('p', null, 'Así no perdés lo que cargues y la abrís con un toque, como cualquier otra app.'),
      entorno.enApp ? h('div', { class: 'stack-2' }, h('p', { style: { color: 'var(--hero-ink)', fontWeight: '700' } }, 'Ahora estás en el navegador de otra app (por ejemplo WhatsApp). Ahí lo que cargues se puede perder.'), pasos(PASOS_NAVEGADOR_INTERNO)) : null,
      h('div', { class: 'install-tabs', role: 'group', 'aria-label': 'Tu celular' },
        h('button', { type: 'button', class: 'install-tab', 'aria-pressed': String(solapa === 'ios'), onclick: () => { solapa = 'ios'; pintar(); } }, 'iPhone'),
        h('button', { type: 'button', class: 'install-tab', 'aria-pressed': String(solapa === 'android'), onclick: () => { solapa = 'android'; pintar(); } }, 'Android')),
      pasos(solapa === 'ios' ? PASOS_IPHONE : PASOS_ANDROID),
      onCopia ? h('button', { type: 'button', class: 'link', onclick: onCopia }, 'Ya cargué algo acá: copia para llevarte a la app') : null,
    ].filter(Boolean));
  };
  pintar();
  return caja;
}

/** Hoja de la segunda visita: "Poné Mis Cuentas en tu pantalla de inicio" + sugerencia de copia de seguridad. */
export function hojaInstalar(ctx, { conCopia = true, alCopia } = {}) {
  estilos();
  const { ui } = ctx;
  const entorno = detectarEntorno();
  try { navigator.storage?.persist?.(); } catch { /* nada */ }
  return ctx.sheet.open({
    title: 'Poné Mis Cuentas en tu pantalla de inicio',
    render(body) {
      body.append(h('div', { class: 'stack-4' },
        h('p', { class: 't-body' }, 'Tus datos viven en este celular. Si la abrís desde la pantalla de inicio, es más difícil que se pierdan.'),
        entorno.enApp ? ui.notice({ tone: 'warn', title: 'Estás en el navegador de otra app. Abrí esta página en Safari o Chrome para instalarla.' }) : null,
        h('h3', { class: 't-h2' }, 'En iPhone'), pasos(PASOS_IPHONE),
        h('h3', { class: 't-h2' }, 'En Android'), pasos(PASOS_ANDROID),
        conCopia ? ui.notice({ tone: 'info', title: 'Además, guardá una copia de seguridad.', text: 'Son 10 segundos y te la podés mandar por WhatsApp.', action: alCopia ? { label: 'Mandarme una copia', onClick: alCopia } : undefined }) : null));
    },
    footer: (close) => ui.btn({ label: 'Listo', onClick: () => close() }),
  });
}
