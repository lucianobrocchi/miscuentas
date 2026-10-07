// _ed-logic.js · lógica PURA de los editores y del armado (sin DOM). Todo lo que cambia el estado pasa por acá:
// las funciones reciben el borrador (draft) que entrega ctx.update(fn) y lo modifican. Se prueba con npm test.
// Los textos que devuelve ya están en voseo y sin palabras prohibidas.

import {
  uid, agregarPersona, aplicarAumento, aplicarResumen, registrarPagoDeuda, anotarCobro, registrarGasto, marcarCompraHecha, emptyState,
} from '../store.js';
import { cuotasQueFaltan, toEngine } from '../adapter.js';
import { addMonths } from '../engine.js';
import { FERIADOS } from '../calendar.js';
import { money, monthName, monthKeyOf, toISO, toDate } from '../format.js';

export { aplicarAumento, aplicarResumen, registrarPagoDeuda, anotarCobro, registrarGasto, marcarCompraHecha };

const nn = (v, d = 0) => {
  if (v === '' || v == null) return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const monthNum = (key) => Number(String(key).split('-')[1]);

export const NOMBRE_CASA = 'Gastos de la casa y del día a día';
export const NOMBRE_GUSTOS = 'Gustos y sorpresas';
export const NOMBRE_AFIP = 'Plan de pagos de AFIP';
export const LABEL_GASTO_INICIAL = 'Ya gastado este mes';
export const ROLES_PERSONA = [
  { value: 'pareja', label: 'Pareja' },
  { value: 'hijo', label: 'Hijo' },
  { value: 'hija', label: 'Hija' },
  { value: 'otro', label: 'Otro' },
];

// ------------------------------------------------------------------ personas
/** Nombre de la persona 'yo' (o 'Vos'). */
export const nombreYo = (state) => (state.people || []).find((p) => p.role === 'yo')?.name || (state.settings?.name || '').trim() || 'Vos';
/** Id -> nombre. '' si no existe. */
export const nombreDe = (state, personId) => (state.people || []).find((p) => p.id === personId)?.name || '';
/** Nombre -> id (sin importar mayúsculas). null si no existe. */
export const idDe = (state, nombre) => {
  const n = String(nombre || '').trim().toLowerCase();
  return n ? ((state.people || []).find((p) => p.name.trim().toLowerCase() === n)?.id ?? null) : null;
};
const sincronizarPersonas = (draft) => { draft.settings.people = (draft.people || []).map((p) => p.name).join(', '); };

/** Cambia el nombre de una persona y de todo lo que figura a su nombre (dueños de ingresos, gastos, cuotas, deudas). */
export function renombrarPersona(draft, id, nuevo) {
  const p = draft.people.find((x) => x.id === id);
  const n = String(nuevo || '').trim();
  if (!p || !n) return false;
  const viejo = p.name;
  if (viejo === n) return true;
  p.name = n;
  for (const lista of ['incomes', 'expenses', 'installments']) for (const it of draft[lista] || []) if (it.owner === viejo) it.owner = n;
  for (const r of draft.receivables || []) if (r.personId === id || r.person === viejo) r.person = n;
  sincronizarPersonas(draft);
  return true;
}

/** Guarda una persona (alta o edición). Devuelve su id (null si falta el nombre). */
export function guardarPersona(draft, id, { name, role }) {
  const n = String(name || '').trim();
  if (!n) return null;
  if (id) {
    const p = draft.people.find((x) => x.id === id);
    if (!p) return null;
    renombrarPersona(draft, id, n);
    if (['yo', 'pareja', 'hijo', 'hija', 'otro'].includes(role) && p.role !== 'yo') p.role = role;
    if (p.role === 'yo') draft.settings.name = n;
    return id;
  }
  return agregarPersona(draft, { name: n, role: role || 'otro' });
}

/**
 * Paso 1 del armado: cómo te llamamos y quiénes más usan las tarjetas o te deben plata.
 * otros: [{ name, role }] (la lista COMPLETA de las demás personas: lo que no está se saca).
 */
export function guardarFamilia(draft, { name, otros = [] }) {
  const n = String(name || '').trim();
  draft.settings.name = n;
  const yo = draft.people.find((p) => p.role === 'yo');
  if (yo) renombrarPersona(draft, yo.id, n || yo.name || 'Vos');
  else draft.people.unshift({ id: uid(), name: n || 'Vos', role: 'yo' });
  const nuevos = [];
  const vistos = new Set([nombreYo(draft).toLowerCase()]);
  for (const o of otros) {
    const nm = String(o.name || '').trim();
    if (!nm || vistos.has(nm.toLowerCase())) continue;
    vistos.add(nm.toLowerCase());
    const ya = draft.people.find((p) => p.role !== 'yo' && p.name.trim().toLowerCase() === nm.toLowerCase());
    nuevos.push(ya ? { ...ya, role: o.role || ya.role } : { id: uid(), name: nm, role: ['pareja', 'hijo', 'hija', 'otro'].includes(o.role) ? o.role : 'otro' });
  }
  draft.people = [draft.people.find((p) => p.role === 'yo'), ...nuevos].filter(Boolean);
  sincronizarPersonas(draft);
  draft.settings.pasos = { ...(draft.settings.pasos || {}), familia: true };
  return draft.people.length;
}

// ------------------------------------------------------------------ ingresos
/**
 * Sueldo neto (y aguinaldo estimado). { amount, owner?, aguinaldo?: boolean }.
 * aguinaldo true = hay un ingreso 'aguinaldo' (la mitad del sueldo, estimado, en junio y diciembre); false = lo saca.
 */
export function guardarSueldo(draft, { id, amount, owner, aguinaldo }) {
  const monto = Math.round(nn(amount));
  if (monto <= 0) return null;
  let s = id ? draft.incomes.find((x) => x.id === id) : draft.incomes.find((x) => x.kind === 'sueldo' && !x.from);
  if (!s) s = draft.incomes.find((x) => x.kind === 'sueldo');
  const dueno = owner !== undefined && owner !== null ? owner : nombreYo(draft);
  if (s) {
    s.amount = monto;
    s.owner = dueno;
    delete s.estimated;
  } else {
    s = { id: uid(), name: 'Sueldo', owner: dueno, amount: monto, kind: 'sueldo' };
    draft.incomes.unshift(s);
  }
  if (aguinaldo === true) {
    const ag = draft.incomes.find((x) => x.kind === 'aguinaldo');
    if (!ag) draft.incomes.push({ id: uid(), name: 'Aguinaldo', owner: dueno, amount: Math.round(monto / 2), months: [6, 12], kind: 'aguinaldo', estimated: true });
    else if (ag.estimated) ag.amount = Math.round(monto / 2);
  } else if (aguinaldo === false) {
    draft.incomes = draft.incomes.filter((x) => x.kind !== 'aguinaldo');
  }
  return s.id;
}

/** Otro ingreso (o el aguinaldo con monto exacto). { name, amount, owner, months?, estimated?, kind? } */
export function guardarIngreso(draft, id, vals) {
  const monto = Math.round(nn(vals.amount));
  const name = String(vals.name || '').trim();
  if (!name || monto <= 0) return null;
  const it = id ? draft.incomes.find((x) => x.id === id) : null;
  const base = { name, owner: vals.owner ?? '', amount: monto };
  if (it) {
    Object.assign(it, base);
    if (vals.months !== undefined) { if (vals.months && vals.months.length) it.months = vals.months; else delete it.months; }
    if (vals.estimated === true) it.estimated = true; else delete it.estimated; // sin 'estimated' el motor usa este monto exacto (no la mitad del sueldo)
    return it.id;
  }
  const nuevo = { id: uid(), ...base, kind: vals.kind || 'otro' };
  if (vals.months && vals.months.length) nuevo.months = vals.months;
  if (vals.estimated === true) nuevo.estimated = true;
  draft.incomes.push(nuevo);
  return nuevo.id;
}

// ------------------------------------------------------------------ movilidad (por día trabajado)
/** Valor de un día de movilidad. */
export const valorPorDia = (full, dias) => (nn(dias) > 0 ? nn(full) / nn(dias) : 0);

/** Arma el ingreso de movilidad a partir del formulario. */
export function itemMovilidad(vals, previo = null) {
  const o = {
    ...(previo || {}),
    id: previo?.id || uid(),
    name: 'Movilidad',
    owner: vals.owner ?? previo?.owner ?? '',
    amount: 0,
    kind: 'movilidad',
    fullMonthAmount: Math.round(nn(vals.fullMonthAmount)),
    fullMonthDays: Math.round(nn(vals.fullMonthDays)),
  };
  delete o.estimated;
  const np = [...new Set((vals.noPayMonths || []).map(Number).filter((m) => m >= 1 && m <= 12))];
  if (np.length) o.noPayMonths = np; else delete o.noPayMonths;
  const dm = {};
  for (const [k, v] of Object.entries(vals.daysByMonthNumber || {})) if (/^(1[0-2]|[1-9])$/.test(k) && Number.isFinite(Number(v))) dm[k] = Number(v);
  if (Object.keys(dm).length) o.daysByMonthNumber = dm; else delete o.daysByMonthNumber;
  const dy = {};
  for (const [k, v] of Object.entries(vals.days || {})) if (/^\d{4}-\d{2}$/.test(k) && Number.isFinite(Number(v))) dy[k] = Number(v);
  if (Object.keys(dy).length) o.days = dy; else delete o.days;
  if (vals.movilidadVencida === true) o.movilidadVencida = true; else delete o.movilidadVencida;
  return o;
}

/** Guarda la movilidad. cobra:false = "no cobro movilidad" (saca el ingreso y recuerda que ya lo contestó). */
export function guardarMovilidad(draft, vals) {
  const previo = draft.incomes.find((x) => x.kind === 'movilidad') || null;
  draft.settings.pasos = { ...(draft.settings.pasos || {}), movilidad: true };
  if (vals.cobra === false) {
    draft.incomes = draft.incomes.filter((x) => x.kind !== 'movilidad');
    return null;
  }
  if (!(nn(vals.fullMonthAmount) > 0) || !(nn(vals.fullMonthDays) > 0)) return null;
  const item = itemMovilidad({ ...vals, owner: vals.owner ?? previo?.owner ?? nombreYo(draft) }, previo);
  if (previo) draft.incomes[draft.incomes.indexOf(previo)] = item; else draft.incomes.push(item);
  return item.id;
}

const esFinDeSemana = (key, d) => { const w = new Date(Number(key.slice(0, 4)), monthNum(key) - 1, d).getDay(); return w === 0 || w === 6; };
/** Feriados de un mes ('YYYY-MM') que caen de lunes a viernes: [{ dia, texto:'12/10' }]. */
export function feriadosDelMes(key) {
  const out = [];
  for (const f of FERIADOS) {
    if (!f.startsWith(key + '-')) continue;
    const d = Number(f.slice(8));
    if (esFinDeSemana(key, d)) continue;
    out.push({ dia: d, texto: `${d}/${String(monthNum(key)).padStart(2, '0')}` });
  }
  return out;
}
/** Los feriados de 2027 y el traslado del 23/11/2026 son estimados (ver calendar.js). */
export const feriadoEstimado = (key) => Number(String(key).slice(0, 4)) >= 2027 || key === '2026-11';

/**
 * Calendario de 12 meses de la movilidad: para cada mes en que se COBRA, cuántos días, cuánto es y por qué.
 * item = ingreso de movilidad (con fullMonthAmount, fullMonthDays, noPayMonths, daysByMonthNumber, days, movilidadVencida).
 * -> [{ key, mes:'Oct', mesNombre:'octubre', dias, monto, activo, feriados:[{dia,texto}], estimado, corregido, anual }] o null si falta el monto o los días.
 */
export function calendarioMovilidad(item, today = new Date()) {
  if (!item || !(nn(item.fullMonthAmount) > 0) || !(nn(item.fullMonthDays) > 0)) return null;
  const t = toDate(today) || new Date();
  const start = monthKeyOf(t);
  const mini = { ...emptyState(t), settings: { ...emptyState(t).settings, start }, incomes: [{ ...item, kind: 'movilidad', id: item.id || 'mov' }] };
  const e = toEngine(mini, t).incomes.find((x) => x.kind === 'movilidad');
  if (!e) return null;
  const vencida = item.movilidadVencida === true;
  const anuales = new Set([...(item.noPayMonths || []).map(Number), ...Object.keys(item.daysByMonthNumber || {}).map(Number)]);
  return Array.from({ length: 12 }, (_, k) => {
    const key = addMonths(start, k);
    const trabajado = vencida ? addMonths(key, -1) : key;
    const activo = e.months.includes(monthNum(key));
    const dias = activo ? nn(e.days[key]) : 0;
    const fer = feriadosDelMes(trabajado);
    return {
      key,
      mes: monthName(key, { short: true }),
      mesNombre: monthName(key),
      trabajado,
      dias,
      monto: Math.round(e.perDay * dias),
      activo,
      feriados: fer,
      estimado: fer.length > 0 && feriadoEstimado(trabajado),
      corregido: item.days?.[key] !== undefined,
      anual: anuales.has(monthNum(trabajado)),
    };
  });
}

/**
 * Cambia los días de UN mes ('YYYY-MM' en que se cobra). todosLosAnios: queda así cada año (0 días = no se cobra ese mes).
 * Devuelve un item nuevo (no muta el que le pasás).
 */
export function conDiasDelMes(item, key, dias, { todosLosAnios = false } = {}) {
  const o = { ...item, days: { ...(item.days || {}) }, daysByMonthNumber: { ...(item.daysByMonthNumber || {}) }, noPayMonths: [...(item.noPayMonths || [])] };
  const trabajado = item.movilidadVencida === true ? addMonths(key, -1) : key;
  const n = monthNum(trabajado);
  const d = Math.max(0, Math.min(31, Math.round(nn(dias))));
  delete o.days[key];
  delete o.daysByMonthNumber[n];
  o.noPayMonths = o.noPayMonths.filter((m) => Number(m) !== n);
  if (todosLosAnios) {
    if (d === 0) o.noPayMonths.push(n); else o.daysByMonthNumber[n] = d;
  } else {
    o.days[key] = d;
  }
  return o;
}

/** Vuelve un mes a "lo normal" (sin corrección ni regla anual). */
export function sinCorreccionDelMes(item, key) {
  const o = { ...item, days: { ...(item.days || {}) }, daysByMonthNumber: { ...(item.daysByMonthNumber || {}) }, noPayMonths: [...(item.noPayMonths || [])] };
  const trabajado = item.movilidadVencida === true ? addMonths(key, -1) : key;
  const n = monthNum(trabajado);
  delete o.days[key];
  delete o.daysByMonthNumber[n];
  o.noPayMonths = o.noPayMonths.filter((m) => Number(m) !== n);
  return o;
}

// ------------------------------------------------------------------ gastos
/** Upsert del gasto de la casa y de los gustos (paso 4). Un monto vacío o 0 no crea nada (queda como dato que falta). */
export function guardarGastosBase(draft, { casa, gustos }) {
  const upsert = (kind, name, monto, estimated) => {
    const m = Math.round(nn(monto));
    const it = draft.expenses.find((x) => x.kind === kind);
    if (m <= 0) return;
    if (it) { it.amount = m; if (estimated) it.estimated = true; else delete it.estimated; }
    else draft.expenses.push({ id: uid(), name, owner: nombreYo(draft), amount: m, kind, ...(estimated ? { estimated: true } : {}) });
  };
  if (casa !== undefined) upsert('casa', NOMBRE_CASA, casa, true);
  if (gustos !== undefined) upsert('gustos', NOMBRE_GUSTOS, gustos, false);
  draft.settings.pasos = { ...(draft.settings.pasos || {}), gastos: true };
}

/** "Ya gasté este mes en gustos: $X" (paso 4). Se guarda UN solo gasto anotado con una etiqueta fija (si lo editás, se reemplaza). */
export function guardarGastoInicial(draft, monto, today = new Date()) {
  draft.spent = (draft.spent || []).filter((g) => g.label !== LABEL_GASTO_INICIAL);
  const m = Math.round(nn(monto));
  if (m > 0) draft.spent.push({ id: uid(), date: toISO(today), amount: m, cat: 'gustos', label: LABEL_GASTO_INICIAL });
  return m > 0;
}
export const gastoInicial = (state) => (state.spent || []).find((g) => g.label === LABEL_GASTO_INICIAL) || null;

/** Gasto genérico (editor 'expense'). { name, amount, owner, estimated, kind } */
export function guardarGasto(draft, id, vals) {
  const monto = Math.round(nn(vals.amount));
  const name = String(vals.name || '').trim();
  if (!name || monto <= 0) return null;
  const it = id ? draft.expenses.find((x) => x.id === id) : null;
  if (it) {
    it.name = name; it.amount = monto; it.owner = vals.owner ?? it.owner ?? '';
    if (vals.estimated === true) it.estimated = true; else delete it.estimated;
    return it.id;
  }
  const nuevo = { id: uid(), name, owner: vals.owner ?? nombreYo(draft), amount: monto, kind: vals.kind || 'otro' };
  if (vals.estimated === true) nuevo.estimated = true;
  draft.expenses.push(nuevo);
  return nuevo.id;
}

// ------------------------------------------------------------------ cuotas, préstamos y planilla
/**
 * Lo que se muestra al editar una cuota: "cuota actual X de N" y si ya se descontó la de este mes.
 * remaining se cuenta DESDE first (incluida): si first es el mes que viene, la de este mes ya se descontó.
 * -> { actual, total, descontadaEsteMes, lejana } ; lejana = empieza más allá del mes que viene (no se puede expresar como X de N).
 */
export function estadoCuota(item, today = new Date()) {
  const cur = monthKeyOf(today);
  const first = item.first || cur;
  const restan = Math.max(0, Math.round(nn(item.remaining)));
  const total = Math.round(nn(item.total)) > 0 ? Math.round(nn(item.total)) : restan;
  const lejana = first > addMonths(cur, 1);
  const descontada = first > cur;
  const actual = Math.max(0, total - restan);
  return { actual, total, descontadaEsteMes: descontada, lejana };
}

/** Frase viva: "Faltan 10 cuotas. La última es en julio de 2027." (o null si todavía no se puede decir). */
export function fraseCuotas({ actual, total, descontadaEsteMes }, today = new Date()) {
  const a = Math.round(nn(actual, NaN));
  const n = Math.round(nn(total, NaN));
  if (!Number.isFinite(a) || !Number.isFinite(n) || n <= 0) return null;
  if (a > n) return null;
  const c = cuotasQueFaltan({ actual: a, total: n, descontadaEsteMes }, today);
  if (c.remaining <= 0) return 'Con esos números ya terminaste de pagarla.';
  return `${cuotasQueFaltanTexto(c.remaining, true)}. La última es en ${monthName(c.termina, { year: true, de: true })}.`;
}

/** "falta 1 cuota" / "faltan 10 cuotas" (con mayúscula inicial si capital). */
export function cuotasQueFaltanTexto(n, capital = false) {
  const t = n === 1 ? 'falta 1 cuota' : `faltan ${n} cuotas`;
  return capital ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

/** Error amable para los campos "cuota actual X de N" (o null). */
export function errorCuotas({ actual, total }) {
  const a = nn(actual, NaN);
  const n = nn(total, NaN);
  if (!Number.isFinite(n) || n <= 0) return { campo: 'total', texto: 'Poné de cuántas cuotas es en total.' };
  if (!Number.isFinite(a) || a < 0) return { campo: 'actual', texto: 'Poné en qué cuota vas (si todavía no pagaste ninguna, 0).' };
  if (a > n) return { campo: 'actual', texto: 'La cuota en que vas no puede ser más que el total.' };
  if (a >= n) return { campo: 'actual', texto: 'Con esos números ya la terminaste de pagar. Revisá la cuota en que vas.' };
  return null;
}

/**
 * Guarda una cuota o préstamo. vals: { name, amount, owner, payroll, actual, total, descontadaEsteMes, mantener? }.
 * `mantener` = { remaining, first } para conservar tal cual una cuota que empieza más adelante cuando no se tocó el conteo.
 * Si es el plan de AFIP, saca el pendiente 'afip'. Devuelve el id.
 */
export function guardarCuota(draft, id, vals, today = new Date()) {
  const monto = Math.round(nn(vals.amount));
  if (monto <= 0) return null;
  const c = vals.mantener || cuotasQueFaltan({ actual: vals.actual, total: vals.total, descontadaEsteMes: vals.descontadaEsteMes === true }, today);
  if (!(c.remaining > 0)) return null;
  const name = String(vals.name || '').trim() || (vals.payroll ? 'Préstamo por planilla' : 'Cuota');
  const total = Math.round(nn(vals.total));
  const it = id ? draft.installments.find((x) => x.id === id) : null;
  const datos = { name, owner: vals.owner ?? it?.owner ?? nombreYo(draft), amount: monto, remaining: c.remaining, first: c.first };
  let out;
  if (it) {
    Object.assign(it, datos);
    if (vals.payroll === true) it.payroll = true; else delete it.payroll;
    if (total > 0) it.total = total; else delete it.total;
    out = it;
  } else {
    out = { id: uid(), ...datos, ...(vals.payroll === true ? { payroll: true } : {}), ...(total > 0 ? { total } : {}) };
    draft.installments.push(out);
  }
  if (vals.afip === true || /afip/i.test(name)) draft.pending = (draft.pending || []).filter((p) => p.target !== 'afip' && p.id !== 'afip');
  draft.settings.pasos = { ...(draft.settings.pasos || {}), planilla: true };
  return out.id;
}

/** "No sé el monto todavía" del plan de AFIP: queda como dato que falta (la cuenta sale como provisoria). */
export function afipPendiente(draft) {
  draft.pending = draft.pending || [];
  if (!draft.pending.some((p) => p.target === 'afip' || p.id === 'afip')) draft.pending.push({ id: 'afip', label: NOMBRE_AFIP, target: 'afip' });
  draft.settings.pasos = { ...(draft.settings.pasos || {}), planilla: true };
}

/** "Sí / No / No sé": ¿el sueldo ya tiene restados los descuentos del recibo? */
export function guardarNeto(draft, valor) {
  draft.settings.salaryNetOfPayroll = valor === true ? true : valor === false ? false : null;
  draft.settings.pasos = { ...(draft.settings.pasos || {}), planilla: true };
}

/** "No me descuentan nada del recibo": recuerda que ya contestó el paso. */
export function sinDescuentos(draft) {
  draft.settings.pasos = { ...(draft.settings.pasos || {}), planilla: true };
}

/** Cuotas y préstamos que se descuentan del recibo (más el plan de AFIP si está pendiente). */
export function descuentosDelRecibo(state) {
  return (state.installments || []).filter((x) => x.payroll);
}

// ------------------------------------------------------------------ plata de hoy
/** Plata en la cuenta hoy y si ya cobró este mes. */
export function guardarPlataDeHoy(draft, { cash, cobroEsteMes }) {
  if (cash !== undefined) draft.settings.cash = Math.max(0, Math.round(nn(cash)));
  if (cobroEsteMes !== undefined) draft.settings.cobroEsteMes = cobroEsteMes === true ? true : cobroEsteMes === false ? false : null;
}

// ------------------------------------------------------------------ tarjeta y deudas
/** Interés mensual que se usa para "Le cobro el interés de lo suyo": el de la primera tarjeta con saldo. */
export function tasaDeLaTarjeta(state) {
  const c = (state.debts || []).find((d) => d.kind === 'card' && nn(d.rate) > 0);
  return c ? nn(c.rate) : 0;
}

/**
 * Carga el resumen de la tarjeta (crea la tarjeta si no existe). valores = lo que devuelve derive.validarResumen().valores.
 * extra: { name, creditor }. Devuelve el id de la tarjeta.
 */
export function guardarResumen(draft, debtId, valores, extra = {}, today = new Date()) {
  let d = debtId ? draft.debts.find((x) => x.id === debtId) : null;
  if (!d) {
    d = { id: uid(), name: String(extra.name || '').trim() || 'Tarjeta', kind: 'card', creditor: String(extra.creditor || '').trim(), balance: nn(valores.total), rate: nn(valores.rate), minPayment: nn(valores.min), statement: null, payments: [], planned: {}, holders: [] };
    draft.debts.push(d);
  } else {
    if (extra.name !== undefined && String(extra.name).trim()) d.name = String(extra.name).trim();
    if (extra.creditor !== undefined) d.creditor = String(extra.creditor).trim();
  }
  aplicarResumen(draft, d.id, valores, today);
  draft.settings.pasos = { ...(draft.settings.pasos || {}), tarjeta: true };
  return d.id;
}

/** Otra deuda con saldo (préstamo, plan): { name, creditor, balance, rate, minPayment }. */
export function guardarDeuda(draft, id, vals) {
  const name = String(vals.name || '').trim();
  const balance = Math.round(nn(vals.balance));
  if (!name || balance <= 0) return null;
  const it = id ? draft.debts.find((x) => x.id === id) : null;
  const datos = { name, creditor: String(vals.creditor || '').trim(), balance, rate: Math.max(0, nn(vals.rate)), minPayment: Math.max(0, Math.round(nn(vals.minPayment))) };
  if (it) { Object.assign(it, datos); return it.id; }
  const nuevo = { id: uid(), kind: vals.kind || 'other', ...datos, statement: null, payments: [], planned: {}, holders: [] };
  draft.debts.push(nuevo);
  return nuevo.id;
}

/** Edición simple de la tarjeta (nombre, banco, saldo, mínimo, interés) sin cargar un resumen. */
export function editarTarjeta(draft, id, vals) {
  const d = draft.debts.find((x) => x.id === id);
  if (!d) return false;
  if (String(vals.name || '').trim()) d.name = String(vals.name).trim();
  if (vals.creditor !== undefined) d.creditor = String(vals.creditor).trim();
  if (nn(vals.balance, -1) >= 0) d.balance = Math.round(nn(vals.balance));
  if (nn(vals.minPayment, -1) >= 0) d.minPayment = Math.round(nn(vals.minPayment));
  if (nn(vals.rate, -1) >= 0) d.rate = nn(vals.rate);
  return true;
}

// ------------------------------------------------------------------ me deben
/**
 * Alta o edición de "Me deben". vals: { person (nombre), personId?, balance, monthlyPayment?, cobraInteres?, note? }.
 * Si la persona no existe se agrega a la familia. Devuelve { id, personId }.
 */
export function guardarMeDeben(draft, id, vals) {
  const balance = Math.round(nn(vals.balance));
  const nombre = String(vals.person || '').trim();
  if (balance <= 0 || (!nombre && !vals.personId)) return null;
  let personId = vals.personId || idDe(draft, nombre);
  const persona = personId ? draft.people.find((p) => p.id === personId) : null;
  const nom = nombre || persona?.name || '';
  if (!personId) personId = agregarPersona(draft, { name: nom, role: vals.role || 'otro' });
  const rate = vals.cobraInteres === true ? tasaDeLaTarjeta(draft) : 0;
  const datos = { person: nom, personId, balance, monthlyPayment: Math.max(0, Math.round(nn(vals.monthlyPayment))), rate };
  if (vals.note !== undefined) datos.note = String(vals.note || '');
  const it = id ? draft.receivables.find((x) => x.id === id) : null;
  if (it) { Object.assign(it, datos); draft.settings.pasos = { ...(draft.settings.pasos || {}), medeben: true }; return { id: it.id, personId }; }
  const nuevo = { id: uid(), name: String(vals.name || ''), note: '', payments: [], ...datos };
  draft.receivables.push(nuevo);
  draft.settings.pasos = { ...(draft.settings.pasos || {}), medeben: true };
  return { id: nuevo.id, personId };
}

/** "No me deben nada" en el paso 7. */
export function sinDeudores(draft) {
  draft.settings.pasos = { ...(draft.settings.pasos || {}), medeben: true };
}

// ------------------------------------------------------------------ compras planificadas
export function borrarCompra(draft, id) {
  const n = (draft.plannedPurchases || []).length;
  draft.plannedPurchases = (draft.plannedPurchases || []).filter((x) => x.id !== id);
  return draft.plannedPurchases.length < n;
}

// ------------------------------------------------------------------ borrar
const LISTA = { income: 'incomes', movilidad: 'incomes', expense: 'expenses', installment: 'installments', debt: 'debts', receivable: 'receivables', person: 'people', plannedPurchase: 'plannedPurchases', spent: 'spent' };

/** Busca lo que se va a borrar. */
export function buscar(state, kind, id) {
  const lista = LISTA[kind];
  return lista ? (state[lista] || []).find((x) => x.id === id) || null : null;
}

/** Borra por tipo e id. Devuelve true si borró algo. */
export function borrar(draft, kind, id) {
  const lista = LISTA[kind];
  if (!lista) return false;
  const antes = (draft[lista] || []).length;
  const it = (draft[lista] || []).find((x) => x.id === id);
  draft[lista] = (draft[lista] || []).filter((x) => x.id !== id);
  if (kind === 'person') {
    sincronizarPersonas(draft);
    for (const d of draft.debts || []) d.holders = (d.holders || []).filter((x) => x.personId !== id);
  }
  if (kind === 'installment' && it && /afip/i.test(it.name || '')) draft.pending = (draft.pending || []).filter((p) => p.target !== 'afip');
  return draft[lista].length < antes;
}

/**
 * Hoja de consecuencias: { titulo, mensaje, boton } para borrar algo. Dice qué cambia en la cuenta, en palabras de casa.
 * `state` es el estado actual (con el ítem todavía).
 */
export function consecuenciasDeBorrar(state, kind, id) {
  const it = buscar(state, kind, id);
  if (!it) return null;
  const neto = state.settings?.salaryNetOfPayroll === true;
  switch (kind) {
    case 'income':
      if (it.kind === 'aguinaldo') return { titulo: '¿Borrar el aguinaldo?', mensaje: 'Dejás de contarlo en junio y diciembre: esos meses van a mostrar menos plata.', boton: 'Borrar el aguinaldo' };
      return { titulo: `¿Borrar ${it.name ? 'el ingreso “' + it.name + '”' : 'este ingreso'}?`, mensaje: `Dejás de contarlo en tu plan y tu plata libre baja ${money(it.amount)} por mes${it.months?.length ? ' (en los meses que lo cobrabas)' : ''}.`, boton: 'Borrar este ingreso' };
    case 'movilidad':
      return { titulo: '¿Borrar la movilidad?', mensaje: `Dejás de contarla en tu plan y tu plata libre baja unos ${money(it.fullMonthAmount || it.amount)} por mes.`, boton: 'Borrar la movilidad' };
    case 'expense':
      return { titulo: `¿Borrar “${it.name}”?`, mensaje: `Dejás de contarlo en tu plan y tu plata libre sube ${money(it.amount)} por mes.`, boton: 'Borrar este gasto' };
    case 'installment': {
      const afectaLibre = !(it.payroll && neto);
      return {
        titulo: `¿Borrar ${/afip/i.test(it.name || '') ? 'el plan de AFIP' : 'el préstamo de ' + money(it.amount)}?`,
        mensaje: afectaLibre
          ? `Dejás de pagarlo en la proyección y tu plata libre sube ${money(it.amount)} por mes. Esto no cancela nada en el banco: solo lo saca de tus cuentas acá.`
          : 'Dejás de contarlo en la proyección. Como tu sueldo ya viene sin ese descuento, tu plata libre de cada mes no cambia.',
        boton: 'Borrar',
      };
    }
    case 'debt':
      return { titulo: `¿Borrar ${it.name || 'esta deuda'}?`, mensaje: `Dejás de ver lo que debés (${money(it.balance)}) y la fecha en que terminás de pagarla. No se cancela nada en el banco: solo se saca de esta app.`, boton: 'Borrar esta deuda' };
    case 'receivable':
      return { titulo: `¿Borrar lo que te debe ${it.person || 'esta persona'}?`, mensaje: `Dejás de contar los ${money(it.balance)} que te debe${it.monthlyPayment > 0 ? ' y la plata que te devuelve por mes' : ''}.`, boton: 'Borrar' };
    case 'person':
      return { titulo: `¿Sacar a ${it.name} de la lista?`, mensaje: 'Deja de aparecer en la familia. Lo que cargaste a su nombre (gastos, deudas) se mantiene.', boton: 'Sacar de la lista' };
    case 'plannedPurchase':
      return { titulo: `¿Borrar “${it.name}”?`, mensaje: 'Dejás de contar esta compra en tu plan.', boton: 'Borrar esta compra' };
    case 'spent':
      return { titulo: '¿Borrar este gasto anotado?', mensaje: `Se saca de lo que anotaste (${money(it.amount)}).`, boton: 'Borrar' };
    default:
      return null;
  }
}

/** Qué decir (en un toast) después de anotar un gasto del día a día. */
export function textoGastoAnotado(monto, cat) {
  return cat === 'gustos' ? `Anotado. ${money(monto)} de tus gustos.` : `Anotado. ${money(monto)} de la casa.`;
}

/** Borra todo (conserva tema, letra y privacidad) y devuelve un estado vacío. */
export function estadoVacioConservando(state, today = new Date()) {
  const e = emptyState(today);
  for (const k of ['theme', 'fontSize', 'privacy']) if (state.settings?.[k] !== undefined) e.settings[k] = state.settings[k];
  return e;
}

/** ¿El estado tiene datos propios (no el ejemplo)? */
export const tieneDatosPropios = (state) => !state.settings?.demo && !!((state.incomes || []).length || (state.expenses || []).length || (state.debts || []).length || (state.receivables || []).length || (state.installments || []).length);
/** ¿Tiene algo cargado (propio o de ejemplo)? */
export const tieneDatos = (state) => !!((state.incomes || []).length || (state.expenses || []).length || (state.debts || []).length || (state.receivables || []).length || (state.installments || []).length);

export { nn };
