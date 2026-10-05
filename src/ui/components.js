// components.js · kit de componentes. Todas las funciones devuelven Elements (nunca strings de HTML).
// Documentación con firmas y ejemplos: docs/ui-kit.md. Estilos: styles/components.css.
// Reglas: ningún monto suelto (siempre ui.amt), ningún nombre de persona suelto (siempre ui.personName),
// nada de colores literales, nada por debajo de 1rem.

import { h, icon, cx, fmt, countUp, autoFit, isPrivate, lsGet, lsSet, toneOf, STATUS, statusInfo, srMoney } from './dom.js';
import * as sheet from './sheet.js';
import { monthStrip } from './charts.js';

export { h, icon, cx, fmt };

export const DISCLAIMER = 'Es una estimación con los datos que cargaste. No es asesoramiento financiero.';

// ------------------------------------------------------------------ tonos y estados (viven en dom.js)
export { toneOf, STATUS, statusInfo, srMoney };

// ------------------------------------------------------------------ montos, nombres, textos para lectores
/**
 * Monto. SIEMPRE usar esto para mostrar plata: con el ojo de privacidad se oculta como "••••".
 * amt(105948) -> $105.948 · amt(-342688) -> −$342.688 · amt(106000,{compact:true}) -> 106 mil · amt(5,{plus:true}) -> +$5
 */
export function amt(value, { compact = false, plus = false, symbol = true, cls, text } = {}) {
  const t = text ?? (compact ? fmt.compact(value) : fmt.money(value, { plus, symbol }));
  return h('span', { class: ['amt num', cls] }, h('span', { class: 'amt-v' }, t));
}

/** Nombre de persona. Con privacidad se muestra "Persona N" (index base 0). */
export function personName(name, index = 0) {
  return h('span', { class: 'pname', 'data-alias': `Persona ${index + 1}` }, h('span', { class: 'pname-v' }, name));
}
/** Para textos planos (toasts, aria-labels): devuelve el alias si la privacidad está activa. */
export const aliasName = (name, index = 0) => (isPrivate() ? `Persona ${index + 1}` : name);

// ------------------------------------------------------------------ íconos y chips
/** Cuadro de ícono 44x44 con fondo del tono: iconTile('tarjeta','warn'). tone: ok|warn|bad|info|brand|neutral. */
export function iconTile(name, tone = 'brand', { size } = {}) {
  return h('span', { class: ['icon-tile', `tone-bg-${toneOf(tone)}`, size === 'lg' && 'icon-tile-lg'], 'aria-hidden': 'true' }, icon(name));
}

/** Chip de lectura (28px). chip('estimado',{tone:'info'}) · chip('Vence el 13',{tone:'info',icon:'calendario'}) */
export function chip(label, { tone = 'neutral', icon: ic, onHero = false, cls } = {}) {
  return h('span', { class: ['chip', `chip-${toneOf(tone)}`, onHero && 'chip-hero', cls] }, ic ? icon(ic, { size: 'sm' }) : null, h('span', null, label));
}

/** Chip de estado con forma y palabra. status('bien') -> "Alcanza". status('falta',{label:'Falta plata'}). onHero para usarlo sobre el hero. */
export function status(code, { label, onHero = false, cls } = {}) {
  const s = statusInfo(code);
  return h('span', { class: ['chip chip-status', `chip-${s.tone}`, onHero && 'chip-hero', cls] },
    icon(s.shape, { size: 'sm' }), h('span', null, label || s.label));
}

/** Glifo de estado solo (círculo con tilde / cuadrado / triángulo), para el mapa de meses de ¿Me alcanza?. */
export function statusGlyph(code, { cls } = {}) {
  const s = statusInfo(code);
  return h('span', { class: ['glyph', `tone-${s.tone}`, cls], role: 'img', 'aria-label': s.label }, icon(s.shape));
}

/** Chip seleccionable (alto táctil 48px). chipButton('Súper',{selected:true,onClick:fn,value:'super'}) */
export function chipButton(label, { selected = false, onClick, icon: ic, value, disabled, ariaLabel, tone, cls } = {}) {
  return h('button', {
    type: 'button', class: ['chipbtn', tone && `chipbtn-${toneOf(tone)}`, cls], 'aria-pressed': String(!!selected), disabled: !!disabled,
    'aria-label': ariaLabel || null, dataset: value != null ? { value } : null,
    onclick: onClick,
  }, h('span', { class: 'chipbtn-face' }, selected ? icon('tilde', { size: 'sm' }) : (ic ? icon(ic, { size: 'sm' }) : null), h('span', null, label)));
}

// ------------------------------------------------------------------ botones y enlaces
/**
 * Botón. variant: 'primary' (56px, relleno) | 'secondary' (56px, contorno) | 'text' (48px) | 'ghost' (48px, gris) |
 * 'danger' (56px, terracota) | 'onhero' (blanco sobre el hero) | 'onhero-ghost'.
 * Por defecto ocupa todo el ancho; {inline:true} para ancho al contenido. Con href es un <a>.
 */
export function btn({ label, icon: ic, iconRight, variant = 'primary', onClick, href, inline = false, disabled = false, type = 'button', ariaLabel, cls, dataset, autofocus } = {}) {
  const attrs = {
    class: ['btn', `btn-${variant}`, inline && 'btn-inline', cls],
    'aria-label': ariaLabel || null, dataset, autofocus: autofocus || null,
  };
  const kids = [ic ? icon(ic) : null, h('span', { class: 'btn-label' }, label), iconRight ? icon(iconRight) : null];
  if (href) return h('a', { ...attrs, href, onclick: onClick }, kids);
  return h('button', { ...attrs, type, disabled: !!disabled, onclick: onClick }, kids);
}

