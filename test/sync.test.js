// Sincronización (src/sync.js) contra el handler real de api/estado.js con un Blob en memoria, dos o más "celulares", reloj falso.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  captureKey, getKey, forgetKey, shareLink, syncable, canon, hasOwnData, mergeStates, conPreferenciasLocales, leerEstadoRemoto,
  KEY_STORAGE, META_STORAGE, LOCAL_SETTINGS, DEBOUNCE_MS, POLL_MS, BACKOFF_MS,
} from '../src/sync.js';
import { normalize } from '../src/store.js';
import { KEY, ENV, makeClock, makeCloud, makePhone, datos, settle } from './_sync-harness.js';

const mundo = (opts) => { const clock = makeClock(); const net = makeCloud(clock, opts); return { clock, net, celular: (o = {}) => makePhone({ clock, net, ...o }) }; };
const nombresIngresos = (s) => s.incomes.map((i) => i.id).sort();

// ============================================================ clave en el link
function fakeLocation(url) {
  const u = new URL(url);
  return { hash: u.hash, search: u.search, pathname: u.pathname };
}
function entorno(url) {
  const store = new Map();
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  const reemplazos = [];
  return { storage, store, reemplazos, location: fakeLocation(url), history: { state: null, replaceState: (s, t, u) => reemplazos.push(u) } };
}

test('la clave en el fragmento (#k=) se guarda y se borra de la dirección', () => {
  const e = entorno(`https://ejemplo.vercel.app/#k=${KEY}`);
  const r = captureKey(e);
  assert.deepEqual(r, { capturada: true });
  assert.equal(getKey(e.storage), KEY);
  assert.deepEqual(e.reemplazos, ['/']);
  assert.ok(!JSON.stringify(r).includes(KEY));
});

test('#k= con más fragmento deja lo que corresponde; ?k= también se acepta y se limpia sin tocar el resto', () => {
  const a = entorno(`https://ejemplo.vercel.app/#k=${KEY}&/hoy`);
  captureKey(a);
  assert.deepEqual(a.reemplazos, ['/#/hoy']);
  const b = entorno(`https://ejemplo.vercel.app/?hoy=2026-10-04&k=${KEY}#/meses`);
  assert.equal(captureKey(b).capturada, true);
  assert.deepEqual(b.reemplazos, ['/?hoy=2026-10-04#/meses']);
  assert.equal(getKey(b.storage), KEY);
});

test('sin clave en el link no se toca nada; una clave inservible se descarta pero igual se limpia la dirección', () => {
  const a = entorno('https://ejemplo.vercel.app/#/hoy');
  assert.deepEqual(captureKey(a), { capturada: false });
  assert.deepEqual(a.reemplazos, []);
  const b = entorno('https://ejemplo.vercel.app/#k=ab');
  assert.equal(captureKey(b).capturada, false);
  assert.equal(getKey(b.storage), null);
  assert.deepEqual(b.reemplazos, ['/']);
});

test('una clave nueva descarta lo que se sabía de la nube anterior; la misma clave no', () => {
  const e = entorno(`https://ejemplo.vercel.app/#k=${KEY}`);
  captureKey(e);
  e.storage.setItem(META_STORAGE, '{"baseRev":3,"base":null,"savedAt":null}');
  captureKey({ ...e, location: fakeLocation(`https://ejemplo.vercel.app/#k=${KEY}`) });
  assert.ok(e.storage.getItem(META_STORAGE));
  captureKey({ ...e, location: fakeLocation('https://ejemplo.vercel.app/#k=otra-clave-nueva-456') });
  assert.equal(e.storage.getItem(META_STORAGE), null);
  assert.equal(getKey(e.storage), 'otra-clave-nueva-456');
});

test('shareLink arma el link con la clave en el fragmento y forgetKey desconecta', () => {
  const e = entorno(`https://ejemplo.vercel.app/#k=${KEY}`);
  captureKey(e);
  assert.equal(shareLink(e.storage, 'https://ejemplo.vercel.app'), `https://ejemplo.vercel.app/#k=${KEY}`);
  forgetKey(e.storage);
  assert.equal(shareLink(e.storage, 'https://ejemplo.vercel.app'), null);
  assert.equal(e.store.has(KEY_STORAGE), false);
});

// ============================================================ puras
test('syncable saca solo las preferencias de este celular', () => {
  const s = datos({}, { theme: 'dark', fontSize: 'grande', privacy: true, mesesMode: '12', lastBackupAt: '2026-10-01', onboardingStep: 3, demo: false, buffer: 50 });
  const p = syncable(s);
  for (const k of LOCAL_SETTINGS) assert.equal(k in p.settings, false, k);
  assert.equal(p.settings.buffer, 50);
  assert.equal(p.settings.onboarded, true);
  assert.equal(s.settings.theme, 'dark', 'no muta el original');
});

