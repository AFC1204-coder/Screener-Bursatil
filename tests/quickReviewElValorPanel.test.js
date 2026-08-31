// CHART-QR-3 — panel «El valor» debe pintar Etapa/RS/Cap/Dist en el HTML.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import QuickReviewModal from "@/app/components/screener/QuickReviewModal";

vi.mock("lightweight-charts", () => ({
  createChart: () => null,
  CandlestickSeries: class {},
  LineSeries: class {},
  AreaSeries: class {},
  HistogramSeries: class {},
  createSeriesMarkers: () => {},
  PriceScaleMode: { Normal: 0, Logarithmic: 1, Percentage: 2 },
}));

function amplRow(overrides = {}) {
  return {
    symbol: "AMPL",
    companyName: "Amplitude",
    currency: "USD",
    country: "US",
    marketCap: 1_800_000_000,
    distance52w: -12.5,
    weeklyRsAvailable: true,
    weeklyRsRating: 95,
    weeklyStageState: "stage2",
    weeklyStageLabel: "Stage 2",
    latestTurnover: 50_000_000,
    volumeSurgePct: 10,
    upDownVolRatio: 1.2,
    shortPercentOfFloat: 3,
    maxDrawdown63d: 20,
    volatility63d: 40,
    sector: "Technology",
    industry: "Software",
    theme: "Software / IA",
    ...overrides,
  };
}

function renderModal(row = amplRow()) {
  return renderToStaticMarkup(React.createElement(QuickReviewModal, {
    activeModalRow: row,
    chartSettings: {},
    modalActiveResolution: null,
    modalDecisionResolutions: {},
    modalReviewPosition: 0,
    modalReviewRows: [row],
    modalOriginLabel: "Screener",
    closeQuickReview: () => {},
    moveQuickReview: () => {},
    reopenQuickReviewDecision: () => {},
    resolveQuickReviewDecision: () => {},
    saveQuickReviewStockOpen: () => {},
    updateChartScope: () => {},
    updateChartSettings: () => {},
  }));
}

describe("CHART-QR-3 · panel El valor", () => {
  it("renderiza Etapa, RS, Cap y Dist. máx 52s con texto no vacío", () => {
    const html = renderModal();
    const start = html.indexOf(">El valor<");
    expect(start).toBeGreaterThan(-1);
    const end = html.indexOf("Sostén", start);
    const block = html.slice(start, end > start ? end : start + 2500);
    console.log("EL_VALOR_BLOCK\n", block);

    expect(block).toMatch(/<span>Etapa<\/span><b>[^<]+<\/b>/);
    expect(block).toMatch(/<span>RS<\/span><b[^>]*>[^<]+<\/b>/);
    expect(block).toMatch(/<span>Capitalización<\/span><b>[^<]+<\/b>/);
    expect(block).toMatch(/<span>Dist\. máx 52s<\/span><b>[^<]+<\/b>/);
    expect(block).toContain("Etapa 2");
    expect(block).toContain("95");
  });
});
