// Formato y lectura de números, fechas y textos en es-AR. Funciones puras, sin DOM.
// No depende de Intl (el resultado no cambia según el navegador o la versión de Node).

export const MINUS = '−'; // signo menos real (no guion)

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MESES_CORTOS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

const agrupar = (digits) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

// ---------- dinero ----------

/** Pesos sin centavos, con puntos de miles y signo menos real. money(-342688) === '−$342.688' */
export function money(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return '$0';
  return (v < 0 ? MINUS : '') + '$' + agrupar(String(Math.abs(v)));
}

/** Solo el número con puntos de miles (sin $): para escribir en un campo. */
export function num(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return '0';
  return (v < 0 ? MINUS : '') + agrupar(String(Math.abs(v)));
}

/** Compacto para chips y barras: "106 mil", "1,3 M", "−343 mil". Sin signo $. */
export function compact(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0';
  const a = Math.abs(v);
  let out;
  if (a >= 999500) {
    const m = Math.round(a / 100000) / 10;
    out = String(m).replace('.', ',') + ' M';
  } else if (a >= 999.5) {
    out = Math.round(a / 1000) + ' mil';
  } else {
    out = String(Math.round(a));
  }
  return (v < 0 && out !== '0' ? MINUS : '') + out;
}

/** Texto para lectores de pantalla: "105948 pesos", "menos 342688 pesos". */
export function ariaMoney(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return '0 pesos';
  const a = Math.abs(v);
  return (v < 0 ? 'menos ' : '') + a + (a === 1 ? ' peso' : ' pesos');
}

/** Porcentaje con coma y sin ceros de más: pct(6.49) = "6,49%", pct(79) = "79%". */
export function pct(n, max = 2) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0%';
  return String(Number(v.toFixed(max))).replace('.', ',') + '%';
}

// ---------- lectura de lo que escribe la persona ----------

/**
 * Lee un monto escrito a mano. Tolera "$ 900.000", "900000", "900.000,50", "1,5", "1500.50", "−5.000".
 * Reglas: con coma y punto, el último es el decimal; un solo tipo repetido es de miles; una coma sola es decimal;
 * un punto solo es de miles si le siguen exactamente 3 dígitos y adelante hay 1 a 3 (1.290 = 1290).
 * Devuelve un número redondeado a pesos, o null si no hay nada legible. { decimales:true } conserva los centavos.
 */
export function parseMoney(input, { decimales = false } = {}) {
  if (typeof input === 'number') return Number.isFinite(input) ? (decimales ? input : Math.round(input)) : null;
  if (input == null) return null;
  let t = String(input).replace(/[\s $]/g, '').replace(/−|–|—/g, '-');
  let neg = false;
  if (/^-/.test(t) || /-$/.test(t)) neg = true;
  t = t.replace(/[^0-9.,]/g, '');
  if (!/\d/.test(t)) return null;
  const lastDot = t.lastIndexOf('.');
  const lastComma = t.lastIndexOf(',');
  let intPart;
  let dec = '';
  if (lastDot >= 0 && lastComma >= 0) {
    const decAt = Math.max(lastDot, lastComma);
    intPart = t.slice(0, decAt).replace(/[.,]/g, '');
    dec = t.slice(decAt + 1).replace(/[.,]/g, '');
  } else if (lastComma >= 0) {
    const n = (t.match(/,/g) || []).length;
    if (n > 1) intPart = t.replace(/,/g, '');
    else {
      intPart = t.slice(0, lastComma);
      dec = t.slice(lastComma + 1);
    }
  } else if (lastDot >= 0) {
    const n = (t.match(/\./g) || []).length;
    const after = t.slice(lastDot + 1);
    const before = t.slice(0, lastDot);
    if (n > 1) intPart = t.replace(/\./g, '');
    else if (after.length === 3 && /^[1-9]\d{0,2}$/.test(before)) intPart = before + after;
    else {
      intPart = before;
      dec = after;
    }
  } else intPart = t;
  if (intPart === '') intPart = '0';
  let v = Number(intPart + (dec ? '.' + dec : ''));
  if (!Number.isFinite(v)) return null;
  if (/\bmil\b/i.test(String(input)) && v < 1000) v *= 1000; // "300 mil"
  const out = neg ? -v : v;
  return decimales ? out : Math.round(out);
}

/**
 * Lee un interés MENSUAL en %. Tolera coma o punto y "%".
 * Si el valor es mayor a 15 parece la tasa anual (TNA): lo convierte a mensual aproximado (x 30/365) y avisa.
 * Devuelve { valor, convertida, original, aviso } o null si no hay nada legible.
 *   parseRate('6,49') -> { valor: 6.49, convertida: false, original: 6.49, aviso: null }
 *   parseRate('79')   -> { valor: 6.49, convertida: true, original: 79, aviso: '79% parece la tasa anual. ¿Usamos 6,49% por mes?' }
 */
export function parseRate(input) {
  if (input == null || input === '') return null;
  let v;
  if (typeof input === 'number') v = input;
  else {
    const t = String(input).replace(/[\s %]/g, '').replace(/[^0-9.,]/g, '');
    if (!/\d/.test(t)) return null;
    const at = Math.max(t.lastIndexOf('.'), t.lastIndexOf(','));
    const limpio = at >= 0 ? t.slice(0, at).replace(/[.,]/g, '') + '.' + t.slice(at + 1).replace(/[.,]/g, '') : t;
    v = Number(limpio === '.' ? NaN : limpio);
  }
  if (!Number.isFinite(v) || v < 0) return null;
  if (v > 15) {
    const mensual = Math.round(((v * 30) / 365) * 100) / 100;
    return { valor: mensual, convertida: true, original: v, aviso: `${pct(v)} parece la tasa anual. ¿Usamos ${pct(mensual)} por mes?` };
  }
  return { valor: v, convertida: false, original: v, aviso: null };
}

