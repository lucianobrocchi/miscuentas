// _deudas-logic.js · lógica pura (sin DOM) de Deudas, Tarjeta y Me deben.
// Toda cifra sale de derive; acá solo se ordena y se arman los textos de presentación (los que derive no escribe).
// Se prueba con test/s3.test.js. Las pantallas (deudas.js, tarjeta.js, medeben.js) solo dibujan lo que sale de acá.

import { uid } from '../../store.js';

const nn = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);
const keyIdx = (k) => { const [y, m] = String(k).split('-').map(Number); return y * 12 + (m - 1); };
const idxKey = (i) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
export const addMonthsKey = (k, n) => idxKey(keyIdx(k) + n);
const monthsBetween = (a, b) => keyIdx(b) - keyIdx(a);

// =====================================================================================================================
// DEUDAS · lo que debo
// =====================================================================================================================

/** Para los textos de lectores de pantalla con el ojo activado: los montos se leen "monto oculto". */
export const ocultarMontos = (texto) => String(texto).replace(/[−-]?\$\s?\d+(?:\.\d{3})*(?:,\d+)?/g, 'monto oculto');

/** Hash al que va "Cargar / completar" cuando falta un dato de planilla o de AFIP (paso 5 del armado). */
export const HASH_PLANILLA = '#/armar/5';

/** Texto de "Hoy, $31 de cada $100 que cobrás van a deudas" a partir de lo que escribe derive. */
export function textoHoyDeudas(sobre) {
  if (!sobre || !sobre.textoHoy) return null;
  return `Hoy, ${sobre.textoHoy}.`;
}

/** ¿Hay algo para mostrar en Deudas? (deudas, cuotas o datos pendientes de planilla/AFIP). */
export function hayDeudas(lib) {
  return !!(lib && lib.items && lib.items.length);
}

/**
 * Fecha de salida de la tarjeta para la línea de tiempo, honesta: nunca un número absurdo ni un mes que se mueve en silencio.
 * Devuelve { dateLabel, end, sinFin }.
 */
function salidaParaLinea(it, salida, F) {
  if (salida && salida.hayTarjeta && salida.estado && salida.estado !== 'fecha' && salida.estado !== 'sinDeuda') {
    if (salida.estado === 'muyLejos') return { dateLabel: 'Falta bastante', end: null, sinFin: true };
    if (salida.estado === 'noTermina') return { dateLabel: 'Todavía no termina', end: null, sinFin: true };
  }
  if (!it.fin) return { dateLabel: 'Todavía no termina', end: null, sinFin: true };
  return { dateLabel: F.monthName(it.fin, { year: true }), end: it.fin, sinFin: false };
}

/** Frase del detalle de una fila de la línea de tiempo. */
export function subDeItem(it, F, { provisoria = false } = {}) {
  if (it.tipo === 'pendiente') return 'Falta cargar monto y cuotas';
  if (it.tipo === 'tarjeta') {
    const base = it.saldo ? `Debés ${F.money(it.saldo)}` : 'Tarjeta';
    return provisoria ? `${base} · fecha provisoria` : base;
  }
  let cuotas = '';
  if (it.quedan != null) cuotas = it.cuotasTotal && it.cuotasTotal >= it.quedan ? `quedan ${it.quedan} de ${it.cuotasTotal} cuotas` : `quedan ${F.plural(it.quedan, 'cuota', 'cuotas')}`;
  const partes = [`Cuota de ${F.money(it.monto)}`, cuotas, it.planilla ? 'se descuenta del sueldo' : ''].filter(Boolean);
  return partes.join(' · ');
}

/**
 * Qué pasa al tocar una fila de la línea de tiempo.
 * { tipo:'nav', hash } | { tipo:'editor', kind, id }
 */
export function destinoLinea(it, state) {
  if (it.tipo === 'pendiente') return { tipo: 'nav', hash: HASH_PLANILLA };
  if (it.tipo === 'tarjeta') {
    const d = (state.debts || []).find((x) => x.id === it.id);
    const tarjetas = (state.debts || []).filter((x) => x.kind === 'card');
    if (!d || d.kind === 'card') return { tipo: 'nav', hash: tarjetas.length > 1 ? `#/deudas/tarjeta?id=${encodeURIComponent(it.id)}` : '#/deudas/tarjeta' };
    return { tipo: 'editor', kind: 'debt', id: it.id };
  }
  return { tipo: 'editor', kind: 'installment', id: it.id };
}

