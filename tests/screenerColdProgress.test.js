import { describe, expect, it } from "vitest";
import {
  coldProgressEmptyLabel,
  isPrimaryScanProgressStatus,
  resolveColdProgressSurfaces,
} from "@/lib/screenerColdProgress";
import { buildScreenerTruthLine, SCREENER_TRUTH_LOADING_SEGMENT } from "@/lib/screenerTruthLine";

describe("screenerColdProgress · T9 una historia", () => {
  it("reconoce el status primario del escaneo", () => {
    expect(isPrimaryScanProgressStatus(null, "Cargando el escaneo nocturno...")).toBe(true);
    expect(isPrimaryScanProgressStatus(null, "Actualizando al último escaneo nocturno...")).toBe(true);
    expect(isPrimaryScanProgressStatus(null, "idle")).toBe(false);
    expect(isPrimaryScanProgressStatus(null, "Listo · Arranque")).toBe(false);
    expect(isPrimaryScanProgressStatus("fallo", "idle")).toBe(true);
  });

  it("en cold con status bar: defer weekly/coverage; truth sin loading; empty quiet", () => {
    const surfaces = resolveColdProgressSurfaces({
      restoringScan: true,
      status: "Cargando el escaneo nocturno...",
    });
    expect(surfaces.cold).toBe(true);
    expect(surfaces.deferWeekly).toBe(true);
    expect(surfaces.deferCoverageFetch).toBe(true);
    expect(surfaces.primaryStatusBar).toBe(true);
    expect(surfaces.truthLineLoading).toBe(false);
    expect(surfaces.quietEmptyLabel).toBe(true);
    expect(coldProgressEmptyLabel()).toBe("");
  });

  it("en cold sin status bar: truth sigue siendo el fallback de progreso", () => {
    const surfaces = resolveColdProgressSurfaces({
      restoringScan: true,
      status: "idle",
    });
    expect(surfaces.primaryStatusBar).toBe(false);
    expect(surfaces.truthLineLoading).toBe(true);
    expect(surfaces.deferWeekly).toBe(true);
  });

  it("fuera de cold no difiere nada", () => {
    const surfaces = resolveColdProgressSurfaces({
      restoringScan: false,
      status: "Cargando el escaneo nocturno...",
    });
    expect(surfaces.cold).toBe(false);
    expect(surfaces.deferWeekly).toBe(false);
    expect(surfaces.truthLineLoading).toBe(false);
    expect(surfaces.quietEmptyLabel).toBe(false);
  });
});

describe("buildScreenerTruthLine · quietProgress (T9)", () => {
  it("con quietProgress y universo vacío no pinta cargando… ni Sin escaneo/datos", () => {
    const line = buildScreenerTruthLine({
      analyzedRows: [],
      passCount: 0,
      visibleCount: 0,
      loading: false,
      quietProgress: true,
      scannedMarkets: ["US"],
      selectedMarkets: ["US"],
      presetName: "Líderes Etapa 2",
    });
    expect(line).not.toContain(SCREENER_TRUTH_LOADING_SEGMENT);
    expect(line).not.toContain("Sin datos");
    expect(line).not.toContain("Sin escaneo");
    expect(line).not.toContain("0 de 0");
    expect(line).toContain("mesa: US");
  });

  it("sin quietProgress y loading vacío sigue diciendo cargando…", () => {
    const line = buildScreenerTruthLine({
      analyzedRows: [],
      passCount: 0,
      visibleCount: 0,
      loading: true,
      quietProgress: false,
      scannedMarkets: ["US"],
      selectedMarkets: ["US"],
    });
    expect(line).toContain(SCREENER_TRUTH_LOADING_SEGMENT);
  });
});
