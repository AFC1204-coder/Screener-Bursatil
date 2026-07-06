// Tests de integración de lib/serverScanRunner.js#runScanChunk.
//
// Cubren el wiring del paso de finalización: que runScanChunk invoca
// finalizeScanResultsInDb exactamente una vez, al completar el último batch de
// scoring, y que escribe progress en el orden correcto:
//   pending (antes de invocar RPC) → succeeded + percentilesFinalized:true (éxito)
//   pending → failed + finalizationError (fallo)
// Y que status:"done" NUNCA se escribe antes de que la finalización se resuelva.
//
// patron: vi.mock por módulo. Mockeamos:
//   - @/lib/marketData (fetchYahooChart/Profile)
//   - @/lib/supabaseServer (supabaseRequest: snapshot, DELETE, POST batch, PATCH progress)
//   - @/lib/scanPercentileFinalization (finalizeScanResultsInDb)
//   - @/lib/scansApiCache (clearScansApiCache, no-op)
//   - @/lib/researchRow (buildResearchRow retorna fila sintética simple,
//     BENCHMARK_SYMBOLS=["SPY","QQQ","ACWI"])
//
// Esto aísla el wiring de finalization del scoring real (cubierto en otros tests).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks -----------------------------------------------------------------

// Mock mínimo de marketData: chart con bars vacío + profile vacío. No llega a
// buildResearchRow porque también la mockeamos abajo.
vi.mock("@/lib/marketData", () => ({
  fetchYahooChart: vi.fn(async () => ({ bars: [], meta: {} })),
  fetchYahooProfile: vi.fn(async () => ({})),
}));

// researchRow: buildResearchRow retorna fila sintética con campos mínimos para
// que scoreRowsForServerScan (sectorize) y resultPayload no exploten.
// BENCHMARK_SYMBOLS se exporta desde researchRow y lo usa loadBenchmarks().
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

// scansApiCache: no-op.
vi.mock("@/lib/scansApiCache", () => ({
  clearScansApiCache: vi.fn(),
}));

// supabaseServer: mock que captura TODAS las llamadas supabaseRequest para
// verificar el orden temporal de escrituras. La primera llamada es el snapshot
// GET; el resto son DELETE/POST/PATCH según el flujo. Retorna [] por defecto
// (suficiente para DELETE/POST/PATCH y para el snapshot inicial que
// desestructuramos como [snapshot]).
vi.mock("@/lib/supabaseServer", () => ({
  supabaseRequest: vi.fn(async () => []),
  supabaseRpc: vi.fn(async () => [{ updated_count: 0 }]),
  finiteOrNull: (v) => (Number.isFinite(v) ? v : null),
  textOrNull: (v) => (v == null ? null : String(v)),
}));

// finalizeScanResultsInDb: mockeado para controlar éxito/fallo sin tocar DB.
vi.mock("@/lib/scanPercentileFinalization", () => ({
  finalizeScanResultsInDb: vi.fn(async () => ({ rowsProcessed: 0, rowsPatched: 0 })),
}));

// screenerPipeline: sectorize pasa a través de filas ya scoreadas en el mock.
vi.mock("@/lib/screenerPipeline", () => ({
  sectorize: vi.fn((rows) => Array.isArray(rows) ? rows : []),
}));

// internalAuth: no-op.
vi.mock("@/lib/internalAuth", () => ({
  internalFetchHeaders: vi.fn(() => ({})),
}));

// Importamos DESPUÉS de los mocks para que runScanChunk use las versiones mock.
import { runScanChunk } from "@/lib/serverScanRunner";
import { supabaseRequest, supabaseRpc } from "@/lib/supabaseServer";
import { finalizeScanResultsInDb } from "@/lib/scanPercentileFinalization";
import { fetchYahooChart, fetchYahooProfile } from "@/lib/marketData";
import { buildResearchRow } from "@/lib/researchRow";

// --- Helpers ---------------------------------------------------------------

// Construye el snapshot inicial de un scan con N símbolos y chunkSize C.
// Para forzar 2 batches, usamos N=6, chunkSize=3 → 1er batch (3 símbolos),
// 2do batch (3 símbolos) → done. Pero runScanChunk procesa UN eslabón por
// invocación, así que para simular "2 batches" llamamos runScanChunk dos veces:
// la 1ra deja cursor=3 y progress.status="running" (re-encadena), la 2da
// procesa los últimos 3 y entra a la rama done.
function snapshotFor(scanId, ownerId, { total, chunkSize, cursor = 0, rowCount = 0, extra = {} }) {
  const symbols = Array.from({ length: total }, (_, i) => `SYM${i + 1}`);
  return {
    settings: {
      owner_id: ownerId,
      scanSymbols: symbols,
      progress: {
        status: "running",
        cursor,
        chunkSize,
        completed: cursor,
        total,
        link: 0,
      },
      ...extra,
    },
    row_count: rowCount,
  };
}

