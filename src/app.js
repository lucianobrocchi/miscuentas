import { simulate, compare, totals, installmentEnd, addMonths, monthDiff } from './engine.js';
import { load, save, uid, demo, emptyState } from './store.js';

let state = load();
let tab = 'resumen';
let simResult = null;

const $ = (s) => document.querySelector(s);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (n) => (n < 0 ? '-' : '') + '$' + Math.abs(Math.round(n)).toLocaleString('es-AR');
const mname = (k) => {
  const [y, m] = k.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }).replace(' de ', ' ');
};
const people = () => state.settings.people.split(',').map((p) => p.trim()).filter(Boolean);
const commit = () => { save(state); render(); };

const TABS = [
  ['resumen', 'Resumen'], ['ingresos', 'Ingresos'], ['gastos', 'Gastos'],
  ['cuotas', 'Cuotas'], ['deudas', 'Deudas'], ['simulador', '¿Me lo puedo permitir?'], ['ajustes', 'Ajustes'],
];

// ---------- esquemas de formularios ----------
const MONTHS_OPT = [['', 'Todos los meses'], ['6,12', 'Solo junio y diciembre (aguinaldo)']];
const ownerField = () => ({ k: 'owner', label: '¿De quién?', type: 'select', options: people().map((p) => [p, p]) });
const SECTIONS = {
  ingresos: {
    list: 'incomes', title: 'Ingresos', add: 'Agregar ingreso',
    fields: () => [
      { k: 'name', label: 'Nombre', type: 'text', req: true },
      ownerField(),
      { k: 'amount', label: 'Monto', type: 'money', req: true },
      { k: 'months', label: '¿Cuándo cobra?', type: 'select', options: MONTHS_OPT },
      { k: 'from', label: 'Desde (opcional)', type: 'month' },
      { k: 'to', label: 'Hasta (opcional)', type: 'month' },
    ],
    line: (x) => [x.name, `${x.owner || ''} · ${x.months?.length ? 'jun y dic' : 'mensual'}${x.to ? ' · hasta ' + mname(x.to) : ''}`, money(x.amount)],
  },
  gastos: {
    list: 'expenses', title: 'Gastos', add: 'Agregar gasto',
    fields: () => [
      { k: 'name', label: 'Nombre', type: 'text', req: true },
      ownerField(),
      { k: 'amount', label: 'Monto', type: 'money', req: true },
      { k: 'from', label: 'Desde (opcional)', type: 'month' },
      { k: 'to', label: 'Hasta (opcional; si es un gasto de una sola vez, poné el mismo mes en ambos)', type: 'month' },
    ],
    line: (x) => [x.name, `${x.owner || ''}${x.from && x.from === x.to ? ' · una vez, ' + mname(x.from) : ' · mensual'}`, money(x.amount)],
  },
  cuotas: {
    list: 'installments', title: 'Compras en cuotas', add: 'Agregar compra en cuotas',
    fields: () => [
      { k: 'name', label: '¿Qué compró?', type: 'text', req: true },
      ownerField(),
      { k: 'amount', label: 'Valor de la cuota', type: 'money', req: true },
      { k: 'remaining', label: 'Cuotas que FALTAN pagar (incluida la de este mes)', type: 'int', req: true },
      { k: 'first', label: 'Mes de la próxima cuota', type: 'month', req: true, def: state.settings.start },
    ],
    line: (x) => [x.name, `${x.owner || ''} · ${x.remaining} cuotas · se libera en ${mname(addMonths(installmentEnd(x), 1))}`, money(x.amount) + '/mes'],
  },
  deudas: {
    list: 'debts', title: 'Deudas', add: 'Agregar deuda',
    fields: () => [
      { k: 'name', label: 'Nombre', type: 'text', req: true },
      { k: 'kind', label: 'Tipo', type: 'select', options: [['card', 'Tarjeta de crédito'], ['loan', 'Préstamo'], ['other', 'Otra']] },
      { k: 'creditor', label: '¿A quién se le debe?', type: 'text' },
      { k: 'balance', label: 'Cuánto se debe hoy', type: 'money', req: true },
      { k: 'rate', label: 'Interés mensual (%)', type: 'rate', hint: 'Está en el resumen de la tarjeta (TEM). Si es TNA, dividí por 12. Si no cobra interés, 0.' },
      { k: 'minPayment', label: 'Pago mínimo mensual', type: 'money', hint: 'Lo mínimo que se paga todos los meses sí o sí. Puede ser 0.' },
    ],
    line: (x) => [x.name, `${x.creditor || ''} · interés ${x.rate || 0}% mensual · mínimo ${money(x.minPayment || 0)}`, money(x.balance)],
  },
};

