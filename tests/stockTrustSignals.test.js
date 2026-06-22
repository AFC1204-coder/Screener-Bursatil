import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import StockClient from "@/app/stock/[symbol]/StockClient";
import UniversalPriceChart from "@/app/UniversalPriceChart";
import { DEFAULT_CHART_SETTINGS } from "@/lib/chartSettings";

function bars(count = 260) {
  const start = Date.UTC(2025, 0, 1);
  return Array.from({ length: count }, (_, index) => {
    const close = 90 + index * 0.16;
    return {
      date: new Date(start + index * 86400000).toISOString().slice(0, 10),
      open: close * 0.99,
      high: close * 1.02,
      low: close * 0.98,
      close,
      volume: 900000 + index * 1200,
    };
  });
}

const vcpPattern = {
  patternDataStatus: "partial_volume",
  patternBarsCount: 260,
  patternMinBars: 90,
  patternEligible: true,
  patternVolumeEligible: false,
  consolidationCandidate: true,
  baseDepthPct: 18,
  baseWeeks: 9,
  contractionDepths: [20, 10],
  contractionCount: 2,
  contractionsDecreasing: true,
  contractionStructureStatus: "ok",
  volumeDryUpRatio: 1.05,
  distanceToPivotPct: 5,
  lastContractionDepthPct: 10,
  tightness10dPct: 14,
  tightness20dPct: 16,
  patternQualityScore: 60,
  pivotPrice: 132,
};

describe("stock trust signals", () => {
  it("marca métricas actuales como medidas, proxy o revisión sin texto largo visible", () => {
    const html = renderToStaticMarkup(React.createElement(StockClient, {
      initialSymbol: "TRUST",
      initialData: {
        name: "Trust Signals Inc.",
        currency: "USD",
        exchange: "NYSE",
        sector: "Technology",
        industry: "Software",
        country: "United States",
        marketCap: 12000000000,
        quoteSnapshot: { price: 131.44 },
        chartBars: bars(),
        dataQuality: {
          freshness: { priceDate: "2025-09-17", rsGlobalAsOf: "2025-09-17", rsGlobalSample: 10 },
          coverage: { label: "Cobertura parcial" },
        },
        relativeStrength: {
          rsGlobalPct: 82,
          rsGlobalSample: 10,
          rsCountryPct: 72,
          rsCountrySample: 4,
          rsSectorPct: 69,
          rsSectorSample: 3,
          benchmarkSymbol: "SPY",
          benchmarkRating: 58,
          rs3m: 12,
          rs6m: 18,
          rs12m: 24,
          rsQualityScore: 62,
          speculationRiskScore: 44,
          volatility63d: 28,
          maxDrawdown63d: 11,
          perf3m: 16,
          distance52w: -7,
        },
        growthMetrics: { revenueGrowth: 22, earningsGrowth: 15 },
        valuationMetrics: { sharesOutstanding: 100000000 },
        earningsCalendar: {
          earningsDate: "2025-10-20",
          epsEstimate: 1.24,
          epsEstimateGrowth: 18,
          revenueEstimate: 2400000000,
          revenueEstimateGrowth: 21,
        },
        stage: { label: "Etapa 2 probable" },
        setupPattern: vcpPattern,
        financialResults: { incomeQuarterly: [], incomeAnnual: [] },
        links: {},
        news: [],
      },
    }));

    expect(html).toContain("source-proxy");
    expect(html).toContain("source-review");
    expect(html).toContain("RS Quality: proxy/estimada");
    expect(html).toContain("EPS YoY: proxy/estimada");
    expect(html).toContain("RS: revisar");
    expect(html).toContain("auditCheck warn source-review");
  });

  it("compacta el diagnóstico VCP del gráfico en gates con marcas", () => {
    const html = renderToStaticMarkup(React.createElement(UniversalPriceChart, {
      bars: bars(),
      symbol: "TRUST",
      settings: DEFAULT_CHART_SETTINGS,
      patternOverlay: vcpPattern,
      showPatternDiagnostics: true,
    }));

    expect(html).toContain("vcpDiagnosticPanel");
    expect(html).not.toContain("vcpDiagnosticObjective");
    expect(html).toContain("vcpGate watch");
    expect(html).toContain(">!</i>");
  });
});
