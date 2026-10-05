import test from 'node:test';
import { workdays } from '../src/calendar.js';
import assert from 'node:assert/strict';
import { simulate, compare, addMonths, isActive, installmentEnd, amountFor, daysFor } from '../src/engine.js';

const base = () => ({
  settings: { start: '2026-10', buffer: 0, cash: 0, strategy: 'avalanche', deficitRate: 0 },
  incomes: [{ id: 'i1', name: 'Sueldo', amount: 1000 }],
  expenses: [],
  installments: [],
  debts: [],
});

test('addMonths cruza de año', () => {
  assert.equal(addMonths('2026-12', 1), '2027-01');
  assert.equal(addMonths('2026-10', -10), '2025-12');
});

test('aguinaldo solo en jun y dic', () => {
  const ag = { amount: 500, months: [6, 12] };
  assert.equal(isActive(ag, '2026-12'), true);
  assert.equal(isActive(ag, '2026-11'), false);
});

test('cuotas: fin correcto', () => {
  assert.equal(installmentEnd({ first: '2026-10', remaining: 3 }), '2026-12');
});

test('sobra = ingresos - gastos - cuotas', () => {
  const st = base();
  st.expenses = [{ id: 'e', amount: 300 }];
  st.installments = [{ id: 'c', amount: 200, first: '2026-10', remaining: 2 }];
  const m = simulate(st).months;
  assert.equal(m[0].free, 500);
  assert.equal(m[1].free, 500);
  assert.equal(m[2].free, 700); // terminó la cuota
});

test('avalancha paga primero la deuda de mayor interés y libera mes', () => {
  const st = base();
  st.debts = [
    { id: 'a', name: 'Préstamo', kind: 'loan', balance: 500, rate: 0, minPayment: 0 },
    { id: 'b', name: 'Tarjeta', kind: 'card', balance: 500, rate: 10, minPayment: 0 },
  ];
  const r = simulate(st);
  // mes 1: la tarjeta crece a 550 y se paga entera; los 450 restantes van al préstamo
  assert.equal(r.months[0].debts.b, 0);
  assert.equal(r.months[0].debts.a, 50);
  assert.equal(r.debtFreeMonth, '2026-11');
});

test('sin estrategia el interés se acumula', () => {
  const st = base();
  st.settings.strategy = 'none';
  st.debts = [{ id: 'b', name: 'Tarjeta', kind: 'card', balance: 1000, rate: 5, minPayment: 0 }];
  const r = simulate(st);
  assert.ok(r.months[11].debtTotal > 1000 * 1.05 ** 11);
  assert.equal(r.debtFreeMonth, null);
});

test('faltante se financia en la tarjeta', () => {
  const st = base();
  st.expenses = [{ id: 'e', amount: 1500 }];
  st.debts = [{ id: 'b', name: 'Tarjeta', kind: 'card', balance: 0, rate: 0, minPayment: 0 }];
  const m = simulate(st).months;
  assert.equal(m[0].status, 'bad');
  assert.equal(m[0].debtTotal, 500);
  assert.equal(m[1].debtTotal, 1000);
});

test('el colchón va a ahorro y no a deuda', () => {
  const st = base();
  st.settings.buffer = 400;
  st.debts = [{ id: 'b', name: 'T', kind: 'card', balance: 1000, rate: 0, minPayment: 0 }];
  const m = simulate(st).months;
  assert.equal(m[0].debtTotal, 400);
  assert.equal(m[0].cash, 400);
});

test('compare: un gasto mensual nuevo atrasa la libertad', () => {
  const st = base();
  st.debts = [{ id: 'b', name: 'T', kind: 'card', balance: 5000, rate: 3, minPayment: 0 }];
  const c = compare(st, [{ id: 'x', amount: 300, from: '2026-10' }]);
  assert.ok(c.delayMonths > 0);
  assert.ok(c.extraInterest > 0);
});

test('lo que le deben entra como cobro mensual y se termina', () => {
  const st = base();
  st.receivables = [{ id: 'r', person: 'Hijo', name: 'Préstamo', balance: 250, monthlyPayment: 100, rate: 0 }];
  const r = simulate(st);
  assert.equal(r.months[0].collections, 100);
  assert.equal(r.months[0].free, 1100);
  assert.equal(r.months[2].collections, 50);
  assert.equal(r.months[2].owed, 0);
  assert.equal(r.months[3].collections, 0);
  assert.equal(r.receivables[0].paidOn, '2026-12');
});

test('lo que le deben sin cuota pactada no entra y acumula interés', () => {
  const st = base();
  st.receivables = [{ id: 'r', person: 'Hijo', name: 'P', balance: 1000, monthlyPayment: 0, rate: 10 }];
  const m = simulate(st).months;
  assert.equal(m[0].collections, 0);
  assert.ok(Math.abs(m[1].owed - 1210) < 0.01);
});

