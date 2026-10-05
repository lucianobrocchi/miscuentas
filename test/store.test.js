import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STORAGE_KEY, VERSION, MENSAJE_ARCHIVO_INVALIDO, MENSAJE_ARCHIVO_NUEVO,
  uid, currentMonth, emptyState, normalize, migrate, load, save, exportJSON, importJSON, describeState,
  registrarPagoDeuda, aplicarResumen, anotarCobro, registrarGasto, crearCompraPlanificada, marcarCompraHecha,
  elegirPagoTarjeta, aplicarCambios, aplicarAumento, guardarProyeccion, ajustarGastosCasa, marcarVisto, marcarCopia, agregarPersona, diasDesdeCopia,
} from '../src/store.js';
import { demo } from '../src/demo.js';

const HOY = new Date(2026, 9, 4);

// Almacenamiento falso (como localStorage).
const fakeStorage = (inicial = {}) => {
  const m = new Map(Object.entries(inicial));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)), _m: m };
};
const clon = (x) => JSON.parse(JSON.stringify(x));

// Estado como lo guardaba la versión 1 de la app (sin v, sin people[], sin kind, con días y montos por mes).
const v1 = () => ({
  settings: { start: '2026-09', horizon: 12, strategy: 'avalanche', buffer: 0, cash: 50000, deficitRate: 0, people: 'Mamá, Hijo 1, Pareja' },
  incomes: [
    { id: 'i1', name: 'Sueldo', owner: 'Mamá', amount: 800000 },
    { id: 'i2', name: 'Movilidad', owner: 'Mamá', amount: 0, perDay: 10000, days: { '2026-10': 20, '2026-11': 18 }, overrides: { '2026-12': 150000 } },
    { id: 'i3', name: 'Aguinaldo', owner: 'Mamá', amount: 400000, months: [6, 12] },
    { id: 'i4', name: 'Changas', owner: 'Hijo 1', amount: 20000, from: '2026-10', to: '2027-03' },
  ],
  expenses: [
    { id: 'e1', name: 'Supermercado', owner: 'Mamá', amount: 300000 },
    { id: 'e2', name: 'Gustos y sorpresas', owner: 'Mamá', amount: 80000, overrides: { '2026-12': 150000 } },
  ],
  installments: [{ id: 'c1', name: 'Heladera', owner: 'Mamá', amount: 45000, remaining: 8, first: '2026-10' }],
  debts: [{ id: 'd1', name: 'Tarjeta Visa', kind: 'card', creditor: 'Banco', balance: 1000000, rate: 7, minPayment: 100000 }],
  receivables: [{ id: 'r1', person: 'Hijo 1', name: 'Préstamo', balance: 200000, rate: 0, monthlyPayment: 20000 }],
});

test('constantes: la clave de storage no cambia y el modelo es v2', () => {
  assert.equal(STORAGE_KEY, 'miscuentas.v1');
  assert.equal(VERSION, 2);
});

test('uid: ids cortos y únicos', () => {
  const ids = new Set();
  for (let i = 0; i < 5000; i++) ids.add(uid());
  assert.equal(ids.size, 5000);
  for (const id of [...ids].slice(0, 20)) assert.match(id, /^[a-z0-9]{8,}$/);
});

test('currentMonth y emptyState', () => {
  assert.equal(currentMonth(HOY), '2026-10');
  const e = emptyState(HOY);
  assert.equal(e.v, 2);
  assert.equal(e.settings.start, '2026-10');
  assert.equal(e.settings.salaryNetOfPayroll, null);
  assert.equal(e.settings.cobroEsteMes, null);
  assert.equal(e.settings.onboarded, false);
  assert.equal(e.settings.demo, false);
  assert.equal(e.settings.theme, 'auto');
  assert.equal(e.settings.fontSize, 'normal');
  assert.equal(e.settings.privacy, false);
  assert.equal(e.settings.lastBackupAt, null);
  for (const k of ['people', 'incomes', 'expenses', 'installments', 'debts', 'receivables', 'spent', 'plannedPurchases', 'pending']) assert.deepEqual(e[k], []);
  assert.deepEqual(e.seen.hitos, []);
});

