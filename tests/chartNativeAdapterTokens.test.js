import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createChartNativeAdapter,
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
// Panel del RS. Lo que se protege aquí es que el RS NO vuelva a compartir el
// eje del precio: si la serie se creara sin índice de panel (o con 0) volvería
// al panel del precio, que es el fallo que se está corrigiendo.

function rsAdapterHarness({ rsRatingSeries, rows }) {
  const priceScaleCalls = [];
  const addedSeries = [];
  const panes = [
    { setStretchFactor: vi.fn() },
    { setStretchFactor: vi.fn() },
  ];
  const makeSeries = () => ({
    setData: vi.fn(),
    priceScale: () => ({ applyOptions: vi.fn() }),
    createPriceLine: vi.fn(),
  });
  const mainSeries = makeSeries();
  const chart = {
    addSeries: vi.fn((definition, options, paneIndex) => {
      const series = addedSeries.length === 0 ? mainSeries : makeSeries();
      addedSeries.push({ definition, options, paneIndex, series });
      return series;
    }),
    applyOptions: vi.fn(),
    panes: vi.fn(() => panes),
    priceScale: vi.fn((id, paneIndex) => {
      const entry = { id, paneIndex, options: null };
      priceScaleCalls.push(entry);
      return { applyOptions: (options) => { entry.options = options; } };
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
      PriceScaleMode: { Normal: 0, Logarithmic: 1, Percentage: 2 },
    },
    profile: { priceScaleMargins: { top: 0.08, bottom: 0.08 }, timeScale: {}, timeFormatter: vi.fn() },
    config: {
      interval: "D",
      style: "1",
      scale: "price",
      indicators: { volume: false, maFast: false, maSlow: false, rsLine: true },
      intraday: false,
    },
    rows,
    rowTimes: rows.map((row) => row.time),
    colors,
    overrides: { rsRatingSeries },
  });
  return { result, addedSeries, priceScaleCalls, panes };
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

describe("chartNativeAdapter · panel del RS", () => {
  it("dibuja el RS en su propio panel, con escala fija 1-99 y eje visible", () => {
    const rows = dailyRows(120);
    // Un punto por semana, doce semanas: por encima del mínimo.
    const rsRatingSeries = Array.from({ length: 12 }, (_, index) => ({
      date: rows[index * 7].date,
      rsRating: 40 + index,
    }));

    const { result, addedSeries, priceScaleCalls, panes } = rsAdapterHarness({ rsRatingSeries, rows });

    const rsEntry = addedSeries.find((entry) => entry.options?.title === "RS");
    expect(rsEntry).toBeTruthy();
    // El panel: si esto fuera 0 o undefined, la línea volvería al eje del precio.
    expect(rsEntry.paneIndex).toBe(1);
    expect(rsEntry.options.color).toBe("#93B8CE"); // --traza, análisis
    // La etiqueta del último valor la pinta el eje del panel, con el RS.
    expect(rsEntry.options.lastValueVisible).toBe(true);
    expect(rsEntry.options.autoscaleInfoProvider()).toEqual({
      priceRange: { minValue: 1, maxValue: 99 },
    });
    // La serie principal sigue sin índice de panel: el precio no se movió.
    expect(addedSeries[0].paneIndex).toBeUndefined();

    const rsScale = priceScaleCalls.find((call) => call.paneIndex === 1);
    expect(rsScale.id).toBe("right");
    // autoScale sigue activo A PROPÓSITO: es lo que hace que se consulte el
    // autoscaleInfoProvider, y el provider devuelve siempre 1-99.
    expect(rsScale.options).toMatchObject({
      visible: true,
      autoScale: true,
      scaleMargins: { top: 0, bottom: 0 },
    });

    expect(panes[0].setStretchFactor).toHaveBeenCalledWith(4);
    expect(panes[1].setStretchFactor).toHaveBeenCalledWith(1);

    expect(result.rsPane).toMatchObject({ rendered: true, paneIndex: 1, weeks: 12, latestValue: 51 });
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
    expect(priceScaleCalls.some((call) => call.paneIndex === 1)).toBe(false);
    expect(result.rsPane).toMatchObject({ rendered: false, paneIndex: null, points: 2, weeks: 1 });
  });
});
