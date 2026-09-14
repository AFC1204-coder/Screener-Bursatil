// lib/scansChartPreviewTransport.js — transporte diferido de chartPreview en GET /api/scans.
//
// chartPreview pesa ~39 % del JSON compacto US (~13,7 MB / 3576 filas) y no
// entra en filtros ni sort. El compacto de mesa lo difiere; la UI lo repone
// por lotes vía /api/scans/chart-preview para símbolos visibles.

/** @returns {"inline"|"deferred"} */
export function scanChartPreviewTransportMode({
  full = false,
  decisionProjection = false,
  chartPreviewParam = null,
} = {}) {
  if (full || decisionProjection) return "inline";
  const param = String(chartPreviewParam ?? "").trim();
  if (param === "1" || param === "inline") return "inline";
  if (param === "0" || param === "deferred") return "deferred";
  return "deferred";
}

export function rowHasChartPreview(row = {}) {
  return Array.isArray(row?.chartPreview)
    && row.chartPreview.filter((bar) => Number.isFinite(bar?.close)).length > 1;
}

export function stripChartPreviewForTransport(row = {}) {
  if (!row || typeof row !== "object" || !("chartPreview" in row)) return row;
  const { chartPreview, ...rest } = row;
  return rest;
}

export function mergeChartPreviewIntoRow(row = {}, chartPreview) {
  if (!row || typeof row !== "object") return row;
  if (rowHasChartPreview(row)) return row;
  if (!Array.isArray(chartPreview) || chartPreview.filter((bar) => Number.isFinite(bar?.close)).length < 2) {
    return row;
  }
  return { ...row, chartPreview };
}

export function mergeChartPreviewsIntoRows(rows = [], previewBySymbol = new Map()) {
  if (!Array.isArray(rows) || !rows.length || !previewBySymbol?.size) return rows;
  let changed = false;
  const merged = rows.map((row) => {
    const symbol = String(row?.symbol || "").trim().toUpperCase();
    if (!symbol || rowHasChartPreview(row)) return row;
    const chartPreview = previewBySymbol.get(symbol);
    if (!chartPreview) return row;
    changed = true;
    return { ...row, chartPreview };
  });
  return changed ? merged : rows;
}

export function symbolsMissingChartPreview(rows = [], extraSymbols = []) {
  const symbols = new Set();
  for (const row of rows) {
    const symbol = String(row?.symbol || "").trim().toUpperCase();
    if (!symbol || rowHasChartPreview(row)) continue;
    symbols.add(symbol);
  }
  for (const raw of extraSymbols) {
    const symbol = String(raw || "").trim().toUpperCase();
    if (symbol) symbols.add(symbol);
  }
  return [...symbols];
}
