// _hoy-sheets.js · hojas que nacen en Hoy y en Meses (spec 6.3 y 6.12):
//   A "Referencia para gastar hoy" · B "Enero: faltan $X" (formas de cubrir un mes difícil) · C "Salís de la tarjeta" con
//   "Qué supone esta fecha" · cierre de mes · hito (cuota o deuda que terminó) · elegir a quién se le anota un pago.
// Toda cifra sale de ctx.derive; los guardados pasan por ctx.update (con Deshacer) y por ctx.editors (lo escribe S4).

import { aplicarCambios, ajustarGastosCasa, marcarVisto } from '../../store.js';
import { cap, quienPaga } from './_hoy-logic.js';

/** Abre un editor de S4 sin romper nada si todavía no existe o falla. Siempre devuelve { saved }. */
export async function abrirEditor(ctx, kind, id, opts) {
  try {
    const res = await ctx.editors.open(kind, id, opts);
    return res && typeof res === 'object' ? res : { saved: false };
  } catch (e) {
    console.error(`[Hoy] el editor "${kind}" no se pudo abrir`, e);
    ctx.toast('Esta opción se está terminando de construir.');
    return { saved: false };
  }
}

/** Filas "Falta un dato" (borde punteado azul) para Hoy y Meses. `pendientes` sale de _hoy-logic.pendientesVisibles. */
export function filasPendientes(ctx, pendientes) {
  if (!pendientes?.length) return null;
  const { ui } = ctx;
  return ui.rowList(pendientes.map((p) => ui.row({
    icon: 'documento', tone: 'info', title: p.titulo, sub: p.texto, chip: { label: 'Completar', tone: 'info' }, pending: true, onClick: () => ctx.nav(p.hash),
  })), { ariaLabel: 'Datos que faltan' });
}

/**
 * Título de una opción (optionGroup) en UN solo nodo: el kit lo pone en un contenedor flex, y si el texto trae un monto
 * se parte en pedazos sueltos ("Apartar" / "$202.000" / "del aguinaldo") que se acomodan en renglones distintos.
 */
const textoUnido = (ui, texto) => ui.h('span', null, ui.txt(texto));

const tasaMayor = (state) => Math.max(0, ...(state.debts || []).filter((d) => d.kind === 'card').map((d) => Number(d.rate) || 0));

