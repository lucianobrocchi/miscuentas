// Lógica pura de los editores, el armado y Más (src/ui/_ed-logic.js, _backup.js, _install.js). Fixture: demo() con hoy = 4 de octubre de 2026.
// Los valores esperados se generaron corriendo la lógica sobre el ejemplo (cifras ilustrativas) y se congelaron.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demo } from '../src/demo.js';
import { emptyState, normalize, exportJSON } from '../src/store.js';
import * as D from '../src/derive.js';
import * as L from '../src/ui/_ed-logic.js';
import { leerCopia } from '../src/ui/_backup.js';
import { detectarEntorno } from '../src/ui/_install.js';

const T = new Date('2026-10-04T12:00:00');
const copia = (o) => JSON.parse(JSON.stringify(o));
const fresco = () => { D.limpiarMemo(); return demo(T); };
const vacio = () => { D.limpiarMemo(); return emptyState(T); };

// ------------------------------------------------------------------ familia
test('guardarFamilia: el nombre, vos primero y las demás personas con su rol (sin repetidos, hasta lo que pongas)', () => {
  const d = vacio();
  L.guardarFamilia(d, { name: 'Ana', otros: [{ name: 'Pareja', role: 'pareja' }, { name: 'Hijo', role: 'hijo' }, { name: 'pareja', role: 'otro' }, { name: 'Ana', role: 'otro' }] });
  assert.equal(d.settings.name, 'Ana');
  assert.deepEqual(d.people.map((p) => [p.name, p.role]), [['Ana', 'yo'], ['Pareja', 'pareja'], ['Hijo', 'hijo']]);
  assert.equal(d.settings.people, 'Ana, Pareja, Hijo');
  assert.equal(d.settings.pasos.familia, true);
  // volver a guardar saca a quien ya no está y conserva el id de quien sigue
  const idPareja = d.people[1].id;
  L.guardarFamilia(d, { name: 'Ana', otros: [{ name: 'Pareja', role: 'pareja' }] });
  assert.deepEqual(d.people.map((p) => p.name), ['Ana', 'Pareja']);
  assert.equal(d.people[1].id, idPareja);
});

test('renombrarPersona: cambia el nombre en todo lo que figura a su nombre', () => {
  const d = fresco();
  const id = d.people.find((p) => p.name === 'Hijo').id;
  L.renombrarPersona(d, id, 'Tomás');
  assert.equal(d.receivables[0].person, 'Tomás');
  assert.equal(d.settings.people.includes('Tomás'), true);
  assert.equal(L.nombreDe(d, id), 'Tomás');
  assert.equal(L.idDe(d, 'tomás'), id);
});

// ------------------------------------------------------------------ sueldo y aguinaldo
test('guardarSueldo: crea el sueldo y el aguinaldo estimado (la mitad); apagarlo lo saca; no pisa uno exacto', () => {
  const d = vacio();
  assert.equal(L.guardarSueldo(d, { amount: 0 }), null);
  const id = L.guardarSueldo(d, { amount: 900000, aguinaldo: true });
  assert.equal(d.incomes.find((x) => x.id === id).amount, 900000);
  const ag = d.incomes.find((x) => x.kind === 'aguinaldo');
  assert.deepEqual([ag.amount, ag.estimated, ag.months], [450000, true, [6, 12]]);
  L.guardarSueldo(d, { id, amount: 1000000, aguinaldo: true });
  assert.equal(d.incomes.filter((x) => x.kind === 'aguinaldo').length, 1);
  assert.equal(d.incomes.find((x) => x.kind === 'aguinaldo').amount, 500000);
  L.guardarSueldo(d, { id, amount: 1000000, aguinaldo: false });
  assert.equal(d.incomes.some((x) => x.kind === 'aguinaldo'), false);
});

