// _sync-ui.js · la parte visible de la nube: arranque del sincronizador, hojas de "¿con qué datos seguís?", avisos, el indicador
// de estado (Más > Tus datos) y el aviso de "esto cambia los datos de todos". La lógica está en src/sync.js (pura y probada).
// Lo carga app.js solo si este celular tiene la clave; Más lo importa para mostrar el indicador.

import { h, icon } from './dom.js';
import { createSync, getKey, shareLink } from '../sync.js';

const storageSeguro = () => { try { return localStorage; } catch { return null; } };

// ---------------------------------------------------------------- textos del estado
const TEXTOS = {
  inicio: 'Conectando con la nube…',
  ok: 'Guardado en la nube',
  guardando: 'Guardando…',
  offline: 'Sin conexión: se guarda en este celular y se sube cuando vuelva',
  error: 'No pudimos guardar en la nube. Lo seguimos intentando.',
  'sin-nube': 'Sin nube configurada',
  clave: 'No pudimos conectar con la nube. Revisá que el link sea el correcto.',
  decidir: 'Falta elegir con qué datos seguir',
  invalido: 'No pudimos leer los datos de la nube',
};
const ICONOS = { inicio: 'reloj', ok: 'tilde', guardando: 'reloj', offline: 'info', error: 'info', 'sin-nube': 'info', clave: 'info', decidir: 'alerta', invalido: 'alerta' };

export function textoEstado(status) {
  if (status?.code === 'error' && status.motivo === 'grande') return 'Tus datos son demasiado grandes para la nube. Siguen a salvo en este celular.';
  return TEXTOS[status?.code] || TEXTOS['sin-nube'];
}

const estadoDe = (ctx) => ctx.sync?.status?.() || { code: 'sin-nube' };

// ---------------------------------------------------------------- indicadores vivos (se repintan solos cuando cambia el estado)
const vivos = new Set();
function pintarLinea(entrada) {
  const { el, ctx } = entrada;
  const st = estadoDe(ctx);
  el.dataset.estado = st.code;
  el.replaceChildren(icon(ICONOS[st.code] || 'info', { size: 'sm' }), h('span', null, textoEstado(st)));
}
function pintarTodo() {
  for (const e of [...vivos]) {
    if (!e.el.isConnected) vivos.delete(e);
    else pintarLinea(e);
  }
}

/** Línea discreta con el estado de la nube ("Guardado en la nube"). Se actualiza sola mientras esté en pantalla. */
export function lineaNube(ctx, { vivo = false } = {}) {
  const el = h('p', { class: 'cluster t-small muted nube-linea', ...(vivo ? { role: 'status' } : {}) });
  const entrada = { el, ctx };
  pintarLinea(entrada);
  vivos.add(entrada);
  return el;
}

/** ¿Este celular está conectado a una nube (tiene la clave)? */
export const nubeActiva = (ctx) => !!(ctx.sync?.hasKey?.() || getKey(storageSeguro() || { getItem: () => null }));

/** Frase para el pie de Más y de Hoy. */
export const dondeEstanLosDatos = (ctx) => (nubeActiva(ctx) ? 'Tus datos se guardan en este celular y en la nube.' : 'Tus datos están solo en este celular.');

/** Aviso para las hojas de "Borrar todo" y "Restaurar una copia": con nube activa el cambio le llega a todos. null si no hay nube. */
export function avisoCompartido(ctx, detalle) {
  if (!nubeActiva(ctx)) return null;
  return ctx.ui.notice({
    tone: 'warn',
    title: 'Esto cambia los datos de TODOS los que usan este link.',
    text: detalle || 'Lo que hagas acá también se aplica en la nube y en los celulares de los demás.',
  });
}

// ---------------------------------------------------------------- compartir el link (con la clave, sin mostrarla)
export async function compartirLink(ctx) {
  const url = shareLink(storageSeguro() || { getItem: () => null }, location.origin, location.pathname);
  if (!url) { ctx.toast('Este celular todavía no está conectado a la nube.'); return false; }
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Mis Cuentas', text: 'Abrí este link para ver y cargar las cuentas de la familia.', url });
      return true;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return false;
  }
  try {
    await navigator.clipboard.writeText(url);
    ctx.toast('Copiamos el link. Pegalo en el mensaje para mandarlo.');
    return true;
  } catch {
    ctx.toast('No pudimos copiar el link. Probá de nuevo.');
    return false;
  }
}

// ---------------------------------------------------------------- tarjeta de la nube (Más > Tus datos)
export function tarjetaNube(ctx) {
  const { ui } = ctx;
  const st = estadoDe(ctx);
  const activa = nubeActiva(ctx);
  const acciones = [];
  if (st.code === 'decidir' || st.code === 'invalido') {
    acciones.push(ui.btn({ label: 'Elegir con qué datos seguir', icon: 'llave', onClick: () => ctx.sync?.decidir() }));
  }
  if (activa) {
    acciones.push(ui.btn({ label: 'Revisar ahora', variant: 'secondary', icon: 'reloj', onClick: async () => { await ctx.sync?.poll({ forzar: true }); } }));
    acciones.push(ui.btn({ label: 'Compartir el link con tu familia', variant: 'secondary', icon: 'compartir', onClick: () => compartirLink(ctx) }));
  }
  return ui.card(h('div', { class: 'stack-3' },
    h('h2', { class: 't-h2' }, 'La nube'),
    lineaNube(ctx, { vivo: true }),
    h('p', { class: 't-body muted' }, activa
      ? 'Lo que cargues en este celular lo ven los demás que usan este link, y al revés. Sin internet seguís usando la app y se sube cuando vuelva.'
      : 'Si te pasaron un link para compartir las cuentas, abrilo en este celular y queda todo conectado. Mientras tanto, tus datos están solo acá.'),
    ...acciones));
}

