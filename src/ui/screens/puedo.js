// puedo.js · "Probá antes de gastar" (barra inferior: ¿Me alcanza?).
// Se escribe qué se quiere comprar, cuánto cuesta (precio total y cuotas, cada uno calculado en vivo desde el otro),
// cómo se paga y en qué mes. La pantalla muestra, mes por mes, si esa compra "Sin costo / Con costo / No conviene"
// (mapaMeses), un veredicto en vivo (veredicto) y la pregunta inversa "¿Cuánto puedo gastar en {mes} sin que me cueste?"
// (topeSinCosto). Todas las cifras salen de derive.js; la lógica del formulario vive en _puedo-logic.js.
// Nada se guarda hasta tocar "Lo voy a hacer": ahí se crea una compra planificada (no un gasto anotado, así no se duplica).

import { debounce, reducedMotion } from '../dom.js';
import { crearCompraPlanificada } from '../../store.js';
import * as L from './_puedo-logic.js';

// El borrador sobrevive a los re-render (ojo de privacidad, un cambio de estado) pero no se guarda en el celular.
let DRAFT = null;

// Meses por fila del mapa (se ven los 12 sin deslizar hacia el costado): 4 en el celular y en la columna de escritorio, 6 en tablet.
const TABLET = '(min-width: 640px) and (max-width: 1023.98px)';

