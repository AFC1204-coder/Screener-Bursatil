import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const STOCK_CSS = readFileSync(new URL("../styles/stock.css", import.meta.url), "utf8");
const COMPONENTS_CSS = readFileSync(new URL("../styles/components.css", import.meta.url), "utf8");
const STOCK_CLIENT = readFileSync(new URL("../app/stock/[symbol]/StockClient.jsx", import.meta.url), "utf8");

describe("STOCK-FIRE-1 · chart in fold (≤480)", () => {
  it("compacta veredicto y benchmark colapsable en stock.css", () => {
    expect(STOCK_CSS).toMatch(/@media \(max-width: 480px\)[\s\S]*\.stockVerdictHead[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*auto/s);
    expect(STOCK_CSS).toMatch(/\.stockChartBenchmarkFold\s*>?\s*summary/);
    expect(STOCK_CSS).toMatch(/@media \(min-width: 761px\)[\s\S]*\.stockChartBenchmarkFold\s*>?\s*summary[\s\S]*display:\s*none/s);
  });

  it("nota colapsable y chartPrefs horizontal en components.css ≤480", () => {
    expect(COMPONENTS_CSS).toMatch(/@media \(max-width: 480px\)[\s\S]*\.stockPage \.stockDecisionNoteFold/s);
    expect(COMPONENTS_CSS).toMatch(/@media \(max-width: 480px\)[\s\S]*\.stockPage \.chartPrefs\.compact \.chartPrefsLine[\s\S]*flex-direction:\s*row/s);
  });

  it("StockClient expone details para nota, menú de clasificación y benchmark", () => {
    expect(STOCK_CLIENT).toContain("stockDecisionNoteFold");
    expect(STOCK_CLIENT).toContain("stockDecisionActionMenu");
    expect(STOCK_CLIENT).toContain("stockChartBenchmarkFold");
    expect(STOCK_CLIENT).toContain("StockSymbolSearch");
    expect(STOCK_CLIENT).toContain("Nota");
  });
});
