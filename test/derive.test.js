import test from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../src/derive.js';
import { demo } from '../src/demo.js';
import { emptyState } from '../src/store.js';
import { compare, simulate } from '../src/engine.js';
import { toEngine } from '../src/adapter.js';

const HOY = new Date(2026, 9, 4); // domingo 4 de octubre de 2026
const r0 = Math.round;
const clon = (x) => JSON.parse(JSON.stringify(x));
const deepFreeze = (o) => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    Object.values(o).forEach(deepFreeze);
  }
  return o;
};
const core = (eng) => {
  const { flags, pending, omitidos, ...c } = eng;
  void flags; void pending; void omitidos;
  return c;
};
const fecha = (y, m, d) => new Date(y, m - 1, d);

// Variantes del ejemplo.
const sinAfip = () => {
  const s = demo(HOY);
  s.pending = [];
  s.settings.salaryNetOfPayroll = false;
  return s;
};
// Todo confirmado: sin estimados, sin pendientes.
const confirmado = () => {
  const s = sinAfip();
  for (const i of s.incomes) delete i.estimated;
  for (const e of s.expenses) delete e.estimated;
  return s;
};
const sinDeudas = () => {
  const s = sinAfip();
  s.debts = [];
  s.receivables = [];
  s.installments = [];
  return s;
};
const AGOSTO = ['Movilidad: 21 días (feriado del 16)', 'Se terminó el préstamo de $80.000: +$80.000 por mes'];
const viaje = (monto, desde, extra = {}) => ({ nombre: 'Viaje', monto, modo: 'una', desde, ...extra });

// Palabras que no pueden aparecer en ningún texto que la app le muestre a la persona (AMENDMENTS A.5 y F).
const PROHIBIDAS = /colch[oó]n|pl[aá]stico|financiaci[oó]n|\bTNA\b|\bTEM\b|liber[aá]s|moroso|5 minutos|vas bien|\bjusto\b|\$5\.744 por d[ií]a/i;
function textos(x, out = []) {
  if (typeof x === 'string') out.push(x);
  else if (Array.isArray(x)) x.forEach((v) => textos(v, out));
  else if (x && typeof x === 'object') {
    for (const [k, v] of Object.entries(x)) {
      // los códigos internos (code, tipo, id...) no son texto visible
      if (['code', 'codigo', 'color', 'tone', 'tono', 'estado', 'tipo', 'id', 'key', 'lista', 'accion', 'ruta', 'glifo', 'modo', 'kind', 'debtId', 'personId', 'target', 'matiz', 'mes', 'fecha', 'desde', 'fin', 'paidOn', 'terminaEn', 'salida', 'salidaTarjeta', 'salidaTarjetaActual', 'salidaAntes', 'salidaDespues', 'closedOn', 'dueOn', 'receivableId', 'receivableIds', 'mesReserva', 'nombreArchivo', 'contenido', 'codeAntes', 'codeDespues', 'antes', 'despues'].includes(k)) continue;
      textos(v, out);
    }
  }
  return out;
}

// ============================================================================
// run: memo, pureza
// ============================================================================
test('run: devuelve el resultado del motor sobre el estado adaptado y lo memoiza por contenido', () => {
  D.limpiarMemo();
  const s = demo(HOY);
  const a = D.run(s, { today: HOY });
  const b = D.run(s, { today: HOY });
  assert.equal(a, b, 'misma referencia: no se vuelve a simular');
  assert.equal(D.run(clon(s), { today: HOY }), a, 'el memo es por contenido, no por objeto');
  assert.notEqual(D.run(s, { today: HOY, strategy: 'none' }), a);
  assert.notEqual(D.run(s, { today: HOY, extra: [{ id: 'x', amount: 1000, from: '2026-12', to: '2026-12' }] }), a);
  assert.notEqual(D.run(s, { today: new Date(2026, 10, 2) }), a, 'otro día = otro mes de inicio');
  // lo mismo que correr el motor a mano
  const mano = simulate(core(toEngine(s, HOY)));
  assert.deepEqual(a.months, mano.months);
  assert.equal(a.totalInterest, mano.totalInterest);
  assert.ok(a.eng.flags && a.eng.pending && a.eng.omitidos);
  assert.equal(Object.keys(a).includes('eng'), false, 'sim.eng no es enumerable');
});

test('run: el memo tiene un máximo de 50 entradas', () => {
  D.limpiarMemo();
  const s = demo(HOY);
  const primera = D.run(s, { today: HOY, extra: [{ id: 'x', amount: 1, from: '2026-12', to: '2026-12' }] });
  for (let i = 2; i <= 60; i++) D.run(s, { today: HOY, extra: [{ id: 'x', amount: i, from: '2026-12', to: '2026-12' }] });
  assert.notEqual(D.run(s, { today: HOY, extra: [{ id: 'x', amount: 1, from: '2026-12', to: '2026-12' }] }), primera, 'la más vieja ya se descartó');
  const reciente = D.run(s, { today: HOY, extra: [{ id: 'x', amount: 60, from: '2026-12', to: '2026-12' }] });
  assert.equal(D.run(s, { today: HOY, extra: [{ id: 'x', amount: 60, from: '2026-12', to: '2026-12' }] }), reciente);
});

test('run: si cambia el contenido del estado se recalcula (aunque sea el mismo objeto)', () => {
  const s = demo(HOY);
  const a = D.run(s, { today: HOY });
  s.expenses[0].amount += 1000;
  const b = D.run(s, { today: HOY });
  assert.notEqual(a, b);
  assert.equal(r0(a.months[0].free - b.months[0].free), 1000);
});

test('ninguna función de derive modifica el estado (se prueba con el estado congelado)', () => {
  const s = deepFreeze(demo(HOY));
  const rid = s.receivables[0].id;
  assert.doesNotThrow(() => {
    D.run(s, { today: HOY });
    D.hero(s, HOY);
    D.paraGastarHoy(s, HOY);
    D.salidaTarjeta(s, HOY);
    D.interesTarjeta(s.debts[0]);
    D.resumenViejo(s.debts[0], HOY);
    D.proximoPago(s.debts[0], HOY);
    D.vencimientos(s, HOY);
    D.ahoraToca(s, HOY);
    D.gustosEscenarios(s, HOY);
    D.eventosMes(s, 3, HOY);
    D.opcionesMesDificil(s, '2027-01', HOY);
    D.veredicto(s, viaje(300000, '2026-12'), HOY);
    D.mapaMeses(s, viaje(300000, '2026-12'), HOY);
    D.topeSinCosto(s, '2026-12', { today: HOY });
    D.escenariosPago(s, HOY, { otro: 400000 });
    D.curvaDeuda(s, HOY);
    D.cicloTarjeta(s, HOY);
    D.titularesTarjeta(s);
    D.liberaciones(s, HOY);
    D.deudaSobreIngreso(s, HOY);
    D.meDeben(s, HOY);
    D.escenariosCobro(s, rid, HOY);
    D.interesDeCobro(s, rid);
    D.mensajeWhatsApp(s, rid, HOY);
    D.lineasMes(s, 2, HOY);
    D.completitud(s, HOY);
    D.faltanDatosClave(s, HOY);
    D.siguientePaso(s, HOY);
    D.hitos(s, HOY);
    D.indicadores(s, HOY);
    D.revelacion(s, HOY);
    D.cierreDeMes(s, fecha(2026, 11, 2), { gastoTotal: 700000 });
    D.icsVencimiento(s, HOY);
    D.plataDeHoy(s);
    D.precargaResumen(s.debts[0]);
    D.validarResumen({ total: 1700000, min: 255000, rate: '79', closedOn: '2026-10-02', dueOn: '2026-10-14' }, { debt: s.debts[0], today: HOY });
    D.proyeccion(s, HOY);
    for (let n = 1; n <= 7; n++) D.recompensa(s, n, HOY);
  });
});

// ============================================================================
// monthState / estadosDe
// ============================================================================
test('monthState: Alcanza, Ajustado, cubierto con plata guardada y Falta plata', () => {
  const m = (o) => ({ income: 1000, collections: 0, free: 0, shortfall: 0, cash: 0, ...o });
  assert.equal(D.monthState(m({ free: 60 })).code, 'bien'); // 6%
  assert.equal(D.monthState(m({ free: 60 })).label, 'Alcanza');
  assert.equal(D.monthState(m({ free: 50 })).code, 'bien'); // justo el 5%
  assert.equal(D.monthState(m({ free: 49 })).code, 'justo');
  assert.equal(D.monthState(m({ free: 49 })).label, 'Ajustado');
  assert.equal(D.monthState(m({ free: 0 })).code, 'justo');
  const falta = D.monthState(m({ free: -100, shortfall: 100 }), 0);
  assert.equal(falta.code, 'falta');
  assert.equal(falta.label, 'Falta plata');
  assert.equal(falta.tone, 'bad');
  assert.equal(falta.faltante, 100);
  const cubierto = D.monthState(m({ free: -100, shortfall: 100, cash: 50 }), 150);
  assert.equal(cubierto.code, 'cubierto');
  assert.equal(cubierto.tone, 'warn');
  assert.equal(cubierto.fromCash, 100);
  assert.equal(cubierto.faltante, 0);
  const parcial = D.monthState(m({ free: -100, shortfall: 100, cash: 0 }), 40);
  assert.equal(parcial.code, 'falta');
  assert.equal(parcial.faltante, 60);
  assert.equal(D.monthState(m({ income: 0, free: -5, shortfall: 5 })).code, 'falta');
});

test('estadosDe: un estado por mes, con el efecto de la plata guardada', () => {
  const s = demo(HOY);
  const sim = D.run(s, { today: HOY });
  const e = D.estadosDe(sim);
  assert.equal(e.length, sim.months.length);
  assert.deepEqual(e.slice(0, 6).map((x) => x.code), ['bien', 'bien', 'bien', 'falta', 'justo', 'bien']);
  assert.equal(D.estadosDe(sim), e, 'se memoiza por simulación');
  const conPlata = clon(s);
  conPlata.settings.cash = 900000;
  conPlata.settings.cobroEsteMes = false;
  assert.equal(D.estadosDe(D.run(conPlata, { today: HOY }))[3].code, 'cubierto');
});

// ============================================================================
// HOY
// ============================================================================
test('hero: octubre, "Va a la tarjeta este mes", chip con matiz y aviso del mes difícil', () => {
  const h = D.hero(demo(HOY), HOY);
  assert.equal(h.estado, 'ok');
  assert.equal(h.mes, '2026-10');
  assert.equal(h.mesNombre, 'octubre');
  assert.equal(r0(h.free), 84364);
  assert.equal(h.code, 'bien');
  assert.equal(h.rotulo, 'Va a la tarjeta este mes');
  assert.equal(r0(h.numero), 354364);
  assert.equal(h.tieneDeuda, true);
  assert.equal(h.subtitulo, 'Es el mínimo ($270.000) y $84.364 de lo que sobra.');
  assert.deepEqual({ total: r0(h.aLaTarjeta.total), minimo: h.aLaTarjeta.minimo, extra: r0(h.aLaTarjeta.extra), elegido: h.aLaTarjeta.elegido }, { total: 354364, minimo: 270000, extra: 84364, elegido: false });
  assert.equal(h.aviso.tipo, 'falta');
  assert.equal(h.aviso.key, '2027-01');
  assert.equal(h.aviso.amount, 202000);
  assert.equal(h.aviso.texto, 'Ojo con enero: faltan $202.000');
  assert.equal(h.chip.texto, 'Alcanza, ojo con enero');
  assert.equal(h.chip.tone, 'warn');
  assert.equal(h.provisorio, true);
  assert.equal(h.estimados.n, 4);
  assert.equal(h.estimados.texto, 'Incluye 4 datos estimados');
  assert.deepEqual(h.tira.map((t) => [t.mes, t.compacto, t.code]), [['Oct', '84 mil', 'bien'], ['Nov', '71 mil', 'bien'], ['Dic', '534 mil', 'bien'], ['Ene', '−202 mil', 'falta']]);
  assert.equal(h.tira[0].actual, true);
  assert.equal(h.tira.filter((t) => t.actual).length, 1);
});

test('hero: "Te sobran" solo aparece sin deuda', () => {
  const h = D.hero(sinDeudas(), HOY);
  assert.equal(h.estado, 'ok');
  assert.equal(h.tieneDeuda, false);
  assert.equal(h.aLaTarjeta, null);
  assert.equal(h.rotulo, 'Te sobran en octubre');
  assert.equal(h.subtitulo, 'Queda guardada.');
  assert.ok(h.numero > 0);
  const conDeuda = D.hero(demo(HOY), HOY);
  assert.notEqual(conDeuda.rotulo.startsWith('Te sobran'), true);
});

