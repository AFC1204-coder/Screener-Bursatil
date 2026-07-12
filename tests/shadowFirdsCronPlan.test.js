import { describe, expect, it } from "vitest";
import {
  SHADOW_FIRDS_CRON_GROUPS,
  expandedShadowFirdsCronGroups,
  shadowFirdsCronGroupAt,
  shadowFirdsCronGroupByKey,
} from "@/lib/cronPlan";

const ESMA_FIRDS_MARKETS = ["AT", "BE", "DE", "DK", "ES", "FI", "FR", "IE", "IT", "NL", "NO", "PT", "SE"];

describe("shadow-firds cron plan", () => {
  it("expone 8 cohortes que cubren exactamente los 13 mercados ESMA (GB-FCA excluido)", () => {
    const groups = expandedShadowFirdsCronGroups();
    expect(groups.length).toBe(8);
    const flat = groups.flatMap((group) => group.markets);
    const deduped = Array.from(new Set(flat));
    expect(deduped.sort()).toEqual([...ESMA_FIRDS_MARKETS].sort());
    expect(flat.length).toBe(deduped.length); // sin duplicados entre cohortes
  });

  it("mantiene GB fuera de cualquier cohorte", () => {
    const groups = expandedShadowFirdsCronGroups();
    for (const group of groups) {
      expect(group.markets).not.toContain("GB");
    }
  });

  it("cada cohorte define resolvePerMarket y pricePerMarket con valores positivos", () => {
    for (const group of SHADOW_FIRDS_CRON_GROUPS) {
      expect(group.key).toBeTruthy();
      expect(group.title).toBeTruthy();
      expect(Array.isArray(group.markets)).toBe(true);
      expect(group.markets.length).toBeGreaterThan(0);
      expect(group.markets.length).toBeLessThanOrEqual(2);
      expect(Number.isFinite(group.resolvePerMarket)).toBe(true);
      expect(group.resolvePerMarket).toBeGreaterThan(0);
      expect(Number.isFinite(group.pricePerMarket)).toBe(true);
      expect(group.pricePerMarket).toBeGreaterThan(0);
    }
  });

  it("shadowFirdsCronGroupByKey resuelve por key normalizada a minúsculas", () => {
    const group = shadowFirdsCronGroupByKey("shadow-firds-pair-1");
    expect(group?.markets).toEqual(["IE", "PT"]);
    expect(group?.resolvePerMarket).toBe(5);
    // pricePerMarket bumped 8 → 20 (2026-07-11). Empirical worst-pair
    // (ES+IT) measured at 26.7s on cache-hit runs under maxDuration=60.
    expect(group?.pricePerMarket).toBe(20);
  });

  it("shadowFirdsCronGroupByKey devuelve null para keys desconocidas", () => {
    expect(shadowFirdsCronGroupByKey("nope")).toBeNull();
    expect(shadowFirdsCronGroupByKey("")).toBeNull();
    expect(shadowFirdsCronGroupByKey(null)).toBeNull();
  });

  it("shadowFirdsCronGroupAt satura índices fuera de rango al grupo 0", () => {
    const groups = expandedShadowFirdsCronGroups();
    const wrapped = shadowFirdsCronGroupAt(groups.length + 2);
    expect(wrapped.index).toBe((groups.length + 2) % groups.length);
    expect(wrapped.group).toBeTruthy();
    const negative = shadowFirdsCronGroupAt(-1);
    expect(negative.index).toBeGreaterThanOrEqual(0);
    expect(negative.group).toBeTruthy();
  });

  it("shadowFirdsCronGroupAt salta por todas las cohortes en orden sin repetir keys", () => {
    const groups = expandedShadowFirdsCronGroups();
    const seen = new Set();
    for (let i = 0; i < groups.length; i += 1) {
      const { group } = shadowFirdsCronGroupAt(i);
      expect(seen.has(group.key)).toBe(false);
      seen.add(group.key);
      for (const market of group.markets) {
        expect(ESMA_FIRDS_MARKETS).toContain(market);
      }
    }
    expect(seen.size).toBe(groups.length);
  });

  it("ningún mercado ESMA aparece en dos cohortes distintas", () => {
    const groups = expandedShadowFirdsCronGroups();
    const occurrences = new Map();
    for (const group of groups) {
      for (const market of group.markets) {
        occurrences.set(market, (occurrences.get(market) || 0) + 1);
      }
    }
    for (const count of occurrences.values()) {
      expect(count).toBe(1);
    }
  });
});
