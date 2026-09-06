import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/screenerPanels", () => ({
  CompactResultsTable: () => React.createElement("div", { className: "compactResultsTable" }),
}));

vi.mock("@/app/components/screener/HuntTapeView", () => ({
  default: () => React.createElement("div", { className: "huntTapeView" }),
}));

const { default: ResultPagerTable } = await import("@/app/components/screener/ResultPagerTable");

function render(overrides = {}) {
  return renderToStaticMarkup(React.createElement(ResultPagerTable, {
    visibleCount: 3,
    presetKey: "balanced",
    filteredRows: [{ symbol: "NVDA" }, { symbol: "META" }],
    resultPageStart: 0,
    resultPageEnd: 3,
    resultPageSize: 50,
    onPageSizeChange: () => {},
    visibleResultPage: 1,
    totalResultPages: 1,
    onSetResultPage: () => {},
    pagedRows: [{ symbol: "NVDA" }],
    favoriteSymbols: new Set(),
    onFavorite: () => {},
    onReview: () => {},
    onOpenStock: () => {},
    perfPeriod: "perf3m",
    onPerfPeriod: () => {},
    ...overrides,
  }));
}

describe("ResultPagerTable · Caza | Auditoría", () => {
  it("muestra toggle Caza y Auditoría", () => {
    const html = render();
    expect(html).toContain("huntTapeModeToggle");
    expect(html).toContain("Caza");
    expect(html).toContain("Auditoría");
  });

  it("en Caza pinta la cinta sobre filteredRows, no la tabla", () => {
    const html = render();
    expect(html).toContain("huntTapeView");
    expect(html).not.toContain("compactResultsTable");
    expect(html).toContain("3 en cola");
  });

  it("en Auditoría mantiene CompactResultsTable y oculta la cinta", () => {
    const html = render({ presetKey: "growth" });
    expect(html).toContain("compactResultsTable");
    expect(html).not.toContain("huntTapeView");
  });
});
