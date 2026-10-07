// Integración: el service worker precachea TODOS los módulos de src/ (si falta uno, sin internet esa pantalla no abre).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';

const raiz = new URL('../', import.meta.url);
const sw = readFileSync(new URL('sw.js', raiz), 'utf8');
const listados = new Set([...sw.matchAll(/'([^']+\.(?:js|css|html|json|woff2|png|svg))'/g)].map((m) => m[1]));

function archivos(dir) {
  return readdirSync(new URL(dir + '/', raiz)).flatMap((n) => {
    const rel = `${dir}/${n}`;
    return statSync(new URL(rel, raiz)).isDirectory() ? archivos(rel) : [rel];
  });
}

test('sw.js precachea cada archivo .js de src/', () => {
  const faltan = archivos('src').filter((f) => f.endsWith('.js') && !listados.has(f));
  assert.deepEqual(faltan, [], `sw.js no precachea: ${faltan.join(', ')}`);
});

test('sw.js no lista archivos que no existen', () => {
  const sobran = [...listados].filter((f) => f !== './' && !existsSync(new URL(f, raiz)));
  assert.deepEqual(sobran, []);
});
