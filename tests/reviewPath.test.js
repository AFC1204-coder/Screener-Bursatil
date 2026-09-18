import { describe, expect, it } from "vitest";
import {
  REVIEW_QUEUE_COLLAPSE_COUNT,
  REVIEW_QUEUE_COLLAPSE_WIDTH,
  SINGLE_SYMBOL_QUEUE_MODE,
  buildSingleSymbolReviewRow,
  defaultReviewQueueCollapsed,
  resolveEmptyQueueReviewPath,
  shouldOpenStockFromEmptySearch,
  shouldUseSingleSymbolReview,
  singleSymbolReviewLaunchOptions,
  singleSymbolReviewStatus,
} from "@/lib/reviewPath";

describe("buildSingleSymbolReviewRow", () => {
  it("normaliza el ticker y marca sourceType", () => {
    expect(buildSingleSymbolReviewRow(" aapl ")).toEqual({
      symbol: "AAPL",
      companyName: "AAPL",
      sourceType: SINGLE_SYMBOL_QUEUE_MODE,
    });
  });

  it("devuelve null sin símbolo", () => {
    expect(buildSingleSymbolReviewRow("")).toBeNull();
    expect(buildSingleSymbolReviewRow("   ")).toBeNull();
  });
});

describe("singleSymbolReviewStatus", () => {
  it("mensaje ES unificado con ticker", () => {
    expect(singleSymbolReviewStatus("aapl")).toBe("Sin cola del screener — viendo solo AAPL");
  });
});

describe("shouldUseSingleSymbolReview", () => {
  it("true solo sin cola y con símbolo", () => {
    expect(shouldUseSingleSymbolReview({ queueRows: [], symbol: "AAPL" })).toBe(true);
    expect(shouldUseSingleSymbolReview({ queueRows: [{ symbol: "AAA" }], symbol: "AAPL" })).toBe(false);
    expect(shouldUseSingleSymbolReview({ queueRows: [], symbol: "" })).toBe(false);
  });
});

describe("resolveEmptyQueueReviewPath", () => {
  it("prefiere Review 1 símbolo (no bounce a /)", () => {
    expect(resolveEmptyQueueReviewPath({ symbol: "AAPL" })).toEqual({
      mode: "single-review",
      href: "/review?source=current&symbol=AAPL",
      status: "Sin cola del screener — viendo solo AAPL",
      symbol: "AAPL",
      queueMode: SINGLE_SYMBOL_QUEUE_MODE,
    });
  });

  it("preferStock abre ficha", () => {
    expect(resolveEmptyQueueReviewPath({ symbol: "MSFT", preferStock: true })).toEqual({
      mode: "stock",
      href: "/stock/MSFT",
      status: "Sin cola del screener — viendo solo MSFT",
      symbol: "MSFT",
      queueMode: "",
    });
  });

  it("sin símbolo → empty", () => {
    expect(resolveEmptyQueueReviewPath({ symbol: "" }).mode).toBe("empty");
  });
});

describe("singleSymbolReviewLaunchOptions", () => {
  it("etiquetas de cola 1 símbolo", () => {
    expect(singleSymbolReviewLaunchOptions("nvda")).toEqual({
      sourceLabel: "1 símbolo",
      sourceDetail: "Sin cola del screener — viendo solo NVDA",
      queueMode: SINGLE_SYMBOL_QUEUE_MODE,
    });
  });
});

describe("defaultReviewQueueCollapsed", () => {
  it(`colapsa bajo ${REVIEW_QUEUE_COLLAPSE_WIDTH}px`, () => {
    expect(defaultReviewQueueCollapsed({ visibleCount: 10, viewportWidth: 1280 })).toBe(true);
    expect(defaultReviewQueueCollapsed({ visibleCount: 10, viewportWidth: 1440 })).toBe(false);
  });

  it(`colapsa con N>${REVIEW_QUEUE_COLLAPSE_COUNT}`, () => {
    expect(defaultReviewQueueCollapsed({ visibleCount: 101, viewportWidth: 1920 })).toBe(true);
    expect(defaultReviewQueueCollapsed({ visibleCount: 100, viewportWidth: 1920 })).toBe(false);
  });
});

describe("shouldOpenStockFromEmptySearch", () => {
  it("solo con mesa vacía y ticker resuelto", () => {
    expect(shouldOpenStockFromEmptySearch({ mesaEmpty: true, resolvedSymbol: "AAPL" })).toBe(true);
    expect(shouldOpenStockFromEmptySearch({ mesaEmpty: false, resolvedSymbol: "AAPL" })).toBe(false);
    expect(shouldOpenStockFromEmptySearch({ mesaEmpty: true, resolvedSymbol: "" })).toBe(false);
  });
});
