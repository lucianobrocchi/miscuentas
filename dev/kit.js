// Galería del kit de UI: renderiza TODOS los componentes con datos ilustrativos (nada real).
// Se sirve en /dev/kit.html pero NO se precachea. Parámetros: ?theme=light|dark  ?fs=grande|masgrande  ?privacy=1
import { h, icon, fmt, lsGet } from '../src/ui/dom.js';
import * as ui from '../src/ui/components.js';
import * as fields from '../src/ui/fields.js';
import * as charts from '../src/ui/charts.js';
import * as sheet from '../src/ui/sheet.js';
import { toast } from '../src/ui/toast.js';
import { buildNav, paintNav } from '../src/ui/nav.js';

const q = new URLSearchParams(location.search);
ui.setKnownNames([{ name: 'Vos', role: 'yo' }, { name: 'Pareja', role: 'pareja' }, { name: 'Hija', role: 'hija' }, { name: 'Hijo', role: 'hijo' }]);
const root = document.documentElement;
void lsGet;

// el sprite de íconos vive en index.html: se toma de ahí para no duplicarlo
async function loadSprite() {
  const html = await (await fetch('../index.html')).text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const sprite = doc.getElementById('sprite');
  document.body.prepend(document.importNode(sprite, true));
}

function applyPrefs() {
  const t = q.get('theme'); if (t === 'light' || t === 'dark') root.setAttribute('data-theme', t);
  const fs = q.get('fs'); if (fs) root.setAttribute('data-fontsize', fs);
  if (q.get('privacy') === '1') root.setAttribute('data-privacy', 'on');
}

const section = (id, title, note, ...kids) => h('section', { class: 'kit-sec', id }, h('h2', { class: 'kit-h' }, title), note ? h('p', { class: 'kit-note' }, note) : null, ...kids);
const amt = ui.amt;

function toolbar() {
  const setAttr = (name, v, on) => { if (on) root.setAttribute(name, v); else root.removeAttribute(name); };
  return h('div', { class: 'kit-bar' },
    ui.segmented({ ariaLabel: 'Tema', value: root.getAttribute('data-theme') || 'auto', options: [{ value: 'auto', label: 'Auto' }, { value: 'light', label: 'Claro' }, { value: 'dark', label: 'Oscuro' }],
      onChange: (v) => setAttr('data-theme', v, v !== 'auto') }),
    ui.segmented({ ariaLabel: 'Tamaño de letra', value: root.getAttribute('data-fontsize') || 'normal', options: [{ value: 'normal', label: 'Normal' }, { value: 'grande', label: 'Grande' }, { value: 'masgrande', label: 'Más grande' }],
      onChange: (v) => setAttr('data-fontsize', v, v !== 'normal') }),
    ui.chipButton('Ojo de privacidad', { selected: root.dataset.privacy === 'on', onClick: (e) => {
      const on = root.dataset.privacy !== 'on'; setAttr('data-privacy', 'on', on);
      e.currentTarget.setAttribute('aria-pressed', String(on)); } }));
}

