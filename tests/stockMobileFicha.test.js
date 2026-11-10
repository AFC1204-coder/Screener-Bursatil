// Ficha móvil (research/movil-2026-11/propuesta.md §2.7): frescura con dos
// fechas, lectura por defecto del gráfico y CSS acotado a móvil.
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { stockMobileFreshnessParts, stockMobileShortDate } from "@/app/stock/[symbol]/StockClient";
import { UniversalPriceChartView } from "@/app/UniversalPriceChart";
import { chartReadoutText } from "@/app/chartNativeAdapter";

const MOBILE_CSS = readFileSync(new URL("../styles/stock-mobile.css", import.meta.url), "utf8");
const STOCK_PAGE = readFileSync(new URL("../app/stock/[symbol]/page.jsx", import.meta.url), "utf8");

describe("ficha móvil · frescura de cabecera", () => {
  it("fecha corta en UTC, sin año", () => {
    expect(stockMobileShortDate("2026-10-16")).toBe("16 oct");
    expect(stockMobileShortDate("2026-09-27T00:00:00Z")).toBe("27 sept");
    expect(stockMobileShortDate("")).toBe("");
    expect(stockMobileShortDate("no-fecha")).toBe("");
  });

  it("dos fechas: precios y RS", () => {
    expect(stockMobileFreshnessParts({ priceDate: "2026-10-16", rsAsOf: "2026-09-27", rsValue: 82 }))
      .toEqual(["precios 16 oct", "RS 27 sept"]);
  });

  it("sin RS no hay fecha de RS (null, undefined y \"\" no son 0)", () => {
    for (const rsValue of [null, undefined, ""]) {
      expect(stockMobileFreshnessParts({ priceDate: "2026-10-16", rsAsOf: "2026-09-27", rsValue }))
        .toEqual(["precios 16 oct"]);
    }
  });

  it("RS 0 real sí lleva fecha; si falta la de precios se omite", () => {
    expect(stockMobileFreshnessParts({ priceDate: "", rsAsOf: "2026-09-27", rsValue: 0 })).toEqual(["RS 27 sept"]);
    expect(stockMobileFreshnessParts({})).toEqual([]);
  });
});

describe("ficha móvil · lectura del gráfico", () => {
  it("la lectura por defecto omite el RS ausente, nunca lo pinta como 0", () => {
    expect(chartReadoutText({ dateText: "16 oct 2026", close: 218.01, rs: null })).not.toMatch(/RS/);
    expect(chartReadoutText({ dateText: "16 oct 2026", close: 218.01, rs: 99 })).toMatch(/RS 99/);
  });

  it("la vista pasa la lectura por defecto como data-default y la deja oculta", () => {
    const html = renderToStaticMarkup(React.createElement(UniversalPriceChartView, {
      canvasRef: { current: null },
      readoutRef: { current: null },
      viewModel: {
        status: "ready",
        header: { symbol: "MRNA", latestClose: 218.01, changePct: 1, positive: true },
        badges: {},
        viewportRail: { key: "unknown", manual: false },
        rsLegend: { enabled: false },
        rsCountryLegend: { enabled: false },
        rsThemeLegend: { enabled: false },
        notes: {},
        emptyFallback: null,
        readoutDefault: "16 oct 2026 · C 218,01",
        rootClassName: "",
      },
      actions: {},
      drawingToolbar: {},
    }));
    expect(html).toMatch(/class="universalChartReadout"[^>]*hidden/);
    expect(html).toContain('data-default="16 oct 2026 · C 218,01"');
  });
});

describe("ficha móvil · CSS acotado", () => {
  it("la página importa stock-mobile.css", () => {
    expect(STOCK_PAGE).toContain("styles/stock-mobile.css");
  });

  it("fuera de media queries solo oculta la cabecera móvil y los pliegues", () => {
    const outside = MOBILE_CSS.replace(/\/\*[\s\S]*?\*\//g, "").split("@media")[0];
    const selectors = [...outside.matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim());
    expect(selectors).toEqual([".stockMobileHead,\n.stockMobileFoldToggle"]);
  });

  it("horizontal con media query sin JS y sin intradía en los rangos", () => {
    expect(MOBILE_CSS).toContain("(orientation:landscape) and (max-height:500px) and (max-width:1000px)");
    expect(MOBILE_CSS).toContain('[aria-label="Temporalidad 1m"]');
  });
});
