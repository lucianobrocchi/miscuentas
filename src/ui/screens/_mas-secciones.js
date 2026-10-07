// _mas-secciones.js · las secciones de Más (#/mas/<sec>): Tus datos, Ingresos, Gastos, Cuotas y descuentos, Tarjetas, Me deben, Ajustes,
// Apariencia, Copia de seguridad y Ayuda. Cada una es una función (ctx, root) que llena la pantalla. Todo cambio pasa por ctx.update
// (con Deshacer) y por ctx.editors (los mismos editores que usa el resto de la app). Toda cifra sale de ctx.derive.

import { h } from '../dom.js';
import { filas, filaConMonto } from '../_ed-core.js';
import * as FM from '../_ed-forms.js';
import * as L from '../_ed-logic.js';
import { mandarCopia, descargarCopia, hojaRestaurar } from '../_backup.js';
import { hojaInstalar, detectarEntorno } from '../_install.js';
import { diasDesdeCopia } from '../../store.js';
import { monthName, haceTiempo } from '../../format.js';

export const SECCIONES = {
  datos: { titulo: 'Tus datos' },
  ingresos: { titulo: 'Ingresos' },
  gastos: { titulo: 'Gastos' },
  cuotas: { titulo: 'Cuotas y descuentos' },
  tarjetas: { titulo: 'Tarjetas y deudas' },
  medeben: { titulo: 'Me deben' },
  ajustes: { titulo: 'Ajustes' },
  apariencia: { titulo: 'Apariencia' },
  copia: { titulo: 'Copia de seguridad' },
  ayuda: { titulo: 'Cómo se calculan los números' },
};

const abrir = (ctx, kind, id, opts) => Promise.resolve(ctx.editors.open(kind, id, opts)).catch(() => ctx.toast('No pudimos abrir eso. Probá de nuevo.'));
const cap = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

/** Fila "agregar": botón secundario con "+" (visible, grande, sin gestos escondidos). */
const agregar = (ctx, label, onClick, icon = 'mas') => ctx.ui.btn({ label, variant: 'secondary', icon, onClick });

const vacio = (ctx, titulo, texto, accion) => ctx.ui.empty({ title: titulo, text: texto, art: 'lista', action: accion });

// ============================================================================================ Tus datos
function datos(ctx, root) {
  const { ui } = ctx;
  const c = ctx.derive.completitud(ctx.state, ctx.today());
  root.append(
    ui.pageTitle('Tus datos', c.completo ? 'Está todo cargado.' : `Tenés ${c.hechos} de 7 cargados. Tocá lo que falta para completarlo.`),
    filas(c.pasos.map((p) => ui.row({
      icon: p.estado === 'hecho' ? 'tilde' : 'documento', tone: p.estado === 'hecho' ? 'ok' : 'info', title: p.titulo,
      sub: p.estado === 'hecho' ? 'Cargado' : 'Falta cargar o confirmar',
      chip: p.estado === 'hecho' ? { label: 'Hecho', tone: 'ok', icon: 'tilde' } : { label: 'Completar', tone: 'info' },
      pending: p.estado !== 'hecho', onClick: () => ctx.nav(p.ruta),
    }))),
    c.faltan.length ? ui.notice({ tone: 'info', title: 'Lo que falta cambia un poco los números.', text: 'Mientras tanto, algunas cuentas salen como estimadas o provisorias.' }) : null);
}

