import { describe, expect, it } from "vitest";
import { resultPayload as snapshotResultPayload, scanFromDb } from "@/app/api/scans/route";
import { DECISION_TRACE_ENGINE_VERSION, DECISION_TRACE_SCHEMA_VERSION } from "@/lib/decisionTraceVersion";
import { scanResultPayload as materializedResultPayload } from "@/lib/materializedScanner";
import { scanDecisionMetrics, scanDecisionRowFromDb } from "@/lib/scanDecisionProjection";
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
    // decisionTrace vive SOLO en metrics desde la poda de escritura.
    expect(payload.raw).not.toHaveProperty("decisionTrace");
    expect(payload.metrics.decisionTrace.engineVersion).toBe(DECISION_TRACE_ENGINE_VERSION);
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

    expect(payload.raw).not.toHaveProperty("decisionTrace");
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
    expect(payload.raw).not.toHaveProperty("decisionTrace");
    expect(payload.metrics.decisionTrace.engineVersion).toBe(DECISION_TRACE_ENGINE_VERSION);
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
    expect(payload.raw).not.toHaveProperty("decisionTrace");
    expect(payload.metrics.decisionTrace.engineVersion).toBe(DECISION_TRACE_ENGINE_VERSION);
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

  it("no inventa percentileScope batch cuando la fila no lo trae", () => {
    const metrics = scanDecisionMetrics({ symbol: "NOSCOPE", price: 10 });
    expect(metrics.percentileScope).toBeNull();

    const restored = scanDecisionRowFromDb({
      symbol: "NOSCOPE",
      metrics,
    }, { decisionProjection: true });
    expect(restored.percentileScope).toBeUndefined();
  });

  it("conserva percentileScope batch o final cuando viene explicito", () => {
    const batchMetrics = scanDecisionMetrics({ symbol: "BAT", percentileScope: "batch" });
    expect(batchMetrics.percentileScope).toBe("batch");

    const finalMetrics = scanDecisionMetrics({ symbol: "FIN", percentileScope: "final" });
    expect(finalMetrics.percentileScope).toBe("final");

    const restored = scanDecisionRowFromDb({
      symbol: "BAT",
      metrics: batchMetrics,
    }, { decisionProjection: true });
    expect(restored.percentileScope).toBe("batch");
  });
});

// ===========================================================================
// Poda de escritura de `raw` (docs/flushbatches-timeout-2026-08-10.md)
// ===========================================================================
//
// Dos ahorros medidos sobre los 89 kB de JSON por fila que hacían que una tanda
// de 50 filas rozara el statement_timeout de 8 s:
//   · chartPreview persistido en su forma compacta (48 puntos ligeros) en vez
//     de 96 barras OHLC.
//   · objectiveMetricAudit y decisionTrace una sola vez, en `metrics`.
// Ninguno cambia lo que ve el usuario: las tres MiniSparkline del repo solo
// leen close/sma50/sma200/volume, y scanDecisionRowFromDb ya daba prioridad a
// la copia de `metrics` sobre la de `raw`.

const CHART_PREVIEW_96 = Array.from({ length: 96 }, (_, i) => ({
  date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
  open: 100 + i,
  high: 105 + i,
  low: 95 + i,
  close: 102 + i,
  volume: 1000 + i * 10,
  sma50: 90 + i,
  sma200: 80 + i,
}));

const AUDIT_FIXTURE = {
  schemaVersion: 1,
  status: "verified",
  worstStatus: "verified",
  items: [{ key: "totalScore", label: "Total", value: 70, expected: 70, status: "verified" }],
  issues: [],
};

const WRITERS = [
  ["scan servidor (lib/serverScanRunner)", (row) => serverResultPayload(row, "scan-1", "owner-1", 1, {})],
  ["snapshot cliente (app/api/scans)", (row) => snapshotResultPayload(row, "scan-1", "owner-1", 0, {})],
  ["cron materializado (lib/materializedScanner)", (row) => materializedResultPayload(row, "scan-1", "owner-1", 0, {})],
];

describe("poda de escritura de scan_results.raw", () => {
  for (const [nombre, build] of WRITERS) {
    describe(nombre, () => {
      const payload = build({
        symbol: "PODA",
        companyName: "Poda SA",
        price: 120,
        chartBarsCount: 260,
        totalScore: 70,
        objectiveMetricAudit: AUDIT_FIXTURE,
        chartPreview: CHART_PREVIEW_96,
      });

      it("persiste el chartPreview compacto, sin OHLC", () => {
        expect(payload.raw.chartPreview).toHaveLength(48);
        for (const campo of ["open", "high", "low"]) {
          expect(payload.raw.chartPreview[0]).not.toHaveProperty(campo);
        }
        expect(Object.keys(payload.raw.chartPreview[0]).sort())
          .toEqual(["close", "date", "sma200", "sma50", "volume"]);
      });

      it("conserva las 48 barras MÁS RECIENTES, no las 48 primeras", () => {
        // La miniatura marca points[length-1] como último cierre: si la ventana
        // fuese la mitad vieja, ese punto sería un precio caduco.
        expect(payload.raw.chartPreview.at(-1).close).toBe(CHART_PREVIEW_96.at(-1).close);
        expect(payload.raw.chartPreview[0].close).toBe(CHART_PREVIEW_96[48].close);
      });

      it("no duplica objectiveMetricAudit ni decisionTrace entre raw y metrics", () => {
        expect(payload.raw).not.toHaveProperty("objectiveMetricAudit");
        expect(payload.raw).not.toHaveProperty("decisionTrace");
        // No se pierden: siguen en metrics, que es la copia que gana al leer.
        expect(payload.metrics.objectiveMetricAudit).toBeTruthy();
        expect(payload.metrics.decisionTrace).toBeTruthy();
      });

      it("ningún campo pesado queda escrito dos veces", () => {
        const duplicados = Object.keys(payload.raw)
          .filter((key) => key in payload.metrics)
          .filter((key) => JSON.stringify(payload.raw[key] ?? null).length > 512);
        expect(duplicados).toEqual([]);
      });
    });
  }

  it("la fila que llega al escritor NO se muta: la poda es solo de persistencia", () => {
    const row = { symbol: "MEM", chartPreview: CHART_PREVIEW_96, objectiveMetricAudit: AUDIT_FIXTURE };
    serverResultPayload(row, "scan-1", "owner-1", 1, {});
    expect(row.chartPreview).toHaveLength(96);
    expect(row.chartPreview[0]).toHaveProperty("open");
    expect(row.objectiveMetricAudit).toBe(AUDIT_FIXTURE);
  });

  it("al releer de la base, la interfaz sigue viendo auditoría y traza", () => {
    const payload = serverResultPayload({
      symbol: "PODA",
      price: 120,
      chartBarsCount: 260,
      objectiveMetricAudit: AUDIT_FIXTURE,
      chartPreview: CHART_PREVIEW_96,
    }, "scan-1", "owner-1", 1, {});
    const row = scanDecisionRowFromDb({ ...payload, raw: payload.raw, metrics: payload.metrics });
    expect(row.objectiveMetricAudit).toBeTruthy();
    expect(row.decisionTrace).toBeTruthy();
    expect(row.chartPreview).toHaveLength(48);
  });
});