test('hasOwnData: el ejemplo y lo vacío no cuentan', () => {
  assert.equal(hasOwnData(normalize({})), false);
  assert.equal(hasOwnData(datos({}, { demo: true })), false);
  assert.equal(hasOwnData(datos()), true);
  assert.equal(hasOwnData(normalize({ people: [{ id: 'p', name: 'Ana' }] })), true);
});

test('conPreferenciasLocales conserva las locales y apaga el ejemplo', () => {
  const local = datos({}, { theme: 'dark', fontSize: 'masgrande', privacy: true, mesesMode: '12', onboardingStep: 4, demo: true, lastBackupAt: '2026-09-01' });
  const nube = datos({ expenses: [] }, { theme: 'light', buffer: 70 });
  const r = conPreferenciasLocales(nube, local);
  assert.equal(r.settings.theme, 'dark');
  assert.equal(r.settings.fontSize, 'masgrande');
  assert.equal(r.settings.privacy, true);
  assert.equal(r.settings.mesesMode, '12');
  assert.equal(r.settings.onboardingStep, 4);
  assert.equal(r.settings.lastBackupAt, '2026-09-01');
  assert.equal(r.settings.demo, false);
  assert.equal(r.settings.buffer, 70);
  assert.equal(r.expenses.length, 0);
});

test('leerEstadoRemoto pasa por importJSON: rechaza formas raras y versiones más nuevas', () => {
  assert.equal(leerEstadoRemoto({ settings: {}, incomes: 'no' }).ok, false);
  assert.equal(leerEstadoRemoto('hola').ok, false);
  const nueva = leerEstadoRemoto({ v: 99, settings: {}, incomes: [] });
  assert.equal(nueva.ok, false);
  assert.match(nueva.mensaje, /versión más nueva/);
  const ok = leerEstadoRemoto({ settings: { onboarded: true }, incomes: [{ id: 'x', amount: '500' }] });
  assert.equal(ok.ok, true);
  assert.equal(ok.state.incomes[0].amount, 500);
});

// ============================================================ merge por id
const B = () => syncable(datos());
const conIngreso = (s, id, monto) => { const c = structuredClone(s); c.incomes.push({ id, name: id, owner: 'Ana', amount: monto, kind: 'otro' }); return c; };

test('merge: cada lado agregó algo distinto -> se juntan los dos', () => {
  const base = B();
  const local = conIngreso(base, 'l1', 10);
  const remoto = structuredClone(base); remoto.expenses.push({ id: 'r1', name: 'Luz', owner: 'Ana', amount: 5, kind: 'otro' });
  const m = mergeStates(base, local, remoto);
  assert.equal(m.ok, true);
  assert.deepEqual(nombresIngresos(m.state), ['i1', 'l1']);
  assert.deepEqual(m.state.expenses.map((x) => x.id), ['e1', 'r1']);
  assert.equal(m.tocoLocal && m.tocoRemoto, true);
});

test('merge: cambios en elementos distintos y un borrado que el otro no tocó', () => {
  const base = syncable(datos({ incomes: [{ id: 'i1', name: 'A', amount: 1, kind: 'otro' }, { id: 'i2', name: 'B', amount: 2, kind: 'otro' }, { id: 'i3', name: 'C', amount: 3, kind: 'otro' }] }));
  const local = structuredClone(base); local.incomes[0].amount = 11; local.incomes = local.incomes.filter((x) => x.id !== 'i3');
  const remoto = structuredClone(base); remoto.incomes[1].amount = 22;
  const m = mergeStates(base, local, remoto);
  assert.equal(m.ok, true);
  assert.deepEqual(m.state.incomes.map((x) => [x.id, x.amount]), [['i1', 11], ['i2', 22]]);
});

test('merge: los dos cambiaron el mismo elemento distinto -> no es inequívoco', () => {
  const base = B();
  const local = structuredClone(base); local.incomes[0].amount = 1;
  const remoto = structuredClone(base); remoto.incomes[0].amount = 2;
  const m = mergeStates(base, local, remoto);
  assert.equal(m.ok, false);
  assert.match(m.motivo, /mismo dato/);
});

test('merge: uno modificó y el otro borró lo mismo -> pregunta; los dos borraron lo mismo o cambiaron igual -> sigue', () => {
  const base = B();
  const local = structuredClone(base); local.incomes[0].amount = 1;
  const remoto = structuredClone(base); remoto.incomes = [];
  assert.equal(mergeStates(base, local, remoto).ok, false);
  const l2 = structuredClone(base); l2.incomes = [];
  assert.equal(mergeStates(base, l2, remoto).ok, true);
  const l3 = structuredClone(base); l3.incomes[0].amount = 7;
  const r3 = structuredClone(base); r3.incomes[0].amount = 7;
  assert.equal(mergeStates(base, l3, r3).ok, true);
});

