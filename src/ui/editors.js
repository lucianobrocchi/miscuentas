// editors.js · los editores de Mis Cuentas (hojas de formulario con un solo patrón). Los usan Hoy, Meses, Deudas, Tarjeta, Me deben, Más
// y el armado. Contrato:  ctx.editors.open(kind, id, opts) -> Promise<{ saved: boolean, ... }>  (se resuelve cuando se cierra la hoja).
//
//   kind                id                      opts
//   'income'            ingreso | null          { kind: 'sueldo'|'aguinaldo'|'otro' }
//   'expense'           gasto | null            { kind: 'casa'|'gustos'|'otro' }
//   'installment'       cuota | null            { payroll?, afip?, mes? }
//   'debt'              deuda | null            { tipo?: 'card'|'other' }
//   'receivable'        me deben | null         { personId? }
//   'person'            persona | null          { role? }
//   'movilidad'         ingreso | null          {}
//   'aumento'           ingreso (sueldo) | null { desde?: 'YYYY-MM' }      "me aumentaron el sueldo desde X"
//   'statement'         id de la tarjeta | null {}                         cargar el resumen nuevo (con la pantalla "Revisá")
//   'cardPayment'       id de la tarjeta | null {}                         "ya pagué la tarjeta"
//   'receivablePayment' me deben | null         { personId? }              "me pagaron" + "¿Qué hiciste con esa plata?"
//   'spent'             null                    { cat?: 'casa'|'gustos' }  "anoté un gasto"
//   'plannedPurchase'   compra                  {}                         marcar hecha / borrar
//   'delete'            id                      { kind }                   hoja de consecuencias + toast Deshacer
// Todo cambio de estado va por ctx.update (con Deshacer) y el toast dice el efecto. Nunca confirm()/alert()/prompt().

import { h } from './dom.js';
import { estilos } from './_ed-style.js';
import { hojaForm, borrarConConsecuencias, copia, filas } from './_ed-core.js';
import * as L from './_ed-logic.js';
import * as FM from './_ed-forms.js';
import { monthName, monthKeyOf, toISO } from '../format.js';
import { addMonths } from '../engine.js';

const noAnda = (ctx) => { ctx.toast('Esta opción se está terminando de construir.'); return { saved: false }; };
const ALIAS = { ingreso: 'income', gasto: 'expense', cuota: 'installment', deuda: 'debt', persona: 'person', compra: 'plannedPurchase', borrar: 'delete' };

/** Chips para elegir de quién es algo (solo si hay más de una persona). Devuelve null si no hace falta. */
function campoDueno(ctx, state, ownerActual) {
  if ((state.people || []).length < 2) return null;
  const { fields: F } = ctx.ui;
  return F.person({ label: '¿De quién es?', people: state.people, value: L.idDe(state, ownerActual) || state.people.find((p) => p.role === 'yo')?.id || null, name: 'dueno' });
}
const nombreDueno = (state, campo, previo) => (campo ? L.nombreDe(state, campo.get()) : previo ?? L.nombreYo(state));

// ===================================================================================== ingresos
function editorIngreso(ctx, id, opts) {
  const state = ctx.state;
  const it = id ? state.incomes.find((x) => x.id === id) : null;
  if (id && !it) return noAnda(ctx);
  const tipo = it?.kind || opts.kind || 'otro';
  if (tipo === 'movilidad') return editorMovilidad(ctx, id, opts);
  if (tipo === 'sueldo') return editorSueldo(ctx, it, opts);
  if (tipo === 'aguinaldo') return editorAguinaldo(ctx, it, opts);

  const { fields: F } = ctx.ui;
  const nombre = F.text({ label: '¿Qué ingreso es?', name: 'nombre', value: it?.name || '', maxLength: 60, placeholder: 'Por ejemplo: Alquiler', required: true, requiredMsg: 'Contanos qué ingreso es.' });
  const monto = F.money({ label: 'Monto por mes', name: 'monto', value: it?.amount ?? null, required: true, requiredMsg: 'Poné cuánto entra.', placeholder: 'Ej: 100.000' });
  const meses = F.monthChips({ label: 'Meses en que lo cobrás', name: 'meses', options: F.MONTHS_OF_YEAR, multi: true, value: it?.months || [], hint: 'Si no elegís ninguno, entra todos los meses.' });
  const dueno = campoDueno(ctx, state, it?.owner);
  return hojaForm(ctx, {
    title: it ? 'Editar ingreso' : 'Agregar un ingreso', size: 'tall', campos: [nombre, monto],
    cuerpo: [nombre.el, monto.el, meses.el, dueno?.el],
    guardar: () => {
      let guardado = null;
      ctx.update((d) => { guardado = L.guardarIngreso(d, id, { name: nombre.get(), amount: monto.get(), owner: nombreDueno(state, dueno, it?.owner), months: meses.get() }); }, { undoLabel: `Listo. Ahora entran ${ctx.format.money(monto.get())} por mes de “${nombre.get().trim()}”.` });
      return guardado ? { id: guardado } : false;
    },
    borrar: it ? { label: 'Borrar este ingreso', ejecutar: () => borrarConConsecuencias(ctx, 'income', it.id) } : null,
  });
}

