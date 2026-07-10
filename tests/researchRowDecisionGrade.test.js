// Tests del guard assertDecisionGrade en ambos buildResearchRow.
//
// Contrato: buildResearchRow (lib/researchRow.js y el propio de
// lib/materializedScanner.js) es el ensamblador de la fila que sostiene scoring
// y decisiones de inversión. No puede construirse sobre barras sintéticas
// (estimated/missing). El guard es la primera línea de buildResearchRow y
// lanza con el mensaje canónico "Serie estimada excluida de research row".

import { describe, expect, it } from "vitest";
import { buildResearchRow } from "@/lib/researchRow";
import { ESTIMATED_CHART_PROVIDER } from "@/lib/estimatedBars";

// Chart real con barras suficientes para buildResearchRow (>= 20). Su
// dataQuality explícito lo marca decision-grade.
function realChart() {
  const bars = [];
  const base = Date.UTC(2025, 0, 1);
  for (let i = 0; i < 60; i += 1) {
    const date = new Date(base + i * 86400000);
    bars.push({
      date: date.toISOString().slice(0, 10),
      open: 100, high: 105, low: 95, close: 100 + i * 0.1,
      volume: 1_000_000, estimated: false,
    });
  }
  return { bars: bars.reverse(), meta: { regularMarketPrice: 106 }, dataQuality: { status: "real" } };
}

// Chart estimado: dataQuality explícito estimated + barras con estimated:true.
function estimatedChart() {
  return {
    bars: [{ date: "2026-07-01", close: 100, estimated: true }],
    meta: { dataProvider: ESTIMATED_CHART_PROVIDER, estimated: true, regularMarketPrice: 100 },
    dataQuality: { status: "estimated", estimated: true },
  };
}

describe("buildResearchRow (lib/researchRow.js) · guard decision-grade", () => {
  it("construye la fila cuando el chart es decision-grade (real)", () => {
    const row = buildResearchRow("AAPL", realChart(), { name: "Apple" }, false);
    expect(row.symbol).toBe("AAPL");
    expect(row.chartEstimated).toBe(false);
  });

  it("lanza 'Serie estimada excluida de research row' cuando el chart es estimated", () => {
    expect(() => buildResearchRow("AAPL", estimatedChart(), {}, false)).toThrow(
      /Serie estimada excluida de research row/,
    );
  });
});
