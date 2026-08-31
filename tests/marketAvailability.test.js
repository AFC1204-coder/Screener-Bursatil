import { describe, expect, it } from "vitest";
import { ASIA, DEFAULT_MARKETS } from "@/lib/screenerConfig";
import { EUROPE_PRIORITY_MARKETS } from "@/lib/markets";
import {
  buildMarketsStaleNotice,
  buildScreenerTruthMarketSegments,
  formatMarketCodesShort,
  formatMissingMarketsDetail,
  intlBroadStatusDetail,
  isMarketSelectable,
  marketPresetMarkets,
  marketsSelectionBlockingMisalignment,
  marketsSelectionMisaligned,
  marketsSelectionPartialCoverage,
  restoreSessionMarketAlignAction,
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

  it("global y us-core-intl son US + Core intl cargable", () => {
    const global = marketPresetMarkets("global");
    const usCoreIntl = marketPresetMarkets("us-core-intl");
    expect(global).toEqual(usCoreIntl);
    expect(global).toContain("US");
    expect(global).toContain("HK");
    expect(global).toContain("CA");
    expect(global).not.toEqual(DEFAULT_MARKETS);
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

describe("formatMissingMarketsDetail", () => {
  it("distingue nocturno US de materializado intl", () => {
    expect(formatMissingMarketsDetail(["US", "HK"], [
      { market: "US", reason: "no-nightly-scan" },
      { market: "HK", reason: "no-materialized-scan" },
    ])).toContain("Falta nocturno US");
    expect(formatMissingMarketsDetail(["US", "HK"], [
      { market: "US", reason: "no-nightly-scan" },
      { market: "HK", reason: "no-materialized-scan" },
    ])).toContain("Falta materializado:");
  });

  it("detalla pocas filas e no publicable", () => {
    expect(formatMissingMarketsDetail(["IT"], [{ market: "IT", reason: "insufficient-rows" }])).toContain("pocas filas");
    expect(formatMissingMarketsDetail(["TW"], [{ market: "TW", reason: "materialized-not-publishable" }])).toContain("no publicable");
  });
});

describe("marketsSelectionPartialCoverage", () => {
  it("detecta subconjunto honesto de la selección", () => {
    expect(marketsSelectionPartialCoverage(["US", "HK"], ["US", "HK", "CA"])).toBe(true);
    expect(marketsSelectionPartialCoverage(["US", "HK"], ["HK", "US"])).toBe(false);
    expect(marketsSelectionPartialCoverage(["US"], ["HK"])).toBe(false);
  });
});

describe("marketsSelectionBlockingMisalignment", () => {
  it("bloquea datos con mercado fuera de selección", () => {
    expect(marketsSelectionBlockingMisalignment(["US"], ["HK"])).toBe(true);
    expect(marketsSelectionBlockingMisalignment(["US", "HK"], ["US", "HK", "CA"])).toBe(false);
  });
});

describe("marketsSelectionMisaligned", () => {
  it("detecta HK seleccionado con datos US cargados", () => {
    expect(marketsSelectionMisaligned(["US"], ["HK"])).toBe(true);
  });

  it("no avisa sin mercados escaneados", () => {
    expect(marketsSelectionMisaligned([], ["HK"])).toBe(false);
  });
});

describe("restoreSessionMarketAlignAction", () => {
  it("pide auto-carga cuando la sesión restaurada tiene HK pero el scan es US", () => {
    expect(restoreSessionMarketAlignAction({
      restoredMarkets: ["HK"],
      scanContext: { scannedMarkets: ["US"] },
      analyzedRows: [{ symbol: "AAON", country: "US" }],
      hasVisibleRows: true,
    })).toEqual(["HK"]);
  });

  it("no auto-carga cuando selección y scan coinciden", () => {
    expect(restoreSessionMarketAlignAction({
      restoredMarkets: ["US"],
      scanContext: { scannedMarkets: ["US"] },
      analyzedRows: [{ symbol: "AAPL", country: "US" }],
      hasVisibleRows: true,
    })).toBeNull();
  });

  it("no auto-carga sin filas visibles", () => {
    expect(restoreSessionMarketAlignAction({
      restoredMarkets: ["HK"],
      scanContext: { scannedMarkets: ["US"] },
      analyzedRows: [{ symbol: "AAON", country: "US" }],
      hasVisibleRows: false,
    })).toBeNull();
  });
});

describe("formatMarketCodesShort", () => {
  it("une códigos ordenados con +", () => {
    expect(formatMarketCodesShort(["HK", "US"])).toBe("HK+US");
    expect(formatMarketCodesShort(["CA", "HK"])).toBe("CA+HK");
  });

  it("devuelve vacío sin mercados", () => {
    expect(formatMarketCodesShort([])).toBe("");
  });
});

describe("buildScreenerTruthMarketSegments", () => {
  it("incluye mesa cuando hay scan cargado", () => {
    expect(buildScreenerTruthMarketSegments({
      scannedMarkets: ["US"],
      selectedMarkets: ["US"],
    })).toEqual(["mesa: US"]);
  });

  it("añade aviso corto de desalineación", () => {
    expect(buildScreenerTruthMarketSegments({
      scannedMarkets: ["US"],
      selectedMarkets: ["HK"],
      marketsMisaligned: true,
    })).toEqual([
      "mesa: US",
      "datos: US · selección: HK",
      "selección ≠ mesa",
    ]);
  });

  it("no emite segmentos sin scan", () => {
    expect(buildScreenerTruthMarketSegments({
      scannedMarkets: [],
      selectedMarkets: ["US"],
    })).toEqual([]);
  });
});

describe("buildMarketsStaleNotice", () => {
  it("avisa cuando solo HK está seleccionado y el scan es US", () => {
    const notice = buildMarketsStaleNotice({
      scannedMarkets: ["US"],
      selectedMarkets: ["HK"],
      rowCount: 3321,
    });
    expect(notice).not.toBeNull();
    expect(notice.detail).toContain("Datos cargados: US (3321)");
    expect(notice.detail).toContain("(HK)");
    expect(notice.ctaLabel).toBe("Cargar datos de la selección");
    expect(notice.blocksResults).toBe(true);
  });

  it("avisa cobertura parcial cuando el scan es subconjunto de la selección", () => {
    const notice = buildMarketsStaleNotice({
      scannedMarkets: ["US"],
      selectedMarkets: DEFAULT_MARKETS,
      rowCount: 3319,
    });
    expect(notice).not.toBeNull();
    expect(notice.source).toBe("markets-partial-coverage");
    expect(notice.blocksResults).toBe(false);
    expect(notice.detail).toContain("Datos cargados: US (3319)");
    expect(notice.detail).toContain("Faltan en mesa:");
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

describe("intlBroadStatusDetail", () => {
  it("devuelve copy honesto solo para official-broad HK/CA", () => {
    expect(intlBroadStatusDetail({
      market: "HK",
      analyzedCount: 95,
      priorityMode: "official-broad",
    })).toBe("Hong Kong: 95 analizadas · universo amplio filtrado (liquidez/cobertura) · rotación nocturna");
    expect(intlBroadStatusDetail({
      market: "HK",
      analyzedCount: 95,
      priorityMode: "curated-core",
    })).toBe("");
  });
});
