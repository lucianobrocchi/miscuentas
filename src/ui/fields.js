// fields.js · campos reutilizables. El onboarding y los editores usan ESTOS mismos campos (un solo código).
// Cada función devuelve un "controlador":
//   { el, name, get(), set(v), setError(msg|null), validate() -> boolean, focus(), onChange(fn) }
// `el` es el Node que se agrega a la pantalla u hoja. La etiqueta va SIEMPRE arriba (nunca el placeholder como etiqueta),
// la ayuda abajo (16px) y el error en lenguaje de casa con ícono (nunca solo color).

import { h, icon, fmt } from './dom.js';
import { moneyInput, stepper as stepperEl, chipButton, segmented, glossary, optionGroup } from './components.js';

let n = 0;
const nid = (p) => `${p}-${++n}`;

/** Cáscara común: etiqueta + (glosario) + control + ayuda + error. */
function shell({ label, hint, help, helpLabel, id, name, control, error, cls, labelHidden }) {
  const hintId = hint ? `${id}-h` : null;
  const errId = `${id}-e`;
  const errEl = h('p', { class: 'field-error', id: errId, role: 'alert', hidden: true }, icon('alerta', { size: 'sm' }), h('span', { class: 'field-error-t' }));
  const head = (label || help) ? h('div', { class: ['field-head', labelHidden && 'sr-only'] },
    label ? h('label', { class: 'field-label', for: id }, label) : null,
    help ? glossary(help, { label: helpLabel || 'Qué es esto' }) : null) : null;
  const hintEl = hint ? h('p', { class: 'field-hint', id: hintId }, hint) : null;
  const el = h('div', { class: ['field', cls], dataset: { field: name || id } }, head, control, hintEl, errEl);
  const setError = (msg) => {
    errEl.hidden = !msg;
    errEl.querySelector('.field-error-t').textContent = msg || '';
    el.classList.toggle('has-error', !!msg);
    const inp = el.querySelector('input,textarea,select');
    if (inp) {
      inp.setAttribute('aria-invalid', msg ? 'true' : 'false');
      const ids = [hintId, msg ? errId : null].filter(Boolean).join(' ');
      if (ids) inp.setAttribute('aria-describedby', ids); else inp.removeAttribute('aria-describedby');
    }
    if (error) { /* reservado */ }
  };
  return { el, setError, hintId, errId };
}

function controller(base, { name, get, set, focus, validateFn, required, requiredMsg }) {
  const listeners = [];
  const c = {
    el: base.el, name, get, set,
    setError: base.setError,
    clearError: () => base.setError(null),
    focus: focus || (() => base.el.querySelector('input,button,textarea,select')?.focus()),
    onChange: (fn) => { listeners.push(fn); return c; },
    _emit: (v) => listeners.forEach((f) => f(v)),
    validate() {
      const v = get();
      const empty = v == null || v === '' || (Array.isArray(v) && !v.length);
      let msg = null;
      if (required && empty) msg = requiredMsg || 'Completá este dato.';
      else if (validateFn && !empty) msg = validateFn(v) || null;
      base.setError(msg);
      return !msg;
    },
  };
  return c;
}

/**
 * Campo de dinero: money({ label:'¿Cuánto cobrás de sueldo por mes?', value:900000, hint:'Poné el neto...', help:'neto',
 *   onChange:(n)=>..., big:true, name:'sueldo', required:true, requiredMsg:'Poné cuánto cobrás.', max:999999999,
 *   validate:(n)=>n>20000000?'Mirá bien los ceros, por favor.':null, placeholder:'Ej: 900.000', autofocus:false })
 * get() -> number | null.
 */
export function money(opts = {}) {
  const { label, value, hint, help, helpLabel, onChange, big = true, name, required, requiredMsg, validate, max, placeholder, autofocus, kind = 'money', ariaLabel, onEnter } = opts;
  const id = nid('f');
  let ctl;
  const input = moneyInput({
    value, kind, big, name, id, max, placeholder, autofocus, ariaLabel: label ? null : ariaLabel, onEnter,
    ariaDescribedby: hint ? `${id}-h` : null,
    onChange: (v) => { if (ctl) { ctl.clearError(); ctl._emit(v); } onChange?.(v); },
  });
  const base = shell({ label, hint, help, helpLabel, id, name, control: input });
  ctl = controller(base, { name, get: () => input.getValue(), set: (v) => input.setValue(v), focus: () => input.focus(), validateFn: validate, required, requiredMsg });
  ctl.input = input.input;
  return ctl;
}