// ---------- render ----------
function render() {
  const t = totals(state);
  $('#sub').textContent = state.debts.length ? `Deuda hoy: ${money(t.debt)} · Interés que suma por mes: ${money(t.monthlyInterest)}` : 'Cargá tus datos para ver el futuro';
  $('#tabs').innerHTML = TABS.map(([k, l]) => `<button class="${k === tab ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('');
  const v = $('#view');
  if (tab === 'resumen') v.innerHTML = viewResumen();
  else if (tab === 'simulador') v.innerHTML = viewSimulador();
  else if (tab === 'ajustes') v.innerHTML = viewAjustes();
  else v.innerHTML = viewList(tab);
}

function viewList(key) {
  const sec = SECTIONS[key];
  const items = state[sec.list];
  const rows = items.map((x) => {
    const [a, b, c] = sec.line(x);
    return `<div class="row"><div class="l"><b>${esc(a)}</b><span>${esc(b)}</span></div><div class="r"><b>${esc(c)}</b><br>
      <button class="link" data-edit="${key}:${x.id}">Editar</button><button class="link del" data-del="${key}:${x.id}">Borrar</button></div></div>`;
  }).join('');
  let total = '';
  if (key === 'ingresos' || key === 'gastos') {
    const m = simulate(state).months[0];
    total = `<p class="note">Este mes (${esc(mname(m.key))}): ${money(key === 'ingresos' ? m.income : m.expenses)}</p>`;
  }
  return `<h2>${sec.title}</h2>${total}<div class="card">${rows || '<p class="note">Todavía no cargaste nada.</p>'}</div>
    <div class="actions"><button class="p" data-add="${key}">+ ${sec.add}</button></div>`;
}

function viewResumen() {
  if (!state.incomes.length && !state.debts.length) {
    return `<div class="card"><p class="big"><b>Bienvenida 👋</b></p>
      <p>Para ver cómo te va a ir en los próximos meses, cargá: <b>1)</b> tus ingresos, <b>2)</b> tus gastos, <b>3)</b> las compras en cuotas y <b>4)</b> las deudas (tarjeta, préstamos).</p>
      <div class="actions"><button class="p" data-tab="ingresos">Empezar por los ingresos</button><button class="s" data-demo>Ver un ejemplo</button></div></div>`;
  }
  const r = simulate(state);
  const none = simulate(state, { strategy: 'none' });
  const h = Math.min(Number(state.settings.horizon) || 12, r.months.length);
  const ms = r.months.slice(0, h);
  const t = totals(state);
  const bad = ms.filter((m) => m.status === 'bad');
  const free = r.debtFreeMonth;
  const kpis = `<div class="grid">
    <div class="card kpi"><small>Deuda hoy</small><b>${money(t.debt)}</b></div>
    <div class="card kpi ${free ? 'ok' : 'bad'}"><small>Libre de deudas</small><b>${free ? esc(mname(free)) : 'No alcanza'}</b>
      <small>${free ? 'en ' + (monthDiff(state.settings.start, free) + 1) + ' meses' : 'con este ritmo la deuda no termina'}</small></div>
    <div class="card kpi"><small>Interés total que vas a pagar</small><b>${money(r.totalInterest)}</b>
      ${none.months[h - 1].debtTotal > ms[h - 1].debtTotal ? `<small>Sin plan, en ${h} meses la deuda estaría en ${money(none.months[h - 1].debtTotal)} (con plan: ${money(ms[h - 1].debtTotal)})</small>` : ''}</div>
  </div>`;
  const alert = bad.length
    ? `<div class="verdict bad"><b>⚠ ${bad.length === 1 ? 'Hay un mes' : 'Hay ' + bad.length + ' meses'} en rojo:</b> ${bad.map((m) => esc(mname(m.key))).join(', ')}. En esos meses los gastos superan lo que entra: hay que recortar o juntar plata antes.</div>`
    : `<div class="verdict ok">✓ En los próximos ${h} meses los ingresos alcanzan para todos los compromisos.</div>`;
  const cards = ms.map((m) => {
    const ev = [
      ...m.freedInstallments.map((i) => `🎉 Se terminó la cuota de ${esc(i.name)}: liberás ${money(i.amount)}/mes`),
      ...r.debts.filter((d) => d.paidOn === m.key).map((d) => `🎉 Se termina de pagar: ${esc(d.name)}`),
    ];
    return `<div class="m ${m.status}"><span class="name">${esc(mname(m.key))}</span>
      <span class="free">${m.free >= 0 ? 'Sobran ' : 'Faltan '}${money(Math.abs(m.free))}</span>
      <span class="det">Entra ${money(m.income)} · Gastos ${money(m.expenses)} · Cuotas ${money(m.installments)} · A deudas ${money(m.debtPayments)} · Deuda al cierre ${money(m.debtTotal)}</span>
      ${ev.map((e) => `<span class="ev">${e}</span>`).join('')}</div>`;
  }).join('');
  return `${kpis}${alert}<h2>Mes por mes</h2><div class="months">${cards}</div>
    <h2>Cómo baja la deuda</h2><div class="card">${chart(ms)}</div>
    <p class="note">Los "sobra" van primero a pagar deudas (${state.settings.strategy === 'snowball' ? 'la más chica primero' : state.settings.strategy === 'none' ? 'desactivado' : 'la de más interés primero'}), dejando un margen de ${money(state.settings.buffer)} por mes para imprevistos.</p>`;
}

function chart(ms) {
  const W = 600, H = 180, P = 28;
  const max = Math.max(...ms.map((m) => m.debtTotal), 1);
  const x = (i) => P + (i * (W - P - 8)) / Math.max(ms.length - 1, 1);
  const y = (v) => H - P - (v / max) * (H - P - 12);
  const pts = ms.map((m, i) => `${x(i)},${y(m.debtTotal)}`).join(' ');
  const labels = ms.map((m, i) => (i % Math.ceil(ms.length / 6) === 0 ? `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${esc(mname(m.key).slice(0, 3))}</text>` : '')).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Deuda total mes a mes">
    <line x1="${P}" y1="${H - P}" x2="${W - 8}" y2="${H - P}" stroke="currentColor" opacity=".2"/>
    <polyline points="${pts}" fill="none" stroke="var(--brand)" stroke-width="3" stroke-linejoin="round"/>
    <text x="${P}" y="12">${money(max)}</text>${labels}</svg>`;
}

