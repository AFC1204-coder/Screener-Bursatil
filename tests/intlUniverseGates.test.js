import { describe, expect, it } from "vitest";
import {
  INTL_UNIVERSE_GATE_THRESHOLDS,
  intlBroadPerMarketLimit,
  intlUniverseGateRejectReason,
  isOfficialBroadMarket,
  officialBroadMarketFromList,
} from "@/lib/intlUniverseGates";
import { _forTest } from "@/lib/materializedScanner";

const { baseRejectReason } = _forTest;

describe("intlUniverseGates", () => {
  it("identifica mercados piloto HK y CA", () => {
    expect(isOfficialBroadMarket("HK")).toBe(true);
    expect(isOfficialBroadMarket("CA")).toBe(true);
    expect(isOfficialBroadMarket("JP")).toBe(false);
    expect(officialBroadMarketFromList(["HK"])).toBe("HK");
    expect(officialBroadMarketFromList(["CA"])).toBe("CA");
    expect(officialBroadMarketFromList(["JP"])).toBe("");
    expect(officialBroadMarketFromList(["HK", "US"])).toBe("");
  });

  it("intlBroadPerMarketLimit devuelve valor en rango 72–96 por defecto", () => {
    const limit = intlBroadPerMarketLimit();
    expect(limit).toBeGreaterThanOrEqual(72);
    expect(limit).toBeLessThanOrEqual(96);
  });

  it("rechaza fila errática con liquidez baja", () => {
    const row = {
      symbol: "9999.HK",
      country: "HK",
      maxDailyMove20dPct: 18,
      avgTurnover: 200000,
      liquidityScore: 40,
    };
    expect(intlUniverseGateRejectReason(row, "HK")).toMatch(/movimiento errático/);
  });

  it("rechaza fila con liquidityScore bajo tras pasar turnover marginal", () => {
    const row = {
      symbol: "0700.HK",
      country: "HK",
      liquidityScore: 12,
      maxDailyMove20dPct: 5,
      avgTurnover: 800000,
    };
    expect(intlUniverseGateRejectReason(row, "HK")).toMatch(/liquidez baja score/);
  });

  it("deja pasar fila normal HK", () => {
    const row = {
      symbol: "0700.HK",
      country: "HK",
      liquidityScore: 55,
      maxDailyMove20dPct: 6,
      avgTurnover: 5000000,
    };
    expect(intlUniverseGateRejectReason(row, "HK")).toBe("");
  });

  it("no aplica gates US", () => {
    const row = {
      symbol: "AAPL",
      country: "US",
      liquidityScore: 5,
      maxDailyMove20dPct: 25,
      avgTurnover: 10000,
    };
    expect(intlUniverseGateRejectReason(row, "US")).toBe("");
  });

  it("baseRejectReason integra gates intl solo en mercados piloto", () => {
    const baseOk = {
      price: 50,
      chartBarsCount: 200,
      priceFreshnessOk: true,
      avgTurnover: 800000,
      marketCap: 5000000000,
      dataCoverageScore: 60,
    };
    const erratic = {
      ...baseOk,
      symbol: "9999.HK",
      country: "HK",
      liquidityScore: 40,
      maxDailyMove20dPct: 20,
      avgTurnover: 300000,
    };
    expect(baseRejectReason(erratic, { market: "HK" })).toMatch(/movimiento errático/);
    expect(baseRejectReason({ ...erratic, country: "US" }, { market: "US" })).toBe("");
  });

  it("expone umbrales HK/CA en mapa único", () => {
    expect(INTL_UNIVERSE_GATE_THRESHOLDS.HK.minLiquidityScore).toBe(25);
    expect(INTL_UNIVERSE_GATE_THRESHOLDS.CA.maxErraticDailyMovePct).toBe(14);
  });
});