// ---------------------------------------------------------------- datos ilustrativos
const strip4 = [
  { key: '2026-10', label: 'Oct', name: 'octubre', value: 82000, state: 'bien', current: true },
  { key: '2026-11', label: 'Nov', name: 'noviembre', value: 31000, state: 'justo' },
  { key: '2026-12', label: 'Dic', name: 'diciembre', value: 540000, state: 'bien', estimated: true },
  { key: '2027-01', label: 'Ene', name: 'enero', value: -210000, state: 'falta' },
];
const strip12 = (() => {
  const L = ['Oct', 'Nov', 'Dic', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep'];
  const V = [82000, 31000, 540000, -210000, 28000, 74000, 330000, 395000, 910000, 290000, 480000, 500000];
  const S = ['bien', 'justo', 'bien', 'falta', 'justo', 'bien', 'bien', 'bien', 'bien', 'bien', 'bien', 'bien'];
  return L.map((l, i) => ({ key: `k${i}`, label: l, name: l, value: V[i], state: S[i], current: i === 0 }));
})();
const monthItems = [
  { key: '2026-10', name: 'Octubre', short: 'Oct', value: 82000, state: 'bien', event: 'Movilidad: 21 días (feriado del 12)', eventIcon: 'bandera', onClick: () => toast('Abrir octubre') },
  { key: '2026-11', name: 'Noviembre', short: 'Nov', value: 31000, state: 'justo', event: 'Movilidad: 20 días', onClick: () => {} },
  { key: '2026-12', name: 'Diciembre', short: 'Dic', value: 540000, state: 'bien', estimated: true, event: 'Aguinaldo estimado: +$450.000', eventIcon: 'destello', onClick: () => {} },
  { key: '2027-01', name: 'Enero', short: 'Ene', value: -210000, state: 'falta', event: 'No cobrás movilidad (feria de enero)', eventIcon: 'alerta', onClick: () => {} },
];
const debtPoints = (vals) => vals.map((v, i) => ({ key: `${2026 + Math.floor((9 + i) / 12)}-${String(((9 + i) % 12) + 1).padStart(2, '0')}`, value: v }));

// ---------------------------------------------------------------- secciones
function tipografia() {
  return section('tipografia', 'Tipografía y números', 'Inter autoalojada. Mínimo 1rem (16px). Cifras tabulares.',
    ui.card([
      h('p', { class: 't-hero amt' }, h('span', { class: 'amt-v' }, '$1.234.567')),
      h('p', { class: 't-display' }, '$1.800.000 · display'),
      h('p', { class: 't-q' }, '¿Cuánto cobrás por mes? · pregunta'),
      h('p', { class: 't-big' }, '$5.300 · big'),
      h('p', { class: 't-date' }, 'abril 2027 · fecha'),
      h('p', { class: 't-h1' }, 'Título de pantalla h1'),
      h('p', { class: 't-sheet' }, 'Título de hoja'),
      h('p', { class: 't-h2' }, 'Título de sección h2'),
      h('p', { class: 't-body' }, 'Cuerpo de texto de 18px con interlineado cómodo para leer sin esfuerzo, en voseo rioplatense.'),
      h('p', { class: 't-row' }, 'Título de fila / botón 18 bold'),
      h('p', { class: 't-small muted' }, 'Detalle de 16px en gris medio. Es el mínimo de toda la app.'),
      h('p', { class: 't-small faint' }, 'Nota al pie en el gris más suave (ink-3).'),
      h('p', { class: 't-small' }, 'Menos real: ', amt(-342688), ' · compacto: ', amt(-342688, { compact: true }), ' · con signo: ', amt(5000, { plus: true }), ' · ', fmt.pct(6.493), ' · ', fmt.compact(1300000)),
    ], { cls: 'stack-2' }));
}

function colores() {
  const names = ['bg', 'surface', 'surface-2', 'line', 'field-border', 'ink', 'ink-2', 'ink-3', 'brand', 'brand-soft', 'btn-bg', 'hero-bg', 'hero-glow',
    'ok-fg', 'ok-bg', 'ok-bar', 'warn-fg', 'warn-bg', 'warn-bar', 'bad-fg', 'bad-bg', 'bad-bar', 'info-fg', 'info-bg'];
  const light = new Set(['bg', 'surface', 'surface-2', 'line', 'brand-soft', 'ok-bg', 'warn-bg', 'bad-bg', 'info-bg']);
  return section('colores', 'Colores (tokens)', 'Verde = alcanza · ámbar = ajustado · terracota = falta · azul = estimado.',
    h('div', { class: 'swatches' }, names.map((n) => h('div', { class: 'sw', style: { background: `var(--${n})`, color: light.has(n) ? 'var(--ink)' : 'var(--btn-fg)' } }, h('b', null, n)))));
}

function botones() {
  return section('botones', 'Botones, enlaces y chips', null,
    ui.btn({ label: 'Primario de 56px', onClick: () => toast('Guardado') }),
    ui.btn({ label: 'Secundario con ícono', variant: 'secondary', icon: 'whatsapp' }),
    ui.btn({ label: 'Botón de texto', variant: 'text' }),
    ui.btn({ label: 'Deshabilitado', disabled: true }),
    ui.btn({ label: 'Borrar este préstamo', variant: 'danger', icon: 'papelera' }),
    h('div', { class: 'kit-dark-wrap stack-2 on-hero' }, ui.btn({ label: 'Empezar', variant: 'onhero' }), ui.btn({ label: 'Ver un ejemplo', variant: 'onhero-ghost' })),
    h('div', { class: 'cluster' }, ui.link({ label: 'Ver todo', href: '#/deudas' }), ui.link({ label: 'Qué supone esta fecha', onClick: () => sheet.info({ title: 'Qué supone esta fecha', content: 'Ejemplo.' }) }),
      ui.iconButton({ icon: 'lapiz', label: 'Editar' }), ui.iconButton({ icon: 'papelera', label: 'Borrar' })),
    h('p', { class: 't-label' }, 'Chips de lectura'),
    h('div', { class: 'cluster' }, ui.chip('estimado', { tone: 'info' }), ui.chip('Vence el 13', { tone: 'info', icon: 'calendario' }), ui.chip('6,49% por mes', { tone: 'warn' }), ui.chip('Cuadra', { tone: 'ok', icon: 'tilde' }), ui.chip('Falta un dato', { tone: 'info', icon: 'forma-info' }), ui.chip('Para conversar', { tone: 'brand' })),
    h('p', { class: 't-label' }, 'Estados con forma + palabra'),
    h('div', { class: 'cluster' }, ['bien', 'justo', 'cubierto', 'falta', 'provisorio', 'pendiente'].map((c) => ui.status(c))),
    h('div', { class: 'cluster' }, ui.status('bien', { label: 'Alcanza, ojo con enero' }), ui.status('falta', { label: 'Te faltan este mes' })),
    h('div', { class: 'kit-dark-wrap cluster on-hero' }, ['bien', 'justo', 'falta', 'provisorio'].map((c) => ui.status(c, { onHero: true }))),
    h('p', { class: 't-label' }, 'Chips seleccionables (48px táctiles)'),
    h('div', { class: 'chips' }, ['Súper', 'Nafta', 'Salida', 'Regalo'].map((l, i) => ui.chipButton(l, { selected: i === 1 })), ui.chipButton('Otro', { icon: 'mas' })),
    h('p', { class: 't-label' }, 'Glifos'),
    h('div', { class: 'cluster' }, ['verde', 'ambar', 'terracota'].map((c) => ui.statusGlyph(c))),
    ui.legend([{ code: 'verde', label: 'Sin costo' }, { code: 'ambar', label: 'Con costo' }, { code: 'terracota', label: 'No conviene' }]));
}

function filas() {
  return section('filas', 'Filas, tarjetas y datos', null,
    ui.rowList([
      ui.row({ icon: 'tarjeta', tone: 'warn', title: 'Visa · 13 de octubre', sub: 'En 9 días · mínimo de tu resumen de septiembre', value: amt(270000), onClick: () => {} }),
      ui.row({ icon: 'banco', tone: 'neutral', title: 'Préstamos por planilla', sub: 'Se descuentan solos del sueldo', value: amt(92000) }),
      ui.row({ icon: 'documento', tone: 'info', title: 'Plan de pagos de AFIP', sub: 'Falta cargar monto y cuotas', chip: { label: 'Completar', tone: 'info' }, onClick: () => {}, pending: true }),
      ui.row({ icon: 'billetera', tone: 'brand', title: 'Para gastar hoy', sub: 'por día hasta fin de mes', value: amt(3500), valueClass: 'big', onClick: () => {} }),
      ui.row({ icon: 'bandera', tone: 'ok', title: 'Salís de la tarjeta', sub: 'faltan 7 meses', value: 'abril 2027', valueClass: 'date', onClick: () => {} }),
      ui.row({ icon: 'usuarios', tone: 'info', title: ui.personName('Hijo', 3), sub: 'Para conversar', value: amt(400000), chip: { label: 'Para conversar', tone: 'brand' } }),
    ]),
    ui.card(ui.stat({ label: 'Total del último resumen (septiembre)', value: amt(1800000), sub: 'Interés que se suma por mes: $116.820', chips: [ui.chip('Cierra el 1', { tone: 'info' }), ui.chip('6,49% por mes', { tone: 'warn' })] })),
    ui.card(ui.kv([{ label: 'Interés que se suma por mes', value: amt(116820) }, { label: 'Pago mínimo', value: amt(270000), strong: true }, { label: 'Interés extra', value: amt(85795), tone: 'warn' }, { label: 'Falta', value: amt(-210000), tone: 'bad' }])),
    ui.sectionTitle('Lo que vence', { label: 'Ver todo', href: '#/deudas' }),
    ui.notice({ tone: 'brand', title: 'Protegido por el ojo', text: 'Si Hijo te devuelve $50.000 por mes, salís un mes antes y ahorrás $58.000. Faltan −$210.000 en enero.' }),
    ui.pageTitle('Los próximos meses', 'Lo que te sobra cada mes, después de pagar todo.'),
    ui.footnote('Tus datos están solo en este celular. Última copia: hace 3 días.'), ui.disclaimer());
}

function opciones() {
  const seg = ui.segmented({ ariaLabel: 'Meses', options: [{ value: '4', label: '4 meses' }, { value: '12', label: '12 meses' }], value: '4', onChange: (v) => toast(`Elegiste ${v}`) });
  return section('opciones', 'Segmentado y opciones', null, seg,
    ui.optionGroup({ name: 'pago', ariaLabel: 'Cuánto pagar', value: 'sobra', options: [
      { value: 'min', title: 'Solo el mínimo', sub: 'Salís en junio 2027 · interés total $914.000', end: amt(270000) },
      { value: 'sobra', title: 'Lo que sobra', sub: 'Salís en abril 2027 · ahorrás $298.000 de interés', end: amt(352000), tag: 'Recomendado' },
      { value: 'otro', title: 'Otro monto', sub: 'Elegí cuánto pagar' }] }),
    fields.choice({ label: '¿Ese sueldo ya tiene restados los descuentos?', variant: 'options', value: null, options: [
      { value: true, title: 'Sí, ya están restados' }, { value: false, title: 'No, hay que restarlos' }, { value: null, title: 'No sé' }].map((o) => ({ ...o, label: o.title })) }).el);
}

function campos() {
  const sueldo = fields.money({ label: '¿Cuánto cobrás de sueldo por mes?', value: 900000, hint: 'Poné el neto, lo que figura en el recibo como total a cobrar.', help: 'neto', name: 'sueldo', validate: (n) => (n > 20000000 ? 'Mirá bien los ceros, por favor.' : null) });
  const error = fields.money({ label: 'Con error', value: 30000000, required: true, validate: (n) => (n > 20000000 ? 'Mirá bien los ceros, por favor.' : null), big: false });
  const stepper = fields.stepper({ label: 'Cuotas que faltan', value: 10, min: 1, max: 60, unit: 'cuotas', hint: 'Incluida la de este mes' });
  const meses = fields.monthChips({ label: '¿Hay meses en que no la cobrás?', options: fields.MONTHS_OF_YEAR, multi: true, value: [1] });
  const personas = fields.person({ label: '¿De quién es?', people: [{ id: 'a', name: 'Vos' }, { id: 'b', name: 'Pareja' }, { id: 'c', name: 'Hija' }], value: 'a', allowNone: true });
  setTimeout(() => error.validate(), 0);
  return section('campos', 'Campos (los mismos del onboarding y los editores)', 'Dinero con puntos de miles en vivo; coma o punto en tasas; nunca step.',
    h('div', { class: 'stack-4' },
      sueldo.el,
      fields.rate({ label: 'Interés por mes', value: 6.49, help: 'interesMensual' }).el,
      fields.text({ label: '¿Cómo te llamamos?', placeholder: 'Ej: Ana', name: 'nombre' }).el,
      fields.textarea({ label: 'Mensaje (editable)', value: 'Hola, te paso la cuenta de la tarjeta: tu parte hoy es $400.000. ¿Lo vemos?', rows: 3 }).el,
      fields.date({ label: '¿Cuándo la pagaste?', value: '2026-10-04' }).el,
      stepper.el, meses.el, personas.el, error.el,
      fields.toggle({ label: 'Cobro aguinaldo en junio y diciembre', hint: 'Calculamos la mitad de tu sueldo', value: true }).el,
      fields.toggle({ label: 'Le cobro el interés de lo suyo', value: false }).el,
      fields.choice({ label: 'Cobra', options: [{ value: 'all', label: 'Todos los meses' }, { value: '6,12', label: 'Solo junio y diciembre' }], value: 'all' }).el,
      fields.choice({ label: 'Cuota', variant: 'chips', options: [{ value: 30000, label: '$30.000' }, { value: 50000, label: '$50.000' }, { value: 100000, label: '$100.000' }], value: 50000 }).el,
      fields.group({ legend: 'Tu tarjeta', children: [fields.money({ label: 'Total a pagar', big: false, value: 1800000 }).el, fields.money({ label: 'Pago mínimo', big: false, value: 270000, help: 'pagoMinimo' }).el] })));
}

function avisos() {
  return section('avisos', 'Avisos, vacíos, hitos y glosario', null,
    ui.notice({ tone: 'warn', title: 'Ya cerró el resumen de septiembre (1 de octubre)', text: 'Cargalo para ver el monto exacto.', action: { label: 'Cargar resumen nuevo', onClick: () => {} } }),
    ui.notice({ tone: 'info', title: 'El aguinaldo es una estimación', text: 'La mitad de tu sueldo. Confirmalo con tu recibo.' }),
    ui.notice({ tone: 'info', dashed: true, title: 'Falta un dato: el plan de AFIP', text: 'Mientras tanto, tu cuenta es un poco más optimista que la realidad.', action: { label: 'Completar', onClick: () => {} } }),
    ui.notice({ tone: 'ok', title: 'Listo, guardado', text: 'Tus cuentas ya incluyen este dato.' }),
    ui.notice({ tone: 'bad', title: 'Mirá bien los ceros', text: 'Ese número parece muy grande.' }),
    ui.pill('Sin internet no pasa nada: todo está guardado en tu celular.'),
    ui.card(ui.empty({ title: 'Empecemos por lo que cobrás', text: 'Con eso ya te muestro cuánto te sobra cada mes.', action: { label: 'Empezar', onClick: () => {} }, secondary: { label: 'Ver un ejemplo', onClick: () => {} }, art: 'barras' })),
    h('div', { class: 'auto-grid' }, ['tarjeta', 'personas', 'lista', 'obra'].map((a) => ui.card(ui.empty({ title: a, art: a })))),
    ui.milestone({ title: '¡Se terminó!', text: 'El préstamo de $80.000 quedó atrás. Desde agosto tenés $80.000 más por mes.', action: { label: 'Seguir', onClick: () => {} }, secondary: { label: 'Contárselo a la familia', icon: 'compartir' } }),
    h('div', { class: 'cluster' }, Object.keys(ui.GLOSSARY).map((k) => ui.glossary(k, { label: ui.GLOSSARY[k].title }))));
}

function barras() {
  const vals = [82000, 31000, 540000, -210000];
  const max = ui.divergingScale(vals);
  return section('barras', 'Barras, progreso, anillo y pips', null,
    ui.card(h('div', { class: 'stack-3' }, vals.map((v, i) => h('div', { class: 'between' }, h('span', { class: 't-small', style: { width: '4.5rem' } }, ['Oct', 'Nov', 'Dic', 'Ene'][i]), h('span', { class: 'grow' }, ui.divergingBar({ value: v, max, tone: ['ok', 'warn', 'ok', 'bad'][i], estimated: i === 2 })), amt(v))))),
    ui.progressBar({ value: 4, max: 7, label: '4 de 7' }), ui.progressBar({ value: 60, tone: 'info', dashed: true, label: 'a completar' }), ui.progressSteps({ total: 7, current: 3 }),
    h('div', { class: 'cluster-3' }, ui.ring({ value: 4, total: 7 }), ui.ring({ value: 1, total: 7, size: 72 })),
    h('div', { class: 'stack-3' }, ui.pips({ total: 10, paid: 4 }), ui.pips({ total: 36, paid: 26 })),
    ui.disclosure({ summary: 'Ver los números', content: ui.dataTable({ caption: 'Ejemplo', head: ['Mes', 'Sobra'], rows: [['Octubre', amt(82000)], ['Noviembre', amt(31000)]] }) }));
}

function heroes() {
  const hero = (cfg) => ui.hero({ countKey: `kit-${Math.random()}`, ...cfg });
  return section('heroes', 'Hero y tira de meses', null,
    hero({ label: 'Va a la tarjeta este mes', value: 82000, status: 'bien', statusLabel: 'Alcanza, ojo con enero', caption: 'Esa plata va a pagar la tarjeta', note: { text: 'Incluye 3 datos estimados', onClick: () => {} }, aviso: { icon: 'alerta', text: 'Ojo con enero: faltan $210.000', onClick: () => {} }, strip: strip4, onOpen: () => {}, ariaLabel: 'Va a la tarjeta 82000 pesos este mes, alcanza' }),
    hero({ label: 'Te faltan este mes', value: -150000, status: 'falta', caption: 'Hay 3 formas de cubrirlo', aviso: { icon: 'alerta', text: 'Hay 3 formas de cubrirlo', onClick: () => {} }, strip: strip4.map((s, i) => (i === 0 ? { ...s, value: -150000, state: 'falta' } : s)), onOpen: () => {} }),
    hero({ label: 'Te sobran en octubre', value: -1150000, status: 'provisorio', caption: 'Número largo para probar que entra', strip: strip4 }),
    hero({ label: 'Te sobran en octubre', value: 310000, status: 'bien', caption: 'Queda guardada', aviso: { icon: 'tilde', text: 'Los próximos 12 meses se ven bien' } }),
    ui.card(h('div', null, h('p', { class: 't-label' }, 'Tira de 12 meses sobre tarjeta blanca'), charts.monthStrip(strip12, { onHero: false, ariaLabel: 'Los próximos 12 meses' })), { cls: 'stack-2' }));
}

function graficos() {
  const plan = debtPoints([1800000, 1560000, 1010000, 520000, 120000, 0].map((v) => v));
  const min = debtPoints([1800000, 1700000, 1590000, 1460000, 1340000, 1200000, 1050000, 880000, 700000, 500000, 280000, 0]);
  return section('graficos', 'Gráficos', 'viewBox = ancho medido; texto de 16px real; tabla alternativa bajo "Ver los números".',
    ui.sectionTitle('Meses (4 meses)'), charts.monthRows(monthItems, { mode: '4' }),
    ui.sectionTitle('Meses (12 meses)'), charts.monthRows(strip12.slice(0, 7).map((s) => ({ ...s, short: s.label, event: s.value < 0 ? 'No cobrás movilidad' : '', eventIcon: 'alerta', onClick: () => {} })), { mode: '12' }),
    ui.sectionTitle('Cómo baja la deuda'),
    ui.card(charts.debtLine({ series: [{ name: 'Tu plan', points: plan, style: 'solid', endLabel: 'marzo 2027' }, { name: 'Solo el mínimo', points: min, style: 'dashed', endLabel: 'agosto 2027' }], ariaLabel: 'La deuda baja de $1.800.000 a cero en marzo 2027 con tu plan, y en agosto 2027 pagando solo el mínimo.', tableCaption: 'Deuda de la tarjeta mes a mes' })),
    ui.sectionTitle('Cuándo termina cada deuda'),
    charts.timeline({ from: '2026-10', to: '2029-03', todayKey: '2026-10', items: [
      { id: 'v', label: 'Tarjeta Visa', sub: 'Debés $1.800.000', start: '2026-10', end: '2027-03', dateLabel: 'marzo 2027', onClick: () => {} },
      { id: 'a', label: 'Préstamo de $80.000', sub: 'Quedan 10 cuotas · se descuenta del sueldo', start: '2026-10', end: '2027-07', dateLabel: 'julio 2027', pipsInfo: { total: 36, paid: 26 }, onClick: () => {} },
      { id: 'b', label: 'Préstamo de $12.000', sub: 'Quedan 29 cuotas', start: '2026-10', end: '2029-02', dateLabel: 'febrero 2029', onClick: () => {} },
      { id: 'c', label: 'Plan de pagos de AFIP', sub: 'Falta cargar monto y cuotas', pending: true, onClick: () => {} }] }),
    ui.sectionTitle('Quién debe qué'),
    ui.card(charts.stacked({ parts: [{ label: 'Hijo', value: 400000, tone: 'info' }, { label: 'Resto', value: 1400000, tone: 'brand' }] })));
}

function decidir() {
  const items = ['Oct', 'Nov', 'Dic', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep'].map((l, i) => ({ key: `m${i}`, label: l, state: ['verde', 'ambar', 'ambar', 'terracota', 'ambar', 'verde', 'verde', 'verde', 'verde', 'verde', 'verde', 'verde'][i] }));
  return section('decidir', '¿Me alcanza?: mapa de meses y veredicto', null,
    ui.monthMap({ items, value: 'm2', ariaLabel: '¿Cuándo?' }),
    ui.legend([{ code: 'verde', label: 'Sin costo' }, { code: 'ambar', label: 'Con costo' }, { code: 'terracota', label: 'No conviene' }]),
    ui.verdict({ code: 'ambar', title: 'Se puede, pero tiene costo', text: 'Un viaje de $300.000 en diciembre te sale $385.000 porque hoy la tarjeta cobra 6,49% por mes.', rows: [{ label: 'Diciembre queda en', value: amt(451000) }, { label: 'Salís de la tarjeta', value: 'abril 2027 (igual)' }, { label: 'Interés extra', value: amt(85000), strong: true }], footer: ui.disclaimer() }),
    ui.verdict({ code: 'verde', title: 'Entra sin problemas', text: 'No cambia tu fecha de salida ni deja ningún mes en rojo.' }),
    ui.verdict({ code: 'terracota', title: 'No conviene ahora', text: 'Con este televisor, noviembre queda en rojo: faltarían $165.000. Si igual lo necesitás, lo mejor es abril.' }));
}

function pantallas() {
  const f = fields.money({ value: 900000, big: true, ariaLabel: 'Sueldo' });
  return section('pantallas', 'Cáscara de onboarding y bienvenida', null,
    h('div', { class: 'kit-phone' }, ui.stepShell({ step: 2, total: 7, stepLabel: 'Lo que cobrás', question: '¿Cuánto cobrás de sueldo por mes?', help: 'Poné el neto, lo que figura en el recibo como total a cobrar. Si no es exacto, no pasa nada.', content: [f.el], reward: { text: 'En octubre entran $1.200.000.' }, onBack: () => {}, onSkip: () => {}, primary: { label: 'Seguir', onClick: () => {} }, secondary: { label: 'No lo sé todavía', onClick: () => {} } })),
    h('div', { class: 'kit-phone', style: { background: 'var(--hero-bg)' } }, ui.welcome({ title: ['Tu plata,', 'clara.'], lead: 'En unos 10 minutos vas a saber cómo te va a ir en los próximos meses y cuándo salís de cada deuda.', bullets: [{ icon: 'escudo', text: 'Tus datos quedan solo en tu celular.' }, { icon: 'tilde', text: 'Sin retos ni culpas: solo números claros.' }, { icon: 'calendario', text: 'Podés frenar y seguir cuando quieras.' }], actions: [ui.btn({ label: 'Empezar', variant: 'onhero' }), ui.btn({ label: 'Ver cómo se ve con un ejemplo', variant: 'onhero-ghost' })], footLink: { label: 'Ya tengo una copia de seguridad' } })),
    ui.ribbon({ text: 'Esto es un ejemplo, no son tus números', actionLabel: 'Cargar lo mío' }),
    ui.fab({ label: 'Agregar', onClick: () => {} }));
}

function hojas() {
  const open1 = () => sheet.open({ title: 'Para gastar hoy', render: (b) => b.append(h('p', { class: 't-body' }, 'Tu plata para gustos este mes: $100.000. Faltan 28 días. $100.000 ÷ 28 = $3.571. Redondeamos para abajo: $3.500.'), ui.progressBar({ value: 12, max: 100 }), ui.disclaimer()), footer: (close) => ui.btn({ label: 'Anoté un gasto', onClick: () => close() }) });
  const open2 = () => {
    const f = fields.money({ label: '¿Cuánto te pasó?', big: true, autofocus: true });
    let dirty = false; f.onChange(() => { dirty = true; });
    sheet.open({ title: 'Anotar pago', size: 'tall', dirty: () => dirty, render: (b) => b.append(h('div', { class: 'stack-4' }, f.el, h('div', { class: 'chips' }, ['Lo acordado', 'Todo lo que debe', 'Otro monto'].map((l) => ui.chipButton(l))), ...Array.from({ length: 6 }, (_, i) => h('p', { class: 't-body muted' }, `Párrafo de relleno ${i + 1} para probar el scroll adentro de la hoja.`)))),
      footer: (close) => [ui.btn({ label: 'Guardar', onClick: () => { if (f.validate()) { dirty = false; close(); toast('Anotado. Hijo ahora te debe $350.000.', { actionLabel: 'Deshacer', onAction: () => toast('Deshecho') }); } } }), ui.btn({ label: 'Cancelar', variant: 'text', onClick: () => close() })] });
  };
  const open3 = async () => { const ok = await sheet.confirm({ title: '¿Borrar el préstamo de $12.000?', message: 'Dejás de pagarlo en la proyección y tu plata libre sube $12.000 por mes.', confirmLabel: 'Borrar', tone: 'bad', icon: 'papelera' }); toast(ok ? 'Borrado.' : 'No se borró.', ok ? { actionLabel: 'Deshacer' } : {}); };
  const open4 = () => sheet.open({ title: 'Hoja de arriba', render: (b, close) => b.append(h('div', { class: 'stack-3' }, h('p', { class: 't-body' }, 'Abrí otra hoja encima: Atrás del celular cierra solo la de arriba.'), ui.btn({ label: 'Abrir otra encima', variant: 'secondary', onClick: () => sheet.open({ title: 'Segunda hoja', render: (bb) => bb.append(h('p', { class: 't-body' }, 'Cerrame con Atrás, Esc o el botón Cerrar.')) }) }))) });
  return section('hojas', 'Hojas, confirmaciones, toasts', 'Atrás del navegador cierra la hoja; Esc, toque en el fondo y el botón Cerrar también.',
    h('div', { class: 'stack-2' },
      ui.btn({ label: 'Abrir hoja simple', variant: 'secondary', onClick: open1 }),
      ui.btn({ label: 'Hoja alta con formulario y cambios sin guardar', variant: 'secondary', onClick: open2 }),
      ui.btn({ label: 'Confirmar borrado (terracota)', variant: 'secondary', onClick: open3 }),
      ui.btn({ label: 'Dos hojas apiladas', variant: 'secondary', onClick: open4 }),
      ui.btn({ label: 'Glosario: pago mínimo', variant: 'secondary', onClick: () => ui.openGlossary('pagoMinimo') }),
      ui.btn({ label: 'Toast simple', variant: 'text', onClick: () => toast('Listo, cambiamos tu plan.') }),
      ui.btn({ label: 'Toast con Deshacer', variant: 'text', onClick: () => toast('Borrado.', { actionLabel: 'Deshacer', onAction: () => toast('Listo, volvió a como estaba.') }) })));
}

async function main() {
  applyPrefs();
  await loadSprite();
  buildNav({ tabbar: document.getElementById('tabbar-in'), rail: document.getElementById('rail'), onClick: (e) => e.preventDefault() });
  paintNav('hoy', { mas: true });
  document.getElementById('topbar').append(h('div', { class: 'topbar-main' }, h('div', { class: 'topbar-text' }, h('span', { class: 'topbar-eyebrow' }, 'Galería del kit'), h('span', { class: 'topbar-title' }, 'Mis Cuentas 2.0'))),
    h('div', { class: 'topbar-actions' }, ui.iconButton({ icon: 'ojo', label: 'Ocultar montos', onClick: () => { const on = root.dataset.privacy !== 'on'; if (on) root.setAttribute('data-privacy', 'on'); else root.removeAttribute('data-privacy'); } })));
  const view = document.getElementById('view');
  view.replaceChildren(h('div', { class: 'screen' }, toolbar(), heroes(), botones(), filas(), opciones(), campos(), avisos(), barras(), graficos(), decidir(), pantallas(), hojas(), tipografia(), colores()));
  window.__kitReady = true;
}
main().catch((e) => { console.error(e); document.getElementById('view').textContent = 'Error: ' + e.message; });
