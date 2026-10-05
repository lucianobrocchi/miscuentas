// Persistencia local (localStorage) y modelo de datos v2. Los datos no salen del dispositivo.
// Sin DOM: se puede probar en node pasando un "storage" falso. La clave se mantiene ('miscuentas.v1') y el
// estado lleva v:2; load() y migrate() completan lo que falte, así que los datos viejos siguen funcionando.

import { toDate, toISO, monthKeyOf, addMonthsDate, monthName, plural, daysBetween } from './format.js';

export const STORAGE_KEY = 'miscuentas.v1';
export const VERSION = 2;
export const MENSAJE_ARCHIVO_INVALIDO = 'Ese archivo no parece una copia de Mis Cuentas. Probá con otro.';
export const MENSAJE_ARCHIVO_NUEVO = 'Esta copia es de una versión más nueva de Mis Cuentas. Actualizá la app y probá de nuevo.';

let _n = 0;
/** Id corto y único en este dispositivo. */
export const uid = () => Date.now().toString(36).slice(-4) + (_n++ % 1296).toString(36).padStart(2, '0') + Math.random().toString(36).slice(2, 6);

/** Mes real de una fecha como 'YYYY-MM' (por defecto, hoy). */
export const currentMonth = (d = new Date()) => monthKeyOf(d);

const ROLES = ['yo', 'pareja', 'hijo', 'hija', 'otro'];
const STRATEGIES = ['avalanche', 'snowball', 'none'];
const THEMES = ['auto', 'light', 'dark'];
const FONT_SIZES = ['normal', 'grande', 'masgrande'];

export const emptyState = (today = new Date()) => ({
  v: VERSION,
  settings: {
    start: currentMonth(today), // el motor usa siempre el mes real (toEngine); se guarda por compatibilidad
    horizon: 12,
    strategy: 'avalanche',
    buffer: 0,
    cash: 0,
    deficitRate: 0,
    people: '', // legado: texto con los nombres, sincronizado con people[]
    name: '',
    theme: 'auto',
    fontSize: 'normal',
    privacy: false,
    onboarded: false,
    onboardingStep: 0,
    pasos: {}, // pasos del armado que ya respondió (aunque sea "no tengo")
    salaryNetOfPayroll: null, // true | false | null (no sé)
    cobroEsteMes: null, // true | false | null
    lastBackupAt: null,
    mesesMode: '4',
    demo: false,
  },
  people: [],
  incomes: [],
  expenses: [],
  installments: [],
  debts: [],
  receivables: [],
  spent: [],
  plannedPurchases: [],
  pending: [],
  seen: { hitos: [], tips: [], cierres: [], proyecciones: {} },
});

// ---------- helpers de normalización ----------
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const str = (x) => (typeof x === 'string' ? x : x == null ? '' : String(x));
const nn = (x, d = 0) => {
  if (x === '' || x == null) return d;
  const v = Number(x);
  return Number.isFinite(v) ? v : d;
};
const isKey = (s) => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
const isISO = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && toISO(toDate(s)) === s;
const tri = (v) => (v === true ? true : v === false ? false : null);
const oneOf = (v, list, d) => (list.includes(v) ? v : d);
const list = (x) => (Array.isArray(x) ? x.filter(isObj) : []);

function numMap(o, keyOk) {
  const out = {};
  if (!isObj(o)) return out;
  for (const [k, v] of Object.entries(o)) {
    if (keyOk(k) && v !== null && v !== '' && Number.isFinite(Number(v))) out[k] = Number(v);
  }
  return out;
}
const keyOrNum = (k) => isKey(k) || /^(1[0-2]|[1-9])$/.test(k);

function setOrDelete(o, k, v) {
  if (v === undefined) delete o[k];
  else o[k] = v;
}

