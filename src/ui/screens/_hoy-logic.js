// _hoy-logic.js · lógica PURA de las pantallas Hoy y Meses (sin DOM): decide qué se muestra y qué abre cada toque.
// Toda cifra sale de derive.js; acá solo se ordena, se arma lo que falta para la vista y se decide el destino de cada toque.
// Se prueba con test/s1.test.js. Los módulos de pantalla (hoy.js, meses.js, _hoy-sheets.js) la usan.

import { addMonths, monthDiff } from '../../engine.js';
import { longDate, haceTiempo, monthKeyOf } from '../../format.js';

export const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// ------------------------------------------------------------------ encabezado y pie
/** Fecha y saludo de la barra superior de Hoy. */
export function encabezado(state, today) {
  const nombre = String(state?.settings?.name || '').trim();
  return { eyebrow: longDate(today, { weekday: true, capital: true }), title: nombre ? `Hola, ${nombre}` : 'Hola' };
}

/** Pie de Hoy: "Tus datos están solo en este celular. Última copia: hace 3 días." */
export function textoPie(state, today, donde = 'celular', enNube = false) {
  const base = enNube ? `Tus datos se guardan en este ${donde} y en la nube.` : `Tus datos están solo en este ${donde}.`;
  const cuando = haceTiempo(state?.settings?.lastBackupAt, today);
  return cuando ? `${base} Última copia: ${cuando}.` : `${base} Todavía no hiciste una copia de seguridad.`;
}

// ------------------------------------------------------------------ meses
const ICONOS_EVENTO = { movilidad: 'calendario', aguinaldo: 'destello', cuotaTermina: 'llave', tarjetaFin: 'bandera', sinTarjeta: 'bandera', cobroTermina: 'usuarios' };
export const iconoEvento = (tipo) => ICONOS_EVENTO[tipo] || 'destello';

/** "Octubre" para listas; si el mes cae en otro año que el de hoy se agrega el año ("Enero 2027"). */
export function nombreMes(key, hoyKey, nombreSimple) {
  const nombre = cap(nombreSimple);
  if (!hoyKey || String(key).slice(0, 4) === String(hoyKey).slice(0, 4)) return nombre;
  return `${nombre} ${String(key).slice(0, 4)}`;
}

/** true si el mes lleva un aguinaldo que todavía es una estimación (esos meses se dibujan con borde punteado). */
export const llevaAguinaldoEstimado = (eventos) => (eventos || []).some((e) => e.tipo === 'aguinaldo' && /estimad/i.test(e.texto || ''));

/**
 * Un evento "importa" para la lista de 12 meses si no es el simple conteo de días de movilidad de un mes con feriados
 * (esos días van en el detalle del mes). Importan: aguinaldo, fin de préstamos y cuotas, tarjeta, lo que termina de devolverte
 * alguien, y la movilidad solo si cambia de verdad (feria de enero o de invierno).
 */
export const eventoImporta = (e) => e.tipo !== 'movilidad' || !!e.sinCobro || /\bferia de\b/i.test(e.texto || '');

/**
 * Filas de la pantalla Meses (y tira de 12 meses de Hoy en escritorio), listas para charts.monthRows / monthStrip.
 * item: { i, key, name, nombreCorto, short, value, state, label, estimated, event (todos los eventos), eventoImporta (solo los que importan),
 *          eventos[{tipo,texto}], eventIcon (del primero que importa), esActual }
 */
export function filasMeses(D, state, today, n = 12) {
  const P = D.proyeccion(state, today, { n });
  const hoyKey = P.filas[0]?.key || monthKeyOf(today);
  const items = P.filas.map((f) => {
    const eventos = D.eventosMes(state, f.i, today);
    return {
      i: f.i,
      key: f.key,
      name: nombreMes(f.key, hoyKey, f.mesNombre),
      nombreCorto: cap(f.mesNombre),
      short: f.mesCorto,
      value: f.free,
      state: f.code,
      label: f.label,
      estimated: llevaAguinaldoEstimado(eventos),
      event: eventos.length ? eventos.map((e) => e.texto).join(' · ') : f.evento,
      eventoImporta: eventos.filter(eventoImporta).map((e) => e.texto).join(' · ') || null,
      eventos,
      eventIcon: eventos.some(eventoImporta) ? iconoEvento(eventos.find(eventoImporta).tipo) : null,
      esActual: f.esActual,
    };
  });
  return { hayIngresos: P.hayIngresos, items, mejorMes: P.mejorMes, mesDificil: P.mesDificil };
}

/** Mes anterior / siguiente dentro de los primeros `total` meses del plan (para los botones < > del detalle). */
export function vecinosDeMes(key, hoyKey, total = 12) {
  const i = monthDiff(hoyKey, key);
  return { i, valido: i >= 0 && i < total, anterior: i > 0 ? addMonths(key, -1) : null, siguiente: i < total - 1 ? addMonths(key, 1) : null };
}

/** Clave 'YYYY-MM' de una ruta tipo '#/meses/2026-12' (o null). */
export function claveDeRuta(hash) {
  const m = /#\/meses\/(\d{4}-(?:0[1-9]|1[0-2]))/.exec(String(hash || ''));
  return m ? m[1] : null;
}

