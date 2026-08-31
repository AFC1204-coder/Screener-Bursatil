// tests/trendSupport.test.js — muletas de sostén de tendencia (MET-4b).

import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import DescriptiveStrip from "@/app/stock/[symbol]/DescriptiveStrip";
import { DESCRIPTIVE_ABSENCE } from "@/lib/descriptiveStrip";
import { scoreWeakness } from "@/lib/scoring";
import {
  ADVANCE_DEAD_BAND_PP,
  advanceAccelerationWord,
  advancePriorPct,
  buildTrendSupportLines,
  consecutiveWeeksRelativeToMa,
  formatWeeksCount,
  trendSupportFieldsFromBars,
  volumeSupportWord,
} from "@/lib/trendSupport";
import { weeklyStageForBars } from "@/lib/weeklyStage";

function dailyBarsFromWeeklyCloses(closes = [], start = "2024-01-01") {
  const bars = [];
  const origin = new Date(`${start}T00:00:00Z`);
  closes.forEach((close, index) => {
    const date = new Date(origin.getTime() + index * 7 * 86400000).toISOString().slice(0, 10);
    bars.push({ date, open: close, high: close + 1, low: close - 1, close, volume: 1_000_000 });
  });
  return bars.reverse();
}

function ascendingDailyBars(weeks = 90, startPrice = 50) {
  const closes = Array.from({ length: weeks }, (_, i) => startPrice + i);
  return dailyBarsFromWeeklyCloses(closes);
}

function dailySessionBars(count, { startPrice = 100, step = 0.5, volume = 1_000_000 } = {}) {
  const bars = [];
  const start = new Date("2024-01-01T00:00:00Z");
  for (let i = 0; i < count; i += 1) {
    const date = new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10);
    const close = startPrice + i * step;
    bars.push({ date, open: close, high: close + 1, low: close - 1, close, volume });
  }
  return bars.reverse();
}

describe("consecutiveWeeksRelativeToMa", () => {
  it("cuenta semanas consecutivas en el lado actual de la media", () => {
    const weeks = Array.from({ length: 20 }, (_, i) => ({
      date: `2026-${String(20 - i).padStart(2, "0")}-01`,
      close: 120 + (19 - i) * 2,
      high: 200,
      low: 90,
      volume: 1,
    }));
    const result = consecutiveWeeksRelativeToMa(weeks, 10);
    expect(result.above).toBe(true);
    expect(result.count).toBeGreaterThan(0);
  });

  it("el contador respeta el horizonte de la media", () => {
    const weeks = Array.from({ length: 25 }, (_, i) => ({
      date: `2026-${String(25 - i).padStart(2, "0")}-01`,
      close: 200,
      high: 210,
      low: 190,
      volume: 1,
    }));
    const result = consecutiveWeeksRelativeToMa(weeks, 10);
    expect(result.above).toBe(false);
    expect(result.count).toBe(16);
  });
});

describe("formatWeeksCount", () => {
  it("capa el reporte en 104 semanas", () => {
    expect(formatWeeksCount(150)).toBe("≥104");
    expect(formatWeeksCount(23)).toBe("23");
  });
});

describe("advancePriorPct", () => {
  it("deriva el tramo anterior a partir de perf3m y perf6m", () => {
    const recent = 6;
    const six = ((1 + 0.06) * (1 + 0.19) - 1) * 100;
    expect(advancePriorPct(recent, six)).toBeCloseTo(19, 5);
  });

  it("sin perf6m devuelve null", () => {
    expect(advancePriorPct(10, null)).toBeNull();
  });
});

describe("advanceAccelerationWord", () => {
  it("usa banda muerta de 5 pp", () => {
    expect(advanceAccelerationWord(12, 8, ADVANCE_DEAD_BAND_PP).word).toBe("mantiene");
    expect(advanceAccelerationWord(20, 8, ADVANCE_DEAD_BAND_PP).word).toBe("acelera");
    expect(advanceAccelerationWord(6, 19, ADVANCE_DEAD_BAND_PP).word).toBe("se frena");
  });
});

describe("volumeSupportWord", () => {
  it("reutiliza umbrales 1 / 1,25 de marketVolume", () => {
    expect(volumeSupportWord(1.4).word).toBe("acompaña");
    expect(volumeSupportWord(1.1).word).toBe("neutro");
    expect(volumeSupportWord(0.9).word).toBe("en contra");
    expect(volumeSupportWord(null).available).toBe(false);
  });
});

