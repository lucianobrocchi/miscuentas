// Lógica pura de Hoy y Meses (src/ui/screens/_hoy-logic.js). Fixture: demo() con hoy = 4 de octubre de 2026.
// Los valores esperados se generaron corriendo la lógica sobre el ejemplo y se congelaron.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demo } from '../src/demo.js';
import { emptyState } from '../src/store.js';
import * as D from '../src/derive.js';
import * as L from '../src/ui/screens/_hoy-logic.js';

const T = new Date('2026-10-04T12:00:00');
const fresco = () => { D.limpiarMemo(); return demo(T); };

test('encabezado: fecha larga y saludo con el nombre', () => {
  const s = fresco();
  assert.deepEqual(L.encabezado(s, T), { eyebrow: 'Domingo 4 de octubre', title: 'Hola, Ana' });
  s.settings.name = '';
  assert.equal(L.encabezado(s, T).title, 'Hola');
});

test('textoPie: dice dónde están los datos y cuándo fue la última copia', () => {
  const s = fresco();
  assert.equal(L.textoPie(s, T, 'celular'), 'Tus datos están solo en este celular. Todavía no hiciste una copia de seguridad.');
  s.settings.lastBackupAt = '2026-10-01';
  assert.equal(L.textoPie(s, T, 'equipo'), 'Tus datos están solo en este equipo. Última copia: hace 3 días.');
});

test('filasMeses: 12 meses con estado, evento, aguinaldo estimado e ícono', () => {
  const M = L.filasMeses(D, fresco(), T, 12);
  assert.equal(M.hayIngresos, true);
  assert.equal(M.items.length, 12);
  const por = (k) => M.items.find((x) => x.key === k);
  assert.equal(Math.round(por('2026-10').value), 84364);
  assert.equal(por('2026-10').state, 'bien');
  assert.equal(por('2026-10').name, 'Octubre');            // mismo año que hoy: sin año
  assert.equal(por('2027-01').name, 'Enero 2027');         // otro año: con año
  assert.equal(por('2027-01').state, 'falta');
  assert.equal(Math.round(por('2027-01').value), -202000);
  assert.equal(por('2027-01').eventoImporta, 'Feria de enero: este mes no cobrás movilidad');
  assert.equal(por('2027-01').eventIcon, 'calendario');
  assert.equal(por('2026-12').estimated, true);            // lleva aguinaldo estimado: barra punteada
  assert.equal(por('2026-12').eventIcon, 'destello');
  assert.equal(por('2027-03').eventoImporta, 'Último pago de la tarjeta');
  assert.equal(por('2027-04').eventoImporta, 'Primer mes sin tarjeta: +$270.000');
  // el conteo de días de movilidad de un mes con feriados es del detalle, no de la lista de 12 meses
  assert.equal(por('2026-10').eventoImporta, null);
  assert.match(por('2026-10').event, /Movilidad: 21 días/);
  assert.equal(M.mesDificil.key, '2027-01');
});

test('filasMeses: 4 meses para la tira del hero', () => {
  assert.equal(L.filasMeses(D, fresco(), T, 4).items.length, 4);
});

test('filasMeses: sin ingresos no hay meses que mostrar', () => {
  D.limpiarMemo();
  const M = L.filasMeses(D, emptyState(T), T, 12);
  assert.equal(M.hayIngresos, false);
});

test('vecinosDeMes: anterior y siguiente dentro de los 12 meses del plan', () => {
  assert.deepEqual(L.vecinosDeMes('2026-12', '2026-10'), { i: 2, valido: true, anterior: '2026-11', siguiente: '2027-01' });
  assert.deepEqual(L.vecinosDeMes('2026-10', '2026-10'), { i: 0, valido: true, anterior: null, siguiente: '2026-11' });
  assert.deepEqual(L.vecinosDeMes('2027-09', '2026-10'), { i: 11, valido: true, anterior: '2027-08', siguiente: null });
  assert.equal(L.vecinosDeMes('2027-10', '2026-10').valido, false);   // fuera del plan
  assert.equal(L.vecinosDeMes('2026-09', '2026-10').valido, false);   // ya pasó
});

test('claveDeRuta: saca el mes de #/meses/YYYY-MM', () => {
  assert.equal(L.claveDeRuta('#/meses/2026-12'), '2026-12');
  assert.equal(L.claveDeRuta('#/meses'), null);
  assert.equal(L.claveDeRuta('#/meses/2026-13'), null);
  assert.equal(L.claveDeRuta(undefined), null);
});

