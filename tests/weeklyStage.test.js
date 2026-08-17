// tests/weeklyStage.test.js — la etapa de Weinstein con el criterio estricto.
//
// Fija lo que docs/diseno-salud-y-cambio-2026-08-16.md (D.14, D.15) define y
// lo que docs/auditoria-etapas-2026-08-16.md encontró roto:
//   - las cuatro etapas existen (antes solo stage2/stage4 + dos categorías
//     que no son etapas y se llevaban el 42,5% del universo),
//   - la media de 10 semanas NO decide la etapa,
//   - una media plana no se clasifica por el signo del ruido,
//   - etapa 1 y 3 se distinguen por lo que hacía la media ANTES de aplanarse,
//   - confirmada frente a tentativa = quién cambió primero, precio o media.

import { describe, expect, it } from "vitest";
import { DEFAULT_WEEKLY_STAGE_SETTINGS, weeklyStageForBars } from "@/lib/weeklyStage";
import { stage2RejectDetail, trendTemplateIssue } from "@/lib/trendStructure";

// Construye barras SEMANALES (una por semana) a partir de una lista de
// cierres en orden cronológico. weeklyBarsFromDaily agrupa por semana ISO, así
// que una barra por semana entra tal cual.
function barsFromCloses(closes = []) {
  const start = Date.UTC(2024, 0, 1); // lunes
  return closes.map((close, index) => ({
    date: new Date(start + index * 7 * 86400000).toISOString().slice(0, 10),
    open: close,
    high: close,
    low: close,
    close,
    volume: 1_000_000,
  }));
}

// Serie de 90 semanas: `fn(i)` da el cierre de la semana i (0 = la más
// antigua). weeklyStageForBars ordena por fecha, así que basta con pasarlas
// en orden cronológico.
function series(fn, weeks = 90) {
  return barsFromCloses(Array.from({ length: weeks }, (_, i) => fn(i)));
}

