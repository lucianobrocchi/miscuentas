// medeben.js · DEUDAS · Me deben (spec 6.8 + enmiendas C.4 y C.13) y la ficha de cada persona (#/deudas/medeben/<personId>).
// Lista por persona con un estado en palabras ("Para conversar" en color pino, nunca una alerta), una idea con el efecto sobre la
// tarjeta y el atajo "Anoté que me pagaron". La ficha muestra lo que debe, las cuotas posibles en vivo, el interés opcional,
// el historial "Te pagó" y el mensaje de WhatsApp editable. Toda cifra sale de ctx.derive; los guardados van por ctx.update.

import { debounce } from '../dom.js';
import * as L from './_deudas-logic.js';
import { abrirEditor, abrirCobro, abrirMensaje, chipFlexible, segmentoDeudas } from './_deudas-sheets.js';

export default {
  id: 'medeben',
  title: 'Me deben',

  mount(root, ctx, params, route) {
    const salida = params && params.personId ? ficha(root, ctx, params.personId) : lista(root, ctx);
    if (route && route.query && route.query.pagar === '1') atajoAnotarPago(ctx, params && params.personId);
    return salida;
  },
};

/**
 * Atajo #/deudas/medeben?pagar=1 (o .../<personId>?pagar=1): abre directo "Anotar pago". Primero deja la dirección limpia (sin
 * ?pagar=1) para que no se vuelva a abrir al re-dibujar la pantalla; la hoja se abre cuando la pantalla ya se volvió a montar.
 */
function atajoAnotarPago(ctx, personId) {
  ctx.nav(personId ? `#/deudas/medeben/${encodeURIComponent(personId)}` : '#/deudas/medeben', { replace: true });
  setTimeout(() => {
    if (!personId) { abrirCobro(ctx); return; }
    const q = L.quienPaga(ctx.derive.meDeben(ctx.state, ctx.today()).personas, ctx.state).personas.find((p) => p.personId === personId);
    if (q) abrirEditor(ctx, 'receivablePayment', q.receivableId, { personId });
  }, 300);
}