/**
 * Filas de la línea de tiempo "Cuándo termina cada deuda" + el rango del eje.
 * Cada fila: { id, tipo, label, sub, start, end, dateLabel, tone, pending, pipsInfo, destino, ariaLabel }.
 */
export function lineaDeTiempo(lib, salida, state, F, hoyKey) {
  const provisoria = !!(salida && salida.provisoria);
  const filas = (lib.items || []).map((it) => {
    const esTarjeta = it.tipo === 'tarjeta';
    const pending = it.tipo === 'pendiente';
    const s = pending ? { dateLabel: 'a completar', end: null, sinFin: true } : salidaParaLinea(it, esTarjeta ? salida : null, F);
    let pipsInfo = null;
    if (!esTarjeta && !pending && it.quedan != null && it.quedan > 0) {
      const total = it.cuotasTotal && it.cuotasTotal >= it.quedan ? it.cuotasTotal : it.quedan;
      // hasta 12 cuotas se dibujan como puntos; con más, el dato va en palabras en el detalle (una barra más se confundiría con la de la línea de tiempo)
      if (total <= 12) pipsInfo = { total, paid: total - it.quedan };
    }
    const sub = subDeItem(it, F, { provisoria: esTarjeta && provisoria && !s.sinFin });
    const destino = destinoLinea(it, state);
    const fin = pending ? 'Falta completar los datos' : s.sinFin ? s.dateLabel : `Termina en ${s.dateLabel}`;
    return {
      id: it.id, tipo: it.tipo, label: it.nombre, sub, start: hoyKey, end: s.end, sinFin: s.sinFin, dateLabel: s.dateLabel,
      tone: pending ? 'info' : 'brand', pending, pipsInfo, destino,
      ariaLabel: `${it.nombre}. ${sub}. ${fin}. Tocá para ${destino.tipo === 'editor' ? 'editarla' : pending ? 'completar los datos' : 'ver el detalle'}.`,
    };
  });
  const fines = filas.map((f) => f.end).filter(Boolean).sort();
  const ultimo = fines.length ? fines[fines.length - 1] : hoyKey;
  const hayAbiertas = filas.some((f) => f.sinFin && !f.pending);
  let to = addMonthsKey(ultimo, 1);
  const minimo = addMonthsKey(hoyKey, hayAbiertas ? 12 : 6);
  if (monthsBetween(to, minimo) > 0) to = minimo;
  for (const f of filas) { if (f.sinFin && !f.pending) f.end = to; }
  return { filas, from: hoyKey, to, todayKey: hoyKey };
}

/**
 * Escalera "Lo que vas a recuperar por mes": agrupa por mes lo que queda libre. Los montos son los de derive (liberaciones.escalera).
 * Cada fila: { desde, titulo:'Desde abril 2027', monto, sub:'Ya no pagás la tarjeta' | 'Termina Préstamo personal' }.
 */
export function escaleraFilas(lib, F) {
  const grupos = new Map();
  for (const it of lib.items || []) {
    if (!it.desde || !(it.monto > 0)) continue;
    const g = grupos.get(it.desde) || { desde: it.desde, partes: [] };
    g.partes.push(it);
    grupos.set(it.desde, g);
  }
  return (lib.escalera || []).map((e) => {
    const g = grupos.get(e.desde);
    const partes = g ? g.partes : [];
    const tarjeta = partes.some((p) => p.tipo === 'tarjeta');
    const otros = partes.filter((p) => p.tipo !== 'tarjeta').map((p) => p.nombre);
    const sub = [tarjeta ? 'Ya no pagás la tarjeta' : null, otros.length ? `Termina: ${F.lista(otros)}` : null].filter(Boolean).join(' · ');
    return { desde: e.desde, titulo: `Desde ${F.monthName(e.desde, { year: true })}`, monto: e.monto, sub, texto: e.texto };
  });
}

