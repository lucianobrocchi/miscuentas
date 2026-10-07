// Lógica pura de Deudas, Tarjeta y Me deben (src/ui/screens/_deudas-logic.js). Fixture: demo() con hoy = 4 de octubre de 2026.
// Los valores esperados se generaron corriendo la lógica sobre el ejemplo y se congelaron.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demo } from '../src/demo.js';
import * as D from '../src/derive.js';
import * as F from '../src/format.js';
import * as L from '../src/ui/screens/_deudas-logic.js';

const T = new Date('2026-10-04T12:00:00');
const fresco = () => { D.limpiarMemo(); return demo(T); };
const PROHIBIDAS = [/colch[oó]n/i, /pl[aá]stico/i, /financiaci[oó]n/i, /moroso/i, /liber[aá]s/i, /5 minutos/i, /\$5\.744 por d[ií]a/i, /\bJusto\b/, /Cuándo te liber/i];
const sinProhibidas = (texto) => PROHIBIDAS.forEach((re) => assert.doesNotMatch(String(texto), re, String(texto)));

// ------------------------------------------------------------------------------------------------ línea de tiempo
test('lineaDeTiempo: una fila por deuda, con fechas de fin, puntos de cuotas y la deuda sin datos como "a completar"', () => {
  const s = fresco();
  const lib = D.liberaciones(s, T);
  const lt = L.lineaDeTiempo(lib, D.salidaTarjeta(s, T), s, F, '2026-10');
  assert.deepEqual(lt.filas.map((f) => f.id), ['demo-visa', 'demo-prestamo-a', 'demo-prestamo-b', 'afip']);
  assert.deepEqual(lt.filas.map((f) => f.dateLabel), ['marzo 2027', 'julio 2027', 'febrero 2029', 'a completar']);
  assert.equal(lt.from, '2026-10');
  assert.equal(lt.to, '2029-03');
  assert.equal(lt.filas[0].sub, 'Debés $1.800.000 · fecha provisoria');
  assert.equal(lt.filas[1].sub, 'Cuota de $80.000 · quedan 10 de 36 cuotas · se descuenta del sueldo');
  assert.equal(lt.filas[3].pending, true);
  assert.equal(lt.filas[3].sub, 'Falta cargar monto y cuotas');
  // más de 12 cuotas: sin puntos (el dato va en palabras); hasta 12: puntos
  assert.equal(lt.filas[1].pipsInfo, null);
  s.installments.push({ id: 'c1', name: 'Heladera', owner: 'Vos', amount: 45000, remaining: 6, first: '2026-10', total: 12 });
  D.limpiarMemo();
  const lt2 = L.lineaDeTiempo(D.liberaciones(s, T), D.salidaTarjeta(s, T), s, F, '2026-10');
  const hel = lt2.filas.find((f) => f.id === 'c1');
  assert.deepEqual(hel.pipsInfo, { total: 12, paid: 6 });
  assert.equal(hel.sub, 'Cuota de $45.000 · quedan 6 de 12 cuotas');
  lt2.filas.forEach((f) => sinProhibidas(f.sub + f.ariaLabel));
});

test('lineaDeTiempo: si la tarjeta no se termina nunca se dice con palabras y la barra llega al final del eje', () => {
  const s = fresco();
  s.debts[0].balance = 20000000; s.debts[0].statement.total = 20000000; s.debts[0].statement.min = 300000; s.debts[0].minPayment = 300000;
  D.limpiarMemo();
  const lt = L.lineaDeTiempo(D.liberaciones(s, T), D.salidaTarjeta(s, T), s, F, '2026-10');
  const visa = lt.filas.find((f) => f.id === 'demo-visa');
  assert.equal(visa.sinFin, true);
  assert.equal(visa.dateLabel, 'Todavía no termina');
  assert.equal(visa.end, lt.to);
  assert.doesNotMatch(visa.sub, /provisoria/);          // sin fecha no hay "fecha provisoria"
});

