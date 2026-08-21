// tests/descriptiveStrip.test.js — la franja descriptiva de la ficha.
//
// Dos frentes: (1) los cálculos nuevos de lib/descriptiveStrip.js, que son
// los únicos números que la franja produce por su cuenta; (2) el render de
// ausencias — todo campo que la auditoría de 2026-08-21 declaró no fiable
// (base, RS de sector, RS de país, rango de sector) debe salir como ausencia
// con motivo, nunca como número ni como cero (principio 3).

import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import DescriptiveStrip from "@/app/stock/[symbol]/DescriptiveStrip";
import {
  DESCRIPTIVE_ABSENCE,
  lowAdvance52wFromBars,
  quarterLabel,
  quarterlyGrowthCells,
  rsWeeklyDelta,
  slopeWord,
  volumeDryUpDisplay,
} from "@/lib/descriptiveStrip";

function dailyBars(count, { startPrice = 100, minLow = 60 } = {}) {
  const bars = [];
  const start = new Date("2024-01-01T00:00:00Z");
  for (let i = 0; i < count; i += 1) {
    const date = new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10);
    // El mínimo absoluto queda a mitad de la serie; el precio final es startPrice.
    const low = i === Math.floor(count / 2) ? minLow : startPrice - 5;
    bars.push({ date, close: startPrice, high: startPrice + 2, low, volume: 1000 });
  }
  return bars;
}

describe("lowAdvance52wFromBars", () => {
  it("calcula el avance sobre el mínimo de las últimas 252 sesiones", () => {
    const bars = dailyBars(300, { startPrice: 120, minLow: 60 });
    // El mínimo (60) cae en la sesión 150, dentro de las últimas 252.
    expect(lowAdvance52wFromBars(bars)).toBeCloseTo(100, 5);
  });

  it("con menos de 252 sesiones no afirma un mínimo de 52 semanas", () => {
    expect(lowAdvance52wFromBars(dailyBars(200))).toBeNull();
    expect(lowAdvance52wFromBars([])).toBeNull();
    expect(lowAdvance52wFromBars(null)).toBeNull();
  });

  it("ignora el orden de llegada de las barras", () => {
    const bars = dailyBars(300, { startPrice: 120, minLow: 60 });
    expect(lowAdvance52wFromBars([...bars].reverse())).toBeCloseTo(100, 5);
  });
});

describe("rsWeeklyDelta", () => {
  const weekly = (date, rsRating) => ({ date, rsRating });
  const series = [];
  for (let i = 0; i < 20; i += 1) {
    const date = new Date(new Date("2026-03-01T00:00:00Z").getTime() + i * 7 * 86400000)
      .toISOString().slice(0, 10);
    series.push(weekly(date, 40 + i * 3));
  }

  it("encuentra el valor de partida 13 semanas atrás", () => {
    const delta = rsWeeklyDelta(series, 13);
    expect(delta.current).toBe(97);
    // 13 semanas antes del último punto (índice 19 → índice 6): 40 + 18 = 58.
    expect(delta.from).toBe(58);
  });

  it("tolera huecos en la serie buscando por fecha, no por índice", () => {
    const withGap = series.filter((_, index) => index !== 6);
    const delta = rsWeeklyDelta(withGap, 13);
    // Sin el punto exacto usa el vecino a ±1 semana (índice 5 o 7).
    expect([55, 61]).toContain(delta.from);
  });

  it("sin punto dentro de la tolerancia no inventa el desde", () => {
    const sparse = [series[0], series.at(-1)];
    const delta = rsWeeklyDelta(sparse, 13);
    expect(delta.current).toBe(97);
    expect(delta.from).toBeNull();
  });

  it("serie vacía: sin actual y sin desde", () => {
    expect(rsWeeklyDelta([], 13)).toMatchObject({ current: null, from: null });
  });
});

describe("slopeWord", () => {
  it("usa la misma banda muerta que la clasificación de etapa", () => {
    expect(slopeWord(8)).toBe("ascendente");
    expect(slopeWord(-8)).toBe("descendente");
    expect(slopeWord(1.9)).toBe("plana");
    expect(slopeWord(-1.9)).toBe("plana");
    expect(slopeWord(2)).toBe("plana");
    expect(slopeWord(null)).toBe("");
  });
});