// ============================================================================================ A · Para gastar hoy
/** Hoja A: la referencia por día, cómo se calcula, anotar un gasto y "gustos vs. salir antes de la tarjeta". */
export function abrirGastarHoy(ctx) {
  const { ui, format: F } = ctx;
  const { h } = ui;
  const D = ctx.derive;
  const t = ctx.today();
  const state = ctx.state;
  const g = D.paraGastarHoy(state, t);
  const esc = D.gustosEscenarios(state, t);

  ctx.sheet.open({
    title: 'Referencia para gastar hoy',
    render(body, close) {
      const nodos = [];
      if (g.estado === 'ok') {
        nodos.push(ui.stat({ label: 'Para tus gustos, por día', value: ui.amt(g.porDia), valueClass: 'display', sub: `hasta el ${g.hastaFecha}` }));
        nodos.push(h('div', { class: 'stack-1' },
          h('h3', { class: 't-h2' }, 'Cómo lo calculamos'),
          h('p', { class: 't-body' }, ui.txt(g.calculo))));
      } else {
        nodos.push(h('p', { class: 't-body' }, ui.txt(g.texto)));
      }
      if (g.gustos > 0) {
        nodos.push(h('div', { class: 'stack-2' },
          h('p', { class: 't-label' }, ui.txt(`Ya anotaste ${F.money(g.gastado)} de ${F.money(g.gustos)} en gustos`)),
          ui.progressBar({ value: Math.min(g.gastado, g.gustos), max: g.gustos, tone: g.gastado >= g.gustos ? 'warn' : 'brand', label: 'Lo que ya anotaste en gustos este mes' }),
          ui.footnote('Es una referencia: si anotás tus gastos se vuelve exacto.')));
      }

      if (esc.hayGustos) {
        const holder = h('div');
        const pintar = (v) => {
          holder.replaceChildren();
          if (Number(v) === esc.actual) return;
          holder.append(ui.btn({ label: `Usar ${F.money(Number(v))} por mes`, variant: 'secondary', onClick: () => usar(Number(v)) }));
        };
        const usar = (monto) => {
          ctx.update((d) => {
            const e = d.expenses.find((x) => x.id === esc.gustosId);
            if (e) { e.amount = monto; delete e.estimated; }
          }, { undoLabel: 'Listo, cambiamos tu plan.' });
          close();
        };
        const opciones = esc.escenarios.map((e) => {
          const interes = `interés total ${F.money(Math.round(e.interesTotal))}`;
          const sub = esc.hayTarjeta ? `${e.salida ? `Salís de la tarjeta en ${e.salidaTexto}` : 'La tarjeta no se termina'} · ${interes}` : cap(interes);
          return { value: String(e.monto), title: textoUnido(ui, `${F.money(e.monto)} por mes`), sub, tag: e.esActual ? 'Lo que tenés hoy' : undefined, tagTone: 'brand' };
        });
        nodos.push(h('div', { class: 'stack-3' },
          h('h3', { class: 't-h2' }, 'Gustos y salir antes de la tarjeta'),
          ui.optionGroup({ name: 'gustos-escenarios', value: String(esc.actual), options: opciones, onChange: pintar, ariaLabel: 'Cuánto por mes para tus gustos' }),
          holder,
          esc.notaPie ? ui.footnote(esc.notaPie) : null));
      }
      nodos.push(ui.disclaimer());
      body.append(h('div', { class: 'stack-4' }, nodos));
    },
    footer: (close) => ui.btn({
      label: 'Anoté un gasto', icon: 'mas',
      onClick: async () => { const r = await abrirEditor(ctx, 'spent', null, { cat: 'gustos' }); if (r.saved) close(); },
    }),
  });
}

// ============================================================================================ B · Mes difícil
/** Hoja B: las formas de cubrir un mes con falta (opcionesMesDificil). */
export function abrirMesDificil(ctx, key) {
  const { ui, format: F } = ctx;
  const { h } = ui;
  const D = ctx.derive;
  const state = ctx.state;
  const o = D.opcionesMesDificil(state, key, ctx.today());
  if (!o) { ctx.toast('Ese mes todavía no está en tu plan.'); return; }
  const nombre = cap(o.mesNombre);
  if (!o.hayProblema) {
    ctx.sheet.info({ title: nombre, content: h('div', { class: 'stack-3' }, h('p', { class: 't-body' }, `Con lo que cargaste, en ${o.mesNombre} no falta plata.`), ui.disclaimer()) });
    return;
  }
  const disponibles = o.opciones.filter((x) => x.disponible);
  const noDisponibles = o.opciones.filter((x) => !x.disponible);
  // derive dice "La deuda sube a $X": no siempre es cierto (a veces la deuda baja igual), así que se dice "queda en".
  // "Es lo más barato." tampoco se muestra: suena a recomendación de endeudarse y a veces contradice a otra opción ("ahorrás $X de interés").
  // El costo de cada forma ya está dicho en su propio texto ("te cuesta $X más de interés", "ahorrás $X").
  const texto = (op) => String(op.texto || '').replace('La deuda sube a ', 'La deuda queda en ').replace(/^Es lo más barato\.\s*/, '');
  let elegido = 'tarjeta';

  ctx.sheet.open({
    title: `${nombre}: faltan ${F.money(o.faltante)}`,
    render(body) {
      const tasa = tasaMayor(state);
      const hayReserva = disponibles.some((x) => x.id === 'reserva');
      const grupo = ui.optionGroup({
        name: 'mes-dificil', value: elegido, ariaLabel: `Cómo cubrir lo que falta en ${o.mesNombre}`,
        options: disponibles.map((x) => ({ value: x.id, title: textoUnido(ui, x.titulo), sub: texto(x), tag: x.etiqueta || undefined, tagTone: 'brand' })),
        onChange: (v) => { elegido = v; },
      });
      body.append(h('div', { class: 'stack-4' },
        h('p', { class: 't-body' }, ui.txt(o.intro)),
        hayReserva
          ? ui.footnote(`Que lo cubra la tarjeta es lo que pasa si no hacés nada, no una recomendación. Apartar plata de antes cuesta algo porque ese mes pagás menos de la tarjeta${tasa > 0 ? `, que cobra ${F.pct(tasa)} por mes` : ''}.`)
          : null,
        grupo,
        noDisponibles.length ? h('div', { class: 'stack-1' }, noDisponibles.map((x) => h('p', { class: 't-small faint' }, ui.txt(`${x.titulo}: ${x.texto}`)))) : null,
        ui.footnote(o.pie || 'Es una estimación con los datos que cargaste. No es asesoramiento financiero.')));
    },
    footer: (close) => ui.btn({
      label: 'Elegir este plan',
      onClick: () => {
        const op = disponibles.find((x) => x.id === elegido);
        if (!op) return;
        if (op.id === 'tarjeta' || !op.cambios || !Object.keys(op.cambios).length) {
          ctx.toast('Listo, seguimos con el plan de hoy.');
          close();
          return;
        }
        const queda = Number(op.faltanteDespues) > 0 ? ` Todavía faltarían ${F.money(op.faltanteDespues)}.` : '';
        ctx.update((d) => { aplicarCambios(d, op.cambios); }, { undoLabel: `Listo, cambiamos tu plan.${queda}` });
        close();
      },
    }),
  });
}