function inferIncomeKind(x) {
  if (['sueldo', 'movilidad', 'aguinaldo', 'otro'].includes(x.kind)) return x.kind;
  if (nn(x.perDay) > 0 || nn(x.fullMonthAmount) > 0) return 'movilidad';
  const name = str(x.name).toLowerCase();
  if (/aguinaldo/.test(name) || (Array.isArray(x.months) && x.months.length === 2 && x.months.includes(6) && x.months.includes(12))) return 'aguinaldo';
  if (/sueldo|salario|haberes/.test(name)) return 'sueldo';
  return 'otro';
}
function inferExpenseKind(x) {
  if (['casa', 'gustos', 'otro', 'compra'].includes(x.kind)) return x.kind;
  return /gusto|sorpresa/i.test(str(x.name)) ? 'gustos' : 'otro';
}

function normIncome(x) {
  const o = { ...x, id: str(x.id) || uid(), name: str(x.name), owner: str(x.owner), amount: nn(x.amount) };
  o.kind = inferIncomeKind(x);
  const months = Array.isArray(x.months) ? [...new Set(x.months.map(Number).filter((m) => m >= 1 && m <= 12))] : [];
  setOrDelete(o, 'months', months.length ? months : undefined);
  setOrDelete(o, 'from', isKey(x.from) ? x.from : undefined);
  setOrDelete(o, 'to', isKey(x.to) ? x.to : undefined);
  setOrDelete(o, 'perDay', nn(x.perDay) > 0 ? nn(x.perDay) : undefined);
  const ov = numMap(x.overrides, isKey);
  setOrDelete(o, 'overrides', Object.keys(ov).length ? ov : undefined);
  const dy = numMap(x.days, isKey);
  setOrDelete(o, 'days', Object.keys(dy).length ? dy : undefined);
  if (o.kind === 'movilidad') {
    setOrDelete(o, 'fullMonthAmount', nn(x.fullMonthAmount) > 0 ? nn(x.fullMonthAmount) : undefined);
    setOrDelete(o, 'fullMonthDays', nn(x.fullMonthDays) > 0 ? nn(x.fullMonthDays) : undefined);
    const np = Array.isArray(x.noPayMonths) ? [...new Set(x.noPayMonths.map(Number).filter((m) => m >= 1 && m <= 12))] : [];
    setOrDelete(o, 'noPayMonths', np.length ? np : undefined);
    const dm = numMap(x.daysByMonthNumber, (k) => /^(1[0-2]|[1-9])$/.test(k));
    setOrDelete(o, 'daysByMonthNumber', Object.keys(dm).length ? dm : undefined);
    setOrDelete(o, 'movilidadVencida', x.movilidadVencida === true ? true : undefined);
  }
  setOrDelete(o, 'estimated', x.estimated === true ? true : undefined);
  return o;
}

function normExpense(x) {
  const o = { ...x, id: str(x.id) || uid(), name: str(x.name), owner: str(x.owner), amount: nn(x.amount), kind: inferExpenseKind(x) };
  const months = Array.isArray(x.months) ? [...new Set(x.months.map(Number).filter((m) => m >= 1 && m <= 12))] : [];
  setOrDelete(o, 'months', months.length ? months : undefined);
  setOrDelete(o, 'from', isKey(x.from) ? x.from : undefined);
  setOrDelete(o, 'to', isKey(x.to) ? x.to : undefined);
  const ov = numMap(x.overrides, isKey);
  setOrDelete(o, 'overrides', Object.keys(ov).length ? ov : undefined);
  setOrDelete(o, 'estimated', x.estimated === true ? true : undefined);
  return o;
}

function normInstallment(x, start) {
  const o = { ...x, id: str(x.id) || uid(), name: str(x.name), owner: str(x.owner), amount: nn(x.amount), remaining: Math.max(0, Math.round(nn(x.remaining))) };
  o.first = isKey(x.first) ? x.first : start;
  setOrDelete(o, 'payroll', x.payroll === true ? true : undefined);
  setOrDelete(o, 'total', nn(x.total) > 0 ? Math.round(nn(x.total)) : undefined);
  return o;
}

