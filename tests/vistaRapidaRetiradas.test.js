// tests/vistaRapidaRetiradas.test.js — contrato de superficie de la vista
// rápida y la cola de revisión tras la limpieza del 2026-08-24
// (docs/analisis-vista-rapida-2026-08-24.md). Es la misma operación que fijó
// tests/fichaRetiradas.test.js para la ficha: el producto clasifica, no
// recomienda (principio 1), y el diagnóstico interno del motor no es un dato
// del valor (principio 2). Si un assert falla porque un bloque "volvió",
// releer el análisis antes de reponerlo.
//
// Dos capas, como en la ficha:
//  - El modal de vista rápida es un componente puro de props: se renderiza
//    con renderToStaticMarkup sobre una fila COMPLETA (con todos los campos
//    del motor presentes) para demostrar que los veredictos no se pintan
//    AUNQUE haya dato.
//  - La página /review monta su cola desde localStorage en un effect que el
//    render estático no ejecuta, así que su contrato se fija sobre el FUENTE
//    (sin comentarios): una versión resucitada volvería a estar oculta al
//    render sin estado.

import React from "react";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import QuickReviewModal from "@/app/components/screener/QuickReviewModal";

vi.mock("lightweight-charts", () => ({
  createChart: () => null,
  CandlestickSeries: class {},
  LineSeries: class {},
  AreaSeries: class {},
  HistogramSeries: class {},
  createSeriesMarkers: () => {},
  PriceScaleMode: { Normal: 0, Logarithmic: 1, Percentage: 2 },
}));