test('merge: ajustes distintos se juntan, el mismo ajuste distinto pregunta, los pasos y lo ya visto se suman', () => {
  const base = B();
  const local = structuredClone(base); local.settings.buffer = 10; local.settings.pasos = { ingresos: true }; local.seen.hitos = ['h1']; local.seen.proyecciones = { '2026-10': 5 };
  const remoto = structuredClone(base); remoto.settings.cash = 20; remoto.settings.pasos = { gastos: true }; remoto.seen.hitos = ['h2']; remoto.seen.proyecciones = { '2026-10': 9 };
  const m = mergeStates(base, local, remoto);
  assert.equal(m.ok, true);
  assert.equal(m.state.settings.buffer, 10);
  assert.equal(m.state.settings.cash, 20);
  assert.deepEqual(m.state.settings.pasos, { gastos: true, ingresos: true });
  assert.deepEqual(m.state.seen.hitos.sort(), ['h1', 'h2']);
  assert.equal(m.state.seen.proyecciones['2026-10'], 9, 'en el mismo mes gana la nube');
  const l2 = structuredClone(base); l2.settings.buffer = 1;
  const r2 = structuredClone(base); r2.settings.buffer = 2;
  assert.equal(mergeStates(base, l2, r2).ok, false);
});

test('merge: sin base, con ids repetidos o con una persona borrada mientras el otro cargaba datos -> no es inequívoco', () => {
  const base = B();
  assert.equal(mergeStates(null, base, base).ok, false);
  const dup = structuredClone(base); dup.incomes.push({ ...dup.incomes[0] });
  assert.equal(mergeStates(base, dup, base).ok, false);
  const local = structuredClone(base); local.people = [];
  const remoto = conIngreso(base, 'r9', 3);
  assert.equal(mergeStates(base, local, remoto).ok, false);
});

// ============================================================ primer arranque
test('sin clave: no pide nada a la red y queda en "sin nube"', async () => {
  const { net, celular } = mundo();
  const a = celular({ key: null, state: datos() });
  await a.start();
  assert.equal(a.ctrl.status().code, 'sin-nube');
  assert.equal(net.log.length, 0);
  a.edit((d) => { d.incomes[0].amount = 5; });
  assert.equal(net.log.length, 0);
});

test('siembra: la nube vacía y este celular con datos propios -> se sube, sin las preferencias locales', async () => {
  const { net, celular } = mundo();
  const a = celular({ state: datos({}, { theme: 'dark', fontSize: 'grande', privacy: true, lastBackupAt: '2026-10-01' }) });
  await a.start();
  assert.equal(net.count('PUT'), 1);
  const doc = net.doc();
  assert.equal(doc.rev, 1);
  assert.equal(doc.state.incomes[0].id, 'i1');
  for (const k of LOCAL_SETTINGS) assert.equal(k in doc.state.settings, false, `no debería subir ${k}`);
  assert.equal(a.ctrl.status().code, 'ok');
  assert.equal(a.ctrl.info().baseRev, 1);
});

test('nube vacía y celular vacío o con el ejemplo: no se sube nada hasta que se cargue algo propio', async () => {
  const { clock, net, celular } = mundo();
  const vacio = celular({ state: normalize({}) });
  await vacio.start();
  const ejemplo = celular({ state: datos({}, { demo: true }) });
  await ejemplo.start();
  assert.equal(net.count('PUT'), 0);
  assert.equal(vacio.ctrl.status().code, 'ok');
  vacio.edit((d) => { d.incomes.push({ id: 'n1', name: 'Sueldo', amount: 9, kind: 'sueldo' }); });
  await clock.advance(DEBOUNCE_MS);
  assert.equal(net.count('PUT'), 1, 'recién al cargar algo propio empieza a subir');
  assert.equal(net.doc().state.incomes[0].id, 'n1');
});

test('bajar: la nube con datos y este celular vacío -> se aplican y se conservan las preferencias locales', async () => {
  const { net, celular } = mundo();
  const a = celular({ state: datos() });
  await a.start();
  const b = celular({ state: normalize({ settings: { theme: 'dark', fontSize: 'grande', privacy: true, mesesMode: '12' } }) });
  await b.start();
  assert.deepEqual(b.applied, ['bajado']);
  assert.deepEqual(b.notices, ['bajado']);
  assert.equal(b.chooses.length, 0);
  assert.equal(b.state.incomes[0].id, 'i1');
  assert.equal(b.state.settings.theme, 'dark');
  assert.equal(b.state.settings.fontSize, 'grande');
  assert.equal(b.state.settings.privacy, true);
  assert.equal(b.state.settings.mesesMode, '12');
  assert.equal(b.state.settings.onboarded, true);
  assert.equal(net.count('PUT'), 1, 'bajar no sube nada');
});

test('bajar con el ejemplo cargado: reemplaza el ejemplo y deja de ser ejemplo', async () => {
  const { celular } = mundo();
  const a = celular({ state: datos() });
  await a.start();
  const b = celular({ state: datos({ incomes: [{ id: 'demo1', name: 'Ejemplo', amount: 1, kind: 'sueldo' }] }, { demo: true }) });
  await b.start();
  assert.deepEqual(b.applied, ['bajado']);
  assert.equal(b.state.settings.demo, false);
  assert.deepEqual(nombresIngresos(b.state), ['i1']);
});

