import { describe, expect, it } from "vitest";
import {
  ipoDesdeSalidaAbsenceReason,
  ipoDesdeSalidaAnchorClose,
  ipoDesdeSalidaPct,
  ipoDesdeSalidaSortValue,
} from "@/lib/ipoDiscoveryView";
import { compareRowsForSort } from "@/lib/screenerPipeline";

function row(overrides = {}) {
  return {
    symbol: "IPO1",
    ipoDate: "2026-06-02",
    price: 110,
    chartPreview: [
      { date: "2026-06-02", close: 100 },
      { date: "2026-06-03", close: 105 },
      { date: "2026-06-04", close: 110 },
    ],
    ...overrides,
  };
}

describe("ipoDesdeSalidaPct", () => {
  it("calcula % vs primer cierre usable ≥ ipoDate en chartPreview", () => {
    expect(ipoDesdeSalidaPct(row())).toBeCloseTo(10, 5);
    expect(ipoDesdeSalidaAnchorClose(row())).toMatchObject({ close: 100, date: "2026-06-02" });
  });

  it("usa el primer cierre en o después de ipoDate si el día exacto no está en la serie", () => {
    const value = ipoDesdeSalidaPct(row({
      ipoDate: "2026-06-01",
      ipoAgeMonths: 1,
      chartPreview: [
        { date: "2026-06-03", close: 50 },
        { date: "2026-06-04", close: 75 },
      ],
      price: 100,
    }));
    expect(value).toBe(100);
  });

  it("devuelve null sin ipoDate verificada", () => {
    expect(ipoDesdeSalidaPct(row({ ipoDate: "" }))).toBeNull();
    expect(ipoDesdeSalidaAbsenceReason(row({ ipoDate: "" }))).toMatch(/fecha de salida/i);
  });

  it("devuelve null para pre-IPO estimada", () => {
    expect(ipoDesdeSalidaPct(row({
      ipoDate: "",
      expectedTradeDate: "2026-09-01",
      ipoWatchOnly: true,
    }))).toBeNull();
    expect(ipoDesdeSalidaAbsenceReason(row({
      ipoDate: "",
      expectedTradeDate: "2026-09-01",
      ipoWatchOnly: true,
    }))).toMatch(/pre-IPO/i);
  });

  it("devuelve null si chartPreview no alcanza hasta ipoDate", () => {
    expect(ipoDesdeSalidaPct(row({
      ipoDate: "2024-01-01",
      ipoAgeMonths: 18,
      chartPreview: [{ date: "2026-06-04", close: 110 }],
    }))).toBeNull();
    expect(ipoDesdeSalidaAbsenceReason(row({
      ipoDate: "2024-01-01",
      ipoAgeMonths: 18,
      chartPreview: [{ date: "2026-06-04", close: 110 }],
    }))).toMatch(/no alcanza hasta la fecha de salida/i);
  });

  it("no inventa número sin serie ni precio", () => {
    expect(ipoDesdeSalidaPct(row({ chartPreview: [], price: null }))).toBeNull();
    expect(ipoDesdeSalidaAbsenceReason(row({ chartPreview: [] }))).toMatch(/serie de precios/i);
  });
});

describe("compareRowsForSort · ipoDesdeSalidaPct", () => {
  it("ordena por rendimiento descendente y deja sin dato al final", () => {
    const rows = [
      row({ symbol: "LOW", price: 105 }),
      row({ symbol: "HIGH", price: 120 }),
      row({ symbol: "NONE", ipoDate: "", chartPreview: [] }),
    ];
    const sorted = [...rows].sort((a, b) => compareRowsForSort(a, b, { sort: "ipoDesdeSalidaPct" }));
    expect(sorted.map((entry) => entry.symbol)).toEqual(["HIGH", "LOW", "NONE"]);
    expect(ipoDesdeSalidaSortValue(sorted[0])).toBeGreaterThan(ipoDesdeSalidaSortValue(sorted[1]));
    expect(ipoDesdeSalidaSortValue(sorted[2])).toBeNull();
  });
});
