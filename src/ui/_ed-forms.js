// _ed-forms.js · los MISMOS campos para los editores (hojas) y para el armado (onboarding). Cada función devuelve
//   { campos, nodos, leer() }  — `campos` se valida junto, `nodos` se agrega a la hoja o al paso, `leer()` devuelve los valores.
// Reciben { labels:true } en los editores (etiqueta visible arriba del campo) y { labels:false } en el armado (la pregunta ya es el título).
// Textos en voseo rioplatense; los errores hablan en lenguaje de casa.

import { h } from './dom.js';
import { estilos } from './_ed-style.js';
import { rotulo, lineaVivo, chipsMonto, escribir } from './_ed-core.js';
import {
  nn, nombreYo, nombreDe, idDe, estadoCuota, fraseCuotas, errorCuotas, calendarioMovilidad, conDiasDelMes, sinCorreccionDelMes, valorPorDia,
  tasaDeLaTarjeta, gastoInicial, itemMovilidad,
} from './_ed-logic.js';
import { monthName, toISO, revisarMonto } from '../format.js';

// ===================================================================================== sueldo
export function camposSueldo(ctx, { state, labels = true, autofocus = false } = {}) {
  estilos();
  const { fields: F } = ctx.ui;
  const s = state.incomes.find((x) => x.kind === 'sueldo' && !x.from) || state.incomes.find((x) => x.kind === 'sueldo');
  const tieneAg = state.incomes.some((x) => x.kind === 'aguinaldo');
  const sueldo = F.money({
    ...rotulo(labels, 'Sueldo neto por mes'), name: 'sueldo', value: s?.amount ?? null, autofocus,
    hint: 'Poné el neto: lo que figura en el recibo como total a cobrar. Si no es exacto, no pasa nada: lo corregís después.',
    help: 'neto', helpLabel: 'Qué es el neto',
    required: true, requiredMsg: 'Poné cuánto cobrás por mes.',
    validate: (n) => (n <= 0 ? 'Poné cuánto cobrás por mes.' : (revisarMonto(n, { tipo: 'sueldo' }).ok ? null : revisarMonto(n, { tipo: 'sueldo' }).aviso)),
  });
  const aguinaldo = F.toggle({ label: 'Cobro aguinaldo en junio y diciembre', value: tieneAg, name: 'aguinaldo', hint: 'Lo calculamos como la mitad de tu sueldo. Confirmalo con tu recibo.' });
  const vivo = lineaVivo('ok');
  const pintar = () => {
    const v = sueldo.get();
    escribir(ctx, vivo, aguinaldo.get() && v > 0 ? `Aguinaldo estimado: ${ctx.format.money(Math.round(v / 2))} (la mitad de tu sueldo).` : '');
  };
  sueldo.onChange(pintar); aguinaldo.onChange(pintar); pintar();
  return {
    campos: [sueldo],
    nodos: [sueldo.el, aguinaldo.el, vivo],
    leer: () => ({ amount: sueldo.get(), aguinaldo: aguinaldo.get(), id: s?.id }),
    sueldo, aguinaldo,
  };
}

// ===================================================================================== plata de hoy
export function camposPlataDeHoy(ctx, { state, labels = true } = {}) {
  const { fields: F } = ctx.ui;
  const cash = F.money({
    ...rotulo(labels, 'Plata que tenés hoy en la cuenta'), name: 'cash', value: state.settings.cash > 0 ? state.settings.cash : null,
    hint: 'Sumá lo que tenés en el banco y en efectivo. Si no lo sabés exacto, un número aproximado sirve.', placeholder: 'Ej: 150.000',
  });
  const cobro = F.choice({
    label: '¿Ya cobraste el sueldo de este mes?', name: 'cobro', variant: 'segmented', value: state.settings.cobroEsteMes,
    options: [{ value: true, label: 'Sí, ya cobré' }, { value: false, label: 'Todavía no' }],
    hint: 'Lo necesito para no contar dos veces tu sueldo.',
  });
  return { campos: [cash, cobro], nodos: [cash.el, cobro.el], leer: () => ({ cash: cash.get() ?? 0, cobroEsteMes: cobro.get() }) };
}

