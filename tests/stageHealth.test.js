// tests/stageHealth.test.js — índice salud de etapa (MET-5b).

import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import DescriptiveStrip from "@/app/stock/[symbol]/DescriptiveStrip";
import { DESCRIPTIVE_ABSENCE } from "@/lib/descriptiveStrip";
import { scoreWeakness } from "@/lib/scoring";
import {
  accelerationSubscore,
  buildStageHealthLine,
  computeStageHealth,
  extensionSubscore,
  persistence10Subscore,
  persistence30Subscore,
  STAGE_HEALTH_ABSENCE_CODES,
  STAGE_HEALTH_METHODOLOGY,
  STAGE_HEALTH_WEIGHTS,
  volumeSubscore,
} from "@/lib/stageHealth";
import { weeklyStageForBars } from "@/lib/weeklyStage";

describe("stageHealth formula", () => {
  it("reproduce el ejemplo trabajado del spec (salud 90)", () => {
    const trend = {
      weeksAboveSma30w: 23,
      weeksAboveSma30wAbove: true,
      weeksAboveSma10w: 8,
      weeksAboveSma10wAbove: true,
    };
    const row = {
      weeklyStageState: "stage2",
      perf3m: 12,
      perf6m: 30,
      upDownVolRatio: 1.4,
      distanceSma30w: 12,
    };
    const health = computeStageHealth(row, trend, []);
    expect(health.available).toBe(true);
    expect(health.score).toBe(90);
    expect(health.points.persistence30).toBeCloseTo(22.1, 1);
    expect(health.points.persistence10).toBeCloseTo(8, 1);
    expect(health.points.acceleration).toBeCloseTo(15, 1);
    expect(health.points.volume).toBe(25);
    expect(health.points.extension).toBe(20);
  });

  it("subscores unitarios siguen las rampas del spec", () => {
    expect(persistence30Subscore(23)).toBeCloseTo(23 / 26, 5);
    expect(persistence30Subscore(30)).toBe(1);
    expect(persistence10Subscore(8, true, "stage2")).toBe(0.8);
    expect(persistence10Subscore(8, false, "stage2")).toBe(0);
    expect(accelerationSubscore(12, 8, "stage2")).toBe(0.75);
    expect(volumeSubscore(1.4, "stage2")).toBe(1);
    expect(extensionSubscore(12)).toBe(1);
    expect(extensionSubscore(32.5)).toBeCloseTo(0.5, 5);
  });
});

describe("stageHealth mirror stage 4", () => {
  it("invierte aceleración y volumen respecto a etapa 2", () => {
    const trend = {
      weeksAboveSma30w: 20,
      weeksAboveSma30wAbove: false,
      weeksAboveSma10w: 6,
      weeksAboveSma10wAbove: false,
    };
    const row = {
      weeklyStageState: "stage4",
      perf3m: 6,
      perf6m: 19,
      upDownVolRatio: 0.8,
      distanceSma30w: -10,
    };
    const stage2 = computeStageHealth({ ...row, weeklyStageState: "stage2" }, {
      ...trend,
      weeksAboveSma30wAbove: true,
      weeksAboveSma10wAbove: true,
    }, []);
    const stage4 = computeStageHealth(row, trend, []);
    expect(stage4.available).toBe(true);
    expect(accelerationSubscore(6, 19, "stage4")).toBe(1);
    expect(volumeSubscore(0.8, "stage4")).toBe(1);
    expect(stage4.components.acceleration).toBe(1);
    expect(stage4.components.volume).toBe(1);
    expect(stage2.components.acceleration).not.toBe(stage4.components.acceleration);
    expect(stage2.components.volume).not.toBe(stage4.components.volume);
  });
});

