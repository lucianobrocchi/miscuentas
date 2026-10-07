// tarjeta.js · TARJETA (spec 6.7 + enmiendas B, C.3, C.8, C.9, C.15). Pantalla hija de Deudas.
// Orden: banner de resumen viejo → total del último resumen con las fechas reales → "Cuánto cuesta esta deuda" (con calma) →
// "Cuánto pagar el {fecha}" (mínimo / lo que sobra / otro monto) + "Ya pagué" → "Cómo baja" con la fecha de salida y lo que supone →
// "De quién es cada parte" (informativo) → consejo → cargar resumen nuevo / avisarme en el calendario → aviso al pie.
// Toda cifra sale de ctx.derive; los guardados pasan por ctx.update (con Deshacer) y por ctx.editors (los escribe S4).

import { elegirPagoTarjeta } from '../../store.js';
import { debounce } from '../dom.js';
import * as L from './_deudas-logic.js';
import { abrirEditor, abrirTitular, avisarCalendario, bloqueSupuesto, chipFlexible } from './_deudas-sheets.js';

const ANCHO = '(min-width: 1024px)';

export default {
  id: 'tarjeta',
  title: 'Tarjeta',

  mount(root, ctx, params, route) {
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

    const { tarjetas, debt } = L.tarjetaElegida(state, route && route.query ? route.query.id : null);

    // ------------------------------------------------------------------ sin tarjeta cargada
    if (!debt) {
      ctx.header({ title: 'Tarjeta', back: '#/deudas' });
      root.append(ui.empty({
        title: 'Todavía no cargaste tu tarjeta',
        text: 'Con el último resumen te muestro cuánto pagar, cuándo termina esta deuda y cuánto cuesta cada mes.',
        art: 'tarjeta',
        action: { label: 'Cargar mi tarjeta', onClick: () => ctx.nav('#/armar/6') },
      }));
      return limpiar;
    }

    ctx.header({ eyebrow: debt.creditor || undefined, title: debt.name, back: '#/deudas' });
    root.append(h('h1', { class: 'sr-only' }, debt.name));

    const est = D.estadoResumen(debt, t);
    const pagos = D.pagosDelResumen(debt);
    const esc = D.escenariosPago(state, t, { debtId: debt.id });
    const sal = D.salidaTarjeta(state, t, { debtId: debt.id });
    const interes = D.interesTarjeta(debt);
    const ciclo = D.cicloTarjeta(state, t, { debtId: debt.id });
    const tit = D.titularesTarjeta(state, { debtId: debt.id });
    const curva = D.curvaDeuda(state, t);
    const ics = D.icsVencimiento(state, t, { debtId: debt.id });
    const cargarResumen = () => abrirEditor(ctx, 'statement', debt.id);

    // ------------------------------------------------------------------ varias tarjetas: elegir cuál se mira
    const selector = tarjetas.length > 1
      ? h('div', { class: 'chips', role: 'group', 'aria-label': 'Qué tarjeta mirar' },
        tarjetas.map((d) => ui.chipButton(d.name, { selected: d.id === debt.id, onClick: () => ctx.nav(`#/deudas/tarjeta?id=${encodeURIComponent(d.id)}`, { replace: true }) })))
      : null;

    // ------------------------------------------------------------------ 1) banner de resumen viejo / sin resumen
    let aviso = null;
    if (!est.hayResumen) {
      aviso = ui.notice({
        tone: 'info', dashed: true, title: 'Falta un dato',
        text: 'Cargá el último resumen para ver las fechas de cierre y vencimiento y cuánto conviene pagar.',
        action: { label: 'Cargar resumen nuevo', onClick: cargarResumen },
      });
    } else if (est.viejo) {
      const b = L.bannerViejo(est, F);
      aviso = ui.notice({ tone: 'warn', title: b.title, text: b.text, action: { label: 'Cargar resumen nuevo', onClick: cargarResumen } });
    }

    // ------------------------------------------------------------------ 2) total del último resumen con las fechas reales
    const st = debt.statement || {};
    const totalResumen = est.hayResumen ? nn(st.total) || nn(debt.balance) : nn(debt.balance);
    const chips = [
      ...L.chipsFechas(est, F).map((c) => chipFlexible(ui, c, { tone: 'info', icon: 'calendario' })),
      nn(debt.rate) > 0 ? ui.chip(`${F.pct(debt.rate)} por mes`, { tone: 'warn' }) : null,
    ].filter(Boolean);
    const filas = L.filasResumen(debt, est, pagos, F);
    const cuadroResumen = ui.card([
      ui.stat({
        label: est.hayResumen ? `Total del último resumen${est.label ? ` (${est.label})` : ''}` : 'Lo que debés según lo último que cargaste',
        value: ui.amt(totalResumen), chips,
      }),
      h('div', { class: 'cluster' },
        nn(debt.rate) > 0 ? ui.glossary('interesMensual', { label: 'Qué es el interés por mes' }) : null,
        ui.glossary('pagoMinimo', { label: 'Qué es el pago mínimo' })),
      filas.length ? ui.kv(filas.map((f) => ({ label: f.label, value: ui.amt(f.valor), strong: f.strong, hint: f.hint }))) : null,
    ].filter(Boolean), { cls: 'stack-3', ariaLabel: 'Último resumen de la tarjeta' });

    // ------------------------------------------------------------------ 3) cuánto cuesta esta deuda (con calma)
    const porDia = nn(interes.porDia);
    const cuesta = h('div', { class: 'stack-3' },
      ui.sectionTitle('Cuánto cuesta esta deuda', null),
      ui.card([
        h('p', { class: 't-body' }, 'Es un dato más para decidir con tranquilidad. Cada pago de más que hacés lo achica.'),
        ui.kv([
          { label: interes.delResumen != null ? 'Interés del último resumen' : 'Interés que se suma por mes', value: ui.amt(interes.mostrar), strong: true },
          porDia > 0 ? { label: 'Por día, unos', value: ui.amt(porDia) } : null,
          nn(debt.rate) > 0 ? { label: 'Tasa', value: `${interes.tasaTexto} por mes (unos ${F.pct(interes.anualAprox, 0)} por año)` } : null,
        ].filter(Boolean)),
      ], { cls: 'stack-3' }));

    // ------------------------------------------------------------------ 4) cuánto pagar el {fecha}
    const opMin = esc.opciones.find((o) => o.id === 'minimo');
    const opSob = esc.opciones.find((o) => o.id === 'sobra');
    const opOtro = esc.opciones.find((o) => o.id === 'otro');
    const conMonto = (monto, texto) => h('span', { style: { display: 'flex', flexDirection: 'column' } },
      h('span', { class: 't-row num', style: { color: 'var(--ink)' } }, ui.amt(monto)),
      h('span', null, ui.txt(texto)));
    let pagar = null;
    if (esc.estado === 'ok' && opMin && opSob) {
      const grupo = ui.optionGroup({
        name: 'pago-tarjeta', ariaLabel: esc.titulo, value: esc.elegida,
        // el monto va DEBAJO del título (en una columna a la derecha, con letra grande el detalle quedaba en una torre angosta)
        options: [
          { value: 'minimo', title: 'Solo el mínimo', sub: conMonto(opMin.monto, L.subOpcionPago(opMin, F, opMin)) },
          { value: 'sobra', title: 'Lo que sobra', tag: opSob.recomendada ? 'Recomendado' : undefined, sub: conMonto(opSob.monto, L.subOpcionPago(opSob, F, opMin)) },
          { value: 'otro', title: 'Otro monto', sub: opOtro ? conMonto(opOtro.monto, L.subOpcionPago(opOtro, F, opMin)) : 'Elegí cuánto querés pagar' },
        ],
        onChange: (v) => {
          cajaOtro.hidden = v !== 'otro';
          if (v === 'otro') { campoOtro.focus(); return; }
          if (v === esc.elegida) return;
          ctx.update((d) => { elegirPagoTarjeta(d, debt.id, { opcion: v, mes: esc.key }); },
            { undoLabel: v === 'minimo' ? 'Listo: este mes vas a pagar solo el mínimo.' : 'Listo: este mes vas a pagar lo que sobra.' });
        },
      });

      // otro monto: se evalúa en vivo y se guarda recién con el botón
      const campoOtro = ui.fields.money({
        label: '¿Cuánto vas a pagar?', value: opOtro ? opOtro.monto : undefined, placeholder: 'Por ejemplo, 400.000', big: true, name: 'otro-monto',
        hint: 'Podés poner el monto que quieras. Con la coma o el punto, como te sea más cómodo.',
      });
      const resultado = h('div', { role: 'status', 'aria-live': 'polite', class: 'stack-3' });
      const botonUsar = ui.btn({ label: 'Usar este monto', icon: 'tilde', disabled: true, onClick: () => guardarOtro() });
      let montoEvaluado = null;
      const mostrar = () => {
        const m = campoOtro.get();
        montoEvaluado = m;
        botonUsar.disabled = !(m > 0);
        if (!(m > 0)) { resultado.replaceChildren(ui.footnote('Poné un monto y te muestro cómo queda.')); return; }
        const e2 = D.escenariosPago(state, t, { debtId: debt.id, otro: m });
        const o = e2.opciones.find((x) => x.id === 'otro');
        if (!o) { resultado.replaceChildren(); return; }
        resultado.replaceChildren(
          o.paidOn
            ? ui.kv([{ label: 'Salís de la tarjeta', value: o.salidaTexto, strong: true }, { label: 'Interés total', value: ui.amt(o.totalInterest) }])
            : h('p', { class: 't-body' }, 'Con ese monto la tarjeta no se termina en los próximos años.'),
          o.aviso ? ui.notice({ tone: 'warn', title: o.aviso }) : null);
      };
      const guardarOtro = () => {
        if (!(montoEvaluado > 0)) { campoOtro.setError('Poné cuánto vas a pagar.'); campoOtro.focus(); return; }
        const monto = montoEvaluado;
        ctx.update((d) => { elegirPagoTarjeta(d, debt.id, { opcion: 'otro', monto, mes: esc.key }); }, { undoLabel: `Listo: este mes vas a pagar ${F.money(monto)}.` });
      };
      campoOtro.onChange(debounce(mostrar, 250));
      const cajaOtro = h('div', { class: 'stack-3' }, campoOtro.el, resultado, botonUsar);
      cajaOtro.hidden = esc.elegida !== 'otro';
      mostrar();

      const textoPagado = L.textoPagado(pagos, F);
      pagar = h('div', { class: 'stack-3' },
        ui.sectionTitle(esc.titulo, null),
        esc.aviso ? ui.notice({ tone: 'warn', title: 'Fecha y montos provisorios', text: esc.aviso }) : null,
        grupo, cajaOtro,
        ui.footnote(esc.pie),
        ui.card([
          h('div', { class: 'stack-1' },
            h('p', { class: 't-row' }, '¿Ya pagaste?'),
            h('p', { class: 't-body muted' }, textoPagado ? ui.txt(textoPagado) : 'Anotá cuánto pagaste y cuándo: baja lo que debés y se actualiza todo.')),
          ui.btn({ label: 'Ya pagué', icon: 'tilde', variant: 'secondary', onClick: () => abrirEditor(ctx, 'cardPayment', debt.id) }),
        ], { cls: 'stack-3' }));
    }

    // ------------------------------------------------------------------ 5) cómo baja + fecha de salida (con lo que supone)
    let baja = null;
    if (sal.hayTarjeta) {
      const hayFecha = sal.estado === 'fecha';
      // sin fecha (no se termina o falta mucho) no se dibuja la línea: mostraría números sin sentido
      const grafico = hayFecha && curva.plan.length ? charts.debtLine({
        series: L.seriesCurva(curva, F), height: 160, ariaLabel: ctx.isPrivate() ? L.ocultarMontos(L.ariaCurva(curva, F)) : L.ariaCurva(curva, F), tableCaption: 'Lo que debés en la tarjeta, mes a mes',
      }) : null;
      baja = h('div', { class: 'stack-3' },
        ui.sectionTitle('Cómo baja', null),
        ui.card([
          h('div', { class: 'stack-1' },
            h('p', { class: 't-small t-label muted' }, 'Salís de la tarjeta'),
            hayFecha ? h('p', { class: 't-date' }, sal.mesNombre) : h('p', { class: 't-row' }, ui.txt(sal.texto)),
            hayFecha ? h('p', { class: 't-small muted' }, sal.detalle) : null),
          hayFecha ? bloqueSupuesto(ctx, sal) : null,
          !hayFecha && sal.estado !== 'sinDeuda' ? ui.footnote('Probá con un monto más alto en "Cuánto pagar" y mirá cuánto cambia.') : null,
          grafico,
          grafico ? ui.footnote('Línea llena: tu plan. Línea punteada: pagando solo el mínimo.') : null,
        ].filter(Boolean), { cls: 'stack-3' }));
    }

    // ------------------------------------------------------------------ 6) de quién es cada parte (informativo, nunca rojo)
    const titulares = L.filasTitulares(state, debt);
    const partes = tit.partes.map((p, i) => ({
      label: p.nombre, labelNode: ui.personName(p.nombre, L.indicePersona(state, p.personId, p.nombre)), value: p.monto, tone: L.TONOS_REPARTO[i % L.TONOS_REPARTO.length],
    }));
    if (tit.resto > 0) partes.push({ label: 'Sin repartir', value: tit.resto, tone: 'brand' });
    const quien = titulares.length ? h('div', { class: 'stack-3' },
      ui.sectionTitle('De quién es cada parte', null),
      ui.card([
        h('p', { class: 't-body muted' }, 'Es solo para tu orden: no cambia ninguna cuenta. Anotá cuánto de este total es de cada persona.'),
        tit.partes.length ? h('div', { class: 'cluster' }, ui.chip(tit.texto, { tone: tit.cuadra ? 'ok' : 'warn', icon: tit.cuadra ? 'tilde' : 'info' })) : null,
        tit.partes.length ? charts.stacked({ parts: partes, ariaLabel: `De quién es cada parte: ${tit.partes.map((p) => `${ui.aliasName(p.nombre, L.indicePersona(state, p.personId, p.nombre))} ${ui.srMoney(p.monto)}`).join(', ')}.` }) : null,
        ui.rowList(titulares.map((f) => ui.row({
          icon: 'usuarios', tone: f.monto ? 'info' : 'neutral', title: ui.personName(f.nombre, f.index),
          sub: f.enMeDeben ? 'Figura en Me deben' : undefined,
          value: f.monto ? ui.amt(f.monto) : undefined,
          chip: f.monto ? undefined : { label: 'Cargar', tone: 'info' },
          onClick: () => abrirTitular(ctx, debt, f),
          ariaLabel: `${ui.aliasName(f.nombre, f.index)}: ${f.monto ? ui.srMoney(f.monto) : 'sin cargar'}. Tocá para ${f.monto ? 'cambiarlo' : 'cargarlo'}.`,
        })), { ariaLabel: 'Parte de cada persona' }),
      ].filter(Boolean), { cls: 'stack-3' })) : null;

    // ------------------------------------------------------------------ 7) consejo del ciclo
    const textoCiclo = ciclo.texto || ciclo.pide;
    const consejo = ciclo.hayResumen && (ciclo.consejo || textoCiclo) ? ui.notice({
      tone: 'brand', icon: 'info', title: ciclo.consejo ? 'Antes de comprar con la tarjeta' : 'Fechas del resumen',
      text: [ciclo.consejo, textoCiclo, ciclo.consejo ? ciclo.nota : null].filter(Boolean).join(' '),
    }) : null;

    // ------------------------------------------------------------------ 8) acciones y aviso al pie
    const textoAviso = L.textoAvisoCalendario(ics, F);
    const acciones = h('div', { class: 'stack-3' },
      h('div', { class: 'actions' },
        ui.btn({ label: 'Cargar resumen nuevo', variant: est.viejo ? 'primary' : 'secondary', icon: 'subir', onClick: cargarResumen }),
        ics.ok ? ui.btn({ label: 'Avisarme en mi calendario', variant: 'secondary', icon: 'campana', onClick: () => avisarCalendario(ctx, debt.id) }) : null),
      textoAviso ? ui.footnote(textoAviso) : null,
      ui.btn({ label: 'Editar los datos de la tarjeta', variant: 'text', onClick: () => abrirEditor(ctx, 'debt', debt.id) }),
      ui.footnote('Es una estimación: el banco puede cobrar impuestos y cargos que no figuran acá.'),
      ui.disclaimer());

    const principal = [selector, aviso, cuadroResumen, cuesta, pagar].filter(Boolean);
    const lateral = [baja, quien, consejo, acciones].filter(Boolean);
    if (mq.matches) {
      root.append(h('div', { class: 'desk-cols' },
        h('div', { class: 'col-main' }, ...principal),
        h('div', { class: 'col-side' }, ...lateral)));
    } else {
      root.append(...principal, ...lateral);
    }
    // atajo #/deudas/tarjeta?pagar=1: abre directo "Ya pagué" (se limpia la dirección para no reabrirlo al re-dibujar)
    if (route && route.query && route.query.pagar === '1') {
      ctx.nav(`#/deudas/tarjeta${tarjetas.length > 1 ? `?id=${encodeURIComponent(debt.id)}` : ''}`, { replace: true });
      setTimeout(() => abrirEditor(ctx, 'cardPayment', debt.id), 300);
    }
    return limpiar;
  },
};

function nn(x) { return Number.isFinite(Number(x)) ? Number(x) : 0; }
