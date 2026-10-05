// charts.js · gráficos propios, sin librerías. Reglas comunes (spec 7):
//  - role="img" + aria-label con el resumen en palabras, y una tabla equivalente bajo "Ver los números".
//  - Los SVG usan viewBox = ancho REAL medido del contenedor: el texto de 1rem es 1rem, nunca se escala.
//  - Texto en --ink / --ink-2, nunca en el color de la serie. Etiquetas directas sobre el dato.
//  - Estimado = trazo o borde punteado. Estado = color + palabra/forma. Zonas táctiles >= 44px.
//  - Animación de entrada 420ms con retardo escalonado de 50ms (sin movimiento con prefers-reduced-motion).
// Gráficos: monthStrip (tira del hero), monthRows (lista de Meses con barras divergentes), debtLine (línea de la
// deuda, SVG), timeline (liberaciones, tipo Gantt), stacked (barra apilada de quién debe qué).

import { h, icon, fmt, remPx, srMoney, statusInfo, toneOf } from './dom.js';
import { amt, disclosure, dataTable, divergingBar, divergingScale, chip, pips, statusGlyph } from './components.js';

const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MES_LARGO = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const keyParts = (k) => k.split('-').map(Number);
const monthIdx = (k) => { const [y, m] = keyParts(k); return y * 12 + (m - 1); };
const shortLabel = (k, withYear) => { const [y, m] = keyParts(k); return MES[m - 1] + (withYear ? ` ${String(y).slice(2)}` : ''); };
export const longMonth = (k) => { const [y, m] = keyParts(k); return `${MES_LARGO[m - 1]} ${y}`; };

// ===================================================================== 1) tira de meses (hero)
/**
 * Tira de meses. HTML+CSS: cada columna es un <button> (>= 48px de alto táctil).
 * items: [{ key:'2026-10', label:'Oct', value:105948, state:'bien'|'justo'|'cubierto'|'falta', current:true, estimated:false,
 *           onClick, ariaLabel }]
 * opts: { showValues: items.length <= 6, onHero: true, barWidth: 34 (28 si hay más de 6), ariaLabel }
 * Escala común k = min(36/maxPositivo, 20/maxNegativo); alto = max(6, |v|*k). Color por estado.
 */
export function monthStrip(items, { showValues, onHero = true, barWidth, ariaLabel = 'Los próximos meses' } = {}) {
  const n = items.length;
  const vals = showValues ?? n <= 6;
  const bw = barWidth ?? (n > 6 ? 28 : 34);
  const maxPos = Math.max(0, ...items.map((i) => i.value).filter((v) => v > 0));
  const maxNeg = Math.max(0, ...items.map((i) => Math.abs(Math.min(0, i.value))));
  const k = Math.min(maxPos ? 36 / maxPos : Infinity, maxNeg ? 20 / maxNeg : Infinity);
  const kk = Number.isFinite(k) ? k : 0;
  return h('div', { class: ['mstrip', onHero ? 'on-hero' : 'on-card', n > 6 && 'dense'], style: { '--n': n, '--bw': `${bw}px` }, role: 'group', 'aria-label': ariaLabel },
    items.map((it, i) => {
      const s = statusInfo(it.state);
      const hgt = Math.max(6, Math.abs(it.value) * kk);
      const bar = h('span', {
        class: ['mbar', `mbar-${s.tone}`, it.estimated && 'dashed'],
        style: it.value >= 0 ? { bottom: '20px', height: `${hgt}px`, '--i': i } : { top: '36px', height: `${hgt}px`, '--i': i },
      });
      const label = it.ariaLabel || `${it.name || it.label}: ${it.value >= 0 ? 'sobran' : 'faltan'} ${srMoney(Math.abs(it.value)).replace('menos ', '')}, ${s.label}`;
      const attrs = { class: ['mcol', it.current && 'now'], type: 'button', 'aria-label': label, 'aria-current': it.current ? 'date' : null, onclick: it.onClick };
      return h(it.onClick ? 'button' : 'div', it.onClick ? attrs : { class: attrs.class, 'aria-label': label, role: 'img' },
        h('span', { class: 'mplot', 'aria-hidden': 'true' }, h('span', { class: 'mbase' }), bar),
        vals ? h('span', { class: ['mval', `tone-on-${s.tone}`], 'aria-hidden': 'true' }, h('span', { class: 'amt' }, h('span', { class: 'amt-v' }, fmt.compact(it.value)))) : null,
        h('span', { class: 'mname', 'aria-hidden': 'true' }, it.label, it.current ? h('span', { class: 'mnow' }) : null));
    }));
}