/** Botón de ícono 48x48 (siempre con aria-label). iconButton({icon:'lapiz', label:'Editar', onClick}) */
export function iconButton({ icon: ic, label, onClick, pressed, cls }) {
  return h('button', { type: 'button', class: ['icon-btn', cls], 'aria-label': label, 'aria-pressed': pressed == null ? null : String(!!pressed), onclick: onClick }, icon(ic));
}

/** Enlace/acción de texto de 48px de alto: link({label:'Ver todo', href:'#/deudas'}) o con onClick. */
export function link({ label, href, onClick, icon: ic, cls } = {}) {
  const kids = [h('span', null, label), ic ? icon(ic, { size: 'sm' }) : null];
  if (href) return h('a', { class: ['link', cls], href, onclick: onClick }, kids);
  return h('button', { type: 'button', class: ['link', cls], onclick: onClick }, kids);
}

// ------------------------------------------------------------------ tarjetas, secciones, títulos
/** Tarjeta blanca radio 24. card(children, {pad:'md'|'sm'|'none', tone:'ok'|'warn'|'bad'|'info', as:'section', cls}) */
export function card(children, { pad = 'md', tone, as = 'section', cls, ariaLabel } = {}) {
  return h(as, { class: ['card', `pad-${pad}`, tone && `card-${toneOf(tone)}`, cls], 'aria-label': ariaLabel || null }, children);
}

/** Título de sección (20/26 800) con acción opcional a la derecha ("Ver todo"). */
export function sectionTitle(title, action, { level = 2, cls } = {}) {
  return h('div', { class: ['section-title', cls] },
    h(`h${level}`, { class: 't-h2' }, title),
    action ? link({ label: action.label, href: action.href, onClick: action.onClick }) : null);
}

/** Título de pantalla (h1 30/36) con bajada opcional. */
export function pageTitle(title, sub) {
  return h('div', { class: 'page-title' }, h('h1', { class: 't-h1' }, title), sub ? h('p', { class: 'muted t-body' }, sub) : null);
}

/** Pie / nota chica (16px, --ink-3). */
export const footnote = (text, cls) => h('p', { class: ['footnote', cls] }, text);
/** Pie obligatorio de las hojas de decisión. */
export const disclaimer = () => footnote(DISCLAIMER, 'disclaimer');

/** Lista de pares etiqueta / valor de 17px. kv([{label:'Interés extra', value:amt(85795), tone:'warn', strong:true, hint:'...'}]) */
export function kv(rows, { cls } = {}) {
  return h('dl', { class: ['kv', cls] }, rows.filter(Boolean).map((r) => h('div', { class: ['kv-row', r.strong && 'strong', r.tone && `tone-${toneOf(r.tone)}`] },
    h('dt', null, r.label, r.hint ? h('span', { class: 'kv-hint' }, r.hint) : null),
    h('dd', null, r.value))));
}

// ------------------------------------------------------------------ filas
/**
 * Fila de 72px (o 88px con size:'lg'). Si tiene onClick/href es un botón/enlace con chevron.
 * row({ icon:'tarjeta', tone:'warn', title:'Visa Gold · 13 de octubre', sub:'En 9 días', value:amt(270000), valueSub:'mínimo',
 *       chip:{label:'Completar', tone:'info'}, onClick, href, size:'md'|'lg', valueClass:'big'|'date', pending:false, ariaLabel })
 * value / title / sub pueden ser string o Node. Meter varias en rowList().
 */
export function row({ icon: ic, tone = 'brand', title, sub, value, valueSub, chip: ch, onClick, href, size = 'md', valueClass, pending = false, chevron, ariaLabel, cls, dataset } = {}) {
  const interactive = !!(onClick || href);
  const showChevron = chevron ?? interactive;
  const kids = [
    ic ? iconTile(ic, tone) : null,
    h('span', { class: 'row-text' },
      h('span', { class: 'row-title' }, title),
      sub ? h('span', { class: 'row-sub' }, sub) : null),
    (value != null || valueSub || ch) ? h('span', { class: 'row-end' },
      value != null ? h('span', { class: ['row-value', valueClass === 'big' && 't-big', valueClass === 'date' && 't-date'] }, value) : null,
      valueSub ? h('span', { class: 'row-valsub' }, valueSub) : null,
      ch ? chip(ch.label, { tone: ch.tone || 'info', icon: ch.icon }) : null) : null,
    showChevron ? icon('chevron', { cls: 'row-chev' }) : null,
  ];
  const attrs = { class: ['row', `row-${size}`, interactive && 'row-action', pending && 'row-pending', cls], 'aria-label': ariaLabel || null, dataset };
  if (href) return h('a', { ...attrs, href, onclick: onClick }, kids);
  if (onClick) return h('button', { ...attrs, type: 'button', onclick: onClick }, kids);
  return h('div', attrs, kids);
}

/** Contenedor blanco que apila filas con líneas finas. rowList([row(...), row(...)]) */
export function rowList(rows, { cls, ariaLabel } = {}) {
  return h('div', { class: ['card rows', cls], role: 'list', 'aria-label': ariaLabel || null },
    rows.filter(Boolean).map((r) => { r.setAttribute?.('role', 'listitem'); return r; }));
}

// ------------------------------------------------------------------ segmentado y opciones (radios reales)
let uidN = 0;
const nextId = (p) => `${p}-${++uidN}`;

/**
 * Control segmentado de 52px. segmented({options:[{value:'4',label:'4 meses'},{value:'12',label:'12 meses'}], value:'4', onChange:(v)=>..., ariaLabel:'Cuántos meses'})
 * Devuelve el elemento; el.value (get/set) y el.setValue(v).
 */
