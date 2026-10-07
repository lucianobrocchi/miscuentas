// onboarding.js · "Armá tu panorama": 7 pasos con una pregunta por pantalla + la revelación. Rutas: #/armar/0 (qué tener a mano) · #/armar/1 a 7 ·
// #/armar/listo (revelación). Algunos pasos tienen dos pantallas (?p=2). Usa los MISMOS campos que los editores (src/ui/_ed-forms.js).
// Reglas: "No lo sé todavía" y "Seguir después" en todos; se guarda al instante y retoma donde quedó; nunca rojo en la carga;
// la recompensa del paso de la tarjeta es una fecha y una acción (sin interés por día). Si el armado ya terminó (onboarded), cada
// paso funciona como EDITOR: "Guardar" vuelve a donde estabas.

import { h, countUp } from '../dom.js';
import { estilos } from '../_ed-style.js';
import { filas } from '../_ed-core.js';
import * as FM from '../_ed-forms.js';
import * as L from '../_ed-logic.js';
import { hojaInstalar } from '../_install.js';
import { mandarCopia } from '../_backup.js';
import { marcarVisto } from '../../store.js';

const ETIQUETAS = { 1: 'Vos y tu familia', 2: 'Lo que cobrás', 3: 'Movilidad', 4: 'Gastos de la casa y gustos', 5: 'Lo que te descuentan', 6: 'Tu tarjeta', 7: 'Lo que te deben' };
const ULTIMA_PANTALLA = { 2: 2, 4: 2 };
const ROLES_ETIQUETA = { pareja: 'Pareja', hijo: 'Hijo', hija: 'Hija', otro: 'Otra persona', yo: 'Vos' };

const hashPaso = (n, p = 1) => `#/armar/${n}${p > 1 ? `?p=${p}` : ''}`;

export default {
  id: 'onboarding',
  title: 'Armá tu panorama',
  mount(root, ctx, params, route) {
    estilos();
    ctx.header(false);
    const clave = String(params?.step ?? '1');
    const p = Number(route?.query?.p || 1) === 2 ? 2 : 1;
    const env = { ctx, root, p, editor: ctx.state.settings.onboarded === true, hoy: ctx.today() };
    if (clave === 'listo') return revelacion(env);
    const n = Number(clave);
    if (!Number.isInteger(n) || n < 0 || n > 7) { ctx.nav('#/armar/1', { replace: true }); return undefined; }
    if (n === 0) return intro(env);
    return PASOS[n](env);
  },
};

// ----------------------------------------------------------------------------------------------- piezas comunes
/** Guarda al instante (sin re-dibujar) y recuerda hasta qué paso llegó. */
function guardar(env, n, fn) {
  env.ctx.update((d) => {
    fn?.(d);
    d.settings.onboardingStep = Math.max(d.settings.onboardingStep || 0, n);
  }, { rerender: false });
}

/** Termina un paso: en el armado sigue al próximo; como editor vuelve a donde estabas. */
function siguiente(env, n) {
  if (env.editor) { env.ctx.toast('Listo, guardado.'); env.ctx.back('#/hoy'); return; }
  env.ctx.nav(n >= 7 ? '#/armar/listo' : hashPaso(n + 1));
}

function atras(env, n) {
  const { ctx } = env;
  if (env.editor) return ctx.back('#/hoy');
  if (env.p > 1) return ctx.nav(hashPaso(n, 1));
  if (n > 1) return ctx.nav(hashPaso(n - 1, ULTIMA_PANTALLA[n - 1] || 1));
  return ctx.nav('#/armar/0');
}

/** "Seguir después": sale al tablero y recuerda el paso. */
function seguirDespues(env, n) {
  const { ctx } = env;
  ctx.update((d) => {
    d.settings.onboardingStep = Math.max(d.settings.onboardingStep || 0, n);
    if (L.tieneDatos(d)) d.settings.onboarded = true;
  }, { rerender: false });
  ctx.nav('#/hoy');
}

