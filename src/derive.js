// Capa de derivación: todo lo que las pantallas necesitan y el motor no calcula.
// Funciones PURAS (no tocan el estado ni el DOM). Todas reciben el estado v2 de la app y `today` (Date, inyectable).
// run() memoiza por hash (máx. 50). El resultado de run() es de SOLO LECTURA: no lo modifiques.
// Referencia completa de firmas y campos: docs/derive-api.md

import { simulate, amountFor, daysFor, installmentEnd, installmentActive, isActive, addMonths, monthDiff } from './engine.js';
import { FERIADOS, workdays } from './calendar.js';
import { toEngine, estadoResumen, pagosDelMes, pagosDelResumen, normalizarGasto, gastoAExtras, cuotasQueFaltan } from './adapter.js';
import { money, compact, monthName, longDate, plural, lista, pct, toDate, toISO, monthKeyOf, addMonthsDate, addDays, daysBetween, lastDayOfMonth, haceTiempo, parseMoney, parseRate, revisarMonto } from './format.js';

export { estadoResumen, pagosDelMes, pagosDelResumen, normalizarGasto, gastoAExtras, cuotasQueFaltan, toEngine };

// ---------- textos fijos ----------
export const PIE_DECISION = 'Es una estimación con los datos que cargaste. No es asesoramiento financiero.';
export const ASUME_SALIDA = 'Si de acá en más pagás completo lo que consumís en el mes';
export const LEYENDA_MAPA = [
  { codigo: 'verde', glifo: 'circulo', texto: 'Sin costo' },
  { codigo: 'ambar', glifo: 'cuadrado', texto: 'Con costo' },
  { codigo: 'terracota', glifo: 'triangulo', texto: 'No conviene' },
];
/** Limitaciones del cálculo, en palabras de casa (para "Qué supone esta fecha" y Más > Ayuda). */
export const LIMITACIONES = [
  'No incluye lo que vos y tu familia compren de acá en más con la tarjeta: la fecha supone que cada compra nueva se paga completa en su resumen.',
  'El interés se calcula sobre el saldo entero antes de pagar, así que puede salir un poco más alto que el del banco.',
  'Si un mes falta plata, el faltante se suma a la deuda de la tarjeta.',
  'Los feriados de 2027 y algunos traslados son estimados: podés corregir los días de movilidad a mano.',
  'El saldo de la tarjeta es el del último resumen que cargaste.',
  'No incluye aumentos de sueldo ni suba de precios.',
];
export const GLOSARIO = {
  'pago minimo': { titulo: 'Pago mínimo', texto: 'Es lo menos que te pide el banco que pagues de la tarjeta en el mes. Está en tu resumen. Si pagás solo eso, el resto de la deuda sigue sumando interés.' },
  'saldo actual': { titulo: 'Saldo actual', texto: 'Es lo que debés hoy en la tarjeta: el total a pagar que figura en tu último resumen, menos lo que pagaste después.' },
  'interes mensual': { titulo: 'Interés mensual', texto: 'Es lo que el banco te cobra cada mes sobre lo que debés. En el resumen puede aparecer también como porcentaje anual: acá usamos el mensual (el anual dividido por 12, más o menos).' },
  estimado: { titulo: 'Estimado', texto: 'Es un número que armamos con lo que nos contaste, pero que todavía no confirmaste con un papel (por ejemplo el aguinaldo). Cuando lo confirmes, deja de ser estimado.' },
  provisorio: { titulo: 'Provisorio', texto: 'Quiere decir que falta algún dato que puede cambiar el resultado. Cuando lo completes, el número se actualiza solo.' },
};
/** Texto de ayuda ("Qué es esto") para un término: 'pago minimo', 'saldo actual', 'interes mensual', 'estimado', 'provisorio'. */
export function glosario(termino) {
  const k = String(termino || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
  return GLOSARIO[k] || null;
}

// ---------- helpers ----------
const nn = (v, d = 0) => {
  if (v === '' || v == null) return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const mes = (k) => monthName(k);
const mesAnio = (k) => monthName(k, { year: true });
const mesDe = (k) => monthName(k, { year: true, de: true });
const fecha = (iso) => longDate(iso);
const EPS = 0.5;
const TONOS = { bien: 'ok', justo: 'warn', cubierto: 'warn', falta: 'bad' };
const ETIQUETAS = { bien: 'Alcanza', justo: 'Ajustado', cubierto: 'Ajustado (lo cubre tu plata guardada)', falta: 'Falta plata' };
const RANGO = { bien: 0, justo: 1, cubierto: 1, falta: 2 };
const dia = (t) => toDate(t) || new Date();
const salidaTexto = (paidOn, start) => (!paidOn ? 'No se termina' : monthDiff(start, paidOn) > 24 ? 'Más de 2 años' : mesAnio(paidOn));
const nombreCorto = (d) => String(d?.name || 'tarjeta').replace(/^tarjeta\s+/i, '');

// ---------- run (memoizado) ----------
// Dos memos: (1) el estado del motor por objeto de estado (WeakMap, se revalida con el contenido) y (2) la simulación por
// "hash" del contenido (estado + día + gasto hipotético + estrategia), máx. 50 entradas. Así 13 corridas de ¿Me alcanza? no
// repiten el armado del estado del motor y una pantalla que llama a varias funciones corre el motor una sola vez.
const cache = new Map();
const CACHE_MAX = 50;
const estadosCache = new WeakMap();
const engCache = new WeakMap();

function firmaDe(state, t) {
  return `${toISO(t)}|${JSON.stringify(state)}`;
}

/** Estado del motor (toEngine) memoizado por objeto de estado; se recalcula si cambió su contenido o el día. */
function engDe(state, t, firma = firmaDe(state, t)) {
  const hit = engCache.get(state);
  if (hit && hit.firma === firma) return hit.eng;
  const eng = toEngine(state, t);
  engCache.set(state, { firma, eng });
  return eng;
}

/**
 * Corre el motor sobre el estado de la app: simulate(toEngine(state, today), { extraExpenses: extra, strategy }).
 * Memoizado por contenido (máx. 50). El resultado es el de simulate() más `sim.eng` (el estado del motor con flags,
 * pending y omitidos; no enumerable). No lo modifiques.
 * @param {object} state estado v2
 * @param {{extra?: object[], strategy?: 'avalanche'|'snowball'|'none', today?: Date}} [opts]
 */
export function run(state, { extra = [], strategy, today = new Date() } = {}) {
  const t = dia(today);
  const firma = firmaDe(state, t);
  const key = `${firma}|${JSON.stringify(extra)}|${strategy ?? ''}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const eng = engDe(state, t, firma);
  const { flags, pending, omitidos, ...core } = eng;
  void flags;
  void pending;
  void omitidos;
  const sim = simulate(core, { extraExpenses: extra, strategy });
  Object.defineProperty(sim, 'eng', { value: eng, enumerable: false });
  cache.set(key, sim);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return sim;
}

/** Vacía el memo (para tests). */
export function limpiarMemo() {
  cache.clear();
}

/**
 * Estado de cada mes de una simulación (con el efecto de la plata guardada). Un array paralelo a sim.months.
 * @returns {{code:'bien'|'justo'|'cubierto'|'falta', pct:number, label:string, tone:'ok'|'warn'|'bad', faltante:number, shortfall:number, fromCash:number}[]}
 */
export function estadosDe(sim) {
  let e = estadosCache.get(sim);
  if (!e) {
    e = [];
    let prev = nn(sim.eng?.settings?.cash);
    for (const m of sim.months) {
      e.push(monthState(m, prev));
      prev = m.cash;
    }
    estadosCache.set(sim, e);
  }
  return e;
}

function ctx(state, today, opts = {}) {
  const t = dia(today);
  const sim = run(state, { today: t, ...opts });
  return { t, sim, eng: sim.eng, start: sim.eng.settings.start, estados: estadosDe(sim) };
}

// Mínimo que se paga en el mes i (o el pago elegido ese mes), sumando todas las deudas.
function minimoMes(sim, i) {
  const key = sim.months[i].key;
  let tot = 0;
  for (const d of sim.eng.debts) {
    const prev = i === 0 ? nn(d.balance) : sim.months[i - 1].debts[d.id];
    if (!(prev > 0.005)) continue;
    const bal = prev * (1 + nn(d.rate) / 100);
    const elegido = d.planned?.[key];
    tot += elegido !== undefined && elegido !== null && elegido !== '' ? Math.min(nn(elegido), bal) : Math.min(nn(d.minPayment), bal);
  }
  return tot;
}

function tarjetaDe(eng, debtId) {
  return eng.debts.find((d) => d.id === debtId) || eng.debts.find((d) => d.kind === 'card' && d.balance > 0) || eng.debts.find((d) => d.kind === 'card') || null;
}
const tarjetaEstado = (state, debtId) => state.debts.find((d) => d.id === debtId) || state.debts.find((d) => d.kind === 'card' && nn(d.balance) > 0) || state.debts.find((d) => d.kind === 'card') || null;
const tasaMayor = (eng) => eng.debts.filter((d) => d.balance > 0).reduce((a, d) => Math.max(a, nn(d.rate)), 0);

// ============================================================================
// Estado de cada mes
// ============================================================================

/**
 * Clasifica un mes de la simulación.
 * @param {object} m mes de sim.months
 * @param {number} [prevCash] plata guardada al cierre del mes anterior (para el primero: settings.cash del motor)
 * @returns {{code:'bien'|'justo'|'cubierto'|'falta', pct:number, label:string, tone:'ok'|'warn'|'bad', faltante:number, shortfall:number, fromCash:number}}
 * bien = sobra 5% o más de lo que entra ("Alcanza"); justo = de 0 a 5% ("Ajustado"); cubierto = falta pero lo cubre
 * la plata guardada ("Ajustado"); falta = no alcanza ("Falta plata"). faltante = lo que no cubre la plata guardada.
 */
export function monthState(m, prevCash = 0) {
  const inflow = nn(m.income) + nn(m.collections);
  const pctv = inflow > 0 ? m.free / inflow : m.free < 0 ? -1 : 0;
  let code;
  let fromCash = 0;
  if (m.free < -EPS) {
    fromCash = Math.max(0, nn(prevCash) - nn(m.cash));
    code = fromCash >= m.shortfall - EPS ? 'cubierto' : 'falta';
  } else code = pctv < 0.05 ? 'justo' : 'bien';
  return {
    code,
    pct: pctv,
    label: ETIQUETAS[code],
    tone: TONOS[code],
    faltante: code === 'falta' ? Math.max(0, m.shortfall - fromCash) : 0,
    shortfall: nn(m.shortfall),
    fromCash,
  };
}

// ============================================================================
// HOY
// ============================================================================

/**
 * Datos del hero de Hoy.
 * estado: 'sinDatos' | 'sinIngresos' | 'parcial' | 'ok'. En 'ok':
 *  rotulo ("Va a la tarjeta este mes" mientras haya deuda, "Te faltan este mes" si falta, "Te sobran en {mes}" sin deuda),
 *  numero (monto positivo a mostrar), subtitulo, free (m0.free, con signo), code/label/tone del mes,
 *  aLaTarjeta {total, minimo, extra, elegido} | null, chip {texto, tone, matiz, provisorio},
 *  provisorio + motivos[], estimados {n, texto}, aviso {tipo, key, mesNombre, amount, texto, accion},
 *  tira[4] {key, mes, free, compacto, code, tone, actual}.
 * @param {object} state
 * @param {Date} [today]
 */
export function hero(state, today = new Date()) {
  const hayIngresos = state.incomes.length > 0;
  const hayAlgo = hayIngresos || state.expenses.length || state.installments.length || state.debts.length;
  const t = dia(today);
  const start = monthKeyOf(t);
  if (!hayAlgo) return { estado: 'sinDatos', mes: start, mesNombre: mes(start), texto: 'Empecemos por lo que cobrás', accion: { texto: 'Empezar', ruta: '#/armar/1' } };
  if (!hayIngresos) return { estado: 'sinIngresos', mes: start, mesNombre: mes(start), texto: 'Para saber cuánto sobra necesito saber cuánto entra.', accion: { texto: 'Cargar mis ingresos', ruta: '#/armar/2' } };
  const { sim, eng, estados } = ctx(state, t);
  const m0 = sim.months[0];
  if (!state.expenses.length && !state.installments.length && !state.debts.length) {
    return { estado: 'parcial', mes: start, mesNombre: mes(start), numero: m0.income, texto: `Entran ${money(m0.income)}. Cargá tus gastos para saber cuánto sobra.`, accion: { texto: 'Cargar mis gastos', ruta: '#/armar/4' } };
  }
  const e0 = estados[0];
  const tieneDeuda = eng.debts.some((d) => d.balance > EPS);
  const minimo = tieneDeuda ? Math.min(minimoMes(sim, 0), m0.debtPayments) : 0;
  const elegido = eng.debts.some((d) => d.planned?.[start] !== undefined && d.planned?.[start] !== null);
  const aLaTarjeta = tieneDeuda ? { total: m0.debtPayments, minimo, extra: Math.max(0, m0.debtPayments - minimo), elegido } : null;

  let rotulo;
  let numero;
  let subtitulo;
  if (e0.code === 'falta' || e0.code === 'cubierto') {
    rotulo = 'Te faltan este mes';
    numero = m0.shortfall;
    subtitulo = e0.code === 'cubierto' ? 'Lo cubrís con tu plata guardada.' : 'Hay formas de cubrirlo.';
  } else if (tieneDeuda) {
    rotulo = 'Va a la tarjeta este mes';
    numero = m0.debtPayments;
    if (elegido) subtitulo = 'Es lo que elegiste pagar.';
    else if (aLaTarjeta.extra > EPS) subtitulo = `Es el mínimo (${money(minimo)}) y ${money(aLaTarjeta.extra)} de lo que sobra.`;
    else subtitulo = 'Es el mínimo de tu resumen.';
    const sinUsar = m0.free - aLaTarjeta.extra;
    if (sinUsar > EPS) subtitulo += ` Te quedan ${money(sinUsar)} sin usar.`;
  } else {
    rotulo = `Te sobran en ${mes(start)}`;
    numero = Math.max(0, m0.free);
    subtitulo = 'Queda guardada.';
  }

  const tira = sim.months.slice(0, 4).map((m, i) => ({ key: m.key, mes: monthName(m.key, { short: true }), free: m.free, compacto: compact(m.free), code: estados[i].code, tone: estados[i].tone, actual: i === 0 }));

  // aviso: el primer mes con falta dentro de los próximos 12; si no hay, el primero ajustado
  let aviso = null;
  const doce = sim.months.slice(0, 12);
  if (e0.code === 'falta') aviso = { tipo: 'mesActualFalta', key: start, mesNombre: mes(start), amount: e0.faltante, texto: 'Hay 3 formas de cubrirlo', accion: 'mes' };
  else {
    const i = doce.findIndex((m, k) => k > 0 && estados[k].code === 'falta');
    if (i > 0) aviso = { tipo: 'falta', key: doce[i].key, mesNombre: mes(doce[i].key), amount: estados[i].faltante, texto: `Ojo con ${mes(doce[i].key)}: faltan ${money(estados[i].faltante)}`, accion: 'mes' };
    else {
      const j = doce.findIndex((m, k) => k > 0 && (estados[k].code === 'justo' || estados[k].code === 'cubierto'));
      if (j > 0) aviso = { tipo: 'justo', key: doce[j].key, mesNombre: mes(doce[j].key), amount: null, texto: `Ojo con ${mes(doce[j].key)}: queda ajustado`, accion: 'mes' };
      else aviso = { tipo: 'bien', key: null, mesNombre: null, amount: null, texto: 'Con lo que cargaste, los próximos 12 meses alcanzan.', accion: null };
    }
  }

  // chip: con palabras; nunca verde puro si hay datos pendientes o un mes futuro con falta
  const provisorio = eng.flags.provisorio;
  const ojo = aviso.tipo === 'falta' ? mes(aviso.key) : null;
  let chip;
  if (e0.code === 'bien') {
    if (ojo) chip = { texto: `Alcanza, ojo con ${ojo}`, tone: 'warn', matiz: 'ojo', provisorio };
    else if (provisorio) chip = { texto: 'Provisorio', tone: 'warn', matiz: 'provisorio', provisorio, detalle: 'Alcanza, pero faltan datos' };
    else chip = { texto: 'Alcanza', tone: 'ok', matiz: null, provisorio: false };
  } else chip = { texto: e0.code === 'falta' ? 'Falta plata' : 'Ajustado', tone: e0.tone, matiz: provisorio ? 'provisorio' : null, provisorio };
  const n = eng.flags.estimados.n;
  return {
    estado: 'ok',
    mes: start,
    mesNombre: mes(start),
    free: m0.free,
    code: e0.code,
    label: e0.label,
    tone: e0.tone,
    pct: e0.pct,
    rotulo,
    numero,
    subtitulo,
    tieneDeuda,
    aLaTarjeta,
    chip,
    provisorio,
    motivos: eng.flags.motivos,
    estimados: { n, texto: n > 0 ? `Incluye ${plural(n, 'dato estimado', 'datos estimados')}` : null },
    aviso,
    tira,
  };
}

/**
 * "Plata de hoy": lo que hay en la cuenta (settings.cash) y si ya cobró este mes (settings.cobroEsteMes).
 * Si hay plata cargada y no dijo si ya cobró, trae `pregunta` ('¿Ya cobraste este mes?'): el motor no suma dos veces el sueldo.
 * @returns {{hay:boolean, rotulo:string, monto:number, cobroEsteMes:boolean|null, pregunta:string|null}}
 */
export function plataDeHoy(state) {
  const monto = Math.max(0, nn(state.settings?.cash));
  const c = state.settings?.cobroEsteMes;
  const cobro = c === true ? true : c === false ? false : null;
  return { hay: monto > 0, rotulo: 'Plata de hoy', monto, cobroEsteMes: cobro, pregunta: monto > 0 && cobro === null ? '¿Ya cobraste este mes?' : null };
}

/**
 * "Referencia" de cuánto gastar por día en gustos hasta fin de mes. Solo cuentan los gastos anotados como 'gustos'.
 * estado: 'sinGustos' | 'agotado' | 'ok'. Es una referencia, no un saldo.
 * @returns {{estado:string, referencia:true, gustos:number, gastado:number, restante:number, dias:number, porDia:number, hastaFecha:string, texto:string, calculo:string}}
 */
export function paraGastarHoy(state, today = new Date()) {
  const t = dia(today);
  const key = monthKeyOf(t);
  const gustos = state.expenses.filter((e) => e.kind === 'gustos' && isActive(e, key)).reduce((a, e) => a + amountFor(e, key), 0);
  const gastado = state.spent.filter((s) => s.cat === 'gustos' && String(s.date).slice(0, 7) === key).reduce((a, s) => a + nn(s.amount), 0);
  const ultimo = lastDayOfMonth(t);
  const dias = ultimo - t.getDate() + 1;
  const hastaFecha = longDate(new Date(t.getFullYear(), t.getMonth(), ultimo));
  const base = { referencia: true, gustos, gastado, restante: gustos - gastado, dias, hastaFecha };
  if (gustos <= 0) return { ...base, estado: 'sinGustos', porDia: 0, texto: 'Decime cuánto querés tener por mes para tus gustos y te digo cuánto por día.', calculo: '' };
  if (gustos - gastado <= 0) return { ...base, estado: 'agotado', porDia: 0, texto: 'Este mes ya usaste lo que separaste para tus gustos.', calculo: '' };
  const porDia = Math.floor((gustos - gastado) / dias / 100) * 100;
  const exacto = Math.floor((gustos - gastado) / dias);
  return {
    ...base,
    estado: 'ok',
    porDia,
    texto: `${money(porDia)} por día hasta fin de mes`,
    calculo: `Tu plata para gustos y sorpresas este mes: ${money(gustos)}. Ya gastaste ${money(gastado)}. Faltan ${plural(dias, 'día', 'días')} (hasta el ${hastaFecha}). ${money(gustos - gastado)} ÷ ${dias} = ${money(exacto)}. Redondeamos para abajo: ${money(porDia)}.`,
  };
}

/**
 * Cuándo se termina la tarjeta, con la honestidad que pide el producto.
 * estado: 'sinTarjeta' | 'sinDeuda' | 'fecha' | 'muyLejos' (más de 24 meses) | 'noTermina'.
 * Siempre trae `supuesto` (debajo de la fecha, en 16px o más) y `queSupone` (la hoja "Qué supone esta fecha").
 * Si hay datos pendientes o el resumen está viejo: provisoria = true y etiqueta 'Fecha provisoria'.
 * @param {{debtId?: string, strategy?: string}} [opts]
 */
export function salidaTarjeta(state, today = new Date(), { debtId, strategy } = {}) {
  const { sim, eng, start } = ctx(state, today, { strategy });
  const d = tarjetaDe(eng, debtId);
  if (!d) return { estado: 'sinTarjeta', hayTarjeta: false };
  const base = { hayTarjeta: true, id: d.id, nombre: d.name, supuesto: ASUME_SALIDA, queSupone: queSupone(eng), provisoria: eng.flags.provisorio, etiqueta: eng.flags.provisorio ? 'Fecha provisoria' : null, motivos: eng.flags.motivos };
  if (d.balance <= EPS) return { ...base, estado: 'sinDeuda', paidOn: null, texto: 'No tenés deuda en la tarjeta.' };
  const paidOn = sim.debts.find((x) => x.id === d.id)?.paidOn || null;
  if (!paidOn) return { ...base, estado: 'noTermina', paidOn: null, texto: 'Con este ritmo la tarjeta no se termina: conversemos qué cambiar.' };
  const meses = monthDiff(start, paidOn) + 1;
  if (monthDiff(start, paidOn) > 24) return { ...base, estado: 'muyLejos', paidOn, mesesQueFaltan: meses, texto: 'Con este ritmo la tarjeta tarda más de 2 años en terminarse.' };
  return { ...base, estado: 'fecha', paidOn, mesNombre: mesAnio(paidOn), mesesQueFaltan: meses, detalle: `faltan ${plural(meses, 'mes', 'meses')}`, texto: mesAnio(paidOn) };
}

function queSupone(eng) {
  const out = [
    'De acá en más cada compra nueva con las tarjetas se paga completa en su resumen. No incluye lo nuevo que compren vos y tu familia.',
    'Lo que sobra después de tus gastos va a la tarjeta.',
  ];
  const ag = eng.incomes.find((i) => i.kind === 'aguinaldo' && i.estimated);
  if (ag) out.push(`El aguinaldo es una estimación (${money(ag.amount)}, la mitad de tu sueldo).`);
  out.push('No incluye aumentos de sueldo ni suba de precios.');
  return out;
}

/**
 * Cuánto interés suma una deuda. Si el resumen cargado informa el interés en pesos, `mostrar` es ese.
 * @param {object} debt deuda del estado (balance, rate, statement?)
 * @returns {{balance:number, rate:number, tasaTexto:string, porMes:number, porDia:number, delResumen:number|null, mostrar:number, anualAprox:number}}
 */
export function interesTarjeta(debt) {
  const balance = nn(debt?.balance);
  const rate = nn(debt?.rate);
  const porMes = (balance * rate) / 100;
  const delResumen = nn(debt?.statement?.interes) > 0 ? nn(debt.statement.interes) : null;
  return { balance, rate, tasaTexto: pct(rate), porMes, porDia: porMes / 30, delResumen, mostrar: delResumen ?? porMes, anualAprox: (rate * 365) / 30 };
}

/** true si ya cerró un resumen más nuevo que el cargado (hay que cargarlo). Usa las fechas reales, no días fijos. */
export function resumenViejo(debt, today = new Date()) {
  return estadoResumen(debt, today).viejo;
}

/**
 * Próximo pago de una tarjeta: { fecha:'YYYY-MM-DD'|null, key:'YYYY-MM', tipo:'vigente'|'proximo'|'sinFecha' }.
 * 'vigente' = el resumen cargado todavía no venció; 'proximo' = el que viene (aún sin cargar).
 */
export function proximoPago(debt, today = new Date()) {
  const t = dia(today);
  const e = estadoResumen(debt, t);
  if (e.fase === 'vigente' && e.dueOn) return { fecha: e.dueOn, key: monthKeyOf(e.dueOn), tipo: 'vigente' };
  if (e.nextDueOn) return { fecha: e.nextDueOn, key: monthKeyOf(e.nextDueOn), tipo: 'proximo' };
  return { fecha: null, key: monthKeyOf(t), tipo: 'sinFecha' };
}

/**
 * Filas de "Lo que vence" (máx. 3, ordenadas por fecha) + el texto de vacío.
 * Cada fila: { id, tipo:'tarjeta'|'planilla'|'pendiente'|'medeben', titulo, fecha, fechaTexto, dias, detalle, monto, montoRotulo,
 *   estado, chip, boton, ruta, pagado, fechasResumen }. Para la tarjeta, estado: 'pendiente' | 'parcial' | 'pagado' | 'viejo'
 * (si el resumen ya cerró uno nuevo NO se muestra monto: "Falta cargar el resumen nuevo para saber cuánto pagar") |
 * 'esperandoCierre' | 'sinResumen'. La fila de "Lo que te deben" reemplaza a la menos urgente.
 * @returns {{filas: object[], todas: object[], vacio: string|null}}
 */
export function vencimientos(state, today = new Date()) {
  const { t, eng, start } = ctx(state, today);
  const hoy = toISO(t);
  const rows = [];
  for (const debt of state.debts.filter((d) => d.kind === 'card' || d.statement)) {
    if (nn(debt.balance) <= 0 && !debt.statement && !pagosDelMes(debt, start).total) continue;
    const e = estadoResumen(debt, t);
    const pag = debt.statement ? pagosDelResumen(debt) : pagosDelMes(debt, start); // lo pagado desde el cierre del resumen vigente
    const pagado = pag.total > 0 ? { total: pag.total, fecha: pag.ultimo?.date || null, texto: `Pagaste ${money(pag.total)} de la ${nombreCorto(debt)}${pag.ultimo ? ' el ' + fecha(pag.ultimo.date) : ''}` } : null;
    const row = { id: `tarjeta:${debt.id}`, tipo: 'tarjeta', debtId: debt.id, titulo: debt.name, fecha: null, fechaTexto: null, dias: null, detalle: '', monto: null, montoRotulo: null, estado: 'pendiente', chip: null, boton: null, ruta: '#/deudas/tarjeta', pagado, fechasResumen: null };
    if (!e.hayResumen) {
      Object.assign(row, { estado: 'sinResumen', detalle: 'Falta cargar el resumen para saber cuánto pagar', boton: { texto: 'Cargar resumen', accion: 'cargarResumen' }, chip: { texto: 'Completar', tone: 'info' } });
    } else {
      row.fechasResumen = `El último resumen que cargaste cerró el ${fecha(e.closedOn)}${e.dueOn ? ' y vence el ' + fecha(e.dueOn) : ''}.`;
      if (e.fase === 'viejo') {
        Object.assign(row, { estado: 'viejo', fecha: e.nextDueOn, fechaTexto: e.nextDueOn ? fecha(e.nextDueOn) : null, dias: e.nextDueOn ? daysBetween(hoy, e.nextDueOn) : null, detalle: 'Falta cargar el resumen nuevo para saber cuánto pagar', boton: { texto: 'Cargar resumen nuevo', accion: 'cargarResumen' } });
      } else if (e.fase === 'vencido') {
        Object.assign(row, { estado: 'esperandoCierre', fecha: e.nextCloseOn, fechaTexto: fecha(e.nextCloseOn), dias: e.diasParaCierre, detalle: `Venció el ${fecha(e.dueOn)} · el próximo resumen cierra el ${fecha(e.nextCloseOn)}` });
      } else {
        const min = nn(debt.statement.min) || nn(debt.minPayment);
        const dias = e.diasParaVencer;
        const cuando = dias === 0 ? 'Vence hoy' : dias === 1 ? 'Vence mañana' : `En ${dias} días`;
        const rot = debt.statement.label ? `mínimo del resumen de ${debt.statement.label}` : 'mínimo de tu resumen';
        Object.assign(row, { fecha: e.dueOn, fechaTexto: fecha(e.dueOn), dias, detalle: `${cuando} · ${rot}`, monto: min, montoRotulo: rot, urgente: dias <= 2 });
        if (pag.total >= min && min > 0) Object.assign(row, { estado: 'pagado', detalle: pagado.texto, monto: null });
        else if (pag.total > 0) Object.assign(row, { estado: 'parcial', detalle: `${pagado.texto} · falta ${money(min - pag.total)} del mínimo`, monto: min - pag.total });
        else row.boton = { texto: 'Ya pagué', accion: 'yaPague' };
      }
    }
    rows.push(row);
  }
  const planilla = eng.installments.filter((x) => x.payroll && installmentActive(x, start)).reduce((a, x) => a + x.amount, 0);
  if (planilla > 0) rows.push({ id: 'planilla', tipo: 'planilla', titulo: 'Préstamos por planilla', fecha: null, fechaTexto: null, dias: null, detalle: 'Se descuentan solos del sueldo', monto: planilla, estado: 'automatico', chip: null, boton: null, ruta: '#/deudas' });
  for (const p of eng.pending.filter((x) => x.target === 'afip')) {
    rows.push({ id: `pendiente:${p.id}`, tipo: 'pendiente', titulo: p.label || 'Plan de pagos de AFIP', fecha: null, fechaTexto: null, dias: null, detalle: 'Falta cargar monto y cuotas', monto: null, estado: 'pendiente', chip: { texto: 'Completar', tone: 'info' }, boton: { texto: 'Completar', accion: 'completar', target: p.target }, ruta: '#/armar/5' });
  }
  rows.sort((a, b) => (a.fecha && b.fecha ? (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0) : a.fecha ? -1 : b.fecha ? 1 : 0));
  const deben = state.receivables.filter((r) => nn(r.balance) > 0);
  let filas = rows;
  if (deben.length) {
    const mayor = [...deben].sort((a, b) => nn(b.balance) - nn(a.balance))[0];
    const total = deben.reduce((a, r) => a + nn(r.balance), 0);
    const fila = { id: 'medeben', tipo: 'medeben', titulo: 'Lo que te deben', fecha: null, fechaTexto: null, dias: null, detalle: deben.length === 1 ? `${mayor.person || mayor.name} ${money(total)}` : `${plural(deben.length, 'persona', 'personas')} · ${money(total)}`, monto: total, estado: 'info', chip: null, boton: { texto: 'Anotar que me pagaron', accion: 'anotarCobro' }, ruta: '#/deudas/medeben' };
    filas = rows.length >= 3 ? [...rows.slice(0, 2), fila] : [...rows, fila];
  } else filas = rows.slice(0, 3);
  const cercano = rows.some((r) => (r.tipo === 'tarjeta' && (r.estado === 'viejo' || r.estado === 'sinResumen')) || (r.fecha && r.dias !== null && r.dias >= 0 && r.dias <= 15));
  const seguro = !eng.flags.provisorio && eng.flags.estimados.n === 0 && eng.pending.length === 0;
  const vacio = cercano ? null : `No vence nada en los próximos 15 días.${seguro ? ' Podés respirar.' : ''}`;
  return { filas, todas: rows, vacio };
}

/**
 * Una sola tarjeta de acción para Hoy según el calendario, o null.
 * tipo: 'cargarResumen' | 'pagarTarjeta' | 'anotarCobro'. Trae titulo, texto, boton { texto, accion }.
 * @returns {{tipo:string, titulo:string, texto:string, boton:{texto:string, accion:string}, urgente?:boolean, debtId?:string}|null}
 */
export function ahoraToca(state, today = new Date()) {
  const t = dia(today);
  for (const d of state.debts.filter((x) => x.kind === 'card')) {
    const e = estadoResumen(d, t);
    if (!e.hayResumen) {
      if (nn(d.balance) > 0) return { tipo: 'cargarResumen', debtId: d.id, titulo: 'Cargá tu resumen', texto: 'Cargá el último resumen de la tarjeta y te digo cuánto conviene pagar.', boton: { texto: 'Cargar resumen', accion: 'cargarResumen' } };
      continue;
    }
    const corto = nombreCorto(d);
    if (e.fase === 'viejo') {
      const cuando = e.nextDueOn ? ` el ${fecha(e.nextDueOn)}` : '';
      return { tipo: 'cargarResumen', debtId: d.id, urgente: true, titulo: 'Cerró tu resumen', texto: `Cerró tu resumen. Cargalo y te digo cuánto conviene pagar${cuando}.`, boton: { texto: 'Cargar resumen nuevo', accion: 'cargarResumen' } };
    }
    if (e.fase === 'vigente') {
      const min = nn(d.statement.min) || nn(d.minPayment);
      const pagado = pagosDelResumen(d).total;
      if (min > 0 && pagado < min) {
        const dias = e.diasParaVencer;
        const texto = dias === 0 ? `Hoy vence la ${corto}: ¿ya pagaste ${money(min)}?` : dias === 1 ? `Mañana vence la ${corto}: ¿ya pagaste ${money(min)}?` : `La ${corto} vence el ${fecha(e.dueOn)}: pagá al menos ${money(min)}.`;
        return { tipo: 'pagarTarjeta', debtId: d.id, urgente: dias <= 1, titulo: dias <= 1 ? 'Vence pronto' : 'Lo que viene', texto, boton: { texto: 'Ya pagué', accion: 'yaPague' } };
      }
    }
  }
  if (state.receivables.some((r) => nn(r.balance) > 0)) {
    return { tipo: 'anotarCobro', titulo: 'Lo que te deben', texto: '¿Te devolvieron algo? Anotalo.', boton: { texto: 'Anotar que me pagaron', accion: 'anotarCobro' } };
  }
  return null;
}

// ============================================================================
// DECIDIR: gustos, mes difícil, ¿me alcanza?
// ============================================================================

function conGustos(state, monto) {
  let hecho = false;
  return { ...state, expenses: state.expenses.map((e) => (!hecho && e.kind === 'gustos' ? ((hecho = true), { ...e, amount: monto }) : e)) };
}

/**
 * Cuándo salís de la tarjeta según cuánto gastes por mes en gustos (4 corridas del motor).
 * @param {{montos?: number[]}} [opts] por defecto 50.000, 100.000, 150.000 y 200.000 (más el actual)
 * `salida` es cuándo termina la tarjeta (null si no hay deuda en la tarjeta o no se termina); `ahorroVsActual` es negativo si cuesta más que lo actual.
 * @returns {{hayGustos:boolean, hayTarjeta:boolean, actual:number, gustosId?:string, escenarios:{monto:number, esActual:boolean, salida:string|null, salidaTexto:string, interesTotal:number, ahorroVsActual:number}[], notaPie:string, rango:{min:number,max:number}|null}}
 */
export function gustosEscenarios(state, today = new Date(), { montos = [50000, 100000, 150000, 200000] } = {}) {
  const g = state.expenses.find((e) => e.kind === 'gustos');
  if (!g) return { hayGustos: false, hayTarjeta: false, actual: 0, escenarios: [], notaPie: '', rango: null };
  const actual = nn(g.amount);
  const lista_ = [...new Set([...montos, actual])].sort((a, b) => a - b);
  const start = monthKeyOf(dia(today));
  const base = run(state, { today });
  const card = tarjetaDe(base.eng);
  const hayTarjeta = !!card && card.balance > EPS;
  const esc = lista_.map((monto) => {
    const sim = monto === actual ? base : run(conGustos(state, monto), { today });
    const d = hayTarjeta ? sim.debts.find((x) => x.id === card.id) : null;
    const salida = d ? d.paidOn : null;
    return { monto, esActual: monto === actual, salida, salidaTexto: !hayTarjeta ? 'Sin deuda en la tarjeta' : salida ? salidaTexto(salida, start) : 'No se termina', interesTotal: sim.totalInterest, ahorroVsActual: base.totalInterest - sim.totalInterest };
  });
  const dif = [];
  const meses = [];
  for (let i = 1; i < esc.length; i++) {
    if (esc[i].salida && esc[i - 1].salida) meses.push(monthDiff(esc[i - 1].salida, esc[i].salida));
    dif.push(esc[i].interesTotal - esc[i - 1].interesTotal);
  }
  const paso = lista_.length > 1 ? lista_[1] - lista_[0] : 50000;
  let notaPie = '';
  let rango = null;
  if (dif.length) {
    rango = { min: Math.round(Math.min(...dif)), max: Math.round(Math.max(...dif)) };
    const prom = meses.length ? meses.reduce((a, b) => a + b, 0) / meses.length : 0;
    const cuando = prom >= 0.75 ? `salís de la tarjeta alrededor de ${plural(Math.round(prom), 'mes', 'meses')} antes` : 'la fecha de salida casi no cambia';
    notaPie = `Cada ${money(paso)} por mes que gastes menos en gustos, ${cuando} y ahorrás entre ${money(rango.min)} y ${money(rango.max)} de interés. Es tu decisión.`;
  }
  return { hayGustos: true, hayTarjeta, actual, gustosId: g.id, escenarios: esc, notaPie, rango };
}

function feriadosDelMes(key) {
  const out = [];
  for (const f of [...FERIADOS].filter((x) => x.startsWith(key + '-'))) {
    const d = toDate(f);
    if (d.getDay() !== 0 && d.getDay() !== 6) out.push(d.getDate());
  }
  return out.sort((a, b) => a - b);
}

/**
 * Eventos de un mes del plan (para el renglón de cada mes): aguinaldo, fin de préstamos y cuotas, último pago de la tarjeta,
 * primer mes sin tarjeta, movilidad con otros días ("Feria de enero" / "Feria de invierno"), lo que termina de devolverte alguien.
 * @param {number} i índice del mes (0 = el mes actual)
 * @returns {{tipo:string, texto:string, monto?:number}[]}
 */
export function eventosMes(state, i, today = new Date()) {
  const { sim, eng } = ctx(state, today);
  const m = sim.months[i];
  if (!m) return [];
  const key = m.key;
  const out = [];
  for (const x of eng.incomes.filter((x) => x.kind === 'movilidad' && x.fullMonthDays)) {
    const trabajado = x.movilidadVencida ? addMonths(key, -1) : key;
    const n = Number(trabajado.slice(5));
    if (!isActive(x, key)) {
      out.push({ tipo: 'movilidad', sinCobro: true, texto: n === 1 ? 'Feria de enero: este mes no cobrás movilidad' : 'Este mes no cobrás movilidad' });
      continue;
    }
    const dias = daysFor(x, key);
    if (dias !== nn(x.fullMonthDays)) {
      const fer = dias === workdays(trabajado) ? feriadosDelMes(trabajado) : [];
      if (n === 7 && dias < nn(x.fullMonthDays)) out.push({ tipo: 'movilidad', texto: `Feria de invierno: movilidad de ${plural(dias, 'día', 'días')}` });
      else out.push({ tipo: 'movilidad', texto: `Movilidad: ${plural(dias, 'día', 'días')}${fer.length ? ` (${fer.length === 1 ? 'feriado' : 'feriados'} del ${lista(fer.map(String))})` : ''}` });
    }
  }
  for (const x of eng.incomes.filter((x) => x.kind === 'aguinaldo' && isActive(x, key) && amountFor(x, key) > 0)) {
    out.push({ tipo: 'aguinaldo', texto: `Aguinaldo${x.estimated ? ' estimado' : ''}: +${money(amountFor(x, key))}`, monto: amountFor(x, key) });
  }
  for (const x of m.freedInstallments) {
    out.push({ tipo: 'cuotaTermina', texto: x.payroll ? `Se terminó el préstamo de ${money(x.amount)}: +${money(x.amount)} por mes` : `Se terminó la cuota de ${x.name || 'una compra'}: +${money(x.amount)} por mes`, monto: x.amount });
  }
  for (const d of sim.debts) {
    const real = eng.debts.find((x) => x.id === d.id);
    if (!real) continue;
    if (d.paidOn === key) out.push({ tipo: 'tarjetaFin', texto: 'Último pago de la tarjeta' });
    else if (d.paidOn && addMonths(d.paidOn, 1) === key) out.push({ tipo: 'sinTarjeta', texto: `Primer mes sin tarjeta: +${money(real.minPayment)}`, monto: real.minPayment });
  }
  for (const r of sim.receivables.filter((x) => x.paidOn === key)) out.push({ tipo: 'cobroTermina', texto: `${r.person || 'Una persona'} termina de devolverte lo que te debe` });
  return out;
}

/**
 * Las tres formas de cubrir un mes con falta (3 corridas del motor): 'tarjeta' (que lo cubra la tarjeta: el plan de hoy),
 * 'reserva' (apartar plata de un mes anterior, idealmente el del aguinaldo) y 'sinGustos' (sacar los gustos de ese mes).
 * Cada opción trae `cambios`, que se aplica con store.aplicarCambios(draft, cambios).
 * @param {string} key 'YYYY-MM' del mes difícil
 * @returns {null|{key, mesNombre, hayProblema:boolean, faltante:number, causa:string, intro:string, opciones:object[], pie:string}}
 */
export function opcionesMesDificil(state, key, today = new Date()) {
  const { sim, eng, start, estados } = ctx(state, today);
  const idx = monthDiff(start, key);
  const m = sim.months[idx];
  if (!m || idx < 0) return null;
  const est = estados[idx];
  const nombre = mes(key);
  if (m.free >= 0) return { key, mesNombre: nombre, hayProblema: false, faltante: 0, causa: '', intro: '', opciones: [], pie: PIE_DECISION };
  const faltante = Math.round(est.code === 'falta' ? est.faltante : m.shortfall);
  const conFalta = sim.months.slice(0, 12).filter((_, k) => estados[k].code === 'falta').map((x) => x.key);
  const salidaBase = tarjetaSalida(sim);
  const ev = eventosMes(state, idx, today);
  const sinMov = ev.find((e) => e.tipo === 'movilidad' && e.sinCobro);
  let causa = 'Ese mes entra menos de lo que sale.';
  if (sinMov) {
    let tipica = 0;
    for (let k = idx - 1; k >= 0 && !tipica; k--) tipica = eng.incomes.filter((x) => x.kind === 'movilidad' && isActive(x, sim.months[k].key)).reduce((a, x) => a + amountFor(x, sim.months[k].key), 0);
    causa = `No cobrás movilidad${tipica > 0 ? ` ($0 en vez de unos ${money(Math.round(tipica / 1000) * 1000)})` : ''} y los gastos siguen.`;
  }
  const intro = conFalta.length === 1 ? `Es el único mes con faltante de los próximos 12. ${causa}` : `${cap(nombre)} es un mes difícil. ${causa}`;

  // 1) que lo cubra la tarjeta (el plan de hoy)
  const opcTarjeta = { id: 'tarjeta', titulo: 'Que lo cubra la tarjeta', etiqueta: 'Es el plan de hoy', disponible: true, faltanteDespues: faltante, deudaEnMes: m.debtTotal, salida: salidaBase, costoInteres: 0, texto: `Es lo más barato. La deuda sube a ${money(m.debtTotal)} en ${nombre}${salidaBase ? ` y igual salís en ${mesAnio(salidaBase)}` : ''}.`, cambios: {} };

  // 2) apartar de un mes anterior (idealmente el del aguinaldo)
  const previos = sim.months.slice(0, idx).map((x, k) => ({ x, k })).filter(({ x }) => x.free >= faltante);
  const aguin = previos.filter(({ x }) => eng.incomes.some((y) => y.kind === 'aguinaldo' && isActive(y, x.key) && amountFor(y, x.key) > 0));
  const elegido = aguin.length ? aguin[aguin.length - 1] : previos.sort((a, b) => b.x.free - a.x.free)[0];
  let opcReserva;
  if (!elegido) opcReserva = { id: 'reserva', titulo: `Apartar ${money(faltante)} de un mes anterior`, etiqueta: null, disponible: false, texto: 'Ningún mes anterior tiene tanta plata de sobra.', cambios: {} };
  else {
    const mesRes = elegido.x.key;
    const delAguinaldo = aguin.length > 0;
    const extra = [
      { id: '_reserva', name: `Reserva para ${nombre}`, amount: faltante, from: mesRes, to: mesRes, kind: 'otro' },
      { id: '_reserva2', name: `Reserva guardada para ${nombre}`, amount: -faltante, from: key, to: key, kind: 'otro' },
    ];
    const alt = run(state, { extra, today });
    const interes = alt.totalInterest - sim.totalInterest;
    const salidaAlt = tarjetaSalida(alt);
    const despues = alt.months[idx].shortfall;
    opcReserva = {
      id: 'reserva',
      titulo: delAguinaldo ? `Apartar ${money(faltante)} del aguinaldo` : `Apartar ${money(faltante)} de ${mes(mesRes)}`,
      etiqueta: null,
      disponible: true,
      mesReserva: mesRes,
      faltanteDespues: Math.round(despues),
      salida: salidaAlt,
      costoInteres: Math.round(interes),
      texto: `${cap(nombre)} queda cubierto sin usar la tarjeta. ${interes > 1 ? `Te cuesta ${money(interes)} más de interés en total` : 'No te suma interés'} y ${salidaAlt === salidaBase ? (salidaAlt ? `salís igual en ${mesAnio(salidaAlt)}` : 'la tarjeta sigue sin terminarse') : `salís en ${salidaAlt ? mesAnio(salidaAlt) : 'una fecha que no se termina'}`}.`,
      cambios: {
        agregar: {
          expenses: [{ name: `Reserva para ${nombre}`, owner: '', amount: faltante, from: mesRes, to: mesRes, kind: 'otro' }],
          incomes: [{ name: `Reserva guardada para ${nombre}`, owner: '', amount: faltante, from: key, to: key, kind: 'otro' }],
        },
      },
    };
  }

  // 3) sacar los gustos de ese mes
  const g = state.expenses.find((e) => e.kind === 'gustos');
  let opcGustos;
  if (!g || amountFor(g, key) <= 0) opcGustos = { id: 'sinGustos', titulo: `Sacar los gustos de ${nombre}`, etiqueta: null, disponible: false, texto: `No tenés gustos cargados para ${nombre}.`, cambios: {} };
  else {
    const st2 = { ...state, expenses: state.expenses.map((e) => (e.id === g.id ? { ...e, overrides: { ...(e.overrides || {}), [key]: 0 } } : e)) };
    const alt = run(st2, { today });
    const e2 = estadosDe(alt)[idx];
    const despues = Math.round(e2.code === 'falta' ? e2.faltante : alt.months[idx].shortfall);
    opcGustos = {
      id: 'sinGustos',
      titulo: `Sacar los gustos de ${nombre}`,
      etiqueta: null,
      disponible: true,
      faltanteDespues: despues,
      salida: tarjetaSalida(alt),
      costoInteres: Math.round(alt.totalInterest - sim.totalInterest),
      texto: `${despues > 0 ? `Con $0 de gustos, la falta baja a ${money(despues)}.` : `Con $0 de gustos, ${nombre} queda cubierto.`}${sim.totalInterest - alt.totalInterest >= 1000 ? ` Además ahorrás ${money(sim.totalInterest - alt.totalInterest)} de interés en total.` : ''}`,
      cambios: { overrides: [{ lista: 'expenses', id: g.id, mes: key, valor: 0 }] },
    };
  }
  return { key, mesNombre: nombre, hayProblema: true, faltante, causa, intro, opciones: [opcTarjeta, opcReserva, opcGustos], pie: PIE_DECISION };
}

function tarjetaSalida(sim) {
  const c = tarjetaDe(sim.eng);
  if (!c) return sim.debtFreeMonth;
  return sim.debts.find((x) => x.id === c.id)?.paidOn || null;
}

// ----- ¿Me alcanza? -----

function evaluar(state, gasto, t) {
  const { sim: base, estados: be, start } = ctx(state, t);
  const g0 = normalizarGasto(gasto, start);
  const g = g0.desde < start ? normalizarGasto({ ...gasto, desde: start }, start) : g0;
  const extra = gastoAExtras(g, start);
  const alt = run(state, { extra, today: t });
  const ae = estadosDe(alt);
  const N = Math.min(12, alt.months.length);
  let costoTotal = 0;
  let primerFalta = null;
  let peor = null;
  let degrada = false;
  const afectados = [];
  for (let i = 0; i < N; i++) {
    const a = alt.months[i];
    const b = base.months[i];
    for (const x of extra) if (isActive(x, a.key)) costoTotal += amountFor(x, a.key);
    if (!primerFalta && ae[i].code === 'falta' && a.free < b.free - EPS) primerFalta = { key: a.key, mesNombre: mes(a.key), faltante: Math.round(ae[i].faltante), free: a.free };
    const caida = b.free - a.free;
    if (caida > EPS && (!peor || caida > peor.caida)) peor = { key: a.key, mesNombre: mes(a.key), free: a.free, freeAntes: b.free, caida, code: ae[i].code };
    if (RANGO[ae[i].code] > RANGO[be[i].code]) {
      degrada = true;
      afectados.push({ key: a.key, antes: be[i].code, despues: ae[i].code });
    }
  }
  const salidaAntes = tarjetaSalida(base);
  const salidaDespues = tarjetaSalida(alt);
  const hayCard = !!tarjetaDe(base.eng);
  const baseTermina = hayCard ? !!salidaAntes : !!base.debtFreeMonth;
  const altTermina = hayCard ? !!salidaDespues : !!alt.debtFreeMonth;
  const delay = salidaAntes && salidaDespues ? monthDiff(salidaAntes, salidaDespues) : salidaAntes === salidaDespues ? 0 : null;
  const extraInterest = alt.totalInterest - base.totalInterest;
  const nuncaTermina = baseTermina && !altTermina;
  let codigo = 'verde';
  if (primerFalta || nuncaTermina) codigo = 'terracota';
  else if ((delay !== null && delay > 0) || (costoTotal > 0 && extraInterest > costoTotal * 0.01) || degrada) codigo = 'ambar';
  // sin costo de interés: no deja ningún mes con falta, no atrasa la tarjeta y el interés extra es menor al 1% del gasto
  const sinInteres = codigo !== 'terracota' && !(delay !== null && delay > 0) && extraInterest <= Math.max(0.5, costoTotal * 0.01);
  return { g, extra, base, alt, be, ae, start, codigo, costoTotal, extraInterest, primerFalta, peor, degrada, afectados, salidaAntes, salidaDespues, delay, nuncaTermina, hayCard, sinInteres };
}

function descSinMes(g) {
  if (g.modo === 'cuotas') return `${g.nombre} en ${g.cuotas} cuotas de ${money(g.montoCuota)}`;
  if (g.modo === 'mensual') return `${g.nombre} de ${money(g.montoCuota)} por mes`;
  return `${g.nombre} de ${money(g.total)}`;
}

function descGasto(g) {
  if (g.modo === 'cuotas') return `${g.nombre} en ${g.cuotas} cuotas de ${money(g.montoCuota)} desde ${mes(g.desde)}`;
  if (g.modo === 'mensual') return `${g.nombre} de ${money(g.montoCuota)} por mes desde ${mes(g.desde)}`;
  return `${g.nombre} de ${money(g.total)} en ${mes(g.desde)}`;
}

/**
 * Veredicto de un gasto hipotético (2 corridas del motor; NO usa compare().newNegativeMonths como criterio único).
 * gasto: { nombre, monto, modo:'una'|'cuotas'|'mensual', desde:'YYYY-MM', cuotas?, montoCuota?, hasta? }
 *  ('una': monto = precio total; 'cuotas': monto = precio total o montoCuota = cada cuota; 'mensual': monto = por mes)
 * codigo: 'terracota' (un mes queda con falta y empeora, o la tarjeta deja de terminarse) | 'ambar' (se atrasa la salida, el
 * interés extra supera el 1% del costo o algún mes pasa a más ajustado) | 'verde'.
 * Si todavía no escribió cuánto cuesta, `vacio: true` (codigo 'verde', texto 'Poné cuánto cuesta y te digo si te alcanza.'): mostrá eso y no un veredicto.
 * Trae: titulo, texto, filas[{k,v}], mesPeor, primerMesFalta, extraInterest, teSale, salidaAntes/Despues(+Texto), delayMonths,
 * mesesAfectados, antesDespues[4], siLoNecesitas {key, texto} (si no es verde), tope (topeSinCosto del mes elegido, si no es verde), pie.
 * @param {{conTope?: boolean}} [opts]
 */
export function veredicto(state, gasto, today = new Date(), { conTope = true } = {}) {
  const t = dia(today);
  const ev = evaluar(state, gasto, t);
  const { g, base, alt, ae, be, start, codigo, costoTotal, extraInterest, primerFalta, peor, salidaAntes, salidaDespues, delay, nuncaTermina } = ev;
  const desc = descGasto(g);
  const rate = tasaMayor(base.eng);
  const precio = g.total ?? costoTotal;
  const teSale = precio + Math.max(0, extraInterest);
  const filas = [];
  if (peor) filas.push({ k: `${cap(peor.mesNombre)} queda en`, v: money(peor.free) });
  if (ev.hayCard && salidaAntes) {
    filas.push({ k: 'Salís de la tarjeta', v: salidaDespues ? `${mesAnio(salidaDespues)}${delay === 0 ? ' (igual)' : delay > 0 ? ` (antes: ${mesAnio(salidaAntes)})` : ''}` : 'No se termina' });
  }
  if (extraInterest > 1) filas.push({ k: 'Interés extra', v: money(extraInterest) });

  let titulo;
  let texto;
  if (codigo === 'terracota') {
    titulo = 'No conviene ahora';
    if (nuncaTermina && !primerFalta) texto = `No conviene ahora. Con ${desc}, la tarjeta deja de terminarse.`;
    else {
      const idxF = monthDiff(start, primerFalta.key);
      const yaVenia = be[idxF]?.code === 'falta';
      const mismoMes = primerFalta.key === g.desde;
      if (yaVenia) texto = `No conviene ahora. ${cap(primerFalta.mesNombre)} ya venía con un faltante de ${money(be[idxF].faltante)} y con ${descSinMes(g)} serían ${money(primerFalta.faltante)}.`;
      else texto = `No conviene ahora. Con ${desc}, ${mismoMes ? '' : `en ${primerFalta.mesNombre} `}te faltarían ${money(primerFalta.faltante)}.`;
    }
  } else if (codigo === 'ambar') {
    titulo = 'Se puede, pero tiene costo';
    if (extraInterest > 1) {
      texto = `Se puede, pero tiene costo. ${cap(desc)} te sale ${money(teSale)}${rate > 0 ? ` porque hoy la tarjeta cobra ${pct(rate)} por mes` : ' con el interés'}.`;
    } else if (delay > 0) texto = `Se puede, pero tiene costo. ${cap(desc)} atrasa ${plural(delay, 'mes', 'meses')} salir de la tarjeta.`;
    else texto = `Se puede, pero tiene costo. ${cap(desc)} deja algún mes más ajustado.`;
  } else {
    titulo = 'Entra sin problemas';
    texto = 'Entra sin problemas.';
  }

  const d0 = monthDiff(start, g.desde);
  const antesDespues = alt.months.slice(Math.max(0, d0), Math.max(0, d0) + 4).map((a, k) => {
    const i = Math.max(0, d0) + k;
    return { key: a.key, mes: monthName(a.key, { short: true }), antes: base.months[i].free, despues: a.free, codeAntes: be[i].code, codeDespues: ae[i].code };
  });

  let siLoNecesitas = null;
  let tope = null;
  if (codigo !== 'verde') {
    // el mejor momento de los próximos 12 meses: el primero que no suma interés; si no hay, el de menor interés sin falta de plata
    let mejor = null;
    for (let k = Math.max(0, monthDiff(start, g.desde)); k < 12; k++) {
      const key = addMonths(start, k);
      const e2 = key === g.desde ? ev : evaluar(state, { ...gasto, desde: key }, t);
      if (e2.codigo === 'terracota') continue;
      if (e2.sinInteres) {
        mejor = { key, interes: 0, sinInteres: true, codigo: e2.codigo };
        break;
      }
      if (!mejor || e2.extraInterest < mejor.interes - 0.5) mejor = { key, interes: e2.extraInterest, sinInteres: false, codigo: e2.codigo };
    }
    if (!mejor) siLoNecesitas = { key: null, sinCosto: false, texto: 'Si igual lo necesitás, probá con un monto menor.' };
    else if (mejor.key === g.desde) siLoNecesitas = { key: mejor.key, sinCosto: false, texto: `Si igual lo necesitás, ${mes(mejor.key)} es el mejor momento que encuentro.` };
    else {
      const cola = mejor.sinInteres ? (mejor.codigo === 'verde' ? ': ahí no te cuesta nada' : ': no te suma interés, aunque el mes queda ajustado') : '';
      siLoNecesitas = { key: mejor.key, sinCosto: mejor.sinInteres, texto: `Si igual lo necesitás, lo mejor es ${mes(mejor.key)}${cola}.` };
    }
    if (conTope) tope = topeSinCosto(state, g.desde, { modo: g.modo, cuotas: g.cuotas, today: t });
  }
  const vacio = !(costoTotal > 0); // todavía no escribió cuánto cuesta: no hay nada que decidir
  if (vacio) {
    titulo = 'Poné cuánto cuesta';
    texto = 'Poné cuánto cuesta y te digo si te alcanza.';
    filas.length = 0;
    siLoNecesitas = null;
    tope = null;
  }
  return {
    vacio,
    codigo,
    color: codigo,
    titulo,
    texto,
    desc,
    gasto: g,
    costoTotal,
    precioTotal: precio,
    extraInterest,
    teSale,
    mesPeor: peor,
    primerMesFalta: primerFalta,
    salidaAntes,
    salidaDespues,
    salidaAntesTexto: salidaAntes ? mesAnio(salidaAntes) : null,
    salidaDespuesTexto: salidaDespues ? mesAnio(salidaDespues) : null,
    delayMonths: delay,
    mesesAfectados: ev.afectados,
    filas,
    antesDespues,
    siLoNecesitas,
    tope,
    pie: PIE_DECISION,
  };
}

/**
 * Mapa de los próximos 12 meses: el mismo veredicto desplazando `desde` (12 corridas).
 * Cada mes: { key, mes, codigo, glifo:'circulo'|'cuadrado'|'triangulo', etiqueta:'Sin costo'|'Con costo'|'No conviene', costoExtra, faltante }.
 * mejorMomento = el primer mes que no suma interés (verde, o ámbar con interés extra menor al 1% del gasto y sin atrasar la tarjeta);
 * cada mes trae `sinInteres`. leyenda = LEYENDA_MAPA (fija, en palabras).
 */
export function mapaMeses(state, gasto, today = new Date()) {
  const t = dia(today);
  const start = monthKeyOf(t);
  const meses = [];
  for (let i = 0; i < 12; i++) {
    const key = addMonths(start, i);
    const e = evaluar(state, { ...gasto, desde: key }, t);
    const L = LEYENDA_MAPA.find((x) => x.codigo === e.codigo);
    meses.push({ key, mes: monthName(key, { short: true }), codigo: e.codigo, glifo: L.glifo, etiqueta: L.texto, costoExtra: Math.max(0, e.extraInterest), faltante: e.primerFalta ? e.primerFalta.faltante : 0, sinInteres: e.sinInteres });
  }
  const vacio = !(nn(normalizarGasto(gasto, start).total ?? normalizarGasto(gasto, start).montoCuota) > 0);
  const mejor = vacio ? null : meses.find((m) => m.sinInteres) || null;
  return {
    vacio,
    meses,
    mejorMomento: mejor ? { key: mejor.key, mesNombre: mesAnio(mejor.key) } : null,
    textoSinMejor: mejor || vacio ? null : 'En los próximos 12 meses no encuentro un mes sin costo. Probá con un monto menor.',
    leyenda: LEYENDA_MAPA,
  };
}

/**
 * La pregunta inversa: "¿Cuánto puedo gastar en {mes} sin que me cueste?" (búsqueda sobre el veredicto).
 * sinCosto = el mayor TOTAL (múltiplo de $1.000) con veredicto verde: sin interés extra material y sin empeorar ningún mes
 *   (mientras tengas deuda en la tarjeta suele ser $0, y se dice así). sinFaltar = el mayor total que no deja ningún mes con falta.
 * Para modo 'mensual' los topes son por mes. porMes* = tope / cuotas (modo 'cuotas').
 * @param {string} key 'YYYY-MM'
 * @param {{modo?: 'una'|'cuotas'|'mensual', cuotas?: number, today?: Date}} [opts]
 */
export function topeSinCosto(state, key, { modo = 'una', cuotas = 1, today = new Date() } = {}) {
  const t = dia(today);
  const { sim } = ctx(state, t);
  const n = Math.max(1, Math.round(cuotas));
  const mesesSim = sim.months.slice(0, 12);
  const maxInflow = Math.max(0, ...mesesSim.map((m) => nn(m.income) + nn(m.collections)));
  const sumInflow = mesesSim.reduce((a, m) => a + nn(m.income) + nn(m.collections), 0);
  const techo = Math.ceil((modo === 'mensual' ? maxInflow : sumInflow) / 1000) * 1000;
  const ok = (pred) => (monto) => {
    const e = evaluar(state, { nombre: 'x', monto, modo, desde: key, cuotas: n }, t);
    return pred(e);
  };
  const buscar = (pred) => {
    const f = ok(pred);
    if (!f(1000)) return 0;
    let lo = 1000;
    let hi = Math.max(techo, 2000);
    if (f(hi)) return hi;
    while (hi - lo > 1000) {
      const mid = Math.floor((lo + hi) / 2000) * 1000;
      if (mid <= lo) break;
      if (f(mid)) lo = mid;
      else hi = mid;
    }
    return lo;
  };
  const sinCosto = buscar((e) => e.codigo === 'verde');
  const sinFaltar = buscar((e) => e.codigo !== 'terracota');
  const hayDeuda = sim.eng.debts.some((d) => d.balance > EPS);
  const porMes = modo === 'cuotas' ? (x) => Math.floor(x / n / 1000) * 1000 : (x) => x;
  const nombre = mes(key);
  const unidad = modo === 'mensual' ? ' por mes' : '';
  let texto;
  if (sinCosto > 0) texto = `Hasta ${money(sinCosto)}${unidad} en ${nombre} sin que te cueste nada.`;
  else if (hayDeuda) texto = `En ${nombre} no hay plata que no cueste: mientras tengas la tarjeta, cada peso que gastás de más suma interés.`;
  else texto = `En ${nombre} no hay margen para gastar de más.`;
  const textoSinFaltar = sinFaltar > sinCosto ? `Hasta ${money(sinFaltar)}${unidad} en ${nombre} no te falta plata, pero cuesta interés.` : null;
  return { key, mesNombre: nombre, modo, cuotas: n, sinCosto, sinFaltar, porMesSinCosto: porMes(sinCosto), porMesSinFaltar: porMes(sinFaltar), texto, textoSinFaltar };
}

// ============================================================================
// TARJETA
// ============================================================================

/**
 * "Cuánto pagar el {fecha}": solo el mínimo, lo que sobra y otro monto.
 * Opciones: { id:'minimo'|'sobra'|'otro', titulo, monto, paidOn, salidaTexto, totalInterest, ahorro, recomendada, aviso?, faltaPlata? }.
 * `maximoQueAlcanza` = lo más que se puede pagar este mes sin que falte plata (el monto de "Lo que sobra"); un 'otro' mayor trae `aviso`.
 * elegida: 'minimo' (settings.strategy 'none'), 'otro' (hay pago elegido para ese mes) o 'sobra'.
 * `otro` en opts: monto a evaluar (se muestra como opción 'otro' aunque no esté guardado).
 * @param {{otro?: number, debtId?: string}} [opts]
 */
export function escenariosPago(state, today = new Date(), { otro, debtId } = {}) {
  const t = dia(today);
  const { sim, eng, start } = ctx(state, t);
  const d = tarjetaDe(eng, debtId);
  const dState = tarjetaEstado(state, debtId);
  if (!d || !dState) return { estado: 'sinTarjeta', opciones: [] };
  const pp = proximoPago(dState, t);
  const idx = Math.max(0, monthDiff(start, pp.key));
  const sinPlan = (s) => ({ ...s, debts: s.debts.map((x) => (x.id === d.id ? { ...x, planned: Object.fromEntries(Object.entries(x.planned || {}).filter(([k]) => k !== pp.key)) } : x)) });
  const limpio = sinPlan(state);
  const estrategia = state.settings.strategy === 'none' ? 'avalanche' : state.settings.strategy;
  const sMin = run(limpio, { strategy: 'none', today: t });
  const sSob = run(limpio, { strategy: estrategia, today: t });
  const minimoReal = minimoMes(sMin, idx);
  const montoMin = sMin.months[idx].debtPayments;
  const montoSob = sSob.months[idx].debtPayments;
  const salida = (s) => s.debts.find((x) => x.id === d.id)?.paidOn || null;
  const fila = (id, titulo, monto, s, extra = {}) => ({ id, titulo, monto, paidOn: salida(s), salidaTexto: salidaTexto(salida(s), start), totalInterest: s.totalInterest, ahorro: sMin.totalInterest - s.totalInterest, recomendada: false, ...extra });
  const opciones = [fila('minimo', 'Solo el mínimo', montoMin, sMin), fila('sobra', 'Lo que sobra', montoSob, sSob, { recomendada: montoSob > montoMin + EPS })];
  const elegido = dState.planned?.[pp.key];
  const montoOtro = otro !== undefined && otro !== null ? Math.max(0, nn(otro)) : elegido !== undefined && elegido !== null ? nn(elegido) : null;
  if (montoOtro !== null) {
    const sOtro = run({ ...limpio, debts: limpio.debts.map((x) => (x.id === d.id ? { ...x, planned: { ...(x.planned || {}), [pp.key]: montoOtro } } : x)) }, { strategy: estrategia, today: t });
    const f = fila('otro', 'Otro monto', montoOtro, sOtro);
    const faltaPlata = Math.max(0, nn(sOtro.months[idx]?.shortfall));
    f.faltaPlata = faltaPlata;
    if (faltaPlata > EPS) f.aviso = `Es más de lo que te sobra este mes: te faltarían ${money(faltaPlata)}, que se suman a la deuda de la tarjeta.`;
    else if (montoOtro < minimoReal - EPS) f.aviso = 'Es menos que el mínimo del resumen: puede traer cargos del banco.';
    opciones.push(f);
  }
  const e = estadoResumen(dState, t);
  return {
    estado: 'ok',
    debtId: d.id,
    nombre: d.name,
    fecha: pp.fecha,
    key: pp.key,
    titulo: pp.fecha ? `Cuánto pagar el ${fecha(pp.fecha)}` : 'Cuánto pagar este mes',
    opciones,
    elegida: elegido !== undefined && elegido !== null ? 'otro' : state.settings.strategy === 'none' ? 'minimo' : 'sobra',
    minimoDelResumen: minimoReal,
    maximoQueAlcanza: montoSob,
    resumenViejo: e.viejo,
    aviso: e.viejo ? 'Ya cerró un resumen nuevo: cargalo para ver el monto exacto.' : null,
    pie: 'Pagar el mínimo está bien si este mes no da para más. Lo importante es saber cuánto cuesta.',
    pieDecision: PIE_DECISION,
  };
}

/**
 * Lo que se precarga al cargar un resumen nuevo: las fechas del mes pasado más un mes y la tasa que ya estaba.
 * @returns {{hayAnterior:boolean, closedOn:string|null, dueOn:string|null, rate:number|null, nota:string|null}}
 */
export function precargaResumen(debt) {
  const st = debt?.statement;
  if (!st) return { hayAnterior: false, closedOn: null, dueOn: null, rate: nn(debt?.rate) > 0 ? nn(debt.rate) : null, nota: null };
  return {
    hayAnterior: true,
    closedOn: st.nextCloseOn || toISO(addMonthsDate(st.closedOn, 1)),
    dueOn: st.nextDueOn || (st.dueOn ? toISO(addMonthsDate(st.dueOn, 1)) : null),
    rate: nn(debt.rate) > 0 ? nn(debt.rate) : null,
    nota: 'Las fechas y el interés son los del resumen anterior: corregilos con tu resumen nuevo.',
  };
}

/**
 * Revisa con amabilidad lo que se escribió del resumen antes de guardarlo (pantalla "Revisá"). Los campos pueden ser texto o número.
 * input: { total, min, rate, closedOn, dueOn, nextCloseOn?, nextDueOn?, newCharges?, interes? }.
 * Cada aviso: { campo, nivel: 'corregir'|'confirmar', texto, sugerido? }. `corregir` impide guardar; `confirmar` pide un "Sí, está bien".
 * Reglas: tasa mayor a 15 se toma como anual y se convierte ("79% parece la tasa anual. ¿Usamos 6,49% por mes?"); mínimo fuera del 5% al 30%
 * del total se confirma; más de 9 dígitos, "Mirá bien los ceros, por favor."; las fechas tienen que tener sentido.
 * @param {{debt?: object, today?: Date}} [opts] con `debt` también compara contra el resumen que ya estaba cargado
 * @returns {{ok:boolean, confirmar:boolean, avisos:object[], valores:{total:number|null, min:number|null, rate:number|null, closedOn:string|null, dueOn:string|null, nextCloseOn?:string, nextDueOn?:string, newCharges?:number, interes?:number}, filas:{rotulo:string, valor:string}[]}}
 */
export function validarResumen(input = {}, { debt, today = new Date() } = {}) {
  const t = dia(today);
  const hoy = toISO(t);
  const avisos = [];
  const av = (campo, nivel, texto, sugerido) => avisos.push(sugerido === undefined ? { campo, nivel, texto } : { campo, nivel, texto, sugerido });
  const iso = (x) => {
    const d = x instanceof Date ? toISO(x) : typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.trim()) ? x.trim() : null;
    return d && toISO(d) === d ? d : null; // descarta fechas que no existen (31 de febrero)
  };
  const total = parseMoney(input.total);
  const min = parseMoney(input.min);
  const tasa = parseRate(input.rate);
  const closedOn = iso(input.closedOn);
  const dueOn = iso(input.dueOn);

  if (total === null || total <= 0) av('total', 'corregir', 'Poné el total a pagar que figura en tu resumen.');
  else if (!revisarMonto(total).ok) av('total', 'corregir', revisarMonto(total).aviso);
  if (min === null || min < 0) av('min', 'corregir', 'Poné el pago mínimo que figura en tu resumen.');
  else if (!revisarMonto(min).ok) av('min', 'corregir', revisarMonto(min).aviso);
  else if (total && total > 0 && min > total) av('min', 'corregir', 'El pago mínimo no puede ser más que el total.');
  else if (total && total > 0) {
    const p = (min / total) * 100;
    if (p < 5 || p > 30) av('min', 'confirmar', `El mínimo es el ${Math.round(p)}% del total y lo normal es entre 5% y 30%. ¿Está bien?`);
  }
  if (!tasa) av('rate', 'corregir', 'Poné el interés por mes de tu resumen (por ejemplo 6,5).');
  else if (tasa.convertida) av('rate', 'confirmar', tasa.aviso, tasa.valor);
  else if (tasa.valor === 0) av('rate', 'confirmar', 'Pusiste 0% de interés. ¿Está bien?');
  if (!closedOn) av('closedOn', 'corregir', 'Poné la fecha en que cerró tu resumen.');
  else if (closedOn > hoy) av('closedOn', 'corregir', 'Esa fecha de cierre todavía no llegó.');
  if (!dueOn) av('dueOn', 'corregir', 'Poné la fecha de vencimiento de tu resumen.');
  else if (closedOn && dueOn <= closedOn) av('dueOn', 'corregir', 'El vencimiento tiene que ser después del cierre.');
  else if (closedOn && daysBetween(closedOn, dueOn) > 40) av('dueOn', 'confirmar', 'El vencimiento queda muy lejos del cierre. ¿Está bien?');
  const ant = debt?.statement;
  if (ant?.closedOn && closedOn && closedOn <= ant.closedOn) av('closedOn', 'confirmar', `Ese resumen cerró el mismo día o antes que el que ya cargaste (${fecha(ant.closedOn)}). ¿Está bien?`);
  if (ant && nn(ant.total) > 0 && total > 0 && (total > nn(ant.total) * 3 || total < nn(ant.total) / 3)) av('total', 'confirmar', `Es muy distinto del resumen anterior (${money(ant.total)}). ¿Está bien?`);

  const valores = { total, min, rate: tasa ? tasa.valor : null, closedOn, dueOn };
  for (const k of ['nextCloseOn', 'nextDueOn']) if (iso(input[k])) valores[k] = iso(input[k]);
  for (const [k, v] of [['newCharges', input.newCharges], ['interes', input.interes]]) {
    const n = parseMoney(v);
    if (n !== null && n >= 0 && v !== '') valores[k] = n;
  }
  const filas = [
    { rotulo: 'Total a pagar', valor: total !== null && total > 0 ? money(total) : '—' },
    { rotulo: 'Pago mínimo', valor: min !== null && min >= 0 ? money(min) : '—' },
    { rotulo: 'Interés por mes', valor: tasa ? pct(tasa.valor) : '—' },
    { rotulo: 'Cerró el', valor: closedOn ? fecha(closedOn) : '—' },
    { rotulo: 'Vence el', valor: dueOn ? fecha(dueOn) : '—' },
  ];
  return { ok: !avisos.some((a) => a.nivel === 'corregir'), confirmar: avisos.some((a) => a.nivel === 'confirmar'), avisos, valores, filas };
}

/**
 * Datos para el gráfico "Cómo baja": deuda total mes a mes con tu plan y con "solo el mínimo".
 * @returns {{plan:{key:string, deuda:number}[], soloMinimo:{key:string, deuda:number}[], planTermina:string|null, minimoTermina:string|null}}
 */
export function curvaDeuda(state, today = new Date(), { meses } = {}) {
  const { sim, start } = ctx(state, today);
  const min = run(state, { strategy: 'none', today });
  const fin = (s) => s.debtFreeMonth;
  const lim = meses || Math.min(36, Math.max(6, Math.max(fin(sim) ? monthDiff(start, fin(sim)) : 12, fin(min) ? monthDiff(start, fin(min)) : 12) + 2));
  const cut = (s) => s.months.slice(0, lim).map((m) => ({ key: m.key, deuda: m.debtTotal }));
  return { plan: cut(sim), soloMinimo: cut(min), planTermina: fin(sim), minimoTermina: fin(min) };
}

/**
 * Fechas del ciclo de la tarjeta (las reales del último resumen cargado) y el consejo.
 * Si no hay resumen o ya está viejo, `fechas` es null y `pide` dice qué cargar.
 * @returns {{hayResumen:boolean, viejo:boolean, fechas:null|{cerroEl:string, venceEl:string|null, proximoCierre:string, proximoVencimiento:string|null}, texto:string|null, consejo:string|null, nota:string, pide:string|null}}
 */
export function cicloTarjeta(state, today = new Date(), { debtId } = {}) {
  const t = dia(today);
  const d = tarjetaEstado(state, debtId);
  const e = d ? estadoResumen(d, t) : { hayResumen: false };
  const nota = 'Fijate la fecha de cierre en tu resumen.';
  if (!e.hayResumen) return { hayResumen: false, viejo: false, fechas: null, texto: null, consejo: null, nota, pide: 'Cargá el último resumen para ver las fechas de cierre y vencimiento.' };
  const { sim } = ctx(state, t);
  const min = nn(d.statement.min) || nn(d.minPayment);
  const cercaDelMinimo = state.settings.strategy === 'none' || (min > 0 && sim.months[0].debtPayments <= min * 1.5);
  const consejo = cercaDelMinimo ? 'Como pagás cerca del mínimo, lo que comprás con la tarjeta se suma a la deuda y paga interés.' : null;
  if (e.viejo) return { hayResumen: true, viejo: true, fechas: null, texto: null, consejo, nota, pide: 'Cargá el resumen nuevo para ver las fechas de este mes.' };
  const fechas = { cerroEl: e.closedOn, venceEl: e.dueOn, proximoCierre: e.nextCloseOn, proximoVencimiento: e.nextDueOn };
  const texto = `El próximo resumen cierra el ${fecha(e.nextCloseOn)}${e.nextDueOn ? ' y vence el ' + fecha(e.nextDueOn) : ''}.`;
  return { hayResumen: true, viejo: false, fechas, texto, consejo, nota, pide: null };
}

/**
 * "De quién es cada parte" de la tarjeta (informativo): reparto cargado vs total.
 * @returns {{total:number, repartido:number, diferencia:number, cuadra:boolean, partes:{personId:string, nombre:string, monto:number}[], resto:number, texto:string}}
 */
export function titularesTarjeta(state, { debtId } = {}) {
  const d = tarjetaEstado(state, debtId);
  if (!d) return { total: 0, repartido: 0, diferencia: 0, cuadra: true, partes: [], resto: 0, texto: '' };
  const total = nn(d.balance);
  const partes = (d.holders || []).map((h) => ({ personId: h.personId, nombre: state.people.find((p) => p.id === h.personId)?.name || 'Otra persona', monto: nn(h.amount) }));
  const repartido = partes.reduce((a, p) => a + p.monto, 0);
  const dif = total - repartido;
  const cuadra = Math.abs(dif) < 1;
  return { total, repartido, diferencia: dif, cuadra, partes, resto: Math.max(0, dif), texto: cuadra ? 'Cuadra' : dif > 0 ? `Faltan ${money(dif)}` : `Te pasaste por ${money(-dif)}` };
}

// ============================================================================
// DEUDAS
// ============================================================================

/**
 * Cuándo se termina cada deuda y qué plata queda libre desde cuándo (alimenta la línea de tiempo y la "escalera").
 * items: { id, tipo:'prestamo'|'cuota'|'tarjeta'|'pendiente', nombre, monto, fin, desde, quedan, cuotaActual, cuotasTotal, noTermina, aCompletar, target }.
 * escalera: { desde, monto, texto } (suma lo que termina el mismo mes). proxima: la primera con `desde` futuro.
 * faltaPagarPlanilla: lo que falta pagar por planilla en total (sin AFIP).
 */
export function liberaciones(state, today = new Date()) {
  const { sim, eng, start } = ctx(state, today);
  const items = [];
  for (const i of eng.installments) {
    const fin = installmentEnd(i);
    if (fin < start) continue;
    const quedan = i.first > start ? i.remaining : monthDiff(start, fin) + 1;
    const total = nn(i.total) > 0 ? nn(i.total) : null;
    items.push({ id: i.id, tipo: i.payroll ? 'prestamo' : 'cuota', nombre: i.name, monto: i.amount, fin, desde: addMonths(fin, 1), quedan, cuotaActual: total ? Math.max(1, total - quedan + 1) : null, cuotasTotal: total, noTermina: false, aCompletar: false, planilla: !!i.payroll });
  }
  for (const d of eng.debts) {
    if (d.balance <= EPS) continue;
    const paidOn = sim.debts.find((x) => x.id === d.id)?.paidOn || null;
    items.push({ id: d.id, tipo: 'tarjeta', nombre: d.name, monto: nn(d.minPayment), fin: paidOn, desde: paidOn ? addMonths(paidOn, 1) : null, quedan: paidOn ? monthDiff(start, paidOn) + 1 : null, cuotaActual: null, cuotasTotal: null, noTermina: !paidOn, aCompletar: false, planilla: false, saldo: nn((state.debts || []).find((x) => x.id === d.id)?.balance ?? d.balance) });
  }
  for (const p of eng.pending.filter((x) => x.target === 'afip' || x.target === 'cuota')) {
    items.push({ id: p.id, tipo: 'pendiente', nombre: p.label, monto: 0, fin: null, desde: null, quedan: null, cuotaActual: null, cuotasTotal: null, noTermina: false, aCompletar: true, target: p.target, planilla: false });
  }
  items.sort((a, b) => (a.desde && b.desde ? (a.desde < b.desde ? -1 : a.desde > b.desde ? 1 : 0) : a.desde ? -1 : b.desde ? 1 : 0));
  const grupos = new Map();
  for (const it of items.filter((x) => x.desde && x.monto > 0)) {
    const g = grupos.get(it.desde) || { desde: it.desde, monto: 0, partes: [] };
    g.monto += it.monto;
    g.partes.push(it);
    grupos.set(it.desde, g);
  }
  const escalera = [...grupos.values()].map((g) => ({ desde: g.desde, monto: g.monto, texto: `Desde ${mesAnio(g.desde)}: +${money(g.monto)}${g.partes.some((x) => x.tipo === 'tarjeta') ? ' (ya no pagás la tarjeta)' : ''}` }));
  const proxima = items.find((x) => x.desde && x.desde > start) || null;
  const faltaPagarPlanilla = items.filter((x) => x.planilla).reduce((a, x) => a + x.monto * x.quedan, 0);
  return { items, escalera, proxima, faltaPagarPlanilla };
}

/**
 * Cuánto de lo que cobrás va a deudas: el hoy, el detalle y la FECHA en que baja (la fecha manda; el "de cada $100" va chico).
 * @returns {{porCien:number|null, deudas:number, tarjetaMinimo:number, prestamos:number, ingresos:number, textoHoy:string, detalle:string, alivio:null|{key:string, mesNombre:string, porCien:number}, textoAlivio:string|null}}
 */
export function deudaSobreIngreso(state, today = new Date()) {
  const { sim } = ctx(state, today);
  const m0 = sim.months[0];
  const tarjetaMinimo = minimoMes(sim, 0);
  const prestamos = m0.installments;
  const deudas = tarjetaMinimo + prestamos;
  const ingresos = m0.income;
  if (ingresos <= 0) return { porCien: null, deudas, tarjetaMinimo, prestamos, ingresos, textoHoy: '', detalle: '', alivio: null, textoAlivio: null };
  const pctAt = (i) => ((sim.months[i].installments + minimoMes(sim, i)) / Math.max(1, sim.months[i].income)) * 100;
  const p0 = pctAt(0);
  let alivio = null;
  for (let i = 1; p0 >= 1 && i < Math.min(48, sim.months.length); i++) {
    if (sim.months[i].income > 0 && pctAt(i) <= p0 * 0.5) {
      alivio = { key: sim.months[i].key, mesNombre: mesDe(sim.months[i].key), porCien: Math.round(pctAt(i)) };
      break;
    }
  }
  return {
    porCien: Math.round(p0),
    deudas,
    tarjetaMinimo,
    prestamos,
    ingresos,
    textoHoy: `$${Math.round(p0)} de cada $100 que cobrás van a deudas`,
    detalle: `${money(deudas)} por mes: ${money(tarjetaMinimo)} de la tarjeta (mínimo) y ${money(prestamos)} de préstamos y cuotas.`,
    alivio,
    textoAlivio: alivio ? `En ${alivio.mesNombre} baja a $${alivio.porCien} de cada $100` : null,
  };
}

// ============================================================================
// ME DEBEN
// ============================================================================

/**
 * Resumen de "Me deben": total, lo que entra por mes y una fila por persona.
 * estado: 'acordado' ("Devuelve lo acordado"), 'parte' ("Pagó una parte"), 'conversar' ("Para conversar"), 'nada' ("No te debe nada cargado").
 * @returns {{total:number, entraPorMes:number, personas:object[], sinCuota:boolean, texto:string}}
 */
export function meDeben(state, today = new Date()) {
  const key = monthKeyOf(dia(today));
  const por = new Map();
  for (const r of state.receivables) {
    const id = r.personId || `n:${r.person}`;
    const g = por.get(id) || { id, personId: r.personId || '', nombre: r.person || state.people.find((p) => p.id === r.personId)?.name || 'Alguien', balance: 0, monthlyPayment: 0, pagadoEsteMes: 0, receivableIds: [] };
    g.balance += nn(r.balance);
    g.monthlyPayment += nn(r.monthlyPayment);
    g.pagadoEsteMes += pagosDelMes(r, key).total;
    g.receivableIds.push(r.id);
    por.set(id, g);
  }
  const personas = [...por.values()].map((g) => {
    let estado;
    if (g.balance <= 0) estado = 'nada';
    else if (g.monthlyPayment > 0) estado = g.pagadoEsteMes > 0 && g.pagadoEsteMes < g.monthlyPayment ? 'parte' : 'acordado';
    else estado = g.pagadoEsteMes > 0 ? 'parte' : 'conversar';
    const estadoTexto = { acordado: 'Devuelve lo acordado', parte: 'Pagó una parte', conversar: 'Para conversar', nada: 'No te debe nada cargado' }[estado];
    const tono = { acordado: 'ok', parte: 'warn', conversar: 'brand', nada: 'info' }[estado];
    const detalle = estado === 'conversar' ? 'Sin cuota acordada' : g.monthlyPayment > 0 ? `Cuota de ${money(g.monthlyPayment)} por mes` : '';
    return { ...g, estado, estadoTexto, tono, detalle };
  });
  for (const p of state.people.filter((x) => x.role !== 'yo' && !por.has(x.id) && !state.receivables.some((r) => r.person === x.name))) {
    personas.push({ id: p.id, personId: p.id, nombre: p.name, balance: 0, monthlyPayment: 0, pagadoEsteMes: 0, receivableIds: [], estado: 'nada', estadoTexto: 'No te debe nada cargado', tono: 'info', detalle: '' });
  }
  const total = personas.reduce((a, p) => a + p.balance, 0);
  const entraPorMes = personas.reduce((a, p) => a + (p.balance > 0 ? Math.min(p.monthlyPayment, p.balance) : 0), 0);
  return { total, entraPorMes, personas, sinCuota: personas.some((p) => p.estado === 'conversar'), texto: entraPorMes > 0 ? `Lo que entra por mes: ${money(entraPorMes)}` : 'Hoy no está entrando nada por mes.' };
}

/**
 * Qué pasa si alguien te devuelve distintas cuotas por mes (una corrida por cuota).
 * Cada escenario: { monto, terminaEn, terminaTexto, meses, interesTotal, salidaTarjeta, mesesAntes, ahorro, advertencia }.
 * `ahorro` es contra el plan actual (la cuota que hoy figura). Advertencia si hay interés y la cuota no lo cubre.
 * @param {{montos?: number[]}} [opts] por defecto 30.000, 50.000 y 100.000 (los que no superan lo que debe) más la cuota actual
 */
export function escenariosCobro(state, receivableId, today = new Date(), { montos = [30000, 50000, 100000] } = {}) {
  const r = state.receivables.find((x) => x.id === receivableId);
  if (!r) return null;
  const t = dia(today);
  const start = monthKeyOf(t);
  const base = run(state, { today: t });
  const salBase = tarjetaSalida(base);
  const lista_ = [...new Set([...montos.filter((m) => m <= nn(r.balance) || nn(r.balance) === 0), nn(r.monthlyPayment)].filter((m) => m > 0))].sort((a, b) => a - b);
  const rate = nn(r.rate);
  const interesMes = (nn(r.balance) * rate) / 100;
  const escenarios = lista_.map((monto) => {
    const sim = run({ ...state, receivables: state.receivables.map((x) => (x.id === receivableId ? { ...x, monthlyPayment: monto } : x)) }, { today: t });
    const terminaEn = sim.receivables.find((x) => x.id === receivableId)?.paidOn || null;
    const sal = tarjetaSalida(sim);
    return {
      monto,
      esActual: monto === nn(r.monthlyPayment),
      terminaEn,
      terminaTexto: terminaEn ? mesAnio(terminaEn) : 'No termina',
      meses: terminaEn ? monthDiff(start, terminaEn) + 1 : null,
      interesTotal: sim.totalInterest,
      salidaTarjeta: sal,
      mesesAntes: sal && salBase ? monthDiff(sal, salBase) : 0,
      ahorro: base.totalInterest - sim.totalInterest,
      advertencia: rate > 0 && monto <= interesMes ? `Con esta cuota su deuda no baja: el interés es ${money(interesMes)} por mes.` : null,
    };
  });
  return {
    receivableId,
    personId: r.personId,
    persona: r.person,
    nombre: r.name,
    balance: nn(r.balance),
    rate,
    interesPorMes: interesMes,
    cuotaActual: nn(r.monthlyPayment),
    salidaTarjetaActual: salBase,
    advertenciaActual: rate > 0 && nn(r.monthlyPayment) > 0 && nn(r.monthlyPayment) <= interesMes ? `Con esta cuota su deuda no baja: el interés es ${money(interesMes)} por mes.` : null,
    escenarios,
  };
}

/**
 * Interés que se le podría sumar a lo que te debe una persona (el de la tarjeta). Texto neutro, sin juicios.
 * @returns {{rate:number, porMes:number, texto:string}|null}
 */
export function interesDeCobro(state, receivableId) {
  const r = state.receivables.find((x) => x.id === receivableId);
  const rate = Math.max(0, ...state.debts.filter((d) => d.kind === 'card').map((d) => nn(d.rate)));
  if (!r || !(rate > 0)) return null;
  const porMes = (nn(r.balance) * rate) / 100;
  return { rate, porMes, texto: `Si querés cobrarle interés por lo que consumió con la tarjeta, se suman ${money(porMes)} por mes a lo que te debe.` };
}

/**
 * Mensaje para mandar por WhatsApp (editable antes de enviar). Hechos + pregunta abierta, sin adjetivos sobre la persona.
 * @param {{monto?: number}} [opts] cuota propuesta (por defecto la acordada, si hay)
 */
export function mensajeWhatsApp(state, receivableId, today = new Date(), { monto } = {}) {
  const r = state.receivables.find((x) => x.id === receivableId);
  if (!r) return '';
  const cuota = nn(monto ?? r.monthlyPayment);
  let fin = '';
  if (cuota > 0) {
    const sim = run({ ...state, receivables: state.receivables.map((x) => (x.id === receivableId ? { ...x, monthlyPayment: cuota } : x)) }, { today });
    const p = sim.receivables.find((x) => x.id === receivableId)?.paidOn;
    if (p) fin = ` Si me pasás ${money(cuota)} por mes terminás en ${mesDe(p)}.`;
    else fin = ` Si me pasás ${money(cuota)} por mes, vamos viendo.`;
  }
  return `Hola ${r.person || ''}, te paso la cuenta de la tarjeta según el último resumen (aproximado): tu parte hoy son ${money(r.balance)}.${fin} ¿Te sirve? Lo vemos y lo anotamos.`.replace('Hola ,', 'Hola,');
}

// ============================================================================
// MESES (detalle de un mes)
// ============================================================================

/**
 * Desglose del detalle de un mes: Entra, Sale y "Qué hacemos con lo que sobra". entraTotal - saleTotal = free del motor.
 * Cada línea: { id, lista, nombre, detalle, monto, estimado, items? }.
 * @param {number} i índice del mes (0 = el mes actual)
 */
export function lineasMes(state, i, today = new Date()) {
  const { sim, eng, estados } = ctx(state, today);
  const m = sim.months[i];
  if (!m) return null;
  const key = m.key;
  const entra = [];
  for (const x of eng.incomes.filter((y) => isActive(y, key))) {
    const monto = amountFor(x, key);
    if (!(monto > 0) && !(x.kind === 'movilidad')) continue;
    let detalle = '';
    if (nn(x.perDay) > 0) detalle = `${plural(daysFor(x, key), 'día', 'días')} x ${money(x.perDay)}`;
    else if (x.payrollAdd) detalle = 'Antes de los descuentos de planilla';
    else if (x.kind === 'aguinaldo' && x.estimated) detalle = 'Es una estimación (la mitad de tu sueldo)';
    entra.push({ id: x.id, lista: 'incomes', nombre: x.name, detalle, monto, estimado: !!x.estimated });
  }
  if (m.collections > 0) entra.push({ id: 'cobros', lista: 'receivables', nombre: 'Lo que te devuelven', detalle: '', monto: m.collections, estimado: false });
  const sale = [];
  for (const x of eng.expenses.filter((y) => isActive(y, key))) {
    const monto = amountFor(x, key);
    if (monto !== 0) sale.push({ id: x.id, lista: 'expenses', nombre: x.name, detalle: '', monto, estimado: !!x.estimated, kind: x.kind });
  }
  const activas = eng.installments.filter((y) => installmentActive(y, key));
  const planilla = activas.filter((y) => y.payroll);
  if (planilla.length) sale.push({ id: 'planilla', lista: 'installments', nombre: 'Préstamos por planilla', detalle: '', monto: planilla.reduce((a, y) => a + y.amount, 0), estimado: false, items: planilla.map((y) => ({ id: y.id, nombre: y.name, monto: y.amount })) });
  for (const y of activas.filter((z) => !z.payroll)) sale.push({ id: y.id, lista: 'installments', nombre: y.name, detalle: '', monto: y.amount, estimado: false });
  let minTotal = 0;
  let extraTarjeta = 0;
  for (const d of eng.debts) {
    const prev = i === 0 ? nn(d.balance) : sim.months[i - 1].debts[d.id];
    if (!(prev > 0.005)) continue;
    const bal = prev * (1 + nn(d.rate) / 100);
    const elegido = d.planned?.[key];
    const hayElegido = elegido !== undefined && elegido !== null && elegido !== '';
    const min = hayElegido ? Math.min(nn(elegido), bal) : Math.min(nn(d.minPayment), bal);
    minTotal += min;
    extraTarjeta += Math.max(0, nn(m.payments[d.id]) - min);
    const nombre = d.kind === 'card' && eng.debts.filter((x) => x.kind === 'card').length === 1 ? 'Tarjeta' : d.name;
    sale.push({ id: d.id, lista: 'debts', nombre: hayElegido ? `${nombre} (lo que elegiste pagar)` : `${nombre} (mínimo)`, detalle: '', monto: min, estimado: false });
  }
  const entraTotal = m.income + m.collections;
  const saleTotal = sale.reduce((a, x) => a + x.monto, 0);
  let queSobra;
  if (m.free < -EPS) {
    const e = estados[i];
    queSobra = { tipo: 'falta', vaALaTarjeta: 0, deudaQueda: m.debtTotal, guardado: 0, texto: e.code === 'cubierto' ? `Faltan ${money(m.shortfall)}: los cubrís con tu plata guardada.` : `Faltan ${money(m.shortfall)}: ${e.fromCash > EPS ? `${money(e.fromCash)} salen de tu plata guardada y el resto` : 'se'} suma a la deuda de la tarjeta.` };
  } else if (extraTarjeta > EPS || m.debtTotal > EPS) {
    const guardado = Math.max(0, m.free - extraTarjeta);
    queSobra = { tipo: 'tarjeta', vaALaTarjeta: extraTarjeta, deudaQueda: m.debtTotal, guardado, texto: `Va a la tarjeta: pagás ${money(m.debtPayments)} en total y la deuda baja a ${money(m.debtTotal)}.${guardado > EPS ? ` Te quedan ${money(guardado)} sin usar.` : ''}` };
  } else queSobra = { tipo: 'guardado', vaALaTarjeta: 0, deudaQueda: 0, guardado: m.free, texto: `Queda guardado: ${money(m.free)}.` };
  const avisos = [];
  const ag = eng.incomes.find((y) => y.kind === 'aguinaldo' && y.estimated && isActive(y, key));
  if (ag) avisos.push('El aguinaldo es una estimación (la mitad de tu sueldo). Confirmalo con tu recibo.');
  return { key, mesNombre: mes(key), free: m.free, code: estados[i].code, label: estados[i].label, tone: estados[i].tone, entra, entraTotal, sale, saleTotal, queSobra, avisos, eventos: eventosMes(state, i, today), pie: PIE_DECISION };
}

// ============================================================================
// DATOS QUE FALTAN, PRÓXIMOS PASOS, HITOS
// ============================================================================

const PASOS = [
  { n: 1, id: 'familia', titulo: 'Vos y tu familia' },
  { n: 2, id: 'sueldo', titulo: 'Lo que cobrás' },
  { n: 3, id: 'movilidad', titulo: 'Movilidad' },
  { n: 4, id: 'gastos', titulo: 'Gastos de la casa y gustos' },
  { n: 5, id: 'planilla', titulo: 'Planilla y cuotas' },
  { n: 6, id: 'tarjeta', titulo: 'Tu tarjeta' },
  { n: 7, id: 'medeben', titulo: 'Lo que te deben' },
];

/**
 * Los 7 pasos del armado (hecho o pendiente) y lo que falta. Alimenta el medidor "4 de 7" y los chips azules de Más.
 * Un paso cuenta como hecho si tiene datos o si la persona lo respondió (settings.pasos), y no tiene datos pendientes.
 * @returns {{hechos:number, total:number, completo:boolean, pasos:{n:number,id:string,titulo:string,estado:'hecho'|'pendiente',ruta:string}[], faltan:{id:string,texto:string,paso:number}[], siguiente:object|null}}
 */
export function completitud(state, today = new Date()) {
  const eng = engDe(state, dia(today));
  const pasos = state.settings.pasos || {};
  const pend = (t) => eng.pending.some((p) => p.target === t);
  const hayPlanilla = state.installments.some((x) => x.payroll);
  const hecho = {
    familia: !!state.settings.name || state.people.length > 0 || !!pasos.familia,
    sueldo: state.incomes.some((x) => x.kind === 'sueldo' && nn(x.amount) > 0),
    movilidad: state.incomes.some((x) => x.kind === 'movilidad' && nn(x.fullMonthAmount ?? x.perDay) > 0) || !!pasos.movilidad,
    gastos: state.expenses.some((x) => x.kind === 'casa' && nn(x.amount) > 0) || !!pasos.gastos,
    planilla: (state.installments.length > 0 || !!pasos.planilla) && !pend('afip') && !pend('planilla') && !(hayPlanilla && state.settings.salaryNetOfPayroll === null),
    tarjeta: state.debts.some((x) => x.statement && nn(x.balance) > 0) || !!pasos.tarjeta,
    medeben: state.receivables.length > 0 || !!pasos.medeben,
  };
  const lista_ = PASOS.map((p) => ({ ...p, estado: hecho[p.id] ? 'hecho' : 'pendiente', ruta: `#/armar/${p.n}` }));
  const faltan = [];
  if (pend('afip')) faltan.push({ id: 'afip', texto: 'Plan de AFIP', paso: 5 });
  if (state.incomes.some((x) => x.kind === 'aguinaldo' && x.estimated) || pend('aguinaldo')) faltan.push({ id: 'aguinaldo', texto: 'Aguinaldo exacto', paso: 2 });
  if (pend('planilla') || (hayPlanilla && state.settings.salaryNetOfPayroll === null)) faltan.push({ id: 'planilla', texto: 'Confirmar planilla', paso: 5 });
  if (pend('titulares')) faltan.push({ id: 'titulares', texto: 'Consumos de los demás titulares', paso: 6 });
  for (const p of lista_.filter((x) => x.estado === 'pendiente')) if (!faltan.some((f) => f.paso === p.n)) faltan.push({ id: p.id, texto: p.titulo, paso: p.n });
  const hechos = lista_.filter((p) => p.estado === 'hecho').length;
  return { hechos, total: 7, completo: hechos === 7, pasos: lista_, faltan, siguiente: lista_.find((p) => p.estado === 'pendiente') || null };
}

/**
 * Datos que faltan Y cambian el resultado (AFIP, planilla): para el punto ámbar de "Más".
 * @returns {{hay:boolean, items:{id:string,texto:string,paso:number}[]}}
 */
export function faltanDatosClave(state, today = new Date()) {
  const eng = engDe(state, dia(today));
  const items = [];
  for (const p of eng.pending.filter((x) => x.cambiaResultado)) items.push({ id: p.target, texto: p.target === 'afip' ? 'Plan de AFIP' : 'Confirmar planilla', paso: 5 });
  return { hay: items.length > 0, items };
}

/**
 * Hasta 3 tarjetas "siguiente paso" para Hoy, bajo el pliegue: (a) Una idea para vos, (b) lo próximo que queda libre, (c) Tus datos.
 * Cada una: { id, titulo, texto, boton:{texto, ruta}, personId? }.
 */
export function siguientePaso(state, today = new Date()) {
  const t = dia(today);
  const out = [];
  const hayTarjeta = state.debts.some((d) => d.kind === 'card' && nn(d.balance) > 0);
  const cand = state.receivables.filter((r) => nn(r.balance) > 0 && !(nn(r.monthlyPayment) > 0)).sort((a, b) => nn(b.balance) - nn(a.balance))[0];
  if (cand && hayTarjeta) {
    const monto = nn(cand.balance) >= 100000 ? 50000 : Math.max(1000, Math.round(nn(cand.balance) / 2 / 1000) * 1000);
    const esc = escenariosCobro(state, cand.id, t, { montos: [monto] })?.escenarios.find((e) => e.monto === monto);
    if (esc && (esc.mesesAntes > 0 || esc.ahorro > 1)) {
      const antes = esc.mesesAntes > 0 ? `salís de la tarjeta ${plural(esc.mesesAntes, 'mes', 'meses')} antes y ` : '';
      out.push({ id: 'idea', titulo: 'Una idea para vos', texto: `Si ${cand.person || 'esa persona'} te devuelve ${money(monto)} por mes, ${antes}ahorrás ${money(esc.ahorro)} de interés.`, personId: cand.personId, boton: { texto: 'Ver cómo', ruta: cand.personId ? `#/deudas/medeben/${cand.personId}` : '#/deudas/medeben' } });
    }
  }
  const lib = liberaciones(state, t).proxima;
  if (lib) {
    const queda = lib.tipo === 'tarjeta' ? `dejás de pagar la tarjeta y quedan libres ${money(lib.monto)} por mes` : `termina ${lib.tipo === 'prestamo' ? 'el préstamo' : 'la cuota'} de ${money(lib.monto)} y queda libre esa plata: ${money(lib.monto)} por mes`;
    out.push({ id: 'liberacion', titulo: 'Lo próximo que queda libre', texto: `Desde ${mesAnio(lib.desde)} ${queda}.`, boton: { texto: 'Ver deudas', ruta: '#/deudas' } });
  }
  const c = completitud(state, t);
  if (!c.completo || c.faltan.length) {
    const n = c.faltan.length;
    const frase = n === 1 ? 'Falta 1 dato' : `Faltan ${n} datos`;
    out.push({ id: 'datos', titulo: 'Tus datos', texto: `${frase} para que esto sea más exacto: ${lista(c.faltan.map((f) => f.texto))}.`, progreso: { hechos: c.hechos, total: c.total }, boton: { texto: 'Completar', ruta: '#/mas' } });
  }
  return out.slice(0, 3);
}

/**
 * Cuotas y deudas que terminaron en los últimos meses y todavía no se mostraron (seen.hitos). Sin confeti: una hoja sobria.
 * Cada hito: { id, tipo:'cuota'|'deuda', titulo:'¡Se terminó!', texto, monto, desde }.
 */
export function hitos(state, today = new Date(), seen = state.seen) {
  const t = dia(today);
  const start = monthKeyOf(t);
  const vistos = new Set(seen?.hitos || []);
  const out = [];
  for (const i of state.installments) {
    if (!(nn(i.amount) > 0 && nn(i.remaining) > 0)) continue;
    const first = i.first || start;
    const fin = installmentEnd({ first, remaining: nn(i.remaining) });
    const id = `cuota:${i.id}`;
    if (fin < start && monthDiff(fin, start) <= 3 && !vistos.has(id)) {
      const desde = addMonths(fin, 1);
      out.push({ id, tipo: 'cuota', titulo: '¡Se terminó!', texto: `${i.payroll ? 'El préstamo' : `La cuota de ${i.name || 'esa compra'}`} de ${money(i.amount)} quedó atrás. Desde ${desde <= start ? 'ahora' : mes(desde)} tenés ${money(i.amount)} más por mes.`, monto: nn(i.amount), desde });
    }
  }
  for (const d of state.debts) {
    const id = `deuda:${d.id}`;
    if (nn(d.balance) <= 0 && d.paidOffOn && !vistos.has(id) && daysBetween(d.paidOffOn, t) <= 90) {
      out.push({ id, tipo: 'deuda', titulo: '¡Se terminó!', texto: `${d.name} quedó en cero. Desde ahora tenés ${money(nn(d.minPayment))} más por mes.`, monto: nn(d.minPayment), desde: start });
    }
  }
  return out;
}

/** Puntos para la barra inferior: { mas: bool (faltan datos que cambian el resultado), deudas: bool (algo termina este mes) }. */
export function indicadores(state, today = new Date()) {
  const t = dia(today);
  const start = monthKeyOf(t);
  const termina = state.installments.some((i) => nn(i.amount) > 0 && nn(i.remaining) > 0 && installmentEnd({ first: i.first || start, remaining: nn(i.remaining) }) === start);
  return { mas: faltanDatosClave(state, t).hay, deudas: termina };
}

/**
 * Las 3 frases de la revelación al terminar el armado: mes actual, mes difícil (si hay) y cuánto por día + fecha de salida (con su supuesto).
 * @returns {{frases:{tipo:string, texto:string}[], supuesto:string|null}}
 */
export function revelacion(state, today = new Date()) {
  const h = hero(state, today);
  const frases = [];
  if (h.estado !== 'ok') return { frases, supuesto: null };
  if (h.code === 'falta') frases.push({ tipo: 'mes', texto: `${cap(h.mesNombre)} viene con faltante: faltan ${money(h.numero)}.` });
  else if (h.tieneDeuda) frases.push({ tipo: 'mes', texto: `${cap(h.mesNombre)} alcanza: pagás ${money(h.aLaTarjeta.total)} de la tarjeta.` });
  else frases.push({ tipo: 'mes', texto: `${cap(h.mesNombre)} alcanza: te sobran ${money(h.free)}.` });
  if (h.aviso?.tipo === 'falta') frases.push({ tipo: 'mesDificil', texto: `${cap(h.aviso.mesNombre)} es el mes difícil: faltan ${money(h.aviso.amount)}. Ya lo tenemos en la mira.` });
  const g = paraGastarHoy(state, today);
  const s = salidaTarjeta(state, today);
  if (s.estado === 'fecha') frases.push({ tipo: 'salida', texto: `${g.estado === 'ok' ? `Podés gastar ${money(g.porDia)} por día y ` : ''}${g.estado === 'ok' ? 'salís' : 'Salís'} de la tarjeta en ${mesDe(s.paidOn)}.` });
  return { frases, supuesto: s.estado === 'fecha' ? ASUME_SALIDA : null };
}

/**
 * Pantalla Meses: una fila por mes con su estado, lo que sobra y sus eventos, más los dos chips de la cabecera.
 * fila: { i, key, mesNombre, mesCorto, free, compacto, code, label, tone, pct, esActual, estimado (algún ingreso o gasto estimado),
 *   eventos:string[], evento (primer evento o 'Un mes sin sorpresas.') }.
 * mejorMes: { key, mesNombre, free, texto:'Mejor mes: diciembre +$534.364' }; mesDificil (solo si existe): { key, mesNombre, free, texto:'Mes difícil: enero −$202.000' }.
 * @param {{n?: number}} [opts] cantidad de meses (4 o 12)
 */
export function proyeccion(state, today = new Date(), { n = 12 } = {}) {
  const { sim, eng, estados } = ctx(state, today);
  const hayIngresos = state.incomes.length > 0;
  const total = Math.max(1, Math.min(Math.round(n), sim.months.length));
  const filas = sim.months.slice(0, total).map((m, i) => {
    const eventos = eventosMes(state, i, today).map((e) => e.texto);
    const estimado = [...eng.incomes, ...eng.expenses].some((x) => x.estimated === true && isActive(x, m.key) && amountFor(x, m.key) > 0);
    return { i, key: m.key, mesNombre: mes(m.key), mesCorto: monthName(m.key, { short: true }), free: m.free, compacto: compact(m.free), code: estados[i].code, label: estados[i].label, tone: estados[i].tone, pct: estados[i].pct, esActual: i === 0, estimado, eventos, evento: eventos[0] || 'Un mes sin sorpresas.' };
  });
  const doce = sim.months.slice(0, 12).map((m, i) => ({ m, i }));
  const mejor = doce.reduce((a, b) => (b.m.free > a.m.free ? b : a), doce[0]);
  const dificiles = doce.filter(({ i }) => estados[i].code === 'falta');
  const peor = dificiles.length ? dificiles.reduce((a, b) => (b.m.free < a.m.free ? b : a)) : null;
  return {
    hayIngresos,
    filas,
    mejorMes: hayIngresos ? { key: mejor.m.key, mesNombre: mes(mejor.m.key), free: mejor.m.free, texto: `Mejor mes: ${mes(mejor.m.key)} ${mejor.m.free < 0 ? '' : '+'}${money(mejor.m.free)}` } : null,
    mesDificil: peor ? { key: peor.m.key, mesNombre: mes(peor.m.key), free: peor.m.free, texto: `Mes difícil: ${mes(peor.m.key)} ${money(peor.m.free)}` } : null,
  };
}

/**
 * Lo que se dice al terminar cada paso del armado (1 a 7). Sin jerga y sin números que angustien: una fecha y una acción.
 * @param {number} paso 1 a 7
 * @returns {{texto:string, detalle:string|null, provisoria?:boolean, accion?:{texto:string}}|null} null si todavía no hay nada que decir
 * (paso 6: `detalle` es el supuesto de la fecha, que va debajo en 16px o más, y `provisoria` pide el cartel 'Fecha provisoria')
 */
export function recompensa(state, paso, today = new Date()) {
  const t = dia(today);
  const nombre = (state.settings?.name || '').trim();
  if (paso === 1) {
    const n = state.people.length;
    return { texto: `Listo${nombre ? `, ${nombre}` : ''}.${n > 1 ? ` Somos ${n} en las cuentas.` : ''}`, detalle: null };
  }
  if (paso === 4) return { texto: 'Ahora vas a ver cómo vienen tus meses. Es para ordenarlos, no para asustarte.', detalle: null };
  if (!state.incomes.length) return null;
  if (paso === 2 || paso === 3) {
    const { sim, eng } = ctx(state, t);
    const m0 = sim.months[0];
    let texto = `En ${mes(m0.key)} entran ${money(m0.income)}.`;
    if (paso === 3) {
      // el primer mes del año en que no se cobra movilidad (por ejemplo la feria de enero)
      const mov = eng.incomes.find((x) => x.kind === 'movilidad');
      const sin = mov ? sim.months.slice(1, 12).find((m) => !isActive(mov, m.key)) : null;
      if (sin) texto += ` En ${mes(sin.key)}, ${money(sin.income)}.`;
    }
    return { texto, detalle: null };
  }
  if (paso === 5) {
    const l = liberaciones(state, t).items.filter((x) => (x.tipo === 'prestamo' || x.tipo === 'cuota') && x.fin).sort((a, b) => (a.fin < b.fin ? -1 : 1))[0];
    if (!l) return null;
    return { texto: `El de ${money(l.monto)} termina en ${mesDe(l.fin)}; desde ${mes(l.desde)} queda libre esa plata.`, detalle: null };
  }
  if (paso === 6) {
    const s = salidaTarjeta(state, t);
    if (s.estado === 'fecha') return { texto: `Con lo que cargaste, salís de la tarjeta en ${mesDe(s.paidOn)}.`, detalle: s.supuesto, provisoria: s.provisoria, accion: { texto: 'Ver mi panorama' } };
    if (s.estado === 'muyLejos' || s.estado === 'noTermina') return { texto: s.texto, detalle: s.supuesto, provisoria: s.provisoria, accion: { texto: 'Ver mi panorama' } };
    return null;
  }
  if (paso === 7) {
    const r = state.receivables.filter((x) => nn(x.balance) > 0).sort((a, b) => nn(b.balance) - nn(a.balance))[0];
    if (!r) return { texto: 'Anotado: por ahora nadie te debe. Si alguien te debe, lo sumás cuando quieras.', detalle: null };
    const monto = nn(r.balance) >= 100000 ? 50000 : Math.max(1000, Math.round(nn(r.balance) / 2 / 1000) * 1000);
    const e = escenariosCobro(state, r.id, t, { montos: [monto] })?.escenarios.find((x) => x.monto === monto);
    const nom = r.person || 'Esa persona';
    return { texto: `${nom} te debe ${money(r.balance)}.${e?.terminaEn ? ` Con ${money(monto)} por mes termina en ${mesDe(e.terminaEn)}.` : ''}`, detalle: null };
  }
  return null;
}

// ============================================================================
// CIERRE DE MES, RECORDATORIO .ics
// ============================================================================

function primerDiaHabil(t) {
  const key = monthKeyOf(t);
  for (let d = 1; d <= 7; d++) {
    const x = new Date(t.getFullYear(), t.getMonth(), d);
    const w = x.getDay();
    if (w !== 0 && w !== 6 && !FERIADOS.has(`${key}-${String(d).padStart(2, '0')}`)) return d;
  }
  return 1;
}

/**
 * Cierre de mes (opcional, sin tono de examen). aplica = es desde el primer día hábil hasta el día 7 y no se mostró ya.
 * Con `entradas` ({ gastoTotal?, pagoVisa? }) devuelve el resultado y el monto sugerido para ajustar los gastos de la casa
 * (se aplica con store.ajustarGastosCasa). Esperado = lo que el plan decía que sobraba en el mes que terminó
 * (usa seen.proyecciones[mes] si se guardó; si no, lo estima con los datos de hoy).
 * @returns {{aplica:boolean, mes:string, mesNombre:string, pregunta:string, esperado:number, textoEsperado:string, resultado:null|object}}
 */
export function cierreDeMes(state, today = new Date(), { gastoTotal, pagoVisa } = {}) {
  const t = dia(today);
  const prev = addMonths(monthKeyOf(t), -1);
  const aplica = t.getDate() >= primerDiaHabil(t) && t.getDate() <= 7 && !(state.seen?.cierres || []).includes(prev) && (state.incomes.length > 0 || state.expenses.length > 0);
  const guardado = state.seen?.proyecciones?.[prev];
  let esperado;
  if (guardado !== undefined) esperado = guardado;
  else {
    const eng = toEngine(state, t, { start: prev });
    const { flags, pending, omitidos, ...core } = eng;
    void flags;
    void pending;
    void omitidos;
    esperado = simulate(core).months[0].free;
  }
  const base = { aplica, mes: prev, mesNombre: mes(prev), pregunta: `¿Cómo te fue en ${mes(prev)}?`, esperado, textoEsperado: `Esperábamos que te sobraran ${money(esperado)}`, resultado: null };
  if (gastoTotal === undefined || gastoTotal === null || gastoTotal === '') return base;
  const casa = state.expenses.find((e) => e.kind === 'casa');
  const previstos = state.expenses.filter((e) => isActive(e, prev)).reduce((a, e) => a + amountFor(e, prev), 0);
  const diferencia = nn(gastoTotal) - previstos;
  const nuevo = casa ? Math.max(0, Math.round(nn(casa.amount) + diferencia)) : null;
  const sobroReal = nn(base.esperado) - diferencia;
  const resultado = { gastoTotal: nn(gastoTotal), pagoVisa: pagoVisa === undefined || pagoVisa === null || pagoVisa === '' ? null : nn(pagoVisa), previstos, diferencia, sobroReal, sugerido: nuevo, boton: nuevo !== null && Math.abs(diferencia) >= 1000 ? `Ajustar mis gastos de la casa a ${money(nuevo)}` : null, texto: diferencia > 1000 ? `Gastaste ${money(diferencia)} más de lo previsto.` : diferencia < -1000 ? `Gastaste ${money(-diferencia)} menos de lo previsto.` : 'Gastaste más o menos lo previsto.' };
  return { ...base, resultado };
}

// ----- .ics -----
const icsEscape = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function icsFold(line) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out = [];
  let cur = '';
  let curBytes = 0;
  for (const ch of line) {
    const b = new TextEncoder().encode(ch).length;
    if (curBytes + b > (out.length === 0 ? 75 : 74)) {
      out.push(cur);
      cur = '';
      curBytes = 0;
    }
    cur += ch;
    curBytes += b;
  }
  if (cur) out.push(cur);
  return out.join('\r\n ');
}
const pad2 = (n) => String(n).padStart(2, '0');

/**
 * Archivo de calendario (.ics) con el vencimiento de la tarjeta (fecha real del resumen cargado) y una alarma 2 días antes.
 * El evento es a las 9:00 (hora flotante, sin zona) para que la alarma suene de día. Funciona sin internet.
 * @returns {{ok:true, nombreArchivo:string, contenido:string, fecha:string}|{ok:false, mensaje:string}}
 */
export function icsVencimiento(state, today = new Date(), { debtId } = {}) {
  const t = dia(today);
  const d = tarjetaEstado(state, debtId);
  if (!d || !d.statement) return { ok: false, mensaje: 'Cargá el último resumen para saber qué día vence.' };
  const hoy = toISO(t);
  const fechaV = d.statement.dueOn && d.statement.dueOn >= hoy ? d.statement.dueOn : d.statement.nextDueOn && d.statement.nextDueOn >= hoy ? d.statement.nextDueOn : null;
  if (!fechaV) return { ok: false, mensaje: 'Cargá el resumen nuevo para saber qué día vence.' };
  const ymd = fechaV.replace(/-/g, '');
  const stamp = `${t.getFullYear()}${pad2(t.getMonth() + 1)}${pad2(t.getDate())}T000000Z`;
  const esElActual = fechaV === d.statement.dueOn;
  const min = esElActual ? nn(d.statement.min) || nn(d.minPayment) : 0;
  const corto = nombreCorto(d);
  const desc = `Vence la ${corto}.${min > 0 ? ` Pago mínimo del resumen: ${money(min)}.` : ''} Podés pagar más que el mínimo: abrí Mis Cuentas y mirá cuánto conviene.`;
  const lineas = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Mis Cuentas//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:vence-${d.id}-${ymd}@miscuentas`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${ymd}T090000`,
    `DTEND:${ymd}T093000`,
    `SUMMARY:${icsEscape(`Vence la ${corto}`)}`,
    `DESCRIPTION:${icsEscape(desc)}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${icsEscape(`En 2 días vence la ${corto}`)}`,
    'TRIGGER:-P2D',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return { ok: true, fecha: fechaV, nombreArchivo: `vencimiento-${corto.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${fechaV}.ics`, contenido: lineas.map(icsFold).join('\r\n') + '\r\n' };
}

// utilidades reexportadas por comodidad de las pantallas
export { haceTiempo, addDays, addMonthsDate };