// Fecha de cierre más reciente (<= hoy) para un día de cierre fijo del modelo viejo.
function ultimaFechaConDia(day, today) {
  const t = toDate(today);
  const clamp = (y, m) => Math.min(day, new Date(y, m + 1, 0).getDate());
  let d = new Date(t.getFullYear(), t.getMonth(), clamp(t.getFullYear(), t.getMonth()));
  if (d > t) d = addMonthsDate(d, -1);
  return d;
}
function conDia(date, day) {
  const x = toDate(date);
  return new Date(x.getFullYear(), x.getMonth(), Math.min(day, new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate()));
}

/** Del modelo previo (closeDay/dueDay/lastStatement) al resumen con fechas completas. */
function statementFromLegacy(d, today) {
  const ls = isObj(d.lastStatement) ? d.lastStatement : {};
  const closeDay = Math.round(nn(d.closeDay));
  const dueDay = Math.round(nn(d.dueDay));
  let closedOn = isISO(ls.closedOn) ? ls.closedOn : closeDay >= 1 && closeDay <= 31 ? toISO(ultimaFechaConDia(closeDay, today)) : null;
  if (!closedOn) return null;
  const cl = toDate(closedOn);
  const cd = closeDay >= 1 ? closeDay : cl.getDate();
  let dueOn = null;
  if (dueDay >= 1 && dueDay <= 31) {
    const base = dueDay > cd ? cl : addMonthsDate(cl, 1);
    dueOn = toISO(conDia(base, dueDay));
  }
  return {
    closedOn,
    dueOn,
    nextCloseOn: toISO(conDia(addMonthsDate(cl, 1), cd)),
    nextDueOn: dueOn ? toISO(conDia(addMonthsDate(toDate(dueOn), 1), dueDay)) : null,
    total: nn(ls.total, nn(d.balance)),
    min: nn(ls.min, nn(d.minPayment)),
    label: str(ls.label),
    loadedAt: isISO(ls.loadedAt) ? ls.loadedAt : null,
  };
}

function normStatement(d, today) {
  let st = isObj(d.statement) ? d.statement : null;
  if (!st && (isObj(d.lastStatement) || d.closeDay || d.dueDay)) st = statementFromLegacy(d, today);
  if (!st) return null;
  const out = { ...st };
  for (const k of ['closedOn', 'dueOn', 'nextCloseOn', 'nextDueOn']) out[k] = isISO(st[k]) ? st[k] : null;
  out.total = nn(st.total);
  out.min = nn(st.min);
  out.label = str(st.label);
  out.loadedAt = isISO(st.loadedAt) ? st.loadedAt : null;
  setOrDelete(out, 'newCharges', st.newCharges === undefined || st.newCharges === null || st.newCharges === '' ? undefined : nn(st.newCharges));
  setOrDelete(out, 'interes', st.interes === undefined || st.interes === null || st.interes === '' ? undefined : nn(st.interes));
  if (!out.closedOn) return null;
  return out;
}

function normPayments(arr, today) {
  return list(arr)
    .map((p) => ({ ...p, id: str(p.id) || uid(), date: isISO(p.date) ? p.date : toISO(today), amount: nn(p.amount) }))
    .filter((p) => p.amount > 0);
}

function normDebt(x, today) {
  const o = { ...x, id: str(x.id) || uid(), name: str(x.name), kind: oneOf(x.kind, ['card', 'loan', 'other'], 'card'), creditor: str(x.creditor), balance: nn(x.balance), rate: Math.max(0, nn(x.rate)), minPayment: Math.max(0, nn(x.minPayment)) };
  const st = normStatement(x, today);
  o.statement = st;
  delete o.lastStatement;
  delete o.closeDay;
  delete o.dueDay;
  o.payments = normPayments(x.payments, today);
  o.planned = numMap(x.planned, isKey);
  o.holders = list(x.holders)
    .map((h) => ({ ...h, personId: str(h.personId), amount: nn(h.amount) }))
    .filter((h) => h.personId);
  setOrDelete(o, 'paidOffOn', isISO(x.paidOffOn) ? x.paidOffOn : undefined);
  return o;
}

