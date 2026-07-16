// lib/researchRowContract.js — contrato único de ResearchRow.
//
// Una ResearchRow es la fila que produce lib/researchRow.buildResearchRow y que
// consumen el screener, review, las listas y la persistencia. Este módulo es la
// única fuente de verdad sobre:
//   1. Qué campos componen el núcleo del contrato (validateResearchRow).
//   2. Cómo se proyecta una fila completa a su forma COMPACTA (compactResearchRow):
//      la que viaja en snapshots (/api/scans por defecto) y en sessionStorage.
//
// Fila COMPLETA (full): todo lo que emite buildResearchRow — chartPreview OHLC de
// 96 barras, growthMetrics con anidados del proveedor, narrativa de patrón.
// La sirven /api/scan (polling del scan en vivo) y /api/scans?full=1.
//
// Fila COMPACTA: mismos campos núcleo, chartPreview de 48 puntos ligeros
// (date/close/sma50/sma200/volume, números redondeados) y growthMetrics solo
// con escalares. Es la forma por defecto de /api/scans y de la sesión local.

export const COMPACT_CHART_PREVIEW_POINTS = 48;

// Núcleo del contrato: si falta alguno de estos campos (puede ser null, pero la
// clave debe existir), la fila no es una ResearchRow válida.
export const RESEARCH_ROW_CORE_FIELDS = {
  identity: ["symbol", "companyName", "country", "exchange", "sector", "industry", "currency"],
  price: ["price", "lastDate", "chartBarsCount", "sma50", "sma150", "sma200", "sma200Slope",
    "distance20d", "distance50d", "distance52w", "distanceATH", "highsSpreadPct", "lowAdvance52w",
    "perf3m", "perf6m", "perf12m", "extSma50", "volatility63d", "maxDrawdown63d"],
  volume: ["marketCap", "avgVolume", "latestVolume", "avgTurnover", "latestTurnover",
    "relativeVolume", "volumeSurgePct", "upDownVolRatio", "upVolume"],
  scores: ["weinsteinScore", "minerviniScore", "momentumScore", "riskScore", "riskRewardScore",
    "volumeEffectScore", "volumeScore", "liquidityScore", "weaknessScore", "weaknessLabel"],
  coverage: ["dataCoverageScore", "priceFreshnessOk", "chartPreview", "chartEstimated"],
};

export const RESEARCH_ROW_ALL_CORE_FIELDS = Object.values(RESEARCH_ROW_CORE_FIELDS).flat();

// Valida la forma (claves presentes y tipos básicos cuando hay valor). No exige
// valores finitos: una fila con datos parciales sigue siendo una fila válida.
export function validateResearchRow(row) {
  if (!row || typeof row !== "object") return { ok: false, missing: RESEARCH_ROW_ALL_CORE_FIELDS, issues: ["no es un objeto"] };
  const missing = RESEARCH_ROW_ALL_CORE_FIELDS.filter((field) => !(field in row));
  const issues = [];
  if ("symbol" in row && typeof row.symbol !== "string") issues.push("symbol debe ser string");
  if ("chartPreview" in row && row.chartPreview != null && !Array.isArray(row.chartPreview)) issues.push("chartPreview debe ser array");
  for (const field of ["weinsteinScore", "minerviniScore", "riskScore", "weaknessScore"]) {
    if (field in row && row[field] != null && typeof row[field] !== "number") issues.push(`${field} debe ser numérico`);
  }
  return { ok: missing.length === 0 && issues.length === 0, missing, issues };
}

function roundOrNull(value, decimals = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(decimals)) : null;
}

// Serie ligera de la sparkline/tabla: 48 puntos date/close/sma/volumen con
// números redondeados (un float64 serializado pesa ~18 caracteres).
export function compactChartPreview(chartPreview = []) {
  if (!Array.isArray(chartPreview)) return [];
  return chartPreview.slice(0, COMPACT_CHART_PREVIEW_POINTS).map((bar) => ({
    date: bar.date,
    close: roundOrNull(bar.close),
    sma50: roundOrNull(bar.sma50),
    sma200: roundOrNull(bar.sma200),
    volume: Number.isFinite(bar.volume) ? Math.round(bar.volume) : null,
  })).filter((bar) => bar.date && Number.isFinite(bar.close));
}

// growthMetrics arrastra estructuras anidadas del proveedor (statements, series);
// en compacto se conservan TODOS los escalares (ratios, TTM, fechas) y se omiten
// los objetos/arrays anidados, que solo necesita la ficha (?full=1).
export function compactGrowthMetrics(gm) {
  if (!gm || typeof gm !== "object" || Array.isArray(gm)) return gm;
  const out = {};
  for (const [key, value] of Object.entries(gm)) {
    if (value === null || ["number", "string", "boolean"].includes(typeof value)) out[key] = value;
  }
  return out;
}

// Proyección compacta canónica: la ÚNICA usada por /api/scans (snapshot por
// defecto) y por la persistencia de sesión del cliente. Mantiene intactos todos
// los campos núcleo del contrato.
export function compactResearchRow(row) {
  if (!row || typeof row !== "object") return row;
  const out = { ...row, growthMetrics: compactGrowthMetrics(row.growthMetrics) };
  if (Array.isArray(row.chartPreview)) out.chartPreview = compactChartPreview(row.chartPreview);
  return out;
}

export function compactResearchRows(rows = []) {
  return Array.isArray(rows) ? rows.map(compactResearchRow) : [];
}
