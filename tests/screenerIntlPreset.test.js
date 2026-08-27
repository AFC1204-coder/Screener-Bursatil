import { describe, expect, it } from "vitest";
import { EUROPE_PRIORITY_MARKETS } from "@/lib/markets";
import { marketPresetMarkets } from "@/lib/marketAvailability";
import {
  intlPresetAutoApplyStatus,
  marketSelectionIncludesUs,
  settingsForPreset,
  shouldAutoApplyIntlFilterPreset,
  shouldAutoRestoreBalancedFilterPreset,
} from "@/lib/screenerFilterCatalog";

describe("settingsForPreset intl", () => {
  it("no exige RS canónico US ni liquidez NYSE", () => {
    const settings = settingsForPreset("intl");
    expect(settings.minRsRating).toBe(0);
    expect(settings.minSectorScore).toBe(0);
    expect(settings.minAvgTurnover).toBeLessThan(1_500_000);
    expect(settings.requireStage2).toBe(false);
    expect(settings.setupMode).toBe("any");
    expect(settings.minRelativeVolume).toBe(0);
    expect(settings.filterStrictness).toBe("discovery");
  });

  it("uiSettingsOverridesFromScan no deja pasar puertas del materializado al preset intl", async () => {
    const { uiSettingsOverridesFromScan } = await import("@/lib/screenerFilterCatalog");
    const overrides = uiSettingsOverridesFromScan({
      minMarketCap: 300_000_000,
      minAvgTurnover: 250_000,
      markets: ["CA"],
      progress: { status: "partial" },
    }, "intl");
    expect(overrides).toEqual({});
    const settings = settingsForPreset("intl", overrides);
    expect(settings.minMarketCap).toBe(50_000_000);
    expect(settings.requireStage2).toBe(false);
  });
});

describe("marketPresetMarkets core-intl", () => {
  it("incluye HK, CA y mercados EU priority seleccionables", () => {
    const markets = marketPresetMarkets("core-intl");
    expect(markets).toContain("HK");
    expect(markets).toContain("CA");
    for (const code of EUROPE_PRIORITY_MARKETS) {
      expect(markets).toContain(code);
    }
    expect(markets).not.toContain("US");
  });
});

describe("shouldAutoApplyIntlFilterPreset", () => {
  it("sin US y balanced → intl", () => {
    expect(shouldAutoApplyIntlFilterPreset(["CA"], "balanced")).toBe(true);
    expect(shouldAutoApplyIntlFilterPreset(["HK", "GB"], "balanced")).toBe(true);
  });

  it("solo US o con US → no pisa balanced", () => {
    expect(shouldAutoApplyIntlFilterPreset(["US"], "balanced")).toBe(false);
    expect(shouldAutoApplyIntlFilterPreset(["US", "CA"], "balanced")).toBe(false);
    expect(marketSelectionIncludesUs(["US"])).toBe(true);
    expect(marketSelectionIncludesUs(["CA", "HK"])).toBe(false);
  });

  it("ya en intl o broad → no re-aplica", () => {
    expect(shouldAutoApplyIntlFilterPreset(["CA"], "intl")).toBe(false);
    expect(shouldAutoApplyIntlFilterPreset(["CA"], "broad")).toBe(false);
  });

  it("US + intl → restaura balanced", () => {
    expect(shouldAutoRestoreBalancedFilterPreset(["US"], "intl")).toBe(true);
    expect(shouldAutoRestoreBalancedFilterPreset(["US", "CA"], "intl")).toBe(true);
    expect(shouldAutoRestoreBalancedFilterPreset(["CA"], "intl")).toBe(false);
    expect(shouldAutoRestoreBalancedFilterPreset(["US"], "balanced")).toBe(false);
  });

  it("expone copy de status", () => {
    expect(intlPresetAutoApplyStatus()).toContain("Preset Intl");
  });
});
