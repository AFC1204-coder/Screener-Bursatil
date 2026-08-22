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
import ChartIdentityCard from "@/app/stock/[symbol]/ChartIdentityCard";
import DescriptiveStrip from "@/app/stock/[symbol]/DescriptiveStrip";
import { buildChartIdentityCard } from "@/lib/chartIdentityCard";
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

// ── Render: franja + tarjeta 2c ───────────────────────────────────────────
//
// Desde el 2026-08-21 por la tarde el contenido está repartido: la tarjeta
// 2c del lienzo (ChartIdentityCard, modelo en lib/chartIdentityCard.js)
// lleva etapa, RS, Máx/mín/Base, crecimiento y pie; la franja conserva el
// resumen, la industria y la banda de medias y volumen. Los tests de render
// siguen ese reparto — nada se aserta en las dos superficies a la vez.

function stripMarkup(data, extra = {}) {
  return renderToStaticMarkup(createElement(DescriptiveStrip, {
    data,
    setupPattern: extra.setupPattern ?? data?.setupPattern ?? null,
    technical: extra.technical ?? null,
    stockVolume: extra.stockVolume ?? null,
  }));
}

function cardMarkup(data, extra = {}) {
  const card = buildChartIdentityCard({
    symbol: "AGL",
    data,
    rsUniverse: extra.rsUniverse ?? null,
  });
  return renderToStaticMarkup(createElement(ChartIdentityCard, { card }));
}

const fullData = {
  name: "agilon health, inc.",
  exchange: "NYSE",
  sector: "Healthcare",
  theme: "Medtech / biotech",
  industry: "Health Information Services",
  summary: "Provides healthcare services for seniors.",
  marketCap: 12000000000,
  currency: "USD",
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

describe("ChartIdentityCard · render (tarjeta 2c densa sobre el lienzo)", () => {
  it("pinta identidad, resumen, tema·cap, raíl con semana, RS con desde, estructura, crecimiento y pie", () => {
    const html = cardMarkup(fullData, { rsUniverse: 99 });
    expect(html).toContain("agilon health, inc.");
    expect(html).toContain("· NYSE");
    expect(html).toContain("Provides healthcare services");
    expect(html).toContain("Medtech / biotech");
    expect(html).toContain("12,0B");
    expect(html).toContain("sem. 14");
    expect(html).toContain("chartIdCardStageRail");
    // El punto de 2026-05-10 está exactamente 13 semanas antes del último:
    // el valor de partida se afirma.
    expect(html).toContain("desde 74");
    expect(html).toContain(">99<");
    expect(html).toContain("Máx. 52s");
    expect(html).toContain("-30,3%");
    expect(html).toContain("Crecimiento trimestral");
    expect(html).toContain("2T26");
    // El pie declara el proveedor real de datos, nunca uno no contratado.
    expect(html).toContain("Gráfico TradingView");
    expect(html).toContain("Datos Yahoo Finance");
    expect(html).not.toMatch(/Twelve ?Data/i);
  });

  it("las ausencias estructurales llevan su motivo: base y rango de sector", () => {
    // El RS de sector y el de país ya no tienen superficie: 2c mostraba
    // país + global y, con un universo de un solo país, se muestra uno
    // (encargo 2026-08-21, punto 6). Sus motivos siguen en
    // DESCRIPTIVE_ABSENCE por si algún día vuelven a tener hueco.
    const html = cardMarkup(fullData, { rsUniverse: 99 });
    expect(html).toContain(DESCRIPTIVE_ABSENCE.base.slice(0, 40));
    expect(html).toContain(DESCRIPTIVE_ABSENCE.sectorRank.slice(0, 40));
  });

  it("sin RS semanal, etapa, mínimo, trimestres ni cap: ausencias con motivo, nunca ceros", () => {
    const html = cardMarkup({
      name: "Valor sin datos",
      chartBars: dailyBars(100),
      stage: { weekly: { state: "insufficient_history", detail: "Requiere al menos 40 semanas." } },
      relativeStrength: {},
      financialResults: {},
    });
    expect(html).toContain(DESCRIPTIVE_ABSENCE.rs.slice(0, 30));
    expect(html).toContain(DESCRIPTIVE_ABSENCE.lowAdvance.slice(0, 30));
    expect(html).toContain(DESCRIPTIVE_ABSENCE.quarters.slice(0, 30));
    expect(html).toContain("Sin capitalización de mercado");
    expect(html).toContain("Sin descripción de negocio");
    // "semanas" aparece dentro de los motivos de ausencia; lo que no puede
    // aparecer es la semana de etapa afirmada ("sem. N").
    expect(html).not.toMatch(/sem\. \d/);
    // Nada de "0" como relleno de RS o de estructura.
    expect(html).not.toMatch(/>0</);
  });

  it("con el RS presente pero sin serie histórica no se afirma el valor de partida", () => {
    const html = cardMarkup({ ...fullData, relativeStrength: { distance52w: -30.3, globalRsSeries: [] } }, { rsUniverse: 99 });
    expect(html).not.toContain("desde");
    expect(html).toContain(">99<");
  });
});

describe("DescriptiveStrip · render (la franja tras el reparto denso)", () => {
  it("pinta la banda de medias y volumen — lo único que conserva", () => {
    const html = stripMarkup(fullData, {
      technical: { distanceSma50: 12.4, distanceSma200: 31.5 },
      stockVolume: {
        upDownVolumeRatio: { available: true, value: 1.25, window: "50" },
        volumeSurge: { available: true, value: -4.1, window: "5 vs 20" },
      },
    });
    expect(html).toContain("ascendente");
    expect(html).toContain("Volumen 10d/50d");
    expect(html).toContain("secado");
    expect(html).toContain("Media 50d");
    expect(html).toContain("Media 200d");
    expect(html).toContain("Reparto vol. 50d");
    expect(html).toContain("Impulso vol. 5/20d");
  });

  it("no repite nada de la tarjeta densa: sin identidad, resumen, clasificación, FR, estructura, crecimiento ni pie", () => {
    const html = stripMarkup(fullData, { technical: { distanceSma50: 12.4, distanceSma200: 31.5 } });
    expect(html).not.toContain("Provides healthcare services");
    expect(html).not.toContain("Medtech / biotech");
    expect(html).not.toContain("Etapa");
    expect(html).not.toContain("Fuerza relativa");
    expect(html).not.toContain("Máx. 52s");
    expect(html).not.toContain("Sobre mín.");
    expect(html).not.toContain('stockDescStructLabel">Base<');
    expect(html).not.toContain("Crecimiento trimestral");
    expect(html).not.toContain("StatsEdge");
    expect(html).not.toContain("rango");
  });
});
