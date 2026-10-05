// meses.js · LOS PRÓXIMOS MESES (spec 6.4): lo que sobra cada mes, en 4 o en 12 meses, y el detalle de cada mes.
// El detalle vive en la URL (#/meses/2026-12): en el celular es una hoja (sheet.openRoute) con botones para ir al mes
// anterior y al siguiente; en escritorio es un panel pegajoso a la derecha de la lista.
// Tocar una línea del detalle abre el editor de ese ingreso, gasto o cuota (src/ui/editors.js, lo escribe S4).

import { monthKeyOf } from '../../format.js';
import * as L from './_hoy-logic.js';
import { abrirEditor, abrirMesDificil, filasPendientes } from './_hoy-sheets.js';

const ANCHO = '(min-width: 1024px)';
const CLAVE_HOJA = 'mes-detalle';

// Mes que se está mirando en la hoja (cambia con los botones < >). La ruta conserva el mes con el que se abrió;
// así, si el estado cambia y la pantalla se vuelve a montar, la hoja sigue en el mes que la persona eligió.
let mesEnHoja = null;
let claveDeRutaVista = null;

export default {
  id: 'meses',
  title: 'Los próximos meses',

  mount(root, ctx, params) {
    const { ui, charts } = ctx;
    const { h } = ui;
    const D = ctx.derive;
    const F = ctx.format;
    const t = ctx.today();
    const state = ctx.state;
    const hoyKey = monthKeyOf(t);
    const mq = matchMedia(ANCHO);
    const ancho = mq.matches;
    const alCambiarAncho = () => ctx.rerender();
    mq.addEventListener?.('change', alCambiarAncho);
    const limpiar = () => mq.removeEventListener?.('change', alCambiarAncho);
    const ir = (hash) => () => ctx.nav(hash);

    ctx.header({});   // el título "Los próximos meses" lo lleva la página
    const titulo = ui.pageTitle('Los próximos meses', 'Lo que te sobra cada mes, después de pagar todo.');

    const M = L.filasMeses(D, state, t, 12);
    if (!M.hayIngresos) {
      root.append(titulo, ui.empty({
        title: 'Para ver tus meses necesito saber cuánto entra', art: 'barras',
        action: { label: 'Cargar mis ingresos', onClick: ir('#/armar/2') },
      }));
      return limpiar;
    }

    // ------------------------------------------------------------------ qué mes se está mirando
    const claveRuta = params?.key || null;
    const claveValida = claveRuta && L.vecinosDeMes(claveRuta, hoyKey).valido ? claveRuta : null;
    if (claveRuta && !claveValida) { ctx.nav('#/meses', { replace: true }); return limpiar; }
    if (claveValida !== claveDeRutaVista) { claveDeRutaVista = claveValida; mesEnHoja = claveValida; }
    const seleccionado = ancho ? (claveValida || M.items[0].key) : null;

    // ------------------------------------------------------------------ detalle de un mes (hoja o panel)
    const abrirLinea = async (linea, key) => {
      const dest = L.destinoDeLinea(linea, ctx.state);
      if (!dest) return;
      if (dest.tipo === 'editor') { await abrirEditor(ctx, dest.kind, dest.id, { mes: key }); return; }
      if (dest.tipo === 'nav') { ctx.nav(dest.hash); return; }
      ctx.sheet.open({
        title: '¿Cuál querés ver?',
        render: (body, close) => body.append(ui.rowList(dest.items.map((it) => ui.row({
          title: it.nombre, value: ui.amt(it.monto),
          onClick: async () => { await abrirEditor(ctx, 'installment', it.id, { mes: key }); close(); },
        })))),
      });
    };

    const bloqueLineas = (titulo, lineas, total, rotuloTotal, key) => {
      const lista = ui.rowList(lineas.map((l) => ui.row({
        title: l.nombre, sub: l.detalle || undefined, value: ui.amt(l.monto),
        chip: l.estimado ? { label: 'estimado', tone: 'info' } : undefined,
        onClick: () => abrirLinea(l, key),
        ariaLabel: `${l.nombre}${l.detalle ? ', ' + l.detalle : ''}: ${ui.srMoney(l.monto)}${l.estimado ? ', estimado' : ''}. Tocá para editarlo.`,
      })));
      lista.append(h('div', { role: 'listitem', class: 'between', style: { padding: '14px 16px', borderTop: '1px solid var(--line)', background: 'var(--surface-2)' } },
        h('span', { class: 't-row' }, rotuloTotal), h('span', { class: 't-row' }, ui.amt(total))));
      return h('div', { class: 'stack-2' }, ui.sectionTitle(titulo, null, { level: 3 }), lista);
    };

    const detalleMes = (key, { panel = false } = {}) => {
      const v = L.vecinosDeMes(key, hoyKey);
      const d = D.lineasMes(state, v.i, t);
      if (!d) return h('p', { class: 't-body' }, 'Ese mes todavía no está en tu plan.');
      const nodos = [];
      if (panel) nodos.push(h('h2', { class: 't-sheet' }, L.nombreMes(key, hoyKey, d.mesNombre)));
      const estimado = d.entra.some((l) => l.estimado) || d.sale.some((l) => l.estimado);
      nodos.push(ui.stat({
        label: d.free >= 0 ? `Te sobran en ${d.mesNombre}` : `Te faltan en ${d.mesNombre}`,
        value: ui.amt(Math.abs(d.free)), valueClass: 'display',
        chips: [ui.status(d.code), estimado ? ui.chip('con datos estimados', { tone: 'info' }) : null].filter(Boolean),
      }));
      if (d.eventos.length) {
        nodos.push(h('ul', { class: 'stack-2' }, d.eventos.map((e) => h('li', { style: { display: 'flex', gap: '10px', alignItems: 'flex-start' } },
          h('span', { class: 'brand', style: { paddingTop: '2px' } }, ui.icon(L.iconoEvento(e.tipo), { size: 'sm' })),
          h('span', { class: 't-body' }, ui.txt(e.texto))))));
      }
      nodos.push(bloqueLineas('Entra', d.entra, d.entraTotal, 'Entra en total', key));
      nodos.push(bloqueLineas('Sale', d.sale, d.saleTotal, 'Sale en total', key));
      nodos.push(ui.card([
        h('h3', { class: 't-h2' }, 'Qué hacemos con lo que sobra'),
        h('p', { class: 't-body' }, ui.txt(d.queSobra.texto)),
        d.code === 'falta' ? ui.btn({ label: 'Ver formas de cubrirlo', variant: 'secondary', onClick: () => abrirMesDificil(ctx, key) }) : null,
      ], { cls: 'stack-2' }));
      d.avisos.forEach((a) => nodos.push(ui.notice({ tone: 'info', icon: 'info', text: a })));
      const sueldo = (state.incomes || []).find((x) => x.kind === 'sueldo');
      if (sueldo) {
        nodos.push(ui.link({ label: `Me aumentaron el sueldo desde ${d.mesNombre}`, icon: 'chevron', onClick: () => abrirEditor(ctx, 'aumento', sueldo.id, { desde: key }) }));
      }
      nodos.push(ui.disclaimer());
      if (panel) nodos.push(navegacion(key, (k) => ctx.nav(`#/meses/${k}`)));
      return h('div', { class: 'stack-4' }, nodos);
    };

    // Botones para ir al mes anterior y al siguiente: con el nombre del mes, no solo una flecha.
    const navegacion = (key, ir_) => {
      const nv = L.vecinosDeMes(key, hoyKey);
      const boton = (k, lado) => ui.btn({
        label: F.monthName(k, { capital: true }), variant: 'secondary', inline: true,
        icon: lado === 'atras' ? 'volver' : undefined, iconRight: lado === 'sigue' ? 'chevron' : undefined,
        ariaLabel: `Ver ${lado === 'atras' ? 'el mes anterior' : 'el mes siguiente'}: ${F.monthName(k, { capital: true })}`,
        onClick: () => ir_(k),
      });
      return h('div', { class: 'between' }, nv.anterior ? boton(nv.anterior, 'atras') : h('span'), nv.siguiente ? boton(nv.siguiente, 'sigue') : h('span'));
    };

    const mostrarHoja = (key) => {
      const item = M.items.find((x) => x.key === key);
      const hoja = ctx.sheet.openRoute(CLAVE_HOJA, {
        title: L.nombreMes(key, hoyKey, item?.nombreCorto || key), size: 'tall',
        render: (body) => body.append(detalleMes(key)),
        footer: () => navegacion(key, (k) => { mesEnHoja = k; mostrarHoja(k).body.scrollTop = 0; }),
        onDismiss: () => { mesEnHoja = null; claveDeRutaVista = null; ctx.back('#/meses'); },
      });
      return hoja;
    };

    // ------------------------------------------------------------------ lista (4 o 12 meses)
    let modo = ui.pref.get('mesesMode', state.settings?.mesesMode || '4');
    if (modo !== '4' && modo !== '12') modo = '4';
    const region = h('div', { class: 'stack' });

    const chipLink = (texto, tono, key) => h('button', {
      type: 'button', style: { minHeight: '48px', display: 'inline-flex', alignItems: 'center', maxWidth: '100%' }, onclick: ir(`#/meses/${key}`),
    }, ui.chip(texto, { tone: tono, icon: tono === 'bad' ? 'forma-falta' : 'forma-ok' }));
    const resumenes = () => {
      const l = [M.mejorMes ? chipLink(M.mejorMes.texto, 'ok', M.mejorMes.key) : null, M.mesDificil ? chipLink(M.mesDificil.texto, 'bad', M.mesDificil.key) : null].filter(Boolean);
      return l.length ? h('div', { class: 'cluster' }, l) : null;
    };

    const filasDe = (items, m) => conLineas(charts.monthRows(items.map((it) => ({
      key: it.key, name: it.name,
      short: it.short,
      value: it.value, state: it.state, estimated: it.estimated,
      event: m === '12' ? it.eventoImporta : it.event, eventIcon: it.eventIcon,
      selected: it.key === seleccionado, onClick: ir(`#/meses/${it.key}`),
    })), { mode: m }));
    // el kit no separa las filas de meses: una línea fina entre una y otra ayuda a leer cada mes por separado
    const conLineas = (el) => { el.querySelectorAll('.mrow').forEach((n, i) => { if (i) n.style.borderTop = '1px solid var(--line)'; }); return el; };

    const leyendaPunteada = (items) => (items.some((it) => it.estimated) ? ui.footnote('Las barras con borde punteado llevan un aguinaldo estimado.') : null);

    const leyendaEventos = () => {
      const con = M.items.filter((it) => it.eventoImporta);
      if (!con.length) return null;
      return h('div', { class: 'stack-2' },
        ui.sectionTitle('Qué pasa en cada mes', null),
        ui.rowList(con.map((it) => ui.row({
          icon: it.eventIcon || 'destello', tone: it.state === 'falta' ? 'bad' : 'brand', title: it.name, sub: it.eventoImporta, onClick: ir(`#/meses/${it.key}`),
        }))));
    };

    const pintar = () => {
      const items = modo === '12' ? M.items : M.items.slice(0, 4);
      region.replaceChildren(...[filasDe(items, modo), leyendaPunteada(items), modo === '12' ? leyendaEventos() : null].filter(Boolean));
    };
    const segmento = ui.segmented({
      options: [{ value: '4', label: '4 meses' }, { value: '12', label: '12 meses' }], value: modo, ariaLabel: 'Cuántos meses ver',
      onChange: (v) => { modo = v; ui.pref.set('mesesMode', v); pintar(); },
    });
    pintar();

    const pendientes = filasPendientes(ctx, L.pendientesVisibles(D.run(state, { today: t }).eng?.flags?.motivosDetalle, { omitir: ['cobro'] }));
    const limitacion = (D.LIMITACIONES || []).find((x) => /aumentos de sueldo/i.test(x));
    const pies = [limitacion ? ui.footnote(limitacion) : null, ui.disclaimer()].filter(Boolean);
    const cabecera = [titulo, pendientes, segmento, resumenes()].filter(Boolean);

    // ------------------------------------------------------------------ armado
    if (ancho) {
      root.append(h('div', { class: 'desk-cols list-detail' },
        h('div', { class: 'col-main' }, ...cabecera, region, ...pies),
        h('aside', { class: 'col-side', 'aria-label': 'Detalle del mes' }, ui.card([detalleMes(seleccionado, { panel: true })], { cls: 'detail-panel', as: 'div' }))));
    } else {
      root.append(...cabecera, region, ...pies);
      if (claveValida) mostrarHoja(mesEnHoja || claveValida);
    }
    return limpiar;
  },
};
