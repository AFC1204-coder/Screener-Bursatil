import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/clientApi", () => ({
  postJson: vi.fn(),
}));

import { postJson } from "@/lib/clientApi";
import {
  MAX_HUNT_CHART_PREVIEW_HYDRATE,
  HUNT_TAPE_ROW_HEIGHT_PX,
  HUNT_CHART_PREVIEW_OVERSCAN,
  applyChartPreviewsToRows,
  buildChartPreviewHydrateSignature,
  buildChartPreviewQueueSignature,
  chartPreviewHydrateCellState,
  computeHuntChartPreviewHydrateLimit,
  computeHuntChartPreviewHydrateStart,
  emitHuntChartPreviewViewport,
  fetchChartPreviewsForSymbols,
  huntRowsForChartPreviewHydrate,
  peekCachedChartPreviews,
  resetChartPreviewHydrateStateForTests,
  HUNT_CHART_PREVIEW_VIEWPORT_EVENT,
  resetChartPreviewHydrateCachesForTests,
} from "@/lib/scansChartPreviewHydrate";

const preview = [
  { date: "2026-01-01", close: 10, sma50: 9.5, sma200: 9, volume: 1000 },
  { date: "2026-01-02", close: 11, sma50: 9.6, sma200: 9.1, volume: 1100 },
];

function row(symbol) {
  return { symbol };
}

describe("buildChartPreviewHydrateSignature", () => {
  it("ordena y deduplica símbolos pendientes", () => {
    expect(buildChartPreviewHydrateSignature(["BBB", "AAA", "BBB"])).toBe("AAA,BBB");
    expect(buildChartPreviewHydrateSignature(["bbb", "aaa"])).toBe("AAA,BBB");
  });

  it("ignora la identidad del array si el set es el mismo", () => {
    const a = buildChartPreviewHydrateSignature(["MSFT", "AAPL"]);
    const b = buildChartPreviewHydrateSignature(["AAPL", "MSFT"]);
    expect(a).toBe(b);
  });
});

describe("buildChartPreviewQueueSignature", () => {
  it("cambia al cambiar ficha o extremos de cola", () => {
    const a = buildChartPreviewQueueSignature({
      presetKey: "balanced",
      rowCount: 100,
      headSymbol: "AAA",
      tailSymbol: "ZZZ",
      hydrateStart: 0,
    });
    const b = buildChartPreviewQueueSignature({
      presetKey: "nearPivot",
      rowCount: 36,
      headSymbol: "BBB",
      tailSymbol: "CCC",
      hydrateStart: 0,
    });
    expect(a).not.toBe(b);
    expect(a).toContain("balanced");
    expect(b).toContain("nearPivot");
  });
});

describe("computeHuntChartPreviewHydrateLimit", () => {
  it("es viewport visible + overscan×2, bajo el techo de 80", () => {
    const limit = computeHuntChartPreviewHydrateLimit(12 * HUNT_TAPE_ROW_HEIGHT_PX, {
      rowHeight: HUNT_TAPE_ROW_HEIGHT_PX,
      overscan: HUNT_CHART_PREVIEW_OVERSCAN,
    });
    expect(limit).toBe(12 + 2 * HUNT_CHART_PREVIEW_OVERSCAN);
    expect(limit).toBeLessThan(MAX_HUNT_CHART_PREVIEW_HYDRATE);
  });

  it("respeta el techo duro MAX_HUNT_CHART_PREVIEW_HYDRATE", () => {
    const limit = computeHuntChartPreviewHydrateLimit(10_000, {
      rowHeight: HUNT_TAPE_ROW_HEIGHT_PX,
      overscan: 8,
    });
    expect(limit).toBe(MAX_HUNT_CHART_PREVIEW_HYDRATE);
  });
});

describe("computeHuntChartPreviewHydrateStart", () => {
  it("en scroll 0 arranca en el top", () => {
    expect(computeHuntChartPreviewHydrateStart(0)).toBe(0);
  });

  it("desplaza la ventana al pasar del top viewport+buffer (con overscan)", () => {
    const limit = computeHuntChartPreviewHydrateLimit(12 * HUNT_TAPE_ROW_HEIGHT_PX);
    const scrollPast = 90 * HUNT_TAPE_ROW_HEIGHT_PX;
    const start = computeHuntChartPreviewHydrateStart(scrollPast, {
      overscan: 8,
      rowCount: 200,
      limit,
    });
    expect(start).toBe(82);
    expect(start + limit).toBeLessThanOrEqual(200);
  });

  it("clampa al final de la cola para mantener ventana completa", () => {
    const start = computeHuntChartPreviewHydrateStart(500 * HUNT_TAPE_ROW_HEIGHT_PX, {
      overscan: 0,
      rowCount: 120,
      limit: 80,
    });
    expect(start).toBe(40);
  });
});