test('destinoLinea: tarjeta abre su pantalla, cuotas abren su editor, lo pendiente lleva al paso de planilla', () => {
  const s = fresco();
  const items = D.liberaciones(s, T).items;
  const por = (id) => items.find((i) => i.id === id);
  assert.deepEqual(L.destinoLinea(por('demo-visa'), s), { tipo: 'nav', hash: '#/deudas/tarjeta' });
  assert.deepEqual(L.destinoLinea(por('demo-prestamo-a'), s), { tipo: 'editor', kind: 'installment', id: 'demo-prestamo-a' });
  assert.deepEqual(L.destinoLinea(por('afip'), s), { tipo: 'nav', hash: '#/armar/5' });
  // otra deuda que no es tarjeta: editor de deuda
  s.debts.push({ id: 'otro', name: 'Préstamo del banco', kind: 'loan', balance: 100000, rate: 3, minPayment: 20000, statement: null, payments: [], planned: {}, holders: [] });
  assert.deepEqual(L.destinoLinea({ id: 'otro', tipo: 'tarjeta' }, s), { tipo: 'editor', kind: 'debt', id: 'otro' });
});

test('escaleraFilas: los montos son los de derive y cada fila dice qué termina', () => {
  const s = fresco();
  const lib = D.liberaciones(s, T);
  const filas = L.escaleraFilas(lib, F);
  assert.deepEqual(filas.map((f) => f.monto), lib.escalera.map((e) => e.monto));
  assert.deepEqual(filas.map((f) => f.titulo), ['Desde abril 2027', 'Desde agosto 2027', 'Desde marzo 2029']);
  assert.equal(filas[0].sub, 'Ya no pagás la tarjeta');
  assert.equal(filas[1].sub, 'Termina: Préstamo personal');
  filas.forEach((f) => sinProhibidas(f.titulo + f.sub + f.texto));
});

test('pieDeudas y detalleDeudas: dicen solo lo que existe', () => {
  const s = fresco();
  assert.equal(L.pieDeudas(D.liberaciones(s, T), F), 'Te falta pagar por planilla $1.148.000 en total (sin el plan de AFIP, que falta cargar).');
  const sobre = D.deudaSobreIngreso(s, T);
  assert.equal(L.textoHoyDeudas(sobre), 'Hoy, $31 de cada $100 que cobrás van a deudas.');
  assert.equal(L.detalleDeudas(sobre, F), sobre.detalle);
  assert.equal(L.detalleDeudas({ deudas: 92000, tarjetaMinimo: 0, prestamos: 92000 }, F), '$92.000 por mes de préstamos y cuotas.');
  assert.equal(L.detalleDeudas({ deudas: 270000, tarjetaMinimo: 270000, prestamos: 0 }, F), '$270.000 por mes de la tarjeta (mínimo).');
  assert.equal(L.detalleDeudas({ deudas: 0, tarjetaMinimo: 0, prestamos: 0 }, F), null);
});

test('pendientesDeudas: solo AFIP y planilla, con el texto del adaptador', () => {
  const s = fresco();
  const p = L.pendientesDeudas(D.toEngine(s, T).flags.motivosDetalle);
  assert.equal(p.length, 1);
  assert.equal(p[0].code, 'afip');
  assert.equal(p[0].titulo, 'Falta un dato');
  assert.equal(p[0].hash, '#/armar/5');
});

// ------------------------------------------------------------------------------------------------ tarjeta
test('tarjetaElegida: la de ?id= o la primera', () => {
  const s = fresco();
  assert.equal(L.tarjetaElegida(s, null).debt.id, 'demo-visa');
  assert.equal(L.tarjetaElegida(s, 'no-existe').debt.id, 'demo-visa');
  assert.equal(L.tarjetaElegida({ ...s, debts: [] }, null).debt, null);
});