function editorSueldo(ctx, it, opts) {
  const state = ctx.state;
  const f = FM.camposSueldo(ctx, { state, labels: true });
  const dueno = campoDueno(ctx, state, it?.owner);
  return hojaForm(ctx, {
    title: it ? 'Tu sueldo' : 'Cargar tu sueldo', size: 'tall', campos: f.campos,
    cuerpo: (api) => [
      ...f.nodos, dueno?.el,
      it ? ctx.ui.link({ label: 'Me aumentaron el sueldo', icon: 'chevron', onClick: async () => { api.hoja.close(); await ctx.editors.open('aumento', it.id, {}); } }) : null,
    ],
    guardar: () => {
      const v = f.leer();
      let guardado = null;
      ctx.update((d) => { guardado = L.guardarSueldo(d, { id: it?.id, amount: v.amount, aguinaldo: v.aguinaldo, owner: nombreDueno(state, dueno, it?.owner) }); }, { undoLabel: `Listo. Tu sueldo es ${ctx.format.money(v.amount)} por mes.` });
      return guardado ? { id: guardado } : false;
    },
    borrar: it ? { label: 'Borrar el sueldo', ejecutar: () => borrarConConsecuencias(ctx, 'income', it.id) } : null,
  });
}

function editorAguinaldo(ctx, it, opts) {
  const { fields: F } = ctx.ui;
  const state = ctx.state;
  const sueldo = state.incomes.find((x) => x.kind === 'sueldo');
  const mitad = Math.round(L.nn(sueldo?.amount) / 2);
  const monto = F.money({
    label: 'Aguinaldo exacto', name: 'monto', value: it && !it.estimated ? it.amount : null, placeholder: mitad ? `Ej: ${ctx.format.num(mitad)}` : 'Ej: 450.000',
    hint: ctx.ui.txt(`Si todavía no lo sabés, dejalo vacío y usamos la mitad de tu sueldo${mitad ? ' (' + ctx.format.money(mitad) + ')' : ''}, marcado como estimado.`), help: 'estimado', helpLabel: 'Qué es un estimado',
  });
  const meses = F.monthChips({ label: 'Meses en que lo cobrás', name: 'meses', options: F.MONTHS_OF_YEAR, multi: true, value: it?.months || [6, 12], required: true, requiredMsg: 'Elegí al menos un mes.' });
  return hojaForm(ctx, {
    title: 'Aguinaldo', campos: [monto, meses], cuerpo: [monto.el, meses.el],
    guardar: () => {
      const exacto = monto.get();
      ctx.update((d) => {
        const ag = d.incomes.find((x) => x.id === it?.id) || d.incomes.find((x) => x.kind === 'aguinaldo');
        const dueno = ag?.owner ?? L.nombreYo(d);
        L.guardarIngreso(d, ag?.id || null, { name: 'Aguinaldo', amount: exacto > 0 ? exacto : Math.max(1, mitad), owner: dueno, months: meses.get(), estimated: !(exacto > 0), kind: 'aguinaldo' });
      }, { undoLabel: exacto > 0 ? `Listo. Tu aguinaldo es ${ctx.format.money(exacto)}.` : 'Listo. Usamos la mitad de tu sueldo, como estimado.' });
      return {};
    },
    borrar: it ? { label: 'Borrar el aguinaldo', ejecutar: () => borrarConConsecuencias(ctx, 'income', it.id) } : null,
  });
}

function editorMovilidad(ctx, id, opts) {
  const state = ctx.state;
  const it = id ? state.incomes.find((x) => x.id === id) : state.incomes.find((x) => x.kind === 'movilidad');
  const f = FM.camposMovilidad(ctx, { state, labels: true, preguntarSiCobra: false });
  return hojaForm(ctx, {
    title: it ? 'Movilidad' : 'Agregar movilidad', size: 'tall', campos: f.campos, cuerpo: f.nodos,
    guardar: () => {
      const v = f.leer();
      ctx.update((d) => { L.guardarMovilidad(d, { ...v, cobra: true }); }, { undoLabel: `Listo. Tu movilidad es ${ctx.format.money(v.fullMonthAmount)} en un mes completo.` });
      return {};
    },
    borrar: it ? { label: 'Borrar esta movilidad', ejecutar: () => borrarConConsecuencias(ctx, 'movilidad', it.id) } : null,
  });
}

