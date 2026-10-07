// _ed-core.js · piezas comunes de los editores: la hoja de formulario (un solo patrón), borrar con consecuencias y avisos.
// Todo cambio de estado pasa por ctx.update (con Deshacer). Nada de confirm()/alert(): se usa ctx.sheet.confirm().

import { h } from './dom.js';
import { estilos } from './_ed-style.js';
import { consecuenciasDeBorrar, borrar } from './_ed-logic.js';

export const copia = (o) => JSON.parse(JSON.stringify(o));

/** Etiqueta visible (editor) o etiqueta solo para lectores de pantalla (el armado ya tiene la pregunta como título). */
export const rotulo = (labels, texto) => (labels === false ? { ariaLabel: texto } : { label: texto });

/**
 * Hoja de formulario (el patrón único de los editores). Devuelve Promise<{ saved, ... }> que se resuelve al cerrar.
 * cfg: {
 *   title, size,
 *   campos: [controladores de ctx.ui.fields],      // se validan juntos al guardar; si cambian, la hoja pide confirmar al cerrar
 *   cuerpo: Node[] | (api) => Node[],
 *   guardar: async (api) => false | { ...extra },   // false = no se guardó (quedó un error visible); un objeto = guardado
 *   guardarLabel = 'Guardar',
 *   borrar: { label, ejecutar: async () => ({ deleted }) },   // botón terracota debajo de Guardar
 *   pie: Node[],                                    // nodos extra bajo el cuerpo (por ejemplo el pie de decisión)
 *   focus: selector
 * }
 * api: { ctx, cerrar(extra), sucio(), vista(nodos, pie), volver(), hoja }  -> vista() reemplaza el cuerpo y los botones (pantalla "Revisá").
 */
export function hojaForm(ctx, cfg) {
  estilos();
  const { ui } = ctx;
  return new Promise((resolve) => {
    let resultado = { saved: false };
    let sucio = false;
    let hoja = null;
    let cuerpoEl = null;
    let cerrarFn = null;
    const campos = cfg.campos || [];
    const marcar = () => { sucio = true; };
    campos.forEach((c) => c.onChange?.(marcar));

    const api = {
      ctx,
      get hoja() { return hoja; },
      sucio: () => sucio,
      marcarSucio: () => { sucio = true; },
      cerrar(extra = {}) { sucio = false; resultado = { saved: true, ...extra }; cerrarFn?.(resultado); },
      vista(nodos, pie) {
        cuerpoEl.replaceChildren(h('div', { class: 'stack-4' }, ...[].concat(nodos).filter(Boolean)));
        hoja.setFooter(pie || []);
        cuerpoEl.scrollTop = 0;
      },
      volver() { mostrarForm(); },
    };

    const nodosCuerpo = () => {
      const c = typeof cfg.cuerpo === 'function' ? cfg.cuerpo(api) : cfg.cuerpo;
      return [].concat(c || []).filter(Boolean);
    };
    let formEl = null;
    const mostrarForm = () => {
      if (!formEl) {
        formEl = h('div', { class: 'stack-4' }, ...nodosCuerpo(), ...(cfg.pie || []));
        // cualquier cambio de la persona (texto, interruptor, chips, + y −) cuenta como "cambios sin guardar"
        formEl.addEventListener('input', marcar);
        formEl.addEventListener('change', marcar);
        formEl.addEventListener('click', (e) => { if (e.target.closest?.('.chipbtn, .stepper-btn, .cal-cell')) marcar(); });
      }
      cuerpoEl.replaceChildren(formEl);
      hoja.setFooter(botones());
    };

    const botones = () => [
      ui.btn({
        label: cfg.guardarLabel || 'Guardar',
        onClick: async (e) => {
          const b = e.currentTarget;
          if (b.disabled) return;
          if (campos.length && !ui.fields.validateAll(campos)) return;
          b.disabled = true;
          try {
            const r = await cfg.guardar(api);
            if (r === false) return;
            api.cerrar(r && typeof r === 'object' ? r : {});
          } catch (err) {
            console.error('[editor] no se pudo guardar', err);
            ctx.toast('No pudimos guardar. Probá de nuevo.');
          } finally { b.disabled = false; }
        },
      }),
      cfg.borrar ? ui.btn({
        label: cfg.borrar.label, variant: 'text', icon: 'papelera', cls: 'btn-borrar',
        onClick: async () => { const r = await cfg.borrar.ejecutar(); if (r && r.deleted) api.cerrar({ deleted: true }); },
      }) : null,
      typeof cfg.pieBoton === 'function' ? cfg.pieBoton(api) : cfg.pieBoton || null,
    ].filter(Boolean);

    hoja = ctx.sheet.open({
      title: cfg.title,
      size: cfg.size || 'auto',
      focus: cfg.focus,
      dirty: () => sucio,
      render(body, close) { cuerpoEl = body; cerrarFn = close; },
      onClose: () => resolve(resultado),
    });
    mostrarForm();
  });
}

