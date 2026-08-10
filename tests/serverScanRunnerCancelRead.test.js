// Tests de lib/serverScanRunner.js#readCancelRequested — la lectura del flag
// de cancelación dentro del bucle de progreso.
//
// Contexto (docs/timeout-tres-minutos-2026-08-10.md): esa lectura pedía
// `select=settings`, es decir la columna JSON entera con settings.scanSymbols
// dentro (los 10.000 símbolos del universo, ~84 KB medidos), PARA LEER UN
// BOOLEANO. Y se ejecuta dos veces por vuelta del bucle, unas 170 veces en una
// corrida del universo completo. El escaneo moría tras un agujero de 21-22 s
// sin poder escribir nada, y esta era la operación candidata principal.
//
// Lo que fijan estos tests:
//   1. la lectura del flag NO pide la columna `settings` entera,
//   2. pide exactamente la ruta JSON del booleano,
//   3. el flag se sigue interpretando bien con el shape nuevo de respuesta
//      (regresión crítica: si el runner siguiera leyendo scan.settings.progress
//      el botón "Detener" dejaría de funcionar en silencio),
//   4. el string "false" no se interpreta como true (Boolean("false") === true),
//   5. el snapshot inicial del eslabón SÍ puede pedir `settings` — necesita
//      scanSymbols de verdad.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/marketData", () => ({
  fetchYahooChart: vi.fn(async () => ({ bars: [], meta: {} })),
  fetchYahooProfile: vi.fn(async () => ({})),
}));

vi.mock("@/lib/dailyBarsCache", () => ({
  withDailyBarsCache: vi.fn(async (symbol, options, fetcher) => fetcher(symbol, options)),
}));
vi.mock("@/lib/fundamentalsCache", () => ({
  withProfileCache: vi.fn(async (symbol, options, fetcher) => fetcher(symbol, options)),
}));

vi.mock("@/lib/researchRow", () => ({
  BENCHMARK_SYMBOLS: ["SPY", "QQQ", "ACWI"],
  buildResearchRow: vi.fn((symbol) => ({
    symbol,
    companyName: symbol,
    country: "US",
    sector: "Technology",
    industry: "Software",
    theme: "Technology",
    price: 100,
    sma50: 95,
    sma150: 90,
    sma200: 85,
    sma200Slope: 0.3,
    chartBarsCount: 260,
    totalScore: 70,
    rsGlobalPct: 75,
    rsRating: 75,
  })),
}));

vi.mock("@/lib/scansApiCache", () => ({
  clearScansApiCache: vi.fn(),
}));

vi.mock("@/lib/supabaseServer", () => ({
  supabaseRequest: vi.fn(async () => []),
  supabaseRpc: vi.fn(async () => [{ updated_count: 0 }]),
  finiteOrNull: (v) => (Number.isFinite(v) ? v : null),
  textOrNull: (v) => (v == null ? null : String(v)),
}));

vi.mock("@/lib/scanPercentileFinalization", () => ({
  finalizeScanResultsInDb: vi.fn(async () => ({ rowsProcessed: 0, rowsPatched: 0 })),
}));

vi.mock("@/lib/screenerPipeline", () => ({
  sectorize: vi.fn((rows) => (Array.isArray(rows) ? rows : [])),
}));

vi.mock("@/lib/internalAuth", () => ({
  internalFetchHeaders: vi.fn(() => ({})),
}));

import { runScanChunk } from "@/lib/serverScanRunner";
import { supabaseRequest, supabaseRpc } from "@/lib/supabaseServer";
import { finalizeScanResultsInDb } from "@/lib/scanPercentileFinalization";

const SCAN_ID = "scan-cancel-read-uuid";
const OWNER_ID = "owner-cancel-read";
const BASE_URL = "http://localhost";

function snapshotFor({ total = 40, chunkSize = 40 } = {}) {
  return {
    settings: {
      owner_id: OWNER_ID,
      scanSymbols: Array.from({ length: total }, (_, i) => `UNIVSYM${i}`),
      progress: { status: "running", cursor: 0, chunkSize, completed: 0, total, link: 0 },
    },
    row_count: 0,
  };
}

// Todas las lecturas GET a `scans`. La primera es el snapshot del eslabón; el
// resto son las de readCancelRequested.
function scansReadQueries() {
  return supabaseRequest.mock.calls
    .filter(([path, options]) => path === "scans" && (!options?.method || options.method === "GET"))
    .map(([, options]) => String(options?.query || ""));
}