describe("weeklyStage · criterio estricto", () => {
  it("etapa 2: precio sobre la media de 30 semanas y media ascendente", () => {
    const stage = weeklyStageForBars(series((i) => 50 + i));
    expect(stage.state).toBe("stage2");
    expect(stage.confirmation).toBe("confirmed");
    expect(stage.priceAboveSlowMa).toBe(true);
    expect(stage.slowMaSlopePct).toBeGreaterThan(DEFAULT_WEEKLY_STAGE_SETTINGS.flatPct);
  });

  it("etapa 4: precio bajo la media de 30 semanas y media descendente", () => {
    const stage = weeklyStageForBars(series((i) => 200 - i));
    expect(stage.state).toBe("stage4");
    expect(stage.confirmation).toBe("confirmed");
    expect(stage.priceAboveSlowMa).toBe(false);
    expect(stage.slowMaSlopePct).toBeLessThan(-DEFAULT_WEEKLY_STAGE_SETTINGS.flatPct);
  });

  it("etapa 1 confirmada: media plana DESPUÉS de una caída", () => {
    // 45 semanas cayendo, luego 45 planas.
    const stage = weeklyStageForBars(series((i) => (i < 45 ? 200 - i * 2 : 110)));
    expect(stage.state).toBe("stage1");
    expect(stage.confirmation).toBe("confirmed");
    expect(Math.abs(stage.slowMaSlopePct)).toBeLessThanOrEqual(DEFAULT_WEEKLY_STAGE_SETTINGS.flatPct);
    expect(stage.slowMaPriorSlopePct).toBeLessThan(0);
  });

  it("etapa 3 confirmada: media plana DESPUÉS de una subida", () => {
    // 45 semanas subiendo, luego 45 planas. Misma forma que la etapa 1, con
    // el contexto previo invertido: es lo único que las separa.
    const stage = weeklyStageForBars(series((i) => (i < 45 ? 50 + i * 2 : 140)));
    expect(stage.state).toBe("stage3");
    expect(stage.confirmation).toBe("confirmed");
    expect(Math.abs(stage.slowMaSlopePct)).toBeLessThanOrEqual(DEFAULT_WEEKLY_STAGE_SETTINGS.flatPct);
    expect(stage.slowMaPriorSlopePct).toBeGreaterThan(0);
  });

  it("etapa 3 tentativa: el precio pierde la media, pero la media aún sube", () => {
    // Subida larga y desplome en las últimas 6 semanas: el precio cae por
    // debajo de la media de 30 semanas antes de que la media reaccione.
    const stage = weeklyStageForBars(series((i) => (i < 84 ? 50 + i * 2 : 150)));
    expect(stage.state).toBe("stage3");
    expect(stage.confirmation).toBe("tentative");
    expect(stage.priceAboveSlowMa).toBe(false);
    expect(stage.slowMaSlopePct).toBeGreaterThan(DEFAULT_WEEKLY_STAGE_SETTINGS.flatPct);
  });

  it("etapa 1 tentativa: el precio recupera la media, pero la media aún cae", () => {
    const stage = weeklyStageForBars(series((i) => (i < 84 ? 200 - i * 2 : 90)));
    expect(stage.state).toBe("stage1");
    expect(stage.confirmation).toBe("tentative");
    expect(stage.priceAboveSlowMa).toBe(true);
    expect(stage.slowMaSlopePct).toBeLessThan(-DEFAULT_WEEKLY_STAGE_SETTINGS.flatPct);
  });

  it("la media de 10 semanas NO decide la etapa", () => {
    // Subida sostenida con un retroceso final que deja el precio por debajo
    // de su media de 10 semanas pero muy por encima de la de 30. Con el
    // criterio anterior esto era "Base"; es etapa 2.
    const stage = weeklyStageForBars(series((i) => (i < 84 ? 50 + i * 2 : 200)));
    expect(stage.priceAboveSlowMa).toBe(true);
    expect(stage.weeklyPrice).toBeLessThan(stage.fastMa);
    expect(stage.state).toBe("stage2");
  });

  it("una media plana no se clasifica por el signo del ruido", () => {
    // Media prácticamente horizontal con un sesgo mínimo: sin banda muerta
    // caería en etapa 2 o 4 según el signo. Con banda muerta es etapa 1 o 3.
    const stage = weeklyStageForBars(series((i) => (i < 45 ? 200 - i * 2 : 110 + i * 0.01)));
    expect(Math.abs(stage.slowMaSlopePct)).toBeLessThanOrEqual(DEFAULT_WEEKLY_STAGE_SETTINGS.flatPct);
    expect(["stage1", "stage3"]).toContain(stage.state);
  });

  it("sin contexto previo: media plana y menos de 60 semanas de histórico", () => {
    const stage = weeklyStageForBars(series(() => 100, 45));
    expect(stage.confirmation).toBe("unknown_context");
    expect(stage.slowMaPriorSlopePct).toBe(null);
    expect(["stage1", "stage3"]).toContain(stage.state);
  });

  it("sin histórico suficiente para la media de 30 semanas: no clasifica", () => {
    const stage = weeklyStageForBars(series((i) => 50 + i, 20));
    expect(stage.state).toBe("insufficient_history");
  });

  it("el umbral de media plana es configurable", () => {
    // Pendiente pequeña pero no nula: con banda muerta 0 es una tendencia
    // (etapa 2 o 4); con banda muerta amplia es una media plana (etapa 1 o 3).
    const bars = series((i) => (i < 45 ? 200 - i * 2 : 110 + i * 0.3));
    const estrecho = weeklyStageForBars(bars, { stageFlatPct: 0 });
    const ancho = weeklyStageForBars(bars, { stageFlatPct: 10 });
    expect(["stage2", "stage4"]).toContain(estrecho.state);
    expect(["stage1", "stage3"]).toContain(ancho.state);
    expect(ancho.flatPct).toBe(10);
  });
});

describe("stage2RejectDetail · el filtro comprueba LA ETAPA", () => {
  it("acepta la etapa 2 aunque la estructura diaria no acompañe", () => {
    // El caso que la auditoría midió al revés: 182 filas en etapa 2 quedaban
    // fuera del filtro por una condición diaria que no es de la metodología.
    const row = {
      weeklyStageState: "stage2",
      weeklyStageLabel: "Etapa 2 confirmada",
      price: 100, sma50: 105, sma150: 95, sma200: 90, sma200Slope: 3,
    };
    expect(stage2RejectDetail(row)).toBe("");
    // …y esa misma estructura diaria sí la rechaza el filtro que la mide.
    expect(trendTemplateIssue(row)).toBe("Precio bajo SMA50 diaria");
  });

  it("rechaza lo que no está en etapa 2, aunque la estructura diaria sea perfecta", () => {
    // El otro lado: 53 filas pasaban sin llevar la etiqueta "Etapa 2".
    const row = {
      weeklyStageState: "stage3",
      weeklyStageLabel: "Etapa 3 confirmada",
      price: 120, sma50: 110, sma150: 100, sma200: 90, sma200Slope: 5,
    };
    expect(stage2RejectDetail(row)).toContain("No está en etapa 2");
    expect(trendTemplateIssue(row)).toBe("");
  });

  it("declara la ausencia en vez de clasificar sin etapa", () => {
    expect(stage2RejectDetail({ price: 120, sma50: 110, sma150: 100, sma200: 90, sma200Slope: 5 }))
      .toContain("Sin etapa semanal");
    expect(stage2RejectDetail({ weeklyStageState: "insufficient_history" }))
      .toContain("Histórico semanal insuficiente");
  });
});
