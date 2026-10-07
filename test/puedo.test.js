// Pantalla "Probá antes de gastar": lógica del formulario (precio total <-> cuotas, armado del gasto, lectura de los
// resultados) y escenarios sobre el ejemplo ilustrativo. Los valores esperados salen de correr el motor sobre demo()
// con hoy = 4 de octubre de 2026 y están congelados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demo } from '../src/demo.js';
import { emptyState, crearCompraPlanificada, marcarCompraHecha } from '../src/store.js';
import * as D from '../src/derive.js';
import * as L from '../src/ui/screens/_puedo-logic.js';

const HOY = new Date('2026-10-04T12:00:00');
const START = '2026-10';
const money = (n) => `$${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
const mes = (k) => ({ '2026-12': 'diciembre 2026', '2027-02': 'febrero 2027', '2027-04': 'abril 2027' }[k] || k);
const form = (o = {}) => ({ ...L.formNuevo(START), ...o });

// ---------------------------------------------------------------- precio total <-> cuotas
test('precio total y cuotas: si manda el total, la cuota se calcula', () => {
  const f = form({ modo: 'cuotas', total: 600000, cuotas: 6, anchor: 'total' });
  L.sincronizar(f);
  assert.equal(f.cuota, 100000);
  assert.deepEqual(L.valores(f), { cuotas: 6, total: 600000, cuota: 100000, porMes: 0 });
});

test('precio total y cuotas: si manda la cuota, el total se calcula', () => {
  const f = form({ modo: 'cuotas', cuota: 45000, cuotas: 6, anchor: 'cuota' });
  L.sincronizar(f);
  assert.equal(f.total, 270000);
  f.cuotas = 10; // cambiar la cantidad de cuotas mueve el total, no la cuota
  L.sincronizar(f);
  assert.equal(f.total, 450000);
  assert.equal(f.cuota, 45000);
});

test('precio total y cuotas: cambiar las cuotas con el total fijo recalcula la cuota', () => {
  const f = form({ modo: 'cuotas', total: 600000, cuotas: 6, anchor: 'total' });
  f.cuotas = 12;
  L.sincronizar(f);
  assert.equal(f.cuota, 50000);
  assert.equal(f.total, 600000);
});

test('las cuotas quedan entre 2 y 48', () => {
  assert.equal(L.valores(form({ modo: 'cuotas', total: 100, cuotas: 1 })).cuotas, 2);
  assert.equal(L.valores(form({ modo: 'cuotas', total: 100, cuotas: 500 })).cuotas, 48);
});

test('resumen en vivo de las cuotas', () => {
  assert.equal(L.resumenCuotas(form({ modo: 'cuotas', total: 600000, cuotas: 6 }), money), '6 cuotas de $100.000 = $600.000 en total');
  assert.equal(L.resumenCuotas(form({ modo: 'cuotas', total: 100000, cuotas: 3 }), money), '3 cuotas de unos $33.333 = $100.000 en total');
  assert.equal(L.resumenCuotas(form({ modo: 'cuotas', total: null, cuotas: 6 }), money), null);
  assert.equal(L.resumenCuotas(form({ modo: 'una', total: 5 }), money), null);
});

test('hayPrecio: depende del modo', () => {
  assert.equal(L.hayPrecio(form()), false);
  assert.equal(L.hayPrecio(form({ total: 1000 })), true);
  assert.equal(L.hayPrecio(form({ modo: 'cuotas', cuota: 100, anchor: 'cuota' })), true);
  assert.equal(L.hayPrecio(form({ modo: 'cuotas', cuota: 100, anchor: 'total' })), false);
  assert.equal(L.hayPrecio(form({ modo: 'mensual', total: 9999 })), false);
  assert.equal(L.hayPrecio(form({ modo: 'mensual', porMes: 5000 })), true);
});

// ---------------------------------------------------------------- armado del gasto
test('armarGasto: de una vez, en cuotas y todos los meses', () => {
  assert.deepEqual(L.armarGasto(form({ nombre: 'Viaje', total: 300000, desde: '2026-12' }), START), { nombre: 'Viaje', modo: 'una', monto: 300000, desde: '2026-12' });
  assert.deepEqual(L.armarGasto(form({ nombre: 'Heladera', modo: 'cuotas', total: 600000, cuotas: 6 }), START), { nombre: 'Heladera', modo: 'cuotas', monto: 600000, cuotas: 6, desde: START });
  assert.deepEqual(L.armarGasto(form({ modo: 'cuotas', cuota: 45000, cuotas: 6, anchor: 'cuota' }), START), { nombre: 'esta compra', modo: 'cuotas', monto: 270000, cuotas: 6, desde: START, montoCuota: 45000 });
  assert.deepEqual(L.armarGasto(form({ modo: 'mensual', porMes: 50000, desde: '2027-01' }), START), { nombre: 'esta compra', modo: 'mensual', monto: 50000, desde: '2027-01' });
});

test('armarGasto: nombre vacío y mes pasado', () => {
  assert.equal(L.armarGasto(form({ total: 1 }), START).nombre, 'esta compra');
  assert.equal(L.armarGasto(form({ total: 1 }), START, { paraGuardar: true }).nombre, 'Compra');
  assert.equal(L.armarGasto(form({ total: 1, desde: '2026-01' }), START).desde, START); // nunca antes del mes actual
  assert.equal(L.armarGasto(form({ total: 1, desde: 'basura' }), START).desde, START);
});

test('un ejemplo tocable deja el formulario listo (y con la cuota calculada)', () => {
  const heladera = L.EJEMPLOS.find((e) => e.id === 'heladera');
  const f = L.formDesdeEjemplo(heladera, START, '2026-12');
  assert.equal(f.modo, 'cuotas');
  assert.equal(f.cuota, 100000);
  assert.equal(f.desde, '2026-12');
  assert.equal(L.hayPrecio(f), true);
});

test('los 12 meses del mapa y su reparto en filas', () => {
  const k = L.clavesDoce(START);
  assert.equal(k.length, 12);
  assert.equal(k[0], '2026-10');
  assert.equal(k[3], '2027-01');
  assert.equal(k[11], '2027-09');
  assert.deepEqual(L.enFilas(k, 4).map((f) => f.length), [4, 4, 4]);
});

// ---------------------------------------------------------------- escenarios sobre el ejemplo
const S = demo(HOY);
const ver = (gasto, opts) => D.veredicto(S, gasto, HOY, opts);

test('un gasto chico lejos de la tarjeta entra sin problemas', () => {
  const v = ver(L.armarGasto(form({ total: 20000, desde: '2027-06' }), START));
  assert.equal(v.vacio, false);
  assert.equal(v.codigo, 'verde');
  assert.equal(v.titulo, 'Entra sin problemas');
});

test('un viaje en diciembre se puede pero tiene costo (interés extra congelado)', () => {
  const g = L.armarGasto(form({ nombre: 'Viaje', total: 300000, desde: '2026-12' }), START);
  const v = ver(g);
  assert.equal(v.codigo, 'ambar');
  assert.equal(Math.round(v.extraInterest), 83517);
  assert.equal(v.salidaDespuesTexto, 'abril 2027');
  assert.equal(L.quedaEnMes(v, '2026-12'), 234363.63636363624);
  assert.match(v.siLoNecesitas.texto, /^Si igual lo necesitás, lo mejor es abril/);
});

test('un gasto grande en un mes que ya venía ajustado es terracota', () => {
  const v = ver(L.armarGasto(form({ total: 300000, desde: '2027-01' }), START));
  assert.equal(v.codigo, 'terracota');
  assert.match(v.texto, /^No conviene ahora\. Enero ya venía con un faltante de \$202\.000/);
});

test('cuotas: la heladera en 6 cuotas desde octubre no conviene; desde abril entra sin problemas', () => {
  const f = form({ nombre: 'Heladera', modo: 'cuotas', total: 600000, cuotas: 6 });
  assert.equal(ver(L.armarGasto({ ...f, desde: '2026-10' }, START)).codigo, 'terracota');
  assert.equal(ver(L.armarGasto({ ...f, desde: '2027-04' }, START)).codigo, 'verde');
});

test('cuotas: escribir la cuota o el total da el mismo veredicto', () => {
  const a = ver(L.armarGasto(form({ modo: 'cuotas', total: 600000, cuotas: 6, desde: '2027-04' }), START));
  const b = ver(L.armarGasto(form({ modo: 'cuotas', cuota: 100000, cuotas: 6, anchor: 'cuota', desde: '2027-04' }), START));
  assert.equal(a.codigo, b.codigo);
  assert.equal(Math.round(a.costoTotal), Math.round(b.costoTotal));
  assert.equal(Math.round(a.extraInterest), Math.round(b.extraInterest));
});

test('todos los meses: el gasto mensual NO queda en cero (arreglo en adapter.normalizarGasto)', () => {
  const g = L.armarGasto(form({ modo: 'mensual', porMes: 50000, desde: '2026-12' }), START);
  const v = ver(g);
  assert.equal(v.vacio, false);
  assert.ok(v.costoTotal > 0);
  assert.equal(v.codigo, 'terracota'); // enero ya venía con faltante
  const m = D.mapaMeses(S, g, HOY);
  assert.equal(m.vacio, false);
  assert.deepEqual(m.meses.map((x) => x.codigo[0]), ['t', 't', 't', 't', 't', 'a', 'v', 'v', 'v', 'v', 'v', 'v']);
  // un gasto ya normalizado vuelve a normalizarse igual (antes quedaba en $0)
  const n = D.normalizarGasto(g, START);
  assert.equal(D.normalizarGasto(n, START).montoCuota, 50000);
  assert.deepEqual(D.gastoAExtras(n, START)[0].amount, 50000);
});

test('sin precio no hay veredicto ni mapa (vacio)', () => {
  const g = L.armarGasto(form(), START);
  assert.equal(ver(g).vacio, true);
  assert.equal(D.mapaMeses(S, g, HOY).vacio, true);
});

test('mapa de meses del viaje: forma y palabra de cada mes', () => {
  const m = D.mapaMeses(S, L.armarGasto(form({ total: 300000, desde: '2026-12' }), START), HOY);
  assert.deepEqual(m.meses.map((x) => x.codigo[0]), ['t', 't', 'a', 't', 't', 't', 'a', 'a', 'v', 'a', 'v', 'v']);
  assert.deepEqual([...new Set(m.meses.map((x) => `${x.codigo}:${x.glifo}:${x.etiqueta}`))].sort(), ['ambar:cuadrado:Con costo', 'terracota:triangulo:No conviene', 'verde:circulo:Sin costo']);
  assert.equal(m.mejorMomento.key, '2027-04');
});

test('pregunta inversa: hasta cuánto puedo gastar en diciembre sin que me cueste', () => {
  const t = D.topeSinCosto(S, '2026-12', { modo: 'una', today: HOY });
  assert.equal(t.sinCosto, 0);
  assert.equal(t.sinFaltar, 534000);
  const vt = L.vistaTope(t, { money });
  assert.equal(vt.titulo, '¿Cuánto puedo gastar en diciembre sin que me cueste?');
  assert.equal(vt.destacado, null);
  assert.equal(vt.sugerido, 534000);
  assert.equal(vt.sugeridoConInteres, true);
  assert.ok(vt.lineas[0].startsWith('En diciembre no hay plata que no cueste'));

  const lejos = D.topeSinCosto(S, '2027-06', { modo: 'una', today: HOY });
  const vl = L.vistaTope(lejos, { money });
  assert.equal(lejos.sinCosto, 722000);
  assert.equal(vl.destacado, 'Hasta $722.000');
  assert.equal(vl.sugeridoConInteres, false);
  assert.deepEqual(vl.lineas, ['en junio, sin que te cueste nada.']);

  const cuotas = L.vistaTope(D.topeSinCosto(S, '2027-06', { modo: 'cuotas', cuotas: 6, today: HOY }), { money });
  assert.match(cuotas.lineas[1], /^En 6 cuotas: hasta \$\d+\.000 por mes sin problema\.$/);
});

test('línea bajo el mapa: "Hasta $X por mes sin problema" según cómo se paga', () => {
  const una = L.lineaMes(D.topeSinCosto(S, '2027-06', { modo: 'una', today: HOY }), { money });
  assert.equal(una, 'En junio: hasta $722.000 sin problema.');
  const cuotas = L.lineaMes(D.topeSinCosto(S, '2027-06', { modo: 'cuotas', cuotas: 6, today: HOY }), { money });
  assert.match(cuotas, /^En junio: hasta \$\d+\.000 por mes sin problema\.$/);
  const mensual = L.lineaMes(D.topeSinCosto(S, '2027-06', { modo: 'mensual', today: HOY }), { money });
  assert.match(mensual, /^En junio: hasta \$\d+\.000 por mes sin problema\.$/);
  // un mes en el que todo suma interés lo dice sin dar un número inventado
  assert.equal(L.lineaMes(D.topeSinCosto(S, '2026-12', { modo: 'una', today: HOY }), { money }), 'En diciembre: cualquier gasto suma interés.');
  assert.equal(L.lineaMes(null, { money }), null);
});

// ---------------------------------------------------------------- lectura de los resultados de derive
test('sinTitulo: el título no se repite al principio del texto', () => {
  assert.equal(L.sinTitulo('Se puede, pero tiene costo', 'Se puede, pero tiene costo. Un viaje te sale $1.'), 'Un viaje te sale $1.');
  assert.equal(L.sinTitulo('No conviene ahora', 'No conviene ahora. Con esto, te faltarían $5.'), 'Con esto, te faltarían $5.');
  assert.equal(L.sinTitulo('Entra sin problemas', 'Entra sin problemas.'), '');
  assert.equal(L.sinTitulo('Otro título', 'Texto distinto'), 'Texto distinto');
});

test('filasVeredicto: no muestra un interés absurdo cuando la tarjeta deja de terminarse', () => {
  const g = L.armarGasto(form({ modo: 'mensual', porMes: 500000, desde: '2026-10' }), START);
  const v = ver(g, { conTope: false });
  assert.equal(v.salidaDespues, null);
  const filas = L.filasVeredicto(v);
  assert.ok(v.filas.some((f) => /^Interés extra/.test(f.k)), 'derive lo trae');
  assert.ok(!filas.some((f) => /^Interés extra/.test(f.label)), 'la pantalla no lo muestra');
  assert.ok(filas.some((f) => f.value === 'No se termina'));
  // en el caso normal sí está
  const normal = L.filasVeredicto(ver(L.armarGasto(form({ total: 300000, desde: '2026-12' }), START), { conTope: false }));
  assert.deepEqual(normal.map((f) => f.label), ['Diciembre queda en', 'Salís de la tarjeta', 'Interés extra']);
});

test('textoVerde: sin tarjeta con deuda no habla de la tarjeta', () => {
  const sinDeuda = structuredClone(S); sinDeuda.debts = []; sinDeuda.receivables = [];
  const v = D.veredicto(sinDeuda, L.armarGasto(form({ total: 20000, desde: '2026-12' }), START), HOY);
  assert.equal(v.codigo, 'verde');
  assert.equal(L.hayTarjetaEnVeredicto(v), false);
  assert.ok(!/tarjeta/.test(L.textoVerde('diciembre 2026', 'una', { conTarjeta: false })));
  const conDeuda = ver(L.armarGasto(form({ total: 20000, desde: '2027-06' }), START));
  assert.equal(L.hayTarjetaEnVeredicto(conDeuda), true);
  assert.match(L.textoVerde('junio 2027', 'una', { conTarjeta: true }), /salís de la tarjeta/);
});

test('textoVerde dice en qué mes', () => {
  assert.equal(L.textoVerde('abril 2027', 'una').startsWith('Si la pagás en abril 2027,'), true);
  assert.equal(L.textoVerde('abril 2027', 'cuotas').startsWith('Si empezás a pagarla en abril 2027,'), true);
});

test('describirCompra y resumen de lo que se anota', () => {
  const f = { money, mes };
  assert.equal(L.describirCompra({ amount: 200000, modo: 'una', desde: '2026-12', cuotas: 1 }, f), '$200.000 en diciembre 2026');
  assert.equal(L.describirCompra({ amount: 600000, modo: 'cuotas', desde: '2027-02', cuotas: 6 }, f), '6 cuotas de $100.000 desde febrero 2027');
  assert.equal(L.describirCompra({ amount: 600000, modo: 'cuotas', desde: '2027-02', cuotas: 6, montoCuota: 110000 }, f), '6 cuotas de $110.000 desde febrero 2027');
  assert.equal(L.describirCompra({ amount: 50000, modo: 'mensual', desde: '2026-12', cuotas: 1 }, f), '$50.000 por mes desde diciembre 2026');
  const filas = L.filasResumenCompra(form({ nombre: 'Heladera', modo: 'cuotas', total: 600000, cuotas: 6, desde: '2027-02' }), START, f);
  assert.deepEqual(filas.map((x) => `${x.label}: ${x.value}`), ['Qué: Heladera', 'Cuánto: 6 cuotas de $100.000', 'Total: $600.000', 'Desde: Febrero 2027']);
});

// ---------------------------------------------------------------- "Lo voy a hacer": compra planificada, sin duplicar
test('Lo voy a hacer crea una compra planificada y no un gasto anotado', () => {
  const d = structuredClone(S);
  const gastosAntes = d.spent.length;
  const g = L.armarGasto(form({ nombre: 'Heladera', modo: 'cuotas', total: 600000, cuotas: 6, desde: '2027-04' }), START, { paraGuardar: true });
  const id = crearCompraPlanificada(d, g);
  assert.equal(d.plannedPurchases.length, 1);
  assert.equal(d.spent.length, gastosAntes, 'no toca los gastos anotados (no se duplica)');
  assert.deepEqual(d.plannedPurchases[0], { id, name: 'Heladera', amount: 600000, modo: 'cuotas', desde: '2027-04', cuotas: 6, hecha: false });
  // el plan la cuenta una sola vez: 100.000 por mes en abril, no más
  const antes = D.run(S, { today: HOY }).months;
  const despues = D.run(d, { today: HOY }).months;
  assert.equal(Math.round(despues[5].expenses - antes[5].expenses), 0); // marzo: todavía nada
  assert.equal(Math.round(despues[6].expenses - antes[6].expenses), 100000); // abril: la primera cuota
  const extra = despues.slice(0, 12).reduce((a, m, i) => a + m.expenses - antes[i].expenses, 0);
  assert.equal(Math.round(extra), 600000); // las 6 cuotas, una sola vez
  // marcarla hecha tampoco crea un gasto aparte
  marcarCompraHecha(d, id, HOY);
  assert.equal(d.plannedPurchases[0].hecha, true);
  assert.equal(d.spent.length, gastosAntes);
});

test('sin datos no hay nada que probar: hero lo avisa y la pantalla muestra el vacío', () => {
  assert.equal(D.hero(emptyState(HOY), HOY).estado, 'sinDatos');
});