// ===================================================================================== gastos y gustos
export function camposGastos(ctx, { state, labels = true, casaRequerida = false } = {}) {
  const { fields: F } = ctx.ui;
  const casa = state.expenses.find((x) => x.kind === 'casa');
  const gustos = state.expenses.find((x) => x.kind === 'gustos');
  const fCasa = F.money({
    ...rotulo(labels, 'Gastos de la casa y del día a día'), name: 'casa', value: casa?.amount ?? null, placeholder: 'Ej: 500.000',
    hint: 'Sumá súper, servicios, nafta. Si no sabés, aproximá: lo vas ajustando.', required: casaRequerida, requiredMsg: 'Poné cuánto gastás por mes en la casa, aunque sea aproximado.',
    validate: (n) => (revisarMonto(n).ok ? null : revisarMonto(n).aviso),
  });
  const fGustos = F.money({
    label: '¿Cuánto querés tener por mes para gustos y sorpresas?', name: 'gustos', value: gustos?.amount ?? null,
    hint: 'Es plata para salir, regalos o algún gusto. Con esto te digo una referencia por día.', placeholder: 'Ej: 100.000',
    validate: (n) => (revisarMonto(n).ok ? null : revisarMonto(n).aviso),
  });
  const chips = chipsMonto(ctx, { montos: [50000, 100000, 150000], campo: fGustos, etiquetaOtro: 'Otro monto' });
  return {
    campos: [fCasa, fGustos],
    nodos: [fCasa.el, fGustos.el, chips],
    leer: () => ({ casa: fCasa.get(), gustos: fGustos.get() }),
    fCasa, fGustos,
  };
}

/** "Ya gasté este mes en gustos: $___" (paso 4). */
export function campoGastoInicial(ctx, { state, labels = true } = {}) {
  const { fields: F } = ctx.ui;
  const g = gastoInicial(state);
  const f = F.money({
    ...rotulo(labels, 'Ya gasté este mes en gustos'), name: 'inicial', value: g?.amount ?? null, placeholder: 'Ej: 20.000',
    hint: 'Si todavía no gastaste nada o no te acordás, dejalo vacío.', validate: (n) => (revisarMonto(n).ok ? null : revisarMonto(n).aviso),
  });
  return { campos: [f], nodos: [f.el], leer: () => ({ monto: f.get() }) };
}

// ===================================================================================== movilidad
/** Hoja chica: cuántos días se cobran en un mes (con el cálculo vivo) y si se repite todos los años. */
function hojaDiasDelMes(ctx, { item, fila, onAplicar }) {
  const { ui } = ctx;
  const { fields: F } = ui;
  const F2 = ctx.format;
  const perDay = valorPorDia(item.fullMonthAmount, item.fullMonthDays);
  const dias = F.stepper({ label: `Días en ${fila.mesNombre}`, value: fila.dias, min: 0, max: 31, unit: 'días', name: 'dias', hint: '¿Cuántos días cobrás ese mes?' });
  const anual = F.toggle({
    label: 'Es así todos los años', value: fila.anual, name: 'anual',
    hint: 'Por ejemplo una feria. Si fue solo este año, dejalo apagado.',
  });
  const calculo = h('p', { class: 't-body num', 'aria-live': 'polite' });
  const pintar = () => { const d = dias.get(); calculo.replaceChildren(`${d} ${d === 1 ? 'día' : 'días'} x `, ui.amt(perDay), ' = ', h('strong', null, ui.amt(Math.round(perDay * d)))); };
  dias.onChange(pintar); pintar();
  const notas = [];
  if (fila.feriados.length) notas.push(h('p', { class: 't-small muted' }, `En ${fila.mesNombre} hay feriado el ${fila.feriados.map((f) => f.texto).join(' y ')}${fila.estimado ? ' (estimado)' : ''}.`));
  return ctx.sheet.open({
    title: `${fila.mesNombre.charAt(0).toUpperCase()}${fila.mesNombre.slice(1)}: días de movilidad`,
    render(body) { body.append(h('div', { class: 'stack-4' }, dias.el, calculo, ...notas, anual.el)); },
    footer: (close) => [
      ui.btn({ label: 'Listo', onClick: () => { onAplicar(conDiasDelMes(item, fila.key, dias.get(), { todosLosAnios: anual.get() })); close(); } }),
      fila.corregido || fila.anual ? ui.btn({ label: 'Volver a lo normal', variant: 'text', onClick: () => { onAplicar(sinCorreccionDelMes(item, fila.key)); close(); } }) : null,
    ],
  });
  void F2;
}

