// Candado de regresión del motor de etapas con barras REALES congeladas hasta 2026-08-31.
//
// Qué es: fija lo que el motor decía el 2026-08-31 para cinco tickers de la auditoría
// docs/auditoria-etapa1-etapa2-2026-09-01.md (§4). Si el motor cambia y alguna lectura se mueve, falla.
// Qué NO es: no valida acierto. Solo MMM (etapa 1), VLO y MPC (etapa 2 con fuga) coinciden con la
// lectura del dueño; en MSI y MDLZ el código dice «Etapa 2 confirmada» y el dueño lee E1 potencial
// (caja sin fuga), por eso allí se fija el estado compuesto E2_ma_only / «Pre-fuga» y no solo la etapa.
// Fuera a propósito: SPY y otros ocho (código y lectura no coinciden) y NDSN (sin revisión a mano).
// Pendiente: ejemplos reales de etapa 3 y 4 (la muestra de septiembre no tiene ninguno).
//
// Barras: tests/fixtures/stage-real-bars-2026-08-31.json (daily_bars del Mini, ajustadas por splits).

import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { weeklyStageForBars } from "@/lib/weeklyStage";
import { STRUCTURE_E2_MA_ONLY, STRUCTURE_E2_STRUCTURAL, weeklyStageStructureForBars } from "@/lib/weeklyStageStructure";

const FIXTURE = JSON.parse(fs.readFileSync("tests/fixtures/stage-real-bars-2026-08-31.json", "utf8"));
// La semana del 31-ago queda cerrada con esta referencia; sin ella el resultado dependería del día en que corra el test.
const OPTIONS = { stageReferenceDate: "2026-09-07" };

function read(symbol) {
  const rows = FIXTURE.bars[symbol];
  const bars = rows.map(([date, high, low, close, volume]) => ({ date, high, low, close, volume })).reverse();
  const stage = weeklyStageForBars(bars, OPTIONS);
  const struct = weeklyStageStructureForBars(bars, { ...OPTIONS, weeklyStageState: stage.state });
  return { stage, struct };
}

describe("candado de etapas con barras reales (hasta 2026-08-31)", () => {
  it("el fixture llega al 2026-08-31 y tiene historia suficiente", () => {
    for (const symbol of ["MMM", "VLO", "MPC", "MSI", "MDLZ"]) {
      const rows = FIXTURE.bars[symbol];
      expect(rows.at(-1)[0]).toBe("2026-08-31");
      expect(rows.length).toBeGreaterThan(300);
    }
  });

  it("MMM: etapa 1 confirmada (único caso donde código y lectura del dueño coinciden)", () => {
    const { stage } = read("MMM");
    expect(stage.state).toBe("stage1");
    expect(stage.confirmation).toBe("confirmed");
    // El subestado estructural de MMM (hoy E2_ma_only) no se fija: bajo etapa 1 no tiene lectura validada.
  });

  it("MSI: etapa 2 confirmada, antes de la fuga (caja bajo el techo, E2_ma_only / Pre-fuga)", () => {
    const { stage, struct } = read("MSI");
    expect(stage.state).toBe("stage2");
    expect(stage.confirmation).toBe("confirmed");
    expect(struct.structure).toBe(STRUCTURE_E2_MA_ONLY);
    expect(struct.label).toBe("Pre-fuga");
    expect(struct.ruptura).toBe(false);
    expect(struct.distResistancePct).toBeGreaterThan(-2.5);
    expect(struct.distResistancePct).toBeLessThan(-1);
  });

  it("MDLZ: etapa 2 confirmada, antes de la fuga (E2_ma_only / Pre-fuga)", () => {
    const { stage, struct } = read("MDLZ");
    expect(stage.state).toBe("stage2");
    expect(stage.confirmation).toBe("confirmed");
    expect(struct.structure).toBe(STRUCTURE_E2_MA_ONLY);
    expect(struct.ruptura).toBe(false);
    expect(struct.distResistancePct).toBeGreaterThan(-8);
    expect(struct.distResistancePct).toBeLessThan(-5);
  });

  it.each(["VLO", "MPC"])("%s: etapa 2 confirmada con la fuga ya hecha (E2_structural)", (symbol) => {
    const { stage, struct } = read(symbol);
    expect(stage.state).toBe("stage2");
    expect(stage.confirmation).toBe("confirmed");
    expect(struct.structure).toBe(STRUCTURE_E2_STRUCTURAL);
    expect(struct.ruptura).toBe(true);
    expect(struct.distResistancePct).toBeGreaterThan(10);
  });
});
