// Motor de proyección. Funciones puras, sin DOM: todo el cálculo vive acá.

import { workdays } from './calendar.js';

export const MAX_MONTHS = 120;

export function addMonths(key, n) {
  const [y, m] = key.split('-').map(Number);
  const d = y * 12 + (m - 1) + n;
  return `${Math.floor(d / 12)}-${String((d % 12) + 1).padStart(2, '0')}`;
}

export function monthDiff(a, b) {
  const [ya, ma] = a.split('-').map(Number);
  const [yb, mb] = b.split('-').map(Number);
  return (yb - ya) * 12 + (mb - ma);
}

const monthNum = (key) => Number(key.split('-')[1]);

// Un ítem recurrente está activo en un mes si cae en [from, to] y en los meses elegidos
// (months vacío/ausente = todos los meses; ej. aguinaldo = [6, 12]).
export function isActive(item, key) {
  if (item.from && key < item.from) return false;
  if (item.to && key > item.to) return false;
  if (item.months && item.months.length && !item.months.includes(monthNum(key))) return false;
  return true;
}

// Monto de un ítem en un mes: permite montos distintos mes a mes (movilidad con feriados, vacaciones, enero sin movilidad).
// Si tiene valor por día (perDay), el monto es perDay x días trabajados del mes (item.days[mes] lo corrige).
export const daysFor = (item, key) => item.days?.[key] ?? workdays(key);
export const amountFor = (item, key) => {
  const o = item.overrides?.[key];
  if (o !== undefined && o !== null) return Number(o) || 0;
  if (Number(item.perDay) > 0) return Number(item.perDay) * daysFor(item, key);
  return Number(item.amount) || 0;
};

export const installmentEnd = (i) => addMonths(i.first, i.remaining - 1);
export const installmentActive = (i, key) => key >= i.first && key <= installmentEnd(i);

const EPS = 0.005;

// Pago ELEGIDO para una deuda en un mes (debt.planned['YYYY-MM']). null = no hay pago elegido: rige mínimo + barrido.
const plannedFor = (d, key) => {
  const v = d.planned?.[key];
  return v === undefined || v === null || v === '' ? null : Math.max(0, Number(v) || 0);
};

/**
 * Simula mes a mes.
 * state: { settings, incomes, expenses, installments, debts }
 * extra: gastos hipotéticos (misma forma que expenses) para el simulador "¿me lo puedo permitir?"
 * debts[].planned: { 'YYYY-MM': monto } pago ELEGIDO ese mes. Reemplaza el mínimo y el barrido para esa deuda
 *   ese mes; lo que no se paga queda en caja. Cada mes devuelve además `payments: { [debtId]: monto pagado }`.
 */
