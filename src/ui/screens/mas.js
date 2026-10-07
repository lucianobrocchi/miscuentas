// mas.js · "Más": tus datos (anillo y pendientes), listas editables (ingresos, gastos, cuotas, tarjetas, me deben), ajustes, apariencia
// (tema y tamaño de letra), copia de seguridad, ayuda y borrar todo. Rutas: #/mas y #/mas/<sec> (ver _mas-secciones.js).

import { h } from '../dom.js';
import { estilos } from '../_ed-style.js';
import { filas } from '../_ed-core.js';
import { estadoVacioConservando } from '../_ed-logic.js';
import { SECCIONES, RENDER } from './_mas-secciones.js';
import { diasDesdeCopia } from '../../store.js';
import { lineaNube, dondeEstanLosDatos, avisoCompartido } from '../_sync-ui.js';
import { monthName, haceTiempo } from '../../format.js';

export default {
  id: 'mas',
  title: (ctx, params) => SECCIONES[params?.sec]?.titulo || 'Más',
  mount(root, ctx, params) {
    estilos();
    const sec = params?.sec || null;
    const hoy = ctx.today();
    try { ctx.setBadges({ mas: !!ctx.derive.indicadores?.(ctx.state, hoy)?.mas }); } catch { /* el punto es solo un aviso */ }
    if (sec) {
      if (!SECCIONES[sec]) { ctx.nav('#/mas', { replace: true }); return undefined; }
      ctx.header({ back: '#/mas' });   // el título lo lleva la página
      RENDER[sec](ctx, root);
      return undefined;
    }
    ctx.header({});   // el título lo lleva la página
    indice(ctx, root);
    return undefined;
  },
};

