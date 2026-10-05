// _puedo-logic.js · lógica PURA de la pantalla "Probá antes de gastar" (sin DOM): el formulario, la conversión entre
// precio total y cuotas, cómo se arma el gasto que entiende derive y cómo se leen sus resultados. Se prueba con
// test/puedo.test.js. Toda cifra de dinero (veredicto, mapa de meses, tope) sale de derive.js: acá solo se arma la
// entrada y se ordena la salida.

import { addMonths } from '../../engine.js';

export const MODOS = [
  { value: 'una', label: 'De una vez' },
  { value: 'cuotas', label: 'En cuotas' },
  { value: 'mensual', label: 'Todos los meses' },
];

export const SUGERENCIAS = ['Regalos de Navidad', 'Viaje', 'Electrodoméstico', 'Arreglo del auto'];

/** Ejemplos tocables para empezar (cifras redondas e ilustrativas). */
export const EJEMPLOS = [
  { id: 'heladera', titulo: 'Heladera en 6 cuotas', nombre: 'Heladera', modo: 'cuotas', total: 600000, cuotas: 6 },
  { id: 'viaje', titulo: 'Un viaje', nombre: 'Viaje', modo: 'una', total: 300000 },
  { id: 'regalo', titulo: 'Un regalo', nombre: 'Regalo', modo: 'una', total: 50000 },
];

export const NOMBRE_POR_DEFECTO = 'esta compra'; // en minúscula: derive lo usa en medio de frases ("Con esta compra...") y lo capitaliza al empezar una
export const CUOTAS_MIN = 2;
export const CUOTAS_MAX = 48;

const nn = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const clampInt = (v, min, max) => Math.min(max, Math.max(min, Math.round(Number(v)) || min));
const isKey = (k) => typeof k === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(k);
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// ------------------------------------------------------------------ el formulario
/** Formulario nuevo. `anchor` = cuál de los dos campos (precio total o cada cuota) es el que mandó por última vez. */
export function formNuevo(start) {
  return { start, nombre: '', modo: 'una', total: null, cuotas: 6, cuota: null, porMes: null, anchor: 'total', desde: start };
}

/** Un ejemplo tocable pasa a ser el formulario (conserva el mes elegido). */
export function formDesdeEjemplo(ej, start, desde = start) {
  const f = { ...formNuevo(start), nombre: ej.nombre, modo: ej.modo, total: ej.total, desde };
  if (ej.modo === 'cuotas') {
    f.cuotas = clampInt(ej.cuotas, CUOTAS_MIN, CUOTAS_MAX);
    f.cuota = Math.round(ej.total / f.cuotas);
  }
  return f;
}

/**
 * Los dos sentidos de "precio total <-> cuotas de $X": si lo último que escribió fue el total, la cuota se calcula
 * (total / cuotas); si fue la cuota, el total se calcula (cuota x cuotas). Devuelve los números coherentes.
 * @returns {{cuotas:number, total:number, cuota:number, porMes:number}}
 */
export function valores(form) {
  const n = clampInt(form.cuotas, CUOTAS_MIN, CUOTAS_MAX);
  if (form.modo === 'mensual') return { cuotas: 1, total: 0, cuota: 0, porMes: nn(form.porMes) };
  if (form.modo === 'cuotas') {
    if (form.anchor === 'cuota') {
      const c = nn(form.cuota);
      return { cuotas: n, total: c * n, cuota: c, porMes: 0 };
    }
    const t = nn(form.total);
    return { cuotas: n, total: t, cuota: Math.round(t / n), porMes: 0 };
  }
  const t = nn(form.total);
  return { cuotas: 1, total: t, cuota: t, porMes: 0 };
}

/** Pone en el formulario los campos calculados (para que lo que se ve y lo que se calcula sean lo mismo). */
export function sincronizar(form) {
  if (form.modo !== 'cuotas') return form;
  const v = valores(form);
  form.cuotas = v.cuotas;
  if (form.anchor === 'cuota') form.total = v.total || null;
  else form.cuota = v.cuota || null;
  return form;
}

/** ¿Ya escribió cuánto cuesta? */
export function hayPrecio(form) {
  const v = valores(form);
  return form.modo === 'mensual' ? v.porMes > 0 : v.total > 0;
}

/** Línea en vivo del modo cuotas: "6 cuotas de $100.000 = $600.000 en total". null si todavía no hay precio. */
export function resumenCuotas(form, money) {
  const v = valores(form);
  if (form.modo !== 'cuotas' || !(v.total > 0)) return null;
  const exacto = Math.round(v.cuota) * v.cuotas === Math.round(v.total);
  return `${v.cuotas} cuotas de ${exacto ? '' : 'unos '}${money(v.cuota)} = ${money(v.total)} en total`;
}

/**
 * El gasto tal como lo entiende derive.veredicto / mapaMeses / topeSinCosto: { nombre, modo, monto, desde, cuotas, montoCuota? }.
 * 'una': monto = precio total · 'cuotas': monto = precio total (o montoCuota si lo último que escribió fue la cuota) · 'mensual': monto = por mes.
 * paraGuardar: el nombre vacío queda como "Compra" (para la lista de compras planificadas) en vez de "Esta compra".
 */
export function armarGasto(form, start, { paraGuardar = false } = {}) {
  const v = valores(form);
  const nombre = (form.nombre || '').trim() || (paraGuardar ? 'Compra' : NOMBRE_POR_DEFECTO);
  const desde = isKey(form.desde) && form.desde >= start ? form.desde : start;
  if (form.modo === 'mensual') return { nombre, modo: 'mensual', monto: v.porMes, desde };
  if (form.modo === 'cuotas') {
    const g = { nombre, modo: 'cuotas', monto: v.total, cuotas: v.cuotas, desde };
    if (form.anchor === 'cuota') g.montoCuota = v.cuota;
    return g;
  }
  return { nombre, modo: 'una', monto: v.total, desde };
}