export function segmented({ options, value, onChange, ariaLabel, name, cls }) {
  const nm = name || nextId('seg');
  const el = h('div', { class: ['seg', cls], role: 'radiogroup', 'aria-label': ariaLabel || null },
    options.map((o) => h('label', { class: 'seg-opt' },
      h('input', { type: 'radio', name: nm, value: o.value, checked: String(o.value) === String(value), class: 'seg-in', onchange: (e) => { if (e.target.checked) onChange?.(o.value); } }),
      h('span', { class: 'seg-face' }, o.icon ? icon(o.icon, { size: 'sm' }) : null, h('span', null, o.label)))));
  Object.defineProperty(el, 'value', { get: () => (el.querySelector('input:checked') || {}).value, set: (v) => { const i = [...el.querySelectorAll('input')].find((x) => x.value === String(v)); if (i) i.checked = true; } });
  el.setValue = (v) => { el.value = v; };
  return el;
}

/**
 * Opciones tipo radio de 88px (cuánto pagar, cómo cubrir enero...).
 * optionGroup({ name:'pago', ariaLabel:'Cuánto pagar', value:'min', onChange:(v)=>..., options:[{value:'min', title:'Solo el mínimo', sub:'Salís en junio 2027', end: amt(270000), tag:'Recomendado', tagTone:'ok'}] })
 * option.title/sub/end pueden ser string o Node. Devuelve el elemento con el.value (get/set).
 */
export function optionGroup({ options, value, onChange, name, ariaLabel, cls }) {
  const nm = name || nextId('opt');
  const el = h('div', { class: ['opts', cls], role: 'radiogroup', 'aria-label': ariaLabel || null },
    options.map((o) => h('label', { class: 'opt' },
      h('input', { type: 'radio', name: nm, value: o.value, checked: String(o.value) === String(value), class: 'opt-in', onchange: (e) => { if (e.target.checked) onChange?.(o.value); } }),
      h('span', { class: 'opt-mark', 'aria-hidden': 'true' }),
      h('span', { class: 'opt-body' },
        h('span', { class: 'opt-title' }, o.title, o.tag ? chip(o.tag, { tone: o.tagTone || 'ok' }) : null),
        o.sub ? h('span', { class: 'opt-sub' }, o.sub) : null),
      o.end != null ? h('span', { class: 'opt-val' }, o.end) : null)));
  Object.defineProperty(el, 'value', { get: () => (el.querySelector('input:checked') || {}).value, set: (v) => { const i = [...el.querySelectorAll('input')].find((x) => x.value === String(v)); if (i) i.checked = true; } });
  return el;
}

// ------------------------------------------------------------------ campo de dinero (puntos de miles en vivo)
/**
 * Campo numérico con formato en vivo.
 * moneyInput({ value, onChange:(n|null)=>..., kind:'money'|'rate'|'int', big:false, name, id, ariaLabel, ariaDescribedby,
 *              max:999999999, placeholder, autofocus, onEnter, suffix })
 *  - kind 'money' (por defecto): solo dígitos con puntos de miles mientras se escribe ("900000" -> "900.000"), prefijo $, teclado numérico,
 *    tope de 9 dígitos. Si se PEGA texto, se lee con fmt.parseMoney (acepta "$ 900.000,50").
 *  - kind 'rate': decimales con coma o punto ("6,49", "6.49"), teclado decimal, sin tope de dígitos, sufijo %.
 *  - kind 'int': solo dígitos, sin puntos ni $ (cantidad de cuotas, días).
 * Devuelve el <div class="money"> con .input (el <input>), .getValue() (number|null), .setValue(n), .focus().
 * NUNCA lleva atributo step. onChange recibe número o null si está vacío.
 */
export function moneyInput({ value, onChange, kind = 'money', big = false, name, id, ariaLabel, ariaDescribedby, max = 999999999, placeholder, autofocus, onEnter, suffix, invalid = false } = {}) {
  const inputId = id || nextId('money');
  const maxDigits = String(max).length;
  const toText = (n) => {
    if (n == null || n === '' || Number.isNaN(Number(n))) return '';
    if (kind === 'money') return fmt.group(String(Math.round(Math.abs(Number(n)))));
    if (kind === 'rate') return String(n).replace('.', ',');
    return String(Math.round(Number(n)));
  };
  const input = h('input', {
    id: inputId, name: name || null, type: 'text', class: 'money-in',
    inputmode: kind === 'rate' ? 'decimal' : 'numeric', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'done',
    placeholder: placeholder || null, 'aria-label': ariaLabel || null, 'aria-describedby': ariaDescribedby || null,
    'aria-invalid': invalid ? 'true' : null, autofocus: autofocus || null, value: toText(value),
  });
  const sign = kind === 'money' ? h('span', { class: 'money-sign', 'aria-hidden': 'true' }, '$') : null;
  const suf = suffix || (kind === 'rate' ? '%' : null);
  const wrap = h('div', { class: ['money', big && 'money-big', kind !== 'money' && 'money-plain', invalid && 'invalid'] }, sign, input, suf ? h('span', { class: 'money-suffix', 'aria-hidden': 'true' }, suf) : null);

  const read = () => {
    const raw = input.value;
    if (!raw.trim()) return null;
    if (kind === 'rate') return fmt.parseDecimal(raw);
    if (kind === 'money') return fmt.parseMoney(raw.replace(/\./g, ''));
    return fmt.parseMoney(raw);
  };
  const reformat = () => {
    if (kind === 'rate') {
      let s = input.value.replace(/[^0-9.,]/g, '');
      const m = s.search(/[.,]/);
      if (m >= 0) s = s.slice(0, m + 1) + s.slice(m + 1).replace(/[.,]/g, '');
      if (s !== input.value) input.value = s;
      return;
    }
    const caret = input.selectionStart ?? input.value.length;
    const digitsBefore = input.value.slice(0, caret).replace(/\D/g, '').length;
    let digits = input.value.replace(/\D/g, '').slice(0, maxDigits).replace(/^0+(?=\d)/, '');
    const text = kind === 'money' ? fmt.group(digits) : digits;
    if (text !== input.value) {
      input.value = text;
      let pos = 0; let seen = 0;
      while (pos < text.length && seen < digitsBefore) { if (/\d/.test(text[pos])) seen++; pos++; }
      try { input.setSelectionRange(pos, pos); } catch { /* algunos teclados no lo permiten */ }
    }
  };
  input.addEventListener('input', () => { reformat(); onChange?.(read()); });
  input.addEventListener('paste', (e) => {
    const t = (e.clipboardData || window.clipboardData)?.getData('text');
    if (!t) return;
    e.preventDefault();
    const n = kind === 'rate' ? fmt.parseDecimal(t) : fmt.parseMoney(t);
    if (n == null) return;
    input.value = toText(Math.abs(n));
    onChange?.(read());
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter?.(read()); } });
  wrap.input = input;
  wrap.getValue = read;
  wrap.setValue = (n) => { input.value = toText(n); };
  wrap.focus = () => input.focus();
  wrap.setInvalid = (b) => { wrap.classList.toggle('invalid', !!b); input.setAttribute('aria-invalid', b ? 'true' : 'false'); };
  return wrap;
}

