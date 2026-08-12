import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ScreenerOriginPanel from "@/app/ScreenerOriginPanel";
import { AuditabilitySummaryRail, CompactResultsTable, DataHealthPanel, DataHealthSummaryRail, DecisionEvidenceChecklist, DecisionIssueBadge, DecisionOperatingBrief, DecisionQualityStrip, DecisionSummaryRail, MobileResultList, PendingDecisionWorkRail, PreviewCard, QuickPanel, ResultFilterChips, ScoreAuditPanel, ScoreAuditSummaryRail } from "@/app/screenerPanels";

describe("DecisionQualityStrip", () => {
  it("renderiza varias alertas principales como filtros accionables", () => {
    const html = renderToStaticMarkup(React.createElement(DecisionQualityStrip, {
      audit: {
        rows: 12,
        decisions: { operable: 3, audit: 2 },
        decisionQuality: {
          longCandidateRiskCount: 4,
          operableConfidenceRiskCount: 1,
          operableConfidenceRiskRows: [{ symbol: "FRAG" }],
          topIssues: [
            { key: "incomplete-decision-evidence", label: "Evidencia incompleta", severity: "warn", share: "25.0%", sample: [{ symbol: "MISS" }] },
            { key: "missing-global-rs", label: "Sin liderazgo RS global", severity: "bad", share: "16.7%", sample: [{ symbol: "LOWRS" }] },
            { key: "overextended-sma50", label: "Extendida sobre SMA50", severity: "warn", share: "8.3%", sample: [{ symbol: "EXT" }] },
          ],
        },
      },
      activeIssueKey: "missing-global-rs",
      activeProfileKey: "operable-fragile",
      onIssueSelect: () => {},
      onProfileSelect: () => {},
    }));

    expect(html).toContain("decisionQualityIssueList");
    expect(html).toContain("Evidencia incompleta");
    expect(html).toContain("Sin liderazgo RS global");
    expect(html).toContain("Extendida sobre SMA50");
    expect(html).toContain("decisionQualityIssue bad active");
    expect(html).toContain("aria-pressed=\"true\"");
  });

  it("renderiza una incidencia de fila como control de filtro accesible", () => {
    const html = renderToStaticMarkup(React.createElement(DecisionIssueBadge, {
      issues: [
        { key: "overextended-sma50", label: "Extendida sobre SMA50", severity: "warn", detail: "36.0%" },
      ],
      activeKey: "overextended-sma50",
      onSelect: () => {},
      compact: true,
    }));

    expect(html).toContain("<button");
    expect(html).toContain("decisionIssueBadge compact warn active");
    expect(html).toContain("aria-pressed=\"true\"");
    expect(html).toContain("Extendida sobre SMA50");
  });

  it("renderiza el resumen de calidad de decision como filtro reutilizable", () => {
    const html = renderToStaticMarkup(React.createElement(DecisionSummaryRail, {
      summary: [
        { key: "operable", label: "Operable", count: 3 },
        { key: "audit", label: "Auditar", count: 2 },
      ],
      activeKey: "audit",
      onSelect: () => {},
    }));

    expect(html).toContain("decisionRail");
    expect(html).toContain("Operable");
    expect(html).toContain("Auditar");
    expect(html).toContain("decisionRailItem neutral active");
    expect(html).toContain("aria-pressed=\"true\"");
  });

  it("renderiza el brief operativo del Screener con métricas y riesgo principal", () => {
    const html = renderToStaticMarkup(React.createElement(DecisionOperatingBrief, {
      audit: {
        rows: 8,
        decisions: { operable: 2, watch: 2, audit: 3, reject: 1 },
        decisionQuality: {
          confidence: [
            { key: "high", count: 2 },
            { key: "medium", count: 2 },
          ],
          topIssues: [
            { key: "missing-global-rs", label: "Sin liderazgo RS global", severity: "bad", count: 3, share: "37.5%", sample: [{ symbol: "LOWRS" }] },
          ],
          longCandidateRiskCount: 2,
          operableConfidenceRiskCount: 1,
        },
      },
      rows: [{ symbol: "LOWRS" }],
      onIssueSelect: () => {},
      onReadinessFilter: () => {},
      onConfidenceFilter: () => {},
      onReview: () => {},
    }));

    expect(html).toContain("decisionOperatingBrief");
    expect(html).toContain("Lectura operativa");
    expect(html).toContain("Lectura frágil");
    expect(html).toContain("Sin liderazgo RS global");
    expect(html).toContain("Auditar datos");
    expect(html).toContain("Priorizar alta confianza");
  });

  // Los grupos "Decisiones" y "Auditoría y datos" se retiraron de la lista móvil
  // igual que de escritorio (principio 1): la pantalla principal no muestra
  // auditoría interna. Los componentes siguen existiendo y probándose arriba;
  // aquí se fija que la LISTA ya no los monta.
  it("no monta rails de decisión ni de auditoría en resultados moviles", () => {
    const html = renderToStaticMarkup(React.createElement(MobileResultList, {
      rows: [],
      totalRows: 4,
      sort: "decisionPriority",
      onSort: () => {},
      onReview: () => {},
      onSave: () => {},
      onCsv: () => {},
      onAuditJson: () => {},
      page: 1,
      pageSize: 25,
      totalPages: 1,
      decisionQuality: {
        rows: 4,
        decisions: { operable: 3, audit: 1 },
        decisionQuality: {
          confidence: [{ key: "high", count: 2 }],
          topIssues: [],
        },
      },
      readinessSummary: [
        { key: "operable", label: "Operable", count: 3 },
        { key: "audit", label: "Auditar", count: 1 },
      ],
      readinessFilter: "operable",
      onReadinessFilter: () => {},
      emptyLabel: "Sin filas en esta pagina",
    }));

    expect(html).not.toContain("decisionRail");
    expect(html).not.toContain("decisionOperatingBrief");
    expect(html).not.toContain("decisionQualityStrip");
    expect(html).not.toContain("dataHealthSummaryRail");
    expect(html).not.toContain("scoreAuditSummaryRail");
    expect(html).not.toContain("Lectura operativa");
    // El estado vacío y los filtros propios de la lista siguen intactos.
    expect(html).toContain("Sin filas en esta pagina");
    expect(html).toContain("mobileFilterDisclosure");
  });

  // La fila móvil ya no lleva veredicto ni maquinaria de fiabilidad: muestra
  // las mismas siete columnas que escritorio (docs/principios-producto.md,
  // principios 1 y 7). El contrato completo de columnas se prueba en
  // tests/screenerSevenColumns.test.js.
  it("pinta las siete columnas en la fila móvil sin maquinaria de fiabilidad", () => {
    const html = renderToStaticMarkup(React.createElement(MobileResultList, {
      rows: [{
        symbol: "FRAG",
        companyName: "Fragile Growth Corp",
        country: "US",
        exchange: "NASDAQ",
        currency: "USD",
        price: 50,
        theme: "Software / IA",
        chartBarsCount: 220,
        priceFreshnessOk: true,
        priceFreshnessDays: 1,
        priceFreshnessMaxDays: 4,
        dataCoverageScore: 82,
        technicalCoverageScore: 84,
        fundamentalCoverageScore: 36,
        chartProvider: "Yahoo Finance",
        totalScore: 82,
        rsGlobalPct: 74,
        rsSectorPct: 71,
        rsQualityScore: 52,
        weeklyRsAvailable: true,
        weeklyRsRating: 74,
        weeklyStageState: "stage2",
        perf3m: 12.5,
        distance52w: -6.4,
        marketCap: 2400000000,
        volumeEffectScore: 69,
        adProxyScore: 50,
        growthScore: 45,
        epsGrowthProxyScore: 45,
        riskRewardScore: 68,
        weaknessScore: 12,
        extSma50: 10,
        setupDisplayPlanValid: true,
      }],
      settings: {},
      totalRows: 1,
      sort: "perf3m",
      onSort: () => {},
      perfPeriod: "perf3m",
      onPerfPeriod: () => {},
      onReview: () => {},
      onFavorite: () => {},
      favoriteSymbols: new Set(),
      onSave: () => {},
      onCsv: () => {},
      onAuditJson: () => {},
      page: 1,
      pageSize: 25,
      totalPages: 1,
      decisionResolutions: {
        FRAG: { key: "candidate", label: "Candidata", tone: "good" },
      },
    }));

    // Los siete datos de la fila.
    expect(html).toContain("mobileResultGrid");
    expect(html).toContain("Software / IA");
    expect(html).toContain("Etapa 2");
    expect(html).toContain("+12.5%");
    expect(html).toContain("-6.4%");
    expect(html).toContain("2.4B");

    // La maquinaria de fiabilidad y el veredicto ya no viven en la fila.
    expect(html).not.toContain("mobileResultTrustLine");
    expect(html).not.toContain("reviewFocusPill");
    expect(html).not.toContain("objectiveMetricTruthPill");
    expect(html).not.toContain("scoreAuditMini");
    expect(html).not.toContain("resolved-candidate");
  });

  it("renderiza la salud de datos como bloque accionable", () => {
    const html = renderToStaticMarkup(React.createElement(DataHealthPanel, {
      health: {
        status: { label: "Precio viejo", tone: "warn", detail: "precio viejo: 9d > 4d" },
        topLine: "Cob 42 · 9d/4d · Yahoo Finance",
        freshness: { tone: "warn", detail: "9d/4d" },
        provider: { label: "Yahoo Finance", tone: "neutral" },
        metrics: [
          { key: "coverage", label: "Cob", value: 42, tone: "warn" },
          { key: "technical", label: "Tec", value: 38, tone: "warn" },
          { key: "fundamental", label: "Fund", value: 12, tone: "warn" },
          { key: "bars", label: "Hist", value: 35, tone: "warn" },
        ],
        issues: [{ key: "freshness", label: "Precio viejo", tone: "warn", detail: "precio viejo" }],
      },
    }));

    expect(html).toContain("dataHealthPanel warn");
    expect(html).toContain("Salud datos");
    expect(html).toContain("Precio viejo");
    expect(html).toContain("Frescura");
    expect(html).toContain("Fuente");
  });

  it("renderiza el resumen accionable de salud de datos", () => {
    const html = renderToStaticMarkup(React.createElement(DataHealthSummaryRail, {
      activeKey: "stale",
      onSelect: () => {},
      summary: {
        rows: 4,
        verdict: { key: "stale", label: "Refrescar precios", tone: "warn", detail: "1 filas con precio viejo." },
        items: [
          { key: "ready", label: "Aptos", fullLabel: "Datos aptos", count: 2, share: "50%", tone: "good" },
          { key: "stale", label: "Viejos", fullLabel: "Precio viejo", count: 1, share: "25%", tone: "warn" },
          { key: "blocked", label: "Bloqueados", fullLabel: "Datos bloqueados", count: 1, share: "25%", tone: "bad" },
        ],
        topIssues: [{ key: "freshness", label: "Precio viejo", tone: "warn", count: 1, share: "25%" }],
      },
    }));

    expect(html).toContain("dataHealthSummaryRail warn");
    expect(html).toContain("Salud datos");
    expect(html).toContain("Refrescar precios");
    expect(html).toContain("dataHealthSummaryItem warn active");
    expect(html).toContain("aria-pressed=\"true\"");
  });

  it("renderiza el resumen accionable de auditoría de score", () => {
    const html = renderToStaticMarkup(React.createElement(ScoreAuditSummaryRail, {
      activeKey: "mismatch",
      onSelect: () => {},
      summary: {
        rows: 5,
        cleanCount: 3,
        attentionCount: 2,
        cleanShare: "60%",
        attentionShare: "40%",
        mismatchCount: 1,
        missingRows: 1,
        verdict: { key: "residual", label: "Revisar fórmula", tone: "warn", detail: "1 filas con diferencia relevante vs score mostrado." },
        topMissing: [{ key: "demand", label: "Demanda", tone: "warn", count: 1, share: "20%" }],
        topDrags: [{ key: "setup", label: "Setup", tone: "warn", count: 2, share: "40%" }],
      },
    }));

    expect(html).toContain("scoreAuditSummaryRail dataHealthSummaryRail warn");
    expect(html).toContain("Score audit");
    expect(html).toContain("Revisar fórmula");
    expect(html).toContain("scoreAuditSummaryItem dataHealthSummaryItem warn active");
    expect(html).toContain("Filtrar Score descuadrado");
  });

  it("renderiza limitaciones metodológicas dentro del rail de auditabilidad", () => {
    const html = renderToStaticMarkup(React.createElement(AuditabilitySummaryRail, {
      onReviewFocus: () => {},
      summary: {
        rows: 6,
        auditabilityShare: "33%",
        snapshotIntegrity: "100%",
        counts: { fullyAuditable: 2 },
        verdict: { key: "method", label: "Validar método", tone: "warn", detail: "4 filas requieren criterio antes de confiar." },
        items: [
          { key: "snapshot", label: "Snapshot íntegro", count: 6, share: "100%", tone: "good" },
          { key: "score", label: "Score trazable", count: 6, share: "100%", tone: "good" },
        ],
        methodologyReviewFocus: [
          { key: "risk", label: "Riesgo operativo", tone: "bad", count: 2, share: "33%", toneSummary: "2 bad", action: "Revisar extension y rentabilidad/riesgo." },
        ],
        methodologyLimitations: [
          { key: "sector-context", label: "Contexto sectorial", tone: "warn", count: 6, share: "100%", toneSummary: "2 warn · 4 neutral" },
          { key: "demand", label: "Demanda/volumen", tone: "warn", count: 3, share: "50%", toneSummary: "3 warn" },
        ],
      },
    }));

    expect(html).toContain("auditabilitySummaryRail");
    expect(html).toContain("Auditabilidad");
    expect(html).toContain("<button");
    expect(html).toContain("Abrir Review: Riesgo operativo");
    expect(html).toContain(">Riesgo operativo<");
    expect(html).toContain("Contexto sectorial");
    expect(html).toContain("Demanda/volumen");
    expect(html).toContain('title="2 warn · 4 neutral"');
    expect(html).toContain(">Observación<");
    expect(html).not.toContain(">Observación, no señal automática<");
  });

  it("renderiza una lectura compacta de decisión en el origen", () => {
    const html = renderToStaticMarkup(React.createElement(ScreenerOriginPanel, {
      origin: {
        key: "bullish",
        label: "Operable",
        tone: "watch",
        sourceLabel: "Screener actual",
        text: "Setup de alta prioridad con validación pendiente.",
        readiness: { key: "operable", label: "Operable", detail: "Puede pasar a Review" },
        decisionProfile: { key: "operable-fragile", label: "Operable fragil", tone: "warn", detail: "Confluencia incompleta" },
        decisionBrief: {
          nextAction: { label: "Siguiente", value: "Validar primero", detail: "Revisar demanda antes de marcar candidata", tone: "warn" },
        },
        decisionTrace: {
          confidence: { key: "medium", score: 62, label: "Media", tone: "warn", detail: "Falta confirmacion de volumen" },
          evidence: {
            status: "needs-work",
            tone: "warn",
            passedCount: 4,
            totalCount: 6,
            pending: [{ key: "demanda-volumen", label: "Demanda/volumen", detail: "Sin volumen relativo suficiente", tone: "warn" }],
          },
        },
        dataHealth: {
          status: { label: "Datos aptos", tone: "good", detail: "Cobertura suficiente" },
          coverageScore: 88,
          issues: [],
        },
        scoreAudit: {
          displayedScore: 82,
          calculatedScore: 70,
          residual: 12,
          integrityTone: "warn",
          topLine: "Score mostrado por encima del cálculo auditado",
          positive: [],
          drags: [{ key: "setup", label: "Setup", value: 40 }],
          missing: [],
        },
      },
      variant: "review",
    }));

    expect(html).toContain("screenerOriginDecisionRead warn");
    expect(html).toContain("Lectura rápida de decisión del screener");
    expect(html).toContain("Acción");
    expect(html).toContain("Validar primero");
    expect(html).toContain("Confianza");
    expect(html).toContain("Media 62");
    expect(html).toContain("Freno");
    expect(html).toContain("Setup");
  });

  it("muestra motivos concretos dentro del panel de auditoría de score", () => {
    const html = renderToStaticMarkup(React.createElement(ScoreAuditPanel, {
      audit: {
        displayedScore: 92,
        calculatedScore: 74.2,
        residual: 17.8,
        integrityTone: "warn",
        formula: "score audit test",
        topLine: "RS +14.4 · Setup +13.6",
        positive: [],
        drags: [{ key: "setup", label: "Setup", value: 40, points: 6.8, tone: "warn" }],
        risks: [],
        missing: [{ key: "demand", label: "Demanda", missing: true }],
        components: [
          { key: "setup", label: "Setup", value: 40, points: 6.8, weight: .17, tone: "warn" },
          { key: "demand", label: "Demanda", value: null, points: 0, weight: .1, tone: "muted", missing: true },
        ],
      },
    }));

    expect(html).toContain("scoreAuditReasons");
    expect(html).toContain("Descuadre score");
    expect(html).toContain("Componentes sin dato");
    expect(html).toContain("Demanda");
  });

  it("renderiza el rail de trabajo pendiente accionable", () => {
    const html = renderToStaticMarkup(React.createElement(PendingDecisionWorkRail, {
      summary: {
        pendingCount: 8,
        highConfidenceCount: 3,
        focusCount: 3,
        top: { symbol: "HIGH", priority: 1388, confidenceLabel: "Alta" },
      },
      active: true,
      onFocus: () => {},
      onClear: () => {},
      onReview: () => {},
    }));

    expect(html).toContain("pendingDecisionWorkRail active");
    expect(html).toContain("Trabajo pendiente");
    expect(html).toContain("Limpiar");
    expect(html).toContain("HIGH");
    expect(html).toContain("alta confianza");
  });

  // Los chips dicen QUÉ está filtrado y cuántas filas quedan; ya no emiten el
  // "Brief vista" (veredicto + Freno + Primero), que era el mismo juicio
  // operativo del panel Decisiones condicionado a tener filtros activos.
  it("explica la vista filtrada sin emitir un veredicto sobre ella", () => {
    const html = renderToStaticMarkup(React.createElement(ResultFilterChips, {
      chips: [
        { key: "evidence", label: "Pruebas: Validar", onClear: () => {} },
        { key: "score", label: "Score: Descuadre", onClear: () => {} },
      ],
      hiddenCount: 58,
      visibleCount: 12,
      totalCount: 70,
      onClearAll: () => {},
      onReview: () => {},
    }));

    expect(html).toContain("resultViewFocusSummary");
    expect(html).toContain("Vista de investigación");
    expect(html).toContain("12/70");
    expect(html).toContain("58");
    expect(html).toContain("Revisar vista");
    expect(html).toContain("Pruebas: Validar");
    expect(html).toContain("Score: Descuadre");
    expect(html).toContain("Limpiar vista");

    expect(html).not.toContain("resultViewBrief");
    expect(html).not.toContain("Brief vista");
    expect(html).not.toContain("Lectura frágil");
    expect(html).not.toContain("Freno");
  });

  it("renderiza pruebas pendientes de decision en el panel rapido", () => {
    const html = renderToStaticMarkup(React.createElement(QuickPanel, {
      row: {
        symbol: "THIN",
        companyName: "Thin Confirmation Inc",
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
        volumeEffectScore: 45,
        demandScore: 48,
        adProxyScore: 44,
        growthScore: 42,
        epsGrowthProxyScore: 40,
        riskRewardScore: 60,
        relativeVolume: 1,
        weaknessScore: 12,
        extSma50: 10,
        objectiveMetricAudit: {
          status: "verified",
          verifiedCount: 2,
          traceableCount: 1,
          issues: [],
          items: [
            { key: "rsGlobalPct", label: "RS global", status: "verified", severity: "neutral", proxy: false },
            { key: "relativeVolume", label: "Vol relativo", status: "verified", severity: "neutral", proxy: false },
            { key: "adProxyScore", label: "A/D proxy", status: "traceable", severity: "neutral", proxy: true },
          ],
        },
        setupDisplayPlanValid: true,
      },
      settings: {},
    }));

    expect(html).toContain("quickPanelTrustRail");
    expect(html).toContain("objectiveMetricTruthPill neutral");
    expect(html).toContain("<em>Mixto</em>");
    expect(html).toContain("source-proxy");
    expect(html).toContain("aria-label=\"A/D: 44. A/D proxy: proxy/estimada\"");
    expect(html).toContain("aria-hidden=\"true\">p");
    expect(html).toContain("decisionEvidenceChecklist");
    expect(html).toContain("dataHealthPanel good");
    expect(html).toContain("Salud datos");
    expect(html).toContain("Datos aptos");
    expect(html).toContain("scoreAuditPanel");
    expect(html).toContain("Score audit");
    expect(html).toContain("Pruebas pendientes");
    expect(html).toContain("Confluencia amplia");
    expect(html).toContain("Contradicciones");
  });

  it("marca proxies en tarjetas de búsqueda sin añadir explicación visible larga", () => {
    const html = renderToStaticMarkup(React.createElement(PreviewCard, {
      variant: "search",
      row: {
        symbol: "MIXD",
        companyName: "Mixed Metrics Corp",
        exchange: "NASDAQ",
        price: 42,
        currency: "USD",
        objectiveScore: 76,
        totalScore: 79,
        rsGlobalPct: 88,
        rsRating: 72,
        adProxyScore: 44,
        epsGrowthProxyScore: 38,
        benchmarkSymbol: "SPY",
        objectiveMetricAudit: {
          status: "verified",
          verifiedCount: 3,
          traceableCount: 2,
          issues: [],
          items: [
            { key: "objectiveScore", label: "Score objetivo", status: "verified", severity: "neutral", proxy: false },
            { key: "rsGlobalPct", label: "RS global", status: "verified", severity: "neutral", proxy: false },
            { key: "adProxyScore", label: "A/D proxy", status: "traceable", severity: "neutral", proxy: true },
            { key: "epsGrowthProxyScore", label: "EPS proxy", status: "traceable", severity: "neutral", proxy: true },
          ],
        },
      },
    }));

    expect(html).toContain("previewSummaryGrid");
    expect(html).toContain("previewSummaryStat");
    expect(html).toContain("source-proxy");
    expect(html).toContain("aria-label=\"A/D: 44. A/D proxy: proxy/estimada\"");
    expect(html).toContain("aria-label=\"EPS proxy: 38. EPS proxy: proxy/estimada\"");
    expect(html).toContain("aria-hidden=\"true\">p");
  });

  it("renderiza el checklist de evidencia como componente compacto", () => {
    const html = renderToStaticMarkup(React.createElement(DecisionEvidenceChecklist, {
      evidence: {
        tone: "warn",
        passedCount: 4,
        totalCount: 6,
        pending: [
          { key: "demanda-volumen", label: "Demanda/volumen", statusLabel: "Pendiente", tone: "warn", detail: "Falta confirmacion" },
        ],
      },
      compact: true,
    }));

    expect(html).toContain("decisionEvidenceChecklist compact warn");
    expect(html).toContain("Demanda/volumen");
    expect(html).toContain("4/6");
  });

  it("renderiza foco de revision metodologica en el checklist expandido", () => {
    const html = renderToStaticMarkup(React.createElement(DecisionEvidenceChecklist, {
      evidence: {
        tone: "warn",
        passedCount: 7,
        totalCount: 9,
        manualReviewRequired: true,
        pending: [
          { key: "confluencia-amplia", label: "Confluencia amplia", statusLabel: "Pendiente", tone: "warn", detail: "confirmacion 4/5" },
        ],
        reviewFocus: [
          { key: "demand", label: "Demanda/volumen", tone: "warn", detail: "demanda debil", action: "Validar acumulacion con volumen, A/D, RelVol o UD Vol antes de elevar confianza." },
        ],
      },
    }));

    expect(html).toContain("Foco revision");
    expect(html).toContain("Demanda/volumen");
    expect(html).toContain("<em>demanda debil</em>");
    expect(html).not.toContain("<em>Validar acumulacion");
    expect(html).toContain("Validar acumulacion");
    expect(html).toContain("Foco de revision metodologica");
  });
});