test('los dos con datos iguales: se unen sin preguntar', async () => {
  const { celular } = mundo();
  const a = celular({ state: datos() });
  await a.start();
  const b = celular({ state: datos({}, { theme: 'dark' }) });
  await b.start();
  assert.equal(b.chooses.length, 0);
  assert.deepEqual(b.applied, []);
  assert.equal(b.ctrl.status().code, 'ok');
});

test('los dos con datos distintos: hoja de elección con el resumen de cada lado; nunca se decide en silencio', async () => {
  const { net, celular } = mundo();
  const a = celular({ state: datos() });
  await a.start();
  const b = celular({ state: datos({ incomes: [{ id: 'zz', name: 'Otro', amount: 5, kind: 'otro' }], expenses: [] }) });
  b.answer.choose = null;
  await b.start();
  assert.equal(b.chooses.length, 1);
  const info = b.chooses[0];
  assert.equal(info.kind, 'primera');
  assert.ok(info.savedAt);
  assert.match(info.remote.resumen.texto, /gasto/);
  assert.match(info.local.resumen.texto, /ingreso/);
  assert.equal(b.ctrl.status().code, 'decidir');
  assert.equal(net.count('PUT'), 1, 'no subió nada mientras no decidió');
  assert.deepEqual(b.applied, []);
  b.edit((d) => { d.incomes[0].amount = 6; });
  await settle();
  assert.equal(net.count('PUT'), 1, 'tampoco sube cambios mientras falta decidir');
});

test('elegir "la nube" aplica lo de la nube; elegir "lo mío" reemplaza la nube', async () => {
  const { net, celular } = mundo();
  const a = celular({ state: datos() });
  await a.start();
  const b = celular({ state: datos({ incomes: [{ id: 'zz', name: 'Otro', amount: 5, kind: 'otro' }] }) });
  b.answer.choose = 'nube';
  await b.start();
  assert.deepEqual(nombresIngresos(b.state), ['i1']);
  assert.equal(b.ctrl.status().code, 'ok');

  const c = celular({ state: datos({ incomes: [{ id: 'cc', name: 'Mío', amount: 5, kind: 'otro' }] }) });
  c.answer.choose = 'mio';
  await c.start();
  assert.deepEqual(c.applied, []);
  assert.deepEqual(nombresIngresos({ incomes: net.doc().state.incomes }), ['cc']);
  assert.equal(net.doc().rev, 2);
});

test('si se cierra la hoja sin elegir, se vuelve a preguntar con decidir() y recién ahí se resuelve', async () => {
  const { net, celular } = mundo();
  const a = celular({ state: datos() });
  await a.start();
  const b = celular({ state: datos({ incomes: [{ id: 'zz', name: 'Otro', amount: 5, kind: 'otro' }] }) });
  await b.start();
  assert.deepEqual(b.notices, ['despues']);
  b.answer.choose = 'mio';
  b.ctrl.decidir();
  await settle();
  assert.equal(b.chooses.length, 2);
  assert.equal(net.doc().state.incomes[0].id, 'zz');
});

// ============================================================ subir cambios
test('cada cambio sube con 1500 ms de espera; varios cambios seguidos son un solo guardado con el último estado', async () => {
  const { clock, net, celular } = mundo();
  const a = celular({ state: datos() });
  await a.start();
  assert.equal(net.count('PUT'), 1);
  a.edit((d) => { d.expenses[0].amount = 1; });
  assert.equal(a.ctrl.status().code, 'guardando');
  await clock.advance(DEBOUNCE_MS - 100);
  a.edit((d) => { d.expenses[0].amount = 2; });
  await clock.advance(DEBOUNCE_MS - 100);
  a.edit((d) => { d.expenses[0].amount = 3; });
  await clock.advance(DEBOUNCE_MS - 1);
  assert.equal(net.count('PUT'), 1, 'todavía no');
  await clock.advance(2);
  assert.equal(net.count('PUT'), 2);
  assert.equal(net.doc().state.expenses[0].amount, 3);
  assert.equal(net.doc().rev, 2);
  assert.equal(a.ctrl.status().code, 'ok');
});

test('un cambio de preferencias de este celular (tema, letra, privacidad) no sube nada', async () => {
  const { clock, net, celular } = mundo();
  const a = celular({ state: datos() });
  await a.start();
  const antes = net.count('PUT');
  a.edit((d) => { d.settings.theme = 'dark'; d.settings.privacy = true; d.settings.fontSize = 'grande'; });
  await clock.advance(DEBOUNCE_MS * 3);
  assert.equal(net.count('PUT'), antes);
  assert.equal(a.ctrl.status().code, 'ok');
});

