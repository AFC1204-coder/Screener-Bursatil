import { describe, expect, it } from "vitest";
import {
  briefToIpoSalidaRow,
  buildStockIpoSalidaContext,
} from "@/lib/stockIpoSalida";
import { ipoDesdeSalidaPct } from "@/lib/ipoDiscoveryView";

const IPO_DATE = "2026-06-02";

function brief(overrides = {}) {
  return {
    ipoDate: IPO_DATE,
    quoteSnapshot: { price: 110 },
    chartBars: [
      { date: "2026-06-02", close: 100 },
      { date: "2026-06-03", close: 105 },
      { date: "2026-06-04", close: 110 },
    ],
    ...overrides,
  };
}

describe("briefToIpoSalidaRow", () => {
  it("calcula % desde chartBars con la misma regla que mesa", () => {
    const row = briefToIpoSalidaRow(brief());
    expect(ipoDesdeSalidaPct(row)).toBeCloseTo(10, 5);
  });

  it("prefiere ancla persistida del brief", () => {
    const row = briefToIpoSalidaRow(brief({
      ipoAnchorClose: 50,
      ipoAnchorDate: "2026-06-03",
      quoteSnapshot: { price: 75 },
    }));
    expect(ipoDesdeSalidaPct(row)).toBe(50);
  });
});

describe("buildStockIpoSalidaContext", () => {
  it("oculta el bloque sin ipoDate", () => {
    expect(buildStockIpoSalidaContext({ listingDate: "2020-01-01" })).toEqual({ visible: false });
  });

  it("expone salida, edad y % desde salida alineados con mesa", () => {
    const context = buildStockIpoSalidaContext(brief());
    expect(context.visible).toBe(true);
    expect(context.salidaDate).toBe(IPO_DATE);
    expect(context.ageMonths).toBeTypeOf("number");
    expect(context.ageDisplay).toMatch(/^\d+m$/);
    expect(context.desdeSalidaPct).toBeCloseTo(10, 5);
    expect(context.desdeSalidaDisplay).toMatch(/10/);
  });

  it("no inventa % sin ancla usable", () => {
    const context = buildStockIpoSalidaContext(brief({
      chartBars: [{ date: "2026-09-04", close: 8.09 }],
      quoteSnapshot: { price: 8.09 },
    }));
    expect(context.visible).toBe(true);
    expect(context.desdeSalidaPct).toBeNull();
    expect(context.desdeSalidaDisplay).toBe("—");
    expect(context.desdeSalidaReason).toMatch(/no alcanza hasta la fecha de salida/i);
  });
});
