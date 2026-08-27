import { describe, expect, it } from "vitest";
import { ASIA, DEFAULT_MARKETS } from "@/lib/screenerConfig";
import { EUROPE_PRIORITY_MARKETS } from "@/lib/markets";
import {
  buildMarketsStaleNotice,
  isMarketSelectable,
  marketPresetMarkets,
  scannedMarketsFromScan,
} from "@/lib/marketAvailability";

describe("isMarketSelectable", () => {
  it("TW no es seleccionable por materializado fallido", () => {
    expect(isMarketSelectable("TW")).toBe(false);
    expect(isMarketSelectable("US")).toBe(true);
    expect(isMarketSelectable("CA")).toBe(true);
  });
});

describe("marketPresetMarkets", () => {
  it("preset Asia excluye TW", () => {
    const asia = marketPresetMarkets("asia");
    expect(asia).not.toContain("TW");
    expect(asia).toEqual(ASIA.filter((code) => code !== "TW"));
  });

  it("DEFAULT_MARKETS no incluye TW", () => {
    expect(DEFAULT_MARKETS).not.toContain("TW");
    expect(marketPresetMarkets("global")).not.toContain("TW");
  });

  it("core-intl fusiona HK, CA y EU priority", () => {
    const coreIntl = marketPresetMarkets("core-intl");
    expect(coreIntl).toEqual(expect.arrayContaining(["HK", "CA", ...EUROPE_PRIORITY_MARKETS]));
    expect(coreIntl).not.toContain("US");
  });
});

describe("scannedMarketsFromScan", () => {
  it("infiera US del local_id nocturno", () => {
    expect(scannedMarketsFromScan({ id: "materialized:US:2026-08-26:o0:l5609", rows: [] })).toEqual(["US"]);
  });

  it("usa settings.markets cuando existen", () => {
    expect(scannedMarketsFromScan({
      id: "materialized:CA:2026-08-26:o0:l100",
      settings: { markets: ["CA"] },
      rows: [],
    })).toEqual(["CA"]);
  });
});

describe("buildMarketsStaleNotice", () => {
  it("avisa cuando la selección multi no coincide con el scan US", () => {
    const notice = buildMarketsStaleNotice({
      scannedMarkets: ["US"],
      selectedMarkets: DEFAULT_MARKETS,
      rowCount: 3319,
    });
    expect(notice).not.toBeNull();
    expect(notice.source).toBe("markets-stale");
    expect(notice.detail).toContain("Datos cargados: US (3319)");
    expect(notice.detail).toContain("no coincide");
    expect(notice.ctaLabel).toBe("Cargar datos de la selección");
  });

  it("no avisa cuando selección y scan coinciden", () => {
    expect(buildMarketsStaleNotice({
      scannedMarkets: ["US"],
      selectedMarkets: ["US"],
      rowCount: 3319,
    })).toBeNull();
  });
});