/**
 * Stepper de cantidades (72x56 por botón). stepper({value:12, min:1, max:60, step:1, onChange:(n)=>..., ariaLabel:'Cuotas', unit:'cuotas', format})
 * Se puede tocar − / + o escribir el número. Devuelve el elemento con .getValue() / .setValue(n).
 */
export function stepper({ value = 0, min = 0, max = 999, step = 1, onChange, ariaLabel, unit, format, id } = {}) {
  let v = Math.min(max, Math.max(min, Number(value) || 0));
  const out = h('input', { class: 'stepper-val', type: 'text', inputmode: 'numeric', autocomplete: 'off', 'aria-label': ariaLabel || null, id: id || null, value: String(v) });
  const minus = h('button', { type: 'button', class: 'stepper-btn', 'aria-label': ariaLabel ? `Menos ${ariaLabel}` : 'Menos', onclick: () => set(v - step, true) }, icon('menos'));
  const plus = h('button', { type: 'button', class: 'stepper-btn', 'aria-label': ariaLabel ? `Más ${ariaLabel}` : 'Más', onclick: () => set(v + step, true) }, icon('mas'));
  const unitEl = unit ? h('span', { class: 'stepper-unit' }, unit) : null;
  const el = h('div', { class: 'stepper', role: 'group', 'aria-label': ariaLabel || null }, minus, h('div', { class: 'stepper-mid' }, out, unitEl), plus);
  function paint() { out.value = format ? format(v) : String(v); minus.disabled = v <= min; plus.disabled = v >= max; }
  function set(n, notify) { v = Math.min(max, Math.max(min, Math.round(n))); paint(); if (notify) onChange?.(v); }
  out.addEventListener('input', () => { const n = parseInt(out.value.replace(/\D/g, ''), 10); if (!Number.isNaN(n)) { v = Math.min(max, Math.max(min, n)); minus.disabled = v <= min; plus.disabled = v >= max; onChange?.(v); } });
  out.addEventListener('blur', paint);
  out.addEventListener('keydown', (e) => { if (e.key === 'ArrowUp') { e.preventDefault(); set(v + step, true); } else if (e.key === 'ArrowDown') { e.preventDefault(); set(v - step, true); } });
  paint();
  el.getValue = () => v;
  el.setValue = (n) => set(n, false);
  return el;
}

// ------------------------------------------------------------------ avisos, vacíos, hitos
const NOTICE_ICON = { ok: 'tilde', warn: 'alerta', bad: 'alerta', info: 'info', brand: 'destello' };
/**
 * Aviso / banner. notice({ tone:'warn', title:'Ya cerró el resumen de septiembre', text:'Cargalo para ver el monto exacto.',
 *   action:{label:'Cargar resumen nuevo', onClick}, icon:'alerta', dashed:false })
 * tone: warn (ámbar) | info (azul) | ok | bad. dashed=true => borde punteado azul de "dato pendiente".
 */
export function notice({ tone = 'info', title, text, action, icon: ic, dashed = false, role, cls } = {}) {
  const t = toneOf(tone);
  return h('div', { class: ['notice', `notice-${t}`, dashed && 'notice-dashed', cls], role: role || null },
    h('span', { class: 'notice-ic', 'aria-hidden': 'true' }, icon(ic || NOTICE_ICON[t] || 'info')),
    h('div', { class: 'notice-body' },
      title ? h('p', { class: 'notice-title' }, title) : null,
      text ? h('p', { class: 'notice-text' }, text) : null,
      action ? btn({ label: action.label, variant: 'text', inline: true, onClick: action.onClick, href: action.href, cls: 'notice-action' }) : null));
}