describe("trendSupportFieldsFromBars", () => {
  it("expone contadores y avances en filas de scan", () => {
    const bars = dailySessionBars(400, { startPrice: 80, step: 0.35 });
    const fields = trendSupportFieldsFromBars(bars);
    expect(typeof fields.weeksAboveSma30w === "number" || fields.weeksAboveSma30w === null).toBe(true);
    if (fields.weeksAboveSma30w !== null) {
      expect(fields.weeksAboveSma30w).toBeGreaterThan(0);
      expect(fields.weeksAboveSma30wAbove).toBe(true);
      expect(fields.weeksAboveSma10w).toBeGreaterThan(0);
    }
    expect(Number.isFinite(fields.advanceRecentPct)).toBe(true);
    expect(Number.isFinite(fields.advancePriorPct)).toBe(true);
  });
});

describe("buildTrendSupportLines", () => {
  it("declara ausencia de aceleración con histórico corto", () => {
    const bars = dailySessionBars(100);
    const block = buildTrendSupportLines(bars);
    const accel = block.lines.find((line) => line.key === "acceleration");
    expect(accel.available).toBe(false);
    expect(accel.reason).toBe(DESCRIPTIVE_ABSENCE.accelInsufficientHistory);
  });

  it("declara ausencia de volumen sin cobertura", () => {
    const bars = dailySessionBars(60, { volume: null });
    const block = buildTrendSupportLines(bars, { upDownVolRatio: null });
    const volume = block.lines.find((line) => line.key === "volume");
    expect(volume.available).toBe(false);
    expect(volume.reason).toBe(DESCRIPTIVE_ABSENCE.volumeCoverage);
  });

  it("declara ausencia de aceleración con salto discontinuo", () => {
    const bars = dailySessionBars(200);
    bars[50] = { ...bars[50], close: bars[51].close * 4 };
    const block = buildTrendSupportLines(bars);
    const accel = block.lines.find((line) => line.key === "acceleration");
    expect(accel.available).toBe(false);
    expect(accel.reason).toBe(DESCRIPTIVE_ABSENCE.accelDiscontinuous);
  });

  it("pinta las tres lecturas con datos suficientes", () => {
    const bars = dailySessionBars(400, { startPrice: 70, step: 0.4 });
    const block = buildTrendSupportLines(bars, { upDownVolRatio: 1.4, perf6m: 30, advanceRecentPct: 12, advancePriorPct: 6 });
    expect(block.title).toBe("Sostén de la tendencia");
    expect(block.lines.every((line) => line.available)).toBe(true);
    expect(block.lines[0].text).toMatch(/media de 30 semanas/);
    expect(block.lines[1].text).toMatch(/Avance:/);
    expect(block.lines[2].text).toMatch(/Volumen: acompaña/);
  });
});

describe("weeklyStage intact", () => {
  it("calcular muletas no altera weeklyStageForBars", () => {
    const bars = ascendingDailyBars(90);
    const before = weeklyStageForBars(bars);
    trendSupportFieldsFromBars(bars);
    buildTrendSupportLines(bars);
    const after = weeklyStageForBars(bars);
    expect(after).toEqual(before);
  });
});

describe("scoring untouched", () => {
  it("campos de trend support no mueven weaknessScore", () => {
    const base = {
      symbol: "TEST",
      objectiveScore: 72,
      compositeScore: 65,
      totalScore: 70,
      perf3m: 14,
      perf6m: 28,
      upDownVolRatio: 1.15,
    };
    const enriched = {
      ...base,
      ...trendSupportFieldsFromBars(ascendingDailyBars(90)),
      weeksAboveSma30w: 18,
      weeksAboveSma10w: 6,
      advanceRecentPct: 10,
      advancePriorPct: 4,
    };
    expect(scoreWeakness(enriched).weaknessScore).toBe(scoreWeakness(base).weaknessScore);
    expect(enriched.objectiveScore).toBe(base.objectiveScore);
  });
});

describe("DescriptiveStrip · sostén de tendencia", () => {
  it("muestra el bloque Sostén de la tendencia sin la palabra muletas", () => {
    const data = {
      chartBars: ascendingDailyBars(90),
      stage: { weekly: weeklyStageForBars(ascendingDailyBars(90)) },
      upDownVolRatio: 1.3,
      perf6m: 24,
      advanceRecentPct: 11,
      advancePriorPct: 7,
    };
    const html = renderToStaticMarkup(createElement(DescriptiveStrip, { data }));
    expect(html).toContain("Sostén de la tendencia");
    expect(html.toLowerCase()).not.toContain("muleta");
  });
});
