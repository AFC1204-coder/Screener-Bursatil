import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildChartRequestKey,
  buildChartUrl,
  fetchChartCached,
  fetchRsWeeklyCached,
  peekChartCache,
  peekRsWeeklyCache,
  prefetchChart,
  __test__,
} from "@/lib/chartFetchCache";

const { resetChartFetchCache } = __test__;

describe("chartFetchCache", () => {
  afterEach(() => {
    resetChartFetchCache();
    vi.restoreAllMocks();
  });

  it("buildChartRequestKey alinea con useChartDataModel (symbol|range|interval)", () => {
    expect(buildChartRequestKey({ symbol: "AAPL", dataRange: "6M", interval: "D" })).toBe("AAPL|6M|D");
    expect(buildChartUrl({ symbol: "AAPL", dataRange: "6M", interval: "D" })).toBe("/api/chart?symbol=AAPL&range=6M&interval=D");
  });

  it("cache hit evita segundo fetch para la misma key", async () => {
    const getJsonImpl = vi.fn().mockResolvedValue({ bars: [{ time: 1 }], meta: {} });
    const first = await fetchChartCached({
      symbol: "BBB",
      dataRange: "6M",
      interval: "D",
      getJsonImpl,
    });
    const second = await fetchChartCached({
      symbol: "BBB",
      dataRange: "6M",
      interval: "D",
      getJsonImpl,
    });
    expect(first).toEqual({ bars: [{ time: 1 }], meta: {} });
    expect(second).toEqual(first);
    expect(getJsonImpl).toHaveBeenCalledTimes(1);
    expect(peekChartCache("BBB|6M|D")).toEqual(first);
  });

  it("dedupe in-flight: dos await comparten una sola petición", async () => {
    let resolveFetch;
    const getJsonImpl = vi.fn().mockImplementation(() => new Promise((resolve) => {
      resolveFetch = resolve;
    }));
    const args = { symbol: "NVDA", dataRange: "6M", interval: "D", getJsonImpl };
    const p1 = fetchChartCached(args);
    const p2 = fetchChartCached(args);
    expect(getJsonImpl).toHaveBeenCalledTimes(1);
    resolveFetch({ bars: [{ time: 2 }] });
    await expect(Promise.all([p1, p2])).resolves.toEqual([
      { bars: [{ time: 2 }] },
      { bars: [{ time: 2 }] },
    ]);
  });

  it("prefetchChart reutiliza la misma caché que fetchChartCached", async () => {
    const getJsonImpl = vi.fn().mockResolvedValue({ bars: [{ time: 3 }] });
    prefetchChart({ symbol: "MSFT", dataRange: "6M", interval: "D", getJsonImpl });
    await vi.waitFor(() => expect(peekChartCache("MSFT|6M|D")).toBeTruthy());
    const hit = await fetchChartCached({
      symbol: "MSFT",
      dataRange: "6M",
      interval: "D",
      getJsonImpl,
    });
    expect(hit).toEqual({ bars: [{ time: 3 }] });
    expect(getJsonImpl).toHaveBeenCalledTimes(1);
  });

  it("rs-weekly cache/dedupe por URL completa", async () => {
    const url = "/api/rs-weekly?symbol=TSLA&limit=180";
    const getJsonImpl = vi.fn().mockResolvedValue({ global: { series: [{ rsRating: 80 }] } });
    await fetchRsWeeklyCached(url, { getJsonImpl });
    await fetchRsWeeklyCached(url, { getJsonImpl });
    expect(getJsonImpl).toHaveBeenCalledTimes(1);
    expect(peekRsWeeklyCache(url)).toEqual({ global: { series: [{ rsRating: 80 }] } });
  });
});
