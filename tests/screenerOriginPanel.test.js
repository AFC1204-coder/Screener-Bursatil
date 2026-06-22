import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ScreenerOriginPanel from "@/app/ScreenerOriginPanel";

function visibleText(html = "") {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

describe("ScreenerOriginPanel", () => {
  it("renderiza el resumen accionable de decision", () => {
    const html = renderToStaticMarkup(React.createElement(ScreenerOriginPanel, { origin: {
      tone: "bullish",
      label: "Contrato largo",
      sourceLabel: "Revisión Screener",
      sourceDetail: "Brief vista: Pruebas: Validar · Freno: Confluencia amplia",
      title: "Líderes con sesgo largo",
      text: "Contexto de prueba.",
      presetName: "Balanceado",
      setupName: "Stage 2",
      readiness: { label: "Operable" },
      decisionProfile: { key: "operable-clean", label: "Operable limpio", tone: "good", detail: "Confianza alta" },
      decisionTrace: {
        priorityScore: 1320.5,
        priority: {
          score: 1320.5,
          issuePenalty: 70,
          components: [
            { key: "readiness", label: "Decision", value: 1000, detail: "Operable" },
            { key: "action", label: "Accion", value: 160, detail: "Candidato largo" },
          ],
          penalties: [{ key: "overextended-sma50", label: "Extendida sobre SMA50", value: 70 }],
        },
        drivers: [{ key: "rs-global", label: "RS global", value: "91" }],
        watch: [],
        evidence: {
          status: "needs-work",
          tone: "warn",
          passedCount: 4,
          totalCount: 6,
          summary: "Confluencia amplia · Demanda/volumen",
          pending: [
            { key: "confluencia-amplia", label: "Confluencia amplia", statusLabel: "Pendiente", tone: "warn", detail: "Liderazgo 2/3" },
            { key: "demanda-volumen", label: "Demanda/volumen", statusLabel: "Pendiente", tone: "warn", detail: "Falta volumen" },
          ],
        },
      },
      decisionBrief: {
        thesis: { label: "Tesis", value: "RS global 91", detail: "Liderazgo claro", tone: "good" },
        risk: { label: "Riesgo", value: "Sin alerta principal", detail: "Validar precio", tone: "good" },
        nextAction: { label: "Siguiente", value: "Preparar entrada", detail: "Confirmar volumen", tone: "good" },
      },
      dataHealth: {
        status: { key: "stale", label: "Precio viejo", tone: "warn", detail: "Precio con 9 dias de desfase." },
        coverageScore: 72,
        issues: [{ key: "freshness", label: "Precio viejo", tone: "warn", detail: "9d/5d" }],
        topLine: "Cob 72 · 9d/5d · Yahoo Finance",
      },
      metricTruth: {
        key: "mixed",
        label: "Métricas mixtas",
        shortLabel: "Mixto",
        tone: "neutral",
        detail: "28 medidas · 2 proxy/estimadas",
        measuredCount: 28,
        proxyCount: 2,
        issues: [],
      },
      metricAuditItems: [
        { key: "totalScore", label: "Score", value: 82, status: "verified", severity: "neutral", proxy: false },
        { key: "rsGlobalPct", label: "RS global", value: 91, status: "traceable", severity: "neutral", proxy: false },
        { key: "adProxyScore", label: "A/D proxy", value: 50, status: "traceable", severity: "neutral", proxy: true },
        { key: "epsGrowthProxyScore", label: "EPS proxy", value: 45, status: "traceable", severity: "neutral", proxy: true },
      ],
      reviewFocus: {
        key: "score",
        label: "Score",
        tone: "warn",
        detail: "Score descuadrado vs componentes.",
      },
      scoreAudit: {
        displayedScore: 82,
        calculatedScore: 73.8,
        residual: 8.2,
        integrityTone: "warn",
        topLine: "RS +14.6 · Setup +13.6",
        positive: [
          { key: "rs", label: "RS", points: 14.6, tone: "good" },
          { key: "setup", label: "Setup", points: 13.6, tone: "good" },
        ],
        drags: [{ key: "risk", label: "Riesgo", value: 42, tone: "warn" }],
        missing: [],
      },
      methodologyFocus: {
        key: "confluence",
        label: "Confluencia amplia",
        shortLabel: "Confluencia amplia",
        tone: "warn",
        detail: "Comprobar que liderazgo, confirmacion y ejecucion no dependan de un unico motor.",
        requiresReview: true,
      },
    } }));

    expect(html).toContain("screenerOriginDecisionGrid");
    expect(html).toContain("screenerOriginSourceDetail");
    expect(html).toContain("Brief vista: Pruebas: Validar");
    expect(html).toContain("screenerOriginDataHealth warn");
    expect(html).toContain("Precio viejo · Cob 72");
    expect(html).toContain("screenerOriginMetricTruth neutral");
    expect(html).toContain("Métricas mixtas · Mixto");
    expect(html).toContain("28 medidas");
    expect(html).toContain("2 proxy");
    expect(html).toContain("screenerOriginSnapshotMetrics");
    expect(html).toContain("title=\"A/D: proxy/estimada\"");
    expect(html).toContain(">50</b><i");
    expect(html).toContain("screenerOriginReviewFocus warn focus-score");
    expect(html).toContain("Foco");
    const visible = visibleText(html);
    expect(html).toContain('title="Foco · Score · Score descuadrado vs componentes."');
    expect(visible).not.toContain("Score descuadrado vs componentes.");
    expect(html).toContain("screenerOriginScoreAudit warn");
    expect(html).toContain("Score 82 · calc 73.8");
    expect(html).toContain("RS +14.6");
    expect(html).toContain("screenerOriginMethodologyFocus warn requiresReview");
    expect(html).toContain("Método pendiente");
    expect(html).toContain("Validar");
    expect(html).toContain("Comprobar que liderazgo, confirmacion y ejecucion no dependan de un unico motor.");
    expect(visible).not.toContain("Comprobar que liderazgo, confirmacion y ejecucion no dependan de un unico motor.");
    expect(html).toContain("originMeta-profile");
    expect(html).toContain("Operable limpio");
    expect(html).toContain("RS global 91");
    expect(html).toContain("Sin alerta principal");
    expect(html).toContain("Preparar entrada");
    expect(html).toContain("Ranking");
    expect(html).toContain("Decision +1000");
    expect(html).toContain("Issues -70");
    expect(html).toContain("screenerOriginEvidence");
    expect(html).toContain("4/6");
    expect(html).toContain("Confluencia amplia");
    expect(html).toContain("Demanda/volumen");
  });
});