describe("stageHealth absences", () => {
  it("todo-o-nada: sin volumen no hay índice", () => {
    const health = computeStageHealth(
      { weeklyStageState: "stage2", perf3m: 10, perf6m: 20, upDownVolRatio: null, distanceSma30w: 5 },
      { weeksAboveSma30w: 10, weeksAboveSma30wAbove: true, weeksAboveSma10w: 5, weeksAboveSma10wAbove: true },
      [],
    );
    expect(health.available).toBe(false);
    expect(health.score).toBeNull();
    expect(health.absenceCode).toBe(STAGE_HEALTH_ABSENCE_CODES.VOLUME_COVERAGE);
    expect(health.reason).toBe(DESCRIPTIVE_ABSENCE.healthVolumeCoverage);
  });

  it("etapa 1 no computa salud", () => {
    const health = computeStageHealth(
      { weeklyStageState: "stage1" },
      {},
      [],
    );
    expect(health.available).toBe(false);
    expect(health.absenceCode).toBe(STAGE_HEALTH_ABSENCE_CODES.NON_TRENDING);
  });

  it("histórico insuficiente declara ausencia de etapa", () => {
    const health = computeStageHealth({ weeklyStageState: "insufficient_history" }, {}, []);
    expect(health.absenceCode).toBe(STAGE_HEALTH_ABSENCE_CODES.STAGE_MISSING);
  });
});

describe("weeklyStage intact", () => {
  it("calcular salud de etapa no altera weeklyStageForBars", () => {
    const closes = Array.from({ length: 90 }, (_, i) => 50 + i);
    const bars = closes.map((close, index) => ({
      date: new Date(Date.UTC(2024, 0, 1 + index * 7)).toISOString().slice(0, 10),
      open: close,
      high: close + 1,
      low: close - 1,
      close,
      volume: 1_000_000,
    })).reverse();
    const before = weeklyStageForBars(bars);
    buildStageHealthLine(bars, { weeklyStageState: before.state, perf3m: 5, perf6m: 10, upDownVolRatio: 1.2 });
    const after = weeklyStageForBars(bars);
    expect(after).toEqual(before);
  });
});

describe("scoring untouched", () => {
  it("campos de salud de etapa no mueven weaknessScore", () => {
    const base = {
      symbol: "TEST",
      objectiveScore: 72,
      compositeScore: 65,
      weaknessScore: 18,
      weeklyStageState: "stage2",
    };
    const withHealth = {
      ...base,
      stageHealthScore: 90,
      stageHealthAbsenceCode: null,
      weeksAboveSma30w: 20,
    };
    expect(scoreWeakness(withHealth)).toEqual(scoreWeakness(base));
  });
});

describe("stageHealth methodology", () => {
  it("documenta pesos, espejo E4 y ejemplo 90 en un solo sitio", () => {
    expect(STAGE_HEALTH_METHODOLOGY.title).toBe("Salud de etapa");
    expect(STAGE_HEALTH_METHODOLOGY.components).toHaveLength(5);
    expect(STAGE_HEALTH_METHODOLOGY.components.reduce((sum, item) => sum + item.weight, 0)).toBe(100);
    expect(STAGE_HEALTH_METHODOLOGY.mirrorStage4).toMatch(/Etapa 4/i);
    expect(STAGE_HEALTH_METHODOLOGY.workedExample.score).toBe(90);
    expect(STAGE_HEALTH_WEIGHTS.persistence30).toBe(25);
  });
});

describe("DescriptiveStrip stage health", () => {
  it("muestra la línea Salud de etapa con desglose cuando computa", () => {
    const html = renderToStaticMarkup(createElement(DescriptiveStrip, {
      data: {
        stage: { weekly: { state: "stage2", distanceSlowMaPct: 12 } },
        perf3m: 12,
        perf6m: 30,
        upDownVolRatio: 1.4,
        weeksAboveSma30w: 23,
        weeksAboveSma30wAbove: true,
        weeksAboveSma10w: 8,
        weeksAboveSma10wAbove: true,
        chartBars: [],
      },
    }));
    expect(html).toContain("Salud de etapa");
    expect(html).toContain("90/100");
    expect(html).toContain("Desglose");
    expect(html).toContain("media 30 sem");
  });

  it("declara ausencia honesta fuera de etapas 2/4", () => {
    const html = renderToStaticMarkup(createElement(DescriptiveStrip, {
      data: {
        stage: { weekly: { state: "stage1" } },
        chartBars: [],
      },
    }));
    expect(html).toContain("Salud de etapa");
    expect(html).toContain(DESCRIPTIVE_ABSENCE.healthNonTrendingStage);
  });
});
