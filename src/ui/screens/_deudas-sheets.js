// _deudas-sheets.js · hojas y ayudas de Deudas, Tarjeta y Me deben (spec 6.6 a 6.8).
//   "Qué supone esta fecha" · agregar una deuda · parte de cada persona en la tarjeta · quién te pagó · enviarle la cuenta
//   por WhatsApp (mensaje editable) · aviso en el calendario (.ics). Toda cifra sale de ctx.derive; los guardados pasan por
//   ctx.update (con Deshacer) y por ctx.editors (los escribe S4).

import * as L from './_deudas-logic.js';

/** Abre un editor de S4 sin romper nada si todavía no existe o falla. Siempre devuelve { saved }. */
export async function abrirEditor(ctx, kind, id, opts) {
  try {
    const res = await ctx.editors.open(kind, id, opts);
    return res && typeof res === 'object' ? res : { saved: false };
  } catch (e) {
    console.error(`[Deudas] el editor "${kind}" no se pudo abrir`, e);
    ctx.toast('Esta opción se está terminando de construir.');
    return { saved: false };
  }
}

/** Segmentado "Lo que debo | Me deben": cambia de pantalla (son dos rutas) y se ve igual en las dos. */
export function segmentoDeudas(ctx, actual) {
  return ctx.ui.segmented({
    name: 'deudas-seg',
    ariaLabel: 'Qué querés ver',
    value: actual,
    options: [{ value: 'debo', label: 'Lo que debo' }, { value: 'medeben', label: 'Me deben' }],
    onChange: (v) => { if (v !== actual) ctx.nav(v === 'medeben' ? '#/deudas/medeben' : '#/deudas'); },
  });
}

/** Chip que puede partirse en dos renglones (con letra muy grande un chip largo se salía de la tarjeta). */
export function chipFlexible(ui, label, opts) {
  const c = ui.chip(label, opts);
  c.style.whiteSpace = 'normal';
  c.style.textAlign = 'left';
  return c;
}

/** Lista con viñetas simples (el reinicio de estilos las saca: se ponen a mano). */
const lista = (ui, items) => ui.h('ul', { class: 'stack-2', style: { listStyle: 'disc', paddingLeft: '1.25rem' } },
  items.map((x) => ui.h('li', { class: 't-body' }, ui.txt(x))));

// ============================================================================================ qué supone esta fecha
/** Hoja "Qué supone esta fecha": los supuestos de la cuenta, dichos con palabras de casa (los escribe derive). */
export function abrirSupuesto(ctx, salida) {
  const { ui } = ctx;
  const { h } = ui;
  const puntos = salida && salida.queSupone && salida.queSupone.length ? salida.queSupone : [];
  return ctx.sheet.open({
    title: 'Qué supone esta fecha',
    render(body) {
      body.append(h('div', { class: 'stack-3' },
        h('p', { class: 't-body' }, 'Es una cuenta hecha con lo que cargaste. Para que dé esa fecha, se supone que:'),
        puntos.length ? lista(ui, puntos) : null,
        salida && salida.provisoria
          ? ui.notice({ tone: 'info', title: salida.etiqueta || 'Fecha provisoria', text: (salida.motivos || []).join(' ') })
          : null,
        ui.disclaimer()));
    },
    footer: (close) => ui.btn({ label: 'Entendido', variant: 'secondary', onClick: () => close() }),
  });
}

/** Enlace "Qué supone esta fecha" (48px) listo para poner debajo de cualquier fecha de salida. */
export function enlaceSupuesto(ctx, salida) {
  return ctx.ui.link({ label: 'Qué supone esta fecha', onClick: () => abrirSupuesto(ctx, salida) });
}

/** Bloque estándar bajo una fecha de salida: el supuesto en 16px+, la etiqueta provisoria y el enlace. */
export function bloqueSupuesto(ctx, salida) {
  const { ui } = ctx;
  const { h } = ui;
  if (!salida || !salida.hayTarjeta) return null;
  return h('div', { class: 'stack-1' },
    salida.supuesto ? h('p', { class: 't-body muted' }, ui.txt(`${salida.supuesto}.`)) : null,
    salida.provisoria ? h('div', { class: 'cluster' }, ui.chip(salida.etiqueta || 'Fecha provisoria', { tone: 'info', icon: 'info' })) : null,
    enlaceSupuesto(ctx, salida));
}

