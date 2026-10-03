// Días hábiles por mes, para sueldos que se pagan por día trabajado (ej. movilidad).
// Solo feriados nacionales. Los traslados (Güemes, San Martín, Diversidad Cultural, Soberanía) siguen la
// ley 27.399: martes/miércoles -> lunes anterior, jueves/viernes -> lunes siguiente.
// Los "días no laborables con fines turísticos" NO están: dependen de cada empleador.
// ESTIMADO para 2027 y para el traslado del 20/11/2026: el Gobierno puede cambiarlos. Siempre se puede
// corregir a mano la cantidad de días de un mes.
export const FERIADOS = new Set([
  // 2026
  '2026-01-01', '2026-02-16', '2026-02-17', '2026-03-24', '2026-04-02', '2026-04-03', '2026-05-01',
  '2026-05-25', '2026-06-15', '2026-07-09', '2026-08-17', '2026-10-12', '2026-11-23', '2026-12-08', '2026-12-25',
  // 2027
  '2027-01-01', '2027-02-08', '2027-02-09', '2027-03-24', '2027-03-26', '2027-04-02', '2027-05-25',
  '2027-06-21', '2027-07-09', '2027-08-16', '2027-10-11', '2027-12-08',
]);

/** Cantidad de días de lunes a viernes del mes ('YYYY-MM') que no son feriado. */
export function workdays(key) {
  const [y, m] = key.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  let n = 0;
  for (let d = 1; d <= last; d++) {
    const dow = new Date(y, m - 1, d).getDay();
    if (dow === 0 || dow === 6) continue;
    if (FERIADOS.has(`${key}-${String(d).padStart(2, '0')}`)) continue;
    n++;
  }
  return n;
}