test('si cambia algo mientras se está subiendo, se sube de nuevo con lo último', async () => {
  const { clock, net, celular } = mundo();
  const a = celular({ state: datos() });
  await a.start();
  a.edit((d) => { d.expenses[0].amount = 10; });
  const fetchOriginal = net.fetch;
  let soltar;
  net.fetch = (url, init) => (init?.method === 'PUT' && !soltar ? new Promise((res) => { soltar = () => res(fetchOriginal(url, init)); }) : fetchOriginal(url, init));
  await clock.advance(DEBOUNCE_MS);
  assert.ok(soltar, 'el PUT quedó en vuelo');
  a.edit((d) => { d.expenses[0].amount = 20; });
  soltar();
  await clock.advance(DEBOUNCE_MS + 10);
  assert.equal(net.doc().state.expenses[0].amount, 20);
  assert.equal(a.ctrl.status().code, 'ok');
});

// ============================================================ dos celulares
async function dosCelulares() {
  const w = mundo();
  const madre = w.celular({ state: datos(), nombre: 'madre' });
  await madre.start();
  const hijo = w.celular({ state: normalize({ settings: { theme: 'dark' } }), nombre: 'hijo' });
  await hijo.start();
  return { ...w, madre, hijo };
}

test('lo que carga uno lo ve el otro: aplica en silencio y avisa con un toast breve', async () => {
  const { clock, net, madre, hijo } = await dosCelulares();
  madre.edit((d) => { d.expenses.push({ id: 'e2', name: 'Luz', owner: 'Ana', amount: 50, kind: 'otro' }); });
  await clock.advance(DEBOUNCE_MS);
  hijo.notices.length = 0;
  await clock.advance(POLL_MS);
  assert.deepEqual(hijo.applied.slice(-1), ['actualizado']);
  assert.deepEqual(hijo.notices, ['actualizado']);
  assert.deepEqual(hijo.state.expenses.map((e) => e.id), ['e1', 'e2']);
  assert.equal(hijo.state.settings.theme, 'dark');
  assert.equal(hijo.chooses.length + hijo.conflicts.length, 0);
  assert.equal(net.doc().rev, 2);
});

test('el control periódico es liviano (?meta=1) cuando no cambió nada, y no corre con la app oculta', async () => {
  const { clock, net, madre, hijo } = await dosCelulares();
  const antes = net.log.length;
  await clock.advance(POLL_MS);
  const nuevos = net.log.slice(antes);
  assert.equal(nuevos.length, 2, 'uno por cada celular');
  for (const n of nuevos) assert.match(n.url, /\?meta=1$/);
  hijo.visible = false;
  madre.visible = false;
  const n = net.log.length;
  await clock.advance(POLL_MS * 3);
  assert.equal(net.log.length, n);
  hijo.visible = true;
  await clock.advance(POLL_MS);
  assert.ok(net.log.length > n);
});

test('al volver a primer plano se consulta enseguida (poll), pero no más de una vez cada 2 s', async () => {
  const { clock, net, madre, hijo } = await dosCelulares();
  madre.edit((d) => { d.expenses[0].amount = 999; });
  await clock.advance(DEBOUNCE_MS);
  await clock.advance(3000);
  await hijo.ctrl.poll();
  await settle();
  assert.equal(hijo.state.expenses[0].amount, 999);
  const n = net.log.length;
  await hijo.ctrl.poll();
  assert.equal(net.log.length, n, 'throttle');
});

test('cambios en elementos distintos de los dos celulares: se juntan solos, sin preguntar, y quedan los dos en la nube', async () => {
  const { clock, net, madre, hijo } = await dosCelulares();
  madre.edit((d) => { d.expenses.push({ id: 'madre1', name: 'Verdulería', owner: 'Ana', amount: 30, kind: 'otro' }); });
  hijo.edit((d) => { d.incomes.push({ id: 'hijo1', name: 'Beca', owner: 'Ana', amount: 70, kind: 'otro' }); });
  await clock.advance(DEBOUNCE_MS); // madre sube primero
  await clock.advance(DEBOUNCE_MS); // hijo choca (409) y junta
  await settle();
  assert.equal(hijo.conflicts.length + hijo.chooses.length, 0);
  assert.ok(hijo.applied.includes('unido'));
  assert.ok(hijo.notices.includes('unido'));
  assert.deepEqual(hijo.state.expenses.map((e) => e.id), ['e1', 'madre1']);
  assert.deepEqual(nombresIngresos(hijo.state), ['hijo1', 'i1']);
  assert.deepEqual(nombresIngresos({ incomes: net.doc().state.incomes }), ['hijo1', 'i1']);
  assert.equal(net.doc().state.expenses.length, 2);
  await clock.advance(POLL_MS);
  assert.deepEqual(nombresIngresos(madre.state), ['hijo1', 'i1']);
  assert.equal(canon(syncable(madre.state)), canon(syncable(hijo.state)));
});