/** Interés mensual en % (teclado decimal, coma o punto, sin step). rate({label:'Interés por mes', value:6.49, help:'interesMensual'}) -> get() number|null */
export const rate = (opts = {}) => money({ ...opts, kind: 'rate', big: opts.big ?? false });

/** Número entero sin $ ni puntos (días, cuotas). Para cantidades chicas preferí stepper(). */
export const int = (opts = {}) => money({ ...opts, kind: 'int', big: opts.big ?? false });

/** Texto corto. text({ label:'¿Cómo te llamamos?', value:'', hint:'', name:'nombre', maxLength:40, required:true, autocomplete:'given-name', onChange }) */
export function text(opts = {}) {
  const { label, value = '', hint, help, helpLabel, onChange, name, required, requiredMsg, validate, maxLength, placeholder, autocomplete = 'off', autofocus, inputmode, enterkeyhint = 'done', onEnter, multiline = false, rows = 4 } = opts;
  const id = nid('f');
  let ctl;
  const attrs = {
    id, name: name || null, class: ['text-in', multiline && 'text-area'], value, maxlength: maxLength || null, placeholder: placeholder || null,
    autocomplete, autocapitalize: 'sentences', inputmode: inputmode || null, enterkeyhint, autofocus: autofocus || null,
    'aria-describedby': hint ? `${id}-h` : null,
    oninput: (e) => { ctl.clearError(); ctl._emit(e.target.value); onChange?.(e.target.value); },
    onkeydown: (e) => { if (e.key === 'Enter' && !multiline) { e.preventDefault(); onEnter?.(e.target.value); } },
  };
  const input = multiline ? h('textarea', { ...attrs, rows, value: null }, value) : h('input', { ...attrs, type: 'text' });
  const base = shell({ label, hint, help, helpLabel, id, name, control: input });
  ctl = controller(base, { name, get: () => input.value, set: (v) => { input.value = v ?? ''; }, focus: () => input.focus(), validateFn: validate, required, requiredMsg });
  ctl.input = input;
  return ctl;
}
/** Texto largo editable (mensaje de WhatsApp). textarea({label, value, rows}) */
export const textarea = (opts = {}) => text({ ...opts, multiline: true });

/** Fecha (selector nativo). date({label:'¿Cuándo la pagaste?', value:'2026-10-04', min, max}) -> get() 'YYYY-MM-DD' */
export function date(opts = {}) {
  const { label, value = '', hint, onChange, name, required, requiredMsg, min, max } = opts;
  const id = nid('f');
  let ctl;
  const input = h('input', { id, name: name || null, type: 'date', class: 'text-in date-in', value, min: min || null, max: max || null, 'aria-describedby': hint ? `${id}-h` : null,
    oninput: (e) => { ctl.clearError(); ctl._emit(e.target.value); onChange?.(e.target.value); } });
  const base = shell({ label, hint, id, name, control: input });
  ctl = controller(base, { name, get: () => input.value || null, set: (v) => { input.value = v || ''; }, focus: () => input.focus(), required, requiredMsg });
  ctl.input = input;
  return ctl;
}

/** Lista de meses para chips: monthRange('2026-10', 12) -> [{value:'2026-10', label:'Oct'}, ...] (con año en enero). */
export function monthRange(startKey, count = 12) {
  const short = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  let [y, m] = startKey.split('-').map(Number);
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({ value: `${y}-${String(m).padStart(2, '0')}`, label: short[m - 1] + (m === 1 || i === 0 ? ` ${String(y).slice(2)}` : '') });
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}
/** Los 12 meses del año con número como valor (1..12): para "meses en que cobra" (aguinaldo = [6,12]). */
export const MONTHS_OF_YEAR = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'].map((label, i) => ({ value: i + 1, label }));