const testDir = dirname(fileURLToPath(import.meta.url));
function sourceWithoutComments(relativePath) {
  return readFileSync(resolve(testDir, relativePath), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

// Fila deliberadamente COMPLETA en maquinaria del motor: percentil del lote
// (rsGlobalPct 97, distinto del RS canónico 61 a propósito), scores
// compuestos y un decisionTrace con los textos prohibidos. Nada de eso debe
// llegar al HTML.
function reviewRow(overrides = {}) {
  return {
    symbol: "RETQ",
    companyName: "Retirada Quick Corp.",
    exchange: "NASDAQ",
    currency: "USD",
    country: "US",
    sector: "Technology",
    industry: "Software",
    theme: "Software / IA",
    price: 13.16,
    marketCap: 2100000000,
    perf3m: 71.6,
    perf6m: 79.3,
    perf12m: 82.8,
    distance52w: -3.3,
    latestTurnover: 111000000,
    volumeSurgePct: 82.6,
    upDownVolRatio: 2.59,
    shortPercentOfFloat: 5.1,
    maxDrawdown63d: 11.9,
    volatility63d: 64.9,
    // RS canónico (ranking semanal) presente e hidratado…
    weeklyRsAvailable: true,
    weeklyRsRating: 61,
    weeklyRsWeekKey: "2026-W32",
    weeklyRsSampleSize: 4868,
    weeklyStageState: "stage2",
    stageLabel: "Stage 2 probable",
    // …y el percentil del lote con OTRO valor, para detectar cualquier celda
    // que vuelva a leerlo bajo la etiqueta RS (lib/rsCanonical.js lo prohíbe).
    rsGlobalPct: 97,
    rsCountryPct: 97,
    rsSectorPct: 98,
    rsQualityScore: 96.9,
    objectiveScore: 88,
    totalScore: 89,
    adProxyScore: 100,
    epsGrowthProxyScore: 58,
    setupQualityScore: 84,
    growthScore: 58,
    riskRewardScore: 70,
    weaknessScore: 0,
    decisionTrace: {
      action: { key: "high-risk", label: "Riesgo alto", tone: "bad" },
      readiness: { key: "audit", label: "Auditar", detail: "Riesgo severo: requiere revisión manual antes de entrar en cola.", tone: "bad" },
      brief: { nextAction: { label: "Siguiente", value: "Auditar antes", tone: "warn" } },
      priority: { score: 235, components: [{ key: "readiness", label: "Decision", value: 260 }], penalties: [] },
    },
    ...overrides,
  };
}

function renderModal(overrides = {}) {
  const row = reviewRow(overrides);
  return renderToStaticMarkup(React.createElement(QuickReviewModal, {
    activeModalRow: row,
    chartSettings: {},
    modalActiveResolution: null,
    modalDecisionResolutions: {},
    modalReviewPosition: 0,
    modalReviewRows: [row, reviewRow({ symbol: "OTRA", companyName: "Otra Corp." })],
    modalOriginLabel: "Revisión Screener",
    closeQuickReview: () => {},
    moveQuickReview: () => {},
    reopenQuickReviewDecision: () => {},
    resolveQuickReviewDecision: () => {},
    saveQuickReviewStockOpen: () => {},
    updateChartScope: () => {},
    updateChartSettings: () => {},
  }));
}

describe("vista rápida: veredictos y estado interno retirados el 2026-08-24", () => {
  const html = renderModal();

  it("ningún veredicto operativo llega al HTML aunque el motor lo traiga", () => {
    for (const veredicto of [
      "Auditar antes",
      "Esperar confirmación",
      "Riesgo severo",
      "revisión manual",
      "Riesgo alto",
      "Candidato largo",
      "Sin tesis clara",
    ]) {
      expect(html, `no debe contener «${veredicto}»`).not.toContain(veredicto);
    }
  });

  it("ningún número interno del programa llega al HTML", () => {
    for (const interno of [
      "Percentil lote",
      "PRIORIDAD",
      "prioridad",
      "Score audit",
      "Score objetivo",
      "Componentes sin dato",
      "Riesgos score",
      "Arrastres",
      "proxy",
      "Bloqueadas",
      "Métricas objetivas",
      "Confianza",
      "Freno",
      "Pruebas",
      "Contrato largo",
      "screenerOriginPanel",
      "reviewPriorityPanel",
      "reviewThesisBar",
      "reviewQueueSummary",
      "scoreAuditPanel",
      "decisionEvidenceChecklist",
      "reviewQueueTrustSignature",
      "reviewQueueFocusBadge",
      "reviewQueueDecisionBadge",
    ]) {
      expect(html, `no debe contener «${interno}»`).not.toContain(interno);
    }
  });

  it("el RS es el canónico, no el percentil del lote", () => {
    // 61 = weeklyRsRating (ranking semanal); 97 = rsGlobalPct (lote). El 97
    // no debe aparecer en NINGUNA celda: el fixture no produce ese número por
    // ninguna otra vía.
    expect(html).toContain(">61<");
    expect(html).not.toContain("97");
  });

  it("conserva la información legítima del valor y la navegación", () => {
    expect(html).toContain(">RETQ<");
    expect(html).toContain("Retirada Quick Corp.");
    expect(html).toContain("Anterior");
    expect(html).toContain("Siguiente");
    expect(html).toContain(">Ficha<");
    expect(html).toContain("+71,6%");
    expect(html).toContain(">Etapa<");
    expect(html).toContain(">Capitalización<");
    expect(html).toContain("2,1B");
    expect(html).toContain(">Negocio<");
    expect(html).toContain("Volumen sesión");
  });

  it("conserva los botones de clasificar del inversor", () => {
    for (const label of ["Reabrir", "Candidata", "Vigilar", "Descartar"]) {
      expect(html).toContain(`>${label}<`);
    }
    // «Vigilar» solo puede aparecer como botón de clasificación, no como
    // veredicto de fila: en este fixture sin resolución aparece una única vez.
    expect(html.split(">Vigilar<").length - 1).toBe(1);
  });

  it("la cola lateral queda en identidad + clasificación + RS canónico", () => {
    expect(html).toContain("reviewQueueItem");
    expect(html).toContain(">OTRA<");
    expect(html).not.toContain("reviewQueueDecisionBadge");
    expect(html).not.toContain("reviewQueuePriorityBadge");
    expect(html).not.toContain("reviewQueueProfileBadge");
    expect(html).not.toContain("reviewQueueMethodologyBadge");
    expect(html).not.toContain("reviewQueueDataHealthBadge");
    expect(html).not.toContain("reviewQueueMetricTruthBadge");
    expect(html).not.toContain("reviewQueueScoreAuditBadge");
  });

  it("el fuente del modal no reconstruye la maquinaria retirada", () => {
    const source = sourceWithoutComments("../app/components/screener/QuickReviewModal.jsx");
    for (const simbolo of [
      "ScreenerOriginPanel",
      "ReviewPriorityPanel",
      "DecisionEvidenceChecklist",
      "ScoreAuditPanel",
      "buildDecisionQueueItem",
      "modalRankExplain",
      "quickReviewOrigin",
      "rsGlobalPct",
      "metricShortLabel",
    ]) {
      expect(source, `el fuente no debe referenciar ${simbolo}`).not.toContain(simbolo);
    }
  });
});

describe("cola de revisión (/review): la maquinaria de veredictos no vuelve", () => {
  const source = sourceWithoutComments("../app/review/page.jsx");

  it("el fuente no monta paneles de decisión ni prioridad", () => {
    for (const simbolo of [
      "ReviewPriorityPanel",
      "ReviewDecisionPanel",
      "DecisionEvidenceStrip",
      "QueueDecisionDigest",
      "ReviewQueueFocusBadge",
      "buildDecisionQueueItem",
      "buildDecisionQueueDigest",
      "buildDecisionQueueSummary",
      "buildReviewPrioritySummary",
      "buildReviewProfileSummary",
      "reviewPriorityForRow",
      "decisionProfileForRow",
      "buildScreenerScoreAudit",
      "buildScreenerDataHealth",
      "vcpReliabilityAudit",
      "metricTruthMetaForRow",
      "rowTrustSignatureForRow",
      "TrustMetric",
    ]) {
      expect(source, `review no debe referenciar ${simbolo}`).not.toContain(simbolo);
    }
  });

  it("el grid de métricas no lee el percentil del lote ni los percentiles de país/grupo", () => {
    // El RS de la pantalla pasa por canonicalRs; rsGlobalPct solo puede
    // aparecer como dato de FILA en la hidratación (hydrateReviewRow guarda
    // campos de fila), nunca como celda pintada.
    expect(source).toContain("canonicalRs");
    expect(source).not.toContain('value(row, "rsGlobalPct")');
    expect(source).not.toContain('value(row, "rsCountryPct")');
    expect(source).not.toContain('value(row, "rsSectorPct")');
    expect(source).not.toContain('value(row, "rsRating")');
    expect(source).not.toContain('value(row, "totalScore")');
    expect(source).not.toContain('value(row, "weaknessScore")');
    expect(source).not.toContain("volumeEvidence");
  });

  it("la clasificación del inversor y su historial se conservan", () => {
    expect(source).toContain("STOCK_DECISION_ACTIONS");
    expect(source).toContain("applyStockDecisionResolution");
    expect(source).toContain("decisionResolutionHistory");
    expect(source).toContain("reviewResolveRail");
  });

  it("la nota de la resolución ya no lleva el veredicto del motor", () => {
    // Antes: note = nextAction.value + risk.value («Auditar antes · …»).
    expect(source).not.toContain("nextAction");
    expect(source).not.toMatch(/risk\??\.value/);
  });
});

describe("la nota de la vista rápida y el RS del chart de fila", () => {
  it("useQuickReviewSession no compone la nota con el veredicto del motor", () => {
    const source = sourceWithoutComments("../app/components/screener/useQuickReviewSession.js");
    expect(source).not.toContain("nextAction");
    expect(source).not.toContain("buildDecisionQueueItem");
    expect(source).not.toContain("buildReviewProfileSummary");
    expect(source).not.toContain("frágiles");
  });

  it("el badge RS del chart de fila lleva el canónico, no el percentil del lote", () => {
    const source = sourceWithoutComments("../app/RowPriceChart.jsx");
    expect(source).toContain("canonicalRsValue(row)");
    expect(source).not.toContain("rsMainScore={row.rsGlobalPct}");
  });
});

describe("los componentes retirados no existen", () => {
  it("ScreenerOriginPanel y ReviewWidgets se fueron del árbol", () => {
    expect(existsSync(resolve(testDir, "../app/ScreenerOriginPanel.jsx"))).toBe(false);
    expect(existsSync(resolve(testDir, "../app/components/screener/ReviewWidgets.jsx"))).toBe(false);
  });

  it("la home no construye el contexto de origen del modal", () => {
    const source = sourceWithoutComments("../app/page.jsx");
    expect(source).not.toContain("quickReviewOrigin");
    expect(source).not.toContain("modalRankExplain");
    expect(source).not.toContain("modalScoreAudit");
    expect(source).not.toContain("modalReviewQueueItems");
    expect(source).not.toContain("buildReviewQueueAuditSummary");
    expect(source).not.toContain("ScreenerOriginPanel");
  });
});