test('el mismo dato cambiado distinto en los dos: hoja de conflicto; "la nube" descarta lo local', async () => {
  const { clock, net, madre, hijo } = await dosCelulares();
  madre.edit((d) => { d.incomes[0].amount = 5000; });
  hijo.edit((d) => { d.incomes[0].amount = 7000; });
  hijo.answer.conflict = 'nube';
  await clock.advance(DEBOUNCE_MS);
  await clock.advance(DEBOUNCE_MS);
  assert.equal(hijo.conflicts.length, 1);
  assert.equal(hijo.conflicts[0].kind, 'conflicto');
  assert.ok(hijo.conflicts[0].savedAt);
  assert.equal(hijo.state.incomes[0].amount, 5000);
  assert.equal(net.doc().state.incomes[0].amount, 5000);
  assert.equal(hijo.ctrl.status().code, 'ok');
});

test('conflicto: "lo mío" reemplaza la nube y el otro celular lo recibe', async () => {
  const { clock, net, madre, hijo } = await dosCelulares();
  madre.edit((d) => { d.incomes[0].amount = 5000; });
  hijo.edit((d) => { d.incomes[0].amount = 7000; });
  hijo.answer.conflict = 'mio';
  await clock.advance(DEBOUNCE_MS);
  await clock.advance(DEBOUNCE_MS);
  assert.equal(net.doc().state.incomes[0].amount, 7000);
  assert.equal(net.doc().rev, 3);
  await clock.advance(POLL_MS);
  assert.equal(madre.state.incomes[0].amount, 7000);
});

test('conflicto sin resolver: no se sube nada, se avisa una vez, y decidir() lo vuelve a preguntar', async () => {
  const { clock, net, madre, hijo } = await dosCelulares();
  madre.edit((d) => { d.incomes[0].amount = 5000; });
  hijo.edit((d) => { d.incomes[0].amount = 7000; });
  await clock.advance(DEBOUNCE_MS);
  await clock.advance(DEBOUNCE_MS);
  assert.equal(hijo.ctrl.status().code, 'decidir');
  assert.equal(hijo.state.incomes[0].amount, 7000, 'lo local sigue intacto');
  assert.ok(hijo.notices.includes('despues'));
  const puts = net.count('PUT');
  await clock.advance(POLL_MS * 3);
  assert.equal(net.count('PUT'), puts);
  assert.equal(hijo.conflicts.length, 1, 'no vuelve a preguntar solo');
  hijo.answer.conflict = 'nube';
  hijo.ctrl.decidir();
  await settle();
  assert.equal(hijo.conflicts.length, 2);
  assert.equal(hijo.state.incomes[0].amount, 5000);
});

test('si la persona está en medio de algo (hoja abierta o escribiendo), no se pisa: se pospone y se aplica después', async () => {
  const { clock, madre, hijo } = await dosCelulares();
  madre.edit((d) => { d.expenses[0].amount = 111; });
  await clock.advance(DEBOUNCE_MS);
  hijo.canApply = false;
  await clock.advance(POLL_MS);
  assert.notEqual(hijo.state.expenses[0].amount, 111);
  assert.deepEqual(hijo.applied.filter((k) => k === 'actualizado'), []);
  hijo.canApply = true;
  await clock.advance(5000);
  assert.equal(hijo.state.expenses[0].amount, 111);
});

test('"Borrar todo" confirmado se propaga: el otro celular recibe el estado vacío', async () => {
  const { clock, net, madre, hijo } = await dosCelulares();
  madre.edit((d) => { d.incomes = []; d.expenses = []; d.people = []; d.settings.onboarded = false; });
  await clock.advance(DEBOUNCE_MS);
  assert.equal(net.doc().state.incomes.length, 0);
  await clock.advance(POLL_MS);
  assert.equal(hijo.state.incomes.length, 0);
  assert.equal(hijo.state.settings.theme, 'dark');
});

test('"Restaurar una copia": al terminar, propagar() sube sin esperar', async () => {
  const { clock, net, madre, hijo } = await dosCelulares();
  madre.edit((d) => { d.incomes.push({ id: 'copia1', name: 'De la copia', amount: 1, kind: 'otro' }); });
  await madre.ctrl.propagar();
  await settle();
  assert.equal(net.doc().state.incomes.length, 2);
  await clock.advance(POLL_MS);
  assert.equal(hijo.state.incomes.length, 2);
});

test('la nube quedó vacía (alguien borró el archivo): se vuelve a sembrar con lo de este celular', async () => {
  const { clock, net, madre } = await dosCelulares();
  net.blob.files.clear();
  await clock.advance(POLL_MS);
  assert.equal(net.doc().rev, 1);
  assert.equal(net.doc().state.incomes[0].id, 'i1');
  assert.equal(madre.ctrl.status().code, 'ok');
});