// ====================================================================================================== lista
function lista(root, ctx) {
  const { ui } = ctx;
  const { h } = ui;
  const D = ctx.derive;
  const t = ctx.today();
  const state = ctx.state;

  ctx.header({});
  const titulo = ui.pageTitle('Deudas', 'La plata que te deben y cuándo te la devuelven.');
  const seg = segmentoDeudas(ctx, 'medeben');
  const md = D.meDeben(state, t);
  const hayAlguien = md.personas.some((p) => p.balance > 0);

  if (!hayAlguien) {
    root.append(titulo, seg, ui.empty({
      title: 'Nadie te debe plata',
      text: 'Si alguien te debe, anotalo y vemos cuándo te la devuelve.',
      art: 'personas',
      action: { label: 'Anotar una deuda', onClick: () => abrirEditor(ctx, 'receivable', null) },
    }));
    return undefined;
  }

  // ---------------------------------------------------------------- total + atajo "Anoté que me pagaron"
  const total = ui.card([
    ui.stat({ label: 'En total te deben', value: ui.amt(md.total), sub: md.texto }),
    ui.btn({ label: 'Anoté que me pagaron', icon: 'tilde', onClick: () => abrirCobro(ctx) }),
  ], { cls: 'stack-3', ariaLabel: 'En total te deben' });

  // ---------------------------------------------------------------- por persona (el valor va DEBAJO del nombre)
  const fila = (p) => {
    const index = L.indicePersona(state, p.personId, p.nombre);
    const idRuta = encodeURIComponent(p.personId || p.id);
    if (p.balance <= 0) {
      return ui.row({
        icon: 'usuarios', tone: 'neutral', title: ui.personName(p.nombre, index), sub: p.estadoTexto,
        chip: { label: 'Cargar', tone: 'info' },
        onClick: () => abrirEditor(ctx, 'receivable', null, { personId: p.personId }),
        ariaLabel: `${ui.aliasName(p.nombre, index)}: no te debe nada cargado. Tocá para cargar una deuda.`,
      });
    }
    return ui.row({
      icon: 'usuarios', tone: p.tono, title: ui.personName(p.nombre, index),
      sub: h('span', { style: { display: 'flex', flexDirection: 'column', gap: '.25rem', alignItems: 'flex-start' } },
        h('span', { class: 't-big num', style: { color: 'var(--ink)' } }, ui.amt(p.balance)),
        chipFlexible(ui, p.estadoTexto, { tone: p.tono, icon: L.ICONO_ESTADO[p.estado] }),
        p.detalle ? h('span', { class: 't-small muted' }, ui.txt(p.detalle)) : null),
      onClick: () => ctx.nav(`#/deudas/medeben/${idRuta}`),
      ariaLabel: `${ui.aliasName(p.nombre, index)} te debe ${ui.srMoney(p.balance)}. ${p.estadoTexto}. ${p.detalle || ''} Tocá para ver el detalle.`,
    });
  };
  const personas = h('div', { class: 'stack-3' },
    ui.sectionTitle('Por persona', null),
    ui.rowList(L.personasOrdenadas(md.personas).map(fila), { ariaLabel: 'Por persona' }));

  // ---------------------------------------------------------------- una idea (la escribe derive) + mandarle la cuenta
  const idea = (D.siguientePaso(state, t) || []).find((x) => x.id === 'idea');
  let tarjetaIdea = null;
  if (idea) {
    const r = (state.receivables || []).find((x) => x.personId === idea.personId && Number(x.balance) > 0 && !(Number(x.monthlyPayment) > 0));
    tarjetaIdea = ui.card([
      h('div', { style: { display: 'flex', gap: '.75rem', alignItems: 'flex-start' } },
        ui.iconTile('destello', 'brand'),
        h('div', { class: 'stack-1' }, h('p', { class: 't-row' }, 'Una idea'), h('p', { class: 't-body' }, ui.txt(idea.texto)))),
      r ? ui.btn({ label: 'Mandarle la cuenta por WhatsApp', variant: 'secondary', icon: 'whatsapp', onClick: () => abrirMensaje(ctx, r.id, L.cuotaSugerida(r.balance)) }) : null,
    ].filter(Boolean), { cls: 'stack-3' });
  }

  const pie = ui.btn({ label: 'Agregar a otra persona', variant: 'secondary', icon: 'mas', onClick: () => abrirEditor(ctx, 'receivable', null) });

  root.append(titulo, seg);
  if (matchMedia('(min-width: 1024px)').matches) {
    root.append(h('div', { class: 'desk-cols' },
      h('div', { class: 'col-main' }, total, personas),
      h('div', { class: 'col-side' }, ...[tarjetaIdea, pie].filter(Boolean))));
  } else {
    root.append(...[total, personas, tarjetaIdea, pie].filter(Boolean));
  }
  return undefined;
}

// ====================================================================================================== ficha de una persona
function ficha(root, ctx, personId) {
  const { ui } = ctx;
  const v = L.vistaFicha(ctx.derive, ctx.state, ctx.today(), personId);

  if (!v) {
    ctx.header({ title: 'Me deben', back: '#/deudas/medeben' });
    root.append(ui.empty({ title: 'No encontramos a esa persona', text: 'Puede que ya no esté cargada. Volvé a la lista para ver quién te debe.', art: 'personas', action: { label: 'Volver a Me deben', onClick: () => ctx.nav('#/deudas/medeben') } }));
    return undefined;
  }
  const { persona, cuentas, index } = v;
  ctx.header({ eyebrow: 'Me deben', title: ui.aliasName(persona.nombre, index), back: '#/deudas/medeben' });

  if (!cuentas.length) {
    root.append(ui.empty({
      title: 'No te debe nada cargado',
      text: 'Si te debe plata, anotala y vemos cuándo te la devuelve.',
      art: 'personas',
      action: { label: 'Anotar una deuda', onClick: () => abrirEditor(ctx, 'receivable', null, { personId: persona.personId }) },
    }));
    return undefined;
  }

  root.append(ui.h('h1', { class: 'sr-only' }, ui.aliasName(persona.nombre, index)));
  const bloques = cuentas.map((c) => bloqueCuenta(ctx, persona, index, c, cuentas.length > 1));
  root.append(...bloques);
  root.append(ui.disclaimer());
  return undefined;
}

