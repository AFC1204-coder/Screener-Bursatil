import { describe, expect, it } from "vitest";
import { buildScreenerTruthLine, marketCountLabel } from "@/lib/screenerTruthLine";

describe("buildScreenerTruthLine", () => {
  it("compone analizadas, pasan, visibles, orden y corte", () => {
    const line = buildScreenerTruthLine({
      analyzedRows: [{ symbol: "A" }, { symbol: "B" }],
      passCount: 1,
      visibleCount: 1,
      presetName: "Balanceado",
      sort: "perf6m",
      sortAsc: false,
      scannedAt: "2026-08-27T14:07:00.000Z",
    });
    expect(line).toContain("2 analizadas");
    expect(line).toContain("1 pasan «Balanceado»");
    expect(line).toContain("1 visibles");
    expect(line).toContain("orden: Rendimiento 6M ↓");
    expect(line).toContain("corte ");
  });

  it("omite corte si no hay fecha", () => {
    const line = buildScreenerTruthLine({
      analyzedRows: [],
      passCount: 0,
      visibleCount: 0,
      presetName: "Balanceado",
      sort: "perf6m",
      sortAsc: true,
      scannedAt: null,
    });
    expect(line).not.toContain("corte ");
    expect(line).toContain("↑");
  });
});

describe("marketCountLabel", () => {
  it("usa singular para 1 mercado", () => {
    expect(marketCountLabel(1)).toBe("1 mercado");
  });

  it("usa plural para varios mercados", () => {
    expect(marketCountLabel(3)).toBe("3 mercados");
  });
});
