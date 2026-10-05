import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MINUS, money, num, compact, ariaMoney, pct, parseMoney, parseRate, revisarMonto,
  toDate, toISO, monthKeyOf, addDays, addMonthsDate, daysBetween, lastDayOfMonth,
  monthName, longDate, haceTiempo, plural, lista,
} from '../src/format.js';

// ---------- dinero ----------
test('money: pesos sin centavos, puntos de miles y signo menos real (U+2212)', () => {
  assert.equal(money(-342688), '−$342.688');
  assert.equal(money(-342688)[0], '−');
  assert.equal(MINUS, '−');
  assert.equal(money(0), '$0');
  assert.equal(money(950), '$950');
  assert.equal(money(1000), '$1.000');
  assert.equal(money(1234567), '$1.234.567');
  assert.equal(money(84363.636), '$84.364');
  assert.equal(money(-0.2), '$0'); // no existe "−$0"
  assert.equal(money(NaN), '$0');
  assert.equal(money(undefined), '$0');
  assert.equal(money('12000'), '$12.000');
});

test('num: solo el número con puntos de miles', () => {
  assert.equal(num(1290000), '1.290.000');
  assert.equal(num(-5000), '−5.000');
  assert.equal(num('x'), '0');
});

test('compact: "106 mil", "1,3 M", "−343 mil"', () => {
  assert.equal(compact(105948), '106 mil');
  assert.equal(compact(-342688), '−343 mil');
  assert.equal(compact(1300000), '1,3 M');
  assert.equal(compact(1156791), '1,2 M');
  assert.equal(compact(999), '999');
  assert.equal(compact(0), '0');
  assert.equal(compact(-0.2), '0');
  assert.equal(compact(999600), '1 M');
  assert.equal(compact(2000000), '2 M');
  assert.equal(compact(NaN), '0');
});

test('ariaMoney: dice los pesos completos para lectores de pantalla', () => {
  assert.equal(ariaMoney(105948), '105948 pesos');
  assert.equal(ariaMoney(-342688), 'menos 342688 pesos');
  assert.equal(ariaMoney(1), '1 peso');
  assert.equal(ariaMoney(NaN), '0 pesos');
});

test('pct: porcentaje con coma y sin ceros de más', () => {
  assert.equal(pct(6.49), '6,49%');
  assert.equal(pct(79), '79%');
  assert.equal(pct(6.5), '6,5%');
  assert.equal(pct(NaN), '0%');
});

// ---------- parseMoney ----------
test('parseMoney tolera coma, punto, miles, signo $ y espacios', () => {
  assert.equal(parseMoney('1.234.567'), 1234567);
  assert.equal(parseMoney('$ 1.234.567'), 1234567);
  assert.equal(parseMoney('1234567'), 1234567);
  assert.equal(parseMoney('1.290'), 1290); // un punto con 3 dígitos detrás = miles
  assert.equal(parseMoney('12.345'), 12345);
  assert.equal(parseMoney('1,234,567'), 1234567);
  assert.equal(parseMoney('1.234.567,50'), 1234568); // el último separador es el decimal
  assert.equal(parseMoney('1.234.567,50', { decimales: true }), 1234567.5);
  assert.equal(parseMoney('1500.50'), 1501);
  assert.equal(parseMoney('1500,5', { decimales: true }), 1500.5);
  assert.equal(parseMoney('  950000  '), 950000);
  assert.equal(parseMoney('0'), 0);
});

test('parseMoney: negativos, "mil" y entradas ilegibles', () => {
  assert.equal(parseMoney('−5.000'), -5000);
  assert.equal(parseMoney('-5.000'), -5000);
  assert.equal(parseMoney('300 mil'), 300000);
  assert.equal(parseMoney(''), null);
  assert.equal(parseMoney('abc'), null);
  assert.equal(parseMoney(null), null);
  assert.equal(parseMoney(undefined), null);
  assert.equal(parseMoney(1234.6), 1235);
  assert.equal(parseMoney(NaN), null);
  assert.equal(parseMoney('$'), null);
});

// ---------- parseRate ----------
test('parseRate: tolera coma y %, y no toca un interés mensual normal', () => {
  assert.deepEqual(parseRate('6,49'), { valor: 6.49, convertida: false, original: 6.49, aviso: null });
  assert.equal(parseRate('6.49').valor, 6.49);
  assert.equal(parseRate('6,49 %').valor, 6.49);
  assert.equal(parseRate(7).valor, 7);
  assert.equal(parseRate('15').convertida, false); // el tope es "mayor a 15"
  assert.equal(parseRate('0').valor, 0);
});

test('parseRate: una tasa anual (mayor a 15) se convierte a mensual aproximado y avisa', () => {
  const r = parseRate('79');
  assert.equal(r.convertida, true);
  assert.equal(r.original, 79);
  assert.equal(r.valor, 6.49);
  assert.equal(r.aviso, '79% parece la tasa anual. ¿Usamos 6,49% por mes?');
  assert.equal(parseRate('79,5').convertida, true);
  assert.equal(parseRate('120').valor, 9.86);
});