test('guardarIngreso: aguinaldo con monto exacto deja de ser estimado y el motor lo respeta', () => {
  const d = fresco();
  const ag = d.incomes.find((x) => x.kind === 'aguinaldo');
  L.guardarIngreso(d, ag.id, { name: 'Aguinaldo', amount: 600000, owner: 'Vos', months: [6, 12] });
  const e = D.run(d, { today: T }).months.find((m) => m.key === '2026-12');
  const sin = D.run(fresco(), { today: T }).months.find((m) => m.key === '2026-12');
  assert.equal(d.incomes.find((x) => x.id === ag.id).estimated, undefined);
  assert.equal(Math.round(e.income - sin.income), 150000); // 600.000 en vez de la mitad del sueldo (450.000)
});

// ------------------------------------------------------------------ movilidad
test('guardarMovilidad: guarda monto, días y meses sin cobro; "no cobro" la saca y recuerda la respuesta', () => {
  const d = vacio();
  assert.equal(L.guardarMovilidad(d, { cobra: true, fullMonthAmount: 0, fullMonthDays: 22 }), null);
  const id = L.guardarMovilidad(d, { cobra: true, fullMonthAmount: 300000, fullMonthDays: 22, noPayMonths: [1], daysByMonthNumber: { 7: 15 }, movilidadVencida: false });
  const m = d.incomes.find((x) => x.id === id);
  assert.deepEqual([m.kind, m.fullMonthAmount, m.fullMonthDays, m.noPayMonths, m.daysByMonthNumber, m.movilidadVencida], ['movilidad', 300000, 22, [1], { 7: 15 }, undefined]);
  L.guardarMovilidad(d, { cobra: false });
  assert.equal(d.incomes.some((x) => x.kind === 'movilidad'), false);
  assert.equal(d.settings.pasos.movilidad, true);
});

test('calendarioMovilidad: 12 meses desde hoy con días, feriados y meses sin cobro (octubre 2026 = 21 días, feriado del 12)', () => {
  const item = L.itemMovilidad({ fullMonthAmount: 300000, fullMonthDays: 22, noPayMonths: [1], daysByMonthNumber: { 7: 15 } });
  const cal = L.calendarioMovilidad(item, T);
  assert.equal(cal.length, 12);
  assert.deepEqual(cal.map((f) => f.key).slice(0, 4), ['2026-10', '2026-11', '2026-12', '2027-01']);
  const oct = cal[0];
  assert.deepEqual([oct.dias, oct.monto, oct.activo, oct.feriados.map((f) => f.texto), oct.estimado], [21, Math.round(300000 / 22 * 21), true, ['12/10'], false]);
  assert.equal(cal[1].dias, 20);                 // noviembre
  assert.equal(cal[1].estimado, true);           // el traslado del 23/11 es estimado
  assert.deepEqual([cal[3].mes, cal[3].dias, cal[3].activo], ['Ene', 0, false]);   // enero: sin cobro
  const jul = cal.find((f) => f.key === '2027-07');
  assert.equal(jul.dias, 15);                    // feria de invierno
  assert.equal(L.calendarioMovilidad({ fullMonthAmount: 0, fullMonthDays: 22 }, T), null);
});

test('calendarioMovilidad: si se cobra el mes siguiente, el calendario se corre un mes', () => {
  const item = L.itemMovilidad({ fullMonthAmount: 300000, fullMonthDays: 22, noPayMonths: [1], movilidadVencida: true });
  const cal = L.calendarioMovilidad(item, T);
  assert.equal(cal.find((f) => f.key === '2027-01').dias > 0, true);   // enero cobra lo trabajado en diciembre
  assert.deepEqual([cal.find((f) => f.key === '2027-02').activo, cal.find((f) => f.key === '2027-02').dias], [false, 0]); // febrero: lo de enero no se trabaja
  assert.equal(cal[0].feriados.length, 0);     // lo que se cobra en octubre se trabajó en septiembre (sin feriados)
});

