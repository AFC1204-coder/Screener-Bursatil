// Verificación REAL de StageStrip, el sustituto de la constelación.
//
// Renderiza el JSX real con renderToStaticMarkup y comprueba el DOM
// resultante. Los dos defectos que retiraron la constelación quedan aquí como
// candados: (1) el caso NORMAL — todos los índices en la misma etapa — debe
// producir una lista legible, no una superposición; (2) la franja se decide
// por `stageState` canónico, nunca buscando dígitos en un texto («Bajo MM30s»
// caía en la zona de techo por el 3 de «MM30s», auditoría C-19).

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import StageStrip, {
  STAGE_ZONES,
  dominantStageState,
  regimeTone,
  universeByStage,
  STRIP_CURVE,
} from "@/app/market-health/StageStrip";

// El caso normal real (medido 2026-08-17 sobre daily_bars con
// lib/weeklyStage.js): los cinco ETF en etapa 2 confirmada.
const ALL_STAGE2 = [
  { symbol: "SPY", weight: 30, stageState: "stage2", stageConfirmation: "confirmed", stage30w: "Etapa 2 confirmada", distanceSma30w: 8.96, stageWeeks: 13 },
  { symbol: "QQQ", weight: 30, stageState: "stage2", stageConfirmation: "confirmed", stage30w: "Etapa 2 confirmada", distanceSma30w: 10.32, stageWeeks: 15 },
  { symbol: "IWM", weight: 20, stageState: "stage2", stageConfirmation: "confirmed", stage30w: "Etapa 2 confirmada", distanceSma30w: 10.64, stageWeeks: 20 },
  { symbol: "DIA", weight: 10, stageState: "stage2", stageConfirmation: "confirmed", stage30w: "Etapa 2 confirmada", distanceSma30w: 7.75, stageWeeks: 12 },
  { symbol: "ACWI", weight: 10, stageState: "stage2", stageConfirmation: "confirmed", stage30w: "Etapa 2 confirmada", distanceSma30w: 8.27, stageWeeks: 19 },
];

const SPREAD = [
  { symbol: "SPY", weight: 30, stageState: "stage2", stageConfirmation: "confirmed", stage30w: "Etapa 2 confirmada", distanceSma30w: 5.2 },
  { symbol: "QQQ", weight: 30, stageState: "stage3", stageConfirmation: "tentative", stage30w: "Etapa 3 tentativa", distanceSma30w: -1.1 },
  { symbol: "IWM", weight: 20, stageState: "stage1", stageConfirmation: "confirmed", stage30w: "Etapa 1 confirmada", distanceSma30w: 0.4 },
  { symbol: "DIA", weight: 10, stageState: "stage4", stageConfirmation: "confirmed", stage30w: "Etapa 4 confirmada", distanceSma30w: -6.3 },
  { symbol: "ACWI", weight: 10, stageState: null, stage30w: "Historico semanal insuficiente", distanceSma30w: null },
];

// Corta el HTML en bloques por franja: { stage1: "<div …>…</div>", … }
function zoneBlocks(html) {
  const out = {};
  for (const zone of STAGE_ZONES) {
    const start = html.indexOf(`data-zone="${zone.state}"`);
    expect(start).toBeGreaterThan(-1);
    const rest = html.slice(start);
    const nextIdx = STAGE_ZONES
      .map((other) => (other.state === zone.state ? -1 : rest.indexOf(`data-zone="${other.state}"`)))
      .filter((idx) => idx > 0);
    out[zone.state] = nextIdx.length ? rest.slice(0, Math.min(...nextIdx)) : rest;
  }
  return out;
}

