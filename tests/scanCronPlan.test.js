import { describe, expect, it } from "vitest";
import {
  SCAN_CRON_GROUPS,
  expandedScanCronGroups,
  scanCronGroupAt,
  scanCronGroupByKey,
} from "@/lib/cronPlan";
import { EUROPE_PRIORITY_MARKETS, EUROPE_SECONDARY_MARKETS } from "@/lib/markets";

describe("scan-refresh cron plan", () => {
  it("expone cohorts HK y CA con perMarket broad ≥72 (INT-3)", () => {
    const hk = scanCronGroupByKey("asia-hongkong");
    const ca = scanCronGroupByKey("north-america-canada");
    expect(hk?.markets).toEqual(["HK"]);
    expect(ca?.markets).toEqual(["CA"]);
    expect(hk?.perMarket).toBeGreaterThanOrEqual(72);
    expect(hk?.perMarket).toBeLessThanOrEqual(96);
    expect(ca?.perMarket).toBeGreaterThanOrEqual(72);
    expect(ca?.perMarket).toBeLessThanOrEqual(96);
    expect(hk?.limit).toBe(hk?.perMarket);
    expect(ca?.limit).toBe(ca?.perMarket);
  });

  it("expone cohorts HK, AU, KR e IN separados con limit/perMarket ≥24", () => {
    const hk = scanCronGroupByKey("asia-hongkong");
    const au = scanCronGroupByKey("oceania-australia");
    const kr = scanCronGroupByKey("asia-korea");
    const ind = scanCronGroupByKey("asia-india");
    expect(hk?.markets).toEqual(["HK"]);
    expect(au?.markets).toEqual(["AU"]);
    expect(kr?.markets).toEqual(["KR"]);
    expect(ind?.markets).toEqual(["IN"]);
    expect(hk?.limit).toBeGreaterThanOrEqual(24);
    expect(hk?.perMarket).toBeGreaterThanOrEqual(24);
    expect(au?.limit).toBeGreaterThanOrEqual(24);
    expect(au?.perMarket).toBeGreaterThanOrEqual(24);
    expect(kr?.limit).toBeGreaterThanOrEqual(24);
    expect(kr?.perMarket).toBeGreaterThanOrEqual(24);
    expect(ind?.limit).toBeGreaterThanOrEqual(24);
    expect(ind?.perMarket).toBeGreaterThanOrEqual(24);
  });

  it("ningún grupo mezcla US, HK y AU en el mismo settings.markets", () => {
    for (const group of expandedScanCronGroups()) {
      const markets = group.markets.slice().sort();
      expect(markets).not.toEqual(["AU", "HK", "US"]);
      const hasUs = markets.includes("US");
      const hasHk = markets.includes("HK");
      const hasAu = markets.includes("AU");
      expect(hasUs && hasHk && hasAu).toBe(false);
    }
  });

  it("no incluye el grupo obsoleto core-us-hk-au", () => {
    expect(scanCronGroupByKey("core-us-hk-au")).toBeNull();
    expect(SCAN_CRON_GROUPS.some((group) => group.key === "core-us-hk-au")).toBe(false);
  });

  it("scanCronGroupByKey resuelve por key normalizada a minúsculas", () => {
    expect(scanCronGroupByKey("ASIA-HONGKONG")?.markets).toEqual(["HK"]);
    expect(scanCronGroupByKey("oceania-australia")?.markets).toEqual(["AU"]);
  });

  it("scanCronGroupByKey devuelve null para keys desconocidas", () => {
    expect(scanCronGroupByKey("nope")).toBeNull();
    expect(scanCronGroupByKey("")).toBeNull();
    expect(scanCronGroupByKey(null)).toBeNull();
  });

  it("scanCronGroupAt incluye las cohorts HK/AU/KR/IN en la rotación diaria", () => {
    const groups = expandedScanCronGroups();
    const keys = new Set();
    for (let i = 0; i < groups.length; i += 1) {
      const { group } = scanCronGroupAt(i);
      expect(keys.has(group.key)).toBe(false);
      keys.add(group.key);
    }
    expect(keys.has("asia-hongkong")).toBe(true);
    expect(keys.has("oceania-australia")).toBe(true);
    expect(keys.has("asia-korea")).toBe(true);
    expect(keys.has("asia-india")).toBe(true);
    expect(keys.size).toBe(groups.length);
  });

  it("no incluye el grupo obsoleto europe-priority con alias EU1", () => {
    expect(scanCronGroupByKey("europe-priority")).toBeNull();
    expect(SCAN_CRON_GROUPS.some((group) => group.key === "europe-priority")).toBe(false);
    for (const group of expandedScanCronGroups()) {
      expect(group.markets).not.toEqual(["EU1"]);
      expect(group.markets.includes("EU1")).toBe(false);
    }
  });

  it("expone cohorts Europa priority de un solo país con limit/perMarket ≥24", () => {
    for (const market of EUROPE_PRIORITY_MARKETS) {
      const group = scanCronGroupByKey(`europe-${market.toLowerCase()}`);
      expect(group?.markets).toEqual([market]);
      expect(group?.limit).toBeGreaterThanOrEqual(24);
      expect(group?.perMarket).toBeGreaterThanOrEqual(24);
    }
  });

  it("mantiene north-america-canada como cohort de un solo mercado con perMarket broad", () => {
    const ca = scanCronGroupByKey("north-america-canada");
    expect(ca?.markets).toEqual(["CA"]);
    expect(ca?.perMarket).toBeGreaterThanOrEqual(72);
    expect(ca?.limit).toBeGreaterThanOrEqual(72);
  });

  it("no incluye el grupo obsoleto europe-secondary con alias EU2", () => {
    expect(scanCronGroupByKey("europe-secondary")).toBeNull();
    expect(SCAN_CRON_GROUPS.some((group) => group.key === "europe-secondary")).toBe(false);
    for (const group of expandedScanCronGroups()) {
      expect(group.markets).not.toEqual(["EU2"]);
      expect(group.markets.includes("EU2")).toBe(false);
    }
  });

  it("expone cohorts Europa secondary de un solo país con limit/perMarket ≥24", () => {
    for (const market of EUROPE_SECONDARY_MARKETS) {
      const group = scanCronGroupByKey(`europe-${market.toLowerCase()}`);
      expect(group?.markets).toEqual([market]);
      expect(group?.limit).toBeGreaterThanOrEqual(24);
      expect(group?.perMarket).toBeGreaterThanOrEqual(24);
    }
  });

  it("mantiene asia-japan como cohort JP sola con limit/perMarket ≥24", () => {
    const jp = scanCronGroupByKey("asia-japan");
    expect(jp?.markets).toEqual(["JP"]);
    expect(jp?.limit).toBeGreaterThanOrEqual(24);
    expect(jp?.perMarket).toBeGreaterThanOrEqual(24);
  });
});
