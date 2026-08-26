// P4: separar «traer datos frescos» (conserva criterios) de «resetear criterios».
import { describe, expect, it } from "vitest";
import {
  criteriaPreservedAcrossDataRefresh,
  dataRefreshEligibleOwner,
  pickScreenerCriteria,
  screenerCriteriaAfterReset,
} from "@/lib/screenerSessionActions";
import { manualDataRefreshStatus, sessionAutoRefreshStatus } from "@/lib/snapshotFreshness";

const customCriteria = {
  markets: ["US", "ES"],
  manual: "AAPL,MSFT",
  presetKey: "aggressive",
  settings: { setupMode: "leader", maxSymbols: 120 },
  filterLayers: { trend: true, volume: false },
  fieldRules: { rsRank: true },
  viewLayers: { country: true, sector: false },
  sort: "rsRank",
  scanMode: "batch",
  useRegimeFilter: false,
  selectedFilterTemplateId: "tpl-1",
};

describe("P4 · criterios vs datos", () => {
  it("el refresh conserva markets/preset/capas/orden/plantilla", () => {
    const before = { ...customCriteria, analyzedRows: [{ symbol: "OLD" }], scanContext: { id: "old" } };
    const after = {
      ...customCriteria,
      analyzedRows: [{ symbol: "NEW" }],
      scanContext: { id: "new", scannedAt: "2026-08-26T04:01:00Z" },
    };
    expect(criteriaPreservedAcrossDataRefresh(before, after)).toBe(true);
    expect(pickScreenerCriteria(after)).toEqual(pickScreenerCriteria(before));
  });

  it("el reset vuelve al preset equilibrado y mercados por defecto", () => {
    const reset = screenerCriteriaAfterReset();
    expect(reset.presetKey).toBe("balanced");
    expect(reset.markets).toContain("US");
    expect(reset.manual).toBe("");
    expect(reset.selectedFilterTemplateId).toBe("");
    expect(reset.scanMode).toBe("all");
    expect(criteriaPreservedAcrossDataRefresh(customCriteria, reset)).toBe(false);
  });

  it("el refresh manual aplica con datos de sesión, nube o copia local", () => {
    expect(dataRefreshEligibleOwner("session")).toBe(true);
    expect(dataRefreshEligibleOwner("cloud")).toBe(true);
    expect(dataRefreshEligibleOwner("local")).toBe(true);
    expect(dataRefreshEligibleOwner("none")).toBe(false);
  });
});

describe("P4 · textos de estado del refresh", () => {
  it("distingue el arranque automático del botón manual", () => {
    expect(sessionAutoRefreshStatus({ sampled: false })).toContain("Sesión restaurada");
    expect(manualDataRefreshStatus({ sampled: false })).not.toContain("Sesión restaurada");
    expect(manualDataRefreshStatus({ sampled: true })).toContain("universo completo");
  });
});