export function camposMovilidad(ctx, { state, labels = true, preguntarSiCobra = false } = {}) {
  estilos();
  const { ui } = ctx;
  const { fields: F } = ui;
  const previo = state.incomes.find((x) => x.kind === 'movilidad') || null;
  let trabajo = previo ? { ...previo } : { kind: 'movilidad', fullMonthAmount: null, fullMonthDays: 22 };
  const preguntaCobra = '¿Cobrás algo que depende de los días que trabajás, como la movilidad?';
  const cobra = preguntarSiCobra ? F.choice({
    label: labels ? preguntaCobra : undefined, name: 'cobra', variant: 'segmented',
    value: previo ? true : (state.settings.pasos?.movilidad ? false : null),
    options: [{ value: true, label: 'Sí' }, { value: false, label: 'No' }], required: true, requiredMsg: 'Contestá sí o no.',
  }) : null;
  const monto = F.money({
    ...rotulo(labels, 'Movilidad en un mes completo'), name: 'monto', value: previo?.fullMonthAmount ?? null, placeholder: 'Ej: 300.000',
    hint: 'Lo que cobrás en un mes sin feriados ni licencias.', required: true, requiredMsg: 'Poné cuánto cobrás de movilidad en un mes completo.',
    validate: (n) => (n <= 0 ? 'Poné cuánto cobrás de movilidad en un mes completo.' : (revisarMonto(n).ok ? null : revisarMonto(n).aviso)),
  });
  const dias = F.stepper({ ...rotulo(labels, 'Días de un mes completo'), name: 'dias', value: previo?.fullMonthDays ?? 22, min: 1, max: 31, unit: 'días', hint: 'Cuántos días se pagan en un mes sin feriados.' });
  const porDia = lineaVivo();
  const vencida = F.choice({
    label: '¿Cuándo la cobrás?', name: 'vencida', variant: 'segmented', value: previo?.movilidadVencida === true,
    options: [{ value: false, label: 'El mismo mes' }, { value: true, label: 'El mes siguiente' }],
    hint: 'Si la movilidad de octubre te la pagan en noviembre, elegí “El mes siguiente”.',
  });
  const sinCobro = F.monthChips({
    label: 'Meses en que no cobrás movilidad', name: 'sinCobro', options: F.MONTHS_OF_YEAR, multi: true, value: previo?.noPayMonths || [],
    hint: 'Por ejemplo, enero si hay feria. Si cobrás todos los meses, no elijas ninguno.',
  });
  if (cobra && !labels) cobra.el.querySelector('[role=radiogroup]')?.setAttribute('aria-label', preguntaCobra);   // en el armado la pregunta ya es el título
  const calHost = h('div', { class: 'stack-2' });

  const leerForm = () => ({ ...trabajo, fullMonthAmount: monto.get(), fullMonthDays: dias.get(), movilidadVencida: vencida.get() === true, noPayMonths: sinCobro.get() });
  const pintarCalendario = () => {
    const item = itemMovilidad({ ...leerForm(), owner: previo?.owner ?? nombreYo(state) }, previo ? { ...previo, ...trabajo } : null);
    const cal = calendarioMovilidad(item, ctx.today());
    if (!cal) { calHost.replaceChildren(h('p', { class: 't-small muted' }, 'Poné cuánto cobrás en un mes completo y te muestro mes por mes.')); return; }
    calHost.replaceChildren(
      h('p', { class: 'field-label' }, 'Mes por mes'),
      h('p', { class: 't-small muted' }, 'Tocá un mes para cambiar los días. Los feriados ya están descontados; los de 2027 son estimados.'),
      h('div', { class: 'cal-mov' }, cal.map((f) => {
        const nf = f.feriados.length;
        const nota = !f.activo ? 'Sin cobro' : nf === 1 ? `Feriado ${f.feriados[0].texto}` : nf > 1 ? `${nf} feriados` : '';
        return h('button', {
          type: 'button', class: ['cal-cell', !f.activo && 'off', f.corregido && 'fixed'],
          'aria-label': `${f.mesNombre}: ${f.activo ? f.dias + ' días' : 'sin cobro'}${f.feriados.length ? ', feriado el ' + f.feriados.map((x) => x.texto).join(' y ') : ''}${f.estimado ? ', estimado' : ''}. Tocá para cambiar.`,
          onclick: () => hojaDiasDelMes(ctx, { item, fila: f, onAplicar: (nuevo) => { trabajo = { ...trabajo, days: nuevo.days, daysByMonthNumber: nuevo.daysByMonthNumber, noPayMonths: nuevo.noPayMonths }; sinCobro.set(nuevo.noPayMonths || []); sinCobro._emit?.(sinCobro.get()); pintarCalendario(); } }),
        },
        h('span', { class: 'cal-mes' }, f.mes + (f.key.endsWith('-01') ? ` ${f.key.slice(2, 4)}` : '')),
        h('span', { class: 'cal-dias' }, f.activo ? `${f.dias} ${f.dias === 1 ? 'día' : 'días'}` : '0 días'),
        nota ? h('span', { class: 'cal-nota' }, ui.icon(f.activo ? 'bandera' : 'calendario', { size: 'sm' }), nota) : null,
        f.estimado ? h('span', { class: 'cal-nota' }, 'estimado') : null);
      })));
  };
  const pintarPorDia = () => {
    const m = monto.get(); const d = dias.get();
    escribir(ctx, porDia, m > 0 && d > 0 ? `Calculamos ${ctx.format.money(Math.round(valorPorDia(m, d)))} por día.` : '');
  };
  const refrescar = () => { pintarPorDia(); pintarCalendario(); };
  monto.onChange(refrescar); dias.onChange(refrescar); vencida.onChange(refrescar);
  sinCobro.onChange((v) => { trabajo = { ...trabajo, noPayMonths: v }; refrescar(); });
  refrescar();

  const detalle = h('div', { class: 'stack-4' }, monto.el, dias.el, porDia, vencida.el, sinCobro.el, calHost);
  const mostrar = () => { detalle.hidden = !!cobra && cobra.get() !== true; };
  cobra?.onChange(mostrar); mostrar();
  return {
    campos: [...(cobra ? [cobra] : []), monto],
    // monto es obligatorio solo si dijo que sí
    validar: () => (cobra && cobra.get() === false ? true : ctx.ui.fields.validateAll([...(cobra ? [cobra] : []), monto])),
    nodos: [...(cobra ? [cobra.el] : []), detalle],
    leer: () => {
      const f = leerForm();
      return {
        cobra: cobra ? cobra.get() : true,
        fullMonthAmount: f.fullMonthAmount, fullMonthDays: f.fullMonthDays, noPayMonths: f.noPayMonths,
        daysByMonthNumber: trabajo.daysByMonthNumber, days: trabajo.days, movilidadVencida: f.movilidadVencida,
      };
    },
    cobra,
  };
}