/** Pantalla de un paso con todos los comunes: Volver, "Seguir después", "No lo sé todavía". */
function pantalla(env, n, cfg) {
  const { ctx } = env;
  const secundario = cfg.secundario === undefined
    ? { label: 'No lo sé todavía', onClick: () => siguiente(env, n) }
    : cfg.secundario;
  env.root.replaceChildren(ctx.ui.stepShell({
    step: n, stepLabel: ETIQUETAS[n], question: cfg.pregunta, help: cfg.ayuda, content: cfg.contenido, extra: cfg.extra,
    reward: cfg.recompensa, onBack: () => atras(env, n), onSkip: env.editor ? null : () => seguirDespues(env, n),
    primary: { label: cfg.primario?.label || (env.editor ? 'Guardar' : 'Seguir'), onClick: cfg.primario?.onClick },
    secondary: secundario,
  }));
  window.scrollTo?.({ top: 0 });
}

/** Muestra la recompensa del paso (si hay) y después sigue. */
function conRecompensa(env, n, { extra, primario, secundario } = {}) {
  const { ctx } = env;
  const r = env.editor ? null : ctx.derive.recompensa(ctx.state, n, env.hoy);
  if (!r) { siguiente(env, n); return; }
  const nodos = [];
  if (r.detalle) nodos.push(h('p', { class: 't-body muted' }, ctx.ui.txt(`${r.detalle}.`)));
  if (r.provisoria) nodos.push(h('div', { class: 'cluster' }, ctx.ui.chip('Fecha provisoria', { tone: 'info', icon: 'info' })));
  if (r.detalle) {
    nodos.push(ctx.ui.link({ label: 'Qué supone esta fecha', icon: 'chevron', onClick: () => {
      const sal = ctx.derive.salidaTarjeta(ctx.state, env.hoy);
      ctx.sheet.info({ title: 'Qué supone esta fecha', content: h('div', { class: 'stack-3' }, h('ul', { class: 'help-list' }, ...(sal.queSupone || []).map((t) => h('li', null, ctx.ui.icon('tilde', { size: 'sm' }), h('span', null, ctx.ui.txt(t))))), ctx.ui.disclaimer()) });
    } }));
  }
  if (extra) nodos.push(extra);
  env.root.replaceChildren(ctx.ui.stepShell({
    step: n, stepLabel: ETIQUETAS[n], question: 'Anotado', reward: { text: r.texto }, extra: h('div', { class: 'stack-2' }, ...nodos),
    onBack: () => atras(env, n), onSkip: () => seguirDespues(env, n),
    primary: { label: primario?.label || 'Seguir', onClick: primario?.onClick || (() => siguiente(env, n)) },
    secondary: secundario === undefined ? null : secundario,
  }));
  window.scrollTo?.({ top: 0 });
}

const hojaPanorama = (ctx) => {
  const { ui } = ctx;
  const hoy = ctx.today();
  const hero = ctx.derive.hero(ctx.state, hoy);
  return ctx.sheet.open({
    title: 'Tu panorama hasta ahora',
    size: 'tall',
    render(body) {
      if (hero.estado !== 'ok') { body.append(ui.empty({ title: hero.texto, art: 'barras' })); return; }
      const sal = ctx.derive.salidaTarjeta(ctx.state, hoy);
      body.append(h('div', { class: 'stack-4' },
        ui.hero({
          label: hero.rotulo, value: hero.numero, status: hero.chip.tone, statusLabel: hero.chip.texto, caption: hero.subtitulo,
          aviso: { icon: hero.aviso.accion ? 'alerta' : 'tilde', text: hero.aviso.texto }, strip: hero.tira, countKey: 'panorama-ob',
        }),
        sal.estado === 'fecha' ? h('div', { class: 'stack-1' }, h('p', { class: 't-row' }, `Salís de la tarjeta en ${sal.mesNombre}.`), h('p', { class: 't-small muted' }, `${sal.supuesto}.`)) : null,
        ui.footnote('Es un panorama provisorio: se va afinando con lo que sigas cargando.'),
        ui.disclaimer()));
    },
    footer: (close) => ui.btn({ label: 'Seguir afinando', onClick: () => close() }),
  });
};

