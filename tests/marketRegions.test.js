// tests/marketRegions.test.js — mapa regional + amplitud por país (MH-FILL-5).

import { describe, expect, it } from "vitest";
import {
  MARKET_REGION_KEYS,
  MARKET_REGIONS,
  filterScanRowsByRegion,
  marketRegionByKey,
  regionalBreadthFromRows,
} from "@/lib/marketRegions";
import { buildRegionalRegimes } from "@/lib/marketRegionalRegimes";

const scanRows = [
  { symbol: "AAPL", country: "US", stage: "stage2", priceAboveSlowMa: true, extSma50: 1, lastDate: "2026-09-05" },
  { symbol: "MSFT", country: "US", stage: "stage2", priceAboveSlowMa: false, extSma50: -2, lastDate: "2026-09-05" },
  { symbol: "SAP", country: "DE", stage: "stage1", priceAboveSlowMa: true, extSma50: 0.5, lastDate: "2026-09-05" },
  { symbol: "7203", country: "JP", stage: "stage3", priceAboveSlowMa: false, extSma50: -1, lastDate: "2026-09-05" },
  { symbol: "0700", country: "HK", stage: "stage4", priceAboveSlowMa: false, extSma50: -3, lastDate: "2026-09-05" },
];

describe("MARKET_REGIONS mapa ETF v1", () => {
  it("expone US/EU/JP/HK con los ETF acordados", () => {
    expect(MARKET_REGION_KEYS).toEqual(["US", "EU", "JP", "HK"]);
    expect(MARKET_REGIONS.US.etf).toBe("SPY");
    expect(MARKET_REGIONS.EU.etf).toBe("FEZ");
    expect(MARKET_REGIONS.JP.etf).toBe("EWJ");
    expect(MARKET_REGIONS.HK.etf).toBe("EWH");
  });

  it("EU usa la lista del panel (incluye GB)", () => {
    expect(MARKET_REGIONS.EU.countries).toContain("GB");
    expect(MARKET_REGIONS.EU.countries).toContain("DE");
  });
});

describe("filterScanRowsByRegion", () => {
  it("filtra por ISO país de la región", () => {
    expect(filterScanRowsByRegion(scanRows, "US").map((row) => row.symbol)).toEqual(["AAPL", "MSFT"]);
    expect(filterScanRowsByRegion(scanRows, "EU").map((row) => row.symbol)).toEqual(["SAP"]);
    expect(filterScanRowsByRegion(scanRows, "JP").map((row) => row.symbol)).toEqual(["7203"]);
    expect(filterScanRowsByRegion(scanRows, "HK").map((row) => row.symbol)).toEqual(["0700"]);
  });

  it("devuelve vacío para clave desconocida", () => {
    expect(filterScanRowsByRegion(scanRows, "XX")).toEqual([]);
    expect(marketRegionByKey("XX")).toBeNull();
  });
});

describe("regionalBreadthFromRows", () => {
  it("declara ausencia cuando la cobertura del campo es baja", () => {
    const euRows = Array.from({ length: 5 }, (_, index) => ({
      symbol: `E${index}`,
      country: "DE",
      stage: "stage2",
      priceAboveSlowMa: index < 2 ? true : undefined,
      extSma50: 1,
      lastDate: "2026-09-05",
    }));
    const breadth = regionalBreadthFromRows(euRows, "EU");
    expect(breadth.population).toBe(5);
    expect(breadth.above30w.available).toBe(false);
    expect(breadth.above30w.reason).toMatch(/cobertura/i);
  });

  it("calcula amplitud MM30s cuando hay cobertura suficiente", () => {
    const usRows = Array.from({ length: 10 }, (_, index) => ({
      symbol: `U${index}`,
      country: "US",
      stage: "stage2",
      priceAboveSlowMa: index < 7,
      extSma50: index < 7 ? 1 : -1,
      lastDate: "2026-09-05",
    }));
    const breadth = regionalBreadthFromRows(usRows, "US");
    expect(breadth.population).toBe(10);
    expect(breadth.above30w.available).toBe(true);
    expect(breadth.above30w.count).toBe(7);
    expect(breadth.above30w.pct).toBe(70);
  });
});

describe("buildRegionalRegimes", () => {
  const stageScoreFn = (state) => (state === "stage2" ? 90 : 10);
  const regimeFn = (score) => ({ label: score >= 75 ? "Alcista" : "Débil", score });

  it("combina ETF + amplitud por región sin score mundial", () => {
    const regimes = buildRegionalRegimes({
      scanRows,
      etfByRegion: {
        US: { stageState: "stage2", stageConfirmation: "confirmed", stage30w: "Etapa 2", lastDate: "2026-09-05" },
        EU: { stageState: "stage1", stageConfirmation: "confirmed", stage30w: "Etapa 1", lastDate: "2026-09-05" },
      },
      etfFailures: { JP: { reason: "Histórico insuficiente" } },
      stageScoreFn,
      regimeFn,
    });

    expect(Object.keys(regimes).sort()).toEqual(["EU", "HK", "JP", "US"]);
    expect(regimes.US.regime.label).toBe("Alcista");
    expect(regimes.US.breadth.population).toBe(2);
    expect(regimes.JP.etfSnapshot).toBeNull();
    expect(regimes.JP.etfFailure.reason).toMatch(/Histórico/i);
    expect(regimes.HK.breadth.population).toBe(1);
  });
});