/**
 * Datos que faltan y que cambian lo que se ve en Deudas (plan de AFIP, si el sueldo ya tiene restados los descuentos):
 * [{ code, titulo:'Falta un dato', texto, hash }]. Los textos los escribe el adaptador (flags.motivosDetalle).
 */
export function pendientesDeudas(motivosDetalle) {
  return (motivosDetalle || []).filter((m) => m.code === 'afip' || m.code === 'planilla').map((m) => ({
    code: m.code, titulo: 'Falta un dato', texto: m.texto, hash: HASH_PLANILLA,
  }));
}

/** El texto del pie de Deudas: lo que falta pagar por planilla (en tono bajo, dato chico a propósito). */
export function pieDeudas(lib, F) {
  const t = nn(lib.faltaPagarPlanilla);
  if (t <= 0) return null;
  const hayAfip = (lib.items || []).some((i) => i.tipo === 'pendiente');
  return `Te falta pagar por planilla ${F.money(t)} en total${hayAfip ? ' (sin el plan de AFIP, que falta cargar)' : ''}.`;
}

// =====================================================================================================================
// TARJETA
// =====================================================================================================================

/** La tarjeta que se muestra: la de ?id= si existe, si no la primera. */
export function tarjetaElegida(state, id) {
  const tarjetas = (state.debts || []).filter((d) => d.kind === 'card');
  return { tarjetas, debt: tarjetas.find((d) => d.id === id) || tarjetas[0] || null };
}

/** "Cerró el 28 de septiembre" / "Vence el 10 de octubre" (fechas reales del resumen cargado). */
export function chipsFechas(est, F) {
  const out = [];
  if (est && est.closedOn) out.push(`Cerró el ${F.longDate(est.closedOn)}`);
  if (est && est.dueOn) out.push(`Vence el ${F.longDate(est.dueOn)}`);
  return out;
}

/** Banner de resumen viejo: { title, text } con la fecha real del cierre que ya pasó. */
export function bannerViejo(est, F) {
  if (!est || !est.hayResumen) return null;
  const cierre = est.nextCloseOn ? `Cerró el ${F.longDate(est.nextCloseOn)}. ` : '';
  return { title: 'Ya cerró un resumen nuevo', text: `${cierre}Cargalo para ver el monto exacto de este mes. Hasta entonces, los montos y las fechas de abajo son provisorios.` };
}

/** Filas del cuadro del último resumen: [{ label, value (número), tone?, strong?, hint? }]. Solo lo que se conoce. */
export function filasResumen(debt, est, pagos, F) {
  const st = debt.statement || {};
  const rows = [];
  const min = nn(st.min) || nn(debt.minPayment);
  if (min > 0) rows.push({ label: 'Pago mínimo', valor: min, strong: true });
  if (st.newCharges != null && nn(st.newCharges) > 0) rows.push({ label: 'Consumos nuevos del resumen', valor: nn(st.newCharges) });
  if (pagos && pagos.total > 0) {
    rows.push({ label: 'Pagaste desde el cierre', valor: pagos.total, hint: pagos.ultimo ? `El último, el ${F.longDate(pagos.ultimo.date)}` : undefined });
    rows.push({ label: 'Saldo de hoy', valor: nn(debt.balance), strong: true });
  }
  return rows;
}

/** "Pagaste $270.000 el 2 de octubre" (o con varios pagos: "Pagaste $X desde el cierre"). */
export function textoPagado(pagos, F) {
  if (!pagos || !(pagos.total > 0)) return null;
  if (pagos.pagos.length === 1) return `Pagaste ${F.money(pagos.total)} el ${F.longDate(pagos.pagos[0].date)}.`;
  return `Pagaste ${F.money(pagos.total)} en ${pagos.pagos.length} pagos desde el cierre. El último, el ${F.longDate(pagos.ultimo.date)}.`;
}

/**
 * Subtítulo de cada opción de "Cuánto pagar" (la salida y lo que cuesta o ahorra). `minimo` = la opción "Solo el mínimo".
 * Honesto con lo que no termina: nunca "Salís en No se termina" ni un interés de millones sin sentido.
 */
