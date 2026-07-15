// lib/chartDataModel.js — pieza pura del data model del chart (ADR §3.1).
//
// Encapsula las decisiones que estaban embebidas en `UniversalPriceChart.jsx`
// para que su API pública (consumida por `useChartDataModel` en el siguiente
// paso del ADR) nunca devuelva barras no decision-grade:
//
//   - normalizeRows: limpieza estructural de barras crudas (UniversalPriceChart.jsx:59-78).
//   - aggregateRows: agrupación por intervalo distinto de D / intradía (UniversalPriceChart.jsx:90-111).
//   - chartRangeRows: recorte por dataRange en barras de mercado (UniversalPriceChart.jsx:137-146).
//   - shouldRequestRemoteBars: suficiencia local antes de pedir más histórico
//     (UniversalPriceChart.jsx:148-153). La decisión se calcula ANTES del guard
//     P0: una serie estimada suficientemente larga NO dispara fetch nuevo.
//   - chartDataModel.resolve: matriz determinista de §3.5–3.6 que decide qué
//     filas finales, `availability`, `requestState`, `notice` y `error` publica.
//
// Esta pieza es 100% pura: no importa React, ni la librería nativa, ni hace
// fetch. El fetch es detalle del adaptador (`useChartDataModel`) y se sustituye
// en tests pasando el resultado del request en `request`.

import {
  barsAreCandleGrade,
  chartQuality,
} from "@/lib/chartDataQuality";
import {
  CHART_RANGES,
  DEFAULT_CHART_SETTINGS,
  normalizeChartInterval,
} from "@/lib/chartSettings";
import { userFacingSearchError } from "@/lib/screenerFormat";

// ─────────────────────────────────────────────────────────────────────────────
// Constantes internas: deben coincidir EXACTAMENTE con las del componente
// original. No se mueven aquí para no tocar el archivo de producción.

const TRADING_DAY_SECONDS = (86400 * 7) / 5;
const INTRADAY_INTERVALS = new Set(["1m", "5m", "15m", "30m", "1H", "4H"]);
const LINE_STYLES = new Set(["8", "3"]); // "8" = Linea, "3" = Area.
const STYLE_LINE = "8";
const STYLE_AREA = "3";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers puros.

// UniversalPriceChart.jsx:42-44
function isIntradayInterval(interval = "") {
  return INTRADAY_INTERVALS.has(normalizeChartInterval(interval));
}

