// lib/periodReturns.js — rendimientos de horizonte corto para el panel de filtros.
//
// Qué resuelve: las filas solo traían perf3m/perf6m/perf12m. Para filtrar
// correcciones («qué ha caído esta semana») y rebotes («qué sube este mes») hacen
// falta 1 día, 1 semana, 1 mes y el año en curso. Se calculan con las barras
// diarias que ya hay (~400 por símbolo): ningún dato nuevo.
//
// Convención idéntica a perf() de lib/indicators.js: barras ordenadas de la más
// reciente a la más antigua, rendimiento = cierre[0] / cierre[n] − 1 en %, y
// 21 sesiones = 1 mes, 5 = 1 semana (63/126/252 = 3/6/12 meses). Devuelve null
// cuando no hay histórico suficiente; nunca 0 ni un número inventado.
// Se redondea a 2 decimales (suficiente para un filtro): perf3m/6m/12m viajan con
// 15-17 decimales y en /api/scans cada dígito se paga ×3.500 filas.

export const PERIOD_RETURN_SESSIONS = { perf1d: 1, perf1w: 5, perf1m: 21 };
const round2 = (value) => Math.round(value * 100) / 100;

export const PERIOD_RETURN_FIELDS = ["perf1d", "perf1w", "perf1m", "perfYtd"];

function sessionReturn(bars, sessions) {
  if (!Array.isArray(bars) || bars.length <= sessions) return null;
  const latest = Number(bars[0]?.close);
  const base = Number(bars[sessions]?.close);
  if (!(latest > 0) || !(base > 0)) return null;
  return round2(((latest / base) - 1) * 100);
}

function yearOf(bar) {
  const year = Number(String(bar?.date || "").slice(0, 4));
  return Number.isInteger(year) && year > 1900 ? year : null;
}

/**
 * Año en curso: cierre más reciente frente al último cierre del año anterior.
 * Es null si el histórico no llega hasta el año anterior (IPO de este año o
 * serie corta): un «YTD» medido desde mitad de año sería engañoso.
 */
export function yearToDateReturn(bars) {
  if (!Array.isArray(bars) || bars.length < 2) return null;
  const year = yearOf(bars[0]);
  if (year == null) return null;
  const latest = Number(bars[0]?.close);
  if (!(latest > 0)) return null;
  for (let i = 1; i < bars.length; i += 1) {
    const barYear = yearOf(bars[i]);
    if (barYear == null) return null;
    if (barYear < year) {
      const base = Number(bars[i]?.close);
      return base > 0 ? round2(((latest / base) - 1) * 100) : null;
    }
  }
  return null;
}

export function periodReturns(bars) {
  return {
    perf1d: sessionReturn(bars, PERIOD_RETURN_SESSIONS.perf1d),
    perf1w: sessionReturn(bars, PERIOD_RETURN_SESSIONS.perf1w),
    perf1m: sessionReturn(bars, PERIOD_RETURN_SESSIONS.perf1m),
    perfYtd: yearToDateReturn(bars),
  };
}