// ----------------------------------------------------------------------------------------------- paso 0: tené a mano
function intro(env) {
  const { ctx } = env;
  const { ui } = ctx;
  const s = ctx.state;
  const paso = s.settings.onboardingStep > 0 && s.settings.onboardingStep < 7 && L.tieneDatos(s) ? s.settings.onboardingStep : 0;
  const item = (icono, titulo, sub) => ui.row({ icon: icono, tone: 'brand', title: titulo, sub });
  env.root.replaceChildren(ui.stepShell({
    step: 0, stepLabel: null, question: 'Para empezar, tené a mano:',
    help: 'Con esos dos papeles es más rápido y más exacto. Si no los tenés ahora, podés cargar lo que sepas y completar después.',
    content: [
      h('div', { class: 'card rows' },
        item('documento', 'Tu recibo de sueldo', 'Para el sueldo y los descuentos.'),
        item('tarjeta', 'El último resumen de tu tarjeta', 'Para saber cuánto debés y cuándo vence.')),
      h('p', { class: 't-body' }, 'Son unos 10 minutos, y podés frenar cuando quieras: lo que cargues queda guardado en tu celular.'),
    ],
    onBack: () => ctx.nav('#/bienvenida'),
    primary: { label: paso ? `Seguir en el paso ${paso} de 7` : 'Empezar', onClick: () => ctx.nav(paso ? hashPaso(paso) : hashPaso(1)) },
    secondary: paso ? { label: 'Empezar de nuevo desde el paso 1', onClick: () => ctx.nav(hashPaso(1)) } : null,
  }));
}