function editorAumento(ctx, id, opts) {
  const state = ctx.state;
  const cur = monthKeyOf(ctx.today());
  const sueldos = state.incomes.filter((x) => x.kind === 'sueldo' || x.kind === 'movilidad');
  const it = (id && sueldos.find((x) => x.id === id))
    || state.incomes.filter((x) => x.kind === 'sueldo' && (!x.from || x.from <= cur)).sort((a, b) => ((a.from || '') < (b.from || '') ? 1 : -1))[0]
    || null;
  if (!it) { ctx.toast('Primero cargá tu sueldo.'); return Promise.resolve({ saved: false }); }
  const { fields: F } = ctx.ui;
  const esMov = it.kind === 'movilidad';
  const actual = esMov ? it.fullMonthAmount : it.amount;
  const monto = F.money({
    label: esMov ? 'Movilidad nueva en un mes completo' : 'Sueldo nuevo por mes', name: 'monto', value: null, required: true,
    requiredMsg: 'Poné el monto nuevo.', placeholder: actual ? `Antes: ${ctx.format.num(actual)}` : '',
    hint: esMov ? 'Poné lo que cobrás ahora en un mes completo.' : 'Poné el neto nuevo, lo que figura en el recibo como total a cobrar.',
    validate: (n) => (n <= 0 ? 'Poné el monto nuevo.' : (ctx.format.revisarMonto(n, { tipo: 'sueldo' }).ok ? null : ctx.format.revisarMonto(n, { tipo: 'sueldo' }).aviso)),
  });
  const opciones = ctx.ui.fields.monthRange(addMonths(cur, -2), 14);
  const desde = F.monthChips({ label: '¿Desde qué mes?', name: 'desde', options: opciones, value: opts.desde && opciones.some((o) => o.value === opts.desde) ? opts.desde : cur, required: true, requiredMsg: 'Elegí desde qué mes.', hint: 'Si el aumento es de un mes que ya pasó, elegí ese mes: lo contamos desde ahora.' });
  return hojaForm(ctx, {
    title: 'Me aumentaron el sueldo', campos: [monto, desde], cuerpo: [monto.el, desde.el],
    guardar: () => {
      let ok = null;
      const m = monto.get(); const k = desde.get();
      ctx.update((d) => { ok = L.aplicarAumento(d, it.id, { desde: k, monto: m }); }, { undoLabel: `Listo. Desde ${monthName(k, { year: true })} ${esMov ? 'tu movilidad' : 'tu sueldo'} es ${ctx.format.money(m)}.` });
      return ok ? { id: ok } : false;
    },
  });
}

// ===================================================================================== gastos
function editorGasto(ctx, id, opts) {
  const state = ctx.state;
  const it = id ? state.expenses.find((x) => x.id === id) : null;
  if (id && !it) return noAnda(ctx);
  const tipo = it?.kind || opts.kind || 'otro';
  const { fields: F } = ctx.ui;
  const esGustos = tipo === 'gustos';
  const nombre = F.text({ label: '¿Qué gasto es?', name: 'nombre', value: it?.name || (tipo === 'casa' ? L.NOMBRE_CASA : tipo === 'gustos' ? L.NOMBRE_GUSTOS : ''), maxLength: 70, required: true, requiredMsg: 'Contanos qué gasto es.', placeholder: 'Por ejemplo: Seguro del auto' });
  const monto = F.money({
    label: esGustos ? 'Plata para gustos y sorpresas por mes' : 'Monto por mes', name: 'monto', value: it?.amount ?? null, required: true, requiredMsg: 'Poné cuánto es por mes.', placeholder: 'Ej: 100.000',
    hint: tipo === 'casa' ? 'Sumá súper, servicios, nafta. Si no sabés, aproximá: lo vas ajustando.' : esGustos ? 'Con esto te digo una referencia por día.' : undefined,
    validate: (n) => (n <= 0 ? 'Poné cuánto es por mes.' : (ctx.format.revisarMonto(n).ok ? null : ctx.format.revisarMonto(n).aviso)),
  });
  const estimado = F.toggle({ label: 'Es un número aproximado', name: 'estimado', value: it ? it.estimated === true : tipo === 'casa', hint: 'Lo marcamos como estimado hasta que lo confirmes.', });
  const dueno = campoDueno(ctx, state, it?.owner);
  return hojaForm(ctx, {
    title: it ? 'Editar gasto' : 'Agregar un gasto fijo', size: 'tall', campos: [nombre, monto],
    cuerpo: [nombre.el, monto.el, estimado.el, dueno?.el],
    guardar: () => {
      let guardado = null;
      ctx.update((d) => { guardado = L.guardarGasto(d, id, { name: nombre.get(), amount: monto.get(), estimated: estimado.get(), owner: nombreDueno(state, dueno, it?.owner), kind: tipo }); }, { undoLabel: `Listo. “${nombre.get().trim()}”: ${ctx.format.money(monto.get())} por mes.` });
      return guardado ? { id: guardado } : false;
    },
    borrar: it ? { label: 'Borrar este gasto', ejecutar: () => borrarConConsecuencias(ctx, 'expense', it.id) } : null,
  });
}