// ============================================================================================ C · Salís de la tarjeta
/**
 * Hoja C: cuándo termina la tarjeta con tu plan y con solo el mínimo, y "Qué supone esta fecha".
 * { irASupone: true } deja a la vista la explicación de lo que supone la fecha (así abre el enlace "Qué supone esta fecha").
 */
export function abrirSalida(ctx, { irASupone = false } = {}) {
  const { ui, charts, format: F } = ctx;
  const { h } = ui;
  const D = ctx.derive;
  const t = ctx.today();
  const state = ctx.state;
  const s = D.salidaTarjeta(state, t);
  if (!s.hayTarjeta) return;
  const curva = D.curvaDeuda(state, t);
  const pago = D.escenariosPago(state, t);
  const titulo = s.estado === 'fecha' ? `Salís de la tarjeta: ${s.mesNombre}` : 'Salís de la tarjeta';

  ctx.sheet.open({
    title: titulo,
    render(body) {
      const nodos = [];
      if (s.etiqueta) {
        nodos.push(h('div', { class: 'stack-2' },
          h('div', { class: 'cluster' }, ui.chip(s.etiqueta, { tone: 'info', icon: 'info' })),
          ...(s.motivos || []).map((m) => h('p', { class: 't-small muted' }, ui.txt(m)))));
      }
      if (s.estado === 'fecha' || s.estado === 'muyLejos' || s.estado === 'noTermina') {
        // cada línea termina en el mes en que la deuda llega a cero (así la etiqueta queda donde corresponde)
        const hasta = (puntos, fin_) => puntos.filter((p) => !fin_ || p.key <= fin_).map((p) => ({ key: p.key, value: p.deuda }));
        const lbl = (n) => (n ? charts.longMonth(n) : null);
        const primero = curva.plan[0]?.deuda ?? 0;
        const fin = lbl(curva.planTermina);
        const finMin = lbl(curva.minimoTermina);
        const aria = `La deuda de la tarjeta baja de ${ui.srMoney(primero)} ${fin ? `a cero en ${fin} con tu plan` : 'con tu plan, pero no llega a cero en el plazo del gráfico'}${finMin ? `, y llega a cero en ${finMin} pagando solo el mínimo` : ''}.`;
        nodos.push(h('div', { class: 'stack-2' },
          h('h3', { class: 't-h2' }, 'Cómo baja la deuda'),
          charts.debtLine({
            series: [
              { name: 'Tu plan', points: hasta(curva.plan, curva.planTermina), style: 'solid', endLabel: fin || undefined },
              { name: 'Solo el mínimo', points: hasta(curva.soloMinimo, curva.minimoTermina), style: 'dashed', endLabel: finMin || undefined },
            ],
            ariaLabel: aria, tableCaption: 'Deuda de la tarjeta mes a mes, con tu plan y pagando solo el mínimo',
          }),
          ui.footnote('Línea llena: tu plan. Línea punteada: solo el mínimo.')));
      } else {
        nodos.push(h('p', { class: 't-body' }, ui.txt(s.texto || '')));
      }

      if (pago.estado === 'ok') {
        const min = pago.opciones.find((x) => x.id === 'minimo');
        const sobra = pago.opciones.find((x) => x.id === 'sobra');
        if (min && sobra) {
          nodos.push(h('div', { class: 'stack-2' },
            h('h3', { class: 't-h2' }, 'Con el mínimo o con lo que sobra'),
            ui.kv([
              { label: 'Solo con el mínimo', hint: `interés total ${F.money(Math.round(min.totalInterest))}`, value: min.salidaTexto },
              { label: 'Con lo que sobra', hint: `interés total ${F.money(Math.round(sobra.totalInterest))}`, value: sobra.salidaTexto },
              sobra.ahorro > 1 ? { label: 'Ahorrás de interés', value: F.money(Math.round(sobra.ahorro)), strong: true, tone: 'ok' } : null,
            ])));
        }
      }

      const supone = h('div', { class: 'stack-3', id: 'que-supone', tabindex: '-1' },
        h('h3', { class: 't-h2' }, 'Qué supone esta fecha'),
        h('p', { class: 't-body' }, `${s.supuesto}.`),
        h('ul', { class: 'stack-2' }, (s.queSupone || []).map((x) => h('li', { style: { display: 'flex', gap: '.625rem', alignItems: 'flex-start' } },
          h('span', { class: 'brand', 'aria-hidden': 'true' }, '•'),
          h('span', { class: 't-body' }, ui.txt(x))))));
      nodos.push(supone, ui.disclaimer());
      body.append(h('div', { class: 'stack-6' }, nodos));
      if (irASupone) requestAnimationFrame(() => { try { supone.scrollIntoView({ block: 'start' }); supone.focus({ preventScroll: true }); } catch { /* nada */ } });
    },
    footer: () => ui.btn({ label: 'Ver la tarjeta', onClick: () => ctx.nav('#/deudas/tarjeta') }),
  });
}