function normReceivable(x, today, people) {
  const o = { ...x, id: str(x.id) || uid(), person: str(x.person), name: str(x.name), balance: nn(x.balance), rate: Math.max(0, nn(x.rate)), monthlyPayment: Math.max(0, nn(x.monthlyPayment)), note: str(x.note) };
  o.payments = normPayments(x.payments, today);
  let pid = str(x.personId);
  if (!pid || !people.some((p) => p.id === pid)) {
    const p = people.find((q) => q.name.trim().toLowerCase() === o.person.trim().toLowerCase() && o.person.trim());
    pid = p ? p.id : '';
  }
  o.personId = pid;
  if (!o.person && pid) o.person = people.find((p) => p.id === pid)?.name || '';
  return o;
}

function guessRole(name, index) {
  const n = name.toLowerCase();
  if (/pareja|espos|marido|mujer|novi/.test(n)) return 'pareja';
  if (/\bhija\b|hija\b/.test(n)) return 'hija';
  if (/\bhijo\b|hijo\b/.test(n)) return 'hijo';
  if (index === 0) return 'yo';
  return 'otro';
}

function normPeople(raw, legacyString, extraNames) {
  let people = list(raw)
    .map((p) => ({ ...p, id: str(p.id) || uid(), name: str(p.name).trim(), role: oneOf(p.role, ROLES, 'otro') }))
    .filter((p) => p.name);
  if (!people.length && typeof legacyString === 'string' && legacyString.trim()) {
    people = legacyString
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((name, i) => ({ id: uid(), name, role: guessRole(name, i) }));
  }
  // nombres que ya se usan en ítems viejos (owner / person) y no están en la lista
  for (const n of extraNames) {
    const name = n.trim();
    if (name && !people.some((p) => p.name.toLowerCase() === name.toLowerCase())) people.push({ id: uid(), name, role: guessRole(name, 99) });
  }
  return people;
}

/**
 * Completa y valida un estado (viejo, nuevo o a medias) y devuelve un estado v2 completo.
 * Idempotente: normalize(normalize(x)) es igual a normalize(x). No muta la entrada.
 */