// ===================================================================================== cuotas, préstamos y planilla
function editorCuota(ctx, id, opts) {
  const state = ctx.state;
  const it = id ? state.installments.find((x) => x.id === id) : null;
  if (id && !it) return noAnda(ctx);
  const afip = opts.afip === true || /afip/i.test(it?.name || '');
  const f = FM.camposCuota(ctx, { state, item: it, labels: true, payroll: opts.payroll === true || afip, afip, conPlanilla: !afip });
  const dueno = campoDueno(ctx, state, it?.owner);
  const hoy = ctx.today();
  return hojaForm(ctx, {
    title: afip ? 'Plan de pagos de AFIP' : it ? 'Editar préstamo o cuota' : 'Agregar un préstamo o una cuota', size: 'tall',
    campos: f.campos, cuerpo: [...f.nodos, dueno?.el],
    pieBoton: afip && !it ? (api) => ctx.ui.btn({ label: 'No sé el monto todavía', variant: 'text', onClick: () => { ctx.update((d) => { L.afipPendiente(d); }, { undoLabel: 'Anotado: el plan de AFIP queda como dato que falta.' }); api.cerrar({ pendiente: true }); } }) : null,
    guardar: () => {
      if (!f.validar()) return false;
      const v = f.leer();
      let guardado = null;
      ctx.update((d) => { guardado = L.guardarCuota(d, id, { ...v, owner: nombreDueno(state, dueno, it?.owner) }, hoy); }, {
        undoLabel: `Listo, anotamos “${(v.name || (afip ? 'Plan de AFIP' : 'la cuota')).trim()}” de ${ctx.format.money(v.amount)} por mes.`,
      });
      return guardado ? { id: guardado } : false;
    },
    borrar: it ? { label: afip ? 'Borrar el plan de AFIP' : 'Borrar este préstamo', ejecutar: () => borrarConConsecuencias(ctx, 'installment', it.id) } : null,
  });
}

// ===================================================================================== deudas y tarjetas
function pasoRevisa(ctx, api, { res, guardarValores }) {
  const r = FM.pantallaRevisa(ctx, { res, onConfirmar: (valores) => guardarValores(valores), onVolver: () => api.volver() });
  api.vista(r.nodos, r.pie);
}

function editorTarjetaSimple(ctx, d) {
  const { fields: F } = ctx.ui;
  const nombre = F.text({ label: 'Nombre', name: 'nombre', value: d.name, maxLength: 40, required: true, requiredMsg: 'Poné cómo la llamás.' });
  const banco = F.text({ label: 'Banco o acreedor (opcional)', name: 'banco', value: d.creditor || '', maxLength: 40 });
  const saldo = F.money({ label: 'Saldo actual', name: 'saldo', value: d.balance, help: 'saldoActual', required: true, requiredMsg: 'Poné cuánto debés.', hint: 'Si tenés un resumen nuevo, mejor usá “Cargar resumen nuevo”.' });
  const min = F.money({ label: 'Pago mínimo', name: 'min', value: d.minPayment, help: 'pagoMinimo' });
  const rate = F.rate({ label: 'Interés por mes', name: 'rate', value: d.rate, help: 'interesMensual', hint: 'Si solo tenés el interés anual, dividilo por 12.' });
  return hojaForm(ctx, {
    title: `Datos de ${d.name || 'la tarjeta'}`, size: 'tall', campos: [nombre, saldo],
    cuerpo: (api) => [nombre.el, banco.el, saldo.el, min.el, rate.el,
      d.kind === 'card' ? ctx.ui.btn({ label: 'Cargar resumen nuevo', variant: 'secondary', onClick: async () => { api.hoja.close(); await ctx.editors.open('statement', d.id, {}); } }) : null],
    guardar: () => {
      ctx.update((x) => { L.editarTarjeta(x, d.id, { name: nombre.get(), creditor: banco.get(), balance: saldo.get(), minPayment: min.get(), rate: rate.get() }); }, { undoLabel: 'Listo, cambiamos los datos de la tarjeta.' });
      return {};
    },
    borrar: { label: 'Borrar esta deuda', ejecutar: () => borrarConConsecuencias(ctx, 'debt', d.id) },
  });
}

