import { describe, expect, it } from "vitest";
import { applyResultViewFilters } from "@/lib/screenerResultView";
import { buildReviewProfileSummary, prepareReviewQueueRows } from "@/lib/decisionProfile";
import { auditRestoredScanRow, buildScreenerAuditabilitySummary, buildScreenerReliability } from "@/lib/screenerReliability";

const strongRow = {
  symbol: "HIGH",
  price: 50,
  chartBarsCount: 260,
  priceFreshnessOk: true,
  dataCoverageScore: 82,
  technicalCoverageScore: 88,
  fundamentalCoverageScore: 64,
  totalScore: 82,
  rsGlobalPct: 90,
  rsSectorPct: 82,
  rsQualityScore: 78,
  weinsteinScore: 86,
  minerviniScore: 82,
  volumeEffectScore: 76,
  adProxyScore: 74,
  growthScore: 70,
  epsGrowthProxyScore: 68,
  riskRewardScore: 72,
  weaknessScore: 12,
  extSma50: 10,
  setupDisplayPlanValid: true,
};

const cleanReliableRow = {
  ...strongRow,
  symbol: "REL",
  totalScore: 74.56,
  setupQualityScore: 80,
  demandScore: 70,
  sectorScore: 75,
  riskScore: 62,
  momentumScore: 58,
  ipoScore: 20,
};

