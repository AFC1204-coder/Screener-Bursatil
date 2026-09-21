import { describe, expect, it } from "vitest";
import {
  curatedFirdsMarketsInScope,
  isCuratedFallbackUniverseCache,
  isFirdsDependentMarket,
  marketUsesCuratedPopulation,
} from "@/lib/firdsCuratedPopulation";

describe("firdsCuratedPopulation detection", () => {
  it("identifica mercados FIRDS dependientes", () => {
    expect(isFirdsDependentMarket("DE")).toBe(true);
    expect(isFirdsDependentMarket("GB")).toBe(true);
    expect(isFirdsDependentMarket("CH")).toBe(false);
    expect(isFirdsDependentMarket("US")).toBe(false);
  });

  it("detecta curated-fallback en cache", () => {
    expect(isCuratedFallbackUniverseCache({ status: "curated-fallback" })).toBe(true);
    expect(isCuratedFallbackUniverseCache({ status: "supabase" })).toBe(false);
  });

  it("marca mercado ESMA como curado cuando FIRDS off", () => {
    expect(marketUsesCuratedPopulation("DE", { esmaFirdsEnabled: false })).toBe(true);
    expect(marketUsesCuratedPopulation("DE", { esmaFirdsEnabled: true })).toBe(false);
  });

  it("marca GB como curado cuando FCA off o not_configured", () => {
    expect(marketUsesCuratedPopulation("GB", { fcaFirdsEnabled: false })).toBe(true);
    expect(marketUsesCuratedPopulation("GB", {
      fcaFirdsEnabled: true,
      providerDiagnostics: { byMarket: { GB: { status: "not_configured" } } },
    })).toBe(true);
    expect(marketUsesCuratedPopulation("GB", { fcaFirdsEnabled: true })).toBe(false);
  });

  it("curatedFirdsMarketsInScope respeta selección Europa con FIRDS off", () => {
    const markets = curatedFirdsMarketsInScope({
      selectedMarkets: ["DE", "FR", "GB"],
      esmaFirdsEnabled: false,
      fcaFirdsEnabled: false,
    });
    expect(markets).toEqual(["DE", "FR", "GB"]);
  });

  it("no inventa curación si FIRDS on y sin curated-fallback", () => {
    expect(curatedFirdsMarketsInScope({
      selectedMarkets: ["DE"],
      esmaFirdsEnabled: true,
      fcaFirdsEnabled: true,
    })).toEqual([]);
  });
});