function viewSimulador() {
  const r = simResult;
  let out = '';
  if (r) {
    const { c, desc } = r;
    let cls, msg;
    if (c.newNegativeMonths.length) {
      cls = 'bad';
      msg = `<b>No conviene.</b> Te deja en rojo en: ${c.newNegativeMonths.slice(0, 6).map((k) => esc(mname(k))).join(', ')}${c.newNegativeMonths.length > 6 ? '…' : ''}.`;
    } else if (c.delayMonths === null || (c.delayMonths > 0 && !c.withExtra.debtFreeMonth)) {
      cls = 'bad';
      msg = `<b>No conviene.</b> Con este gasto la deuda deja de terminarse.`;
    } else if (c.delayMonths > 0) {
      cls = 'tight';
      msg = `<b>Se puede, pero tiene costo:</b> atrasa ${c.delayMonths} ${c.delayMonths === 1 ? 'mes' : 'meses'} salir de la deuda (de ${esc(mname(c.base.debtFreeMonth))} a ${esc(mname(c.withExtra.debtFreeMonth))}) y suma ${money(c.extraInterest)} de interés.`;
    } else {
      cls = 'ok';
      msg = `<b>Entra sin problemas.</b> No cambia la fecha en que salís de la deuda${c.extraInterest > 1 ? ` (suma ${money(c.extraInterest)} de interés)` : ''}.`;
    }
    out = `<div class="verdict ${cls}">${esc(desc)}<br>${msg}</div>`;
  }
  return `<h2>¿Me lo puedo permitir?</h2><p class="note">Probá un gasto nuevo antes de hacerlo y mirá cómo cambia el futuro. No se guarda.</p>
    <form class="card" id="simform">
      <label>¿Qué es?</label><input name="name" placeholder="Ej: viaje, televisor, regalo">
      <label>Monto</label><input name="amount" type="number" min="0" step="1000" inputmode="numeric" required>
      <label>¿Cada cuánto?</label><select name="mode"><option value="once">Una sola vez</option><option value="monthly">Todos los meses</option></select>
      <label>Desde qué mes</label><input name="from" type="month" value="${esc(state.settings.start)}" required>
      <label>Hasta qué mes (solo si es mensual; vacío = para siempre)</label><input name="to" type="month">
      <div class="actions"><button class="p" type="submit">Calcular</button></div></form>${out}`;
}