// ------------------------------------------------------------------ qué abre cada toque
/**
 * Destino al tocar una línea del detalle de un mes (lineasMes):
 *  { tipo:'editor', kind, id } · { tipo:'elegir', items } (varios préstamos por planilla) · { tipo:'nav', hash } · null
 */
export function destinoDeLinea(linea, state) {
  if (!linea) return null;
  switch (linea.lista) {
    case 'incomes': {
      const inc = (state.incomes || []).find((x) => x.id === linea.id);
      return { tipo: 'editor', kind: inc?.kind === 'movilidad' ? 'movilidad' : 'income', id: linea.id };
    }
    case 'expenses': return { tipo: 'editor', kind: 'expense', id: linea.id };
    case 'installments': {
      if (linea.id !== 'planilla') return { tipo: 'editor', kind: 'installment', id: linea.id };
      const items = linea.items || [];
      return items.length === 1 ? { tipo: 'editor', kind: 'installment', id: items[0].id } : { tipo: 'elegir', items };
    }
    case 'debts': {
      const d = (state.debts || []).find((x) => x.id === linea.id);
      return !d || d.kind === 'card' ? { tipo: 'nav', hash: '#/deudas/tarjeta' } : { tipo: 'editor', kind: 'debt', id: linea.id };
    }
    case 'receivables': return { tipo: 'nav', hash: '#/deudas/medeben' };
    default: return null;
  }
}

/** Qué hace el botón de una fila de "Lo que vence" (o de la tarjeta "Ahora toca"). */
export function accionDeBoton(boton, fila) {
  switch (boton?.accion) {
    case 'yaPague': return { tipo: 'editor', kind: 'cardPayment', id: fila?.debtId };
    case 'cargarResumen': return { tipo: 'editor', kind: 'statement', id: fila?.debtId };
    case 'anotarCobro': return { tipo: 'cobro' };
    case 'completar': return { tipo: 'nav', hash: fila?.ruta || '#/mas' };
    default: return null;
  }
}

/** Botón-aviso del hero: qué ícono lleva y qué abre ('mesDificil' = hoja con las formas de cubrirlo, 'mes' = detalle del mes). */
export function accionAviso(aviso) {
  if (!aviso) return { icon: 'tilde', accion: null, key: null };
  if (aviso.tipo === 'falta' || aviso.tipo === 'mesActualFalta') return { icon: 'alerta', accion: 'mesDificil', key: aviso.key };
  if (aviso.tipo === 'justo') return { icon: 'info', accion: 'mes', key: aviso.key };
  return { icon: 'tilde', accion: null, key: null };
}

// ------------------------------------------------------------------ lo que te deben
/**
 * A quién se le anota un pago: personas que te deben algo, con el id del saldo más grande de cada una.
 * modo: 'ninguno' | 'uno' (se abre directo) | 'varios' (primero se elige quién).
 */
export function quienPaga(D, state, today) {
  const personas = D.meDeben(state, today).personas.filter((p) => p.balance > 0).map((p) => {
    const propios = (state.receivables || []).filter((r) => p.receivableIds.includes(r.id)).sort((a, b) => Number(b.balance) - Number(a.balance));
    return { personId: p.personId, nombre: p.nombre, balance: p.balance, receivableId: propios[0]?.id || p.receivableIds[0], index: Math.max(0, (state.people || []).findIndex((x) => x.id === p.personId)) };
  });
  return { modo: personas.length === 0 ? 'ninguno' : personas.length === 1 ? 'uno' : 'varios', personas };
}

// ------------------------------------------------------------------ datos que faltan (resultado provisorio)
/**
 * Filas "Falta un dato" para Hoy y Meses. Los motivos de resumen viejo y de "¿ya cobraste?" tienen su propio lugar
 * (el banner de la fila de la tarjeta y la pregunta de la plata de hoy), así que acá se dejan afuera.
 */
export function pendientesVisibles(motivosDetalle, { omitir = ['cobro', 'resumenViejo'] } = {}) {
  return (motivosDetalle || []).filter((m) => !omitir.includes(m.code)).map((m) => ({
    code: m.code,
    titulo: 'Falta un dato',
    texto: m.texto,
    hash: m.code === 'afip' || m.code === 'planilla' ? '#/armar/5' : '#/mas',
  }));
}

// ------------------------------------------------------------------ vista completa de Hoy
/**
 * Junta lo que Hoy necesita de derive en un solo lugar (una corrida del motor, el resto sale del memo).
 * estado: 'sinDatos' | 'sinIngresos' | 'parcial' | 'ok'.
 */
export function vistaHoy(D, state, today) {
  const hero = D.hero(state, today);
  if (hero.estado === 'sinDatos' || hero.estado === 'sinIngresos') return { estado: hero.estado, hero };
  const base = { estado: hero.estado, hero, siguientes: D.siguientePaso(state, today), hitos: D.hitos(state, today), cierre: D.cierreDeMes(state, today) };
  if (hero.estado === 'parcial') return base;
  const sim = D.run(state, { today });
  return {
    ...base,
    plata: D.plataDeHoy(state),
    gastar: D.paraGastarHoy(state, today),
    salida: D.salidaTarjeta(state, today),
    vence: D.vencimientos(state, today),
    ahora: D.ahoraToca(state, today),
    pendientes: pendientesVisibles(sim.eng?.flags?.motivosDetalle),
  };
}