// ============================================================ sin conexión
test('sin conexión: se guarda en el celular, queda "sin conexión" y se reintenta con 2, 4, 8, 16, 32, 60, 60 s', async () => {
  const { clock, net, celular } = mundo();
  const a = celular({ state: datos() });
  await a.start();
  net.offline = true;
  const a0 = clock.now();
  a.edit((d) => { d.expenses[0].amount = 77; });
  await clock.advance(DEBOUNCE_MS);
  assert.equal(a.ctrl.status().code, 'offline');
  assert.equal(a.state.expenses[0].amount, 77, 'lo local no se pierde');
  await clock.advance(2000 + 4000 + 8000 + 16000 + 32000 + 60000 * 2 + 10);
  const veces = net.log.filter((l) => l.at > a0).map((l) => l.at);
  assert.equal(veces[0], a0 + DEBOUNCE_MS, 'el primer intento es el guardado');
  assert.deepEqual(veces.slice(1).map((t, k) => t - veces[k]), [2000, 4000, 8000, 16000, 32000, 60000, 60000].map((x) => x), 'backoff');
  assert.equal(a.ctrl.status().code, 'offline');
});

test('al volver la conexión (evento online) sube ya, y solo el último estado', async () => {
  const { clock, net, celular } = mundo();
  const a = celular({ state: datos() });
  await a.start();
  net.offline = true;
  a.edit((d) => { d.expenses[0].amount = 1; });
  await clock.advance(DEBOUNCE_MS);
  a.edit((d) => { d.expenses[0].amount = 2; });
  await clock.advance(DEBOUNCE_MS);
  a.edit((d) => { d.expenses[0].amount = 3; });
  await clock.advance(DEBOUNCE_MS);
  net.offline = false;
  const puts = net.count('PUT');
  await a.ctrl.online();
  await settle();
  assert.equal(net.count('PUT'), puts + 1);
  assert.equal(net.doc().state.expenses[0].amount, 3);
  assert.equal(a.ctrl.status().code, 'ok');
});

test('lo pendiente sobrevive a cerrar la app: al abrirla de nuevo se sube', async () => {
  const { clock, net, celular } = mundo();
  const a = celular({ state: datos() });
  await a.start();
  net.offline = true;
  a.edit((d) => { d.expenses[0].amount = 88; });
  await clock.advance(DEBOUNCE_MS);
  a.ctrl.stop();
  net.offline = false;
  await a.restart();
  assert.equal(net.doc().state.expenses[0].amount, 88);
  assert.equal(a.ctrl.status().code, 'ok');
});

test('un celular que estuvo sin conexión y cambió, mientras otro también cambió: al volver se junta', async () => {
  const { clock, net, madre, hijo } = await dosCelulares();
  net.offline = true;
  hijo.edit((d) => { d.incomes.push({ id: 'hijo2', name: 'Changa', amount: 10, kind: 'otro' }); });
  await clock.advance(DEBOUNCE_MS);
  net.offline = false;
  const nm = net.log.length;
  net.offline = false;
  // la madre (que sí tenía red) sube lo suyo entretanto
  madre.edit((d) => { d.expenses.push({ id: 'madre2', name: 'Pan', owner: 'Ana', amount: 3, kind: 'otro' }); });
  await clock.advance(DEBOUNCE_MS);
  await hijo.ctrl.online();
  await settle();
  assert.ok(net.log.length > nm);
  assert.deepEqual(nombresIngresos(hijo.state), ['hijo2', 'i1']);
  assert.ok(hijo.state.expenses.some((e) => e.id === 'madre2'));
  assert.equal(net.doc().state.expenses.some((e) => e.id === 'madre2'), true);
  assert.equal(net.doc().state.incomes.some((e) => e.id === 'hijo2'), true);
});

test('un pedido colgado se corta a los 20 s y cuenta como sin conexión', async () => {
  const { clock, net, celular } = mundo();
  const a = celular({ state: datos() });
  net.hang = true;
  const p = a.ctrl.start();
  await clock.advance(20000);
  await p;
  assert.equal(a.ctrl.status().code, 'offline');
  net.hang = false;
});

test('un error del servidor (500) se reintenta con backoff y no se muestra como falta de red', async () => {
  const { clock, net, celular } = mundo();
  const a = celular({ state: datos() });
  net.status = 500;
  await a.start();
  assert.equal(a.ctrl.status().code, 'error');
  net.status = null;
  await clock.advance(2100);
  assert.equal(a.ctrl.status().code, 'ok');
  assert.equal(net.doc().rev, 1);
});

// ============================================================ nube no disponible, clave mala, datos raros
test('servidor sin configurar (503 sin-nube): queda en modo solo-local, sin reintentos ni avisos', async () => {
  const w = mundo({ env: {} });
  const a = w.celular({ state: datos() });
  await a.start();
  assert.equal(a.ctrl.status().code, 'sin-nube');
  assert.deepEqual(a.notices, []);
  const n = w.net.log.length;
  a.edit((d) => { d.expenses[0].amount = 5; });
  await w.clock.advance(60000);
  assert.equal(w.net.log.length, n, 'no insiste');
  assert.equal(a.state.expenses[0].amount, 5);
});