// UniversalPriceChart.jsx:52-57 — convierte cualquier input de fecha (epoch
// segundos, ISO YYYY-MM-DD o string completo) a epoch segundos.
function timeFromBar(bar = {}) {
  if (!bar) return null;
  const numeric = Number(bar.time);
  if (Number.isFinite(numeric)) return numeric;
  const dateText = String(bar.date || "");
  const parsed = Date.parse(
    dateText.length <= 10 ? `${dateText}T00:00:00Z` : dateText,
  );
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// UniversalPriceChart.jsx:59-78 — verbatim. Devuelve siempre la forma canónica
// interna { time, date, open, high, low, close, volume } ordenada por tiempo
// ascendente. Es la pieza que el modelo considera estructuralmente correcta;
// los flags `estimated`/`missing` no la afectan: el guard P0 vive en
// `chartDataModel.resolve`, no aquí.
function normalizeRowsImpl(bars = []) {
  return (bars || [])
    .map((bar) => {
      if (!bar) return null;
      const close = safeNumber(bar.close);
      if (!Number.isFinite(close)) return null;
      const open = safeNumber(bar.open) ?? close;
      const time = timeFromBar(bar);
      return {
        time,
        date: String(bar.date || "").slice(0, 10),
        open,
        high: safeNumber(bar.high) ?? Math.max(open, close),
        low: safeNumber(bar.low) ?? Math.min(open, close),
        close,
        volume: safeNumber(bar.volume) ?? 0,
      };
    })
    .filter((bar) => Number.isFinite(bar?.time) && Number.isFinite(bar.close) && bar.close > 0)
    .sort((a, b) => a.time - b.time);
}

// UniversalPriceChart.jsx:80-88 — weekKey se conserva tal cual: la regla ISO
// para encontrar el lunes de la semana es invariante.
function weekKey(dateText = "") {
  const date = new Date(`${dateText}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return dateText;
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

// UniversalPriceChart.jsx:90-111 — verbatim. D y los intradías (excepto 4H)
// pasan tal cual; W y M agrupan por clave temporal; 4H agrupa por bloque de 4h.
function aggregateRowsImpl(rows = [], interval = "D") {
  const normalizedInterval = normalizeChartInterval(interval);
  if (normalizedInterval === "D" || (isIntradayInterval(normalizedInterval) && normalizedInterval !== "4H")) {
    return rows;
  }
  const groups = new Map();
  for (const row of rows) {
    const key = normalizedInterval === "4H"
      ? String(Math.floor(row.time / (4 * 60 * 60)))
      : normalizedInterval === "M"
        ? row.date.slice(0, 7)
        : weekKey(row.date);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.values()].map((group) => {
    const first = group[0];
    const last = group[group.length - 1];
    return {
      time: last.time,
      date: last.date,
      open: first.open,
      high: Math.max(...group.map((item) => item.high)),
      low: Math.min(...group.map((item) => item.low)),
      close: last.close,
      volume: group.reduce((sum, item) => sum + (item.volume || 0), 0),
    };
  });
}

// UniversalPriceChart.jsx:137-146 — verbatim. Intradía nunca recorta; MAX
// recorta a nada; el resto aplica el cutoff en segundos de mercado.
function chartRangeRowsImpl(rows = [], rangeKey = DEFAULT_CHART_SETTINGS.range, interval = DEFAULT_CHART_SETTINGS.interval) {
  const normalizedInterval = normalizeChartInterval(interval);
  if (isIntradayInterval(normalizedInterval)) return rows;
  const activeRange = CHART_RANGES.find((range) => range.key === rangeKey) || CHART_RANGES[3];
  if (activeRange.key === "MAX" || activeRange.bars === Infinity) return rows;
  const latestTime = rows.at(-1)?.time;
  if (!Number.isFinite(latestTime)) return rows.slice(-Math.min(activeRange.bars, rows.length));
  const cutoff = latestTime - (activeRange.bars * TRADING_DAY_SECONDS);
  const filtered = rows.filter((row) => Number.isFinite(row.time) && row.time >= cutoff);
  return filtered.length >= 2 ? filtered : rows.slice(-Math.min(activeRange.bars, rows.length));
}

// UniversalPriceChart.jsx:148-153 — verbatim. La suficiencia se evalúa SIEMPRE
// antes del guard P0: una serie estimada suficientemente larga NO dispara un
// fetch nuevo (caracterización: local estimado largo con `shouldRequestRemote`
// false → el componente NO entra en loading).
function shouldRequestRemoteBarsImpl(localRows = [], rangeKey = DEFAULT_CHART_SETTINGS.range, interval = DEFAULT_CHART_SETTINGS.interval) {
  const normalizedInterval = normalizeChartInterval(interval);
  if (isIntradayInterval(normalizedInterval)) return true;
  const activeRange = CHART_RANGES.find((range) => range.key === rangeKey) || CHART_RANGES[3];
  if (activeRange.key === "MAX" || activeRange.bars === Infinity) return localRows.length < 900;
  return Number.isFinite(activeRange.bars) && localRows.length < activeRange.bars;
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolución de la calidad local (ADR §3.2, paso 9).
//
// El data model sólo conoce la forma canónica `ChartQuality`. La prop
// legacy `chartEstimated` ya no forma parte del contrato del resolver:
// los callers deben pasar `quality` explícito (típicamente el resultado
// de `chartQualityFromBrief` o `chartQuality`). Si el caller legacy NO
// pasa `quality`, se ejecuta el clasificador estructural sobre los campos
// crudos de las barras + meta del payload, que es la red de seguridad
// histórica (camino legacy de `chartQuality`).
function localQualityFromInput(input = {}) {
  const { bars = [], localQuality = null } = input;
  if (localQuality && typeof localQuality === "object" && typeof localQuality.status === "string") {
    return localQuality;
  }
  return chartQuality({ bars });
}

// `eligibleLocal` — clasificación de las barras locales según los criterios
// de la matriz §3.6 (paso 3):
//   - calidad real;
//   - no intradía;
//   - ≥ 2 filas;
//   - estilo línea/área O `barsAreCandleGrade`.
function eligibleLocal({ rows, quality, interval, style }) {
  if (!rows || rows.length < 2) return false;
  if (!quality || quality.status !== "real") return false;
  if (isIntradayInterval(interval)) return false;
  return LINE_STYLES.has(style) || barsAreCandleGrade(rows);
}

// `localOutcome` — §3.6 paso 4. Una sola decisión por fuente local:
//   - blocked si la calidad local es no-real (P0);
//   - ready si eligibleLocal;
//   - empty en cualquier otro caso (incluye close-only en candlestick).
function localOutcome({ rows, quality, interval, style }) {
  if (quality && quality.status !== "real") return "blocked";
  if (eligibleLocal({ rows, quality, interval, style })) return "ready";
  return "empty";
}

// `rowsToModel` — aplica agregación + recorte sobre una fuente ya normalizada
// y devuelve `{ rows, empty }` para que el resolver decida.
function shapeRows(normalizedRows = [], interval, range) {
  const aggregated = aggregateRowsImpl(normalizedRows, interval);
  const trimmed = chartRangeRowsImpl(aggregated, range, interval);
  return { rows: trimmed, hasRows: trimmed.length >= 2 };
}

// `qualityFromPayload` — clasifica un payload remoto con la API canónica,
// aplicando también la detección estructural legacy. `null` si la respuesta
// todavía no llegó.
function qualityFromPayload(payload = null) {
  if (!payload || typeof payload !== "object") return null;
  return chartQuality(payload);
}

// `noticeFor` — única tabla de copy §3.4 con prioridad numérica estricta.
// Gana siempre el código de menor prioridad; un bloqueo P0 nunca queda oculto
// tras un loading o error operacional.
const NOTICE_TABLE = [
  { priority: 1, code: "quality-estimated", text: "Datos estimados — no aptos para decisión", kind: "quality", copyTitle: true },
  { priority: 2, code: "quality-missing", text: "Sin histórico de mercado disponible", kind: "quality", copyTitle: true },
  { priority: 3, code: "history-loading", text: "Cargando histórico...", kind: "loading", copyTitle: false },
  { priority: 4, code: "provider-unavailable", text: "Proveedor de gráfico no disponible: {error.message}", kind: "error", copyTitle: false },
  { priority: 5, code: "history-expanding", text: "Ampliando histórico para este rango...", kind: "expanding", copyTitle: false },
  { priority: 6, code: "history-expansion-failed", text: "Histórico ampliado no disponible: {error.message}. Se mantiene el histórico disponible.", kind: "error", copyTitle: false },
  { priority: 7, code: "insufficient-history", text: null, kind: "empty", copyTitle: false }, // se materializa vía userFacingSearchError.
];

function applyNoticeTemplate(text, error) {
  if (typeof text !== "string") return text;
  const message = String(error?.message || "").trim();
  return text.replace("{error.message}", message);
}

function noticeFor({ availability, requestState, requestError, localQuality, remoteQuality, dataRange, interval }) {
  // 1) Calidad efectiva estimada — tanto si viene del remoto (respuesta estimada)
  //    como si viene del local (`localQuality` no-real). §3.4 prioridad 1.
  //    Cuando remoteQuality es el veredicto, gana el remoto.
  const effectiveDegraded = remoteQuality && remoteQuality.status !== "real"
    ? remoteQuality
    : localQuality && localQuality.status !== "real" ? localQuality : null;

  if (effectiveDegraded && effectiveDegraded.status === "estimated") {
    return {
      kind: "quality",
      code: "quality-estimated",
      text: "Datos estimados — no aptos para decisión",
      title: effectiveDegraded.reason || effectiveDegraded.issue || "",
    };
  }
  if (effectiveDegraded && effectiveDegraded.status === "missing") {
    return {
      kind: "quality",
      code: "quality-missing",
      text: "Sin histórico de mercado disponible",
      title: effectiveDegraded.reason || effectiveDegraded.issue || "",
    };
  }

  // 3–4) Sin rows + request loading/error.
  if (availability !== "ready" && requestState === "loading") {
    return { kind: "loading", code: "history-loading", text: "Cargando histórico...", title: "" };
  }
  if (availability !== "ready" && requestState === "error") {
    return {
      kind: "error",
      code: "provider-unavailable",
      text: applyNoticeTemplate(
        "Proveedor de gráfico no disponible: {error.message}",
        requestError,
      ),
      title: "",
    };
  }

  // 5–6) Rows listas + request loading/error (no bloquea el render pero avisa).
  if (availability === "ready" && requestState === "loading") {
    return { kind: "expanding", code: "history-expanding", text: "Ampliando histórico para este rango...", title: "" };
  }
  if (availability === "ready" && requestState === "error") {
    return {
      kind: "error",
      code: "history-expansion-failed",
      text: applyNoticeTemplate(
        "Histórico ampliado no disponible: {error.message}. Se mantiene el histórico disponible.",
        requestError,
      ),
      title: "",
    };
  }

  // 7) Availability empty con rows insuficientes para el estilo pedido.
  if (availability === "empty") {
    return {
      kind: "empty",
      code: "insufficient-history",
      text: userFacingSearchError("Histórico insuficiente"),
      title: "",
    };
  }

  return null;
}

// Normaliza la entrada de `chartDataModel.resolve` con la misma tolerancia
// que `chartDataQuality` (entradas nulas / ausentes no rompen).
function normalizeInput(input = {}) {
  const localSource = input.localSource && typeof input.localSource === "object" ? input.localSource : {};
  const config = input.config && typeof input.config === "object" ? input.config : {};
  return {
    symbol: typeof input.symbol === "string" ? input.symbol : "",
    localSource: {
      bars: Array.isArray(localSource.bars) ? localSource.bars : [],
      quality: localSource.quality ?? null,
    },
    config: {
      dataRange: config.dataRange || DEFAULT_CHART_SETTINGS.range,
      interval: normalizeChartInterval(config.interval || DEFAULT_CHART_SETTINGS.interval),
      style: config.style || DEFAULT_CHART_SETTINGS.style,
    },
    request: input.request && typeof input.request === "object" ? input.request : null,
  };
}

// `emptyResult` — salida canónica para "no hay decisión todavía".
// Cuando el local era real pero no candle-grade (close-only en velas), la
// calidad sigue siendo "real": la disponibilidad es empty por insuficiencia
// estructural, NO por calidad P0. Por eso propagamos el localQuality cuando
// viene informado; sólo es null si nunca hubo fuente.
function emptyResult({ dataRange, interval, style, localQuality, remoteQuality, requestState, requestError }) {
  const availability = "empty";
  return {
    rows: [],
    rowTimes: [],
    quality: localQuality || remoteQuality || null,
    availability,
    requestState,
    error: requestError,
    notice: noticeFor({
      availability,
      requestState,
      requestError,
      localQuality,
      remoteQuality,
      dataRange,
      interval,
    }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// chartDataModel.resolve — entrada única del modelo de datos.
//
// Implementa la matriz §3.5–3.6 verbatim. Garantías contractuales:
//   - `rows` NUNCA contiene datos estimated/missing.
//   - `rowTimes` se deriva de `rows` (no de barras crudas).
//   - `quality.source` se conserva como procedencia; no se exponen nombres
//     remote/local/fallback.
//   - Si `rows.length > 0` ⇒ `quality.status === "real"` (invariante).
//   - `notice` se resuelve por prioridad numérica estricta (1–7) y la copia es
//     la del ADR §3.4.
//
// `request` (opcional) describe el resultado del fetch vigente:
//   { generation, key, state: 'idle'|'loading'|'settled'|'error',
//     bars, meta, quality, error }
//   - `key` y `generation` son la identidad vigente: cualquier respuesta con
//     una key/generation distinta a la del último `resolve` debe ser filtrada
//     por el adaptador React antes de llegar aquí. Este módulo trata la
//     respuesta como si fuera la vigente.
//   - `state` mapea 1:1 a `requestState` en la salida.
function resolve(input = {}) {
  const { symbol, localSource, config, request } = normalizeInput(input);

  // Paso 1: localQuality ANTES de normalizar — preserva los flags estructurales
  // que el guard necesita incluso si las barras crudas no los exponen. ADR §3.2
  // y §9 (cierre): la entrada del resolver es ÚNICAMENTE `quality`; cualquier
  // representación legacy se ha eliminado.
  const localQuality = localQualityFromInput({
    bars: localSource.bars,
    localQuality: localSource.quality,
  });

  // Paso 2: normalize + decisión de suficiencia basada en la cantidad/rango
  // local. NO se cambia el criterio P0: la suficiencia se evalúa antes del
  // guard de calidad.
  const localRows = normalizeRowsImpl(localSource.bars);
  const needsRemote = shouldRequestRemoteBarsImpl(localRows, config.dataRange, config.interval);
  const intraday = isIntradayInterval(config.interval);

  // Paso 3 y 4: localOutcome y decisión de remote según `request`.
  const local = localOutcome({
    rows: localRows,
    quality: localQuality,
    interval: config.interval,
    style: config.style,
  });

  // Paso 5: sin request necesario → localOutcome con requestState idle.
  if (!needsRemote || !symbol) {
    if (local === "blocked") {
      return {
        rows: [],
        rowTimes: [],
        quality: localQuality,
        availability: "blocked",
        requestState: "idle",
        error: null,
        notice: noticeFor({
          availability: "blocked",
          requestState: "idle",
          requestError: null,
          localQuality,
          remoteQuality: null,
          dataRange: config.dataRange,
          interval: config.interval,
        }),
      };
    }
    if (local === "ready") {
      const { rows } = shapeRows(localRows, config.interval, config.dataRange);
      if (rows.length < 2) {
        // La transformación final dejó menos de 2 filas → outcome empty (§3.6 paso 8).
        return emptyResult({
          dataRange: config.dataRange,
          interval: config.interval,
          style: config.style,
          localQuality,
          remoteQuality: null,
          requestState: "idle",
          requestError: null,
        });
      }
      return {
        rows,
        rowTimes: rows.map((row) => row.time),
        quality: localQuality,
        availability: "ready",
        requestState: "idle",
        error: null,
        notice: noticeFor({
          availability: "ready",
          requestState: "idle",
          requestError: null,
          localQuality,
          remoteQuality: null,
          dataRange: config.dataRange,
          interval: config.interval,
        }),
      };
    }
    // local === "empty" (incluye close-only real en candlestick).
    return emptyResult({
      dataRange: config.dataRange,
      interval: config.interval,
      style: config.style,
      localQuality,
      remoteQuality: null,
      requestState: "idle",
      requestError: null,
    });
  }

  // Necesitamos request. Mapeo a requestState.
  const requestState = request?.state || "loading";
  const requestError = requestState === "error" && request?.error
    ? { code: "fetch-error", message: String(request.error.message || request.error || "Proveedor no disponible") }
    : null;
  const remoteQuality = requestState === "settled" ? qualityFromPayload(request?.payload) : null;
  const remoteBars = requestState === "settled" && Array.isArray(request?.payload?.bars)
    ? request.payload.bars
    : null;

  // Mientras el request está pendiente, devolvemos el outcome local.
  if (requestState !== "settled") {
    if (local === "blocked") {
      return {
        rows: [],
        rowTimes: [],
        quality: localQuality,
        availability: "blocked",
        requestState,
        error: requestError,
        notice: noticeFor({
          availability: "blocked",
          requestState,
          requestError,
          localQuality,
          remoteQuality: null,
          dataRange: config.dataRange,
          interval: config.interval,
        }),
      };
    }
    if (local === "ready") {
      const { rows } = shapeRows(localRows, config.interval, config.dataRange);
      if (rows.length < 2) {
        return emptyResult({
          dataRange: config.dataRange,
          interval: config.interval,
          style: config.style,
          localQuality,
          remoteQuality: null,
          requestState,
          requestError,
        });
      }
      return {
        rows,
        rowTimes: rows.map((row) => row.time),
        quality: localQuality,
        availability: "ready",
        requestState,
        error: requestError,
        notice: noticeFor({
          availability: "ready",
          requestState,
          requestError,
          localQuality,
          remoteQuality: null,
          dataRange: config.dataRange,
          interval: config.interval,
        }),
      };
    }
    return emptyResult({
      dataRange: config.dataRange,
      interval: config.interval,
      style: config.style,
      localQuality,
      remoteQuality: null,
      requestState,
      requestError,
    });
  }

  // requestState === "settled": Paso 6.
  // Calidad no-real → blocked + [], aunque exista local real.
  if (remoteQuality && remoteQuality.status !== "real") {
    return {
      rows: [],
      rowTimes: [],
      quality: remoteQuality,
      availability: "blocked",
      requestState: "settled",
      error: null,
      notice: noticeFor({
        availability: "blocked",
        requestState: "settled",
        requestError: null,
        localQuality,
        remoteQuality,
        dataRange: config.dataRange,
        interval: config.interval,
      }),
    };
  }

  // Calidad real + barras válidas → esas barras.
  if (remoteBars && remoteBars.length) {
    const normalizedRemote = normalizeRowsImpl(remoteBars);
    if (normalizedRemote.length) {
      const { rows } = shapeRows(normalizedRemote, config.interval, config.dataRange);
      if (rows.length < 2) {
        // Paso 6: real pero vacío/insuficiente → vuelve a localOutcome.
        return fallbackToLocal({
          local,
          localQuality,
          localRows,
          config,
          requestState: "settled",
          requestError: null,
        });
      }
      return {
        rows,
        rowTimes: rows.map((row) => row.time),
        quality: remoteQuality || localQuality,
        availability: "ready",
        requestState: "settled",
        error: null,
        notice: noticeFor({
          availability: "ready",
          requestState: "settled",
          requestError: null,
          localQuality,
          remoteQuality,
          dataRange: config.dataRange,
          interval: config.interval,
        }),
      };
    }
  }

  // Calidad real + barras vacías/insuficientes → vuelve a localOutcome.
  return fallbackToLocal({
    local,
    localQuality,
    localRows,
    config,
    requestState: "settled",
    requestError: null,
  });
}

// Vuelve al outcome local preservando su posible blocked (Paso 6 / Paso 7).
function fallbackToLocal({ local, localQuality, localRows, config, requestState, requestError }) {
  if (local === "blocked") {
    return {
      rows: [],
      rowTimes: [],
      quality: localQuality,
      availability: "blocked",
      requestState,
      error: requestError,
      notice: noticeFor({
        availability: "blocked",
        requestState,
        requestError,
        localQuality,
        remoteQuality: null,
        dataRange: config.dataRange,
        interval: config.interval,
      }),
    };
  }
  if (local === "ready") {
    const { rows } = shapeRows(localRows, config.interval, config.dataRange);
    if (rows.length < 2) {
      return emptyResult({
        dataRange: config.dataRange,
        interval: config.interval,
        style: config.style,
        localQuality,
        remoteQuality: null,
        requestState,
        requestError,
      });
    }
    return {
      rows,
      rowTimes: rows.map((row) => row.time),
      quality: localQuality,
      availability: "ready",
      requestState,
      error: requestError,
      notice: noticeFor({
        availability: "ready",
        requestState,
        requestError,
        localQuality,
        remoteQuality: null,
        dataRange: config.dataRange,
        interval: config.interval,
      }),
    };
  }
  return emptyResult({
    dataRange: config.dataRange,
    interval: config.interval,
    style: config.style,
    localQuality,
    remoteQuality: null,
    requestState,
    requestError,
  });
}

// Export principal: el resolver de la matriz. La forma del output es la
// prometida por ADR §3.4.
export const chartDataModel = { resolve };

// Re-exports para tests y para el adaptador React del siguiente paso del ADR.
// Se reexporta la versión pública (alias canónico) de cada helper; las `Impl`
// internas no salen del módulo.
export {
  aggregateRowsImpl as aggregateRows,
  chartRangeRowsImpl as chartRangeRows,
  isIntradayInterval,
  normalizeChartInterval,
  normalizeRowsImpl as normalizeRows,
  shouldRequestRemoteBarsImpl as shouldRequestRemoteBars,
  timeFromBar,
  weekKey,
};

// Tabla de notices — expuesta para que los tests verifiquen la prioridad
// numérica y el copy exacto. NO se usa en runtime directamente.
export const NOTICE_PRIORITY = NOTICE_TABLE.map(({ priority, code, kind, copyTitle }) => ({
  priority,
  code,
  kind,
  copyTitle,
}));

// Constantes expuestas para que el adaptador React del siguiente paso no
// duplique la decisión de estilos. Línea/área nunca pasan por barsAreCandleGrade.
export { LINE_STYLES, STYLE_LINE, STYLE_AREA };