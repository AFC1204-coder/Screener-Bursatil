// Normalizador canónico de la calidad de una serie de gráfico.
//
// El productor de datos de gráfico (estimatedBars.js / dailyBarsCache.js /
// fetchYahooChart) emite un objeto `dataQuality` con shape variable según el
// origen. Este módulo lo colapsa a UNA sola forma canónica que el consumidor
// (scoring, brief, UI de confianza) puede leer sin importar de dónde vino la
// serie. La pieza crítica es la detección de barras sintéticas (estimated):
// un payload legacy sin `dataQuality` se asume real, PERO se degrada a
// "estimated" cuando las señales estructurales (meta.estimated,
// meta.dataProvider === ESTIMATED_CHART_PROVIDER, o alguna barra con
// estimated === true) lo delatan. Eso impide que barras sintéticas se cuelen
// como reales en decisiones de inversión.
//
// La detección estructural está deliberadamente acotada al camino legacy (sin
// `dataQuality` explícito): cuando el productor emite `dataQuality`, este
// módulo confía en su `status` — el productor es la fuente canónica y ya lo
// calcula correctamente.

import { ESTIMATED_CHART_PROVIDER, UNAVAILABLE_CHART_PROVIDER } from "@/lib/estimatedBars";

const VALID_STATUSES = new Set(["real", "estimated", "missing"]);
const DEFAULT_SOURCE = "unknown";
const LEGACY_DETECTED_REASON = "Serie estimada detectada por meta/bars sin dataQuality explícito";

// Detecta señales estructurales de "estimated" sobre el payload crudo, sin
// fiarse del campo `dataQuality`. Es la red de seguridad del camino legacy.
function detectEstimated(meta = {}, bars = []) {
  if (meta.estimated === true) return true;
  if (meta.dataProvider === ESTIMATED_CHART_PROVIDER) return true;
  if (Array.isArray(bars) && bars.some((bar) => bar && bar.estimated === true)) return true;
  return false;
}

// Normaliza cualquier payload de gráfico a la forma canónica:
//   { status, estimated, degraded, source, reason, issue, demo }
//
// - status: veredicto de decision-grade ("real" | "estimated" | "missing").
// - estimated: true si la serie es sintética/estimada.
// - degraded: true si la calidad está degradada (estimated/missing, o real
//   marcado explícitamente degraded por el productor).
// - source: quién sirvió la serie (dataQuality.source > meta.dataProvider).
// - reason / issue: texto humano del productor (reason es alias de fallbackError).
// - demo: true si la serie se sirvió por modo demo del caller.
export function chartQuality(json = {}) {
  const payload = json || {};
  const dq = payload.dataQuality || null;
  const meta = payload.meta || {};
  const bars = Array.isArray(payload.bars) ? payload.bars : [];

  const detectedEstimated = detectEstimated(meta, bars);
  const source = (dq && dq.source) || meta.dataProvider || DEFAULT_SOURCE;

  let status;
  let estimated;
  let degraded;
  let reason;
  let issue;
  let demo;

  if (dq) {
    // Camino explícito: confía en el productor. Normaliza status al enum
    // válido; si el productor solo puso estimated:true, deriva "estimated".
    if (VALID_STATUSES.has(dq.status)) {
      status = dq.status;
    } else if (dq.estimated === true) {
      status = "estimated";
    } else {
      status = "real";
    }
    estimated = status === "estimated";
    degraded = status === "real" ? dq.degraded === true : true;
    reason = dq.reason || dq.fallbackError || "";
    issue = dq.issue || "";
    demo = dq.demo === true;
  } else {
    // Camino legacy: asume real, pero degrada a "estimated" si las señales
    // estructurales (meta/bars) delatan barras sintéticas.
    status = detectedEstimated ? "estimated" : "real";
    estimated = detectedEstimated;
    degraded = detectedEstimated;
    reason = detectedEstimated ? LEGACY_DETECTED_REASON : "";
    issue = "";
    demo = false;
  }

  return { status, estimated, degraded, source, reason, issue, demo };
}

// Decision-grade: la serie puede sostener una decisión de inversión. Es true
// únicamente cuando status === "real". El source NO importa: una serie servida
// desde caché stale sigue siendo mercado real (solo viejo), así que cuenta
// como decision-grade. Solo estimated/missing la descalifican.
export function isDecisionGrade(json = {}) {
  return chartQuality(json).status === "real";
}

// Patrón del proveedor de chart cuando su nombre delata serie estimada / no
// live. Comparte regex con la detección histórica en StockClient para no
// divergir: "estimado", "estimated" o "no live" en el nombre del proveedor
// implican datos sintéticos.
const ESTIMATED_PROVIDER_RE = /estimado|estimated|no live/i;