/** Todo lo de una cuenta (una persona puede tener más de una): cuánto debe, cuotas en vivo, interés, historial y acciones. */
function bloqueCuenta(ctx, persona, index, cuenta, varias) {
  const { ui } = ctx;
  const { h } = ui;
  const D = ctx.derive;
  const F = ctx.format;
  const t = ctx.today();
  const state = ctx.state;
  const { r, esc, interes, historial } = cuenta;
  const cuotaActual = Number(r.monthlyPayment) || 0;

  // ---------------------------------------------------------------- cuánto debe
  // con una sola cuenta, el estado de la persona; con varias, el de cada cuenta (si no, una cuenta sin cuota heredaba "Devuelve lo acordado")
  const chipsEstado = varias
    ? [cuotaActual > 0 ? chipFlexible(ui, `Cuota de ${F.money(cuotaActual)} por mes`, { tone: 'info' }) : chipFlexible(ui, 'Para conversar', { tone: 'brand', icon: L.ICONO_ESTADO.conversar })]
    : [chipFlexible(ui, persona.estadoTexto, { tone: persona.tono, icon: L.ICONO_ESTADO[persona.estado] }),
      cuotaActual > 0 ? chipFlexible(ui, `Cuota de ${F.money(cuotaActual)} por mes`, { tone: 'info' }) : null].filter(Boolean);
  const deuda = ui.card([
    ui.stat({ label: varias ? r.name : 'Te debe', value: ui.amt(r.balance), sub: r.note || undefined, chips: chipsEstado }),
  ], { cls: 'stack-3', ariaLabel: `${ui.aliasName(persona.nombre, index)} te debe` });

  // ---------------------------------------------------------------- cuánto te devolvería por mes (en vivo)
  const opciones = L.opcionesCuota(esc, F);
  const hayActualEnLista = opciones.some((o) => o.esActual);
  const valorInicial = hayActualEnLista ? opciones.find((o) => o.esActual).value : 'otro';
  const grupo = ui.optionGroup({
    name: `cuota-${r.id}`, ariaLabel: 'Cuánto te devolvería por mes', value: String(valorInicial),
    options: [
      // el título va en UN solo nodo: el kit lo pone en un contenedor flex y el monto se separaba del resto de la frase
      ...opciones.map((o) => ({ value: String(o.value), title: h('span', null, ui.txt(o.titulo)), sub: o.sub, tag: o.esActual && o.value > 0 ? 'La acordada' : undefined, tagTone: 'info' })),
      { value: 'otro', title: 'Otro monto', sub: 'Elegí cuánto por mes' },
    ],
    onChange: (val) => {
      cajaOtro.hidden = val !== 'otro';
      if (val === 'otro') { campoOtro.focus(); return; }
      const monto = Number(val);
      if (monto === cuotaActual) return;
      ctx.update((d) => { L.fijarCuota(d, r.id, monto); },
        { undoLabel: monto > 0 ? `Listo: la cuota de ${persona.nombre} quedó en ${F.money(monto)} por mes.` : `Listo: ${persona.nombre} queda sin cuota por ahora.` });
    },
  });

  const campoOtro = ui.fields.money({ label: '¿Cuánto por mes?', placeholder: 'Por ejemplo, 40.000', big: true, name: `otra-cuota-${r.id}`, hint: 'Podés poner el monto que quieras.' });
  const resultado = h('div', { role: 'status', 'aria-live': 'polite', class: 'stack-3' });
  const botonUsar = ui.btn({ label: 'Usar esta cuota', icon: 'tilde', disabled: true, onClick: () => guardarOtra() });
  let montoOtro = null;
  const mostrar = () => {
    const m = campoOtro.get();
    montoOtro = m;
    botonUsar.disabled = !(m > 0);
    if (!(m > 0)) { resultado.replaceChildren(ui.footnote('Poné un monto y te muestro cómo queda.')); return; }
    const e2 = D.escenariosCobro(state, r.id, t, { montos: [m] });
    const una = e2 && e2.escenarios.find((x) => x.monto === m);
    if (!una) { resultado.replaceChildren(h('p', { class: 't-body' }, 'Con ese monto te lo devolvería de una vez.')); return; }
    const o = L.opcionesCuota({ ...e2, escenarios: [una] }, F)[0];
    resultado.replaceChildren(h('p', { class: 't-body' }, ui.txt(o.sub)), una.advertencia ? ui.notice({ tone: 'warn', title: una.advertencia }) : null);
  };
  const guardarOtra = () => {
    if (!(montoOtro > 0)) { campoOtro.setError('Poné cuánto te devolvería por mes.'); campoOtro.focus(); return; }
    const monto = montoOtro;
    ctx.update((d) => { L.fijarCuota(d, r.id, monto); }, { undoLabel: `Listo: la cuota de ${persona.nombre} quedó en ${F.money(monto)} por mes.` });
  };
  campoOtro.onChange(debounce(mostrar, 250));
  const cajaOtro = h('div', { class: 'stack-3' }, campoOtro.el, resultado, botonUsar);
  cajaOtro.hidden = valorInicial !== 'otro';
  mostrar();

  const cuotas = h('div', { class: 'stack-3' },
    ui.sectionTitle('¿Cuánto te devolvería por mes?', null),
    grupo, cajaOtro,
    esc.advertenciaActual ? ui.notice({ tone: 'warn', title: esc.advertenciaActual }) : null);

  // ---------------------------------------------------------------- interés opcional (el de la tarjeta)
  let bloqueInteres = null;
  if (interes || Number(r.rate) > 0) {
    const tasaCobro = interes ? interes.rate : Number(r.rate);
    const campo = ui.fields.toggle({
      label: 'Le cobro el interés de lo suyo',
      hint: ui.txt(interes ? interes.texto : `Se suma el ${F.pct(r.rate)} por mes a lo que te debe.`),
      value: Number(r.rate) > 0, name: `interes-${r.id}`,
      onChange: (on) => { ctx.update((d) => { L.fijarInteres(d, r.id, on ? tasaCobro : 0); }, { undoLabel: on ? 'Listo: se le suma el interés.' : 'Listo: sin interés.' }); },
    });
    bloqueInteres = ui.card([campo.el, Number(r.rate) > 0 && esc.interesPorMes > 0 ? ui.kv([{ label: 'Interés que se suma por mes', value: ui.amt(esc.interesPorMes) }]) : null].filter(Boolean), { cls: 'stack-3' });
  }

  // ---------------------------------------------------------------- historial "Te pagó"
  const pagos = h('div', { class: 'stack-3' },
    ui.sectionTitle('Te pagó', { label: 'Anotar pago', onClick: () => abrirEditor(ctx, 'receivablePayment', r.id, { personId: persona.personId }) }),
    historial.length
      ? ui.rowList(historial.map((p) => ui.row({
        icon: 'tilde', tone: 'ok', title: L.fechaCorta(F, p.date, t), sub: L.TEXTO_DESTINO[p.destino] || undefined, value: ui.amt(p.amount),
      })), { ariaLabel: 'Pagos que te hizo' })
      : ui.footnote('Todavía no anotaste ningún pago.'));

  // ---------------------------------------------------------------- acciones
  const acciones = h('div', { class: 'actions' },
    ui.btn({ label: 'Anotar un pago', icon: 'mas', onClick: () => abrirEditor(ctx, 'receivablePayment', r.id, { personId: persona.personId }) }),
    ui.btn({ label: 'Mandarle la cuenta por WhatsApp', variant: 'secondary', icon: 'whatsapp', onClick: () => abrirMensaje(ctx, r.id, cuotaActual > 0 ? cuotaActual : 0) }),
    ui.btn({ label: 'Editar lo que te debe', variant: 'text', onClick: () => abrirEditor(ctx, 'receivable', r.id) }));

  return h('div', { class: 'stack' }, deuda, cuotas, bloqueInteres, pagos, acciones);
}