// ===================================================================== 2) filas de Meses con barras divergentes
/**
 * Lista de meses con barra divergente (cero al 25%, escala común, mínimo 8px; estimados con borde punteado).
 * items: [{ key, name:'Octubre', short:'Oct', value, state, estimated, event:'Movilidad: 21 días (feriado del 12)', eventIcon:'bandera', onClick, selected }]
 * mode: '4' (filas de 96px: mes, chip de estado, número 28px, barra, evento) | '12' (filas de 56px: nombre, barra, número, ícono de evento)
 * Devuelve un <div class="card rows"> con role="list".
 */
export function monthRows(items, { mode = '4', ariaLabel = 'Los próximos meses' } = {}) {
  const max = divergingScale(items.map((i) => i.value));
  const rows = items.map((it) => {
    const s = statusInfo(it.state);
    const common = {
      class: ['mrow', `mrow-${mode}`, it.selected && 'selected'], type: 'button', role: 'listitem', onclick: it.onClick,
      'aria-label': `${it.name || it.short}: ${it.value >= 0 ? 'te sobran' : 'te faltan'} ${srMoney(Math.abs(it.value)).replace('menos ', '')}, ${s.label}${it.event ? '. ' + it.event : ''}`,
      'aria-current': it.selected ? 'true' : null,
    };
    const bar = divergingBar({ value: it.value, max, tone: s.tone, estimated: it.estimated });
    const money = h('span', { class: ['mrow-val', `tone-${s.tone}`], 'aria-hidden': 'true' }, amt(it.value));
    const kids = mode === '12'
      ? [h('span', { class: 'mrow-name', 'aria-hidden': 'true' }, it.short || it.name), bar, money,
         h('span', { class: 'mrow-ev', 'aria-hidden': 'true', title: it.event || null }, it.event ? icon(it.eventIcon || 'destello', { size: 'sm' }) : null)]
      : [h('span', { class: 'mrow-head', 'aria-hidden': 'true' }, h('span', { class: 'mrow-name t-h2' }, it.name), chip(s.label, { tone: s.tone, icon: s.shape })),
         h('span', { class: 'mrow-main', 'aria-hidden': 'true' }, h('span', { class: ['mrow-num', `tone-${s.tone}`] }, amt(it.value)), bar),
         it.event ? h('span', { class: 'mrow-event', 'aria-hidden': 'true' }, it.event) : null];
    return it.onClick ? h('button', common, kids) : h('div', { class: common.class, role: 'listitem', 'aria-label': common['aria-label'] }, kids);
  });
  return h('div', { class: ['card rows mrows'], role: 'list', 'aria-label': ariaLabel }, rows);
}

// ===================================================================== 3) línea de deuda (SVG, ancho medido)
/**
 * Línea de la deuda mes a mes. Texto de 1rem real (viewBox = ancho medido). Plan sólido de 4px; comparación punteada gris.
 * debtLine({
 *   series: [
 *     { name:'Tu plan', points:[{key:'2026-10', value:1800000}, ...], style:'solid', endLabel:'abril 2027' },
 *     { name:'Solo el mínimo', points:[...], style:'dashed', endLabel:'junio 2027' },
 *   ],
 *   height: 160, ariaLabel:'La deuda de la tarjeta baja de $1.800.000 a cero en abril 2027...',
 *   tableCaption:'Deuda de la tarjeta mes a mes',
 * })
 * Devuelve <div class="chart"> con el SVG y el desplegable "Ver los números".
 */