test('chipsFechas y filasResumen: fechas reales del resumen cargado y lo pagado desde el cierre', () => {
  const s = fresco();
  const d = s.debts[0];
  const est = D.estadoResumen(d, T);
  assert.deepEqual(L.chipsFechas(est, F), ['Cerró el 28 de septiembre', 'Vence el 10 de octubre']);
  assert.deepEqual(L.filasResumen(d, est, D.pagosDelResumen(d), F).map((f) => [f.label, f.valor]), [['Pago mínimo', 270000], ['Consumos nuevos del resumen', 700000]]);
  d.payments = [{ id: 'p1', date: '2026-10-02', amount: 270000 }];
  d.balance = 1530000;
  const pagos = D.pagosDelResumen(d);
  const filas = L.filasResumen(d, est, pagos, F);
  assert.deepEqual(filas.slice(-2).map((f) => [f.label, f.valor]), [['Pagaste desde el cierre', 270000], ['Saldo de hoy', 1530000]]);
  assert.equal(L.textoPagado(pagos, F), 'Pagaste $270.000 el 2 de octubre.');
  assert.equal(L.textoPagado({ total: 0, pagos: [] }, F), null);
});

test('bannerViejo: con la fecha real del cierre que ya pasó', () => {
  const s = fresco();
  const tarde = new Date('2026-10-27T12:00:00');
  const est = D.estadoResumen(s.debts[0], tarde);
  assert.equal(est.viejo, true);
  const b = L.bannerViejo(est, F);
  assert.equal(b.title, 'Ya cerró un resumen nuevo');
  assert.match(b.text, /^Cerró el 26 de octubre\. Cargalo para ver el monto exacto/);
  sinProhibidas(b.title + b.text);
  assert.equal(L.bannerViejo({ hayResumen: false }, F), null);
});

test('subOpcionPago: nunca "Salís en No se termina" ni un interés absurdo', () => {
  const s = fresco();
  const e = D.escenariosPago(s, T);
  const min = e.opciones.find((o) => o.id === 'minimo');
  const sob = e.opciones.find((o) => o.id === 'sobra');
  assert.equal(L.subOpcionPago(min, F, min), 'Salís en julio 2027 · interés total $633.898');
  assert.equal(L.subOpcionPago(sob, F, min), 'Salís en marzo 2027 · ahorrás $233.730 de interés');
  // la deuda no se termina con ninguna opción
  s.debts[0].balance = 20000000; s.debts[0].statement.total = 20000000; s.debts[0].statement.min = 300000; s.debts[0].minPayment = 300000;
  D.limpiarMemo();
  const e2 = D.escenariosPago(s, T);
  const min2 = e2.opciones.find((o) => o.id === 'minimo');
  const sob2 = e2.opciones.find((o) => o.id === 'sobra');
  assert.equal(L.subOpcionPago(min2, F, min2), 'Con este pago la tarjeta no se termina en los próximos años');
  assert.equal(L.subOpcionPago(sob2, F, min2), 'Con este pago la tarjeta no se termina en los próximos años');
  // el mínimo no termina pero lo que sobra sí: no se muestra un ahorro de millones
  assert.equal(L.subOpcionPago({ id: 'sobra', monto: 500000, paidOn: '2028-05', salidaTexto: 'mayo 2028', ahorro: 4e9, totalInterest: 1e6 }, F, { monto: 300000, paidOn: null }), 'Salís en mayo 2028 · con el mínimo no se termina');
  // no sobra más que el mínimo
  assert.equal(L.subOpcionPago({ id: 'sobra', monto: 270000, paidOn: '2027-07', salidaTexto: 'julio 2027', ahorro: 0, totalInterest: 1 }, F, { monto: 270000, paidOn: '2027-07' }), 'Este mes no sobra más que el mínimo');
});

test('seriesCurva: cada línea termina donde llega a cero y la etiqueta es ese mes', () => {
  const s = fresco();
  const curva = D.curvaDeuda(s, T);
  const [plan, minimo] = L.seriesCurva(curva, F);
  assert.equal(plan.endLabel, 'marzo 2027');
  assert.equal(minimo.endLabel, 'julio 2027');
  assert.equal(plan.points[plan.points.length - 1].key, '2027-03');
  assert.equal(plan.points[plan.points.length - 1].value, 0);
  assert.ok(minimo.points.length > plan.points.length);
  assert.equal(plan.style, 'solid');
  assert.equal(minimo.style, 'dashed');
  assert.match(L.ariaCurva(curva, F), /llega a cero en marzo 2027 con tu plan, y en julio 2027 pagando solo el mínimo/);
});

