import { describe, expect, it } from "vitest";
import { buildScreenerTruthLine, marketCountLabel } from "@/lib/screenerTruthLine";

describe("buildScreenerTruthLine", () => {
  it("compone analizadas, pasan, en lista, orden y corte", () => {
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
    expect(line).toContain("1 en lista");
    expect(line).not.toContain("visibles");
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

  it("añade hint de página cuando hay más de una página", () => {
    const line = buildScreenerTruthLine({
      analyzedRows: Array.from({ length: 100 }, (_, i) => ({ symbol: `S${i}` })),
      passCount: 1047,
      visibleCount: 1047,
      pageSize: 50,
      totalPages: 21,
      presetName: "Deterioro",
      sort: "perf3m",
      sortAsc: false,
    });
    expect(line).toContain("1047 en lista · 50/página");
  });

  it("añade hint de página cuando visibleCount supera pageSize aunque totalPages no se pase", () => {
    const line = buildScreenerTruthLine({
      analyzedRows: [],
      passCount: 120,
      visibleCount: 120,
      pageSize: 50,
      presetName: "Balanceado",
      sort: "perf6m",
      sortAsc: true,
    });
    expect(line).toContain("120 en lista · 50/página");
  });

  it("omite hint de página en una sola página cabida en pageSize", () => {
    const line = buildScreenerTruthLine({
      analyzedRows: [],
      passCount: 47,
      visibleCount: 47,
      pageSize: 50,
      totalPages: 1,
      presetName: "Líderes Etapa 2",
      sort: "perf3m",
      sortAsc: false,
    });
    expect(line).toContain("47 en lista");
    expect(line).not.toContain("/página");
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