describe("emitHuntChartPreviewViewport", () => {
  it("publica start y limit en el evento de viewport", () => {
    const seen = [];
    const listeners = new Map();
    const fakeWindow = {
      addEventListener(type, handler) {
        listeners.set(type, handler);
      },
      removeEventListener(type) {
        listeners.delete(type);
      },
      dispatchEvent(event) {
        listeners.get(event.type)?.(event);
        return true;
      },
    };
    const prev = globalThis.window;
    globalThis.window = fakeWindow;
    try {
      fakeWindow.addEventListener(HUNT_CHART_PREVIEW_VIEWPORT_EVENT, (event) => {
        seen.push(event.detail);
      });
      emitHuntChartPreviewViewport({ start: 42, limit: 24 });
      emitHuntChartPreviewViewport(7);
    } finally {
      if (prev === undefined) delete globalThis.window;
      else globalThis.window = prev;
    }
    expect(seen[0]).toEqual({ start: 42, limit: 24 });
    expect(seen[1].start).toBe(7);
    expect(seen[1].limit).toBe(computeHuntChartPreviewHydrateLimit());
  });

  it("no rompe sin window (SSR)", () => {
    const prev = globalThis.window;
    delete globalThis.window;
    try {
      expect(() => emitHuntChartPreviewViewport(1)).not.toThrow();
    } finally {
      if (prev === undefined) delete globalThis.window;
      else globalThis.window = prev;
    }
  });
});

describe("huntRowsForChartPreviewHydrate cap", () => {
  it("limita la cola Caza al viewport+buffer (default), no a 80 fijas", () => {
    const defaultLimit = computeHuntChartPreviewHydrateLimit();
    const queue = Array.from({ length: defaultLimit + 40 }, (_, index) => row(`Q${index}`));
    const capped = huntRowsForChartPreviewHydrate(queue, true);
    expect(capped).toHaveLength(defaultLimit);
    expect(capped[0].symbol).toBe("Q0");
    expect(capped.at(-1).symbol).toBe(`Q${defaultLimit - 1}`);
    expect(defaultLimit).toBeLessThan(MAX_HUNT_CHART_PREVIEW_HYDRATE);
  });

  it("al scroll profundo hidrata la ventana desplazada, no el top fijo", () => {
    const limit = 24;
    const queue = Array.from({ length: 160 }, (_, index) => row(`Q${index}`));
    const windowed = huntRowsForChartPreviewHydrate(queue, true, { start: 90, limit });
    expect(windowed).toHaveLength(limit);
    expect(windowed[0].symbol).toBe("Q90");
    expect(windowed.at(-1).symbol).toBe("Q113");
  });
});

