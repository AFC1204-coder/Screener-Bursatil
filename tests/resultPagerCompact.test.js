import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// El pie de la tabla ocupaba una franja entera para decir "Mostrando 1-3 de 3"
// —lo mismo que la cabecera ya dice con "3 resultados"— más un selector de
// tamaño y dos botones de texto. Con una sola página no aporta nada y no se
// pinta; con varias se reduce a una línea (principio 2: menos superficie).

vi.mock("@/app/screenerPanels", () => ({
  CompactResultsTable: () => React.createElement("div", { className: "compactResultsTable" }),
}));

const { default: ResultPagerTable } = await import("@/app/components/screener/ResultPagerTable");

function render(overrides = {}) {
  return renderToStaticMarkup(React.createElement(ResultPagerTable, {
    visibleCount: 3,
    resultPageStart: 0,
    resultPageEnd: 3,
    resultPageSize: 50,
    onPageSizeChange: () => {},
    visibleResultPage: 1,
    totalResultPages: 1,
    onSetResultPage: () => {},
    pagedRows: [],
    favoriteSymbols: new Set(),
    onFavorite: () => {},
    onReview: () => {},
    onOpenStock: () => {},
    perfPeriod: "perf3m",
    onPerfPeriod: () => {},
    ...overrides,
  }));
}

describe("pie de resultados compacto", () => {
  it("no pinta el pager con una sola página", () => {
    const html = render();
    expect(html).not.toContain("resultPager");
    expect(html).not.toContain("Mostrando");
    expect(html).toContain("compactResultsTable");
  });

  it("tampoco lo pinta sin resultados", () => {
    expect(render({ visibleCount: 0, resultPageEnd: 0 })).not.toContain("resultPager");
  });

  it("con varias páginas cabe en una línea: rango, tamaño y dos flechas", () => {
    const html = render({ visibleCount: 55, resultPageEnd: 50, totalResultPages: 2 });
    expect(html).toContain("resultPager");
    expect(html).toContain("1-50 de 55");
    expect(html).toContain("pág. 1/2");
    expect(html).toContain("50/pág.");
    expect(html).toContain('aria-label="Página anterior"');
    expect(html).toContain('aria-label="Página siguiente"');
    // El texto largo de los botones desaparece; queda el glifo con aria-label.
    expect(html).not.toContain(">Anterior<");
    expect(html).not.toContain(">Siguiente<");
    expect(html).not.toContain("Mostrando");
  });

  it("desactiva la flecha del extremo en la última página", () => {
    const html = render({ visibleCount: 55, resultPageStart: 50, resultPageEnd: 55, visibleResultPage: 2, totalResultPages: 2 });
    expect(html).toContain("51-55 de 55");
    const siguiente = html.match(/<button[^>]*aria-label="Página siguiente"[^>]*>/)[0];
    const anterior = html.match(/<button[^>]*aria-label="Página anterior"[^>]*>/)[0];
    expect(siguiente).toContain("disabled");
    expect(anterior).not.toContain("disabled");
  });
});
