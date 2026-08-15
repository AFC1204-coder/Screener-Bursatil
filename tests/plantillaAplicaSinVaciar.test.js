// Aplicar una plantilla guardada NO vacía la tabla (2026-08-16).
//
// Reproducido el 2026-08-15 (docs/analisis-friccion-2026-08-15.md, sesión A3):
// guardar "periodo 6M + orden RS", aplicar la plantilla desde el desplegable, y
// la tabla se vaciaba con "Pulsa Ejecutar" — applyFilterConfig terminaba en
// clear(), que borraba analyzedRows y scanContext, las dos precondiciones del
// re-filtrado automático. Ningún criterio de plantilla exige un scan: todos se
// evalúan en cliente. Este archivo fija ese contrato por las dos vías:
//   1. templateSnapshotAssessment (la evaluación que usa la página) filtra el
//      snapshot cargado sin mutarlo y distingue 0-resultados de sin-datos.
//   2. Cerrojo sobre el fuente: applyFilterConfig no destruye datos y la
//      superficie del screener no conserva la maquinaria de ejecución.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { snapshotCoverageGaps, templateSnapshotAssessment } from "@/lib/templateApplication";
import { settingsForPreset } from "@/lib/screenerFilterCatalog";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const readSource = (relative) => readFileSync(path.join(repoRoot, relative), "utf8");

// Fila que atraviesa el pipeline real completo (quality gate + filtros duros +
// régimen + post) — el mismo builder que tests/persistenciaNavegador.test.js.
const filterReadyRow = (symbol, overrides = {}) => ({
  symbol,
  companyName: `${symbol} Corp`,
  theme: "Consumer tech",
  sector: "Technology",
  industry: "Hardware",
  country: "US",
  exchange: "NASDAQ",
  currency: "USD",
  price: 100.5,
  rsRating: 92,
  totalScore: 71,
  marketCap: 2_000_000_000,
  perf3m: 12.5,
  perf6m: 30.1,
  perf12m: 80.4,
  distance52w: -3.2,
  weeklyRsRank: 92,
  chartBarsCount: 250,
  sma50: 95, sma150: 92, sma200: 90, sma200Slope: 0.4,
  weeklyStageState: "stage2", weeklyStageLabel: "Etapa 2",
  weeklyFastWeeks: 30, weeklySlowWeeks: 40,
  priceFreshnessDays: 1, priceFreshnessOk: true, lastDate: "2026-08-14",
  dataCoverageScore: 90, technicalCoverageScore: 90, fundamentalCoverageScore: 80,
  avgVolume: 2_000_000, latestVolume: 2_500_000, avgTurnover: 200_000_000,
  latestTurnover: 250_000_000, relativeVolume: 1.2, upDownVolRatio: 1.4, upVolume: true,
  // Los settings EFECTIVOS del preset (capas incluidas) activan puertas que
  // los settings crudos del test espejo de persistencia no activan (volumen
  // 5d, proximidad, riesgo, patrón). Verificado contra el pipeline real:
  // sin estos campos la fila cae con "sin dato" en volumeSurge/proximity.
  volumeSurgePct: 25, volumeEffectScore: 70, adProxyScore: 70, epsGrowthProxyScore: 70,
  highsSpreadPct: 3, maxDailyMove20dPct: 6, maxDailyRange20dPct: 7, range63dPct: 25,
  returnToVol3m: 1.5, returnToDrawdown3m: 2, riskRewardScore: 70, shortPercentOfFloat: 5,
  contractionCount: 3, contraction1DepthPct: 15, contraction2DepthPct: 9,
  contraction3DepthPct: 5, lastContractionDepthPct: 5, baseDepthPct: 18, baseWeeks: 8,
  absDistanceToPivotPct: 3, volumeDryUpRatio: 0.6, tightness10dPct: 4, patternQualityScore: 70,
  distance20d: -2, distance50d: 4, rsGlobalPct: 92, distanceATH: -5,
  weinsteinScore: 80, minerviniScore: 75, momentumScore: 70, riskScore: 60,
  volumeScore: 65, liquidityScore: 85, sectorScore: 55, weaknessScore: 80,
  volatility63d: 30, maxDrawdown63d: -12, extSma50: 5,
  weeklyRsAvailable: true, weeklyRsRating: 92, rsCountryPct: 90, rsSectorPct: 88,
  rsQualityScore: 70, objectiveScore: 71, ipoAgeMonths: 60,
  ...overrides,
});

const templateConfig = (overrides = {}) => ({
  version: 1,
  presetKey: "balanced",
  markets: ["US"],
  settings: settingsForPreset("balanced"),
  useRegimeFilter: false,
  sort: "rsGlobalPct",
  perfPeriod: "perf6m",
  ...overrides,
});

