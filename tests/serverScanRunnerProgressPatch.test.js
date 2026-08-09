// Tests de lib/serverScanRunner.js#patchScan — el PATCH de progreso.
//
// Contexto (docs/timeout-scan-universo-2026-08-09.md): el bucle de progreso
// hacía, cada ~1,5-3s durante todo el eslabón, un PATCH REST a `scans` con
// body `{...settings, progress: {...}}` — reescribía la columna `settings`
// COMPLETA, incluida settings.scanSymbols (la lista de símbolos del universo
// pedido, invariante desde que se crea el scan). Medido contra un scan real:
// settings completo pesaba 59.688 bytes, 44.575 (75%) solo scanSymbols. Con
// "todo el universo" (~10.000 símbolos) ese payload se retransmitía entero
// varias veces por minuto durante toda la corrida — candidata principal al
// "canceling statement due to statement timeout" observado.
//
// El fix: patchScan ahora llama a la RPC scan_progress_patch (merge del lado
// de Postgres vía jsonb_set), transmitiendo SOLO `progress` — nunca
// scanSymbols. Si esa RPC todavía no está desplegada (PostgREST responde
// 404), degrada al PATCH completo de antes (con scanSymbols, para no romper
// el scan) — cualquier otro error se propaga tal cual.
//
// Patrón de mocks: igual que serverScanRunnerFinalization.test.js.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/marketData", () => ({
  fetchYahooChart: vi.fn(async () => ({ bars: [], meta: {} })),
  fetchYahooProfile: vi.fn(async () => ({})),
}));

vi.mock("@/lib/dailyBarsCache", () => ({
  writeDailyBarsCache: vi.fn(async () => ({ status: "supabase", written: true, count: 0 })),
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
    distance52w: -5,
    perf3m: 8,
    perf6m: 15,
    perf12m: 25,
    chartBarsCount: 260,
    totalScore: 70,
    rsGlobalPct: 75,
    rsRating: 75,
    rsQualityScore: 70,
    setupDisplayPlanValid: true,
    dataCoverageScore: 80,
  })),
}));

vi.mock("@/lib/scansApiCache", () => ({
  clearScansApiCache: vi.fn(),
}));