test('hero: el chip nunca es verde puro si hay datos pendientes o un mes futuro con falta', () => {
  // sin mes con falta y sin pendientes: Alcanza (verde)
  const ok = confirmado();
  ok.incomes.find((i) => i.kind === 'movilidad').noPayMonths = [];
  const h1 = D.hero(ok, HOY);
  assert.notEqual(h1.aviso.tipo, 'falta');
  assert.equal(h1.chip.texto, 'Alcanza');
  assert.equal(h1.chip.tone, 'ok');
  assert.equal(h1.provisorio, false);
  // lo mismo pero con un dato pendiente (AFIP): Provisorio
  const pend = clon(ok);
  pend.pending = [{ id: 'afip', label: 'Plan de pagos de AFIP', target: 'afip' }];
  const h2 = D.hero(pend, HOY);
  assert.equal(h2.chip.texto, 'Provisorio');
  assert.equal(h2.chip.tone, 'warn');
  assert.equal(h2.provisorio, true);
  assert.ok(h2.motivos.length > 0);
  // con un mes futuro en falta: lleva el matiz
  const h3 = D.hero(confirmado(), HOY);
  assert.equal(h3.chip.texto, 'Alcanza, ojo con enero');
  assert.notEqual(h3.chip.tone, 'ok');
});

test('hero: mes actual con falta -> "Te faltan este mes" y "Falta plata"', () => {
  const s = sinAfip();
  s.expenses[0].amount = 1500000;
  const h = D.hero(s, HOY);
  assert.equal(h.code, 'falta');
  assert.equal(h.rotulo, 'Te faltan este mes');
  assert.equal(h.chip.texto, 'Falta plata');
  assert.equal(h.chip.tone, 'bad');
  assert.ok(h.numero > 0);
  assert.equal(h.aviso.tipo, 'mesActualFalta');
  assert.equal(h.aviso.texto, 'Hay 3 formas de cubrirlo');
});

test('hero: sin datos, sin ingresos y solo ingresos', () => {
  const vacio = D.hero(emptyState(HOY), HOY);
  assert.equal(vacio.estado, 'sinDatos');
  assert.equal(vacio.texto, 'Empecemos por lo que cobrás');
  const sinIng = emptyState(HOY);
  sinIng.expenses = [{ id: 'e', name: 'Casa', amount: 500000, kind: 'casa' }];
  assert.equal(D.hero(sinIng, HOY).estado, 'sinIngresos');
  const parcial = emptyState(HOY);
  parcial.incomes = [{ id: 'i', name: 'Sueldo', amount: 900000, kind: 'sueldo' }];
  const p = D.hero(parcial, HOY);
  assert.equal(p.estado, 'parcial');
  assert.equal(p.texto, 'Entran $900.000. Cargá tus gastos para saber cuánto sobra.');
});

test('hero: un mes ya negativo en el mes actual, cubierto con plata guardada, queda como Ajustado', () => {
  const s = sinAfip();
  s.expenses[0].amount = 1500000;
  s.settings.cash = 2000000;
  s.settings.cobroEsteMes = false;
  const h = D.hero(s, HOY);
  assert.equal(h.code, 'cubierto');
  assert.equal(h.chip.texto, 'Ajustado');
  assert.equal(h.subtitulo, 'Lo cubrís con tu plata guardada.');
});

test('hero: con un pago elegido de la tarjeta lo dice y lo que no se usa queda sin usar', () => {
  const s = sinAfip();
  s.debts[0].planned = { '2026-10': 300000 };
  const h = D.hero(s, HOY);
  assert.equal(h.aLaTarjeta.elegido, true);
  assert.equal(r0(h.numero), 300000);
  assert.match(h.subtitulo, /^Es lo que elegiste pagar\./);
  assert.match(h.subtitulo, /sin usar\.$/);
});

test('paraGastarHoy: referencia por día hasta fin de mes (solo cuentan los gastos de gustos)', () => {
  const g = D.paraGastarHoy(demo(HOY), HOY);
  assert.equal(g.estado, 'ok');
  assert.equal(g.referencia, true);
  assert.equal(g.gustos, 100000);
  assert.equal(g.gastado, 12000); // el gasto de la casa (30.000) no resta
  assert.equal(g.dias, 28);
  assert.equal(g.hastaFecha, '31 de octubre');
  assert.equal(g.porDia, 3100);
  assert.equal(g.texto, '$3.100 por día hasta fin de mes');
  assert.match(g.calculo, /\$88\.000 ÷ 28 = \$3\.142\. Redondeamos para abajo: \$3\.100\./);
  // sin gastos anotados: 100.000 / 28 = 3.571 -> 3.500
  const limpio = demo(HOY);
  limpio.spent = [];
  assert.equal(D.paraGastarHoy(limpio, HOY).porDia, 3500);
  // gastos de la casa no cambian la referencia
  limpio.spent = [{ id: 'a', date: '2026-10-02', amount: 90000, cat: 'casa' }];
  assert.equal(D.paraGastarHoy(limpio, HOY).porDia, 3500);
});

test('paraGastarHoy: agotado, sin gustos y último día del mes', () => {
  const s = demo(HOY);
  s.spent = [{ id: 'a', date: '2026-10-02', amount: 100000, cat: 'gustos' }];
  const a = D.paraGastarHoy(s, HOY);
  assert.equal(a.estado, 'agotado');
  assert.equal(a.porDia, 0);
  assert.doesNotMatch(a.texto, /casa/);
  s.spent = [];
  s.expenses = s.expenses.filter((e) => e.kind !== 'gustos');
  const b = D.paraGastarHoy(s, HOY);
  assert.equal(b.estado, 'sinGustos');
  assert.equal(b.texto, 'Decime cuánto querés tener por mes para tus gustos y te digo cuánto por día.');
  assert.equal(D.paraGastarHoy(demo(fecha(2026, 10, 31)), fecha(2026, 10, 31)).dias, 1);
  // los gastos de otro mes no cuentan
  const c = demo(HOY);
  c.spent = [{ id: 'a', date: '2026-09-20', amount: 90000, cat: 'gustos' }];
  assert.equal(D.paraGastarHoy(c, HOY).gastado, 0);
});

test('salidaTarjeta: fecha de salida con su supuesto y el cartel de fecha provisoria', () => {
  const s = D.salidaTarjeta(demo(HOY), HOY);
  assert.equal(s.estado, 'fecha');
  assert.equal(s.paidOn, '2027-03');
  assert.equal(s.mesNombre, 'marzo 2027');
  assert.equal(s.mesesQueFaltan, 6);
  assert.equal(s.detalle, 'faltan 6 meses');
  assert.equal(s.supuesto, 'Si de acá en más pagás completo lo que consumís en el mes');
  assert.equal(s.provisoria, true); // falta el plan de AFIP
  assert.equal(s.etiqueta, 'Fecha provisoria');
  assert.ok(s.queSupone.length >= 3);
  assert.ok(s.queSupone.some((t) => /no incluye lo nuevo/i.test(t)));
  assert.ok(s.queSupone.some((t) => /aguinaldo es una estimación/i.test(t)));
  const firme = D.salidaTarjeta(confirmado(), HOY);
  assert.equal(firme.provisoria, false);
  assert.equal(firme.etiqueta, null);
  // con un resumen viejo la fecha es provisoria
  const viejo = D.salidaTarjeta(confirmado(), fecha(2026, 10, 27));
  assert.equal(viejo.etiqueta, 'Fecha provisoria');
});

test('salidaTarjeta: sin tarjeta, sin deuda, que no se termina y más de dos años', () => {
  assert.equal(D.salidaTarjeta(emptyState(HOY), HOY).estado, 'sinTarjeta');
  const sd = sinAfip();
  sd.debts[0].balance = 0;
  assert.equal(D.salidaTarjeta(sd, HOY).estado, 'sinDeuda');
  // el interés es mayor que lo que se puede pagar: nunca termina y no se muestra un número absurdo
  const eterna = sinAfip();
  eterna.incomes = [{ id: 's', name: 'Sueldo', kind: 'sueldo', amount: 700000 }];
  eterna.installments = [];
  eterna.debts[0].balance = 8000000;
  eterna.debts[0].minPayment = 100000;
  eterna.debts[0].rate = 9;
  const e = D.salidaTarjeta(eterna, HOY);
  assert.equal(e.estado, 'noTermina');
  assert.equal(e.paidOn, null);
  assert.equal(e.texto, 'Con este ritmo la tarjeta no se termina: conversemos qué cambiar.');
  // tarda más de 24 meses pero termina
  const larga = sinAfip();
  larga.incomes = [{ id: 's', name: 'Sueldo', kind: 'sueldo', amount: 840000 }];
  larga.expenses = [{ id: 'c', name: 'Casa', kind: 'casa', amount: 640000 }];
  larga.installments = [];
  larga.debts[0].balance = 12000000;
  larga.debts[0].rate = 1;
  larga.debts[0].minPayment = 100000;
  const l = D.salidaTarjeta(larga, HOY);
  assert.equal(l.estado, 'muyLejos');
  assert.equal(l.texto, 'Con este ritmo la tarjeta tarda más de 2 años en terminarse.');
});

test('interesTarjeta: por mes, por día y el interés en pesos del resumen si lo informa', () => {
  const t = D.interesTarjeta(demo(HOY).debts[0]);
  assert.equal(t.porMes, 116820);
  assert.equal(r0(t.porDia), 3894);
  assert.equal(t.tasaTexto, '6,49%');
  assert.equal(t.delResumen, null);
  assert.equal(t.mostrar, 116820);
  assert.equal(r0(t.anualAprox), 79);
  const d = clon(demo(HOY).debts[0]);
  d.statement.interes = 100000;
  assert.equal(D.interesTarjeta(d).mostrar, 100000);
  assert.deepEqual({ ...D.interesTarjeta({}) }, { balance: 0, rate: 0, tasaTexto: '0%', porMes: 0, porDia: 0, delResumen: null, mostrar: 0, anualAprox: 0 });
});

test('resumenViejo y proximoPago usan las fechas reales del resumen', () => {
  const d = demo(HOY).debts[0]; // cierra 28/9, vence 10/10, próximo cierre 26/10, próximo vencimiento 7/11
  assert.equal(D.resumenViejo(d, HOY), false);
  assert.equal(D.resumenViejo(d, fecha(2026, 10, 26)), false);
  assert.equal(D.resumenViejo(d, fecha(2026, 10, 27)), true);
  assert.equal(D.resumenViejo({}, HOY), false);
  assert.deepEqual(D.proximoPago(d, HOY), { fecha: '2026-10-10', key: '2026-10', tipo: 'vigente' });
  assert.deepEqual(D.proximoPago(d, fecha(2026, 10, 12)), { fecha: '2026-11-07', key: '2026-11', tipo: 'proximo' });
  assert.equal(D.proximoPago({}, HOY).tipo, 'sinFecha');
});

test('vencimientos: filas ordenadas, la tarjeta con las fechas reales, máximo 3', () => {
  const v = D.vencimientos(demo(HOY), HOY);
  assert.deepEqual(v.filas.map((f) => f.id), ['tarjeta:demo-visa', 'planilla', 'medeben']);
  const t = v.filas[0];
  assert.equal(t.estado, 'pendiente');
  assert.equal(t.fecha, '2026-10-10');
  assert.equal(t.fechaTexto, '10 de octubre');
  assert.equal(t.dias, 6);
  assert.equal(t.monto, 270000);
  assert.equal(t.detalle, 'En 6 días · mínimo del resumen de septiembre');
  assert.equal(t.boton.accion, 'yaPague');
  assert.match(t.fechasResumen, /cerró el 28 de septiembre y vence el 10 de octubre/);
  assert.equal(v.filas[1].monto, 92000);
  assert.equal(v.filas[2].tipo, 'medeben');
  assert.equal(v.filas[2].boton.texto, 'Anotar que me pagaron');
  assert.equal(v.vacio, null);
  // con AFIP pendiente las filas serían 4: gana el orden por fecha y "me deben" reemplaza a la menos urgente
  assert.equal(v.todas.length, 3);
  const mas = demo(HOY);
  mas.pending = [{ id: 'afip', label: 'Plan de pagos de AFIP', target: 'afip' }];
  const v2 = D.vencimientos(mas, HOY);
  assert.equal(v2.filas.length, 3);
  assert.deepEqual(v2.filas.map((f) => f.tipo), ['tarjeta', 'planilla', 'medeben']);
  assert.equal(v2.todas.length, 3);
  const sinMeDeben = clon(mas);
  sinMeDeben.receivables = [];
  assert.deepEqual(D.vencimientos(sinMeDeben, HOY).filas.map((f) => f.tipo), ['tarjeta', 'planilla', 'pendiente']);
});

