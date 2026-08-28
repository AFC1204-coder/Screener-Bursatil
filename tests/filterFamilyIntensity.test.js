import { describe, expect, it } from "vitest";
import {
  inferFamilyIntensity,
  isFamilyIntensityCustom,
  settingsAtFamilyIntensity,
  settingsMatchFamilyIntensity,
  summarizeFamilyIntensity,
} from "@/lib/filterFamilyIntensity";

describe("filterFamilyIntensity · IPO", () => {
  it("interpola edad y cobertura entre discovery y estricto", () => {
    const open = settingsAtFamilyIntensity("ipo", 0).settings;
    const mid = settingsAtFamilyIntensity("ipo", 50).settings;
    const strict = settingsAtFamilyIntensity("ipo", 100).settings;

    expect(open.maxIpoAgeMonths).toBeGreaterThan(strict.maxIpoAgeMonths);
    expect(mid.maxIpoAgeMonths).toBe(60);
    expect(mid.minDataCoverageScore).toBeGreaterThan(open.minDataCoverageScore);
    expect(mid.minDataCoverageScore).toBeLessThan(strict.minDataCoverageScore);
    expect(open.requireRecentIpo).toBe(true);
    expect(strict.requireRecentIpo).toBe(true);
  });

  it("genera resumen legible en intensidad media", () => {
    const { settings } = settingsAtFamilyIntensity("ipo", 50);
    const summary = summarizeFamilyIntensity("ipo", settings, {});
    expect(summary).toContain("IPO real");
    expect(summary).toContain("edad ≤ 60m");
  });

  it("infiere intensidad exacta en anclas", () => {
    const anchor = settingsAtFamilyIntensity("ipo", 100);
    expect(inferFamilyIntensity(anchor.settings, {}, "ipo")).toBe(100);
  });
});

describe("filterFamilyIntensity · relativeStrength", () => {
  it("mueve RS global y auxiliares en 100", () => {
    const open = settingsAtFamilyIntensity("relativeStrength", 0);
    const mid = settingsAtFamilyIntensity("relativeStrength", 50);
    const top = settingsAtFamilyIntensity("relativeStrength", 100);

    expect(open.settings.minRsRating).toBe(0);
    expect(mid.settings.minRsRating).toBe(55);
    expect(top.settings.minRsRating).toBe(75);
    expect(top.settings.minRsBenchmarkRating).toBe(60);
    expect(top.fieldRules.minRsRating).toBe(true);
    expect(open.fieldRules.minRsRating).toBe(false);
  });

  it("marca personalizado cuando el usuario edita fuera del mapa", () => {
    const base = settingsAtFamilyIntensity("relativeStrength", 50);
    const edited = { ...base.settings, minRsRating: 72 };
    expect(settingsMatchFamilyIntensity(edited, base.fieldRules, "relativeStrength", 50)).toBe(false);
    expect(isFamilyIntensityCustom(edited, base.fieldRules, "relativeStrength", 50)).toBe(true);
  });

  it("resume sin corte RS en intensidad 0", () => {
    const { settings } = settingsAtFamilyIntensity("relativeStrength", 0);
    expect(summarizeFamilyIntensity("relativeStrength", settings, {})).toContain("sin corte RS");
  });
});
