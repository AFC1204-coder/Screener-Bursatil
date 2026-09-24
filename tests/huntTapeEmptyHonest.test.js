import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/screenerAtoms", () => ({
  CompanyMark: () => React.createElement("span", { className: "companyMark" }),
}));

import HuntTapeView from "@/app/components/screener/HuntTapeView";
import { buildScreenerTruthLine, SCREENER_TRUTH_UNAVAILABLE_SEGMENT } from "@/lib/screenerTruthLine";
import { shouldShowMesaEmptyCard } from "@/lib/mesaEmptyState";

describe("UX-EMPTY-HONEST · Caza HuntTapeView", () => {
  it("no pinta titles de laboratorio ni guiones mudos en celdas", () => {
    const html = renderToStaticMarkup(React.createElement(HuntTapeView, {
      rows: [{
        symbol: "AAA",
        companyName: "Alpha",
        chartPreviewAttempted: true,
      }],
      chartPreviewDeferred: true,
    }));
    expect(html).not.toMatch(/chartPreview/i);
    expect(html).not.toMatch(/materializ/i);
    expect(html).not.toMatch(/Spark desde/i);
    expect(html).toContain("Sin serie");
    expect(html).toContain("Sin etapa");
    expect(html).toContain("Sin máx.");
    expect(html).not.toMatch(/>\s*[–—-]\s*</);
  });

  it("muestra loading humano mientras spark está pendiente", () => {
    const html = renderToStaticMarkup(React.createElement(HuntTapeView, {
      rows: [{ symbol: "BBB", companyName: "Beta" }],
      chartPreviewDeferred: true,
    }));
    expect(html).toContain("Cargando gráfico semanal");
    expect(html).toContain("huntTapeSparkPending");
  });
});

describe("UX-EMPTY-HONEST · mesa sin-escaneo vs 0-filtro", () => {
  it("truth de universo vacío dice sin escaneo, no 0 de 0", () => {
    const line = buildScreenerTruthLine({
      analyzedRows: [],
      passCount: 0,
      visibleCount: 0,
      presetName: "Líderes Etapa 2",
      loading: false,
    });
    expect(line).toContain(SCREENER_TRUTH_UNAVAILABLE_SEGMENT);
    expect(line).toBe("Sin escaneo en mesa");
    expect(line).not.toMatch(/0 de 0/);
    expect(line).not.toMatch(/pasan/);
  });

  it("tarjeta de mesa vacía aplica con 0 analizadas; filtro-0 no", () => {
    expect(shouldShowMesaEmptyCard({ analyzedCount: 0, restoringScan: false })).toBe(true);
    expect(shouldShowMesaEmptyCard({ analyzedCount: 12, restoringScan: false })).toBe(false);
  });
});