test('conDiasDelMes: una corrección puntual o para todos los años (0 días = sin cobro) y se puede deshacer', () => {
  const base = L.itemMovilidad({ fullMonthAmount: 300000, fullMonthDays: 22 });
  const puntual = L.conDiasDelMes(base, '2026-11', 18);
  assert.deepEqual(puntual.days, { '2026-11': 18 });
  assert.equal(L.calendarioMovilidad(puntual, T)[1].dias, 18);
  assert.equal(L.calendarioMovilidad(puntual, T)[1].corregido, true);
  const anual = L.conDiasDelMes(base, '2027-07', 15, { todosLosAnios: true });
  assert.deepEqual(anual.daysByMonthNumber, { 7: 15 });
  const sin = L.conDiasDelMes(base, '2027-01', 0, { todosLosAnios: true });
  assert.deepEqual(sin.noPayMonths, [1]);
  assert.deepEqual(L.sinCorreccionDelMes(sin, '2027-01').noPayMonths, []);
  assert.deepEqual(L.sinCorreccionDelMes(puntual, '2026-11').days, {});
  assert.equal(L.valorPorDia(300000, 22), 300000 / 22);
});

test('feriadosDelMes: solo los que caen de lunes a viernes; los de 2027 son estimados', () => {
  assert.deepEqual(L.feriadosDelMes('2026-10'), [{ dia: 12, texto: '12/10' }]);
  assert.equal(L.feriadoEstimado('2027-05'), true);
  assert.equal(L.feriadoEstimado('2026-10'), false);
  assert.equal(L.feriadoEstimado('2026-11'), true);
});

// ------------------------------------------------------------------ cuotas y planilla
test('estadoCuota y fraseCuotas: "cuota actual X de N" y cuándo termina (la X ya se descontó)', () => {
  const frase = (a, n, desc) => L.fraseCuotas({ actual: a, total: n, descontadaEsteMes: desc }, T);
  assert.equal(frase(26, 36, false), 'Faltan 10 cuotas. La última es en julio de 2027.');
  assert.equal(frase(26, 36, true), 'Faltan 10 cuotas. La última es en agosto de 2027.');
  assert.equal(frase(35, 36, false), 'Falta 1 cuota. La última es en octubre de 2026.');
  assert.deepEqual([L.cuotasQueFaltanTexto(1), L.cuotasQueFaltanTexto(10), L.cuotasQueFaltanTexto(2, true)], ['falta 1 cuota', 'faltan 10 cuotas', 'Faltan 2 cuotas']);
  assert.equal(frase('', 36, false), null);
  assert.equal(frase(40, 36, false), null);
  const e = L.estadoCuota({ remaining: 10, first: '2026-10', total: 36 }, T);
  assert.deepEqual([e.actual, e.total, e.descontadaEsteMes, e.lejana], [26, 36, false, false]);
  assert.equal(L.estadoCuota({ remaining: 10, first: '2026-11', total: 36 }, T).descontadaEsteMes, true);
  assert.equal(L.estadoCuota({ remaining: 6, first: '2027-02' }, T).lejana, true);
});

test('errorCuotas: mensajes en lenguaje de casa', () => {
  assert.match(L.errorCuotas({ actual: 3, total: '' }).texto, /de cuántas cuotas/);
  assert.match(L.errorCuotas({ actual: '', total: 12 }).texto, /en qué cuota vas/);
  assert.match(L.errorCuotas({ actual: 13, total: 12 }).texto, /no puede ser más/);
  assert.match(L.errorCuotas({ actual: 12, total: 12 }).texto, /ya la terminaste/);
  assert.equal(L.errorCuotas({ actual: 0, total: 12 }), null);
});