function editorDeuda(ctx, id, opts) {
  const state = ctx.state;
  const d = id ? state.debts.find((x) => x.id === id) : null;
  if (id && !d) return noAnda(ctx);
  if (d) return editorTarjetaSimple(ctx, d);

  // alta: tarjeta (con el resumen) u otra deuda con saldo
  const { fields: F } = ctx.ui;
  const tipo = F.choice({
    label: '¿Qué querés agregar?', name: 'tipo', variant: 'segmented', value: opts.tipo === 'other' ? 'other' : 'card',
    options: [{ value: 'card', label: 'Una tarjeta' }, { value: 'other', label: 'Otra deuda' }],
  });
  const tarjeta = FM.camposResumen(ctx, { debt: null, labels: true, conNombre: true });
  const nombre = F.text({ label: '¿Qué deuda es?', name: 'nombre', value: '', maxLength: 50, placeholder: 'Por ejemplo: Préstamo del banco', required: true, requiredMsg: 'Contanos qué deuda es.' });
  const saldo = F.money({ label: 'Cuánto debés hoy', name: 'saldo', value: null, required: true, requiredMsg: 'Poné cuánto debés.', placeholder: 'Ej: 500.000' });
  const cuota = F.money({ label: 'Pago por mes', name: 'cuota', value: null, hint: 'Lo mínimo que tenés que pagar cada mes.' });
  const tasa = F.rate({ label: 'Interés por mes', name: 'tasa', value: null, help: 'interesMensual', hint: 'Si no tiene interés, dejalo vacío.' });
  const bloqueOtra = h('div', { class: 'stack-4' }, nombre.el, saldo.el, cuota.el, tasa.el);
  const bloqueTarjeta = h('div', { class: 'stack-4' }, ...tarjeta.nodos);
  const pintar = () => { const t = tipo.get(); bloqueOtra.hidden = t !== 'other'; bloqueTarjeta.hidden = t !== 'card'; };
  tipo.onChange(pintar); pintar();
  const camposActivos = () => (tipo.get() === 'card' ? tarjeta.campos : [nombre, saldo]);
  return hojaForm(ctx, {
    title: 'Agregar una deuda', size: 'tall', campos: [],
    cuerpo: [tipo.el, bloqueTarjeta, bloqueOtra],
    guardar: async (api) => {
      if (!ctx.ui.fields.validateAll(camposActivos())) return false;
      if (tipo.get() === 'other') {
        let id2 = null;
        ctx.update((x) => { id2 = L.guardarDeuda(x, null, { name: nombre.get(), balance: saldo.get(), minPayment: cuota.get(), rate: tasa.get() ?? 0, kind: 'other' }); }, { undoLabel: `Listo, anotamos “${nombre.get().trim()}”.` });
        return id2 ? { id: id2 } : false;
      }
      const res = tarjeta.revisar();
      if (!res.ok) return false;
      const v = tarjeta.leer();
      const guardar = (valores) => {
        let id2 = null;
        ctx.update((x) => { id2 = L.guardarResumen(x, null, valores, { name: v.name || 'Tarjeta' }, ctx.today()); }, { undoLabel: 'Tarjeta cargada. Mirá cómo quedó tu panorama.' });
        api.cerrar({ id: id2 });
      };
      if (res.confirmar) { pasoRevisa(ctx, api, { res, guardarValores: guardar }); return false; }
      // todo en orden: igual mostramos "Revisá" (cargar mal una tarjeta cambia todo el panorama)
      pasoRevisa(ctx, api, { res, guardarValores: guardar });
      return false;
    },
  });
}

function tarjetaDe(ctx, id) {
  const cards = ctx.state.debts.filter((x) => x.kind === 'card');
  return (id && ctx.state.debts.find((x) => x.id === id)) || cards[0] || null;
}

function editorResumen(ctx, id, opts) {
  const state = ctx.state;
  const d = tarjetaDe(ctx, id);
  const f = FM.camposResumen(ctx, { debt: d, labels: true, conNombre: !d, autofocus: true });
  const fechaCerro = d?.statement?.closedOn;
  return hojaForm(ctx, {
    title: 'Cargar el resumen nuevo', size: 'tall', campos: f.campos,
    cuerpo: (api) => [
      h('p', { class: 't-body muted' }, d && fechaCerro ? `Cargá el último resumen que te llegó. El que tenías cargado cerró el ${ctx.format.longDate(fechaCerro)}.` : 'Cargá el último resumen que te llegó (el que cerró hace poco).'),
      ctx.ui.disclosure({ summary: '¿Dónde lo encuentro?', content: FM.ilustracionResumen(ctx) }),
      ...f.nodos,
    ],
    guardarLabel: 'Revisar',
    guardar: (api) => {
      const res = f.revisar();
      if (!res.ok) return false;
      const v = f.leer();
      const guardar = (valores) => {
        let id2 = null;
        ctx.update((x) => { id2 = L.guardarResumen(x, d?.id || null, valores, { name: v.name || undefined }, ctx.today()); }, { undoLabel: 'Resumen cargado. Mirá cómo quedó tu panorama.' });
        api.cerrar({ id: id2 });
      };
      pasoRevisa(ctx, api, { res, guardarValores: guardar });
      return false;
    },
  });
  void state; void opts;
}

