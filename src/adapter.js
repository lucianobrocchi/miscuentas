// Adaptador: arma, a partir del estado de la app (modelo v2), el estado que entiende el motor (engine.js).
// Funciones puras: NUNCA modifican el estado que reciben. Sin DOM.

import { addMonths, monthDiff, installmentActive, isActive, amountFor, MAX_MONTHS } from './engine.js';
import { workdays } from './calendar.js';
import { monthKeyOf, toISO, toDate, addMonthsDate, daysBetween } from './format.js';

const nn = (v, d = 0) => {
  if (v === '' || v == null) return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const isKey = (s) => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
const monthNum = (key) => Number(key.slice(5, 7));
const AGUINALDO_FRACCION = 0.5;

/** Pagos anotados en un mes ('YYYY-MM') de una deuda o de una persona que te debe: { total, pagos, ultimo }. */
export function pagosDelMes(item, key) {
  const pagos = (item?.payments || []).filter((p) => typeof p.date === 'string' && p.date.slice(0, 7) === key && nn(p.amount) > 0);
  const ordenados = [...pagos].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { total: pagos.reduce((a, p) => a + nn(p.amount), 0), pagos: ordenados, ultimo: ordenados[ordenados.length - 1] || null };
}

/**
 * Pagos de una deuda que ya bajaron el saldo cargado y que cuentan para el resumen vigente: los posteriores al cierre
 * del último resumen (los anteriores ya están descontados en su total). Sin resumen cargado cuentan todos.
 * { total, pagos, ultimo }. Con { key } solo los de ese mes ('YYYY-MM').
 */
export function pagosDelResumen(debt, { key } = {}) {
  const cierre = debt?.statement?.closedOn || null;
  const pagos = (debt?.payments || [])
    .filter((p) => typeof p.date === 'string' && nn(p.amount) > 0 && (!cierre || p.date > cierre) && (!key || p.date.slice(0, 7) === key))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { total: pagos.reduce((a, p) => a + nn(p.amount), 0), pagos, ultimo: pagos[pagos.length - 1] || null };
}

/**
 * En qué punto está el último resumen cargado de una tarjeta, comparado con hoy.
 * fase: 'sinResumen' (no hay), 'vigente' (todavía no venció), 'vencido' (ya venció pero no cerró uno nuevo),
 * 'viejo' (ya cerró uno más nuevo: hay que cargarlo). Las fechas son las reales del resumen, no días fijos.
 */
export function estadoResumen(debt, today = new Date()) {
  const t = toISO(today);
  const st = debt?.statement;
  if (!st || !st.closedOn) return { fase: 'sinResumen', hayResumen: false, viejo: false, vencido: false };
  const nextCloseOn = st.nextCloseOn || toISO(addMonthsDate(st.closedOn, 1));
  const nextDueOn = st.nextDueOn || (st.dueOn ? toISO(addMonthsDate(st.dueOn, 1)) : null);
  const viejo = nextCloseOn < t;
  const vencido = !!st.dueOn && st.dueOn < t;
  return {
    fase: viejo ? 'viejo' : vencido ? 'vencido' : 'vigente',
    hayResumen: true,
    viejo,
    vencido,
    closedOn: st.closedOn,
    dueOn: st.dueOn || null,
    nextCloseOn,
    nextDueOn,
    label: st.label || '',
    diasParaVencer: st.dueOn ? daysBetween(t, st.dueOn) : null,
    diasParaCierre: daysBetween(t, nextCloseOn),
  };
}

/**
 * La app pide "cuota actual X de N" y calcula las que faltan.
 * actual = la última que YA se descontó. descontadaEsteMes: true si la cuota de este mes ya se descontó.
 * Devuelve { remaining, first, termina } para guardar en la cuota (remaining se cuenta desde first, incluida).
 */
export function cuotasQueFaltan({ actual, total, descontadaEsteMes = false }, today = new Date()) {
  const a = Math.max(0, Math.round(nn(actual)));
  const n = Math.max(0, Math.round(nn(total)));
  const remaining = Math.max(0, n - a);
  const cur = monthKeyOf(today);
  const first = descontadaEsteMes ? addMonths(cur, 1) : cur;
  return { remaining, first, termina: remaining > 0 ? addMonths(first, remaining - 1) : null };
}

/**
 * Normaliza lo que se quiere gastar (¿Me alcanza? y compras planificadas):
 * { nombre, monto, modo:'una'|'cuotas'|'mensual', desde, cuotas, montoCuota?, hasta? }.
 * 'una': monto = total. 'cuotas': monto = total (o montoCuota = cada cuota). 'mensual': monto = por mes.
 * Devuelve { nombre, modo, desde, cuotas, montoCuota, total (null si es mensual sin fin), hasta }.
 */
export function normalizarGasto(g, start) {
  const modo = ['una', 'cuotas', 'mensual'].includes(g?.modo) ? g.modo : 'una';
  const desde = isKey(g?.desde) ? g.desde : start;
  const hasta = isKey(g?.hasta) ? g.hasta : undefined;
  const nombre = g?.nombre || g?.name || 'Gasto nuevo';
  const monto = Math.max(0, nn(g?.monto ?? g?.total));
  if (modo === 'cuotas') {
    const cuotas = Math.max(1, Math.round(nn(g.cuotas, 1)));
    const cuota = nn(g.montoCuota) > 0 ? nn(g.montoCuota) : monto / cuotas;
    return { nombre, modo, desde, cuotas, montoCuota: cuota, total: cuota * cuotas, hasta: undefined };
  }
  if (modo === 'mensual') {
    const meses = hasta ? Math.max(0, monthDiff(desde, hasta) + 1) : null;
    return { nombre, modo, desde, cuotas: 1, montoCuota: monto, total: meses === null ? null : monto * meses, hasta };
  }
  return { nombre, modo, desde, cuotas: 1, montoCuota: monto, total: monto, hasta: undefined };
}

/** Convierte un gasto (ver normalizarGasto) en gastos del motor (extraExpenses). */
export function gastoAExtras(g, start, id = '_extra') {
  const n = normalizarGasto(g, start);
  const base = { id, name: n.nombre, owner: '', kind: 'compra' };
  if (n.modo === 'una') return [{ ...base, amount: n.total, from: n.desde, to: n.desde }];
  if (n.modo === 'cuotas') return [{ ...base, amount: n.montoCuota, from: n.desde, to: addMonths(n.desde, n.cuotas - 1) }];
  return [{ ...base, amount: n.montoCuota, from: n.desde, ...(n.hasta ? { to: n.hasta } : {}) }];
}

const compraAExpenses = (p, start) =>
  gastoAExtras({ nombre: p.name, monto: p.amount, modo: p.modo, desde: p.desde, cuotas: p.cuotas, montoCuota: p.montoCuota, hasta: p.hasta }, start, `pp_${p.id}`);

// Movilidad: valor por día, calendario real (feriados), meses sin cobro, días fijos por mes y mes vencido.
function expandirMovilidad(i, start) {
  const full = nn(i.fullMonthAmount);
  const fd = nn(i.fullMonthDays);
  const perDay = full / fd;
  const noPay = new Set((i.noPayMonths || []).map(Number));
  const porNumero = i.daysByMonthNumber || {};
  const vencida = i.movilidadVencida === true;
  const days = {};
  for (let k = 0; k < MAX_MONTHS; k++) {
    const key = addMonths(start, k);
    const trabajado = vencida ? addMonths(key, -1) : key; // si se cobra al mes siguiente, se corre el calendario un mes
    const n = monthNum(trabajado);
    days[key] = porNumero[n] !== undefined ? nn(porNumero[n]) : workdays(trabajado);
  }
  Object.assign(days, i.days || {}); // correcciones puntuales por 'YYYY-MM' (mes en que se cobra)
  let months = [];
  for (let n = 1; n <= 12; n++) {
    const trabajado = vencida ? (n === 1 ? 12 : n - 1) : n;
    if (!noPay.has(trabajado)) months.push(n);
  }
  if (i.months?.length) months = months.filter((m) => i.months.includes(m));
  return { ...i, perDay, days, months };
}

/**
 * Estado del motor a partir del estado de la app. Puro.
 * Devuelve { settings, incomes, expenses, installments, debts, receivables } (lo que lee simulate) y además:
 *   flags: { provisorio, motivos:[texto], motivosDetalle:[{code,texto,target}], estimados:{n, items} }
 *   pending: [{id,label,target,cambiaResultado}]   (datos que faltan: los de state.pending más los ítems incompletos)
 *   omitidos: [{lista,id,nombre,motivo}]            (ítems que no se mandaron al motor por estar incompletos)
 * Reglas: el mes de inicio es el mes real de `today`; movilidad por día con feriados, meses sin cobro y mes vencido;
 * aguinaldo estimado = 50% del sueldo; planilla según settings.salaryNetOfPayroll (true: el sueldo ya viene sin los
 * descuentos, se suman al sueldo; false: se restan; null: se restan igual pero el resultado queda "provisorio");
 * pagos de este mes de tarjetas y de quienes te deben ya descontados; compras planificadas como gastos.
 * opts.start: fuerza otro mes de inicio ('YYYY-MM'), por ejemplo para estimar un mes que ya pasó.
 */
export function toEngine(state, today = new Date(), opts = {}) {
  const t = toDate(today) || new Date();
  const start = isKey(opts.start) ? opts.start : monthKeyOf(t);
  const s = state.settings || {};
  const motivos = [];
  const pending = [];
  const omitidos = [];
  const addMotivo = (code, texto, target) => motivos.push({ code, texto, target: target || code });
  const addPending = (id, label, target) => {
    if (!pending.some((p) => p.id === id || (p.target === target && target !== 'cuota'))) {
      pending.push({ id, label, target, cambiaResultado: target === 'afip' || target === 'planilla' });
    }
  };
  for (const p of state.pending || []) addPending(p.id, p.label, p.target || p.id);

  // ---- ingresos ----
  const srcIncomes = state.incomes || [];
  const sueldos = srcIncomes.filter((i) => i.kind === 'sueldo');
  const sueldoEn = (key) => sueldos.filter((i) => isActive(i, key)).reduce((a, i) => a + amountFor(i, key), 0);
  const incomes = [];
  for (const raw of srcIncomes) {
    let i = { ...raw };
    if (i.kind === 'movilidad') {
      const full = nn(i.fullMonthAmount);
      if (full > 0 && nn(i.fullMonthDays) > 0) {
        i = expandirMovilidad(i, start);
        if (!i.months.length) {
          omitidos.push({ lista: 'incomes', id: raw.id, nombre: raw.name, motivo: 'No cobra ningún mes' });
          continue;
        }
      } else if (full > 0) {
        omitidos.push({ lista: 'incomes', id: raw.id, nombre: raw.name, motivo: 'Falta cuántos días tiene un mes completo' });
        addPending('movilidad', raw.name || 'Movilidad', 'movilidad');
        continue;
      }
    } else if (i.kind === 'aguinaldo' && i.estimated === true) {
      const months = i.months?.length ? i.months : [6, 12];
      i.months = months;
      const ov = {};
      for (let k = 0; k < MAX_MONTHS; k++) {
        const key = addMonths(start, k);
        if (months.includes(monthNum(key)) && isActive(i, key)) ov[key] = Math.round(sueldoEn(key) * AGUINALDO_FRACCION);
      }
      i.overrides = { ...ov, ...(raw.overrides || {}) };
      i.amount = Math.round(sueldoEn(start) * AGUINALDO_FRACCION);
    }
    if (nn(i.amount) <= 0 && !(nn(i.perDay) > 0) && !i.overrides) {
      omitidos.push({ lista: 'incomes', id: raw.id, nombre: raw.name, motivo: 'Sin monto' });
      continue;
    }
    incomes.push(i);
  }

  // ---- cuotas y préstamos (los incompletos no van al motor: quedan como datos que faltan) ----
  const installments = [];
  let hayPlanilla = false;
  for (const x of state.installments || []) {
    if (x.payroll) hayPlanilla = true;
    const amount = nn(x.amount);
    const remaining = nn(x.remaining);
    if (amount > 0 && remaining > 0) installments.push({ ...x, amount, remaining, first: isKey(x.first) ? x.first : start });
    else {
      omitidos.push({ lista: 'installments', id: x.id, nombre: x.name, motivo: 'Falta el monto o cuántas cuotas faltan' });
      const target = x.pendingKey || (/afip/i.test(x.name || '') ? 'afip' : 'cuota');
      addPending(target === 'cuota' ? `cuota:${x.id}` : target, x.name || 'Cuota sin completar', target);
    }
  }

  // ---- planilla: ¿el sueldo que cargó ya viene sin los descuentos? ----
  const planillaActual = installments.filter((x) => x.payroll && installmentActive(x, start)).reduce((a, x) => a + x.amount, 0);
  const net = s.salaryNetOfPayroll === true ? true : s.salaryNetOfPayroll === false ? false : null;
  const incomeNetStart = incomes.filter((i) => isActive(i, start)).reduce((a, i) => a + amountFor(i, start), 0);
  if (net === true && planillaActual > 0) {
    // El sueldo que cargó ya viene sin los descuentos: se le suman (una sola vez por mes). Si hay un aumento "desde" un mes,
    // la cadena de sueldos (el vigente hoy y los que empiezan después de que termina el anterior) lleva la suma.
    const sueldosIdx = incomes.map((i, k) => [i, k]).filter(([i]) => i.kind === 'sueldo');
    let fin = null; // último mes cubierto por la cadena ('' = sin fin)
    const ordenados = sueldosIdx.filter(([i]) => isActive(i, start)).concat(sueldosIdx.filter(([i]) => i.from && i.from > start).sort((a, b) => (a[0].from < b[0].from ? -1 : 1)));
    for (const [i, k] of ordenados) {
      const entra = fin === null ? isActive(i, start) : fin !== '' && i.from && i.from > fin;
      if (!entra) continue;
      incomes[k] = { ...i, amount: nn(i.amount) + planillaActual, payrollAdd: planillaActual };
      fin = i.to || '';
    }
  }
  if (net === null && hayPlanilla) {
    addMotivo('planilla', 'No sabemos si los descuentos del recibo ya están restados de tu sueldo.', 'planilla');
    addPending('planilla', 'Confirmar si los descuentos ya están restados', 'planilla');
  }

  // ---- gastos y compras planificadas ----
  const expenses = (state.expenses || []).filter((e) => {
    if (nn(e.amount) > 0 || e.overrides) return true;
    omitidos.push({ lista: 'expenses', id: e.id, nombre: e.name, motivo: 'Sin monto' });
    return false;
  });
  for (const p of state.plannedPurchases || []) expenses.push(...compraAExpenses(p, start));

  // ---- deudas: lo pagado este mes ya está descontado del saldo, así que se repone y se fija como pago elegido ----
  const debts = (state.debts || []).map((d) => {
    const pagado = pagosDelResumen(d, { key: start }).total; // lo pagado este mes que ya bajó el saldo cargado
    const planned = { ...(d.planned || {}) };
    if (pagado > 0) planned[start] = Math.max(nn(planned[start]), pagado);
    return { ...d, balance: nn(d.balance) + pagado, rate: nn(d.rate), minPayment: nn(d.minPayment), planned };
  });
  if (debts.some((d) => d.balance > 0 && estadoResumen(d, t).viejo)) {
    addMotivo('resumenViejo', 'Falta cargar el resumen nuevo de la tarjeta.', 'resumen');
  }
  if (pending.some((p) => p.target === 'afip')) {
    addMotivo('afip', 'Falta el plan de pagos de AFIP: la cuenta es un poco más optimista que la realidad.', 'afip');
  }

  // ---- lo que te deben: el pago ya anotado este mes no se cuenta dos veces ----
  const receivables = (state.receivables || []).map((r) => ({
    ...r,
    balance: nn(r.balance) + pagosDelMes(r, start).total,
    rate: nn(r.rate),
    monthlyPayment: nn(r.monthlyPayment),
  }));

  // ---- plata de hoy: si ya cobró, el saldo incluye el ingreso de este mes (que el motor ya cuenta): se descuenta ----
  const cash = Math.max(0, nn(s.cash));
  const cobro = s.cobroEsteMes === true ? true : s.cobroEsteMes === false ? false : null;
  const cashMotor = cobro === false ? cash : Math.max(0, cash - incomeNetStart);
  if (cash > 0 && cobro === null) addMotivo('cobro', 'Falta saber si ya cobraste este mes.', 'cobro');

  // ---- estimados ----
  const estimadosItems = [...(state.incomes || []).map((x) => ['incomes', x]), ...(state.expenses || []).map((x) => ['expenses', x])]
    .filter(([, x]) => x.estimated === true)
    .map(([lista, x]) => ({ lista, id: x.id, nombre: x.name }));

  // Copia profunda: lo que sale no comparte objetos con el estado (si alguien modifica el estado después, un resultado
  // memoizado no se contamina, y si modifica la salida, el estado no cambia).
  const dup = (x) => JSON.parse(JSON.stringify(x));
  return {
    settings: {
      start,
      horizon: nn(s.horizon, 12),
      strategy: ['avalanche', 'snowball', 'none'].includes(s.strategy) ? s.strategy : 'avalanche',
      buffer: Math.max(0, nn(s.buffer)),
      cash: cashMotor,
      deficitRate: Math.max(0, nn(s.deficitRate)),
    },
    incomes: dup(incomes),
    expenses: dup(expenses),
    installments: dup(installments),
    debts: dup(debts),
    receivables: dup(receivables),
    flags: {
      provisorio: motivos.length > 0,
      motivos: motivos.map((m) => m.texto),
      motivosDetalle: motivos,
      estimados: { n: estimadosItems.length, items: estimadosItems },
    },
    pending,
    omitidos,
  };
}
