// tests/marketHealthStage.test.js — paridad de etapa estructural en /api/market-health.
//
// Índices y sectores deben calcular weeklyStageStructureForBars con el mismo
// módulo que la mesa, y el payload no debe incluir el stageLabel diario muerto.

import { describe, expect, it } from "vitest";
import { weeklyStageSnapshot } from "@/app/api/market-health/route";
import { stageDisplayForRow } from "@/lib/stageDisplay";
import { STRUCTURE_E2_MA_ONLY, STRUCTURE_E2_STRUCTURAL } from "@/lib/weeklyStageStructure";

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

function structuralBreakoutBars() {
  return weeklyBars(90, (i) => {
    const wave = i >= 82 ? 0 : ((i % 8 === 3 ? 14 : 0) - (i % 8 === 6 ? 8 : 0));
    const close = 50 + i * 4 + wave;
    const highBoost = i >= 86 ? 8 : (i % 8 === 3 ? 4 : 0);
    return { close, high: close + 6 + highBoost, low: close - 5 - (i % 8 === 6 && i < 82 ? 3 : 0) };
  });
}

describe("market-health weeklyStageSnapshot", () => {
  it("MSI-like: stage2 + caja bajo techo → Pre-fuga en el payload y en stageDisplay", () => {
    const bars = msiLikeBars();
    const snapshot = weeklyStageSnapshot(bars);
    expect(snapshot.stageState).toBe("stage2");
    expect(snapshot.weeklyStageStructure).toBe(STRUCTURE_E2_MA_ONLY);
    expect(snapshot.weeklyStageStructureLabel).toBe("Pre-fuga");
    const display = stageDisplayForRow(snapshot);
    expect(display?.word).toBe("Etapa 2");
    expect(display?.qualifier).toBe("Pre-fuga");
  });

  it("fuga + HH/HL → Con fuga en el payload y en stageDisplay", () => {
    const bars = structuralBreakoutBars();
    const snapshot = weeklyStageSnapshot(bars);
    expect(snapshot.stageState).toBe("stage2");
    expect(snapshot.weeklyStageStructure).toBe(STRUCTURE_E2_STRUCTURAL);
    expect(snapshot.weeklyStageStructureLabel).toBe("Con fuga");
    const display = stageDisplayForRow(snapshot);
    expect(display?.qualifier).toBe("Con fuga");
  });

  it("expone los alias weeklyStage* que consume stageDisplayForRow", () => {
    const bars = msiLikeBars();
    const snapshot = weeklyStageSnapshot(bars);
    expect(snapshot.weeklyStageState).toBe(snapshot.stageState);
    expect(snapshot.weeklyStageConfirmation).toBe(snapshot.stageConfirmation);
    expect(snapshot.weeklyStageLabel).toBe(snapshot.stage30w);
  });

  it("no incluye el stageLabel diario muerto (G9)", () => {
    const snapshot = weeklyStageSnapshot(msiLikeBars());
    expect(snapshot).not.toHaveProperty("stage");
  });
});
