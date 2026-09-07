import { describe, expect, it } from "vitest";
import { projectScanIpoAnchorFromRow } from "@/app/api/company-brief/route";
import { buildStockIpoSalidaContext } from "@/lib/stockIpoSalida";
import { ipoDesdeSalidaPct } from "@/lib/ipoDiscoveryView";

describe("projectScanIpoAnchorFromRow", () => {
  it("proyecta ancla desde metrics del scan materializado", () => {
    const result = projectScanIpoAnchorFromRow({
      symbol: "ANDG",
      metrics: {
        ipoAnchorClose: 54.25,
        ipoAnchorDate: "2026-06-03",
      },
    });
    expect(result).toEqual({
      ipoAnchorClose: 54.25,
      ipoAnchorDate: "2026-06-03",
    });
  });

  it("cae a raw cuando metrics no trae ancla", () => {
    const result = projectScanIpoAnchorFromRow({
      symbol: "ANDG",
      metrics: {},
      raw: {
        ipoAnchorClose: 50,
        ipoAnchorDate: "2026-06-02",
      },
    });
    expect(result).toEqual({
      ipoAnchorClose: 50,
      ipoAnchorDate: "2026-06-02",
    });
  });

  it("omite ancla incompleta o inválida", () => {
    expect(projectScanIpoAnchorFromRow(null)).toBeNull();
    expect(projectScanIpoAnchorFromRow({ metrics: {} })).toBeNull();
    expect(projectScanIpoAnchorFromRow({
      metrics: { ipoAnchorClose: 50 },
    })).toBeNull();
    expect(projectScanIpoAnchorFromRow({
      metrics: { ipoAnchorDate: "2026-06-02" },
    })).toBeNull();
    expect(projectScanIpoAnchorFromRow({
      metrics: { ipoAnchorClose: 0, ipoAnchorDate: "2026-06-02" },
    })).toBeNull();
  });
});

describe("company-brief ipoAnchor* → ficha salida", () => {
  it("alinea % desde salida con la mesa cuando el brief trae ancla persistida", () => {
    const brief = {
      ipoDate: "2026-06-02",
      ipoAnchorClose: 50,
      ipoAnchorDate: "2026-06-03",
      quoteSnapshot: { price: 110.75 },
      chartBars: [
        { date: "2026-06-02", close: 100 },
        { date: "2026-06-03", close: 105 },
      ],
    };
    const context = buildStockIpoSalidaContext(brief);
    expect(context.desdeSalidaPct).toBeCloseTo(121.5, 1);
    expect(context.desdeSalidaDisplay).toMatch(/121/);
    expect(ipoDesdeSalidaPct({
      ipoDate: brief.ipoDate,
      ipoAnchorClose: brief.ipoAnchorClose,
      ipoAnchorDate: brief.ipoAnchorDate,
      price: brief.quoteSnapshot.price,
      chartPreview: brief.chartBars,
    })).toBeCloseTo(121.5, 1);
  });

  it("sin ancla en brief sigue usando fallback chartBars sin romper", () => {
    const brief = {
      ipoDate: "2026-06-02",
      quoteSnapshot: { price: 110 },
      chartBars: [
        { date: "2026-06-02", close: 100 },
        { date: "2026-06-03", close: 105 },
      ],
    };
    const context = buildStockIpoSalidaContext(brief);
    expect(context.visible).toBe(true);
    expect(context.desdeSalidaPct).toBeCloseTo(10, 5);
    expect(brief.ipoAnchorClose).toBeUndefined();
    expect(brief.ipoAnchorDate).toBeUndefined();
  });
});