// ===================================================================================== cuota o préstamo
export function camposCuota(ctx, { state, item = null, labels = true, payroll = false, afip = false, conPlanilla = true } = {}) {
  estilos();
  const { fields: F } = ctx.ui;
  const hoy = ctx.today();
  const est = item ? estadoCuota(item, hoy) : null;
  const nombre = F.text({
    label: afip ? 'Nombre' : '¿Qué es?', name: 'nombre', value: item?.name || (afip ? 'Plan de pagos de AFIP' : ''), maxLength: 60,
    placeholder: afip ? '' : 'Por ejemplo: Préstamo personal', required: !afip, requiredMsg: 'Contanos qué es, por ejemplo “Préstamo personal”.',
  });
  const monto = F.money({
    ...rotulo(labels, afip ? 'Cuota por mes del plan de AFIP' : 'Cuota por mes'), name: 'monto', value: item?.amount ?? null, placeholder: 'Ej: 50.000',
    hint: afip ? 'Está en tu recibo: buscá la línea AFIP.' : 'Lo que te cobran cada mes.', required: true, requiredMsg: 'Poné cuánto es la cuota por mes.',
    validate: (n) => (n <= 0 ? 'Poné cuánto es la cuota por mes.' : (revisarMonto(n).ok ? null : revisarMonto(n).aviso)),
  });
  const actual = F.int({ label: 'Cuota actual', name: 'actual', value: est ? est.actual : null, placeholder: '0', hint: 'La última que ya te descontaron. Si no pagaste ninguna, 0.' });
  const total = F.int({ label: 'De cuántas', name: 'total', value: est ? est.total : null, placeholder: 'Ej: 24', hint: 'El total de cuotas.' });
  const descontada = F.choice({
    label: '¿Ya te descontaron la de este mes?', name: 'descontada', variant: 'segmented',
    value: est ? est.descontadaEsteMes : null, required: true, requiredMsg: 'Contestá si ya te descontaron la de este mes.',
    options: [{ value: true, label: 'Sí, ya' }, { value: false, label: 'Todavía no' }],
  });
  const planilla = conPlanilla ? F.toggle({ label: 'Se descuenta del recibo de sueldo', name: 'payroll', value: item ? item.payroll === true : payroll, hint: 'Si lo pagás por planilla, no tenés que acordarte: se descuenta solo.' }) : null;
  const vivo = lineaVivo('ok');
  let tocoConteo = false;
  const pintar = () => {
    const f = fraseCuotas({ actual: actual.get(), total: total.get(), descontadaEsteMes: descontada.get() === true }, hoy);
    vivo.textContent = f || '';
    vivo.hidden = !f;
  };
  [actual, total].forEach((c) => c.onChange(() => { tocoConteo = true; pintar(); }));
  descontada.onChange(() => { tocoConteo = true; pintar(); });
  pintar();
  const nota = est?.lejana ? h('p', { class: 't-small muted' }, `Esta cuota empieza en ${monthName(item.first, { year: true, de: true })}. Si no cambiás el conteo, se mantiene así.`) : null;
  const campos = [...(afip ? [] : [nombre]), monto, actual, total, descontada];
  return {
    campos,
    validar: () => {
      if (est?.lejana && !tocoConteo) return true;
      const e = errorCuotas({ actual: actual.get(), total: total.get() });
      if (e) { (e.campo === 'total' ? total : actual).setError(e.texto); (e.campo === 'total' ? total : actual).focus(); return false; }
      return true;
    },
    nodos: [afip ? null : nombre.el, monto.el, h('div', { class: 'dos-cols' }, actual.el, total.el), descontada.el, vivo, nota, planilla?.el].filter(Boolean),
    leer: () => ({
      name: nombre.get(), amount: monto.get(), actual: actual.get(), total: total.get(), descontadaEsteMes: descontada.get() === true,
      payroll: planilla ? planilla.get() : payroll, afip,
      mantener: est?.lejana && !tocoConteo ? { remaining: item.remaining, first: item.first } : null,
    }),
    monto,
  };
}