test('clave equivocada: 404 genérico -> estado "clave", sin reintentos, y la clave nunca viaja fuera del header', async () => {
  const w = mundo();
  const a = w.celular({ key: 'esta-clave-no-es-la-correcta', state: datos() });
  await a.start();
  assert.equal(a.ctrl.status().code, 'clave');
  const n = w.net.log.length;
  await w.clock.advance(120000);
  assert.equal(w.net.log.length, n);
  for (const l of w.net.log) {
    assert.ok(!l.url.includes('esta-clave'), 'la clave no va en la URL');
    assert.ok(!(l.body || '').includes('esta-clave'), 'ni en el cuerpo');
    assert.equal(l.headers.Authorization, 'Bearer esta-clave-no-es-la-correcta');
  }
  assert.ok(!JSON.stringify(a.ctrl.status()).includes('esta-clave'));
});

test('la clave correcta tampoco aparece en la URL, el cuerpo, el estado ni los avisos', async () => {
  const { clock, net, madre, hijo } = await dosCelulares();
  madre.edit((d) => { d.expenses[0].amount = 12; });
  await clock.advance(DEBOUNCE_MS + POLL_MS);
  for (const l of net.log) { assert.ok(!l.url.includes(KEY)); assert.ok(!(l.body || '').includes(KEY)); }
  for (const p of [madre, hijo]) {
    assert.ok(!JSON.stringify(p.ctrl.status()).includes(KEY));
    assert.ok(!JSON.stringify(p.ctrl.info()).includes(KEY));
    assert.ok(!JSON.stringify(p.notices).includes(KEY));
    assert.ok(!(p.store.get(META_STORAGE) || '').includes(KEY));
  }
});

test('datos de la nube que no se pueden leer: no rompen lo local, se avisa y se puede reemplazar la nube a pedido', async () => {
  const { clock, net, celular } = mundo();
  const a = celular({ state: datos() });
  await a.start();
  const b = celular({ state: datos() });
  await b.start();
  net.blob.files.set('miscuentas/estado.json', { body: JSON.stringify({ rev: 5, savedAt: '2026-10-07T10:00:00.000Z', state: { v: 99, settings: {}, incomes: [] } }), etag: '"x"' });
  await clock.advance(POLL_MS);
  assert.equal(b.ctrl.status().code, 'invalido');
  assert.ok(b.notices.includes('invalido'));
  assert.equal(b.state.incomes[0].id, 'i1');
  b.edit((d) => { d.expenses[0].amount = 9; });
  await clock.advance(DEBOUNCE_MS * 2);
  assert.equal(net.doc().rev, 5, 'no se pisa la nube sin que la persona lo decida');
  b.answer.conflict = 'mio';
  b.ctrl.decidir();
  await settle();
  assert.equal(b.conflicts.at(-1).kind, 'invalido');
  assert.equal(net.doc().rev, 6);
  assert.equal(net.doc().state.expenses[0].amount, 9);
});

test('el estado que sube nunca incluye el ejemplo: con el ejemplo cargado no se sube nada aunque cambie', async () => {
  const { clock, net, celular } = mundo();
  const a = celular({ state: normalize({}) });
  await a.start();
  a.edit((d) => { d.settings.demo = true; d.incomes.push({ id: 'd1', name: 'Ejemplo', amount: 1, kind: 'sueldo' }); });
  await clock.advance(DEBOUNCE_MS * 2);
  assert.equal(net.count('PUT'), 0);
});

test('un celular que vuelve después de mucho, sin cambios propios, recibe lo nuevo en silencio', async () => {
  const { clock, madre, hijo } = await dosCelulares();
  hijo.ctrl.stop();
  for (let i = 0; i < 3; i++) {
    madre.edit((d) => { d.expenses[0].amount = 100 + i; });
    await clock.advance(DEBOUNCE_MS);
  }
  await hijo.restart();
  assert.equal(hijo.state.expenses[0].amount, 102);
  assert.deepEqual(hijo.notices.slice(-1), ['actualizado']);
});

test('la clave se rota: con la nueva, el mismo contenido se une sin preguntar', async () => {
  const w = mundo();
  const a = w.celular({ state: datos() });
  await a.start();
  const clock = w.clock;
  const net2 = makeCloud(clock, { env: { ...ENV, MC_CLAVE: 'clave-nueva-de-prueba-9' } });
  net2.blob.files = w.net.blob.files; // misma nube, otra clave
  const b = makePhone({ clock, net: net2, key: 'clave-nueva-de-prueba-9', state: datos() });
  await b.start();
  assert.equal(b.chooses.length, 0);
  assert.equal(b.ctrl.status().code, 'ok');
  const vieja = makePhone({ clock, net: net2, key: KEY, state: datos() });
  await vieja.start();
  assert.equal(vieja.ctrl.status().code, 'clave');
});