function editorPagoTarjeta(ctx, id, opts) {
  const d = tarjetaDe(ctx, id);
  if (!d) { ctx.toast('Todavía no cargaste ninguna tarjeta.'); return Promise.resolve({ saved: false }); }
  const { fields: F } = ctx.ui;
  const hoy = ctx.today();
  const min = L.nn(d.statement?.min ?? d.minPayment);
  const saldo = L.nn(d.balance);
  const monto = F.money({
    label: '¿Cuánto pagaste?', name: 'monto', value: null, autofocus: true, required: true, requiredMsg: 'Poné cuánto pagaste.', placeholder: 'Ej: 150.000',
    validate: (n) => (n <= 0 ? 'Poné cuánto pagaste.' : (n > saldo + 0.5 && saldo > 0 ? 'Es más de lo que figura en tu resumen. Revisá el monto.' : (ctx.format.revisarMonto(n).ok ? null : ctx.format.revisarMonto(n).aviso))),
  });
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Montos sugeridos' });
  const pintar = () => {
    const v = monto.get();
    const items = [];
    if (min > 0) items.push({ t: `El mínimo ${ctx.format.money(min)}`, m: min });
    if (saldo > 0 && saldo !== min) items.push({ t: `Todo ${ctx.format.money(saldo)}`, m: saldo });
    chips.replaceChildren(...items.map((x) => ctx.ui.chipButton(x.t, { selected: v === x.m, onClick: () => { monto.set(x.m); monto._emit(x.m); } })));
  };
  monto.onChange(pintar); pintar();
  const fecha = F.date({ label: '¿Cuándo la pagaste?', name: 'fecha', value: toISO(hoy), max: toISO(hoy), required: true, requiredMsg: 'Poné la fecha.' });
  return hojaForm(ctx, {
    title: 'Ya pagué la tarjeta', campos: [monto, fecha],
    cuerpo: [h('p', { class: 't-body muted' }, `Anotá lo que pagaste de ${d.name || 'la tarjeta'} y bajamos lo que debés.`), monto.el, chips, fecha.el],
    guardar: () => {
      const m = Math.round(monto.get());
      const nuevo = Math.max(0, saldo - m);
      let pago = null;
      ctx.update((x) => { pago = L.registrarPagoDeuda(x, d.id, { amount: m, date: fecha.get() }, hoy); }, {
        undoLabel: `Anotado. Pagaste ${ctx.format.money(m)} de ${d.name || 'la tarjeta'}.${nuevo > 0 ? ` Ahora figura un saldo de ${ctx.format.money(nuevo)}.` : ' Ya no debés nada.'}`,
      });
      return pago ? { id: pago.id } : false;
    },
  });
}

// ===================================================================================== me deben
function editorMeDeben(ctx, id, opts) {
  const state = ctx.state;
  const it = id ? state.receivables.find((x) => x.id === id) : null;
  if (id && !it) return noAnda(ctx);
  const f = FM.camposMeDeben(ctx, { state, item: it, personId: opts.personId || null, labels: true });
  return hojaForm(ctx, {
    title: it ? 'Lo que te debe' : 'Anotar lo que te deben', size: 'tall', campos: [], cuerpo: f.nodos,
    guardar: () => {
      if (!f.validar()) return false;
      const v = f.leer();
      let r = null;
      ctx.update((d) => { r = L.guardarMeDeben(d, id, v); }, { undoLabel: `Anotado. ${v.person} te debe ${ctx.format.money(v.balance)}.` });
      return r ? { id: r.id, personId: r.personId } : false;
    },
    borrar: it ? { label: 'Borrar lo que te debe', ejecutar: () => borrarConConsecuencias(ctx, 'receivable', it.id) } : null,
  });
}

