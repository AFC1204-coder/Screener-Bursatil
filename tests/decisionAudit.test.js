import { describe, expect, it } from "vitest";
import { auditDecisionPayload, auditDecisionRowIssues, buildDecisionAuditExportPayload, buildDecisionTrace, decisionConfidenceSummary, decisionPriorityBreakdown, decisionPriorityScore, decisionTraceForRow, isDecisionTraceCurrent, normalizeDecisionAuditPayload } from "@/lib/decisionAudit";
import { DECISION_TRACE_ENGINE_VERSION, DECISION_TRACE_SCHEMA_VERSION } from "@/lib/decisionTraceVersion";

const strongRow = {
  symbol: "GOOD",
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

describe("decision audit", () => {
  it("normaliza arrays, payloads de API y scans sueltos", () => {
    expect(normalizeDecisionAuditPayload([{ id: "a", rows: [] }]).scans).toHaveLength(1);
    expect(normalizeDecisionAuditPayload({ rows: [] }).scans).toHaveLength(1);
    expect(normalizeDecisionAuditPayload({ scans: [{ id: "a", rows: [] }] }).scans).toHaveLength(1);
  });

  it("audita decisiones desde un payload offline sin llamar al endpoint", () => {
    const report = auditDecisionPayload({
      projection: "fixture",
      scans: [{
        id: "scan-1",
        name: "Fixture",
        rows: [
          strongRow,
          { ...strongRow, symbol: "WATCH", rsGlobalPct: 55 },
          { ...strongRow, symbol: "AUDIT", chartBarsCount: 30, decisionProjectionPartial: true, decisionProjectionMissing: ["chartBarsCount"] },
        ],
      }],
    }, { source: "file", file: "fixture.json", scannedAt: "2026-06-15T00:00:00.000Z" });

    expect(report.source).toBe("file");
    expect(report.file).toBe("fixture.json");
    expect(report.projection).toBe("fixture");
    expect(report.rows).toBe(3);
    expect(report.decisionShare.operable.count).toBe(1);
    expect(report.decisionShare.watch.count).toBe(1);
    expect(report.decisionShare.audit.count).toBe(1);
    expect(report.partialProjection.count).toBe(1);
    expect(report.decisionQuality.longCandidateRisk.count).toBe(1);
    expect(report.decisionQuality.topIssues.map((item) => item.key)).toEqual(expect.arrayContaining(["missing-global-rs", "partial-projection"]));
    expect(report.scoreAudit.rows).toBe(3);
    expect(report.scoreAudit.verdict.key).toBeTruthy();
    expect(report.suspiciousOperable).toEqual([]);
  });

  it("construye un JSON exportable desde la UI y el auditor lo entiende", () => {
    const payload = buildDecisionAuditExportPayload({
      id: "export-1",
      exportedAt: "2026-06-15T10:00:00.000Z",
      name: "Balanced · 1 visible",
      preset: "balanced",
      activeSettings: { setupMode: "leader" },
      filterLayers: { trend: true, marketRegime: true },
      fieldRules: { minRs: true },
      viewLayers: { country: true },
      viewFilters: { countryFilter: "US", sort: "totalScore" },
      marketScore: 74,
      marketRegime: "Riesgo favorable",
      rows: [strongRow],
    });

    expect(payload.projection).toBe("screener-decision-audit-export");
    expect(payload.rowCount).toBe(1);
    expect(payload.dataHealth).toMatchObject({
      rows: 1,
      readyCount: 1,
      attentionCount: 0,
      counts: { ready: 1 },
    });
    expect(payload.scoreAudit).toMatchObject({
      rows: 1,
      mismatchCount: 1,
      verdict: { key: "residual" },
    });
    expect(payload.scans[0]).toMatchObject({
      id: "export-1",
      name: "Balanced · 1 visible",
      rowsAreFilteredSnapshot: true,
      marketScore: 74,
      marketRegime: "Riesgo favorable",
    });
    expect(payload.scans[0].dataHealth).toMatchObject({
      rows: 1,
      readyCount: 1,
      counts: { ready: 1 },
    });
    expect(payload.scans[0].rows[0].dataHealth).toMatchObject({
      status: { key: "ready", label: "Datos aptos" },
      coverageScore: 82,
    });
    expect(payload.scans[0].rows[0].scoreAudit).toMatchObject({
      displayedScore: 82,
      integrityTone: "warn",
    });
    expect(payload.scans[0].rows[0].scoreAudit.components.map((item) => item.key)).toContain("rs");
    expect(payload.scans[0].rows[0].decisionTrace).toMatchObject({
      schemaVersion: 1,
      readiness: { key: "operable" },
      action: { key: "candidate-long" },
      confidence: { key: "high", label: "Alta" },
      evidence: { status: "ready", summary: "Pruebas metodologicas confirmadas" },
    });
    expect(payload.scans[0].rows[0].decisionTrace.priorityScore).toBeGreaterThan(0);
    expect(payload.scans[0].rows[0].decisionTrace.drivers.length).toBeGreaterThan(0);
    expect(payload.scans[0].rows[0].decisionTrace.evidence.items.length).toBeGreaterThan(0);

    const report = auditDecisionPayload(payload, { scannedAt: "2026-06-15T10:01:00.000Z", source: "file" });
    expect(report.source).toBe("file");
    expect(report.projection).toBe("screener-decision-audit-export");
    expect(report.rows).toBe(1);
    expect(report.decisionShare.operable.count).toBe(1);
    expect(report.dataHealth).toMatchObject({
      rows: 1,
      readyCount: 1,
      counts: { ready: 1 },
    });
    expect(report.scoreAudit).toMatchObject({
      rows: 1,
      mismatchCount: 1,
      verdict: { key: "residual" },
    });
    expect(report.byScan[0].dataHealth).toMatchObject({
      rows: 1,
      readyCount: 1,
      counts: { ready: 1 },
    });
    expect(report.byScan[0].scoreAudit).toMatchObject({ rows: 1, mismatchCount: 1 });
    expect(report.byScan[0].decisionQuality.confidence[0]).toMatchObject({ key: "high", label: "Alta", count: 1 });
    expect(report.decisionQuality.confidence[0]).toMatchObject({ key: "high", count: 1 });
  });

  it("recalcula trazas antiguas al exportar auditoria JSON", () => {
    const payload = buildDecisionAuditExportPayload({
      exportedAt: "2026-06-15T10:00:00.000Z",
      activeSettings: { setupMode: "leader" },
      rows: [{
        ...strongRow,
        symbol: "STALE",
        decisionProjectionPartial: true,
        decisionProjectionMissing: ["chartBarsCount", "price"],
        decisionTrace: {
          schemaVersion: 1,
          priorityScore: 9999,
          readiness: { key: "operable", label: "Operable" },
          action: { key: "candidate-long", label: "Candidato largo" },
          issues: [],
        },
      }],
    });

    const trace = payload.scans[0].rows[0].decisionTrace;
    expect(trace.priorityScore).not.toBe(9999);
    expect(trace.readiness.key).toBe("audit");
    expect(trace.action.key).toBe("check-data");
    expect(trace.issues.map((item) => item.key)).toContain("partial-projection");
  });

  it("detecta falsos positivos probables en candidatos largos no operables", () => {
    const thinConfirmation = {
      ...strongRow,
      symbol: "THIN",
      volumeEffectScore: 50,
      adProxyScore: 50,
      growthScore: 50,
      epsGrowthProxyScore: 50,
      riskRewardScore: 60,
    };
    const extended = {
      ...strongRow,
      symbol: "EXT",
      extSma50: 24,
      riskRewardScore: 42,
    };

    const report = auditDecisionPayload({
      projection: "fixture",
      scans: [{
        id: "scan-risk",
        rows: [strongRow, thinConfirmation, extended],
      }],
    }, { scannedAt: "2026-06-15T00:00:00.000Z" });

    expect(report.rows).toBe(3);
    expect(report.decisionQuality.longCandidateRisk.count).toBe(2);
    expect(report.decisionQuality.longCandidateRisk.sample.map((item) => item.symbol)).toEqual(expect.arrayContaining(["THIN", "EXT"]));
    expect(report.byScan[0].decisionQuality.confidence.map((item) => item.key)).toEqual(expect.arrayContaining(["high", "low"]));
    const issueKeys = report.decisionQuality.topIssues.map((item) => item.key);
    expect(issueKeys).toEqual(expect.arrayContaining(["thin-confirmation", "overextended-sma50", "low-risk-reward"]));
    expect(report.byScan[0].decisionQuality.longCandidateRiskCount).toBe(2);
  });

  it("expone issues por fila para filtros accionables de UI", () => {
    const issues = auditDecisionRowIssues({
      ...strongRow,
      rsGlobalPct: 55,
      extSma50: 24,
      riskRewardScore: 42,
    }, { setupMode: "leader" });

    expect(issues.map((item) => item.key)).toEqual(expect.arrayContaining([
      "missing-global-rs",
      "overextended-sma50",
      "low-risk-reward",
    ]));
  });

  it("marca candidatos operables de confluencia minima para bajar falsos positivos", () => {
    const minimumConfluence = {
      ...strongRow,
      symbol: "MIN",
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

    const trace = buildDecisionTrace(minimumConfluence, { setupMode: "leader" });
    const issues = auditDecisionRowIssues(minimumConfluence, { setupMode: "leader" });
    const confidence = decisionConfidenceSummary(minimumConfluence, { setupMode: "leader" });

    expect(trace.readiness.key).toBe("operable");
    expect(issues.map((item) => item.key)).toContain("minimum-confluence");
    expect(trace.confidence.score).toBeLessThan(buildDecisionTrace(strongRow, { setupMode: "leader" }).confidence.score);
    expect(confidence.detail).toMatch(/Confluencia mínima|liderazgo/i);
    expect(decisionPriorityScore(strongRow, { setupMode: "leader" })).toBeGreaterThan(decisionPriorityScore(minimumConfluence, { setupMode: "leader" }));

    const report = auditDecisionPayload({
      projection: "fixture",
      scans: [{ id: "scan-confidence", rows: [strongRow, minimumConfluence] }],
    }, { scannedAt: "2026-06-15T00:00:00.000Z" });
    expect(report.decisionQuality.operableConfidenceRisk.count).toBe(1);
    expect(report.decisionQuality.operableConfidenceRisk.sample[0]).toMatchObject({
      symbol: "MIN",
      confidenceKey: trace.confidence.key,
      confluence: trace.confidence.confluence,
    });
    expect(report.decisionQuality.operableConfidenceRisk.topIssues.map((item) => item.key)).toContain("minimum-confluence");
    expect(report.byScan[0].decisionQuality.operableConfidenceRiskCount).toBe(1);
    expect(report.byScan[0].decisionQuality.operableConfidenceTopIssues.map((item) => item.key)).toContain("minimum-confluence");
  });

  it("penaliza candidatos con evidencia crítica incompleta aunque sus scores sean fuertes", () => {
    const incompleteEvidence = {
      ...strongRow,
      symbol: "MISS",
      rsGlobalPct: 88,
      rsSectorPct: 82,
      rsQualityScore: null,
      fundamentalCoverageScore: null,
      weinsteinScore: 86,
      minerviniScore: 82,
      volumeEffectScore: 76,
      adProxyScore: 74,
      growthScore: 70,
      epsGrowthProxyScore: 68,
      riskRewardScore: 72,
    };

    const trace = buildDecisionTrace(incompleteEvidence, { setupMode: "leader" });
    const issues = auditDecisionRowIssues(incompleteEvidence, { setupMode: "leader" });

    expect(trace.readiness.key).toBe("watch");
    expect(trace.action.key).toBe("candidate-with-watch");
    expect(issues.map((item) => item.key)).toContain("incomplete-decision-evidence");
    expect(trace.confidence.key).not.toBe("high");
    expect(trace.confidence.detail).toMatch(/Evidencia incompleta/);
    expect(decisionPriorityScore(strongRow, { setupMode: "leader" })).toBeGreaterThan(decisionPriorityScore(incompleteEvidence, { setupMode: "leader" }));
  });

  it("construye una traza compacta de ranking para export y snapshot", () => {
    const trace = buildDecisionTrace({
      ...strongRow,
      symbol: "TRACE",
      rsGlobalPct: 55,
      extSma50: 24,
      riskRewardScore: 42,
    }, { setupMode: "leader" });

    expect(trace.schemaVersion).toBe(DECISION_TRACE_SCHEMA_VERSION);
    expect(trace.engineVersion).toBe(DECISION_TRACE_ENGINE_VERSION);
    expect(trace.priorityScore).toBeTypeOf("number");
    expect(trace.action.key).toBeTruthy();
    expect(trace.readiness.key).toBeTruthy();
    expect(trace.brief.nextAction.value).toBe("Esperar confirmacion");
    expect(trace.issues.map((item) => item.key)).toEqual(expect.arrayContaining(["missing-global-rs", "overextended-sma50", "low-risk-reward"]));
    expect(trace.drivers.length).toBeGreaterThan(0);
    expect(trace.confidence).toMatchObject({ label: expect.any(String), score: expect.any(Number) });
    expect(trace.priority).toMatchObject({
      // "percentil de lote", no "RS": el componente es rsGlobalPct, la
      // entrada real de la prioridad, no el RS semanal que enseña la interfaz.
      formula: "decision + accion + score + percentil de lote + rent/riesgo - issues",
      issuePenalty: expect.any(Number),
    });
  });

  it("expone el desglose auditable del ranking de calidad", () => {
    const breakdown = decisionPriorityBreakdown({
      ...strongRow,
      symbol: "RISKY",
      totalScore: 96,
      rsGlobalPct: 55,
      extSma50: 24,
      riskRewardScore: 42,
    }, { setupMode: "leader" });
    const componentTotal = breakdown.components.reduce((sum, item) => sum + item.value, 0);

    expect(breakdown.score).toBe(decisionPriorityScore({
      ...strongRow,
      symbol: "RISKY",
      totalScore: 96,
      rsGlobalPct: 55,
      extSma50: 24,
      riskRewardScore: 42,
    }, { setupMode: "leader" }));
    expect(breakdown.components.map((item) => item.key)).toEqual(["readiness", "action", "score", "rs", "riskReward"]);
    expect(breakdown.issuePenalty).toBeGreaterThan(0);
    expect(breakdown.penalties.map((item) => item.key)).toEqual(expect.arrayContaining(["missing-global-rs", "overextended-sma50", "low-risk-reward"]));
    expect(breakdown.score).toBeCloseTo(componentTotal - breakdown.issuePenalty, 2);
  });

  it("recalcula trazas legacy sin desglose de prioridad", () => {
    const legacyOperable = {
      ...strongRow,
      symbol: "LEGACY",
      decisionTrace: {
        schemaVersion: 1,
        priorityScore: 9999,
        readiness: { key: "operable", label: "Operable" },
        action: { key: "candidate-long", label: "Candidato largo" },
        confidence: { key: "high", score: 95, label: "Alta" },
        issues: [],
      },
      rsGlobalPct: 55,
      extSma50: 24,
      riskRewardScore: 42,
    };

    expect(isDecisionTraceCurrent(legacyOperable.decisionTrace, legacyOperable)).toBe(false);
    const trace = decisionTraceForRow(legacyOperable, { setupMode: "leader" });
    expect(trace.priorityScore).not.toBe(9999);
    expect(trace.priority.components.map((item) => item.key)).toEqual(["readiness", "action", "score", "rs", "riskReward"]);
    expect(trace.issues.map((item) => item.key)).toEqual(expect.arrayContaining(["missing-global-rs", "overextended-sma50"]));
  });

  it("recalcula trazas actuales cuando se pasan settings activos", () => {
    const rowWithStaleCurrentTrace = {
      ...strongRow,
      symbol: "STALECTX",
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

    expect(isDecisionTraceCurrent(rowWithStaleCurrentTrace.decisionTrace, rowWithStaleCurrentTrace)).toBe(true);
    const trace = decisionTraceForRow(rowWithStaleCurrentTrace, { setupMode: "leader" });
    expect(trace.readiness.key).toBe("operable");
    expect(trace.action.key).toBe("candidate-long");
    expect(trace.priorityScore).not.toBe(820);
  });

  it("recalcula trazas con motor antiguo aunque tengan forma actual", () => {
    const staleEngineTrace = {
      ...strongRow,
      symbol: "OLDENGINE",
      decisionTrace: {
        schemaVersion: DECISION_TRACE_SCHEMA_VERSION,
        engineVersion: "decision-trace-v1",
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

    expect(isDecisionTraceCurrent(staleEngineTrace.decisionTrace, staleEngineTrace)).toBe(false);
    const trace = decisionTraceForRow(staleEngineTrace, {});
    expect(trace.engineVersion).toBe(DECISION_TRACE_ENGINE_VERSION);
    expect(trace.priorityScore).not.toBe(820);
    expect(trace.readiness.key).toBe("operable");
    expect(trace.action.key).toBe("candidate-long");
  });

  it("no exporta como operable una proyeccion parcial", () => {
    const trace = buildDecisionTrace({
      ...strongRow,
      symbol: "PARTIAL",
      decisionProjectionPartial: true,
      decisionProjectionMissing: ["chartBarsCount", "price"],
    }, { setupMode: "leader" });

    expect(trace.action.key).toBe("check-data");
    expect(trace.readiness.key).toBe("audit");
    expect(trace.issues.map((item) => item.key)).toEqual(expect.arrayContaining(["partial-projection", "needs-data-audit"]));
    expect(trace.watch.map((item) => item.key)).toContain("partial-projection");
  });

  it("prioriza candidatos operables limpios por encima de candidatos con issues", () => {
    const clean = { ...strongRow, symbol: "CLEAN", totalScore: 82 };
    const higherScoreButRisky = {
      ...strongRow,
      symbol: "RISKY",
      totalScore: 96,
      rsGlobalPct: 55,
      extSma50: 24,
      riskRewardScore: 42,
    };

    expect(decisionPriorityScore(clean, { setupMode: "leader" })).toBeGreaterThan(decisionPriorityScore(higherScoreButRisky, { setupMode: "leader" }));
  });
});
