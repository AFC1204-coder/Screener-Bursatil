// Verifica la unificación de docs/duplicados-restantes-2026-08-07.md:
// dataCoverageForRow (y sus helpers coveragePct/priceFreshnessForDate) ya no
// son dos copias byte-a-byte en lib/researchRow.js y lib/materializedScanner.js
// (con la única diferencia real de producción: ebitdaMargin presente en la
// lista del camino interactivo, ausente en la del cron) — ambos importan
// ahora la misma función de lib/dataCoverageShared.js.
import { describe, expect, it } from "vitest";
import { dataCoverageForRow as sharedDataCoverageForRow } from "@/lib/dataCoverageShared";
import { dataCoverageForRow as researchRowDataCoverageForRow } from "@/lib/researchRow";
import { _forTest as materializedScannerForTest } from "@/lib/materializedScanner";

const FULL_TECHNICAL_ROW = {
  priceFreshnessOk: true,
  chartBarsCount: 250,
  price: 100, sma50: 95, sma150: 90, sma200: 85, sma200Slope: 1,
  distance20d: -2, distance50d: -5, distance52w: -10, distanceATH: -12,
  highsSpreadPct: 3, perf3m: 5, perf6m: 10, perf12m: 20, extSma50: 5,
  avgVolume: 1000000, avgTurnover: 5000000, latestVolume: 1200000, latestTurnover: 6000000,
  relativeVolume: 1.1, volumeSurgePct: 5, upDownVolRatio: 1.2, volumeEffectScore: 60,
  shortPercentOfFloat: 2, maxDailyMove20dPct: 4, maxDailyRange20dPct: 6, range63dPct: 30,
  volatility63d: 25, maxDrawdown63d: 8, rsRating: 70, rs3m: 5, rs6m: 8, rs12m: 15,
  companyName: "Acme Corp", symbol: "ACME", exchange: "NASDAQ", country: "US", currency: "USD",
  marketCap: 5000000000, sector: "Technology", industry: "Software", website: "https://acme.example",
  ipoDate: "2015-01-01",
};

describe("dataCoverageForRow unificado", () => {
  it("las tres vías de acceso (dataCoverageShared, researchRow, materializedScanner._forTest) son la MISMA función", () => {
    expect(researchRowDataCoverageForRow).toBe(sharedDataCoverageForRow);
    expect(materializedScannerForTest.dataCoverageForRow).toBe(sharedDataCoverageForRow);
  });

  it("con ebitdaMargin presente, el camino que antes era el cron da ahora el mismo fundamentalCoverageScore que el interactivo (antes divergían)", () => {
    const profile = {
      businessSummary: "Acme hace cosas.",
      growthMetrics: {
        revenueGrowth: 10, earningsGrowth: 8, grossMargin: 40, operatingMargin: 20,
        profitMargin: 15, ebitdaMargin: 25, roe: 18, roa: 9, debtToEquity: 30,
        currentRatio: 1.5, institutionalOwnership: 60, insiderOwnership: 5, shortPercentOfFloat: 2,
      },
    };
    // Antes del fix: materializedScanner.js tenía su propia copia SIN
    // ebitdaMargin en la lista (12 campos en vez de 13) — con los 13 campos
    // presentes, ambas daban 100% de todas formas (12/12 y 13/13 redondean
    // igual); la divergencia real aparecía cuando algo faltaba (ver el
    // siguiente test). Este primer caso confirma que la vía "cron" (ahora
    // delegando en la compartida) coincide con la "interactiva" incluso
    // cuando ebitdaMargin SÍ está presente.
    const viaShared = sharedDataCoverageForRow(FULL_TECHNICAL_ROW, profile);
    const viaResearchRow = researchRowDataCoverageForRow(FULL_TECHNICAL_ROW, profile);
    const viaMaterialized = materializedScannerForTest.dataCoverageForRow(FULL_TECHNICAL_ROW, profile);
    expect(viaResearchRow).toEqual(viaShared);
    expect(viaMaterialized).toEqual(viaShared);
    expect(viaShared.fundamentalCoverageScore).toBe(100);
  });

  it("con ebitdaMargin AUSENTE y el resto de fundamentales presentes: la divergencia real que existía antes del fix ya no puede reproducirse — las dos vías dan el mismo fundamentalCoverageScore más bajo (12 de 13 campos)", () => {
    const profile = {
      businessSummary: "Acme hace cosas.",
      growthMetrics: {
        revenueGrowth: 10, earningsGrowth: 8, grossMargin: 40, operatingMargin: 20,
        profitMargin: 15, ebitdaMargin: null, roe: 18, roa: 9, debtToEquity: 30,
        currentRatio: 1.5, institutionalOwnership: 60, insiderOwnership: 5, shortPercentOfFloat: 2,
      },
    };
    const viaResearchRow = researchRowDataCoverageForRow(FULL_TECHNICAL_ROW, profile);
    const viaMaterialized = materializedScannerForTest.dataCoverageForRow(FULL_TECHNICAL_ROW, profile);
    // 12 de 13 campos de fundamentalCoverageScore presentes -> round(12/13*100) = 92.
    expect(viaResearchRow.fundamentalCoverageScore).toBe(92);
    // Antes del fix, materializedScanner.js NO contaba ebitdaMargin en absoluto
    // (12/12 = 100, no 92) — esta aserción es justo la que habría fallado con
    // el código viejo, y confirma que la copia del cron ya no existe.
    expect(viaMaterialized.fundamentalCoverageScore).toBe(92);
    expect(viaMaterialized).toEqual(viaResearchRow);
  });
});