// ============================================================================================ agregar una deuda o cuota
export function abrirAgregar(ctx) {
  const { ui } = ctx;
  return ctx.sheet.open({
    title: '¿Qué querés agregar?',
    render(body, close) {
      body.append(ui.rowList([
        ui.row({
          icon: 'banco', tone: 'brand', title: 'Un préstamo o una compra en cuotas', sub: 'Algo que ya estás pagando por mes',
          onClick: () => { close(); abrirEditor(ctx, 'installment', null); },
        }),
        ui.row({
          icon: 'tarjeta', tone: 'warn', title: 'Una tarjeta u otra deuda con saldo', sub: 'Con el total que debés hoy',
          onClick: () => { close(); abrirEditor(ctx, 'debt', null); },
        }),
      ]));
    },
  });
}

// ============================================================================================ parte de cada persona en la tarjeta
/**
 * Hoja "Parte de {nombre}" de la tarjeta: cuánto del total es de esa persona (informativo) y, si querés, pasarlo a "Me deben".
 * `fila` sale de filasTitulares(). Nunca habla de falta ni de rojo: es solo para tu orden.
 */
export function abrirTitular(ctx, debt, fila) {
  const { ui } = ctx;
  const { h } = ui;
  const F = ctx.format;
  const alias = ui.aliasName(fila.nombre, fila.index);
  const campo = ui.fields.money({
    label: `Cuánto de este total es de ${alias}`,
    value: fila.monto || undefined,
    hint: 'Es solo para tu orden: no cambia ninguna cuenta.',
    big: true,
    autofocus: true,
    required: false,
  });
  let sucio = false;
  campo.onChange(() => { sucio = true; });
  return ctx.sheet.open({
    title: `Parte de ${fila.nombre}`,
    dirty: () => sucio,
    render(body) {
      body.append(h('div', { class: 'stack-4' },
        campo.el,
        fila.enMeDeben
          ? ui.notice({ tone: 'info', title: 'Ya figura en Me deben', text: 'Si cambió el monto, lo ajustás desde Me deben.', icon: 'usuarios' })
          : null));
    },
    footer: (close) => [
      ui.btn({
        label: 'Guardar', variant: 'primary',
        onClick: () => {
          sucio = false;
          const m = campo.get();
          ctx.update((d) => { L.fijarTitular(d, debt.id, fila.personId, m); }, { undoLabel: m ? `Listo, anotamos la parte de ${fila.nombre}.` : 'Listo, sacamos a esa persona del reparto.' });
          close();
        },
      }),
      !fila.enMeDeben && fila.role !== 'yo' ? ui.btn({
        label: 'Pasar a Me deben', variant: 'secondary', icon: 'usuarios',
        onClick: () => {
          const m = campo.get();
          if (!(m > 0)) { campo.setError('Poné cuánto es de esa persona para pasarlo a Me deben.'); campo.focus(); return; }
          sucio = false;
          let res = null;
          ctx.update((d) => { L.fijarTitular(d, debt.id, fila.personId, m); res = L.pasarAMeDeben(d, debt.id, fila.personId, m); },
            { undoLabel: `Listo. ${fila.nombre} figura en Me deben con ${F.money(m)}.` });
          if (res && !res.ok && res.motivo === 'existe') ctx.toast('Ya figura en Me deben.');
          close();
        },
      }) : null,
      fila.monto ? ui.btn({
        label: 'Sacar del reparto', variant: 'text',
        onClick: () => { sucio = false; ctx.update((d) => { L.fijarTitular(d, debt.id, fila.personId, 0); }, { undoLabel: 'Listo, sacamos a esa persona del reparto.' }); close(); },
      }) : null,
    ],
  });
}

// ============================================================================================ quién te pagó
/** "Anoté que me pagaron": si hay una sola persona con saldo se abre directo el editor; si hay varias, primero se elige quién. */
export async function abrirCobro(ctx) {
  const { ui } = ctx;
  const F = ctx.format;
  const q = L.quienPaga(ctx.derive.meDeben(ctx.state, ctx.today()).personas, ctx.state);
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
      },
      onClose: () => resolve({ saved: guardado }),
    });
  });
}