test('guardarCuota: calcula las que faltan y desde cuándo; editar conserva el id; AFIP saca el pendiente', () => {
  const d = vacio();
  const id = L.guardarCuota(d, null, { name: 'Préstamo', amount: 80000, actual: 26, total: 36, descontadaEsteMes: false, payroll: true }, T);
  const c = d.installments.find((x) => x.id === id);
  assert.deepEqual([c.remaining, c.first, c.total, c.payroll, c.amount], [10, '2026-10', 36, true, 80000]);
  L.guardarCuota(d, id, { name: 'Préstamo', amount: 80000, actual: 26, total: 36, descontadaEsteMes: true, payroll: true }, T);
  assert.equal(d.installments.length, 1);
  assert.deepEqual([d.installments[0].remaining, d.installments[0].first], [10, '2026-11']);
  // mantener (cuota que empieza más adelante, sin tocar el conteo)
  L.guardarCuota(d, id, { name: 'Préstamo', amount: 90000, mantener: { remaining: 6, first: '2027-02' }, payroll: true }, T);
  assert.deepEqual([d.installments[0].remaining, d.installments[0].first, d.installments[0].amount], [6, '2027-02', 90000]);
  // no se guarda lo que ya terminó
  assert.equal(L.guardarCuota(d, null, { name: 'x', amount: 1000, actual: 12, total: 12 }, T), null);
  // AFIP
  L.afipPendiente(d);
  L.afipPendiente(d);
  assert.equal(d.pending.filter((p) => p.target === 'afip').length, 1);
  L.guardarCuota(d, null, { name: 'Plan de pagos de AFIP', amount: 20000, actual: 2, total: 12, descontadaEsteMes: true, payroll: true, afip: true }, T);
  assert.equal(d.pending.some((p) => p.target === 'afip'), false);
});

test('afip pendiente + préstamo por planilla: la cuenta sale provisoria hasta contestar si el sueldo ya viene sin descuentos', () => {
  const d = vacio();
  L.guardarSueldo(d, { amount: 900000 });
  L.guardarGastosBase(d, { casa: 600000, gustos: 100000 });
  L.guardarCuota(d, null, { name: 'Préstamo', amount: 80000, actual: 26, total: 36, descontadaEsteMes: false, payroll: true }, T);
  L.afipPendiente(d);
  assert.equal(D.hero(d, T).provisorio, true);
  L.guardarNeto(d, false);
  assert.equal(d.settings.salaryNetOfPayroll, false);
  assert.equal(d.settings.pasos.planilla, true);
  L.guardarNeto(d, null);
  assert.equal(d.settings.salaryNetOfPayroll, null);
  assert.deepEqual(L.descuentosDelRecibo(d).map((x) => x.amount), [80000]);
});

// ------------------------------------------------------------------ gastos y plata de hoy
test('guardarGastosBase: casa estimada y gustos no; vacío no crea nada; el gasto inicial se reemplaza (no se duplica)', () => {
  const d = vacio();
  L.guardarGastosBase(d, { casa: 640000, gustos: 100000 });
  assert.deepEqual(d.expenses.map((e) => [e.kind, e.amount, e.estimated]), [['casa', 640000, true], ['gustos', 100000, undefined]]);
  L.guardarGastosBase(d, { casa: 700000, gustos: null });
  assert.equal(d.expenses.length, 2);
  assert.equal(d.expenses.find((e) => e.kind === 'casa').amount, 700000);
  L.guardarGastoInicial(d, 12000, T);
  L.guardarGastoInicial(d, 15000, T);
  assert.equal(d.spent.length, 1);
  assert.equal(L.gastoInicial(d).amount, 15000);
  assert.equal(D.paraGastarHoy(d, T).gastado, 15000);
  L.guardarGastoInicial(d, 0, T);
  assert.equal(d.spent.length, 0);
});

test('guardarGasto e ingreso: validan monto y nombre', () => {
  const d = fresco();
  assert.equal(L.guardarGasto(d, null, { name: '', amount: 1000 }), null);
  assert.equal(L.guardarGasto(d, null, { name: 'Seguro', amount: 0 }), null);
  const id = L.guardarGasto(d, null, { name: 'Seguro', amount: 25000, estimated: true, kind: 'otro' });
  assert.equal(d.expenses.find((e) => e.id === id).estimated, true);
  L.guardarGasto(d, id, { name: 'Seguro del auto', amount: 27000, estimated: false });
  assert.deepEqual([d.expenses.find((e) => e.id === id).name, d.expenses.find((e) => e.id === id).amount, d.expenses.find((e) => e.id === id).estimated], ['Seguro del auto', 27000, undefined]);
  assert.equal(L.guardarIngreso(d, null, { name: 'Alquiler', amount: 0 }), null);
});