export function subOpcionPago(op, F, minimo = null) {
  if (!op.paidOn) return 'Con este pago la tarjeta no se termina en los próximos años';
  if (op.id === 'sobra' && minimo && Math.abs(nn(op.monto) - nn(minimo.monto)) < 1) return 'Este mes no sobra más que el mínimo';
  if (op.id === 'sobra' && op.ahorro > 1 && minimo && minimo.paidOn) return `Salís en ${op.salidaTexto} · ahorrás ${F.money(op.ahorro)} de interés`;
  if (op.id === 'sobra' && minimo && !minimo.paidOn) return `Salís en ${op.salidaTexto} · con el mínimo no se termina`;
  return `Salís en ${op.salidaTexto} · interés total ${F.money(op.totalInterest)}`;
}

/** El detalle de "cuánto va a deudas" dicho solo con lo que existe (sin "$0 de la tarjeta"). */
export function detalleDeudas(sobre, F) {
  if (!sobre) return null;
  const { deudas, tarjetaMinimo, prestamos } = sobre;
  if (!(deudas > 0)) return null;
  if (tarjetaMinimo > 0 && prestamos > 0) return sobre.detalle || null;
  if (tarjetaMinimo > 0) return `${F.money(deudas)} por mes de la tarjeta (mínimo).`;
  return `${F.money(deudas)} por mes de préstamos y cuotas.`;
}

/** Texto accesible del gráfico "Cómo baja". */
export function ariaCurva(curva, F) {
  const p0 = curva.plan[0];
  const ini = p0 ? F.money(p0.deuda) : 'lo que debés';
  const plan = curva.planTermina ? `llega a cero en ${F.monthName(curva.planTermina, { year: true })} con tu plan` : 'sigue bajando con tu plan';
  const min = curva.minimoTermina ? `en ${F.monthName(curva.minimoTermina, { year: true })} pagando solo el mínimo` : 'más despacio pagando solo el mínimo';
  return `La deuda de la tarjeta baja desde ${ini}: ${plan}, y ${min}.`;
}

/** Puntos de las dos líneas del gráfico. Cada línea termina en el mes en que llega a cero, así la etiqueta queda donde corresponde. */
export function seriesCurva(curva, F) {
  const pts = (arr, fin) => {
    const hasta = fin ? arr.findIndex((p) => p.key === fin) : -1;
    return (hasta >= 0 ? arr.slice(0, hasta + 1) : arr).map((p) => ({ key: p.key, value: Math.max(0, nn(p.deuda)) }));
  };
  return [
    { name: 'Tu plan', points: pts(curva.plan, curva.planTermina), style: 'solid', endLabel: curva.planTermina ? F.monthName(curva.planTermina, { year: true }) : undefined },
    { name: 'Solo el mínimo', points: pts(curva.soloMinimo, curva.minimoTermina), style: 'dashed', endLabel: curva.minimoTermina ? F.monthName(curva.minimoTermina, { year: true }) : undefined },
  ];
}

/**
 * "De quién es cada parte": una fila por persona con lo cargado y si ya figura en Me deben.
 * [{ personId, nombre, index, role, monto (o null), enMeDeben }]
 */
export function filasTitulares(state, debt) {
  const holders = new Map((debt.holders || []).map((h) => [h.personId, nn(h.amount)]));
  return (state.people || []).map((p, index) => ({
    personId: p.id, nombre: p.name, index, role: p.role,
    monto: holders.has(p.id) && holders.get(p.id) > 0 ? holders.get(p.id) : null,
    enMeDeben: (state.receivables || []).some((r) => (r.personId === p.id || (!r.personId && r.person === p.name)) && nn(r.balance) > 0),
  }));
}

/** Tonos de la barra apilada del reparto (nunca rojo; el resto va en pino). */
export const TONOS_REPARTO = ['info', 'neutral', 'ok', 'warn'];

