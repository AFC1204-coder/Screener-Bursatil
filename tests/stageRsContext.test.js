// Corrección de etapa por fuerza relativa (lib/stageRsContext.js).
import { describe, expect, it } from "vitest";
import { applyStageRsContext, STAGE_RS_CORRECTION_MAX_RS } from "@/lib/stageRsContext";
import { scanLightMetrics } from "@/lib/scanLightProjection";

const row = (over = {}) => ({
  symbol: "ORCL",
  weeklyStageState: "stage1",
  weeklyStageConfirmation: "confirmed",
  weeklyStageLabel: "Etapa 1 confirmada",
  weeklyStageWeek: 22,
  weeklyDistanceSlowMa: -25.3,
  rsGlobalPct: 13,
  weeklyStage: { state: "stage1", confirmation: "confirmed", label: "Etapa 1 confirmada", weekInStage: 22 },
  ...over,
});

describe("applyStageRsContext", () => {
  it("etapa 1 confirmada bajo la media con RS < 30 pasa a etapa 4 y conserva el estado del motor", () => {
    const [out] = applyStageRsContext([row()]);
    expect(out).toMatchObject({ weeklyStageState: "stage4", weeklyStageConfirmation: "confirmed", weeklyStageLabel: "Etapa 4 confirmada", weeklyStageEngineState: "stage1", weeklyStageRsAdjusted: true, weeklyStageWeek: null, weeklyStageStructure: "n/a" });
    expect(out.weeklyStage).toMatchObject({ state: "stage4", weekInStage: null });
  });
  it("no toca etapa 1 con RS suficiente, precio sobre la media, tentativa, sin RS o sin distancia", () => {
    for (const over of [{ rsGlobalPct: STAGE_RS_CORRECTION_MAX_RS }, { rsGlobalPct: 55 }, { weeklyDistanceSlowMa: 3 }, { weeklyDistanceSlowMa: 0 }, { weeklyStageConfirmation: "tentative" }, { rsGlobalPct: null }, { weeklyDistanceSlowMa: null }, { weeklyStageState: "stage2" }, { weeklyStageState: "stage3" }]) {
      const input = row(over);
      expect(applyStageRsContext([input])[0]).toEqual(input);
    }
  });
  it("es idempotente y no muta la entrada", () => {
    const input = row();
    const once = applyStageRsContext([input]);
    expect(input.weeklyStageState).toBe("stage1");
    expect(applyStageRsContext(once)[0]).toEqual(once[0]);
  });
  it("los campos de la corrección sobreviven a la lista blanca de la fila ligera", () => {
    const [out] = applyStageRsContext([row()]);
    expect(scanLightMetrics(out)).toMatchObject({ weeklyStageEngineState: "stage1", weeklyStageRsAdjusted: true });
  });
});

describe("enganche en el escaneo nocturno (materializedScanner.sectorize)", () => {
  it("sectorize aplica la corrección: etapa 1 bajo la media con RS bajo sale como etapa 4", async () => {
    const { _forTest } = await import("@/lib/materializedScanner");
    // 40 filas con rsCompositeRaw creciente: el percentil global se calcula sobre el lote
    const rows = Array.from({ length: 40 }, (_, i) => ({
      symbol: `S${i}`,
      sector: "Tech",
      rsComposite: i,
      rs3m: i, rs6m: i, rs12m: i,
      weeklyStageState: "stage1",
      weeklyStageConfirmation: "confirmed",
      weeklyStageLabel: "Etapa 1 confirmada",
      weeklyDistanceSlowMa: -10,
      weeklyStage: { state: "stage1", confirmation: "confirmed" },
    }));
    const out = _forTest.sectorize(rows);
    const bySymbol = new Map(out.map((r) => [r.symbol, r]));
    const low = bySymbol.get("S0");
    const high = bySymbol.get("S39");
    expect(low.rsGlobalPct).toBeLessThan(STAGE_RS_CORRECTION_MAX_RS);
    expect(low).toMatchObject({ weeklyStageState: "stage4", weeklyStageRsAdjusted: true, weeklyStageEngineState: "stage1" });
    expect(high.rsGlobalPct).toBeGreaterThan(STAGE_RS_CORRECTION_MAX_RS);
    expect(high.weeklyStageState).toBe("stage1");
  });
});