// ============================================================================================ Ingresos
function ingresos(ctx, root) {
  const { ui } = ctx;
  const s = ctx.state;
  const F = ctx.format;
  const tipo = { sueldo: 'Sueldo', movilidad: 'Por día trabajado', aguinaldo: 'Aguinaldo', otro: 'Otro ingreso' };
  const detalleDe = (i) => {
    if (i.kind === 'movilidad') return `${F.money(i.fullMonthAmount || 0)} en un mes completo`;
    if (i.kind === 'aguinaldo') return `En ${(i.months || [6, 12]).map((m) => monthName(`2026-${String(m).padStart(2, '0')}`)).join(' y ')}`;
    if (i.from) return `Desde ${monthName(i.from, { year: true })}${i.to ? ` hasta ${monthName(i.to, { year: true })}` : ''}`;
    if (i.to) return `Hasta ${monthName(i.to, { year: true })}`;
    return i.kind === 'sueldo' ? 'Todos los meses' : tipo[i.kind] || 'Ingreso';
  };
  const items = s.incomes.map((i) => filaConMonto(ctx, {
    icon: i.kind === 'movilidad' ? 'calendario' : 'billetera', title: i.name || tipo[i.kind], detalle: detalleDe(i),
    monto: i.kind === 'movilidad' ? null : i.amount,
    chip: i.estimated ? { label: 'estimado', tone: 'info' } : undefined,
    onClick: () => abrir(ctx, i.kind === 'movilidad' ? 'movilidad' : 'income', i.id, {}),
    ariaLabel: `${i.name || tipo[i.kind]}. Tocá para editarlo.`,
  }));
  root.append(ui.pageTitle('Ingresos', 'Lo que entra por mes.'));
  if (items.length) root.append(filas(items));
  else root.append(vacio(ctx, 'Todavía no cargaste ingresos', 'Con tu sueldo ya puedo mostrarte cuánto te sobra cada mes.', { label: 'Cargar mi sueldo', onClick: () => abrir(ctx, 'income', null, { kind: 'sueldo' }) }));
  const acciones = [];
  if (!s.incomes.some((x) => x.kind === 'sueldo')) acciones.push(agregar(ctx, 'Cargar mi sueldo', () => abrir(ctx, 'income', null, { kind: 'sueldo' })));
  else acciones.push(ui.btn({ label: 'Me aumentaron el sueldo', variant: 'secondary', icon: 'flecha-arriba', onClick: () => abrir(ctx, 'aumento', null, {}) }));
  if (!s.incomes.some((x) => x.kind === 'movilidad')) acciones.push(agregar(ctx, 'Agregar movilidad (por día trabajado)', () => abrir(ctx, 'movilidad', null, {}), 'calendario'));
  if (!s.incomes.some((x) => x.kind === 'aguinaldo') && s.incomes.some((x) => x.kind === 'sueldo')) acciones.push(agregar(ctx, 'Agregar el aguinaldo', () => abrir(ctx, 'income', null, { kind: 'aguinaldo' }), 'destello'));
  acciones.push(agregar(ctx, 'Agregar otro ingreso', () => abrir(ctx, 'income', null, { kind: 'otro' })));
  root.append(h('div', { class: 'actions' }, ...acciones));
}

// ============================================================================================ Gastos
function gastos(ctx, root) {
  const { ui } = ctx;
  const s = ctx.state;
  const F = ctx.format;
  const etiqueta = { casa: 'Casa y día a día', gustos: 'Gustos y sorpresas', otro: 'Gasto fijo', compra: 'Compra' };
  const items = s.expenses.filter((e) => e.kind !== 'compra').map((e) => filaConMonto(ctx, {
    icon: e.kind === 'gustos' ? 'destello' : 'billetera', title: e.name || etiqueta[e.kind], detalle: etiqueta[e.kind] || 'Gasto', monto: e.amount,
    chip: e.estimated ? { label: 'estimado', tone: 'info' } : undefined,
    onClick: () => abrir(ctx, 'expense', e.id, {}), ariaLabel: `${e.name || etiqueta[e.kind]}. Tocá para editarlo.`,
  }));
  root.append(ui.pageTitle('Gastos', 'Lo que sale por mes, además de las cuotas y la tarjeta.'));
  if (items.length) root.append(filas(items));
  else root.append(vacio(ctx, 'Todavía no cargaste gastos', 'Con los gastos de la casa y de tu día a día te digo cuánto te sobra.', { label: 'Cargar gastos de la casa', onClick: () => abrir(ctx, 'expense', null, { kind: 'casa' }) }));
  const compras = (s.plannedPurchases || []);
  if (compras.length) {
    root.append(ui.sectionTitle('Compras planificadas', null),
      filas(compras.map((p) => filaConMonto(ctx, {
        icon: p.hecha ? 'tilde' : 'calendario', tone: p.hecha ? 'ok' : 'brand', title: p.name || 'Compra', detalle: p.hecha ? 'Ya la hiciste' : `${p.modo === 'cuotas' ? `En ${p.cuotas} cuotas` : p.modo === 'mensual' ? 'Por mes' : 'De una vez'} desde ${monthName(p.desde, { year: true })}`,
        monto: p.amount, onClick: () => abrir(ctx, 'plannedPurchase', p.id, {}),
      }))));
  }
  const acciones = [];
  if (!s.expenses.some((x) => x.kind === 'casa')) acciones.push(agregar(ctx, 'Cargar gastos de la casa', () => abrir(ctx, 'expense', null, { kind: 'casa' })));
  if (!s.expenses.some((x) => x.kind === 'gustos')) acciones.push(agregar(ctx, 'Cargar plata para gustos', () => abrir(ctx, 'expense', null, { kind: 'gustos' }), 'destello'));
  acciones.push(agregar(ctx, 'Agregar un gasto fijo', () => abrir(ctx, 'expense', null, { kind: 'otro' })));
  acciones.push(ui.btn({ label: 'Anoté un gasto de hoy', variant: 'text', onClick: () => abrir(ctx, 'spent', null, {}) }));
  root.append(h('div', { class: 'actions' }, ...acciones));
  void F;
}

