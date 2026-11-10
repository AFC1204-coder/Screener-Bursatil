import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildReviewPageHref, resolvePrimaryReviewStartSymbol } from "@/lib/screenerReviewLaunch";

const rows = [{ symbol: "AAA" }, { symbol: "BBB" }, { symbol: "CCC" }];

describe("resolvePrimaryReviewStartSymbol", () => {
  it("prioriza fila seleccionada en tabla sobre selectedSymbol y primera fila", () => {
    expect(resolvePrimaryReviewStartSymbol({
      selectedResultSymbol: "BBB",
      selectedSymbol: "CCC",
      rows,
    })).toBe("BBB");
  });

  it("usa selectedSymbol cuando no hay fila seleccionada en tabla", () => {
    expect(resolvePrimaryReviewStartSymbol({
      selectedResultSymbol: "",
      selectedSymbol: "CCC",
      rows,
    })).toBe("CCC");
  });

  it("cae a la primera fila visible cuando no hay selección previa", () => {
    expect(resolvePrimaryReviewStartSymbol({
      selectedResultSymbol: "",
      selectedSymbol: "",
      rows,
    })).toBe("AAA");
  });

  it("ignora símbolos fuera de la lista visible", () => {
    expect(resolvePrimaryReviewStartSymbol({
      selectedResultSymbol: "ZZZ",
      selectedSymbol: "YYY",
      rows,
    })).toBe("AAA");
  });

  it("restaura selectedSymbol almacenado cuando la tabla tiene otra fila activa", () => {
    expect(resolvePrimaryReviewStartSymbol({
      selectedResultSymbol: "",
      selectedSymbol: "CCC",
      rows,
    })).toBe("CCC");
  });
});

describe("buildReviewPageHref", () => {
  it("construye la URL de review con source y symbol", () => {
    expect(buildReviewPageHref("DK", "current")).toBe("/review?source=current&symbol=DK");
  });
});

describe("P7 empty-queue launch path", () => {
  it("openReviewPage cae a cola 1 símbolo cuando no hay filas", () => {
    const hook = readFileSync(resolve(import.meta.dirname, "../app/components/screener/useQuickReviewSession.js"), "utf8");
    expect(hook).toContain("persistSingleSymbolReviewQueue");
    expect(hook).toContain("singleSymbolReviewStatus");
    expect(hook).toContain("buildSingleSymbolReviewRow");
  });

  it("review page sintetiza 1 símbolo desde ?symbol= sin cola", () => {
    const reviewPage = readFileSync(resolve(import.meta.dirname, "../app/review/page.jsx"), "utf8");
    expect(reviewPage).toContain("shouldUseSingleSymbolReview");
    expect(reviewPage).toContain("singleSymbolReviewStatus");
    expect(reviewPage).not.toContain("Rapid Review");
    expect(reviewPage).toContain("defaultReviewQueueCollapsed");
    expect(reviewPage).toContain("Vista rápida");
  });

  it("mesa vacía: search Enter navega a ficha", () => {
    const page = readFileSync(resolve(import.meta.dirname, "../app/page.jsx"), "utf8");
    expect(page).toContain("shouldOpenStockFromEmptySearch");
    expect(page).toContain("router.push(stockUrl(picked.symbol))");
  });
});

describe("openPrimaryReview handler", () => {
  it("resuelve símbolo, persiste con openReviewPage y navega con router.push", () => {
    const source = readFileSync(resolve(import.meta.dirname, "../app/page.jsx"), "utf8");
    expect(source).toContain("function openPrimaryReview()");
    expect(source).toContain("resolvePrimaryReviewStartSymbol");
    expect(source).toContain("openReviewPage(filtered, startSymbol)");
    expect(source).toContain("router.push(href)");
  });
});

describe("REVIEW-REFETCH-1 callers", () => {
  it("Vista rápida y el hook de launch no piden el listado /api/scans", () => {
    const reviewPage = readFileSync(resolve(import.meta.dirname, "../app/review/page.jsx"), "utf8");
    const hook = readFileSync(resolve(import.meta.dirname, "../app/components/screener/useQuickReviewSession.js"), "utf8");
    // Sin GET del snapshot de scans desde Review/cola. Las miniaturas del foco
    // van por useReviewChartPreviewHydrate → chart-preview (módulo aparte).
    expect(reviewPage).not.toContain("/api/scans");
    expect(hook).not.toContain("/api/scans");
    expect(hook).toContain("resumeStoredReviewSession");
    expect(reviewPage).toContain("useReviewChartPreviewHydrate");
  });

  it("los GET residuales salen del remount de app/page.jsx, no de Review", () => {
    const page = readFileSync(resolve(import.meta.dirname, "../app/page.jsx"), "utf8");
    expect(page).toContain("restoreLatestSnapshot");
    expect(page).toContain("getLatestScanFromCloud()");
    expect(page).toContain("loadScanForMarketSelection");
    expect(page).toContain("getLatestScanFromCloudForMarkets");
  });

  it("bounce /review→/ persiste settled y evita refetch cloud en remount", () => {
    const page = readFileSync(resolve(import.meta.dirname, "../app/page.jsx"), "utf8");
    expect(page).toContain("shouldSkipCloudSnapshotRestore");
    expect(page).toContain("marketsSelectionSettledKey");
    expect(page).toContain("selectionLoadSettled");
    expect(page).toContain("sessionAutosaveRef.current?.flush()");
  });
});

describe("home Page hook order (FILTER-SESSION-BACK-1 TDZ)", () => {
  it("declara chartSettings useState antes de useQuickReviewSession", () => {
    const page = readFileSync(resolve(import.meta.dirname, "../app/page.jsx"), "utf8");
    const chartSettingsState = page.indexOf("const [chartSettings, setChartSettings] = useState");
    const quickReviewCall = page.indexOf("useQuickReviewSession({");
    expect(chartSettingsState).toBeGreaterThan(-1);
    expect(quickReviewCall).toBeGreaterThan(-1);
    expect(chartSettingsState).toBeLessThan(quickReviewCall);
  });
});