// ----------------------------------------------------------------------------------------------- paso 1: vos y tu familia
function paso1(env) {
  const { ctx } = env;
  const { ui } = ctx;
  const { fields: F } = ui;
  const s = ctx.state;
  const nombre = F.text({ name: 'nombre', value: s.settings.name || '', maxLength: 40, required: true, requiredMsg: 'Poné tu nombre o cómo te gusta que te digan.', autocomplete: 'given-name', autofocus: !env.editor });
  nombre.input.setAttribute('aria-label', '¿Cómo te llamamos?');
  let otros = s.people.filter((p) => p.role !== 'yo').map((p) => ({ name: p.name, role: p.role }));
  const lista = h('div', { class: 'people-list', role: 'list', 'aria-label': 'Personas que sumaste' });
  const nuevoNombre = F.text({ label: 'Nombre', name: 'otro', value: '', maxLength: 40, placeholder: 'Por ejemplo: Abuela', onEnter: () => agregar() });
  const rol = F.choice({ label: 'Es tu…', name: 'rol', variant: 'chips', value: 'otro', options: L.ROLES_PERSONA.map((r) => ({ value: r.value, label: r.value === 'otro' ? 'Otra persona' : r.label })) });
  const pintar = () => {
    lista.replaceChildren(...otros.map((o, i) => h('span', { class: 'person-tag', role: 'listitem' },
      h('span', null, ui.personName(o.name, i + 1)), (ROLES_ETIQUETA[o.role] || 'Otra persona').toLowerCase() === o.name.trim().toLowerCase() ? null : h('span', { class: 'tag-rol' }, ` · ${ROLES_ETIQUETA[o.role] || 'Otra persona'}`),
      h('button', { type: 'button', 'aria-label': `Sacar a ${ui.aliasName(o.name, i + 1)} de la lista`, onclick: () => { otros.splice(i, 1); pintar(); } }, ui.icon('x')))));
    lista.hidden = !otros.length;
    btnAgregar.disabled = otros.length >= 8;
  };
  const agregar = () => {
    const n = nuevoNombre.get().trim();
    if (!n) { nuevoNombre.setError('Escribí un nombre para sumarlo.'); nuevoNombre.focus(); return false; }
    if (otros.length >= 8) { nuevoNombre.setError('Podés sumar hasta 8 personas.'); return false; }
    if (otros.some((o) => o.name.toLowerCase() === n.toLowerCase()) || n.toLowerCase() === nombre.get().trim().toLowerCase()) { nuevoNombre.setError('Ya está en la lista.'); return false; }
    otros.push({ name: n, role: rol.get() || 'otro' });
    nuevoNombre.set(''); nuevoNombre.clearError(); pintar(); nuevoNombre.focus();
    return true;
  };
  const btnAgregar = ui.btn({ label: 'Sumar a la lista', variant: 'secondary', icon: 'mas', onClick: agregar });
  pintar();
  const seguir = () => {
    if (nuevoNombre.get().trim() && !agregar()) return;
    if (!F.validateAll([nombre])) return;
    guardar(env, 1, (d) => L.guardarFamilia(d, { name: nombre.get(), otros }));
    conRecompensa(env, 1);
  };
  pantalla(env, 1, {
    pregunta: '¿Cómo te llamamos?',
    ayuda: 'Lo uso para saludarte. Y para ordenar las cuentas: ¿quiénes más usan tus tarjetas o te deben plata?',
    contenido: [
      nombre.el,
      h('div', { class: 'stack-3' }, h('p', { class: 'field-label' }, '¿Quiénes más usan tus tarjetas o te deben plata?'), h('p', { class: 'field-hint' }, 'Es opcional. Podés sumar hasta 8 personas.'), lista, nuevoNombre.el, rol.el, btnAgregar),
    ],
    primario: { onClick: seguir },
    secundario: { label: 'Somos solo yo', onClick: () => { guardar(env, 1, (d) => L.guardarFamilia(d, { name: nombre.get() || d.settings.name || '', otros: [] })); if (!nombre.get().trim()) { F.validateAll([nombre]); return; } conRecompensa(env, 1); } },
  });
}

// ----------------------------------------------------------------------------------------------- paso 2: lo que cobrás (sueldo y plata de hoy)
function paso2(env) {
  const { ctx } = env;
  const { ui } = ctx;
  const s = ctx.state;
  if (env.p === 2) {
    const f = FM.camposPlataDeHoy(ctx, { state: s, labels: false });
    pantalla(env, 2, {
      pregunta: '¿Cuánta plata tenés hoy en la cuenta?',
      ayuda: 'Lo uso para saber con cuánta plata contás hoy. Si no sabés exacto, aproximá.',
      contenido: f.nodos,
      primario: { onClick: () => {
        if (!ui.fields.validateAll(f.campos)) return;
        const v = f.leer();
        guardar(env, 2, (d) => L.guardarPlataDeHoy(d, v));
        conRecompensa(env, 2);
      } },
      secundario: { label: 'No lo sé todavía', onClick: () => conRecompensa(env, 2) },
    });
    return;
  }
  const f = FM.camposSueldo(ctx, { state: s, labels: false, autofocus: !env.editor });
  pantalla(env, 2, {
    pregunta: '¿Cuánto cobrás de sueldo por mes?',
    ayuda: 'Lo uso para calcular cuánto te sobra cada mes.',
    contenido: f.nodos,
    primario: { onClick: () => {
      if (!ui.fields.validateAll(f.campos)) return;
      const v = f.leer();
      guardar(env, 2, (d) => L.guardarSueldo(d, { id: v.id, amount: v.amount, aguinaldo: v.aguinaldo }));
      if (env.editor) { siguiente(env, 2); return; }
      ctx.nav(hashPaso(2, 2));
    } },
    secundario: { label: 'No lo sé todavía', onClick: () => (env.editor ? siguiente(env, 2) : ctx.nav(hashPaso(2, 2))) },
  });
}