test('vencimientos: si el resumen ya está viejo NO muestra monto y pide cargar el nuevo', () => {
  const v = D.vencimientos(demo(HOY), fecha(2026, 10, 27));
  const t = v.filas[0];
  assert.equal(t.estado, 'viejo');
  assert.equal(t.monto, null);
  assert.equal(t.detalle, 'Falta cargar el resumen nuevo para saber cuánto pagar');
  assert.equal(t.boton.texto, 'Cargar resumen nuevo');
  assert.match(t.fechasResumen, /cerró el 28 de septiembre/);
  assert.equal(t.fecha, '2026-11-07');
});

test('vencimientos: sin resumen, vencido, parcial y pagado', () => {
  const sin = demo(HOY);
  sin.debts[0].statement = null;
  const s = D.vencimientos(sin, HOY).filas[0];
  assert.equal(s.estado, 'sinResumen');
  assert.equal(s.detalle, 'Falta cargar el resumen para saber cuánto pagar');
  assert.equal(s.monto, null);
  const venc = D.vencimientos(demo(HOY), fecha(2026, 10, 12)).filas[0];
  assert.equal(venc.estado, 'esperandoCierre');
  assert.equal(venc.monto, null);
  assert.match(venc.detalle, /Venció el 10 de octubre/);
  // pagos desde el cierre del resumen
  const parcial = demo(HOY);
  parcial.debts[0].payments = [{ id: 'p', date: '2026-10-02', amount: 100000 }];
  const p = D.vencimientos(parcial, HOY).filas[0];
  assert.equal(p.estado, 'parcial');
  assert.equal(p.monto, 170000);
  assert.match(p.detalle, /Pagaste \$100\.000 de la Visa el 2 de octubre · falta \$170\.000 del mínimo/);
  const pagado = demo(HOY);
  pagado.debts[0].payments = [{ id: 'p', date: '2026-09-30', amount: 270000 }]; // antes de fin de mes pero después del cierre
  const g = D.vencimientos(pagado, HOY).filas[0];
  assert.equal(g.estado, 'pagado');
  assert.equal(g.monto, null);
  assert.equal(g.pagado.total, 270000);
  assert.equal(g.pagado.texto, 'Pagaste $270.000 de la Visa el 30 de septiembre');
});

test('vencimientos: "Podés respirar" solo si no hay datos estimados ni pendientes', () => {
  const lejos = (s) => {
    s.debts[0].statement = { ...s.debts[0].statement, closedOn: '2026-10-01', dueOn: '2026-10-25', nextCloseOn: '2026-10-29', nextDueOn: '2026-11-22' };
    s.installments = [];
    return s;
  };
  const sinNada = D.vencimientos(lejos(confirmado()), HOY);
  assert.equal(sinNada.vacio, 'No vence nada en los próximos 15 días. Podés respirar.');
  const conEstimados = D.vencimientos(lejos(sinAfip()), HOY);
  assert.equal(conEstimados.vacio, 'No vence nada en los próximos 15 días.');
  const conPendiente = lejos(confirmado());
  conPendiente.pending = [{ id: 'afip', label: 'AFIP', target: 'afip' }];
  assert.equal(D.vencimientos(conPendiente, HOY).vacio, 'No vence nada en los próximos 15 días.');
});

test('ahoraToca: una sola tarjeta de acción según el calendario', () => {
  const a = D.ahoraToca(demo(HOY), HOY);
  assert.equal(a.tipo, 'pagarTarjeta');
  assert.equal(a.texto, 'La Visa vence el 10 de octubre: pagá al menos $270.000.');
  assert.equal(a.boton.accion, 'yaPague');
  assert.equal(a.urgente, false);
  const manana = D.ahoraToca(demo(HOY), fecha(2026, 10, 9));
  assert.equal(manana.texto, 'Mañana vence la Visa: ¿ya pagaste $270.000?');
  assert.equal(manana.urgente, true);
  assert.equal(D.ahoraToca(demo(HOY), fecha(2026, 10, 10)).texto, 'Hoy vence la Visa: ¿ya pagaste $270.000?');
  const viejo = D.ahoraToca(demo(HOY), fecha(2026, 10, 27));
  assert.equal(viejo.tipo, 'cargarResumen');
  assert.equal(viejo.texto, 'Cerró tu resumen. Cargalo y te digo cuánto conviene pagar el 7 de noviembre.');
  const pagado = demo(HOY);
  pagado.debts[0].payments = [{ id: 'p', date: '2026-10-02', amount: 270000 }];
  assert.equal(D.ahoraToca(pagado, HOY).tipo, 'anotarCobro');
  pagado.receivables = [];
  assert.equal(D.ahoraToca(pagado, HOY), null);
  const sinResumen = demo(HOY);
  sinResumen.debts[0].statement = null;
  assert.equal(D.ahoraToca(sinResumen, HOY).tipo, 'cargarResumen');
});

// ============================================================================
// DECIDIR
// ============================================================================
test('gustosEscenarios: 4 corridas y la nota con rangos calculados', () => {
  const g = D.gustosEscenarios(demo(HOY), HOY);
  assert.equal(g.hayGustos, true);
  assert.equal(g.actual, 100000);
  assert.deepEqual(g.escenarios.map((e) => [e.monto, e.salida, r0(e.interesTotal), r0(e.ahorroVsActual), e.esActual]), [
    [50000, '2027-03', 347070, 53097, false],
    [100000, '2027-03', 400168, 0, true],
    [150000, '2027-05', 476127, -75959, false],
    [200000, '2027-06', 595976, -195808, false],
  ]);
  assert.equal(g.escenarios[2].salidaTexto, 'mayo 2027');
  assert.deepEqual(g.rango, { min: 53097, max: 119849 });
  assert.equal(g.notaPie, 'Cada $50.000 por mes que gastes menos en gustos, salís de la tarjeta alrededor de 1 mes antes y ahorrás entre $53.097 y $119.849 de interés. Es tu decisión.');
  // si lo actual no es uno de los montos, se agrega
  const raro = demo(HOY);
  raro.expenses.find((e) => e.kind === 'gustos').amount = 120000;
  assert.deepEqual(D.gustosEscenarios(raro, HOY).escenarios.map((e) => e.monto), [50000, 100000, 120000, 150000, 200000]);
  const sin = demo(HOY);
  sin.expenses = sin.expenses.filter((e) => e.kind !== 'gustos');
  assert.equal(D.gustosEscenarios(sin, HOY).hayGustos, false);
});

test('eventosMes: movilidad con feriados, feria de enero e invierno, aguinaldo, fin de la tarjeta y de los préstamos', () => {
  const s = demo(HOY);
  const t = (i) => D.eventosMes(s, i, HOY).map((e) => e.texto);
  assert.deepEqual(t(0), ['Movilidad: 21 días (feriado del 12)']);
  assert.deepEqual(t(1), ['Movilidad: 20 días (feriado del 23)']);
  assert.deepEqual(t(2), ['Movilidad: 21 días (feriados del 8 y 25)', 'Aguinaldo estimado: +$450.000']);
  assert.deepEqual(t(3), ['Feria de enero: este mes no cobrás movilidad']);
  assert.equal(D.eventosMes(s, 3, HOY)[0].sinCobro, true);
  assert.deepEqual(t(5), ['Movilidad: 21 días (feriados del 24 y 26)', 'Último pago de la tarjeta']);
  assert.deepEqual(t(6), ['Movilidad: 21 días (feriado del 2)', 'Primer mes sin tarjeta: +$270.000']);
  assert.deepEqual(t(9), ['Feria de invierno: movilidad de 15 días']);
  assert.deepEqual(t(10), AGOSTO);
  assert.ok(D.eventosMes(s, 10, HOY).some((e) => e.tipo === 'cuotaTermina' && e.monto === 80000));
  assert.deepEqual(D.eventosMes(s, 500, HOY), []);
  assert.deepEqual(D.eventosMes(s, -1, HOY), []);
  // un mes sin sorpresas
  assert.deepEqual(D.eventosMes(sinDeudas(), 2, HOY).filter((e) => e.tipo !== 'movilidad' && e.tipo !== 'aguinaldo'), []);
});

test('opcionesMesDificil: enero tiene 3 formas de cubrirlo, con sus costos', () => {
  const o = D.opcionesMesDificil(demo(HOY), '2027-01', HOY);
  assert.equal(o.hayProblema, true);
  assert.equal(o.key, '2027-01');
  assert.equal(o.mesNombre, 'enero');
  assert.equal(o.faltante, 202000);
  assert.match(o.causa, /^No cobrás movilidad \(\$0 en vez de unos \$286\.000\) y los gastos siguen\.$/);
  assert.match(o.intro, /^Es el único mes con faltante de los próximos 12\./);
  assert.deepEqual(o.opciones.map((x) => x.id), ['tarjeta', 'reserva', 'sinGustos']);
  const [t, r, g] = o.opciones;
  assert.equal(t.etiqueta, 'Es el plan de hoy');
  assert.equal(t.texto, 'Es lo más barato. La deuda sube a $575.881 en enero y igual salís en marzo 2027.');
  assert.equal(r.titulo, 'Apartar $202.000 del aguinaldo');
  assert.equal(r.mesReserva, '2026-12');
  assert.equal(r.costoInteres, 14867);
  assert.equal(r.faltanteDespues, 0);
  assert.equal(r.texto, 'Enero queda cubierto sin usar la tarjeta. Te cuesta $14.867 más de interés en total y salís igual en marzo 2027.');
  assert.deepEqual(r.cambios.agregar.expenses[0], { name: 'Reserva para enero', owner: '', amount: 202000, from: '2026-12', to: '2026-12', kind: 'otro' });
  assert.deepEqual(r.cambios.agregar.incomes[0], { name: 'Reserva guardada para enero', owner: '', amount: 202000, from: '2027-01', to: '2027-01', kind: 'otro' });
  assert.equal(g.faltanteDespues, 102000);
  assert.match(g.texto, /^Con \$0 de gustos, la falta baja a \$102\.000\./);
  assert.deepEqual(g.cambios.overrides, [{ lista: 'expenses', id: 'demo-gustos', mes: '2027-01', valor: 0 }]);
  assert.equal(o.pie, 'Es una estimación con los datos que cargaste. No es asesoramiento financiero.');
});

test('opcionesMesDificil: un mes sin problema, un mes fuera de rango y sin gustos', () => {
  const o = D.opcionesMesDificil(demo(HOY), '2026-10', HOY);
  assert.equal(o.hayProblema, false);
  assert.deepEqual(o.opciones, []);
  assert.equal(D.opcionesMesDificil(demo(HOY), '2025-01', HOY), null);
  assert.equal(D.opcionesMesDificil(demo(HOY), '2090-01', HOY), null);
  const s = demo(HOY);
  s.expenses = s.expenses.filter((e) => e.kind !== 'gustos');
  const x = D.opcionesMesDificil(s, '2027-01', HOY);
  assert.equal(x.opciones[2].disponible, false);
  assert.match(x.opciones[2].texto, /No tenés gustos cargados para enero/);
});

test('opcionesMesDificil: elegir una opción y aplicarla con store.aplicarCambios cubre el mes', async () => {
  const { aplicarCambios } = await import('../src/store.js');
  const s = clon(demo(HOY));
  const o = D.opcionesMesDificil(s, '2027-01', HOY);
  aplicarCambios(s, o.opciones[1].cambios);
  const h = D.hero(s, HOY);
  assert.equal(h.aviso.tipo !== 'falta' || h.aviso.key !== '2027-01', true);
  const s2 = clon(demo(HOY));
  aplicarCambios(s2, o.opciones[2].cambios);
  assert.equal(r0(D.estadosDe(D.run(s2, { today: HOY }))[3].faltante), 102000);
});