/** Fija lo que le toca a una persona de esta tarjeta (monto vacío o 0 la saca del reparto). Muta el borrador. */
export function fijarTitular(draft, debtId, personId, monto) {
  const d = (draft.debts || []).find((x) => x.id === debtId);
  if (!d) return false;
  const m = Math.round(nn(monto));
  d.holders = (d.holders || []).filter((h) => h.personId !== personId);
  if (m > 0) d.holders.push({ personId, amount: m });
  return true;
}

/**
 * "Pasar a Me deben": crea lo que le toca a esa persona como algo que te debe. Muta el borrador.
 * Devuelve { ok, motivo?: 'existe'|'sinPersona'|'sinMonto', receivable? }
 */
export function pasarAMeDeben(draft, debtId, personId, monto) {
  const d = (draft.debts || []).find((x) => x.id === debtId);
  const p = (draft.people || []).find((x) => x.id === personId);
  const m = Math.round(nn(monto));
  if (!d || !p) return { ok: false, motivo: 'sinPersona' };
  if (!(m > 0)) return { ok: false, motivo: 'sinMonto' };
  const nombre = `Lo que usó de ${d.name}`;
  const ya = (draft.receivables || []).find((r) => (r.personId === p.id || (!r.personId && r.person === p.name)) && r.name === nombre);
  if (ya) return { ok: false, motivo: 'existe', receivable: ya };
  const r = { id: uid(), person: p.name, personId: p.id, name: nombre, balance: m, rate: 0, monthlyPayment: 0, payments: [], note: 'El interés ya está incluido en lo que debe.' };
  draft.receivables = [...(draft.receivables || []), r];
  return { ok: true, receivable: r };
}

/** El archivo .ics para el calendario: devuelve { ok, nombreArchivo, contenido, fecha } o { ok:false, mensaje } (lo escribe derive). */
export function textoAvisoCalendario(ics, F) {
  if (!ics || !ics.ok) return null;
  return `Te avisa 2 días antes del vencimiento (el ${F.longDate(ics.fecha)}), a las 9. Funciona sin internet.`;
}

// =====================================================================================================================
// ME DEBEN
// =====================================================================================================================

/** Ícono de cada estado de persona (palabra + ícono + color; nunca una alerta). */
export const ICONO_ESTADO = { acordado: 'tilde', parte: 'reloj', conversar: 'info', nada: 'mas' };

/** Índice de la persona en people[] (para el alias del modo privacidad: "Persona 3"). */
export const indicePersona = (state, personId, nombre) => {
  const i = (state.people || []).findIndex((p) => (personId ? p.id === personId : p.name === nombre));
  return i >= 0 ? i : 0;
};

/**
 * Personas a las que se les puede anotar un pago (con saldo). modo: 'ninguno' | 'uno' (se abre directo) | 'varios' (primero se elige).
 * Cada una: { personId, nombre, balance, receivableId, index }. receivableId = el de mayor saldo de esa persona.
 */
export function quienPaga(personas, state) {
  const lista = (personas || []).filter((p) => p.balance > 0).map((p) => {
    const propios = (state.receivables || []).filter((r) => (p.receivableIds || []).includes(r.id)).sort((a, b) => nn(b.balance) - nn(a.balance));
    return { personId: p.personId, nombre: p.nombre, balance: p.balance, receivableId: (propios[0] && propios[0].id) || (p.receivableIds || [])[0], index: indicePersona(state, p.personId, p.nombre) };
  });
  return { modo: lista.length === 0 ? 'ninguno' : lista.length === 1 ? 'uno' : 'varios', personas: lista };
}

/** "2 de octubre" (con el año solo si no es el de hoy). */
export function fechaCorta(F, date, today) {
  const d = F.toDate(date);
  const hoy = F.toDate(today);
  return F.longDate(date, { year: !!(d && hoy && d.getFullYear() !== hoy.getFullYear()) });
}

/** Cómo se dice a dónde fue lo que te devolvieron (historial "Te pagó"). */
export const TEXTO_DESTINO = {
  tarjeta: 'Lo usaste para pagar la tarjeta',
  guardada: 'La guardaste',
  gastada: 'La gastaste',
};