// Forma breve de la fuente local (`company-brief`): encapsula los predicados
// ad-hoc que vivían en StockClient para detectar histórico estimado, en un
// único adaptador que devuelve un `ChartQuality` canónico. Se aplica **solo
// en el lado del caller**; NO decide si el chart puede pintar barras — esa
// responsabilidad pertenece al data model (ADR §3.2). Sus entradas son:
//
//   - bars: payload crudo de barras locales (puede ser []).
//   - dataQuality: el sub-objeto dataQuality del brief (`freshness.*`,
//     `dataQuality.estimatedChart`). Opcional.
//   - chartProvider: el nombre del proveedor de chart que produjo la serie
//     local (p.ej. "Yahoo Finance", "StatsEdge fallback estimado (no live)").
//
// Devuelve SIEMPRE la forma canónica `{ status, estimated, degraded, source,
// reason, issue, demo }`. No es otro guard: reusar `chartQuality()` deja una
// sola fuente de verdad para el veredicto canónico.
export function chartQualityFromBrief({ bars = [], dataQuality = null, chartProvider = "" } = {}) {
  const brief = dataQuality && typeof dataQuality === "object" ? dataQuality : {};
  const freshness = brief.freshness && typeof brief.freshness === "object" ? brief.freshness : {};
  const providerString = typeof chartProvider === "string" ? chartProvider : "";

  // Ausencia declarada por el productor: no hay serie real detrás. Se
  // distingue de "estimada" a propósito — estimada es un dato inventado que ya
  // no se emite; ausente es la respuesta honesta cuando no hay mercado. Se lee
  // solo de banderas explícitas del brief, nunca de "bars viene vacío": un
  // array vacío durante la carga inicial no es una ausencia confirmada.
  const briefUnavailable = Boolean(
    freshness.chartUnavailable === true
    || brief.chartUnavailable === true
    || brief.unavailable === true
    || (providerString && providerString === UNAVAILABLE_CHART_PROVIDER)
  );
  if (briefUnavailable) {
    return {
      status: "missing",
      estimated: false,
      degraded: true,
      source: providerString || UNAVAILABLE_CHART_PROVIDER,
      reason: "",
      issue: "Sin serie de precios real para este símbolo.",
      demo: false,
    };
  }

  // Réplica exacta del predicado local en StockClient: cualquier bandera
  // estimada por proveedor delata la serie como no decision-grade.
  const briefEstimates = Boolean(
    freshness.priceEstimated
    || freshness.chartEstimated
    || brief.estimatedChart === true
    || (providerString && ESTIMATED_PROVIDER_RE.test(providerString))
  );

  // Construye el payload que `chartQuality()` entiende: si el brief delata
  // una serie estimada, declaramos `meta.estimated = true` para que el
  // clasificador canónico (camino legacy → `detectEstimated`) la degrade a
  // `status:"estimated"`. Si NO hay señal estimada, dejamos `meta` vacío y
  // dejamos que la detección estructural de barras (`bar.estimated` o
  // `meta.dataProvider === ESTIMATED_CHART_PROVIDER`) haga su trabajo.
  const meta = { dataProvider: providerString || "" };
  if (briefEstimates) meta.estimated = true;

  return chartQuality({
    bars: Array.isArray(bars) ? bars : [],
    meta,
  });
}

// Guardia: lanza si la serie NO es decision-grade. Mensaje canónico para que el
// consumidor identifique sin ambigüedad que la exclusión fue por ser estimada.
export function assertDecisionGrade(json = {}, context = "decisión") {
  if (!isDecisionGrade(json)) {
    throw new Error(`Serie estimada excluida de ${context}`);
  }
}

// Candle-grade: las barras tienen OHLC nativo (con rango real) y pueden pintarse
// como velas coherentes, no como puntos/guiones degenerados.
//
// Un `chartPreview` close-only (p.ej. el persistido en app/review/page.jsx vía
// chartPreviewFromBars, que guarda {date, close, volume, sma50, sma200}) se
// degenera a open=high=low=close al normalizarlo, y produce velas de cero rango
// cuando se renderiza en modo candlestick. Eso es aceptable como placeholder
// MIENTRAS el fetch remoto de OHLC real está en curso, pero cuando ese fetch
// falla por red el fallback NO debe pintarse como velas: el usuario vería datos
// visualmente rotos que podría confundir con mercado real degradado — justo el
// riesgo que el bloque dataQuality existe para prevenir.
//
// Heurística robusta: una barra con OHLC real tiene high≠close o low≠close en
// al menos un punto; bars close-only tienen todo = close. Datos de mercado real
// siempre tienen algo de rango intradía/barra, así que esto no da false-positives.
export function barsAreCandleGrade(bars = []) {
  return Array.isArray(bars) && bars.some((bar) => {
    if (!bar) return false;
    const open = Number(bar.open);
    const high = Number(bar.high);
    const low = Number(bar.low);
    const close = Number(bar.close);
    if (!Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) return false;
    return high !== close || low !== close;
  });
}