test('veredicto ámbar: viaje de $300.000 en diciembre cuesta intereses', () => {
  const v = D.veredicto(demo(HOY), viaje(300000, '2026-12'), HOY);
  assert.equal(v.codigo, 'ambar');
  assert.equal(v.titulo, 'Se puede, pero tiene costo');
  assert.equal(r0(v.extraInterest), 83517);
  assert.equal(r0(v.teSale), 383517);
  assert.equal(v.salidaAntes, '2027-03');
  assert.equal(v.salidaDespues, '2027-04');
  assert.equal(v.delayMonths, 1);
  assert.equal(v.texto, 'Se puede, pero tiene costo. Viaje de $300.000 en diciembre te sale $383.517 porque hoy la tarjeta cobra 6,49% por mes.');
  assert.deepEqual(v.filas, [
    { k: 'Diciembre queda en', v: '$234.364' },
    { k: 'Salís de la tarjeta', v: 'abril 2027 (antes: marzo 2027)' },
    { k: 'Interés extra', v: '$83.517' },
  ]);
  assert.equal(v.mesPeor.key, '2026-12');
  assert.equal(v.antesDespues.length, 4);
  assert.equal(r0(v.antesDespues[0].antes - v.antesDespues[0].despues), 300000);
  assert.equal(v.pie, 'Es una estimación con los datos que cargaste. No es asesoramiento financiero.');
  assert.ok(v.siLoNecesitas.texto.startsWith('Si igual lo necesitás'));
  // el tope sin costo de ese mes viene incluido
  assert.equal(v.tope.key, '2026-12');
  assert.equal(v.tope.sinCosto, 0);
  assert.equal(D.veredicto(demo(HOY), viaje(300000, '2026-12'), HOY, { conTope: false }).tope, null);
});

test('veredicto verde: un gasto chico cuando ya no hay tarjeta entra sin problemas', () => {
  const v = D.veredicto(demo(HOY), viaje(5000, '2027-05'), HOY);
  assert.equal(v.codigo, 'verde');
  assert.equal(v.titulo, 'Entra sin problemas');
  assert.equal(v.texto, 'Entra sin problemas.');
  assert.equal(v.extraInterest, 0);
  assert.equal(v.siLoNecesitas, null);
  assert.equal(v.tope, null);
});

test('veredicto terracota: un mes que ya estaba en falta y empeora (compare().newNegativeMonths no lo detecta)', () => {
  const s = demo(HOY);
  const cmp = compare(core(toEngine(s, HOY)), [{ id: 'x', name: 'Tele', amount: 660000, from: '2027-01', to: '2027-01' }]);
  assert.deepEqual(cmp.newNegativeMonths, [], 'el criterio viejo no ve nada: enero ya era negativo');
  const v = D.veredicto(s, { nombre: 'Tele', monto: 660000, modo: 'una', desde: '2027-01' }, HOY);
  assert.equal(v.codigo, 'terracota');
  assert.equal(v.titulo, 'No conviene ahora');
  assert.equal(v.primerMesFalta.key, '2027-01');
  assert.equal(v.primerMesFalta.faltante, 862000);
  assert.equal(v.texto, 'No conviene ahora. Enero ya venía con un faltante de $202.000 y con Tele de $660.000 serían $862.000.');
  assert.equal(v.mesPeor.free, -862000);
  assert.equal(v.siLoNecesitas.key, '2027-05');
  assert.equal(v.siLoNecesitas.texto, 'Si igual lo necesitás, lo mejor es mayo: no te suma interés, aunque el mes queda ajustado.');
});

test('veredicto terracota: un mes que pasa a falta nombra el mes y el faltante', () => {
  const v = D.veredicto(demo(HOY), { nombre: 'Tele', monto: 660000, modo: 'una', desde: '2026-12' }, HOY);
  assert.equal(v.codigo, 'terracota');
  assert.equal(v.primerMesFalta.key, '2026-12');
  assert.match(v.texto, /^No conviene ahora\. Con Tele de \$660\.000 en diciembre, te faltarían \$125\.636\.$/);
  const futuro = D.veredicto(demo(HOY), { nombre: 'Viaje', monto: 300000, modo: 'cuotas', desde: '2026-12', cuotas: 3 }, HOY);
  assert.notEqual(futuro.codigo, 'verde');
});

test('veredicto: en cuotas y todos los meses; si no hay tarjeta no habla de ella', () => {
  const s = sinDeudas();
  const una = D.veredicto(s, viaje(100000, '2026-12'), HOY);
  assert.equal(una.codigo, 'verde');
  assert.equal(una.filas.some((f) => f.k === 'Salís de la tarjeta'), false);
  const cuotas = D.veredicto(s, { nombre: 'Heladera', monto: 660000, modo: 'cuotas', desde: '2026-11', cuotas: 6 }, HOY);
  assert.equal(cuotas.gasto.montoCuota, 110000);
  assert.equal(cuotas.costoTotal, 660000);
  const mensual = D.veredicto(s, { nombre: 'Gimnasio', monto: 20000, modo: 'mensual', desde: '2026-11' }, HOY);
  assert.equal(mensual.gasto.total, null);
  assert.match(mensual.desc, /Gimnasio de \$20\.000 por mes desde noviembre/);
  const enorme = D.veredicto(s, { nombre: 'Auto', monto: 90000000, modo: 'una', desde: '2026-12' }, HOY);
  assert.equal(enorme.codigo, 'terracota');
  assert.equal(enorme.siLoNecesitas.texto, 'Si igual lo necesitás, probá con un monto menor.');
});

test('veredicto y mapaMeses: sin un monto escrito no hay veredicto (vacio: true)', () => {
  const v = D.veredicto(demo(HOY), viaje(0, '2026-12'), HOY);
  assert.equal(v.vacio, true);
  assert.equal(v.texto, 'Poné cuánto cuesta y te digo si te alcanza.');
  assert.deepEqual(v.filas, []);
  assert.equal(v.tope, null);
  assert.equal(v.siLoNecesitas, null);
  assert.equal(D.veredicto(demo(HOY), viaje(300000, '2026-12'), HOY).vacio, false);
  const m = D.mapaMeses(demo(HOY), viaje('', '2026-12'), HOY);
  assert.equal(m.vacio, true);
  assert.equal(m.mejorMomento, null);
  assert.equal(m.textoSinMejor, null);
  assert.equal(D.mapaMeses(demo(HOY), viaje(300000, '2026-12'), HOY).vacio, false);
});

test('veredicto: un mes en el pasado se evalúa desde el mes actual', () => {
  const v = D.veredicto(demo(HOY), viaje(5000, '2025-01'), HOY);
  assert.equal(v.gasto.desde, '2026-10');
});

test('mapaMeses: 12 meses con veredicto, forma y leyenda fija en palabras', () => {
  const m = D.mapaMeses(demo(HOY), viaje(300000, '2026-12'), HOY);
  assert.equal(m.meses.length, 12);
  assert.deepEqual(m.meses.map((x) => x.codigo), ['terracota', 'terracota', 'ambar', 'terracota', 'terracota', 'terracota', 'ambar', 'ambar', 'verde', 'ambar', 'verde', 'verde']);
  assert.deepEqual(m.meses.map((x) => x.glifo).slice(0, 3), ['triangulo', 'triangulo', 'cuadrado']);
  assert.equal(m.meses[8].glifo, 'circulo');
  assert.equal(m.meses[8].etiqueta, 'Sin costo');
  assert.equal(m.meses[2].etiqueta, 'Con costo');
  assert.equal(m.meses[0].etiqueta, 'No conviene');
  assert.equal(r0(m.meses[2].costoExtra), 83517);
  assert.equal(m.meses[3].faltante, 502000);
  assert.deepEqual(m.leyenda.map((x) => x.texto), ['Sin costo', 'Con costo', 'No conviene']);
  assert.deepEqual(m.leyenda.map((x) => x.glifo), ['circulo', 'cuadrado', 'triangulo']);
  assert.deepEqual(m.mejorMomento, { key: '2027-04', mesNombre: 'abril 2027' });
  assert.equal(m.textoSinMejor, null);
  assert.equal(m.meses[0].key, '2026-10');
  assert.equal(m.meses[0].mes, 'Oct');
});

test('mapaMeses: si ningún mes sirve lo dice y propone un monto menor', () => {
  const m = D.mapaMeses(demo(HOY), viaje(90000000, '2026-12'), HOY);
  assert.equal(m.mejorMomento, null);
  assert.equal(m.textoSinMejor, 'En los próximos 12 meses no encuentro un mes sin costo. Probá con un monto menor.');
  assert.ok(m.meses.every((x) => x.codigo === 'terracota'));
});

test('topeSinCosto: la pregunta inversa "¿cuánto puedo gastar en {mes} sin que me cueste?"', () => {
  const s = demo(HOY);
  const mayo = D.topeSinCosto(s, '2027-05', { today: HOY });
  assert.equal(mayo.sinCosto, 282000);
  assert.equal(mayo.sinFaltar, 730000);
  assert.equal(mayo.texto, 'Hasta $282.000 en mayo sin que te cueste nada.');
  assert.equal(mayo.textoSinFaltar, 'Hasta $730.000 en mayo no te falta plata, pero cuesta interés.');
  // lo que da el tope realmente no cuesta, y un poco más sí
  assert.equal(D.veredicto(s, viaje(282000, '2027-05'), HOY, { conTope: false }).codigo, 'verde');
  assert.notEqual(D.veredicto(s, viaje(284000, '2027-05'), HOY, { conTope: false }).codigo, 'verde');
  // mientras haya tarjeta, en diciembre no hay plata que no cueste (y no se recomienda esperar hasta abril por eso)
  const dic = D.topeSinCosto(s, '2026-12', { today: HOY });
  assert.equal(dic.sinCosto, 0);
  assert.equal(dic.sinFaltar, 534000);
  assert.match(dic.texto, /^En diciembre no hay plata que no cueste/);
  // en cuotas: el tope es del total y se dice por cuota
  const cuotas = D.topeSinCosto(s, '2027-05', { today: HOY, modo: 'cuotas', cuotas: 6 });
  assert.equal(cuotas.cuotas, 6);
  assert.equal(cuotas.porMesSinCosto, Math.floor(cuotas.sinCosto / 6 / 1000) * 1000);
  assert.ok(cuotas.sinCosto > mayo.sinCosto);
  // por mes
  const mensual = D.topeSinCosto(s, '2027-05', { today: HOY, modo: 'mensual' });
  assert.match(mensual.texto, /por mes en mayo/);
  // sin deudas y con un mes holgado, hay tope
  assert.ok(D.topeSinCosto(sinDeudas(), '2026-12', { today: HOY }).sinCosto > 0);
});

// ============================================================================
// TARJETA
// ============================================================================
test('escenariosPago: solo el mínimo vs lo que sobra, con ahorro de interés', () => {
  const e = D.escenariosPago(demo(HOY), HOY);
  assert.equal(e.estado, 'ok');
  assert.equal(e.fecha, '2026-10-10');
  assert.equal(e.titulo, 'Cuánto pagar el 10 de octubre');
  assert.deepEqual(e.opciones.map((o) => [o.id, r0(o.monto), o.paidOn, r0(o.totalInterest), r0(o.ahorro), o.recomendada]), [
    ['minimo', 270000, '2027-07', 633898, 0, false],
    ['sobra', 354364, '2027-03', 400168, 233730, true],
  ]);
  assert.equal(e.elegida, 'sobra');
  assert.equal(e.minimoDelResumen, 270000);
  assert.equal(r0(e.maximoQueAlcanza), 354364);
  assert.equal(e.resumenViejo, false);
  assert.equal(e.pie, 'Pagar el mínimo está bien si este mes no da para más. Lo importante es saber cuánto cuesta.');
  assert.equal(e.opciones[0].salidaTexto, 'julio 2027');
});

test('escenariosPago: "otro monto" usa el pago elegido de ese mes', () => {
  const s = demo(HOY);
  const e = D.escenariosPago(s, HOY, { otro: 310000 });
  const otro = e.opciones.find((o) => o.id === 'otro');
  assert.equal(otro.monto, 310000);
  assert.equal(otro.titulo, 'Otro monto');
  assert.equal(otro.paidOn, '2027-03');
  assert.ok(otro.totalInterest > e.opciones[1].totalInterest, 'pagar menos de lo que sobra cuesta más interés');
  assert.ok(otro.totalInterest < e.opciones[0].totalInterest);
  assert.equal(otro.aviso, undefined);
  assert.equal(e.elegida, 'sobra', 'evaluar un monto no cambia lo elegido');
  // si ya hay un pago elegido guardado, es el elegido
  const g = clon(s);
  g.debts[0].planned = { '2026-10': 310000 };
  const e2 = D.escenariosPago(g, HOY);
  assert.equal(e2.elegida, 'otro');
  assert.equal(e2.opciones.find((o) => o.id === 'otro').monto, 310000);
  // los otros escenarios no dependen del pago elegido
  assert.deepEqual(e2.opciones[0], e.opciones[0]);
  assert.deepEqual(e2.opciones[1], e.opciones[1]);
  assert.equal(D.escenariosPago(clon(s), HOY, { otro: 0 }).opciones.find((o) => o.id === 'otro').aviso, 'Es menos que el mínimo del resumen: puede traer cargos del banco.');
});

