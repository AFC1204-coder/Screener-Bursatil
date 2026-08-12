const RANGE_BAR_COUNTS = {
  "1D": 2,
  "5D": 5,
  "1M": 21,
  "3M": 63,
  "6M": 126,
  "1A": 252,
  "2A": 504,
  "5A": 1260,
  MAX: 1260,
};

export const ESTIMATED_CHART_PROVIDER = "StatsEdge fallback estimado (no live)";

function canonicalSymbol(symbol = "") {
  const clean = String(symbol || "").trim().toUpperCase();
  const hk = clean.match(/^(\d{1,4})\.HK$/);
  if (hk) return `${hk[1].padStart(4, "0")}.HK`;
  return clean;
}

function hashSymbol(symbol = "") {
  let hash = 2166136261;
  for (const char of canonicalSymbol(symbol)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function round(n, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}

function safeDate(value = "") {
  const clean = String(value || "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
    const date = new Date(`${clean}T00:00:00Z`);
    if (Number.isFinite(date.getTime())) return date;
  }
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function tradingDatesDesc(count, asOfDate = "") {
  const dates = [];
  const cursor = safeDate(asOfDate);
  while (dates.length < count) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return dates;
}

function countForOptions(options = {}) {
  const key = String(options.range || "2A").trim().toUpperCase();
  const byRange = RANGE_BAR_COUNTS[key] || RANGE_BAR_COUNTS["2A"];
  const minBars = Number(options.minBars || options.minChartBars || 0);
  return clamp(Math.ceil(Math.max(byRange, Number.isFinite(minBars) ? minBars : 0)), 2, RANGE_BAR_COUNTS.MAX);
}

export function estimatedDailyBarsForSymbol(symbol = "", options = {}) {
  const normalized = canonicalSymbol(symbol);
  const seed = hashSymbol(normalized || "STATEDGE");
  const count = countForOptions(options);
  const latestClose = Number(options.latestClose);
  const baseClose = Number.isFinite(latestClose) && latestClose > 0
    ? latestClose
    : 28 + (seed % 520) + ((seed >>> 12) % 100) / 100;
  const baseVolume = 450000 + ((seed >>> 7) % 8500000);
  const trend = 0.00014 + ((seed >>> 10) % 34) / 100000;
  const phase = (seed % 360) * Math.PI / 180;
  const dates = tradingDatesDesc(count, options.asOfDate || options.asOf || "");
  const raw = [];

  for (let i = 0; i < count; i += 1) {
    const t = count - 1 - i;
    const cycle = Math.sin((t / 17) + phase) * 0.035 + Math.sin((t / 47) + phase / 2) * 0.022;
    raw.push(Math.exp(trend * t + cycle));
  }

  const scale = baseClose / (raw[0] || 1);
  return raw.map((value, i) => {
    const t = count - 1 - i;
    const close = Math.max(0.1, value * scale);
    const openOffset = Math.sin((t / 5) + phase) * 0.004;
    const open = close * (1 + openOffset);
    const spread = 0.007 + (((seed + t) % 9) / 2000);
    const high = Math.max(open, close) * (1 + spread);
    const low = Math.min(open, close) * (1 - spread);
    const volumeWave = 1 + Math.sin((t / 11) + phase) * 0.18 + ((t % 13) / 100);
    return {
      date: dates[i],
      open: round(open),
      high: round(high),
      low: round(low),
      close: round(close),
      rawClose: round(close),
      adjClose: round(close),
      volume: Math.max(1000, Math.round(baseVolume * volumeWave)),
      currency: options.currency || "",
      provider: ESTIMATED_CHART_PROVIDER,
      estimated: true,
    };
  });
}

export const UNAVAILABLE_CHART_PROVIDER = "Sin datos de mercado";

// Motivo para el usuario. Deliberadamente NO expone el mensaje crudo del
// proveedor (nombres de servicio, variables de entorno, códigos HTTP): eso vive
// en meta.cache.error para diagnóstico, no en el veredicto que lee la interfaz.
const UNAVAILABLE_ISSUE = "Sin serie de precios real para este símbolo: no hay dato que mostrar.";

// Payload canónico de AUSENCIA. Es lo que devuelve el sistema cuando no existe
// serie real: cero barras, cero precio, cero veredicto. Ninguna superficie puede
// derivar una etapa, un RS o un rendimiento de aquí, que es exactamente el
// punto — un símbolo sin datos reales no genera juicio técnico.
export function unavailableChartForSymbol(symbol = "", options = {}, error = {}) {
  const normalized = canonicalSymbol(symbol);
  const message = error?.message || "Proveedor/caché no disponible dentro del presupuesto operativo";
  return {
    ok: false,
    bars: [],
    meta: {
      symbol: normalized,
      regularMarketPrice: null,
      currency: options.currency || "",
      dataProvider: UNAVAILABLE_CHART_PROVIDER,
      requestedInterval: options.interval || "D",
      requestedRange: options.range || "2A",
      estimated: false,
      cache: {
        hit: false,
        stale: false,
        rows: 0,
        maxAgeDays: options.maxAgeDays ?? null,
        error: message,
      },
    },
    dataQuality: {
      status: "missing",
      estimated: false,
      degraded: true,
      source: "unavailable",
      demo: false,
      issue: UNAVAILABLE_ISSUE,
      reason: message,
      fallbackError: message,
    },
  };
}

// Serie sintética. SOLO se emite bajo modo demo explícito (`options.demo ===
// true`), nunca como fallback por fallo del proveedor: fabricar precios cuando
// la descarga falla producía fichas completas —precio, cierre y veredicto de
// etapa— sobre símbolos inexistentes y sobre símbolos reales con histórico
// insuficiente. El aviso de "datos estimados" no basta; el dato inventado no
// debe existir. Sin demo, esta función devuelve el payload de ausencia.
export function estimatedChartForSymbol(symbol = "", options = {}, error = {}) {
  const demo = options.demo === true;
  if (!demo) return unavailableChartForSymbol(symbol, options, error);
  const normalized = canonicalSymbol(symbol);
  const bars = estimatedDailyBarsForSymbol(normalized, options);
  const latest = bars[0] || {};
  const message = error?.message || "Proveedor/caché no disponible dentro del presupuesto operativo";
  return {
    ok: false,
    bars,
    meta: {
      symbol: normalized,
      regularMarketPrice: latest.close ?? null,
      currency: latest.currency || options.currency || "",
      dataProvider: ESTIMATED_CHART_PROVIDER,
      requestedInterval: options.interval || "D",
      requestedRange: options.range || "2A",
      estimated: true,
      cache: {
        hit: false,
        stale: false,
        rows: 0,
        maxAgeDays: options.maxAgeDays ?? null,
        error: message,
      },
    },
    dataQuality: {
      status: "estimated",
      estimated: true,
      degraded: true,
      source: "estimator",
      demo,
      issue: "Serie generada solo para continuidad visual; no sustituye datos de mercado reales.",
      // reason es el alias canónico de fallbackError (chartDataQuality lo lee
      // preferentemente). Se mantiene fallbackError por compatibilidad —
      // tests/estimatedBars.test.js y company-brief lo consumen directamente.
      reason: message,
      fallbackError: message,
    },
  };
}