// ---------- migración ----------
test('migración v1 -> v2: los datos viejos siguen funcionando (días, montos por mes, planes, personas)', () => {
  const viejo = v1();
  const copia = clon(viejo);
  const s = migrate(viejo, { today: HOY });
  assert.deepEqual(viejo, copia, 'no muta la entrada');
  assert.equal(s.v, 2);
  // ingresos: se conserva todo y se infiere el tipo
  const [sueldo, mov, agui, changas] = s.incomes;
  assert.equal(sueldo.kind, 'sueldo');
  assert.equal(mov.kind, 'movilidad');
  assert.equal(mov.perDay, 10000);
  assert.deepEqual(mov.days, { '2026-10': 20, '2026-11': 18 });
  assert.deepEqual(mov.overrides, { '2026-12': 150000 });
  assert.equal(agui.kind, 'aguinaldo');
  assert.deepEqual(agui.months, [6, 12]);
  assert.equal(changas.kind, 'otro');
  assert.equal(changas.from, '2026-10');
  assert.equal(changas.to, '2027-03');
  // gastos: el de gustos se reconoce y conserva sus montos por mes
  assert.equal(s.expenses[0].kind, 'otro');
  assert.equal(s.expenses[1].kind, 'gustos');
  assert.deepEqual(s.expenses[1].overrides, { '2026-12': 150000 });
  // cuotas, deudas y me deben
  assert.equal(s.installments[0].remaining, 8);
  assert.equal(s.installments[0].first, '2026-10');
  assert.equal(s.debts[0].balance, 1000000);
  assert.equal(s.debts[0].rate, 7);
  assert.equal(s.debts[0].statement, null);
  assert.deepEqual(s.debts[0].payments, []);
  assert.deepEqual(s.debts[0].planned, {});
  assert.equal(s.receivables[0].monthlyPayment, 20000);
  assert.deepEqual(s.receivables[0].payments, []);
  // personas: del texto viejo a people[], sincronizado con el texto legado
  assert.deepEqual(s.people.map((p) => p.name), ['Mamá', 'Hijo 1', 'Pareja']);
  assert.deepEqual(s.people.map((p) => p.role), ['yo', 'hijo', 'pareja']);
  assert.ok(s.people.every((p) => p.id));
  assert.equal(s.settings.people, 'Mamá, Hijo 1, Pareja');
  assert.equal(s.receivables[0].personId, s.people[1].id, 'el me deben se vincula con la persona por nombre');
  // settings nuevos con sus valores por defecto
  assert.equal(s.settings.cash, 50000);
  assert.equal(s.settings.salaryNetOfPayroll, null);
  assert.equal(s.settings.onboarded, false);
  assert.equal(s.settings.demo, false);
  assert.deepEqual(s.spent, []);
  assert.deepEqual(s.plannedPurchases, []);
  assert.deepEqual(s.pending, []);
});

test('migración idempotente: migrar dos veces da lo mismo y un estado v2 no cambia', () => {
  const una = migrate(v1(), { today: HOY });
  // los ids de personas nuevas se generan una sola vez: la segunda pasada los conserva
  const dos = migrate(una, { today: HOY });
  assert.deepEqual(dos, una);
  const d = demo(HOY);
  assert.deepEqual(normalize(d, { today: HOY }), d);
  assert.deepEqual(normalize(normalize(d, { today: HOY }), { today: HOY }), d);
});

test('migración: lo viejo corre igual en el motor (mismo resultado antes y después de migrar)', async () => {
  const { toEngine } = await import('../src/adapter.js');
  const { simulate } = await import('../src/engine.js');
  const viejo = v1();
  viejo.settings.start = '2026-10';
  const sim = (st) => {
    const { flags, pending, omitidos, ...core } = toEngine(st, HOY);
    void flags; void pending; void omitidos;
    return simulate(core);
  };
  const a = sim(viejo);
  const b = sim(migrate(viejo, { today: HOY }));
  // octubre: sueldo 800.000 + movilidad 20 días x 10.000 + cambios 20.000 = 1.020.000
  assert.equal(a.months[0].income, 1020000);
  assert.equal(b.months[0].income, 1020000);
  assert.deepEqual(b.months.map((m) => Math.round(m.free)), a.months.map((m) => Math.round(m.free)));
  assert.equal(b.months[2].income - a.months[2].income, 0); // diciembre: el monto fijo de movilidad (150.000) manda
});

