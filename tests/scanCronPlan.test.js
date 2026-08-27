import { describe, expect, it } from "vitest";
import {
  SCAN_CRON_GROUPS,
  expandedScanCronGroups,
  scanCronGroupAt,
  scanCronGroupByKey,
} from "@/lib/cronPlan";

describe("scan-refresh cron plan", () => {
  it("expone cohorts HK y AU separados con limit/perMarket ≥24", () => {
    const hk = scanCronGroupByKey("asia-hongkong");
    const au = scanCronGroupByKey("oceania-australia");
    expect(hk?.markets).toEqual(["HK"]);
    expect(au?.markets).toEqual(["AU"]);
    expect(hk?.limit).toBeGreaterThanOrEqual(24);
    expect(hk?.perMarket).toBeGreaterThanOrEqual(24);
    expect(au?.limit).toBeGreaterThanOrEqual(24);
    expect(au?.perMarket).toBeGreaterThanOrEqual(24);
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

  it("scanCronGroupAt incluye las cohorts HK/AU en la rotación diaria", () => {
    const groups = expandedScanCronGroups();
    const keys = new Set();
    for (let i = 0; i < groups.length; i += 1) {
      const { group } = scanCronGroupAt(i);
      expect(keys.has(group.key)).toBe(false);
      keys.add(group.key);
    }
    expect(keys.has("asia-hongkong")).toBe(true);
    expect(keys.has("oceania-australia")).toBe(true);
    expect(keys.size).toBe(groups.length);
  });
});