test('escenariosPago: pagar más de lo que alcanza avisa que el faltante se suma a la deuda', () => {
  const e = D.escenariosPago(demo(HOY), HOY, { otro: 500000 });
  const otro = e.opciones.find((o) => o.id === 'otro');
  assert.equal(r0(otro.faltaPlata), 145636);
  assert.equal(otro.aviso, 'Es más de lo que te sobra este mes: te faltarían $145.636, que se suman a la deuda de la tarjeta.');
});

test('escenariosPago: sin tarjeta, con resumen viejo y recordando la estrategia "solo el mínimo"', () => {
  assert.equal(D.escenariosPago(emptyState(HOY), HOY).estado, 'sinTarjeta');
  const viejo = D.escenariosPago(demo(HOY), fecha(2026, 10, 27));
  assert.equal(viejo.resumenViejo, true);
  assert.equal(viejo.aviso, 'Ya cerró un resumen nuevo: cargalo para ver el monto exacto.');
  assert.equal(viejo.fecha, '2026-11-07');
  const min = clon(demo(HOY));
  min.settings.strategy = 'none';
  const e = D.escenariosPago(min, HOY);
  assert.equal(e.elegida, 'minimo');
  assert.equal(e.opciones[1].id, 'sobra');
  assert.equal(e.opciones[1].paidOn, '2027-03', '"lo que sobra" siempre se calcula con una estrategia que barre');
});

test('precargaResumen: las fechas del mes pasado más un mes y la tasa que ya estaba', () => {
  const p = D.precargaResumen(demo(HOY).debts[0]);
  assert.deepEqual({ ...p, nota: undefined }, { hayAnterior: true, closedOn: '2026-10-26', dueOn: '2026-11-07', rate: 6.49, nota: undefined });
  assert.match(p.nota, /corregilos con tu resumen nuevo/);
  const sin = D.precargaResumen({ balance: 5, rate: 0 });
  assert.deepEqual(sin, { hayAnterior: false, closedOn: null, dueOn: null, rate: null, nota: null });
  assert.equal(D.precargaResumen(undefined).hayAnterior, false);
});

test('validarResumen: una carga normal se puede guardar sin avisos', () => {
  const v = D.validarResumen({ total: '1.700.000', min: '255.000', rate: '6,5', closedOn: '2026-10-02', dueOn: '2026-10-14' }, { debt: demo(HOY).debts[0], today: HOY });
  assert.equal(v.ok, true);
  assert.equal(v.confirmar, false);
  assert.deepEqual(v.avisos, []);
  assert.deepEqual(v.valores, { total: 1700000, min: 255000, rate: 6.5, closedOn: '2026-10-02', dueOn: '2026-10-14' });
  assert.deepEqual(v.filas.map((f) => f.valor), ['$1.700.000', '$255.000', '6,5%', '2 de octubre', '14 de octubre']);
  // y lo que devuelve se puede guardar tal cual
  const v2 = D.validarResumen({ total: 1700000, min: 255000, rate: 6.5, closedOn: '2026-10-02', dueOn: '2026-10-14', newCharges: '660.000', interes: '' }, { today: HOY });
  assert.equal(v2.valores.newCharges, 660000);
  assert.equal('interes' in v2.valores, false);
});

test('validarResumen: tasa anual se convierte y se pide confirmar', () => {
  const v = D.validarResumen({ total: 1700000, min: 255000, rate: '79', closedOn: '2026-10-02', dueOn: '2026-10-14' }, { today: HOY });
  assert.equal(v.ok, true);
  assert.equal(v.confirmar, true);
  assert.equal(v.valores.rate, 6.49);
  assert.deepEqual(v.avisos, [{ campo: 'rate', nivel: 'confirmar', texto: '79% parece la tasa anual. ¿Usamos 6,49% por mes?', sugerido: 6.49 }]);
  assert.equal(D.validarResumen({ total: 1700000, min: 255000, rate: '0', closedOn: '2026-10-02', dueOn: '2026-10-14' }, { today: HOY }).avisos[0].texto, 'Pusiste 0% de interés. ¿Está bien?');
});

test('validarResumen: mínimo fuera del 5% al 30%, ceros de más y mínimo mayor al total', () => {
  const base = { rate: '6,5', closedOn: '2026-10-02', dueOn: '2026-10-14' };
  const bajo = D.validarResumen({ ...base, total: 1700000, min: 9000 }, { today: HOY });
  assert.equal(bajo.ok, true);
  assert.deepEqual(bajo.avisos.map((a) => [a.campo, a.nivel]), [['min', 'confirmar']]);
  assert.equal(bajo.avisos[0].texto, 'El mínimo es el 1% del total y lo normal es entre 5% y 30%. ¿Está bien?');
  assert.equal(D.validarResumen({ ...base, total: 1000000, min: 500000 }, { today: HOY }).avisos[0].nivel, 'confirmar');
  assert.equal(D.validarResumen({ ...base, total: 1000000, min: 300000 }, { today: HOY }).avisos.length, 0, 'el 30% justo es normal');
  const ceros = D.validarResumen({ ...base, total: '17000000000', min: 255000 }, { today: HOY });
  assert.equal(ceros.ok, false);
  assert.equal(ceros.avisos[0].texto, 'Mirá bien los ceros, por favor.');
  const mayor = D.validarResumen({ ...base, total: 100000, min: 255000 }, { today: HOY });
  assert.equal(mayor.ok, false);
  assert.equal(mayor.avisos[0].texto, 'El pago mínimo no puede ser más que el total.');
});

test('validarResumen: fechas con sentido y comparación con el resumen que ya estaba cargado', () => {
  const debt = demo(HOY).debts[0]; // cerró el 28 de septiembre, total 1.800.000
  const base = { total: 1700000, min: 255000, rate: '6,5' };
  const futuro = D.validarResumen({ ...base, closedOn: '2026-10-20', dueOn: '2026-10-30' }, { today: HOY });
  assert.equal(futuro.ok, false);
  assert.equal(futuro.avisos[0].texto, 'Esa fecha de cierre todavía no llegó.');
  const venceAntes = D.validarResumen({ ...base, closedOn: '2026-10-02', dueOn: '2026-10-01' }, { today: HOY });
  assert.equal(venceAntes.avisos[0].texto, 'El vencimiento tiene que ser después del cierre.');
  const inexistente = D.validarResumen({ ...base, closedOn: '2026-02-31', dueOn: '2026-10-14' }, { today: HOY });
  assert.equal(inexistente.avisos[0].texto, 'Poné la fecha en que cerró tu resumen.');
  const viejo = D.validarResumen({ ...base, closedOn: '2026-09-28', dueOn: '2026-10-10' }, { debt, today: HOY });
  assert.equal(viejo.ok, true);
  assert.match(viejo.avisos[0].texto, /cerró el mismo día o antes que el que ya cargaste \(28 de septiembre\)/);
  const distinto = D.validarResumen({ ...base, total: 9000000, closedOn: '2026-10-02', dueOn: '2026-10-14' }, { debt, today: HOY });
  assert.match(distinto.avisos.map((a) => a.texto).join(' '), /muy distinto del resumen anterior \(\$1\.800\.000\)/);
  assert.equal(D.validarResumen({ ...base, closedOn: new Date(2026, 9, 2), dueOn: '2026-10-14' }, { today: HOY }).valores.closedOn, '2026-10-02');
});

test('validarResumen: sin nada escrito pide cada dato y no se puede guardar', () => {
  const v = D.validarResumen({}, { today: HOY });
  assert.equal(v.ok, false);
  assert.deepEqual(v.avisos.map((a) => a.campo), ['total', 'min', 'rate', 'closedOn', 'dueOn']);
  assert.ok(v.avisos.every((a) => a.nivel === 'corregir'));
  assert.deepEqual(v.filas.map((f) => f.valor), ['—', '—', '—', '—', '—']);
  assert.equal(D.validarResumen(undefined, { today: HOY }).ok, false);
  for (const t of textos(v)) assert.doesNotMatch(t, PROHIBIDAS);
});

test('el resumen validado se guarda con store.aplicarResumen y mueve los números', async () => {
  const { aplicarResumen } = await import('../src/store.js');
  const s = clon(demo(HOY));
  const v = D.validarResumen({ total: '1.700.000', min: '255.000', rate: '79', closedOn: '2026-10-02', dueOn: '2026-10-14' }, { debt: s.debts[0], today: HOY });
  assert.equal(aplicarResumen(s, s.debts[0].id, v.valores, HOY), true);
  assert.equal(s.debts[0].balance, 1700000);
  assert.equal(s.debts[0].rate, 6.49);
  assert.equal(s.debts[0].statement.dueOn, '2026-10-14');
  assert.equal(D.vencimientos(s, HOY).filas[0].fecha, '2026-10-14');
  assert.equal(D.vencimientos(s, HOY).filas[0].monto, 255000);
});

test('curvaDeuda: el plan y "solo el mínimo" mes a mes', () => {
  const c = D.curvaDeuda(demo(HOY), HOY);
  assert.equal(c.planTermina, '2027-03');
  assert.equal(c.minimoTermina, '2027-07');
  assert.equal(r0(c.plan[0].deuda), 1562456);
  assert.equal(c.plan[0].key, '2026-10');
  assert.equal(c.plan.length, c.soloMinimo.length);
  assert.ok(c.plan.length >= 6 && c.plan.length <= 36);
  assert.ok(c.soloMinimo[5].deuda >= c.plan[5].deuda);
  assert.equal(D.curvaDeuda(demo(HOY), HOY, { meses: 5 }).plan.length, 5);
});

test('cicloTarjeta: usa las fechas reales del resumen y no promete cuándo se paga lo que comprás hoy', () => {
  const c = D.cicloTarjeta(demo(HOY), HOY);
  assert.deepEqual(c.fechas, { cerroEl: '2026-09-28', venceEl: '2026-10-10', proximoCierre: '2026-10-26', proximoVencimiento: '2026-11-07' });
  assert.equal(c.texto, 'El próximo resumen cierra el 26 de octubre y vence el 7 de noviembre.');
  assert.equal(c.nota, 'Fijate la fecha de cierre en tu resumen.');
  assert.equal(c.consejo, 'Como pagás cerca del mínimo, lo que comprás con la tarjeta se suma a la deuda y paga interés.');
  assert.doesNotMatch(JSON.stringify(c), /Lo que compres hoy/);
  const viejo = D.cicloTarjeta(demo(HOY), fecha(2026, 10, 27));
  assert.equal(viejo.viejo, true);
  assert.equal(viejo.fechas, null);
  assert.equal(viejo.pide, 'Cargá el resumen nuevo para ver las fechas de este mes.');
  const sin = demo(HOY);
  sin.debts[0].statement = null;
  const s = D.cicloTarjeta(sin, HOY);
  assert.equal(s.hayResumen, false);
  assert.equal(s.fechas, null);
  assert.match(s.pide, /Cargá el último resumen/);
});

test('titularesTarjeta: reparto informativo, con "Cuadra" o lo que falta (nunca un reto)', () => {
  const t = D.titularesTarjeta(demo(HOY));
  assert.equal(t.total, 1800000);
  assert.equal(t.repartido, 700000);
  assert.equal(t.texto, 'Faltan $1.100.000');
  assert.equal(t.cuadra, false);
  assert.deepEqual(t.partes.map((p) => p.nombre), ['Hijo', 'Pareja']);
  const c = clon(demo(HOY));
  c.debts[0].holders.push({ personId: 'demo-vos', amount: 1100000 });
  const t2 = D.titularesTarjeta(c);
  assert.equal(t2.cuadra, true);
  assert.equal(t2.texto, 'Cuadra');
  c.debts[0].holders.push({ personId: 'demo-hija', amount: 50000 });
  assert.equal(D.titularesTarjeta(c).texto, 'Te pasaste por $50.000');
  assert.equal(D.titularesTarjeta(emptyState(HOY)).total, 0);
});

