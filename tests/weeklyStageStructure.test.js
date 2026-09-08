// tests/weeklyStageStructure.test.js — subestado estructural (candidato B).
//
// Campo paralelo a weeklyStage: no reclasifica etapa. Umbrales y reglas en
// docs/auditoria-etapa1-etapa2-2026-09-01.md §3.1. Ancla MSI: stage2 código +
// caja bajo techo → E2_ma_only.

import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SCREENER_COLUMNS } from "@/lib/screenerColumns";
import { stageDisplayForRow, stageStructureAbsence, stageStructureQualifier, stageSummaryText, stageWordForState } from "@/lib/stageDisplay";
import { weeklyStageForBars, weeklyBarsFromDaily } from "@/lib/weeklyStage";
import {
  BREAKOUT_VOL_PRIOR_WEEKS,
  STRUCTURE_E2_MA_ONLY,
  STRUCTURE_E2_STRUCTURAL,
  STRUCTURE_NA,
  weeklyBreakoutVolMetricsFromWeeks,
  weeklyStageStructureFields,
  weeklyStageStructureForBars,
} from "@/lib/weeklyStageStructure";
import { screenerFilterRejectReason } from "@/lib/screenerFilters";

function monday(index, start = Date.UTC(2024, 0, 1)) {
  return new Date(start + index * 7 * 86400000).toISOString().slice(0, 10);
}

function weeklyBars(weeks, mapFn) {
  return Array.from({ length: weeks }, (_, i) => {
    const mapped = mapFn(i, weeks);
    const close = mapped.close;
    return {
      date: monday(i),
      open: mapped.open ?? close,
      high: mapped.high ?? close,
      low: mapped.low ?? close,
      close,
      volume: mapped.volume ?? 1_000_000,
    };
  });
}

// Subida larga y luego caja 26s bajo un techo fijo: stage2 MM + sin fuga.
function msiLikeBars() {
  return weeklyBars(90, (i) => {
    if (i < 55) {
      const close = 120 + i * 5;
      return { close, high: close * 1.015, low: close * 0.985 };
    }
    if (i === 80) {
      return { close: 470, high: 493.57, low: 450 };
    }
    if (i >= 86) {
      return { close: 485.3, high: 488, low: 470 };
    }
    const close = 450 + Math.sin((i - 55) / 4) * 18;
    return { close, high: close + 12, low: close - 16 };
  });
}

// Avance con nuevos máximos y oscilación para pivotes HH/HL.
function structuralBreakoutBars(volumeAt = () => 1_000_000) {
  return weeklyBars(90, (i) => {
    const wave = i >= 82 ? 0 : ((i % 8 === 3 ? 14 : 0) - (i % 8 === 6 ? 8 : 0));
    const close = 50 + i * 4 + wave;
    const highBoost = i >= 86 ? 8 : (i % 8 === 3 ? 4 : 0);
    return {
      close,
      high: close + 6 + highBoost,
      low: close - 5 - (i % 8 === 6 && i < 82 ? 3 : 0),
      volume: volumeAt(i),
    };
  });
}

function oldestFirst(weeks) {
  return [...weeks].sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
}

function breakoutWeekDateFromBars(bars) {
  const stage = weeklyStageForBars(bars);
  const probe = weeklyStageStructureForBars(bars, { weeklyStageState: stage.state });
  const weeks = oldestFirst(weeklyBarsFromDaily(bars));
  const resistance = probe.resistance;
  const recentStart = Math.max(0, weeks.length - 52);
  for (let i = recentStart; i < weeks.length; i += 1) {
    if (weeks[i].close > resistance) return weeks[i].date;
  }
  return null;
}

function breakoutVolRatioBars({ priorVol = 1_000_000, breakoutVol = 2_500_000 } = {}) {
  const breakoutDate = breakoutWeekDateFromBars(structuralBreakoutBars());
  const breakoutIdx = breakoutDate
    ? Array.from({ length: 90 }, (_, i) => monday(i)).indexOf(breakoutDate)
    : -1;
  return structuralBreakoutBars((i) => {
    if (i === breakoutIdx) return breakoutVol;
    if (breakoutIdx > 0 && i >= breakoutIdx - BREAKOUT_VOL_PRIOR_WEEKS && i < breakoutIdx) {
      return priorVol;
    }
    return priorVol;
  });
}