test('filasTitulares: una fila por persona, con lo cargado y si ya figura en Me deben', () => {
  const s = fresco();
  const f = L.filasTitulares(s, s.debts[0]);
  assert.deepEqual(f.map((x) => [x.nombre, x.monto, x.enMeDeben]), [['Vos', null, false], ['Pareja', 300000, false], ['Hija', null, false], ['Hijo', 400000, true]]);
  assert.deepEqual(f.map((x) => x.index), [0, 1, 2, 3]);
});

test('fijarTitular: carga, cambia y saca a una persona del reparto (muta el borrador)', () => {
  const s = fresco();
  assert.equal(L.fijarTitular(s, 'demo-visa', 'demo-hija', 250000), true);
  assert.deepEqual(s.debts[0].holders.find((h) => h.personId === 'demo-hija'), { personId: 'demo-hija', amount: 250000 });
  L.fijarTitular(s, 'demo-visa', 'demo-hija', 300000);
  assert.equal(s.debts[0].holders.filter((h) => h.personId === 'demo-hija').length, 1);
  L.fijarTitular(s, 'demo-visa', 'demo-hija', 0);
  assert.equal(s.debts[0].holders.some((h) => h.personId === 'demo-hija'), false);
  assert.equal(L.fijarTitular(s, 'no-existe', 'demo-hija', 5), false);
  const t = D.titularesTarjeta(s);
  assert.equal(t.texto, 'Faltan $1.100.000');
});

test('pasarAMeDeben: crea la cuenta con el monto de esa persona, y no duplica', () => {
  const s = fresco();
  const antes = s.receivables.length;
  const r = L.pasarAMeDeben(s, 'demo-visa', 'demo-pareja', 300000);
  assert.equal(r.ok, true);
  assert.equal(s.receivables.length, antes + 1);
  assert.deepEqual({ person: r.receivable.person, personId: r.receivable.personId, balance: r.receivable.balance, rate: r.receivable.rate, monthlyPayment: r.receivable.monthlyPayment },
    { person: 'Pareja', personId: 'demo-pareja', balance: 300000, rate: 0, monthlyPayment: 0 });
  assert.equal(L.pasarAMeDeben(s, 'demo-visa', 'demo-pareja', 300000).motivo, 'existe');
  assert.equal(s.receivables.length, antes + 1);
  assert.equal(L.pasarAMeDeben(s, 'demo-visa', 'demo-hija', 0).motivo, 'sinMonto');
  assert.equal(L.pasarAMeDeben(s, 'demo-visa', 'nadie', 100).motivo, 'sinPersona');
  // lo que debe la pareja ahora aparece en Me deben
  D.limpiarMemo();
  assert.equal(D.meDeben(s, T).total, 700000);
});

test('avisoCalendario: dice cuándo avisa y funciona sin internet', () => {
  const s = fresco();
  const ics = D.icsVencimiento(s, T);
  assert.equal(L.textoAvisoCalendario(ics, F), 'Te avisa 2 días antes del vencimiento (el 10 de octubre), a las 9. Funciona sin internet.');
  assert.equal(L.textoAvisoCalendario({ ok: false }, F), null);
});

// ------------------------------------------------------------------------------------------------ me deben
test('quienPaga: ninguno, uno o varios; el índice sirve para el alias del modo privacidad', () => {
  const s = fresco();
  const q = L.quienPaga(D.meDeben(s, T).personas, s);
  assert.equal(q.modo, 'uno');
  assert.deepEqual(q.personas.map((p) => [p.nombre, p.balance, p.receivableId, p.index]), [['Hijo', 400000, 'demo-hijo-debe', 3]]);
  s.receivables.push({ id: 'r2', person: 'Hija', personId: 'demo-hija', name: 'Compra', balance: 150000, rate: 0, monthlyPayment: 25000, payments: [], note: '' });
  D.limpiarMemo();
  assert.equal(L.quienPaga(D.meDeben(s, T).personas, s).modo, 'varios');
  s.receivables = [];
  D.limpiarMemo();
  assert.equal(L.quienPaga(D.meDeben(s, T).personas, s).modo, 'ninguno');
});

