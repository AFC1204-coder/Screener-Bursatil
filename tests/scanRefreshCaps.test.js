import { describe, expect, it, vi } from "vitest";
import { scanCronGroupByKey } from "@/lib/cronPlan";
import {
  SCAN_REFRESH_LEGACY_PER_MARKET_MAX,
  scanRefreshParamCaps,
} from "@/lib/intlUniverseGates";

vi.mock("@/lib/internalAuth", () => ({
  isInternalRequest: vi.fn(() => true),
}));
vi.mock("@/lib/supabaseServer", () => ({
  supabaseConfig: vi.fn(() => ({ configured: false })),
  supabaseRequest: vi.fn(),
}));

describe("scan-refresh param caps (INT-3b)", () => {
  it("asia-hongkong resuelve perMarket efectivo ≥72, no el clamp legacy 25", () => {
    const group = scanCronGroupByKey("asia-hongkong");
    const caps = scanRefreshParamCaps(group);
    expect(caps.broad).toBe("HK");
    expect(caps.perMarketMax).toBeGreaterThanOrEqual(72);
    expect(caps.perMarketMax).toBeLessThanOrEqual(120);
    expect(caps.perMarketMax).not.toBe(SCAN_REFRESH_LEGACY_PER_MARKET_MAX);
    expect(caps.limitMax).toBe(caps.perMarketMax);
    expect(caps.perMarketMax).toBe(group.perMarket);
  });

  it("north-america-canada usa caps broad del plan", () => {
    const group = scanCronGroupByKey("north-america-canada");
    const caps = scanRefreshParamCaps(group);
    expect(caps.broad).toBe("CA");
    expect(caps.perMarketMax).toBeGreaterThanOrEqual(72);
    expect(caps.perMarketMax).not.toBe(SCAN_REFRESH_LEGACY_PER_MARKET_MAX);
    expect(caps.limitMax).toBe(group.limit);
  });

  it("cohorts no broad conservan techo legacy 25/80", () => {
    const au = scanCronGroupByKey("oceania-australia");
    const caps = scanRefreshParamCaps(au);
    expect(caps.broad).toBe("");
    expect(caps.perMarketMax).toBe(Math.min(au.perMarket, SCAN_REFRESH_LEGACY_PER_MARKET_MAX));
    expect(caps.perMarketMax).toBe(24);
  });

  it("dryRun del cron expone perMarket del plan para HK", async () => {
    const { GET } = await import("@/app/api/cron/scan-refresh/route");
    const response = await GET(new Request(
      "http://localhost/api/cron/scan-refresh?group=asia-hongkong&dryRun=1",
    ));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.options.perMarket).toBeGreaterThanOrEqual(72);
    expect(body.options.perMarket).not.toBe(25);
    expect(body.options.limit).toBe(body.options.perMarket);
  });
});