test('migración del modelo anterior de tarjeta (closeDay/dueDay) a fechas completas', () => {
  const st = v1();
  st.debts[0].closeDay = 28;
  st.debts[0].dueDay = 10;
  const d = migrate(st, { today: HOY }).debts[0];
  assert.equal(d.closeDay, undefined);
  assert.equal(d.dueDay, undefined);
  assert.equal(d.statement.closedOn, '2026-09-28');
  assert.equal(d.statement.dueOn, '2026-10-10');
  assert.equal(d.statement.nextCloseOn, '2026-10-28');
  assert.equal(d.statement.nextDueOn, '2026-11-10');
  assert.equal(d.statement.total, 1000000);
  assert.equal(d.statement.min, 100000);
});

test('migración de lastStatement (modelo intermedio): conserva sus fechas', () => {
  const st = v1();
  st.debts[0].lastStatement = { label: 'septiembre', closedOn: '2026-09-01', total: 900000, min: 90000, loadedAt: '2026-09-05' };
  st.debts[0].closeDay = 1;
  st.debts[0].dueDay = 13;
  const d = migrate(st, { today: HOY }).debts[0];
  assert.equal(d.statement.closedOn, '2026-09-01');
  assert.equal(d.statement.dueOn, '2026-09-13');
  assert.equal(d.statement.total, 900000);
  assert.equal(d.statement.label, 'septiembre');
  assert.equal(d.statement.loadedAt, '2026-09-05');
});

test('normalize: arregla basura sin tirar error (montos como texto, listas rotas, enumerados inválidos)', () => {
  const raro = {
    settings: { strategy: 'cualquiera', theme: 'violeta', fontSize: 'enorme', horizon: 'x', cash: '1500', buffer: -3, salaryNetOfPayroll: 'sí', onboardingStep: 99, mesesMode: '7', start: 'ayer' },
    incomes: [{ name: 'Sueldo', amount: '900000', months: [0, 13, 6, 6], from: 'x' }, null, 'texto', 7],
    expenses: 'no es lista',
    installments: [{ name: 'Cuota', amount: '1000', remaining: '3.7', first: 'xx' }],
    debts: [{ name: 'T', balance: '1000', rate: -2, minPayment: 'x', payments: [{ amount: 0 }, { amount: 5, date: 'mal' }], planned: { '2026-10': '300', mal: 5, '2026-11': null } }],
    receivables: [{ person: '', balance: 'x' }],
    spent: [{ amount: 10, cat: 'otra' }, { amount: 0 }],
    people: [{ name: '  Ana ', role: 'rara' }, { name: '' }],
    pending: [{ id: 'afip' }, { id: 'afip' }, { label: 'sin id' }],
    seen: { hitos: ['a', 'a', 3] },
  };
  const s = normalize(raro, { today: HOY });
  assert.equal(s.settings.strategy, 'avalanche');
  assert.equal(s.settings.theme, 'auto');
  assert.equal(s.settings.fontSize, 'normal');
  assert.equal(s.settings.horizon, 12);
  assert.equal(s.settings.cash, 1500);
  assert.equal(s.settings.buffer, 0);
  assert.equal(s.settings.salaryNetOfPayroll, null);
  assert.equal(s.settings.onboardingStep, 7);
  assert.equal(s.settings.mesesMode, '4');
  assert.equal(s.settings.start, '2026-10');
  assert.equal(s.incomes.length, 1);
  assert.equal(s.incomes[0].amount, 900000);
  assert.deepEqual(s.incomes[0].months, [6]);
  assert.equal(s.incomes[0].from, undefined);
  assert.deepEqual(s.expenses, []);
  assert.equal(s.installments[0].remaining, 4);
  assert.equal(s.installments[0].first, '2026-10');
  assert.equal(s.debts[0].rate, 0);
  assert.equal(s.debts[0].minPayment, 0);
  assert.equal(s.debts[0].payments.length, 1);
  assert.equal(s.debts[0].payments[0].date, '2026-10-04');
  assert.deepEqual(s.debts[0].planned, { '2026-10': 300 });
  assert.equal(s.receivables[0].balance, 0);
  assert.equal(s.spent.length, 1);
  assert.equal(s.spent[0].cat, 'gustos');
  assert.deepEqual(s.people.map((p) => p.role), ['otro']);
  assert.equal(s.people[0].name, 'Ana');
  assert.deepEqual(s.pending.map((p) => p.id), ['afip']);
  assert.deepEqual(s.seen.hitos, ['a']);
  assert.deepEqual(normalize(s, { today: HOY }), s, 'y sigue siendo idempotente');
});