test('personasOrdenadas: primero las que te deben, de mayor a menor', () => {
  const s = fresco();
  s.receivables.push({ id: 'r2', person: 'Hija', personId: 'demo-hija', name: 'Compra', balance: 600000, rate: 0, monthlyPayment: 0, payments: [], note: '' });
  D.limpiarMemo();
  assert.deepEqual(L.personasOrdenadas(D.meDeben(s, T).personas).map((p) => p.nombre), ['Hija', 'Hijo', 'Pareja']);
});

test('opcionesCuota: una por escenario en palabras, más "Sin cuota por ahora"; marca la cuota de hoy', () => {
  const s = fresco();
  const o = L.opcionesCuota(D.escenariosCobro(s, 'demo-hijo-debe', T), F);
  assert.deepEqual(o.map((x) => x.value), [30000, 50000, 100000, 0]);
  assert.equal(o[1].titulo, '$50.000 por mes');
  assert.equal(o[1].sub, 'Termina en mayo 2027 (8 meses) · ahorrás $53.097 de interés');
  assert.equal(o[2].sub, 'Termina en enero 2027 (4 meses) · ahorrás $88.708 de interés · salís de la tarjeta un mes antes');
  assert.equal(o[3].esActual, true);
  o.forEach((x) => sinProhibidas(x.titulo + x.sub));
  // con una cuota acordada, esa es la de hoy y no lleva "ahorrás"
  s.receivables[0].monthlyPayment = 50000;
  D.limpiarMemo();
  const o2 = L.opcionesCuota(D.escenariosCobro(s, 'demo-hijo-debe', T), F);
  assert.equal(o2.find((x) => x.esActual).value, 50000);
  assert.doesNotMatch(o2.find((x) => x.esActual).sub, /ahorrás/);
});

test('opcionesCuota: con interés y una cuota que no alcanza trae la advertencia de derive', () => {
  const s = fresco();
  s.receivables[0].rate = 6.49;
  D.limpiarMemo();
  const esc = D.escenariosCobro(s, 'demo-hijo-debe', T, { montos: [20000, 50000] });
  const o = L.opcionesCuota(esc, F);
  assert.equal(o[0].advertencia, 'Con esta cuota su deuda no baja: el interés es $25.960 por mes.');
  assert.equal(o[1].advertencia, null);
});

test('fijarCuota y fijarInteres: guardan en la cuenta (muta el borrador)', () => {
  const s = fresco();
  assert.equal(L.fijarCuota(s, 'demo-hijo-debe', 40000.4), true);
  assert.equal(s.receivables[0].monthlyPayment, 40000);
  L.fijarCuota(s, 'demo-hijo-debe', -5);
  assert.equal(s.receivables[0].monthlyPayment, 0);
  assert.equal(L.fijarInteres(s, 'demo-hijo-debe', 6.49), true);
  assert.equal(s.receivables[0].rate, 6.49);
  L.fijarInteres(s, 'demo-hijo-debe', 0);
  assert.equal(s.receivables[0].rate, 0);
  assert.equal(L.fijarCuota(s, 'nada', 1), false);
  assert.equal(L.fijarInteres(s, 'nada', 1), false);
});

test('cuotaSugerida coincide con la cuota que propone "Una idea" de derive', () => {
  const s = fresco();
  const idea = D.siguientePaso(s, T).find((x) => x.id === 'idea');
  assert.ok(idea);
  assert.ok(idea.texto.includes(F.money(L.cuotaSugerida(400000))), idea.texto);
  assert.equal(L.cuotaSugerida(400000), 50000);
  assert.equal(L.cuotaSugerida(60000), 30000);
  assert.equal(L.cuotaSugerida(1000), 1000);
});