// ============================================================================
// DEUDAS
// ============================================================================
test('liberaciones: cuándo termina cada deuda, la escalera y lo que falta pagar por planilla', () => {
  const l = D.liberaciones(demo(HOY), HOY);
  assert.deepEqual(l.items.map((i) => [i.id, i.tipo, i.fin, i.desde, i.quedan]), [
    ['demo-visa', 'tarjeta', '2027-03', '2027-04', 6],
    ['demo-prestamo-a', 'prestamo', '2027-07', '2027-08', 10],
    ['demo-prestamo-b', 'prestamo', '2029-02', '2029-03', 29],
    ['afip', 'pendiente', null, null, null],
  ]);
  assert.equal(l.items[1].cuotaActual, 27);
  assert.equal(l.items[1].cuotasTotal, 36);
  assert.equal(l.items[3].aCompletar, true);
  assert.deepEqual(l.escalera.map((e) => [e.desde, e.monto]), [['2027-04', 270000], ['2027-08', 80000], ['2029-03', 12000]]);
  assert.equal(l.escalera[0].texto, 'Desde abril 2027: +$270.000 (ya no pagás la tarjeta)');
  assert.equal(l.escalera[1].texto, 'Desde agosto 2027: +$80.000');
  assert.equal(l.proxima.id, 'demo-visa');
  assert.equal(l.faltaPagarPlanilla, 1148000);
});

test('liberaciones: una deuda que nunca termina y cuotas ya terminadas', () => {
  const s = sinAfip();
  s.incomes = [{ id: 's', name: 'Sueldo', kind: 'sueldo', amount: 700000 }];
  s.installments = [{ id: 'c', name: 'Heladera', amount: 10000, remaining: 3, first: '2026-06' }]; // terminó en agosto
  s.debts[0].balance = 8000000;
  s.debts[0].minPayment = 100000;
  s.debts[0].rate = 9;
  const l = D.liberaciones(s, HOY);
  assert.equal(l.items.length, 1);
  assert.equal(l.items[0].noTermina, true);
  assert.equal(l.items[0].desde, null);
  assert.deepEqual(l.escalera, []);
  assert.equal(l.proxima, null);
});

test('deudaSobreIngreso: lo que va a deudas hoy y la fecha en que baja', () => {
  const d = D.deudaSobreIngreso(demo(HOY), HOY);
  assert.equal(d.porCien, 31);
  assert.equal(d.deudas, 362000);
  assert.equal(d.tarjetaMinimo, 270000);
  assert.equal(d.prestamos, 92000);
  assert.equal(r0(d.ingresos), 1186364);
  assert.equal(d.textoHoy, '$31 de cada $100 que cobrás van a deudas');
  assert.equal(d.detalle, '$362.000 por mes: $270.000 de la tarjeta (mínimo) y $92.000 de préstamos y cuotas.');
  assert.deepEqual(d.alivio, { key: '2027-04', mesNombre: 'abril de 2027', porCien: 8 });
  assert.equal(d.textoAlivio, 'En abril de 2027 baja a $8 de cada $100');
  const sin = D.deudaSobreIngreso(sinDeudas(), HOY);
  assert.equal(sin.porCien, 0);
  assert.equal(sin.alivio, null);
  const sinIng = demo(HOY);
  sinIng.incomes = [];
  assert.equal(D.deudaSobreIngreso(sinIng, HOY).porCien, null);
});

test('meDeben: personas con su estado (palabra + tono), sin rojo ni alarma', () => {
  const m = D.meDeben(demo(HOY), HOY);
  assert.equal(m.total, 400000);
  assert.equal(m.entraPorMes, 0);
  assert.equal(m.texto, 'Hoy no está entrando nada por mes.');
  assert.equal(m.sinCuota, true);
  const hijo = m.personas.find((p) => p.nombre === 'Hijo');
  assert.equal(hijo.estado, 'conversar');
  assert.equal(hijo.estadoTexto, 'Para conversar');
  assert.equal(hijo.tono, 'brand');
  assert.equal(hijo.detalle, 'Sin cuota acordada');
  assert.deepEqual(m.personas.filter((p) => p.estado === 'nada').map((p) => p.nombre), ['Pareja', 'Hija']);
  // con cuota acordada
  const a = clon(demo(HOY));
  a.receivables[0].monthlyPayment = 50000;
  const ma = D.meDeben(a, HOY);
  assert.equal(ma.personas[0].estado, 'acordado');
  assert.equal(ma.personas[0].estadoTexto, 'Devuelve lo acordado');
  assert.equal(ma.personas[0].tono, 'ok');
  assert.equal(ma.entraPorMes, 50000);
  assert.equal(ma.texto, 'Lo que entra por mes: $50.000');
  // pagó una parte
  a.receivables[0].payments = [{ id: 'p', date: '2026-10-02', amount: 20000 }];
  assert.equal(D.meDeben(a, HOY).personas[0].estado, 'parte');
  assert.equal(D.meDeben(a, HOY).personas[0].estadoTexto, 'Pagó una parte');
  // nadie debe
  assert.equal(D.meDeben(sinDeudas(), HOY).total, 0);
});

test('escenariosCobro: qué pasa si te devuelven distintas cuotas, con el efecto en la tarjeta', () => {
  const s = demo(HOY);
  const e = D.escenariosCobro(s, 'demo-hijo-debe', HOY);
  assert.equal(e.persona, 'Hijo');
  assert.equal(e.balance, 400000);
  assert.equal(e.salidaTarjetaActual, '2027-03');
  assert.deepEqual(e.escenarios.map((x) => [x.monto, x.terminaEn, x.meses, x.salidaTarjeta, x.mesesAntes, r0(x.interesTotal), r0(x.ahorro)]), [
    [30000, '2027-11', 14, '2027-03', 0, 368309, 31858],
    [50000, '2027-05', 8, '2027-03', 0, 347070, 53097],
    [100000, '2027-01', 4, '2027-02', 1, 311460, 88708],
  ]);
  assert.equal(e.escenarios[1].terminaTexto, 'mayo 2027');
  assert.equal(e.escenarios.every((x) => x.advertencia === null), true);
  assert.equal(D.escenariosCobro(s, 'no existe', HOY), null);
  // montos propios: el que supera lo que debe se descarta
  const otro = D.escenariosCobro(s, 'demo-hijo-debe', HOY, { montos: [25000, 500000] });
  assert.deepEqual(otro.escenarios.map((x) => x.monto), [25000]);
});

test('escenariosCobro: con interés y una cuota baja la deuda no baja y lo dice', () => {
  const s = clon(demo(HOY));
  s.receivables[0].rate = 6.49;
  s.receivables[0].monthlyPayment = 10000;
  const e = D.escenariosCobro(s, 'demo-hijo-debe', HOY);
  assert.equal(e.interesPorMes, 25960);
  assert.equal(e.advertenciaActual, 'Con esta cuota su deuda no baja: el interés es $25.960 por mes.');
  const baja = e.escenarios.find((x) => x.monto === 10000);
  assert.equal(baja.esActual, true);
  assert.equal(baja.terminaEn, null);
  assert.equal(baja.terminaTexto, 'No termina');
  assert.equal(baja.meses, null);
  assert.equal(baja.advertencia, 'Con esta cuota su deuda no baja: el interés es $25.960 por mes.');
  const buena = e.escenarios.find((x) => x.monto === 100000);
  assert.equal(buena.advertencia, null);
  assert.ok(buena.terminaEn);
  assert.equal(r0(D.interesDeCobro(s, 'demo-hijo-debe').porMes), 25960);
});

test('interesDeCobro y mensajeWhatsApp: texto neutro, hechos y una pregunta abierta', () => {
  const s = demo(HOY);
  const i = D.interesDeCobro(s, 'demo-hijo-debe');
  assert.equal(i.rate, 6.49);
  assert.equal(i.porMes, 25960);
  assert.equal(i.texto, 'Si querés cobrarle interés por lo que consumió con la tarjeta, se suman $25.960 por mes a lo que te debe.');
  assert.equal(D.interesDeCobro(s, 'x'), null);
  assert.equal(D.interesDeCobro(sinDeudas(), 'x'), null);
  const m = D.mensajeWhatsApp(s, 'demo-hijo-debe', HOY, { monto: 50000 });
  assert.equal(m, 'Hola Hijo, te paso la cuenta de la tarjeta según el último resumen (aproximado): tu parte hoy son $400.000. Si me pasás $50.000 por mes terminás en mayo de 2027. ¿Te sirve? Lo vemos y lo anotamos.');
  const sinCuota = D.mensajeWhatsApp(s, 'demo-hijo-debe', HOY);
  assert.doesNotMatch(sinCuota, /por mes/);
  assert.match(sinCuota, /¿Te sirve\?/);
  assert.equal(D.mensajeWhatsApp(s, 'nada', HOY), '');
  const anon = clon(s);
  anon.receivables[0].person = '';
  assert.match(D.mensajeWhatsApp(anon, 'demo-hijo-debe', HOY), /^Hola, te paso/);
});

// ============================================================================
// MESES
// ============================================================================
test('lineasMes: entra - sale = lo que sobra, en todos los meses', () => {
  const s = demo(HOY);
  const sim = D.run(s, { today: HOY });
  for (let i = 0; i < 24; i++) {
    const l = D.lineasMes(s, i, HOY);
    assert.ok(Math.abs(l.entraTotal - l.saleTotal - sim.months[i].free) < 1, `mes ${i}`);
    assert.equal(l.key, sim.months[i].key);
    assert.equal(l.free, sim.months[i].free);
  }
  assert.equal(D.lineasMes(s, 500, HOY), null);
});

test('lineasMes: diciembre con movilidad por día, aguinaldo estimado y la tarjeta', () => {
  const l = D.lineasMes(demo(HOY), 2, HOY);
  assert.equal(l.mesNombre, 'diciembre');
  assert.deepEqual(l.entra.map((x) => [x.nombre, r0(x.monto), x.estimado]), [['Sueldo', 900000, false], ['Movilidad', 286364, true], ['Aguinaldo', 450000, true]]);
  assert.equal(l.entra[1].detalle, '21 días x $13.636');
  assert.equal(l.entra[2].detalle, 'Es una estimación (la mitad de tu sueldo)');
  assert.deepEqual(l.sale.map((x) => [x.nombre, x.monto]), [['Gastos de la casa y del día a día', 640000], ['Gustos y sorpresas', 100000], ['Préstamos por planilla', 92000], ['Tarjeta (mínimo)', 270000]]);
  assert.equal(l.sale[2].items.length, 2);
  assert.equal(r0(l.entraTotal), 1636364);
  assert.equal(l.saleTotal, 1102000);
  assert.equal(l.queSobra.tipo, 'tarjeta');
  assert.equal(l.queSobra.texto, 'Va a la tarjeta: pagás $804.364 en total y la deuda baja a $604.640.');
  assert.deepEqual(l.avisos, ['El aguinaldo es una estimación (la mitad de tu sueldo). Confirmalo con tu recibo.']);
  assert.deepEqual(l.eventos.map((e) => e.tipo), ['movilidad', 'aguinaldo']);
  assert.equal(l.pie, 'Es una estimación con los datos que cargaste. No es asesoramiento financiero.');
});

test('lineasMes: mes con falta, mes sin deuda y pago elegido', () => {
  const s = demo(HOY);
  const ene = D.lineasMes(s, 3, HOY);
  assert.equal(ene.code, 'falta');
  assert.equal(ene.queSobra.tipo, 'falta');
  assert.equal(ene.queSobra.texto, 'Faltan $202.000: se suma a la deuda de la tarjeta.');
  assert.equal(ene.entra.some((x) => x.nombre === 'Movilidad'), false, 'enero no cobra movilidad');
  const sinDeuda = D.lineasMes(s, 8, HOY);
  assert.equal(sinDeuda.queSobra.tipo, 'guardado');
  assert.match(sinDeuda.queSobra.texto, /^Queda guardado: \$/);
  const elegido = clon(s);
  elegido.debts[0].planned = { '2026-10': 300000 };
  const l = D.lineasMes(elegido, 0, HOY);
  assert.equal(l.sale.find((x) => x.id === 'demo-visa').nombre, 'Tarjeta (lo que elegiste pagar)');
  assert.equal(l.sale.find((x) => x.id === 'demo-visa').monto, 300000);
});

test('lineasMes: "lo que te devuelven" aparece cuando hay una cuota acordada', () => {
  const s = clon(demo(HOY));
  s.receivables[0].monthlyPayment = 50000;
  const l = D.lineasMes(s, 0, HOY);
  assert.deepEqual(l.entra.at(-1), { id: 'cobros', lista: 'receivables', nombre: 'Lo que te devuelven', detalle: '', monto: 50000, estimado: false });
});

