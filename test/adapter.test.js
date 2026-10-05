import test from 'node:test';
import assert from 'node:assert/strict';
import { toEngine, pagosDelMes, pagosDelResumen, estadoResumen, cuotasQueFaltan, normalizarGasto, gastoAExtras } from '../src/adapter.js';
import { simulate, amountFor, isActive, daysFor } from '../src/engine.js';
import { run, limpiarMemo } from '../src/derive.js';
import { demo } from '../src/demo.js';
import { workdays } from '../src/calendar.js';

const HOY = new Date(2026, 9, 4); // domingo 4 de octubre de 2026
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
const sim = (st, today = HOY, o = {}) => simulate(core(toEngine(st, today)), o);
const r0 = Math.round;

test('toEngine es puro: no modifica el estado (ni siquiera congelado) y es determinista', () => {
  const st = deepFreeze(demo(HOY));
  const a = toEngine(st, HOY);
  const b = toEngine(st, HOY);
  assert.deepEqual(a, b);
  assert.equal(st.debts[0].planned && Object.keys(st.debts[0].planned).length, 0);
});

test('el mes de inicio es el mes real de hoy (no el guardado)', () => {
  const st = demo(HOY);
  st.settings.start = '2025-01';
  assert.equal(toEngine(st, HOY).settings.start, '2026-10');
  assert.equal(toEngine(st, new Date(2027, 1, 20)).settings.start, '2027-02');
  assert.equal(toEngine(st, HOY, { start: '2026-09' }).settings.start, '2026-09');
});

test('la salida lleva strategy, buffer y cash tal cual (la plata de hoy se explica más abajo)', () => {
  const st = demo(HOY);
  st.settings.strategy = 'snowball';
  st.settings.buffer = 25000;
  st.settings.deficitRate = 3;
  const e = toEngine(st, HOY);
  assert.equal(e.settings.strategy, 'snowball');
  assert.equal(e.settings.buffer, 25000);
  assert.equal(e.settings.deficitRate, 3);
  assert.equal(e.settings.horizon, 12);
});

// ---------- movilidad ----------
test('movilidad por día: octubre 2026 = 21 días (feriado del 12) y noviembre 20', () => {
  const e = toEngine(demo(HOY), HOY);
  const mov = e.incomes.find((i) => i.kind === 'movilidad');
  assert.equal(r0(mov.perDay * 100) / 100, 13636.36);
  assert.equal(daysFor(mov, '2026-10'), 21);
  assert.equal(r0(amountFor(mov, '2026-10')), 286364);
  assert.equal(daysFor(mov, '2026-11'), 20);
  assert.equal(r0(amountFor(mov, '2026-11')), 272727);
  assert.equal(daysFor(mov, '2026-12'), 21);
});

test('movilidad: enero no se cobra (noPayMonths) y julio son 15 días (daysByMonthNumber)', () => {
  const mov = toEngine(demo(HOY), HOY).incomes.find((i) => i.kind === 'movilidad');
  assert.equal(isActive(mov, '2027-01'), false);
  assert.equal(amountFor({ ...mov, months: undefined }, '2027-01') > 0, true, 'sin el filtro de meses sí habría monto: lo corta isActive');
  assert.equal(isActive(mov, '2027-07'), true);
  assert.equal(daysFor(mov, '2027-07'), 15);
  assert.equal(r0(amountFor(mov, '2027-07')), 204545);
  assert.equal(isActive(mov, '2027-02'), true);
});

test('movilidad: se expande para todo el horizonte (120 meses), también más allá de un año', () => {
  const mov = toEngine(demo(HOY), HOY).incomes.find((i) => i.kind === 'movilidad');
  assert.equal(Object.keys(mov.days).length, 120);
  assert.equal(daysFor(mov, '2030-07'), 15);
});

test('movilidad: las correcciones puntuales por mes ganan sobre el calendario', () => {
  const st = demo(HOY);
  st.incomes[1].days = { '2026-11': 18 };
  const mov = toEngine(st, HOY).incomes.find((i) => i.kind === 'movilidad');
  assert.equal(daysFor(mov, '2026-11'), 18);
  assert.equal(r0(amountFor(mov, '2026-11')), 245455);
  assert.equal(daysFor(mov, '2026-10'), 21);
});

