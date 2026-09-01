// tests/weeklyStageStructure.test.js — subestado estructural (candidato B).
//
// Campo paralelo a weeklyStage: no reclasifica etapa. Umbrales y reglas en
// docs/auditoria-etapa1-etapa2-2026-09-01.md §3.1. Ancla MSI: stage2 código +
// caja bajo techo → E2_ma_only.

import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SCREENER_COLUMNS } from "@/lib/screenerColumns";
import { stageDisplayForRow, stageStructureQualifier, stageWordForState } from "@/lib/stageDisplay";
import { weeklyStageForBars } from "@/lib/weeklyStage";
import {
  STRUCTURE_E2_MA_ONLY,
  STRUCTURE_E2_STRUCTURAL,
  STRUCTURE_NA,
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
function structuralBreakoutBars() {
  return weeklyBars(90, (i) => {
    const wave = i >= 82 ? 0 : ((i % 8 === 3 ? 14 : 0) - (i % 8 === 6 ? 8 : 0));
    const close = 50 + i * 4 + wave;
    const highBoost = i >= 86 ? 8 : (i % 8 === 3 ? 4 : 0);
    return { close, high: close + 6 + highBoost, low: close - 5 - (i % 8 === 6 && i < 82 ? 3 : 0) };
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
    });
    expect(fields.weeklyStageStructure).toBe("E2_ma_only");
    expect(fields.weeklyStageStructureLabel).toBe("Pre-fuga");
    expect(fields.weeklyResistance).toBeCloseTo(493.57);
    expect(fields.weeklyRuptura).toBe(false);
    expect(fields.weeklyHhHl).toBe(true);
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

  it("sin subestado no inventa calificador", () => {
    const display = stageDisplayForRow({ weeklyStageState: "stage2" });
    expect(display.qualifier).toBe("");
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