function viewAjustes() {
  const s = state.settings;
  const opt = (v, l) => `<option value="${v}" ${s.strategy === v ? 'selected' : ''}>${l}</option>`;
  return `<h2>Ajustes</h2><form class="card" id="setform">
    <label>Mes en que empieza el cálculo</label><input name="start" type="month" value="${esc(s.start)}" required>
    <label>Cuántos meses mostrar</label><input name="horizon" type="number" min="3" max="60" value="${esc(s.horizon)}">
    <label>Cómo pagar las deudas con lo que sobra</label>
    <select name="strategy">${opt('avalanche', 'Primero la de más interés (ahorra más plata)')}${opt('snowball', 'Primero la más chica (más motivante)')}${opt('none', 'Solo pagar los mínimos')}</select>
    <label>Margen para imprevistos por mes (no se usa para deudas)</label><input name="buffer" type="number" min="0" step="1000" value="${esc(s.buffer)}">
    <label>Plata ahorrada hoy (sirve para cubrir meses en rojo)</label><input name="cash" type="number" min="0" step="1000" value="${esc(s.cash)}">
    <label>Interés mensual (%) del faltante cuando no hay tarjeta cargada</label><input name="deficitRate" type="number" min="0" step="0.1" value="${esc(s.deficitRate)}">
    <label>Personas (separadas por coma)</label><input name="people" value="${esc(s.people)}">
    <div class="actions"><button class="p" type="submit">Guardar</button></div></form>
    <h2>Datos</h2><div class="actions"><button class="s" data-export>Descargar copia</button><button class="s" data-import>Restaurar copia</button>
    <button class="s" data-demo>Cargar ejemplo</button><button class="s" data-reset>Borrar todo</button></div>
    <p class="note">Todo se guarda solo en este dispositivo. Descargá una copia de vez en cuando.</p>`;
}

