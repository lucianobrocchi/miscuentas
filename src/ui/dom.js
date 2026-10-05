// dom.js · utilidades de DOM sin dependencias: h(), íconos, delegación de eventos,
// fitText, conteo animado, formato de plata del kit (fmt) y almacenamiento seguro.
// Todo el kit de UI se apoya en este archivo. No importa nada.

const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set(['svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'g', 'text', 'tspan', 'defs', 'use', 'ellipse', 'title', 'desc', 'clipPath', 'linearGradient', 'stop']);

/**
 * Crea un elemento. h('div', {class:'card', onclick: fn}, 'texto', otroNodo, [lista...])
 * attrs: class (string | array | objeto {clase: bool}), style (string | objeto), dataset (objeto),
 *        on<evento> (función), ref (función que recibe el elemento), html (innerHTML: solo texto propio, nunca del usuario),
 *        true => atributo vacío, false/null/undefined => se omite.
 * children: strings, números, Nodes, arrays (se aplanan). null/false/undefined se ignoran.
 * Si el 2.º argumento es un string/Node/array se toma como hijo (h('p', 'hola')).
 */
export function h(tag, attrs, ...children) {
  let props = attrs;
  if (props == null || typeof props !== 'object' || props instanceof Node || Array.isArray(props)) {
    children.unshift(props);
    props = null;
  }
  const isSvg = SVG_TAGS.has(tag);
  const el = isSvg ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class' || k === 'className') {
        const c = classes(v);
        if (c) el.setAttribute('class', c);
      } else if (k === 'style') {
        if (typeof v === 'string') el.setAttribute('style', v);
        else for (const [sk, sv] of Object.entries(v)) {
          if (sv == null) continue;
          if (sk.startsWith('--')) el.style.setProperty(sk, sv);
          else el.style[sk] = sv;
        }
      } else if (k === 'dataset') {
        Object.assign(el.dataset, v);
      } else if (k === 'ref') {
        v(el);
      } else if (k === 'html') {
        el.innerHTML = v;
      } else if (k.length > 2 && k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (!isSvg && (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected' || k === 'indeterminate')) {
        el[k] = v;
      } else if (v === true) {
        el.setAttribute(k, '');
      } else {
        el.setAttribute(k, String(v));
      }
    }
  }
  append(el, children);
  return el;
}
export const svg = h;

function classes(v) {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(classes).filter(Boolean).join(' ');
  if (v && typeof v === 'object') return Object.keys(v).filter((k) => v[k]).join(' ');
  return '';
}
export const cx = (...a) => classes(a);

function append(el, kids) {
  for (const c of kids) {
    if (c == null || c === false || c === true) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

/** Vacía `el` y le pone los hijos nuevos. */
export function mount(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

/** Ícono del sprite de index.html. name: 'home', 'tarjeta', 'alerta'... size: 'sm' (20px) | 'lg' (32px). */
export function icon(name, { size, cls, label } = {}) {
  const el = h('svg', {
    class: ['icon', size, cls],
    'aria-hidden': label ? null : 'true',
    role: label ? 'img' : null,
    'aria-label': label || null,
    focusable: 'false',
  }, h('use', { href: `#i-${name}` }));
  return el;
}

/** Delegación: on(root, 'click', '[data-x]', (e, el) => ...). Devuelve una función para desuscribir. */
export function on(root, type, selector, handler, opts) {
  const fn = (e) => {
    const t = e.target instanceof Element ? e.target.closest(selector) : null;
    if (t && root.contains(t)) handler(e, t);
  };
  root.addEventListener(type, fn, opts);
  return () => root.removeEventListener(type, fn, opts);
}

export const reducedMotion = () => !!(globalThis.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
export const remPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
export const isPrivate = () => document.documentElement.dataset.privacy === 'on';

export function debounce(fn, ms = 250) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.cancel = () => clearTimeout(t);
  return d;
}

export const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
export const focusables = (root) => [...root.querySelectorAll(FOCUSABLE)].filter((e) => !e.closest('[hidden]') && e.offsetParent !== null || e === document.activeElement);

/** Anuncia un mensaje a lectores de pantalla (región aria-live del index). */
export function announce(msg) {
  const live = document.getElementById('live');
  if (!live) return;
  live.textContent = '';
  requestAnimationFrame(() => { live.textContent = msg; });
}

/** localStorage seguro: nunca tira (modo privado, sitio bloqueado, vista previa). */
export function lsGet(key, fallback = null) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch { return fallback; }
}
export function lsSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

export const uid = () => Math.random().toString(36).slice(2, 10);
export const vibrate = (ms = 8) => { try { navigator.vibrate?.(ms); } catch { /* sin vibración */ } };

// ------------------------------------------------------------------ fitText
/**
 * Baja el font-size de `el` (en px) hasta que su contenido entre en una sola línea.
 * Necesita que el elemento sea display:block con white-space:nowrap (la clase .fit lo hace).
 * min: tamaño mínimo en px (por defecto 2rem).
 */
export function fitText(el, { min } = {}) {
  if (!el || !el.isConnected) return;
  const floor = min ?? 2 * remPx();
  el.style.fontSize = '';
  const avail = el.clientWidth;
  if (!avail) return;
  let size = parseFloat(getComputedStyle(el).fontSize);
  if (el.scrollWidth <= avail + 0.5) return;
  size = Math.max(floor, Math.floor(size * (avail / el.scrollWidth)));
  el.style.fontSize = size + 'px';
  let guard = 40;
  while (el.scrollWidth > avail + 0.5 && size > floor && guard--) {
    size -= 1;
    el.style.fontSize = size + 'px';
  }
}

/** fitText que se re-ajusta solo cuando cambia el ancho del contenedor. */
export function autoFit(el, opts) {
  if (typeof ResizeObserver === 'undefined') { requestAnimationFrame(() => fitText(el, opts)); return; }
  let last = 0;
  const ro = new ResizeObserver(() => {
    if (!el.isConnected) { ro.disconnect(); return; }
    const w = el.parentElement ? el.parentElement.clientWidth : 0;
    if (w !== last) { last = w; fitText(el, opts); }
  });
  ro.observe(el.parentElement || el);
  requestAnimationFrame(() => fitText(el, opts));
}

// ------------------------------------------------------------------ countUp
const counted = new Set();
/**
 * Cuenta de 0 al valor en 600 ms SOLO la primera vez por sesión (por `key`).
 * Con prefers-reduced-motion o si ya contó, muestra el valor directo. `format` recibe el número.
 */
export function countUp(el, to, { format = (n) => fmt.money(n), duration = 600, key = 'default', once = true } = {}) {
  el.textContent = format(to);
  if (reducedMotion() || (once && counted.has(key)) || !Number.isFinite(to)) return;
  counted.add(key);
  const t0 = performance.now();
  const step = (t) => {
    if (!el.isConnected) return;
    const p = Math.min(1, (t - t0) / duration);
    const e = 1 - Math.pow(1 - p, 3);
    el.textContent = format(Math.round(to * e));
    if (p < 1) requestAnimationFrame(step);
    else el.textContent = format(to);
  };
  el.textContent = format(0);
  requestAnimationFrame(step);
}
export const resetCountUp = () => counted.clear();

// ------------------------------------------------------------------ fmt
export const MINUS = '−';
const group = (digits) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

export const fmt = {
  MINUS,
  /** Agrupa con puntos de miles una cadena de dígitos: '1234567' -> '1.234.567'. */
  group,
  /** 105948 -> '$105.948' · -342688 -> '−$342.688' (signo menos real, sin centavos). {plus:true} agrega '+'. {symbol:false} sin '$'. */
  money(n, { plus = false, symbol = true } = {}) {
    if (n == null || !Number.isFinite(Number(n))) return '';
    const v = Math.round(Number(n));
    const s = (symbol ? '$' : '') + group(String(Math.abs(v)));
    return v < 0 ? MINUS + s : plus && v > 0 ? '+' + s : s;
  },
  /** Compacto para barras y chips: 105948 -> '106 mil' · -342688 -> '−343 mil' · 1300000 -> '1,3 M'. */
  compact(n) {
    if (n == null || !Number.isFinite(Number(n))) return '';
    const v = Math.round(Number(n));
    const a = Math.abs(v);
    const sign = v < 0 ? MINUS : '';
    if (a < 1000) return sign + a;
    if (Math.round(a / 1000) < 1000) return `${sign}${Math.round(a / 1000)} mil`;
    const m = a / 1e6;
    const txt = String(Math.round(m * 10) / 10).replace('.', ',');
    return `${sign}${txt} M`;
  },
  /** 6.493 -> '6,49%' (coma, hasta `dec` decimales sin ceros de más). */
  pct(n, dec = 2) {
    if (n == null || !Number.isFinite(Number(n))) return '';
    const s = (Math.round(Number(n) * 10 ** dec) / 10 ** dec).toFixed(dec).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',');
    return s + '%';
  },
  /** plural(1,'mes','meses') -> '1 mes' · plural(3,'mes','meses') -> '3 meses' */
  plural(n, one, many) { return `${n} ${Math.abs(n) === 1 ? one : many}`; },
  /**
   * Lee un número escrito por una persona. Acepta coma o punto: '270.000' -> 270000 · '6,49' -> 6.49 ·
   * '1.234,56' -> 1234.56 · '$ 1.234.567' -> 1234567 · '1,234.5' -> 1234.5. Devuelve null si no hay dígitos.
   * Regla: una coma siempre es decimal; un punto solo es de miles si lo siguen exactamente 3 dígitos
   * (o si hay varios puntos).
   */
  parseDecimal(input) {
    if (typeof input === 'number') return Number.isFinite(input) ? input : null;
    let s = String(input ?? '').trim().replace(/[\s $]/g, '').replace(/[−–—]/g, '-');
    let neg = false;
    if (s.startsWith('-')) { neg = true; s = s.slice(1); }
    s = s.replace(/[^0-9.,]/g, '');
    if (!/\d/.test(s)) return null;
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    let intPart = s;
    let frac = '';
    if (lastDot > -1 && lastComma > -1) {
      const idx = Math.max(lastDot, lastComma);
      intPart = s.slice(0, idx).replace(/[.,]/g, '');
      frac = s.slice(idx + 1);
    } else if (lastDot > -1 || lastComma > -1) {
      const sep = lastDot > -1 ? '.' : ',';
      const idx = s.lastIndexOf(sep);
      const count = s.split(sep).length - 1;
      const after = s.slice(idx + 1);
      if (count > 1) intPart = s.replace(/[.,]/g, '');
      else if (sep === '.' && after.length === 3 && idx > 0) intPart = s.replace('.', '');
      else { intPart = s.slice(0, idx); frac = after; }
    }
    const n = Number((intPart || '0') + (frac ? '.' + frac.replace(/\D/g, '') : ''));
    if (!Number.isFinite(n)) return null;
    return neg ? -n : n;
  },
  /** Como parseDecimal pero redondea a pesos enteros. '1.500,60' -> 1501. null si está vacío. */
  parseMoney(input) {
    const n = fmt.parseDecimal(input);
    return n == null ? null : Math.round(n);
  },
};

// ------------------------------------------------------------------ tonos, estados y textos para lectores
const TONE_ALIAS = {
  ok: 'ok', bien: 'ok', alcanza: 'ok', verde: 'ok', hecho: 'ok',
  warn: 'warn', justo: 'warn', ajustado: 'warn', cubierto: 'warn', ambar: 'warn', 'ámbar': 'warn',
  bad: 'bad', falta: 'bad', terracota: 'bad',
  info: 'info', estimado: 'info', provisorio: 'info', pendiente: 'info',
  brand: 'brand', pino: 'brand', neutral: 'neutral',
};
/** Normaliza un código de estado (de derive o propio) a 'ok' | 'warn' | 'bad' | 'info' | 'brand' | 'neutral'. */
export const toneOf = (code) => TONE_ALIAS[code] || 'neutral';

/** Estados con palabra + forma + color (nunca solo color). Los códigos son los de derive.monthState y los del veredicto. */
export const STATUS = {
  bien:       { tone: 'ok',   shape: 'forma-ok',    label: 'Alcanza' },
  justo:      { tone: 'warn', shape: 'forma-justo', label: 'Ajustado' },
  cubierto:   { tone: 'warn', shape: 'forma-justo', label: 'Ajustado' },
  falta:      { tone: 'bad',  shape: 'forma-falta', label: 'Falta plata' },
  provisorio: { tone: 'info', shape: 'forma-info',  label: 'Provisorio' },
  estimado:   { tone: 'info', shape: 'forma-info',  label: 'Estimado' },
  pendiente:  { tone: 'info', shape: 'forma-info',  label: 'Falta un dato' },
  verde:      { tone: 'ok',   shape: 'forma-ok',    label: 'Sin costo' },
  ambar:      { tone: 'warn', shape: 'forma-justo', label: 'Con costo' },
  terracota:  { tone: 'bad',  shape: 'forma-falta', label: 'No conviene' },
};
const STATUS_ALIAS = { ok: 'bien', warn: 'justo', bad: 'falta', info: 'estimado', alcanza: 'bien', ajustado: 'justo' };
export const statusInfo = (code) => STATUS[code] || STATUS[STATUS_ALIAS[code]] || { tone: toneOf(code), shape: 'forma-info', label: String(code || '') };

/** Para aria-labels: '105948 pesos' · '-342688' -> 'menos 342688 pesos' · con privacidad: 'monto oculto'. */
export function srMoney(n) {
  if (isPrivate()) return 'monto oculto';
  const v = Math.round(Number(n) || 0);
  return v < 0 ? `menos ${Math.abs(v)} pesos` : `${v} pesos`;
}
