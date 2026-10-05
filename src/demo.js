// Ejemplo ILUSTRATIVO: cifras redondas y nombres genéricos (Vos, Pareja, Hija, Hijo). No son datos de nadie.
// La app lo usa para "Ver un ejemplo" y los tests lo usan como fixture. Los ids son fijos para que sea estable.

import { emptyState } from './store.js';
import { addDays, toISO, monthKeyOf, toDate } from './format.js';

/**
 * Estado v2 de ejemplo, armado alrededor de `today` (Date). settings.demo = true.
 * Sueldo 900.000, movilidad 300.000 por 22 días, tarjeta 1.800.000 al 6,49% con mínimo 270.000,
 * préstamos 80.000 x 10 y 12.000 x 29 por planilla, "Hijo" debe 400.000, plan de AFIP sin datos.
 */
export function demo(today = new Date()) {
  const t = toDate(today) || new Date();
  const s = emptyState(t);
  const start = monthKeyOf(t);
  const hoy = toISO(t);
  const cierre = addDays(t, -6);
  const vence = addDays(cierre, 12);

  s.settings = {
    ...s.settings,
    start,
    name: 'Ana',
    cash: 120000,
    cobroEsteMes: true,
    salaryNetOfPayroll: false,
    onboarded: true,
    onboardingStep: 7,
    pasos: { familia: true, sueldo: true, movilidad: true, gastos: true, planilla: true, tarjeta: true, medeben: true },
    demo: true,
  };
  s.settings.people = 'Vos, Pareja, Hija, Hijo';
  s.people = [
    { id: 'demo-vos', name: 'Vos', role: 'yo' },
    { id: 'demo-pareja', name: 'Pareja', role: 'pareja' },
    { id: 'demo-hija', name: 'Hija', role: 'hija' },
    { id: 'demo-hijo', name: 'Hijo', role: 'hijo' },
  ];
  s.incomes = [
    { id: 'demo-sueldo', name: 'Sueldo', owner: 'Vos', amount: 900000, kind: 'sueldo' },
    {
      id: 'demo-movilidad',
      name: 'Movilidad',
      owner: 'Vos',
      amount: 0,
      kind: 'movilidad',
      fullMonthAmount: 300000,
      fullMonthDays: 22,
      noPayMonths: [1],
      daysByMonthNumber: { 7: 15 },
      estimated: true,
    },
    { id: 'demo-aguinaldo', name: 'Aguinaldo', owner: 'Vos', amount: 450000, months: [6, 12], kind: 'aguinaldo', estimated: true },
  ];
  s.expenses = [
    { id: 'demo-casa', name: 'Gastos de la casa y del día a día', owner: 'Vos', amount: 640000, kind: 'casa', estimated: true },
    { id: 'demo-gustos', name: 'Gustos y sorpresas', owner: 'Vos', amount: 100000, kind: 'gustos', estimated: true },
  ];
  s.installments = [
    { id: 'demo-prestamo-a', name: 'Préstamo personal', owner: 'Vos', amount: 80000, remaining: 10, first: start, payroll: true, total: 36 },
    { id: 'demo-prestamo-b', name: 'Préstamo de consumo', owner: 'Vos', amount: 12000, remaining: 29, first: start, payroll: true, total: 48 },
  ];
  s.debts = [
    {
      id: 'demo-visa',
      name: 'Tarjeta Visa',
      kind: 'card',
      creditor: 'Banco',
      balance: 1800000,
      rate: 6.49,
      minPayment: 270000,
      statement: {
        closedOn: toISO(cierre),
        dueOn: toISO(vence),
        nextCloseOn: toISO(addDays(cierre, 28)),
        nextDueOn: toISO(addDays(vence, 28)),
        total: 1800000,
        min: 270000,
        label: 'septiembre',
        loadedAt: toISO(addDays(t, -4)),
        newCharges: 700000,
      },
      payments: [],
      planned: {},
      holders: [
        { personId: 'demo-hijo', amount: 400000 },
        { personId: 'demo-pareja', amount: 300000 },
      ],
    },
  ];
  s.receivables = [
    { id: 'demo-hijo-debe', person: 'Hijo', personId: 'demo-hijo', name: 'Lo que usó de la tarjeta', balance: 400000, rate: 0, monthlyPayment: 0, payments: [], note: 'El interés ya está incluido en lo que debe.' },
  ];
  s.spent = [
    { id: 'demo-gasto-1', date: hoy, amount: 12000, cat: 'gustos', label: 'Salida' },
    { id: 'demo-gasto-2', date: hoy, amount: 30000, cat: 'casa', label: 'Súper' },
  ];
  s.pending = [{ id: 'afip', label: 'Plan de pagos de AFIP', target: 'afip' }];
  return s;
}
