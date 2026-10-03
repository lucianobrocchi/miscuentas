// Persistencia local (localStorage). Los datos no salen del dispositivo.
const KEY = 'miscuentas.v1';

export const uid = () => Math.random().toString(36).slice(2, 10);

export const currentMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export const emptyState = () => ({
  settings: {
    start: currentMonth(),
    horizon: 12,
    strategy: 'avalanche',
    buffer: 0,
    cash: 0,
    deficitRate: 0,
    people: 'Mamá, Hijo 1, Hijo 2, Pareja',
  },
  incomes: [],
  expenses: [],
  installments: [],
  debts: [],
  receivables: [],
});

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyState();
    const s = JSON.parse(raw);
    const e = emptyState();
    return { ...e, ...s, settings: { ...e.settings, ...s.settings } };
  } catch {
    return emptyState();
  }
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* modo privado o storage lleno: la app sigue andando sin guardar */
  }
}

// Datos de ejemplo SOLO para probar la app. Montos inventados.
export function demo() {
  const s = emptyState();
  const addM = (k, n) => {
    const [y, m] = k.split('-').map(Number);
    const d = y * 12 + (m - 1) + n;
    return `${Math.floor(d / 12)}-${String((d % 12) + 1).padStart(2, '0')}`;
  };
  const st = s.settings.start;
  s.incomes = [
    { id: uid(), name: 'Sueldo', owner: 'Mamá', amount: 1400000 },
    { id: uid(), name: 'Aguinaldo', owner: 'Mamá', amount: 700000, months: [6, 12] },
    { id: uid(), name: 'Devolución del préstamo (hijo)', owner: 'Hijo 1', amount: 50000, to: addM(st, 11) },
  ];
  s.expenses = [
    { id: uid(), name: 'Alquiler y expensas', owner: 'Mamá', amount: 450000 },
    { id: uid(), name: 'Supermercado', owner: 'Mamá', amount: 400000 },
    { id: uid(), name: 'Servicios', owner: 'Mamá', amount: 120000 },
    { id: uid(), name: 'Gastos del hijo 1', owner: 'Hijo 1', amount: 100000 },
    { id: uid(), name: 'Gastos de la pareja', owner: 'Pareja', amount: 150000 },
  ];
  s.installments = [
    { id: uid(), name: 'Heladera', owner: 'Mamá', amount: 45000, remaining: 8, first: st },
    { id: uid(), name: 'Celular', owner: 'Hijo 2', amount: 38000, remaining: 5, first: st },
  ];
  s.debts = [
    { id: uid(), name: 'Tarjeta Visa', kind: 'card', creditor: 'Banco', balance: 1800000, rate: 7, minPayment: 120000 },
  ];
  return s;
}