/** Historial de pagos de una cuenta, del más nuevo al más viejo. */
export function historialPagos(r) {
  return [...(r.payments || [])]
    .filter((p) => nn(p.amount) > 0)
    .sort((a, b) => (String(a.date) < String(b.date) ? 1 : String(a.date) > String(b.date) ? -1 : 0));
}

/**
 * Opciones de cuota de la ficha (una por escenario de derive, más "Sin cuota por ahora").
 * Cada una: { value (número), titulo, sub, esActual, advertencia? }.
 */
export function opcionesCuota(esc, F) {
  const filas = (esc.escenarios || []).map((e) => {
    const partes = [e.terminaEn ? `Termina en ${e.terminaTexto}${e.meses ? ` (${F.plural(e.meses, 'mes', 'meses')})` : ''}` : 'Con esta cuota no termina'];
    if (!e.esActual) {
      if (e.ahorro > 1) partes.push(`ahorrás ${F.money(e.ahorro)} de interés`);
      else if (e.ahorro < -1) partes.push(`suma ${F.money(-e.ahorro)} más de interés`);
    }
    if (e.mesesAntes > 0) partes.push(`salís de la tarjeta ${e.mesesAntes === 1 ? 'un mes' : `${e.mesesAntes} meses`} antes`);
    return { value: e.monto, titulo: `${F.money(e.monto)} por mes`, sub: partes.join(' · '), esActual: e.esActual, advertencia: e.advertencia };
  });
  const sin = { value: 0, titulo: 'Sin cuota por ahora', sub: 'Cuando te devuelva algo, lo anotás.', esActual: !(nn(esc.cuotaActual) > 0) };
  return [...filas, sin];
}

/**
 * Cuota que propone "Una idea" de derive (siguientePaso): 50.000 si te deben 100.000 o más, si no la mitad redondeada.
 * La usa el mensaje de WhatsApp de esa tarjeta para decir lo mismo que la idea. test/s3.test.js verifica que coincidan.
 */
export const cuotaSugerida = (balance) => (nn(balance) >= 100000 ? 50000 : Math.max(1000, Math.round(nn(balance) / 2 / 1000) * 1000));

/** Personas ordenadas para la lista: primero las que te deben (de mayor a menor), después las que no. */
export function personasOrdenadas(personas) {
  return [...(personas || [])].sort((a, b) => (b.balance > 0) - (a.balance > 0) || nn(b.balance) - nn(a.balance));
}

/** Fija la cuota mensual acordada de una cuenta. Muta el borrador. */
export function fijarCuota(draft, receivableId, monto) {
  const r = (draft.receivables || []).find((x) => x.id === receivableId);
  if (!r) return false;
  r.monthlyPayment = Math.max(0, Math.round(nn(monto)));
  return true;
}

/** Prende o apaga el interés de lo que te deben (usa el de la tarjeta). Muta el borrador. */
export function fijarInteres(draft, receivableId, rate) {
  const r = (draft.receivables || []).find((x) => x.id === receivableId);
  if (!r) return false;
  r.rate = Math.max(0, nn(rate));
  return true;
}

/** Enlace de WhatsApp con el texto ya codificado (nunca se manda solo: se abre la conversación para que la persona revise y envíe). */
export const urlWhatsApp = (texto) => `https://wa.me/?text=${encodeURIComponent(texto)}`;

/**
 * Ficha de una persona: junta lo de derive en un solo lugar.
 * Devuelve null si no se reconoce a la persona; si no te debe nada, { persona, cuentas: [] }.
 */
export function vistaFicha(D, state, t, personId) {
  const md = D.meDeben(state, t);
  const persona = md.personas.find((p) => p.personId === personId || p.id === personId);
  if (!persona) return null;
  const cuentas = (state.receivables || [])
    .filter((r) => (persona.receivableIds || []).includes(r.id))
    .map((r) => ({
      r,
      esc: D.escenariosCobro(state, r.id, t),
      interes: D.interesDeCobro(state, r.id),
      historial: historialPagos(r),
    }));
  return { persona, cuentas, index: indicePersona(state, persona.personId, persona.nombre) };
}
