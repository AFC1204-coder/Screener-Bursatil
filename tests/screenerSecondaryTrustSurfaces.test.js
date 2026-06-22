import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LeaderTape, PreviewCard } from "@/app/screenerPanels";

function visibleText(html = "") {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

const auditedRow = {
  symbol: "TRST",
  companyName: "Trust Surface Corp",
  exchange: "NASDAQ",
  price: 42,
  currency: "USD",
  chartBarsCount: 260,
  priceFreshnessOk: true,
  dataCoverageScore: 88,
  technicalCoverageScore: 91,
  fundamentalCoverageScore: 70,
  objectiveScore: 76,
  totalScore: 74.56,
  compositeScore: 74.56,
  setupQualityScore: 80,
  demandScore: 70,
  rsGlobalPct: 88,
  rsSectorPct: 74,
  rsQualityScore: 72,
  sectorScore: 75,
  growthScore: 70,
  riskRewardScore: 72,
  riskScore: 62,
  momentumScore: 58,
  ipoScore: 20,
  volumeEffectScore: 76,
  adProxyScore: 64,
  epsGrowthProxyScore: 68,
  benchmarkSymbol: "SPY",
  setupDisplayPlanValid: true,
  objectiveMetricAudit: {
    status: "verified",
    verifiedCount: 3,
    traceableCount: 2,
    issues: [],
    items: [
      { key: "objectiveScore", label: "Score objetivo", status: "verified", severity: "neutral", proxy: false },
      { key: "rsGlobalPct", label: "RS global", status: "verified", severity: "neutral", proxy: false },
      { key: "adProxyScore", label: "A/D proxy", status: "traceable", severity: "neutral", proxy: true },
      { key: "epsGrowthProxyScore", label: "EPS proxy", status: "traceable", severity: "neutral", proxy: true },
    ],
  },
};

describe("secondary screener trust surfaces", () => {
  it("mantiene firma compacta en tarjetas de resultado sin texto largo visible", () => {
    const html = renderToStaticMarkup(React.createElement(PreviewCard, {
      variant: "search",
      row: auditedRow,
    }));
    const visible = visibleText(html);

    expect(html).toContain("previewTrustSignature");
    expect(visible).toContain("Obj 2");
    expect(visible).toContain("p 2");
    expect(visible).toContain("!");
    expect(visible).toContain("x");
    expect(visible).not.toContain("proxy/estimadas");
  });

  it("mantiene firma compacta en la cinta de líderes", () => {
    const html = renderToStaticMarkup(React.createElement(LeaderTape, {
      rows: [auditedRow],
      activeRow: auditedRow,
      onSelect: () => {},
      favoriteSymbols: new Set(),
    }));
    const visible = visibleText(html);

    expect(html).toContain("leaderTrustSignature");
    expect(visible).toContain("TRST");
    expect(visible).toContain("Obj 2");
    expect(visible).toContain("p 2");
  });
});
