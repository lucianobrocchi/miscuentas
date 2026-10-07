// _backup.js · copia de seguridad: mandársela a una misma por WhatsApp o mail (navigator.share con archivo; si no se puede, se descarga)
// y restaurarla de forma guiada (con pantalla de "qué reemplaza"). Lo usan Bienvenida y Más.

import { h } from './dom.js';
import { exportJSON, importJSON, describeState, marcarCopia } from '../store.js';
import { tieneDatos } from './_ed-logic.js';
import { avisoCompartido } from './_sync-ui.js';

/** Arma el archivo de la copia (File) a partir del estado actual. */
export function archivoDeCopia(ctx) {
  const { nombreArchivo, contenido } = exportJSON(ctx.state, ctx.today());
  const blob = new Blob([contenido], { type: 'application/json' });
  let file = null;
  try { file = new File([blob], nombreArchivo, { type: 'application/json' }); } catch { /* navegadores viejos: solo se descarga */ }
  return { nombreArchivo, contenido, blob, file };
}

/** Descarga el archivo (siempre funciona). */
export function descargarArchivo({ nombreArchivo, blob }) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: nombreArchivo, style: { display: 'none' } });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

const marcar = (ctx) => ctx.update((d) => { marcarCopia(d, ctx.today()); }, { rerender: true });

/**
 * "Mandarme una copia": abre el menú de compartir del celular con el archivo (WhatsApp, mail, Drive...). Sin ese menú, la descarga.
 * Devuelve 'compartida' | 'descargada' | 'cancelada'.
 */
export async function mandarCopia(ctx) {
  const a = archivoDeCopia(ctx);
  if (a.file && typeof navigator !== 'undefined' && navigator.canShare?.({ files: [a.file] })) {
    try {
      await navigator.share({ files: [a.file], title: 'Copia de Mis Cuentas', text: 'Mi copia de seguridad de Mis Cuentas.' });
      marcar(ctx);
      ctx.toast('Listo, la copia salió. Guardala donde la puedas encontrar.');
      return 'compartida';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelada';
      // cualquier otro error: se cae a la descarga
    }
  }
  descargarArchivo(a);
  marcar(ctx);
  ctx.toast('Se descargó tu copia. Buscala en Descargas y guardala donde la encuentres.');
  return 'descargada';
}

/** Descarga directa (sin menú de compartir). */
export function descargarCopia(ctx) {
  descargarArchivo(archivoDeCopia(ctx));
  marcar(ctx);
  ctx.toast('Se descargó tu copia. Buscala en Descargas.');
}

/** Abre el selector de archivos y devuelve el File elegido (o null si no eligió). */
export function elegirArchivo() {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept: '.json,application/json,text/plain', style: { display: 'none' }, 'aria-hidden': 'true', tabindex: '-1' });
    let hecho = false;
    const fin = (f) => { if (hecho) return; hecho = true; input.remove(); resolve(f); };
    input.addEventListener('change', () => fin(input.files && input.files[0] ? input.files[0] : null));
    input.addEventListener('cancel', () => fin(null));
    document.body.append(input);
    input.click();
  });
}

const leerTexto = (file) => (file.text ? file.text() : new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsText(file); }));

/** Lee un archivo de copia. -> { ok, mensaje? } | { ok, state, resumen, fecha, nombre } */
export async function leerCopia(ctx, file) {
  let texto = '';
  try { texto = await leerTexto(file); } catch { return { ok: false, mensaje: 'No pudimos leer ese archivo. Probá con otro.' }; }
  const r = importJSON(texto, { today: ctx.today() });
  if (!r.ok) return r;
  let fecha = null;
  try { const o = JSON.parse(texto); fecha = typeof o.exportedAt === 'string' ? o.exportedAt : null; } catch { /* nada */ }
  return { ...r, fecha, nombre: file.name };
}

/**
 * Restauración guiada: 1) "Buscá el archivo que te mandaste", 2) qué tiene la copia y qué reemplaza, 3) confirmar.
 * alRestaurar() se llama después de restaurar (por ejemplo para ir a Hoy). Devuelve Promise<boolean>.
 */
export function hojaRestaurar(ctx, { alRestaurar } = {}) {
  const { ui } = ctx;
  return new Promise((resolve) => {
    let restaurada = false;
    let hoja = null;
    let cuerpo = null;
    const vistaPrimera = (aviso) => {
      cuerpo.replaceChildren(h('div', { class: 'stack-4' },
        h('p', { class: 't-body' }, 'Buscá el archivo que te mandaste. Se llama algo como “mis-cuentas-2026-10-04.json” y puede estar en WhatsApp, en tu mail o en Descargas.'),
        aviso ? ui.notice({ tone: 'warn', title: aviso }) : null,
        ui.btn({ label: 'Elegir el archivo', icon: 'subir', onClick: async () => { const f = await elegirArchivo(); if (f) await revisar(f); } })));
      hoja.setFooter([ui.btn({ label: 'Cancelar', variant: 'text', onClick: () => hoja.close() })]);
    };
    const revisar = async (file) => {
      const r = await leerCopia(ctx, file);
      if (!r.ok) { vistaPrimera(r.mensaje); return; }
      const hay = tieneDatos(ctx.state);
      const actual = describeState(ctx.state).texto;
      cuerpo.replaceChildren(h('div', { class: 'stack-4' },
        h('p', { class: 't-body' }, `Esta copia tiene: ${r.resumen.texto}.${r.fecha ? ` La hiciste el ${ctx.format.longDate(r.fecha, { year: true })}.` : ''}`),
        r.descartados > 0 ? ui.footnote(`Dejamos afuera ${r.descartados} dato${r.descartados === 1 ? '' : 's'} que no se pudieron leer.`) : null,
        hay ? ui.notice({ tone: 'warn', title: 'Si seguís, esta copia reemplaza lo que tenés ahora.', text: `Ahora hay: ${actual}.` }) : null,
        avisoCompartido(ctx, 'La copia reemplaza lo que hay en la nube, en los celulares de los demás.')));
      hoja.setFooter([
        ui.btn({ label: 'Sí, restaurar esta copia', onClick: async () => {
          const nuevo = r.state;
          ctx.update(() => ({ ...nuevo, settings: { ...nuevo.settings, onboarded: tieneDatos(nuevo) ? true : nuevo.settings.onboarded, demo: false } }), { undoLabel: 'Listo, recuperamos tu copia.' });
          restaurada = true;
          // si hay que navegar, se hace con la hoja todavía abierta: ctx.nav la cierra y arregla el historial (cerrar primero y navegar después lo desordena)
          if (alRestaurar) await alRestaurar(); else hoja.close();
        } }),
        ui.btn({ label: 'No, dejar todo como está', variant: 'text', onClick: () => hoja.close() }),
      ]);
    };
    hoja = ctx.sheet.open({
      title: 'Restaurar una copia',
      render(body) { cuerpo = body; },
      onClose: () => resolve(restaurada),
    });
    vistaPrimera();
  });
}
