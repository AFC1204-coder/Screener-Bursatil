// fetchYahooFullHistoryChart (rango «Max»): period1=0 + intervalo 1wk/1mo,
// y la granularidad declarada por Yahoo debe coincidir con la pedida.
// También cubre el helper de barras compartido con fetchYahooChartDirect.
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchYahooChart, fetchYahooFullHistoryChart } from "@/lib/yahoo";

function yahooResponse({ granularity = "1wk", count = 30, step = 7 } = {}) {
  const start = Date.UTC(1990, 0, 1) / 1000;
  const timestamp = Array.from({ length: count }, (_, i) => start + i * step * 86400);
  const close = timestamp.map((_, i) => 10 + i);
  return {
    chart: {
      result: [{
        meta: { symbol: "AAPL", dataGranularity: granularity },
        timestamp,
        indicators: {
          quote: [{ open: close, high: close.map((c) => c + 1), low: close.map((c) => c - 1), close, volume: close.map(() => 1000) }],
          adjclose: [{ adjclose: close }],
        },
      }],
    },
  };
}

function mockFetch(body) {
  const fn = vi.fn(async () => ({ ok: true, status: 200, json: async () => body }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("fetchYahooFullHistoryChart", () => {
  it("pide period1=0 con el intervalo semanal y devuelve barras con fecha diaria", async () => {
    const fetchFn = mockFetch(yahooResponse({ granularity: "1wk", count: 40 }));
    const chart = await fetchYahooFullHistoryChart("AAPL", { barInterval: "1wk" });
    const url = fetchFn.mock.calls[0][0];
    expect(url).toContain("period1=0");
    expect(url).toContain("interval=1wk");
    expect(url).not.toContain("range=");
    expect(chart.bars).toHaveLength(40);
    expect(chart.bars[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(chart.meta.barInterval).toBe("1wk");
  });

  it("falla si Yahoo degrada la granularidad (no etiqueta mal)", async () => {
    mockFetch(yahooResponse({ granularity: "3mo" }));
    await expect(fetchYahooFullHistoryChart("AAPL", { barInterval: "1wk" })).rejects.toThrow(/granularidad/);
  });

  it("rechaza intervalos que no son de histórico completo", async () => {
    await expect(fetchYahooFullHistoryChart("AAPL", { barInterval: "1d" })).rejects.toThrow();
  });
});

describe("fetchYahooChart (camino diario) sigue funcionando tras extraer el helper de barras", () => {
  it("devuelve barras diarias de Yahoo sin recurrir a respaldos", async () => {
    mockFetch(yahooResponse({ granularity: "1d", count: 60, step: 1 }));
    const chart = await fetchYahooChart("AAPL", { range: "1A", interval: "D" });
    expect(chart.meta.dataProvider).toBe("Yahoo Finance");
    expect(chart.bars).toHaveLength(60);
    expect(chart.meta.fallbackReason).toBeUndefined();
  });
});
