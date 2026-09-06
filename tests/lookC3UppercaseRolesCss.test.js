import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const STOCK_CSS = readFileSync(new URL("../styles/stock.css", import.meta.url), "utf8");
const MARKET_HEALTH_CSS = readFileSync(
  new URL("../styles/market-health.css", import.meta.url),
  "utf8",
);
const COMPONENTS_CSS = readFileSync(new URL("../styles/components.css", import.meta.url), "utf8");

function extractRuleBlock(css, selector) {
  const re = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`);
  const match = re.exec(css);
  expect(match).toBeTruthy();
  const start = match.index;
  const end = css.indexOf("}", start);
  return css.slice(start, end + 1);
}

function countUppercase(css) {
  return (css.match(/text-transform:\s*uppercase/gi) || []).length;
}

describe("LOOK-C3 · uppercase solo en 3 roles (ficha + Mercado)", () => {
  it("stock.css baja uppercase de forma material vs oleada previa (29)", () => {
    const count = countUppercase(STOCK_CSS);
    expect(count).toBeGreaterThanOrEqual(11);
    expect(count).toBeLessThanOrEqual(15);
  });

  it("market-health.css baja uppercase de forma material vs oleada previa (22)", () => {
    const count = countUppercase(MARKET_HEALTH_CSS);
    expect(count).toBeGreaterThanOrEqual(11);
    expect(count).toBeLessThanOrEqual(15);
  });

  it("meta/hints/chrome secundario sin uppercase en ficha y Mercado", () => {
    for (const [css, selector] of [
      [STOCK_CSS, ".stockIdentityKicker"],
      [STOCK_CSS, ".stockVerdictQuoteLabel"],
      [STOCK_CSS, ".stockTechRowLabel"],
      [STOCK_CSS, ".stockChartBenchmarkControl label"],
      [STOCK_CSS, ".stockDescLabel"],
      [MARKET_HEALTH_CSS, ".stageStripZoneName"],
      [MARKET_HEALTH_CSS, ".marketRegionTag"],
      [MARKET_HEALTH_CSS, ".marketAuditKvRow span"],
      [MARKET_HEALTH_CSS, ".sentimentPill"],
      [COMPONENTS_CSS, ".marketReliabilityStripLabel"],
      [COMPONENTS_CSS, ".stockPage .stockReviewFlowMeta span"],
    ]) {
      const block = extractRuleBlock(css, selector);
      expect(block).not.toMatch(/text-transform:\s*uppercase/i);
    }
  });

  it("tres roles permitidos conservan uppercase en stock y Mercado", () => {
    const stockSection = extractRuleBlock(STOCK_CSS, ".stockNarrativeTitle");
    expect(stockSection).toMatch(/text-transform:\s*uppercase/i);
    expect(stockSection).toMatch(/var\(--track-display\)/);

    const stockTh = extractRuleBlock(STOCK_CSS, ".stockAuditBody th");
    expect(stockTh).toMatch(/text-transform:\s*uppercase/i);
    expect(stockTh).toMatch(/var\(--track-label\)/);

    const stockMetric = extractRuleBlock(STOCK_CSS, ".rsMetric span");
    expect(stockMetric).toMatch(/text-transform:\s*uppercase/i);

    const mhPageTitle = extractRuleBlock(MARKET_HEALTH_CSS, ".marketHealthHeader h1");
    expect(mhPageTitle).toMatch(/text-transform:\s*uppercase/i);

    expect(MARKET_HEALTH_CSS).toMatch(
      /\.marketIndexesTable thead th\s*\{[^}]*text-transform:\s*uppercase/i,
    );

    const mhKpi = extractRuleBlock(MARKET_HEALTH_CSS, ".marketRegimeKpi span");
    expect(mhKpi).toMatch(/text-transform:\s*uppercase/i);
    expect(mhKpi).toMatch(/var\(--track-label\)/);
  });

  it("components.css: selectores ficha/Mercado — métricas uppercase, chrome secundario sentence case", () => {
    const metric = extractRuleBlock(COMPONENTS_CSS, ".stockPage .metric span");
    expect(metric).toMatch(/text-transform:\s*uppercase/i);

    const stripToggle = extractRuleBlock(COMPONENTS_CSS, ".marketReliabilityStripToggle");
    expect(stripToggle).not.toMatch(/text-transform:\s*uppercase/i);
  });
});
