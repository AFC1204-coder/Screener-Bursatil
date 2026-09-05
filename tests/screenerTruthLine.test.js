import { describe, expect, it } from "vitest";
import { DEFAULT_MARKETS } from "@/lib/screenerConfig";
import { buildScreenerTruthLine, marketCountLabel, resolveScreenerTruthCounts } from "@/lib/screenerTruthLine";

describe("buildScreenerTruthLine", () => {
  it("compone pasan con denominador, corte y mesa alineada", () => {
    const line = buildScreenerTruthLine({
      analyzedRows: [{ symbol: "A" }, { symbol: "B" }],
      passCount: 1,
      visibleCount: 1,
      presetName: "Balanceado",
      sort: "perf6m",
      sortAsc: false,
      scannedAt: "2026-08-27T14:07:00.000Z",
    });
    expect(line).toContain("1 de 2 pasan «Balanceado»");
    expect(line).not.toContain("analizadas");
    expect(line).not.toContain("en lista");
    expect(line).not.toContain("visibles");
    expect(line).not.toContain("orden:");
    expect(line).not.toContain("/página");
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
    expect(line).not.toContain("orden:");
  });

  it("no repite en lista ni página cuando pasan y visibles coinciden", () => {
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
    expect(line).toContain("1047 de 100 pasan «Deterioro»");
    expect(line).not.toContain("en lista");
    expect(line).not.toContain("/página");
  });

  it("muestra en lista solo cuando visibleCount difiere de passCount", () => {
    const line = buildScreenerTruthLine({
      analyzedRows: [],
      passCount: 120,
      visibleCount: 80,
      pageSize: 50,
      presetName: "Balanceado",
      sort: "perf6m",
      sortAsc: true,
    });
    expect(line).toContain("120 de 0 pasan «Balanceado»");
    expect(line).toContain("80 en lista");
    expect(line).not.toContain("/página");
  });

  it("no añade en lista cuando visibleCount iguala passCount", () => {
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
    expect(line).toContain("47 de 0 pasan «Líderes Etapa 2»");
    expect(line).not.toContain("en lista");
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

  it("con desalineación omite segmentos de mercado de la verdad", () => {
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
    expect(line).toContain("0 de 0 pasan «HK»");
    expect(line).not.toContain("mesa:");
    expect(line).not.toContain("datos:");
    expect(line).not.toContain("selección ≠ mesa");
  });

  it("desktop desalineado no mete muro de códigos en la verdad", () => {
    const many = DEFAULT_MARKETS.slice(0, 10);
    const line = buildScreenerTruthLine({
      analyzedRows: [],
      passCount: 0,
      visibleCount: 0,
      presetName: "Balanceado",
      sort: "perf6m",
      sortAsc: false,
      scannedMarkets: ["US"],
      selectedMarkets: many,
      marketsMisaligned: true,
    });
    expect(line).toContain("0 de 0 pasan «Balanceado»");
    expect(line).not.toContain("mesa:");
    expect(line).not.toContain("selección ≠ mesa");
    expect(line).not.toContain("AT+");
    expect(line).not.toContain("datos: US · selección:");
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

  it("modo compacto resume mercados en móvil sin mentir conteos", () => {
    const many = ["AT", "AU", "BE", "CA", "CH", "DE", "ES", "FR"];
    const line = buildScreenerTruthLine({
      analyzedRows: Array.from({ length: 120 }, (_, i) => ({ symbol: `S${i}` })),
      passCount: 47,
      visibleCount: 47,
      presetName: "Balanceado",
      sort: "perf6m",
      sortAsc: false,
      scannedMarkets: many,
      selectedMarkets: many,
      compactMarketSegments: true,
      scannedAt: "2026-08-27T14:07:00.000Z",
    });
    expect(line).toContain("47 de 120 pasan «Balanceado»");
    expect(line).toContain("8 mercados en mesa");
    expect(line).not.toContain("mesa: AT+");
    expect(line).not.toContain("orden:");
    expect(line).not.toContain("corte ");
  });

  it("modo compacto desalineado omite segmentos de mercado", () => {
    const line = buildScreenerTruthLine({
      analyzedRows: Array.from({ length: 100 }, (_, i) => ({ symbol: `S${i}` })),
      passCount: 20,
      visibleCount: 20,
      presetName: "Balanceado",
      sort: "perf6m",
      sortAsc: false,
      scannedMarkets: ["US"],
      selectedMarkets: DEFAULT_MARKETS,
      marketsMisaligned: true,
      compactMarketSegments: true,
    });
    expect(line).toContain("20 de 100 pasan «Balanceado»");
    expect(line).not.toContain("mercado");
    expect(line).not.toContain("selección ≠ mesa");
  });

  it("TRUTH-LOAD-1: en carga sin conteos usa cargando… y conserva mesa/corte", () => {
    const line = buildScreenerTruthLine({
      analyzedRows: [],
      passCount: 0,
      visibleCount: 0,
      presetName: "Líderes intl",
      sort: "perf6m",
      sortAsc: false,
      scannedAt: "2026-08-27T14:07:00.000Z",
      scannedMarkets: ["HK"],
      selectedMarkets: ["HK"],
      loading: true,
    });
    expect(line).toContain("cargando…");
    expect(line).not.toContain("0 de 0 pasan");
    expect(line).not.toContain("en lista");
    expect(line).toContain("mesa: HK");
    expect(line).not.toContain("orden:");
    expect(line).toContain("corte ");
  });

  it("TRUTH-LOAD-1: en carga con filas en memoria no afirma ceros", () => {
    const line = buildScreenerTruthLine({
      analyzedRows: Array.from({ length: 157 }, (_, i) => ({ symbol: `S${i}` })),
      passCount: 42,
      visibleCount: 42,
      presetName: "Líderes intl",
      sort: "perf6m",
      sortAsc: false,
      scannedMarkets: ["US"],
      selectedMarkets: ["HK"],
      suppressMisalignmentAlarm: true,
      loading: true,
    });
    expect(line).toContain("42 de 157 pasan «Líderes intl»");
    expect(line).not.toContain("0 de 0 pasan");
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

  it("PERF-NAC: override cold con passCount null alinea en lista con pasan eager", () => {
    const counts = resolveScreenerTruthCounts({
      eagerPassCount: 290,
      filteredVisibleCount: 488,
      huntTruthOverride: { passCount: null, presetName: "Deterioro" },
      viewFiltersActive: 0,
    });
    expect(counts).toEqual({ passCount: 290, visibleCount: 290 });
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
    expect(line).toContain("1045 de 3321 pasan «Deterioro»");
    expect(line).not.toContain("en lista");
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
