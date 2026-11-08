// Exposición honesta de fundamentales (2026-11-08, diagnóstico en
// research/datos-fundamentales-2026-11/).
//
// Reglas, todas con ejemplo real medido en la base del Mini:
//  - `null` del proveedor ≠ `0`. Dividendo 0 = «No paga»; vacío = «Sin dato de Yahoo».
//  - Un margen 0 sin ingresos no es 0 %: es ausencia (RCE.AX grossMargin:0).
//  - ROE y deuda/patrimonio no significan nada con patrimonio ≤ 0
//    (SBUX ROE −31 % con D/E −329).
//  - Un crecimiento sobre base ínfima no es un número que leer
//    (ABT.MI −1.424 %, GERHSP.CO +810 %).
//
// Módulo puro: sin red ni React. Cada función devuelve
// { text, state: "value" | "ghost" | "note", reason }.
import { pctShare } from "./formatters.js";

export const PROVIDER_LABEL = "Yahoo";
export const GROWTH_CAP_PCT = 500;

const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);

export const ABSENT_REASONS = {
  provider: `Sin dato de ${PROVIDER_LABEL}`,
  losses: "No aplica: pérdidas",
  noRevenue: "Sin ingresos informados",
  negativeEquity: "Patrimonio negativo",
  notMeaningful: "No significativo",
  noDividend: "No paga dividendo",
  semiannual: "Informa semestralmente: sin trimestres",
};

function ghost(reason) {
  return { text: reason, state: "ghost", reason };
}

export function percentDisplay(value, { digits = 1, reason = ABSENT_REASONS.provider } = {}) {
  const n = finite(value);
  return n === null ? ghost(reason) : { text: pctShare(n, digits), state: "value", reason: "" };
}

export function dividendYieldDisplay(value) {
  const n = finite(value);
  if (n === null) return ghost(ABSENT_REASONS.provider);
  if (n === 0) return { text: ABSENT_REASONS.noDividend, state: "note", reason: ABSENT_REASONS.noDividend };
  return { text: pctShare(n, 2), state: "value", reason: "" };
}

// Crecimiento YoY en %. Más allá de ±500 % no se muestra la cifra.
export function growthDisplay(value, { cap = GROWTH_CAP_PCT } = {}) {
  const n = finite(value);
  if (n === null) return ghost(ABSENT_REASONS.provider);
  if (Math.abs(n) > cap) return { text: `>${n > 0 ? "+" : "−"}${cap} %`, state: "note", reason: ABSENT_REASONS.notMeaningful };
  return { text: pctShare(n, 1), state: "value", reason: "" };
}

// Margen en %. `revenue` (opcional) permite distinguir 0 % real de 0 por falta de ingresos.
export function marginDisplay(value, { revenue } = {}) {
  const n = finite(value);
  if (n === null) return ghost(ABSENT_REASONS.provider);
  const rev = finite(revenue);
  if (n === 0 && (rev === null || rev <= 0)) return ghost(ABSENT_REASONS.noRevenue);
  return { text: pctShare(n, 1), state: "value", reason: "" };
}

export function roeDisplay(roe, { equity, profitMargin } = {}) {
  const n = finite(roe);
  const eq = finite(equity);
  const margin = finite(profitMargin);
  // Sin patrimonio en el balance: ROE negativo con margen neto positivo solo
  // sale con patrimonio negativo (SBUX: ROE −31 % y margen +6,7 %).
  const impliedNegativeEquity = eq === null && n !== null && n < 0 && margin !== null && margin > 0;
  if ((eq !== null && eq <= 0) || impliedNegativeEquity) return { text: ABSENT_REASONS.negativeEquity, state: "note", reason: ABSENT_REASONS.negativeEquity };
  if (n === null) return ghost(ABSENT_REASONS.provider);
  return { text: pctShare(n, 1), state: "value", reason: "" };
}

// Deuda/patrimonio (ratio ×1, no %). Con patrimonio ≤ 0 o razón negativa no hay ratio.
export function debtToEquityDisplay(value, { equity, format } = {}) {
  const n = finite(value);
  const eq = finite(equity);
  if ((eq !== null && eq <= 0) || (n !== null && n < 0)) {
    return { text: ABSENT_REASONS.negativeEquity, state: "note", reason: ABSENT_REASONS.negativeEquity };
  }
  if (n === null) return ghost(ABSENT_REASONS.provider);
  return { text: format ? format(n) : String(Math.round(n * 100) / 100), state: "value", reason: "" };
}

// Múltiplos (PER, P/E fwd…): ausentes por pérdidas se explican, no se dejan en blanco.
export function multipleDisplay(value, { earnings, format } = {}) {
  const n = finite(value);
  if (n === null) {
    const e = finite(earnings);
    return ghost(e !== null && e <= 0 ? ABSENT_REASONS.losses : ABSENT_REASONS.provider);
  }
  if (n <= 0) return ghost(ABSENT_REASONS.losses);
  return { text: format ? format(n) : String(Math.round(n * 100) / 100), state: "value", reason: "" };
}

// Tipo de ausencia de la serie trimestral, para el mensaje de la franja.
export function quarterlyAbsenceReason({ quarterlyRows = 0, annualRows = 0, symbol = "" } = {}) {
  if (quarterlyRows >= 6) return "";
  if (quarterlyRows === 0 && annualRows > 0) {
    return /\.HK$/i.test(String(symbol))
      ? "Informa semestralmente: Yahoo no entrega trimestres. Se muestra el crecimiento anual."
      : "Yahoo no entrega trimestres para este valor. Se muestra el crecimiento anual.";
  }
  if (quarterlyRows > 0) return `Yahoo solo entrega ${quarterlyRows} trimestres; hacen falta 6 para comparar cada uno con el del año anterior.`;
  return ""; // sin nada: la tarjeta usa el texto genérico DESCRIPTIVE_ABSENCE.quarters
}

// Crecimiento anual (alternativa honesta cuando no hay serie trimestral).
export function annualGrowthCells(financialResults = {}, { years = 4 } = {}) {
  const rows = (Array.isArray(financialResults?.incomeAnnual) ? financialResults.incomeAnnual : [])
    .filter((row) => row?.date)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  const growth = (cur, prev) => (finite(cur) !== null && finite(prev) !== null && prev > 0 ? ((cur / prev) - 1) * 100 : null);
  const cells = rows.slice(0, years).map((row, i) => ({
    date: row.date,
    label: String(row.date).slice(0, 4),
    revenueYoY: finite(row.revenueGrowthYoY) ?? growth(row.revenue, rows[i + 1]?.revenue),
    epsYoY: growth(finite(row.eps), finite(rows[i + 1]?.eps)),
  }));
  cells.reverse();
  return { cells, usable: cells.filter((c) => finite(c.revenueYoY) !== null || finite(c.epsYoY) !== null).length >= 2 };
}
