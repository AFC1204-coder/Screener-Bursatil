import { describe, expect, it } from "vitest";
import {
  alignRestoredSortSession,
  alignSortPerfPeriod,
  applyPerfPeriodSelection,
  applySortSelection,
  isPerformanceSortKey,
} from "@/lib/screenerSortInvariant";
import { DEFAULT_PERFORMANCE_PERIOD } from "@/lib/screenerPeriods";

describe("screener sort ↔ perf period invariant", () => {
  it("detecta claves de orden por rendimiento", () => {
    expect(isPerformanceSortKey("perf3m")).toBe(true);
    expect(isPerformanceSortKey("perf6m")).toBe(true);
    expect(isPerformanceSortKey("rsGlobalPct")).toBe(false);
    expect(isPerformanceSortKey("weaknessScore")).toBe(false);
  });

  it("alinear sort de rendimiento fuerza el mismo periodo visible", () => {
    expect(alignSortPerfPeriod({ sort: "perf3m", perfPeriod: "perf6m" }))
      .toEqual({ sort: "perf3m", perfPeriod: "perf3m" });
    expect(alignSortPerfPeriod({ sort: "perf12m", perfPeriod: "perf3m" }))
      .toEqual({ sort: "perf12m", perfPeriod: "perf12m" });
  });

  it("no toca perfPeriod cuando el orden no es de rendimiento", () => {
    expect(alignSortPerfPeriod({ sort: "rsGlobalPct", perfPeriod: "perf6m" }))
      .toEqual({ sort: "rsGlobalPct", perfPeriod: "perf6m" });
  });

  it("select Ordenar con rendimiento actualiza periodo", () => {
    expect(applySortSelection("perf6m", { perfPeriod: "perf3m" }))
      .toEqual({ sort: "perf6m", perfPeriod: "perf6m" });
    expect(applySortSelection("rsGlobalPct", { perfPeriod: "perf6m" }))
      .toEqual({ sort: "rsGlobalPct", perfPeriod: "perf6m" });
  });

  it("period picker actualiza sort al mismo periodo", () => {
    expect(applyPerfPeriodSelection("perf12m"))
      .toEqual({ sort: "perf12m", perfPeriod: "perf12m" });
  });

  it("restaurar sesión nunca deja sort y periodo desalineados", () => {
    expect(alignRestoredSortSession({
      sort: "perf3m",
      perfPeriod: "perf6m",
      fallbackSort: DEFAULT_PERFORMANCE_PERIOD,
    })).toEqual({ sort: "perf3m", perfPeriod: "perf3m" });

    expect(alignRestoredSortSession({
      sort: "weaknessScore",
      perfPeriod: "perf6m",
      fallbackSort: "weaknessScore",
    })).toEqual({ sort: "weaknessScore", perfPeriod: "perf6m" });

    expect(alignRestoredSortSession({
      perfPeriod: "perf6m",
      fallbackSort: DEFAULT_PERFORMANCE_PERIOD,
    })).toEqual({ sort: "perf6m", perfPeriod: "perf6m" });
  });
});
