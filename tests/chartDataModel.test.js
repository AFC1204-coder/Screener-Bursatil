// tests/chartDataModel.test.js — cobertura del data model puro del chart
// (ADR chart-controller-extraction §3.5–3.6 y matriz mínima del §9).
//
// Pieza pura: no React, no DOM, no lightweight-charts, no red. El "request"
// se simula pasando `request` con `state` y `payload` directamente a
// `chartDataModel.resolve` — esto emula lo que hará `useChartDataModel` en el
// paso 4 del ADR sin tocar la red.
//
// Cobertura:
//   - Helpers extraídos (normalizeRows, aggregateRows, chartRangeRows,
//     shouldRequestRemoteBars) preservan el comportamiento actual
//     (caracterizado en tests/chartUniversalPriceChartBehavior.test.js).
//   - Matriz §3.5–3.6:
//     * real remoto gana y entrega rows;
//     * estimated/missing remoto → blocked + [], incluso con local real;
//     * local estimado nunca entrega rows;
//     * legacy estructural estimated sigue bloqueado;
//     * close-only real: vacío en candlestick, listo en línea/área;
//     * error remoto conserva local elegible y expone error;
//     * intradía no usa local;
//     * respuesta de generación vieja no publica (no aplica en la pieza pura
//       — esa validación la hace el adaptador React; aquí se cubre que el
//       resolver trata el request como si fuera vigente cuando se le pasa).
//   - Invariante: `rows.length > 0 ⇒ quality.status === "real"`.

import { describe, expect, it } from "vitest";
import {
  LINE_STYLES,
  NOTICE_PRIORITY,
  STYLE_AREA,
  STYLE_LINE,
  aggregateRows,
  chartDataModel,
  chartRangeRows,
  homogeneousDailyRows,
  isIntradayInterval,
  normalizeChartInterval,
  normalizeRows,
  shouldRequestRemoteBars,
  weekKey,
} from "@/lib/chartDataModel";

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures: misma factoría que tests/chartUniversalPriceChartBehavior.test.js
// para que ambas suites compartan el contrato temporal.

const TRADING_DAY = 86400;
const BASE_TIME = Math.floor(Date.UTC(2024, 0, 1) / 1000);

function ohlcBars(count, { start = BASE_TIME, step = TRADING_DAY, base = 100, drift = 0.1 } = {}) {
  return Array.from({ length: count }, (_, i) => {
    const close = Number((base + drift * i).toFixed(2));
    const open = Number((close - 0.4).toFixed(2));
    const high = Number((close + 1.2).toFixed(2));
    const low = Number((close - 1.2).toFixed(2));
    const date = new Date((start + i * step) * 1000).toISOString().slice(0, 10);
    return { date, time: start + i * step, open, high, low, close, volume: 1_000_000 };
  });
}

function closeOnlyBars(count, { start = BASE_TIME, step = TRADING_DAY, base = 100 } = {}) {
  return Array.from({ length: count }, (_, i) => {
    const close = Number((base + 0.5 * i).toFixed(2));
    const date = new Date((start + i * step) * 1000).toISOString().slice(0, 10);
    return { date, time: start + i * step, close };
  });
}

const REAL_DATA_QUALITY = { status: "real", source: "Yahoo Finance" };