/**
 * Revisa un monto escrito para detectar ceros de más. Devuelve { ok, aviso }.
 * tipo 'sueldo': más de 20.000.000 pide revisar. Cualquier tipo: más de 9 dígitos.
 */
export function revisarMonto(n, { tipo = 'general' } = {}) {
  const v = Math.abs(Number(n));
  if (!Number.isFinite(v)) return { ok: false, aviso: 'Poné un número, por favor.' };
  if (String(Math.round(v)).length > 9 || (tipo === 'sueldo' && v > 20000000)) {
    return { ok: false, aviso: 'Mirá bien los ceros, por favor.' };
  }
  return { ok: true, aviso: null };
}

// ---------- fechas ----------

const pad = (n) => String(n).padStart(2, '0');

/** Acepta Date, 'YYYY-MM-DD' o ISO largo y devuelve un Date a medianoche local. null si no es una fecha. */
export function toDate(x) {
  if (x instanceof Date) return Number.isNaN(x.getTime()) ? null : new Date(x.getFullYear(), x.getMonth(), x.getDate());
  if (typeof x === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(x);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  return null;
}
/** Date -> 'YYYY-MM-DD' (hora local). */
export const toISO = (d) => {
  const x = toDate(d);
  return x ? `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}` : null;
};
/** Date o 'YYYY-MM-DD' -> 'YYYY-MM'. */
export const monthKeyOf = (d) => {
  const x = toDate(d) || toDate(`${d}-01`);
  return x ? `${x.getFullYear()}-${pad(x.getMonth() + 1)}` : null;
};
export const addDays = (d, n) => {
  const x = toDate(d);
  return new Date(x.getFullYear(), x.getMonth(), x.getDate() + n);
};
/** Suma meses a una fecha; si el día no existe en el mes destino, usa el último (31 de enero + 1 = 28 de febrero). */
export const addMonthsDate = (d, n) => {
  const x = toDate(d);
  const total = x.getFullYear() * 12 + x.getMonth() + n;
  const y = Math.floor(total / 12);
  const m = total % 12;
  const last = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(x.getDate(), last));
};
/** Días de calendario de a hasta b (b - a). */
export const daysBetween = (a, b) => {
  const x = toDate(a);
  const y = toDate(b);
  return Math.round((Date.UTC(y.getFullYear(), y.getMonth(), y.getDate()) - Date.UTC(x.getFullYear(), x.getMonth(), x.getDate())) / 86400000);
};
export const lastDayOfMonth = (d) => {
  const x = toDate(d);
  return new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate();
};

/**
 * Nombre del mes de 'YYYY-MM' (o Date): "octubre". Opciones: { year: true } -> "octubre 2026",
 * { year: true, de: true } -> "octubre de 2026", { short: true } -> "Oct", { capital: true } -> "Octubre".
 */
export function monthName(key, { year = false, de = false, short = false, capital = false } = {}) {
  const k = monthKeyOf(key);
  if (!k) return '';
  const [y, m] = k.split('-').map(Number);
  let t = short ? MESES_CORTOS[m - 1] : MESES[m - 1];
  if (year) t += (de ? ' de ' : ' ') + y;
  return capital && !short ? cap(t) : t;
}

/**
 * Fecha larga en palabras: "4 de octubre". { weekday: true } -> "domingo 4 de octubre",
 * { year: true } -> "4 de octubre de 2026", { capital: true } -> "Domingo 4 de octubre".
 */
export function longDate(d, { weekday = false, year = false, capital = false } = {}) {
  const x = toDate(d);
  if (!x) return '';
  let t = `${x.getDate()} de ${MESES[x.getMonth()]}`;
  if (year) t += ` de ${x.getFullYear()}`;
  if (weekday) t = `${DIAS[x.getDay()]} ${t}`;
  return capital ? cap(t) : t;
}

/** "hoy", "ayer", "hace 3 días", "hace 2 semanas", "hace 5 meses". null si no hay fecha. */
export function haceTiempo(d, hoy) {
  if (!toDate(d)) return null;
  const n = daysBetween(d, hoy);
  if (n <= 0) return 'hoy';
  if (n === 1) return 'ayer';
  if (n < 14) return `hace ${n} días`;
  if (n < 60) return `hace ${Math.floor(n / 7)} semanas`;
  return `hace ${Math.floor(n / 30)} meses`;
}

/** plural(7, 'mes', 'meses') -> "7 meses"; plural(1, 'mes', 'meses') -> "1 mes"; { sinNumero: true } -> solo la palabra. */
export function plural(n, uno, otros, { sinNumero = false } = {}) {
  const palabra = Math.abs(Number(n)) === 1 ? uno : otros;
  return sinNumero ? palabra : `${n} ${palabra}`;
}

/** Une una lista en palabras: ["AFIP", "aguinaldo", "planilla"] -> "AFIP, aguinaldo y planilla". */
export function lista(items) {
  const l = items.filter(Boolean);
  if (l.length <= 1) return l.join('');
  return `${l.slice(0, -1).join(', ')} y ${l[l.length - 1]}`;
}