export function normalize(raw, { today = new Date() } = {}) {
  const e = emptyState(today);
  const r = isObj(raw) ? raw : {};
  const rs = isObj(r.settings) ? r.settings : {};
  const s = { ...e.settings, ...rs };
  s.start = isKey(rs.start) ? rs.start : e.settings.start;
  s.horizon = Math.min(60, Math.max(3, Math.round(nn(rs.horizon, 12))));
  s.strategy = oneOf(rs.strategy, STRATEGIES, 'avalanche');
  s.buffer = Math.max(0, nn(rs.buffer));
  s.cash = Math.max(0, nn(rs.cash));
  s.deficitRate = Math.max(0, nn(rs.deficitRate));
  s.name = str(rs.name);
  s.theme = oneOf(rs.theme, THEMES, 'auto');
  s.fontSize = oneOf(rs.fontSize, FONT_SIZES, 'normal');
  s.privacy = rs.privacy === true;
  s.onboarded = rs.onboarded === true;
  s.onboardingStep = Math.max(0, Math.min(7, Math.round(nn(rs.onboardingStep))));
  s.pasos = {};
  if (isObj(rs.pasos)) for (const [k, v] of Object.entries(rs.pasos)) if (v === true) s.pasos[k] = true;
  s.salaryNetOfPayroll = tri(rs.salaryNetOfPayroll);
  s.cobroEsteMes = tri(rs.cobroEsteMes);
  s.lastBackupAt = isISO(rs.lastBackupAt) ? rs.lastBackupAt : null;
  s.mesesMode = rs.mesesMode === '12' ? '12' : '4';
  s.demo = rs.demo === true;

  const incomes = list(r.incomes).map(normIncome);
  const expenses = list(r.expenses).map(normExpense);
  const installments = list(r.installments).map((x) => normInstallment(x, s.start));
  const debts = list(r.debts).map((x) => normDebt(x, today));
  const extraNames = [
    ...incomes.map((x) => x.owner),
    ...expenses.map((x) => x.owner),
    ...installments.map((x) => x.owner),
    ...list(r.receivables).map((x) => str(x.person)),
  ];
  const people = normPeople(r.people, rs.people, Array.isArray(r.people) && r.people.length ? [] : extraNames);
  const receivables = list(r.receivables).map((x) => normReceivable(x, today, people));
  s.people = people.map((p) => p.name).join(', ');

  const seenIn = isObj(r.seen) ? r.seen : {};
  const strs = (a) => (Array.isArray(a) ? [...new Set(a.filter((x) => typeof x === 'string'))] : []);
  const seen = { hitos: strs(seenIn.hitos), tips: strs(seenIn.tips), cierres: strs(seenIn.cierres), proyecciones: numMap(seenIn.proyecciones, isKey) };

  const pendSeen = new Set();
  const pending = list(r.pending)
    .map((p) => ({ ...p, id: str(p.id), label: str(p.label), target: str(p.target) || str(p.id) }))
    .filter((p) => p.id && !pendSeen.has(p.id) && pendSeen.add(p.id));

  const spent = list(r.spent).map((x) => ({
    ...x,
    id: str(x.id) || uid(),
    date: isISO(x.date) ? x.date : toISO(today),
    amount: nn(x.amount),
    cat: oneOf(x.cat, ['casa', 'gustos'], 'gustos'),
  })).filter((x) => x.amount > 0);

  const plannedPurchases = list(r.plannedPurchases).map((x) => {
    const o = {
      ...x,
      id: str(x.id) || uid(),
      name: str(x.name),
      amount: nn(x.amount),
      modo: oneOf(x.modo, ['una', 'cuotas', 'mensual'], 'una'),
      desde: isKey(x.desde) ? x.desde : s.start,
      cuotas: Math.max(1, Math.round(nn(x.cuotas, 1))),
      hecha: x.hecha === true,
    };
    setOrDelete(o, 'montoCuota', nn(x.montoCuota) > 0 ? nn(x.montoCuota) : undefined);
    setOrDelete(o, 'hasta', isKey(x.hasta) ? x.hasta : undefined);
    setOrDelete(o, 'hechaEl', isISO(x.hechaEl) ? x.hechaEl : undefined);
    return o;
  });

  return { v: VERSION, settings: s, people, incomes, expenses, installments, debts, receivables, spent, plannedPurchases, pending, seen };
}

/** Migra cualquier estado anterior (v1 o sin versión) a v2. Es normalize() con un nombre más claro. */
export const migrate = normalize;

// ---------- guardar y leer ----------
function safeStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** Lee el estado guardado. Nunca tira error: ante cualquier problema devuelve un estado vacío. */
export function load(storage = safeStorage(), { today = new Date() } = {}) {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return emptyState(today);
    return normalize(JSON.parse(raw), { today });
  } catch {
    return emptyState(today);
  }
}