// ----------------------------------------------------------------------------------------------- paso 3: movilidad
function paso3(env) {
  const { ctx } = env;
  const f = FM.camposMovilidad(ctx, { state: ctx.state, labels: false, preguntarSiCobra: true });
  pantalla(env, 3, {
    pregunta: '¿Cobrás movilidad o algo por día trabajado?',
    ayuda: 'Si te pagan según los días que trabajás, calculo cuánto entra cada mes, con los feriados.',
    contenido: f.nodos,
    primario: { onClick: () => {
      if (!f.validar()) return;
      const v = f.leer();
      guardar(env, 3, (d) => L.guardarMovilidad(d, v));
      conRecompensa(env, 3);
    } },
  });
}

// ----------------------------------------------------------------------------------------------- paso 4: gastos de la casa y gustos
function paso4(env) {
  const { ctx } = env;
  const { ui } = ctx;
  const s = ctx.state;
  if (env.p === 2) {
    const f = FM.campoGastoInicial(ctx, { state: s, labels: false });
    pantalla(env, 4, {
      pregunta: 'Este mes, ¿cuánto gastaste ya en gustos?',
      ayuda: 'Así la referencia por día arranca bien. Si todavía no gastaste nada, seguí.',
      contenido: f.nodos,
      primario: { onClick: () => {
        if (!ui.fields.validateAll(f.campos)) return;
        guardar(env, 4, (d) => L.guardarGastoInicial(d, f.leer().monto, env.hoy));
        conRecompensa(env, 4);
      } },
      secundario: { label: 'Todavía no gasté nada', onClick: () => { guardar(env, 4, (d) => L.guardarGastoInicial(d, 0, env.hoy)); conRecompensa(env, 4); } },
    });
    return;
  }
  const f = FM.camposGastos(ctx, { state: s, labels: false, casaRequerida: true });
  pantalla(env, 4, {
    pregunta: '¿Cuánto gastás por mes en la casa y en el día a día?',
    ayuda: 'Lo uso para saber cuánto te queda después de pagar todo.',
    contenido: f.nodos,
    primario: { onClick: () => {
      if (!ui.fields.validateAll(f.campos)) return;
      const v = f.leer();
      guardar(env, 4, (d) => L.guardarGastosBase(d, v));
      if (env.editor) { siguiente(env, 4); return; }
      ctx.nav(hashPaso(4, 2));
    } },
    secundario: { label: 'No lo sé todavía', onClick: () => (env.editor ? siguiente(env, 4) : ctx.nav(hashPaso(4, 2))) },
  });
}