// ---------------------------------------------------------------- hojas de decisión
const fechaDe = (ctx, iso) => { try { return iso ? ctx.format.longDate(new Date(iso), { year: true }) : null; } catch { return null; } };

/**
 * Hoja "¿con qué datos seguís?". info.kind: 'primera' (este celular y la nube tienen datos distintos), 'conflicto' (los dos cambiaron lo mismo)
 * o 'invalido' (no se pueden leer los de la nube). Devuelve Promise<'nube' | 'mio' | null> (null = decidir después). Nunca decide sola.
 */
export function hojaDecision(ctx, info) {
  const { ui } = ctx;
  return new Promise((resolve) => {
    let elegido = null;
    const fecha = fechaDe(ctx, info.savedAt);
    const titulos = { primera: 'Ya hay datos en la nube', conflicto: 'Hay cambios distintos', invalido: 'No pudimos leer la nube' };
    const intro = {
      primera: 'Este celular y la nube tienen datos distintos. Elegí con cuáles seguir.',
      conflicto: 'Otra persona cambió lo mismo que vos y no podemos juntarlo solos. Elegí con cuáles seguir.',
      invalido: 'Puede ser que se hayan guardado con una versión más nueva de la app. Tus datos de este celular están a salvo.',
    }[info.kind];
    // cada opción: qué tiene, el botón y, debajo, en una frase, qué se pierde si la elegís
    const lado = (titulo, resumen, boton, consecuencia) => ui.card(h('div', { class: 'stack-2' },
      h('h3', { class: 't-row' }, titulo),
      resumen ? h('p', { class: 't-small muted' }, `Tiene: ${resumen}.`) : null,
      boton,
      h('p', { class: 't-small' }, consecuencia)), { pad: 'md' });
    const elegir = (v, close) => () => { elegido = v; close(v); };
    ctx.sheet.open({
      title: titulos[info.kind] || titulos.primera,
      size: 'tall',
      render(body, close) {
        const nube = info.remote ? lado(
          'Lo que hay en la nube',
          info.remote.resumen?.texto,
          ui.btn({ label: info.kind === 'conflicto' ? 'Quedarme con lo de la nube' : fecha ? `Usar los de la nube (guardados el ${fecha})` : 'Usar los de la nube', variant: 'secondary', onClick: elegir('nube', close) }),
          info.kind === 'conflicto' ? 'Se pierde lo que cambiaste en este celular desde la última vez que se guardó.' : 'Se pierde lo que hay ahora en este celular.') : null;
        const mio = lado(
          'Lo que hay en este celular',
          info.local?.resumen?.texto,
          ui.btn({ label: info.kind === 'conflicto' ? 'Quedarme con lo mío y reemplazar la nube' : 'Usar los de este celular (reemplazan los de la nube)', variant: 'danger', onClick: elegir('mio', close) }),
          info.kind === 'conflicto' ? 'Se pierde lo que cambió la otra persona, para todos los que usan este link.' : 'Se pierde lo que hay en la nube, para todos los que usan este link.');
        body.append(h('div', { class: 'stack-3' },
          h('p', { class: 't-body' }, intro),
          nube, mio));
      },
      footer: (close) => [ui.btn({ label: 'Decidir después', variant: 'text', onClick: () => close(null) })],
      onClose: () => resolve(elegido),
    });
  });
}

// ---------------------------------------------------------------- avisos
const AVISOS = {
  actualizado: ['Se actualizaron los datos', 4000],
  bajado: ['Listo, se cargaron los datos de la nube.', 6000],
  unido: ['Juntamos tus cambios con los de la otra persona.', 6000],
  invalido: ['No pudimos leer los datos de la nube. Los tuyos siguen a salvo en este celular.', 8000],
  despues: ['Cuando quieras, elegí con qué datos seguir desde Más, en Tus datos.', 8000],
};

// ---------------------------------------------------------------- arranque
const escribiendo = () => {
  const a = document.activeElement;
  return !!(a && a !== document.body && a.matches?.('input, textarea, select, [contenteditable="true"]'));
};

/** Arranca la sincronización. applyState(state, {kind}) lo provee app.js (reemplaza el estado sin volver a avisar un cambio local). */
export function startSync(ctx, { applyState }) {
  const ctrl = createSync({
    fetch: (...a) => fetch(...a),
    storage: storageSeguro() || { getItem: () => null, setItem() {}, removeItem() {} },
    getState: () => ctx.state,
    applyState,
    today: () => ctx.today(),
    choose: (info) => hojaDecision(ctx, info),
    conflict: (info) => hojaDecision(ctx, info),
    notify: (kind) => { const a = AVISOS[kind]; if (a) ctx.toast(a[0], { duration: a[1] }); },
    canApply: () => !ctx.sheet.isOpen() && !escribiendo(),
    isVisible: () => document.visibilityState === 'visible',
    onStatus: pintarTodo,
  });
  ctx.sync = ctrl;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') ctrl.poll();
    else ctrl.flush(); // al pasar a segundo plano se sube lo pendiente sin esperar
  });
  addEventListener('focus', () => ctrl.poll());
  addEventListener('online', () => ctrl.online());
  ctrl.start();
  return ctrl;
}