describe("market-health/StageStrip — render real", () => {
  it("caso normal (5 índices en etapa 2): los cinco tickers en la franja de etapa 2, una vez cada uno, legibles como texto", () => {
    const html = renderToStaticMarkup(
      React.createElement(StageStrip, { indexes: ALL_STAGE2, tone: "senal" }),
    );
    const zones = zoneBlocks(html);
    for (const symbol of ["SPY", "QQQ", "IWM", "DIA", "ACWI"]) {
      // Presente exactamente una vez en todo el HTML (nada superpuesto ni duplicado)…
      expect(html.split(`>${symbol}<`).length - 1).toBe(1);
      // …y esa única vez, dentro de la franja de etapa 2.
      expect(zones.stage2).toContain(`>${symbol}<`);
    }
    // Las otras tres franjas declaran que no tienen índices.
    for (const state of ["stage1", "stage3", "stage4"]) {
      expect(zones[state]).toContain("ninguno");
    }
    // La franja dominante es la 2 y el marcador del régimen está en su tramo.
    expect(zones.stage2).toContain('data-dominant="true"');
    expect(html).toContain(`cx="${STRIP_CURVE.centers.stage2[0]}"`);
    expect(html).toContain("stageStripMarker");
    expect(html).toContain('data-tone="senal"');
    // La distancia a la MM30s acompaña al ticker.
    expect(zones.stage2).toContain("+9,0%");
  });

  it("índices repartidos: cada chip cae en la franja de su stageState y la tentativa se declara", () => {
    const html = renderToStaticMarkup(
      React.createElement(StageStrip, { indexes: SPREAD, tone: "senal" }),
    );
    const zones = zoneBlocks(html);
    expect(zones.stage2).toContain(">SPY<");
    expect(zones.stage3).toContain(">QQQ<");
    expect(zones.stage1).toContain(">IWM<");
    expect(zones.stage4).toContain(">DIA<");
    // La confirmación tentativa se escribe junto al ticker.
    expect(zones.stage3).toContain("tentativa");
    // El índice sin etapa NO se coloca en ninguna franja: va a la nota.
    for (const state of Object.keys(zones)) {
      expect(zones[state]).not.toContain(">ACWI<");
    }
    expect(html).toContain("Sin etapa: ACWI");
  });

  it("payload antiguo (caché sin refresh): sin stageState, la etiqueta larga basta para colocar el índice", () => {
    // El caché escrito por el código anterior al 2026-08-17 solo trae
    // `stage30w` («Etapa 2 probable»). El estado se deriva con el diccionario
    // único (stageDisplay), el mismo que usan las filas viejas del screener.
    const stale = [
      { symbol: "SPY", weight: 30, stage30w: "Etapa 2 probable", distanceSma30w: 5.4 },
      { symbol: "QQQ", weight: 30, stage30w: "Etapa 2 probable", distanceSma30w: 9.5 },
      { symbol: "IWM", weight: 20, stage30w: "Etapa 4 probable", distanceSma30w: -8.2 },
    ];
    const html = renderToStaticMarkup(React.createElement(StageStrip, { indexes: stale, tone: "senal" }));
    const zones = zoneBlocks(html);
    expect(zones.stage2).toContain(">SPY<");
    expect(zones.stage2).toContain(">QQQ<");
    expect(zones.stage4).toContain(">IWM<");
    expect(html).not.toContain("Sin etapa:");
    expect(dominantStageState(stale)).toBe("stage2");
  });

  it("candado C-19: la franja sale del stageState, jamás de los dígitos del texto", () => {
    // Texto con un «3» dentro (el caso «Bajo MM30s») pero sin stageState:
    // no debe aparecer en la franja de techo — debe declararse sin etapa.
    const html = renderToStaticMarkup(
      React.createElement(StageStrip, {
        indexes: [{ symbol: "XXX", weight: 30, stageState: null, stage30w: "Bajo MM30s", distanceSma30w: -2 }],
        tone: "humo",
      }),
    );
    const zones = zoneBlocks(html);
    expect(zones.stage3).not.toContain(">XXX<");
    expect(html).toContain("Sin etapa: XXX (Bajo MM30s)");
  });

  it("degradado (proveedor caído): sin crash, cuatro franjas vacías y todos en la nota de sin etapa", () => {
    const degraded = ["SPY", "QQQ", "IWM", "DIA", "ACWI"].map((symbol) => ({
      symbol, weight: 10, stageState: null, stage30w: "Proveedor no disponible", distanceSma30w: null,
    }));
    const html = renderToStaticMarkup(React.createElement(StageStrip, { indexes: degraded, tone: "humo" }));
    const zones = zoneBlocks(html);
    for (const state of Object.keys(zones)) expect(zones[state]).toContain("ninguno");
    expect(html).toContain("Sin etapa:");
    // Sin marcador: no hay etapa dominante que marcar.
    expect(html).not.toContain("stageStripMarker");
  });

  it("universo por franja: se pinta solo cuando el escaneo ya clasifica con el criterio vigente", () => {
    const freshStages = {
      available: true,
      measured: 3000,
      buckets: [
        { key: "stage1", label: "Etapa 1", count: 600, pct: 20 },
        { key: "stage2", label: "Etapa 2", count: 1500, pct: 50 },
        { key: "stage3", label: "Etapa 3", count: 300, pct: 10 },
        { key: "stage4", label: "Etapa 4", count: 600, pct: 20 },
      ],
    };
    const html = renderToStaticMarkup(
      React.createElement(StageStrip, { indexes: ALL_STAGE2, stages: freshStages, tone: "senal" }),
    );
    const zones = zoneBlocks(html);
    expect(zones.stage2).toContain("universo");
    expect(zones.stage2).toContain("50%");
    expect(zones.stage1).toContain("20%");

    // Con filas de la taxonomía anterior, nada de porcentajes por franja:
    // una nota única con el motivo.
    const legacyStages = {
      available: true,
      measured: 3267,
      buckets: [
        { key: "stage2", label: "Etapa 2", count: 1207, pct: 36.9 },
        { key: "stage4", label: "Etapa 4", count: 655, pct: 20 },
        { key: "base", label: "Base / transición (criterio anterior)", count: 1032, pct: 31.6 },
        { key: "mixed", label: "Mixta / débil (criterio anterior)", count: 373, pct: 11.4 },
      ],
    };
    const htmlLegacy = renderToStaticMarkup(
      React.createElement(StageStrip, { indexes: ALL_STAGE2, stages: legacyStages, tone: "senal" }),
    );
    expect(htmlLegacy).not.toContain("universo 3");
    expect(htmlLegacy).toContain("criterio anterior");
  });
});