export default {
  id: 'puedo',
  title: 'Probá antes de gastar',

  mount(root, ctx, params, route) {
    const { ui, derive, format } = ctx;
    const { h } = ui;
    const fields = ui.fields;
    const state = ctx.state;
    const today = ctx.today();
    const start = format.monthKeyOf(today);

    const money = (n) => format.money(n);
    const mesLargo = (k) => format.monthName(k, { year: true });
    const MesLargo = (k) => format.monthName(k, { year: true, capital: true });
    const mesCorto = (k) => format.monthName(k, { short: true });
    const mesSolo = (k) => format.monthName(k);
    const MesSolo = (k) => format.monthName(k, { capital: true });

    ctx.header({ title: '' }); // el título grande va en la pantalla
    const titulo = ui.pageTitle('Probá antes de gastar', 'Escribí qué querés comprar y fijate si te alcanza. No se guarda nada hasta que vos digas.');

    // ---------------------------------------------------------------- sin datos: no hay nada que probar todavía
    const hero = derive.hero(state, today);
    if (hero.estado === 'sinDatos' || hero.estado === 'sinIngresos') {
      root.append(
        titulo,
        ui.empty({
          art: 'barras',
          title: 'Para decirte si te alcanza, primero tengo que saber cuánto entra y cuánto sale.',
          text: 'Cargá tus ingresos y tus gastos, y después probás cualquier compra antes de hacerla.',
          action: { label: 'Cargar mis datos', onClick: () => ctx.nav(hero.accion.ruta) },
          secondary: { label: 'Ver cómo se ve con un ejemplo', onClick: () => ctx.nav('#/bienvenida') },
        }),
      );
      return undefined;
    }

    // ---------------------------------------------------------------- el formulario (vive mientras no se anote ni se limpie)
    if (!DRAFT || DRAFT.start !== start) DRAFT = L.formNuevo(start);
    const form = DRAFT;
    const qMes = route?.query?.mes;
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(qMes || '') && qMes >= start) form.desde = qMes;
    if (form.desde < start) form.desde = start;
    L.sincronizar(form);

    let totalF = null;
    let cuotaF = null;
    let cuotasF = null;
    let porMesF = null;
    let ultimoMapa = null;
    let token = 0;
    let gone = false;

    const soltarTeclado = () => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); };

    // ------ qué querés comprar
    const nombreF = fields.text({
      label: '¿Qué querés comprar?', value: form.nombre, name: 'nombre', maxLength: 40, placeholder: 'Por ejemplo: heladera',
      onChange: (v) => { form.nombre = v; pintarChips(); programar(); },
      onEnter: soltarTeclado,
    });
    const chipsEl = h('div', { class: 'chips', role: 'group', 'aria-label': 'Ideas para completar' });
    function pintarChips() {
      const foco = document.activeElement && chipsEl.contains(document.activeElement) ? [...chipsEl.children].indexOf(document.activeElement.closest('.chipbtn')) : -1;
      chipsEl.replaceChildren(...L.SUGERENCIAS.map((s) => ui.chipButton(s, {
        selected: form.nombre.trim() === s,
        onClick: () => { form.nombre = s; nombreF.set(s); pintarChips(); programar(true); },
      })));
      if (foco >= 0) chipsEl.children[foco]?.focus({ preventScroll: true });
    }

    // ------ cómo lo pagás
    const modoF = fields.choice({
      label: '¿Cómo lo pagás?', variant: 'segmented', options: L.MODOS, value: form.modo,
      onChange: (v) => { form.modo = v; L.sincronizar(form); pintarDinero(); pintarEtiquetaMes(); programar(true); },
    });

    // ------ cuánto cuesta (precio total y cuotas, en vivo en los dos sentidos)
    const dineroEl = h('div', { class: 'stack-4' });
    const resumenEl = h('p', { class: 'puedo-resumen', style: { padding: 'var(--s3) var(--s4)', borderRadius: 'var(--r-btn)', background: 'var(--surface-2)' } });
    function refrescarResumen() {
      const t = L.resumenCuotas(form, money);
      resumenEl.className = `puedo-resumen ${t ? 't-row' : 't-small muted'}`;
      resumenEl.replaceChildren(...[].concat(ui.txt(t || 'Escribí el precio total, o lo que te dicen de cada cuota, y te calculo el otro.')));
    }
    function pintarDinero() {
      totalF = null; cuotaF = null; cuotasF = null; porMesF = null;
      if (form.modo === 'mensual') {
        porMesF = fields.money({
          label: 'Cuánto por mes', value: form.porMes, name: 'porMes',
          hint: 'Un gasto que se repite todos los meses, por ejemplo una suscripción. Se suma desde el mes que elijas.',
          onChange: (n) => { form.porMes = n; programar(); }, onEnter: soltarTeclado,
        });
        dineroEl.replaceChildren(porMesF.el);
        return;
      }
      totalF = fields.money({
        label: 'Precio total', value: form.total, name: 'total',
        onChange: (n) => { form.total = n; form.anchor = 'total'; L.sincronizar(form); cuotaF?.set(form.cuota); refrescarResumen(); programar(); },
        onEnter: soltarTeclado,
      });
      const kids = [totalF.el];
      if (form.modo === 'cuotas') {
        cuotasF = fields.stepper({
          label: 'En cuántas cuotas', value: form.cuotas, min: L.CUOTAS_MIN, max: L.CUOTAS_MAX,
          onChange: (n) => { form.cuotas = n; L.sincronizar(form); totalF.set(form.total); cuotaF.set(form.cuota); refrescarResumen(); programar(); },
        });
        cuotaF = fields.money({
          label: 'Cada cuota', value: form.cuota, big: false, name: 'cuota',
          hint: 'Si ya sabés de cuánto es la cuota, escribila y te calculo el precio total.',
          onChange: (n) => { form.cuota = n; form.anchor = 'cuota'; L.sincronizar(form); totalF.set(form.total); refrescarResumen(); programar(); },
          onEnter: soltarTeclado,
        });
        kids.push(cuotasF.el, cuotaF.el, resumenEl);
      }
      dineroEl.replaceChildren(...kids);
      refrescarResumen();
    }

    // ------ cuándo: mapa de 12 meses con su veredicto, leyenda fija en palabras y la pregunta inversa
    const etiquetaMesEl = h('span', { class: 'field-label', id: 'puedo-mes-l' });
    function pintarEtiquetaMes() {
      etiquetaMesEl.textContent = form.modo === 'una' ? '¿En qué mes lo pagás?' : form.modo === 'cuotas' ? '¿En qué mes pagás la primera cuota?' : '¿Desde qué mes?';
    }
    const mqTablet = typeof matchMedia === 'function' ? matchMedia(TABLET) : null;
    const porFila = mqTablet && mqTablet.matches ? 6 : 4;
    const alCambiarAncho = () => ctx.rerender();
    mqTablet?.addEventListener?.('change', alCambiarAncho);
    const claves = L.clavesDoce(start);
    const itemsDe = (mapa) => claves.map((k) => {
      const m = mapa && mapa.meses.find((x) => x.key === k);
      return { key: k, label: mesCorto(k), state: m ? m.codigo : null, ariaLabel: m ? `${MesLargo(k)}: ${m.etiqueta}` : MesLargo(k) };
    });
    const filasMapa = L.enFilas(itemsDe(null), porFila);
    const mapas = filasMapa.map((fila) => {
      const m = ui.monthMap({ items: fila, value: form.desde, ariaLabel: `${MesLargo(fila[0].key)} a ${mesLargo(fila[fila.length - 1].key)}`, onChange: elegirMes });
      m.style.justifyContent = 'space-between';
      return m;
    });
    const mapaEl = h('div', { class: 'stack-1', role: 'group', 'aria-labelledby': 'puedo-mes-l' }, ...mapas);
    const notaMapaEl = h('p', { class: 't-small muted' });
    const topeEl = h('section', { class: 'card pad-md stack-2', 'aria-label': 'Hasta cuánto podés gastar' });
    const ejemplosEl = h('div', { class: 'stack-2' });

    function pintarMapa(mapa, { conNota = true } = {}) {
      const foco = document.activeElement && mapaEl.contains(document.activeElement) ? document.activeElement.closest('.mm')?.dataset.key : null;
      const filas = L.enFilas(itemsDe(mapa), porFila);
      mapas.forEach((m, i) => m.setItems(filas[i], form.desde));
      if (foco) mapaEl.querySelector(`.mm[data-key="${foco}"]`)?.focus({ preventScroll: true });
      if (!conNota) return;
      let nota = 'Escribí cuánto cuesta y te marco cómo queda cada mes.';
      if (mapa) nota = mapa.mejorMomento ? `Mejor momento ${form.modo === 'una' ? 'para pagarlo' : 'para empezar'}: ${mapa.mejorMomento.mesNombre}.` : (mapa.textoSinMejor || '');
      notaMapaEl.className = mapa && !mapa.mejorMomento ? 't-small tone-warn' : 't-small muted';
      notaMapaEl.replaceChildren(...[].concat(ui.txt(nota)));
    }

    function elegirMes(key) {
      form.desde = key;
      mapas.forEach((m) => m.setValue(key));
      mapaEl.querySelector('.mm.on')?.focus({ preventScroll: true });
      calcular({ conMapa: false });
    }

    function pintarTope(tope) {
      const vt = L.vistaTope(tope, { money });
      topeEl.replaceChildren(...[
        h('h2', { class: 't-h2' }, vt.titulo),
        vt.destacado ? h('p', { class: 't-big num' }, ui.txt(vt.destacado)) : null,
        ...vt.lineas.map((l) => h('p', { class: 't-body' }, ui.txt(l))),
        vt.sugerido > 0 ? ui.btn({
          label: `Probar con ${money(vt.sugerido)}`, variant: 'text', inline: true,
          onClick: () => probarMonto(vt.sugerido),
        }) : null,
      ].filter(Boolean));
    }

    // probar con un monto sugerido: el campo de precio (o de por mes) pasa a ese número
    function probarMonto(n) {
      if (form.modo === 'mensual') { form.porMes = n; porMesF?.set(n); } else { form.total = n; form.anchor = 'total'; L.sincronizar(form); totalF?.set(n); cuotaF?.set(form.cuota); refrescarResumen(); }
      calcular();
    }

    // ---------------------------------------------------------------- el resultado (en vivo, anunciado a lectores de pantalla)
    const resultEl = h('div', { class: 'stack-3' });
    // lo que se anuncia a lectores de pantalla: el veredicto en una frase (no todos los botones y filas)
    const vivoEl = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
    let primerCalculo = true;
    function anunciar(frase) {
      if (primerCalculo) { primerCalculo = false; return; } // al abrir la pantalla no se anuncia nada
      vivoEl.replaceChildren(...[].concat(ui.txt(frase)));
    }

    // En el celular el resultado queda más abajo que el formulario: una barra fija lo resume y lleva hasta él.
    const barraEl = h('button', {
      type: 'button', class: 'puedo-barra', hidden: true,
      // sticky y no fixed: el contenedor de la pantalla tiene una animación de entrada que se vuelve su bloque contenedor
      style: {
        position: 'sticky', zIndex: '15',
        bottom: 'calc(var(--tabbar-h) + env(safe-area-inset-bottom, 0px) + var(--s2))',
        display: 'flex', alignItems: 'center', gap: 'var(--s3)', minHeight: '56px', padding: '0 var(--s4)',
        borderRadius: 'var(--r-btn)', border: '2px solid currentColor', boxShadow: 'var(--shadow-sheet)', fontWeight: '800',
      },
      onclick: () => resultEl.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' }),
    });
    let conVeredicto = false;
    let resultadoAbajo = false;
    let escribiendo = false; // con el teclado abierto la barra taparía el campo
    function pintarBarra(v) {
      conVeredicto = !!v;
      if (v) {
        const st = ui.statusInfo(v.codigo);
        barraEl.className = `puedo-barra tone-bg-${st.tone}`;
        const resumen = `${st.label} en ${mesSolo(form.desde)}`;
        barraEl.setAttribute('aria-label', `Ver el resultado: ${resumen}`);
        barraEl.replaceChildren(ui.icon(st.shape), h('span', { class: 'grow t-row', style: { textAlign: 'left' } }, resumen), h('span', { class: 't-small' }, 'Ver'), ui.icon('chevron'));
      }
      mostrarBarra();
    }
    function mostrarBarra() {
      const ancho = typeof matchMedia === 'function' && matchMedia('(min-width: 1024px)').matches;
      barraEl.hidden = !(conVeredicto && resultadoAbajo && !ancho && !escribiendo);
    }
    const campo = (e) => e.target instanceof Element && e.target.matches('input, textarea');
    root.addEventListener('focusin', (e) => { if (campo(e)) { escribiendo = true; mostrarBarra(); } });
    root.addEventListener('focusout', (e) => { if (campo(e)) { escribiendo = false; mostrarBarra(); } });
    let observador = null;
    if (typeof IntersectionObserver === 'function') {
      observador = new IntersectionObserver((entradas) => {
        const e = entradas[entradas.length - 1];
        resultadoAbajo = !e.isIntersecting && e.boundingClientRect.top > 0;
        mostrarBarra();
      }, { rootMargin: '0px 0px -96px 0px' });
    }

    function viejo(on) {
      vivoEl.setAttribute('aria-busy', on ? 'true' : 'false');
      resultEl.style.opacity = on ? '.5' : '';
    }

    function pintarResultado(r) {
      ejemplosEl.replaceChildren();
      pintarBarra(r.vacio ? null : r.v);
      if (r.vacio) { resultEl.replaceChildren(ui.notice({ tone: 'info', title: 'Poné cuánto cuesta', text: 'Y te digo si te alcanza, mes por mes.' })); ejemplosEl.replaceChildren(ejemplos()); anunciar('Poné cuánto cuesta y te digo si te alcanza.'); return; }
      const v = r.v;
      const texto = v.codigo === 'verde' ? L.textoVerde(mesLargo(form.desde), form.modo) : L.sinTitulo(v.titulo, v.texto);
      anunciar(`${v.titulo}. ${texto} ${v.siLoNecesitas ? v.siLoNecesitas.texto : ''}`.trim());
      const pie = [];
      if (v.siLoNecesitas) {
        pie.push(h('p', { class: 't-body', style: { fontWeight: '700' } }, ui.txt(v.siLoNecesitas.texto)));
        if (v.siLoNecesitas.key && v.siLoNecesitas.key !== form.desde) {
          pie.push(ui.btn({ label: `Probar en ${mesLargo(v.siLoNecesitas.key)}`, variant: 'secondary', onClick: () => elegirMes(v.siLoNecesitas.key) }));
        }
      }
      const vEl = ui.verdict({
        code: v.codigo, title: v.titulo, text: texto, rows: L.filasVeredicto(v),
        footer: pie.length ? h('div', { class: 'stack-3', style: { marginTop: 'var(--s3)' } }, pie) : null,
      });
      vEl.removeAttribute('role'); // se anuncia por la región vivoEl (una frase), no por cada pieza
      vEl.removeAttribute('aria-live');
      const kids = [vEl];
      kids.push(h('div', { class: 'actions' },
        ui.btn({ label: 'Lo voy a hacer', icon: 'tilde', variant: v.codigo === 'terracota' ? 'secondary' : 'primary', onClick: () => abrirHoja(r) }),
        ui.btn({ label: 'Mejor no', variant: 'text', onClick: limpiar }),
      ));
      kids.push(ui.footnote('Si la anotás, queda como compra planificada y todos tus números la tienen en cuenta.'));
      if (hero.provisorio) {
        kids.push(ui.notice({
          tone: 'info', dashed: true, title: 'Resultado provisorio',
          text: hero.motivos[0] || 'Faltan datos que pueden cambiar este resultado.',
          action: { label: 'Ver qué falta', onClick: () => ctx.nav('#/mas') },
        }));
      }
      if ((v.antesDespues || []).length) {
        kids.push(ui.disclosure({
          summary: `Cómo quedan tus meses desde ${mesLargo(form.desde)}`,
          content: ui.rowList(v.antesDespues.map((a) => {
            const st = ui.statusInfo(a.codeDespues);
            return ui.row({
              title: MesLargo(a.key), sub: `Antes: ${money(a.antes)}. Con la compra: ${money(a.despues)}.`,
              chip: { label: st.label, tone: st.tone, icon: st.shape },
            });
          })),
        }));
      }
      resultEl.replaceChildren(...kids);
    }

    function ejemplos() {
      return h('section', { class: 'stack-2' },
        ui.sectionTitle('O probá con un ejemplo'),
        ui.rowList(L.EJEMPLOS.map((e) => ui.row({
          icon: 'destello', tone: 'brand', title: e.titulo,
          sub: e.modo === 'cuotas' ? `${e.cuotas} cuotas de ${money(Math.round(e.total / e.cuotas))}, ${money(e.total)} en total` : `${money(e.total)} de una vez`,
          onClick: () => { DRAFT = L.formDesdeEjemplo(e, start, form.desde); ctx.rerender(); },
        }))));
    }

    // ---------------------------------------------------------------- cálculo (el veredicto primero; el mapa y el tope, enseguida)
    function calcular({ conMapa = true } = {}) {
      const mi = ++token;
      const gasto = L.armarGasto(form, start);
      const hay = L.hayPrecio(form);
      const v = hay ? derive.veredicto(state, gasto, today, { conTope: false }) : null;
      pintarResultado({ vacio: !hay || !v || v.vacio, v, gasto });
      viejo(false);
      setTimeout(() => {
        if (gone || mi !== token) return;
        if (!hay) ultimoMapa = null;
        else if (conMapa || !ultimoMapa) ultimoMapa = derive.mapaMeses(state, gasto, today);
        pintarMapa(ultimoMapa);
        pintarTope(derive.topeSinCosto(state, gasto.desde, { modo: gasto.modo, cuotas: gasto.cuotas, today }));
      }, 0);
    }
    const calcularConPausa = debounce(() => calcular(), 250);
    // al escribir: se marca el resultado como "calculando" y se espera 250 ms de pausa; lo discreto (mes, modo) calcula ya
    function programar(ya = false) {
      if (ya) { calcularConPausa.cancel(); calcular(); return; }
      viejo(true);
      pintarMapa(null, { conNota: false });
      calcularConPausa();
    }

    // ---------------------------------------------------------------- acciones
    function limpiar() {
      DRAFT = null;
      ctx.toast('Listo, no se guardó nada.');
      ctx.rerender();
    }

    function abrirHoja(r) {
      const v = r.v;
      const g = L.armarGasto(form, start, { paraGuardar: true });
      const queda = L.quedaEnMes(v, g.desde);
      const efecto = queda != null ? `Tu ${mesSolo(g.desde)} queda en ${money(queda)}.` : '';
      ctx.sheet.open({
        title: 'Anotar como compra planificada',
        render(body) {
          body.append(h('div', { class: 'stack-4' },
            ui.kv([...L.filasResumenCompra(form, start, { money, mes: mesLargo }), queda != null ? { label: `${MesSolo(g.desde)} queda en`, value: money(queda), strong: true } : null]),
            h('div', null, ui.status(v.codigo)),
            h('p', { class: 't-body' }, ui.txt(`Queda como una compra planificada, aparte de tus gustos. Se suma a tus gastos desde ${mesLargo(g.desde)} y todos los números la tienen en cuenta.`)),
            h('p', { class: 't-body' }, 'Cuando la hagas, marcala como hecha: no hace falta anotarla de nuevo como gasto.'),
            ui.disclaimer(),
          ));
        },
        footer: (close) => [
          // no se cierra la hoja acá: ctx.nav la cierra y espera a que el historial termine (si no, el "Atrás" de la hoja deshace la navegación)
          ui.btn({ label: 'Anotar compra planificada', icon: 'tilde', onClick: () => guardar(g, efecto) }),
          ui.btn({ label: 'Todavía no', variant: 'text', onClick: () => close() }),
        ],
      });
    }

    function guardar(gasto, efecto) {
      DRAFT = null;
      ctx.update((d) => { crearCompraPlanificada(d, gasto); }, { undoLabel: `Anotado como compra planificada. ${efecto}`.trim(), rerender: false });
      ctx.nav('#/hoy');
    }

    // ---------------------------------------------------------------- compras planificadas (para marcarlas hechas o borrarlas)
    function planificadas() {
      const lista = [...(ctx.state.plannedPurchases || [])].sort((a, b) => Number(a.hecha) - Number(b.hecha) || String(a.desde).localeCompare(String(b.desde)));
      if (!lista.length) return null;
      return h('section', { class: 'stack-2' },
        ui.sectionTitle('Tus compras planificadas'),
        ui.rowList(lista.map((p) => ui.row({
          icon: 'billetera', tone: p.hecha ? 'ok' : 'brand', title: p.name, sub: L.describirCompra(p, { money, mes: mesLargo }),
          chip: p.hecha ? { label: 'Hecha', tone: 'ok', icon: 'forma-ok' } : { label: 'Planificada', tone: 'info', icon: 'forma-info' },
          onClick: () => { Promise.resolve(ctx.editors.open('plannedPurchase', p.id)).catch(() => ctx.toast('No pudimos abrir esa compra. Probá de nuevo.')); },
        }))),
        ui.footnote('Ya están sumadas a tus números. Cuando hagas una, marcala como hecha: no hace falta anotarla de nuevo como gasto.'));
    }

    // ---------------------------------------------------------------- armado
    pintarChips();
    pintarDinero();
    pintarEtiquetaMes();

    const formCard = ui.card(
      h('div', { class: 'stack-6' },
        h('div', { class: 'stack-2' }, nombreF.el, chipsEl),
        modoF.el,
        dineroEl,
        h('div', { class: 'stack-3' },
          h('div', { class: 'field-head' }, etiquetaMesEl),
          mapaEl,
          ui.legend([{ code: 'verde' }, { code: 'ambar' }, { code: 'terracota' }]),
          notaMapaEl)),
      { cls: 'puedo-form' });

    const lado = [h('div', { class: 'mobile-only', 'aria-hidden': 'true' }), vivoEl, resultEl, topeEl, ejemplosEl, planificadas()];

    root.append(titulo);
    if (hero.estado === 'parcial') {
      root.append(ui.notice({
        tone: 'warn', title: 'Todavía no cargaste tus gastos',
        text: 'Sin tus gastos, el resultado va a ser más optimista que la realidad.',
        action: { label: 'Cargar mis gastos', onClick: () => ctx.nav(hero.accion.ruta) },
      }));
    }
    root.append(
      h('div', { class: 'desk-cols list-detail' },
        h('div', { class: 'col-main' }, formCard),
        h('div', { class: 'col-side' }, ...lado)),
      ui.disclaimer(),
      barraEl,
    );

    observador?.observe(resultEl); // recién ahora está en el documento
    calcular();

    return () => {
      gone = true;
      token += 1;
      observador?.disconnect();
      mqTablet?.removeEventListener?.('change', alCambiarAncho);
      calcularConPausa.cancel();
    };
  },
};
