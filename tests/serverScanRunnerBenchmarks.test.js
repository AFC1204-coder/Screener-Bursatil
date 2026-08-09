// Tests de verificación del fix de hidratación de benchmarks locales en
// lib/serverScanRunner.js#loadBenchmarks.
//
// Hallazgo (audit docs/screener-design-audit-2026-07-10.md §C1):
// benchmarkSymbolForRow(row) asigna un benchmark local por país (^IBEX para
// España, ^GDAXI para Alemania, ^N225 para Japón…). Pero el runner de /api/scan
// solo hidrataba ["SPY","QQQ","ACWI"], así que para cualquier fila no-US,
// benchmarks["^IBEX"] era undefined → bars=[] → rsRating=null con
// rsBenchmarkIssue:"benchmark insuficiente".
//
// Tras el fix, loadBenchmarks recorre los símbolos del eslabón actual, calcula
// benchmarkSymbolForRow para cada uno, deduplica y los hidrata junto a los 3
// globales. Esta prueba verifica el wiring: qué símbolos se piden a
// fetchYahooChart.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks (mismo patrón que serverScanRunnerFinalization.test.js) ------------

vi.mock("@/lib/marketData", () => ({
  // fetchYahooChart es lo que queremos espiar: loadBenchmarks lo llama por cada
  // benchmark. Devolvemos un chart sintético con la cuenta de barras que
  // scoreRelativeStrength necesita (>=252 para perf12m).
  fetchYahooChart: vi.fn(async (symbol) => ({
    bars: Array.from({ length: 260 }, (_, i) => ({ date: `2024-${String(i % 30 + 1).padStart(2, "0")}`, close: 100 + i })),
    meta: { symbol },
  })),
  fetchYahooProfile: vi.fn(async () => ({})),
}));

// dailyBarsCache/fundamentalsCache: no es lo que este archivo verifica (solo
// le importa qué símbolos se piden a fetchYahooChart para benchmarks) — se
// mockean como "pass-through" (llaman al fetcher recibido) para que el
// símbolo del scan siga llegando a fetchYahooChart/fetchYahooProfile igual
// que antes de docs/adr-scan-desde-base.md, sin tener que rediseñar estos
// tests.
vi.mock("@/lib/dailyBarsCache", () => ({
  withDailyBarsCache: vi.fn(async (symbol, options, fetcher) => fetcher(symbol, options)),
}));
vi.mock("@/lib/fundamentalsCache", () => ({
  withProfileCache: vi.fn(async (symbol, options, fetcher) => fetcher(symbol, options)),
}));

// buildResearchRow sintetiza una fila cuya rsRating depende de si el benchmark
// local está en `benchmarks`. Aquí solo nos importa que se llame con el map de
// benchmarks completo; reflejamos benchmarkSymbol para inspeccionarlo.
vi.mock("@/lib/researchRow", () => ({
  BENCHMARK_SYMBOLS: ["SPY", "QQQ", "ACWI"],
  buildResearchRow: vi.fn((symbol, _chart, _profile, _opts, benchmarks) => ({
    symbol,
    companyName: symbol,
    country: symbol.includes(".") ? symbol.split(".").pop() : "US",
    sector: "Technology",
    industry: "Software",
    theme: "Technology",
    price: 100,
    sma50: 95,
    sma150: 90,
    sma200: 85,
    sma200Slope: 0.3,
    distance52w: -5,
    perf3m: 8,
    perf6m: 15,
    perf12m: 25,
    chartBarsCount: 260,
    totalScore: 70,
    rsGlobalPct: 75,
    rsRating: benchmarks && Object.keys(benchmarks).length > 3 ? 80 : null,
    benchmarkSymbol: symbol.includes(".MC") ? "^IBEX" : symbol.includes(".DE") ? "^GDAXI" : symbol.includes(".T") ? "^N225" : "SPY",
    rsQualityScore: 70,
    setupDisplayPlanValid: true,
    dataCoverageScore: 80,
  })),
}));

vi.mock("@/lib/scansApiCache", () => ({ clearScansApiCache: vi.fn() }));

vi.mock("@/lib/supabaseServer", () => ({
  supabaseRequest: vi.fn(async () => []),
  // patchScan (lib/serverScanRunner.js) llama a esta RPC para persistir el
  // progreso (docs/timeout-scan-universo-2026-08-09.md); este archivo no
  // inspecciona el progreso, solo necesita que la RPC no crashee.
  supabaseRpc: vi.fn(async () => [{ id: "irrelevant", row_count: 0, updated_at: new Date().toISOString() }]),
  finiteOrNull: (v) => (Number.isFinite(v) ? v : null),
  textOrNull: (v) => (v == null ? null : String(v)),
}));

vi.mock("@/lib/scanPercentileFinalization", () => ({
  finalizeScanResultsInDb: vi.fn(async () => ({ rowsProcessed: 0, rowsPatched: 0 })),
}));

vi.mock("@/lib/screenerPipeline", () => ({
  sectorize: vi.fn((rows) => (Array.isArray(rows) ? rows : [])),
}));

vi.mock("@/lib/internalAuth", () => ({ internalFetchHeaders: vi.fn(() => ({})) }));