// ============================================================================================ Cuotas y descuentos
function cuotas(ctx, root) {
  const { ui } = ctx;
  const { fields: F } = ui;
  const s = ctx.state;
  const M = ctx.format.money;
  const afip = (s.pending || []).some((p) => p.target === 'afip');
  const items = s.installments.map((i) => {
    const e = L.estadoCuota(i, ctx.today());
    return filaConMonto(ctx, {
      icon: 'banco', title: i.name || 'Cuota', detalle: `${i.payroll ? 'Se descuenta del recibo · ' : ''}${L.cuotasQueFaltanTexto(i.remaining)}${e.total && e.total !== i.remaining ? ` de ${e.total}` : ''}`,
      monto: i.amount, onClick: () => abrir(ctx, 'installment', i.id, {}), ariaLabel: `${i.name || 'Cuota'}. Tocá para editarla.`,
    });
  });
  if (afip) items.push(ui.row({ icon: 'documento', tone: 'info', title: L.NOMBRE_AFIP, sub: 'Falta el monto y las cuotas.', chip: { label: 'Completar', tone: 'info' }, pending: true, onClick: () => abrir(ctx, 'installment', null, { afip: true }) }));
  root.append(ui.pageTitle('Cuotas y descuentos', 'Préstamos y planes que pagás por mes.'));
  if (items.length) root.append(filas(items));
  else root.append(vacio(ctx, 'No cargaste cuotas ni préstamos', 'Si no tenés, mejor todavía. Si tenés, anotalas y te muestro cuándo terminan.', { label: 'Agregar un préstamo', onClick: () => abrir(ctx, 'installment', null, { payroll: true }) }));
  const hayPlanilla = L.descuentosDelRecibo(s).length > 0 || afip;
  if (hayPlanilla) {
    const respondio = s.settings.pasos?.planilla === true;
    const valor = respondio ? (s.settings.salaryNetOfPayroll === true ? true : s.settings.salaryNetOfPayroll === false ? false : 'nose') : undefined;
    const sueldo = s.incomes.find((x) => x.kind === 'sueldo');
    const neto = F.choice({
      label: sueldo && !ctx.isPrivate() ? `¿Ese sueldo de ${M(sueldo.amount)} ya tiene restados estos descuentos?` : '¿Tu sueldo ya tiene restados estos descuentos?', name: 'neto', variant: 'options', help: 'neto', helpLabel: 'Qué es el neto', value: valor,
      hint: 'Mirá tu recibo: si el total que te cae en la cuenta ya viene después de los descuentos, elegí “Sí”.',
      options: [{ value: true, label: 'Sí, ya están restados' }, { value: false, label: 'No, hay que restarlos' }, { value: 'nose', label: 'No sé' }],
      onChange: (v) => ctx.update((d) => { L.guardarNeto(d, v === 'nose' ? null : v); }, { undoLabel: 'Listo, cambiamos tu respuesta.' }),
    });
    root.append(ui.card(neto.el));
  }
  root.append(h('div', { class: 'actions' },
    agregar(ctx, 'Agregar un préstamo o una cuota', () => abrir(ctx, 'installment', null, { payroll: true })),
    !afip && !s.installments.some((i) => /afip/i.test(i.name || '')) ? agregar(ctx, 'Agregar el plan de AFIP', () => abrir(ctx, 'installment', null, { afip: true }), 'documento') : null));
}