const ART = {
  barras: () => h('svg', { viewBox: '0 0 120 96', class: 'art', 'aria-hidden': 'true', focusable: 'false' },
    h('rect', { x: 8, y: 20, width: 104, height: 68, rx: 18, class: 'art-soft' }),
    h('rect', { x: 26, y: 52, width: 12, height: 26, rx: 6, class: 'art-brand' }),
    h('rect', { x: 46, y: 36, width: 12, height: 42, rx: 6, class: 'art-brand' }),
    h('rect', { x: 66, y: 46, width: 12, height: 32, rx: 6, class: 'art-brand' }),
    h('rect', { x: 86, y: 28, width: 12, height: 50, rx: 6, class: 'art-brand' }),
    h('circle', { cx: 100, cy: 18, r: 7, class: 'art-dot' })),
  tarjeta: () => h('svg', { viewBox: '0 0 120 96', class: 'art', 'aria-hidden': 'true', focusable: 'false' },
    h('rect', { x: 10, y: 18, width: 100, height: 64, rx: 14, class: 'art-soft' }),
    h('rect', { x: 10, y: 34, width: 100, height: 14, class: 'art-brand' }),
    h('rect', { x: 22, y: 60, width: 34, height: 8, rx: 4, class: 'art-brand' }),
    h('circle', { cx: 96, cy: 20, r: 8, class: 'art-dot' })),
  personas: () => h('svg', { viewBox: '0 0 120 96', class: 'art', 'aria-hidden': 'true', focusable: 'false' },
    h('circle', { cx: 44, cy: 38, r: 16, class: 'art-brand' }),
    h('path', { d: 'M14 84c2-18 14-26 30-26s28 8 30 26Z', class: 'art-brand' }),
    h('circle', { cx: 82, cy: 44, r: 12, class: 'art-soft' }),
    h('path', { d: 'M64 84c1-14 9-22 18-22s17 8 19 22Z', class: 'art-soft' }),
    h('circle', { cx: 100, cy: 16, r: 7, class: 'art-dot' })),
  lista: () => h('svg', { viewBox: '0 0 120 96', class: 'art', 'aria-hidden': 'true', focusable: 'false' },
    h('rect', { x: 20, y: 10, width: 80, height: 76, rx: 14, class: 'art-soft' }),
    h('rect', { x: 34, y: 28, width: 52, height: 8, rx: 4, class: 'art-brand' }),
    h('rect', { x: 34, y: 46, width: 40, height: 8, rx: 4, class: 'art-brand' }),
    h('rect', { x: 34, y: 64, width: 30, height: 8, rx: 4, class: 'art-brand' }),
    h('circle', { cx: 98, cy: 18, r: 7, class: 'art-dot' })),
  obra: () => h('svg', { viewBox: '0 0 120 96', class: 'art', 'aria-hidden': 'true', focusable: 'false' },
    h('rect', { x: 14, y: 52, width: 92, height: 30, rx: 12, class: 'art-soft' }),
    h('path', { d: 'M30 52V34a10 10 0 0 1 10-10h40a10 10 0 0 1 10 10v18', class: 'art-line' }),
    h('rect', { x: 46, y: 62, width: 28, height: 8, rx: 4, class: 'art-brand' }),
    h('circle', { cx: 98, cy: 22, r: 7, class: 'art-dot' })),
};
/**
 * Estado vacío: ilustración duotono + título + texto + UN botón.
 * empty({ title:'Empecemos por lo que cobrás', text:'...', action:{label:'Empezar', onClick}, secondary:{label:'Ver un ejemplo', onClick}, art:'barras'|'tarjeta'|'personas'|'lista'|'obra' })
 */
export function empty({ title, text, action, secondary, art = 'barras', cls } = {}) {
  return h('div', { class: ['empty', cls] },
    (ART[art] || ART.barras)(),
    h('h2', { class: 'empty-title' }, title),
    text ? h('p', { class: 'empty-text' }, text) : null,
    action ? btn({ label: action.label, onClick: action.onClick, href: action.href, icon: action.icon, cls: 'empty-btn' }) : null,
    secondary ? btn({ label: secondary.label, variant: 'text', onClick: secondary.onClick, href: secondary.href, cls: 'empty-btn2' }) : null);
}

/** Hito celebrable y sobrio (ícono llave sobre fondo ok). milestone({title:'¡Se terminó!', text:'...', action:{label:'Seguir', onClick}}) */
export function milestone({ title, text, action, secondary } = {}) {
  return h('div', { class: 'milestone' },
    h('span', { class: 'milestone-ic', 'aria-hidden': 'true' }, icon('llave', { size: 'lg' })),
    h('h3', { class: 't-sheet' }, title),
    text ? h('p', { class: 't-body' }, text) : null,
    action ? btn({ label: action.label, onClick: action.onClick }) : null,
    secondary ? btn({ label: secondary.label, variant: 'text', onClick: secondary.onClick, icon: secondary.icon }) : null);
}

// ------------------------------------------------------------------ glosario ("Qué es esto")
export const GLOSSARY = {
  pagoMinimo: {
    title: 'Pago mínimo',
    body: ['Es lo menos que podés pagar de tu resumen antes del vencimiento.', 'El resto sigue siendo deuda y sigue sumando interés. Lo encontrás en el resumen, con ese mismo nombre.'],
  },
  saldoActual: {
    title: 'Saldo o total a pagar',
    body: ['Es el total que figura en tu último resumen: todo lo que debías a la tarjeta en la fecha de cierre.', 'No incluye lo que pagaste ni lo que compraste después de esa fecha.'],
  },
  interesMensual: {
    title: 'Interés por mes y por año',
    body: ['El banco puede mostrarte el interés de dos maneras: por mes (por ejemplo 6,49%) o por año (la TNA, por ejemplo 79%).', 'Esta app usa el interés por mes. Si solo tenés el anual, dividilo por 12: te da casi lo mismo.'],
  },
  estimado: {
    title: 'Número estimado',
    body: ['Es un número que todavía no confirmaste con un papel, como el recibo o el resumen. Lo usamos para poder mostrarte el panorama.', 'Cuando lo confirmes, lo cambiás y las cuentas se ajustan solas.'],
  },
  provisorio: {
    title: 'Resultado provisorio',
    body: ['Los números salen como provisorios cuando falta un dato que cambia el resultado, por ejemplo el plan de AFIP o si tu sueldo ya tiene restados los descuentos.', 'Cuando lo completes, dejan de ser provisorios.'],
  },
  planilla: {
    title: 'Descuentos por planilla',
    body: ['Son los pagos que te descuentan directo del recibo de sueldo, como préstamos o un plan de pagos de AFIP.', 'Están en el recibo, en las líneas de descuentos.'],
  },
  neto: {
    title: 'Sueldo neto',
    body: ['Es lo que te cae en la cuenta, después de los descuentos de ley. Figura en el recibo como total a cobrar.', 'Fijate si los préstamos y el plan de AFIP ya están restados de ese total: de eso depende cuánto te queda.'],
  },
};

