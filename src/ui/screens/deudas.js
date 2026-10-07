// deudas.js · DEUDAS · lo que debo (spec 6.6 + enmiendas C.7 y C.9).
// Orden: segmentado "Lo que debo | Me deben" → cuándo baja el peso de las deudas (la FECHA primero, el "$X de cada $100" chico debajo)
// → "Cuándo termina cada deuda" (línea de tiempo con cuotas) → "Lo que vas a recuperar por mes" → pie y agregar.
// Toda cifra sale de ctx.derive. La pantalla es una función pura del estado: app.js la vuelve a montar cada vez que cambia.

import { monthKeyOf } from '../../format.js';
import * as L from './_deudas-logic.js';
import { abrirEditor, abrirAgregar, bloqueSupuesto, segmentoDeudas } from './_deudas-sheets.js';

const ANCHO = '(min-width: 1024px)';

export default {
  id: 'deudas',
  title: 'Deudas',

  mount(root, ctx) {
    const { ui, charts } = ctx;
    const { h } = ui;
    const D = ctx.derive;
    const F = ctx.format;
    const t = ctx.today();
    const state = ctx.state;
    const mq = matchMedia(ANCHO);
    const alCambiarAncho = () => ctx.rerender();
    mq.addEventListener?.('change', alCambiarAncho);
    const limpiar = () => mq.removeEventListener?.('change', alCambiarAncho);

    ctx.header({});   // el título lo lleva la página
    const titulo = ui.pageTitle('Deudas', 'Cuándo termina cada una y cuánta plata va quedando libre.');
    const seg = segmentoDeudas(ctx, 'debo');

    const aria = (texto) => (ctx.isPrivate() ? L.ocultarMontos(texto) : texto);
    const lib = D.liberaciones(state, t);
    if (!L.hayDeudas(lib)) {
      root.append(titulo, seg, ui.empty({
        title: 'No cargaste deudas',
        text: 'Si no tenés, mejor todavía. Si tenés, anotalas y te muestro cuándo termina cada una.',
        art: 'tarjeta',
        action: { label: 'Agregar una deuda', onClick: () => abrirAgregar(ctx) },
      }));
      return limpiar;
    }

    const sobre = D.deudaSobreIngreso(state, t);
    const salida = D.salidaTarjeta(state, t);
    const hoyKey = monthKeyOf(t);
    const linea = L.lineaDeTiempo(lib, salida, state, F, hoyKey);
    const escalera = L.escaleraFilas(lib, F);
    const pie = L.pieDeudas(lib, F);

    // ------------------------------------------------------------------ 1) cuándo baja el peso de las deudas (la fecha manda)
    const hoyTexto = L.textoHoyDeudas(sobre);
    const detalle = L.detalleDeudas(sobre, F);
    let contexto = null;
    if (sobre.porCien != null && (sobre.textoAlivio || hoyTexto)) {
      contexto = ui.card([
        h('div', { class: 'stack-2' },
          h('p', { class: 't-small t-label muted' }, 'Cuánto de lo que cobrás va a deudas'),
          h('p', { class: 't-date' }, ui.txt(sobre.textoAlivio || hoyTexto)),
          sobre.textoAlivio ? h('p', { class: 't-body muted' }, ui.txt(hoyTexto)) : null,
          detalle ? h('p', { class: 't-small muted' }, ui.txt(detalle)) : null),
        // la fecha de la tarjeta lleva siempre lo que supone; si la tarjeta no tiene fecha, no hay nada que aclarar
        sobre.textoAlivio || salida.estado === 'fecha' ? bloqueSupuesto(ctx, salida) : null,
      ].filter(Boolean), { cls: 'stack-3', ariaLabel: 'Cuánto de lo que cobrás va a deudas' });
    }

    // ------------------------------------------------------------------ 2) cuándo termina cada deuda
    const tl = charts.timeline({
      items: linea.filas.map((f) => ({
        id: f.id, label: f.label, sub: f.sub, start: f.start, end: f.end, dateLabel: f.dateLabel, tone: f.tone, pending: f.pending,
        pipsInfo: f.pipsInfo, ariaLabel: aria(f.ariaLabel),
        onClick: () => {
          if (f.destino.tipo === 'nav') ctx.nav(f.destino.hash);
          else abrirEditor(ctx, f.destino.kind, f.destino.id);
        },
      })),
      from: linea.from, to: linea.to, todayKey: linea.todayKey, ariaLabel: 'Cuándo termina cada deuda',
    });

    // ------------------------------------------------------------------ datos que faltan (AFIP, planilla): cambian lo que se ve acá
    const faltan = L.pendientesDeudas(D.toEngine(state, t).flags.motivosDetalle);
    const pendientes = faltan.length ? ui.rowList(faltan.map((p) => ui.row({
      icon: 'documento', tone: 'info', title: p.titulo, sub: p.texto, chip: { label: 'Completar', tone: 'info' }, pending: true, onClick: () => ctx.nav(p.hash),
    })), { ariaLabel: 'Datos que faltan' }) : null;

    // ------------------------------------------------------------------ 3) lo que vas a recuperar por mes
    const recuperar = escalera.length ? h('div', { class: 'stack-3' },
      ui.sectionTitle('Lo que vas a recuperar por mes', null),
      ui.rowList(escalera.map((e) => ui.row({
        icon: 'flecha-arriba', tone: 'ok', title: e.titulo,
        // el monto va DEBAJO del título: a la derecha dejaba el título partido en dos renglones a 390px
        sub: h('span', { style: { display: 'flex', flexDirection: 'column' } },
          h('span', { class: 't-row num', style: { color: 'var(--ink)' } }, ui.amt(e.monto, { plus: true }), ' por mes'),
          e.sub ? h('span', { class: 't-small muted' }, ui.txt(e.sub)) : null),
        ariaLabel: aria(e.texto),
      })), { ariaLabel: 'Lo que vas a recuperar por mes' })) : null;

    // ------------------------------------------------------------------ 4) pie y agregar
    const abajo = h('div', { class: 'stack-3' },
      pie ? ui.footnote(pie) : null,
      ui.btn({ label: 'Agregar una deuda o cuota', variant: 'secondary', icon: 'mas', onClick: () => abrirAgregar(ctx) }),
      ui.disclaimer());

    const bloqueLinea = h('div', { class: 'stack-3' }, ui.sectionTitle('Cuándo termina cada deuda', null), tl);

    root.append(titulo, seg);
    if (mq.matches) {
      // escritorio: arriba la fecha de alivio y lo que se recupera, lado a lado; la línea de tiempo ocupa todo el ancho
      root.append(
        h('div', { class: 'desk-cols even' },
          h('div', { class: 'col-main' }, ...[contexto].filter(Boolean)),
          h('div', { class: 'col-side' }, ...[recuperar].filter(Boolean))),
        bloqueLinea, pendientes, abajo);
    } else {
      root.append(...[contexto, bloqueLinea, pendientes, recuperar, abajo].filter(Boolean));
    }
    return limpiar;
  },
};