test('movilidad vencida: se cobra al mes siguiente, así que el calendario se corre un mes', () => {
  const st = demo(HOY);
  st.incomes[1].movilidadVencida = true;
  const mov = toEngine(st, HOY).incomes.find((i) => i.kind === 'movilidad');
  // octubre se cobra por los días trabajados en septiembre (22 en 2026)
  assert.equal(daysFor(mov, '2026-10'), workdays('2026-09'));
  assert.equal(daysFor(mov, '2026-10'), 22);
  // el mes sin trabajo es enero: se paga en febrero y no se paga nada en febrero
  assert.equal(isActive(mov, '2027-02'), false);
  assert.equal(isActive(mov, '2027-01'), true);
  assert.equal(daysFor(mov, '2027-01'), workdays('2026-12'));
  // julio (15 días) se cobra en agosto
  assert.equal(daysFor(mov, '2027-08'), 15);
});

test('movilidad sin "días de un mes completo": se omite del motor y queda pendiente', () => {
  const st = demo(HOY);
  st.incomes[1].fullMonthDays = 0;
  const e = toEngine(st, HOY);
  assert.equal(e.incomes.some((i) => i.kind === 'movilidad'), false);
  assert.ok(e.omitidos.some((o) => o.id === 'demo-movilidad'));
  assert.ok(e.pending.some((p) => p.target === 'movilidad'));
});

test('movilidad vieja con perDay y días guardados (modelo v1) pasa tal cual al motor', () => {
  const st = demo(HOY);
  st.incomes[1] = { id: 'm', name: 'Movilidad', owner: 'Vos', amount: 0, kind: 'movilidad', perDay: 10000, days: { '2026-10': 20 } };
  const mov = toEngine(st, HOY).incomes.find((i) => i.id === 'm');
  assert.equal(amountFor(mov, '2026-10'), 200000);
  assert.equal(amountFor(mov, '2026-11'), 10000 * workdays('2026-11'));
});

// ---------- aguinaldo ----------
test('aguinaldo estimado = 50% del sueldo, en junio y diciembre', () => {
  const st = demo(HOY);
  st.incomes[0].amount = 1000000;
  const agui = toEngine(st, HOY).incomes.find((i) => i.kind === 'aguinaldo');
  assert.equal(amountFor(agui, '2026-12'), 500000);
  assert.equal(amountFor(agui, '2027-06'), 500000);
  assert.equal(isActive(agui, '2027-03'), false);
  const m = sim(st).months;
  assert.equal(m[2].income - sim({ ...st, incomes: st.incomes.filter((i) => i.kind !== 'aguinaldo') }).months[2].income, 500000);
});

test('aguinaldo confirmado (sin estimated) usa el monto cargado, no el 50%', () => {
  const st = demo(HOY);
  delete st.incomes[2].estimated;
  st.incomes[2].amount = 333333;
  const agui = toEngine(st, HOY).incomes.find((i) => i.kind === 'aguinaldo');
  assert.equal(amountFor(agui, '2026-12'), 333333);
});

// ---------- planilla: sueldo neto de los descuentos ----------
const sinAfip = () => {
  const st = demo(HOY);
  st.pending = [];
  return st;
};

test('planilla false: los descuentos se restan y no hay aviso', () => {
  const st = sinAfip();
  st.settings.salaryNetOfPayroll = false;
  const e = toEngine(st, HOY);
  assert.equal(e.flags.provisorio, false);
  assert.deepEqual(e.flags.motivos, []);
  assert.equal(e.incomes[0].payrollAdd, undefined);
  assert.equal(r0(sim(st).months[0].free), 84364);
});

test('planilla true: el sueldo ya viene sin los descuentos, así que se le suman (y al terminar un préstamo se ve la liberación)', () => {
  const st = sinAfip();
  st.settings.salaryNetOfPayroll = true;
  const e = toEngine(st, HOY);
  assert.equal(e.incomes[0].payrollAdd, 92000);
  assert.equal(e.incomes[0].amount, 992000);
  const m = sim(st).months;
  assert.equal(r0(m[0].free), 84364 + 92000);
  // el préstamo de 80.000 termina en julio de 2027: desde agosto sobran 80.000 más
  assert.equal(r0(m[10].free - m[9].free), r0(m[10].income - m[9].income) + 80000);
});