/** Abre la hoja de glosario de un término (o uno propio: {title, body:[...]}). */
export function openGlossary(term) {
  const g = typeof term === 'string' ? GLOSSARY[term] : term;
  if (!g) return null;
  return sheet.open({
    title: g.title,
    render: (body) => body.appendChild(h('div', { class: 'stack-3' }, g.body.map((p) => h('p', { class: 't-body' }, p)))),
    footer: (close) => btn({ label: 'Entendido', variant: 'secondary', onClick: () => close() }),
  });
}
/** Botón "Qué es esto" que abre la hoja del término. glossary('pagoMinimo') · glossary('estimado',{label:'Qué es un estimado'}) */
export function glossary(term, { label = 'Qué es esto', cls } = {}) {
  return h('button', { type: 'button', class: ['glossary', cls], onclick: () => openGlossary(term) }, icon('info', { size: 'sm' }), h('span', null, label));
}

// ------------------------------------------------------------------ barras y progreso
/** Máximo de referencia para barras divergentes: que ni positivos (75%) ni negativos (25%) se pasen. */
export function divergingScale(values) {
  const pos = Math.max(0, ...values.filter((v) => v > 0));
  const neg = Math.max(0, ...values.filter((v) => v < 0).map(Math.abs));
  return Math.max(pos, neg * 3, 1);
}
/**
 * Barra divergente (cero a 25% del ancho, positivos a la derecha, negativos a la izquierda). 16px de alto.
 * divergingBar({ value:105948, max: divergingScale(todos), tone:'ok', estimated:false })
 */
export function divergingBar({ value, max, tone = 'ok', estimated = false, cls }) {
  const t = toneOf(tone);
  const m = max || Math.abs(value) || 1;
  const pct = value >= 0 ? Math.min(75, (Math.abs(value) / m) * 75) : Math.min(25, (Math.abs(value) / m) * 75);
  const fill = h('span', { class: ['dbar-fill', `dbar-${t}`, estimated && 'dashed', value < 0 && 'neg'], style: value >= 0 ? { left: '25%', width: `${pct}%` } : { right: '75%', width: `${pct}%` } });
  return h('span', { class: ['dbar', cls], 'aria-hidden': 'true' }, h('span', { class: 'dbar-zero' }), value === 0 ? null : fill);
}

/** Barra de progreso horizontal. progressBar({value:3, max:7, tone:'brand', label:'3 de 7', dashed:false}) */
export function progressBar({ value, max = 100, tone = 'brand', label, dashed = false, cls }) {
  const p = Math.max(0, Math.min(100, (value / (max || 1)) * 100));
  return h('div', { class: ['pbar', `pbar-${toneOf(tone)}`, dashed && 'dashed', cls], role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(max), 'aria-valuenow': String(value), 'aria-label': label || null },
    h('span', { class: 'pbar-fill', style: { width: `${p}%` } }));
}

/** Barra de pasos del onboarding (7 segmentos de 6px). progressSteps({total:7, current:2}) -> pasos 1 y 2 llenos. */
export function progressSteps({ total = 7, current = 0, label }) {
  return h('div', { class: 'psteps', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(total), 'aria-valuenow': String(current), 'aria-label': label || `Paso ${current} de ${total}` },
    Array.from({ length: total }, (_, i) => h('span', { class: ['pstep', i < current && 'on', i === current - 1 && 'now'] })));
}

/** Anillo de progreso con texto al centro. ring({value:4, total:7, label:'4 de 7'}) */
export function ring({ value, total, label, size = 88 }) {
  const r = 36; const c = 2 * Math.PI * r; const p = Math.max(0, Math.min(1, value / (total || 1)));
  return h('div', { class: 'ring', style: { width: size + 'px', height: size + 'px' }, role: 'img', 'aria-label': label || `${value} de ${total}` },
    h('svg', { viewBox: '0 0 88 88', 'aria-hidden': 'true', focusable: 'false' },
      h('circle', { cx: 44, cy: 44, r, class: 'ring-bg' }),
      h('circle', { cx: 44, cy: 44, r, class: 'ring-fg', 'stroke-dasharray': `${c * p} ${c}`, transform: 'rotate(-90 44 44)' })),
    h('span', { class: 'ring-txt' }, label || `${value} de ${total}`));
}

/**
 * Pips de cuotas (puntos de 14px; el actual lleva anillo; hasta 12, si son más se muestra una barra).
 * pips({ total:36, paid:26, ariaLabel:'Cuota 27 de 36' })  — paid = cuotas ya pagadas (la actual es paid+1).
 */
export function pips({ total, paid = 0, ariaLabel, cls }) {
  const label = ariaLabel || `${paid} de ${total} cuotas pagadas`;
  if (total > 12) return progressBar({ value: paid, max: total, tone: 'brand', label, cls: ['pbar-slim', cls] });
  return h('span', { class: ['pips', cls], role: 'img', 'aria-label': label },
    Array.from({ length: total }, (_, i) => h('span', { class: ['pip', i < paid ? 'done' : i === paid ? 'now' : 'todo'] })));
}

// ------------------------------------------------------------------ hero (Hoy)
/**
 * Hero de Hoy: fondo pino con brillo radial, número enorme, chip de estado, aviso y tira de meses.
 * hero({
 *   label:'Va a la tarjeta este mes',          // rótulo sobre el número
 *   value: 105948,                             // número (money). Alternativa: valueText:'—'
 *   status:'bien', statusLabel:'Alcanza, ojo con enero',   // chip de estado (código de derive o propio)
 *   caption:'Esa plata va a pagar la tarjeta',
 *   note:{ text:'Incluye 3 datos estimados', onClick },    // línea tocable
 *   aviso:{ icon:'alerta', text:'Ojo con enero: faltan $342.688', onClick },
 *   strip:[{ key:'2026-10', label:'Oct', value:105948, state:'bien', current:true, onClick }, ...],  // ver charts.monthStrip
 *   stripOptions:{ showValues:true },
 *   onOpen: () => nav('#/meses/2026-10'),      // al tocar el número
 *   ariaLabel:'Te sobran 105948 pesos en octubre, alcanza'
 * })
 */