// ===================================================================================== resumen de la tarjeta
/** Ilustración "¿Dónde lo encuentro?": un resumen de ejemplo con los 5 datos marcados. */
export function ilustracionResumen(ctx) {
  estilos();
  const l = (n, t) => h('div', { class: 'mock-linea marca' }, h('span', { class: 'mock-num', 'aria-hidden': 'true' }, String(n)), h('span', null, t));
  return h('div', { class: 'stack-3' },
    h('p', { class: 't-body' }, 'Los datos están en la primera hoja del resumen que te manda el banco (en papel, en el mail o en la app del banco). Buscá estos cinco:'),
    h('div', { class: 'mock-resumen', role: 'img', 'aria-label': 'Dibujo de un resumen de tarjeta con cinco datos marcados: fecha de cierre, fecha de vencimiento, total a pagar, pago mínimo e interés' },
      h('div', { class: 'mock-gris', style: { maxWidth: '55%' } }),
      l(1, 'Fecha de cierre'),
      l(2, 'Fecha de vencimiento'),
      l(3, 'Saldo actual o total a pagar'),
      l(4, 'Pago mínimo'),
      l(5, 'Interés (por mes o por año)'),
      h('div', { class: 'mock-gris' }), h('div', { class: 'mock-gris', style: { maxWidth: '70%' } })),
    h('p', { class: 't-small muted' }, 'Si en tu resumen el interés figura solo por año (por ejemplo 79%), escribilo igual: lo pasamos a mensual y te lo confirmamos.'));
}