test('guardarPlataDeHoy: plata en la cuenta y si ya cobró este mes (sin default silencioso)', () => {
  const d = vacio();
  L.guardarPlataDeHoy(d, { cash: 120000, cobroEsteMes: true });
  assert.deepEqual([d.settings.cash, d.settings.cobroEsteMes], [120000, true]);
  L.guardarPlataDeHoy(d, { cash: -5, cobroEsteMes: null });
  assert.deepEqual([d.settings.cash, d.settings.cobroEsteMes], [0, null]);
});

// ------------------------------------------------------------------ tarjeta, deudas y me deben
test('guardarResumen: crea la tarjeta con las fechas reales del resumen y convierte el interés anual', () => {
  const d = vacio();
  const res = D.validarResumen({ total: '1.800.000', min: '270.000', rate: '79', closedOn: '2026-09-28', dueOn: '2026-10-10' }, { today: T });
  assert.equal(res.ok, true);
  assert.equal(res.confirmar, true);                 // "79% parece la tasa anual": se confirma
  const id = L.guardarResumen(d, null, res.valores, { name: 'Visa' }, T);
  const t = d.debts.find((x) => x.id === id);
  assert.deepEqual([t.name, t.kind, t.balance, t.minPayment, t.statement.closedOn, t.statement.dueOn], ['Visa', 'card', 1800000, 270000, '2026-09-28', '2026-10-10']);
  assert.equal(t.rate < 15, true);
  assert.equal(d.settings.pasos.tarjeta, true);
  // un resumen nuevo se carga sobre la misma tarjeta
  L.guardarResumen(d, id, { ...res.valores, total: 1700000, closedOn: '2026-10-01', dueOn: '2026-10-13' }, {}, T);
  assert.equal(d.debts.length, 1);
  assert.equal(d.debts[0].statement.dueOn, '2026-10-13');
  assert.equal(L.guardarResumen(d, null, res.valores, { name: '' }, T) !== id, true);   // sin id: otra tarjeta (se llama "Tarjeta")
  assert.equal(d.debts[1].name, 'Tarjeta');
});

test('guardarDeuda y editarTarjeta', () => {
  const d = fresco();
  assert.equal(L.guardarDeuda(d, null, { name: '', balance: 1000 }), null);
  const id = L.guardarDeuda(d, null, { name: 'Préstamo del banco', balance: 500000, minPayment: 40000, rate: 3 });
  assert.deepEqual([d.debts.find((x) => x.id === id).kind, d.debts.find((x) => x.id === id).minPayment], ['other', 40000]);
  L.editarTarjeta(d, 'demo-visa', { name: 'Visa', balance: 1700000, minPayment: 250000, rate: 6.5 });
  assert.deepEqual([d.debts[0].name, d.debts[0].balance, d.debts[0].minPayment, d.debts[0].rate], ['Visa', 1700000, 250000, 6.5]);
  assert.equal(L.tasaDeLaTarjeta(d), 6.5);
});

test('guardarMeDeben: suma a la persona a la familia si no existe; el interés usa el de la tarjeta; editar conserva el id', () => {
  const d = fresco();
  const r = L.guardarMeDeben(d, null, { person: 'Prima', balance: 100000, monthlyPayment: 20000, cobraInteres: true, role: 'otro' });
  assert.equal(d.people.some((p) => p.name === 'Prima'), true);
  const it = d.receivables.find((x) => x.id === r.id);
  assert.deepEqual([it.balance, it.monthlyPayment, it.rate, it.personId === r.personId], [100000, 20000, 6.49, true]);
  const r2 = L.guardarMeDeben(d, r.id, { person: 'Prima', personId: r.personId, balance: 80000, monthlyPayment: 0, cobraInteres: false });
  assert.equal(r2.id, r.id);
  assert.deepEqual([d.receivables.find((x) => x.id === r.id).rate, d.receivables.length], [0, 2]);
  assert.equal(L.guardarMeDeben(d, null, { person: 'Alguien', balance: 0 }), null);
  // una persona que ya está se reutiliza
  const r3 = L.guardarMeDeben(d, null, { person: 'hijo', balance: 5000 });
  assert.equal(r3.personId, 'demo-hijo');
});

