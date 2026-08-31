import { describe, expect, it } from "vitest";
import { buildScreenerTruthLine, marketCountLabel, resolveScreenerTruthCounts } from "@/lib/screenerTruthLine";

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

  it("incluye mesa cuando hay scan cargado y mercados alineados", () => {
    const line = buildScreenerTruthLine({
      analyzedRows: [{ symbol: "AAPL" }],
      passCount: 1,
      visibleCount: 1,
      presetName: "Balanceado",
      sort: "perf6m",
      sortAsc: false,
      scannedMarkets: ["US"],
      selectedMarkets: ["US"],
    });
    expect(line).toContain("mesa: US");
    expect(line).not.toContain("selección ≠ mesa");
    expect(line).not.toContain("datos:");
  });

  it("une varios mercados de mesa con +", () => {
    const line = buildScreenerTruthLine({
      analyzedRows: [{ symbol: "A" }, { symbol: "B" }],
      passCount: 2,
      visibleCount: 2,
      presetName: "Balanceado",
      sort: "perf6m",
      sortAsc: false,
      scannedMarkets: ["CA", "HK"],
      selectedMarkets: ["CA", "HK"],
    });
    expect(line).toContain("mesa: CA+HK");
  });

  it("con desalineación mantiene 0 analizadas y aclara datos vs selección", () => {
    const line = buildScreenerTruthLine({
      analyzedRows: [],
      passCount: 0,
      visibleCount: 0,
      presetName: "HK",
      sort: "perf6m",
      sortAsc: false,
      scannedMarkets: ["US"],
      selectedMarkets: ["HK"],
      marketsMisaligned: true,
    });
    expect(line).toContain("0 analizadas");
    expect(line).toContain("mesa: US");
    expect(line).toContain("datos: US · selección: HK");
    expect(line).toContain("selección ≠ mesa");
  });

  it("omite segmentos de mercado sin scan cargado", () => {
    const line = buildScreenerTruthLine({
      analyzedRows: [],
      passCount: 0,
      visibleCount: 0,
      presetName: "Balanceado",
      sort: "perf6m",
      sortAsc: true,
      scannedMarkets: [],
      selectedMarkets: ["US"],
    });
    expect(line).not.toContain("mesa:");
    expect(line).not.toContain("selección ≠ mesa");
  });
});

describe("resolveScreenerTruthCounts", () => {
  it("alinea en lista con pasan durante override hunt sin filtros de vista", () => {
    const counts = resolveScreenerTruthCounts({
      eagerPassCount: 290,
      filteredVisibleCount: 488,
      huntTruthOverride: { passCount: 1045, presetName: "Deterioro" },
      viewFiltersActive: 0,
    });
    expect(counts).toEqual({ passCount: 1045, visibleCount: 1045 });
  });

  it("alinea en lista con pasan cuando deferred está desfasado", () => {
    const counts = resolveScreenerTruthCounts({
      eagerPassCount: 1045,
      filteredVisibleCount: 290,
      rowsDeferredStale: true,
      viewFiltersActive: 0,
    });
    expect(counts).toEqual({ passCount: 1045, visibleCount: 1045 });
  });

  it("alinea durante transición hunt pendiente", () => {
    const counts = resolveScreenerTruthCounts({
      eagerPassCount: 290,
      filteredVisibleCount: 290,
      isHuntTransitionPending: true,
      huntTruthOverride: { passCount: 488, presetName: "Radar IPO" },
      viewFiltersActive: 0,
    });
    expect(counts).toEqual({ passCount: 488, visibleCount: 488 });
  });

  it("respeta lista filtrada real con chips de vista activos", () => {
    const counts = resolveScreenerTruthCounts({
      eagerPassCount: 1045,
      filteredVisibleCount: 120,
      rowsDeferredStale: true,
      huntTruthOverride: { passCount: 1045, presetName: "Deterioro" },
      viewFiltersActive: 1,
    });
    expect(counts).toEqual({ passCount: 1045, visibleCount: 120 });
  });

  it("usa filtered cuando no hay transición ni override", () => {
    const counts = resolveScreenerTruthCounts({
      eagerPassCount: 47,
      filteredVisibleCount: 47,
      viewFiltersActive: 0,
    });
    expect(counts).toEqual({ passCount: 47, visibleCount: 47 });
  });

  it("no publica pasan≠lista imposible en línea compuesta bajo override", () => {
    const { passCount, visibleCount } = resolveScreenerTruthCounts({
      eagerPassCount: 290,
      filteredVisibleCount: 488,
      huntTruthOverride: { passCount: 1045, presetName: "Deterioro" },
    });
    const line = buildScreenerTruthLine({
      analyzedRows: Array.from({ length: 3321 }),
      passCount,
      visibleCount,
      presetName: "Deterioro",
      sort: "perf3m",
      sortAsc: false,
    });
    expect(line).toContain("1045 pasan «Deterioro»");
    expect(line).toContain("1045 en lista");
    expect(line).not.toContain("488 en lista");
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
