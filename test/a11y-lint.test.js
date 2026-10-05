// Lint de accesibilidad y de reglas duras del repo (se corre con npm test):
//  - nada de font-size menor a 1rem (16px) en styles/*.css, en src/ui/**/*.js ni en atributos SVG
//  - sin emojis, sin colores sueltos, sin confirm()/alert()/prompt(), sin <input type="number"> ni step restrictivo
//  - sin las palabras prohibidas en textos visibles
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const rel = (f) => relative(ROOT, f);
function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
const read = (f) => readFileSync(f, 'utf8');
const stripCssComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
const stripJsComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

const cssFiles = readdirSync(join(ROOT, 'styles')).filter((f) => f.endsWith('.css')).map((f) => join(ROOT, 'styles', f));
const uiFiles = walk(join(ROOT, 'src/ui')).filter((f) => f.endsWith('.js'));
const jsFiles = [...uiFiles, join(ROOT, 'src/app.js'), ...walk(join(ROOT, 'dev')).filter((f) => f.endsWith('.js'))];
const visibleFiles = [...jsFiles, join(ROOT, 'index.html'), join(ROOT, 'dev/kit.html'), ...cssFiles];

// ---------------------------------------------------------------- font-size
const tokens = {};
for (const m of read(join(ROOT, 'styles/tokens.css')).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) tokens[m[1]] = m[2].trim();

/** Menor tamaño posible, en px, de un valor de font-size (1rem = 16px). null si no se puede saber (heredado). */
function minPx(value, depth = 0) {
  const v = value.trim().replace(/\s*!important$/, '');
  let m = v.match(/^var\((--[\w-]+)\s*(?:,[^)]*)?\)$/);
  if (m) return depth < 5 && tokens[m[1]] ? minPx(tokens[m[1]], depth + 1) : null;
  m = v.match(/^clamp\((.+)\)$/);
  if (m) { const a = splitArgs(m[1]); return minPx(a[0], depth + 1); }
  m = v.match(/^(?:min|max)\((.+)\)$/);
  if (m) { const all = splitArgs(m[1]).map((x) => minPx(x, depth + 1)).filter((x) => x != null); return all.length ? Math.min(...all) : null; }
  m = v.match(/^([\d.]+)(px|rem|em|pt|%)$/);
  if (m) {
    const n = parseFloat(m[1]);
    if (m[2] === 'px') return n;
    if (m[2] === 'rem') return n * 16;
    if (m[2] === 'pt') return (n * 96) / 72;
    return n / (m[2] === '%' ? 100 : 1) * 16; // em y % relativos al texto del padre: se mide contra 1em = 16px
  }
  if (/^(xx-small|x-small|small|smaller)$/.test(v)) return 10;
  return null; // inherit, calc(...) con variables, etc.
}
function splitArgs(s) {
  const out = []; let depth = 0; let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}

