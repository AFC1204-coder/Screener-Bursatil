import { describe, expect, it } from "vitest";
import {
  COVERAGE_PILOT_FAMILIES,
  RS_COVERAGE_LOW_RATIO,
  filterFamilyCoverageByPilot,
  filterFamilyCoverageCardWarning,
  filterFamilyCoverageModalLine,
  filterFamilyCoverageStats,
  filterFamilyEmptyMessage,
  rowHasRsDataSignal,
  rsCoverageStats,
  rsFamilyEmptyMessage,
  shouldUseFamilyEmptyLabel,
} from "@/lib/filterFamilyCoverage";
import { rowHasIpoDateSignal } from "@/lib/ipoDiscoveryView";

describe("filterFamilyCoverage · RS", () => {
  it("detecta fila con RS semanal hidratado", () => {
    expect(rowHasRsDataSignal({ weeklyRsAvailable: true, weeklyRsRating: 72 })).toBe(true);
    expect(rowHasRsDataSignal({ weeklyRsAvailable: false })).toBe(false);
    expect(rowHasRsDataSignal({ rsGlobalPct: 90 })).toBe(false);
  });

  it("marca cobertura baja por debajo del umbral testeable", () => {
    const rows = [
      { weeklyRsAvailable: true, weeklyRsRating: 80 },
      ...Array.from({ length: 9 }, (_, index) => ({ symbol: `X${index}` })),
    ];
    const stats = rsCoverageStats(rows);
    expect(stats.withRsData).toBe(1);
    expect(stats.ratio).toBeCloseTo(0.1);
    expect(stats.low).toBe(true);
    expect(RS_COVERAGE_LOW_RATIO).toBe(0.55);
  });

  it("no marca cobertura baja cuando la mayoría tiene RS", () => {
    const rows = Array.from({ length: 10 }, (_, index) => ({
      symbol: `R${index}`,
      weeklyRsAvailable: true,
      weeklyRsRating: 60 + index,
    }));
    const stats = rsCoverageStats(rows);
    expect(stats.low).toBe(false);
  });
});

describe("filterFamilyCoverage · IPO", () => {
  it("reutiliza ipoDateCoverageStats para la familia IPO", () => {
    const rows = [
      { ipoDate: "2024-01-01" },
      ...Array.from({ length: 24 }, (_, index) => ({ symbol: `B${index}` })),
    ];
    const stats = filterFamilyCoverageStats("ipo", rows);
    expect(stats.withIpoDate).toBe(1);
    expect(stats.low).toBe(true);
    expect(rowHasIpoDateSignal(rows[0])).toBe(true);
  });
});

describe("filterFamilyCoverage · copy", () => {
  const ipoStats = { total: 3321, withIpoDate: 12, low: true };
  const rsStats = { total: 47, withRsData: 25, low: true };

  it("genera aviso corto en tarjeta solo si la familia está activa y cobertura baja", () => {
    expect(filterFamilyCoverageCardWarning("ipo", ipoStats, { active: true })).toBe("⚠ ipoDate en 12/3321");
    expect(filterFamilyCoverageCardWarning("ipo", ipoStats, { active: false })).toBe("");
    expect(filterFamilyCoverageCardWarning("relativeStrength", rsStats, { active: true })).toBe(
      "⚠ RS con dato en 25/47",
    );
    expect(filterFamilyCoverageCardWarning("relativeStrength", { ...rsStats, low: false }, { active: true })).toBe("");
  });

  it("genera cabecera de modal con N/M del lote", () => {
    expect(filterFamilyCoverageModalLine("ipo", ipoStats)).toBe(
      "Cobertura del dato: ipoDate en 12/3321 del lote",
    );
    expect(filterFamilyCoverageModalLine("relativeStrength", rsStats)).toBe(
      "Cobertura del dato: RS semanal en 25/47 del lote",
    );
  });
});

describe("filterFamilyCoverage · empty", () => {
  it("explica vacío RS por dato ausente", () => {
    const text = rsFamilyEmptyMessage({
      analyzedCount: 47,
      coverage: { total: 47, withRsData: 0, low: true },
    });
    expect(text).toMatch(/RS semanal/i);
    expect(text).toMatch(/nocturno/i);
  });

  it("explica vacío RS con cobertura parcial", () => {
    const text = filterFamilyEmptyMessage("relativeStrength", {
      analyzedCount: 47,
      coverage: { total: 47, withRsData: 25, low: true },
      filterLayers: { relativeStrength: true },
      settings: { minRsRating: 75 },
    });
    expect(text).toMatch(/25 de 47/);
  });

  it("decide cuándo usar empty especializado por familia", () => {
    expect(shouldUseFamilyEmptyLabel("ipo", {
      rows: [],
      analyzedRows: [{ symbol: "A" }],
      presetKey: "ipoDiscovery",
      filterLayers: { ipo: true },
      settings: {},
    })).toBe(true);
    expect(shouldUseFamilyEmptyLabel("relativeStrength", {
      rows: [],
      analyzedRows: [{ symbol: "A" }],
      filterLayers: { relativeStrength: true },
      settings: { minRsRating: 75 },
    })).toBe(true);
    expect(shouldUseFamilyEmptyLabel("relativeStrength", {
      rows: [],
      analyzedRows: [{ symbol: "A" }],
      filterLayers: { relativeStrength: true },
      settings: { minRsRating: 0 },
    })).toBe(false);
  });
});

describe("filterFamilyCoverageByPilot", () => {
  it("calcula IPO y RS en un solo pase por familia", () => {
    const map = filterFamilyCoverageByPilot([
      { ipoDate: "2024-01-01", weeklyRsAvailable: true, weeklyRsRating: 70 },
    ]);
    expect(COVERAGE_PILOT_FAMILIES).toEqual(["ipo", "relativeStrength"]);
    expect(map.ipo.withIpoDate).toBe(1);
    expect(map.relativeStrength.withRsData).toBe(1);
  });
});