vi.mock("@/lib/supabaseServer", () => ({
  supabaseRequest: vi.fn(async () => []),
  supabaseRpc: vi.fn(async () => [{ id: "scan-id", row_count: 0, updated_at: new Date().toISOString() }]),
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

const SCAN_ID = "scan-progress-uuid";
const OWNER_ID = "owner-progress";
const BASE_URL = "http://localhost";

// Universo "grande" simulado: suficientes símbolos para que, si scanSymbols se
// colara en el PATCH de progreso, sea trivial detectarlo por tamaño/contenido.
function bigSnapshot({ total = 500, chunkSize = 500, cursor = 0, rowCount = 0 } = {}) {
  const symbols = Array.from({ length: total }, (_, i) => `UNIVSYM${i}`);
  return {
    settings: {
      owner_id: OWNER_ID,
      scanSymbols: symbols,
      progress: { status: "running", cursor, chunkSize, completed: cursor, total, link: 0 },
    },
    row_count: rowCount,
  };
}

function configureSnapshotOnce(snapshot) {
  supabaseRequest.mockImplementationOnce(async () => [snapshot]);
  supabaseRequest.mockResolvedValue([]);
}

describe("patchScan · el latido de progreso no retransmite scanSymbols", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabaseRpc.mockResolvedValue([{ id: SCAN_ID, row_count: 0, updated_at: new Date().toISOString() }]);
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("cada llamada a supabaseRpc('scan_progress_patch', ...) lleva SOLO progress — sin scanSymbols", async () => {
    const snapshot = bigSnapshot({ total: 500, chunkSize: 500 });
    configureSnapshotOnce(snapshot);
    finalizeScanResultsInDb.mockResolvedValue({ rowsProcessed: 500, rowsPatched: 500 });

    await runScanChunk({ scanId: SCAN_ID, ownerId: OWNER_ID, baseUrl: BASE_URL });

    const progressPatchCalls = supabaseRpc.mock.calls.filter(([fn]) => fn === "scan_progress_patch");
    expect(progressPatchCalls.length).toBeGreaterThan(0);
    for (const [, payload] of progressPatchCalls) {
      expect(payload).not.toHaveProperty("p_progress.scanSymbols");
      expect(payload.p_progress?.scanSymbols).toBeUndefined();
      // Chequeo más fuerte que solo la clave "scanSymbols": progress.currentSymbol
      // SÍ lleva legítimamente un símbolo suelto (para mostrar "Analizando X"),
      // pero la LISTA completa del universo (los 500 símbolos) nunca debe
      // viajar — como mucho una referencia (currentSymbol), nunca un array.
      const serialized = JSON.stringify(payload);
      const symbolMatches = serialized.match(/UNIVSYM\d+/g) || [];
      expect(symbolMatches.length).toBeLessThanOrEqual(1);
      // Los campos correctos SÍ viajan: id, owner, progreso, row_count.
      expect(payload.p_id).toBe(SCAN_ID);
      expect(payload.p_owner_id).toBe(OWNER_ID);
      expect(payload.p_progress).toHaveProperty("status");
      expect(payload.p_progress).toHaveProperty("cursor");
    }
  });

  it("nunca hace un PATCH REST directo a scans mientras la RPC funciona (el camino caro queda sin usar)", async () => {
    const snapshot = bigSnapshot({ total: 500, chunkSize: 500 });
    configureSnapshotOnce(snapshot);
    finalizeScanResultsInDb.mockResolvedValue({ rowsProcessed: 500, rowsPatched: 500 });

    await runScanChunk({ scanId: SCAN_ID, ownerId: OWNER_ID, baseUrl: BASE_URL });

    const scansPatchCalls = supabaseRequest.mock.calls.filter(
      ([path, opts]) => path === "scans" && opts?.method === "PATCH",
    );
    expect(scansPatchCalls).toHaveLength(0);
  });

  it("fallback (RPC no desplegada, 404): degrada al PATCH completo con scanSymbols, el scan no se rompe", async () => {
    const notFound = Object.assign(new Error("PGRST202: Could not find the function public.scan_progress_patch"), { status: 404 });
    supabaseRpc.mockRejectedValue(notFound);
    const snapshot = bigSnapshot({ total: 3, chunkSize: 3 });
    configureSnapshotOnce(snapshot);
    finalizeScanResultsInDb.mockResolvedValue({ rowsProcessed: 3, rowsPatched: 3 });

    await runScanChunk({ scanId: SCAN_ID, ownerId: OWNER_ID, baseUrl: BASE_URL });

    // El scan completó pese a que la RPC nueva no existe: el PATCH degradado
    // sí incluyó scanSymbols (necesario para no corromper el estado del scan).
    const scansPatchCalls = supabaseRequest.mock.calls.filter(
      ([path, opts]) => path === "scans" && opts?.method === "PATCH",
    );
    expect(scansPatchCalls.length).toBeGreaterThan(0);
    const [, opts] = scansPatchCalls.at(-1);
    expect(opts.body.settings.scanSymbols).toEqual(["UNIVSYM0", "UNIVSYM1", "UNIVSYM2"]);
    expect(opts.body.settings.progress.status).toBeTruthy();

    // El scan terminó en un estado terminal de éxito, no en "error" — el
    // fallback funcionó de punta a punta.
    const finalPatch = scansPatchCalls.at(-1)[1].body.settings.progress;
    expect(["complete", "partial", "failed"]).toContain(finalPatch.status);
  });

  it("un error de la RPC que NO es 404 (p.ej. timeout real) se propaga — no reintenta con un PATCH más pesado", async () => {
    const realTimeout = Object.assign(new Error("canceling statement due to statement timeout"), { status: 500 });
    supabaseRpc.mockRejectedValue(realTimeout);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const snapshot = bigSnapshot({ total: 3, chunkSize: 3 });
    configureSnapshotOnce(snapshot);

    await runScanChunk({ scanId: SCAN_ID, ownerId: OWNER_ID, baseUrl: BASE_URL });

    // Ni una sola vez se intentó el PATCH REST completo como reintento del
    // fallo de la RPC (sería reintentar con un payload todavía más pesado).
    const scansPatchCalls = supabaseRequest.mock.calls.filter(
      ([path, opts]) => path === "scans" && opts?.method === "PATCH",
    );
    expect(scansPatchCalls).toHaveLength(0);
    // El fallo queda registrado (dos intentos de patchScan fallan igual: el
    // del error original y el del catch exterior que intenta persistirlo).
    expect(log).toHaveBeenCalledWith(
      "[scan-runner] eslabón fallido",
      expect.objectContaining({ scanId: SCAN_ID, ownerId: OWNER_ID }),
    );
    expect(log).toHaveBeenCalledWith(
      "[scan-runner] no se pudo persistir el fallo",
      expect.objectContaining({ scanId: SCAN_ID, ownerId: OWNER_ID }),
    );
    log.mockRestore();
  });
});