// ------------------------------------------------------------------ borrar con consecuencias
test('consecuenciasDeBorrar: dice qué cambia, en palabras de casa y con el monto', () => {
  const s = fresco();
  const c = L.consecuenciasDeBorrar(s, 'installment', 'demo-prestamo-a');
  assert.equal(c.titulo, '¿Borrar el préstamo de $80.000?');
  assert.match(c.mensaje, /tu plata libre sube \$80\.000 por mes/);
  assert.match(L.consecuenciasDeBorrar(s, 'expense', 'demo-casa').mensaje, /sube \$640\.000 por mes/);
  assert.match(L.consecuenciasDeBorrar(s, 'income', 'demo-sueldo').mensaje, /baja \$900\.000 por mes/);
  assert.match(L.consecuenciasDeBorrar(s, 'movilidad', 'demo-movilidad').titulo, /movilidad/);
  assert.match(L.consecuenciasDeBorrar(s, 'receivable', 'demo-hijo-debe').mensaje, /\$400\.000/);
  assert.match(L.consecuenciasDeBorrar(s, 'debt', 'demo-visa').mensaje, /No se cancela nada en el banco/);
  assert.equal(L.consecuenciasDeBorrar(s, 'installment', 'no-existe'), null);
  // con el sueldo ya sin descuentos, borrar un préstamo por planilla no cambia lo que sobra
  s.settings.salaryNetOfPayroll = true;
  assert.match(L.consecuenciasDeBorrar(s, 'installment', 'demo-prestamo-a').mensaje, /no cambia/);
  // ningún texto trae palabras prohibidas
  const todos = ['income', 'movilidad', 'expense', 'installment', 'debt', 'receivable', 'person'].map((k) => L.consecuenciasDeBorrar(s, k, { income: 'demo-sueldo', movilidad: 'demo-movilidad', expense: 'demo-casa', installment: 'demo-prestamo-a', debt: 'demo-visa', receivable: 'demo-hijo-debe', person: 'demo-hijo' }[k]));
  for (const c2 of todos) assert.doesNotMatch(JSON.stringify(c2), /colch[oó]n|pl[aá]stico|financiaci[oó]n|moroso|liber[aá]s|5 minutos/i);
});

test('borrar: saca el ítem; una persona se saca también de los reparto de la tarjeta; el plan de AFIP limpia el pendiente', () => {
  const d = fresco();
  assert.equal(L.borrar(d, 'installment', 'demo-prestamo-a'), true);
  assert.equal(d.installments.length, 1);
  assert.equal(L.borrar(d, 'installment', 'demo-prestamo-a'), false);
  assert.equal(L.borrar(d, 'person', 'demo-hijo'), true);
  assert.equal(d.people.some((p) => p.id === 'demo-hijo'), false);
  assert.equal(d.debts[0].holders.some((h) => h.personId === 'demo-hijo'), false);
  assert.equal(d.settings.people.includes('Hijo'), false);
  assert.equal(L.borrar(d, 'plannedPurchase', 'x'), false);
  assert.equal(L.borrarCompra(d, 'x'), false);
});

test('textoGastoAnotado y estadoVacioConservando', () => {
  assert.equal(L.textoGastoAnotado(8000, 'gustos'), 'Anotado. $8.000 de tus gustos.');
  assert.equal(L.textoGastoAnotado(8000, 'casa'), 'Anotado. $8.000 de la casa.');
  const s = fresco();
  s.settings.theme = 'dark'; s.settings.fontSize = 'grande'; s.settings.privacy = true;
  const e = L.estadoVacioConservando(s, T);
  assert.deepEqual([e.settings.theme, e.settings.fontSize, e.settings.privacy, e.incomes.length, e.settings.demo], ['dark', 'grande', true, 0, false]);
  assert.equal(L.tieneDatos(s), true);
  assert.equal(L.tieneDatosPropios(s), false);   // el ejemplo no cuenta como datos propios
  assert.equal(L.tieneDatosPropios({ ...s, settings: { ...s.settings, demo: false } }), true);
  assert.equal(L.tieneDatos(e), false);
});