// ============================================================================
// DATOS QUE FALTAN, PRÓXIMOS PASOS, HITOS
// ============================================================================
test('completitud: 7 pasos, hechos o pendientes, y lo que falta', () => {
  const c = D.completitud(demo(HOY), HOY);
  assert.equal(c.total, 7);
  assert.equal(c.hechos, 6);
  assert.equal(c.completo, false);
  assert.deepEqual(c.pasos.map((p) => p.estado), ['hecho', 'hecho', 'hecho', 'hecho', 'pendiente', 'hecho', 'hecho']);
  assert.deepEqual(c.faltan.map((f) => f.id), ['afip', 'aguinaldo']);
  assert.deepEqual(c.faltan.map((f) => f.texto), ['Plan de AFIP', 'Aguinaldo exacto']);
  assert.equal(c.siguiente.id, 'planilla');
  assert.equal(c.pasos[4].ruta, '#/armar/5');
  const todo = D.completitud(confirmado(), HOY);
  assert.equal(todo.completo, true);
  assert.equal(todo.hechos, 7);
  assert.equal(todo.siguiente, null);
  const vacio = D.completitud(emptyState(HOY), HOY);
  assert.equal(vacio.hechos, 0);
  assert.equal(vacio.siguiente.id, 'familia');
  assert.equal(vacio.faltan.length, 7);
  // "no sé" sobre la planilla deja el paso pendiente
  const nose = confirmado();
  nose.settings.salaryNetOfPayroll = null;
  const n = D.completitud(nose, HOY);
  assert.equal(n.pasos[4].estado, 'pendiente');
  assert.ok(n.faltan.some((f) => f.id === 'planilla' && f.texto === 'Confirmar planilla'));
  // un paso que la persona respondió con "no tengo" cuenta como hecho
  const nada = emptyState(HOY);
  nada.settings.pasos = { medeben: true };
  assert.equal(D.completitud(nada, HOY).pasos[6].estado, 'hecho');
});

test('faltanDatosClave: solo lo que cambia el resultado (AFIP, planilla)', () => {
  const k = D.faltanDatosClave(demo(HOY), HOY);
  assert.equal(k.hay, true);
  assert.deepEqual(k.items.map((i) => i.texto), ['Plan de AFIP']);
  assert.equal(D.faltanDatosClave(confirmado(), HOY).hay, false, 'los estimados no prenden el punto ámbar');
  const nose = confirmado();
  nose.settings.salaryNetOfPayroll = null;
  assert.deepEqual(D.faltanDatosClave(nose, HOY).items.map((i) => i.texto), ['Confirmar planilla']);
});

test('siguientePaso: máximo 3 tarjetas en orden idea, próxima liberación, tus datos', () => {
  const p = D.siguientePaso(demo(HOY), HOY);
  assert.deepEqual(p.map((x) => x.id), ['idea', 'liberacion', 'datos']);
  assert.equal(p[0].titulo, 'Una idea para vos');
  assert.equal(p[0].texto, 'Si Hijo te devuelve $50.000 por mes, ahorrás $53.097 de interés.');
  assert.equal(p[0].boton.ruta, '#/deudas/medeben/demo-hijo');
  assert.equal(p[1].texto, 'Desde abril 2027 dejás de pagar la tarjeta y quedan libres $270.000 por mes.');
  assert.equal(p[2].texto, 'Faltan 2 datos para que esto sea más exacto: Plan de AFIP y Aguinaldo exacto.');
  assert.deepEqual(p[2].progreso, { hechos: 6, total: 7 });
  assert.ok(p.length <= 3);
  // sin deudas ni datos pendientes no hay nada que sugerir
  const sd = D.siguientePaso(sinDeudas(), HOY);
  assert.deepEqual(sd.map((x) => x.id), ['datos']);
  assert.equal(sd[0].texto, 'Falta 1 dato para que esto sea más exacto: Aguinaldo exacto.');
  const t = confirmado();
  t.receivables = [];
  t.debts = [];
  t.installments = [];
  assert.deepEqual(D.siguientePaso(t, HOY), []);
});

test('hitos: cuota que terminó hace poco y todavía no se mostró', () => {
  const s = clon(demo(HOY));
  s.installments.push({ id: 'vieja', name: 'Heladera', amount: 45000, remaining: 9, first: '2026-01' }); // terminó en septiembre
  const h = D.hitos(s, HOY);
  assert.equal(h.length, 1);
  assert.equal(h[0].id, 'cuota:vieja');
  assert.equal(h[0].titulo, '¡Se terminó!');
  assert.equal(h[0].texto, 'La cuota de Heladera de $45.000 quedó atrás. Desde ahora tenés $45.000 más por mes.');
  assert.equal(h[0].monto, 45000);
  assert.deepEqual(D.hitos(s, HOY, { hitos: ['cuota:vieja'] }), [], 'una vez mostrado no vuelve');
  s.seen.hitos = ['cuota:vieja'];
  assert.deepEqual(D.hitos(s, HOY), []);
  // una cuota que terminó hace mucho no se celebra
  const vieja = clon(demo(HOY));
  vieja.installments.push({ id: 'muy', name: 'X', amount: 1000, remaining: 3, first: '2025-01' });
  assert.deepEqual(D.hitos(vieja, HOY), []);
  // un préstamo por planilla dice "préstamo"
  const p = clon(demo(HOY));
  p.installments.push({ id: 'pre', name: 'Préstamo', amount: 30000, remaining: 5, first: '2026-05', payroll: true });
  assert.match(D.hitos(p, HOY)[0].texto, /^El préstamo de \$30\.000 quedó atrás\./);
});

test('hitos: una deuda que quedó en cero', () => {
  const s = clon(demo(HOY));
  s.debts[0].balance = 0;
  s.debts[0].paidOffOn = '2026-09-20';
  const h = D.hitos(s, HOY);
  assert.equal(h.length, 1);
  assert.equal(h[0].tipo, 'deuda');
  assert.equal(h[0].texto, 'Tarjeta Visa quedó en cero. Desde ahora tenés $270.000 más por mes.');
  s.debts[0].paidOffOn = '2026-01-20';
  assert.deepEqual(D.hitos(s, HOY), []);
});

test('indicadores: punto ámbar en Más (datos clave) y en Deudas (algo termina este mes)', () => {
  assert.deepEqual(D.indicadores(demo(HOY), HOY), { mas: true, deudas: false });
  const s = clon(confirmado());
  s.installments[0].remaining = 1; // termina este mes
  assert.deepEqual(D.indicadores(s, HOY), { mas: false, deudas: true });
});

test('revelacion: las frases al terminar de cargar (mes actual, mes difícil, cuánto por día y fecha de salida)', () => {
  const r = D.revelacion(demo(HOY), HOY);
  assert.deepEqual(r.frases.map((f) => f.tipo), ['mes', 'mesDificil', 'salida']);
  assert.equal(r.frases[0].texto, 'Octubre alcanza: pagás $354.364 de la tarjeta.');
  assert.equal(r.frases[1].texto, 'Enero es el mes difícil: faltan $202.000. Ya lo tenemos en la mira.');
  assert.equal(r.frases[2].texto, 'Podés gastar $3.100 por día y salís de la tarjeta en marzo de 2027.');
  assert.equal(r.supuesto, 'Si de acá en más pagás completo lo que consumís en el mes');
  assert.deepEqual(D.revelacion(emptyState(HOY), HOY), { frases: [], supuesto: null });
  const sin = sinDeudas();
  assert.deepEqual(D.revelacion(sin, HOY).frases.map((f) => f.tipo), ['mes']);
  assert.equal(D.revelacion(sin, HOY).supuesto, null);
});

// ============================================================================
// CIERRE DE MES y recordatorio
// ============================================================================
test('cierreDeMes: aparece el primer día hábil del mes, con lo esperado y sin tono de examen', () => {
  const c = D.cierreDeMes(demo(HOY), fecha(2026, 11, 2)); // lunes 2 de noviembre
  assert.equal(c.aplica, true);
  assert.equal(c.mes, '2026-10');
  assert.equal(c.pregunta, '¿Cómo te fue en octubre?');
  assert.equal(r0(c.esperado), 84364);
  assert.equal(c.textoEsperado, 'Esperábamos que te sobraran $84.364');
  assert.equal(c.resultado, null);
  assert.equal(D.cierreDeMes(demo(HOY), fecha(2026, 11, 9)).aplica, false);
  assert.equal(D.cierreDeMes(demo(HOY), fecha(2026, 11, 1)).aplica, false, 'el domingo todavía no es día hábil');
  assert.equal(D.cierreDeMes(demo(HOY), fecha(2026, 11, 3)).aplica, true);
  const visto = clon(demo(HOY));
  visto.seen.cierres = ['2026-10'];
  assert.equal(D.cierreDeMes(visto, fecha(2026, 11, 2)).aplica, false);
  assert.equal(D.cierreDeMes(emptyState(HOY), fecha(2026, 11, 2)).aplica, false);
  // si se guardó lo que se esperaba ese mes, se usa eso
  const guardado = clon(demo(HOY));
  guardado.seen.proyecciones = { '2026-10': 120000 };
  assert.equal(D.cierreDeMes(guardado, fecha(2026, 11, 2)).esperado, 120000);
});

test('cierreDeMes: con lo gastado calcula la diferencia y el botón para ajustar los gastos de la casa', () => {
  const c = D.cierreDeMes(demo(HOY), fecha(2026, 11, 2), { gastoTotal: 800000, pagoVisa: 300000 });
  assert.equal(c.resultado.previstos, 740000);
  assert.equal(c.resultado.diferencia, 60000);
  assert.equal(c.resultado.texto, 'Gastaste $60.000 más de lo previsto.');
  assert.equal(c.resultado.sugerido, 700000);
  assert.equal(c.resultado.boton, 'Ajustar mis gastos de la casa a $700.000');
  assert.equal(c.resultado.pagoVisa, 300000);
  const menos = D.cierreDeMes(demo(HOY), fecha(2026, 11, 2), { gastoTotal: 700000 });
  assert.equal(menos.resultado.texto, 'Gastaste $40.000 menos de lo previsto.');
  assert.equal(menos.resultado.pagoVisa, null);
  const igual = D.cierreDeMes(demo(HOY), fecha(2026, 11, 2), { gastoTotal: 740500 });
  assert.equal(igual.resultado.texto, 'Gastaste más o menos lo previsto.');
  assert.equal(igual.resultado.boton, null);
  assert.equal(D.cierreDeMes(demo(HOY), fecha(2026, 11, 2), { gastoTotal: '' }).resultado, null);
});