function editorCobro(ctx, id, opts) {
  const state = ctx.state;
  const hoy = ctx.today();
  let r = id ? state.receivables.find((x) => x.id === id) : null;
  if (!r && opts.personId) r = state.receivables.find((x) => x.personId === opts.personId && L.nn(x.balance) > 0) || state.receivables.find((x) => x.personId === opts.personId);
  if (!r) { ctx.toast('Todavía no cargaste a nadie que te deba plata.'); return Promise.resolve({ saved: false }); }
  const { fields: F } = ctx.ui;
  const nombre = r.person || L.nombreDe(state, r.personId) || 'Esa persona';
  const saldo = L.nn(r.balance);
  const acordado = L.nn(r.monthlyPayment);
  const monto = F.money({
    label: '¿Cuánto te pasó?', name: 'monto', value: null, autofocus: true, required: true, requiredMsg: 'Poné cuánto te pasó.', placeholder: 'Ej: 50.000',
    validate: (n) => (n <= 0 ? 'Poné cuánto te pasó.' : (n > saldo + 0.5 ? 'Es más de lo que te debe. Revisá el monto.' : null)),
  });
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Montos sugeridos' });
  const pintar = () => {
    const v = monto.get();
    const items = [];
    if (acordado > 0 && acordado <= saldo) items.push({ t: `Lo acordado ${ctx.format.money(acordado)}`, m: acordado });
    if (saldo > 0 && saldo !== acordado) items.push({ t: `Todo lo que debe ${ctx.format.money(saldo)}`, m: saldo });
    chips.replaceChildren(...items.map((x) => ctx.ui.chipButton(x.t, { selected: v === x.m, onClick: () => { monto.set(x.m); monto._emit(x.m); } })));
  };
  monto.onChange(pintar); pintar();
  const fecha = F.date({ label: '¿Cuándo fue?', name: 'fecha', value: toISO(hoy), max: toISO(hoy), required: true, requiredMsg: 'Poné la fecha.' });
  const tarjeta = tarjetaDe(ctx, null);

  return hojaForm(ctx, {
    title: `${nombre} te pagó`, campos: [monto, fecha],
    cuerpo: [monto.el, chips, fecha.el],
    guardarLabel: 'Seguir',
    guardar: (api) => {
      const m = Math.round(monto.get());
      const nuevo = Math.max(0, saldo - m);
      const anotar = (destino) => {
        let res = null;
        ctx.update((d) => { res = L.anotarCobro(d, r.id, { amount: m, date: fecha.get(), destino, debtId: tarjeta?.id }, hoy); }, {
          undoLabel: nuevo > 0 ? `Anotado. ${nombre} ahora te debe ${ctx.format.money(nuevo)}.` : `Anotado. ${nombre} ya no te debe nada.`,
        });
        api.cerrar({ id: r.id, destino, saldoNuevo: nuevo, res });
      };
      const opcion = (titulo, sub, destino, icono) => ctx.ui.row({ icon: icono, tone: 'brand', title: titulo, sub, onClick: () => anotar(destino) });
      api.vista([
        h('p', { class: 't-q', style: { fontSize: 'var(--t-sheet)', lineHeight: '1.25', fontWeight: '800' } }, '¿Qué hiciste con esa plata?'),
        h('p', { class: 't-body muted' }, ctx.ui.txt(`Así sé si cambia lo que pagás de la tarjeta o lo que tenés guardado. Anotamos ${ctx.format.money(m)} de ${nombre}.`)),
        filas([
          tarjeta ? opcion('Pagué la tarjeta', `Se suma a lo que pagaste de ${tarjeta.name || 'la tarjeta'}.`, 'tarjeta', 'tarjeta') : null,
          opcion('La guardé', 'Se suma a la plata que tenés guardada hoy.', 'guardada', 'billetera'),
          opcion('La gasté', 'Solo baja lo que te debe.', 'gastada', 'mas-puntos'),
        ]),
      ], [ctx.ui.btn({ label: 'Volver', variant: 'text', onClick: () => api.volver() })]);
      return false;
    },
  });
}

// ===================================================================================== un gasto del día a día
function editorGastoAnotado(ctx, id, opts) {
  const { fields: F } = ctx.ui;
  const hoy = ctx.today();
  const monto = F.money({ label: '¿Cuánto gastaste?', name: 'monto', value: null, autofocus: true, required: true, requiredMsg: 'Poné cuánto gastaste.', placeholder: 'Ej: 8.000', validate: (n) => (n <= 0 ? 'Poné cuánto gastaste.' : (ctx.format.revisarMonto(n).ok ? null : ctx.format.revisarMonto(n).aviso)) });
  const cat = F.choice({
    label: '¿Es de la casa o de tus gustos?', name: 'cat', variant: 'chips', value: opts.cat === 'casa' || opts.cat === 'gustos' ? opts.cat : null, required: true, requiredMsg: 'Elegí si es de la casa o de tus gustos.',
    options: [{ value: 'casa', label: 'De la casa' }, { value: 'gustos', label: 'De mis gustos' }],
    hint: 'Solo lo que es de tus gustos cuenta para la referencia de gastar hoy.',
  });
  const que = F.monthChips({ label: 'Qué fue (opcional)', name: 'que', options: ['Súper', 'Nafta', 'Salida', 'Regalo', 'Otro'].map((t) => ({ value: t, label: t })), value: null, allowEmpty: true });
  return hojaForm(ctx, {
    title: 'Anoté un gasto', campos: [monto, cat], cuerpo: [monto.el, cat.el, que.el],
    guardar: () => {
      const m = Math.round(monto.get());
      const c = cat.get();
      const sim = copia(ctx.state);
      L.registrarGasto(sim, { amount: m, cat: c, label: que.get() || '' }, hoy);
      const g = c === 'gustos' ? ctx.derive.paraGastarHoy(sim, hoy) : null;
      let texto = L.textoGastoAnotado(m, c);
      if (g?.estado === 'ok') texto = `Anotado. De tus gustos te quedan ${ctx.format.money(g.restante)} este mes.`;
      else if (g?.estado === 'agotado') texto = 'Anotado. Ya llegaste a lo que tenías pensado para gustos este mes.';
      let gasto = null;
      ctx.update((d) => { gasto = L.registrarGasto(d, { amount: m, cat: c, label: que.get() || '' }, hoy); }, { undoLabel: texto });
      return gasto ? { id: gasto.id, cat: c } : false;
    },
  });
}

