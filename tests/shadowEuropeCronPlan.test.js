import { describe, expect, it } from "vitest";
import {
  SHADOW_EUROPE_CRON_GROUPS,
  expandedShadowEuropeCronGroups,
  shadowEuropeCronGroupAt,
  shadowEuropeCronGroupByKey,
} from "@/lib/cronPlan";

const THIN_SECONDARY_MARKETS = ["AT", "BE", "IE", "PT"];

describe("shadow-europe cron plan", () => {
  it("la unión de markets incluye AT, BE, IE y PT", () => {
    const groups = expandedShadowEuropeCronGroups();
    const flat = groups.flatMap((group) => group.markets);
    for (const market of THIN_SECONDARY_MARKETS) {
      expect(flat).toContain(market);
    }
  });

  it("cada cohorte thin define caps conservadores alineados a West/South", () => {
    for (const group of SHADOW_EUROPE_CRON_GROUPS) {
      expect(group.key).toBeTruthy();
      expect(group.title).toBeTruthy();
      expect(Array.isArray(group.markets)).toBe(true);
      expect(group.markets.length).toBeGreaterThan(0);
      expect(Number.isFinite(group.resolvePerMarket)).toBe(true);
      expect(group.resolvePerMarket).toBe(3);
      expect(Number.isFinite(group.pricePerMarket)).toBe(true);
      expect(group.pricePerMarket).toBe(6);
      expect(Number.isFinite(group.scanPerMarket)).toBe(true);
      expect(group.scanPerMarket).toBe(6);
      expect(Number.isFinite(group.scanLimit)).toBe(true);
      expect(group.scanLimit).toBeGreaterThanOrEqual(18);
    }
  });

  it("shadowEuropeCronGroupByKey resuelve los pares thin IE+PT y AT+BE", () => {
    const iePt = shadowEuropeCronGroupByKey("shadow-europe-pair-ie-pt");
    const atBe = shadowEuropeCronGroupByKey("shadow-europe-pair-at-be");
    expect(iePt?.markets).toEqual(["IE", "PT"]);
    expect(atBe?.markets).toEqual(["AT", "BE"]);
    expect(iePt?.scanLimit).toBe(18);
    expect(atBe?.scanLimit).toBe(18);
  });

  it("shadowEuropeCronGroupByKey resuelve por key normalizada a minúsculas", () => {
    const group = shadowEuropeCronGroupByKey("SHADOW-EUROPE-WEST");
    expect(group?.markets).toEqual(["DE", "FR", "NL"]);
  });

  it("shadowEuropeCronGroupByKey devuelve null para keys desconocidas", () => {
    expect(shadowEuropeCronGroupByKey("nope")).toBeNull();
    expect(shadowEuropeCronGroupByKey("")).toBeNull();
    expect(shadowEuropeCronGroupByKey(null)).toBeNull();
  });

  it("shadowEuropeCronGroupAt satura índices fuera de rango", () => {
    const groups = expandedShadowEuropeCronGroups();
    const wrapped = shadowEuropeCronGroupAt(groups.length + 2);
    expect(wrapped.index).toBe((groups.length + 2) % groups.length);
    expect(wrapped.group).toBeTruthy();
    const negative = shadowEuropeCronGroupAt(-1);
    expect(negative.index).toBeGreaterThanOrEqual(0);
    expect(negative.group).toBeTruthy();
  });

  it("shadowEuropeCronGroupAt salta por todas las cohortes en orden sin repetir keys", () => {
    const groups = expandedShadowEuropeCronGroups();
    expect(groups.length).toBe(6);
    const seen = new Set();
    for (let i = 0; i < groups.length; i += 1) {
      const { group } = shadowEuropeCronGroupAt(i);
      expect(seen.has(group.key)).toBe(false);
      seen.add(group.key);
    }
    expect(seen.size).toBe(groups.length);
  });

  it("ningún mercado thin aparece en dos cohortes distintas", () => {
    const groups = expandedShadowEuropeCronGroups();
    const occurrences = new Map();
    for (const group of groups) {
      for (const market of group.markets) {
        occurrences.set(market, (occurrences.get(market) || 0) + 1);
      }
    }
    for (const market of THIN_SECONDARY_MARKETS) {
      expect(occurrences.get(market)).toBe(1);
    }
  });
});