/**
 * Campos del resumen de la tarjeta. debt = tarjeta existente (o null si es la primera). conNombre = pedir cómo se llama.
 * -> { campos, nodos, leer(), revisar() }  — revisar() corre derive.validarResumen y devuelve su resultado (con los errores ya puestos en los campos).
 */
export function camposResumen(ctx, { debt = null, labels = true, conNombre = false, autofocus = false } = {}) {
  estilos();
  const { ui } = ctx;
  const { fields: F } = ui;
  const D = ctx.derive;
  const hoy = ctx.today();
  const pre = debt ? D.precargaResumen(debt) : { hayAnterior: false, closedOn: null, dueOn: null, rate: null, nota: null };
  const nombre = conNombre ? F.text({ label: '¿Cómo se llama tu tarjeta?', name: 'nombre', value: debt?.name || '', maxLength: 40, placeholder: 'Por ejemplo: Visa', hint: 'Solo para reconocerla. Si la dejás vacía, le ponemos “Tarjeta”.' }) : null;
  const total = F.money({
    ...rotulo(labels, 'Total a pagar'), name: 'total', value: null, autofocus, placeholder: 'Ej: 1.200.000', help: 'saldoActual', helpLabel: 'Qué es el saldo',
    hint: 'Es lo que figura como saldo actual o total a pagar en tu último resumen.', required: true, requiredMsg: 'Poné el total a pagar que figura en tu resumen.',
  });
  const min = F.money({
    ...rotulo(labels, 'Pago mínimo'), name: 'min', value: null, placeholder: 'Ej: 150.000', help: 'pagoMinimo', helpLabel: 'Qué es el mínimo',
    hint: 'Lo menos que te piden pagar este mes.', required: true, requiredMsg: 'Poné el pago mínimo que figura en tu resumen.',
  });
  const rate = F.rate({
    ...rotulo(labels, 'Interés por mes'), name: 'rate', value: pre.rate, placeholder: 'Ej: 6,5', help: 'interesMensual', helpLabel: 'Mensual o anual',
    hint: 'Si en tu resumen solo figura el interés anual (por ejemplo 79%), escribilo igual: lo pasamos a mensual.', required: true, requiredMsg: 'Poné el interés por mes de tu resumen.',
  });
  const closedOn = F.date({ label: 'El resumen cerró el', name: 'closedOn', value: pre.closedOn || '', max: toISO(hoy), required: true, requiredMsg: 'Poné la fecha en que cerró tu resumen.' });
  const dueOn = F.date({ label: 'Vence el', name: 'dueOn', value: pre.dueOn || '', required: true, requiredMsg: 'Poné la fecha de vencimiento de tu resumen.' });
  const nextCloseOn = F.date({ label: 'El próximo cierre es el', name: 'nextCloseOn', value: '', hint: 'Está en el mismo resumen, si lo tenés a mano.' });
  const nextDueOn = F.date({ label: 'El próximo vencimiento es el', name: 'nextDueOn', value: '' });
  const nuevos = F.money({ label: 'Consumos nuevos del resumen', name: 'newCharges', value: null, placeholder: 'Ej: 700.000', hint: 'Lo que compraron en el mes todos los que usan la tarjeta. Es opcional.' });
  const masDatos = ui.disclosure({ summary: 'Más datos del resumen (opcional)', content: h('div', { class: 'stack-4' }, nextCloseOn.el, nextDueOn.el, nuevos.el) });
  const aviso = pre.nota ? ui.notice({ tone: 'info', title: pre.nota }) : null;
  const campos = [...(nombre ? [nombre] : []), total, min, rate, closedOn, dueOn];
  const leer = () => ({
    name: nombre?.get() ?? undefined,
    total: total.get(), min: min.get(), rate: rate.get(), closedOn: closedOn.get(), dueOn: dueOn.get(),
    nextCloseOn: nextCloseOn.get() || undefined, nextDueOn: nextDueOn.get() || undefined, newCharges: nuevos.get() ?? undefined,
  });
  const porCampo = { total, min, rate, closedOn, dueOn };
  return {
    campos,
    nodos: [aviso, ...(nombre ? [nombre.el] : []), total.el, min.el, rate.el, closedOn.el, dueOn.el, masDatos].filter(Boolean),
    leer,
    /** Corre la validación amable. Los avisos "corregir" quedan escritos en el campo; devuelve el resultado completo. */
    revisar() {
      const v = leer();
      const res = D.validarResumen({ total: v.total, min: v.min, rate: v.rate, closedOn: v.closedOn, dueOn: v.dueOn, nextCloseOn: v.nextCloseOn, nextDueOn: v.nextDueOn, newCharges: v.newCharges }, { debt, today: hoy });
      for (const c of Object.values(porCampo)) c.clearError();
      let primero = null;
      for (const a of res.avisos.filter((x) => x.nivel === 'corregir')) {
        const c = porCampo[a.campo];
        if (c) { c.setError(a.texto); primero ||= c; }
      }
      if (primero) { primero.focus(); primero.el.scrollIntoView?.({ block: 'center', behavior: 'smooth' }); }
      return res;
    },
    porCampo,
  };
}

