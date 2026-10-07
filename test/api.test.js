// api/estado.js con un Blob en memoria: contrato, clave, 503 sin nube, conflictos, límites y encabezados.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { makeHandler, claveCorrecta, estadoValido, BLOB_PATH, MAX_BODY } from '../api/estado.js';
import { makeBlobDouble, fakeReq, fakeRes } from './_blob-double.js';

const CLAVE = 'clave-de-prueba-123'; // ilustrativa: no es ninguna clave real
const ENV = { MC_CLAVE: CLAVE, BLOB_READ_WRITE_TOKEN: 'token-de-prueba' };
const auth = { authorization: `Bearer ${CLAVE}` };
const estado = (extra = {}) => ({ v: 2, settings: { name: 'Ana', onboarded: true }, incomes: [{ id: 'a1', name: 'Sueldo', amount: 1000 }], expenses: [], ...extra });

function nuevo(env = ENV, ahora = Date.parse('2026-10-07T15:00:00Z')) {
  const blob = makeBlobDouble();
  const handler = makeHandler({ blob, env, now: () => ahora });
  const call = async (opts) => { const res = fakeRes(); await handler(fakeReq(opts), res); return res; };
  return { blob, handler, call };
}
const put = (call, baseRev, state, headers = auth) => call({ method: 'PUT', headers, body: { baseRev, state } });

test('GET sin nada guardado: rev 0 y state null, con los encabezados de seguridad', async () => {
  const { call } = nuevo();
  const r = await call({ headers: auth });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json, { rev: 0, savedAt: null, state: null });
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.equal(r.headers['x-robots-tag'], 'noindex');
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.equal(r.headers['referrer-policy'], 'no-referrer');
});

test('PUT con baseRev 0 guarda, sube rev y GET lo devuelve; el blob es privado en la ruta acordada', async () => {
  const { call, blob } = nuevo();
  const p = await put(call, 0, estado());
  assert.equal(p.statusCode, 200);
  assert.equal(p.json.rev, 1);
  assert.equal(p.json.savedAt, '2026-10-07T15:00:00.000Z');
  const g = await call({ headers: auth });
  assert.deepEqual(g.json, { rev: 1, savedAt: '2026-10-07T15:00:00.000Z', state: estado() });
  assert.ok(blob.files.has(BLOB_PATH));
  const llamada = blob.calls.put[0];
  assert.equal(llamada.opts.access, 'private');
  assert.equal(llamada.opts.addRandomSuffix, false);
});

test('PUT sobre un rev existente usa ifMatch con el etag y sube de a uno', async () => {
  const { call, blob } = nuevo();
  await put(call, 0, estado());
  const p2 = await put(call, 1, estado({ expenses: [{ id: 'g1', amount: 5 }] }));
  assert.equal(p2.json.rev, 2);
  const seg = blob.calls.put[1].opts;
  assert.equal(seg.allowOverwrite, true);
  assert.ok(seg.ifMatch);
});

test('PUT con baseRev viejo da 409 con el estado actual', async () => {
  const { call } = nuevo();
  await put(call, 0, estado());
  await put(call, 1, estado({ expenses: [{ id: 'g1', amount: 5 }] }));
  const viejo = await put(call, 1, estado({ expenses: [{ id: 'otro', amount: 9 }] }));
  assert.equal(viejo.statusCode, 409);
  assert.equal(viejo.json.rev, 2);
  assert.equal(viejo.json.state.expenses[0].id, 'g1');
  assert.ok(viejo.json.savedAt);
});

test('carrera: si alguien escribe entre la lectura y la escritura, el Blob rechaza y la respuesta es 409', async () => {
  const { call, blob } = nuevo();
  await put(call, 0, estado());
  const putOriginal = blob.put;
  let colado = false;
  blob.put = async (p, body, opts) => {
    if (!colado) { // otro celular se adelanta justo antes de que escribamos
      colado = true;
      await putOriginal(p, JSON.stringify({ rev: 2, savedAt: 'x', state: estado({ spent: [{ id: 's' }] }) }), { access: 'private', addRandomSuffix: false, allowOverwrite: true });
    }
    return putOriginal(p, body, opts);
  };
  const r = await put(call, 1, estado({ expenses: [{ id: 'g' }] }));
  assert.equal(r.statusCode, 409);
  assert.equal(r.json.rev, 2);
});