test('historialPagos: del más nuevo al más viejo, sin montos vacíos; fechaCorta pone el año solo si no es el actual', () => {
  const r = { payments: [{ id: 'a', date: '2026-09-12', amount: 50000 }, { id: 'b', date: '2026-10-02', amount: 20000 }, { id: 'c', date: '2026-10-03', amount: 0 }, { id: 'd', date: '2025-12-01', amount: 10000 }] };
  assert.deepEqual(L.historialPagos(r).map((p) => p.id), ['b', 'a', 'd']);
  assert.equal(L.fechaCorta(F, '2026-10-02', T), '2 de octubre');
  assert.equal(L.fechaCorta(F, '2025-12-01', T), '1 de diciembre de 2025');
  assert.equal(L.TEXTO_DESTINO.tarjeta, 'Lo usaste para pagar la tarjeta');
});

test('vistaFicha: null si no se conoce a la persona; sin deuda, la lista de cuentas va vacía', () => {
  const s = fresco();
  assert.equal(L.vistaFicha(D, s, T, 'no-existe'), null);
  const v = L.vistaFicha(D, s, T, 'demo-hijo');
  assert.equal(v.persona.nombre, 'Hijo');
  assert.equal(v.index, 3);
  assert.equal(v.cuentas.length, 1);
  assert.equal(v.cuentas[0].r.id, 'demo-hijo-debe');
  assert.equal(v.cuentas[0].esc.balance, 400000);
  assert.equal(v.cuentas[0].interes.rate, 6.49);
  assert.equal(L.vistaFicha(D, s, T, 'demo-hija').cuentas.length, 0);
});

test('mensaje de WhatsApp: editable, con "según el último resumen (aproximado)", sin palabras prohibidas y el enlace va codificado', () => {
  const s = fresco();
  const m = D.mensajeWhatsApp(s, 'demo-hijo-debe', T, { monto: L.cuotaSugerida(400000) });
  assert.match(m, /según el último resumen \(aproximado\)/);
  assert.match(m, /Si me pasás \$50\.000 por mes terminás en mayo de 2027\./);
  sinProhibidas(m);
  const url = L.urlWhatsApp(m);
  assert.ok(url.startsWith('https://wa.me/?text='));
  assert.equal(decodeURIComponent(url.slice('https://wa.me/?text='.length)), m);
});

test('todos los textos que arma la pantalla pasan el filtro de palabras prohibidas', () => {
  const s = fresco();
  s.receivables[0].monthlyPayment = 50000;
  D.limpiarMemo();
  const textos = [];
  const lib = D.liberaciones(s, T);
  const lt = L.lineaDeTiempo(lib, D.salidaTarjeta(s, T), s, F, '2026-10');
  lt.filas.forEach((f) => textos.push(f.label, f.sub, f.dateLabel, f.ariaLabel));
  L.escaleraFilas(lib, F).forEach((e) => textos.push(e.titulo, e.sub));
  textos.push(L.pieDeudas(lib, F), L.textoHoyDeudas(D.deudaSobreIngreso(s, T)), L.detalleDeudas(D.deudaSobreIngreso(s, T), F));
  const e = D.escenariosPago(s, T);
  e.opciones.forEach((o) => textos.push(L.subOpcionPago(o, F, e.opciones[0])));
  D.meDeben(s, T).personas.forEach((p) => textos.push(p.estadoTexto, p.detalle));
  textos.filter(Boolean).forEach(sinProhibidas);
  assert.ok(textos.length > 20);
});

test('ocultarMontos: con el ojo activado los textos para lectores no dicen ningún monto', () => {
  assert.equal(L.ocultarMontos('Tarjeta Visa. Debés $1.800.000 · cuota de −$80.000,50 por mes.'), 'Tarjeta Visa. Debés monto oculto · cuota de monto oculto por mes.');
  assert.equal(L.ocultarMontos('Sin montos acá'), 'Sin montos acá');
  const s = fresco();
  assert.doesNotMatch(L.ocultarMontos(L.ariaCurva(D.curvaDeuda(s, T), F)), /\$\d/);
});