test('montos distintos en meses puntuales (enero sin movilidad)', () => {
  const st = base();
  st.incomes = [
    { id: 'i1', name: 'Sueldo', amount: 1000 },
    { id: 'i2', name: 'Movilidad', amount: 400, overrides: { '2027-01': 0, '2026-12': 300 } },
  ];
  const m = simulate(st).months;
  assert.equal(m[0].income, 1400); // oct
  assert.equal(m[2].income, 1300); // dic con menos
  assert.equal(m[3].income, 1000); // enero sin movilidad
  assert.equal(amountFor(st.incomes[1], '2027-02'), 400);
});

test('días hábiles: octubre 2026 tiene 21 (feriado 12/10)', () => {
  assert.equal(workdays('2026-10'), 21);
  assert.equal(workdays('2026-11'), 20);
  assert.equal(workdays('2026-12'), 21);
});

test('pago por día: feriados, julio con 15 días y enero sin movilidad', () => {
  const it = { perDay: 1000, days: { '2027-07': 15, '2027-01': 0 } };
  assert.equal(amountFor(it, '2026-10'), 21000);
  assert.equal(amountFor(it, '2027-07'), 15000);
  assert.equal(amountFor(it, '2027-01'), 0);
  assert.equal(daysFor(it, '2026-11'), 20);
  assert.equal(amountFor({ ...it, overrides: { '2026-10': 5 } }, '2026-10'), 5); // el monto fijo manda
});

// ---------- pago elegido (debts[].planned) y payments por mes ----------
const conTarjeta = (extra = {}) => {
  const st = base();
  st.debts = [{ id: 'v', name: 'Visa', kind: 'card', balance: 5000, rate: 0, minPayment: 100, ...extra }];
  return st;
};

test('payments: sin pago elegido devuelve mínimo + barrido por deuda y coincide con debtPayments', () => {
  const m = simulate(conTarjeta()).months;
  assert.equal(m[0].payments.v, 1000); // 100 de mínimo + 900 que sobran
  assert.equal(m[0].debtPayments, 1000);
  assert.equal(m[0].debts.v, 4000);
});

test('planned: el pago elegido reemplaza mínimo y barrido; lo que no se paga queda en caja', () => {
  const st = conTarjeta({ planned: { '2026-10': 300 } });
  const m = simulate(st).months;
  assert.equal(m[0].payments.v, 300);
  assert.equal(m[0].debts.v, 4700);
  assert.equal(m[0].free, 700); // 1000 - 300
  assert.equal(m[0].cash, 700); // el resto no va a la tarjeta
  assert.equal(m[1].payments.v, 1000); // sin plan, vuelve el barrido
  assert.equal(m[1].cash, 700);
});

test('planned: elegir pagar menos que el mínimo o cero se respeta', () => {
  const m = simulate(conTarjeta({ planned: { '2026-10': 40, '2026-11': 0 } })).months;
  assert.equal(m[0].payments.v, 40);
  assert.equal(m[0].cash, 960);
  assert.equal(m[1].payments.v, 0);
  assert.equal(m[1].debts.v, 4960);
});

test('planned: se topea al saldo y no afecta a otras deudas', () => {
  const st = base();
  st.debts = [
    { id: 'v', name: 'Visa', kind: 'card', balance: 200, rate: 0, minPayment: 0, planned: { '2026-10': 5000 } },
    { id: 'p', name: 'Préstamo', kind: 'loan', balance: 3000, rate: 0, minPayment: 0 },
  ];
  const m = simulate(st).months;
  assert.equal(m[0].payments.v, 200);
  assert.equal(m[0].debts.v, 0);
  assert.equal(m[0].payments.p, 800); // lo que queda del mes va a la otra deuda
});

test('planned: una deuda con pago elegido no recibe el barrido de ese mes', () => {
  const st = base();
  st.debts = [
    { id: 'v', name: 'Visa', kind: 'card', balance: 5000, rate: 10, minPayment: 0, planned: { '2026-10': 100 } },
    { id: 'p', name: 'Préstamo', kind: 'loan', balance: 5000, rate: 0, minPayment: 0 },
  ];
  const m = simulate(st).months;
  assert.equal(m[0].payments.v, 100);
  assert.equal(m[0].payments.p, 900);
  assert.equal(m[0].debtPayments, 1000);
});

test('planned vacío o null: se ignora (rige el comportamiento de siempre)', () => {
  const a = simulate(conTarjeta()).months;
  const b = simulate(conTarjeta({ planned: { '2026-10': null, '2026-11': '' } })).months;
  assert.deepEqual(b.map((x) => x.debts.v), a.map((x) => x.debts.v));
});

test('planned: si el pago elegido deja el mes en falta, el faltante se financia en la tarjeta', () => {
  const st = conTarjeta({ planned: { '2026-10': 1500 } });
  const m = simulate(st).months;
  assert.equal(m[0].free, -500);
  assert.equal(m[0].shortfall, 500);
  assert.equal(m[0].debts.v, 5000 - 1500 + 500);
});

test('payments incluye la deuda de faltante financiado', () => {
  const st = base();
  st.expenses = [{ id: 'e', amount: 1500 }];
  const m = simulate(st).months;
  assert.equal(m[0].payments._deficit, 0);
  assert.equal(m[1].payments._deficit, 0);
  assert.equal(m[0].debts._deficit, 500);
});
