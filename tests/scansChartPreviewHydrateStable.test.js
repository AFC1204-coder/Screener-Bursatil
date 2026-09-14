import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/clientApi", () => ({
  postJson: vi.fn(),
}));

import { postJson } from "@/lib/clientApi";
import {
  MAX_HUNT_CHART_PREVIEW_HYDRATE,
  applyChartPreviewsToRows,
  buildChartPreviewHydrateSignature,
  fetchChartPreviewsForSymbols,
  huntRowsForChartPreviewHydrate,
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

describe("huntRowsForChartPreviewHydrate cap", () => {
  it("limita la cola Caza al tope exportado", () => {
    const queue = Array.from({ length: MAX_HUNT_CHART_PREVIEW_HYDRATE + 40 }, (_, index) => row(`Q${index}`));
    const capped = huntRowsForChartPreviewHydrate(queue, true);
    expect(capped).toHaveLength(MAX_HUNT_CHART_PREVIEW_HYDRATE);
    expect(capped[0].symbol).toBe("Q0");
    expect(capped.at(-1).symbol).toBe(`Q${MAX_HUNT_CHART_PREVIEW_HYDRATE - 1}`);
  });
});

describe("fetchChartPreviewsForSymbols incremental", () => {
  beforeEach(() => {
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
