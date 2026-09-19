// lib/reviewChartPreviewHydrate.js — hidrata chartPreview del foco Review
// (activo + vecinos) vía /api/scans/chart-preview. Sin company-brief.
//
// Tras el transporte diferido de chartPreview (#24/#26), la cola Review suele
// abrir sin miniaturas: merge desde STORAGE_KEYS.scans no encuentra preview
// porque la mesa también lo difiere. Sin preview local el chart queda en
// «Cargando histórico…» hasta que /api/chart (OHLC) resuelva. Este módulo
// repone el preview close-only del foco para pintar línea al instante
// (CHART-QR-1) mientras el OHLC sigue en paralelo.

import { fetchChartCached } from "@/lib/chartFetchCache";
import { reviewQueueNeighbors } from "@/lib/reviewChartPrefetch";
import { compactChartPreview } from "@/lib/researchRowContract";
import {
  buildChartPreviewHydrateSignature,
  fetchChartPreviewsForSymbols,
} from "@/lib/scansChartPreviewHydrate";
import { chartPreviewScanIdsFromScan } from "@/lib/scansChartPreviewScanIds";
import { symbolsMissingChartPreview } from "@/lib/scansChartPreviewTransport";

/** Mismo rango que REVIEW_CHART_SETTINGS en app/review/page.jsx */
export const REVIEW_DIRECT_CHART_DATA_RANGE = "6M";
export const REVIEW_DIRECT_CHART_INTERVAL = "D";

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

/** UUIDs de persistencia para chart-preview (merged → mergedFrom). */
export function resolveReviewChartPreviewScanIds(scans = []) {
  const scan = Array.isArray(scans) ? scans[0] : null;
  if (!scan) return [];
  if (Array.isArray(scan.chartPreviewScanIds) && scan.chartPreviewScanIds.length) {
    return scan.chartPreviewScanIds;
  }
  return chartPreviewScanIdsFromScan(scan);
}

/**
 * Plan estable para el effect de hidratación en /review.
 * null si no faltan previews en el foco.
 *
 * Con cloudId del scan → POST /api/scans/chart-preview (modo scan).
 * Sin cloudId (p. ej. /review?symbol=AAPL, modo 1 símbolo) → GET /api/chart
 * y compactChartPreview (modo direct) para pintar línea al instante.
 */
export function buildReviewChartPreviewHydratePlan({
  enabled = false,
  scans = [],
  visibleRows = [],
  currentIndex = 0,
} = {}) {
  if (!enabled) return null;
  const symbols = collectReviewSymbolsForChartPreviewHydrate(visibleRows, currentIndex);
  if (!symbols.length) return null;
  const signature = buildChartPreviewHydrateSignature(symbols);
  const cloudId = resolveReviewScanCloudId(scans);
  if (cloudId) {
    return {
      mode: "scan",
      cloudId,
      scanIds: resolveReviewChartPreviewScanIds(scans),
      symbols,
      signature: `scan|${cloudId}|${signature}`,
    };
  }
  return {
    mode: "direct",
    symbols,
    dataRange: REVIEW_DIRECT_CHART_DATA_RANGE,
    interval: REVIEW_DIRECT_CHART_INTERVAL,
    signature: `direct|${signature}`,
  };
}

/**
 * Hidrata chartPreview vía /api/chart (modo 1 símbolo o sin scan en sesión).
 * onChunk recibe previews parciales por símbolo resuelto.
 */
export async function runReviewDirectChartHydrate(
  plan,
  {
    fetchImpl = fetchChartCached,
    onChunk,
  } = {},
) {
  if (plan?.mode !== "direct" || !Array.isArray(plan.symbols) || !plan.symbols.length) {
    return {};
  }
  const previews = {};
  const dataRange = plan.dataRange || REVIEW_DIRECT_CHART_DATA_RANGE;
  const interval = plan.interval || REVIEW_DIRECT_CHART_INTERVAL;

  await Promise.all(plan.symbols.map(async (symbol) => {
    const clean = String(symbol || "").trim().toUpperCase();
    if (!clean) return;
    try {
      const payload = await fetchImpl({
        symbol: clean,
        dataRange,
        interval,
      });
      const chartPreview = compactChartPreview(payload?.bars || []);
      if (chartPreview.length < 2) return;
      previews[clean] = chartPreview;
      onChunk?.({ [clean]: chartPreview });
    } catch {
      // Fallo por símbolo: el chart sigue su propio /api/chart con error explícito.
    }
  }));

  return previews;
}

/**
 * Dispara el fetch; onChunk recibe previews parciales (mismo contrato que Caza).
 * Devuelve la promesa final de previews (objeto symbol → bars).
 */
export function runReviewChartPreviewHydrate(
  plan,
  {
    fetchImpl = fetchChartPreviewsForSymbols,
    directFetchImpl = fetchChartCached,
    onChunk,
  } = {},
) {
  if (!plan || !Array.isArray(plan.symbols) || !plan.symbols.length) {
    return Promise.resolve({});
  }
  if (plan.mode === "direct") {
    return runReviewDirectChartHydrate(plan, { fetchImpl: directFetchImpl, onChunk });
  }
  if (!plan.cloudId) return Promise.resolve({});
  return fetchImpl(plan.cloudId, plan.symbols, {
    onChunk,
    scanIds: Array.isArray(plan.scanIds) && plan.scanIds.length ? plan.scanIds : null,
  });
}
