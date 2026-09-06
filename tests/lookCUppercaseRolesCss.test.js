import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SCREENER_CSS = readFileSync(new URL("../styles/screener.css", import.meta.url), "utf8");
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

describe("LOOK-C2 · uppercase solo en 3 roles (screener home)", () => {
  it("screener.css baja uppercase de forma material vs oleada previa (~85)", () => {
    const count = countUppercase(SCREENER_CSS);
    expect(count).toBeGreaterThanOrEqual(18);
    expect(count).toBeLessThanOrEqual(26);
  });

  it("meta/hints/chips secundarios sin uppercase", () => {
    for (const selector of [
      ".layerControlMeta",
      ".scanStatusBar span",
      ".huntCardModeBadge",
      ".decisionSummaryChip span",
      ".screenerContractStats em",
      ".filterFamilyHeader span",
    ]) {
      const block = extractRuleBlock(SCREENER_CSS, selector);
      expect(block).not.toMatch(/text-transform:\s*uppercase/i);
    }
  });

  it("tres roles permitidos conservan uppercase + tracking", () => {
    const section = extractRuleBlock(SCREENER_CSS, ".marketPanelHead span");
    expect(section).toMatch(/text-transform:\s*uppercase/i);
    expect(section).toMatch(/letter-spacing:/);

    expect(SCREENER_CSS).toMatch(/\.compactResultsTable th\s*\{[^}]*text-transform:\s*uppercase/i);

    const metricBlock = SCREENER_CSS.match(/\n\.compactMetric small\s*\{[^}]*\}/)?.[0] ?? "";
    expect(metricBlock).toMatch(/text-transform:\s*uppercase/i);
    expect(metricBlock).toMatch(/var\(--track-label\)/);

    const heroMetric = extractRuleBlock(SCREENER_CSS, ".globalCoverageMetricLabel");
    expect(heroMetric).toMatch(/text-transform:\s*uppercase/i);
    expect(heroMetric).toMatch(/var\(--track-label\)/);
  });

  it("components.css: h2 genérico sentence case; sectionTitle/table/metric label uppercase", () => {
    expect(COMPONENTS_CSS).toMatch(/\nh2\s*\{[^}]*text-transform:\s*none/i);

    const sectionH2 = extractRuleBlock(COMPONENTS_CSS, ".sectionTitle h2");
    expect(sectionH2).toMatch(/text-transform:\s*uppercase/i);

    const tableTh = extractRuleBlock(COMPONENTS_CSS, ".table th");
    expect(tableTh).toMatch(/text-transform:\s*uppercase/i);

    const metricSmall = extractRuleBlock(COMPONENTS_CSS, ".compactMetric small");
    expect(metricSmall).toMatch(/text-transform:\s*uppercase/i);
  });
});