test('planilla true con un aumento de sueldo: el sueldo nuevo también lleva la suma (no se pierde ni se duplica)', () => {
  const st = sinAfip();
  st.settings.salaryNetOfPayroll = true;
  st.incomes[0].to = '2027-02';
  st.incomes.splice(1, 0, { id: 'nuevo', name: 'Sueldo', owner: 'Vos', kind: 'sueldo', amount: 1000000, from: '2027-03' });
  const e = toEngine(st, HOY);
  const sueldos = e.incomes.filter((i) => i.kind === 'sueldo');
  assert.deepEqual(sueldos.map((i) => i.amount), [992000, 1092000]);
  const m = sim(st).months;
  const mismo = sinAfip();
  mismo.settings.salaryNetOfPayroll = true;
  const base = sim(mismo).months;
  assert.equal(r0(m[3].income), r0(base[3].income)); // enero: el sueldo viejo con su suma
  assert.equal(r0(m[5].income - base[5].income), 100000); // marzo: solo cambia el aumento
  // dos sueldos al mismo tiempo no duplican la suma
  const dos = sinAfip();
  dos.settings.salaryNetOfPayroll = true;
  dos.incomes.push({ id: 'otro', name: 'Sueldo 2', owner: 'Pareja', kind: 'sueldo', amount: 500000 });
  assert.equal(toEngine(dos, HOY).incomes.filter((i) => i.payrollAdd).length, 1);
});

test('planilla null (no sé): no resta en silencio, avisa y deja los números como provisorios', () => {
  const st = sinAfip();
  st.settings.salaryNetOfPayroll = null;
  const e = toEngine(st, HOY);
  assert.equal(e.flags.provisorio, true);
  assert.ok(e.flags.motivos.length >= 1);
  assert.match(e.flags.motivos.join(' '), /descuentos del recibo/);
  assert.ok(e.flags.motivosDetalle.some((m) => m.code === 'planilla'));
  assert.ok(e.pending.some((p) => p.target === 'planilla' && p.cambiaResultado));
  assert.equal(e.incomes[0].payrollAdd, undefined);
});

test('planilla null sin préstamos por planilla: no hay nada que preguntar', () => {
  const st = sinAfip();
  st.settings.salaryNetOfPayroll = null;
  st.installments = [];
  const e = toEngine(st, HOY);
  assert.equal(e.flags.provisorio, false);
  assert.equal(e.pending.length, 0);
});

// ---------- ítems incompletos ----------
test('ítems incompletos (plan de AFIP sin monto) no van al motor: se reportan como pendientes', () => {
  const st = sinAfip();
  st.settings.salaryNetOfPayroll = false;
  st.installments.push({ id: 'afip-1', name: 'Plan de pagos de AFIP', owner: 'Vos', amount: 0, remaining: 0, first: '2026-10', payroll: true });
  st.installments.push({ id: 'x-1', name: 'Celular', owner: 'Vos', amount: 5000, remaining: 0, first: '2026-10' });
  st.expenses.push({ id: 'g-sin', name: 'Sin monto', amount: 0 });
  const e = toEngine(st, HOY);
  assert.equal(e.installments.length, 2);
  assert.deepEqual(e.omitidos.map((o) => o.id).sort(), ['afip-1', 'g-sin', 'x-1']);
  assert.ok(e.pending.some((p) => p.id === 'afip' && p.target === 'afip' && p.cambiaResultado));
  assert.ok(e.pending.some((p) => p.id === 'cuota:x-1'));
  assert.equal(e.flags.provisorio, true);
  assert.match(e.flags.motivos.join(' '), /AFIP/);
  assert.equal(e.expenses.some((x) => x.id === 'g-sin'), false);
});

test('los datos pendientes cargados por la persona (state.pending) se conservan en la salida', () => {
  const e = toEngine(demo(HOY), HOY);
  assert.deepEqual(e.pending.map((p) => p.id), ['afip']);
  assert.equal(e.flags.estimados.n, 4);
});

