// Tests del contrato único de ResearchRow (lib/researchRowContract.js):
// 1) lo que produce buildResearchRow cumple el contrato (fila completa);
// 2) la proyección compacta conserva el núcleo y reduce el peso;
// 3) full y compacto solo difieren en chartPreview y anidados de growthMetrics.
import { describe, expect, it } from "vitest";
import { buildResearchRow } from "@/lib/researchRow";
import {
  COMPACT_CHART_PREVIEW_POINTS,
  compactGrowthMetrics,
  compactResearchRow,
  RESEARCH_ROW_ALL_CORE_FIELDS,
  validateResearchRow,
} from "@/lib/researchRowContract";
import { stage2Bars } from "./fixtures.js";

const profile = {
  name: "Stage2 Corp",
  sector: "Technology",
  industry: "Semiconductors",
  marketCap: 5_000_000_000,
  growthMetrics: {
    revenueGrowth: 25,
    earningsGrowth: 30,
    roe: 18,
    fundamentalsAsOf: "2026-05-31",
    // anidados del proveedor que el compacto debe omitir:
    financialResults: [{ year: 2025, revenue: 1e9 }, { year: 2024, revenue: 8e8 }],
    quarterlySeries: { revenue: [1, 2, 3, 4] },
  },
};
const fullRow = buildResearchRow("STAGE2", { bars: stage2Bars() }, profile, { requireLongHistory: false }, {});

describe("contrato ResearchRow · fila completa", () => {
  it("buildResearchRow cumple el contrato (todas las claves núcleo presentes)", () => {
    const result = validateResearchRow(fullRow);
    expect(result.missing).toEqual([]);
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });
  it("el contrato detecta filas rotas", () => {
    const { symbol, weinsteinScore, ...broken } = fullRow;
    const result = validateResearchRow(broken);
    expect(result.ok).toBe(false);
    expect(result.missing).toContain("symbol");
    expect(result.missing).toContain("weinsteinScore");
    expect(validateResearchRow(null).ok).toBe(false);
    expect(validateResearchRow({ ...fullRow, weinsteinScore: "100" }).ok).toBe(false);
  });
});

describe("contrato ResearchRow · proyección compacta", () => {
  const compact = compactResearchRow(fullRow);
  it("conserva todas las claves núcleo y los mismos scores", () => {
    expect(validateResearchRow(compact).ok).toBe(true);
    for (const field of RESEARCH_ROW_ALL_CORE_FIELDS) {
      if (field === "chartPreview") continue;
      expect(compact[field]).toEqual(fullRow[field]);
    }
  });
  it("chartPreview queda en ≤48 puntos ligeros con números redondeados", () => {
    expect(compact.chartPreview.length).toBeLessThanOrEqual(COMPACT_CHART_PREVIEW_POINTS);
    const point = compact.chartPreview[0];
    expect(Object.keys(point).sort()).toEqual(["close", "date", "sma200", "sma50", "volume"]);
    expect(String(point.close).length).toBeLessThanOrEqual(10);
  });
  it("growthMetrics conserva escalares y omite anidados del proveedor", () => {
    expect(compact.growthMetrics.revenueGrowth).toBe(25);
    expect(compact.growthMetrics.fundamentalsAsOf).toBe("2026-05-31");
    expect(compact.growthMetrics.financialResults).toBeUndefined();
    expect(compact.growthMetrics.quarterlySeries).toBeUndefined();
  });
  it("reduce el peso serializado de la fila", () => {
    const fullSize = JSON.stringify(fullRow).length;
    const compactSize = JSON.stringify(compact).length;
    expect(compactSize).toBeLessThan(fullSize * 0.7);
  });
  it("compactGrowthMetrics es estable ante entradas raras", () => {
    expect(compactGrowthMetrics(null)).toBeNull();
    expect(compactGrowthMetrics(undefined)).toBeUndefined();
    expect(compactGrowthMetrics([1, 2])).toEqual([1, 2]);
  });
});
