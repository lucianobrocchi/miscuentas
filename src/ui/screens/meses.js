// meses.js · LOS PRÓXIMOS MESES (spec 6.4): lo que sobra cada mes, en 4 o en 12 meses, y el detalle de cada mes.
// El detalle vive en la URL (#/meses/2026-12): en el celular es una hoja (sheet.openRoute) con botones para ir al mes
// anterior y al siguiente; en escritorio es un panel pegajoso a la derecha de la lista.
// Tocar una línea del detalle abre el editor de ese ingreso, gasto o cuota (src/ui/editors.js, lo escribe S4).

import { monthKeyOf } from '../../format.js';
import * as L from './_hoy-logic.js';
import { abrirEditor, abrirMesDificil, filasPendientes } from './_hoy-sheets.js';

const ANCHO = '(min-width: 1024px)';
// Entre 1024 y 1179px (tablet apaisada) la lista de 5 columnas queda muy angosta para las barras: se le da media pantalla.
const ANCHO_LISTA = '(min-width: 1180px)';
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
    const mqLista = matchMedia(ANCHO_LISTA);
    const ancho = mq.matches;
    const alCambiarAncho = () => ctx.rerender();
    mq.addEventListener?.('change', alCambiarAncho);
    mqLista.addEventListener?.('change', alCambiarAncho);
    const limpiar = () => {
      mq.removeEventListener?.('change', alCambiarAncho);
      mqLista.removeEventListener?.('change', alCambiarAncho);
      // Al irse de Meses (no al volver a dibujarla por un cambio de estado) se olvida qué mes estaba abierto en la hoja.
      if (ctx.route()?.name !== 'meses') { mesEnHoja = null; claveDeRutaVista = null; }
    };
    const ir = (hash) => () => ctx.nav(hash);
    // En escritorio el detalle es un panel al lado de la lista: cambiar de mes lo reemplaza en el historial (no suma una entrada por cada toque).
    const irMes = (key) => () => ctx.nav(`#/meses/${key}`, { replace: ancho });

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

    // Para etiquetas de lectura (aria-label): con el ojo puesto, los montos que trae un texto también se ocultan.
    const sinMontos = (texto) => (ctx.isPrivate() ? String(texto).replace(/[−-]?\$\s?[\d.]+/g, 'monto oculto') : texto);

    const bloqueLineas = (titulo, lineas, total, rotuloTotal, key) => {
      const lista = ui.rowList(lineas.map((l) => ui.row({
        title: l.nombre, sub: l.detalle || undefined, value: ui.amt(l.monto),
        chip: l.estimado ? { label: 'estimado', tone: 'info' } : undefined,
        onClick: () => abrirLinea(l, key),
        ariaLabel: `${l.nombre}${l.detalle ? ', ' + sinMontos(l.detalle) : ''}: ${ui.srMoney(l.monto)}${l.estimado ? ', estimado' : ''}. Tocá para editarlo.`,
      })));
      lista.append(h('div', { role: 'listitem', class: 'between', style: { padding: '.875rem 1rem', borderTop: '1px solid var(--line)', background: 'var(--surface-2)' } },
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
        nodos.push(h('ul', { class: 'stack-2' }, d.eventos.map((e) => h('li', { style: { display: 'flex', gap: '.625rem', alignItems: 'flex-start' } },
          h('span', { class: 'brand', style: { paddingTop: '.125rem' } }, ui.icon(L.iconoEvento(e.tipo), { size: 'sm' })),
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
      if (panel) nodos.push(navegacion(key, (k) => irMes(k)()));
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
      // Si no entran los dos lado a lado (360px con letra Más grande), el segundo pasa abajo a todo el ancho.
      const fila = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '.5rem' } },
        nv.anterior ? boton(nv.anterior, 'atras') : null, nv.siguiente ? boton(nv.siguiente, 'sigue') : null);
      fila.querySelectorAll('.btn').forEach((n) => { n.style.flex = '1 1 9rem'; });
      return fila;
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

    // Panel pegajoso de escritorio: si el detalle es más alto que la ventana, se desplaza por dentro (si no, el final quedaba fuera de alcance).
    const panelDetalle = (key) => {
      const card = ui.card([detalleMes(key, { panel: true })], { cls: 'detail-panel', as: 'div' });
      card.style.maxHeight = 'calc(100vh - 2rem)';
      card.style.overflowY = 'auto';
      card.tabIndex = 0;
      return card;
    };

    // ------------------------------------------------------------------ lista (4 o 12 meses)
    let modo = ui.pref.get('mesesMode', state.settings?.mesesMode || '4');
    if (modo !== '4' && modo !== '12') modo = '4';
    const region = h('div', { class: 'stack' });

    const chipLink = (texto, tono, key) => h('button', {
      type: 'button', style: { minHeight: '3rem', display: 'inline-flex', alignItems: 'center', maxWidth: '100%' }, onclick: irMes(key),
    }, ui.chip(texto, { tone: tono, icon: tono === 'bad' ? 'forma-falta' : 'forma-ok' }));
    const resumenes = () => {
      // si todos los meses sobran lo mismo, "Mejor mes" no dice nada
      const hayVariacion = new Set(M.items.map((it) => Math.round(it.value))).size > 1;
      const l = [M.mejorMes && hayVariacion ? chipLink(M.mejorMes.texto, 'ok', M.mejorMes.key) : null, M.mesDificil ? chipLink(M.mesDificil.texto, 'bad', M.mesDificil.key) : null].filter(Boolean);
      return l.length ? h('div', { class: 'cluster' }, l) : null;
    };

    const filasDe = (items, m) => conLineas(charts.monthRows(items.map((it) => ({
      key: it.key, name: it.name,
      short: it.short,
      value: it.value, state: it.state, estimated: it.estimated,
      event: m === '12' ? it.eventoImporta : it.event, eventIcon: it.eventIcon,
      selected: it.key === seleccionado, onClick: irMes(it.key),
    })), { mode: m }), m, items);
    // El kit no separa las filas de meses: una línea fina entre una y otra ayuda a leer cada mes por separado.
    // En 4 meses el kit pone el número y la barra lado a lado (styles/components.css:380, columna "auto"): el cero de la barra
    // queda en un lugar distinto en cada fila y no se pueden comparar. Acá el número va arriba y la barra debajo, a todo el ancho.
    const conLineas = (el, m, items) => {
      el.querySelectorAll('.mrow').forEach((n, i) => {
        if (i) n.style.borderTop = '1px solid var(--line)';
        // el kit mete el texto del evento tal cual en la etiqueta de lectura: con el ojo puesto no puede llevar montos
        const et = n.getAttribute('aria-label');
        if (et) n.setAttribute('aria-label', sinMontos(et));
      });
      // En 12 meses la fila no trae palabra de estado: se suma la forma (círculo, cuadrado, triángulo) para que no dependa solo del color.
      if (m === '12') {
        el.querySelectorAll('.mrow').forEach((n, i) => {
          const val = n.querySelector('.mrow-val');
          if (!val || !items[i]) return;
          val.style.display = 'flex'; val.style.alignItems = 'center'; val.style.justifyContent = 'flex-end'; val.style.gap = '.375rem';
          val.prepend(ui.statusGlyph(items[i].state));
          // columna del monto de ancho fijo: así el cero de las barras queda en el mismo lugar en todas las filas
          n.style.gridTemplateColumns = '2.75rem minmax(0, 1fr) 7.25rem 1.75rem';
          n.style.gap = '.5rem';
        });
      }
      if (m === '4') el.querySelectorAll('.mrow-main').forEach((n) => { n.style.gridTemplateColumns = 'minmax(0, 1fr)'; n.style.gap = '.5rem'; });
      return el;
    };

    const leyendaPunteada = (items) => (items.some((it) => it.estimated) ? ui.footnote('Las barras con borde punteado llevan un aguinaldo estimado.') : null);

    const leyendaEventos = () => {
      const con = M.items.filter((it) => it.eventoImporta);
      if (!con.length) return null;
      return h('div', { class: 'stack-2' },
        ui.sectionTitle('Qué pasa en cada mes', null),
        ui.rowList(con.map((it) => ui.row({
          icon: it.eventIcon || 'destello', tone: it.state === 'falta' ? 'bad' : 'brand', title: it.name, sub: it.eventoImporta, onClick: irMes(it.key),
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
    const cabecera = [titulo, segmento, resumenes()].filter(Boolean);
    const abajo = [pendientes, ...pies].filter(Boolean);   // "Falta un dato" va después de la lista: lo primero que se ve son los meses

    // ------------------------------------------------------------------ armado
    if (ancho) {
      const principal = h('div', { class: 'col-main' }, ...cabecera, region, ...abajo);
      const lateral = h('aside', { class: 'col-side', 'aria-label': 'Detalle del mes' }, panelDetalle(seleccionado));
      if (!mqLista.matches) { principal.style.gridColumn = '1 / span 6'; lateral.style.gridColumn = '7 / span 6'; }
      root.append(h('div', { class: 'desk-cols list-detail' }, principal, lateral));
    } else {
      root.append(...cabecera, region, ...abajo);
      if (claveValida) mostrarHoja(mesEnHoja || claveValida);
    }
    return limpiar;
  },
};
