// Contraste WCAG de los pares de color de styles/tokens.css, en claro y en oscuro.
// Texto >= 4,5 · bordes de campo y marcas gráficas >= 3. Además verifica que los dos bloques oscuros
// (automático y forzado) estén sincronizados y que nadie use colores literales fuera de tokens.css.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(ROOT, 'styles/tokens.css'), 'utf8');

// ---------------------------------------------------------------- lectura de tokens
function declarations(block) {
  const out = {};
  for (const m of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
function blockAfter(marker) {
  const i = css.indexOf(marker);
  assert.ok(i >= 0, `no encontré ${marker} en tokens.css`);
  const open = css.indexOf('{', i);
  let depth = 0;
  for (let j = open; j < css.length; j++) {
    if (css[j] === '{') depth++;
    else if (css[j] === '}' && --depth === 0) return css.slice(open + 1, j);
  }
  throw new Error('bloque sin cerrar: ' + marker);
}
const lightRaw = declarations(blockAfter(':root {'));
const darkAutoRaw = declarations(blockAfter(':root:not([data-theme="light"])'));
const darkForcedRaw = declarations(blockAfter(':root[data-theme="dark"]'));

function resolve(map, name, seen = new Set()) {
  let v = map[name];
  if (v == null) return null;
  const ref = v.match(/^var\((--[\w-]+)\)$/);
  if (ref) {
    assert.ok(!seen.has(ref[1]), 'referencia circular');
    seen.add(ref[1]);
    return resolve(map, ref[1], seen);
  }
  return v;
}
const light = { ...lightRaw };
const dark = { ...lightRaw, ...darkForcedRaw };

// ---------------------------------------------------------------- color
function parseColor(str) {
  const s = str.trim();
  let m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (m) {
    let h = m[1];
    if (h.length === 3) h = [...h].map((c) => c + c).join('');
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
  }
  m = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] == null ? 1 : +m[4] };
  throw new Error('color no soportado: ' + str);
}
const blend = (fg, bg) => ({
  r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1,
});
const lin = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
export function contrast(a, b) {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
function color(theme, name, over) {
  const map = theme === 'light' ? light : dark;
  const raw = resolve(map, `--${name}`);
  assert.ok(raw, `falta el token ${name} en ${theme}`);
  const c = parseColor(raw);
  return over && c.a < 1 ? blend(c, over) : c;
}

test('la función de contraste da los valores de referencia de WCAG', () => {
  const w = parseColor('#fff'); const k = parseColor('#000');
  assert.ok(Math.abs(contrast(w, k) - 21) < 0.01);
  assert.ok(Math.abs(contrast(w, w) - 1) < 0.001);
});

test('los dos bloques oscuros (automático y forzado) están sincronizados', () => {
  const a = { ...darkAutoRaw }; const f = { ...darkForcedRaw };
  assert.deepEqual(Object.keys(a).sort(), Object.keys(f).sort(), 'mismas variables en ambos bloques');
  for (const k of Object.keys(a)) assert.equal(a[k], f[k], `${k} difiere entre el oscuro automático y el forzado`);
});

// ---------------------------------------------------------------- pares de texto (>= 4,5)
// [token texto, token fondo, descripción]
const TEXT_PAIRS = [
  ['ink', 'bg', 'texto principal sobre el fondo'],
  ['ink', 'surface', 'texto principal sobre tarjeta'],
  ['ink', 'surface-2', 'texto principal sobre superficie 2 (segmentado, pastillas)'],
  ['ink-2', 'bg', 'texto secundario sobre el fondo'],
  ['ink-2', 'surface', 'texto secundario sobre tarjeta'],
  ['ink-2', 'surface-2', 'texto secundario sobre superficie 2'],
  ['ink-3', 'bg', 'texto terciario sobre el fondo'],
  ['ink-3', 'surface', 'texto terciario sobre tarjeta'],
  ['btn-fg', 'btn-bg', 'botón primario'],
  ['brand', 'bg', 'enlaces y acciones sobre el fondo'],
  ['brand', 'surface', 'enlaces y acciones sobre tarjeta'],
  ['brand', 'brand-soft', 'destino activo de la barra inferior'],
  ['ok-fg', 'ok-bg', 'estado alcanza'], ['warn-fg', 'warn-bg', 'estado ajustado'],
  ['bad-fg', 'bad-bg', 'estado falta'], ['info-fg', 'info-bg', 'estimado / falta un dato'],
  ['ok-fg', 'surface', 'estado alcanza sobre tarjeta'], ['warn-fg', 'surface', 'estado ajustado sobre tarjeta'],
  ['bad-fg', 'surface', 'estado falta sobre tarjeta'], ['info-fg', 'surface', 'azul sobre tarjeta'],
  ['ok-fg', 'bg', 'estado alcanza sobre el fondo'], ['warn-fg', 'bg', 'ajustado sobre el fondo'], ['bad-fg', 'bg', 'falta sobre el fondo'],
  ['warn-bg', 'warn-fg', 'botón de la cinta de ejemplo (texto claro sobre ámbar oscuro)'],
  ['hero-ink', 'hero-bg', 'texto del hero'], ['hero-ink-2', 'hero-bg', 'texto secundario del hero'],
  ['hero-ink', 'hero-glow', 'texto del hero sobre el brillo'], ['hero-ink-2', 'hero-glow', 'texto secundario del hero sobre el brillo'],
  ['on-hero-ok', 'hero-bg', 'verde sobre el hero'], ['on-hero-warn', 'hero-bg', 'ámbar sobre el hero'], ['on-hero-bad', 'hero-bg', 'terracota sobre el hero'],
  // on-hero-ok/warn/bad solo se dibujan en la tira de meses (abajo del hero), lejos del brillo de la esquina: se miden contra hero-bg.
  ['chip-ok-fg', 'chip-ok-bg', 'chip alcanza del hero'], ['chip-warn-fg', 'chip-warn-bg', 'chip ajustado del hero'], ['chip-bad-fg', 'chip-bad-bg', 'chip falta del hero'],
  ['toast-fg', 'toast-bg', 'texto del toast'], ['toast-link', 'toast-bg', 'acción del toast'],
];
for (const theme of ['light', 'dark']) {
  for (const [fg, bg, why] of TEXT_PAIRS) {
    test(`contraste ${theme}: ${fg} sobre ${bg} >= 4,5 (${why})`, () => {
      const b = color(theme, bg);
      const f = color(theme, fg, b);
      const r = contrast(f, b);
      assert.ok(r >= 4.5, `${fg} sobre ${bg} en ${theme}: ${r.toFixed(2)} (mínimo 4,5)`);
    });
  }
  test(`contraste ${theme}: texto del hero sobre las fichas translúcidas >= 4,5`, () => {
    const base = color(theme, 'hero-bg');
    const tile = color(theme, 'hero-tile', base);
    for (const name of ['hero-ink', 'hero-ink-2']) {
      const r = contrast(color(theme, name), tile);
      assert.ok(r >= 4.5, `${name} sobre hero-tile en ${theme}: ${r.toFixed(2)}`);
    }
  });
}

// ---------------------------------------------------------------- bordes y marcas gráficas (>= 3)
const GRAPHIC_PAIRS = [
  ['field-border', 'surface', 'borde de campo sobre tarjeta'],
  ['field-border', 'bg', 'borde de campo sobre el fondo'],
  ['focus', 'bg', 'anillo de foco sobre el fondo'], ['focus', 'surface', 'anillo de foco sobre tarjeta'],
  ['ok-bar', 'surface', 'barra verde'], ['warn-bar', 'surface', 'barra ámbar'], ['bad-bar', 'surface', 'barra terracota'],
  ['info-fg', 'surface', 'barra azul / borde punteado'],
  ['on-hero-ok', 'hero-bg', 'barra verde del hero'], ['on-hero-warn', 'hero-bg', 'barra ámbar del hero'], ['on-hero-bad', 'hero-bg', 'barra terracota del hero'],
];
for (const theme of ['light', 'dark']) {
  for (const [fg, bg, why] of GRAPHIC_PAIRS) {
    test(`contraste ${theme}: ${fg} sobre ${bg} >= 3 (${why})`, () => {
      const b = color(theme, bg);
      const r = contrast(color(theme, fg, b), b);
      assert.ok(r >= 3, `${fg} sobre ${bg} en ${theme}: ${r.toFixed(2)} (mínimo 3)`);
    });
  }
}

// ---------------------------------------------------------------- nada de colores literales fuera de tokens.css
function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
test('no hay colores literales (hex, rgb, hsl) fuera de tokens.css', () => {
  const files = [...readdirSync(join(ROOT, 'styles')).filter((f) => f.endsWith('.css') && f !== 'tokens.css').map((f) => join(ROOT, 'styles', f)),
    ...walk(join(ROOT, 'src/ui')).filter((f) => f.endsWith('.js')), join(ROOT, 'src/app.js')];
  const bad = [];
  for (const f of files) {
    const text = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const m of text.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![\w-])|\brgba?\(|\bhsla?\(/g)) {
      // '#abc' dentro de una ruta (#/hoy) no es color; los hashes de la app empiezan con '#/'
      bad.push(`${f.replace(ROOT + '/', '')}: ${m[0]}`);
    }
  }
  assert.deepEqual(bad, [], 'colores literales: ' + bad.join(', '));
});