function indice(ctx, root) {
  const { ui } = ctx;
  const s = ctx.state;
  const D = ctx.derive;
  const F = ctx.format;
  const hoy = ctx.today();
  const c = D.completitud(s, hoy);

  // ------------------------------------------------------------------ tus datos
  const pendientes = c.faltan.slice(0, 6).map((f) => h('button', {
    type: 'button', class: 'chipbtn chipbtn-info', onclick: () => ctx.nav(`#/armar/${f.paso}`), 'aria-label': `${f.texto}: completar`,
  }, h('span', { class: 'chipbtn-face' }, ui.icon('alerta', { size: 'sm' }), h('span', null, f.texto))));
  const tarjetaDatos = ui.card([
    h('div', { class: 'mas-head' },
      ui.ring({ value: c.hechos, total: 7, label: `${c.hechos} de 7` }),
      h('div', { class: 'grow stack-1' },
        h('h2', { class: 't-h2' }, 'Tus datos'),
        h('p', { class: 't-body muted' }, c.completo ? 'Está todo cargado.' : `Cargaste ${c.hechos} de 7. Cuanto más completo, más exactos los números.`))),
    lineaNube(ctx),
    pendientes.length ? h('div', { class: 'mas-chips' }, ...pendientes) : null,
    ui.link({ label: 'Ver todos los pasos', onClick: () => ctx.nav('#/mas/datos'), icon: 'chevron' }),
  ], { cls: 'stack-3' });

  // ------------------------------------------------------------------ resúmenes de cada sección
  const mes0 = D.lineasMes(s, 0, hoy);
  const entra = mes0?.entraTotal;
  const gastosMes = mes0 ? mes0.sale.filter((l) => l.lista === 'expenses').reduce((a, l) => a + l.monto, 0) : 0;
  const nCuotas = s.installments.length;
  const afip = (s.pending || []).some((p) => p.target === 'afip');
  const tarjeta = s.debts.find((d) => d.kind === 'card');
  const totalDeben = s.receivables.reduce((a, r) => a + Number(r.balance || 0), 0);
  const gustos = s.expenses.find((e) => e.kind === 'gustos');
  const tema = { auto: 'Automático', light: 'Claro', dark: 'Oscuro' }[s.settings.theme] || 'Automático';
  const letra = { normal: 'Letra normal', grande: 'Letra grande', masgrande: 'Letra más grande' }[s.settings.fontSize] || 'Letra normal';
  const dias = diasDesdeCopia(s, hoy);
  const fila = (icon, titulo, sub, sec, extra = {}) => ui.row({ icon, tone: 'brand', title: titulo, sub, onClick: () => ctx.nav(`#/mas/${sec}`), ...extra });
  const lista = filas([
    fila('flecha-arriba', 'Ingresos', entra != null ? `${F.money(entra)} en ${monthName(hoy)}` : 'Todavía no cargaste', 'ingresos'),
    fila('billetera', 'Gastos', gastosMes > 0 ? `${F.money(gastosMes)} por mes` : 'Todavía no cargaste', 'gastos'),
    fila('banco', 'Cuotas y descuentos', nCuotas ? `${nCuotas} ${nCuotas === 1 ? 'préstamo o cuota' : 'préstamos o cuotas'}${afip ? ', AFIP sin completar' : ''}` : afip ? 'AFIP sin completar' : 'Ninguna cargada', 'cuotas'),
    fila('tarjeta', 'Tarjetas y deudas', tarjeta ? `${tarjeta.name || 'Tarjeta'}: debés ${F.money(tarjeta.balance)}` : s.debts.length ? `${s.debts.length} deudas` : 'Ninguna cargada', 'tarjetas'),
    fila('usuarios', 'Me deben', s.receivables.length ? `${F.money(totalDeben)} en total` : 'Nadie te debe', 'medeben'),
    fila('llave', 'Ajustes', gustos ? `Plata para gustos: ${F.money(gustos.amount)} por mes` : 'Familia, plata de hoy y gustos', 'ajustes'),
    fila('luna', 'Apariencia', `${tema} · ${letra}`, 'apariencia'),
    fila('descargar', 'Copia de seguridad', dias === null ? 'Todavía no hiciste una copia' : `Última copia: ${haceTiempo(s.settings.lastBackupAt, hoy)}`, 'copia', dias === null || dias > 30 ? { chip: { label: 'Hacela', tone: 'warn' } } : {}),
    fila('ayuda-circulo', 'Ayuda', 'Cómo se calculan los números', 'ayuda'),
  ]);

  // ------------------------------------------------------------------ borrar todo
  // Hoja de consecuencias propia (y no sheet.confirm): al confirmar hay que ir a la Bienvenida y eso se hace con la hoja todavía abierta
  // (ctx.nav la cierra y arregla el historial; cerrar primero y navegar después lo desordena).
  const borrarTodo = () => ctx.sheet.open({
    title: '¿Borrar todos tus datos?',
    cls: 'sheet-confirm',
    render(body) {
      body.append(h('div', { class: 'stack-3' },
        h('div', { class: 'icon-tile tone-bg-bad' }, ui.icon('papelera')),
        h('p', { class: 't-body' }, 'Se borra todo lo que cargaste en este celular: ingresos, gastos, deudas y lo que te deben. Solo lo podés recuperar con una copia de seguridad.'),
        h('p', { class: 't-body' }, 'Si querés, primero mandate una copia.'),
        avisoCompartido(ctx, 'Se borra también en la nube y en los celulares de los demás, no solo en este.')));
    },
    footer: (close) => [
      ui.btn({ label: 'Sí, borrar todo', variant: 'danger', onClick: async () => {
        ctx.update((d) => estadoVacioConservando(d, ctx.today()), { rerender: false, undoLabel: 'Borramos todo.', onUndo: () => ctx.nav('#/mas') });
        await ctx.nav('#/bienvenida');
      } }),
      ui.btn({ label: 'No, dejar todo como está', variant: 'text', onClick: () => close() }),
    ],
  });

  root.append(
    ui.pageTitle('Más'),
    tarjetaDatos,
    lista,
    ui.btn({ label: 'Borrar todo', variant: 'text', icon: 'papelera', cls: 'btn-borrar mas-borrar', onClick: borrarTodo }),
    ui.footnote(`${dondeEstanLosDatos(ctx)} Versión 2.0.`));
}