test('normalize: entrada que no es un objeto da un estado vacío válido', () => {
  for (const x of [null, undefined, 5, 'x', [], true]) {
    const s = normalize(x, { today: HOY });
    assert.equal(s.v, 2);
    assert.deepEqual(s.incomes, []);
    assert.equal(s.settings.start, '2026-10');
  }
});

test('movilidad: se conservan los datos para expandir por día, sin tocar los demás ingresos', () => {
  const s = normalize({
    incomes: [
      { id: 'm', name: 'Movilidad', kind: 'movilidad', amount: 0, fullMonthAmount: 300000, fullMonthDays: 22, noPayMonths: [1, 1, 13], daysByMonthNumber: { 7: 15, 14: 3 }, movilidadVencida: true },
      { id: 's', name: 'Sueldo', kind: 'sueldo', amount: 900000 },
    ],
  }, { today: HOY });
  const m = s.incomes[0];
  assert.deepEqual(m.noPayMonths, [1]);
  assert.deepEqual(m.daysByMonthNumber, { 7: 15 });
  assert.equal(m.movilidadVencida, true);
  assert.equal(m.fullMonthDays, 22);
  assert.equal(s.incomes[1].kind, 'sueldo'); // lo de movilidad solo se interpreta en ingresos de movilidad
});

// ---------- load / save ----------
test('save y load: ida y vuelta con la clave miscuentas.v1', () => {
  const st = fakeStorage();
  const d = demo(HOY);
  assert.equal(save(d, st), true);
  assert.ok(st._m.has('miscuentas.v1'));
  assert.deepEqual(load(st, { today: HOY }), d);
});

test('load: sin datos, con JSON roto o con storage que falla devuelve un estado vacío (nunca tira)', () => {
  assert.deepEqual(load(fakeStorage(), { today: HOY }), emptyState(HOY));
  assert.deepEqual(load(fakeStorage({ 'miscuentas.v1': '{no es json' }), { today: HOY }), emptyState(HOY));
  assert.deepEqual(load(fakeStorage({ 'miscuentas.v1': 'null' }), { today: HOY }), emptyState(HOY));
  const roto = { getItem() { throw new Error('bloqueado'); } };
  assert.deepEqual(load(roto, { today: HOY }), emptyState(HOY));
  assert.deepEqual(load(null, { today: HOY }), emptyState(HOY));
});

test('load migra datos guardados por la versión 1', () => {
  const st = fakeStorage({ 'miscuentas.v1': JSON.stringify(v1()) });
  const s = load(st, { today: HOY });
  assert.equal(s.v, 2);
  assert.equal(s.incomes[0].kind, 'sueldo');
  assert.equal(s.people.length, 3);
});

test('save: si el storage está lleno o bloqueado devuelve false y no tira', () => {
  const lleno = { setItem() { throw new Error('QuotaExceededError'); } };
  assert.equal(save(demo(HOY), lleno), false);
  assert.equal(save(demo(HOY), null), false);
});

// ---------- exportar / importar ----------
test('exportJSON: nombre con fecha y contenido que importJSON vuelve a leer igual', () => {
  const d = demo(HOY);
  const { nombreArchivo, contenido } = exportJSON(d, HOY);
  assert.equal(nombreArchivo, 'mis-cuentas-2026-10-04.json');
  const obj = JSON.parse(contenido);
  assert.equal(obj.app, 'miscuentas');
  assert.equal(obj.exportedAt, '2026-10-04');
  const r = importJSON(contenido, { today: HOY });
  assert.equal(r.ok, true);
  assert.deepEqual(r.state, d);
  assert.equal(r.descartados, 0);
  assert.match(r.resumen.texto, /4 personas/);
  assert.match(r.resumen.texto, /1 persona que te debe/);
});

