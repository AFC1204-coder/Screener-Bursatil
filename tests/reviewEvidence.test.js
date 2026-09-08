import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { evidenceRows } from "@/lib/reviewEvidence";
import { stageSummaryText } from "@/lib/stageDisplay";

const stage2TrendRow = {
  weeklyStageState: "stage2",
  weeklyStageLabel: "Etapa 2 confirmada",
  weeklyStageConfirmation: "confirmed",
  weeklyStageStructure: "E2_ma_only",
  price: 120,
  sma50: 110,
  sma150: 100,
  sma200: 90,
  sma200Slope: 0.02,
};

describe("review evidence · etapa Weinstein vs estructura diaria", () => {
  it("la fila Etapa usa stageDisplayForRow, no objectiveStage", () => {
    const rows = evidenceRows(stage2TrendRow);
    const etapa = rows.find(([label]) => label === "Etapa");
    const estructura = rows.find(([label]) => label === "Estructura diaria");
    expect(etapa).toEqual([
      "Etapa",
      "Etapa 2 · Pre-fuga",
      expect.stringMatching(/MM30s/),
    ]);
    expect(estructura).toEqual([
      "Estructura diaria",
      "Precio > SMA50 > SMA150 > SMA200",
    ]);
  });

  it("sin etapa semanal, Etapa muestra ausencia y estructura diaria sigue", () => {
    const rows = evidenceRows({
      price: 50,
      sma50: 60,
      sma150: 70,
      sma200: 80,
    });
    expect(rows[0][0]).toBe("Etapa");
    expect(rows[0][1]).toBe("-");
    expect(rows[1]).toEqual(["Estructura diaria", "Precio < SMA200"]);
  });

  it("stageSummaryText alinea review con la mesa", () => {
    expect(stageSummaryText({
      weeklyStageState: "stage2",
      weeklyStageStructure: "E2_structural",
      weeklyBreakoutVolRatio: 2.4,
    })).toBe("Etapa 2 · Con fuga (2,4×)");
    expect(stageSummaryText({
      weeklyStageState: "stage2",
      weeklyStageStructure: "E2_structural",
    })).toBe("Etapa 2 · Con fuga");
    expect(stageSummaryText({ weeklyStageState: "stage3" })).toBe("Etapa 3");
    expect(stageSummaryText({})).toBeNull();
  });
});

describe("review page · wiring", () => {
  const source = readFileSync("app/review/page.jsx", "utf8");

  it("importa evidenceRows desde lib/reviewEvidence", () => {
    expect(source).toContain('from "@/lib/reviewEvidence"');
    expect(source).not.toContain("objectiveStage");
  });

  it("pinta title en evidencia medible", () => {
    expect(source).toMatch(/evidenceRows\(activeRow\)\.map\(\(\[label, metric, title/);
  });
});