// ---------- me deben ----------
test('me deben: un pago ya anotado este mes no se cuenta dos veces', () => {
  const antes = demo(HOY);
  antes.receivables[0].monthlyPayment = 50000;
  const despues = clon(antes);
  despues.receivables[0].balance -= 50000;
  despues.receivables[0].payments = [{ id: 'p1', date: '2026-10-02', amount: 50000 }];
  const a = sim(antes);
  const b = sim(despues);
  assert.equal(toEngine(despues, HOY).receivables[0].balance, 400000);
  assert.deepEqual(b.months.map((m) => m.owed), a.months.map((m) => m.owed));
  assert.deepEqual(b.months.map((m) => m.collections), a.months.map((m) => m.collections));
  assert.equal(b.receivables[0].paidOn, a.receivables[0].paidOn);
  // un pago de un mes anterior sí baja la deuda
  const viejo = clon(despues);
  viejo.receivables[0].payments[0].date = '2026-09-20';
  assert.equal(toEngine(viejo, HOY).receivables[0].balance, 350000);
});

// ---------- deudas: pagos del mes y pago elegido ----------
test('deuda: lo pagado este mes después del cierre se repone en el saldo y se fija como pago elegido', () => {
  const st = demo(HOY); // el resumen cerró el 28 de septiembre
  const antes = sim(st);
  const pagado = clon(st);
  pagado.debts[0].balance -= 300000;
  pagado.debts[0].payments = [{ id: 'p', date: '2026-10-02', amount: 300000 }];
  const e = toEngine(pagado, HOY);
  assert.equal(e.debts[0].balance, 1800000);
  assert.equal(e.debts[0].planned['2026-10'], 300000);
  const despues = sim(pagado);
  assert.equal(r0(despues.months[0].payments['demo-visa']), 300000, 'este mes se pagó lo que se pagó, no el barrido');
  assert.equal(r0(despues.months[0].debts['demo-visa']), r0(antes.months[0].debts['demo-visa'] + (antes.months[0].payments['demo-visa'] - 300000)));
  assert.ok(despues.months[0].cash >= antes.months[0].cash, 'lo que no se pagó queda en caja');
});

test('deuda: un pago anterior al cierre del resumen ya está en su total y no se repone', () => {
  const st = demo(HOY);
  st.debts[0].payments = [{ id: 'p', date: '2026-09-28', amount: 50000 }, { id: 'q', date: '2026-10-01', amount: 40000 }];
  assert.equal(pagosDelMes(st.debts[0], '2026-10').total, 40000);
  assert.equal(pagosDelResumen(st.debts[0]).total, 40000);
  assert.equal(pagosDelResumen(st.debts[0], { key: '2026-10' }).total, 40000);
  const e = toEngine(st, HOY);
  assert.equal(e.debts[0].balance, 1800000 + 40000);
  // sin resumen cargado cuentan todos los de este mes
  st.debts[0].statement = null;
  assert.equal(pagosDelResumen(st.debts[0]).total, 90000);
  assert.equal(toEngine(st, HOY).debts[0].balance, 1800000 + 40000);
});

test('deuda: el pago elegido que ya estaba cargado se respeta si es mayor a lo pagado', () => {
  const st = demo(HOY);
  st.debts[0].planned = { '2026-10': 500000, '2026-11': 100000 };
  st.debts[0].payments = [{ id: 'p', date: '2026-10-02', amount: 300000 }];
  const d = toEngine(st, HOY).debts[0];
  assert.equal(d.planned['2026-10'], 500000);
  assert.equal(d.planned['2026-11'], 100000);
});

test('pagosDelMes: total, orden por fecha y último pago', () => {
  const d = { payments: [{ date: '2026-10-09', amount: 5 }, { date: '2026-10-02', amount: 3 }, { date: '2026-09-30', amount: 100 }, { date: '2026-10-03', amount: 0 }] };
  const r = pagosDelMes(d, '2026-10');
  assert.equal(r.total, 8);
  assert.deepEqual(r.pagos.map((p) => p.date), ['2026-10-02', '2026-10-09']);
  assert.equal(r.ultimo.date, '2026-10-09');
  assert.deepEqual(pagosDelMes(null, '2026-10'), { total: 0, pagos: [], ultimo: null });
});