// ============================================================================================ cierre de mes
/** Hoja del cierre de mes: "¿Cómo te fue en septiembre?" Todo es opcional y sin tono de examen. */
export function abrirCierre(ctx) {
  const { ui, format: F } = ctx;
  const { h } = ui;
  const D = ctx.derive;
  const t = ctx.today();
  const base = D.cierreDeMes(ctx.state, t);
  const previstos = D.cierreDeMes(ctx.state, t, { gastoTotal: 0 }).resultado?.previstos ?? 0;

  const gasto = ui.fields.money({ label: `Lo que gastaste en total en ${base.mesNombre}`, hint: 'Sumá la casa y tus gustos. No cuentes la tarjeta ni los préstamos.', big: false, name: 'gasto', placeholder: 'Ej: 700.000' });
  const visa = ui.fields.money({ label: 'Lo que pagaste de la tarjeta', hint: 'Si no te acordás, dejalo vacío.', big: false, name: 'visa', placeholder: 'Ej: 300.000' });
  const salida = h('div', { class: 'stack-2', role: 'status', 'aria-live': 'polite' });
  let handle;
  let resultado = null;

  const marcarYCerrar = (extra) => {
    ctx.update((d) => { extra?.(d); marcarVisto(d, 'cierres', base.mes); }, extra ? { undoLabel: 'Listo, ajustamos tus gastos de la casa.' } : {});
    handle?.close();
  };
  const pintarPie = () => {
    const ajustar = resultado?.boton
      ? ui.btn({ label: resultado.boton, onClick: () => marcarYCerrar((d) => { ajustarGastosCasa(d, resultado.sugerido); }) })
      : null;
    handle?.setFooter(h('div', { class: 'stack-2' },
      ajustar,
      ui.btn({ label: ajustar ? 'Seguir con mis gastos como están' : 'Listo', variant: ajustar ? 'text' : 'primary', onClick: () => marcarYCerrar() })));
  };
  const repintar = () => {
    const gt = gasto.get();
    if (gt == null) { resultado = null; salida.replaceChildren(); pintarPie(); return; }
    const c = D.cierreDeMes(ctx.state, t, { gastoTotal: gt, pagoVisa: visa.get() });
    resultado = c.resultado;
    const r = c.resultado;
    salida.replaceChildren(ui.card([
      h('p', { class: 't-row' }, ui.txt(r.texto)),
      h('p', { class: 't-body' }, ui.txt(`Con eso, calculamos que te sobraron unos ${F.money(Math.round(r.sobroReal))} (esperábamos ${F.money(Math.round(c.esperado))}).`)),
      r.pagoVisa != null ? h('p', { class: 't-small muted' }, ui.txt(`Pagaste ${F.money(r.pagoVisa)} de la tarjeta.`)) : null,
    ], { tone: 'info', cls: 'stack-2' }));
    pintarPie();
  };
  gasto.onChange(repintar);
  visa.onChange(repintar);

  handle = ctx.sheet.open({
    title: base.pregunta,
    render(body) {
      body.append(h('div', { class: 'stack-4' },
        h('p', { class: 't-body' }, ui.txt(`${base.textoEsperado}. Si querés, contame cómo te fue y ajustamos tus gastos. Es opcional.`)),
        previstos > 0 ? h('p', { class: 't-small muted' }, ui.txt(`Entre la casa y tus gustos teníamos previstos ${F.money(previstos)} por mes.`)) : null,
        gasto.el, visa.el, salida));
    },
  });
  pintarPie();
  return handle;
}

