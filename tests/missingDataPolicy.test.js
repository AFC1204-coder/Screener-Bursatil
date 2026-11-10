// Política única de dato que falta (auditoría de filtros 2026-11, propuesta 2).
//
// DECISIÓN: una fila sin el dato que exige un filtro ACTIVO no pasa ese
// filtro, y su rechazo se marca «sin dato» para contarlo aparte en la
// auditoría (diagnostics.missingDataRejected / missingDataByField). Vale igual
// para el RS semanal, el RS país, el RS tema, el RS quality, la fuerza de
// grupo, el score compuesto y las reglas numéricas genéricas, y da el mismo
// veredicto por el camino de reglas y por el atajo screenPassed. Con el
// filtro apagado, la ausencia no cuenta. En el veredicto del escáner (stage
// "scan") el RS semanal se aplaza: aún no está hidratado y se aplica al leer.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  MISSING_DATA_POLICY,
  isMissingDataRejection,
  missingDataReject,
  requiredThresholdReject,
  summarizeMissingData,
} from "@/lib/missingDataPolicy";
import { applyScreenerFilters, screenerFilterRejectReason, screenerFiltersFromParams, screenerReadTimeRejectReason } from "@/lib/screenerFilters";
import { filterAnalyzedRows } from "@/lib/screenerPipeline";
import { canUseScreenPassedFastPath } from "@/lib/screenerFilterFastPath";

const TODAY = "2026-08-26T12:00:00Z";
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(TODAY));
});
afterAll(() => {
  vi.useRealTimers();
});

function row(symbol, overrides = {}) {
  return {
    symbol,
    price: 30,
    chartBarsCount: 250,
    lastDate: "2026-08-25",
    sma50: 28, sma150: 26, sma200: 24, sma200Slope: 0.3,
    weeklyStageState: "stage2", weeklyStageLabel: "Etapa 2", weeklyFastWeeks: 30, weeklySlowWeeks: 40,
    dataCoverageScore: 85, technicalCoverageScore: 85, fundamentalCoverageScore: 70,
    avgVolume: 1_000_000, latestVolume: 1_100_000, avgTurnover: 30_000_000, latestTurnover: 33_000_000,
    relativeVolume: 1.1, upDownVolRatio: 1.2, upVolume: true, marketCap: 900_000_000,
    weinsteinScore: 70, minerviniScore: 65, momentumScore: 60, riskScore: 55, volumeScore: 50, liquidityScore: 70,
    sectorScore: 60, volatility63d: 25, maxDrawdown63d: -10, extSma50: 6,
    weeklyRsAvailable: true, weeklyRsRating: 80,
    weeklyCountryRsAvailable: true, weeklyCountryRsRating: 78, weeklyCountryRsMarket: "US",
    weeklyThemeRsAvailable: true, weeklyThemeRsRating: 75,
    rsGlobalPct: 80, rsCountryPct: 80, rsSectorPct: 70, rsQualityScore: 60,
    objectiveScore: 65, compositeScore: 65, totalScore: 65,
    perf3m: 10, perf6m: 20, perf12m: 30, distance52w: -10, distance20dHigh: -3, distance50dHigh: -6,
    theme: "Software", sector: "Technology", industry: "Software", country: "US",
    ...overrides,
  };
}

describe("missingDataPolicy · el módulo", () => {
  it("declara la política y marca los rechazos por ausencia", () => {
    expect(MISSING_DATA_POLICY).toBe("reject-and-count");
    expect(missingDataReject("minRsRating", "RS semanal")).toEqual({ field: "minRsRating", reason: "RS semanal sin dato", missingData: true });
    expect(requiredThresholdReject({ field: "x", label: "X", value: null, threshold: 50 })).toMatchObject({ missingData: true });
    expect(requiredThresholdReject({ field: "x", label: "X", value: 40, threshold: 50 })).toMatchObject({ missingData: false, reason: "X 40 < 50" });
    expect(requiredThresholdReject({ field: "x", label: "X", value: 60, threshold: 50 })).toBeNull();
    expect(requiredThresholdReject({ field: "x", label: "X", value: null, threshold: null })).toBeNull();
  });

  it("distingue «sin dato» de «no llega al umbral» y lo cuenta aparte", () => {
    expect(isMissingDataRejection({ reason: "RS semanal 40 < 50", missingData: false })).toBe(false);
    expect(isMissingDataRejection({ reason: "precio sin dato" })).toBe(true); // motivo de texto heredado
    expect(summarizeMissingData([
      { field: "minRsRating", missingData: true },
      { field: "minRsRating", missingData: true },
      { field: "minThemeRsRating", missingData: true },
      { field: "minPrice", missingData: false },
    ])).toEqual({ total: 3, byField: { minRsRating: 2, minThemeRsRating: 1 } });
  });
});

