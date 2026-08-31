import { describe, expect, it } from "vitest";

import {
  attachWeeklyThemeRs,
  themeRs,
  THEME_RS_NOT_HYDRATED_REASON,
} from "@/lib/themeRs";
import {
  canonicalRsEngineVersion,
  PRIVATE_GLOBAL_RS_ENGINE_VERSION,
  themeRsEngineVersion,
  themeRsSlug,
  US_COUNTRY_RS_ENGINE_VERSION,
} from "@/lib/rsEngines";
import { rankableThemeKeys } from "@/lib/themeRsAssign";
import { attachWeeklyRs } from "@/lib/globalRs";
import { scoreWeakness } from "@/lib/scoring";

describe("themeRs lector", () => {
  it("no usa rsSectorPct del batch como rating tema", () => {
    const row = {
      symbol: "NVDA",
      sector: "Technology",
      industry: "Semiconductors",
      theme: "Semis / fotonica",
      rsSectorPct: 97,
      weeklyThemeRsAvailable: true,
      weeklyThemeRsRating: 88,
      weeklyThemeRsWeekKey: "2026-W35",
      weeklyThemeRsSampleSize: 142,
      weeklyThemeRsThemeKey: "Semis / fotonica",
      weeklyThemeRsEngineVersion: themeRsEngineVersion("Semis / fotonica"),
    };
    const trs = themeRs(row);
    expect(trs.available).toBe(true);
    expect(trs.value).toBe(88);
    expect(trs.value).not.toBe(97);
  });

  it("residual no hidratado devuelve theme-residual", () => {
    const row = {
      symbol: "X",
      sector: "Basic Materials",
      industry: "Chemicals",
      theme: "Basic Materials",
    };
    const trs = themeRs(row);
    expect(trs.available).toBe(false);
    expect(trs.reason).toContain("residual");
  });

  it("perfil vacío devuelve theme-profile-missing", () => {
    const trs = themeRs({ symbol: "X", sector: "", industry: "", theme: "" });
    expect(trs.available).toBe(false);
    expect(trs.reason).toContain("sector/industria");
  });

  it("sin hidratar devuelve motivo de vista", () => {
    const trs = themeRs({
      symbol: "NVDA",
      sector: "Technology",
      industry: "Semiconductors",
      theme: "Semis / fotonica",
    });
    expect(trs.available).toBe(false);
    expect(trs.reason).toBe(THEME_RS_NOT_HYDRATED_REASON);
  });

  it("fila ligera con theme curado (sin sector) sigue siendo rankeable para hidratar", () => {
    const row = {
      symbol: "MSFT",
      theme: "Software / IA",
      weeklyThemeRsAvailable: true,
      weeklyThemeRsRating: 64,
      weeklyThemeRsThemeKey: "Software / IA",
      weeklyThemeRsSampleSize: 570,
    };
    const trs = themeRs(row);
    expect(trs.available).toBe(true);
    expect(trs.value).toBe(64);
    expect(trs.themeKey).toBe("Software / IA");
  });
});

describe("themeRsEngineVersion slug", () => {
  it("genera slugs únicos para las 12 keys", () => {
    const slugs = rankableThemeKeys().map((key) => themeRsSlug(key));
    expect(new Set(slugs).size).toBe(12);
    expect(themeRsEngineVersion("Semis / fotonica")).toBe("statsedge-private-theme-rs-usd-semis-fotonica-v1");
    expect(themeRsEngineVersion("Software / IA")).toBe("statsedge-private-theme-rs-usd-software-ia-v1");
    expect(themeRsEngineVersion("General")).toBe("");
    expect(themeRsEngineVersion("Basic Materials")).toBe("");
  });
});

describe("pin global intacto", () => {
  it("canonicalRsEngineVersion sigue en motor global privado", () => {
    expect(canonicalRsEngineVersion()).toBe(PRIVATE_GLOBAL_RS_ENGINE_VERSION);
    expect(canonicalRsEngineVersion()).not.toBe(themeRsEngineVersion("Software / IA"));
    expect(canonicalRsEngineVersion()).not.toBe(US_COUNTRY_RS_ENGINE_VERSION);
  });
});

describe("scoring untouched", () => {
  it("attachWeeklyThemeRs no toca objectiveScore ni rsSectorPct batch", () => {
    const original = {
      symbol: "NVDA",
      rsSectorPct: 88,
      objectiveScore: 71,
      sector: "Technology",
      industry: "Semiconductors",
      theme: "Semis / fotonica",
    };
    const row = attachWeeklyThemeRs(original, new Map([["NVDA", {
      available: true,
      rsRating: 91,
      rsRaw: 100,
      rank: 12,
      sampleSize: 140,
      asOf: "2026-08-29",
      weekKey: "2026-W35",
      engineVersion: themeRsEngineVersion("Semis / fotonica"),
      themeKey: "Semis / fotonica",
    }]]));
    expect(row.rsSectorPct).toBe(88);
    expect(row.objectiveScore).toBe(71);
    expect(scoreWeakness(row).weaknessScore).toBe(scoreWeakness(original).weaknessScore);
    expect(themeRs(row).value).toBe(91);
  });

  it("attachWeeklyRs + attachWeeklyThemeRs no mueven scores", () => {
    const base = { symbol: "MU", rsGlobalPct: 90, objectiveScore: 60, sector: "Technology", industry: "Semiconductors", theme: "Semis / fotonica" };
    const globalRow = attachWeeklyRs(base, new Map([["MU", {
      available: true,
      rsRating: 71,
      engineVersion: PRIVATE_GLOBAL_RS_ENGINE_VERSION,
    }]]));
    const row = attachWeeklyThemeRs(globalRow, new Map([["MU", {
      available: true,
      rsRating: 92,
      engineVersion: themeRsEngineVersion("Semis / fotonica"),
      themeKey: "Semis / fotonica",
    }]]));
    expect(row.rsGlobalPct).toBe(90);
    expect(row.objectiveScore).toBe(60);
  });
});
