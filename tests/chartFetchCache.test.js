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

  // Auditoría 2026-11, H21: el AbortController del hook no llegaba al fetch.
  function pendingGetJson() {
    const calls = [];
    const getJsonImpl = vi.fn().mockImplementation((url, options = {}) => new Promise((resolve, reject) => {
      const call = { url, options, resolve, aborted: false };
      calls.push(call);
      options.signal?.addEventListener("abort", () => {
        call.aborted = true;
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    }));
    return { getJsonImpl, calls };
  }

  it("cancelación: el único interesado aborta → la descarga se cancela y no queda en vuelo", async () => {
    const { getJsonImpl, calls } = pendingGetJson();
    const controller = new AbortController();
    const pending = fetchChartCached({ symbol: "AAPL", dataRange: "5A", interval: "D", getJsonImpl, signal: controller.signal });
    expect(calls).toHaveLength(1);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(calls[0].aborted).toBe(true);
    expect(__test__.CHART_INFLIGHT.size).toBe(0);
    expect(peekChartCache("AAPL|5A|D")).toBeNull();
  });

  it("cancelación con dedupe: si otro interesado sigue esperando, la descarga continúa", async () => {
    const { getJsonImpl, calls } = pendingGetJson();
    const a = new AbortController();
    const b = new AbortController();
    const first = fetchChartCached({ symbol: "KO", dataRange: "5A", interval: "D", getJsonImpl, signal: a.signal });
    const second = fetchChartCached({ symbol: "KO", dataRange: "5A", interval: "D", getJsonImpl, signal: b.signal });
    expect(calls).toHaveLength(1);
    a.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    expect(calls[0].aborted).toBe(false);
    calls[0].resolve({ bars: [{ time: 9 }] });
    await expect(second).resolves.toEqual({ bars: [{ time: 9 }] });
    expect(peekChartCache("KO|5A|D")).toEqual({ bars: [{ time: 9 }] });
  });

  it("cancelación: un prefetch (sin signal) fija la petición aunque el consumidor aborte", async () => {
    const { getJsonImpl, calls } = pendingGetJson();
    prefetchChart({ symbol: "MRNA", dataRange: "2A", interval: "D", getJsonImpl });
    const controller = new AbortController();
    const waiting = fetchChartCached({ symbol: "MRNA", dataRange: "2A", interval: "D", getJsonImpl, signal: controller.signal });
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    expect(calls[0].aborted).toBe(false);
    calls[0].resolve({ bars: [{ time: 4 }] });
    await vi.waitFor(() => expect(peekChartCache("MRNA|2A|D")).toEqual({ bars: [{ time: 4 }] }));
  });

  it("signal ya abortado: rechaza sin pedir nada", async () => {
    const { getJsonImpl } = pendingGetJson();
    const controller = new AbortController();
    controller.abort();
    await expect(fetchChartCached({ symbol: "X", dataRange: "1A", interval: "D", getJsonImpl, signal: controller.signal }))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(getJsonImpl).not.toHaveBeenCalled();
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