test('parseRate: entradas ilegibles o negativas dan null', () => {
  assert.equal(parseRate(''), null);
  assert.equal(parseRate(null), null);
  assert.equal(parseRate('abc'), null);
  assert.equal(parseRate(-3), null);
  assert.equal(parseRate('%'), null);
});

test('revisarMonto: avisa ceros de más (más de 9 dígitos o sueldo mayor a 20 millones)', () => {
  assert.deepEqual(revisarMonto(900000), { ok: true, aviso: null });
  assert.equal(revisarMonto(1234567890).ok, false);
  assert.equal(revisarMonto(1234567890).aviso, 'Mirá bien los ceros, por favor.');
  assert.equal(revisarMonto(25000000, { tipo: 'sueldo' }).ok, false);
  assert.equal(revisarMonto(25000000).ok, true);
  assert.equal(revisarMonto('x').ok, false);
});

// ---------- fechas ----------
test('toDate / toISO / monthKeyOf', () => {
  assert.equal(toISO(new Date(2026, 9, 4, 18, 30)), '2026-10-04');
  assert.equal(toISO('2026-10-04'), '2026-10-04');
  assert.equal(toISO('2026-10-04T23:59:00Z'), '2026-10-04'); // se queda con la parte de fecha escrita
  assert.equal(toDate('nada'), null);
  assert.equal(toISO('nada'), null);
  assert.equal(toDate(new Date('x')), null);
  assert.equal(monthKeyOf(new Date(2026, 9, 4)), '2026-10');
  assert.equal(monthKeyOf('2026-10-04'), '2026-10');
  assert.equal(monthKeyOf('2026-10'), '2026-10');
});

test('addDays / addMonthsDate / daysBetween / lastDayOfMonth', () => {
  assert.equal(toISO(addDays('2026-10-30', 3)), '2026-11-02');
  assert.equal(toISO(addDays('2026-01-01', -1)), '2025-12-31');
  assert.equal(toISO(addMonthsDate('2026-01-31', 1)), '2026-02-28'); // el día no existe: último del mes
  assert.equal(toISO(addMonthsDate('2028-01-31', 1)), '2028-02-29');
  assert.equal(toISO(addMonthsDate('2026-11-15', 3)), '2027-02-15');
  assert.equal(toISO(addMonthsDate('2026-03-15', -4)), '2025-11-15');
  assert.equal(daysBetween('2026-10-04', '2026-10-13'), 9);
  assert.equal(daysBetween('2026-10-13', '2026-10-04'), -9);
  assert.equal(daysBetween('2026-10-24', '2026-10-25'), 1); // sin saltos por horario de verano
  assert.equal(lastDayOfMonth('2026-02-10'), 28);
  assert.equal(lastDayOfMonth(new Date(2026, 9, 4)), 31);
});

test('monthName: variantes', () => {
  assert.equal(monthName('2026-10'), 'octubre');
  assert.equal(monthName('2026-10', { year: true }), 'octubre 2026');
  assert.equal(monthName('2026-10', { year: true, de: true }), 'octubre de 2026');
  assert.equal(monthName('2026-10', { short: true }), 'Oct');
  assert.equal(monthName('2027-01', { capital: true }), 'Enero');
  assert.equal(monthName(new Date(2026, 4, 1)), 'mayo');
  assert.equal(monthName('basura'), '');
});

test('longDate: variantes', () => {
  assert.equal(longDate('2026-10-04'), '4 de octubre');
  assert.equal(longDate('2026-10-04', { weekday: true }), 'domingo 4 de octubre');
  assert.equal(longDate('2026-10-04', { weekday: true, capital: true }), 'Domingo 4 de octubre');
  assert.equal(longDate('2026-10-04', { year: true }), '4 de octubre de 2026');
  assert.equal(longDate(new Date(2026, 9, 13)), '13 de octubre');
  assert.equal(longDate('x'), '');
});

test('haceTiempo: en palabras', () => {
  const hoy = new Date(2026, 9, 4);
  assert.equal(haceTiempo('2026-10-04', hoy), 'hoy');
  assert.equal(haceTiempo('2026-10-03', hoy), 'ayer');
  assert.equal(haceTiempo('2026-10-01', hoy), 'hace 3 días');
  assert.equal(haceTiempo('2026-09-10', hoy), 'hace 3 semanas');
  assert.equal(haceTiempo('2026-05-04', hoy), 'hace 5 meses');
  assert.equal(haceTiempo(null, hoy), null);
});

test('plural y lista', () => {
  assert.equal(plural(7, 'mes', 'meses'), '7 meses');
  assert.equal(plural(1, 'mes', 'meses'), '1 mes');
  assert.equal(plural(0, 'mes', 'meses'), '0 meses');
  assert.equal(plural(2, 'mes', 'meses', { sinNumero: true }), 'meses');
  assert.equal(lista(['AFIP', 'aguinaldo', 'planilla']), 'AFIP, aguinaldo y planilla');
  assert.equal(lista(['AFIP', 'aguinaldo']), 'AFIP y aguinaldo');
  assert.equal(lista(['AFIP']), 'AFIP');
  assert.equal(lista([]), '');
  assert.equal(lista(['a', '', null, 'b']), 'a y b');
});