// ----------------------------------------------------------------------------------------------- paso 5: lo que te descuentan por planilla
function paso5(env) {
  const { ctx } = env;
  const { ui } = ctx;
  const { fields: F } = ui;
  const s = ctx.state;
  const F2 = ctx.format;
  const hoy = env.hoy;
  const items = L.descuentosDelRecibo(s);
  const afipPendiente = (s.pending || []).some((p) => p.target === 'afip');
  const hayDescuentos = items.length > 0 || afipPendiente;
  const sueldo = s.incomes.find((x) => x.kind === 'sueldo');
  const respondio = s.settings.pasos?.planilla === true;
  const neto = F.choice({
    label: sueldo && !ctx.isPrivate() ? `¿Ese sueldo de ${F2.money(sueldo.amount)} ya tiene restados estos descuentos?` : '¿Ese sueldo ya tiene restados estos descuentos?',
    name: 'neto', variant: 'options', help: 'neto', helpLabel: 'Qué es el neto',
    value: respondio && s.settings.salaryNetOfPayroll === true ? true : respondio && s.settings.salaryNetOfPayroll === false ? false : respondio ? 'nose' : undefined,
    hint: 'Mirá tu recibo: si el total que te cae en la cuenta ya viene después de los descuentos, elegí “Sí”. Si los descuentos se restan aparte, elegí “No”.',
    required: true, requiredMsg: 'Elegí una opción. Si no sabés, elegí “No sé”.',
    options: [{ value: true, label: 'Sí, ya están restados' }, { value: false, label: 'No, hay que restarlos' }, { value: 'nose', label: 'No sé' }],
  });
  const bloqueNeto = h('div', { class: 'stack-3' }, neto.el);
  bloqueNeto.hidden = !hayDescuentos;

  const filaCuota = (it) => {
    const e = L.estadoCuota(it, hoy);
    return ui.row({
      icon: 'banco', tone: 'brand', title: it.name || 'Préstamo', sub: `${F2.money(it.amount)} por mes · ${L.cuotasQueFaltanTexto(it.remaining)}`,
      onClick: () => ctx.editors.open('installment', it.id, {}), ariaLabel: `${it.name || 'Préstamo'}. Tocá para editarlo.`,
    });
  };
  const hayAfip = items.some((x) => /afip/i.test(x.name || ''));
  const filasLista = [
    ...items.map(filaCuota),
    afipPendiente ? ui.row({ icon: 'documento', tone: 'info', title: 'Plan de pagos de AFIP', sub: 'Falta cargar el monto y las cuotas.', chip: { label: 'Completar', tone: 'info' }, pending: true, onClick: () => ctx.editors.open('installment', null, { afip: true }) }) : null,
  ].filter(Boolean);

  const contenido = [
    filasLista.length ? filas(filasLista) : null,
    ui.btn({ label: items.length ? 'Agregar otro préstamo' : 'Agregar un préstamo', variant: 'secondary', icon: 'mas', onClick: () => ctx.editors.open('installment', null, { payroll: true }) }),
    !hayAfip && !afipPendiente ? ui.btn({ label: 'Tengo un plan de pagos de AFIP', variant: 'secondary', icon: 'documento', onClick: () => ctx.editors.open('installment', null, { afip: true }) }) : null,
    bloqueNeto,
  ].filter(Boolean);

  const seguir = () => {
    if (hayDescuentos && !F.validateAll([neto])) return;
    const v = neto.get();
    guardar(env, 5, (d) => { if (hayDescuentos) L.guardarNeto(d, v === 'nose' ? null : v); else L.sinDescuentos(d); });
    conRecompensa(env, 5);
  };
  pantalla(env, 5, {
    pregunta: '¿Te descuentan algo del recibo de sueldo?',
    ayuda: 'Préstamos o el plan de pagos de AFIP. Está en tu recibo: buscá las líneas de descuentos y la línea AFIP.',
    contenido,
    primario: { onClick: seguir },
    secundario: hayDescuentos ? null : { label: 'No me descuentan nada', onClick: () => { guardar(env, 5, (d) => L.sinDescuentos(d)); conRecompensa(env, 5); } },
  });
}