test('nombreMes y cap', () => {
  assert.equal(L.cap('octubre'), 'Octubre');
  assert.equal(L.cap(''), '');
  assert.equal(L.nombreMes('2026-10', '2026-10', 'octubre'), 'Octubre');
  assert.equal(L.nombreMes('2027-02', '2026-10', 'febrero'), 'Febrero 2027');
});

test('eventoImporta: la movilidad solo importa si cambia de verdad', () => {
  assert.equal(L.eventoImporta({ tipo: 'movilidad', texto: 'Movilidad: 21 días (feriado del 12)' }), false);
  assert.equal(L.eventoImporta({ tipo: 'movilidad', texto: 'Feria de invierno: movilidad de 15 días' }), true);
  assert.equal(L.eventoImporta({ tipo: 'movilidad', texto: 'Feria de enero: este mes no cobrás movilidad', sinCobro: true }), true);
  assert.equal(L.eventoImporta({ tipo: 'aguinaldo', texto: 'Aguinaldo estimado: +$450.000' }), true);
});

test('llevaAguinaldoEstimado: solo si el aguinaldo todavía es una estimación', () => {
  assert.equal(L.llevaAguinaldoEstimado([{ tipo: 'aguinaldo', texto: 'Aguinaldo estimado: +$450.000' }]), true);
  assert.equal(L.llevaAguinaldoEstimado([{ tipo: 'aguinaldo', texto: 'Aguinaldo: +$450.000' }]), false);
  assert.equal(L.llevaAguinaldoEstimado([]), false);
});

test('destinoDeLinea: qué abre cada línea del detalle de un mes', () => {
  const s = fresco();
  const d = D.lineasMes(s, 2, T);
  const por = (lista, id) => (lista.find((l) => l.id === id));
  assert.deepEqual(L.destinoDeLinea(por(d.entra, 'demo-sueldo'), s), { tipo: 'editor', kind: 'income', id: 'demo-sueldo' });
  assert.deepEqual(L.destinoDeLinea(por(d.entra, 'demo-movilidad'), s), { tipo: 'editor', kind: 'movilidad', id: 'demo-movilidad' });
  assert.deepEqual(L.destinoDeLinea(por(d.entra, 'demo-aguinaldo'), s), { tipo: 'editor', kind: 'income', id: 'demo-aguinaldo' });
  assert.deepEqual(L.destinoDeLinea(por(d.sale, 'demo-casa'), s), { tipo: 'editor', kind: 'expense', id: 'demo-casa' });
  assert.deepEqual(L.destinoDeLinea(por(d.sale, 'demo-visa'), s), { tipo: 'nav', hash: '#/deudas/tarjeta' });
  // varios préstamos por planilla: primero se elige cuál
  const planilla = L.destinoDeLinea(por(d.sale, 'planilla'), s);
  assert.equal(planilla.tipo, 'elegir');
  assert.equal(planilla.items.length, 2);
  // un solo préstamo: se abre directo
  const uno = { lista: 'installments', id: 'planilla', items: [{ id: 'p1', nombre: 'Préstamo', monto: 1000 }] };
  assert.deepEqual(L.destinoDeLinea(uno, s), { tipo: 'editor', kind: 'installment', id: 'p1' });
  assert.deepEqual(L.destinoDeLinea({ lista: 'receivables', id: 'cobros' }, s), { tipo: 'nav', hash: '#/deudas/medeben' });
  assert.equal(L.destinoDeLinea(null, s), null);
  assert.equal(L.destinoDeLinea({ lista: 'otra', id: 'x' }, s), null);
});

test('accionDeBoton: qué hace cada botón de "Lo que vence"', () => {
  assert.deepEqual(L.accionDeBoton({ accion: 'yaPague' }, { debtId: 'v' }), { tipo: 'editor', kind: 'cardPayment', id: 'v' });
  assert.deepEqual(L.accionDeBoton({ accion: 'cargarResumen' }, { debtId: 'v' }), { tipo: 'editor', kind: 'statement', id: 'v' });
  assert.deepEqual(L.accionDeBoton({ accion: 'anotarCobro' }, {}), { tipo: 'cobro' });
  assert.deepEqual(L.accionDeBoton({ accion: 'completar' }, { ruta: '#/armar/5' }), { tipo: 'nav', hash: '#/armar/5' });
  assert.equal(L.accionDeBoton(null, {}), null);
  assert.equal(L.accionDeBoton({ accion: 'rara' }, {}), null);
});