function cancelReadQueries() {
  return scansReadQueries().slice(1);
}

// Responde el snapshot a la 1ª lectura y `cancelPayload` a todas las demás
// lecturas de `scans`; [] al resto de llamadas (DELETE/POST).
function configureReads(snapshot, cancelPayload = [{ cancelRequested: false }]) {
  let scansReads = 0;
  supabaseRequest.mockImplementation(async (path, options) => {
    if (path === "scans" && (!options?.method || options.method === "GET")) {
      scansReads += 1;
      return scansReads === 1 ? [snapshot] : cancelPayload;
    }
    return [];
  });
}

describe("readCancelRequested · no arrastra la columna settings entera", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabaseRpc.mockResolvedValue([{ updated_count: 0 }]);
    finalizeScanResultsInDb.mockResolvedValue({ rowsProcessed: 0, rowsPatched: 0 });
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("REGRESIÓN: ninguna lectura del flag pide `select=settings` a secas", async () => {
    configureReads(snapshotFor());

    await runScanChunk({ scanId: SCAN_ID, ownerId: OWNER_ID, baseUrl: BASE_URL });

    const queries = cancelReadQueries();
    expect(queries.length).toBeGreaterThan(0);
    for (const query of queries) {
      // `select=settings` seguido de fin de campo (& o fin de cadena) es
      // exactamente la forma que arrastraba los 10.000 símbolos.
      expect(query).not.toMatch(/select=settings(&|$)/);
      expect(query).not.toMatch(/select=settings,/);
    }
  });

  it("pide exactamente la ruta JSON del booleano, no un objeto intermedio", async () => {
    configureReads(snapshotFor());

    await runScanChunk({ scanId: SCAN_ID, ownerId: OWNER_ID, baseUrl: BASE_URL });

    for (const query of cancelReadQueries()) {
      expect(query).toContain("select=cancelRequested:settings->progress->cancelRequested");
      // Ni siquiera el objeto progress entero: progress lleva dentro el array
      // de errores y crece durante la corrida.
      expect(query).not.toMatch(/select=[^&]*settings->progress(&|,|$)/);
    }
  });

  it("el snapshot inicial del eslabón SÍ puede pedir settings — necesita scanSymbols", async () => {
    configureReads(snapshotFor());

    await runScanChunk({ scanId: SCAN_ID, ownerId: OWNER_ID, baseUrl: BASE_URL });

    const [snapshotQuery] = scansReadQueries();
    expect(snapshotQuery).toContain("select=settings,row_count");
  });

  it("REGRESIÓN: con el shape nuevo, cancelRequested:true sigue cancelando el scan", async () => {
    // Si el runner siguiera leyendo scan.settings.progress.cancelRequested de
    // una respuesta que ya no trae `settings`, el flag sería siempre false y el
    // botón "Detener" dejaría de funcionar sin que nada fallara.
    configureReads(snapshotFor({ total: 40, chunkSize: 40 }), [{ cancelRequested: true }]);

    await runScanChunk({ scanId: SCAN_ID, ownerId: OWNER_ID, baseUrl: BASE_URL });

    const statuses = supabaseRpc.mock.calls
      .filter(([fn]) => fn === "scan_progress_patch")
      .map(([, payload]) => payload?.p_progress?.status);
    expect(statuses).toContain("cancelled");
  });

  it("el string \"false\" NO se toma por true (Boolean(\"false\") === true)", async () => {
    configureReads(snapshotFor({ total: 40, chunkSize: 40 }), [{ cancelRequested: "false" }]);

    await runScanChunk({ scanId: SCAN_ID, ownerId: OWNER_ID, baseUrl: BASE_URL });

    const statuses = supabaseRpc.mock.calls
      .filter(([fn]) => fn === "scan_progress_patch")
      .map(([, payload]) => payload?.p_progress?.status);
    expect(statuses).not.toContain("cancelled");
    expect(statuses.some((status) => ["complete", "partial", "failed"].includes(status))).toBe(true);
  });

  it("un scan sin el campo (respuesta null) no se cancela solo", async () => {
    configureReads(snapshotFor({ total: 40, chunkSize: 40 }), [{ cancelRequested: null }]);

    await runScanChunk({ scanId: SCAN_ID, ownerId: OWNER_ID, baseUrl: BASE_URL });

    const statuses = supabaseRpc.mock.calls
      .filter(([fn]) => fn === "scan_progress_patch")
      .map(([, payload]) => payload?.p_progress?.status);
    expect(statuses).not.toContain("cancelled");
  });
});