test('primera escritura simultánea: el segundo que llega con baseRev 0 recibe 409', async () => {
  const { call, blob } = nuevo();
  const putOriginal = blob.put;
  let colado = false;
  blob.put = async (p, body, opts) => {
    if (!colado) { colado = true; await putOriginal(p, JSON.stringify({ rev: 1, savedAt: 'x', state: estado() }), { access: 'private', addRandomSuffix: false }); }
    return putOriginal(p, body, opts);
  };
  const r = await put(call, 0, estado({ expenses: [{ id: 'g' }] }));
  assert.equal(r.statusCode, 409);
  assert.equal(r.json.rev, 1);
});

test('clave ausente, incorrecta o mal armada: 404 genérico, sin tocar el Blob', async () => {
  const { call, blob } = nuevo();
  for (const headers of [{}, { authorization: 'Bearer otra-clave-cualquiera' }, { authorization: CLAVE }, { authorization: 'Basic abc' }, { authorization: 'Bearer ' }]) {
    const g = await call({ headers });
    assert.equal(g.statusCode, 404, JSON.stringify(headers));
    assert.ok(!g.texto.includes(CLAVE));
    const p = await put(call, 0, estado(), headers);
    assert.equal(p.statusCode, 404);
  }
  assert.equal(blob.calls.get.length, 0);
  assert.equal(blob.calls.put.length, 0);
});

test('la clave por query string no vale (las URLs se loguean)', async () => {
  const { call } = nuevo();
  const r = await call({ url: `/api/estado?k=${CLAVE}` });
  assert.equal(r.statusCode, 404);
});

test('sin MC_CLAVE, con clave demasiado corta o sin token del Blob: 503 sin-nube', async () => {
  const casos = [
    [{ BLOB_READ_WRITE_TOKEN: 't' }, ['MC_CLAVE']],
    [{ MC_CLAVE: CLAVE }, ['BLOB_READ_WRITE_TOKEN']],
    [{ MC_CLAVE: '1234', BLOB_READ_WRITE_TOKEN: 't' }, ['MC_CLAVE']],
    [{}, ['MC_CLAVE', 'BLOB_READ_WRITE_TOKEN']],
  ];
  for (const [env, falta] of casos) {
    const { call } = nuevo(env);
    const r = await call({ headers: auth });
    assert.equal(r.statusCode, 503);
    assert.deepEqual(r.json, { error: 'sin-nube', falta }); // solo nombres, nunca valores
    assert.ok(!JSON.stringify(r.json).includes(CLAVE));
    assert.equal(r.headers['cache-control'], 'no-store');
  }
});

test('otros métodos: 405 con Allow (pero solo si la clave es correcta)', async () => {
  const { call } = nuevo();
  for (const method of ['POST', 'DELETE', 'PATCH', 'HEAD']) {
    const r = await call({ method, headers: auth });
    assert.equal(r.statusCode, 405, method);
    assert.equal(r.headers.allow, 'GET, PUT');
  }
  assert.equal((await call({ method: 'POST' })).statusCode, 404);
});

test('cuerpo de más de 1 MB: 413 (por Content-Length, por tamaño del texto y por stream)', async () => {
  const { call, blob } = nuevo();
  const grande = estado({ spent: [{ id: 'x', label: 'a'.repeat(MAX_BODY) }] });
  assert.equal((await put(call, 0, grande)).statusCode, 413);
  assert.equal((await call({ method: 'PUT', headers: { ...auth, 'content-length': String(MAX_BODY + 1) }, body: undefined })).statusCode, 413);
  const texto = JSON.stringify({ baseRev: 0, state: grande });
  assert.equal((await call({ method: 'PUT', headers: auth, body: texto })).statusCode, 413);
  const res = fakeRes();
  const { handler } = nuevo();
  const stream = Object.assign(Readable.from([Buffer.from(texto)]), { method: 'PUT', url: '/api/estado', headers: { authorization: auth.authorization } });
  await handler(stream, res);
  assert.equal(res.statusCode, 413);
  assert.equal(blob.calls.put.length, 0);
});

