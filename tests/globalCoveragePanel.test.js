import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { renderGlobalCoverageView } from "@/app/components/screener/GlobalCoveragePanel";

// Tests del panel informativo de cobertura internacional (solo lectura).
// Patrón del repo: renderToStaticMarkup sobre la función pura
// renderGlobalCoverageView({ report, loading, error }) con respuestas simuladas
// de GET /api/coverage (modelo de lib/coveragePlan.js). Sin DOM ni timers.

function visibleText(html = "") {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// Mismo formato que usa el componente (Number.toLocaleString). Node/vitest no
// always trae datos ICU es-ES, así que construimos los valores esperados con la
// MISMA transformación para que los asserts sean robustos al entorno.
function fmt(value) {
  return Number(value).toLocaleString("es-ES");
}

// marketRow helper: construye una fila de /api/coverage coherente con coveragePlan.js.
// scanFresh y scanUnique se separan a propósito para validar que el panel NO los
// confunde (fresh = precio reciente; uniqueSymbols = filas materializadas).
function marketRow({
  market = "US",
  region = "US",
  grade = "util",
  coveragePct = 60,
  inventoryCandidates = 3000,
  scanFresh = 380,
  scanUnique = 450,
  scanRankingEligible = 120,
  readinessState = "operational",
  readinessLabel = "Cobertura operativa",
  readinessDetail = "Fuente e inventario suficientes.",
}) {
  return {
    market,
    region,
    priority: 1,
    sourceStatus: "active",
    current: inventoryCandidates,
    target: Math.round((inventoryCandidates / Math.max(coveragePct, 1)) * 100),
    coveragePct,
    grade,
    gap: 0,
    inventory: { candidates: inventoryCandidates, target: 1, coveragePct, grade, gap: 0 },
    scan: {
      uniqueSymbols: scanUnique,
      fresh: scanFresh,
      qualityOk: scanRankingEligible,
      rankingEligible: scanRankingEligible,
      actionable: scanRankingEligible,
      scannedPct: 0,
      rankingEligiblePct: 0,
      actionablePct: 0,
      activationPct: 0,
      grade,
      gap: 0,
      actionableGap: 0,
    },
    activeSource: "test",
    nextAction: "",
    readiness: { state: readinessState, label: readinessLabel, detail: readinessDetail, tone: "pass", blocksCoverageClaim: false },
  };
}

describe("GlobalCoveragePanel · renderGlobalCoverageView", () => {
  it("1. cobertura disponible: muestra universo, frescos, materializados y elegibles", () => {
    const report = {
      generatedAt: "2026-07-16T00:00:00.000Z",
      degraded: false,
      status: "complete",
      markets: [marketRow({
        market: "US",
        inventoryCandidates: 5864,
        scanFresh: 410,       // frescos (precio reciente) — DISTINTO de materializados
        scanUnique: 1820,     // materializados — DISTINTO de frescos
        scanRankingEligible: 210,
        grade: "util",
        coveragePct: 95,
        readinessState: "operational",
        readinessLabel: "Cobertura operativa",
      })],
    };
    const html = renderToStaticMarkup(React.createElement(renderGlobalCoverageView, { report, loading: false, error: "" }));
    const text = visibleText(html);

    // Universo disponible
    expect(text).toContain(fmt(5864));
    expect(text).toContain("Universo");
    // Estado de cobertura operativo
    expect(text).toContain("Cobertura operativa");
    // Grado visible
    expect(text).toContain("Útil");
    // No muestra estados de error/vacío
    expect(text).not.toContain("Cobertura no disponible");
    expect(text).not.toContain("Sin cobertura accesible");
  });

  it("2. cobertura parcial: comunica estado parcial honesto (brecha/gap)", () => {
    const report = {
      status: "complete",
      markets: [marketRow({
        market: "KR",
        grade: "baja",
        coveragePct: 10,
        inventoryCandidates: 110,
        scanFresh: 0,
        scanUnique: 0,
        scanRankingEligible: 0,
        readinessState: "coverage_gap",
        readinessLabel: "Cobertura baja",
        readinessDetail: "Inventario insuficiente frente al objetivo operativo.",
      })],
    };
    const html = renderToStaticMarkup(React.createElement(renderGlobalCoverageView, { report, loading: false, error: "" }));
    const text = visibleText(html);

    expect(text).toContain("Cobertura baja");
    expect(text).toContain("Baja");
    expect(text).toMatch(/10%/);
    expect(text).toContain("Inventario insuficiente");
    expect(text).not.toContain("Cobertura operativa");
  });

  it("3. ausencia de datos: muestra mensaje de sin cobertura y no pinta tabla", () => {
    const report = { status: "complete", markets: [] };
    const html = renderToStaticMarkup(React.createElement(renderGlobalCoverageView, { report, loading: false, error: "" }));
    const text = visibleText(html);

    expect(text).toContain("Sin cobertura accesible todavía");
    expect(text).toContain("resultados materializados");
    expect(html).not.toContain("globalCoverageMarketList");
    expect(html).not.toContain("globalCoverageMetric");
  });

  it("4. fallo de red: muestra error sin acciones de scan/backfill", () => {
    const html = renderToStaticMarkup(React.createElement(renderGlobalCoverageView, { report: null, loading: false, error: "Failed to fetch" }));
    const text = visibleText(html);

    expect(text).toContain("Cobertura no disponible");
    expect(text).toContain("recargando la página");
    expect(text).toContain("Failed to fetch");
    expect(text.toLowerCase()).not.toContain("ejecutar scan");
    expect(text.toLowerCase()).not.toContain("lanzar backfill");
  });

  it("5. ningún estado expone rutas/acciones que lancen scan o backfill", () => {
    const states = [
      { report: { status: "complete", markets: [marketRow({ market: "US" })], backfillPlan: { recommendedJobs: [{ label: "Core US", path: "/api/jobs/scan-refresh?markets=US&limit=100" }] } }, loading: false, error: "" },
      { report: { status: "complete", markets: [marketRow({ market: "ES", readinessState: "coverage_gap" })] }, loading: false, error: "" },
      { report: null, loading: false, error: "network down" },
      { report: null, loading: true, error: "" },
    ];
    for (const props of states) {
      const html = renderToStaticMarkup(React.createElement(renderGlobalCoverageView, props));
      expect(html).not.toMatch(/<a\s[^>]*href=/i);
      expect(html).not.toMatch(/<button/i);
      expect(html).not.toMatch(/href=["']\/api\/(scan|jobs|cron)/i);
    }
    const withBackfill = renderToStaticMarkup(React.createElement(renderGlobalCoverageView, states[0]));
    expect(withBackfill).toContain("/api/jobs/scan-refresh");
    expect(withBackfill).toContain("no ejecutable desde aquí");
    expect(withBackfill).not.toMatch(/<a\s/i);
    expect(withBackfill).not.toMatch(/<button/i);
  });

  it("6. separa frescos (scan.fresh) de materializados (scan.uniqueSymbols) y de universo", () => {
    const universe = 5864;
    const fresh = 37;        // scan.fresh
    const materialized = 200; // scan.uniqueSymbols
    const report = {
      status: "complete",
      markets: [marketRow({ market: "US", inventoryCandidates: universe, scanFresh: fresh, scanUnique: materialized })],
    };
    const html = renderToStaticMarkup(React.createElement(renderGlobalCoverageView, { report, loading: false, error: "" }));

    // "Frescos" debe contener EXACTAMENTE scan.fresh (no uniqueSymbols).
    const freshBlock = html.match(/data-metric="fresh"[^]*?<\/b>/);
    expect(freshBlock).toBeTruthy();
    expect(freshBlock[0]).toContain(fmt(fresh));
    expect(freshBlock[0]).not.toContain(fmt(materialized));

    // "Materializados" es un bloque distinto con scan.uniqueSymbols.
    const materializedBlock = html.match(/data-metric="materialized"[^]*?<\/b>/);
    expect(materializedBlock).toBeTruthy();
    expect(materializedBlock[0]).toContain(fmt(materialized));
    expect(materializedBlock[0]).not.toContain(fmt(fresh));

    // Los bloques son distintos entre sí (no comparten número).
    expect(freshBlock[0]).not.toEqual(materializedBlock[0]);

    // El universo es otro bloque distinto.
    const universeBlock = html.match(/data-metric="universe"[^]*?<\/b>/);
    expect(universeBlock[0]).toContain(fmt(universe));
    expect(universeBlock[0]).not.toContain(fmt(fresh));

    // Las etiquetas textuales están separadas.
    const text = visibleText(html);
    expect(text).toContain("Frescos");
    expect(text).toContain("Materializados");
    expect(text).toContain("Universo");
    expect(text).toContain("con precio reciente");
    expect(text).toContain("filas recientes");
  });

  it("7. la etiqueta de elegibles no afirma publicación ni ranking global comparable", () => {
    const eligible = 210;
    const report = {
      status: "complete",
      markets: [marketRow({ market: "US", scanRankingEligible: eligible })],
    };
    const html = renderToStaticMarkup(React.createElement(renderGlobalCoverageView, { report, loading: false, error: "" }));
    const text = visibleText(html);

    // La etiqueta se llama "Elegibles por calidad", no "Elegibles para ranking".
    expect(text).toContain("Elegibles por calidad");
    expect(text).not.toContain("Elegibles para ranking");

    // El valor aparece bajo su bloque.
    const eligibleBlock = html.match(/data-metric="eligible"[^]*?<\/b>/);
    expect(eligibleBlock).toBeTruthy();
    expect(eligibleBlock[0]).toContain(fmt(eligible));

    // La ayuda contextual aclara que cumplen controles técnicos, no que están
    // publicados ni que son comparables globalmente.
    expect(text).toContain("cumplen los controles técnicos");
    // La leyenda deja claro que la publicación/comparabilidad global es posterior.
    expect(text).toContain("publicación y comparabilidad global dependen de una fase posterior");
    // La leyenda mantiene que universo ≠ ranking comparable.
    expect(text).toContain("Universo disponible ≠ ranking comparable");

    // No afirma publicación realizada ni comparabilidad ya alcanzada.
    expect(text.toLowerCase()).not.toContain("publicados en leaderboards");
    expect(text.toLowerCase()).not.toContain("comparables globalmente ya");
  });

  it("8. degradea honestamente a — cuando scan.fresh falta (no usa uniqueSymbols)", () => {
    // fresh ausente; uniqueSymbols presente. El panel debe mostrar "—" en Frescos,
    // NO sustituirlo silenciosamente por el valor de materializados.
    const report = {
      status: "complete",
      markets: [{
        market: "JP",
        region: "Japan",
        grade: "util",
        coveragePct: 70,
        inventory: { candidates: 1500, coveragePct: 70, grade: "util", gap: 0 },
        scan: { uniqueSymbols: 300, qualityOk: 90, rankingEligible: 90, actionable: 90, grade: "util" },
        readiness: { state: "operational", label: "Cobertura operativa", detail: "ok", tone: "pass", blocksCoverageClaim: false },
      }],
    };
    const html = renderToStaticMarkup(React.createElement(renderGlobalCoverageView, { report, loading: false, error: "" }));
    const freshBlock = html.match(/data-metric="fresh"[^]*?<\/b>/)[0];
    expect(freshBlock).toContain("—");
    // No contiene el número de materializados en el bloque de frescos.
    expect(freshBlock).not.toContain(fmt(300));

    // Materializados sí muestra 300.
    const materializedBlock = html.match(/data-metric="materialized"[^]*?<\/b>/)[0];
    expect(materializedBlock).toContain(fmt(300));
  });
});