// ============================================================================================ Tarjetas y deudas
function tarjetas(ctx, root) {
  const { ui } = ctx;
  const s = ctx.state;
  const F = ctx.format;
  const items = s.debts.map((d) => {
    const st = d.statement;
    return filaConMonto(ctx, {
      icon: 'tarjeta', tone: 'warn', title: d.name || 'Tarjeta',
      detalle: d.kind === 'card' && st ? `Último resumen: cerró el ${F.longDate(st.closedOn)}${st.dueOn ? `, vence el ${F.longDate(st.dueOn)}` : ''}` : d.kind === 'card' ? 'Falta cargar el resumen' : 'Deuda con saldo',
      monto: d.balance, onClick: () => (d.kind === 'card' ? ctx.nav('#/deudas/tarjeta') : abrir(ctx, 'debt', d.id, {})),
      ariaLabel: `${d.name || 'Tarjeta'}. Tocá para verla.`,
    });
  });
  root.append(ui.pageTitle('Tarjetas y deudas', 'Lo que debés con saldo, como la tarjeta.'));
  if (items.length) root.append(filas(items));
  else root.append(vacio(ctx, 'No cargaste tarjetas ni deudas', 'Si tenés una tarjeta con saldo, cargá el último resumen y te digo cuándo terminás de pagarla.', { label: 'Cargar mi tarjeta', onClick: () => abrir(ctx, 'statement', null, {}) }));
  const card = s.debts.find((d) => d.kind === 'card');
  root.append(h('div', { class: 'actions' },
    card ? ui.btn({ label: 'Cargar resumen nuevo', variant: 'secondary', icon: 'documento', onClick: () => abrir(ctx, 'statement', card.id, {}) }) : null,
    card ? ui.btn({ label: 'Editar los datos de la tarjeta', variant: 'text', onClick: () => abrir(ctx, 'debt', card.id, {}) }) : null,
    agregar(ctx, 'Agregar otra tarjeta o deuda', () => abrir(ctx, 'debt', null, {}))));
}

// ============================================================================================ Me deben
function medeben(ctx, root) {
  const { ui } = ctx;
  const s = ctx.state;
  const items = s.receivables.map((r, i) => filaConMonto(ctx, {
    icon: 'usuarios', tone: 'info', title: ui.personName(r.person || 'Alguien', i + 1),
    detalle: r.monthlyPayment > 0 ? `Te devuelve ${ctx.format.money(r.monthlyPayment)} por mes` : 'Sin cuota acordada',
    monto: r.balance, onClick: () => abrir(ctx, 'receivable', r.id, {}), ariaLabel: 'Tocá para editar lo que te debe.',
  }));
  root.append(ui.pageTitle('Me deben', 'Plata que otras personas te tienen que devolver.'));
  if (items.length) root.append(filas(items));
  else root.append(vacio(ctx, 'Nadie te debe plata', 'Si alguien te debe, anotalo y vemos cuándo te la puede devolver.', { label: 'Anotar a alguien', onClick: () => abrir(ctx, 'receivable', null, {}) }));
  root.append(h('div', { class: 'actions' },
    agregar(ctx, 'Anotar a alguien que me debe', () => abrir(ctx, 'receivable', null, {})),
    ui.btn({ label: 'Ver cuándo me lo devuelven', variant: 'text', onClick: () => ctx.nav('#/deudas/medeben') })));
}