// ---------- formulario modal ----------
function openForm(title, fields, values, onSave) {
  const f = $('#form');
  const input = (fd) => {
    const v = values[fd.k] ?? fd.def ?? '';
    const common = `name="${fd.k}" ${fd.req ? 'required' : ''}`;
    if (fd.type === 'select') {
      const cur = fd.k === 'months' ? (values.months || []).join(',') : v;
      return `<select ${common}>${fd.options.map(([o, l]) => `<option value="${esc(o)}" ${String(cur) === o ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    }
    if (fd.type === 'month') return `<input type="month" ${common} value="${esc(v)}">`;
    if (fd.type === 'text') return `<input type="text" ${common} value="${esc(v)}">`;
    if (fd.type === 'rate') return `<input type="number" step="0.01" min="0" inputmode="decimal" ${common} value="${esc(v)}">`;
    return `<input type="number" min="${fd.type === 'int' ? 1 : 0}" step="${fd.type === 'int' ? 1 : 1000}" inputmode="numeric" ${common} value="${esc(v)}">`;
  };
  f.innerHTML = `<h3>${esc(title)}</h3>${fields.map((fd) => `<label>${esc(fd.label)}</label>${input(fd)}${fd.hint ? `<div class="hint">${esc(fd.hint)}</div>` : ''}`).join('')}
    <div class="actions"><button class="p" value="ok">Guardar</button><button class="s" value="cancel" formnovalidate>Cancelar</button></div>`;
  f.onsubmit = (e) => {
    if (e.submitter?.value !== 'ok') return;
    const data = Object.fromEntries(new FormData(f));
    const out = {};
    for (const fd of fields) {
      const raw = data[fd.k];
      if (fd.k === 'months') out.months = raw ? raw.split(',').map(Number) : undefined;
      else if (['money', 'int', 'rate'].includes(fd.type)) out[fd.k] = raw === '' || raw == null ? 0 : Number(raw);
      else out[fd.k] = raw === '' ? undefined : raw;
    }
    onSave(out);
  };
  $('#dlg').showModal();
}

// ---------- eventos ----------
document.addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  const d = t.dataset;
  if (d.tab) { tab = d.tab; render(); window.scrollTo(0, 0); }
  else if (d.add) {
    const sec = SECTIONS[d.add];
    openForm(sec.add, sec.fields(), {}, (v) => { state[sec.list].push({ id: uid(), ...v }); commit(); });
  } else if (d.edit) {
    const [k, id] = d.edit.split(':');
    const sec = SECTIONS[k];
    const item = state[sec.list].find((x) => x.id === id);
    openForm('Editar', sec.fields(), item, (v) => { Object.assign(item, v); commit(); });
  } else if (d.del) {
    const [k, id] = d.del.split(':');
    const sec = SECTIONS[k];
    const item = state[sec.list].find((x) => x.id === id);
    if (confirm(`¿Borrar "${item.name}"?`)) { state[sec.list] = state[sec.list].filter((x) => x.id !== id); commit(); }
  } else if ('demo' in d) {
    if (!state.incomes.length || confirm('Esto reemplaza lo que cargaste por datos de ejemplo. ¿Seguir?')) { state = demo(); commit(); }
  } else if ('reset' in d) {
    if (confirm('¿Borrar TODOS los datos? No se puede deshacer.')) { state = emptyState(); commit(); }
  } else if ('export' in d) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }));
    a.download = `miscuentas-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  } else if ('import' in d) {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = 'application/json';
    i.onchange = async () => {
      try {
        const s = JSON.parse(await i.files[0].text());
        if (!Array.isArray(s.incomes) || !s.settings) throw new Error();
        state = { ...emptyState(), ...s }; commit();
      } catch { alert('Ese archivo no es una copia válida.'); }
    };
    i.click();
  }
});

document.addEventListener('submit', (e) => {
  if (e.target.id === 'setform') {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    Object.assign(state.settings, { ...d, horizon: Number(d.horizon) || 12, buffer: Number(d.buffer) || 0, cash: Number(d.cash) || 0, deficitRate: Number(d.deficitRate) || 0 });
    commit();
  } else if (e.target.id === 'simform') {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    const once = d.mode === 'once';
    const extra = [{ id: 'sim', name: d.name || 'Gasto nuevo', amount: Number(d.amount), from: d.from, to: once ? d.from : d.to || undefined }];
    simResult = { c: compare(state, extra), desc: `${d.name || 'Gasto nuevo'}: ${money(Number(d.amount))} ${once ? 'una vez en ' + mname(d.from) : 'por mes desde ' + mname(d.from)}` };
    render();
  }
});

render();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