// ---------- plata de hoy ----------
test('plata de hoy: si ya cobró este mes, el saldo incluye el ingreso del mes y no se cuenta dos veces', () => {
  const st = sinAfip();
  st.settings.salaryNetOfPayroll = false;
  st.settings.cash = 2000000;
  st.settings.cobroEsteMes = true;
  // lo que entra en octubre es 900.000 de sueldo + 286.364 de movilidad: se descuenta de la plata de hoy
  assert.equal(r0(toEngine(st, HOY).settings.cash), 2000000 - 1186364);
  st.settings.cash = 800000;
  assert.equal(toEngine(st, HOY).settings.cash, 0, 'nunca queda negativa');
});

test('plata de hoy: si todavía no cobró se usa tal cual; si no sabe, se descuenta y se avisa', () => {
  const st = sinAfip();
  st.settings.salaryNetOfPayroll = false;
  st.settings.cash = 500000;
  st.settings.cobroEsteMes = false;
  let e = toEngine(st, HOY);
  assert.equal(e.settings.cash, 500000);
  assert.equal(e.flags.motivosDetalle.some((m) => m.code === 'cobro'), false);
  st.settings.cobroEsteMes = null;
  e = toEngine(st, HOY);
  assert.equal(e.settings.cash, 0);
  assert.equal(e.flags.provisorio, true);
  assert.ok(e.flags.motivosDetalle.some((m) => m.code === 'cobro'));
  st.settings.cash = 0;
  assert.equal(toEngine(st, HOY).flags.motivosDetalle.some((m) => m.code === 'cobro'), false);
});

// ---------- compras planificadas y gastos ----------
test('compras planificadas pasan al motor como gastos (una vez, en cuotas, por mes)', () => {
  const st = demo(HOY);
  st.plannedPurchases = [
    { id: 'a', name: 'Viaje', amount: 300000, modo: 'una', desde: '2026-12', cuotas: 1, hecha: false },
    { id: 'b', name: 'Heladera', amount: 660000, modo: 'cuotas', desde: '2026-11', cuotas: 6, hecha: false },
    { id: 'c', name: 'Gimnasio', amount: 20000, modo: 'mensual', desde: '2027-01', cuotas: 1, hecha: false },
  ];
  const e = toEngine(st, HOY);
  const viaje = e.expenses.find((x) => x.id === 'pp_a');
  const heladera = e.expenses.find((x) => x.id === 'pp_b');
  const gim = e.expenses.find((x) => x.id === 'pp_c');
  assert.equal(amountFor(viaje, '2026-12'), 300000);
  assert.equal(isActive(viaje, '2027-01'), false);
  assert.equal(amountFor(heladera, '2027-02'), 110000);
  assert.equal(isActive(heladera, '2027-04'), true); // la sexta cuota
  assert.equal(isActive(heladera, '2027-05'), false);
  assert.equal(isActive(gim, '2030-01'), true);
  assert.equal(isActive(gim, '2026-12'), false);
});

// ---------- estimados ----------
test('estimados: cuenta ingresos y gastos marcados como estimados', () => {
  const e = toEngine(demo(HOY), HOY);
  assert.deepEqual(e.flags.estimados.items.map((x) => x.id).sort(), ['demo-aguinaldo', 'demo-casa', 'demo-gustos', 'demo-movilidad']);
});

// ---------- resumen de la tarjeta ----------
test('estadoResumen: vigente, vencido, viejo y sin resumen, con las fechas reales', () => {
  const d = demo(HOY).debts[0]; // cierra 28/9, vence 10/10; próximo cierre 26/10, vence 7/11
  let e = estadoResumen(d, HOY);
  assert.equal(e.fase, 'vigente');
  assert.equal(e.viejo, false);
  assert.equal(e.dueOn, '2026-10-10');
  assert.equal(e.diasParaVencer, 6);
  assert.equal(e.diasParaCierre, 22);
  e = estadoResumen(d, new Date(2026, 9, 11));
  assert.equal(e.fase, 'vencido');
  assert.equal(e.vencido, true);
  e = estadoResumen(d, new Date(2026, 9, 27));
  assert.equal(e.fase, 'viejo');
  assert.equal(e.viejo, true);
  assert.equal(estadoResumen({ statement: null }, HOY).fase, 'sinResumen');
  assert.equal(estadoResumen(undefined, HOY).hayResumen, false);
});

