// lib/reviewChartPreviewHydrate.js — hidrata chartPreview del foco Review
// (activo + vecinos) vía /api/scans/chart-preview. Sin company-brief.
//
// Tras el transporte diferido de chartPreview (#24/#26), la cola Review suele
// abrir sin miniaturas: merge desde STORAGE_KEYS.scans no encuentra preview
// porque la mesa también lo difiere. Sin preview local el chart queda en
// «Cargando histórico…» hasta que /api/chart (OHLC) resuelva. Este módulo
// repone el preview close-only del foco para pintar línea al instante
// (CHART-QR-1) mientras el OHLC sigue en paralelo.

import { reviewQueueNeighbors } from "@/lib/reviewChartPrefetch";
import {
  buildChartPreviewHydrateSignature,
  fetchChartPreviewsForSymbols,
} from "@/lib/scansChartPreviewHydrate";
import { symbolsMissingChartPreview } from "@/lib/scansChartPreviewTransport";

/** Activo + N+1 + N-1: suficiente para el gesto j/k sin hidratar la cola entera. */
export const REVIEW_CHART_PREVIEW_FOCUS_MAX = 3;

/**
 * Filas del foco Review a hidratar: activo, siguiente y anterior (circular).
 * Deduplica por símbolo; no toca el resto de la cola.
 */
export function reviewRowsForChartPreviewHydrate(visibleRows = [], currentIndex = 0) {
  if (!Array.isArray(visibleRows) || !visibleRows.length) return [];
  const safeIndex = Number.isFinite(currentIndex)
    ? Math.max(0, Math.min(visibleRows.length - 1, Math.floor(currentIndex)))
    : 0;
  const focus = visibleRows[safeIndex] || null;
  const { next, prev } = reviewQueueNeighbors(visibleRows, safeIndex);
  const ordered = [focus, next, prev].filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const row of ordered) {
    const symbol = String(row?.symbol || "").trim().toUpperCase();
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    out.push(row);
    if (out.length >= REVIEW_CHART_PREVIEW_FOCUS_MAX) break;
  }
  return out;
}

export function collectReviewSymbolsForChartPreviewHydrate(
  visibleRows = [],
  currentIndex = 0,
  extraSymbols = [],
) {
  return symbolsMissingChartPreview(
    reviewRowsForChartPreviewHydrate(visibleRows, currentIndex),
    extraSymbols,
  );
}

/** cloudId del último scan en RAM (misma fuente que la mesa). */
export function resolveReviewScanCloudId(scans = []) {
  const scan = Array.isArray(scans) ? scans[0] : null;
  const id = String(scan?.cloudId || scan?.id || "").trim();
  return id || null;
}

/**
 * Plan estable para el effect de hidratación en /review.
 * null si no hay scanId o no faltan previews en el foco.
 */
export function buildReviewChartPreviewHydratePlan({
  enabled = false,
  scans = [],
  visibleRows = [],
  currentIndex = 0,
} = {}) {
  if (!enabled) return null;
  const cloudId = resolveReviewScanCloudId(scans);
  if (!cloudId) return null;
  const symbols = collectReviewSymbolsForChartPreviewHydrate(visibleRows, currentIndex);
  if (!symbols.length) return null;
  return {
    cloudId,
    symbols,
    signature: buildChartPreviewHydrateSignature(symbols),
  };
}

/**
 * Dispara el fetch; onChunk recibe previews parciales (mismo contrato que Caza).
 * Devuelve la promesa final de previews (objeto symbol → bars).
 */
export function runReviewChartPreviewHydrate(
  plan,
  {
    fetchImpl = fetchChartPreviewsForSymbols,
    onChunk,
  } = {},
) {
  if (!plan?.cloudId || !Array.isArray(plan.symbols) || !plan.symbols.length) {
    return Promise.resolve({});
  }
  return fetchImpl(plan.cloudId, plan.symbols, { onChunk });
}
