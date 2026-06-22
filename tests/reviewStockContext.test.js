import { describe, expect, it } from "vitest";
import { DECISION_TRACE_ENGINE_VERSION, DECISION_TRACE_SCHEMA_VERSION } from "@/lib/decisionTraceVersion";
import { buildReviewStockOpenContext } from "@/lib/reviewStockContext";

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

describe("buildReviewStockOpenContext", () => {
  it("preserva perfil, decision y cola al abrir ficha desde review", () => {
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

    const context = buildReviewStockOpenContext(fragileOperable, {
      settings: { setupMode: "leader" },
      source: "current",
      sourceLabel: "Screener actual",
      rank: 2,
      queueSize: 7,
      rowsCount: 12,
      visibleCount: 7,
      hiddenCount: 5,
      openedAt: "2026-06-15T12:00:00.000Z",
    });

    expect(context.sourceLabel).toBe("Review · Screener actual");
    expect(context.symbol).toBe("FRAG");
    expect(context.rank).toBe(2);
    expect(context.queueSize).toBe(7);
    expect(context.decisionProfile).toEqual({
      key: "operable-fragile",
      label: "Operable fragil",
      tone: "warn",
      detail: "Operable, pero con confianza limitada o confluencia minima.",
    });
    expect(context.readiness.key).toBe("operable");
    expect(context.decisionTrace.confidence.key).not.toBe("high");
    expect(context.decisionTrace.evidence.status).toBe("needs-work");
    expect(context.decisionTrace.evidence.pending.map((item) => item.key)).toContain("confluencia-amplia");
    expect(context.dataHealth).toMatchObject({
      status: { key: "ready", label: "Datos aptos" },
      coverageScore: 82,
    });
    expect(context.scoreAudit).toMatchObject({
      displayedScore: 82,
      integrityTone: "warn",
    });
    expect(context.metricTruth).toMatchObject({
      key: "missing",
      shortLabel: "Sin audit",
      tone: "warn",
    });
    expect(context.methodologyFocus).toMatchObject({
      key: "confluence",
      label: "Confluencia amplia",
      tone: "warn",
      requiresReview: true,
    });
    expect(context.reviewFocus).toMatchObject({
      key: "score",
      label: "Score",
      tone: "warn",
    });
    expect(context.reviewFocus.detail).toBeTruthy();
    expect(context.methodologyFocus.detail).toMatch(/liderazgo|confirmacion|ejecucion|unico motor/i);
    expect(context.scoreAudit.components.map((item) => item.key)).toContain("rs");
    expect(context.statusText).toMatch(/acciones ocultas/i);
  });

  it("preserva la trazabilidad de metricas objetivas al abrir ficha", () => {
    const context = buildReviewStockOpenContext({
      ...strongRow,
      symbol: "METR",
      objectiveMetricAudit: {
        schemaVersion: 1,
        status: "verified",
        checkedCount: 3,
        verifiedCount: 2,
        traceableCount: 1,
        issues: [],
        items: [
          { key: "sma50", label: "SMA50", status: "verified", proxy: false },
          { key: "sma200", label: "SMA200", status: "verified", proxy: false },
          { key: "adProxyScore", label: "A/D proxy", status: "traceable", proxy: true },
        ],
      },
    }, {
      settings: { setupMode: "leader" },
      sourceLabel: "Screener actual",
      rank: 1,
      queueSize: 1,
      rowsCount: 1,
    });

    expect(context.metricTruth).toMatchObject({
      key: "mixed",
      label: "Métricas mixtas",
      shortLabel: "Mixto",
      tone: "neutral",
      measuredCount: 2,
      proxyCount: 1,
    });
    expect(context.metricTruth.detail).toMatch(/2 medidas/i);
    expect(context.metricTruth.detail).toMatch(/1 proxy/i);
  });

  it("incluye el foco de pruebas activo al abrir ficha desde un filtro de Review", () => {
    const context = buildReviewStockOpenContext({
      ...strongRow,
      symbol: "BLOCK",
      decisionProjectionPartial: true,
      decisionProjectionMissing: ["chartBarsCount", "price"],
    }, {
      settings: { setupMode: "leader" },
      sourceLabel: "Screener actual",
      digestFilter: "blocked",
      rank: 1,
      queueSize: 3,
      rowsCount: 12,
      visibleCount: 3,
    });

    expect(context.decisionFocus).toMatchObject({
      state: "blocked",
      stateLabel: "Bloqueada",
      filterKey: "blocked",
      filterLabel: "Bloqueadas",
    });
    expect(context.decisionFocus.ratio).toMatch(/\d\/9/);
    expect(context.decisionFocus.check.label).toBeTruthy();
    expect(context.decisionFocus.instruction).toMatch(/Resolver bloqueo/i);
  });

  it("preserva el origen de una cola de trabajo pendiente al abrir ficha", () => {
    const context = buildReviewStockOpenContext(strongRow, {
      settings: { setupMode: "leader" },
      source: "current",
      sourceLabel: "Trabajo pendiente",
      digestFilter: "all",
      rank: 1,
      queueSize: 2,
      rowsCount: 2,
      visibleCount: 2,
    });

    expect(context.sourceLabel).toBe("Review · Trabajo pendiente");
    expect(context.presetName).toBe("Trabajo pendiente");
    expect(context.queueSize).toBe(2);
  });

  it("preserva el detalle trazable de la cola al abrir ficha", () => {
    const context = buildReviewStockOpenContext(strongRow, {
      settings: { setupMode: "leader" },
      source: "current",
      sourceLabel: "Vista filtrada",
      sourceDetail: "Brief vista: Pruebas: Validar · Freno: Confluencia amplia",
      queueMode: "filtered-view",
      digestFilter: "needs-work",
      rank: 1,
      queueSize: 1,
      rowsCount: 3,
      visibleCount: 1,
      hiddenCount: 2,
    });

    expect(context.sourceLabel).toBe("Review · Vista filtrada");
    expect(context.sourceDetail).toBe("Brief vista: Pruebas: Validar · Freno: Confluencia amplia");
    expect(context.queueMode).toBe("filtered-view");
    expect(context.statusText).toMatch(/acciones ocultas/i);
  });

  it("preserva la subcola de resolucion al abrir ficha desde candidatas", () => {
    const context = buildReviewStockOpenContext(strongRow, {
      settings: { setupMode: "leader" },
      source: "current",
      sourceLabel: "Trabajo pendiente",
      digestFilter: "all",
      resolutionFilter: "candidate",
      rank: 1,
      queueSize: 1,
      rowsCount: 2,
      visibleCount: 1,
    });

    expect(context.sourceLabel).toBe("Review · Trabajo pendiente");
    expect(context.decisionFocus).toMatchObject({
      resolutionFilterKey: "candidate",
      resolutionFilterLabel: "Candidata",
      queueFilterLabel: "Candidata",
    });
  });

  it("recalcula una decisionTrace legacy antes de abrir ficha", () => {
    const riskyLegacy = {
      ...strongRow,
      symbol: "OLD",
      rsGlobalPct: 55,
      extSma50: 24,
      riskRewardScore: 42,
      decisionTrace: {
        schemaVersion: 1,
        priorityScore: 9999,
        readiness: { key: "operable", label: "Operable" },
        action: { key: "candidate-long", label: "Candidato largo" },
        confidence: { key: "high", score: 96, label: "Alta" },
        issues: [],
      },
    };

    const context = buildReviewStockOpenContext(riskyLegacy, {
      settings: { setupMode: "leader" },
      sourceLabel: "Screener actual",
      rank: 1,
      queueSize: 1,
      rowsCount: 1,
    });

    expect(context.decisionTrace.priorityScore).not.toBe(9999);
    expect(context.decisionTrace.priority.components.map((item) => item.key)).toEqual(["readiness", "action", "score", "rs", "riskReward"]);
    expect(context.decisionTrace.issues.map((item) => item.key)).toEqual(expect.arrayContaining(["missing-global-rs", "overextended-sma50"]));
    expect(context.decisionTrace.evidence.pending.map((item) => item.key)).toEqual(expect.arrayContaining(["precio-perseguible"]));
    expect(context.decisionTrace.evidence.items.find((item) => item.key === "liderazgo-global")).toMatchObject({
      status: "confirmed",
      tone: "neutral",
    });
    expect(context.decisionIssues.map((item) => item.key)).toEqual(expect.arrayContaining(["missing-global-rs", "overextended-sma50"]));
  });

  it("recalcula una decisionTrace actual cuando pertenece a otro contexto", () => {
    const staleContext = {
      ...strongRow,
      symbol: "CTX",
      decisionTrace: {
        schemaVersion: DECISION_TRACE_SCHEMA_VERSION,
        engineVersion: DECISION_TRACE_ENGINE_VERSION,
        priorityScore: 820,
        priority: {
          score: 820,
          components: [
            { key: "readiness", label: "Decision", value: 660 },
            { key: "action", label: "Accion", value: 80 },
            { key: "score", label: "Score", value: 80 },
          ],
          issuePenalty: 0,
          penalties: [],
        },
        readiness: { key: "watch", label: "Vigilar" },
        action: { key: "candidate-with-watch", label: "Candidato" },
        confidence: { key: "medium", score: 64, label: "Media" },
        issues: [],
      },
    };

    const context = buildReviewStockOpenContext(staleContext, {
      settings: { setupMode: "leader" },
      sourceLabel: "Screener actual",
      rank: 1,
      queueSize: 1,
      rowsCount: 1,
    });

    expect(context.decisionTrace.priorityScore).not.toBe(820);
    expect(context.decisionTrace.readiness.key).toBe("operable");
    expect(context.decisionTrace.action.key).toBe("candidate-long");
  });
});
