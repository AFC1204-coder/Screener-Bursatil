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
