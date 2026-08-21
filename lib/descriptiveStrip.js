// lib/descriptiveStrip.js — cálculos de la franja descriptiva de la ficha
// (el cuadro que acompaña al gráfico: identidad, etapa, RS, estructura y
// crecimiento). Solo funciones puras, para poder probarlas sin renderizar.
//
// Los campos que la franja NO puede demostrar hoy no se calculan aquí ni en
// ningún sitio: se muestran ausentes con su motivo (principio 3). Los motivos
// viven en este módulo para que el componente y los tests digan lo mismo.

function finite(value) {
  // Number(null) y Number("") son 0: sin este corte, una ausencia se
  // convertía en un cero con aspecto de dato (principio 3).
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// ── Avance desde el mínimo de 52 semanas ─────────────────────────────────
// Mismo contrato que la métrica del escaneo (lib/objectiveMetricTruth.js):
// (precio / min(low, 252 sesiones) - 1) * 100, con mínimo de 252 barras.
// Con menos histórico el "mínimo de 52 semanas" no existe y el resultado
// sería un avance sobre un mínimo parcial con aspecto de dato completo.
export function lowAdvance52wFromBars(bars = []) {
  const rows = (Array.isArray(bars) ? bars : [])
    .map((bar) => ({
      date: bar?.date || "",
      close: finite(bar?.close),
      low: finite(bar?.low) ?? finite(bar?.close),
    }))
    .filter((bar) => bar.date && Number.isFinite(bar.close) && bar.close > 0)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  if (rows.length < 252) return null;
  const last252 = rows.slice(-252);
  const price = rows.at(-1).close;
  const lows = last252.map((bar) => bar.low).filter((low) => Number.isFinite(low) && low > 0);
  if (lows.length < 252) return null;
  const minLow = Math.min(...lows);
  return minLow > 0 ? ((price / minLow) - 1) * 100 : null;
}

// ── RS semanal: valor de partida ("desde N") ─────────────────────────────
// La serie del ranking semanal (rs_weekly_items) llega ordenada ascendente
// con huecos posibles. El punto de partida se busca por FECHA (weeksBack
// semanas antes del último punto) con tolerancia de ±14 días, no por índice:
// contar posiciones sobre una serie con huecos desplaza la comparación sin
// avisar. Si no hay punto dentro de la tolerancia, no hay "desde".
export function rsWeeklyDelta(series = [], weeksBack = 13) {
  const rows = (Array.isArray(series) ? series : [])
    .map((item) => ({
      date: item?.date || "",
      rsRating: finite(item?.rsRating),
    }))
    .filter((item) => item.date && Number.isFinite(item.rsRating));
  const latest = rows.at(-1);
  if (!latest) return { current: null, from: null, fromDate: "", weeksBack };
  const targetMs = new Date(latest.date).getTime() - weeksBack * 7 * 86400000;
  const toleranceMs = 14 * 86400000;
  let best = null;
  let bestDiff = Infinity;
  for (const row of rows.slice(0, -1)) {
    const diff = Math.abs(new Date(row.date).getTime() - targetMs);
    if (diff < bestDiff) {
      best = row;
      bestDiff = diff;
    }
  }
  if (!best || bestDiff > toleranceMs) {
    return { current: latest.rsRating, from: null, fromDate: "", weeksBack };
  }
  return { current: latest.rsRating, from: best.rsRating, fromDate: best.date, weeksBack };
}

// ── Media de 30 semanas: palabra de pendiente ────────────────────────────
// Misma banda muerta que la clasificación de etapa (lib/weeklyStage.js,
// flatPct = 2 por defecto): usar otro umbral aquí haría que la franja dijera
// "ascendente" mientras la etapa clasifica la media como plana.
export function slopeWord(slopePct, flatPct = 2) {
  const n = finite(slopePct);
  if (n === null) return "";
  if (Math.abs(n) <= flatPct) return "plana";
  return n > 0 ? "ascendente" : "descendente";
}

// ── Volumen reciente (10 sesiones frente a 50) ───────────────────────────
// volumeDryUpRatio = volumen medio 10d / volumen medio 50d
// (lib/setupPatterns.js). NO es "volumen en la base": el detector de bases
// reales no está en producción, así que la franja lo etiqueta por lo que es.
// Umbral de secado 0.85: el mismo que usa la evidencia metodológica
// (lib/methodologyEngine.js) para la etiqueta "Volumen seco".
export const VOLUME_DRYUP_DRIED_MAX = 0.85;

export function volumeDryUpDisplay(ratio) {
  const n = finite(ratio);
  if (n === null || n < 0) return { pct: null, dried: false, word: "" };
  return {
    pct: (n - 1) * 100,
    dried: n <= VOLUME_DRYUP_DRIED_MAX,
    word: n <= VOLUME_DRYUP_DRIED_MAX ? "secado" : "sin secado",
  };
}

// ── Crecimiento trimestral ───────────────────────────────────────────────
// Misma semántica que la tabla de resultados de la ficha: el YoY del
// proveedor manda; si falta, se calcula contra el mismo trimestre del año
// anterior (índice + 4) SOLO con base positiva — un YoY sobre base negativa
// o nula no significa nada y se muestra ausente. El BPA se deriva de
// beneficio neto / acciones cuando el proveedor no lo trae (marcado derived).
function calcGrowth(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null;
  return ((current / previous) - 1) * 100;
}

function epsFor(row, sharesOutstanding) {
  if (Number.isFinite(row?.eps)) return { value: row.eps, derived: false };
  const shares = [row?.weightedAverageShsOutDil, row?.weightedAverageShsOut, row?.sharesOutstanding, sharesOutstanding]
    .map(finite)
    .find((value) => Number.isFinite(value) && value > 0);
  if (Number.isFinite(row?.netIncome) && Number.isFinite(shares)) {
    return { value: row.netIncome / shares, derived: true };
  }
  return { value: null, derived: false };
}

export function quarterLabel(date = "") {
  const value = String(date || "");
  const year = value.slice(2, 4);
  const month = Number(value.slice(5, 7));
  const quarter = Number.isFinite(month) && month > 0 ? Math.ceil(month / 3) : null;
  return quarter && year ? `${quarter}T${year}` : "";
}

export function quarterlyGrowthCells(financialResults = {}, options = {}) {
  const quarters = Number.isFinite(options.quarters) ? options.quarters : 6;
  const sharesOutstanding = finite(options.sharesOutstanding);
  const source = (Array.isArray(financialResults?.incomeQuarterly) ? financialResults.incomeQuarterly : [])
    .filter((row) => row?.date)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  const cells = source.slice(0, quarters).map((row, index) => {
    const providerRevenueYoY = finite(row?.revenueGrowthYoY);
    const revenueYoY = providerRevenueYoY !== null
      ? providerRevenueYoY
      : calcGrowth(finite(row?.revenue), finite(source[index + 4]?.revenue));
    const providerEpsYoY = finite(row?.epsGrowthYoY);
    const eps = epsFor(row, sharesOutstanding);
    const epsPrev = epsFor(source[index + 4], sharesOutstanding);
    const epsYoY = providerEpsYoY !== null ? providerEpsYoY : calcGrowth(eps.value, epsPrev.value);
    return {
      date: row.date,
      label: quarterLabel(row.date),
      revenueYoY,
      epsYoY,
      epsDerived: eps.derived && Number.isFinite(epsYoY),
    };
  });
  // Del más antiguo al más reciente, como en el diseño (la aceleración se
  // lee de izquierda a derecha).
  cells.reverse();
  const withData = cells.filter((cell) => Number.isFinite(cell.revenueYoY) || Number.isFinite(cell.epsYoY));
  return { cells, usable: withData.length >= 2 };
}

// ── Motivos de ausencia (texto único para componente y tests) ────────────
export const DESCRIPTIVE_ABSENCE = {
  base: "Sin medida de base: el campo disponible usa una ventana fija de 65 sesiones (siempre 13 semanas), que no mide la base real del valor. El detector de bases está en calibración y aún no está en producción.",
  rsSector: "Sin RS de sector: el ranking semanal del universo no clasifica por sector todavía. El percentil de sector del escaneo no es comparable entre pantallas y no se muestra como RS.",
  rsCountry: "Sin RS de país: el ranking semanal cubre solo el universo de EE. UU., donde el RS de país coincidiría con el global.",
  sectorRank: "Sin rango dentro del sector: no existe todavía un ranking por sector sobre el universo semanal.",
  quarters: "Sin serie trimestral suficiente: el proveedor actual no entrega historial para comparar cada trimestre con el del año anterior.",
  lowAdvance: "Sin mínimo de 52 semanas: el histórico disponible no llega a 252 sesiones.",
  stage: "Sin etapa: el histórico semanal no alcanza para clasificar con la media de 30 semanas.",
  rs: "Sin RS semanal: este símbolo no entra en el ranking del universo (histórico insuficiente o serie de precios discontinua).",
};
