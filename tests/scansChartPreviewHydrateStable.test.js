import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/clientApi", () => ({
  postJson: vi.fn(),
}));

import { postJson } from "@/lib/clientApi";
import {
  MAX_HUNT_CHART_PREVIEW_HYDRATE,
  HUNT_TAPE_ROW_HEIGHT_PX,
  applyChartPreviewsToRows,
  buildChartPreviewHydrateSignature,
  computeHuntChartPreviewHydrateStart,
  emitHuntChartPreviewViewport,
  fetchChartPreviewsForSymbols,
  huntRowsForChartPreviewHydrate,
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

describe("computeHuntChartPreviewHydrateStart", () => {
  it("en scroll 0 arranca en el top", () => {
    expect(computeHuntChartPreviewHydrateStart(0)).toBe(0);
  });

  it("desplaza la ventana al pasar del top 80 (con overscan)", () => {
    const scrollPastTop80 = 90 * HUNT_TAPE_ROW_HEIGHT_PX;
    const start = computeHuntChartPreviewHydrateStart(scrollPastTop80, {
      overscan: 8,
      rowCount: 200,
    });
    expect(start).toBe(82);
    expect(start + MAX_HUNT_CHART_PREVIEW_HYDRATE).toBeLessThanOrEqual(200);
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
  it("publica el start en el evento de viewport", () => {
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
        seen.push(event.detail?.start);
      });
      emitHuntChartPreviewViewport(42);
    } finally {
      if (prev === undefined) delete globalThis.window;
      else globalThis.window = prev;
    }
    expect(seen).toEqual([42]);
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
  it("limita la cola Caza al tope exportado", () => {
    const queue = Array.from({ length: MAX_HUNT_CHART_PREVIEW_HYDRATE + 40 }, (_, index) => row(`Q${index}`));
    const capped = huntRowsForChartPreviewHydrate(queue, true);
    expect(capped).toHaveLength(MAX_HUNT_CHART_PREVIEW_HYDRATE);
    expect(capped[0].symbol).toBe("Q0");
    expect(capped.at(-1).symbol).toBe(`Q${MAX_HUNT_CHART_PREVIEW_HYDRATE - 1}`);
  });

  it("al scroll profundo hidrata la ventana desplazada, no el top fijo", () => {
    const queue = Array.from({ length: 160 }, (_, index) => row(`Q${index}`));
    const windowed = huntRowsForChartPreviewHydrate(queue, true, { start: 90, limit: 80 });
    expect(windowed).toHaveLength(80);
    expect(windowed[0].symbol).toBe("Q80");
    expect(windowed.at(-1).symbol).toBe("Q159");
  });
});

describe("fetchChartPreviewsForSymbols incremental", () => {
  beforeEach(() => {
    resetChartPreviewHydrateCachesForTests();
    vi.mocked(postJson).mockReset();
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

  it("reintenta un chunk fallido una vez y continúa con el resto", async () => {
    vi.mocked(postJson)
      .mockRejectedValueOnce(new Error("HTTP 500"))
      .mockResolvedValueOnce({ previews: { AAA: preview } });

    const onChunk = vi.fn();
    const result = await fetchChartPreviewsForSymbols("scan-retry", ["AAA"], { onChunk });

    expect(postJson).toHaveBeenCalledTimes(2);
    expect(onChunk).toHaveBeenCalledTimes(1);
    expect(result.AAA).toEqual(preview);
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
});