// ------------------------------------------------------------------ copia de seguridad (restauración guiada)
const fakeCtx = () => ({ today: () => T });
const archivo = (texto, nombre = 'mis-cuentas-2026-10-04.json') => new File([texto], nombre, { type: 'application/json' });

test('leerCopia: una copia válida dice qué tiene y de cuándo es; un archivo que no es una copia da el mensaje amable', async () => {
  const s = { ...fresco(), settings: { ...demo(T).settings, demo: false } };
  const { contenido } = exportJSON(s, T);
  const r = await leerCopia(fakeCtx(), archivo(contenido));
  assert.equal(r.ok, true);
  assert.equal(r.fecha, '2026-10-04');
  assert.match(r.resumen.texto, /4 personas/);
  assert.equal(r.state.incomes.length, 3);
  assert.deepEqual(normalize(r.state, { today: T }), r.state);   // ya viene normalizada
  const mal = await leerCopia(fakeCtx(), archivo('{"hola": 1}'));
  assert.deepEqual(mal, { ok: false, mensaje: 'Ese archivo no parece una copia de Mis Cuentas. Probá con otro.' });
  const roto = await leerCopia(fakeCtx(), archivo('esto no es json'));
  assert.equal(roto.ok, false);
  const nueva = await leerCopia(fakeCtx(), archivo(JSON.stringify({ ...JSON.parse(contenido), v: 99 })));
  assert.equal(nueva.ok, false);
  assert.match(nueva.mensaje, /versión más nueva/);
});

test('leerCopia: acepta copias del modelo anterior (se migran)', async () => {
  const vieja = { settings: { start: '2026-01', horizon: 12, strategy: 'avalanche', buffer: 0, cash: 50000, people: 'Vos, Pareja' }, incomes: [{ id: 'a', name: 'Sueldo', owner: 'Vos', amount: 900000 }], expenses: [], installments: [], debts: [], receivables: [] };
  const r = await leerCopia(fakeCtx(), archivo(JSON.stringify(vieja)));
  assert.equal(r.ok, true);
  assert.equal(r.state.v, 2);
  assert.deepEqual(r.state.people.map((p) => p.name), ['Vos', 'Pareja']);
});

// ------------------------------------------------------------------ instalar la app
test('detectarEntorno: iPhone, navegador de WhatsApp, Android, app instalada y computadora', () => {
  const ua = {
    iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    wa: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WhatsApp/24.1',
    android: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    androidWv: 'Mozilla/5.0 (Linux; Android 13; Pixel 7; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36',
    desk: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  };
  const win = (standalone, fino) => ({ matchMedia: (q) => ({ matches: /standalone/.test(q) ? standalone : /hover: hover/.test(q) ? fino : false }) });
  const e = (u, w = win(false, false), nav = {}) => detectarEntorno({ userAgent: u, platform: 'x', maxTouchPoints: 5, ...nav }, w);
  assert.deepEqual([e(ua.iphone).ios, e(ua.iphone).enApp, e(ua.iphone).instalada], [true, false, false]);
  assert.deepEqual([e(ua.wa).ios, e(ua.wa).enApp], [true, true]);
  assert.deepEqual([e(ua.android).android, e(ua.android).enApp], [true, false]);
  assert.equal(e(ua.androidWv).enApp, true);
  assert.equal(e(ua.iphone, win(true, false)).instalada, true);
  assert.equal(e(ua.iphone, win(false, false), { standalone: true }).instalada, true);
  assert.deepEqual([e(ua.desk, win(false, true)).escritorio, e(ua.iphone, win(false, true)).escritorio], [true, false]);
});