function decliningBars() {
  return weeklyBars(90, (i) => {
    const close = 400 - i * 3;
    return { close, high: close + 4, low: close - 4 };
  });
}

const stageColumn = SCREENER_COLUMNS.find((column) => column.key === "stage");

function renderStageCell(row) {
  return renderToStaticMarkup(stageColumn.cell(row, {}));
}

describe("weeklyStageStructure · candidato B", () => {
  it("MSI-like: stage2 código + caja bajo techo → E2_ma_only", () => {
    const bars = msiLikeBars();
    const stage = weeklyStageForBars(bars);
    expect(stage.state).toBe("stage2");
    const struct = weeklyStageStructureForBars(bars, { weeklyStageState: stage.state });
    expect(struct.structure).toBe(STRUCTURE_E2_MA_ONLY);
    expect(struct.label).toBe("Pre-fuga");
    expect(struct.ruptura).toBe(false);
    expect(struct.rng26Pct).toBeLessThanOrEqual(32);
    expect(struct.resistance).toBeCloseTo(493.57, 1);
    expect(struct.distResistancePct).toBeLessThan(0);
    expect(struct.distResistancePct).toBeGreaterThan(-8);
  });

  it("fuga + HH/HL → E2_structural", () => {
    const bars = structuralBreakoutBars();
    const stage = weeklyStageForBars(bars);
    expect(stage.state).toBe("stage2");
    const struct = weeklyStageStructureForBars(bars, { weeklyStageState: stage.state });
    expect(struct.structure).toBe(STRUCTURE_E2_STRUCTURAL);
    expect(struct.label).toBe("Con fuga");
    expect(struct.ruptura).toBe(true);
    expect(struct.hhhl).toBe(true);
  });

  it("stage4 no recibe calificador aunque haya caja", () => {
    const bars = decliningBars();
    const stage = weeklyStageForBars(bars);
    expect(stage.state).toBe("stage4");
    const struct = weeklyStageStructureForBars(bars, { weeklyStageState: stage.state });
    expect(struct.structure).toBe(STRUCTURE_NA);
    expect(struct.label).toBe("");
  });

  it("histórico corto → n/a", () => {
    const bars = weeklyBars(20, (i) => ({ close: 50 + i }));
    const struct = weeklyStageStructureForBars(bars);
    expect(struct.structure).toBe(STRUCTURE_NA);
    expect(struct.detail).toMatch(/corto/i);
  });

  it("weeklyStageStructureFields proyecta las claves de fila", () => {
    const fields = weeklyStageStructureFields({
      structure: STRUCTURE_E2_MA_ONLY,
      label: "Pre-fuga",
      detail: "caja",
      resistance: 493.57,
      resistanceDate: "2026-08-03",
      distResistancePct: -1.7,
      rng26Pct: 30,
      ruptura: false,
      hhhl: true,
      breakoutVolRatio: null,
      breakoutVolWeek: "",
      breakoutVolDetail: "",
    });
    expect(fields.weeklyStageStructure).toBe("E2_ma_only");
    expect(fields.weeklyStageStructureLabel).toBe("Pre-fuga");
    expect(fields.weeklyResistance).toBeCloseTo(493.57);
    expect(fields.weeklyRuptura).toBe(false);
    expect(fields.weeklyHhHl).toBe(true);
    expect(fields.weeklyBreakoutVolRatio).toBeNull();
    expect(fields.weeklyBreakoutVolWeek).toBe("");
  });
});

