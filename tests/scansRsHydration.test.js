import { describe, expect, it } from "vitest";
import {
  attachWeeklyCountryRs,
  countryRs,
  COUNTRY_RS_NOT_HYDRATED_REASON,
} from "@/lib/countryRs";
import {
  attachWeeklyThemeRs,
  themeRs,
  THEME_RS_NOT_HYDRATED_REASON,
} from "@/lib/themeRs";
import { scanRsHydrationMode } from "@/lib/scansRsHydration";

// Campos de RS país/tema que el catálogo de mesa usa hoy (lib/scanLightProjection.js,
// lib/screenerColumns.jsx). Solo se rellenan con hidratación extended.
export const RS_EXTENDED_ROW_FIELDS = ["weeklyCountryRsRating", "weeklyThemeRsRating"];

describe("scanRsHydrationMode · PERF-NAC", () => {
  it("compacto de mesa usa hidratación core (sin país/tema)", () => {
    expect(scanRsHydrationMode()).toBe("core");
    expect(scanRsHydrationMode({ full: false, decisionProjection: false })).toBe("core");
  });

  it("full y decision projection piden extended", () => {
    expect(scanRsHydrationMode({ full: true })).toBe("extended");
    expect(scanRsHydrationMode({ decisionProjection: true })).toBe("extended");
  });

  it("hydrateRs query param fuerza modo", () => {
    expect(scanRsHydrationMode({ hydrateRsParam: "1" })).toBe("extended");
    expect(scanRsHydrationMode({ hydrateRsParam: "0" })).toBe("core");
    expect(scanRsHydrationMode({ hydrateRsParam: "extended" })).toBe("extended");
    expect(scanRsHydrationMode({ hydrateRsParam: "core" })).toBe("core");
  });
});

describe("contrato core vs extended · campos de fila de mesa", () => {
  const baseRow = {
    symbol: "NVDA",
    country: "US",
    sector: "Technology",
    industry: "Semiconductors",
    theme: "Semis / fotonica",
  };

  it("documenta los campos extended del catálogo", () => {
    expect(RS_EXTENDED_ROW_FIELDS).toEqual(["weeklyCountryRsRating", "weeklyThemeRsRating"]);
  });

  it("core: fila sin hidratar no expone ratings país/tema", () => {
    expect(baseRow.weeklyCountryRsRating).toBeUndefined();
    expect(baseRow.weeklyThemeRsRating).toBeUndefined();
    expect(countryRs(baseRow).available).toBe(false);
    expect(countryRs(baseRow).reason).toBe(COUNTRY_RS_NOT_HYDRATED_REASON);
    expect(themeRs(baseRow).available).toBe(false);
    expect(themeRs(baseRow).reason).toBe(THEME_RS_NOT_HYDRATED_REASON);
  });

  it("extended: hidratación país/tema rellena weeklyCountryRsRating y weeklyThemeRsRating", () => {
    const withCountry = attachWeeklyCountryRs(
      baseRow,
      new Map([["NVDA", {
        available: true,
        rsRating: 72,
        rsRaw: 0.42,
        rank: 18,
        sampleSize: 312,
        asOf: "2026-08-01",
        weekKey: "2026-W31",
        engineVersion: "statsedge-private-country-rs-us-v1",
      }]]),
    );
    const withBoth = attachWeeklyThemeRs(
      withCountry,
      new Map([["NVDA", {
        available: true,
        rsRating: 84,
        rsRaw: 0.55,
        rank: 9,
        sampleSize: 142,
        asOf: "2026-08-01",
        weekKey: "2026-W31",
        engineVersion: "statsedge-private-theme-rs-usd-semis-fotonica-v1",
        themeKey: "Semis / fotonica",
      }]]),
    );

    expect(withBoth.weeklyCountryRsRating).toBe(72);
    expect(withBoth.weeklyThemeRsRating).toBe(84);
    expect(countryRs(withBoth).available).toBe(true);
    expect(countryRs(withBoth).value).toBe(72);
    expect(themeRs(withBoth).available).toBe(true);
    expect(themeRs(withBoth).value).toBe(84);
  });
});