describe("fetchChartPreviewsForSymbols incremental", () => {
  beforeEach(() => {
    resetChartPreviewHydrateCachesForTests();
    vi.mocked(postJson).mockReset();
    resetChartPreviewHydrateStateForTests();
  });

  it("invoca onChunk por cada lote y acumula previews", async () => {
    const symbols = [
      ...Array.from({ length: 80 }, (_, index) => `A${index}`),
      "Z1",
      "Z2",
    ];
    const firstChunk = Object.fromEntries(
      symbols.slice(0, 80).map((symbol) => [symbol, preview]),
    );
    const secondChunk = { Z1: preview, Z2: preview };
    const chunkCalls = [];
    vi.mocked(postJson)
      .mockResolvedValueOnce({ previews: firstChunk })
      .mockResolvedValueOnce({ previews: secondChunk });

    const onChunk = vi.fn((chunk) => {
      chunkCalls.push(Object.keys(chunk).length);
    });

    const result = await fetchChartPreviewsForSymbols("scan-1", symbols, { onChunk });

    expect(postJson).toHaveBeenCalledTimes(2);
    expect(onChunk).toHaveBeenCalledTimes(2);
    expect(chunkCalls).toEqual([80, 2]);
    expect(result.A0).toEqual(preview);
    expect(result.Z2).toEqual(preview);
  });

  it("reintenta un chunk fallido (hasta 2) y continúa con el resto", async () => {
    vi.mocked(postJson)
      .mockRejectedValueOnce(new Error("HTTP 500"))
      .mockRejectedValueOnce(new Error("HTTP 502"))
      .mockResolvedValueOnce({ previews: { AAA: preview } });

    const onChunk = vi.fn();
    const result = await fetchChartPreviewsForSymbols("scan-retry", ["AAA"], { onChunk });

    expect(postJson).toHaveBeenCalledTimes(3);
    expect(onChunk).toHaveBeenCalledTimes(1);
    expect(result.AAA).toEqual(preview);
  });

  it("envía scanIds UUID en el body cuando el cloudId es sintético", async () => {
    const us = "11111111-2222-4333-8444-555555555555";
    vi.mocked(postJson).mockResolvedValueOnce({ previews: { AAA: preview } });
    await fetchChartPreviewsForSymbols(
      "merged-nightly-materialized:US-HK:2026-09-16",
      ["AAA"],
      { scanIds: [us] },
    );
    expect(postJson).toHaveBeenCalledWith(
      "/api/scans/chart-preview",
      {
        scanId: "merged-nightly-materialized:US-HK:2026-09-16",
        symbols: ["AAA"],
        scanIds: [us],
      },
      expect.objectContaining({}),
    );
  });

  it("aplica previews parciales sin esperar al universo completo", async () => {
    vi.mocked(postJson).mockResolvedValueOnce({ previews: { AAA: preview } });

    let rows = [row("AAA"), row("BBB")];
    await fetchChartPreviewsForSymbols("scan-partial", ["AAA", "BBB"], {
      onChunk: (chunkPreviews) => {
        rows = applyChartPreviewsToRows(rows, chunkPreviews);
      },
    });

    expect(rows[0].chartPreview).toEqual(preview);
    expect(rows[1].chartPreview).toBeUndefined();
  });

  it("en cache hit re-aplica vía onChunk (cambio de cola / refs viejas)", async () => {
    vi.mocked(postJson).mockResolvedValueOnce({ previews: { AAA: preview, BBB: preview } });
    await fetchChartPreviewsForSymbols("scan-cache", ["AAA", "BBB"]);
    expect(postJson).toHaveBeenCalledTimes(1);

    const onChunk = vi.fn();
    let rows = [row("AAA"), row("BBB")];
    const result = await fetchChartPreviewsForSymbols("scan-cache", ["AAA", "BBB"], {
      onChunk: (chunk) => {
        onChunk(chunk);
        rows = applyChartPreviewsToRows(rows, chunk);
      },
    });

    expect(postJson).toHaveBeenCalledTimes(1);
    expect(onChunk).toHaveBeenCalledTimes(1);
    expect(rows[0].chartPreview).toEqual(preview);
    expect(rows[1].chartPreview).toEqual(preview);
    expect(result.AAA).toEqual(preview);
    expect(peekCachedChartPreviews("scan-cache", ["AAA"]).AAA).toEqual(preview);
  });

  it("si un caller cancelled pierde onChunk, el join re-aplica al segundo", async () => {
    let resolvePost;
    vi.mocked(postJson).mockImplementationOnce(() => new Promise((resolve) => {
      resolvePost = resolve;
    }));

    const firstOnChunk = vi.fn();
    const firstPromise = fetchChartPreviewsForSymbols("scan-join", ["JOIN1"], { onChunk: firstOnChunk });

    let rows = [row("JOIN1")];
    const secondOnChunk = vi.fn((chunk) => {
      rows = applyChartPreviewsToRows(rows, chunk);
    });
    const secondPromise = fetchChartPreviewsForSymbols("scan-join", ["JOIN1"], { onChunk: secondOnChunk });

    resolvePost({ previews: { JOIN1: preview } });
    await firstPromise;
    await secondPromise;

    expect(postJson).toHaveBeenCalledTimes(1);
    expect(secondOnChunk).toHaveBeenCalled();
    expect(rows[0].chartPreview).toEqual(preview);
  });

  it("marca failed cuando el chunk agota reintentos sin preview", async () => {
    vi.mocked(postJson)
      .mockRejectedValueOnce(new Error("HTTP 500"))
      .mockRejectedValueOnce(new Error("HTTP 500"));

    await fetchChartPreviewsForSymbols("scan-fail", ["FAIL1"]);
    expect(chartPreviewHydrateCellState({ symbol: "FAIL1" }, { scanId: "scan-fail" })).toBe("failed");
    expect(chartPreviewHydrateCellState({ symbol: "FAIL1" }, {
      scanId: "scan-fail",
      pendingSymbols: new Set(["FAIL1"]),
    })).toBe("failed");
    expect(chartPreviewHydrateCellState({ symbol: "PEND1" }, {
      pendingSymbols: new Set(["PEND1"]),
    })).toBe("pending");
    expect(chartPreviewHydrateCellState({ symbol: "X", chartPreview: preview })).toBe("ready");
  });

  it("respeta AbortSignal y no deja inflight colgado", async () => {
    const controller = new AbortController();
    vi.mocked(postJson).mockImplementationOnce((_url, _body, options) => new Promise((resolve, reject) => {
      options?.signal?.addEventListener("abort", () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        reject(err);
      });
    }));

    const pending = fetchChartPreviewsForSymbols("scan-abort", ["AB1"], { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });

    vi.mocked(postJson).mockResolvedValueOnce({ previews: { AB1: preview } });
    const onChunk = vi.fn();
    await fetchChartPreviewsForSymbols("scan-abort", ["AB1"], { onChunk });
    expect(onChunk).toHaveBeenCalled();
  });
});