export function simulate(state, { extraExpenses = [], strategy } = {}) {
  const s = state.settings;
  const strat = strategy ?? s.strategy;
  const buffer = Number(s.buffer) || 0;
  let cash = Number(s.cash) || 0;

  const recv = (state.receivables || []).map((r) => ({ ...r, bal: Number(r.balance) || 0, paidOn: null }));
  const debts = state.debts.map((d) => ({ ...d, bal: Number(d.balance) || 0, paidOn: null }));
  // Si el hogar gasta más de lo que entra, el faltante se financia (tarjeta u otra deuda).
  const deficitRate = Number(s.deficitRate) || 0;
  let deficitDebt = null;

  const months = [];
  let totalInterest = 0;
  let key = s.start;

  for (let i = 0; i < MAX_MONTHS; i++, key = addMonths(key, 1)) {
    let interest = 0;
    for (const d of allDebts()) {
      if (d.bal > EPS) {
        const it = (d.bal * (Number(d.rate) || 0)) / 100;
        d.bal += it;
        interest += it;
      }
    }
    totalInterest += interest;

    // Lo que le deben a la familia: acumula interés (si lo hay) y se cobra la cuota pactada.
    let collections = 0;
    for (const r of recv) {
      if (r.bal > EPS) {
        r.bal += (r.bal * (Number(r.rate) || 0)) / 100;
        const c = Math.min(Number(r.monthlyPayment) || 0, r.bal);
        r.bal -= c;
        collections += c;
        if (r.bal <= EPS) {
          r.bal = 0;
          r.paidOn = key;
        }
      }
    }

    const income = sum(state.incomes.filter((x) => isActive(x, key)), key);
    const allExp = [...state.expenses, ...extraExpenses].filter((x) => isActive(x, key));
    const expenses = sum(allExp, key);
    const insts = state.installments.filter((x) => installmentActive(x, key));
    const installments = insts.reduce((a, x) => a + Number(x.amount), 0);
    const freedInst = state.installments.filter((x) => installmentEnd(x) === addMonths(key, -1));

    let minPaid = 0;
    const paid = {}; // pagado por deuda este mes (mínimo o elegido + barrido)
    for (const d of allDebts()) {
      if (d.bal > EPS) {
        const chosen = plannedFor(d, key);
        const p = Math.min(chosen !== null ? chosen : Number(d.minPayment) || 0, d.bal);
        d.bal -= p;
        minPaid += p;
        paid[d.id] = (paid[d.id] || 0) + p;
      }
    }

    let free = income + collections - expenses - installments - minPaid;
    let extraPaid = 0;
    let shortfall = 0;

    if (free < 0) {
      shortfall = -free;
      const fromCash = Math.min(Math.max(cash, 0), shortfall);
      cash -= fromCash;
      const financed = shortfall - fromCash;
      if (financed > EPS) {
        const target = financingTarget();
        target.bal += financed;
      }
    } else {
      const reserve = Math.min(free, buffer);
      let avail = free - reserve;
      cash += reserve;
      if (strat !== 'none') {
        for (const d of order(allDebts())) {
          if (avail <= EPS) break;
          if (plannedFor(d, key) !== null) continue; // esa deuda ya tiene el pago elegido este mes
          if (d.bal > EPS) {
            const p = Math.min(avail, d.bal);
            d.bal -= p;
            avail -= p;
            extraPaid += p;
            paid[d.id] = (paid[d.id] || 0) + p;
          }
        }
      }
      cash += avail; // lo que sobra sin deudas que pagar o sin estrategia
    }

    for (const d of allDebts()) {
      if (d.bal <= EPS && d.paidOn === null && (Number(d.balance) > 0 || d === deficitDebt)) {
        d.bal = 0;
        d.paidOn = key;
      }
    }

    const debtTotal = allDebts().reduce((a, d) => a + d.bal, 0);
    months.push({
      key,
      income,
      collections,
      owed: recv.reduce((a, r) => a + r.bal, 0),
      expenses,
      installments,
      installmentCount: insts.length,
      freedInstallments: freedInst,
      debtPayments: minPaid + extraPaid,
      payments: Object.fromEntries(allDebts().map((d) => [d.id, paid[d.id] || 0])),
      interest,
      free,
      shortfall,
      cash,
      debtTotal,
      debts: Object.fromEntries(allDebts().map((d) => [d.id, d.bal])),
      status: free < 0 ? 'bad' : free < buffer ? 'tight' : 'ok',
    });

  }

  const final = allDebts();

  return {
    months,
    receivables: recv.map((r) => ({ id: r.id, person: r.person, name: r.name, bal: r.bal, paidOn: r.paidOn })),
    debts: final.map((d) => ({ id: d.id, name: d.name, paidOn: d.paidOn })),
    debtFreeMonth: firstClearMonth(months),
    totalInterest,
  };

  // --- helpers (cierran sobre el estado de la simulación) ---
  function allDebts() {
    return deficitDebt ? [...debts, deficitDebt] : debts;
  }
  function financingTarget() {
    const card = debts.find((d) => d.kind === 'card' && d.bal > EPS) || debts.find((d) => d.kind === 'card');
    if (card) {
      card.paidOn = null;
      return card;
    }
    if (!deficitDebt) {
      deficitDebt = { id: '_deficit', name: 'Faltante financiado', kind: 'other', rate: deficitRate, minPayment: 0, bal: 0, paidOn: null, balance: 0 };
    }
    deficitDebt.paidOn = null;
    return deficitDebt;
  }
  function order(list) {
    const l = list.filter((d) => d.bal > EPS);
    if (strat === 'snowball') return l.sort((a, b) => a.bal - b.bal);
    return l.sort((a, b) => (Number(b.rate) || 0) - (Number(a.rate) || 0)); // avalancha: mayor interés primero
  }
}

function sum(items, key) {
  return items.reduce((a, x) => a + amountFor(x, key), 0);
}

// Primer mes a partir del cual ya no hay deuda (y no vuelve a aparecer).
function firstClearMonth(months) {
  for (let i = 0; i < months.length; i++) {
    if (months.slice(i).every((m) => m.debtTotal <= EPS)) return months[i].key;
  }
  return null;
}

/** Compara el plan actual contra "no hacer nada extra" y contra un gasto hipotético. */
export function compare(state, extraExpenses) {
  const base = simulate(state);
  const withExtra = simulate(state, { extraExpenses });
  const negBase = base.months.filter((m) => m.free < 0).map((m) => m.key);
  const negExtra = withExtra.months.filter((m) => m.free < 0).map((m) => m.key);
  return {
    base,
    withExtra,
    delayMonths:
      base.debtFreeMonth && withExtra.debtFreeMonth
        ? monthDiff(base.debtFreeMonth, withExtra.debtFreeMonth)
        : withExtra.debtFreeMonth === base.debtFreeMonth
        ? 0
        : null,
    extraInterest: withExtra.totalInterest - base.totalInterest,
    newNegativeMonths: negExtra.filter((k) => !negBase.includes(k)),
  };
}

export function totals(state) {
  return {
    owed: (state.receivables || []).reduce((a, r) => a + (Number(r.balance) || 0), 0),
    debt: state.debts.reduce((a, d) => a + (Number(d.balance) || 0), 0),
    monthlyInterest: state.debts.reduce((a, d) => a + ((Number(d.balance) || 0) * (Number(d.rate) || 0)) / 100, 0),
  };
}
