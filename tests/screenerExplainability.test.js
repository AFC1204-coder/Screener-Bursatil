import { describe, expect, it } from "vitest";
import {
  buildDecisionBrief,
  buildDecisionEvidenceChecklist,
  buildDecisionEvidenceSummary,
  buildDecisionQueueDigest,
  buildDecisionQueueDigestSummary,
  buildDecisionQueueItem,
  buildDecisionQueueSummary,
  DECISION_READINESS_ORDER,
  decisionReadinessLabel,
  explainScreenerRank,
  RANK_ACTION_ORDER,
  rankActionLabel,
} from "@/lib/screenerExplainability";
import { buildRowMethodologyEvidence } from "@/lib/screenerMethodologyEvidence";
import { DECISION_TRACE_ENGINE_VERSION, DECISION_TRACE_SCHEMA_VERSION } from "@/lib/decisionTraceVersion";

const baseRow = {
  symbol: "STG",
  price: 120,
  chartBarsCount: 260,
  priceFreshnessOk: true,
  dataCoverageScore: 82,
  technicalCoverageScore: 88,
  fundamentalCoverageScore: 64,
  totalScore: 78,
  rsGlobalPct: 84,
  rsSectorPct: 76,
  rsQualityScore: 74,
  weinsteinScore: 82,
  minerviniScore: 77,
  setupQualityScore: 80,
  volumeEffectScore: 72,
  adProxyScore: 70,
  epsGrowthProxyScore: 68,
  growthScore: 66,
  riskRewardScore: 71,
  relativeVolume: 1.7,
  distance52w: -7,
  extSma50: 12,
  maxDrawdown63d: 14,
  weaknessScore: 18,
  setupDisplayPlanValid: true,
  setupDisplayReason: "Compresion valida con pivote definido",
};