test('PUT leyendo el stream cuando la plataforma no parseó el cuerpo', async () => {
  const { handler } = nuevo();
  const res = fakeRes();
  const stream = Object.assign(Readable.from([Buffer.from(JSON.stringify({ baseRev: 0, state: estado() }))]), { method: 'PUT', url: '/api/estado', headers: { authorization: auth.authorization } });
  await handler(stream, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.json.rev, 1);
});

test('cuerpos inválidos: 400 (JSON roto, baseRev no entero, state sin settings o con listas que no son arrays)', async () => {
  const { call, blob } = nuevo();
  assert.equal((await call({ method: 'PUT', headers: auth, body: '{roto' })).statusCode, 400);
  assert.equal((await put(call, '0', estado())).statusCode, 400);
  assert.equal((await put(call, -1, estado())).statusCode, 400);
  assert.equal((await put(call, 0, null)).statusCode, 400);
  assert.equal((await put(call, 0, { incomes: [] })).statusCode, 400);
  assert.equal((await put(call, 0, estado({ incomes: 'no' }))).statusCode, 400);
  assert.equal(blob.calls.put.length, 0);
});

test('estadoValido y claveCorrecta', () => {
  assert.equal(estadoValido(estado()), true);
  assert.equal(estadoValido({ settings: {} }), true);
  assert.equal(estadoValido([]), false);
  assert.equal(claveCorrecta(`Bearer ${CLAVE}`, CLAVE), true);
  assert.equal(claveCorrecta(`Bearer ${CLAVE}x`, CLAVE), false);
  assert.equal(claveCorrecta(undefined, CLAVE), false);
});

test('GET ?meta=1 devuelve solo rev y fecha', async () => {
  const { call } = nuevo();
  await put(call, 0, estado());
  const r = await call({ url: '/api/estado?meta=1', headers: auth });
  assert.deepEqual(Object.keys(r.json).sort(), ['rev', 'savedAt']);
  assert.equal(r.json.rev, 1);
});

test('una caída del almacenamiento da 502 sin filtrar el mensaje ni la clave', async () => {
  const { call, blob } = nuevo();
  const mudo = console.error;
  const logs = [];
  console.error = (...a) => logs.push(a.join(' '));
  try {
    blob.failNext = { op: 'get', error: new Error(`fallo con ${CLAVE} y token-de-prueba`) };
    const r = await call({ headers: auth });
    assert.equal(r.statusCode, 502);
    assert.ok(!r.texto.includes(CLAVE) && !r.texto.includes('token'));
    assert.ok(!logs.join('\n').includes(CLAVE) && !logs.join('\n').includes('token-de-prueba'));
  } finally { console.error = mudo; }
});

test('un fallo de escritura que no es un conflicto da 502', async () => {
  const { call, blob } = nuevo();
  const mudo = console.error;
  console.error = () => {};
  try {
    blob.failNext = { op: 'put', error: new Error('red caída') };
    const r = await put(call, 0, estado());
    assert.equal(r.statusCode, 502);
  } finally { console.error = mudo; }
});

test('un documento guardado roto da 502 y no se pisa', async () => {
  const { call, blob } = nuevo();
  blob.files.set(BLOB_PATH, { body: 'no es json', etag: '"x"' });
  const mudo = console.error;
  console.error = () => {};
  try {
    assert.equal((await call({ headers: auth })).statusCode, 502);
    assert.equal((await put(call, 0, estado())).statusCode, 502);
    assert.equal(blob.files.get(BLOB_PATH).body, 'no es json');
  } finally { console.error = mudo; }
});