test('accionAviso: el aviso del hero abre las formas de cubrir un mes difícil o el detalle del mes', () => {
  assert.deepEqual(L.accionAviso({ tipo: 'falta', key: '2027-01' }), { icon: 'alerta', accion: 'mesDificil', key: '2027-01' });
  assert.deepEqual(L.accionAviso({ tipo: 'mesActualFalta', key: '2026-10' }), { icon: 'alerta', accion: 'mesDificil', key: '2026-10' });
  assert.deepEqual(L.accionAviso({ tipo: 'justo', key: '2027-02' }), { icon: 'info', accion: 'mes', key: '2027-02' });
  assert.deepEqual(L.accionAviso({ tipo: 'bien', key: null }), { icon: 'tilde', accion: null, key: null });
  assert.deepEqual(L.accionAviso(null), { icon: 'tilde', accion: null, key: null });
});

test('quienPaga: una persona se abre directo, varias se eligen, ninguna avisa', () => {
  const s = fresco();
  const uno = L.quienPaga(D, s, T);
  assert.equal(uno.modo, 'uno');
  assert.deepEqual(uno.personas.map((p) => [p.personId, p.receivableId, p.balance]), [['demo-hijo', 'demo-hijo-debe', 400000]]);
  s.receivables.push({ id: 'r2', person: 'Hija', personId: 'demo-hija', name: 'Compra', balance: 150000, rate: 0, monthlyPayment: 0, payments: [], note: '' });
  D.limpiarMemo();
  assert.equal(L.quienPaga(D, s, T).modo, 'varios');
  s.receivables = [];
  D.limpiarMemo();
  assert.deepEqual(L.quienPaga(D, s, T), { modo: 'ninguno', personas: [] });
});

test('pendientesVisibles: los motivos de resumen viejo y de "¿ya cobraste?" tienen su propio lugar', () => {
  const motivos = [
    { code: 'afip', texto: 'Falta el plan de AFIP' }, { code: 'planilla', texto: 'No sabemos si ya están restados' },
    { code: 'resumenViejo', texto: 'viejo' }, { code: 'cobro', texto: 'cobro' },
  ];
  const v = L.pendientesVisibles(motivos);
  assert.deepEqual(v.map((x) => x.code), ['afip', 'planilla']);
  assert.ok(v.every((x) => x.titulo === 'Falta un dato' && x.hash === '#/armar/5'));
  assert.deepEqual(L.pendientesVisibles(motivos, { omitir: ['cobro'] }).map((x) => x.code), ['afip', 'planilla', 'resumenViejo']);
  assert.equal(L.pendientesVisibles(motivos, { omitir: [] }).find((x) => x.code === 'cobro').hash, '#/mas');
  assert.deepEqual(L.pendientesVisibles(undefined), []);
});

test('vistaHoy: los cuatro estados de Hoy', () => {
  D.limpiarMemo();
  assert.equal(L.vistaHoy(D, emptyState(T), T).estado, 'sinDatos');

  const solo = emptyState(T);
  solo.incomes = [{ id: 'i1', name: 'Sueldo', owner: 'Vos', amount: 900000, kind: 'sueldo' }];
  assert.equal(L.vistaHoy(D, solo, T).estado, 'parcial');

  const sinIng = emptyState(T);
  sinIng.expenses = [{ id: 'e1', name: 'Casa', owner: 'Vos', amount: 500000, kind: 'casa' }];
  assert.equal(L.vistaHoy(D, sinIng, T).estado, 'sinIngresos');

  const v = L.vistaHoy(D, fresco(), T);
  assert.equal(v.estado, 'ok');
  assert.equal(v.hero.rotulo, 'Va a la tarjeta este mes');
  assert.equal(v.plata.monto, 120000);
  assert.equal(v.gastar.estado, 'ok');
  assert.equal(v.salida.estado, 'fecha');
  assert.equal(v.vence.filas[0].tipo, 'tarjeta');
  assert.deepEqual(v.pendientes.map((p) => p.code), ['afip']);
  assert.equal(v.siguientes.length > 0 && v.siguientes.length <= 3, true);
});

test('vistaHoy: el cierre de mes aparece los primeros días del mes', () => {
  const v = L.vistaHoy(D, fresco(), T);
  assert.equal(v.cierre.aplica, true);
  assert.equal(v.cierre.pregunta, '¿Cómo te fue en septiembre?');
});

test('sw.js precachea los módulos de apoyo de Hoy y Meses (sin ellos, sin internet esas pantallas no abren)', async () => {
  const { readFileSync } = await import('node:fs');
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  for (const pantalla of ['hoy', 'meses']) {
    const fuente = readFileSync(new URL(`../src/ui/screens/${pantalla}.js`, import.meta.url), 'utf8');
    for (const m of fuente.matchAll(/from '\.\/(_[\w-]+\.js)'/g)) {
      assert.ok(sw.includes(`src/ui/screens/${m[1]}`), `sw.js no precachea src/ui/screens/${m[1]}, que importa ${pantalla}.js`);
    }
  }
});