// ============================================================================================ Ajustes
function ajustes(ctx, root) {
  const { ui } = ctx;
  const { fields: F } = ui;
  const s = ctx.state;
  const M = ctx.format.money;
  root.append(ui.pageTitle('Ajustes', 'Tu familia y la plata con la que contás.'));

  // familia
  const personas = s.people.map((p, i) => ui.row({
    icon: 'usuarios', tone: p.role === 'yo' ? 'brand' : 'info', title: ui.personName(p.name, i), sub: p.role === 'yo' ? 'Vos' : { pareja: 'Pareja', hijo: 'Hijo', hija: 'Hija', otro: 'Otra persona' }[p.role],
    onClick: () => abrir(ctx, 'person', p.id, {}), ariaLabel: `${ui.aliasName(p.name, i)}. Tocá para editar.`,
  }));
  root.append(ui.sectionTitle('Tu familia', null));
  if (personas.length) root.append(filas(personas));
  root.append(agregar(ctx, 'Sumar a alguien', () => abrir(ctx, 'person', null, {})));

  // gustos y reserva
  const gustos = s.expenses.find((e) => e.kind === 'gustos');
  root.append(ui.sectionTitle('Tu plata para gustos', null),
    filas([filaConMonto(ctx, { icon: 'destello', title: 'Plata para gustos y sorpresas', detalle: gustos ? 'Por mes. Te da la referencia por día.' : 'Todavía no la cargaste', monto: gustos ? gustos.amount : null, chip: gustos ? undefined : { label: 'Cargar', tone: 'info' }, onClick: () => abrir(ctx, 'expense', gustos?.id || null, { kind: 'gustos' }) })]));

  // plata de hoy y reserva
  const pd = FM.camposPlataDeHoy(ctx, { state: s, labels: true });
  const reserva = F.money({ label: 'Reserva por mes', name: 'reserva', value: s.settings.buffer > 0 ? s.settings.buffer : null, big: false, hint: 'Plata que querés dejar sin usar cada mes. Si no querés reservar nada, dejalo vacío.', placeholder: 'Ej: 50.000' });
  const guardarPlata = () => {
    if (!F.validateAll([...pd.campos, reserva])) return;
    const v = pd.leer();
    ctx.update((d) => { L.guardarPlataDeHoy(d, v); d.settings.buffer = Math.max(0, Math.round(L.nn(reserva.get()))); }, { undoLabel: `Listo. Hoy contás con ${M(v.cash)}.` });
  };
  root.append(ui.sectionTitle('Plata de hoy', null),
    ui.card(h('div', { class: 'stack-4' }, ...pd.nodos, reserva.el, ui.btn({ label: 'Guardar', onClick: guardarPlata }))));
}

// ============================================================================================ Apariencia
function apariencia(ctx, root) {
  const { ui } = ctx;
  const { fields: F } = ui;
  const s = ctx.state;
  const tema = F.choice({
    label: 'Tema', name: 'tema', variant: 'segmented', value: s.settings.theme || 'auto',
    options: [{ value: 'auto', label: 'Automático' }, { value: 'light', label: 'Claro' }, { value: 'dark', label: 'Oscuro' }],
    hint: 'Automático sigue el modo de tu celular.',
    onChange: (v) => ctx.update((d) => { d.settings.theme = v; }, { rerender: false }),
  });
  const letra = F.choice({
    label: 'Tamaño de letra', name: 'letra', variant: 'options', value: s.settings.fontSize || 'normal',
    options: [
      { value: 'normal', label: 'Normal', sub: 'El tamaño de siempre.' },
      { value: 'grande', label: 'Grande', sub: 'Un poco más grande en toda la app.' },
      { value: 'masgrande', label: 'Más grande', sub: 'El más grande: ideal si te cuesta leer.' },
    ],
    onChange: (v) => ctx.update((d) => { d.settings.fontSize = v; }, { rerender: false }),
  });
  const oculta = F.toggle({
    label: 'Ocultar montos y nombres', name: 'privacidad', value: ctx.isPrivate(), hint: 'Lo mismo que el ojo de arriba: sirve para mostrar la app sin que se vean tus números.',
    onChange: (v) => ctx.setPrivacy(v),
  });
  root.append(ui.pageTitle('Apariencia', 'Cómo se ve la app.'), ui.card(h('div', { class: 'stack-4' }, tema.el, letra.el)), ui.card(oculta.el),
    ui.card(h('div', { class: 'stack-2' }, h('p', { class: 'field-label' }, 'Así se ve el texto'), h('p', { class: 't-body' }, 'Tus cuentas, claras y a tu medida: lo que entra, lo que sale y lo que te sobra.'))));
}