import { runScanChunk } from "@/lib/serverScanRunner";
import { supabaseRequest } from "@/lib/supabaseServer";
import { fetchYahooChart } from "@/lib/marketData";
import { buildResearchRow } from "@/lib/researchRow";

const SCAN_ID = "scan-bench-uuid";
const OWNER_ID = "owner-bench";
const BASE_URL = "http://localhost";

function snapshotWith(symbols) {
  return {
    settings: {
      owner_id: OWNER_ID,
      scanSymbols: symbols,
      progress: { status: "running", cursor: 0, chunkSize: symbols.length, completed: 0, total: symbols.length, link: 0 },
    },
    row_count: 0,
  };
}

function configureSnapshotOnce(snapshot) {
  supabaseRequest.mockImplementationOnce(async () => [snapshot]);
  supabaseRequest.mockResolvedValue([]);
}

// Conjunto de símbolos que recibe fetchYahooChart (incluye acciones + benchmarks).
function fetchedSymbols() {
  return fetchYahooChart.mock.calls.map(([s]) => s);
}

describe("loadBenchmarks · hidrata benchmarks locales para mercados no-US", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.clearAllMocks(); });

  it("scan con fila española (.MC) hidrata ^IBEX además de SPY/QQQ/ACWI", async () => {
    const snapshot = snapshotWith(["SAN.MC", "AAPL"]);
    configureSnapshotOnce(snapshot);

    await runScanChunk({ scanId: SCAN_ID, ownerId: OWNER_ID, baseUrl: BASE_URL });

    const fetched = fetchedSymbols();
    // Los 3 globales siempre se hidratan.
    expect(fetched).toContain("SPY");
    expect(fetched).toContain("QQQ");
    expect(fetched).toContain("ACWI");
    // ^IBEX es el benchmark local para España (.MC → ES).
    expect(fetched).toContain("^IBEX");
    // buildResearchRow recibió el map con ^IBEX presente.
    const benchmarksArg = buildResearchRow.mock.calls[0]?.[4] || {};
    expect(benchmarksArg["^IBEX"]).toBeTruthy();
  });

  it("scan multi-mercado deduplica y añade ^IBEX, ^GDAXI, ^N225", async () => {
    // SAN.MC/BBVA.MC → ES → ^IBEX (deduplica las dos); SAP.DE/SIE.DE → DE → ^GDAXI; 7203.T → JP → ^N225.
    const snapshot = snapshotWith(["SAN.MC", "BBVA.MC", "SAP.DE", "SIE.DE", "7203.T"]);
    configureSnapshotOnce(snapshot);

    await runScanChunk({ scanId: SCAN_ID, ownerId: OWNER_ID, baseUrl: BASE_URL });

    const fetched = fetchedSymbols();
    expect(fetched).toContain("^IBEX");
    expect(fetched).toContain("^GDAXI");
    expect(fetched).toContain("^N225");
    // ^IBEX aparece una sola vez pese a dos símbolos españoles (deduplicación).
    expect(fetched.filter((s) => s === "^IBEX")).toHaveLength(1);
    expect(fetched.filter((s) => s === "^GDAXI")).toHaveLength(1);
  });

  it("scan solo-US NO hidrata benchmarks locales (no sobre-fetch)", async () => {
    const inputs = ["AAPL", "MSFT", "NVDA"];
    const snapshot = snapshotWith(inputs);
    configureSnapshotOnce(snapshot);

    await runScanChunk({ scanId: SCAN_ID, ownerId: OWNER_ID, baseUrl: BASE_URL });

    const fetched = fetchedSymbols();
    expect(fetched).toContain("SPY");
    expect(fetched).toContain("QQQ");
    expect(fetched).toContain("ACWI");
    // Fuera de los 3 globales y los símbolos de input (acciones propias), no
    // debe quedar ningún benchmark local hidratado — no sobre-fetch.
    const locals = fetched.filter((s) => !["SPY", "QQQ", "ACWI"].includes(s) && !inputs.includes(s));
    expect(locals).toEqual([]);
  });

  it("si un benchmark local falla al hidratarse, NO tumba el scan (degrada a bars:[])", async () => {
    // ^IBEX lanza; el resto OK. El scan debe completar sin lanzar.
    fetchYahooChart.mockImplementation(async (symbol) => {
      if (symbol === "^IBEX") throw new Error("proveedor caído");
      return { bars: Array.from({ length: 260 }, (_, i) => ({ close: 100 + i })), meta: { symbol } };
    });
    const snapshot = snapshotWith(["SAN.MC", "AAPL"]);
    configureSnapshotOnce(snapshot);

    // No debe lanzar — la degradación es silenciosa a bars:[].
    await expect(runScanChunk({ scanId: SCAN_ID, ownerId: OWNER_ID, baseUrl: BASE_URL })).resolves.toBeUndefined();

    const benchmarksArg = buildResearchRow.mock.calls[0]?.[4] || {};
    // ^IBEX está en el map pero con bars vacías (degradación, no ausencia).
    expect(benchmarksArg["^IBEX"]).toBeTruthy();
    expect((benchmarksArg["^IBEX"].bars || []).length).toBe(0);
  });
});