describe("explainScreenerRank", () => {
  it("resume los drivers principales de una fila fuerte", () => {
    const explanation = explainScreenerRank(baseRow, {});
    const labels = explanation.drivers.map((item) => item.label);
    expect(explanation.mode).toBe("long");
    expect(explanation.tone).toBe("good");
    expect(labels).toContain("Plan valido");
    expect(labels).toContain("RS universo");
    expect(labels).toContain("Estructura");
    expect(explanation.watch).toEqual([]);
    expect(explanation.action.key).toBe("candidate-long");
    expect(explanation.action.label).toBe("Candidato largo");
    expect(explanation.readiness.key).toBe("operable");
    expect(explanation.readiness.label).toBe("Operable");
    expect(explanation.line).toMatch(/Plan valido/);
  });

  it("eleva riesgos de datos, frescura y deterioro en modo largo", () => {
    const explanation = explainScreenerRank({
      ...baseRow,
      chartBarsCount: 42,
      priceFreshnessOk: false,
      priceFreshnessIssue: "precio viejo: 9d > 4d",
      dataCoverageScore: 45,
      technicalCoverageScore: 48,
      weaknessScore: 72,
      weaknessLabel: "Deterioro alto",
      weaknessReasons: ["bajo SMA200", "momentum negativo"],
    }, {});
    const labels = explanation.watch.map((item) => item.label);
    expect(explanation.tone).toBe("bad");
    expect(labels).toContain("Datos base");
    expect(labels).toContain("Precio");
    expect(labels).toContain("Deterioro alto");
    expect(explanation.action.label).toBe("Revisar datos");
    expect(explanation.readiness.key).toBe("audit");
    expect(explanation.line).toMatch(/Revisar:/);
  });

  it("trata el deterioro como driver cuando el filtro es bearish", () => {
    const explanation = explainScreenerRank({
      ...baseRow,
      weaknessScore: 78,
      weaknessLabel: "Deterioro severo",
      weaknessReasons: ["bajo SMA200", "distribucion visible"],
      perf3m: -18,
      distance52w: -34,
    }, { setupMode: "weakness" });
    const driverLabels = explanation.drivers.map((item) => item.label);
    const watchLabels = explanation.watch.map((item) => item.label);
    expect(explanation.mode).toBe("weakness");
    expect(explanation.action.label).toBe("Bearish");
    expect(explanation.readiness.key).toBe("bearish");
    expect(driverLabels).toContain("Deterioro");
    expect(driverLabels).toContain("bajo SMA200");
    expect(watchLabels).not.toContain("Deterioro severo");
  });

  it("lee métricas anidadas de snapshots antiguos", () => {
    const explanation = explainScreenerRank({
      symbol: "NEST",
      chartBarsCount: 240,
      price: 50,
      metrics: {
        rsGlobalPct: 88,
        rsSectorPct: 80,
        weaknessScore: 12,
        setupDisplayPlanValid: true,
      },
      raw: {
        weinsteinScore: 84,
        minerviniScore: 79,
      },
      snapshot: {
        priceFreshnessOk: true,
      },
    }, {});
    const labels = explanation.drivers.map((item) => item.label);
    expect(labels).toContain("RS universo");
    expect(labels).toContain("RS grupo");
    expect(labels).toContain("Estructura");
  });

  it("usa fallback informativo cuando no hay drivers largos fuertes", () => {
    const explanation = explainScreenerRank({
      symbol: "WEAK",
      chartBarsCount: 260,
      price: 20,
      priceFreshnessOk: true,
      dataCoverageScore: 80,
      technicalCoverageScore: 82,
      fundamentalCoverageScore: 45,
      rsRating: 32,
      weaknessScore: 82,
      weaknessLabel: "Deterioro severo",
      perf12m: -20,
    }, {});
    expect(explanation.drivers[0].label).toBe("Debilidad domina");
    expect(explanation.action.label).toBe("Evitar largo");
    expect(explanation.readiness.key).toBe("reject");
    expect(explanation.watch.map((item) => item.label)).toContain("Deterioro severo");
    expect(explanation.displayWatch.map((item) => item.label)).not.toContain("Deterioro severo");
    expect(explanation.line).toBe("Debilidad domina 82");
  });

  it("no marca como operable un buen perfil sin setup accionable", () => {
    const explanation = explainScreenerRank({
      ...baseRow,
      setupDisplayPlanValid: false,
      setupDisplayStrict: false,
      setupDisplayWatch: false,
      setupQualityScore: 55,
      rsGlobalPct: 92,
      weinsteinScore: 90,
      minerviniScore: 88,
    }, {});
    expect(explanation.action.key).toBe("strong-profile");
    expect(explanation.readiness.key).toBe("watch");
  });

  it("no marca como operable un setup valido sin liderazgo suficiente", () => {
    const explanation = explainScreenerRank({
      ...baseRow,
      rsGlobalPct: 52,
      rsSectorPct: 48,
      rsQualityScore: 50,
      weinsteinScore: 58,
      minerviniScore: 54,
      volumeEffectScore: 45,
      adProxyScore: 44,
      growthScore: 42,
      epsGrowthProxyScore: 40,
      riskRewardScore: 55,
      setupDisplayPlanValid: true,
    }, {});
    expect(explanation.action.key).toBe("candidate-long");
    expect(explanation.readiness.key).toBe("watch");
    expect(explanation.readiness.detail).toMatch(/liderazgo/i);
  });

  it("no marca como operable un setup valido sin liderazgo relativo global", () => {
    const explanation = explainScreenerRank({
      ...baseRow,
      rsGlobalPct: 58,
      rsSectorPct: 88,
      rsQualityScore: 82,
      weinsteinScore: 88,
      minerviniScore: 84,
      volumeEffectScore: 76,
      adProxyScore: 74,
      growthScore: 72,
      epsGrowthProxyScore: 70,
      riskRewardScore: 72,
      setupDisplayPlanValid: true,
    }, {});
    expect(explanation.action.key).toBe("candidate-long");
    expect(explanation.readiness.key).toBe("watch");
    expect(explanation.readiness.detail).toMatch(/global/i);
  });

  it("bloquea operabilidad cuando el setup esta demasiado extendido sobre SMA50", () => {
    const explanation = explainScreenerRank({
      ...baseRow,
      extSma50: 22,
      setupDisplayPlanValid: true,
    }, {});
    expect(explanation.action.key).toBe("candidate-with-watch");
    expect(explanation.readiness.key).toBe("watch");
    expect(explanation.displayWatch.map((item) => item.key)).toContain("extension");
  });

  it("bloquea operabilidad cuando el rentabilidad riesgo es pobre", () => {
    const explanation = explainScreenerRank({
      ...baseRow,
      riskRewardScore: 42,
      setupDisplayPlanValid: true,
    }, {});
    expect(explanation.action.key).toBe("candidate-with-watch");
    expect(explanation.readiness.key).toBe("watch");
    expect(explanation.displayWatch.map((item) => item.key)).toContain("risk-reward-low");
  });

  it("bloquea operabilidad cuando faltan evidencias críticas de decision", () => {
    const explanation = explainScreenerRank({
      ...baseRow,
      fundamentalCoverageScore: null,
      rsQualityScore: null,
      rsGlobalPct: 88,
      rsSectorPct: 82,
      weinsteinScore: 86,
      minerviniScore: 82,
      volumeEffectScore: 76,
      adProxyScore: 74,
      growthScore: 70,
      epsGrowthProxyScore: 68,
      riskRewardScore: 72,
      setupDisplayPlanValid: true,
    }, {});
    expect(explanation.action.key).toBe("candidate-with-watch");
    expect(explanation.readiness.key).toBe("watch");
    expect(explanation.displayWatch.map((item) => item.key)).toContain("decision-evidence");
    expect(explanation.displayWatch.find((item) => item.key === "decision-evidence")?.text).toMatch(/cobertura fundamental|RS calidad/);
  });

  it("exige al menos una confirmacion operativa ademas del liderazgo", () => {
    const explanation = explainScreenerRank({
      ...baseRow,
      volumeEffectScore: 45,
      adProxyScore: 44,
      relativeVolume: 1.0,
      growthScore: 42,
      epsGrowthProxyScore: 40,
      riskRewardScore: 60,
      setupDisplayPlanValid: true,
      rsGlobalPct: 90,
      rsSectorPct: 84,
      rsQualityScore: 82,
      weinsteinScore: 88,
      minerviniScore: 86,
    }, {});
    expect(explanation.action.key).toBe("candidate-long");
    expect(explanation.readiness.key).toBe("watch");
    expect(explanation.readiness.detail).toMatch(/demanda|momentum/i);
  });

  it("degrada proyecciones parciales aunque parezcan operables", () => {
    const explanation = explainScreenerRank({
      ...baseRow,
      decisionProjectionPartial: true,
      decisionProjectionMissing: ["chartBarsCount", "price"],
    }, {});
    expect(explanation.watch.map((item) => item.key)).toContain("partial-projection");
    expect(explanation.action.key).toBe("check-data");
    expect(explanation.readiness.key).toBe("audit");
  });

  it("construye una sintesis accionable para revision de candidatos operables", () => {
    const brief = buildDecisionBrief(baseRow, {});
    expect(brief.thesis.label).toBe("Tesis");
    expect(brief.thesis.value).toMatch(/Plan valido/);
    expect(brief.risk.value).toBe("Sin alerta principal");
    expect(brief.nextAction.value).toBe("Preparar entrada");
    expect(brief.nextAction.tone).toBe("good");
  });

  it("convierte alertas de decision en siguiente accion conservadora", () => {
    const brief = buildDecisionBrief({
      ...baseRow,
      extSma50: 24,
      riskRewardScore: 42,
    }, {});
    expect(brief.risk.value).toMatch(/Extendida|Rent/);
    expect(brief.nextAction.value).toBe("Esperar confirmacion");
    expect(brief.nextAction.tone).toBe("warn");
  });

  it("expone pruebas confirmadas y pendientes para reducir falsos positivos", () => {
    const ready = buildDecisionEvidenceChecklist(baseRow, {});
    expect(ready.status).toBe("ready");
    expect(ready.passedCount).toBe(ready.totalCount);
    expect(ready.pending).toEqual([]);
    expect(ready.items.map((item) => item.key)).toEqual(expect.arrayContaining([
      "setup-accionable",
      "liderazgo-global",
      "contexto-sectorial",
      "demanda-volumen",
      "precio-perseguible",
      "frescura-de-datos",
      "datos-fiables",
      "contradicciones",
    ]));
    expect(ready.methodology.categories.map((item) => item.key)).toEqual([
      "setup",
      "leadership",
      "sector-context",
      "confluence",
      "demand",
      "risk",
      "freshness",
      "data",
      "contradictions",
    ]);
    expect(ready.manualReviewRequired).toBe(false);
    expect(ready.reviewFocus).toEqual([]);

    const thin = buildDecisionEvidenceChecklist({
      ...baseRow,
      volumeEffectScore: 45,
      adProxyScore: 44,
      relativeVolume: 1.0,
      growthScore: 42,
      epsGrowthProxyScore: 40,
      riskRewardScore: 60,
    }, {});
    expect(thin.status).toBe("needs-work");
    expect(thin.pending.map((item) => item.key)).toEqual(expect.arrayContaining([
      "confluencia-amplia",
    ]));
    expect(thin.items.find((item) => item.methodologyKey === "demand")).toMatchObject({
      status: "confirmed",
      tone: "warn",
    });
    expect(thin.manualReviewRequired).toBe(true);
    expect(thin.reviewFocus.map((item) => item.key)).toEqual(expect.arrayContaining([
      "confluence",
      "demand",
    ]));
    expect(thin.reviewFocus.find((item) => item.key === "demand")?.action).toMatch(/acumulacion|volumen/i);
    expect(thin.summary).toMatch(/Confluencia/);
  });

  it("exige categorias metodologicas visibles antes de marcar evidencia lista", () => {
    const row = {
      ...baseRow,
      symbol: "GAPS",
      priceFreshnessOk: undefined,
      priceFreshnessDays: undefined,
      priceFreshnessMaxDays: undefined,
      rsSectorPct: undefined,
      sectorScore: undefined,
      groupStrengthScore: undefined,
      volumeEffectScore: 44,
      adProxyScore: 43,
      relativeVolume: 1.0,
      demandScore: 42,
    };
    const methodology = buildRowMethodologyEvidence(row, { explanation: explainScreenerRank(row, {}) });
    expect(methodology.status).toBe("needs-work");
    expect(methodology.pending.map((item) => item.key)).toEqual(expect.arrayContaining([
      "sector-context",
      "freshness",
    ]));
    expect(methodology.categories.find((item) => item.key === "demand")).toMatchObject({
      status: "confirmed",
      tone: "warn",
    });
    expect(buildDecisionEvidenceChecklist(row, {}).pending.map((item) => item.methodologyKey)).toEqual(expect.arrayContaining([
      "sector-context",
      "freshness",
    ]));
    expect(methodology.manualReviewRequired).toBe(true);
    expect(methodology.reviewFocus.map((item) => item.key)).toEqual(expect.arrayContaining([
      "freshness",
      "sector-context",
      "demand",
    ]));
  });

  it("trata liderazgo y demanda debiles como evidencia evaluada con limitacion", () => {
    const row = {
      ...baseRow,
      symbol: "EVALWEAK",
      rsGlobalPct: 58,
      rsQualityScore: 52,
      weinsteinScore: 55,
      minerviniScore: 54,
      volumeEffectScore: 44,
      adProxyScore: 43,
      relativeVolume: 1.0,
      upDownVolRatio: 0.8,
      demandScore: 42,
    };
    const checklist = buildDecisionEvidenceChecklist(row, {});
    const leadership = checklist.items.find((item) => item.methodologyKey === "leadership");
    const demand = checklist.items.find((item) => item.methodologyKey === "demand");

    expect(leadership).toMatchObject({ status: "confirmed", tone: "neutral" });
    expect(demand).toMatchObject({ status: "confirmed", tone: "warn" });
    expect(checklist.pending.map((item) => item.methodologyKey)).not.toEqual(expect.arrayContaining(["leadership", "demand"]));
    expect(checklist.manualReviewRequired).toBe(true);
    expect(checklist.reviewFocus.map((item) => item.key)).toEqual(expect.arrayContaining(["demand"]));
  });

  it("trata el contexto sectorial evaluado como evidencia completa aunque no sea viento de cola", () => {
    const row = {
      ...baseRow,
      symbol: "NEUTRALGRP",
      sectorScore: 52,
      groupStrengthScore: 52,
      rsSectorPct: 56,
    };
    const checklist = buildDecisionEvidenceChecklist(row, {});
    const sector = checklist.items.find((item) => item.methodologyKey === "sector-context");

    expect(checklist.status).toBe("ready");
    expect(sector).toMatchObject({
      status: "confirmed",
      tone: "neutral",
    });
    expect(sector.detail).toMatch(/neutral|no aporta/i);
    expect(checklist.manualReviewRequired).toBe(false);
    expect(checklist.reviewFocus).toEqual([
      expect.objectContaining({
        key: "sector-context",
        requiresReview: false,
      }),
    ]);
  });

  it("bloquea contradicciones severas sin convertirlas en recomendacion", () => {
    const row = {
      ...baseRow,
      symbol: "CONTRA",
      extSma50: 38,
      setupQualityScore: 84,
      setupDisplayPlanValid: true,
    };
    const methodology = buildRowMethodologyEvidence(row, { explanation: explainScreenerRank(row, {}) });
    expect(methodology.status).toBe("blocked");
    expect(methodology.blocked.map((item) => item.key)).toEqual(expect.arrayContaining([
      "risk",
      "contradictions",
    ]));
    const checklist = buildDecisionEvidenceChecklist(row, {});
    expect(checklist.status).toBe("blocked");
    expect(checklist.pending.map((item) => item.methodologyKey)).toContain("contradictions");
    expect(checklist.pending.map((item) => item.key)).toContain("precio-perseguible");
  });

  it("compacta la decision para colas de revision", () => {
    const item = buildDecisionQueueItem(baseRow, {});
    expect(item.symbol).toBe("STG");
    expect(item.score).toBe(78);
    expect(item.readiness.key).toBe("operable");
    expect(item.label).toBe("Preparar entrada");
    expect(item.detail).toBe("Sin alerta principal");
    expect(item.evidence.status).toBe("ready");
  });

  it("incluye foco metodologico compacto en cada item de cola", () => {
    const item = buildDecisionQueueItem({
      ...baseRow,
      symbol: "MFOCUS",
      volumeEffectScore: 45,
      adProxyScore: 44,
      relativeVolume: 1.0,
      growthScore: 42,
      epsGrowthProxyScore: 40,
      riskRewardScore: 60,
    }, {});

    expect(item.methodologyFocus).toMatchObject({
      key: "contradictions",
      label: "Contradicciones",
      tone: "warn",
      requiresReview: true,
    });
    expect(item.methodologyFocus.detail).toMatch(/contradicciones|score|setup|liderazgo|riesgo|datos/i);
  });

  it("resume tesis, riesgo y pruebas para hacer accionable cada fila de Review", () => {
    const readyDigest = buildDecisionQueueDigest(baseRow, {});
    expect(readyDigest.symbol).toBe("STG");
    expect(readyDigest.state).toBe("ready");
    expect(readyDigest.stateLabel).toBe("Pruebas OK");
    expect(readyDigest.ratio).toBe("9/9");
    expect(readyDigest.headline).toBe("Preparar entrada");
    expect(readyDigest.thesis).toMatch(/Plan valido/);
    expect(readyDigest.risk).toBe("Sin alerta principal");
    expect(readyDigest.checkLine).toMatch(/Setup accionable|Liderazgo global/);

    const thinDigest = buildDecisionQueueDigest({
      ...baseRow,
      symbol: "THIN",
      volumeEffectScore: 45,
      adProxyScore: 44,
      relativeVolume: 1.0,
      growthScore: 42,
      epsGrowthProxyScore: 40,
      riskRewardScore: 60,
    }, {});
    expect(thinDigest.symbol).toBe("THIN");
    expect(thinDigest.state).toBe("needs-work");
    expect(thinDigest.stateLabel).toBe("Falta validar");
    expect(thinDigest.checkLine).toMatch(/Confluencia amplia|Demanda\/volumen/);
  });

  it("resume la cola por estado de pruebas para filtrar trabajo pendiente", () => {
    const summary = buildDecisionQueueDigestSummary([
      baseRow,
      {
        ...baseRow,
        symbol: "THIN",
        volumeEffectScore: 45,
        adProxyScore: 44,
        relativeVolume: 1.0,
        growthScore: 42,
        epsGrowthProxyScore: 40,
        riskRewardScore: 60,
      },
      {
        ...baseRow,
        symbol: "BLOCK",
        decisionProjectionPartial: true,
        decisionProjectionMissing: ["chartBarsCount", "price"],
      },
    ], {});

    expect(summary.map((group) => [group.key, group.count])).toEqual([
      ["all", 3],
      ["ready", 1],
      ["needs-work", 1],
      ["blocked", 1],
    ]);
    expect(summary.find((group) => group.key === "needs-work")?.firstIndex).toBe(1);
    expect(summary.find((group) => group.key === "blocked")?.sampleSymbols).toEqual(["BLOCK"]);
  });

  it("mantiene la cola conservadora cuando la fila viene con traza guardada", () => {
    const item = buildDecisionQueueItem({
      symbol: "TRACE",
      totalScore: 91,
      decisionTrace: {
        schemaVersion: DECISION_TRACE_SCHEMA_VERSION,
        engineVersion: DECISION_TRACE_ENGINE_VERSION,
        action: { key: "candidate-with-watch", label: "Candidato", tone: "warn", detail: "Buen perfil, timing pendiente." },
        readiness: { key: "watch", label: "Vigilar", tone: "warn", detail: "Esperar confirmacion." },
        confidence: { key: "medium", score: 64, label: "Media", tone: "warn" },
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
        brief: {
          thesis: { label: "Tesis", value: "RS universo 88", detail: "Buen liderazgo", tone: "good" },
          risk: { label: "Riesgo", value: "Extendida SMA50 24.0%", detail: "No perseguir", tone: "warn" },
          nextAction: { label: "Siguiente", value: "Esperar confirmacion", detail: "Buscar pullback", tone: "warn" },
        },
      },
    }, {});
    expect(item.readiness.key).toBe("watch");
    expect(item.label).toBe("Esperar confirmacion");
    expect(item.detail).toBe("Extendida SMA50 24.0%");
  });

  it("recalcula una traza guardada legacy sin ranking explicable", () => {
    const item = buildDecisionQueueItem({
      ...baseRow,
      symbol: "LEGACYTRACE",
      decisionTrace: {
        action: { key: "candidate-with-watch", label: "Candidato", tone: "warn", detail: "Trace antigua." },
        readiness: { key: "watch", label: "Vigilar", tone: "warn", detail: "Trace antigua." },
        confidence: { key: "medium", score: 64, label: "Media", tone: "warn" },
        brief: {
          nextAction: { label: "Siguiente", value: "Esperar confirmacion", detail: "Trace antigua", tone: "warn" },
        },
      },
    }, {});
    expect(item.readiness.key).toBe("operable");
    expect(item.action.key).toBe("candidate-long");
    expect(item.label).toBe("Preparar entrada");
  });

  it("recalcula una traza guardada actual cuando recibe settings activos", () => {
    const item = buildDecisionQueueItem({
      ...baseRow,
      symbol: "STALECTX",
      decisionTrace: {
        schemaVersion: DECISION_TRACE_SCHEMA_VERSION,
        engineVersion: DECISION_TRACE_ENGINE_VERSION,
        action: { key: "candidate-with-watch", label: "Candidato", tone: "warn", detail: "Trace de otra vista." },
        readiness: { key: "watch", label: "Vigilar", tone: "warn", detail: "Trace de otra vista." },
        confidence: { key: "medium", score: 64, label: "Media", tone: "warn" },
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
        brief: {
          nextAction: { label: "Siguiente", value: "Esperar confirmacion", detail: "Trace de otra vista.", tone: "warn" },
        },
      },
    }, { setupMode: "leader" });
    expect(item.readiness.key).toBe("operable");
    expect(item.action.key).toBe("candidate-long");
    expect(item.label).toBe("Preparar entrada");
  });

  it("no confia en una traza operable cuando la proyeccion es parcial", () => {
    const item = buildDecisionQueueItem({
      ...baseRow,
      symbol: "OLDTRACE",
      decisionProjectionPartial: true,
      decisionProjectionMissing: ["chartBarsCount", "price"],
      decisionTrace: {
        action: { key: "candidate-long", label: "Candidato largo", tone: "good", detail: "Trace antigua." },
        readiness: { key: "operable", label: "Operable", tone: "good", detail: "Trace antigua." },
        brief: {
          nextAction: { label: "Siguiente", value: "Preparar entrada", detail: "Trace antigua", tone: "good" },
        },
      },
    }, {});
    expect(item.readiness.key).toBe("audit");
    expect(item.action.key).toBe("check-data");
    expect(item.label).toBe("Auditar antes");
    expect(item.detail).toMatch(/Proyección parcial/);
  });

  it("resume la cola por grupos y conserva el primer indice para saltos", () => {
    const summary = buildDecisionQueueSummary([
      baseRow,
      {
        ...baseRow,
        symbol: "WAIT",
        extSma50: 24,
        riskRewardScore: 42,
      },
      {
        ...baseRow,
        symbol: "AUDIT",
        priceFreshnessOk: false,
        priceFreshnessIssue: "precio viejo",
      },
    ], {});
    expect(summary.total).toBe(3);
    expect(summary.counts.operable).toBe(1);
    expect(summary.counts.watch).toBe(1);
    expect(summary.counts.audit).toBe(1);
    expect(summary.groups.find((group) => group.key === "watch").firstIndex).toBe(1);
    expect(summary.reviewCount).toBe(2);
  });

  it("resume pruebas de decision por estado y pendiente dominante", () => {
    const readyRow = { ...baseRow, symbol: "READY" };
    const needsWorkRow = {
      ...baseRow,
      symbol: "CHECK",
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
    const blockedRow = {
      ...baseRow,
      symbol: "BLOCK",
      decisionProjectionPartial: true,
      decisionProjectionMissing: ["price", "chartBarsCount"],
    };
    const summary = buildDecisionEvidenceSummary([readyRow, needsWorkRow, blockedRow], { setupMode: "leader" });

    expect(summary.rows).toBe(3);
    expect(summary.counts.ready).toBe(1);
    expect(summary.counts["needs-work"]).toBe(1);
    expect(summary.counts.blocked).toBe(1);
    expect(summary.verdict).toMatchObject({ key: "blocked", tone: "bad" });
    expect(summary.items.map((item) => item.key)).toEqual(["ready", "needs-work", "blocked"]);
    expect(summary.topIssues.map((item) => item.key)).toEqual(expect.arrayContaining(["confluencia-amplia", "datos-fiables"]));
  });

  it("expone un catalogo estable de acciones para filtrar resultados", () => {
    expect(RANK_ACTION_ORDER).toEqual(expect.arrayContaining([
      "candidate-long",
      "strong-profile",
      "check-data",
      "avoid-long",
      "bearish-watch",
    ]));
    expect(DECISION_READINESS_ORDER).toEqual(["operable", "watch", "audit", "reject", "bearish"]);
    expect(rankActionLabel("candidate-long")).toBe("Candidato largo");
    expect(rankActionLabel("check-data")).toBe("Revisar datos");
    expect(decisionReadinessLabel("operable")).toBe("Operable");
    expect(decisionReadinessLabel("audit")).toBe("Auditar");
    expect(rankActionLabel("unknown-action", "Desconocida")).toBe("Desconocida");
  });
});