test('importJSON: mensajes amables ante archivos que no son una copia', () => {
  for (const malo of ['no es json', '[]', '{}', '"hola"', '123', '{"settings":{}}', '{"settings":{},"incomes":"x"}', '{"settings":[],"incomes":[]}', '']) {
    const r = importJSON(malo, { today: HOY });
    assert.equal(r.ok, false, malo);
    assert.equal(r.mensaje, MENSAJE_ARCHIVO_INVALIDO);
  }
  assert.equal(MENSAJE_ARCHIVO_INVALIDO, 'Ese archivo no parece una copia de Mis Cuentas. Probá con otro.');
  assert.equal(importJSON(null).ok, false);
  assert.equal(importJSON(undefined).ok, false);
  assert.equal(importJSON('x'.repeat(9 * 1024 * 1024)).ok, false);
});

test('importJSON: una copia de una versión más nueva se rechaza con un mensaje claro', () => {
  const r = importJSON(JSON.stringify({ v: 3, settings: {}, incomes: [] }), { today: HOY });
  assert.equal(r.ok, false);
  assert.equal(r.mensaje, MENSAJE_ARCHIVO_NUEVO);
});

test('importJSON: acepta una copia v1 (se migra) y cuenta lo que descarta', () => {
  const viejo = { ...v1(), expenses: [...v1().expenses, 'basura', null] };
  const r = importJSON(JSON.stringify(viejo), { today: HOY });
  assert.equal(r.ok, true);
  assert.equal(r.state.v, 2);
  assert.equal(r.state.expenses.length, 2);
  assert.equal(r.descartados, 2);
});

test('describeState: resume en palabras lo que reemplazaría una copia', () => {
  assert.equal(describeState(emptyState(HOY)).texto, 'sin datos cargados');
  const t = describeState(demo(HOY));
  assert.equal(t.ingresos, 3);
  assert.equal(t.deudas, 1);
  assert.equal(t.meDeben, 1);
});

// ---------- mutadores (sobre un borrador) ----------
test('registrarPagoDeuda: anota el pago, baja el saldo y marca la deuda saldada', () => {
  const d = clon(demo(HOY));
  const id = d.debts[0].id;
  assert.equal(registrarPagoDeuda(d, id, { amount: 0 }), null);
  assert.equal(registrarPagoDeuda(d, 'no existe', { amount: 5 }), null);
  const p = registrarPagoDeuda(d, id, { amount: 300000, date: '2026-10-02' }, HOY);
  assert.equal(p.amount, 300000);
  assert.equal(p.date, '2026-10-02');
  assert.equal(d.debts[0].balance, 1500000);
  assert.equal(d.debts[0].payments.length, 1);
  registrarPagoDeuda(d, id, { amount: 99999999 }, HOY);
  assert.equal(d.debts[0].balance, 0);
  assert.equal(d.debts[0].paidOffOn, '2026-10-04');
});

test('aplicarResumen: carga el resumen nuevo con fechas completas y descuenta lo pagado después del cierre', () => {
  const d = clon(demo(HOY));
  const id = d.debts[0].id;
  registrarPagoDeuda(d, id, { amount: 50000, date: '2026-10-01' }, HOY); // antes del cierre: ya está en el total
  registrarPagoDeuda(d, id, { amount: 20000, date: '2026-10-03' }, HOY); // después del cierre: se descuenta
  d.debts[0].planned = { '2026-09': 1, '2026-10': 400000, '2026-11': 500000 };
  const ok = aplicarResumen(d, id, { closedOn: '2026-10-02', dueOn: '2026-10-14', total: 1700000, min: 255000, rate: 6.5, newCharges: 660000 }, HOY);
  assert.equal(ok, true);
  const t = d.debts[0];
  assert.equal(t.statement.closedOn, '2026-10-02');
  assert.equal(t.statement.dueOn, '2026-10-14');
  assert.equal(t.statement.nextCloseOn, '2026-11-02');
  assert.equal(t.statement.nextDueOn, '2026-11-14');
  assert.equal(t.statement.total, 1700000);
  assert.equal(t.statement.min, 255000);
  assert.equal(t.statement.label, 'septiembre'); // un cierre a principios de mes es de los consumos del mes anterior
  assert.equal(t.statement.loadedAt, '2026-10-04');
  assert.equal(t.statement.newCharges, 660000);
  assert.equal(t.balance, 1680000);
  assert.equal(t.minPayment, 255000);
  assert.equal(t.rate, 6.5);
  assert.deepEqual(t.planned, { '2026-10': 400000, '2026-11': 500000 }, 'se limpian los pagos elegidos de meses pasados');
  assert.equal(aplicarResumen(d, id, { closedOn: 'mal', total: 1 }, HOY), false);
  assert.equal(aplicarResumen(d, 'no existe', { closedOn: '2026-10-02', total: 1 }, HOY), false);
});

