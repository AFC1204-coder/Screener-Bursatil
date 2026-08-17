// tests/materializedScannerChartPreviewOrder.test.js
//
// Regresión: el chartPreview del builder nocturno (lib/materializedScanner.js)
// debe salir ASCENDENTE (fecha más antigua primero), igual que el contrato
// (lib/researchRowContract.compactChartPreview). El bug original: la función
// privada homónima tomaba slice(0, 48) de `calcBars`, que normalizeBars ordena
// DESCENDENTE — la miniatura terminaba dibujando el tiempo invertido.

import { describe, expect, it } from "vitest";
import { _forTest as routeC } from "@/lib/materializedScanner";
import { stage2Bars } from "./fixtures.js";

describe("materializedScanner · chartPreview orden", () => {
  const profile = {
    growthMetrics: {
      revenueGrowth: 18, earningsGrowth: 22, grossMargin: 45,
      operatingMargin: 18, profitMargin: 14, ebitdaMargin: 25,
      roe: 20, roa: 8, debtToEquity: 50, currentRatio: 1.5,
    },
  };
  const row = routeC.buildResearchRow("C_STAGE2", { bars: stage2Bars() }, profile, {}, {});

  it("chartPreview viene ordenado por fecha ascendente", () => {
    const dates = row.chartPreview.map((bar) => bar.date);
    const sorted = [...dates].sort();
    expect(dates).toEqual(sorted);
  });

  it("el último punto es el cierre más reciente (coherente con una tendencia alcista)", () => {
    const first = row.chartPreview[0];
    const last = row.chartPreview[row.chartPreview.length - 1];
    expect(last.date >= first.date).toBe(true);
    expect(last.close).toBeGreaterThan(first.close);
  });
});