export function hero({ label, value, valueText, status: st, statusLabel, caption, note, aviso, strip, stripOptions, onOpen, ariaLabel, countKey = 'hero', cls } = {}) {
  const numEl = h('span', { class: 'hero-num-v', 'aria-live': 'polite' });
  const numBox = h('span', { class: 'amt num hero-amt' }, h('span', { class: 'amt-v fit' }, numEl));
  const fitHost = numBox.firstChild;
  const numWrap = onOpen
    ? h('button', { type: 'button', class: 'hero-num', onclick: onOpen, 'aria-label': ariaLabel || null }, numBox)
    : h('div', { class: 'hero-num' }, numBox);
  if (valueText != null) numEl.textContent = valueText;
  else countUp(numEl, value, { key: countKey, format: (n) => fmt.money(n) });
  autoFit(fitHost, { min: 2 * 16 });
  return h('section', { class: ['hero on-hero', cls] },
    h('div', { class: 'hero-top' },
      h('span', { class: 'hero-label' }, label),
      st ? status(st, { label: statusLabel, onHero: true }) : null),
    numWrap,
    caption ? h('p', { class: 'hero-caption' }, caption) : null,
    note ? h('button', { type: 'button', class: 'hero-note', onclick: note.onClick }, note.text, icon('chevron', { size: 'sm' })) : null,
    aviso ? h(aviso.onClick ? 'button' : 'div', { type: aviso.onClick ? 'button' : null, class: 'hero-aviso', onclick: aviso.onClick },
      icon(aviso.icon || 'alerta'), h('span', { class: 'hero-aviso-t' }, aviso.text), aviso.onClick ? icon('chevron') : null) : null,
    strip && strip.length ? monthStrip(strip, stripOptions) : null);
}

// ------------------------------------------------------------------ misc
/** Botón flotante "+ Agregar" (esquina inferior derecha, sobre la barra). fab({label:'Agregar', icon:'mas', onClick}) */
export function fab({ label, icon: ic = 'mas', onClick }) {
  return h('button', { type: 'button', class: 'fab', onclick: onClick }, icon(ic), h('span', null, label));
}

/** Desplegable "Ver los números" para tablas alternativas de gráficos. disclosure({summary:'Ver los números', content:Node}) */
export function disclosure({ summary = 'Ver los números', content, open = false }) {
  return h('details', { class: 'disclosure', open: open || null }, h('summary', null, h('span', null, summary), icon('chevron', { size: 'sm' })), h('div', { class: 'disclosure-body' }, content));
}

/** Tabla accesible simple. dataTable({caption:'Deuda mes a mes', head:['Mes','Deuda'], rows:[['Oct', amt(1)], ...]}) */
export function dataTable({ caption, head, rows, cls }) {
  return h('table', { class: ['dtable', cls] },
    caption ? h('caption', { class: 'sr-only' }, caption) : null,
    h('thead', null, h('tr', null, head.map((c) => h('th', { scope: 'col' }, c)))),
    h('tbody', null, rows.map((r) => h('tr', null, r.map((c, i) => h(i === 0 ? 'th' : 'td', { scope: i === 0 ? 'row' : null }, c))))));
}

/** Pastilla gris (ej. sin internet). pill('Sin internet no pasa nada: todo está guardado en tu celular.') */
export const pill = (text, cls) => h('div', { class: ['pill-note', cls] }, text);

/** Leyenda fija en palabras (mapa de meses de ¿Me alcanza?): legend([{code:'verde'},{code:'ambar'},{code:'terracota'}]) */
export function legend(items) {
  return h('ul', { class: 'legend', 'aria-label': 'Referencias' }, items.map((it) => {
    const s = statusInfo(it.code);
    return h('li', { class: ['legend-i', `tone-${s.tone}`] }, icon(s.shape, { size: 'sm' }), h('span', { class: 'legend-t' }, it.label || s.label));
  }));
}

/** Preferencias de vista por celular (se pierden sin avisar si no hay almacenamiento): pref.get('mesesMode','4') · pref.set('mesesMode','12'). */
export const pref = { get: (k, d) => lsGet(`mc.pref.${k}`, d), set: (k, v) => lsSet(`mc.pref.${k}`, v) };


// ------------------------------------------------------------------ bloques de pantalla
/**
 * Dato destacado: etiqueta + número grande + detalle + chips. stat({ label:'Total del último resumen (agosto)', value:amt(1800000), valueClass:'display',
 *   sub:'Interés que se suma por mes: ...', chips:[chip('Cierra el 1',{tone:'info'}), chip('6,49% por mes',{tone:'warn'})] })
 * valueClass: 'display' (44/48) | 'big' (32/36) | 'date' (26/32) | 'h1'.
 */
export function stat({ label, value, valueClass = 'display', sub, chips, tone, cls } = {}) {
  return h('div', { class: ['stat', tone && `stat-${toneOf(tone)}`, cls] },
    label ? h('p', { class: 'stat-label' }, label) : null,
    h('p', { class: ['stat-value', `t-${valueClass}`] }, value),
    sub ? h('p', { class: 'stat-sub' }, sub) : null,
    chips && chips.length ? h('div', { class: 'cluster stat-chips' }, chips) : null);
}

/**
 * Veredicto en vivo (¿Me alcanza?). role=status aria-live=polite, borde izquierdo de 6px del tono.
 * verdict({ code:'ambar'|'verde'|'terracota', title:'Se puede, pero tiene costo', text:'...', rows:[{label,value,strong}], footer:Node })
 */
export function verdict({ code, title, text, rows, footer, cls } = {}) {
  const s = statusInfo(code);
  return h('div', { class: ['verdict', `verdict-${s.tone}`, cls], role: 'status', 'aria-live': 'polite' },
    h('p', { class: 'verdict-title' }, icon(s.tone === 'ok' ? 'forma-ok' : s.tone === 'warn' ? 'alerta' : 'forma-falta'), h('span', null, title)),
    text ? h('p', { class: 'verdict-text' }, text) : null,
    rows && rows.length ? kv(rows, { cls: 'verdict-kv' }) : null,
    footer || null);
}