test('ningún font-size en styles/*.css baja de 1rem (16px)', () => {
  const bad = [];
  for (const f of cssFiles) {
    const text = stripCssComments(read(f));
    for (const m of text.matchAll(/(?<![\w-])font-size\s*:\s*([^;}]+)/g)) {
      const px = minPx(m[1]);
      if (px != null && px < 16 - 1e-9) bad.push(`${rel(f)}: font-size: ${m[1].trim()} (${px}px)`);
    }
    // atajo font: [peso] tamaño/interlínea familia
    for (const m of text.matchAll(/(?<![\w-])font\s*:\s*([^;}]+)/g)) {
      const sz = m[1].match(/(?:^|\s)((?:var\([^)]+\))|[\d.]+(?:px|rem|em|%))\s*\//);
      if (sz) { const px = minPx(sz[1]); if (px != null && px < 16 - 1e-9) bad.push(`${rel(f)}: font: ${m[1].trim()} (${px}px)`); }
    }
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('ningún font-size en src/ui/**/*.js ni en atributos SVG baja de 1rem (16px)', () => {
  const bad = [];
  for (const f of jsFiles) {
    const text = stripJsComments(read(f));
    const patterns = [
      /font-size\s*[:=]\s*["']?\s*([\d.]+(?:px|rem|em|pt|%))/g,          // style="font-size: 12px" · font-size="12px" · 'font-size': '12px'
      /fontSize\s*[:=]\s*["'`]\s*([\d.]+(?:px|rem|em|pt|%))/g,            // style.fontSize = '12px' · { fontSize: '0.8rem' }
      /font-size\s*[:=]\s*["']?\s*(\d+(?:\.\d+)?)\s*(?=["'\s;}>])/g,    // font-size="12" (SVG sin unidad: px)
    ];
    for (const re of patterns) {
      for (const m of text.matchAll(re)) {
        const v = /^[\d.]+$/.test(m[1]) ? `${m[1]}px` : m[1];
        const px = minPx(v);
        if (px != null && px < 16 - 1e-9) bad.push(`${rel(f)}: ${m[0].trim()}`);
      }
    }
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('el piso de tamaño (--t-small) es 1rem', () => {
  assert.equal(minPx(tokens['--t-small']), 16);
  for (const [k, v] of Object.entries(tokens)) if (/^--t-/.test(k)) assert.ok(minPx(v) >= 16, `${k}: ${v}`);
});

// ---------------------------------------------------------------- reglas duras
const stripAll = (f) => (f.endsWith('.css') ? stripCssComments(read(f)) : f.endsWith('.js') ? stripJsComments(read(f)) : read(f).replace(/<!--[\s\S]*?-->/g, ''));

test('no hay emojis en la interfaz (solo íconos del sprite)', () => {
  const bad = [];
  for (const f of visibleFiles) {
    const m = stripAll(f).match(/\p{Extended_Pictographic}/gu);
    if (m) bad.push(`${rel(f)}: ${[...new Set(m)].join(' ')}`);
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('no se usan confirm(), alert() ni prompt() (se usa sheet.confirm)', () => {
  const bad = [];
  for (const f of jsFiles) {
    const text = stripJsComments(read(f));
    for (const m of text.matchAll(/(?<![.\w$])(alert|prompt)\s*\(|window\.(alert|confirm|prompt)\s*\(|(?<![.\w$])(?<!function )confirm\s*\(/g)) bad.push(`${rel(f)}: ${m[0]}`);
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('los campos numéricos no usan type="number" ni step restrictivo (inputmode decimal/numeric)', () => {
  const bad = [];
  for (const f of [...uiFiles, join(ROOT, 'src/app.js')]) {
    const text = stripJsComments(read(f));
    for (const m of text.matchAll(/type\s*[:=]\s*["']number["']|<input[^>]*\bstep\s*=|['"]step['"]\s*:\s*[\d'"]/g)) bad.push(`${rel(f)}: ${m[0]}`);
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

const BANNED = [
  [/colch[oó]n/i, 'colchón'], [/pl[aá]stico/i, 'plástico'], [/financiaci[oó]n/i, 'financiación'], [/\bmoroso/i, 'moroso'],
  [/liber[aá]s/i, 'liberás (decir "queda libre")'], [/5 minutos/i, '5 minutos'], [/\$5\.744 por d[ií]a/i, '$5.744 por día'],
  [/\bJusto\b(?!\s*[,.]?\s*(?:lo cubre))/, '"Justo" (decir "Ajustado")'],
];
test('textos visibles sin palabras prohibidas', () => {
  const bad = [];
  for (const f of [...jsFiles, join(ROOT, 'index.html'), join(ROOT, 'manifest.json')]) {
    if (!existsSync(f)) continue;
    const text = stripAll(f);
    for (const [re, name] of BANNED) if (re.test(text)) bad.push(`${rel(f)}: ${name}`);
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('index.html: idioma es-AR, viewport sin bloquear el zoom y tema doble', () => {
  const html = read(join(ROOT, 'index.html'));
  assert.match(html, /<html lang="es-AR"/);
  assert.match(html, /name="viewport"[^>]*width=device-width/);
  assert.doesNotMatch(html, /user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?!\d)/);
  assert.equal((html.match(/name="theme-color"/g) || []).length, 2);
});

test('el sprite de íconos define todos los de la lista de la spec', () => {
  const html = read(join(ROOT, 'index.html'));
  const need = ['home', 'calendario', 'ayuda-circulo', 'tarjeta', 'mas-puntos', 'ojo', 'ojo-tachado', 'chevron', 'volver', 'alerta', 'tilde', 'mas', 'bandera', 'banco',
    'documento', 'usuarios', 'destello', 'escudo', 'billetera', 'whatsapp', 'lapiz', 'papelera', 'descargar', 'subir', 'luna', 'llave', 'reloj'];
  const missing = need.filter((n) => !html.includes(`id="i-${n}"`));
  assert.deepEqual(missing, []);
});

test('todos los íconos usados con icon(\'nombre\') existen en el sprite', () => {
  const html = read(join(ROOT, 'index.html'));
  const defined = new Set([...html.matchAll(/<symbol id="i-([\w-]+)"/g)].map((m) => m[1]));
  const used = new Map();
  for (const f of [...jsFiles]) {
    const text = stripJsComments(read(f));
    for (const m of text.matchAll(/\bicon\(\s*['"]([\w-]+)['"]/g)) used.set(m[1], rel(f));
    for (const m of text.matchAll(/\bicon:\s*['"]([\w-]+)['"]/g)) used.set(m[1], rel(f));
    for (const m of text.matchAll(/\bshape:\s*['"]([\w-]+)['"]/g)) used.set(m[1], rel(f));
    for (const m of text.matchAll(/\b(?:eventIcon|iconName)\s*[:=]\s*['"]([\w-]+)['"]/g)) used.set(m[1], rel(f));
  }
  const missing = [...used].filter(([n]) => !defined.has(n)).map(([n, f]) => `${n} (${f})`);
  assert.deepEqual(missing, [], 'íconos sin definir en el sprite: ' + missing.join(', '));
});