test('anotarCobro: baja lo que te deben y, según el destino, paga la tarjeta, guarda o solo anota', () => {
  const base = clon(demo(HOY));
  const rid = base.receivables[0].id;
  const a = clon(base);
  const r1 = anotarCobro(a, rid, { amount: 50000, destino: 'tarjeta' }, HOY);
  assert.deepEqual(r1, { ok: true, saldoNuevo: 350000 });
  assert.equal(a.receivables[0].payments.length, 1);
  assert.equal(a.receivables[0].payments[0].destino, 'tarjeta');
  assert.equal(a.debts[0].balance, 1750000);
  assert.equal(a.debts[0].payments.length, 1);
  const b = clon(base);
  anotarCobro(b, rid, { amount: 30000, destino: 'guardada' }, HOY);
  assert.equal(b.settings.cash, 150000);
  assert.equal(b.debts[0].balance, 1800000);
  const c = clon(base);
  anotarCobro(c, rid, { amount: 30000 }, HOY);
  assert.equal(c.settings.cash, 120000);
  assert.equal(c.receivables[0].balance, 370000);
  assert.deepEqual(anotarCobro(c, rid, { amount: 0 }, HOY), { ok: false });
  assert.deepEqual(anotarCobro(c, 'x', { amount: 5 }, HOY), { ok: false });
  assert.equal(anotarCobro(c, rid, { amount: 99999999 }, HOY).saldoNuevo, 0);
});

test('registrarGasto: categoría casa o gustos (cualquier otra cosa cuenta como gustos)', () => {
  const d = clon(demo(HOY));
  const n = d.spent.length;
  const g = registrarGasto(d, { amount: 5000, cat: 'casa', label: 'Súper' }, HOY);
  assert.equal(g.cat, 'casa');
  assert.equal(g.date, '2026-10-04');
  assert.equal(registrarGasto(d, { amount: 1000, cat: 'rara' }, HOY).cat, 'gustos');
  assert.equal(registrarGasto(d, { amount: 0 }, HOY), null);
  assert.equal(d.spent.length, n + 2);
});

test('compras planificadas: se crean desde ¿Me alcanza?, se marcan hechas y no duplican gastos', () => {
  const d = clon(demo(HOY));
  const id = crearCompraPlanificada(d, { nombre: 'Heladera', monto: 660000, modo: 'cuotas', desde: '2026-12', cuotas: 6 });
  assert.equal(d.plannedPurchases.length, 1);
  assert.equal(d.plannedPurchases[0].hecha, false);
  assert.equal(d.plannedPurchases[0].cuotas, 6);
  const gastosAntes = d.spent.length;
  assert.equal(marcarCompraHecha(d, id, HOY), true);
  assert.equal(d.plannedPurchases[0].hecha, true);
  assert.equal(d.plannedPurchases[0].hechaEl, '2026-10-04');
  assert.equal(d.spent.length, gastosAntes, 'no crea un gasto aparte');
  assert.equal(marcarCompraHecha(d, 'no existe'), false);
  assert.deepEqual(normalize(d, { today: HOY }).plannedPurchases[0].desde, '2026-12');
});