test('resumen viejo: el motor avisa que el resultado es provisorio', () => {
  const e = toEngine(demo(HOY), new Date(2026, 9, 27));
  assert.equal(e.flags.provisorio, true);
  assert.ok(e.flags.motivosDetalle.some((m) => m.code === 'resumenViejo'));
});

// ---------- cuotas ----------
test('cuotasQueFaltan: "cuota actual 26 de 36" calcula las que faltan, con o sin la de este mes', () => {
  // la 26 ya se descontó, la de este mes todavía no: faltan 10 incluida la de este mes
  assert.deepEqual(cuotasQueFaltan({ actual: 26, total: 36, descontadaEsteMes: false }, HOY), { remaining: 10, first: '2026-10', termina: '2027-07' });
  // la 26 es la de este mes (ya descontada): faltan 10 desde el mes que viene
  assert.deepEqual(cuotasQueFaltan({ actual: 26, total: 36, descontadaEsteMes: true }, HOY), { remaining: 10, first: '2026-11', termina: '2027-08' });
  assert.deepEqual(cuotasQueFaltan({ actual: 36, total: 36 }, HOY), { remaining: 0, first: '2026-10', termina: null });
  assert.equal(cuotasQueFaltan({ actual: 50, total: 36 }, HOY).remaining, 0);
  assert.equal(cuotasQueFaltan({ actual: '', total: '12' }, HOY).remaining, 12);
});

// ---------- gastos hipotéticos ----------
test('normalizarGasto y gastoAExtras: una vez, en cuotas y todos los meses', () => {
  const una = normalizarGasto({ nombre: 'Viaje', monto: 300000, modo: 'una', desde: '2026-12' }, '2026-10');
  assert.equal(una.total, 300000);
  assert.deepEqual(gastoAExtras({ nombre: 'Viaje', monto: 300000, modo: 'una', desde: '2026-12' }, '2026-10'), [
    { id: '_extra', name: 'Viaje', owner: '', kind: 'compra', amount: 300000, from: '2026-12', to: '2026-12' },
  ]);
  const cuotas = normalizarGasto({ nombre: 'Tele', monto: 660000, modo: 'cuotas', desde: '2026-11', cuotas: 6 }, '2026-10');
  assert.equal(cuotas.montoCuota, 110000);
  assert.equal(cuotas.total, 660000);
  assert.equal(normalizarGasto({ nombre: 'Tele', montoCuota: 90000, modo: 'cuotas', cuotas: 6 }, '2026-10').total, 540000);
  assert.deepEqual(gastoAExtras({ nombre: 'Tele', monto: 660000, modo: 'cuotas', desde: '2026-11', cuotas: 6 }, '2026-10')[0].to, '2027-04');
  const mensual = normalizarGasto({ nombre: 'Gimnasio', monto: 20000, modo: 'mensual', desde: '2026-11' }, '2026-10');
  assert.equal(mensual.total, null);
  assert.equal(normalizarGasto({ nombre: 'Gimnasio', monto: 20000, modo: 'mensual', desde: '2026-11', hasta: '2027-02' }, '2026-10').total, 80000);
  assert.equal('to' in gastoAExtras({ nombre: 'G', monto: 1, modo: 'mensual', desde: '2026-11' }, '2026-10')[0], false);
  // valores raros: usa el mes de inicio y el modo "una vez"
  const raro = normalizarGasto({ monto: 'x', modo: 'otro', desde: 'mal' }, '2026-10');
  assert.equal(raro.desde, '2026-10');
  assert.equal(raro.modo, 'una');
  assert.equal(raro.total, 0);
  assert.equal(raro.nombre, 'Gasto nuevo');
});

// ---------- el motor con el estado adaptado ----------
test('con el fixture de ejemplo el motor da los valores congelados', () => {
  limpiarMemo();
  const s = run(demo(HOY), { today: HOY });
  assert.deepEqual(s.months.slice(0, 7).map((m) => r0(m.free)), [84364, 70727, 534364, -202000, 43455, 84364, 354364]);
  assert.equal(s.debts[0].paidOn, '2027-03');
  assert.equal(r0(s.totalInterest), 400168);
});