export function debtLine({ series, height = 160, ariaLabel, tableCaption = 'Deuda mes a mes', showTable = true } = {}) {
  const host = h('div', { class: 'chart chart-line' });
  const box = h('div', { class: 'chart-box' });
  host.appendChild(box);
  let firstDraw = true;
  let lastW = 0;

  // eje de meses común
  const keys = [...new Set(series.flatMap((s) => s.points.map((p) => p.key)))].sort();
  const idx = new Map(keys.map((k, i) => [k, i]));

  function draw() {
    const W = Math.max(240, Math.round(box.clientWidth || 358));
    lastW = W;
    const fs = remPx();                       // 1rem en px (respeta el tamaño de letra elegido)
    const H = Math.round(height + (fs - 16) * 2);
    const padL = 6; const padR = 12; const padT = Math.round(fs * 1.9); const padB = Math.round(fs * 1.9);
    const iw = W - padL - padR; const ih = H - padT - padB;
    const maxV = Math.max(1, ...series.flatMap((s) => s.points.map((p) => p.value)));
    const X = (k) => padL + (keys.length > 1 ? (idx.get(k) / (keys.length - 1)) * iw : 0);
    const Y = (v) => padT + ih - (v / maxV) * ih;
    const els = [];
    // base y línea de cero
    els.push(h('line', { x1: padL, y1: padT + ih, x2: W - padR, y2: padT + ih, class: 'chart-axis' }));
    // etiqueta del máximo (arriba a la izquierda) y del cero
    els.push(h('text', { x: padL, y: fs * 0.95, class: 'chart-txt chart-txt-2' }, fmt.compact(maxV)));
    // etiquetas del eje x: hasta 4, repartidas sin pisarse
    const nl = Math.min(4, keys.length);
    const picks = [];
    for (let i = 0; i < nl; i++) picks.push(Math.round((i * (keys.length - 1)) / Math.max(1, nl - 1)));
    [...new Set(picks)].forEach((i, j, arr) => {
      const k = keys[i];
      const withYear = j === 0 || keyParts(k)[1] === 1;
      els.push(h('text', { x: X(k), y: H - fs * 0.35, class: 'chart-txt chart-txt-2', 'text-anchor': j === 0 ? 'start' : j === arr.length - 1 ? 'end' : 'middle' }, shortLabel(k, withYear)));
    });
    // series
    const labelBoxes = [];
    series.forEach((s, si) => {
      const pts = s.points.filter((p) => idx.has(p.key));
      if (!pts.length) return;
      const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.key).toFixed(1)} ${Y(p.value).toFixed(1)}`).join(' ');
      const dashed = s.style === 'dashed';
      els.push(h('path', {
        d, class: ['chart-path', dashed ? 'chart-path-dashed' : 'chart-path-main', firstDraw && 'draw'], pathLength: dashed ? null : '1',
        style: firstDraw ? { '--delay': `${si * 120}ms` } : null,
      }));
      const last = pts[pts.length - 1];
      const lx = X(last.key); const ly = Y(last.value);
      els.push(h('circle', { cx: lx, cy: ly, r: dashed ? 5 : 6, class: dashed ? 'chart-dot-hollow' : 'chart-dot' }));
      if (s.endLabel) {
        const text = s.endLabel;
        const wEst = text.length * fs * 0.58;
        let anchor = 'end'; let tx = lx + 4;
        if (lx - wEst < padL) { anchor = 'start'; tx = lx - 4; }
        const box = { y: ly - fs * 0.8, x1: anchor === 'end' ? tx - wEst : tx, x2: anchor === 'end' ? tx : tx + wEst };
        const clash = (a, b2) => a.x1 < b2.x2 && b2.x1 < a.x2 && Math.abs(a.y - b2.y) < fs * 1.15;
        let guard = 0;
        while (labelBoxes.some((b2) => clash(box, b2)) && guard++ < 4) box.y -= fs * 1.25;
        labelBoxes.push(box);
        const ty = Math.max(fs * 0.95, box.y);
        els.push(h('text', { x: tx, y: ty, class: 'chart-txt chart-txt-halo chart-txt-strong', 'text-anchor': anchor }, text));
      }
    });
    const svg = h('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': ariaLabel || 'Gráfico de línea', focusable: 'false' }, els);
    box.replaceChildren(svg);
    firstDraw = false;
  }

  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => {
      if (!host.isConnected) { ro.disconnect(); return; }
      if (Math.abs((box.clientWidth || 0) - lastW) > 1) draw();
    });
    ro.observe(box);
  }
  requestAnimationFrame(draw);

  if (showTable) {
    const names = series.map((s) => s.name);
    const rows = keys.map((k) => [longMonth(k), ...series.map((s) => { const p = s.points.find((q) => q.key === k); return p ? amt(p.value) : '—'; })]);
    host.appendChild(disclosure({ summary: 'Ver los números', content: dataTable({ caption: tableCaption, head: ['Mes', ...names], rows }) }));
  }
  return host;
}

// ===================================================================== 4) línea de tiempo de liberaciones (Gantt)
/**
 * Línea de tiempo con eje común. HTML+CSS (posiciones en %): cada fila es un botón de 96px.
 * timeline({
 *   from:'2026-10', to:'2029-03', todayKey:'2026-10',
 *   items:[{ id, label:'Tarjeta Visa Gold', sub:'Debés $1.800.000', start:'2026-10', end:'2027-04', dateLabel:'abril 2027',
 *            tone:'brand'|'info', pending:false, pipsInfo:{ total:36, paid:26 }, onClick, ariaLabel }]
 * })
 * Marcas del eje: cada 1 de enero dentro del rango (2027, 2028...) + "Hoy". Si pending:true la barra es punteada azul ("a completar").
 */
export function timeline({ items, from, to, todayKey, ariaLabel = 'Cuándo se termina cada deuda' }) {
  const span = Math.max(1, monthIdx(to) - monthIdx(from));
  const pct = (k) => Math.max(0, Math.min(100, ((monthIdx(k) - monthIdx(from)) / span) * 100));
  const ticks = [];
  for (let m = monthIdx(from) + 1; m <= monthIdx(to); m++) {
    if (m % 12 === 0) ticks.push({ year: Math.floor(m / 12), left: ((m - monthIdx(from)) / span) * 100 });
  }
  const todayLeft = pct(todayKey || from);
  const axis = h('div', { class: 'tl-axis', 'aria-hidden': 'true' },
    h('span', { class: 'tl-now-lbl', style: { left: `${todayLeft}%` } }, 'Hoy'),
    ticks.map((t) => h('span', { class: 'tl-tick-lbl', style: { left: `${t.left}%` } }, String(t.year))));
  const rows = items.map((it, i) => {
    const startP = it.start ? pct(it.start) : todayLeft;
    const endP = it.pending ? Math.min(100, startP + 22) : Math.max(pct(it.end) , startP + 2);
    const track = h('span', { class: 'tl-track', 'aria-hidden': 'true' },
      ticks.map((t) => h('span', { class: 'tl-grid', style: { left: `${t.left}%` } })),
      h('span', { class: ['tl-fill', `tl-${toneOf(it.tone || (it.pending ? 'info' : 'brand'))}`, it.pending && 'dashed'], style: { left: `${startP}%`, width: `${Math.max(1.5, endP - startP)}%`, '--i': i } }));
    const kids = [
      h('span', { class: 'tl-top' }, h('span', { class: 'tl-label' }, it.label), h('span', { class: ['tl-date', it.pending && 'tone-info'] }, it.pending ? 'a completar' : it.dateLabel)),
      track,
      h('span', { class: 'tl-bottom' }, h('span', { class: 'tl-sub' }, it.sub), it.pipsInfo ? pips({ total: it.pipsInfo.total, paid: it.pipsInfo.paid }) : null),
    ];
    const label = it.ariaLabel || `${it.label}. ${it.sub || ''}. ${it.pending ? 'Falta completar datos' : 'Termina en ' + it.dateLabel}`;
    return it.onClick
      ? h('button', { class: 'tl-row', type: 'button', role: 'listitem', 'aria-label': label, onclick: it.onClick }, kids)
      : h('div', { class: 'tl-row', role: 'listitem', 'aria-label': label }, kids);
  });
  const nowLine = h('span', { class: 'tl-now', style: { left: `${todayLeft}%` }, 'aria-hidden': 'true' });
  return h('div', { class: 'card timeline', role: 'list', 'aria-label': ariaLabel },
    h('div', { class: 'tl-head' }, axis),
    h('div', { class: 'tl-body', style: { '--today': `${todayLeft}%` } }, nowLine, rows));
}

// ===================================================================== 5) barra apilada "quién debe qué"
/**
 * Barra apilada con etiquetas directas. stacked({ parts:[{label:'Hijo', value:400000, tone:'info', nameIndex:3}, {label:'Resto', value:1400000, tone:'brand'}], ariaLabel })
 * Cada parte lleva etiqueta con nombre + monto debajo (nunca solo color). Los nombres pasan por privacidad si part.person:true.
 */
export function stacked({ parts, ariaLabel, cls }) {
  const total = parts.reduce((a, p) => a + Math.max(0, p.value), 0) || 1;
  const segs = parts.filter((p) => p.value > 0);
  return h('div', { class: ['stackbar', cls], role: 'img', 'aria-label': ariaLabel || segs.map((p) => `${p.label}: ${srMoney(p.value)}`).join('. ') },
    h('div', { class: 'stackbar-track', 'aria-hidden': 'true' },
      segs.map((p, i) => h('span', { class: ['stackbar-seg', `stackbar-${toneOf(p.tone || 'brand')}`], style: { flexGrow: String(p.value / total), '--i': i } }))),
    h('div', { class: 'stackbar-legend', 'aria-hidden': 'true' },
      segs.map((p) => h('span', { class: 'stackbar-item' },
        h('span', { class: ['stackbar-key', `stackbar-${toneOf(p.tone || 'brand')}`] }),
        h('span', { class: 'stackbar-name' }, p.labelNode || p.label), h('span', { class: 'stackbar-amt' }, amt(p.value))))));
}

export { statusGlyph };