test('icsVencimiento: .ics válido con la fecha real del resumen y alarma 2 días antes', () => {
  const r = D.icsVencimiento(demo(HOY), HOY);
  assert.equal(r.ok, true);
  assert.equal(r.fecha, '2026-10-10');
  assert.equal(r.nombreArchivo, 'vencimiento-visa-2026-10-10.ics');
  const c = r.contenido;
  assert.ok(c.endsWith('\r\n'));
  assert.ok(c.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'));
  assert.equal(c.includes('\n') && c.split('\n').every((l, i, a) => i === a.length - 1 || l.endsWith('\r')), true, 'todas las líneas terminan en CRLF');
  const lineas = c.split('\r\n').filter(Boolean);
  assert.ok(lineas.every((l) => new TextEncoder().encode(l).length <= 75), 'líneas de hasta 75 bytes');
  const desplegado = c.replace(/\r\n /g, '');
  for (const clave of ['BEGIN:VCALENDAR', 'END:VCALENDAR', 'BEGIN:VEVENT', 'END:VEVENT', 'BEGIN:VALARM', 'END:VALARM', 'PRODID:', 'UID:vence-demo-visa-20261010@miscuentas', 'DTSTAMP:20261004T000000Z', 'DTSTART:20261010T090000', 'DTEND:20261010T093000', 'SUMMARY:Vence la Visa', 'ACTION:DISPLAY', 'TRIGGER:-P2D']) {
    assert.ok(desplegado.includes(clave), clave);
  }
  assert.match(desplegado, /DESCRIPTION:Vence la Visa\. Pago mínimo del resumen: \$270\.000\./);
  // la alarma está dentro del evento y los bloques están bien anidados
  assert.ok(desplegado.indexOf('BEGIN:VEVENT') < desplegado.indexOf('BEGIN:VALARM'));
  assert.ok(desplegado.indexOf('END:VALARM') < desplegado.indexOf('END:VEVENT'));
  assert.equal((desplegado.match(/^BEGIN:/gm) || []).length, (desplegado.match(/^END:/gm) || []).length);
});

test('icsVencimiento: después del vencimiento usa el próximo y sin resumen pide cargarlo', () => {
  const r = D.icsVencimiento(demo(HOY), fecha(2026, 10, 12));
  assert.equal(r.ok, true);
  assert.equal(r.fecha, '2026-11-07');
  assert.doesNotMatch(r.contenido, /Pago mínimo/);
  const sin = demo(HOY);
  sin.debts[0].statement = null;
  assert.deepEqual(D.icsVencimiento(sin, HOY), { ok: false, mensaje: 'Cargá el último resumen para saber qué día vence.' });
  assert.equal(D.icsVencimiento(emptyState(HOY), HOY).ok, false);
  const pasado = D.icsVencimiento(demo(HOY), fecha(2027, 3, 1));
  assert.equal(pasado.ok, false);
  assert.equal(pasado.mensaje, 'Cargá el resumen nuevo para saber qué día vence.');
});

// ============================================================================
// glosario y textos
// ============================================================================
test('glosario: pago mínimo, saldo actual, interés mensual, estimado y provisorio', () => {
  for (const t of ['pago minimo', 'Pago mínimo', 'saldo actual', 'interes mensual', 'Interés mensual', 'estimado', 'provisorio']) {
    const g = D.glosario(t);
    assert.ok(g && g.titulo && g.texto.length > 30, t);
  }
  assert.equal(D.glosario('Pago mínimo').titulo, 'Pago mínimo');
  assert.equal(D.glosario('cualquier cosa'), null);
  assert.equal(D.glosario(undefined), null);
});

test('textos fijos: pie de decisión, supuesto de la fecha y limitaciones (incluye aumentos e inflación)', () => {
  assert.equal(D.PIE_DECISION, 'Es una estimación con los datos que cargaste. No es asesoramiento financiero.');
  assert.equal(D.ASUME_SALIDA, 'Si de acá en más pagás completo lo que consumís en el mes');
  assert.ok(D.LIMITACIONES.includes('No incluye aumentos de sueldo ni suba de precios.'));
  assert.ok(D.LIMITACIONES.some((t) => /No incluye lo que vos y tu familia compren/.test(t)));
});

test('ningún texto visible usa las palabras prohibidas', () => {
  const rid = 'demo-hijo-debe';
  const variantes = [demo(HOY), sinAfip(), confirmado(), sinDeudas(), clon(emptyState(HOY))];
  const viejo = demo(HOY);
  const eterna = sinAfip();
  eterna.debts[0].balance = 8000000;
  eterna.debts[0].rate = 9;
  eterna.debts[0].minPayment = 100000;
  const faltaMes = sinAfip();
  faltaMes.expenses[0].amount = 1500000;
  const todo = [];
  for (const [s, hoy] of [[variantes[0], HOY], [variantes[1], HOY], [variantes[2], HOY], [variantes[3], HOY], [variantes[4], HOY], [viejo, fecha(2026, 10, 27)], [eterna, HOY], [faltaMes, HOY], [demo(HOY), fecha(2026, 10, 9)]]) {
    todo.push(D.hero(s, hoy), D.paraGastarHoy(s, hoy), D.salidaTarjeta(s, hoy), D.vencimientos(s, hoy), D.ahoraToca(s, hoy), D.gustosEscenarios(s, hoy), D.siguientePaso(s, hoy), D.revelacion(s, hoy), D.completitud(s, hoy), D.cicloTarjeta(s, hoy), D.escenariosPago(s, hoy, { otro: 500000 }), D.deudaSobreIngreso(s, hoy), D.liberaciones(s, hoy), D.meDeben(s, hoy), D.cierreDeMes(s, hoy, { gastoTotal: 900000 }));
    for (let i = 0; i < 14; i++) todo.push(D.eventosMes(s, i, hoy), D.lineasMes(s, i, hoy));
    for (const key of ['2026-10', '2026-12', '2027-01', '2027-02']) todo.push(D.opcionesMesDificil(s, key, hoy));
    for (const desde of ['2026-10', '2026-12', '2027-01', '2027-06']) for (const monto of [20000, 300000, 660000]) todo.push(D.veredicto(s, viaje(monto, desde), hoy));
    todo.push(D.mapaMeses(s, viaje(300000, '2026-12'), hoy), D.topeSinCosto(s, '2026-12', { today: hoy }), D.topeSinCosto(s, '2027-05', { today: hoy }));
    if (s.receivables.length) todo.push(D.escenariosCobro(s, rid, hoy), D.mensajeWhatsApp(s, rid, hoy, { monto: 50000 }), D.interesDeCobro(s, rid));
  }
  todo.push(D.LIMITACIONES, D.GLOSARIO, D.PIE_DECISION, D.ASUME_SALIDA, D.LEYENDA_MAPA);
  const todosLosTextos = textos(todo);
  assert.ok(todosLosTextos.length > 1000, 'se revisaron muchos textos');
  for (const t of todosLosTextos) assert.doesNotMatch(t, PROHIBIDAS, t);
  // "Podés respirar" solo si no hay estimados ni pendientes (ver el test de vencimientos)
  for (const t of textos(D.vencimientos(demo(HOY), HOY))) assert.doesNotMatch(t, /Podés respirar/);
  // nadie ve "5.744 por día" ni el interés por día fuera de la pantalla de la tarjeta (interesTarjeta lo trae, las demás no)
  for (const t of textos([D.hero(demo(HOY), HOY), D.revelacion(demo(HOY), HOY), D.siguientePaso(demo(HOY), HOY), D.vencimientos(demo(HOY), HOY)])) assert.doesNotMatch(t, /\$3\.894/);
});

test('nada de lo que devuelve derive trae NaN, undefined ni Infinity en los textos', () => {
  const s = demo(HOY);
  const vistos = textos([D.hero(s, HOY), D.vencimientos(s, HOY), D.lineasMes(s, 4, HOY), D.veredicto(s, viaje(300000, '2026-12'), HOY), D.escenariosPago(s, HOY), D.siguientePaso(s, HOY)]);
  for (const t of vistos) assert.doesNotMatch(t, /NaN|undefined|Infinity|\[object/, t);
});

test('sin ingresos: el motor corre, el hero pide cargarlos y las demás funciones no se rompen', () => {
  const s = sinAfip();
  s.incomes = [];
  assert.equal(D.hero(s, HOY).estado, 'sinIngresos');
  const sim = D.run(s, { today: HOY });
  assert.ok(sim.months[0].free < 0);
  assert.doesNotThrow(() => {
    D.veredicto(s, viaje(100000, '2026-12'), HOY);
    D.mapaMeses(s, viaje(100000, '2026-12'), HOY);
    D.lineasMes(s, 0, HOY);
    D.siguientePaso(s, HOY);
    D.escenariosPago(s, HOY);
  });
});

test('sin deudas: no hay tarjeta, ni salida, ni escenarios, y las demás pantallas siguen andando', () => {
  const s = sinDeudas();
  assert.equal(D.salidaTarjeta(s, HOY).estado, 'sinTarjeta');
  assert.equal(D.escenariosPago(s, HOY).estado, 'sinTarjeta');
  assert.equal(D.vencimientos(s, HOY).filas.length, 0);
  assert.equal(D.ahoraToca(s, HOY), null);
  assert.deepEqual(D.liberaciones(s, HOY).items, []);
  const g = D.gustosEscenarios(s, HOY);
  assert.equal(g.hayTarjeta, false);
  assert.ok(g.escenarios.every((e) => e.salida === null && e.salidaTexto === 'Sin deuda en la tarjeta'));
  assert.equal(D.hero(s, HOY).tieneDeuda, false);
  assert.equal(D.cicloTarjeta(s, HOY).hayResumen, false);
});

test('plataDeHoy: lo que hay en la cuenta y la pregunta de si ya cobró', () => {
  assert.deepEqual(D.plataDeHoy(demo(HOY)), { hay: true, rotulo: 'Plata de hoy', monto: 120000, cobroEsteMes: true, pregunta: null });
  const s = clon(demo(HOY));
  s.settings.cobroEsteMes = null;
  assert.equal(D.plataDeHoy(s).pregunta, '¿Ya cobraste este mes?');
  s.settings.cash = 0;
  assert.deepEqual(D.plataDeHoy(s), { hay: false, rotulo: 'Plata de hoy', monto: 0, cobroEsteMes: null, pregunta: null });
});

test('proyeccion: filas de Meses con estado, eventos y los chips de la cabecera', () => {
  const p = D.proyeccion(demo(HOY), HOY, { n: 4 });
  assert.equal(p.hayIngresos, true);
  assert.equal(p.filas.length, 4);
  assert.deepEqual(p.filas.map((f) => [f.key, f.mesCorto, f.compacto, f.code, f.label, f.esActual]), [
    ['2026-10', 'Oct', '84 mil', 'bien', 'Alcanza', true],
    ['2026-11', 'Nov', '71 mil', 'bien', 'Alcanza', false],
    ['2026-12', 'Dic', '534 mil', 'bien', 'Alcanza', false],
    ['2027-01', 'Ene', '−202 mil', 'falta', 'Falta plata', false],
  ]);
  assert.equal(p.filas[0].evento, 'Movilidad: 21 días (feriado del 12)');
  assert.deepEqual(p.filas[2].eventos, ['Movilidad: 21 días (feriados del 8 y 25)', 'Aguinaldo estimado: +$450.000']);
  assert.equal(p.filas[3].evento, 'Feria de enero: este mes no cobrás movilidad');
  assert.equal(p.filas[0].estimado, true);
  assert.equal(p.mejorMes.texto, 'Mejor mes: junio +$804.364');
  assert.equal(p.mesDificil.texto, 'Mes difícil: enero −$202.000');
  assert.equal(D.proyeccion(demo(HOY), HOY).filas.length, 12);
  assert.equal(D.proyeccion(demo(HOY), HOY, { n: 500 }).filas.length, 120);
});

test('proyeccion: sin mes difícil no hay chip, un mes sin eventos lo dice y sin ingresos no hay mejor mes', () => {
  const s = confirmado();
  s.incomes = [{ id: 's', name: 'Sueldo', kind: 'sueldo', amount: 1400000 }];
  const p = D.proyeccion(s, HOY);
  assert.equal(p.mesDificil, null);
  assert.ok(p.filas.some((f) => f.evento === 'Un mes sin sorpresas.' && f.eventos.length === 0));
  assert.equal(p.filas[0].estimado, false);
  const sin = emptyState(HOY);
  const q = D.proyeccion(sin, HOY, { n: 4 });
  assert.equal(q.hayIngresos, false);
  assert.equal(q.mejorMes, null);
});

test('recompensa: lo que se dice al terminar cada paso del armado', () => {
  const s = demo(HOY);
  const t = (n) => D.recompensa(s, n, HOY);
  assert.equal(t(1).texto, 'Listo, Ana. Somos 4 en las cuentas.');
  assert.equal(t(2).texto, 'En octubre entran $1.186.364.');
  assert.equal(t(3).texto, 'En octubre entran $1.186.364. En enero, $900.000.');
  assert.equal(t(4).texto, 'Ahora vas a ver cómo vienen tus meses. Es para ordenarlos, no para asustarte.');
  assert.equal(t(5).texto, 'El de $80.000 termina en julio de 2027; desde agosto queda libre esa plata.');
  // el paso de la tarjeta es una fecha y una acción, con el supuesto debajo (nunca el interés por día ni por mes)
  assert.equal(t(6).texto, 'Con lo que cargaste, salís de la tarjeta en marzo de 2027.');
  assert.equal(t(6).detalle, 'Si de acá en más pagás completo lo que consumís en el mes');
  assert.equal(t(6).provisoria, true);
  assert.equal(t(6).accion.texto, 'Ver mi panorama');
  assert.doesNotMatch(t(6).texto, /por d[ií]a|por mes/);
  assert.equal(t(7).texto, 'Hijo te debe $400.000. Con $50.000 por mes termina en mayo de 2027.');
  assert.equal(D.recompensa(s, 8, HOY), null);
  // sin ingresos todavía no hay nada que calcular
  assert.equal(D.recompensa(emptyState(HOY), 2, HOY), null);
  assert.equal(D.recompensa(emptyState(HOY), 1, HOY).texto, 'Listo.');
  // nadie te debe
  const sinDeben = clon(s);
  sinDeben.receivables = [];
  assert.match(D.recompensa(sinDeben, 7, HOY).texto, /^Anotado: por ahora nadie te debe\./);
  // sin préstamos en el paso 5 no hay frase
  assert.equal(D.recompensa(sinDeudas(), 5, HOY), null);
  for (let n = 1; n <= 7; n++) for (const x of textos(D.recompensa(s, n, HOY))) assert.doesNotMatch(x, PROHIBIDAS);
});

test('rendimiento: 13 corridas distintas del motor tardan menos de 150 ms', () => {
  const s = demo(HOY);
  D.limpiarMemo();
  const t = performance.now();
  for (let i = 0; i < 13; i++) D.run(s, { today: HOY, extra: [{ id: 'x', amount: 1000 * (i + 1), from: '2026-12', to: '2026-12' }] });
  assert.ok(performance.now() - t < 150);
});
