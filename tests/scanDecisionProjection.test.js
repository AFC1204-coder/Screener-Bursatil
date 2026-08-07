import { describe, expect, it } from "vitest";
import { resultPayload as snapshotResultPayload, scanFromDb } from "@/app/api/scans/route";
import { DECISION_TRACE_ENGINE_VERSION, DECISION_TRACE_SCHEMA_VERSION } from "@/lib/decisionTraceVersion";
import { scanResultPayload as materializedResultPayload } from "@/lib/materializedScanner";
import { scanDecisionRowFromDb } from "@/lib/scanDecisionProjection";
import { buildDecisionEvidenceChecklist } from "@/lib/screenerExplainability";
import { scoreAuditStatusForRow } from "@/lib/screenerScoreAudit";
import { resultPayload as serverResultPayload, scoreRowsForServerScan } from "@/lib/serverScanRunner";

describe("scan decision projection", () => {
  it("persiste los campos necesarios para explicar una decision sin leer raw", () => {
    const payload = snapshotResultPayload({
      symbol: "STG",
      companyName: "Stage Radar",
      price: 42.5,
      marketCap: 3826251264,
      chartBarsCount: 260,
      dataCoverageScore: 88,
      technicalCoverageScore: 91,
      fundamentalCoverageScore: 40,
      setupDisplayPlanValid: true,
      setupDisplayReason: "Pivot limpio con volumen",
      rsGlobalPct: 93,
      rsSectorPct: 84,
      rsQualityScore: 79,
      weinsteinScore: 82,
      minerviniScore: 78,
      volumeEffectScore: 76,
      growthScore: 72,
      adProxyScore: 76,
      epsGrowthProxyScore: 72,
      riskRewardScore: 81,
      weaknessScore: 12,
      weaknessReasons: ["Sin deterioro relevante"],
      compositeReasons: ["Liderazgo relativo"],
      compositeRisks: ["Distancia a pivot elevada"],
    }, "scan-1", "owner-1", 0, { setupMode: "leader" });

    expect(payload.rank_index).toBe(1);
    expect(payload.raw.decisionTrace.engineVersion).toBe(DECISION_TRACE_ENGINE_VERSION);
    expect(payload.metrics.decisionTrace.engineVersion).toBe(DECISION_TRACE_ENGINE_VERSION);
    expect(payload.metrics.decisionTrace.priorityScore).toBe(payload.raw.decisionTrace.priorityScore);
    expect(payload.metrics.price).toBe(42.5);
    expect(payload.metrics.marketCap).toBe(3826251264);
    expect(payload.metrics.chartBarsCount).toBe(260);
    expect(payload.metrics.totalScore).toBeNull();
    expect(payload.metrics.dataCoverageScore).toBe(88);
    expect(payload.metrics.setupDisplayPlanValid).toBe(true);
    expect(payload.metrics.adProxyScore).toBe(76);
    expect(payload.metrics.epsGrowthProxyScore).toBe(72);
    expect(payload.metrics.riskRewardScore).toBe(81);
    expect(payload.metrics.weaknessReasons).toEqual(["Sin deterioro relevante"]);
    expect(payload.metrics.compositeReasons).toEqual(["Liderazgo relativo"]);
    expect(payload.metrics.compositeRisks).toEqual(["Distancia a pivot elevada"]);
    expect(payload.metrics.decisionTrace.readiness.key).toBe("watch");
    expect(payload.metrics.decisionTrace.issues.map((item) => item.key)).toContain("long-not-operable");
  });

  it("restaura un score completo aunque metrics/raw traigan totalScore nulo", () => {
    const payload = snapshotResultPayload({
      symbol: "CLEAN",
      companyName: "Clean Score Inc",
      price: 42.5,
      chartBarsCount: 260,
      totalScore: 74.56,
      compositeScore: 74.56,
      objectiveScore: 70.31,
      objectiveSetupScore: 55,
      patternScore: 86,
      patternContributionScore: 14,
      setupQualityScore: 80,
      rsGlobalPct: 90,
      rsQualityScore: 78,
      demandScore: 70,
      adProxyScore: 74,
      growthScore: 70,
      epsGrowthProxyScore: 68,
      sectorScore: 75,
      riskRewardScore: 72,
      riskScore: 62,
      momentumScore: 58,
      ipoScore: 20,
      dataCoverageScore: 88,
      technicalCoverageScore: 91,
      fundamentalCoverageScore: 40,
      priceFreshnessOk: true,
      setupDisplayPlanValid: true,
    }, "scan-1", "owner-1", 0, { setupMode: "leader" });

    expect(payload.metrics.totalScore).toBe(74.56);
    expect(payload.metrics.objectiveScore).toBe(70.31);
    expect(payload.metrics.patternScore).toBe(86);
    const restored = scanDecisionRowFromDb({
      ...payload,
      raw: { ...payload.raw, totalScore: null },
      metrics: { ...payload.metrics, totalScore: null },
    }, { decisionProjection: true });

    expect(restored.totalScore).toBe(74.56);
    expect(restored.objectiveScore).toBe(70.31);
    expect(restored.patternScore).toBe(86);
    expect(scoreAuditStatusForRow(restored)).toMatchObject({ clean: true, missing: false, mismatch: false });
  });

  it("reconstruye una fila ligera desde columnas y metrics para auditoria de decision", () => {
    const row = scanDecisionRowFromDb({
      symbol: "STG",
      company_name: "Stage Radar",
      total_score: 86,
      weinstein_score: 82,
      minervini_score: 78,
      risk_score: 71,
      rs_rating: 93,
      metrics: {
        price: "42.5",
        patternBarsCount: 260,
        setupDisplayPlanValid: true,
        setupDisplayReason: "Pivot limpio con volumen",
        rsGlobalPct: 93,
        decisionTrace: {
          schemaVersion: DECISION_TRACE_SCHEMA_VERSION,
          engineVersion: DECISION_TRACE_ENGINE_VERSION,
          priorityScore: 1280.5,
          readiness: { key: "operable", label: "Operable" },
          action: { key: "candidate-long", label: "Candidato largo" },
          issues: [],
          drivers: [{ key: "rs-global", label: "RS universo", value: "93" }],
          watch: [],
        },
      },
    }, { decisionProjection: true });

    expect(row.symbol).toBe("STG");
    expect(row.companyName).toBe("Stage Radar");
    expect(row.totalScore).toBe(86);
    expect(row.price).toBe(42.5);
    expect(row.chartBarsCount).toBe(260);
    expect(row.decisionTrace.readiness.key).toBe("operable");
    expect(row.decisionProjectionPartial).toBeUndefined();
  });

  it("conserva campos de evidencia metodologica en la proyeccion ligera", () => {
    const payload = snapshotResultPayload({
      symbol: "EVID",
      companyName: "Evidence Ready",
      price: 72,
      chartBarsCount: 260,
      priceFreshnessDays: 1,
      priceFreshnessMaxDays: 5,
      dataCoverageScore: 88,
      technicalCoverageScore: 91,
      fundamentalCoverageScore: 52,
      profileCoverageScore: 77,
      totalScore: 76,
      compositeScore: 76,
      setupQualityScore: 82,
      setupDisplayPlanValid: true,
      rsGlobalPct: 88,
      rsSectorPct: 82,
      rsSectorSample: 8,
      rsQualityScore: 79,
      weinsteinScore: 84,
      minerviniScore: 81,
      sectorScore: 78,
      groupStrengthScore: 78,
      volumeEffectScore: 42,
      adProxyScore: 41,
      relativeVolume: 1.0,
      upDownVolRatio: 1.35,
      demandScore: 42,
      growthScore: 72,
      epsGrowthProxyScore: 70,
      riskRewardScore: 76,
      riskScore: 64,
      momentumScore: 66,
      ipoScore: 20,
      extSma50: 8,
      maxDrawdown63d: 12,
      weaknessScore: 16,
    }, "scan-1", "owner-1", 0, { setupMode: "leader" });

    const restored = scanDecisionRowFromDb({ ...payload, raw: null }, { decisionProjection: true });
    const evidence = buildDecisionEvidenceChecklist(restored, { setupMode: "leader" });

    expect(restored.priceFreshnessMaxDays).toBe(5);
    expect(restored.upDownVolRatio).toBe(1.35);
    expect(restored.rsSectorSample).toBe(8);
    expect(evidence.status).toBe("ready");
    expect(evidence.items.find((item) => item.methodologyKey === "demand")).toMatchObject({
      status: "confirmed",
    });
    expect(evidence.items.find((item) => item.methodologyKey === "freshness")).toMatchObject({
      status: "confirmed",
    });
  });

  it("regenera una decisionTrace de motor antiguo antes de persistir snapshots", () => {
    const payload = snapshotResultPayload({
      symbol: "OLDTRACE",
      price: 42.5,
      chartBarsCount: 260,
      totalScore: 82,
      dataCoverageScore: 88,
      technicalCoverageScore: 91,
      fundamentalCoverageScore: 40,
      setupDisplayPlanValid: true,
      rsGlobalPct: 93,
      rsSectorPct: 84,
      rsQualityScore: 79,
      adProxyScore: 76,
      epsGrowthProxyScore: 72,
      riskRewardScore: 81,
      weaknessScore: 12,
      decisionTrace: {
        schemaVersion: DECISION_TRACE_SCHEMA_VERSION,
        engineVersion: "decision-trace-v1",
        priorityScore: 9999,
        readiness: { key: "operable", label: "Operable" },
        action: { key: "candidate-long", label: "Candidato largo" },
      },
    }, "scan-1", "owner-1", 0, { setupMode: "leader" });

    expect(payload.raw.decisionTrace.engineVersion).toBe(DECISION_TRACE_ENGINE_VERSION);
    expect(payload.metrics.decisionTrace.engineVersion).toBe(DECISION_TRACE_ENGINE_VERSION);
    expect(payload.metrics.decisionTrace.priorityScore).not.toBe(9999);
  });

  it("prepara decisionTrace fresca en el writer del scan server-side", () => {
    const payload = serverResultPayload({
      symbol: "SVR",
      price: 50,
      chartBarsCount: 260,
      totalScore: 82,
      rsGlobalPct: 90,
      setupDisplayPlanValid: true,
      decisionTrace: {
        schemaVersion: DECISION_TRACE_SCHEMA_VERSION,
        engineVersion: "decision-trace-v1",
        priorityScore: 9999,
        readiness: { key: "operable", label: "Operable" },
        action: { key: "candidate-long", label: "Candidato largo" },
      },
    }, "scan-1", "owner-1", 7, { setupMode: "leader" });

    expect(payload.rank_index).toBe(7);
    expect(payload.raw.decisionTrace.engineVersion).toBe(DECISION_TRACE_ENGINE_VERSION);
    expect(payload.metrics.decisionTrace.engineVersion).toBe(DECISION_TRACE_ENGINE_VERSION);
    expect(payload.metrics.decisionTrace.priorityScore).toBe(payload.raw.decisionTrace.priorityScore);
    expect(payload.metrics.decisionTrace.priorityScore).not.toBe(9999);
  });

  it("calcula score completo antes de persistir filas server-side", () => {
    const [scored] = scoreRowsForServerScan([{
      symbol: "SRVSC",
      companyName: "Server Scored",
      theme: "Technology",
      sector: "Technology",
      industry: "Software",
      country: "US",
      price: 50,
      chartBarsCount: 260,
      priceFreshnessOk: true,
      priceFreshnessDays: 1,
      priceFreshnessMaxDays: 4,
      dataCoverageScore: 88,
      technicalCoverageScore: 91,
      fundamentalCoverageScore: 40,
      rsRating: 90,
      rsGlobalPct: 90,
      rsSectorPct: 84,
      weinsteinScore: 82,
      minerviniScore: 78,
      momentumScore: 76,
      riskScore: 71,
      riskRewardScore: 81,
      volumeScore: 78,
      volumeEffectScore: 76,
      liquidityScore: 74,
      avgTurnover: 25_000_000,
      relativeVolume: 1.7,
      perf3m: 18,
      perf6m: 34,
      perf12m: 42,
      growthMetrics: { revenueGrowth: 25, earningsGrowth: 30 },
      setupDisplayPlanValid: true,
      setupDisplayStrict: true,
    }]);
    const payload = serverResultPayload(scored, "scan-1", "owner-1", 1, { setupMode: "leader" });
    const restored = scanDecisionRowFromDb(payload, { decisionProjection: true });

    expect(Number.isFinite(scored.totalScore)).toBe(true);
    expect(Number.isFinite(payload.metrics.totalScore)).toBe(true);
    expect(scoreAuditStatusForRow(restored).missing).toBe(false);
  });

  it("prepara decisionTrace fresca en snapshots materializados", () => {
    const payload = materializedResultPayload({
      symbol: "MAT",
      price: 50,
      chartBarsCount: 260,
      totalScore: 82,
      rsGlobalPct: 90,
      setupDisplayPlanValid: true,
    }, "scan-1", "owner-1", 2, { setupMode: "leader" });

    expect(payload.rank_index).toBe(3);
    expect(payload.raw.decisionTrace.engineVersion).toBe(DECISION_TRACE_ENGINE_VERSION);
    expect(payload.metrics.decisionTrace.engineVersion).toBe(DECISION_TRACE_ENGINE_VERSION);
    expect(payload.metrics.decisionTrace.priorityScore).toBe(payload.raw.decisionTrace.priorityScore);
  });

  it("repara decisionTrace antigua al restaurar un snapshot desde Supabase", () => {
    const scan = scanFromDb({
      id: "cloud-1",
      local_id: "scan-legacy",
      name: "Snapshot legacy",
      settings: { activeSettings: { setupMode: "leader" } },
      row_count: 1,
    }, [{
      scan_id: "cloud-1",
      rank_index: 1,
      raw: {
        symbol: "REST",
        price: 50,
        chartBarsCount: 260,
        totalScore: 82,
        dataCoverageScore: 88,
        technicalCoverageScore: 91,
        fundamentalCoverageScore: 40,
        setupDisplayPlanValid: true,
        rsGlobalPct: 90,
        decisionTrace: {
          schemaVersion: DECISION_TRACE_SCHEMA_VERSION,
          engineVersion: "decision-trace-v1",
          priorityScore: 9999,
          readiness: { key: "operable", label: "Operable" },
          action: { key: "candidate-long", label: "Candidato largo" },
          issues: [],
        },
      },
    }]);

    expect(scan.rows[0].decisionTrace.engineVersion).toBe(DECISION_TRACE_ENGINE_VERSION);
    expect(scan.rows[0].decisionTrace.priorityScore).not.toBe(9999);
    expect(scan.rows[0].decisionTrace.priority.components.length).toBeGreaterThanOrEqual(3);
  });

  it("marca como parcial una proyeccion antigua sin precio o historico suficiente", () => {
    const row = scanDecisionRowFromDb({
      symbol: "OLD",
      metrics: {
        setupDisplayPlanValid: true,
      },
    }, { decisionProjection: true });

    expect(row.decisionProjectionPartial).toBe(true);
    expect(row.decisionProjectionMissing).toEqual(["chartBarsCount", "price"]);
  });
});