describe("weeklyStageStructure · volumen de fuga (STAGE-4)", () => {
  it("ratio ≈ vol_fuga / mediana(4 prev) en fuga clara", () => {
    const bars = breakoutVolRatioBars({ priorVol: 1_000_000, breakoutVol: 2_500_000 });
    const stage = weeklyStageForBars(bars);
    const struct = weeklyStageStructureForBars(bars, { weeklyStageState: stage.state });
    expect(struct.structure).toBe(STRUCTURE_E2_STRUCTURAL);
    expect(struct.breakoutVolRatio).toBeCloseTo(2.5, 1);
    expect(struct.breakoutVolWeek).toBeTruthy();
    expect(struct.breakoutVolDetail).toBe("");
  });

  it("fuga seca: ratio < 1", () => {
    const bars = breakoutVolRatioBars({ priorVol: 1_000_000, breakoutVol: 700_000 });
    const stage = weeklyStageForBars(bars);
    const struct = weeklyStageStructureForBars(bars, { weeklyStageState: stage.state });
    expect(struct.structure).toBe(STRUCTURE_E2_STRUCTURAL);
    expect(struct.breakoutVolRatio).toBeCloseTo(0.7, 1);
  });

  it("weeklyBreakoutVolMetricsFromWeeks: ratio directo con semanas sintéticas", () => {
    const weeks = Array.from({ length: 10 }, (_, i) => ({
      date: monday(i),
      close: i < 5 ? 90 : 110,
      high: i < 5 ? 95 : 115,
      low: 85,
      volume: i === 5 ? 2_000_000 : 1_000_000,
    }));
    const metrics = weeklyBreakoutVolMetricsFromWeeks(weeks, 100, { lookbackWeeks: 10, rightWeeks: 0 });
    expect(metrics.ratio).toBeCloseTo(2, 1);
    expect(metrics.weekDate).toBe(monday(5));
  });

  it("weeklyBreakoutVolMetricsFromWeeks: sin ruptura puntual", () => {
    const weeks = weeklyBars(60, (i) => ({ close: 100 + i, high: 105 + i, low: 95 + i, volume: 1_000_000 }));
    const metrics = weeklyBreakoutVolMetricsFromWeeks(weeks, 500);
    expect(metrics.ratio).toBeNull();
    expect(metrics.detail).toMatch(/sin semana de fuga puntual/i);
  });

  it("weeklyStageStructureFields proyecta ratio y semana de fuga", () => {
    const fields = weeklyStageStructureFields({
      structure: STRUCTURE_E2_STRUCTURAL,
      breakoutVolRatio: 1.8,
      breakoutVolWeek: "2026-08-04",
      breakoutVolDetail: "",
    });
    expect(fields.weeklyBreakoutVolRatio).toBeCloseTo(1.8);
    expect(fields.weeklyBreakoutVolWeek).toBe("2026-08-04");
  });

  it("la clasificación estructural no cambia al calcular el ratio", () => {
    const plain = structuralBreakoutBars();
    const withVol = breakoutVolRatioBars({ priorVol: 500_000, breakoutVol: 50_000 });
    const stagePlain = weeklyStageForBars(plain);
    const stageVol = weeklyStageForBars(withVol);
    const structPlain = weeklyStageStructureForBars(plain, { weeklyStageState: stagePlain.state });
    const structVol = weeklyStageStructureForBars(withVol, { weeklyStageState: stageVol.state });
    expect(structPlain.structure).toBe(structVol.structure);
    expect(structPlain.label).toBe(structVol.label);
    expect(structVol.breakoutVolRatio).toBeCloseTo(0.1, 1);
  });
});

describe("weeklyStage intact", () => {
  it("calcular el subestado no altera weeklyStageForBars", () => {
    const bars = msiLikeBars();
    const before = weeklyStageForBars(bars);
    weeklyStageStructureForBars(bars, { weeklyStageState: before.state });
    const after = weeklyStageForBars(bars);
    expect(after).toEqual(before);
  });
});

