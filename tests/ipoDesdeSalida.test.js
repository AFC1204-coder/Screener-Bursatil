import { describe, expect, it } from "vitest";
import {
  ipoAnchorFromBars,
  ipoDesdeSalidaAbsenceReason,
  ipoDesdeSalidaAnchorClose,
  ipoDesdeSalidaPct,
  ipoDesdeSalidaSortValue,
} from "@/lib/ipoDiscoveryView";
import { scanLightMetrics } from "@/lib/scanLightProjection";
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

  it("prefiere ancla persistida aunque chartPreview no alcance ipoDate", () => {
    const anchored = row({
      ipoDate: "2024-01-01",
      ipoAgeMonths: 18,
      ipoAnchorClose: 50,
      ipoAnchorDate: "2024-01-02",
      price: 75,
      chartPreview: [{ date: "2026-06-04", close: 110 }],
    });
    expect(ipoDesdeSalidaPct(anchored)).toBe(50);
    expect(ipoDesdeSalidaAnchorClose(anchored)).toMatchObject({ close: 50, date: "2024-01-02" });
    expect(scanLightMetrics(anchored).ipoAnchorClose).toBe(50);
    expect(scanLightMetrics(anchored).ipoAnchorDate).toBe("2024-01-02");
  });

  it("no inventa número sin serie ni precio", () => {
    expect(ipoDesdeSalidaPct(row({ chartPreview: [], price: null }))).toBeNull();
    expect(ipoDesdeSalidaAbsenceReason(row({ chartPreview: [] }))).toMatch(/serie de precios/i);
  });
});

describe("ipoAnchorFromBars", () => {
  const bars = [
    { date: "2026-01-10", close: 120 },
    { date: "2026-01-09", close: 115 },
    { date: "2024-03-21", close: 50 },
    { date: "2024-03-20", close: 48 },
  ];

  it("encuentra el primer cierre usable ≥ ipoDate en serie descendente", () => {
    expect(ipoAnchorFromBars(bars, "2024-03-21")).toEqual({
      ipoAnchorClose: 50,
      ipoAnchorDate: "2024-03-21",
    });
  });

  it("salta al primer día de sesión posterior si ipoDate no está en la serie", () => {
    expect(ipoAnchorFromBars(bars, "2024-03-22")).toEqual({
      ipoAnchorClose: 115,
      ipoAnchorDate: "2026-01-09",
    });
  });

  it("devuelve null sin ipoDate o sin barra en el histórico", () => {
    expect(ipoAnchorFromBars(bars, "")).toBeNull();
    expect(ipoAnchorFromBars(bars, "2030-01-01")).toBeNull();
    expect(ipoAnchorFromBars([], "2024-03-21")).toBeNull();
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