// ===================================================================================== compras planificadas
function editorCompra(ctx, id, opts) {
  const p = (ctx.state.plannedPurchases || []).find((x) => x.id === id);
  if (!p) return noAnda(ctx);
  const { ui } = ctx;
  const F = ctx.format;
  const desde = monthName(p.desde, { year: true });
  const como = p.modo === 'cuotas' ? `En ${p.cuotas} cuotas de ${F.money(p.montoCuota || p.amount / Math.max(1, p.cuotas))}, desde ${desde}`
    : p.modo === 'mensual' ? `${F.money(p.montoCuota || p.amount)} por mes, desde ${desde}` : `De una vez, en ${desde}`;
  return new Promise((resolve) => {
    let res = { saved: false };
    ctx.sheet.open({
      title: p.name || 'Compra planificada',
      render(body) {
        body.append(h('div', { class: 'stack-4' },
          ui.kv([{ label: 'Precio', value: F.money(p.amount), strong: true }, { label: 'Cómo la pagás', value: como }, p.hecha ? { label: 'Estado', value: 'Ya la hiciste' } : { label: 'Estado', value: 'Todavía no la hiciste' }]),
          ui.footnote('Una compra planificada ya está contada en tu plan: marcarla como hecha no suma un gasto aparte.')));
      },
      footer: (close) => [
        !p.hecha ? ui.btn({ label: 'Ya la hice', icon: 'tilde', onClick: () => { ctx.update((d) => { L.marcarCompraHecha(d, p.id, ctx.today()); }, { undoLabel: 'Listo, la marcamos como hecha.' }); res = { saved: true, hecha: true }; close(); } }) : null,
        ui.btn({ label: 'Borrar esta compra', variant: 'danger', icon: 'papelera', onClick: async () => { const r = await borrarConConsecuencias(ctx, 'plannedPurchase', p.id); if (r.deleted) { res = { saved: true, deleted: true }; close(); } } }),
      ],
      onClose: () => resolve(res),
    });
  });
}

// ===================================================================================== personas
function editorPersona(ctx, id, opts) {
  const state = ctx.state;
  const it = id ? state.people.find((x) => x.id === id) : null;
  if (id && !it) return noAnda(ctx);
  const f = FM.camposPersona(ctx, { item: it, role: opts.role || 'otro' });
  return hojaForm(ctx, {
    title: it ? 'Editar persona' : 'Sumar a alguien de la familia', campos: f.campos, cuerpo: f.nodos,
    guardar: () => {
      const v = f.leer();
      let pid = null;
      ctx.update((d) => { pid = L.guardarPersona(d, id, v); }, { undoLabel: it ? 'Listo, cambiamos los datos.' : `Listo, sumamos a ${v.name}.` });
      return pid ? { id: pid } : false;
    },
    borrar: it && it.role !== 'yo' ? { label: 'Sacar de la lista', ejecutar: () => borrarConConsecuencias(ctx, 'person', it.id) } : null,
  });
}

// ===================================================================================== borrar
async function editorBorrar(ctx, id, opts) {
  const kind = ALIAS[opts.kind] || opts.kind;
  const r = await borrarConConsecuencias(ctx, kind, id);
  return { saved: !!r.deleted, deleted: !!r.deleted };
}

const EDITORES = {
  income: editorIngreso,
  expense: editorGasto,
  installment: editorCuota,
  debt: editorDeuda,
  receivable: editorMeDeben,
  person: editorPersona,
  movilidad: editorMovilidad,
  aumento: editorAumento,
  statement: editorResumen,
  cardPayment: editorPagoTarjeta,
  receivablePayment: editorCobro,
  spent: editorGastoAnotado,
  plannedPurchase: editorCompra,
  delete: editorBorrar,
};

/** Abre un editor. Siempre devuelve una Promise<{ saved }>. open.length es 4 a propósito: app.js le pasa el ctx como primer argumento. */
export function open(ctx, kind, id, opts) {
  estilos();
  const fn = EDITORES[ALIAS[kind] || kind];
  if (!fn) { console.warn(`[editores] no existe el editor "${kind}"`); return Promise.resolve(noAnda(ctx)); }
  try {
    return Promise.resolve(fn(ctx, id ?? null, opts || {})).then((r) => (r && typeof r === 'object' ? r : { saved: false }));
  } catch (e) {
    console.error(`[editores] falló "${kind}"`, e);
    ctx.toast('No pudimos abrir esto. Probá de nuevo.');
    return Promise.resolve({ saved: false });
  }
}

export const kinds = Object.keys(EDITORES);
export default { open, kinds };