test('elegirPagoTarjeta: solo el mínimo, lo que sobra y otro monto', () => {
  const d = clon(demo(HOY));
  const id = d.debts[0].id;
  assert.equal(elegirPagoTarjeta(d, id, { opcion: 'minimo' }), true);
  assert.equal(d.settings.strategy, 'none');
  assert.equal(elegirPagoTarjeta(d, id, { opcion: 'sobra' }), true);
  assert.equal(d.settings.strategy, 'avalanche');
  assert.equal(elegirPagoTarjeta(d, id, { opcion: 'otro', monto: 310000, mes: '2026-10' }), true);
  assert.deepEqual(d.debts[0].planned, { '2026-10': 310000 });
  assert.equal(elegirPagoTarjeta(d, id, { opcion: 'otro', monto: 0, mes: '2026-11' }), true, 'pagar $0 también se puede elegir');
  assert.equal(d.debts[0].planned['2026-11'], 0);
  assert.equal(elegirPagoTarjeta(d, id, { opcion: 'sobra', mes: '2026-10' }), true);
  assert.equal(d.debts[0].planned['2026-10'], undefined, 'volver a "lo que sobra" borra el pago elegido de ese mes');
  assert.equal(elegirPagoTarjeta(d, id, { opcion: 'otro', monto: -5, mes: '2026-10' }), false);
  assert.equal(elegirPagoTarjeta(d, id, { opcion: 'otro', monto: 5, mes: 'mal' }), false);
  assert.equal(elegirPagoTarjeta(d, 'x', { opcion: 'minimo' }), false);
});

test('aplicarCambios: agrega ítems, edita y pone montos de un mes', () => {
  const d = clon(demo(HOY));
  const gustos = d.expenses.find((e) => e.kind === 'gustos');
  const ni = d.incomes.length;
  aplicarCambios(d, {
    agregar: { expenses: [{ name: 'Reserva para enero', amount: 100, from: '2026-12', to: '2026-12', kind: 'otro' }], incomes: [{ name: 'Reserva guardada', amount: 100, from: '2027-01', to: '2027-01', kind: 'otro' }] },
    editar: [{ lista: 'expenses', id: gustos.id, set: { amount: 80000 } }],
    overrides: [{ lista: 'expenses', id: gustos.id, mes: '2027-01', valor: 0 }],
  });
  assert.equal(d.expenses.length, 3);
  assert.ok(d.expenses[2].id);
  assert.equal(d.incomes.length, ni + 1);
  assert.equal(gustos.amount, 80000);
  assert.deepEqual(gustos.overrides, { '2027-01': 0 });
  assert.doesNotThrow(() => aplicarCambios(d, undefined));
});

test('ajustarGastosCasa, marcarVisto, marcarCopia, agregarPersona y diasDesdeCopia', () => {
  const d = clon(demo(HOY));
  assert.equal(ajustarGastosCasa(d, 660000.4), true);
  const casa = d.expenses.find((e) => e.kind === 'casa');
  assert.equal(casa.amount, 660000);
  assert.equal(casa.estimated, undefined, 'al ajustarlo con datos reales deja de ser estimado');
  assert.equal(ajustarGastosCasa(clon(emptyState(HOY)), 5), false);

  marcarVisto(d, 'hitos', 'cuota:x');
  marcarVisto(d, 'hitos', 'cuota:x');
  assert.deepEqual(d.seen.hitos, ['cuota:x']);

  assert.equal(diasDesdeCopia(d, HOY), null);
  marcarCopia(d, new Date(2026, 8, 24));
  assert.equal(d.settings.lastBackupAt, '2026-09-24');
  assert.equal(diasDesdeCopia(d, HOY), 10);

  const id = agregarPersona(d, { name: ' Tía ', role: 'otro' });
  assert.ok(id);
  assert.equal(agregarPersona(d, { name: 'tía' }), id, 'no duplica por mayúsculas');
  assert.equal(agregarPersona(d, { name: '   ' }), null);
  assert.equal(d.people.at(-1).name, 'Tía');
  assert.equal(d.settings.people, 'Vos, Pareja, Hija, Hijo, Tía');
});

