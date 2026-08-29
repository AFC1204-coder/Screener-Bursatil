import { describe, expect, it } from "vitest";
import {
  augmentIpoDiscoveryFilteredView,
  eligibleIpoWatchItems,
  ipoWatchItemInMarkets,
  isIpoWatchPlaceholderSymbol,
  mergeIpoDiscoveryRows,
  watchItemToDiscoveryRow,
} from "@/lib/mergeIpoDiscoveryRows";
import { IPO_DISCOVERY_PRESET_KEY } from "@/lib/ipoDiscoveryView";

function scanRow(symbol, overrides = {}) {
  return { symbol, companyName: symbol, country: "US", ipoDate: "2025-01-01", totalScore: 55, ...overrides };
}

function watchItem(overrides = {}) {
  return {
    id: "w1",
    companyName: "Acme Pre-IPO",
    symbol: "",
    country: "US",
    includeInScreener: true,
    status: "watch",
    ...overrides,
  };
}

describe("mergeIpoDiscoveryRows", () => {
  it("deduplica por símbolo: gana la fila de scan", () => {
    const merged = mergeIpoDiscoveryRows(
      [scanRow("RDDT")],
      [watchItem({ id: "w-rddt", symbol: "RDDT", companyName: "Reddit watch" })],
      { markets: ["US"] },
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].symbol).toBe("RDDT");
    expect(merged[0].ipoWatchOnly).toBeUndefined();
  });

  it("añade vigilada con ticker ausente en scan", () => {
    const merged = mergeIpoDiscoveryRows(
      [scanRow("AAA")],
      [watchItem({ id: "w-bbb", symbol: "BBB", country: "US" })],
      { markets: ["US"] },
    );
    expect(merged).toHaveLength(2);
    const watchRow = merged.find((row) => row.symbol === "BBB");
    expect(watchRow?.ipoWatchOnly).toBe(true);
    expect(watchRow?.totalScore).toBeUndefined();
  });

  it("añade pre-IPO sin ticker con clave estable", () => {
    const merged = mergeIpoDiscoveryRows([], [watchItem({ id: "pre-1", country: "HK" })], { markets: ["HK"] });
    expect(merged).toHaveLength(1);
    expect(isIpoWatchPlaceholderSymbol(merged[0].symbol)).toBe(true);
    expect(merged[0].ipoWatchId).toBe("pre-1");
    expect(merged[0].companyName).toBe("Acme Pre-IPO");
  });

  it("respeta mercados activos sin forzar US", () => {
    expect(ipoWatchItemInMarkets(watchItem({ country: "HK" }), ["HK"])).toBe(true);
    expect(ipoWatchItemInMarkets(watchItem({ country: "HK" }), ["US"])).toBe(false);
    const merged = mergeIpoDiscoveryRows(
      [],
      [watchItem({ id: "hk-1", country: "HK" }), watchItem({ id: "us-1", country: "US" })],
      { markets: ["HK"] },
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].country).toBe("HK");
  });

  it("excluye passed y las que no están en screener", () => {
    expect(eligibleIpoWatchItems([
      watchItem({ status: "passed" }),
      watchItem({ includeInScreener: false }),
      watchItem({ id: "ok" }),
    ])).toHaveLength(1);
  });

  it("watchItemToDiscoveryRow no inventa scores", () => {
    const row = watchItemToDiscoveryRow(watchItem({ symbol: "NEW" }));
    expect(row.ipoWatchOnly).toBe(true);
    expect(row.totalScore).toBeUndefined();
    expect(row.symbol).toBe("NEW");
  });
});

describe("augmentIpoDiscoveryFilteredView", () => {
  it("solo aplica merge con preset ipoDiscovery", () => {
    const base = { rows: [scanRow("AAA")], filterMs: 1 };
    const untouched = augmentIpoDiscoveryFilteredView(base, {
      presetKey: "balanced",
      markets: ["US"],
      watchItems: [watchItem({ symbol: "BBB" })],
    });
    expect(untouched.rows).toHaveLength(1);

    const merged = augmentIpoDiscoveryFilteredView(base, {
      presetKey: IPO_DISCOVERY_PRESET_KEY,
      markets: ["US"],
      watchItems: [watchItem({ id: "w-bbb", symbol: "BBB" })],
    });
    expect(merged.rows).toHaveLength(2);
  });
});