// ============================================================================================ Copia de seguridad
function copia(ctx, root) {
  const { ui } = ctx;
  const s = ctx.state;
  const dias = diasDesdeCopia(s, ctx.today());
  const entorno = detectarEntorno();
  const estado = s.settings.lastBackupAt ? `Tu última copia fue ${haceTiempo(s.settings.lastBackupAt, ctx.today())}.` : 'Todavía no hiciste una copia.';
  root.append(...[
    ui.pageTitle('Copia de seguridad', 'Tus datos viven en este celular. Una copia te cuida si lo cambiás o se borra la app.'),
    dias === null || dias > 30 ? ui.notice({ tone: 'warn', title: dias === null ? 'Todavía no guardaste ninguna copia.' : `Hace ${dias} días que no guardás una copia.`, text: 'Son 10 segundos.' }) : ui.notice({ tone: 'ok', title: estado }),
    h('div', { class: 'actions' },
      ui.btn({ label: 'Mandarme una copia', icon: 'compartir', onClick: () => mandarCopia(ctx) }),
      ui.btn({ label: 'Descargar la copia', variant: 'secondary', icon: 'descargar', onClick: () => descargarCopia(ctx) }),
      ui.btn({ label: 'Restaurar una copia', variant: 'secondary', icon: 'subir', onClick: () => hojaRestaurar(ctx, { alRestaurar: () => ctx.nav('#/hoy') }) })),
    ui.footnote('“Mandarme una copia” abre el menú de tu celular: elegí WhatsApp, tu mail o donde la quieras guardar. Para restaurarla, buscá ese archivo.'),
    !entorno.instalada && !entorno.escritorio ? ui.card(h('div', { class: 'stack-3' },
      h('h2', { class: 't-h2' }, '¿Empezaste a cargar en el navegador?'),
      h('p', { class: 't-body muted' }, 'Lo que cargues en el navegador no pasa solo a la app instalada. Mandate una copia, instalá la app en tu pantalla de inicio y restaurala ahí.'),
      ui.btn({ label: 'Cómo instalar la app', variant: 'secondary', icon: 'inicio-pantalla', onClick: () => hojaInstalar(ctx, { conCopia: false }) }))) : null,
  ].filter(Boolean));
}

// ============================================================================================ Ayuda
function ayuda(ctx, root) {
  const { ui } = ctx;
  const D = ctx.derive;
  const G = D.GLOSARIO || {};
  root.append(
    ui.pageTitle('Cómo se calculan los números', 'Para que sepas qué hay detrás de cada fecha y cada monto.'),
    ui.card(h('div', { class: 'stack-3' },
      h('h2', { class: 't-h2' }, 'La cuenta, en simple'),
      h('p', { class: 't-body' }, 'Cada mes sumo lo que entra y resto lo que sale: gastos, cuotas y el mínimo de la tarjeta. Lo que sobra va a la tarjeta, y así calculo cuándo la terminás de pagar.'),
      h('p', { class: 't-body' }, 'El chip dice “Alcanza” si queda al menos el 5% de lo que entra, “Ajustado” si queda muy poco y “Falta plata” si no alcanza.'))),
    ui.card(h('div', { class: 'stack-3' },
      h('h2', { class: 't-h2' }, 'Lo que tenés que tener en cuenta'),
      h('ul', { class: 'help-list' }, ...(D.LIMITACIONES || []).map((t) => h('li', null, ui.icon('info', { size: 'sm' }), h('span', null, ui.txt(t))))))),
    ui.card(h('div', { class: 'stack-1' },
      h('h2', { class: 't-h2' }, 'Palabras que aparecen'),
      ...Object.values(G).map((g) => h('div', { class: 'help-term' }, h('h3', { class: 't-row' }, g.titulo), h('p', { class: 't-body muted' }, g.texto))))),
    ui.disclaimer());
}

export const RENDER = { datos, ingresos, gastos, cuotas, tarjetas, medeben, ajustes, apariencia, copia, ayuda };
void cap;