describe("misma política para RS semanal, RS país, RS tema y reglas genéricas", () => {
  const cases = [
    ["minRsRating", { weeklyRsAvailable: false, weeklyRsRating: null }, "RS semanal sin dato"],
    ["minRsCountryPct", { weeklyCountryRsAvailable: false, weeklyCountryRsRating: null }, "RS país semanal sin dato"],
    ["minThemeRsRating", { weeklyThemeRsAvailable: false, weeklyThemeRsRating: null }, "RS tema semanal sin dato"],
    ["minRsQualityScore", { rsQualityScore: null }, "RS quality sin dato"],
    ["minSectorScore", { sectorScore: null }, "fuerza grupo sin dato"],
  ];
  for (const [field, missing, reason] of cases) {
    it(`${field}: sin dato con el filtro activo NO pasa y queda marcado`, () => {
      expect(screenerFilterRejectReason(row("A", missing), { [field]: 50 })).toEqual({ field, reason, missingData: true });
    });
    it(`${field}: con el filtro apagado la ausencia no cuenta`, () => {
      expect(screenerFilterRejectReason(row("A", missing), { [field]: 0 })).toBe("");
    });
  }

  it("una regla genérica (cap. bursátil) sigue la misma forma", () => {
    expect(screenerFilterRejectReason(row("A", { marketCap: null }), { minMarketCap: 150_000_000 }))
      .toEqual({ field: "minMarketCap", reason: "market cap sin dato", missingData: true });
  });

  it("el RS país/tema ya NO depende de que la fila diga que está hidratada", () => {
    // Antes: weeklyCountryRsAvailable !== true → el filtro duro se lo saltaba
    // y solo el post-filtro rechazaba. Ahora ambos caminos rechazan igual.
    expect(screenerFilterRejectReason(row("A", { weeklyCountryRsAvailable: undefined, weeklyCountryRsRating: undefined }), { minRsCountryPct: 50 }))
      .toMatchObject({ field: "minRsCountryPct", missingData: true });
  });
});

describe("el veredicto del escáner aplaza el RS semanal (aún no hidratado)", () => {
  it("applyScreenerFilters (nocturno/leaderboards) no rechaza por RS sin hidratar", () => {
    const filters = screenerFiltersFromParams({ filterPreset: "balanced" });
    const unhydrated = row("N", { weeklyRsAvailable: undefined, weeklyRsRating: undefined });
    const result = applyScreenerFilters([unhydrated], filters);
    expect(result.rejections.filter((item) => item.field === "minRsRating")).toEqual([]);
  });

  it("al leer, screenerReadTimeRejectReason sí lo aplica", () => {
    expect(screenerReadTimeRejectReason(row("N", { weeklyRsAvailable: false }), { minRsRating: 50 }))
      .toMatchObject({ field: "minRsRating", missingData: true });
    expect(screenerReadTimeRejectReason(row("N"), { minRsRating: 50 })).toBeNull();
  });
});

describe("pipeline: mismo veredicto por reglas y por el atajo screenPassed, y recuento aparte", () => {
  // Filtro mínimo (solo RS semanal + frescura) para aislar la política; el
  // veredicto precomputado del nocturno usa exactamente los mismos criterios.
  const settings = { minRsRating: 50, maxPriceFreshnessDays: 5, requireStage2: true };
  const precomputed = { enabled: true, values: { ...settings } };
  const rows = [
    row("OK"),
    row("NORS", { weeklyRsAvailable: false, weeklyRsRating: null }),
    row("LOWRS", { weeklyRsRating: 20 }),
  ];
  // Lo que escribe el nocturno: veredicto de escáner (RS semanal aplazado).
  // Se calcula dentro de cada test, con el reloj ya fijado por beforeAll.
  const stampScan = () => rows.map((item) => {
    const reason = screenerFilterRejectReason(item, precomputed, { stage: "scan" });
    return { ...item, screenPassed: !reason, screenRejectField: reason?.field || null, screenRejectReason: reason?.reason || null };
  });

  it("el nocturno dio por buenas las tres filas (no conocía el RS)", () => {
    const stamped = stampScan();
    expect(stamped.every((item) => item.screenPassed)).toBe(true);
    expect(canUseScreenPassedFastPath(stamped, settings, { screenerFilters: precomputed })).toBe(true);
  });

  it("por reglas: la fila sin RS no pasa y se cuenta como «sin dato»", () => {
    const view = filterAnalyzedRows(rows, settings, { useRegimeFilter: false });
    expect(view.path).toBe("rules");
    expect(view.rows.map((item) => item.symbol)).toEqual(["OK"]);
    expect(view.diagnostics.missingDataRejected).toBe(1);
    expect(view.diagnostics.missingDataByField).toEqual({ minRsRating: 1 });
  });

  it("por el atajo screenPassed: el mismo resultado y el mismo recuento", () => {
    const stamped = stampScan();
    const view = filterAnalyzedRows(stamped, settings, { useRegimeFilter: false, screenerFilters: precomputed });
    expect(view.path).toBe("screen-passed");
    expect(view.rows.map((item) => item.symbol)).toEqual(["OK"]);
    expect(view.diagnostics.missingDataRejected).toBe(1);
    expect(view.diagnostics.missingDataByField).toEqual({ minRsRating: 1 });
  });

  it("el atajo screenPassed también vuelve a mirar la antigüedad real del precio", () => {
    const stale = stampScan().map((item) => (item.symbol === "OK" ? { ...item, lastDate: "2026-08-10", priceFreshnessDays: 1 } : item));
    const view = filterAnalyzedRows(stale, settings, { useRegimeFilter: false, screenerFilters: precomputed });
    expect(view.path).toBe("screen-passed");
    expect(view.rows).toEqual([]);
    expect(view.diagnostics.blocks.find((block) => block.key === "coverage")?.count).toBe(1);
  });
});
