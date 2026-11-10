import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  chartReadoutText,
  createChartNativeAdapter,
  pointAtOrBefore,
  resolveCssTokensNative,
} from "@/app/chartNativeAdapter";

const EXPECTED_TOKENS = [
  ["soft", "--soft", "#B9BFB2"],
  ["humo", "--humo", "#7E8B82"],
  ["tiza", "--tiza", "#EDE8DA"],
  ["line", "--line", "rgba(237, 232, 218, .10)"],
  ["line2", "--line2", "rgba(237, 232, 218, .26)"],
  ["line3", "--line3", "rgba(237, 232, 218, .45)"],
  ["pizarra2", "--pizarra-2", "#2C4C39"],
  ["senal", "--senal", "#E0A93F"],
  ["traza", "--traza", "#93B8CE"],
  ["trazaDim", "--traza-dim", "rgba(147, 184, 206, .12)"],
  ["rsTheme", "--rs-theme", "#C4A5E8"],
];

const ROOT = fileURLToPath(new URL("..", import.meta.url));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("chartNativeAdapter · contrato de tokens CSS", () => {
  it("usa nombres existentes en tokens-v2.css y pasa nombre/fallback por separado", () => {
    const adapterSource = readFileSync(`${ROOT}/app/chartNativeAdapter.js`, "utf8");
    const tokensSource = readFileSync(`${ROOT}/styles/tokens-v2.css`, "utf8");

    for (const [key, token, fallback] of EXPECTED_TOKENS) {
      expect(tokensSource).toMatch(new RegExp(`${token.replace("-", "\\-")}\\s*:`));
      expect(adapterSource).toContain(`${key}: get("${token}", "${fallback}")`);
      expect(adapterSource).not.toContain(`get("${token}, ${fallback}")`);
    }
    expect(adapterSource).not.toMatch(/get\("--(?:ink|rule)-/);
  });

  it("devuelve los fallbacks originales cuando CSS no resuelve ningún token", () => {
    const getPropertyValue = vi.fn(() => "");
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", { documentElement: {} });
    vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue }));

    const colors = resolveCssTokensNative();

    expect(colors).toEqual(Object.fromEntries(EXPECTED_TOKENS.map(([key, , fallback]) => [key, fallback])));
    expect(getPropertyValue.mock.calls.map(([name]) => name)).toEqual(
      EXPECTED_TOKENS.map(([, token]) => token),
    );
  });

  it("aplica senal a los marcadores C1/C2/C3 en el adaptador nativo", () => {
    const mainSeries = {
      setData: vi.fn(),
      priceScale: () => ({ applyOptions: vi.fn() }),
      createPriceLine: vi.fn(),
    };
    const chart = {
      addSeries: vi.fn(() => mainSeries),
      applyOptions: vi.fn(),
      priceScale: () => ({ applyOptions: vi.fn() }),
    };
    const createSeriesMarkers = vi.fn();
    const rows = [
      { time: 1704067200, date: "2024-01-01", open: 10, high: 12, low: 9, close: 11, volume: 100 },
      { time: 1704153600, date: "2024-01-02", open: 11, high: 13, low: 10, close: 12, volume: 120 },
    ];
    const colors = Object.fromEntries(EXPECTED_TOKENS.map(([key, , fallback]) => [key, fallback]));

    const result = createChartNativeAdapter({
      container: { clientWidth: 640, offsetLeft: 0, offsetTop: 0 },
      lib: {
        AreaSeries: "area",
        CandlestickSeries: "candles",
        createChart: vi.fn(() => chart),
        createSeriesMarkers,
        HistogramSeries: "histogram",
        LineSeries: "line",
        PriceScaleMode: { Normal: 0, Logarithmic: 1, Percentage: 2 },
      },
      profile: { priceScaleMargins: { top: 0.08, bottom: 0.08 }, timeScale: {}, timeFormatter: vi.fn() },
      config: {
        interval: "D",
        style: "1",
        scale: "price",
        indicators: { volume: false, maFast: false, maSlow: false, rsLine: false },
        intraday: false,
      },
      rows,
      rowTimes: rows.map((row) => row.time),
      colors,
      overrides: {
        patternOverlay: { contractionSwings: [{ toDate: "2024-01-02" }] },
      },
    });

    expect(result.markerDescriptors).toEqual([
      expect.objectContaining({ text: "C1", color: "#E0A93F" }),
    ]);
    expect(createSeriesMarkers).toHaveBeenCalledWith(mainSeries, result.markerDescriptors);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Overlay del RS rating. Lo que se protege aquí es que el RS NO comparta el
// eje del precio ni vuelva a un panel inferior aparte: escala overlay dedicada
// con rango fijo 1-99 y banda inferior propia.

function rsAdapterHarness({ rsRatingSeries, rsCountrySeries, rsThemeSeries, indicators, rows }) {
  const priceScaleCalls = [];
  const addedSeries = [];
  const registeredPriceScaleIds = new Set();
  const makeSeries = () => ({
    setData: vi.fn(),
    priceScale: () => ({ applyOptions: vi.fn() }),
    createPriceLine: vi.fn(),
  });
  const mainSeries = makeSeries();
  const chart = {
    addSeries: vi.fn((definition, options, paneIndex) => {
      if (options?.priceScaleId) {
        registeredPriceScaleIds.add(options.priceScaleId);
      }
      const series = addedSeries.length === 0 ? mainSeries : makeSeries();
      addedSeries.push({ definition, options, paneIndex, series });
      return series;
    }),
    applyOptions: vi.fn(),
    priceScale: vi.fn((id, paneIndex) => {
      const entry = { id, paneIndex, options: null };
      priceScaleCalls.push(entry);
      return {
        applyOptions: (options) => {
          if (id && !registeredPriceScaleIds.has(id)) {
            throw new Error(`Trying to apply price scale options with incorrect ID: ${id}`);
          }
          entry.options = options;
        },
      };
    }),
  };
  const colors = Object.fromEntries(EXPECTED_TOKENS.map(([key, , fallback]) => [key, fallback]));
  const result = createChartNativeAdapter({
    container: { clientWidth: 900, offsetLeft: 0, offsetTop: 0 },
    lib: {
      AreaSeries: "area",
      CandlestickSeries: "candles",
      createChart: vi.fn(() => chart),
      createSeriesMarkers: vi.fn(),
      HistogramSeries: "histogram",
      LineSeries: "line",
      LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3, SparseDotted: 4 },
      PriceScaleMode: { Normal: 0, Logarithmic: 1, Percentage: 2 },
    },
    profile: { priceScaleMargins: { top: 0.08, bottom: 0.08 }, timeScale: {}, timeFormatter: vi.fn() },
    config: {
      interval: "D",
      style: "1",
      scale: "price",
      indicators: { volume: false, maFast: false, maSlow: false, rsLine: true, rsCountryLine: true, rsThemeLine: true, ...(indicators || {}) },
      intraday: false,
    },
    rows,
    rowTimes: rows.map((row) => row.time),
    colors,
    overrides: { rsRatingSeries, rsCountrySeries, rsThemeSeries },
  });
  return { result, addedSeries, priceScaleCalls };
}

function dailyRows(count) {
  const start = Date.UTC(2026, 0, 5) / 1000; // lunes
  return Array.from({ length: count }, (_, index) => {
    const time = start + index * 86400;
    return {
      time,
      date: new Date(time * 1000).toISOString().slice(0, 10),
      open: 10, high: 12, low: 9, close: 11, volume: 100,
    };
  });
}

describe("chartNativeAdapter · overlay del RS rating", () => {
  it("dibuja el RS como overlay en panel 0, escala rs-rating invisible y rango fijo 1-99", () => {
    const rows = dailyRows(120);
    // Un punto por semana, doce semanas: por encima del mínimo.
    const rsRatingSeries = Array.from({ length: 12 }, (_, index) => ({
      date: rows[index * 7].date,
      rsRating: 40 + index,
    }));

    const { result, addedSeries, priceScaleCalls } = rsAdapterHarness({ rsRatingSeries, rows });

    const rsEntry = addedSeries.find((entry) => entry.options?.title === "RS");
    expect(rsEntry).toBeTruthy();
    expect(rsEntry.paneIndex).toBe(0);
    expect(rsEntry.options.priceScaleId).toBe("rs-rating");
    expect(rsEntry.options.color).toBe("#93B8CE"); // --traza
    expect(rsEntry.options.lastValueVisible).toBe(true);
    expect(rsEntry.options.autoscaleInfoProvider()).toEqual({
      priceRange: { minValue: 1, maxValue: 99 },
    });
    // La serie principal no usa escala overlay.
    expect(addedSeries[0].options?.priceScaleId).toBeUndefined();

    const rsScale = priceScaleCalls.find((call) => call.id === "rs-rating");
    expect(rsScale).toBeTruthy();
    expect(rsScale.options).toMatchObject({
      visible: false,
      autoScale: true,
      // Banda propia 0,70→0,84: ni pisa el volumen (0,86→1) ni el precio
      // (0,08→0,68) — auditoría 2026-11, H7.
      scaleMargins: { top: 0.70, bottom: 0.16 },
    });
    // Sin panel inferior RS.
    expect(priceScaleCalls.some((call) => call.paneIndex === 1)).toBe(false);

    expect(result.rsPane).toMatchObject({ rendered: true, paneIndex: 0, weeks: 12, latestValue: 51 });
  });

  it("no dibuja nada cuando el histórico semanal no llega al mínimo", () => {
    const rows = dailyRows(120);
    // El caso real de producción: dos lecturas de la MISMA semana ISO. Unirlas
    // producía el segmento casi vertical del borde derecho.
    const rsRatingSeries = [
      { date: rows[100].date, rsRating: 80 },
      { date: rows[101].date, rsRating: 70 },
    ];

    const { result, addedSeries, priceScaleCalls } = rsAdapterHarness({ rsRatingSeries, rows });

    expect(addedSeries.some((entry) => entry.options?.title === "RS")).toBe(false);
    expect(priceScaleCalls.some((call) => call.id === "rs-rating")).toBe(false);
    expect(priceScaleCalls.some((call) => call.paneIndex === 1)).toBe(false);
    expect(result.rsPane).toMatchObject({ rendered: false, paneIndex: null, points: 2, weeks: 1 });
  });

  it("dibuja RS país como overlay en panel 0 con escala rs-rating compartida, tono --soft y trazo discontinuo", () => {
    const rows = dailyRows(120);
    const rsCountrySeries = Array.from({ length: 12 }, (_, index) => ({
      date: rows[index * 7].date,
      rsRating: 30 + index,
    }));

    const { result, addedSeries, priceScaleCalls } = rsAdapterHarness({
      rsRatingSeries: [],
      rsCountrySeries,
      indicators: { rsLine: false, rsCountryLine: true },
      rows,
    });

    const countryEntry = addedSeries.find((entry) => entry.options?.title === "RS país");
    expect(countryEntry).toBeTruthy();
    expect(countryEntry.paneIndex).toBe(0);
    expect(countryEntry.options.priceScaleId).toBe("rs-rating");
    expect(countryEntry.options.color).toBe("#B9BFB2"); // --soft
    expect(countryEntry.options.lineStyle).toBe(2); // Dashed
    expect(priceScaleCalls.filter((call) => call.id === "rs-rating")).toHaveLength(1);
    expect(priceScaleCalls.some((call) => call.id === "rs-country")).toBe(false);
    expect(result.rsCountryPane).toMatchObject({ rendered: true, paneIndex: 0, weeks: 12, latestValue: 41 });
  });

  it("dibuja RS tema como overlay en panel 0 con escala rs-rating compartida y tono --rs-theme", () => {
    const rows = dailyRows(120);
    const rsThemeSeries = Array.from({ length: 12 }, (_, index) => ({
      date: rows[index * 7].date,
      rsRating: 20 + index,
    }));

    const { result, addedSeries, priceScaleCalls } = rsAdapterHarness({
      rsRatingSeries: [],
      rsThemeSeries,
      indicators: { rsLine: false, rsCountryLine: false, rsThemeLine: true },
      rows,
    });

    const themeEntry = addedSeries.find((entry) => entry.options?.title === "RS tema");
    expect(themeEntry).toBeTruthy();
    expect(themeEntry.paneIndex).toBe(0);
    expect(themeEntry.options.priceScaleId).toBe("rs-rating");
    expect(themeEntry.options.color).toBe("#C4A5E8"); // --rs-theme
    expect(priceScaleCalls.filter((call) => call.id === "rs-rating")).toHaveLength(1);
    expect(priceScaleCalls.some((call) => call.id === "rs-theme")).toBe(false);
    expect(result.rsThemePane).toMatchObject({ rendered: true, paneIndex: 0, weeks: 12, latestValue: 31 });
  });

  it("comparte una sola escala rs-rating cuando global, país y tema están activos", () => {
    const rows = dailyRows(120);
    const makeSeries = (base) => Array.from({ length: 12 }, (_, index) => ({
      date: rows[index * 7].date,
      rsRating: base + index,
    }));

    const { addedSeries, priceScaleCalls } = rsAdapterHarness({
      rsRatingSeries: makeSeries(40),
      rsCountrySeries: makeSeries(30),
      rsThemeSeries: makeSeries(20),
      rows,
    });

    const rsEntries = addedSeries.filter((entry) => ["RS", "RS país", "RS tema"].includes(entry.options?.title));
    expect(rsEntries).toHaveLength(3);
    for (const entry of rsEntries) {
      expect(entry.options.priceScaleId).toBe("rs-rating");
      expect(entry.paneIndex).toBe(0);
    }
    expect(priceScaleCalls.filter((call) => call.id === "rs-rating")).toHaveLength(1);
    expect(priceScaleCalls.some((call) => call.id === "rs-country" || call.id === "rs-theme")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Auditoría del gráfico 2026-11: actualizar sin recrear (H22), lienzo limpio
// (H7, H29) y lectura bajo el cursor (H4).

function liveChartHarness() {
  const created = [];
  const removed = [];
  const scaleOptions = new Map();
  const registered = new Set([""]);
  let crosshairHandler = null;
  const makeSeries = (definition, options) => {
    const series = {
      definition,
      options: { ...(options || {}) },
      data: null,
      priceLines: [],
      setData: vi.fn((data) => { series.data = data; }),
      applyOptions: vi.fn((next) => { Object.assign(series.options, next); }),
      priceScale: () => ({ applyOptions: vi.fn() }),
      createPriceLine: vi.fn((line) => { series.priceLines.push(line); return line; }),
      removePriceLine: vi.fn((line) => { series.priceLines = series.priceLines.filter((item) => item !== line); }),
    };
    return series;
  };
  const chart = {
    addSeries: vi.fn((definition, options) => {
      if (options?.priceScaleId) registered.add(options.priceScaleId);
      const series = makeSeries(definition, options);
      created.push(series);
      return series;
    }),
    removeSeries: vi.fn((series) => { removed.push(series); }),
    applyOptions: vi.fn(),
    priceScale: vi.fn((id) => ({
      applyOptions: (options) => {
        if (id && !registered.has(id)) throw new Error(`incorrect ID: ${id}`);
        scaleOptions.set(id, options);
      },
    })),
    subscribeCrosshairMove: vi.fn((handler) => { crosshairHandler = handler; }),
    unsubscribeCrosshairMove: vi.fn(() => { crosshairHandler = null; }),
  };
  const createChart = vi.fn(() => chart);
  const lib = {
    AreaSeries: "area",
    CandlestickSeries: "candles",
    createChart,
    createSeriesMarkers: vi.fn(() => ({ setMarkers: vi.fn() })),
    HistogramSeries: "histogram",
    LineSeries: "line",
    LineStyle: { Solid: 0, Dotted: 1, Dashed: 2 },
    PriceScaleMode: { Normal: 0, Logarithmic: 1, Percentage: 2 },
  };
  const colors = Object.fromEntries(EXPECTED_TOKENS.map(([key, , fallback]) => [key, fallback]));
  const profile = {
    priceScaleMargins: { top: 0.08, bottom: 0.25 },
    timeScale: {},
    timeFormatter: (time) => `T${time}`,
  };
  return {
    chart, lib, colors, profile, created, removed, scaleOptions, createChart,
    hover: (param) => crosshairHandler?.(param),
  };
}

const BASE_INDICATORS = {
  volume: true, maFast: true, maFastLength: 3, maSlow: true, maSlowLength: 5,
  rsLine: true, rsCountryLine: false, rsThemeLine: false,
};

function weeklyRs(rows, weeks, base) {
  return Array.from({ length: weeks }, (_, index) => ({ date: rows[index * 7].date, rsRating: base + index }));
}

describe("chartNativeAdapter · auditoría 2026-11", () => {
  it("las medias no llevan etiqueta de último valor, línea de precio ni marcador de cursor", () => {
    const h = liveChartHarness();
    const rows = dailyRows(60);
    createChartNativeAdapter({
      container: { clientWidth: 900 }, lib: h.lib, profile: h.profile, colors: h.colors, rows,
      config: { interval: "D", style: "1", scale: "price", indicators: BASE_INDICATORS, intraday: false },
      overrides: {},
    });
    const mas = h.created.filter((series) => series.definition === "line" && !series.options.priceScaleId);
    expect(mas).toHaveLength(2);
    for (const ma of mas) {
      expect(ma.options).toMatchObject({ lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
    }
  });

  it("la línea ÷ benchmark está apagada por defecto y solo aparece con indicators.benchmarkLine", () => {
    const rows = dailyRows(60);
    const benchmarkSeries = rows.map((row, index) => ({ date: row.date, rsLine: 1 + index / 100 }));
    const off = liveChartHarness();
    createChartNativeAdapter({
      container: { clientWidth: 900 }, lib: off.lib, profile: off.profile, colors: off.colors, rows,
      config: { interval: "D", style: "1", scale: "price", indicators: BASE_INDICATORS, intraday: false },
      overrides: { benchmarkSeries },
    });
    expect(off.created.some((series) => series.options.priceScaleId === "benchmark-ratio")).toBe(false);

    const on = liveChartHarness();
    createChartNativeAdapter({
      container: { clientWidth: 900 }, lib: on.lib, profile: on.profile, colors: on.colors, rows,
      config: { interval: "D", style: "1", scale: "price", indicators: { ...BASE_INDICATORS, benchmarkLine: true }, intraday: false },
      overrides: { benchmarkSeries },
    });
    expect(on.created.some((series) => series.options.priceScaleId === "benchmark-ratio")).toBe(true);
  });

  it("con línea RS, precio, RS y volumen ocupan franjas que no se solapan", () => {
    const h = liveChartHarness();
    const rows = dailyRows(80);
    createChartNativeAdapter({
      container: { clientWidth: 900 }, lib: h.lib, profile: h.profile, colors: h.colors, rows,
      config: { interval: "D", style: "1", scale: "price", indicators: BASE_INDICATORS, intraday: false },
      overrides: { rsRatingSeries: weeklyRs(rows, 12, 40) },
    });
    const band = (margins) => [margins.top, 1 - margins.bottom];
    const rsBand = band(h.scaleOptions.get("rs-rating").scaleMargins);
    const volumeBand = band(h.scaleOptions.get("").scaleMargins);
    const lastPrice = h.chart.applyOptions.mock.calls.map(([o]) => o?.rightPriceScale?.scaleMargins).filter(Boolean).at(-1);
    const priceBand = band(lastPrice);
    expect(priceBand[1]).toBeLessThanOrEqual(rsBand[0]);
    expect(rsBand[1]).toBeLessThanOrEqual(volumeBand[0]);
  });

  it("update() cambia datos y rango sobre el MISMO chart: sin createChart ni series nuevas para lo que ya existe", () => {
    const h = liveChartHarness();
    const rows = dailyRows(120);
    const config = { interval: "D", style: "1", scale: "price", indicators: BASE_INDICATORS, intraday: false };
    const handle = createChartNativeAdapter({
      container: { clientWidth: 900 }, lib: h.lib, profile: h.profile, colors: h.colors, rows,
      config, overrides: { rsRatingSeries: weeklyRs(rows, 12, 40) },
    });
    const seriesBefore = h.created.length;
    const extraBefore = handle.extraSeries;
    const shorter = rows.slice(-100); // conserva 9 lecturas RS: la línea sigue
    handle.update({
      config: { ...config, dataRange: "3M", scale: "log" },
      rows: shorter,
      overrides: { rsRatingSeries: weeklyRs(rows, 12, 40) },
      profile: h.profile,
    });
    expect(h.createChart).toHaveBeenCalledTimes(1);
    expect(h.created.length).toBe(seriesBefore);
    expect(handle.extraSeries).toBe(extraBefore);
    expect(handle.mainSeries.data).toHaveLength(100);
    expect(handle.rsPane.rendered).toBe(true);
    // La escala log llega por applyOptions, sin recrear.
    expect(h.chart.applyOptions.mock.calls.some(([o]) => o?.rightPriceScale?.mode === 1)).toBe(true);
    // Una sola referencia 50 viva tras re-aplicar.
    const rs = h.created.find((series) => series.options.title === "RS");
    expect(rs.priceLines).toHaveLength(1);
  });

  it("update() retira la línea RS si en el nuevo rango no hay histórico suficiente, y la vuelve a crear si lo hay", () => {
    const h = liveChartHarness();
    const rows = dailyRows(120);
    const config = { interval: "D", style: "1", scale: "price", indicators: BASE_INDICATORS, intraday: false };
    const rsRatingSeries = weeklyRs(rows, 12, 40);
    const handle = createChartNativeAdapter({
      container: { clientWidth: 900 }, lib: h.lib, profile: h.profile, colors: h.colors, rows, config,
      overrides: { rsRatingSeries },
    });
    expect(handle.rsPane.rendered).toBe(true);
    handle.update({ config, rows: rows.slice(-15), overrides: { rsRatingSeries }, profile: h.profile });
    expect(handle.rsPane.rendered).toBe(false);
    expect(h.removed.some((series) => series.options.title === "RS")).toBe(true);
    handle.update({ config, rows, overrides: { rsRatingSeries }, profile: h.profile });
    expect(handle.rsPane.rendered).toBe(true);
    expect(h.createChart).toHaveBeenCalledTimes(1);
  });

  it("lectura bajo el cursor: fecha, cierre y RS vigente en esa fecha; vacía fuera del lienzo", () => {
    const h = liveChartHarness();
    const rows = dailyRows(80);
    const readouts = [];
    const rsRatingSeries = weeklyRs(rows, 12, 40);
    const handle = createChartNativeAdapter({
      container: { clientWidth: 900 }, lib: h.lib, profile: h.profile, colors: h.colors, rows,
      config: { interval: "D", style: "1", scale: "price", indicators: BASE_INDICATORS, intraday: false },
      overrides: { rsRatingSeries },
      onReadout: (text) => readouts.push(text),
    });
    const target = rows[23]; // entre la lectura 3 (fila 21) y la 4 (fila 28)
    const seriesData = new Map([[handle.mainSeries, { open: 10, high: 12, low: 9, close: 251.065 }]]);
    h.hover({ time: target.time, point: { x: 10, y: 10 }, seriesData });
    expect(readouts.at(-1)).toBe(`T${target.time} · C 251,07 · RS 43`);
    h.hover({ time: undefined, point: undefined, seriesData: new Map() });
    expect(readouts.at(-1)).toBe("");
  });

  it("chartReadoutText y pointAtOrBefore", () => {
    expect(chartReadoutText({ dateText: "16 abr 2026", close: 251.065, rs: 64.4 })).toBe("16 abr 2026 · C 251,07 · RS 64");
    expect(chartReadoutText({ dateText: "16 abr 2026", close: 251.065, rs: null })).toBe("16 abr 2026 · C 251,07");
    expect(chartReadoutText({ dateText: "16 abr 2026" })).toBe("");
    const points = [{ time: 10, value: 1 }, { time: 20, value: 2 }, { time: 30, value: 3 }];
    expect(pointAtOrBefore(points, 5)).toBeNull();
    expect(pointAtOrBefore(points, 20).value).toBe(2);
    expect(pointAtOrBefore(points, 29).value).toBe(2);
    expect(pointAtOrBefore(points, 99).value).toBe(3);
  });
});