describe("stageDisplay · calificador", () => {
  it("MSI se lee Etapa 2 + Pre-fuga", () => {
    const display = stageDisplayForRow({
      weeklyStageState: "stage2",
      weeklyStageLabel: "Etapa 2 confirmada",
      weeklyStageConfirmation: "confirmed",
      weeklyStageStructure: "E2_ma_only",
    });
    expect(display.word).toBe("Etapa 2");
    expect(display.qualifier).toBe("Pre-fuga");
    expect(display.title).toMatch(/MM30s/);
    expect(display.title).toMatch(/Pre-fuga/);
    expect(stageWordForState("stage2").word).toBe("Etapa 2");
    expect(stageStructureQualifier("E2_ma_only").word).toBe("Pre-fuga");
  });

  it("E2 estructural se lee Etapa 2 + Con fuga", () => {
    const display = stageDisplayForRow({
      weeklyStageState: "stage2",
      weeklyStageStructure: "E2_structural",
    });
    expect(display.word).toBe("Etapa 2");
    expect(display.qualifier).toBe("Con fuga");
  });

  it("Con fuga con ratio muestra el multiplicador (patrón MET-4)", () => {
    const display = stageDisplayForRow({
      weeklyStageState: "stage2",
      weeklyStageStructure: "E2_structural",
      weeklyBreakoutVolRatio: 1.8,
    });
    expect(display.qualifierDisplay).toBe("Con fuga (1,8×)");
    expect(display.title).toMatch(/Weinstein/);
    expect(stageSummaryText({
      weeklyStageState: "stage2",
      weeklyStageStructure: "E2_structural",
      weeklyBreakoutVolRatio: 1.8,
    })).toBe("Etapa 2 · Con fuga (1,8×)");
  });

  it("Con fuga sin ratio declara ausencia en el title", () => {
    const display = stageDisplayForRow({
      weeklyStageState: "stage2",
      weeklyStageStructure: "E2_structural",
    });
    expect(display.breakoutVol?.phrase).toMatch(/sin dato vol\. fuga/);
    expect(display.title).toMatch(/sin dato vol\. fuga|Sin ratio/i);
  });

  it("sin subestado no inventa calificador", () => {
    const display = stageDisplayForRow({ weeklyStageState: "stage2" });
    expect(display.qualifier).toBe("");
  });

  it("n/a dudoso pinta motivo desde weeklyStageStructureDetail", () => {
    const detail = "ni caja ≤32% ni fuga+HH/HL (rng26=45%)";
    expect(stageStructureAbsence(STRUCTURE_NA, detail)?.word).toBe("Dudoso");
    const display = stageDisplayForRow({
      weeklyStageState: "stage2",
      weeklyStageStructure: STRUCTURE_NA,
      weeklyStageStructureDetail: detail,
    });
    expect(display.qualifier).toBe("Dudoso");
    expect(display.title).toMatch(/ni caja/i);
    expect(display.title).toMatch(/MM30s/);
  });

  it("n/a histórico corto pinta motivo legible", () => {
    const detail = "Histórico semanal corto para 52+4 semanas de techo.";
    expect(stageStructureAbsence(STRUCTURE_NA, detail)?.word).toBe("Hist. corto");
    const display = stageDisplayForRow({
      weeklyStageState: "stage2",
      weeklyStageStructure: STRUCTURE_NA,
      weeklyStageStructureDetail: detail,
    });
    expect(display.qualifier).toBe("Hist. corto");
    expect(display.title).toMatch(/histórico semanal insuficiente/i);
  });

  it("n/a no aplica en etapas 3/4", () => {
    const detail = "código stage4; el subestado estructural no aplica";
    expect(stageStructureAbsence(STRUCTURE_NA, detail)?.word).toBe("No aplica");
    const display = stageDisplayForRow({
      weeklyStageState: "stage4",
      weeklyStageStructure: STRUCTURE_NA,
      weeklyStageStructureDetail: detail,
    });
    expect(display.qualifier).toBe("No aplica");
  });

  it("mesa: stage2 n/a dudoso muestra calificador de ausencia", () => {
    const html = renderStageCell({
      weeklyStageState: "stage2",
      weeklyStageStructure: STRUCTURE_NA,
      weeklyStageStructureDetail: "ni caja ≤32% ni fuga+HH/HL (rng26=45%)",
    });
    expect(html).toContain("Etapa 2");
    expect(html).toContain("Dudoso");
    expect(html).toContain("stageTagQualifier");
  });

  it("stageSummaryText resume palabra + calificador para texto plano", () => {
    expect(stageSummaryText({
      weeklyStageState: "stage2",
      weeklyStageStructure: "E2_ma_only",
    })).toBe("Etapa 2 · Pre-fuga");
    expect(stageSummaryText({ weeklyStageState: "stage4" })).toBe("Etapa 4");
  });
});

describe("columna Etapa y filtro requireStage2", () => {
  it("pinta Pre-fuga y el filtro Etapa 2 sigue pasando", () => {
    const bars = msiLikeBars();
    const stage = weeklyStageForBars(bars);
    const struct = weeklyStageStructureForBars(bars, { weeklyStageState: stage.state });
    const row = {
      symbol: "MSI",
      weeklyStageState: stage.state,
      weeklyStageConfirmation: stage.confirmation,
      weeklyStageLabel: stage.label,
      ...weeklyStageStructureFields(struct),
    };
    const html = renderStageCell(row);
    expect(html).toContain("Etapa 2");
    expect(html).toContain("Pre-fuga");
    expect(html).toContain("stageTagQualifier");
    expect(screenerFilterRejectReason(row, { requireStage2: true })).toBe("");
  });
});