/**
 * Borra algo con la hoja de consecuencias y el toast "Borrado. Deshacer". Devuelve { deleted: boolean }.
 * kind: 'income' | 'movilidad' | 'expense' | 'installment' | 'debt' | 'receivable' | 'person' | 'plannedPurchase' | 'spent'
 */
export async function borrarConConsecuencias(ctx, kind, id, { mensajeBorrado } = {}) {
  const c = consecuenciasDeBorrar(ctx.state, kind, id);
  if (!c) { ctx.toast('No encontramos eso para borrar.'); return { deleted: false }; }
  const ok = await ctx.sheet.confirm({ title: c.titulo, message: c.mensaje, confirmLabel: c.boton, cancelLabel: 'Cancelar', tone: 'bad', icon: 'papelera' });
  if (!ok) return { deleted: false };
  ctx.update((d) => { borrar(d, kind, id); }, { undoLabel: mensajeBorrado || 'Borrado.' });
  return { deleted: true };
}

/** Escribe un texto (que puede traer montos o nombres) en un nodo, respetando el ojo de privacidad. */
export function escribir(ctx, el, texto) {
  const t = [].concat(ctx.ui.txt(texto || ''));
  el.replaceChildren(...t.map((n) => (n instanceof Node ? n : document.createTextNode(String(n)))));
  el.hidden = !texto;
}

/** Nodo con una línea chica de lectura (preview vivo). */
export const lineaVivo = (cls) => h('p', { class: ['preview-linea', cls], 'aria-live': 'polite' });

/** Chips de montos rápidos que completan un campo de dinero. */
export function chipsMonto(ctx, { montos, campo, etiquetaOtro }) {
  const { ui } = ctx;
  const wrap = h('div', { class: 'chips', role: 'group', 'aria-label': 'Montos sugeridos' });
  const pintar = () => {
    const v = campo.get();
    wrap.replaceChildren(...[...montos.map((m) => ui.chipButton(ctx.format.money(m), { selected: v === m, onClick: () => { campo.set(m); campo._emit?.(m); pintar(); } })),
      etiquetaOtro ? ui.chipButton(etiquetaOtro, { selected: v != null && !montos.includes(v), onClick: () => campo.focus() }) : null].filter(Boolean));
  };
  campo.onChange(pintar);
  pintar();
  return wrap;
}

/**
 * Fila con un monto: el monto va DEBAJO del título (no a la derecha), así el título no se parte en tres renglones
 * con letra grande o a 360px. Mismo criterio que Hoy. detalle: texto chico bajo el monto.
 */
export function filaConMonto(ctx, { icon, tone = 'brand', title, detalle, monto, chip, onClick, ariaLabel, pending }) {
  const { ui } = ctx;
  const sub = monto == null ? detalle : h('span', { style: { display: 'flex', flexDirection: 'column' } },
    h('span', { class: 't-h2 num', style: { color: 'var(--ink)' } }, ui.amt(monto)),
    detalle ? h('span', { class: 't-small muted' }, ui.txt(detalle)) : null);
  return ui.row({ icon, tone, title, sub, chip, onClick, ariaLabel, pending });
}

/**
 * Lista de filas TOCABLES (cada una es un botón o un enlace). No usa ui.rowList porque ese contenedor les pone role="listitem"
 * a las filas y los lectores de pantalla dejan de anunciarlas como botones. Mismo aspecto (tarjeta blanca con líneas finas).
 */
export const filas = (rows, { ariaLabel } = {}) => h('div', { class: 'card rows', role: 'group', 'aria-label': ariaLabel || null }, ...rows.filter(Boolean));