// ----------------------------------------------------------------------------------------------- paso 6: tu tarjeta
function paso6(env) {
  const { ctx } = env;
  const { ui } = ctx;
  const s = ctx.state;
  const debt = s.debts.find((d) => d.kind === 'card') || null;
  const f = FM.camposResumen(ctx, { debt, labels: false, conNombre: !debt, autofocus: !env.editor });
  const cerro = debt?.statement?.closedOn ? ctx.format.longDate(debt.statement.closedOn) : null;

  const revisar = () => {
    if (!ui.fields.validateAll(f.campos)) return;
    const res = f.revisar();
    if (!res.ok) return;
    const v = f.leer();
    const r = FM.pantallaRevisa(ctx, {
      res,
      onVolver: () => pantallaForm(),
      onConfirmar: (valores) => {
        guardar(env, 6, (d) => { L.guardarResumen(d, debt?.id || null, valores, { name: v.name || 'Tarjeta' }, env.hoy); });
        conRecompensa(env, 6, {
          primario: { label: 'Seguir', onClick: () => siguiente(env, 6) },
          secundario: { label: 'Ver mi panorama', onClick: () => hojaPanorama(ctx) },
        });
      },
    });
    env.root.replaceChildren(ui.stepShell({
      step: 6, stepLabel: ETIQUETAS[6], question: 'Revisá que esté bien', content: r.nodos, onBack: () => pantallaForm(),
      onSkip: env.editor ? null : () => seguirDespues(env, 6),
      primary: { label: r.labelConfirmar, onClick: r.confirmar },
      secondary: { label: 'Volver y corregir', onClick: () => pantallaForm() },
    }));
    window.scrollTo?.({ top: 0 });
  };
  const pantallaForm = () => pantalla(env, 6, {
    pregunta: 'Contanos de tu tarjeta',
    ayuda: cerro ? `Cargá el último resumen que te llegó. El que tenías cargado cerró el ${cerro}.` : 'Cargá el último resumen que te llegó (el que cerró hace poco). Lo uso para decirte cuándo terminás de pagarla.',
    contenido: [ui.disclosure({ summary: '¿Dónde lo encuentro?', content: FM.ilustracionResumen(ctx) }), ...f.nodos],
    primario: { label: 'Revisar', onClick: revisar },
    secundario: { label: debt ? 'No lo sé todavía' : 'No tengo tarjeta con deuda', onClick: () => { if (!debt) guardar(env, 6, (d) => { d.settings.pasos = { ...(d.settings.pasos || {}), tarjeta: true }; }); siguiente(env, 6); } },
  });
  pantallaForm();
}

// ----------------------------------------------------------------------------------------------- paso 7: lo que te deben
function paso7(env) {
  const { ctx } = env;
  const { ui } = ctx;
  const s = ctx.state;
  const F2 = ctx.format;
  const otros = s.people.filter((p) => p.role !== 'yo');
  const debenDe = (p) => s.receivables.filter((r) => r.personId === p.id || (!r.personId && r.person === p.name));
  const rows = otros.map((p, i) => {
    const rs = debenDe(p);
    const total = rs.reduce((a, r) => a + L.nn(r.balance), 0);
    return ui.row({
      icon: 'usuarios', tone: total > 0 ? 'info' : 'brand', title: ui.personName(p.name, i + 1),
      sub: total > 0 ? h('span', null, 'Te debe ', ui.amt(total)) : 'Tocá si te debe algo',
      chip: total > 0 ? { label: 'Cargado', tone: 'info', icon: 'tilde' } : undefined,
      onClick: () => ctx.editors.open('receivable', rs[0]?.id || null, { personId: p.id }),
    });
  });
  const otrosSinPersona = s.receivables.filter((r) => !otros.some((p) => p.id === r.personId || p.name === r.person));
  for (const r of otrosSinPersona) {
    rows.push(ui.row({ icon: 'usuarios', tone: 'info', title: ui.personName(r.person || 'Alguien', rows.length + 1), sub: h('span', null, 'Te debe ', ui.amt(r.balance)), chip: { label: 'Cargado', tone: 'info', icon: 'tilde' }, onClick: () => ctx.editors.open('receivable', r.id, {}) }));
  }
  pantalla(env, 7, {
    pregunta: '¿Alguien te debe plata?',
    ayuda: 'Por ejemplo, lo que usó de tu tarjeta. Lo anoto para que no se pierda y te muestro cuándo te lo puede devolver.',
    contenido: [
      rows.length ? filas(rows) : null,
      ui.btn({ label: rows.length ? 'Sumar a otra persona' : 'Anotar a alguien que me debe', variant: 'secondary', icon: 'mas', onClick: () => ctx.editors.open('receivable', null, {}) }),
    ].filter(Boolean),
    primario: { onClick: () => { guardar(env, 7, (d) => L.sinDeudores(d)); conRecompensa(env, 7); } },
    secundario: { label: 'No me deben nada', onClick: () => { guardar(env, 7, (d) => L.sinDeudores(d)); conRecompensa(env, 7); } },
  });
  void F2;
}

