import { describe, expect, it } from "vitest";
import { ASIA, ALL_SELECTABLE_MARKETS, DEFAULT_MARKETS, EUROPE } from "@/lib/screenerConfig";
import { EUROPE_PRIORITY_MARKETS, EUROPE_SECONDARY_MARKETS } from "@/lib/markets";
import {
  buildMarketsLoadingNotice,
  buildMarketsStaleNotice,
  buildMergedSnapshotNotice,
  buildScreenerTruthMarketSegments,
  describeEuropeCoverageGap,
  formatEuropeSecondaryGapNames,
  formatMarketCodesShort,
  formatMarketsProductLabel,
  formatMissingMarketsDetail,
  intlBroadStatusDetail,
  isEuropeBreadthSelection,
  isEuropePresetSelection,
  isEuropePriorityOnlyMarkets,
  isMarketSelectable,
  marketPresetMarkets,
  marketsMisalignmentLoadCtaLabel,
  marketsSelectionBlockingMisalignment,
  marketsSelectionMisaligned,
  marketsSelectionLoadSettled,
  marketsSelectionPartialCoverage,
  missingEuropeSecondaryMarkets,
  missingMarketsPeekDetail,
  orderEuropeSecondaryForCopy,
  resolveMarketsMisalignmentNotice,
  restoreSessionMarketAlignAction,
  scannedMarketsFromScan,
  screenerTableMarketsUsOnly,
  shouldAutoLoadMarketSelection,
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

  it("DEFAULT_MARKETS es solo EE. UU. y no incluye TW", () => {
    expect(DEFAULT_MARKETS).toEqual(["US"]);
    expect(DEFAULT_MARKETS).not.toContain("TW");
    expect(ALL_SELECTABLE_MARKETS).not.toContain("TW");
    expect(ALL_SELECTABLE_MARKETS.length).toBeGreaterThan(1);
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
    expect(global).not.toEqual(ALL_SELECTABLE_MARKETS);
  });

  it("core-intl fusiona HK, CA y EU priority", () => {
    const coreIntl = marketPresetMarkets("core-intl");
    expect(coreIntl).toEqual(expect.arrayContaining(["HK", "CA", ...EUROPE_PRIORITY_MARKETS]));
    expect(coreIntl).not.toContain("US");
  });

  it("fallback de preset desconocido es EE. UU.", () => {
    expect(marketPresetMarkets("no-existe")).toEqual(["US"]);
    expect(marketPresetMarkets("")).toEqual(["US"]);
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

describe("missingMarketsPeekDetail", () => {
  it("resume N mercados sin enumerar países", () => {
    expect(missingMarketsPeekDetail(["AT", "BE"])).toBe("Faltan 2 mercados");
    expect(missingMarketsPeekDetail(["US"])).toBe("Falta 1 mercado");
    expect(missingMarketsPeekDetail([])).toBe("Faltan mercados");
  });
});

describe("buildMergedSnapshotNotice", () => {
  it("fusión parcial: peek corto y detalle largo en body", () => {
    const notice = buildMergedSnapshotNotice({
      merged: true,
      partial: true,
      missingMarkets: ["AT", "BE", "CH"],
      missingDetails: [
        { market: "AT", reason: "no-materialized-scan" },
        { market: "BE", reason: "no-materialized-scan" },
        { market: "CH", reason: "no-materialized-scan" },
      ],
    });
    expect(notice.label).toBe("Fusión parcial");
    expect(notice.peekDetail).toBe("Faltan 3 mercados");
    expect(notice.bodyDetail).toContain("Falta materializado:");
    expect(notice.peekDetail).not.toContain("Austria");
    expect(notice.source).toBe("merged-materialized-partial");
  });

  it("fusión completa sin peek extra", () => {
    const notice = buildMergedSnapshotNotice({
      merged: true,
      partial: false,
      source: "merged-materialized",
    });
    expect(notice.label).toBe("Fusión");
    expect(notice.peekDetail).toBeUndefined();
    expect(notice.detail).toContain("materializados por mercado");
  });

  it("devuelve null sin merged", () => {
    expect(buildMergedSnapshotNotice({ merged: false })).toBeNull();
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

  it("no auto-carga tras remount si cobertura parcial ya estaba settled", () => {
    expect(restoreSessionMarketAlignAction({
      restoredMarkets: ALL_SELECTABLE_MARKETS,
      scanContext: { scannedMarkets: ["US"] },
      analyzedRows: [{ symbol: "AAPL", country: "US" }],
      hasVisibleRows: true,
      selectionLoadSettled: true,
    })).toBeNull();
  });

  it("sigue pidiendo auto-carga con desalineación bloqueante aunque settled", () => {
    expect(restoreSessionMarketAlignAction({
      restoredMarkets: ["HK"],
      scanContext: { scannedMarkets: ["US"] },
      analyzedRows: [{ symbol: "AAON", country: "US" }],
      hasVisibleRows: true,
      selectionLoadSettled: true,
    })).toEqual(["HK"]);
  });
});

describe("screenerTableMarketsUsOnly", () => {
  it("true para mesa US-only o sin mesa cargada", () => {
    expect(screenerTableMarketsUsOnly(["US"])).toBe(true);
    expect(screenerTableMarketsUsOnly([])).toBe(true);
  });

  it("false cuando hay otros mercados en mesa", () => {
    expect(screenerTableMarketsUsOnly(["US", "HK"])).toBe(false);
    expect(screenerTableMarketsUsOnly(["HK"])).toBe(false);
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

  it("añade copy de decisión ante desalineación (P9)", () => {
    expect(buildScreenerTruthMarketSegments({
      scannedMarkets: ["US"],
      selectedMarkets: ["HK"],
      marketsMisaligned: true,
    })).toEqual([
      "Mostrando EE. UU. · tu selección es Hong Kong",
    ]);
  });

  it("desktop desalineado con muchos mercados en selección resume sin volcar códigos", () => {
    const many = ALL_SELECTABLE_MARKETS.slice(0, 10);
    expect(buildScreenerTruthMarketSegments({
      scannedMarkets: ["US"],
      selectedMarkets: many,
      marketsMisaligned: true,
    })).toEqual([
      "Mostrando EE. UU. · tu selección es 10 mercados",
    ]);
  });

  it("desktop desalineado con muchos mercados en mesa resume sin volcar códigos", () => {
    const many = ["AT", "AU", "BE", "CA", "CH"];
    expect(buildScreenerTruthMarketSegments({
      scannedMarkets: many,
      selectedMarkets: ["US"],
      marketsMisaligned: true,
    })).toEqual([
      "Mostrando 5 mercados · tu selección es EE. UU.",
    ]);
  });

  it("modo compacto resume mercados sin listar códigos", () => {
    const many = ["AT", "AU", "BE", "CA", "CH", "DE", "ES", "FR"];
    expect(buildScreenerTruthMarketSegments({
      scannedMarkets: many,
      selectedMarkets: many,
      compact: true,
    })).toEqual(["8 mercados en mesa"]);
  });

  it("modo compacto mantiene aviso de desalineación sin jerga ≠", () => {
    expect(buildScreenerTruthMarketSegments({
      scannedMarkets: ["US", "CA", "HK"],
      selectedMarkets: ALL_SELECTABLE_MARKETS,
      marketsMisaligned: true,
      compact: true,
    })).toEqual([
      "3 mercados en mesa",
      "Mostrando CA+HK+US · selección 28 mercados",
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
    expect(notice.detail).toContain("Mostrando EE. UU. (3321)");
    expect(notice.detail).toContain("Hong Kong");
    expect(notice.ctaLabel).toBe("Cargar Hong Kong");
    expect(notice.stayCtaLabel).toBe("Quedarme en EE. UU.");
    expect(notice.blocksResults).toBe(true);
  });

  it("avisa cobertura parcial cuando el scan es subconjunto de la selección", () => {
    const notice = buildMarketsStaleNotice({
      scannedMarkets: ["US"],
      selectedMarkets: ALL_SELECTABLE_MARKETS,
      rowCount: 3319,
    });
    expect(notice).not.toBeNull();
    expect(notice.source).toBe("markets-partial-coverage");
    expect(notice.blocksResults).toBe(false);
    expect(notice.detail).toContain("Mostrando EE. UU. (3319)");
    expect(notice.detail).toContain("faltan en mesa:");
    expect(notice.peekDetail).toBe(`Faltan ${ALL_SELECTABLE_MARKETS.length - 1} mercados`);
    expect(notice.peekDetail).not.toContain("Austria");
    expect(notice.ctaLabel).toBe("Cargar datos de la selección");
    expect(notice.stayCtaLabel).toBe("Quedarme en EE. UU.");
  });

  it("no avisa cuando selección y scan coinciden", () => {
    expect(buildMarketsStaleNotice({
      scannedMarkets: ["US"],
      selectedMarkets: ["US"],
      rowCount: 3319,
    })).toBeNull();
  });
});

describe("resolveMarketsMisalignmentNotice (UX-NAC-3)", () => {
  it("devuelve aviso de carga sin CTA cuando hay desalineación", () => {
    const notice = resolveMarketsMisalignmentNotice({
      scannedMarkets: ["US"],
      selectedMarkets: ["HK"],
      rowCount: 100,
    });
    expect(notice?.showCta).toBe(false);
    expect(notice?.tone).toBe("loading");
    expect(notice?.detail).toContain("Cargando datos");
  });

  it("devuelve CTA solo si loadFailed", () => {
    const notice = resolveMarketsMisalignmentNotice({
      scannedMarkets: ["US"],
      selectedMarkets: ["HK"],
      loadFailed: true,
      loadFailedDetail: "Sin materializado HK.",
    });
    expect(notice?.showCta).toBe(true);
    expect(notice?.tone).toBe("error");
    expect(notice?.detail).toBe("Sin materializado HK.");
  });

  it("no avisa si mercados alineados", () => {
    expect(resolveMarketsMisalignmentNotice({
      scannedMarkets: ["US"],
      selectedMarkets: ["US"],
    })).toBeNull();
  });

  it("cobertura parcial estable: aviso honesto sin loading eterno", () => {
    const notice = resolveMarketsMisalignmentNotice({
      scannedMarkets: ["US", "HK", "CA"],
      selectedMarkets: ALL_SELECTABLE_MARKETS,
      rowCount: 4188,
      restoringScan: false,
      loadFailed: false,
      selectionLoadSettled: true,
    });
    expect(notice?.tone).toBe("warn");
    expect(notice?.label).toBe("Cobertura parcial");
    expect(notice?.blocksResults).toBe(false);
    expect(notice?.source).toBe("markets-partial-coverage");
    expect(notice?.showCta).toBe(true);
    expect(notice?.detail).not.toContain("Cargando");
  });

  it("cobertura parcial sin settled: loading para permitir auto-load", () => {
    const notice = resolveMarketsMisalignmentNotice({
      scannedMarkets: ["US"],
      selectedMarkets: ALL_SELECTABLE_MARKETS,
      rowCount: 3319,
      restoringScan: false,
      loadFailed: false,
      selectionLoadSettled: false,
    });
    expect(notice?.tone).toBe("loading");
    expect(notice?.source).toBe("markets-pending-load");
    expect(notice?.detail).toContain("Cargando");
    expect(notice?.blocksResults).toBe(false);
  });

  it("cobertura parcial durante restoringScan sigue mostrando loading", () => {
    const notice = resolveMarketsMisalignmentNotice({
      scannedMarkets: ["US", "HK"],
      selectedMarkets: ALL_SELECTABLE_MARKETS,
      rowCount: 100,
      restoringScan: true,
    });
    expect(notice?.tone).toBe("loading");
    expect(notice?.source).toBe("markets-loading");
    expect(notice?.detail).toContain("Cargando");
  });
});

describe("shouldAutoLoadMarketSelection", () => {
  it("dispara cuando hay mesa y selección diverge", () => {
    expect(shouldAutoLoadMarketSelection({
      sessionReady: true,
      marketsStale: true,
      hasScannedMarkets: true,
    })).toBe(true);
  });

  it("no dispara si ya carga, falló o no hay mesa", () => {
    expect(shouldAutoLoadMarketSelection({
      sessionReady: true,
      marketsStale: true,
      restoringScan: true,
      hasScannedMarkets: true,
    })).toBe(false);
    expect(shouldAutoLoadMarketSelection({
      sessionReady: true,
      marketsStale: true,
      loadFailed: true,
      hasScannedMarkets: true,
    })).toBe(false);
    expect(shouldAutoLoadMarketSelection({
      sessionReady: true,
      marketsStale: true,
      hasScannedMarkets: false,
    })).toBe(false);
  });

  it("dispara con US ⊆ Global si la selección no está settled", () => {
    expect(shouldAutoLoadMarketSelection({
      sessionReady: true,
      marketsStale: true,
      hasScannedMarkets: true,
      selectionLoadSettled: false,
    })).toBe(true);
  });

  it("no dispara con cobertura parcial settled en la misma key", () => {
    expect(shouldAutoLoadMarketSelection({
      sessionReady: true,
      marketsStale: true,
      hasScannedMarkets: true,
      selectionLoadSettled: true,
    })).toBe(false);
  });

  it("sigue disparando con desalineación bloqueante (mesa fuera de selección)", () => {
    expect(shouldAutoLoadMarketSelection({
      sessionReady: true,
      marketsStale: true,
      hasScannedMarkets: true,
      selectionLoadSettled: false,
    })).toBe(true);
  });
});

describe("marketsSelectionLoadSettled", () => {
  it("true solo cuando selectedKey y settledKey coinciden", () => {
    const key = ALL_SELECTABLE_MARKETS.slice().sort().join(",");
    expect(marketsSelectionLoadSettled(key, key)).toBe(true);
    expect(marketsSelectionLoadSettled(key, "US")).toBe(false);
    expect(marketsSelectionLoadSettled("", key)).toBe(false);
  });
});

describe("buildMarketsLoadingNotice", () => {
  it("copy neutro para un mercado", () => {
    const notice = buildMarketsLoadingNotice({ selectedMarkets: ["HK"] });
    expect(notice.detail).toContain("Hong Kong");
    expect(notice.peekDetail).toContain("Hong Kong");
    expect(notice.showCta).toBe(false);
  });

  it("mantiene códigos para 2–3 mercados", () => {
    const notice = buildMarketsLoadingNotice({ selectedMarkets: ["US", "CA", "HK"] });
    expect(notice.detail).toContain("CA+HK+US");
    expect(notice.peekDetail).toBe(notice.detail);
  });

  it("resume N mercados en peek y detail sin volcar códigos", () => {
    const many = ALL_SELECTABLE_MARKETS.slice(0, 10);
    const notice = buildMarketsLoadingNotice({ selectedMarkets: many });
    expect(notice.peekDetail).toBe("Cargando 10 mercados…");
    expect(notice.bodyDetail).toBe("Cargando 10 mercados…");
    expect(notice.detail).toBe("Cargando 10 mercados…");
    expect(notice.peekDetail).not.toContain("+");
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

describe("EUROPA-COVERAGE-TRUTH-1", () => {
  it("detecta preset Europa-15 y solo prioridad", () => {
    expect(isEuropePresetSelection(EUROPE)).toBe(true);
    expect(isEuropePresetSelection(marketPresetMarkets("europe"))).toBe(true);
    expect(isEuropePriorityOnlyMarkets(EUROPE_PRIORITY_MARKETS)).toBe(true);
    expect(isEuropePriorityOnlyMarkets(EUROPE)).toBe(false);
    expect(isEuropeBreadthSelection(EUROPE)).toBe(true);
    expect(isEuropeBreadthSelection(EUROPE_PRIORITY_MARKETS)).toBe(false);
    expect(isEuropeBreadthSelection([...EUROPE_PRIORITY_MARKETS, "IE"])).toBe(true);
  });

  it("etiqueta producto: Europa completa vs prioritaria (nunca confunde)", () => {
    expect(formatMarketsProductLabel(EUROPE)).toBe("Europa");
    expect(formatMarketsProductLabel(EUROPE_PRIORITY_MARKETS)).toBe("Europa prioritaria");
    expect(marketsMisalignmentLoadCtaLabel(EUROPE)).toBe("Cargar Europa");
    expect(marketsMisalignmentLoadCtaLabel(EUROPE_PRIORITY_MARKETS)).toBe("Cargar Europa prioritaria");
  });

  it("prioriza IE y PT en el copy de secundarios ausentes", () => {
    expect(orderEuropeSecondaryForCopy(["DK", "PT", "IE", "NO"])).toEqual(["IE", "PT", "DK", "NO"]);
    expect(formatEuropeSecondaryGapNames(["DK", "PT", "IE"])).toMatch(/^Irlanda, Portugal/);
    expect(missingEuropeSecondaryMarkets(EUROPE_PRIORITY_MARKETS, EUROPE)).toEqual(
      EUROPE_SECONDARY_MARKETS,
    );
  });

  it("describe hueco cuando mesa = EU1 y selección = Europa-15", () => {
    const gap = describeEuropeCoverageGap({
      scannedMarkets: EUROPE_PRIORITY_MARKETS,
      selectedMarkets: EUROPE,
    });
    expect(gap).not.toBeNull();
    expect(gap.allSecondaryMissing).toBe(true);
    expect(gap.names).toMatch(/^Irlanda, Portugal/);
    expect(gap.truthSegment).toContain("Europa incompleta");
    expect(gap.truthSegment).toContain("secundarios");
    expect(gap.peekDetail).toContain("secundarios Europa");
  });

  it("no inventa hueco Europa si la mesa no es parcial de la selección", () => {
    expect(describeEuropeCoverageGap({
      scannedMarkets: ["US"],
      selectedMarkets: EUROPE,
    })).toBeNull();
    expect(describeEuropeCoverageGap({
      scannedMarkets: EUROPE,
      selectedMarkets: EUROPE,
    })).toBeNull();
  });

  it("notice P9: Europa prioritaria vs Europa-15 tipifica secundarios (IE/PT primero)", () => {
    const notice = buildMarketsStaleNotice({
      scannedMarkets: EUROPE_PRIORITY_MARKETS,
      selectedMarkets: EUROPE,
      rowCount: 420,
    });
    expect(notice).not.toBeNull();
    expect(notice.label).toBe("Cobertura parcial");
    expect(notice.source).toBe("markets-partial-coverage");
    expect(notice.blocksResults).toBe(false);
    expect(notice.detail).toContain("Europa prioritaria");
    expect(notice.detail).toContain("Europa");
    expect(notice.detail).toContain("no es Europa completa");
    expect(notice.detail).toContain("secundarios");
    expect(notice.detail).toMatch(/Irlanda, Portugal/);
    expect(notice.detail).not.toContain("selección ≠ mesa");
    expect(notice.ctaLabel).toBe("Cargar Europa");
    expect(notice.stayCtaLabel).toBe("Quedarme en Europa prioritaria");
    expect(notice.peekDetail).toContain("secundarios Europa");
  });

  it("truth segments: Europa incompleta con secundarios ausentes", () => {
    const segments = buildScreenerTruthMarketSegments({
      scannedMarkets: EUROPE_PRIORITY_MARKETS,
      selectedMarkets: EUROPE,
      marketsMisaligned: true,
      europeCoverageHonesty: true,
    });
    expect(segments[0]).toBe("mesa: Europa prioritaria");
    expect(segments[1]).toMatch(/^Europa incompleta · faltan secundarios \(Irlanda, Portugal/);
    expect(segments).toHaveLength(2);
  });

  it("resolve settled: aviso estable sin loading eterno (EU1 ⊂ Europa)", () => {
    const notice = resolveMarketsMisalignmentNotice({
      scannedMarkets: EUROPE_PRIORITY_MARKETS,
      selectedMarkets: EUROPE,
      rowCount: 420,
      selectionLoadSettled: true,
    });
    expect(notice?.tone).toBe("warn");
    expect(notice?.label).toBe("Cobertura parcial");
    expect(notice?.detail).toContain("secundarios");
    expect(notice?.detail).not.toContain("Cargando");
  });
});
