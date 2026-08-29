import { describe, expect, it } from "vitest";
import {
  IMPACT_PILOT_FAMILIES,
  filterFamilyImpactByPilot,
  filterFamilyImpactCardLabel,
  filterFamilyImpactModalLine,
  filterFamilyImpactStats,
} from "@/lib/filterFamilyImpact";

const ON = { ipo: true, relativeStrength: true };

describe("filterFamilyImpact · IPO", () => {
  it("cuenta el recorte de la familia IPO sobre el lote cargado", () => {
    const analyzedRows = [
      { symbol: "NEW1", ipoAgeMonths: 12 },
      { symbol: "NEW2", ipoAgeMonths: 40 },
      { symbol: "OLD", ipoAgeMonths: 200 },
      { symbol: "NODATE" },
    ];
    const stats = filterFamilyImpactStats("ipo", {
      analyzedRows,
      settings: { requireRecentIpo: true, maxIpoAgeMonths: 60 },
      filterLayers: ON,
      fieldRules: {},
    });
    expect(stats.total).toBe(4);
    expect(stats.cut).toBe(2); // OLD (fuera de edad) + NODATE (sin ipoDate)
    expect(stats.remaining).toBe(2);
    expect(stats.hasActiveRules).toBe(true);
    expect(filterFamilyImpactCardLabel(stats)).toEqual({ text: "recorta −2", tone: "cut" });
    expect(filterFamilyImpactModalLine(stats)).toBe("Esta familia deja 2 de 4 · recorta −2");
  });

  it("familia activa sin regla de corte → sin recorte", () => {
    const stats = filterFamilyImpactStats("ipo", {
      analyzedRows: [{ symbol: "A", ipoAgeMonths: 12 }, { symbol: "B" }],
      settings: { requireRecentIpo: false, maxIpoAgeMonths: 999 },
      filterLayers: ON,
      fieldRules: {},
    });
    expect(stats.cut).toBe(0);
    expect(stats.remaining).toBe(2);
    expect(filterFamilyImpactCardLabel(stats)).toEqual({ text: "sin recorte", tone: "none" });
    expect(filterFamilyImpactModalLine(stats)).toBe("Esta familia deja 2 de 2 · sin recorte");
  });

  it("capa apagada no inventa impacto de corte", () => {
    const stats = filterFamilyImpactStats("ipo", {
      analyzedRows: [{ symbol: "A" }, { symbol: "B" }],
      settings: { requireRecentIpo: true, maxIpoAgeMonths: 60 },
      filterLayers: { ipo: false },
      fieldRules: {},
    });
    expect(stats.layerOn).toBe(false);
    expect(stats.cut).toBe(0);
    expect(filterFamilyImpactCardLabel(stats)).toBeNull();
    expect(filterFamilyImpactModalLine(stats)).toBeNull();
  });
});

describe("filterFamilyImpact · RS", () => {
  it("cuenta el recorte de la familia RS por benchmark", () => {
    const analyzedRows = [
      { symbol: "STRONG", rsRating: 82 },
      { symbol: "MID", rsRating: 55 },
      { symbol: "WEAK", rsRating: 20 },
      { symbol: "NODATA" },
    ];
    const stats = filterFamilyImpactStats("relativeStrength", {
      analyzedRows,
      settings: { minRsBenchmarkRating: 60, minRsRating: 0, minRsQualityScore: 0, minSectorScore: 0 },
      filterLayers: ON,
      fieldRules: {},
    });
    expect(stats.total).toBe(4);
    expect(stats.cut).toBe(3); // MID + WEAK (bajo umbral) + NODATA (sin dato)
    expect(stats.remaining).toBe(1);
    expect(filterFamilyImpactCardLabel(stats)).toEqual({ text: "recorta −3", tone: "cut" });
  });

  it("RS abierto (todos los umbrales a 0) no recorta", () => {
    const stats = filterFamilyImpactStats("relativeStrength", {
      analyzedRows: [{ symbol: "A", rsRating: 30 }, { symbol: "B", rsRating: 90 }],
      settings: { minRsRating: 0, minRsBenchmarkRating: 0, minRsCountryPct: 0, minRsSectorPct: 0, minRsQualityScore: 0, minSectorScore: 0 },
      filterLayers: ON,
      fieldRules: {},
    });
    expect(stats.cut).toBe(0);
    expect(filterFamilyImpactCardLabel(stats)).toEqual({ text: "sin recorte", tone: "none" });
  });

  it("una regla de campo desactivada no cuenta para el impacto", () => {
    const analyzedRows = [{ symbol: "WEAK", rsRating: 20 }, { symbol: "STRONG", rsRating: 90 }];
    const settings = { minRsBenchmarkRating: 60 };
    const active = filterFamilyImpactStats("relativeStrength", { analyzedRows, settings, filterLayers: ON, fieldRules: {} });
    expect(active.cut).toBe(1);
    const disabled = filterFamilyImpactStats("relativeStrength", {
      analyzedRows,
      settings,
      filterLayers: ON,
      fieldRules: { minRsBenchmarkRating: false },
    });
    expect(disabled.cut).toBe(0);
  });
});

describe("filterFamilyImpactByPilot", () => {
  it("calcula ambas familias piloto en un pase por familia", () => {
    const analyzedRows = [
      { symbol: "A", ipoAgeMonths: 12, rsRating: 90 },
      { symbol: "B", rsRating: 10 },
    ];
    const map = filterFamilyImpactByPilot({
      analyzedRows,
      settings: { requireRecentIpo: true, maxIpoAgeMonths: 60, minRsBenchmarkRating: 60 },
      filterLayers: ON,
      fieldRules: {},
    });
    expect(IMPACT_PILOT_FAMILIES).toEqual(["ipo", "relativeStrength"]);
    expect(map.ipo.cut).toBe(1); // B sin ipoDate
    expect(map.relativeStrength.cut).toBe(1); // B rsRating 10 < 60
  });

  it("lote vacío → sin impacto y sin errores", () => {
    const map = filterFamilyImpactByPilot({ analyzedRows: [], settings: {}, filterLayers: ON, fieldRules: {} });
    expect(map.ipo.total).toBe(0);
    expect(map.ipo.cut).toBe(0);
    expect(filterFamilyImpactCardLabel(map.ipo)).toEqual({ text: "sin recorte", tone: "none" });
    expect(filterFamilyImpactModalLine(map.ipo)).toBeNull();
  });
});