/** Guarda el estado. Devuelve true si pudo (modo privado o storage lleno: false, y la app sigue andando). */
export function save(state, storage = safeStorage()) {
  try {
    if (!storage) return false;
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

// ---------- copia de seguridad ----------
/** Arma el archivo de la copia: { nombreArchivo, contenido (texto JSON) }. Después hay que marcar la copia con marcarCopia(). */
export function exportJSON(state, today = new Date()) {
  const copia = { app: 'miscuentas', exportedAt: toISO(today), ...normalize(state, { today }) };
  return { nombreArchivo: `mis-cuentas-${toISO(today)}.json`, contenido: JSON.stringify(copia, null, 2) };
}

/** Resumen en palabras de lo que tiene un estado: sirve para decir qué reemplaza una copia. */
export function describeState(state) {
  const s = normalize(state);
  const partes = [];
  const add = (n, uno, otros) => n > 0 && partes.push(plural(n, uno, otros));
  add(s.people.length, 'persona', 'personas');
  add(s.incomes.length, 'ingreso', 'ingresos');
  add(s.expenses.length, 'gasto', 'gastos');
  add(s.installments.length, 'cuota o préstamo', 'cuotas o préstamos');
  add(s.debts.length, 'tarjeta o deuda', 'tarjetas o deudas');
  add(s.receivables.length, 'persona que te debe', 'personas que te deben');
  return { personas: s.people.length, ingresos: s.incomes.length, gastos: s.expenses.length, cuotas: s.installments.length, deudas: s.debts.length, meDeben: s.receivables.length, texto: partes.length ? partes.join(', ') : 'sin datos cargados' };
}

/**
 * Lee y valida una copia (texto JSON). Devuelve { ok:true, state, resumen, descartados } o { ok:false, mensaje }.
 * Acepta copias del modelo anterior (se migran). Nunca tira error.
 */
export function importJSON(text, { today = new Date() } = {}) {
  let obj;
  try {
    if (typeof text !== 'string' || text.length > 8 * 1024 * 1024) return { ok: false, mensaje: MENSAJE_ARCHIVO_INVALIDO };
    obj = JSON.parse(text);
  } catch {
    return { ok: false, mensaje: MENSAJE_ARCHIVO_INVALIDO };
  }
  if (!isObj(obj) || !isObj(obj.settings) || !Array.isArray(obj.incomes)) return { ok: false, mensaje: MENSAJE_ARCHIVO_INVALIDO };
  if (Number(obj.v) > VERSION) return { ok: false, mensaje: MENSAJE_ARCHIVO_NUEVO };
  const listas = ['incomes', 'expenses', 'installments', 'debts', 'receivables', 'spent', 'plannedPurchases', 'pending', 'people'];
  let descartados = 0;
  for (const k of listas) {
    if (obj[k] === undefined) continue;
    if (!Array.isArray(obj[k])) return { ok: false, mensaje: MENSAJE_ARCHIVO_INVALIDO };
    descartados += obj[k].filter((x) => !isObj(x)).length;
  }
  const { app, exportedAt, ...resto } = obj;
  void app;
  void exportedAt;
  const state = normalize(resto, { today });
  return { ok: true, state, resumen: describeState(state), descartados };
}

// ---------- mutadores: todos reciben el borrador (draft) que entrega ctx.update(fn) y lo modifican ----------
function etiquetaResumen(closedOn) {
  const d = toDate(closedOn);
  if (!d) return '';
  // un resumen que cierra a principios de mes corresponde a los consumos del mes anterior
  return monthName(d.getDate() <= 10 ? addMonthsDate(d, -1) : d);
}

/** Registra que pagaste algo de una deuda y baja el saldo. Devuelve el pago creado o null si el monto no sirve. */
export function registrarPagoDeuda(draft, debtId, { amount, date }, today = new Date()) {
  const d = draft.debts.find((x) => x.id === debtId);
  const monto = Math.round(nn(amount));
  if (!d || monto <= 0) return null;
  const pago = { id: uid(), date: isISO(date) ? date : toISO(today), amount: monto };
  d.payments = [...(d.payments || []), pago];
  d.balance = Math.max(0, nn(d.balance) - monto);
  if (d.balance === 0) d.paidOffOn = pago.date;
  return pago;
}

/**
 * Carga un resumen nuevo de la tarjeta. stmt: { closedOn, dueOn, nextCloseOn?, nextDueOn?, total, min, rate?, label?, newCharges?, interes? }.
 * Actualiza saldo (total menos lo que pagaste después del cierre), mínimo e interés, y limpia pagos elegidos de meses pasados.
 */
export function aplicarResumen(draft, debtId, stmt, today = new Date()) {
  const d = draft.debts.find((x) => x.id === debtId);
  if (!d || !isISO(stmt.closedOn)) return false;
  const total = Math.max(0, nn(stmt.total));
  const nextClose = isISO(stmt.nextCloseOn) ? stmt.nextCloseOn : toISO(addMonthsDate(stmt.closedOn, 1));
  const nextDue = isISO(stmt.nextDueOn) ? stmt.nextDueOn : isISO(stmt.dueOn) ? toISO(addMonthsDate(stmt.dueOn, 1)) : null;
  const st = {
    closedOn: stmt.closedOn,
    dueOn: isISO(stmt.dueOn) ? stmt.dueOn : null,
    nextCloseOn: nextClose,
    nextDueOn: nextDue,
    total,
    min: Math.max(0, nn(stmt.min)),
    label: str(stmt.label) || etiquetaResumen(stmt.closedOn),
    loadedAt: toISO(today),
  };
  if (stmt.newCharges !== undefined && stmt.newCharges !== '' && stmt.newCharges !== null) st.newCharges = nn(stmt.newCharges);
  if (stmt.interes !== undefined && stmt.interes !== '' && stmt.interes !== null) st.interes = nn(stmt.interes);
  d.statement = st;
  const despues = (d.payments || []).filter((p) => p.date > stmt.closedOn).reduce((a, p) => a + nn(p.amount), 0);
  d.balance = Math.max(0, total - despues);
  d.minPayment = st.min;
  if (stmt.rate !== undefined && stmt.rate !== null && stmt.rate !== '') d.rate = Math.max(0, nn(stmt.rate));
  const mes = currentMonth(today);
  const planned = {};
  for (const [k, v] of Object.entries(d.planned || {})) if (k >= mes) planned[k] = v;
  d.planned = planned;
  if (d.balance > 0) delete d.paidOffOn;
  return true;
}

/**
 * Anota que alguien te pagó. destino: 'tarjeta' (también registra el pago a la deuda debtId), 'guardada' (suma a tu plata)
 * o 'gastada' (solo baja lo que te deben). Devuelve { ok, saldoNuevo } o { ok:false }.
 */
export function anotarCobro(draft, receivableId, { amount, date, destino = 'gastada', debtId } = {}, today = new Date()) {
  const r = draft.receivables.find((x) => x.id === receivableId);
  const monto = Math.round(nn(amount));
  if (!r || monto <= 0) return { ok: false };
  const f = isISO(date) ? date : toISO(today);
  r.payments = [...(r.payments || []), { id: uid(), date: f, amount: monto, destino }];
  r.balance = Math.max(0, nn(r.balance) - monto);
  if (destino === 'tarjeta') {
    const card = (debtId && draft.debts.find((x) => x.id === debtId)) || draft.debts.find((x) => x.kind === 'card' && nn(x.balance) > 0) || draft.debts.find((x) => x.kind === 'card');
    if (card) registrarPagoDeuda(draft, card.id, { amount: monto, date: f }, today);
  } else if (destino === 'guardada') {
    draft.settings.cash = nn(draft.settings.cash) + monto;
  }
  return { ok: true, saldoNuevo: r.balance };
}

/** Anota un gasto del día a día. cat: 'casa' | 'gustos'. Solo 'gustos' resta de "Para gastar hoy". */
export function registrarGasto(draft, { amount, cat = 'gustos', date, label = '' }, today = new Date()) {
  const monto = Math.round(nn(amount));
  if (monto <= 0) return null;
  const g = { id: uid(), date: isISO(date) ? date : toISO(today), amount: monto, cat: oneOf(cat, ['casa', 'gustos'], 'gustos'), label: str(label) };
  draft.spent = [...(draft.spent || []), g];
  return g;
}

/** Crea una compra planificada desde ¿Me alcanza? (gasto: { nombre, monto, modo, desde, cuotas, montoCuota?, hasta? }). */
export function crearCompraPlanificada(draft, gasto) {
  const modo = oneOf(gasto.modo, ['una', 'cuotas', 'mensual'], 'una');
  const p = {
    id: uid(),
    name: str(gasto.nombre || gasto.name) || 'Compra',
    amount: Math.max(0, nn(gasto.monto)),
    modo,
    desde: isKey(gasto.desde) ? gasto.desde : draft.settings.start,
    cuotas: Math.max(1, Math.round(nn(gasto.cuotas, 1))),
    hecha: false,
  };
  if (nn(gasto.montoCuota) > 0) p.montoCuota = nn(gasto.montoCuota);
  if (isKey(gasto.hasta)) p.hasta = gasto.hasta;
  draft.plannedPurchases = [...(draft.plannedPurchases || []), p];
  return p.id;
}

/** Marca una compra planificada como hecha. No crea un gasto aparte (no se duplica con "Anoté un gasto"). */
export function marcarCompraHecha(draft, id, today = new Date()) {
  const p = (draft.plannedPurchases || []).find((x) => x.id === id);
  if (!p) return false;
  p.hecha = true;
  p.hechaEl = toISO(today);
  return true;
}

/**
 * Elige cuánto pagar de la tarjeta. opcion: 'minimo' (solo el mínimo, siempre), 'sobra' (el mínimo y lo que sobra)
 * o 'otro' (monto elegido para el mes `mes`, 'YYYY-MM').
 */
export function elegirPagoTarjeta(draft, debtId, { opcion, monto, mes }) {
  const d = draft.debts.find((x) => x.id === debtId);
  if (!d) return false;
  d.planned = { ...(d.planned || {}) };
  if (opcion === 'minimo') {
    draft.settings.strategy = 'none';
    if (mes) delete d.planned[mes];
  } else if (opcion === 'sobra') {
    if (draft.settings.strategy === 'none') draft.settings.strategy = 'avalanche';
    if (mes) delete d.planned[mes];
  } else if (opcion === 'otro' && isKey(mes) && nn(monto, -1) >= 0) {
    d.planned[mes] = Math.round(nn(monto));
  } else return false;
  return true;
}

/**
 * Aplica un conjunto de cambios generado por derive (opciones de un mes difícil, usar otro monto de gustos, etc.):
 * { agregar: { incomes, expenses, installments }, editar: [{ lista, id, set }], overrides: [{ lista, id, mes, valor }] }.
 */
export function aplicarCambios(draft, cambios = {}) {
  for (const lista of ['incomes', 'expenses', 'installments']) {
    for (const item of cambios.agregar?.[lista] || []) draft[lista].push({ ...item, id: item.id || uid() });
  }
  for (const e of cambios.editar || []) {
    const it = draft[e.lista]?.find((x) => x.id === e.id);
    if (it) Object.assign(it, e.set);
  }
  for (const o of cambios.overrides || []) {
    const it = draft[o.lista]?.find((x) => x.id === o.id);
    if (it) it.overrides = { ...(it.overrides || {}), [o.mes]: Number(o.valor) };
  }
  return draft;
}

/** Cambia el monto mensual de "gastos de la casa" (cierre de mes: "Ajustar mis gastos de la casa a $X"). */
export function ajustarGastosCasa(draft, monto) {
  const e = draft.expenses.find((x) => x.kind === 'casa');
  if (!e) return false;
  e.amount = Math.max(0, Math.round(nn(monto)));
  delete e.estimated;
  return true;
}

/** Recuerda que algo ya se mostró: tipo 'hitos' | 'tips' | 'cierres'. */
export function marcarVisto(draft, tipo, id) {
  draft.seen = draft.seen || { hitos: [], tips: [], cierres: [], proyecciones: {} };
  draft.seen[tipo] = draft.seen[tipo] || [];
  if (!draft.seen[tipo].includes(id)) draft.seen[tipo].push(id);
}

/** Marca que se descargó o mandó una copia de seguridad. */
export function marcarCopia(draft, today = new Date()) {
  draft.settings.lastBackupAt = toISO(today);
}

/** Suma una persona (nombre y rol) y mantiene sincronizado el texto viejo settings.people. Devuelve su id. */
export function agregarPersona(draft, { name, role = 'otro' }) {
  const n = str(name).trim();
  if (!n) return null;
  const ya = draft.people.find((p) => p.name.toLowerCase() === n.toLowerCase());
  if (ya) return ya.id;
  const p = { id: uid(), name: n, role: oneOf(role, ROLES, 'otro') };
  draft.people.push(p);
  draft.settings.people = draft.people.map((x) => x.name).join(', ');
  return p.id;
}

/** Días desde la última copia (null si nunca hubo). */
export function diasDesdeCopia(state, today = new Date()) {
  const d = state.settings.lastBackupAt;
  return d ? daysBetween(d, today) : null;
}