describe("templateSnapshotAssessment · la plantilla se evalúa sobre el snapshot cargado", () => {
  it("con filas que cumplen, la plantilla deja resultados a la vista y NO muta el snapshot", () => {
    const analyzedRows = [
      filterReadyRow("PASA"),
      filterReadyRow("PASB"),
      filterReadyRow("HIST", { chartBarsCount: 59 }),      // rechazo del quality gate
      filterReadyRow("TREN", { price: 80, sma200: 90 }),   // rechazo de tendencia
    ];
    const frozen = JSON.stringify(analyzedRows);
    const result = templateSnapshotAssessment(templateConfig(), analyzedRows);
    expect(result.analyzedCount).toBe(4);
    expect(result.filteredCount).toBeGreaterThan(0);
    expect(result.filteredCount).toBeLessThan(4);
    expect(result.uncoveredMarkets).toEqual([]);
    // El snapshot es de solo lectura para la plantilla.
    expect(JSON.stringify(analyzedRows)).toBe(frozen);
  });

  it("una plantilla que no pasa nada devuelve 0 (para avisar), nunca borra los datos", () => {
    const analyzedRows = [filterReadyRow("PASA"), filterReadyRow("PASB")];
    const impossible = templateConfig({
      settings: { ...settingsForPreset("balanced"), minRsRating: 100_000 },
    });
    const result = templateSnapshotAssessment(impossible, analyzedRows);
    expect(result.filteredCount).toBe(0);
    expect(result.analyzedCount).toBe(2);
    expect(analyzedRows).toHaveLength(2);
  });

  it("sin datos cargados, filteredCount es null (sin-datos ≠ cero-por-filtro)", () => {
    const result = templateSnapshotAssessment(templateConfig(), []);
    expect(result.filteredCount).toBeNull();
    expect(result.analyzedCount).toBe(0);
  });

  it("una config rota no lanza: cae al preset por defecto", () => {
    for (const broken of [null, undefined, "texto", 42, { presetKey: "no-existe" }]) {
      const result = templateSnapshotAssessment(broken, [filterReadyRow("PASA")]);
      expect(result.presetKey).toBe("balanced");
      expect(result.analyzedCount).toBe(1);
    }
  });

  it("mercados que el snapshot no cubre se declaran como hueco de cobertura (punto 7)", () => {
    const usRows = [filterReadyRow("PASA"), filterReadyRow("PASB", { country: "" , symbol: "PASB" })];
    const result = templateSnapshotAssessment(templateConfig({ markets: ["US", "ES", "DE"] }), usRows);
    expect(result.uncoveredMarkets).toEqual(["ES", "DE"]);
    // El hueco de cobertura NO impide filtrar lo que sí está cubierto.
    expect(result.filteredCount).toBeGreaterThan(0);
  });
});

describe("snapshotCoverageGaps", () => {
  it("sin filas o sin mercados pedidos no hay nada que declarar", () => {
    expect(snapshotCoverageGaps([], [filterReadyRow("PASA")])).toEqual([]);
    expect(snapshotCoverageGaps(["US"], [])).toEqual([]);
  });

  it("usa row.country y cae a countryCode(symbol) como la restauración", () => {
    const rows = [filterReadyRow("ACS.MC", { country: "" })];
    expect(snapshotCoverageGaps(["ES"], rows)).toEqual([]);
    expect(snapshotCoverageGaps(["US"], rows)).toEqual(["US"]);
  });
});

describe("cerrojo sobre el fuente · la aplicación de plantillas no destruye y la maquinaria no vuelve", () => {
  const pageSource = readSource("app/page.jsx");
  const shellSource = readSource("app/components/screener/ScreenerShell.jsx");

  it("applyFilterConfig no llama a clear() ni vacía analyzedRows/scanContext", () => {
    const start = pageSource.indexOf("function applyFilterConfig");
    expect(start).toBeGreaterThan(-1);
    // Cuerpo de la función: hasta la siguiente función declarada al mismo nivel.
    const end = pageSource.indexOf("\n  async function", start);
    const body = pageSource.slice(start, end === -1 ? start + 3000 : end);
    expect(body).not.toMatch(/\bclear\(\)/);
    expect(body).not.toMatch(/setAnalyzedRows\(\s*\[\s*\]\s*\)/);
    expect(body).not.toMatch(/setScanContext\(\s*null\s*\)/);
    expect(body).not.toMatch(/setRows\(\s*\[\s*\]\s*\)/);
  });

  it("no queda 'Pulsa Ejecutar' ni superficie de escaneo en el screener", () => {
    expect(pageSource).not.toMatch(/Pulsa Ejecutar/);
    expect(pageSource).not.toMatch(/Pulsa Cargar/);
    // Sin el estado del scan en vivo ni la lista congelada.
    expect(pageSource).not.toMatch(/\bsetRunning\b|\bpendingResults\b|\bstopScan\b/);
    expect(shellSource).not.toMatch(/>Ejecutar<|>Detener<|PendingResultsBar|Lista congelada/);
  });
});
