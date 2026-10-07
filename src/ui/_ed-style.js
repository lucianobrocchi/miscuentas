// _ed-style.js · estilos propios de los editores, el armado, la bienvenida y Más (no están en styles/*.css, que es del kit).
// Se inyectan una sola vez como <style id="s4-css">. Solo variables del kit (--ink, --brand, ...), medidas en rem, nada menor a 1rem.

const CSS = `
/* ---- calendario de movilidad (12 chips en grilla de 3) ---- */
.cal-mov { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .5rem; }
.cal-cell { display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: .125rem; min-height: 4.25rem; padding: .625rem .75rem; text-align: left;
  border: 2px solid var(--field-border); border-radius: 1rem; background: var(--surface); color: var(--ink); cursor: pointer; }
.cal-cell:active { transform: scale(.98); }
.cal-cell.off { background: var(--surface-2); border-style: dashed; }
.cal-cell.fixed { border-color: var(--brand); }
.cal-mes { font-size: var(--t-small); line-height: 1.375; font-weight: 800; }
.cal-dias { font-size: var(--t-small); line-height: 1.375; font-weight: 700; color: var(--ink); }
.cal-nota { display: inline-flex; align-items: center; gap: .25rem; font-size: var(--t-small); line-height: 1.25; color: var(--ink-2); }
.cal-nota .icon { flex: none; }
@media (max-width: 22.5rem) { .cal-mov { grid-template-columns: repeat(2, minmax(0, 1fr)); } }

/* ---- resumen de ejemplo: "¿Dónde lo encuentro?" ---- */
.mock-resumen { border: 2px solid var(--line); border-radius: 1.25rem; background: var(--surface); padding: 1rem; display: flex; flex-direction: column; gap: .75rem; }
.mock-linea { display: flex; align-items: center; gap: .75rem; padding: .5rem .75rem; border-radius: .875rem; background: var(--surface-2); font-size: var(--t-small); line-height: 1.375; font-weight: 600; }
.mock-linea.marca { background: var(--brand-soft); color: var(--ink); }
.mock-num { flex: none; display: grid; place-items: center; width: 1.75rem; height: 1.75rem; border-radius: 50%; background: var(--brand); color: var(--btn-fg); font-size: var(--t-small); font-weight: 800; }
.mock-gris { flex: 1 1 auto; height: .625rem; border-radius: .5rem; background: var(--line); }

/* ---- pasos numerados (instalar la app) ---- */
.pasos { display: flex; flex-direction: column; gap: .75rem; counter-reset: paso; }
.paso { display: flex; align-items: flex-start; gap: .75rem; font-size: var(--t-body); line-height: 1.444; }
.paso-n { flex: none; display: grid; place-items: center; width: 2rem; height: 2rem; border-radius: 50%; background: var(--brand-soft); color: var(--brand); font-weight: 800; }
.on-hero .paso-n { background: var(--hero-tile); color: var(--hero-ink); }
.on-hero .paso { color: var(--hero-ink); }
.install-box { display: flex; flex-direction: column; gap: .75rem; padding: 1rem 1.125rem; border-radius: 1.25rem; background: var(--hero-tile); border: 1px solid var(--hero-line); color: var(--hero-ink); }
.install-box h2 { font-size: var(--t-h2); line-height: 1.3; font-weight: 800; color: var(--hero-ink); }
.install-box p { font-size: var(--t-small); line-height: 1.375; color: var(--hero-ink-2); }
.install-box .link { color: var(--hero-ink); }
.install-tabs { display: flex; gap: .5rem; flex-wrap: wrap; }
.install-tab { min-height: 3rem; padding: 0 1rem; border-radius: 99px; border: 2px solid var(--hero-line); color: var(--hero-ink); font-size: var(--t-small); font-weight: 700; background: transparent; }
.install-tab[aria-pressed="true"] { background: var(--hero-ink); color: var(--hero-bg); border-color: var(--hero-ink); }

/* ---- el botón de la Revelación queda siempre a la vista (las frases la alargan). En la Bienvenida no: primero se lee cómo instalarla ---- */
body[data-screen="revelacion"] .welcome-foot { position: sticky; bottom: 0; z-index: 2; padding-top: 1.5rem; margin-top: -1rem; background: linear-gradient(to top, var(--hero-bg) 70%, transparent); }

/* ---- personas del paso 1 ---- */
.people-list { display: flex; flex-wrap: wrap; gap: .5rem; }
.person-tag { display: inline-flex; align-items: center; gap: .25rem; min-height: 3rem; padding: 0 .25rem 0 1rem; border-radius: 99px; background: var(--brand-soft); color: var(--ink); font-size: var(--t-small); font-weight: 700; }
.person-tag button { display: grid; place-items: center; width: 3rem; height: 3rem; border-radius: 50%; color: var(--ink-2); }
.person-tag .tag-rol { font-weight: 450; color: var(--ink-2); }

/* ---- borrar: texto terracota (con ícono), debajo de Guardar ---- */
.btn-borrar, .btn-borrar .icon { color: var(--bad-fg); }

/* ---- Más ---- */
.mas-head { display: flex; align-items: center; gap: 1rem; }
.mas-head .grow { min-width: 0; }
.mas-chips { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: .5rem; }
.mas-borrar { margin-top: .5rem; }
.help-term { display: flex; flex-direction: column; gap: .25rem; padding: 1rem 0; border-top: 1px solid var(--line); }
.help-term:first-child { border-top: 0; padding-top: 0; }
.help-list { display: flex; flex-direction: column; gap: .75rem; list-style: none; padding: 0; margin: 0; }
.help-list li { display: flex; gap: .75rem; font-size: var(--t-body); line-height: 1.444; }
.help-list .icon { flex: none; margin-top: .25rem; color: var(--brand); }

/* ---- Revelación ---- */
.reveal-num { font-size: clamp(2.5rem, 13vw, 3.5rem); line-height: 1.07; font-weight: 800; letter-spacing: -.035em; color: var(--hero-ink); font-variant-numeric: tabular-nums lining-nums; }
.reveal-label { font-size: var(--t-small); line-height: 1.375; font-weight: 600; color: var(--hero-ink-2); }
.reveal-block { display: flex; flex-direction: column; gap: .5rem; }

/* ---- plata de hoy / dos columnas de campos ---- */
.dos-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(9.5rem, 1fr)); gap: .75rem; }
.preview-linea { font-size: var(--t-small); line-height: 1.375; color: var(--ink-2); font-weight: 600; }
.preview-linea.ok { color: var(--ok-fg); }
.fila-lista { display: flex; align-items: center; justify-content: space-between; gap: .75rem; }
`;

let puesto = false;
/** Inyecta los estilos una sola vez (idempotente). */
export function estilos() {
  if (puesto || typeof document === 'undefined') return;
  if (document.getElementById('s4-css')) { puesto = true; return; }
  const el = document.createElement('style');
  el.id = 's4-css';
  el.textContent = CSS;
  document.head.appendChild(el);
  puesto = true;
}