/**
 * Mapa de meses de ¿Me alcanza?: tira horizontal de chips 64x76 con glifo de veredicto (forma + color) y mes.
 * monthMap({ items:[{key:'2026-12', label:'Dic', state:'ambar'|'verde'|'terracota'|null, ariaLabel:'Diciembre: con costo'}], value:'2026-12', onChange:(key)=>... })
 */
export function monthMap({ items, value, onChange, ariaLabel = 'Elegí el mes', cls }) {
  const el = h('div', { class: ['mmap', cls], role: 'group', 'aria-label': ariaLabel });
  const paint = (cur) => {
    el.replaceChildren(...items.map((it) => {
      const s = it.state ? statusInfo(it.state) : null;
      return h('button', {
        type: 'button', class: ['mm', s && `mm-${s.tone}`, it.key === cur && 'on'], 'aria-pressed': String(it.key === cur), dataset: { key: it.key },
        'aria-label': it.ariaLabel || `${it.label}${s ? ': ' + s.label : ''}`,
        onclick: () => { paint(it.key); onChange?.(it.key); },
      }, s ? h('span', { class: 'mm-glyph' }, icon(s.shape)) : h('span', { class: 'mm-glyph mm-wait' }),
         h('span', { class: 'mm-label' }, it.label));
    }));
  };
  paint(value);
  el.setItems = (next, cur) => { items = next; paint(cur ?? value); };
  el.setValue = (v) => { value = v; paint(v); };
  return el;
}

/** Cinta fija ámbar (modo ejemplo). ribbon({ text:'Esto es un ejemplo, no son tus números', actionLabel:'Cargar lo mío', onClick }) */
export function ribbon({ text, actionLabel, onClick }) {
  return h('div', { class: 'ribbon', role: 'note' }, h('span', null, text), actionLabel ? h('button', { type: 'button', onclick: onClick }, actionLabel) : null);
}

/**
 * Cáscara de un paso del onboarding (y de los editores a pantalla completa): barra de 7 pasos, Volver / "Seguir después",
 * etiqueta, pregunta 32/38, ayuda, contenido, recompensa, y botones pegados abajo.
 * stepShell({ step:2, total:7, stepLabel:'Lo que cobrás', question:'¿Cuánto cobrás de sueldo por mes?', help:'Poné el neto...',
 *   content:[campo.el], reward:{ text:'En octubre entran $1.738.735.' }, onBack, onSkip, skipLabel:'Seguir después',
 *   primary:{ label:'Seguir', onClick, disabled:false }, secondary:{ label:'No lo sé todavía', onClick }, extra: Node })
 */
export function stepShell({ step, total = 7, stepLabel, question, help, content, reward, onBack, onSkip, skipLabel = 'Seguir después', primary, secondary, extra, cls } = {}) {
  return h('div', { class: ['ob', cls] },
    h('div', { class: 'ob-top' },
      progressSteps({ total, current: step }),
      h('div', { class: 'ob-bar' },
        onBack ? h('button', { type: 'button', class: 'icon-btn back', 'aria-label': 'Volver', onclick: onBack }, icon('volver')) : h('span', { class: 'ob-bar-gap' }),
        onSkip ? link({ label: skipLabel, onClick: onSkip }) : null)),
    h('div', { class: 'ob-main stack-4' },
      stepLabel ? h('p', { class: 'ob-step' }, `Paso ${step} de ${total}${stepLabel ? ' · ' + stepLabel : ''}`) : null,
      h('h1', { class: 'ob-q t-q' }, question),
      help ? h('p', { class: 'ob-help' }, help) : null,
      h('div', { class: 'ob-content stack-4' }, content),
      reward ? h('div', { class: 'ob-reward', role: 'status', 'aria-live': 'polite' }, h('span', { class: 'ob-reward-ic' }, icon('tilde')), h('p', { class: 'ob-reward-t' }, reward.text)) : null,
      extra || null),
    h('div', { class: 'ob-foot' },
      primary ? btn({ label: primary.label, onClick: primary.onClick, disabled: primary.disabled, icon: primary.icon }) : null,
      secondary ? btn({ label: secondary.label, variant: 'text', onClick: secondary.onClick }) : null));
}

/**
 * Pantalla oscura a pantalla completa (Bienvenida y Revelación). El fondo pino con brillo lo pone el <body> (data-screen).
 * welcome({ mark:true, title:['Tu plata,','clara.'], lead:'...', bullets:[{icon:'escudo', text:'Tus datos quedan solo en tu celular.'}],
 *   children: Node[] (contenido extra antes de los botones), actions:[btn({variant:'onhero', label:'Empezar'}), btn({variant:'onhero-ghost',...})], footLink:{label, onClick} })
 */
export function welcome({ mark = true, title, lead, bullets, children, actions, footLink, cls } = {}) {
  return h('div', { class: ['welcome on-hero', cls] },
    h('div', { class: 'welcome-top stack-6' },
      mark ? h('svg', { class: 'brandmark', viewBox: '0 0 64 64', 'aria-hidden': 'true', focusable: 'false' }, h('use', { href: '#i-marca' })) : null,
      title ? h('h1', { class: 'welcome-title' }, (Array.isArray(title) ? title : [title]).flatMap((t, i) => (i ? [h('br'), t] : [t]))) : null,
      lead ? h('p', { class: 'welcome-lead' }, lead) : null,
      bullets ? h('ul', { class: 'welcome-list' }, bullets.map((b) => h('li', null, icon(b.icon), h('span', null, b.text)))) : null,
      children || null),
    h('div', { class: 'welcome-foot stack-2' }, actions || null, footLink ? h('button', { type: 'button', class: 'welcome-link', onclick: footLink.onClick }, footLink.label) : null));
}
