import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate, compare, addMonths, isActive, installmentEnd } from '../src/engine.js';

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