// ============================================================================================ enviarle la cuenta por WhatsApp
async function copiarTexto(ctx, texto) {
  try {
    await navigator.clipboard.writeText(texto);
    ctx.toast('Copiado. Pegalo donde quieras.');
  } catch {
    ctx.toast('No pudimos copiarlo solo. Mantené apretado el texto y elegí Copiar.');
  }
}

function enviarWhatsApp(ctx, texto) {
  const url = L.urlWhatsApp(texto);
  const w = window.open(url, '_blank', 'noopener');
  if (!w) {
    if (navigator.share) navigator.share({ text: texto }).catch(() => {});
    else window.location.href = url;
  }
}

/**
 * Hoja "Enviarle la cuenta": mensaje editable (hechos + pregunta abierta, "según el último resumen (aproximado)").
 * Nunca se manda solo: se abre WhatsApp con el texto y lo envía la persona.
 * Con el ojo activado no se muestra el texto (tiene nombres y montos): se ofrece mostrarlos.
 */
export function abrirMensaje(ctx, receivableId, monto) {
  const { ui } = ctx;
  const { h } = ui;
  const D = ctx.derive;
  const t = ctx.today();
  const state = ctx.state;
  const r = (state.receivables || []).find((x) => x.id === receivableId);
  if (!r) return null;
  const texto0 = D.mensajeWhatsApp(state, receivableId, t, monto > 0 ? { monto } : {});
  const hayViejo = (state.debts || []).filter((d) => d.kind === 'card').some((d) => D.estadoResumen(d, t).viejo);
  return ctx.sheet.open({
    title: 'Enviarle la cuenta',
    size: 'tall',
    render(body, close) {
      if (ctx.isPrivate()) {
        body.append(ui.notice({
          tone: 'info', icon: 'ojo-tachado', title: 'Tenés los montos ocultos',
          text: 'El mensaje lleva nombres y montos. Para revisarlo antes de mandarlo hace falta verlos.',
          action: { label: 'Mostrar y revisar el mensaje', onClick: () => { close(); ctx.setPrivacy(false); setTimeout(() => abrirMensaje(ctx, receivableId, monto), 80); } },
        }));
        return;
      }
      const campo = ui.fields.textarea({ label: 'Mensaje', value: texto0, rows: 7, name: 'mensaje-whatsapp' });
      body.append(h('div', { class: 'stack-4' },
        h('p', { class: 't-body muted' }, 'Este mensaje no se manda solo. Podés cambiarlo y recién después lo mandás vos.'),
        hayViejo ? ui.notice({ tone: 'warn', title: 'Tu último resumen ya es viejo', text: 'El número puede haber cambiado. Si querés que sea exacto, cargá el resumen nuevo antes de mandarlo.' }) : null,
        campo.el));
      body._campo = campo;
    },
    footer: (close, hoja) => {
      if (ctx.isPrivate()) return null;
      const get = () => (hoja.body._campo ? hoja.body._campo.get() : texto0);
      return [
        ui.btn({ label: 'Enviar por WhatsApp', icon: 'whatsapp', onClick: () => { enviarWhatsApp(ctx, get()); } }),
        ui.btn({ label: 'Copiar texto', variant: 'secondary', icon: 'copiar', onClick: () => copiarTexto(ctx, get()) }),
      ];
    },
  });
}

// ============================================================================================ aviso en el calendario
/** Baja un archivo (offline). Devuelve true si pudo. */
export function descargarArchivo(nombre, contenido, tipo) {
  try {
    const blob = new Blob([contenido], { type: tipo });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nombre; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return true;
  } catch { return false; }
}

/** "Avisarme en mi calendario": genera el .ics con el vencimiento real del resumen cargado y una alarma 2 días antes. */
export function avisarCalendario(ctx, debtId) {
  const ics = ctx.derive.icsVencimiento(ctx.state, ctx.today(), { debtId });
  if (!ics || !ics.ok) { ctx.toast((ics && ics.mensaje) || 'Primero cargá el resumen para saber la fecha de vencimiento.'); return false; }
  const ok = descargarArchivo(ics.nombreArchivo, ics.contenido, 'text/calendar');
  ctx.toast(ok ? 'Listo. Abrí el archivo y agregalo a tu calendario.' : 'No pudimos armar el aviso. Probá de nuevo.');
  return ok;
}