/**
 * Chips de mes (o de cualquier opción corta). monthChips({ label:'¿Desde qué mes?', options: monthRange('2026-10', 12), value:'2026-10', multi:false, onChange })
 * multi:true -> get() devuelve un array; single -> el valor o null (tocar el chip elegido lo deselecciona solo si allowEmpty).
 */
export function monthChips(opts = {}) {
  const { label, hint, options, value, multi = false, allowEmpty = false, onChange, name, required, requiredMsg, help, helpLabel } = opts;
  const id = nid('f');
  let cur = multi ? new Set(value || []) : (value ?? null);
  let ctl;
  const group = h('div', { class: 'chips', role: multi ? 'group' : 'radiogroup', 'aria-labelledby': label ? `${id}-l` : null });
  const paint = () => {
    group.replaceChildren(...options.map((o) => chipButton(o.label, {
      selected: multi ? cur.has(o.value) : cur === o.value, value: o.value,
      ariaLabel: o.ariaLabel,
      onClick: () => {
        if (multi) { cur.has(o.value) ? cur.delete(o.value) : cur.add(o.value); }
        else cur = (cur === o.value && allowEmpty) ? null : o.value;
        paint(); ctl.clearError();
        const v = get(); ctl._emit(v); onChange?.(v);
      },
    })));
  };
  const get = () => (multi ? options.map((o) => o.value).filter((v) => cur.has(v)) : cur);
  const base = shell({ label: null, hint, id, name, control: group });
  if (label) base.el.prepend(h('div', { class: 'field-head' }, h('span', { class: 'field-label', id: `${id}-l` }, label), help ? glossary(help, { label: helpLabel || 'Qué es esto' }) : null));
  ctl = controller(base, { name, get, set: (v) => { cur = multi ? new Set(v || []) : (v ?? null); paint(); }, focus: () => group.querySelector('button')?.focus(), required, requiredMsg });
  paint();
  return ctl;
}

/** Selector de persona (chips): person({ label:'¿De quién es?', people:[{id,name}], value:'p1', allowNone:true, noneLabel:'De nadie en particular', onChange }) */
export function person(opts = {}) {
  const { label = '¿De quién es?', people = [], value = null, allowNone = false, noneLabel = 'Nadie en particular', onChange, name, required, requiredMsg, hint } = opts;
  const options = [...(allowNone ? [{ value: '', label: noneLabel }] : []), ...people.map((p) => ({ value: p.id, label: p.name }))];
  const c = monthChips({ label, options, value: value ?? (allowNone ? '' : null), onChange: (v) => onChange?.(v === '' ? null : v), name, required, requiredMsg, hint });
  const baseGet = c.get;
  c.get = () => { const v = baseGet(); return v === '' ? null : v; };
  return c;
}

/** Cantidad con − y +: stepper({ label:'Cuotas que faltan', value:10, min:1, max:60, unit:'cuotas', hint:'Incluida la de este mes', onChange }) */
export function stepper(opts = {}) {
  const { label, value = 0, min = 0, max = 999, step = 1, unit, hint, onChange, name, required, requiredMsg, validate, format, help, helpLabel } = opts;
  const id = nid('f');
  let ctl;
  const st = stepperEl({ value, min, max, step, unit, format, ariaLabel: label || unit, id, onChange: (v) => { ctl.clearError(); ctl._emit(v); onChange?.(v); } });
  const base = shell({ label, hint, help, helpLabel, id, name, control: st });
  ctl = controller(base, { name, get: () => st.getValue(), set: (v) => st.setValue(v), focus: () => st.querySelector('input')?.focus(), validateFn: validate, required, requiredMsg });
  return ctl;
}