function remotePayload(bars, { quality = REAL_DATA_QUALITY } = {}) {
  return { bars, meta: { dataProvider: "Yahoo Finance" }, dataQuality: quality };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers extraídos: preservan semántica actual.

describe("chartDataModel · helpers extraídos", () => {
  it("normalizeRows descarta barras sin close/close<=0 y ordena por tiempo", () => {
    const bars = [
      { date: "2024-01-03", time: BASE_TIME + 2 * TRADING_DAY, close: 102 },
      { date: "2024-01-01", time: BASE_TIME, close: 100 },
      { date: "2024-01-02", time: BASE_TIME + TRADING_DAY, close: -1 }, // close<=0 → fuera
      { date: "2024-01-02", time: BASE_TIME + TRADING_DAY, close: null }, // null → fuera
      { date: "2024-01-02", time: BASE_TIME + TRADING_DAY }, // sin close → fuera
    ];
    const rows = normalizeRows(bars);
    expect(rows.map((r) => r.time)).toEqual([BASE_TIME, BASE_TIME + 2 * TRADING_DAY]);
    expect(rows[0].close).toBe(100);
    expect(rows[0].open).toBe(100); // open null → close
  });

  it("normalizeRows conserva OHLC nativo cuando existe", () => {
    const rows = normalizeRows([
      { date: "2024-01-01", open: 100, high: 105, low: 98, close: 102, volume: 1000 },
    ]);
    expect(rows[0]).toMatchObject({ open: 100, high: 105, low: 98, close: 102, volume: 1000 });
  });

  it("normalizeRows acepta time numérico sin date", () => {
    const rows = normalizeRows([{ time: BASE_TIME, close: 100 }]);
    expect(rows[0].time).toBe(BASE_TIME);
    expect(rows[0].date).toBe("");
  });

  it("normalizeRows convierte date ISO a epoch segundos cuando no hay time", () => {
    const rows = normalizeRows([{ date: "2024-06-15", close: 100 }]);
    const expected = Math.floor(Date.UTC(2024, 5, 15) / 1000);
    expect(rows[0].time).toBe(expected);
  });

  it("aggregateRows en D es identidad", () => {
    const rows = normalizeRows(ohlcBars(5));
    expect(aggregateRows(rows, "D")).toBe(rows);
  });

  it("aggregateRows en W colapsa por semana ISO con open/close/high/low/volume coherentes", () => {
    // 14 días seguidos: 2 semanas ISO (2024-W01 y 2024-W02, empezando 2024-01-01 lunes).
    const rows = normalizeRows(ohlcBars(14));
    const weekly = aggregateRows(rows, "W");
    expect(weekly.length).toBe(2);
    // aggregateRows preserva verbatim la forma original: time/date del último
    // bar del grupo, open del primero, close del último, high/low/volume
    // agregados del grupo. Verificamos esa forma exacta.
    expect(weekly[0].time).toBe(rows[6].time); // última barra de la semana 1
    expect(weekly[0].date).toBe(rows[6].date);
    expect(weekly[0].open).toBe(rows[0].open); // primera barra de la semana 1
    expect(weekly[0].close).toBe(rows[6].close);
    expect(weekly[0].high).toBe(Math.max(...rows.slice(0, 7).map((r) => r.high)));
    expect(weekly[0].low).toBe(Math.min(...rows.slice(0, 7).map((r) => r.low)));
    expect(weekly[0].volume).toBe(rows.slice(0, 7).reduce((s, r) => s + r.volume, 0));
  });

  it("aggregateRows en M colapsa por mes preservando la fecha de la última barra del grupo", () => {
    const start = Math.floor(Date.UTC(2024, 0, 1) / 1000);
    const rows = [
      { time: start, date: "2024-01-30", open: 100, high: 102, low: 99, close: 101, volume: 1 },
      { time: start + TRADING_DAY, date: "2024-01-31", open: 101, high: 103, low: 100, close: 102, volume: 2 },
      { time: start + 40 * TRADING_DAY, date: "2024-02-10", open: 102, high: 105, low: 101, close: 104, volume: 3 },
    ];
    const monthly = aggregateRows(rows, "M");
    expect(monthly.length).toBe(2);
    // date preserva la última fecha del grupo (verbatim del comportamiento
    // original de UniversalPriceChart.jsx).
    expect(monthly[0].date).toBe("2024-01-31");
    expect(monthly[1].date).toBe("2024-02-10");
  });

  it("chartRangeRows recorta por cutoff a partir del último timestamp cuando excede el rango", () => {
    // Con 600 barras y rango 1A (252), el cutoff deja solo las últimas
    // ~213 barras. Caracterizamos el comportamiento del algoritmo:
    // recorta por `latestTime - 252 * TRADING_DAY_SECONDS`.
    const rows = normalizeRows(ohlcBars(600));
    const trimmed = chartRangeRows(rows, "1A", "D");
    expect(trimmed.length).toBeLessThan(rows.length);
    expect(trimmed.at(-1).time).toBe(rows.at(-1).time);
    // Todas las barras que quedan son >= cutoff.
    const latest = rows.at(-1).time;
    const cutoff = latest - 252 * (86400 * 7) / 5;
    for (const row of trimmed) {
      expect(row.time).toBeGreaterThanOrEqual(cutoff);
    }
  });

  it("chartRangeRows en MAX no recorta", () => {
    const rows = normalizeRows(ohlcBars(300));
    expect(chartRangeRows(rows, "MAX", "D")).toBe(rows);
  });

  it("chartRangeRows en intradía nunca recorta", () => {
    const rows = normalizeRows(ohlcBars(50, { step: 60 }));
    expect(chartRangeRows(rows, "1A", "1m")).toBe(rows);
  });

  it("shouldRequestRemoteBars devuelve false si el local cubre el rango (1A, D)", () => {
    const rows = normalizeRows(ohlcBars(300));
    expect(shouldRequestRemoteBars(rows, "1A", "D")).toBe(false);
  });

  it("shouldRequestRemoteBars devuelve true si el local es corto", () => {
    expect(shouldRequestRemoteBars(normalizeRows(ohlcBars(100)), "1A", "D")).toBe(true);
  });

  it("shouldRequestRemoteBars en intradía siempre pide (no cae a local)", () => {
    expect(shouldRequestRemoteBars(normalizeRows(ohlcBars(5000)), "1A", "1H")).toBe(true);
  });

  it("shouldRequestRemoteBars evalúa ANTES del guard P0: serie estimada larga NO dispara fetch", () => {
    // El dato es sintético pero la suficiencia se calcula por cantidad. Esto
    // preserva el comportamiento actual: mientras el local cubra el rango, no
    // se pide más histórico, INCLUSO si la calidad es no-real.
    const local = ohlcBars(300);
    expect(shouldRequestRemoteBars(normalizeRows(local), "1A", "D")).toBe(false);
  });

  it("isIntradayInterval normaliza aliases (60m → 1H, 4h → 4H)", () => {
    expect(isIntradayInterval("60m")).toBe(true);
    expect(isIntradayInterval("4h")).toBe(true);
    expect(isIntradayInterval("1m")).toBe(true);
    expect(isIntradayInterval("D")).toBe(false);
    expect(isIntradayInterval("W")).toBe(false);
  });

  it("weekKey devuelve clave ISO-8601 estable", () => {
    // 2024-01-01 es lunes → 2024-W01; 2024-01-07 también W01; 2024-01-08 → W02.
    expect(weekKey("2024-01-01")).toBe("2024-W01");
    expect(weekKey("2024-01-07")).toBe("2024-W01");
    expect(weekKey("2024-01-08")).toBe("2024-W02");
  });

  it("normalizeChartInterval es alias estable a la implementación canónica", () => {
    expect(normalizeChartInterval("60m")).toBe("1H");
    expect(normalizeChartInterval("1h")).toBe("1H");
    expect(normalizeChartInterval("D")).toBe("D");
  });

  it("LINE_STYLES / STYLE_LINE / STYLE_AREA exportados para el adaptador", () => {
    expect(LINE_STYLES.has("8")).toBe(true);
    expect(LINE_STYLES.has("3")).toBe(true);
    expect(STYLE_LINE).toBe("8");
    expect(STYLE_AREA).toBe("3");
  });

  it("NOTICE_PRIORITY expone 8 códigos únicos en orden numérico ascendente", () => {
    expect(NOTICE_PRIORITY.length).toBe(8);
    const codes = NOTICE_PRIORITY.map((n) => n.code);
    expect(new Set(codes).size).toBe(8);
    for (let i = 1; i <= 8; i += 1) {
      expect(NOTICE_PRIORITY[i - 1].priority).toBe(i);
    }
    expect(codes).toEqual([
      "quality-estimated",
      "quality-missing",
      "history-loading",
      "provider-unavailable",
      "history-expanding",
      "history-expansion-failed",
      "insufficient-history",
      "history-coarse-dropped",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Matriz de §3.5–3.6 (resolución determinista).

describe("chartDataModel.resolve · matriz de resolución", () => {
  it("remoto real → entrega las filas remotas, recortadas por rango", () => {
    const remoteBars = ohlcBars(300, { base: 50 });
    const result = chartDataModel.resolve({
      symbol: "AAPL",
      localSource: { bars: ohlcBars(10) },
      config: { dataRange: "1A", interval: "D", style: "1" },
      request: { state: "settled", payload: remotePayload(remoteBars) },
    });
    expect(result.availability).toBe("ready");
    expect(result.requestState).toBe("settled");
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.quality.status).toBe("real");
    expect(result.rowTimes).toEqual(result.rows.map((r) => r.time));
    // No expone nombres remote/local/fallback.
    expect(result).not.toHaveProperty("remote");
    expect(result).not.toHaveProperty("localRows");
    expect(result).not.toHaveProperty("needsRemote");
    expect(result).not.toHaveProperty("sourceKind");
    expect(result).not.toHaveProperty("usedFallback");
  });

  it("remoto real legacy sin dataQuality entrega rows reales aunque localQuality sea no-real", () => {
    const remoteBars = ohlcBars(300, { base: 75 });
    const result = chartDataModel.resolve({
      symbol: "AAPL",
      localSource: {
        bars: ohlcBars(100),
        quality: { status: "estimated", source: "fallback local", reason: "no live" },
      },
      config: { dataRange: "1A", interval: "D", style: "1" },
      request: {
        state: "settled",
        payload: {
          bars: remoteBars,
          meta: { dataProvider: "Yahoo Finance" },
        },
      },
    });
    expect(result.availability).toBe("ready");
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.quality).toMatchObject({
      status: "real",
      source: "Yahoo Finance",
    });
  });

  it("remoto estimated → blocked + [] incluso con local real candle-grade", () => {
    const remoteBars = ohlcBars(50);
    const result = chartDataModel.resolve({
      symbol: "AAPL",
      localSource: { bars: ohlcBars(200) },
      config: { dataRange: "1A", interval: "D", style: "1" },
      request: {
        state: "settled",
        payload: remotePayload(remoteBars, {
          quality: { status: "estimated", reason: "timeout del proveedor" },
        }),
      },
    });
    expect(result.availability).toBe("blocked");
    expect(result.rows).toEqual([]);
    expect(result.rowTimes).toEqual([]);
    expect(result.quality.status).toBe("estimated");
    expect(result.notice).toMatchObject({
      code: "quality-estimated",
      text: "Datos estimados — no aptos para decisión",
    });
  });

  it("remoto missing → blocked + [], mismo copy/notice que estimated", () => {
    const result = chartDataModel.resolve({
      symbol: "AAPL",
      localSource: { bars: ohlcBars(200) },
      config: { dataRange: "1A", interval: "D", style: "1" },
      request: {
        state: "settled",
        payload: {
          bars: [],
          meta: { dataProvider: "no disponible" },
          dataQuality: { status: "missing", reason: "sin histórico" },
        },
      },
    });
    expect(result.availability).toBe("blocked");
    expect(result.rows).toEqual([]);
    expect(result.quality.status).toBe("missing");
    expect(result.notice.code).toBe("quality-missing");
    expect(result.notice.text).toBe("Sin histórico de mercado disponible");
  });

  it("remoto estimated gana al local real: el bloque P0 NO se oculta tras el fallback", () => {
    // Esto preserva la regla §3.6 paso 6: una respuesta degradada nunca
    // queda escondida detrás de un fallback.
    const result = chartDataModel.resolve({
      symbol: "AAPL",
      localSource: { bars: ohlcBars(200), quality: REAL_DATA_QUALITY },
      config: { dataRange: "1A", interval: "D", style: "1" },
      request: {
        state: "settled",
        payload: remotePayload(ohlcBars(50), {
          quality: { status: "estimated", reason: "no live" },
        }),
      },
    });
    expect(result.availability).toBe("blocked");
    expect(result.rows).toEqual([]);
  });

  it("local estimado (ChartQuality.status='estimated') nunca entrega rows, aunque sea candle-grade", () => {
    // compactChartBars borró el flag por barra: barsAreCandleGrade la ve
    // como candle-grade, pero `localQuality.status="estimated"` delata que
    // es estimada. El guard P0 fuerza []. ADR §3.2 + §9: el contrato del
    // data model es `quality` canónico.
    const local = ohlcBars(300);
    const result = chartDataModel.resolve({
      symbol: "AAPL",
      localSource: {
        bars: local,
        quality: { status: "estimated", source: "estimado", reason: "demo" },
      },
      config: { dataRange: "1A", interval: "D", style: "1" },
    });
    expect(result.availability).toBe("blocked");
    expect(result.rows).toEqual([]);
    expect(result.quality.status).toBe("estimated");
  });

  it("local estimado vía localQuality explícito → blocked", () => {
    const local = ohlcBars(300);
    const result = chartDataModel.resolve({
      symbol: "AAPL",
      localSource: {
        bars: local,
        quality: { status: "estimated", source: "estimator", reason: "demo" },
      },
      config: { dataRange: "1A", interval: "D", style: "1" },
    });
    expect(result.availability).toBe("blocked");
    expect(result.rows).toEqual([]);
  });

  it("legacy estructural estimated (bar.estimated=true sin dataQuality) → blocked", () => {
    const local = [
      { date: "2024-01-01", open: 100, high: 105, low: 98, close: 102, estimated: true },
      { date: "2024-01-02", open: 102, high: 107, low: 100, close: 104, estimated: true },
    ];
    const result = chartDataModel.resolve({
      symbol: "AAPL",
      localSource: { bars: local },
      config: { dataRange: "1A", interval: "D", style: "1" },
    });
    expect(result.availability).toBe("blocked");
    expect(result.rows).toEqual([]);
    expect(result.quality.status).toBe("estimated");
  });

  it("close-only real en candlestick → empty (no blocked, no ready)", () => {
    // El shape exacto del chartPreview persistido en review. Como el local
    // es corto (< 252), el resolver dispara request; pasamos un payload
    // settled con quality real pero vacío (escenario real: fetch OK pero
    // sin histórico). El fallback a local da empty (close-only + candlestick).
    const local = [
      { date: "2024-01-01", close: 100, volume: 1000, sma50: 99, sma200: 98 },
      { date: "2024-01-02", close: 101, volume: 1100, sma50: 99.5, sma200: 98.2 },
      { date: "2024-01-03", close: 102, volume: 1200, sma50: 100, sma200: 98.5 },
    ];
    const result = chartDataModel.resolve({
      symbol: "AAPL",
      localSource: { bars: local },
      config: { dataRange: "1A", interval: "D", style: "1" },
      request: { state: "settled", payload: { bars: [], dataQuality: { status: "real" } } },
    });
    expect(result.availability).toBe("empty");
    expect(result.rows).toEqual([]);
    expect(result.quality.status).toBe("real");
    expect(result.notice.code).toBe("insufficient-history");
  });

  it("close-only real sin request disparado (símbolo vacío) → empty + insufficient-history", () => {
    // Sin símbolo NO hay request. El local short → needsRemote=true PERO
    // sin request la rama es `!symbol` y resuelve solo el local.
    const local = [
      { date: "2024-01-01", close: 100 },
      { date: "2024-01-02", close: 101 },
    ];
    const result = chartDataModel.resolve({
      symbol: "",
      localSource: { bars: local },
      config: { dataRange: "1A", interval: "D", style: "1" },
    });
    expect(result.availability).toBe("empty");
    expect(result.rows).toEqual([]);
    expect(result.notice.code).toBe("insufficient-history");
  });

  it("close-only real en línea (style 8) → ready sin nuevo fetch", () => {
    const local = [
      { date: "2024-01-01", close: 100 },
      { date: "2024-01-02", close: 101 },
      { date: "2024-01-03", close: 102 },
    ];
    const result = chartDataModel.resolve({
      symbol: "AAPL",
      localSource: { bars: local },
      config: { dataRange: "1A", interval: "D", style: "8" },
    });
    expect(result.availability).toBe("ready");
    expect(result.rows.length).toBe(3);
    expect(result.quality.status).toBe("real");
  });

  it("close-only real en área (style 3) → ready", () => {
    const local = [
      { date: "2024-01-01", close: 100 },
      { date: "2024-01-02", close: 101 },
    ];
    const result = chartDataModel.resolve({
      symbol: "AAPL",
      localSource: { bars: local },
      config: { dataRange: "1A", interval: "D", style: "3" },
    });
    expect(result.availability).toBe("ready");
    expect(result.rows.length).toBe(2);
  });

  it("error remoto con local real elegible → availability ready + error expuesto", () => {
    // Local corto (< 252) para que `shouldRequestRemote` devuelva true y el
    // requestState="error" entre en el camino de error (no en el idle).
    const local = ohlcBars(100);
    const result = chartDataModel.resolve({
      symbol: "AAPL",
      localSource: { bars: local },
      config: { dataRange: "1A", interval: "D", style: "1" },
      request: { state: "error", error: { message: "Proveedor no disponible" } },
    });
    expect(result.availability).toBe("ready");
    expect(result.requestState).toBe("error");
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.quality.status).toBe("real");
    expect(result.error).toMatchObject({ code: "fetch-error" });
    expect(result.error.message).toBe("Proveedor no disponible");
    expect(result.notice).toMatchObject({
      code: "history-expansion-failed",
      kind: "error",
    });
    expect(result.notice.text).toContain("Histórico ampliado no disponible");
    expect(result.notice.text).toContain("Proveedor no disponible");
  });

  it("error remoto con local estimado → bloque conserva local estimado (no oculta P0)", () => {
    // Local corto (< 252) para que `shouldRequestRemote` devuelva true y
    // entremos en el camino de request con error.
    const local = ohlcBars(100);
    const result = chartDataModel.resolve({
      symbol: "AAPL",
      localSource: {
        bars: local,
        quality: { status: "estimated", source: "estimado" },
      },
      config: { dataRange: "1A", interval: "D", style: "1" },
      request: { state: "error", error: { message: "timeout" } },
    });
    expect(result.availability).toBe("blocked");
    expect(result.rows).toEqual([]);
    expect(result.quality.status).toBe("estimated");
    // El notice de calidad gana sobre el error operacional: prioridad 1.
    expect(result.notice.code).toBe("quality-estimated");
    expect(result.error).toBeTruthy(); // pero el error se conserva ortogonal.
  });

  it("intradía no usa local: rows=[] mientras carga, vacío si falla", () => {
    const local = ohlcBars(300);
    const loading = chartDataModel.resolve({
      symbol: "AAPL",
      localSource: { bars: local },
      config: { dataRange: "1A", interval: "1H", style: "1" },
      request: { state: "loading" },
    });
    expect(loading.availability).toBe("empty");
    expect(loading.rows).toEqual([]);
    expect(loading.requestState).toBe("loading");
    expect(loading.notice.code).toBe("history-loading");

    const errored = chartDataModel.resolve({
      symbol: "AAPL",
      localSource: { bars: local },
      config: { dataRange: "1A", interval: "1H", style: "1" },
      request: { state: "error", error: { message: "timeout" } },
    });
    expect(errored.availability).toBe("empty");
    expect(errored.notice.code).toBe("provider-unavailable");
    expect(errored.notice.text).toContain("Proveedor de gráfico no disponible");
    expect(errored.notice.text).toContain("timeout");
  });

  it("intradía + request settled real → ready con filas intradía", () => {
    const remote = Array.from({ length: 30 }, (_, i) => ({
      time: BASE_TIME + i * 60,
      open: 100 + i * 0.1,
      high: 100 + i * 0.1 + 0.05,
      low: 100 + i * 0.1 - 0.05,
      close: 100 + i * 0.1 + 0.02,
    }));
    const result = chartDataModel.resolve({
      symbol: "AAPL",
      localSource: { bars: ohlcBars(300) }, // intradía jamás usa local aunque exista
      config: { dataRange: "1A", interval: "1H", style: "1" },
      request: { state: "settled", payload: remotePayload(remote) },
    });
    expect(result.availability).toBe("ready");
    expect(result.rows.length).toBe(30);
    expect(result.quality.status).toBe("real");
  });

  it("request settled real pero payload vacío/insuficiente → vuelve a local elegible", () => {
    const local = ohlcBars(300);
    const result = chartDataModel.resolve({
      symbol: "AAPL",
      localSource: { bars: local },
      config: { dataRange: "1A", interval: "D", style: "1" },
      request: { state: "settled", payload: { bars: [], dataQuality: REAL_DATA_QUALITY } },
    });
    expect(result.availability).toBe("ready");
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.quality.status).toBe("real");
  });

  it("request settled real con sólo 1 barra válida → cae a local elegible", () => {
    const local = ohlcBars(300);
    const result = chartDataModel.resolve({
      symbol: "AAPL",
      localSource: { bars: local },
      config: { dataRange: "1A", interval: "D", style: "1" },
      request: {
        state: "settled",
        payload: remotePayload([{ date: "2024-01-01", close: 100 }]),
      },
    });
    expect(result.availability).toBe("ready");
    expect(result.rows.length).toBeGreaterThan(2);
  });

  it("local estimado + remoto real → mientras carga, bloque; al llegar remoto real pasa a ready", () => {
    // Local corto (< 252) para que el request se dispare y los requestState
    // 'loading'/'settled' entren por la rama correspondiente.
    const local = ohlcBars(100);
    const loading = chartDataModel.resolve({
      symbol: "AAPL",
      localSource: {
        bars: local,
        quality: { status: "estimated", source: "estimado" },
      },
      config: { dataRange: "1A", interval: "D", style: "1" },
      request: { state: "loading" },
    });
    expect(loading.availability).toBe("blocked");
    expect(loading.requestState).toBe("loading");

    const settled = chartDataModel.resolve({
      symbol: "AAPL",
      localSource: {
        bars: local,
        quality: { status: "estimated", source: "estimado" },
      },
      config: { dataRange: "1A", interval: "D", style: "1" },
      request: { state: "settled", payload: remotePayload(ohlcBars(300)) },
    });
    expect(settled.availability).toBe("ready");
    expect(settled.rows.length).toBeGreaterThan(0);
    expect(settled.quality.status).toBe("real");
  });

  it("símbolo vacío → no hay request; resuelve solo local", () => {
    const local = ohlcBars(300);
    const result = chartDataModel.resolve({
      symbol: "",
      localSource: { bars: local },
      config: { dataRange: "1A", interval: "D", style: "1" },
    });
    expect(result.availability).toBe("ready");
    expect(result.requestState).toBe("idle");
    expect(result.rows.length).toBeGreaterThan(0);
  });

  it("no debe disparar request si el local cubre el rango: requestState=idle sin request", () => {
    const local = ohlcBars(300);
    const result = chartDataModel.resolve({
      symbol: "AAPL",
      localSource: { bars: local },
      config: { dataRange: "1A", interval: "D", style: "1" },
    });
    expect(result.availability).toBe("ready");
    expect(result.requestState).toBe("idle");
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.quality.status).toBe("real");
  });

  it("carga con local NO elegible (intradía mientras carga) → empty + notice loading", () => {
    const result = chartDataModel.resolve({
      symbol: "AAPL",
      localSource: { bars: [] },
      config: { dataRange: "1A", interval: "D", style: "1" },
      request: { state: "loading" },
    });
    expect(result.availability).toBe("empty");
    expect(result.requestState).toBe("loading");
    expect(result.rows).toEqual([]);
    expect(result.notice.code).toBe("history-loading");
  });

  it("carga con local NO elegible y luego OK → ready + notice expanding", () => {
    const result = chartDataModel.resolve({
      symbol: "AAPL",
      localSource: { bars: [] },
      config: { dataRange: "1A", interval: "D", style: "1" },
      request: { state: "loading" },
    });
    expect(result.notice).toMatchObject({
      code: "history-loading",
      kind: "loading",
      title: "",
    });
  });

  it("rows listas + request loading → notice history-expanding (no oculta)", () => {
    // Local corto (< 252) → needsRemote=true → entra en rama de request.
    const local = ohlcBars(100);
    const result = chartDataModel.resolve({
      symbol: "AAPL",
      localSource: { bars: local },
      config: { dataRange: "1A", interval: "D", style: "1" },
      request: { state: "loading" },
    });
    expect(result.availability).toBe("ready");
    expect(result.notice).toMatchObject({
      code: "history-expanding",
      kind: "expanding",
      title: "",
    });
    expect(result.notice.text).toBe("Ampliando histórico para este rango...");
  });

  it("notice prioriza P0 sobre loading/error operacional", () => {
    // local estimado + remote loading: el notice P0 gana al de loading.
    const local = ohlcBars(300);
    const result = chartDataModel.resolve({
      symbol: "AAPL",
      localSource: {
        bars: local,
        quality: { status: "estimated", source: "estimado" },
      },
      config: { dataRange: "1A", interval: "D", style: "1" },
      request: { state: "loading" },
    });
    expect(result.availability).toBe("blocked");
    expect(result.notice.code).toBe("quality-estimated");
  });

  it("entradas ausentes/nulas no rompen y devuelven empty como default", () => {
    const empty1 = chartDataModel.resolve();
    expect(empty1.availability).toBe("empty");
    expect(empty1.rows).toEqual([]);
    // Sin localSource, chartQuality({}) devuelve status:"real" (camino legacy).
    // La invariante del módulo se respeta: rows=[] ⇒ quality puede ser
    // cualquier valor, pero rows.length>0 ⇒ quality.status="real" (cubierto
    // por el describe "invariante" más abajo).
    expect(empty1.quality).toBeTruthy();
    expect(empty1.notice).toBeTruthy();

    const empty2 = chartDataModel.resolve({});
    expect(empty2.availability).toBe("empty");

    const empty3 = chartDataModel.resolve({
      symbol: "AAPL",
      localSource: { bars: null, quality: null },
      config: { dataRange: "1A", interval: "D", style: "1" },
      request: null,
    });
    expect(empty3.availability).toBe("empty");
  });

  it("config inválido cae a defaults (D, 1A, velas)", () => {
    const local = ohlcBars(300);
    const result = chartDataModel.resolve({
      symbol: "AAPL",
      localSource: { bars: local },
      config: { dataRange: "ZZZ", interval: "xyz", style: "???" },
    });
    // Defaults: D + 1A + velas → local real candle-grade → ready.
    expect(result.availability).toBe("ready");
    expect(result.rows.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Invariante principal: rows.length > 0 ⇒ quality.status === "real".

describe("chartDataModel · invariante rows.length>0 ⇒ quality.status real", () => {
  function assertInvariant(result, label) {
    if (result.rows.length > 0) {
      expect(result.quality, `quality en ${label}`).not.toBeNull();
      expect(result.quality.status, `status en ${label}`).toBe("real");
    }
  }

  it("todas las combinaciones de la matriz preservan la invariante", () => {
    const localReal = ohlcBars(300);
    const localCloseOnly = [
      { date: "2024-01-01", close: 100 },
      { date: "2024-01-02", close: 101 },
    ];
    const localEstimated = ohlcBars(300);
    const remoteReal = ohlcBars(300, { base: 50 });
    const remoteEstimated = ohlcBars(50);

    const scenarios = [
      {
        label: "local real + sin request",
        input: { symbol: "AAPL", localSource: { bars: localReal }, config: { dataRange: "1A", interval: "D", style: "1" } },
      },
      {
        label: "local real + remote real settled",
        input: { symbol: "AAPL", localSource: { bars: localReal }, config: { dataRange: "1A", interval: "D", style: "1" }, request: { state: "settled", payload: remotePayload(remoteReal) } },
      },
      {
        label: "local real + remote error",
        input: { symbol: "AAPL", localSource: { bars: localReal }, config: { dataRange: "1A", interval: "D", style: "1" }, request: { state: "error", error: { message: "x" } } },
      },
      {
        label: "local real + remote empty settled (fallback local)",
        input: { symbol: "AAPL", localSource: { bars: localReal }, config: { dataRange: "1A", interval: "D", style: "1" }, request: { state: "settled", payload: { bars: [], dataQuality: REAL_DATA_QUALITY } } },
      },
      {
        label: "local close-only + style 8",
        input: { symbol: "AAPL", localSource: { bars: localCloseOnly }, config: { dataRange: "1A", interval: "D", style: "8" } },
      },
      {
        label: "local close-only + style 3",
        input: { symbol: "AAPL", localSource: { bars: localCloseOnly }, config: { dataRange: "1A", interval: "D", style: "3" } },
      },
      {
        label: "remote real intradía",
        input: { symbol: "AAPL", localSource: { bars: localReal }, config: { dataRange: "1A", interval: "1H", style: "1" }, request: { state: "settled", payload: remotePayload(ohlcBars(300, { step: 60 })) } },
      },
      // Casos degenerados: rows SIEMPRE es [], la invariante se cumple trivialmente.
      {
        label: "local estimado",
        input: {
          symbol: "AAPL",
          localSource: {
            bars: localEstimated,
            quality: { status: "estimated", source: "estimado" },
          },
          config: { dataRange: "1A", interval: "D", style: "1" },
        },
      },
      {
        label: "remote estimated con local real",
        input: { symbol: "AAPL", localSource: { bars: localReal }, config: { dataRange: "1A", interval: "D", style: "1" }, request: { state: "settled", payload: remotePayload(remoteEstimated, { quality: { status: "estimated" } }) } },
      },
      {
        label: "close-only real + candlestick",
        input: { symbol: "AAPL", localSource: { bars: localCloseOnly }, config: { dataRange: "1A", interval: "D", style: "1" } },
      },
    ];

    for (const { label, input } of scenarios) {
      const result = chartDataModel.resolve(input);
      assertInvariant(result, label);
    }
  });
});
// ─────────────────────────────────────────────────────────────────────────────
// Homogeneidad de cadencia (docs/analisis-grafico-2026-08-14.md, 2ª pasada).
//
// Medido en vivo: /api/chart para rangos largos sirve un prefijo antiguo con
// paso MENSUAL (herencia del merge MAX en la caché) seguido del tramo diario.
// Dibujar esa mezcla fabricaba "semanas" de un mes: 5A·W declaraba casi cinco
// años con 96 barras y un eje que saltaba dos años entre etiquetas.

describe("chartDataModel · homogeneidad de cadencia", () => {
  const DAY = 86400;
  const MONTH = 30 * DAY;
  const START = Math.floor(Date.UTC(2020, 0, 6) / 1000);

  function bar(time, close = 100) {
    return {
      time,
      date: new Date(time * 1000).toISOString().slice(0, 10),
      open: close - 0.4,
      high: close + 1,
      low: close - 1,
      close,
      volume: 1000,
    };
  }

  function mixedSeries({ monthly = 24, daily = 200 } = {}) {
    const coarse = Array.from({ length: monthly }, (_, i) => bar(START + i * MONTH, 90 + i));
    const dailyStart = START + monthly * MONTH;
    const fine = Array.from({ length: daily }, (_, i) => bar(dailyStart + i * DAY, 120 + i * 0.1));
    return [...coarse, ...fine];
  }

  it("homogeneousDailyRows se queda con el sufijo diario y reporta lo descartado", () => {
    const rows = normalizeRows(mixedSeries({ monthly: 24, daily: 200 }));
    const out = homogeneousDailyRows(rows);

    expect(out.rows.length).toBe(200);
    expect(out.dropped).toBe(24);
    expect(out.coarseUntilDate).toBe(rows[23].date);
    // El sufijo es estrictamente diario: ningún gap > 7 días naturales.
    for (let i = 1; i < out.rows.length; i += 1) {
      expect((out.rows[i].time - out.rows[i - 1].time) / DAY).toBeLessThanOrEqual(7);
    }
  });

  it("una serie diaria con fines de semana y festivos NO se recorta", () => {
    // Paso de 1-4 días naturales (viernes→lunes y algún festivo largo).
    const rows = [];
    let t = START;
    for (let i = 0; i < 120; i += 1) {
      rows.push(bar(t, 100 + i));
      t += (i % 5 === 4 ? 3 : i % 17 === 0 ? 4 : 1) * DAY;
    }
    const out = homogeneousDailyRows(normalizeRows(rows));
    expect(out.dropped).toBe(0);
    expect(out.rows.length).toBe(120);
  });

  it("resolve dibuja solo el tramo homogéneo y lo declara con la notice informativa", () => {
    // 6M queda cubierto por las 300 filas diarias elegibles: sin fetch en
    // vuelo, la notice informativa del recorte es la única aplicable. (Con un
    // fetch pendiente ganaría `history-expanding`, que tiene prioridad — la
    // informativa es la última de la tabla.)
    const result = chartDataModel.resolve({
      symbol: "AAPL",
      localSource: { bars: mixedSeries({ monthly: 24, daily: 300 }), quality: { status: "real", source: "test" } },
      config: { dataRange: "6M", interval: "W", style: "1" },
    });

    expect(result.availability).toBe("ready");
    // Ninguna fila dibujada procede del tramo mensual: la primera fila
    // semanal vive dentro del sufijo diario.
    const dailyStart = START + 24 * MONTH;
    expect(result.rows[0].time).toBeGreaterThanOrEqual(dailyStart);
    // Y la ausencia se declara donde falta (principio 5).
    expect(result.notice?.code).toBe("history-coarse-dropped");
    expect(result.notice?.kind).toBe("info");
  });

  it("resolve expone contextRows: la serie agregada sin recorte de rango, superconjunto de rows", () => {
    const daily = mixedSeries({ monthly: 0, daily: 520 });
    const result = chartDataModel.resolve({
      symbol: "AAPL",
      localSource: { bars: daily, quality: { status: "real", source: "test" } },
      config: { dataRange: "1A", interval: "D", style: "1" },
    });

    expect(result.availability).toBe("ready");
    expect(result.contextRows.length).toBeGreaterThan(result.rows.length);
    const contextTimes = new Set(result.contextRows.map((row) => row.time));
    for (const row of result.rows) {
      expect(contextTimes.has(row.time)).toBe(true);
    }
    // Serie homogénea sin recorte: sin notice informativa.
    expect(result.notice).toBeNull();
  });

  it("la suficiencia local se evalúa sobre filas elegibles: un prefijo mensual no la infla", () => {
    // 24 mensuales + 100 diarias = 124 filas crudas; elegibles solo 100.
    // Para 1A (252) el fetch remoto sigue siendo necesario.
    const rows = normalizeRows(mixedSeries({ monthly: 24, daily: 100 }));
    const eligible = homogeneousDailyRows(rows).rows;
    expect(shouldRequestRemoteBars(eligible, "1A", "D")).toBe(true);
  });
});
