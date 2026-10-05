// hoy.js · HOY, el tablero de 10 segundos (spec 6.2). Orden fijo: hero (¿cómo estoy este mes?) → respuestas (plata de hoy,
// referencia para gastar, cuándo salís de la tarjeta) → lo que vence → cierre de mes → siguientes pasos → pie.
// Toda cifra sale de ctx.derive; los guardados pasan por ctx.update. La pantalla es una función pura del estado:
// app.js la vuelve a montar cada vez que cambia el estado.

import { guardarProyeccion, marcarVisto } from '../../store.js';
import { demo } from '../../demo.js';
import * as L from './_hoy-logic.js';
import { abrirEditor, filasPendientes, abrirGastarHoy, abrirMesDificil, abrirSalida, abrirCierre, abrirHitos, abrirCobro } from './_hoy-sheets.js';

const ANCHO = '(min-width: 1024px)';
const nombreCorto = (n) => String(n || 'Tarjeta').replace(/^tarjeta\s+(?=\S)/i, '');

export default {
  id: 'hoy',
  title: 'Hoy',

  mount(root, ctx) {
    const { ui } = ctx;
    const { h } = ui;
    const D = ctx.derive;
    const F = ctx.format;
    const t = ctx.today();
    let vivo = true;
    const timers = [];
    const mq = matchMedia(ANCHO);
    const alCambiarAncho = () => ctx.rerender();
    mq.addEventListener?.('change', alCambiarAncho);
    const limpiar = () => { vivo = false; timers.forEach(clearTimeout); mq.removeEventListener?.('change', alCambiarAncho); };

    // La proyección del mes se guarda una sola vez: es lo que el cierre de mes compara con lo que pasó de verdad.
    const h0 = D.hero(ctx.state, t);
    if (h0.estado === 'ok' && ctx.state.seen?.proyecciones?.[h0.mes] === undefined) {
      ctx.update((d) => { guardarProyeccion(d, Math.round(h0.free), t); }, { rerender: false });
    }

    const state = ctx.state;
    const v = L.vistaHoy(D, state, t);
    const ancho = mq.matches;
    ctx.header(L.encabezado(state, t));
    root.append(h('h1', { class: 'sr-only' }, 'Hoy'));

    const ir = (hash) => () => ctx.nav(hash);

    // ------------------------------------------------------------------ estados sin datos
    if (v.estado === 'sinDatos') {
      root.append(ui.empty({
        title: v.hero.texto,
        text: 'Con tu sueldo y tus gastos te digo cuánto sobra cada mes y cuándo salís de la tarjeta.',
        art: 'barras',
        action: { label: v.hero.accion.texto, onClick: ir(v.hero.accion.ruta) },
        secondary: { label: 'Ver un ejemplo', onClick: () => ctx.update(() => demo(t)) },
      }));
      return limpiar;
    }
    if (v.estado === 'sinIngresos') {
      root.append(ui.empty({
        title: v.hero.texto, art: 'barras',
        action: { label: v.hero.accion.texto, onClick: ir(v.hero.accion.ruta) },
      }));
      return limpiar;
    }

    // ------------------------------------------------------------------ hero
    const H = v.hero;
    const heroNodo = () => {
      if (v.estado === 'parcial') {
        return ui.hero({
          label: `Entran en ${H.mesNombre}`, value: H.numero, caption: 'Cargá tus gastos para saber cuánto sobra.',
          aviso: { icon: 'mas', text: H.accion.texto, onClick: ir(H.accion.ruta) },
          ariaLabel: `Entran ${ui.srMoney(H.numero)} en ${H.mesNombre}. Cargá tus gastos para saber cuánto sobra.`,
        });
      }
      const filas = L.filasMeses(D, state, t, ancho ? 12 : 4).items;
      const tira = filas.map((it) => ({
        key: it.key, label: it.short, name: it.nombreCorto, value: it.value, state: it.state, current: it.esActual, estimated: it.estimated,
        onClick: ir(`#/meses/${it.key}`),
      }));
      const av = L.accionAviso(H.aviso);
      const abrirAviso = av.accion === 'mesDificil' ? () => abrirMesDificil(ctx, av.key) : av.accion === 'mes' ? ir(`#/meses/${av.key}`) : undefined;
      const nota = H.estimados.texto || (H.provisorio ? 'Es provisorio: faltan datos' : null);
      const nodo = ui.hero({
        label: H.rotulo, value: H.numero, status: H.chip.tone, statusLabel: H.chip.texto, caption: H.subtitulo,
        note: nota ? { text: nota, onClick: ir('#/mas') } : null,
        aviso: { icon: av.icon, text: H.aviso.texto, onClick: abrirAviso },
        strip: tira, stripOptions: ancho ? { showValues: false, onHero: true, barWidth: 28 } : { showValues: true, onHero: true },
        onOpen: ir(`#/meses/${H.mes}`),
        ariaLabel: `${H.rotulo}: ${ui.srMoney(H.numero)}. ${H.chip.texto}. Tocá para ver el detalle del mes.`,
      });
      // La tira muestra lo que sobra cada mes (no lo que va a la tarjeta): se dice en palabras para que no se confundan los dos números.
      const franja = nodo.querySelector('.mstrip');
      if (franja) {
        franja.style.marginTop = '6px';
        franja.before(h('p', { class: 't-small', style: { color: 'var(--hero-ink-2)', marginTop: '16px', fontWeight: '600' } }, 'Lo que te sobra cada mes'));
      }
      return nodo;
    };

    // ------------------------------------------------------------------ tarjeta de respuestas
    // El valor grande va DEBAJO del título (a 390px, a la derecha dejaba el título en tres renglones).
    const grande = (valor, nota, clase = 't-big') => h('span', { style: { display: 'flex', flexDirection: 'column' } },
      h('span', { class: `${clase} num`, style: { color: 'var(--ink)' } }, valor),
      nota ? h('span', { class: 't-small muted' }, ui.txt(nota)) : null);

    const filaPlata = () => ui.row({
      icon: 'banco', tone: 'brand', title: v.plata.rotulo,
      sub: grande(ui.amt(v.plata.monto), 'lo que hay en tu cuenta'),
    });
    const filaReferencia = () => {
      const g = v.gastar;
      if (g.estado === 'ok') {
        return ui.row({
          icon: 'billetera', tone: 'brand', title: 'Referencia para gastar hoy',
          sub: grande(ui.amt(g.porDia), 'por día hasta fin de mes'), onClick: () => abrirGastarHoy(ctx),
          ariaLabel: `Referencia para gastar hoy: ${ui.srMoney(g.porDia)} por día hasta fin de mes. Tocá para ver cómo se calcula.`,
        });
      }
      return ui.row({
        icon: 'billetera', tone: 'brand', title: 'Referencia para gastar hoy', sub: g.texto,
        onClick: g.estado === 'sinGustos' ? ir('#/armar/4') : () => abrirGastarHoy(ctx),
      });
    };
    const filaSalida = () => {
      const s = v.salida;
      if (s.estado === 'sinDeuda') return ui.row({ icon: 'bandera', tone: 'ok', title: 'Tarjeta', sub: s.texto });
      if (s.estado === 'fecha') {
        return ui.row({
          icon: 'bandera', tone: 'ok', title: 'Salís de la tarjeta', sub: grande(s.mesNombre, s.detalle, 't-date'),
          onClick: () => abrirSalida(ctx), ariaLabel: `Salís de la tarjeta en ${s.mesNombre}, ${s.detalle}. ${s.supuesto}. Tocá para ver el detalle.`,
        });
      }
      return ui.row({ icon: 'bandera', tone: 'warn', title: 'Salís de la tarjeta', sub: s.texto, onClick: () => abrirSalida(ctx) });
    };
    const bloqueSupuesto = () => {
      const s = v.salida;
      return h('div', { role: 'listitem', class: 'stack-1', style: { padding: '2px 16px 12px 74px' } },
        h('p', { class: 't-small muted' }, s.supuesto),
        h('div', { class: 'cluster' },
          s.etiqueta ? ui.chip(s.etiqueta, { tone: 'info', icon: 'info' }) : null,
          ui.link({ label: 'Qué supone esta fecha', onClick: () => abrirSalida(ctx, { irASupone: true }), icon: 'chevron' })));
    };
    const tarjetaRespuestas = () => {
      const filas = [];
      if (v.plata?.hay) filas.push(filaPlata());
      filas.push(filaReferencia());
      if (v.salida.hayTarjeta) filas.push(filaSalida());
      const lista = ui.rowList(filas, { ariaLabel: 'Tus respuestas de hoy' });
      if (['fecha', 'muyLejos', 'noTermina'].includes(v.salida.estado)) lista.append(bloqueSupuesto());
      return lista;
    };

    // ------------------------------------------------------------------ preguntas y avisos sueltos
    const botonGasto = () => ui.btn({ label: 'Anoté un gasto', icon: 'mas', variant: 'secondary', onClick: () => abrirEditor(ctx, 'spent', null, {}) });

    const preguntaCobro = () => {
      if (!v.plata?.pregunta) return null;
      const guardar = (valor) => ctx.update((d) => { d.settings.cobroEsteMes = valor; }, { undoLabel: 'Listo, anotado.' });
      return ui.card([
        h('p', { class: 't-row' }, v.plata.pregunta),
        h('p', { class: 't-small muted' }, 'Lo necesito para no contar dos veces tu sueldo.'),
        h('div', { class: 'chips' },
          ui.chipButton('Sí, ya cobré', { onClick: () => guardar(true) }),
          ui.chipButton('Todavía no', { onClick: () => guardar(false) })),
      ], { cls: 'stack-2' });
    };

    const pendientes = () => filasPendientes(ctx, v.pendientes);

    // ------------------------------------------------------------------ lo que vence
    const accionar = (boton, fila) => {
      const a = L.accionDeBoton(boton, fila);
      if (!a) return undefined;
      if (a.tipo === 'editor') return () => abrirEditor(ctx, a.kind, a.id, {});
      if (a.tipo === 'cobro') return () => abrirCobro(ctx);
      return ir(a.hash);
    };
    // El monto va debajo del título (no a la derecha): con letra grande o 360px el título quedaba en tres renglones.
    const conMonto = (monto, detalle) => (monto == null ? detalle : h('span', { style: { display: 'flex', flexDirection: 'column' } },
      h('span', { class: 't-h2 num', style: { color: 'var(--ink)' } }, ui.amt(monto)),
      detalle ? h('span', { class: 't-small muted' }, ui.txt(detalle)) : null));
    const itemTarjeta = (f) => {
      const conFecha = f.fechaTexto && f.estado !== 'viejo' && f.estado !== 'esperandoCierre';
      const chip = f.estado === 'pagado' ? { label: 'Pagado', tone: 'ok', icon: 'tilde' } : f.estado === 'sinResumen' ? { label: 'Completar', tone: 'info' } : undefined;
      const fila = ui.row({
        icon: 'tarjeta', tone: f.estado === 'pagado' ? 'ok' : 'warn', title: conFecha ? `${nombreCorto(f.titulo)} · ${f.fechaTexto}` : f.titulo, sub: conMonto(f.monto, f.detalle),
        chip, onClick: ir(f.ruta),
      });
      const extras = [];
      if (f.estado === 'viejo') {
        const texto = v.ahora?.tipo === 'cargarResumen' ? v.ahora.texto : 'Ya cerró un resumen nuevo. Cargalo para ver el monto exacto.';
        extras.push(ui.notice({ tone: 'warn', title: texto }));
      } else if (v.ahora?.tipo === 'pagarTarjeta' && v.ahora.urgente && f.debtId === v.ahora.debtId) {
        extras.push(ui.notice({ tone: 'warn', title: v.ahora.texto }));
      }
      const al = accionar(f.boton, f);
      if (f.estado === 'parcial' && !f.boton) extras.push(ui.btn({ label: 'Anoté otro pago', variant: 'secondary', onClick: () => abrirEditor(ctx, 'cardPayment', f.debtId, {}) }));
      if (f.boton && al) extras.push(ui.btn({ label: f.boton.texto, variant: f.estado === 'viejo' || f.estado === 'sinResumen' ? 'primary' : 'secondary', onClick: al }));
      if (f.fechasResumen) extras.push(h('p', { class: 't-small muted' }, ui.txt(f.fechasResumen)));
      return h('div', null, fila, h('div', { class: 'stack-2', style: { padding: '2px 16px 14px' } }, extras));
    };
    const itemMedeben = (f) => h('div', null,
      ui.row({ icon: 'usuarios', tone: 'info', title: f.titulo, sub: f.detalle, onClick: ir(f.ruta) }),
      h('div', { class: 'stack-2', style: { padding: '2px 16px 14px' } },
        ui.btn({ label: f.boton?.texto || 'Anoté que me pagaron', variant: 'secondary', onClick: () => abrirCobro(ctx) })));
    const itemVence = (f) => {
      if (f.tipo === 'tarjeta') return itemTarjeta(f);
      if (f.tipo === 'medeben') return itemMedeben(f);
      if (f.tipo === 'pendiente') return ui.row({ icon: 'documento', tone: 'info', title: f.titulo, sub: f.detalle, chip: f.chip, pending: true, onClick: ir(f.ruta) });
      return ui.row({ icon: 'banco', tone: 'neutral', title: f.titulo, sub: conMonto(f.monto, f.detalle), onClick: ir(f.ruta) });
    };
    const bloqueVence = () => {
      const out = [ui.sectionTitle('Lo que vence', { label: 'Ver todo', href: '#/deudas' })];
      if (v.vence.vacio) out.push(ui.notice({ tone: 'ok', icon: 'tilde', title: v.vence.vacio }));
      // el plan de AFIP pendiente ya está arriba, en "Falta un dato": no se repite acá
      const filas = v.vence.filas.filter((f) => !(f.tipo === 'pendiente' && (v.pendientes || []).some((p) => p.code === 'afip')));
      if (filas.length) {
        const items = filas.map(itemVence);
        items.forEach((n, i) => { if (i) n.style.borderTop = '1px solid var(--line)'; });
        out.push(ui.rowList(items, { ariaLabel: 'Lo que vence' }));
      }
      return out;
    };

    // ------------------------------------------------------------------ cierre de mes y siguientes pasos
    const tarjetaCierre = () => {
      const c = v.cierre;
      if (!c?.aplica) return null;
      return ui.card([
        h('p', { class: 'eyebrow' }, 'Cierre de mes'),
        h('h2', { class: 't-h2' }, c.pregunta),
        h('p', { class: 't-body' }, ui.txt(`${c.textoEsperado}.`)),
        h('div', { class: 'stack-2' },
          ui.btn({ label: 'Contame cómo te fue', variant: 'secondary', onClick: () => abrirCierre(ctx) }),
          ui.btn({ label: 'Ahora no', variant: 'text', onClick: () => ctx.update((d) => { marcarVisto(d, 'cierres', c.mes); }) })),
      ], { cls: 'stack-2' });
    };
    const ICONO_PASO = { idea: ['destello', 'brand'], liberacion: ['llave', 'ok'], datos: ['documento', 'info'] };
    const tarjetasSiguientes = () => (v.siguientes || []).map((p) => {
      const [ic, tono] = ICONO_PASO[p.id] || ['destello', 'brand'];
      return ui.card([
        h('div', { style: { display: 'flex', gap: '12px', alignItems: 'flex-start' } },
          ui.iconTile(ic, tono),
          h('div', { class: 'grow stack-1' }, h('p', { class: 'eyebrow' }, p.titulo), h('p', { class: 't-body' }, ui.txt(p.texto)))),
        p.progreso ? h('div', { class: 'stack-1' },
          ui.progressBar({ value: p.progreso.hechos, max: p.progreso.total, label: `${p.progreso.hechos} de ${p.progreso.total} datos cargados` }),
          h('p', { class: 't-small muted' }, `${p.progreso.hechos} de ${p.progreso.total} datos cargados`)) : null,
        ui.btn({ label: p.boton.texto, variant: 'secondary', onClick: ir(p.boton.ruta) }),
      ], { cls: 'next-card' });
    });
    const pie = () => ui.footnote(L.textoPie(state, t, ancho ? 'equipo' : 'celular'));

    // ------------------------------------------------------------------ armado
    const nodos = (...l) => l.flat().filter(Boolean);
    if (v.estado === 'parcial') {
      root.append(...nodos(heroNodo(), tarjetasSiguientes(), pie()));
    } else if (ancho) {
      root.append(h('div', { class: 'desk-cols' },
        h('div', { class: 'col-main' }, ...nodos(heroNodo(), pendientes(), tarjetasSiguientes())),
        h('div', { class: 'col-side' }, ...nodos(tarjetaRespuestas(), botonGasto(), preguntaCobro(), bloqueVence(), tarjetaCierre()))));
      root.append(pie());
    } else {
      root.append(...nodos(heroNodo(), tarjetaRespuestas(), botonGasto(), preguntaCobro(), pendientes(), bloqueVence(), tarjetaCierre(), tarjetasSiguientes(), pie()));
    }

    // ------------------------------------------------------------------ hito: una sola vez, sobrio
    if (v.hitos?.length) {
      timers.push(setTimeout(() => {
        if (!vivo || ctx.sheet.isOpen()) return;
        const nuevos = D.hitos(ctx.state, t);
        if (!nuevos.length) return;
        ctx.update((d) => { nuevos.forEach((x) => marcarVisto(d, 'hitos', x.id)); }, { rerender: false });
        abrirHitos(ctx, nuevos);
      }, 700));
    }
    void F;
    return limpiar;
  },
};
