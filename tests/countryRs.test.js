import { describe, expect, it } from "vitest";

import {
  attachWeeklyCountryRs,
  countryRs,
  COUNTRY_RS_MARKET_UNSUPPORTED_REASON,
} from "@/lib/countryRs";
import {
  canonicalRsEngineVersion,
  countryRsEngineVersionForMarket,
  intlCountryRsEngineVersion,
  PRIVATE_GLOBAL_RS_ENGINE_VERSION,
  US_COUNTRY_RS_ENGINE_VERSION,
} from "@/lib/rsEngines";
import { attachWeeklyRs } from "@/lib/globalRs";
import { scoreWeakness } from "@/lib/scoring";

describe("countryRs lector", () => {
  it("no usa rsCountryPct del batch como rating país", () => {
    const row = {
      symbol: "0700.HK",
      country: "HK",
      rsCountryPct: 97,
      weeklyCountryRsAvailable: true,
      weeklyCountryRsRating: 41,
      weeklyCountryRsWeekKey: "2026-W35",
      weeklyCountryRsSampleSize: 76,
      weeklyCountryRsEngineVersion: intlCountryRsEngineVersion("HK"),
    };
    const crs = countryRs(row);
    expect(crs.available).toBe(true);
    expect(crs.value).toBe(41);
    expect(crs.value).not.toBe(97);
  });

  it("ausencia hidratada no cae al percentil del lote", () => {
    const row = attachWeeklyCountryRs(
      { symbol: "AAPL", rsCountryPct: 88, objectiveScore: 70 },
      new Map([["AAPL", { available: false, reason: "Sin RS país semanal", exclusionReason: "insufficient-bars" }]]),
    );
    expect(row.rsCountryPct).toBe(88);
    expect(countryRs(row).available).toBe(false);
    expect(countryRs(row).value).toBe(null);
  });

  it("mercado no soportado devuelve motivo market-not-supported", () => {
    const crs = countryRs({ symbol: "PETR4.SA", country: "BR" });
    expect(crs.available).toBe(false);
    expect(crs.reason).toBe(COUNTRY_RS_MARKET_UNSUPPORTED_REASON);
  });

  it("US país usa engine statsedge-us-equity-rs-v1", () => {
    expect(US_COUNTRY_RS_ENGINE_VERSION).toBe("statsedge-us-equity-rs-v1");
    expect(countryRsEngineVersionForMarket("US")).toBe(US_COUNTRY_RS_ENGINE_VERSION);
  });
});

describe("pin global intacto", () => {
  it("canonicalRsEngineVersion sigue en motor global privado", () => {
    expect(canonicalRsEngineVersion()).toBe(PRIVATE_GLOBAL_RS_ENGINE_VERSION);
    expect(canonicalRsEngineVersion()).not.toBe(US_COUNTRY_RS_ENGINE_VERSION);
    expect(canonicalRsEngineVersion()).not.toBe(intlCountryRsEngineVersion("HK"));
  });
});

describe("scoring untouched", () => {
  it("attachWeeklyCountryRs no toca objectiveScore ni rsCountryPct batch", () => {
    const original = {
      symbol: "MAR",
      rsCountryPct: 88,
      objectiveScore: 71,
      compositeScore: 64,
      totalScore: 68,
    };
    const row = attachWeeklyCountryRs(original, new Map([["MAR", {
      available: true,
      rsRating: 55,
      rsRaw: 100,
      rank: 200,
      sampleSize: 4868,
      asOf: "2026-08-29",
      weekKey: "2026-W35",
      engineVersion: US_COUNTRY_RS_ENGINE_VERSION,
    }]]));
    expect(row.rsCountryPct).toBe(88);
    expect(row.objectiveScore).toBe(71);
    expect(scoreWeakness(row).weaknessScore).toBe(scoreWeakness(original).weaknessScore);
    expect(countryRs(row).value).toBe(55);
  });

  it("attachWeeklyRs + attachWeeklyCountryRs no mueven scores", () => {
    const base = { symbol: "MU", rsGlobalPct: 90, objectiveScore: 60 };
    const globalRow = attachWeeklyRs(base, new Map([["MU", {
      available: true,
      rsRating: 71,
      engineVersion: PRIVATE_GLOBAL_RS_ENGINE_VERSION,
    }]]));
    const row = attachWeeklyCountryRs(globalRow, new Map([["MU", {
      available: true,
      rsRating: 44,
      engineVersion: US_COUNTRY_RS_ENGINE_VERSION,
    }]]));
    expect(row.rsGlobalPct).toBe(90);
    expect(row.objectiveScore).toBe(60);
  });
});