/** Los 12 meses del mapa: ['2026-10', ..., '2027-09']. */
export const clavesDoce = (start) => Array.from({ length: 12 }, (_, i) => addMonths(start, i));

/** Reparte los meses en filas (4 por fila en el celular: se ven los 12 sin deslizar hacia el costado). */
export function enFilas(list, porFila) {
  const out = [];
  for (let i = 0; i < list.length; i += porFila) out.push(list.slice(i, i + porFila));
  return out;
}

// ------------------------------------------------------------------ cómo se leen los resultados de derive
/** derive repite el título al principio del texto ("Se puede, pero tiene costo. Un viaje..."): acá se muestra una sola vez. */
export function sinTitulo(titulo, texto) {
  let t = String(texto || '').trim();
  const ti = String(titulo || '').trim();
  if (ti && t.startsWith(ti)) t = t.slice(ti.length).replace(/^[\s.:,;-]+/, '');
  return t.trim();
}

/**
 * Filas del veredicto: las de derive, salvo el "Interés extra" cuando la tarjeta deja de terminarse
 * (un número de miles de millones no le sirve a nadie: ya lo dice la fila "No se termina").
 * @returns {{label:string, value:string, strong?:boolean}[]}
 */
export function filasVeredicto(v) {
  const nunca = !!v.salidaAntes && !v.salidaDespues;
  return (v.filas || [])
    .filter((f) => !(nunca && /^Interés extra/.test(f.k)))
    .map((f) => ({ label: f.k, value: f.v, strong: /^Interés extra/.test(f.k) }));
}

/** Frase para el caso "Entra sin problemas" (derive solo trae el título). `mes` = "abril 2027". */
export function textoVerde(mes, modo = 'una') {
  const cuando = modo === 'una' ? `Si la pagás en ${mes}` : `Si empezás a pagarla en ${mes}`;
  return `${cuando}, no cambia cuándo salís de la tarjeta, casi no suma interés y no deja ningún mes más ajustado.`;
}

/** Cuánto queda el mes elegido con la compra (de la tira antes/después del veredicto); null si no se sabe. */
export function quedaEnMes(v, key) {
  const f = (v.antesDespues || []).find((x) => x.key === key) || null;
  if (f) return f.despues;
  return v.mesPeor ? v.mesPeor.free : null;
}

/**
 * La respuesta a "¿Cuánto puedo gastar en {mes} sin que me cueste?" lista para mostrar.
 * @param {object} tope  derive.topeSinCosto(...)
 * @param {{money:(n:number)=>string}} f
 * @returns {{titulo:string, lineas:string[], sugerido:number, sugeridoConInteres:boolean, destacado:string|null}}
 */
export function vistaTope(tope, f) {
  const { money } = f;
  const lineas = [];
  const unidad = tope.modo === 'mensual' ? ' por mes' : '';
  let destacado = null;
  let sugerido = 0;
  let sugeridoConInteres = false;
  if (tope.sinCosto > 0) {
    destacado = `Hasta ${money(tope.sinCosto)}${unidad}`;
    lineas.push(tope.modo === 'cuotas' ? `en total, en ${tope.mesNombre}, sin que te cueste nada.` : `en ${tope.mesNombre}, sin que te cueste nada.`);
    if (tope.modo === 'cuotas') lineas.push(`En ${tope.cuotas} cuotas: hasta ${money(tope.porMesSinCosto)} por mes sin problema.`);
    sugerido = tope.sinCosto;
  } else {
    lineas.push(tope.texto);
    if (tope.sinFaltar > 0) {
      if (tope.textoSinFaltar) lineas.push(tope.textoSinFaltar);
      if (tope.modo === 'cuotas' && tope.porMesSinFaltar > 0) lineas.push(`Si no te importa pagar interés, podés llegar a ${money(tope.porMesSinFaltar)} por mes.`);
      sugerido = tope.sinFaltar;
      sugeridoConInteres = true;
    }
  }
  return { titulo: `¿Cuánto puedo gastar en ${tope.mesNombre} sin que me cueste?`, lineas, sugerido, sugeridoConInteres, destacado };
}

/** Una compra planificada en una línea: "6 cuotas de $100.000 desde abril 2027". f = { money, mes } */
export function describirCompra(p, f) {
  const desde = f.mes(p.desde);
  if (p.modo === 'cuotas') {
    const n = Math.max(1, Number(p.cuotas) || 1);
    const c = p.montoCuota > 0 ? p.montoCuota : p.amount / n;
    return `${n} cuotas de ${f.money(c)} desde ${desde}`;
  }
  if (p.modo === 'mensual') return `${f.money(p.amount)} por mes desde ${desde}`;
  return `${f.money(p.amount)} en ${desde}`;
}

/** Texto de lo que se anota (hoja "Lo voy a hacer"): [{label, value}]. f = { money, mes } */
export function filasResumenCompra(form, start, f) {
  const g = armarGasto(form, start, { paraGuardar: true });
  const v = valores(form);
  let cuanto;
  if (g.modo === 'cuotas') cuanto = `${v.cuotas} cuotas de ${f.money(v.cuota)}`;
  else if (g.modo === 'mensual') cuanto = `${f.money(v.porMes)} por mes`;
  else cuanto = f.money(v.total);
  const filas = [
    { label: 'Qué', value: g.nombre },
    { label: 'Cuánto', value: cuanto },
  ];
  if (g.modo === 'cuotas') filas.push({ label: 'Total', value: f.money(v.total) });
  filas.push({ label: g.modo === 'una' ? 'En' : 'Desde', value: cap(f.mes(g.desde)) });
  return filas;
}