/**
 * Pantalla "Revisá" antes de guardar el resumen: las 5 filas, los avisos para confirmar y los botones.
 * -> { nodos, pie } ; onConfirmar(valores) guarda; onVolver() vuelve al formulario.
 */
export function pantallaRevisa(ctx, { res, onConfirmar, onVolver }) {
  const { ui } = ctx;
  const confirmar = res.avisos.filter((a) => a.nivel === 'confirmar');
  const conTasa = res.avisos.find((a) => a.campo === 'rate' && a.sugerido !== undefined);
  const nodos = [
    h('p', { class: 't-body' }, 'Revisá que esté todo bien antes de guardar.'),
    ui.kv(res.filas.map((f) => ({ label: f.rotulo, value: f.valor, strong: true }))),
    ...confirmar.map((a) => ui.notice({ tone: 'warn', title: a.texto })),
  ];
  const label = conTasa ? `Sí, usar ${ctx.format.pct(conTasa.sugerido)} por mes` : confirmar.length ? 'Sí, está bien: guardar' : 'Guardar el resumen';
  const pie = [
    ui.btn({ label, onClick: () => onConfirmar(res.valores) }),
    ui.btn({ label: 'Volver y corregir', variant: 'text', onClick: onVolver }),
  ];
  return { nodos, pie, labelConfirmar: label, confirmar: () => onConfirmar(res.valores) };
}