// El mock de supabaseRequest recibe un snapshot distinto según la invocación:
// - 1ra llamada (GET scans) → retorna [snapshot].
// - Resto (DELETE/POST/PATCH) → retorna [].
// Esto permite simular el snapshot inicial y luego las escrituras.
function configureSnapshotOnce(snapshot) {
  supabaseRequest.mockImplementationOnce(async () => [snapshot]);
  supabaseRequest.mockResolvedValue([]);
}

// Extrae, en orden, los bodies PATCH de `scans` (donde vive progress).
// Cada PATCH escribe { row_count, settings: { progress: {...} }, updated_at }.
function progressPatches() {
  return supabaseRequest.mock.calls
    .filter(([path, opts]) => path === "scans" && opts?.method === "PATCH")
    .map(([_, opts]) => opts.body?.settings?.progress)
    .filter(Boolean);
}

// --- Tests -----------------------------------------------------------------

const SCAN_ID = "scan-test-uuid";
const OWNER_ID = "owner-test";
const BASE_URL = "http://localhost";

describe("runScanChunk · wiring de finalización de percentiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("al completar el último batch: invoca finalizeScanResultsInDb una vez con scanId+ownerId correctos", async () => {
    // Scan de 3 símbolos, chunkSize=3 → 1 solo eslabón que completa todo.
    const snapshot = snapshotFor(SCAN_ID, OWNER_ID, { total: 3, chunkSize: 3 });
    configureSnapshotOnce(snapshot);
    finalizeScanResultsInDb.mockResolvedValue({ rowsProcessed: 3, rowsPatched: 3 });

    await runScanChunk({ scanId: SCAN_ID, ownerId: OWNER_ID, baseUrl: BASE_URL });

    // Exactamente una invocación, con los IDs correctos.
    expect(finalizeScanResultsInDb).toHaveBeenCalledTimes(1);
    expect(finalizeScanResultsInDb).toHaveBeenCalledWith(SCAN_ID, OWNER_ID);
  });

  it("no invoca finalizeScanResultsInDb en un batch intermedio (solo al completar)", async () => {
    // Scan de 15 símbolos, chunkSize=10 (clamp mínimo es MIN_SCAN_CHUNK_SIZE=10,
    // así que chunkSize<=10 se respeta). Este eslabón procesa los primeros 10
    // (cursor 0→10) y re-encadena porque quedan 5. finalizeScanResultsInDb no
    // debe invocarse.
    const snapshot = snapshotFor(SCAN_ID, OWNER_ID, { total: 15, chunkSize: 10 });
    configureSnapshotOnce(snapshot);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, json: async () => ({}) });

    await runScanChunk({ scanId: SCAN_ID, ownerId: OWNER_ID, baseUrl: BASE_URL });

    expect(finalizeScanResultsInDb).not.toHaveBeenCalled();
    // Re-encadenó al próximo eslabón.
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/api/scan/continue`,
      expect.objectContaining({ method: "POST" }),
    );
    fetchMock.mockRestore();
  });

  it("éxito: progress pasa por finalizationStatus 'pending' → 'succeeded' + percentilesFinalized:true, y status termina 'done'", async () => {
    const snapshot = snapshotFor(SCAN_ID, OWNER_ID, { total: 3, chunkSize: 3 });
    configureSnapshotOnce(snapshot);
    finalizeScanResultsInDb.mockResolvedValue({ rowsProcessed: 3, rowsPatched: 3 });

    await runScanChunk({ scanId: SCAN_ID, ownerId: OWNER_ID, baseUrl: BASE_URL });

    const patches = progressPatches();
    // Esperamos al menos 2 PATCH de progress durante la rama done:
    //   1. "finalizing" + finalizationStatus:"pending"
    //   2. "done" + finalizationStatus:"succeeded" + percentilesFinalized:true
    const finalizingPatch = patches.find((p) => p.status === "finalizing");
    const donePatch = patches.find((p) => p.status === "done");
    expect(finalizingPatch).toBeTruthy();
    expect(finalizingPatch.finalizationStatus).toBe("pending");
    expect(finalizingPatch.percentilesFinalized).toBe(false);

    expect(donePatch).toBeTruthy();
    expect(donePatch.finalizationStatus).toBe("succeeded");
    expect(donePatch.percentilesFinalized).toBe(true);
    expect(donePatch.finalizationRowsPatched).toBe(3);

    // ORDEN TEMPORAL: "finalizing" debe aparecer ANTES que "done" en la secuencia
    // de PATCHes (no basta con que ambos existan; el orden importa).
    const finalizingIdx = patches.findIndex((p) => p.status === "finalizing");
    const doneIdx = patches.findIndex((p) => p.status === "done");
    expect(finalizingIdx).toBeLessThan(doneIdx);
    expect(finalizingIdx).toBeGreaterThanOrEqual(0);
  });

  it("status 'done' NO se escribe antes de que finalizeScanResultsInDb se resuelva", async () => {
    // Patrón de defer controlable: finalizeScanResultsInDb queda pendiente hasta
    // que liberemos `releaseFinalize`. Mientras está pendiente, verificamos que
    // ningún PATCH con status:"done" se ha emitido.
    //
    // Nota: el writer del runner hace sleep(FLUSH_INTERVAL_MS=1500ms) entre
    // flushes, así que esperamos >1.5s reales para que el flujo llegue al await
    // de finalizeScanResultsInDb antes de soltar el defer.
    const snapshot = snapshotFor(SCAN_ID, OWNER_ID, { total: 3, chunkSize: 3 });
    configureSnapshotOnce(snapshot);
    let releaseFinalize;
    const finalizeStarted = new Promise((resolve) => { releaseFinalize = resolve; });
    let started = false;
    finalizeScanResultsInDb.mockImplementation(async () => {
      started = true;
      await finalizeStarted;
      return { rowsProcessed: 3, rowsPatched: 3 };
    });

    const chunkPromise = runScanChunk({ scanId: SCAN_ID, ownerId: OWNER_ID, baseUrl: BASE_URL });

    // Esperamos a que el flujo avance hasta el await de finalizeScanResultsInDb.
    // El writer duerme 1.5s entre flushes; damos 2s de margen.
    const startedWithin = new Promise((resolve) => {
      const t = setInterval(() => { if (started) { clearInterval(t); resolve(true); } }, 25);
      setTimeout(() => { clearInterval(t); resolve(false); }, 2500);
    });
    expect(await startedWithin).toBe(true);

    // Mientras finalizeScanResultsInDb está pendiente, no debe haber "done".
    const patchesBeforeResolve = progressPatches();
    const doneBefore = patchesBeforeResolve.find((p) => p.status === "done");
    expect(doneBefore).toBeUndefined();
    // El "finalizing" sí debe estar ya escrito.
    expect(patchesBeforeResolve.find((p) => p.status === "finalizing")).toBeTruthy();

    // Liberamos la finalización y dejamos terminar.
    releaseFinalize();
    await chunkPromise;

    const patchesAfter = progressPatches();
    expect(patchesAfter.find((p) => p.status === "done")).toBeTruthy();
  });

  it("fallo del RPC: progress termina con finalizationStatus:'failed', percentilesFinalized:false, finalizationError con el mensaje, status:'error' (no 'done')", async () => {
    const snapshot = snapshotFor(SCAN_ID, OWNER_ID, { total: 3, chunkSize: 3 });
    configureSnapshotOnce(snapshot);
    const errorMsg = "DB rollback simulado";
    finalizeScanResultsInDb.mockRejectedValue(new Error(errorMsg));

    await runScanChunk({ scanId: SCAN_ID, ownerId: OWNER_ID, baseUrl: BASE_URL });

    const patches = progressPatches();
    const finalizingPatch = patches.find((p) => p.status === "finalizing");
    const errorPatch = patches.find((p) => p.status === "error");
    const donePatch = patches.find((p) => p.status === "done");

    expect(finalizingPatch).toBeTruthy();
    expect(finalizingPatch.finalizationStatus).toBe("pending");

    expect(errorPatch).toBeTruthy();
    expect(errorPatch.finalizationStatus).toBe("failed");
    expect(errorPatch.percentilesFinalized).toBe(false);
    expect(errorPatch.finalizationError).toBe(errorMsg);
    expect(errorPatch.error).toContain("percentile finalization failed");

    // CRÍTICO: no debe haber ningún "done".
    expect(donePatch).toBeUndefined();

    // ORDEN: "finalizing" antes que "error".
    const finalizingIdx = patches.findIndex((p) => p.status === "finalizing");
    const errorIdx = patches.findIndex((p) => p.status === "error");
    expect(finalizingIdx).toBeLessThan(errorIdx);
  });

  it("supabaseRpc no se invoca directamente desde runScanChunk (va vía finalizeScanResultsInDb)", async () => {
    // El wiring del runner llama a finalizeScanResultsInDb, no a supabaseRpc
    // directamente. Esto protege contra un refactor futuro que omita el wrapper.
    const snapshot = snapshotFor(SCAN_ID, OWNER_ID, { total: 3, chunkSize: 3 });
    configureSnapshotOnce(snapshot);
    finalizeScanResultsInDb.mockResolvedValue({ rowsProcessed: 3, rowsPatched: 3 });

    await runScanChunk({ scanId: SCAN_ID, ownerId: OWNER_ID, baseUrl: BASE_URL });

    expect(supabaseRpc).not.toHaveBeenCalled();
    expect(finalizeScanResultsInDb).toHaveBeenCalledTimes(1);
  });
});