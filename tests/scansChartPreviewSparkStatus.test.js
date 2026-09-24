import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/clientApi", () => ({
  postJson: vi.fn(),
}));

import { postJson } from "@/lib/clientApi";
import {
  fetchChartPreviewsForSymbols,
  isChartPreviewSymbolResolved,
  markChartPreviewAttemptedOnRows,
  resetChartPreviewHydrateCachesForTests,
  resolveHuntTapeSparkStatus,
} from "@/lib/scansChartPreviewHydrate";

const preview = [
  { date: "2026-01-01", close: 10 },
  { date: "2026-01-02", close: 11 },
];

describe("resolveHuntTapeSparkStatus", () => {
  it("ready cuando la fila ya tiene chartPreview dibujable", () => {
    expect(resolveHuntTapeSparkStatus({ chartPreview: preview }, { deferred: true })).toBe("ready");
  });

  it("pending si transporte diferido y aún no se intentó hidratar", () => {
    expect(resolveHuntTapeSparkStatus({ symbol: "AAA" }, { deferred: true })).toBe("pending");
  });

  it("empty tras intento (chartPreviewAttempted) aunque no haya barras", () => {
    expect(resolveHuntTapeSparkStatus(
      { symbol: "AAA", chartPreviewAttempted: true },
      { deferred: true },
    )).toBe("empty");
  });

  it("empty inmediato si el transporte no es diferido", () => {
    expect(resolveHuntTapeSparkStatus({ symbol: "AAA" }, { deferred: false })).toBe("empty");
  });

  it("pending no es el estado final tras intento fallido/vacío", () => {
    expect(resolveHuntTapeSparkStatus(
      { symbol: "ZZZ", chartPreviewAttempted: true },
      { deferred: true },
    )).not.toBe("pending");
  });
});

describe("markChartPreviewAttemptedOnRows", () => {
  it("marca solo los símbolos pedidos", () => {
    const rows = [{ symbol: "AAA" }, { symbol: "BBB" }];
    const next = markChartPreviewAttemptedOnRows(rows, ["aaa"]);
    expect(next[0].chartPreviewAttempted).toBe(true);
    expect(next[1].chartPreviewAttempted).toBeUndefined();
    expect(next).not.toBe(rows);
  });

  it("es idempotente si ya estaba marcado", () => {
    const rows = [{ symbol: "AAA", chartPreviewAttempted: true }];
    expect(markChartPreviewAttemptedOnRows(rows, ["AAA"])).toBe(rows);
  });
});

describe("fetchChartPreviewsForSymbols resolved-empty", () => {
  beforeEach(() => {
    resetChartPreviewHydrateCachesForTests();
    vi.mocked(postJson).mockReset();
  });

  it("marca resueltos los símbolos sin barras y no los re-pide", async () => {
    vi.mocked(postJson).mockResolvedValueOnce({ previews: { AAA: preview } });

    await fetchChartPreviewsForSymbols("scan-empty", ["AAA", "BBB"]);

    expect(isChartPreviewSymbolResolved("scan-empty", "AAA")).toBe(true);
    expect(isChartPreviewSymbolResolved("scan-empty", "BBB")).toBe(true);

    vi.mocked(postJson).mockClear();
    const second = await fetchChartPreviewsForSymbols("scan-empty", ["AAA", "BBB"]);
    expect(postJson).not.toHaveBeenCalled();
    expect(second.AAA).toEqual(preview);
    expect(second.BBB).toBeUndefined();
  });
});