// ===================================================================================== me deben
export function camposMeDeben(ctx, { state, item = null, personId = null, labels = true } = {}) {
  estilos();
  const { ui } = ctx;
  const { fields: F } = ui;
  const otros = state.people.filter((p) => p.role !== 'yo');
  const actualId = item?.personId || personId || null;
  const hayLista = otros.length > 0;
  let eleccion = actualId && otros.some((p) => p.id === actualId) ? actualId : (hayLista ? (item ? '__otra' : null) : '__otra');
  if (item && !actualId && item.person) eleccion = '__otra';
  const quien = hayLista ? F.choice({
    label: '¿Quién te debe?', name: 'quien', variant: 'chips', value: eleccion, required: true, requiredMsg: 'Elegí quién te debe.',
    options: [...otros.map((p) => ({ value: p.id, label: p.name })), { value: '__otra', label: 'Otra persona' }],
  }) : null;
  const nuevoNombre = F.text({ label: hayLista ? 'Nombre' : '¿Quién te debe?', name: 'nombre', value: item && !otros.some((p) => p.id === actualId) ? item.person : '', maxLength: 40, placeholder: 'Por ejemplo: Hija', required: true, requiredMsg: 'Poné el nombre.' });
  const rolChips = F.choice({ label: 'Es tu…', name: 'rol', variant: 'chips', value: 'otro', options: [{ value: 'pareja', label: 'Pareja' }, { value: 'hijo', label: 'Hijo' }, { value: 'hija', label: 'Hija' }, { value: 'otro', label: 'Otra persona' }] });
  const bloqueNuevo = h('div', { class: 'stack-4' }, nuevoNombre.el, rolChips.el);
  const mostrarNuevo = () => { bloqueNuevo.hidden = !(quien ? quien.get() === '__otra' : true); };
  quien?.onChange(mostrarNuevo); mostrarNuevo();
  const saldo = F.money({
    ...rotulo(labels, '¿Cuánto te debe en total?'), name: 'saldo', value: item?.balance ?? null, placeholder: 'Ej: 400.000',
    hint: 'Poné el total. Si ya sumaste el interés, que figure incluido.', required: true, requiredMsg: 'Poné cuánto te debe.',
    validate: (n) => (n <= 0 ? 'Poné cuánto te debe.' : (revisarMonto(n).ok ? null : revisarMonto(n).aviso)),
  });
  const cuota = F.money({ label: '¿Cuánto te devuelve por mes?', name: 'cuota', value: item?.monthlyPayment > 0 ? item.monthlyPayment : null, placeholder: 'Ej: 50.000', hint: 'Si todavía no acordaron nada, dejalo vacío.' });
  const tasa = tasaDeLaTarjeta(state);
  const interes = F.toggle({
    label: 'Le cobro el interés de lo suyo', name: 'interes', value: item ? nn(item.rate) > 0 : false,
    hint: tasa > 0 ? 'Si querés cobrarle interés por lo que consumió con la tarjeta, se suma a lo que te debe. Si el monto de arriba ya lo incluye, dejalo apagado.' : 'Si querés cobrarle interés, cargá primero tu tarjeta para usar el mismo.',
  });
  const hintInteres = interes.el.querySelector('.toggle-hint');
  const pintarInteres = () => {
    if (!(tasa > 0) || !hintInteres) return;
    const s = nn(saldo.get());
    escribir(ctx, hintInteres, `Si querés cobrarle interés por lo que consumió con la tarjeta, ${s > 0 ? `se suman ${ctx.format.money(Math.round(s * tasa / 100))} por mes` : 'se suma cada mes'} a lo que te debe (${ctx.format.pct(tasa)} por mes). Si el monto de arriba ya lo incluye, dejalo apagado.`);
  };
  saldo.onChange(pintarInteres); pintarInteres();
  const campos = [...(quien ? [quien] : []), saldo];
  return {
    campos,
    validar: () => {
      const ok = ctx.ui.fields.validateAll([...(quien ? [quien] : []), saldo]);
      if (!ok) return false;
      if (!quien || quien.get() === '__otra') return ctx.ui.fields.validateAll([nuevoNombre]);
      return true;
    },
    nodos: [...(quien ? [quien.el] : []), bloqueNuevo, saldo.el, cuota.el, tasa > 0 || item ? interes.el : null].filter(Boolean),
    leer: () => {
      const elegido = quien ? quien.get() : '__otra';
      const esNueva = elegido === '__otra' || elegido == null;
      return {
        personId: esNueva ? (idDe(state, nuevoNombre.get()) || undefined) : elegido,
        person: esNueva ? nuevoNombre.get().trim() : nombreDe(state, elegido),
        role: rolChips.get(),
        balance: saldo.get(), monthlyPayment: cuota.get() ?? 0, cobraInteres: interes.get(),
      };
    },
  };
}

// ===================================================================================== persona
export function camposPersona(ctx, { item = null, role = 'otro' } = {}) {
  const { fields: F } = ctx.ui;
  const nombre = F.text({ label: 'Nombre', name: 'nombre', value: item?.name || '', maxLength: 40, required: true, requiredMsg: 'Poné el nombre.', placeholder: 'Por ejemplo: Hija' });
  const esYo = item?.role === 'yo';
  const rol = esYo ? null : F.choice({
    label: 'Es tu…', name: 'rol', variant: 'chips', value: item?.role && item.role !== 'yo' ? item.role : role,
    options: [{ value: 'pareja', label: 'Pareja' }, { value: 'hijo', label: 'Hijo' }, { value: 'hija', label: 'Hija' }, { value: 'otro', label: 'Otra persona' }],
  });
  return { campos: [nombre], nodos: [nombre.el, rol?.el].filter(Boolean), leer: () => ({ name: nombre.get().trim(), role: rol ? rol.get() : 'yo' }) };
}