describe("screener result view filters", () => {
  it("ignora filtros fantasma de juicio del sistema", () => {
    const partialRow = {
      ...strongRow,
      symbol: "LOW",
      decisionProjectionPartial: true,
      decisionProjectionMissing: ["chartBarsCount", "price"],
    };
    const rows = [strongRow, partialRow];

    expect(applyResultViewFilters(rows, {
      confidenceFilter: "high",
      readinessFilter: "operable",
      actionFilter: "watch",
      decisionProfileFilter: "operable-clean",
      reviewPriorityFilter: "focus-now",
      reliabilityFilter: "reliable",
      decisionEvidenceFilter: "ready",
      dataHealthFilter: "ready",
      scoreAuditFilter: "clean",
      decisionIssueFilter: "incomplete-decision-evidence",
      activeSettings: { setupMode: "leader" },
    }).map((row) => row.symbol)).toEqual(["HIGH", "LOW"]);
  });

  it("filtra por resolución guardada de decision", () => {
    const watchRow = { ...strongRow, symbol: "WAIT" };
    const pendingRow = { ...strongRow, symbol: "PEND" };
    const decisionResolutions = {
      HIGH: { key: "candidate", label: "Candidata", tone: "good" },
      WAIT: { key: "watch", label: "Vigilar", tone: "warn" },
    };

    expect(applyResultViewFilters([strongRow, watchRow, pendingRow], {
      decisionResolutionFilter: "candidate",
      decisionResolutions,
    }).map((row) => row.symbol)).toEqual(["HIGH"]);

    expect(applyResultViewFilters([strongRow, watchRow, pendingRow], {
      decisionResolutionFilter: "watch",
      decisionResolutions,
    }).map((row) => row.symbol)).toEqual(["WAIT"]);

    expect(applyResultViewFilters([strongRow, watchRow, pendingRow], {
      decisionResolutionFilter: "pending",
      decisionResolutions,
    }).map((row) => row.symbol)).toEqual(["PEND"]);
  });

  it("filtra por capas visibles de vista", () => {
    const usRow = { ...strongRow, symbol: "US1", country: "US", theme: "Software / IA", sector: "Software", industry: "Apps" };
    const euRow = { ...strongRow, symbol: "EU1", country: "DE", theme: "Industrial", sector: "Machinery", industry: "Tools" };

    expect(applyResultViewFilters([usRow, euRow], {
      viewLayers: { country: true },
      countryFilter: "US",
    }).map((row) => row.symbol)).toEqual(["US1"]);

    expect(applyResultViewFilters([usRow, euRow], {
      viewLayers: { theme: true },
      themeFilter: "Industrial",
    }).map((row) => row.symbol)).toEqual(["EU1"]);
  });

  it("clasifica la fiabilidad combinando datos, score, pruebas y confianza", () => {
    const needsValidationRow = {
      ...cleanReliableRow,
      symbol: "VAL",
      priceFreshnessOk: false,
      priceFreshnessDays: 9,
      priceFreshnessMaxDays: 4,
      priceFreshnessIssue: "precio viejo: 9d > 4d",
    };
    const missingScoreRow = {
      ...cleanReliableRow,
      symbol: "MISS",
      demandScore: undefined,
      sectorScore: undefined,
      riskRewardScore: undefined,
    };
    const blockedRow = {
      ...cleanReliableRow,
      symbol: "BLOCK",
      decisionProjectionPartial: true,
      decisionProjectionMissing: ["price", "chartBarsCount"],
    };

    expect(buildScreenerReliability(cleanReliableRow, { setupMode: "leader" }).key).toBe("reliable");
    expect(buildScreenerReliability(needsValidationRow, { setupMode: "leader" }).key).toBe("needs-validation");
    expect(buildScreenerReliability(missingScoreRow, { setupMode: "leader" }).key).toBe("needs-validation");
    expect(buildScreenerReliability(blockedRow, { setupMode: "leader" }).key).toBe("blocked");
  });

  it("no eleva a alta fiabilidad una fila auditable con señal crítica débil", () => {
    const weakDemandRow = {
      ...cleanReliableRow,
      symbol: "WEAKD",
      demandScore: 40,
      volumeEffectScore: 40,
      adProxyScore: 40,
      relativeVolume: 0.8,
      upDownVolRatio: 0.8,
      totalScore: 68.84,
    };

    const state = buildScreenerReliability(weakDemandRow, { setupMode: "leader" });

    expect(state.key).toBe("needs-validation");
    expect(state.auditabilityKey).toBe("audit-ready");
    expect(state.evidenceKey).toBe("ready");
    expect(state.methodologyWarningKeys).toContain("methodology-demand");
  });

  it("marca como limitada una fila restaurada sin score mostrado", () => {
    const missingDisplayedScore = {
      ...cleanReliableRow,
      symbol: "NOSCORE",
      totalScore: undefined,
      compositeScore: undefined,
    };

    const auditability = auditRestoredScanRow(missingDisplayedScore, { setupMode: "leader" });
    expect(auditability).toMatchObject({ key: "data-limited", scoreTraceable: false });
    expect(auditability.scoreMissing).toContain("Score mostrado");
    expect(buildScreenerReliability(missingDisplayedScore, { setupMode: "leader" }).key).toBe("needs-validation");
  });

  it("resume auditabilidad interna sin tratarla como probabilidad de acierto", () => {
    const weakButComplete = {
      ...cleanReliableRow,
      symbol: "WEAK",
      rsGlobalPct: 55,
      totalScore: 68.96,
    };
    const missingDisplayedScore = {
      ...cleanReliableRow,
      symbol: "NOSCORE",
      totalScore: undefined,
      compositeScore: undefined,
    };
    const summary = buildScreenerAuditabilitySummary([cleanReliableRow, weakButComplete, missingDisplayedScore], { setupMode: "leader" });

    expect(summary.rows).toBe(3);
    expect(summary.counts.snapshotReady).toBe(2);
    expect(summary.snapshotIntegrity).toBe("67%");
    expect(summary.verdict.label).toBe("Contrato incompleto");
    expect(summary.counts.manualReviewRequired).toBe(0);
    expect(summary.methodologyLimitations).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "leadership", label: "Liderazgo global", tone: "neutral", count: 1 }),
    ]));
  });

  it("resume focos globales de revision metodologica sin mezclarlos con contexto neutral", () => {
    const weakDemandRow = {
      ...cleanReliableRow,
      symbol: "WEAKD",
      demandScore: 40,
      volumeEffectScore: 40,
      adProxyScore: 40,
      relativeVolume: 0.8,
      upDownVolRatio: 0.8,
      totalScore: 68.84,
    };
    const neutralLeadershipRow = {
      ...cleanReliableRow,
      symbol: "NEUTRAL",
      rsGlobalPct: 58,
      rsQualityScore: 52,
      weinsteinScore: 55,
      minerviniScore: 54,
      totalScore: 68.84,
    };
    const summary = buildScreenerAuditabilitySummary([cleanReliableRow, weakDemandRow, neutralLeadershipRow], { setupMode: "leader" });

    expect(summary.counts.manualReviewRequired).toBe(2);
    expect(summary.methodologyReviewFocus).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "demand", label: "Demanda/volumen", tone: "warn", count: 1 }),
      expect.objectContaining({ key: "confluence", label: "Confluencia amplia", tone: "warn", count: 1 }),
    ]));
    expect(summary.methodologyReviewFocus.map((item) => item.key)).not.toContain("leadership");
    expect(summary.methodologyLimitations).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "leadership", tone: "neutral", count: 1 }),
    ]));
  });

  it("conserva desglose de tonos cuando una categoria mezcla neutral y advertencia", () => {
    const neutralSectorRow = {
      ...cleanReliableRow,
      symbol: "NEUSEC",
      sectorScore: 52,
      groupStrengthScore: 52,
      rsSectorPct: 56,
    };
    const weakSectorRow = {
      ...cleanReliableRow,
      symbol: "WEAKSEC",
      sectorScore: 45,
      groupStrengthScore: 45,
      rsSectorPct: 44,
      totalScore: 71.56,
    };
    const summary = buildScreenerAuditabilitySummary([neutralSectorRow, weakSectorRow], { setupMode: "leader" });
    const sector = summary.methodologyLimitations.find((item) => item.key === "sector-context");

    expect(sector).toMatchObject({
      count: 2,
      tone: "warn",
      toneCounts: { neutral: 1, warn: 1 },
    });
    expect(sector.toneSummary).toContain("1 warn");
    expect(sector.toneSummary).toContain("1 neutral");
  });

  it("la cola de revisión respeta el orden de llegada y los perfiles solo resumen", () => {
    const fragileOperable = {
      ...strongRow,
      symbol: "FRAG",
      rsGlobalPct: 74,
      rsSectorPct: 71,
      rsQualityScore: 52,
      weinsteinScore: 55,
      minerviniScore: 54,
      volumeEffectScore: 69,
      adProxyScore: 50,
      growthScore: 45,
      epsGrowthProxyScore: 45,
      riskRewardScore: 68,
    };
    const watchRow = {
      ...strongRow,
      symbol: "WAIT",
      setupDisplayPlanValid: false,
      setupDisplayStrict: false,
      setupDisplayWatch: false,
      setupQualityScore: 55,
    };

    const queue = prepareReviewQueueRows([watchRow, fragileOperable, strongRow], { setupMode: "leader" });
    expect(queue.map((row) => row.symbol)).toEqual(["WAIT", "FRAG", "HIGH"]);

    const summary = buildReviewProfileSummary(queue, { setupMode: "leader" });
    expect(summary.map((group) => [group.key, group.count, group.firstIndex])).toEqual([
      ["operable-clean", 1, 2],
      ["operable-fragile", 1, 1],
      ["other", 1, 0],
    ]);
  });
});