// ============================================================================================ hito
/** Hoja de hito (6.12): "¡Se terminó!". Sobria: sin confeti ni sonido. `hitos` = D.hitos(...). */
export function abrirHitos(ctx, hitos) {
  const { ui } = ctx;
  const { h } = ui;
  if (!hitos?.length) return null;
  const compartir = async (texto) => {
    const mensaje = `${texto} (Mis Cuentas)`;
    try {
      if (navigator.share) { await navigator.share({ text: mensaje }); return; }
      await navigator.clipboard.writeText(mensaje);
      ctx.toast('Listo, copiamos el mensaje para que se lo mandes.');
    } catch { /* si cancela el menú de compartir no pasa nada */ }
  };
  return ctx.sheet.open({
    title: hitos.length > 1 ? 'Buenas noticias' : 'Una buena noticia',
    render(body, close) {
      body.append(h('div', { class: 'stack-3' }, hitos.map((x) => ui.milestone({
        title: x.titulo, text: x.texto,
        action: { label: 'Seguir', onClick: () => close() },
        secondary: { label: 'Contárselo a la familia', icon: 'compartir', onClick: () => compartir(x.texto) },
      }))));
    },
  });
}

// ============================================================================================ anotar que me pagaron
/** "Anoté que me pagaron": si te debe una sola persona abre directo el editor; si son varias, primero se elige quién. */
export async function abrirCobro(ctx) {
  const { ui, format: F } = ctx;
  const { h } = ui;
  const q = quienPaga(ctx.derive, ctx.state, ctx.today());
  if (q.modo === 'ninguno') { ctx.toast('Todavía no cargaste a nadie que te deba plata.'); return { saved: false }; }
  const abrir = (p) => abrirEditor(ctx, 'receivablePayment', p.receivableId, { personId: p.personId });
  if (q.modo === 'uno') return abrir(q.personas[0]);
  return new Promise((resolve) => {
    let guardado = false;
    ctx.sheet.open({
      title: '¿Quién te pagó?',
      render(body, close) {
        body.append(ui.rowList(q.personas.map((p) => ui.row({
          icon: 'usuarios', tone: 'info', title: ui.personName(p.nombre, p.index), sub: `Te debe ${F.money(p.balance)}`,
          onClick: async () => { const r = await abrir(p); if (r.saved) { guardado = true; close(); } },
        }))));
        body.append(h('div', { style: { height: '.5rem' } }));
      },
      onClose: () => resolve({ saved: guardado }),
    });
  });
}