describe("volumeDryUpDisplay", () => {
  it("marca secado en el mismo umbral que la evidencia metodológica (0,85)", () => {
    expect(volumeDryUpDisplay(0.58)).toMatchObject({ dried: true, word: "secado" });
    expect(volumeDryUpDisplay(0.58).pct).toBeCloseTo(-42, 5);
    expect(volumeDryUpDisplay(0.85).dried).toBe(true);
    expect(volumeDryUpDisplay(1.04)).toMatchObject({ dried: false, word: "sin secado" });
  });

  it("sin ratio no hay porcentaje ni etiqueta", () => {
    expect(volumeDryUpDisplay(null)).toMatchObject({ pct: null, word: "" });
    expect(volumeDryUpDisplay(-1)).toMatchObject({ pct: null, word: "" });
  });
});

describe("quarterlyGrowthCells", () => {
  const q = (date, extra = {}) => ({ date, ...extra });

  it("el YoY del proveedor manda y el fallback compara con el mismo trimestre del año anterior", () => {
    const results = {
      incomeQuarterly: [
        q("2026-06-30", { revenue: 110, revenueGrowthYoY: 12.5 }),
        q("2026-03-31", { revenue: 105 }),
        q("2025-12-31", { revenue: 104 }),
        q("2025-09-30", { revenue: 103 }),
        q("2025-06-30", { revenue: 100 }),
        q("2025-03-31", { revenue: 84 }),
      ],
    };
    const { cells } = quarterlyGrowthCells(results);
    // Orden: del más antiguo al más reciente.
    expect(cells.at(-1).date).toBe("2026-06-30");
    expect(cells.at(-1).revenueYoY).toBe(12.5);
    // 2026-03-31 sin YoY del proveedor: 105 vs 84 (índice + 4) = +25%.
    expect(cells.at(-2).revenueYoY).toBeCloseTo(25, 5);
    // Trimestres sin comparable del año anterior: ausentes, no cero.
    expect(cells[0].revenueYoY).toBeNull();
  });

  it("no calcula YoY sobre base negativa o nula", () => {
    const results = {
      incomeQuarterly: [
        q("2026-06-30", { eps: 1.04 }),
        q("2026-03-31", { eps: 2.9 }),
        q("2025-12-31", { eps: 1.1 }),
        q("2025-09-30", { eps: 0.8 }),
        q("2025-06-30", { eps: -6.31 }),
      ],
    };
    const { cells } = quarterlyGrowthCells(results);
    // 1,04 frente a −6,31: variación interanual indefinida → ausencia.
    expect(cells.at(-1).epsYoY).toBeNull();
  });

  it("deriva el BPA de beneficio neto y acciones cuando el proveedor no lo trae", () => {
    const results = {
      incomeQuarterly: [
        q("2026-06-30", { netIncome: 220 }),
        q("2026-03-31", {}),
        q("2025-12-31", {}),
        q("2025-09-30", {}),
        q("2025-06-30", { netIncome: 200 }),
      ],
    };
    const { cells } = quarterlyGrowthCells(results, { sharesOutstanding: 100 });
    expect(cells.at(-1).epsYoY).toBeCloseTo(10, 5);
    expect(cells.at(-1).epsDerived).toBe(true);
  });

  it("con menos de dos trimestres con dato la serie no es utilizable", () => {
    expect(quarterlyGrowthCells({}).usable).toBe(false);
    expect(quarterlyGrowthCells({ incomeQuarterly: [q("2026-06-30", { revenueGrowthYoY: 5 })] }).usable).toBe(false);
  });

  it("etiqueta compacta de trimestre", () => {
    expect(quarterLabel("2026-06-30")).toBe("2T26");
    expect(quarterLabel("2025-12-31")).toBe("4T25");
    expect(quarterLabel("")).toBe("");
  });
});

// ── Render de la franja ───────────────────────────────────────────────────

function stripMarkup(data, extra = {}) {
  return renderToStaticMarkup(createElement(DescriptiveStrip, {
    symbol: "AGL",
    data,
    rsUniverse: extra.rsUniverse ?? null,
    freshness: extra.freshness ?? {},
    setupPattern: extra.setupPattern ?? null,
  }));
}