/** Interruptor (role=switch). toggle({ label:'Cobro aguinaldo en junio y diciembre', hint:'Calculamos la mitad de tu sueldo', value:true, onChange }) -> get() boolean */
export function toggle(opts = {}) {
  const { label, hint, value = false, onChange, name } = opts;
  const id = nid('f');
  let ctl;
  const input = h('input', { type: 'checkbox', role: 'switch', id, name: name || null, class: 'toggle-in', checked: !!value, 'aria-describedby': hint ? `${id}-h` : null,
    onchange: (e) => { ctl._emit(e.target.checked); onChange?.(e.target.checked); } });
  const el = h('div', { class: 'field field-toggle', dataset: { field: name || id } },
    h('label', { class: 'toggle', for: id },
      h('span', { class: 'toggle-text' }, h('span', { class: 'toggle-label' }, label), hint ? h('span', { class: 'toggle-hint', id: `${id}-h` }, hint) : null),
      input, h('span', { class: 'toggle-ui', 'aria-hidden': 'true' }, h('span', { class: 'toggle-knob' }))));
  ctl = controller({ el, setError: () => {} }, { name, get: () => input.checked, set: (v) => { input.checked = !!v; }, focus: () => input.focus() });
  ctl.input = input;
  return ctl;
}

/**
 * Elección entre pocas opciones. choice({ label:'¿Cobra?', options:[{value:'all', label:'Todos los meses'}, {value:'6,12', label:'Solo junio y diciembre'}],
 *   value:'all', variant:'segmented' | 'options' (radios de 88px con título/sub) | 'chips', onChange })
 * Para preguntas tipo Sí / No / No sé: options:[{value:true,label:'Sí'},{value:false,label:'No'},{value:null,label:'No sé'}] con variant:'options'.
 * get() devuelve el valor ORIGINAL (boolean/null/number/string), no el texto.
 */
export function choice(opts = {}) {
  const { label, hint, options, value, variant = 'segmented', onChange, name, required, requiredMsg, help, helpLabel } = opts;
  const id = nid('f');
  const keyOf = (v) => (v === null ? '__null' : String(v));
  const byKey = new Map(options.map((o) => [keyOf(o.value), o.value]));
  let cur = value === undefined ? null : value;
  let ctl;
  const handle = (k) => { cur = byKey.get(k); ctl.clearError(); ctl._emit(cur); onChange?.(cur); };
  let control;
  if (variant === 'chips') {
    control = h('div', { class: 'chips', role: 'radiogroup', 'aria-labelledby': `${id}-l` });
    const paint = () => control.replaceChildren(...options.map((o) => chipButton(o.label, { selected: cur === o.value, onClick: () => { cur = o.value; paint(); handle(keyOf(o.value)); } })));
    paint();
    control._paint = paint;
  } else if (variant === 'options') {
    control = optionGroup({ options: options.map((o) => ({ ...o, value: keyOf(o.value) })), value: keyOf(cur), onChange: handle, name: name || id, ariaLabel: label });
  } else {
    control = segmented({ options: options.map((o) => ({ ...o, value: keyOf(o.value) })), value: keyOf(cur), onChange: handle, name: name || id, ariaLabel: label });
  }
  const base = shell({ label: null, hint, id, name, control });
  if (label) base.el.prepend(h('div', { class: 'field-head' }, h('span', { class: 'field-label', id: `${id}-l` }, label), help ? glossary(help, { label: helpLabel || 'Qué es esto' }) : null));
  ctl = controller(base, {
    name, get: () => cur,
    set: (v) => { cur = v; if (variant === 'chips') control._paint(); else control.value = keyOf(v); },
    focus: () => base.el.querySelector('input,button')?.focus(), required, requiredMsg,
  });
  return ctl;
}

/** Agrupa campos con un título (fieldset accesible). group({ legend:'Tu tarjeta', children:[campo.el, ...] }) */
export function group({ legend, children, cls }) {
  return h('fieldset', { class: ['field-group', cls] }, legend ? h('legend', { class: 't-h2' }, legend) : null, children);
}

/** Valida una lista de controladores; enfoca el primero con error y devuelve true si todo está bien. */
export function validateAll(list) {
  let first = null;
  for (const c of list) { if (!c.validate() && !first) first = c; }
  if (first) { first.focus(); first.el.scrollIntoView?.({ block: 'center', behavior: 'smooth' }); }
  return !first;
}
/** Junta {name: valor} de una lista de controladores con name. */
export function collect(list) {
  return Object.fromEntries(list.filter((c) => c.name).map((c) => [c.name, c.get()]));
}

export { fmt };