test('aplicarAumento: el sueldo anterior termina el mes previo y el nuevo empieza en el mes elegido', async () => {
  const { toEngine } = await import('../src/adapter.js');
  const { simulate } = await import('../src/engine.js');
  const sim = (st) => {
    const { flags, pending, omitidos, ...core } = toEngine(st, HOY);
    void flags; void pending; void omitidos;
    return simulate(core);
  };
  const antes = clon(demo(HOY));
  const d = clon(antes);
  const id = aplicarAumento(d, 'demo-sueldo', { desde: '2027-03', monto: 1000000 });
  assert.ok(id && id !== 'demo-sueldo');
  const [viejo, nuevo] = d.incomes.filter((i) => i.kind === 'sueldo');
  assert.equal(viejo.to, '2027-02');
  assert.equal(viejo.amount, 900000);
  assert.equal(nuevo.from, '2027-03');
  assert.equal(nuevo.amount, 1000000);
  assert.equal(nuevo.id, id);
  const a = sim(antes).months;
  const b = sim(d).months;
  for (let i = 0; i < 5; i++) assert.equal(Math.round(b[i].income), Math.round(a[i].income), 'antes del aumento no cambia nada');
  assert.equal(Math.round(b[5].income - a[5].income), 100000, 'marzo de 2027: +100.000');
  assert.equal(Math.round(b[2].income), Math.round(a[2].income), 'el aguinaldo de diciembre sigue siendo el de antes');
  assert.equal(Math.round(b[8].income - a[8].income), 150000, 'junio de 2027: +100.000 de sueldo y +50.000 de aguinaldo estimado');
  // se puede volver a aplicar otro aumento más adelante
  const id2 = aplicarAumento(d, id, { desde: '2027-09', monto: 1100000 });
  assert.ok(id2);
  assert.equal(d.incomes.find((i) => i.id === id).to, '2027-08');
  assert.equal(Math.round(sim(d).months[11].income - a[11].income), 200000);
  // el resultado sigue siendo un estado válido
  assert.deepEqual(normalize(d, { today: HOY }), d);
});

test('aplicarAumento: casos borde (monto o mes inválidos, antes del comienzo, montos de un mes, movilidad)', () => {
  const d = clon(demo(HOY));
  assert.equal(aplicarAumento(d, 'x', { desde: '2027-03', monto: 5 }), null);
  assert.equal(aplicarAumento(d, 'demo-sueldo', { desde: 'mal', monto: 5 }), null);
  assert.equal(aplicarAumento(d, 'demo-sueldo', { desde: '2027-03', monto: 0 }), null);
  assert.equal(d.incomes.length, 3);
  // desde antes de que empiece el ingreso: solo cambia el monto
  d.incomes[0].from = '2026-10';
  assert.equal(aplicarAumento(d, 'demo-sueldo', { desde: '2026-06', monto: 950000 }), 'demo-sueldo');
  assert.equal(d.incomes[0].amount, 950000);
  assert.equal(d.incomes.length, 3);
  // los montos puestos a mano de un mes quedan donde corresponde y un ingreso con fin lo conserva en el nuevo
  const e = clon(demo(HOY));
  e.incomes[0].overrides = { '2026-12': 1200000, '2027-04': 1250000 };
  e.incomes[0].to = '2027-12';
  const id = aplicarAumento(e, 'demo-sueldo', { desde: '2027-03', monto: 1000000 });
  const nuevo = e.incomes.find((i) => i.id === id);
  assert.deepEqual(e.incomes[0].overrides, { '2026-12': 1200000 });
  assert.deepEqual(nuevo.overrides, { '2027-04': 1250000 });
  assert.equal(e.incomes[0].to, '2027-02');
  assert.equal(nuevo.to, '2027-12');
  // movilidad: cambia el monto de un mes completo
  const f = clon(demo(HOY));
  const idm = aplicarAumento(f, 'demo-movilidad', { desde: '2027-02', monto: 330000 });
  assert.equal(f.incomes.find((i) => i.id === idm).fullMonthAmount, 330000);
  assert.equal(f.incomes.find((i) => i.id === 'demo-movilidad').fullMonthAmount, 300000);
});

test('guardarProyeccion: guarda una sola vez por mes lo que se esperaba que sobrara', () => {
  const d = clon(demo(HOY));
  assert.equal(guardarProyeccion(d, 84363.6, HOY), true);
  assert.deepEqual(d.seen.proyecciones, { '2026-10': 84364 });
  assert.equal(guardarProyeccion(d, 5, HOY), false, 'no pisa lo ya guardado');
  assert.equal(guardarProyeccion(d, 'x', new Date(2026, 10, 3)), false);
  assert.equal(guardarProyeccion(d, -5000, new Date(2026, 10, 3)), true);
  assert.equal(d.seen.proyecciones['2026-11'], -5000);
  assert.deepEqual(normalize(d, { today: HOY }).seen.proyecciones, { '2026-10': 84364, '2026-11': -5000 });
});