const fullData = {
  name: "agilon health, inc.",
  exchange: "NYSE",
  sector: "Healthcare",
  theme: "Medtech / biotech",
  industry: "Health Information Services",
  summary: "Provides healthcare services for seniors.",
  chartProvider: "Yahoo Finance",
  chartBars: dailyBars(300, { startPrice: 92, minLow: 46 }),
  stage: {
    label: "Etapa 2 confirmada",
    weekly: {
      state: "stage2",
      confirmation: "confirmed",
      label: "Etapa 2 confirmada",
      weekInStage: 14,
      slowMaSlopePct: 90.8,
      distanceSlowMaPct: 52.4,
      flatPct: 2,
    },
  },
  relativeStrength: {
    distance52w: -30.3,
    globalRsSeries: [
      { date: "2026-05-10", rsRating: 74, sampleSize: 4868 },
      { date: "2026-08-09", rsRating: 99, sampleSize: 4868 },
    ],
  },
  financialResults: {
    source: "SEC EDGAR companyfacts",
    incomeQuarterly: [
      { date: "2026-06-30", revenue: 110, revenueGrowthYoY: 12.5 },
      { date: "2026-03-31", revenue: 105, revenueGrowthYoY: 8 },
    ],
  },
  setupPattern: { volumeDryUpRatio: 0.58 },
};

describe("DescriptiveStrip · render", () => {
  it("pinta etapa con semana, RS con muestra, estructura y volumen", () => {
    const html = stripMarkup(fullData, { rsUniverse: 99, freshness: { priceDate: "2026-08-20" } });
    expect(html).toContain("semana 14");
    expect(html).toContain("Etapa 2");
    // es-ES no agrupa los números de cuatro cifras: n=4868, sin punto.
    expect(html).toContain("n=4868");
    // El punto de 2026-05-10 está exactamente 13 semanas antes del último:
    // el valor de partida se afirma.
    expect(html).toContain("desde 74");
    expect(html).toContain("secado");
    expect(html).toContain("ascendente");
    expect(html).toContain("Volumen 10d/50d");
  });

  it("las ausencias estructurales llevan su motivo: base, RS sector, RS país y rango", () => {
    const html = stripMarkup(fullData, { rsUniverse: 99 });
    expect(html).toContain(DESCRIPTIVE_ABSENCE.base.slice(0, 40));
    expect(html).toContain(DESCRIPTIVE_ABSENCE.rsSector.slice(0, 40));
    expect(html).toContain(DESCRIPTIVE_ABSENCE.rsCountry.slice(0, 40));
    expect(html).toContain(DESCRIPTIVE_ABSENCE.sectorRank.slice(0, 40));
  });

  it("el pie declara el proveedor real de datos, nunca uno no contratado", () => {
    const html = stripMarkup(fullData, { rsUniverse: 99, freshness: { priceDate: "2026-08-20" } });
    expect(html).toContain("Gráfico TradingView");
    expect(html).toContain("Datos Yahoo Finance");
    expect(html).not.toMatch(/Twelve ?Data/i);
  });

  it("sin RS semanal, sin etapa y sin trimestres: ausencias con motivo, nunca ceros", () => {
    const html = stripMarkup({
      name: "Valor sin datos",
      chartBars: dailyBars(100),
      stage: { weekly: { state: "insufficient_history", detail: "Requiere al menos 40 semanas." } },
      relativeStrength: {},
      financialResults: {},
    });
    expect(html).toContain(DESCRIPTIVE_ABSENCE.rs.slice(0, 30));
    expect(html).toContain(DESCRIPTIVE_ABSENCE.quarters.slice(0, 30));
    expect(html).toContain(DESCRIPTIVE_ABSENCE.lowAdvance.slice(0, 30));
    // "semanas" aparece dentro de los motivos de ausencia; lo que no puede
    // aparecer es la semana de etapa afirmada ("semana N").
    expect(html).not.toMatch(/semana \d/);
    // Nada de "0" como relleno de RS o de estructura.
    expect(html).not.toMatch(/>0</);
  });

  it("con el RS presente pero sin serie histórica no se afirma el valor de partida", () => {
    const html = stripMarkup({ ...fullData, relativeStrength: { distance52w: -30.3, globalRsSeries: [] } }, { rsUniverse: 99 });
    expect(html).not.toContain("desde");
    expect(html).toContain(">99<");
  });
});