describe("dominantStageState / regimeTone / universeByStage — funciones puras", () => {
  it("la etapa dominante pondera por weight y devuelve null sin clasificados", () => {
    expect(dominantStageState(ALL_STAGE2)).toBe("stage2");
    expect(dominantStageState([])).toBe(null);
    expect(dominantStageState([{ symbol: "X", stageState: null }])).toBe(null);
    // Mayoría de peso en declive.
    const bearish = [
      { symbol: "A", weight: 60, stageState: "stage4" },
      { symbol: "B", weight: 40, stageState: "stage2" },
    ];
    expect(dominantStageState(bearish)).toBe("stage4");
  });

  it("regimeTone: avance con amplitud → señal; avance sin amplitud → humo; declive → óxido; vacío → humo", () => {
    const breadthWide = { indicators: [{ key: "above30w", pct: 68.5 }] };
    const breadthNarrow = { indicators: [{ key: "above30w", pct: 30 }] };
    expect(regimeTone(ALL_STAGE2, breadthWide)).toBe("senal");
    expect(regimeTone(ALL_STAGE2, null)).toBe("senal");
    expect(regimeTone(ALL_STAGE2, breadthNarrow)).toBe("humo");
    expect(regimeTone([{ symbol: "A", weight: 100, stageState: "stage4" }], breadthWide)).toBe("oxido");
    expect(regimeTone([], breadthWide)).toBe("humo");
    expect(regimeTone([{ symbol: "A", weight: 100, stageState: "stage1" }], breadthWide)).toBe("humo");
  });

  it("universeByStage: null sin cobertura; legacy si quedan base/mixed; byState si el escaneo es del criterio vigente", () => {
    expect(universeByStage(null)).toBe(null);
    expect(universeByStage({ available: false, buckets: [] })).toBe(null);
    const legacy = universeByStage({
      available: true,
      buckets: [
        { key: "stage2", count: 1207, pct: 36.9 },
        { key: "base", count: 1032, pct: 31.6 },
      ],
    });
    expect(legacy).toEqual({ legacy: true, legacyCount: 1032 });
    const fresh = universeByStage({
      available: true,
      buckets: [
        { key: "stage1", count: 600, pct: 20 },
        { key: "stage2", count: 1500, pct: 50 },
        { key: "base", count: 0, pct: 0 },
      ],
    });
    expect(fresh.legacy).toBe(false);
    expect(fresh.byState.stage2.count).toBe(1500);
    expect(fresh.byState.base).toBeUndefined();
  });
});