const PASOS = { 1: paso1, 2: paso2, 3: paso3, 4: paso4, 5: paso5, 6: paso6, 7: paso7 };

// ----------------------------------------------------------------------------------------------- revelación
function revelacion(env) {
  const { ctx } = env;
  const { ui, charts } = ctx;
  ctx.screenMode('revelacion');
  const hero = ctx.derive.hero(ctx.state, env.hoy);
  const rev = ctx.derive.revelacion(ctx.state, env.hoy);

  const terminar = async () => {
    ctx.update((d) => { d.settings.onboarded = true; d.settings.onboardingStep = 7; }, { rerender: false });
    try { navigator.storage?.persist?.(); } catch { /* nada */ }
    await ctx.nav('#/hoy');
    if (!(ctx.state.seen?.tips || []).includes('instalar')) {
      ctx.update((d) => { marcarVisto(d, 'tips', 'instalar'); }, { rerender: false });
      setTimeout(() => hojaInstalar(ctx, { alCopia: () => mandarCopia(ctx) }), 500);
    }
  };

  if (hero.estado !== 'ok') {
    const sig = ctx.derive.completitud(ctx.state, env.hoy).siguiente;
    env.root.append(ui.welcome({
      title: ['Ya casi.'],
      lead: 'Todavía falta algún dato para armar tu panorama. Podés completarlo ahora o dejarlo para después.',
      actions: [
        sig ? ui.btn({ label: `Completar: ${sig.titulo}`, variant: 'onhero', onClick: () => ctx.nav(`#/armar/${sig.n}`) }) : null,
        ui.btn({ label: 'Ir a mi tablero', variant: sig ? 'onhero-ghost' : 'onhero', onClick: terminar }),
      ].filter(Boolean),
    }));
    return undefined;
  }

  const num = h('p', { class: 'reveal-num num', 'aria-live': 'polite' });
  if (ctx.isPrivate()) num.append(ui.amt(hero.numero));
  else countUp(num, hero.numero, { format: (n) => ctx.format.money(n), key: 'revelacion', once: false });
  const bloque = h('div', { class: 'reveal-block' },
    h('p', { class: 'reveal-label' }, hero.rotulo),
    num,
    h('div', { class: 'cluster' }, ui.status(hero.chip.tone, { label: hero.chip.texto, onHero: true })),
    charts.monthStrip(hero.tira, { onHero: true, showValues: true, ariaLabel: 'Los próximos cuatro meses' }));
  const frases = h('div', { class: 'reveal-phrases' }, ...rev.frases.map((f, i) => h('p', { class: 'reveal-phrase', style: { '--i': i } }, ui.txt(f.texto))));
  const supuesto = rev.supuesto ? h('div', { class: 'stack-1' },
    h('p', { class: 'reveal-label' }, `${rev.supuesto}.`),
    h('button', { type: 'button', class: 'link', style: { color: 'var(--hero-ink)' }, onclick: () => { const sal = ctx.derive.salidaTarjeta(ctx.state, env.hoy); ctx.sheet.info({ title: 'Qué supone esta fecha', content: h('ul', { class: 'help-list' }, ...sal.queSupone.map((t) => h('li', null, ui.icon('tilde', { size: 'sm' }), h('span', null, ui.txt(t))))) }); } }, 'Qué supone esta fecha')) : null;

  env.root.append(ui.welcome({
    mark: false,
    title: ['Tu panorama'],
    children: [bloque, frases, supuesto, hero.provisorio ? h('p', { class: 'reveal-label' }, 'Es provisorio: falta algún dato que puede cambiar el resultado.') : null].filter(Boolean),
    actions: [ui.btn({ label: 'Ir a mi tablero', variant: 'onhero', onClick: terminar })],
  }));
  return undefined;
}
