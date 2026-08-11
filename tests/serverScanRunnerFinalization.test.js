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
// buildResearchRow porque también la mockeamos abajo. Los helpers `failChartFor`
// y `chartFailures` aplican en runtime para forzar fallos por símbolo.
vi.mock("@/lib/marketData", () => ({
  fetchYahooChart: vi.fn(async () => ({ bars: [], meta: {} })),
  fetchYahooProfile: vi.fn(async () => ({})),
}));

// dailyBarsCache/fundamentalsCache: withDailyBarsCache/withProfileCache son
// las funciones que runScanChunk usa ahora para leer barras/perfil
// (docs/adr-scan-desde-base.md) — el mismo patrón que ya usa el cron. El mock
// por defecto es un "pass-through": llama al fetcher recibido (fetchYahooChart/
// fetchYahooProfile, mockeados abajo) igual que haría la función real en un
// cache-miss. Los tests que necesitan simular un cache-HIT sobrescriben la
// implementación para no invocar el fetcher.
vi.mock("@/lib/dailyBarsCache", () => ({
  withDailyBarsCache: vi.fn(async (symbol, options, fetcher) => fetcher(symbol, options)),
}));
vi.mock("@/lib/fundamentalsCache", () => ({
  withProfileCache: vi.fn(async (symbol, options, fetcher) => fetcher(symbol, options)),
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
import { withDailyBarsCache } from "@/lib/dailyBarsCache";
import { withProfileCache } from "@/lib/fundamentalsCache";

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

// Extrae, en orden, los objetos progress persistidos. patchScan
// (lib/serverScanRunner.js) ya no hace un PATCH REST con `settings` completo
// — llama a la RPC scan_progress_patch con el progress solo (ver
// docs/timeout-scan-universo-2026-08-09.md), así que se leen desde
// supabaseRpc, no desde supabaseRequest.
function progressPatches() {
  return supabaseRpc.mock.calls
    .filter(([fn]) => fn === "scan_progress_patch")
    .map(([, payload]) => payload?.p_progress)
    .filter(Boolean);
}

// Configura fallos por símbolo en fetchYahooChart. `failureMap` mapea símbolo
// → mensaje de error. El mock global retorna siempre OK por defecto; este
// helper instala una implementación alternativa que lanza para los símbolos
// mapeados y deja pasar al resto.
function failChartFor(failureMap = {}) {
  fetchYahooChart.mockImplementation(async (symbol) => {
    if (Object.hasOwn(failureMap, symbol)) {
      throw new Error(failureMap[symbol]);
    }
    return { bars: [], meta: {} };
  });
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

  it("emite un log estructurado si ni siquiera puede leer el estado inicial", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    supabaseRequest.mockRejectedValueOnce(new Error("database unavailable probe"));

    await runScanChunk({ scanId: SCAN_ID, ownerId: OWNER_ID, baseUrl: BASE_URL });

    expect(log).toHaveBeenCalledWith(
      "[scan-runner] no se pudo leer el estado inicial",
      expect.objectContaining({ scanId: SCAN_ID, ownerId: OWNER_ID, error: "database unavailable probe" }),
    );
    log.mockRestore();
  });

  it("al completar el último batch: invoca finalizeScanResultsInDb una vez con scanId+ownerId correctos", async () => {
    // Scan de 3 símbolos, chunkSize=3 → 1 solo eslabón que completa todo.
    const snapshot = snapshotFor(SCAN_ID, OWNER_ID, { total: 3, chunkSize: 3 });
    configureSnapshotOnce(snapshot);
    finalizeScanResultsInDb.mockResolvedValue({ rowsProcessed: 3, rowsPatched: 3 });

    await runScanChunk({ scanId: SCAN_ID, ownerId: OWNER_ID, baseUrl: BASE_URL });

    // Exactamente una invocación, con los IDs correctos. Un tercer argumento
    // (onBatchProgress, para reportar el avance de las tandas de escritura —
    // ver lib/serverScanRunner.js) es el único extra permitido.
    expect(finalizeScanResultsInDb).toHaveBeenCalledTimes(1);
    expect(finalizeScanResultsInDb).toHaveBeenCalledWith(
      SCAN_ID,
      OWNER_ID,
      expect.objectContaining({ onBatchProgress: expect.any(Function) }),
    );
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

  it("éxito (todo OK): progress pasa por finalizationStatus 'pending' → 'succeeded' + percentilesFinalized:true, status terminal 'complete' (no 'done')", async () => {
    const snapshot = snapshotFor(SCAN_ID, OWNER_ID, { total: 3, chunkSize: 3 });
    configureSnapshotOnce(snapshot);
    finalizeScanResultsInDb.mockResolvedValue({ rowsProcessed: 3, rowsPatched: 3 });

    await runScanChunk({ scanId: SCAN_ID, ownerId: OWNER_ID, baseUrl: BASE_URL });

    const patches = progressPatches();
    // Esperamos al menos 2 PATCH de progress durante la rama terminal:
    //   1. "finalizing" + finalizationStatus:"pending"
    //   2. "complete" (ratio=1, errores=0) + finalizationStatus:"succeeded" + percentilesFinalized:true
    const finalizingPatch = patches.find((p) => p.status === "finalizing");
    const completePatch = patches.find((p) => p.status === "complete");
    expect(finalizingPatch).toBeTruthy();
    expect(finalizingPatch.finalizationStatus).toBe("pending");
    expect(finalizingPatch.percentilesFinalized).toBe(false);

    expect(completePatch).toBeTruthy();
    expect(completePatch.finalizationStatus).toBe("succeeded");
    expect(completePatch.percentilesFinalized).toBe(true);
    expect(completePatch.finalizationRowsPatched).toBe(3);

    // Métrica de completitud persistida.
    expect(completePatch.completeness).toBeTruthy();
    expect(completePatch.completeness.saved).toBe(3);
    expect(completePatch.completeness.errors).toBe(0);
    expect(completePatch.completeness.ratio).toBe(1);
    expect(completePatch.completeness.kindBreakdown).toEqual({ retryable: 0, terminal: 0, unknown: 0 });

    // "done" legado NUNCA debe aparecer — el runner nuevo lo prohibe.
    expect(patches.find((p) => p.status === "done")).toBeUndefined();

    // ORDEN TEMPORAL: "finalizing" debe aparecer ANTES que "complete".
    const finalizingIdx = patches.findIndex((p) => p.status === "finalizing");
    const completeIdx = patches.findIndex((p) => p.status === "complete");
    expect(finalizingIdx).toBeGreaterThanOrEqual(0);
    expect(finalizingIdx).toBeLessThan(completeIdx);
  });

  it("status terminal (complete|partial|failed) NO se escribe antes de que finalizeScanResultsInDb se resuelva", async () => {
    // Patrón de defer controlable: finalizeScanResultsInDb queda pendiente hasta
    // que liberemos `releaseFinalize`. Mientras está pendiente, verificamos que
    // ningún PATCH con status completo o partial o failed se ha emitido.
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

    // Mientras finalizeScanResultsInDb está pendiente, NO debe haber ningún estado terminal de completitud.
    const patchesBeforeResolve = progressPatches();
    expect(patchesBeforeResolve.find((p) => p.status === "complete")).toBeUndefined();
    expect(patchesBeforeResolve.find((p) => p.status === "partial")).toBeUndefined();
    expect(patchesBeforeResolve.find((p) => p.status === "failed")).toBeUndefined();
    expect(patchesBeforeResolve.find((p) => p.status === "done")).toBeUndefined();
    // El "finalizing" sí debe estar ya escrito.
    expect(patchesBeforeResolve.find((p) => p.status === "finalizing")).toBeTruthy();

    // Liberamos la finalización y dejamos terminar.
    releaseFinalize();
    await chunkPromise;

    const patchesAfter = progressPatches();
    expect(patchesAfter.find((p) => p.status === "complete")).toBeTruthy();
  });

  it("fallo del RPC: progress termina con finalizationStatus:'failed', percentilesFinalized:false, finalizationError con el mensaje, status:'error' (ni 'complete' ni 'failed')", async () => {
    const snapshot = snapshotFor(SCAN_ID, OWNER_ID, { total: 3, chunkSize: 3 });
    configureSnapshotOnce(snapshot);
    const errorMsg = "DB rollback simulado";
    finalizeScanResultsInDb.mockRejectedValue(new Error(errorMsg));

    await runScanChunk({ scanId: SCAN_ID, ownerId: OWNER_ID, baseUrl: BASE_URL });

    const patches = progressPatches();
    const finalizingPatch = patches.find((p) => p.status === "finalizing");
    const errorPatch = patches.find((p) => p.status === "error");

    expect(finalizingPatch).toBeTruthy();
    expect(finalizingPatch.finalizationStatus).toBe("pending");

    expect(errorPatch).toBeTruthy();
    expect(errorPatch.finalizationStatus).toBe("failed");
    expect(errorPatch.percentilesFinalized).toBe(false);
    expect(errorPatch.finalizationError).toBe(errorMsg);
    expect(errorPatch.error).toContain("percentile finalization failed");

    // CRÍTICO: cuando la RPC falla, NINGÚN terminal de completitud se escribe.
    // El status es "error" (runtime); el cómputo de ratio no se aplica.
    expect(patches.find((p) => p.status === "complete")).toBeUndefined();
    expect(patches.find((p) => p.status === "partial")).toBeUndefined();
    expect(patches.find((p) => p.status === "failed")).toBeUndefined();
    expect(patches.find((p) => p.status === "done")).toBeUndefined();

    // ORDEN: "finalizing" antes que "error".
    const finalizingIdx = patches.findIndex((p) => p.status === "finalizing");
    const errorIdx = patches.findIndex((p) => p.status === "error");
    expect(finalizingIdx).toBeLessThan(errorIdx);
  });

  it("fallo A MITAD de la escritura en tandas: persiste cuántas filas/tandas ya quedaron finalizadas, NUNCA 'succeeded'", async () => {
    // Simula lo que lib/scanPercentileFinalization.js#finalizeScanResultsInDb
    // lanza cuando una tanda falla tras otras ya comprometidas (ver sus propios
    // tests en tests/scanFinalizeInputs.test.js): un Error con propiedades
    // adicionales rowsPatched/rowsTotal/batchesDone/batchesTotal.
    const snapshot = snapshotFor(SCAN_ID, OWNER_ID, { total: 3, chunkSize: 3 });
    configureSnapshotOnce(snapshot);
    const partialError = new Error("percentile finalization failed at batch 4/10 (300/992 filas ya finalizadas): DB timeout");
    partialError.rowsProcessed = 992;
    partialError.rowsPatched = 300;
    partialError.rowsTotal = 992;
    partialError.batchesDone = 3;
    partialError.batchesTotal = 10;
    finalizeScanResultsInDb.mockRejectedValue(partialError);

    await runScanChunk({ scanId: SCAN_ID, ownerId: OWNER_ID, baseUrl: BASE_URL });

    const patches = progressPatches();
    const errorPatch = patches.find((p) => p.status === "error");

    expect(errorPatch).toBeTruthy();
    // NUNCA succeeded/percentilesFinalized:true con tandas pendientes — pase lo
    // que pase, si finalizeScanResultsInDb lanza, esto queda en false/"failed".
    expect(errorPatch.finalizationStatus).toBe("failed");
    expect(errorPatch.percentilesFinalized).toBe(false);
    // Y el progreso real (no un "falló" opaco) queda persistido.
    expect(errorPatch.finalizationRowsPatched).toBe(300);
    expect(errorPatch.finalizationRowsTotal).toBe(992);
    expect(errorPatch.finalizationBatchesDone).toBe(3);
    expect(errorPatch.finalizationBatchesTotal).toBe(10);
    expect(errorPatch.finalizationError).toContain("300/992");

    expect(patches.find((p) => p.status === "complete")).toBeUndefined();
    expect(patches.find((p) => p.status === "partial")).toBeUndefined();
    expect(patches.find((p) => p.status === "failed")).toBeUndefined();
  });

  it("fallo SIN información de tandas (p.ej. la lectura scan_finalize_inputs falló, antes de escribir nada): los campos de progreso quedan null, no undefined ni NaN", async () => {
    const snapshot = snapshotFor(SCAN_ID, OWNER_ID, { total: 3, chunkSize: 3 });
    configureSnapshotOnce(snapshot);
    finalizeScanResultsInDb.mockRejectedValue(new Error("scan_finalize_inputs timeout"));

    await runScanChunk({ scanId: SCAN_ID, ownerId: OWNER_ID, baseUrl: BASE_URL });

    const errorPatch = progressPatches().find((p) => p.status === "error");
    expect(errorPatch.finalizationStatus).toBe("failed");
    expect(errorPatch.finalizationRowsPatched).toBeNull();
    expect(errorPatch.finalizationRowsTotal).toBeNull();
    expect(errorPatch.finalizationBatchesDone).toBeNull();
    expect(errorPatch.finalizationBatchesTotal).toBeNull();
  });

  it("reporta el progreso INTERMEDIO de la finalización (finalizationStatus:'in_progress') sin marcarla terminal, antes del PATCH final de éxito", async () => {
    // finalizeScanResultsInDb real invoca options.onBatchProgress tras cada
    // tanda de escritura (ver lib/scanPercentileFinalization.js). Este mock
    // simula esa llamada para probar el WIRING en runScanChunk, no la lógica
    // de troceo en sí (ya cubierta en tests/scanFinalizeInputs.test.js).
    const snapshot = snapshotFor(SCAN_ID, OWNER_ID, { total: 3, chunkSize: 3 });
    configureSnapshotOnce(snapshot);
    finalizeScanResultsInDb.mockImplementation(async (scanId, ownerId, options) => {
      // Con FINALIZE_PROGRESS_PATCH_EVERY=10, solo la ÚLTIMA tanda de un run
      // de 3 dispara un PATCH real (las intermedias quedan throttled) — ver
      // el comentario de onFinalizeBatchProgress en lib/serverScanRunner.js.
      options.onBatchProgress({ batchesDone: 1, batchesTotal: 3, rowsPatched: 100, rowsTotal: 280 });
      options.onBatchProgress({ batchesDone: 2, batchesTotal: 3, rowsPatched: 200, rowsTotal: 280 });
      options.onBatchProgress({ batchesDone: 3, batchesTotal: 3, rowsPatched: 280, rowsTotal: 280 });
      return { rowsProcessed: 280, rowsPatched: 280, batchesTotal: 3, batchesDone: 3 };
    });

    await runScanChunk({ scanId: SCAN_ID, ownerId: OWNER_ID, baseUrl: BASE_URL });

    const patches = progressPatches();
    const inProgressPatches = patches.filter((p) => p.finalizationStatus === "in_progress");
    // Throttle: de las 3 llamadas a onBatchProgress, solo la última (isLast)
    // se persiste — no una por tanda.
    expect(inProgressPatches).toHaveLength(1);
    expect(inProgressPatches[0]).toMatchObject({
      status: "finalizing",
      percentilesFinalized: false,
      finalizationBatchesDone: 3,
      finalizationBatchesTotal: 3,
      finalizationRowsPatched: 280,
    });

    // Nunca terminal mientras es "in_progress" — y aparece ANTES del PATCH
    // final de éxito.
    const inProgressIdx = patches.findIndex((p) => p.finalizationStatus === "in_progress");
    const completeIdx = patches.findIndex((p) => p.status === "complete");
    expect(completeIdx).toBeGreaterThan(inProgressIdx);
  });

  it("ALERTA: todos los proveedores fallan → terminal 'failed' (no 'done'/'complete'). Reproduce audit §Terminal done can mean zero rows", async () => {
    // Caso original del hallazgo del audit 2026-07-10: si los 3 providers
    // fallan, el status reportado debe ser 'failed', no 'done' ni 'complete'.
    failChartFor({ SYM1: "Yahoo chart HTTP 500", SYM2: "Yahoo chart HTTP 503", SYM3: "Yahoo chart HTTP 429" });
    const snapshot = snapshotFor(SCAN_ID, OWNER_ID, { total: 3, chunkSize: 3 });
    configureSnapshotOnce(snapshot);
    finalizeScanResultsInDb.mockResolvedValue({ rowsProcessed: 0, rowsPatched: 0 });

    await runScanChunk({ scanId: SCAN_ID, ownerId: OWNER_ID, baseUrl: BASE_URL });

    const patches = progressPatches();
    // El status terminal del último PATCH debe ser 'failed' (no 'done' ni 'complete').
    const completePatch = patches.find((p) => p.status === "complete");
    const partialPatch = patches.find((p) => p.status === "partial");
    const failedPatch = patches.find((p) => p.status === "failed");
    const donePatch = patches.find((p) => p.status === "done");

    expect(completePatch).toBeUndefined();
    expect(partialPatch).toBeUndefined();
    expect(donePatch).toBeUndefined();

    expect(failedPatch).toBeTruthy();
    expect(failedPatch.finalizationStatus).toBe("succeeded");
    expect(failedPatch.percentilesFinalized).toBe(true);
    // Métrica: 0 guardados / 3 errores → ratio 0, no publicable.
    expect(failedPatch.completeness).toEqual(expect.objectContaining({
      saved: 0,
      errors: 3,
      ratio: 0,
    }));
    // El kindBreakdown clasifica 3 errores como "retryable" (5xx/429 son retryable).
    expect(failedPatch.completeness.kindBreakdown.retryable).toBe(3);
  });

  it("caso mixto: 7 OK y 3 fallan (de un scan de 10 en 1 eslabón) → terminal 'partial' con degraded-ready", async () => {
    // 7/10 = 0.7 → partial. Se publica en leaderboards con degraded=true.
    failChartFor({
      SYM2: "Yahoo chart HTTP 503",
      SYM5: "Yahoo chart HTTP 404", // terminal
      SYM9: "Sin resultado Yahoo",  // terminal
    });
    const snapshot = snapshotFor(SCAN_ID, OWNER_ID, { total: 10, chunkSize: 10 });
    configureSnapshotOnce(snapshot);
    finalizeScanResultsInDb.mockResolvedValue({ rowsProcessed: 7, rowsPatched: 7 });

    await runScanChunk({ scanId: SCAN_ID, ownerId: OWNER_ID, baseUrl: BASE_URL });

    const patches = progressPatches();
    const completePatch = patches.find((p) => p.status === "complete");
    const failedPatch = patches.find((p) => p.status === "failed");
    const partialPatch = patches.find((p) => p.status === "partial");

    expect(completePatch).toBeUndefined();
    expect(failedPatch).toBeUndefined();

    expect(partialPatch).toBeTruthy();
    expect(partialPatch.finalizationStatus).toBe("succeeded");
    expect(partialPatch.percentilesFinalized).toBe(true);
    expect(partialPatch.completeness.saved).toBe(7);
    expect(partialPatch.completeness.errors).toBe(3);
    expect(partialPatch.completeness.ratio).toBeCloseTo(0.7, 5);
    expect(partialPatch.completeness.kindBreakdown.retryable).toBe(1); // 503
    expect(partialPatch.completeness.kindBreakdown.terminal).toBe(2);  // 404 + sin-resultado
  });

  it("caso degenerado: 0 símbolos procesados (cancel inmediato) → 'failed' (no 'complete')", async () => {
    // saved=0 y errors=0 → falla seguro como failed por decisión del contrato.
    const snapshot = snapshotFor(SCAN_ID, OWNER_ID, { total: 0, chunkSize: 3 });
    configureSnapshotOnce(snapshot);
    finalizeScanResultsInDb.mockResolvedValue({ rowsProcessed: 0, rowsPatched: 0 });

    await runScanChunk({ scanId: SCAN_ID, ownerId: OWNER_ID, baseUrl: BASE_URL });

    const patches = progressPatches();
    const completePatch = patches.find((p) => p.status === "complete");
    const failedPatch = patches.find((p) => p.status === "failed");
    expect(completePatch).toBeUndefined();
    expect(failedPatch).toBeTruthy();
    expect(failedPatch.completeness.saved).toBe(0);
    expect(failedPatch.completeness.errors).toBe(0);
    expect(failedPatch.completeness.ratio).toBe(0);
  });

  it("la finalización de percentiles NUNCA llama a supabaseRpc directamente desde runScanChunk (va vía finalizeScanResultsInDb)", async () => {
    // El wiring de la finalización llama a finalizeScanResultsInDb, no a
    // supabaseRpc directamente para "finalize_scan_results"/"scan_finalize_inputs".
    // Esto protege contra un refactor futuro que omita el wrapper.
    //
    // runScanChunk SÍ llama a supabaseRpc directamente para persistir el
    // progreso (RPC scan_progress_patch, patchScan en lib/serverScanRunner.js —
    // docs/timeout-scan-universo-2026-08-09.md) — eso es intencional y distinto
    // de la finalización, así que aquí solo comprobamos que ninguna llamada a
    // supabaseRpc use el nombre de función de la finalización.
    const snapshot = snapshotFor(SCAN_ID, OWNER_ID, { total: 3, chunkSize: 3 });
    configureSnapshotOnce(snapshot);
    finalizeScanResultsInDb.mockResolvedValue({ rowsProcessed: 3, rowsPatched: 3 });

    await runScanChunk({ scanId: SCAN_ID, ownerId: OWNER_ID, baseUrl: BASE_URL });

    const rpcFunctionNames = supabaseRpc.mock.calls.map(([fn]) => fn);
    expect(rpcFunctionNames).not.toContain("finalize_scan_results");
    expect(rpcFunctionNames).not.toContain("scan_finalize_inputs");
    expect(finalizeScanResultsInDb).toHaveBeenCalledTimes(1);
  });
});

// Lectura desde la base en vez de descarga (docs/adr-scan-desde-base.md,
// docs/cobertura-base-2026-08-09.md): el scan interactivo ahora lee barras y
// perfil vía withDailyBarsCache/withProfileCache (el mismo patrón que ya usa
// el cron) en vez de llamar a fetchYahooChart/fetchYahooProfile directamente.
// Estos tests verifican las dos rutas: caché-hit (no toca Yahoo) y
// caché-miss (cae a la descarga en vivo a través de la misma función).
describe("runScanChunk · lee de la base, cae a descarga solo si falta", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchYahooChart.mockResolvedValue({ bars: [{ date: "2026-08-08", close: 100 }], meta: { symbol: "SYM1" } });
    fetchYahooProfile.mockResolvedValue({ name: "Symbol One", sector: "Technology" });
    // Pass-through por defecto (cache-miss simulado): cada test de "hit"
    // sobrescribe esto para NO invocar el fetcher.
    withDailyBarsCache.mockImplementation(async (symbol, options, fetcher) => fetcher(symbol, options));
    withProfileCache.mockImplementation(async (symbol, options, fetcher) => fetcher(symbol, options));
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("pide cada símbolo del eslabón a withDailyBarsCache/withProfileCache, no a Yahoo directamente", async () => {
    const snapshot = snapshotFor(SCAN_ID, OWNER_ID, { total: 1, chunkSize: 1 });
    configureSnapshotOnce(snapshot);
    finalizeScanResultsInDb.mockResolvedValue({ rowsProcessed: 1, rowsPatched: 1 });

    await runScanChunk({ scanId: SCAN_ID, ownerId: OWNER_ID, baseUrl: BASE_URL });

    expect(withDailyBarsCache).toHaveBeenCalledWith(
      "SYM1",
      expect.objectContaining({ range: "2A", interval: "D", maxAgeDays: 5 }),
      fetchYahooChart,
    );
    expect(withProfileCache).toHaveBeenCalledWith(
      "SYM1",
      expect.objectContaining({ maxAgeDays: 14 }),
      fetchYahooProfile,
    );
  });

  it("cache-HIT: si withDailyBarsCache/withProfileCache resuelven sin llamar al fetcher, Yahoo nunca se toca", async () => {
    const cachedChart = { bars: [{ date: "2026-08-07", close: 55 }], meta: { symbol: "SYM1", dataProvider: "StatsEdge daily_bars cache" } };
    const cachedProfile = { name: "Symbol One (cached)", sector: "Industrials" };
    // Simulan un hit real: NO invocan el tercer argumento (fetcher).
    withDailyBarsCache.mockImplementation(async () => cachedChart);
    withProfileCache.mockImplementation(async () => cachedProfile);
    const snapshot = snapshotFor(SCAN_ID, OWNER_ID, { total: 1, chunkSize: 1 });
    configureSnapshotOnce(snapshot);
    finalizeScanResultsInDb.mockResolvedValue({ rowsProcessed: 1, rowsPatched: 1 });

    await runScanChunk({ scanId: SCAN_ID, ownerId: OWNER_ID, baseUrl: BASE_URL });

    // fetchYahooChart SÍ se llama para los benchmarks globales (SPY/QQQ/ACWI,
    // loadBenchmarks — fuera del alcance de este cambio, ver comentario en
    // lib/serverScanRunner.js), pero NUNCA para el símbolo del scan (SYM1):
    // ese vino del cache-hit simulado arriba, no de Yahoo.
    expect(fetchYahooChart).not.toHaveBeenCalledWith("SYM1");
    expect(fetchYahooProfile).not.toHaveBeenCalled();
    expect(buildResearchRow).toHaveBeenCalledWith("SYM1", cachedChart, cachedProfile, expect.any(Object), expect.any(Object));
  });

  it("cache-MISS: si withDailyBarsCache cae a la descarga (pass-through), SÍ llama a fetchYahooChart", async () => {
    // El mock por defecto de beforeEach ya es pass-through (simula el
    // comportamiento real de un miss). Solo confirmamos que, en ese caso,
    // el fetcher (Yahoo) SÍ se invoca.
    const snapshot = snapshotFor(SCAN_ID, OWNER_ID, { total: 1, chunkSize: 1 });
    configureSnapshotOnce(snapshot);
    finalizeScanResultsInDb.mockResolvedValue({ rowsProcessed: 1, rowsPatched: 1 });

    await runScanChunk({ scanId: SCAN_ID, ownerId: OWNER_ID, baseUrl: BASE_URL });

    expect(fetchYahooChart).toHaveBeenCalledWith("SYM1", expect.objectContaining({ range: "2A", interval: "D", maxAgeDays: 5 }));
    expect(fetchYahooProfile).toHaveBeenCalledWith("SYM1", expect.objectContaining({ maxAgeDays: 14 }));
  });

  it("un fallo de withProfileCache (ni caché ni Yahoo) no tumba el scan — degrada a perfil vacío", async () => {
    withProfileCache.mockRejectedValue(new Error("fundamental_snapshots read failed"));
    const snapshot = snapshotFor(SCAN_ID, OWNER_ID, { total: 1, chunkSize: 1 });
    configureSnapshotOnce(snapshot);
    finalizeScanResultsInDb.mockResolvedValue({ rowsProcessed: 1, rowsPatched: 1 });

    await runScanChunk({ scanId: SCAN_ID, ownerId: OWNER_ID, baseUrl: BASE_URL });

    const patches = progressPatches();
    expect(patches.find((p) => p.status === "complete")).toBeTruthy();
    expect(patches.find((p) => p.status === "error")).toBeUndefined();
    expect(buildResearchRow).toHaveBeenCalledWith("SYM1", expect.any(Object), {}, expect.any(Object), expect.any(Object));
  });

  it("un fallo de withDailyBarsCache (ni caché ni Yahoo) se clasifica como error de ESE símbolo, no tumba el scan", async () => {
    // A diferencia del perfil, la falta de barras SÍ impide construir la fila
    // (buildResearchRow las necesita) — mismo comportamiento que ya tenía
    // fetchYahooChart antes de este cambio: el símbolo cae a state.errors,
    // el resto del eslabón sigue.
    withDailyBarsCache.mockRejectedValue(new Error("daily_bars read failed"));
    const snapshot = snapshotFor(SCAN_ID, OWNER_ID, { total: 1, chunkSize: 1 });
    configureSnapshotOnce(snapshot);
    finalizeScanResultsInDb.mockResolvedValue({ rowsProcessed: 0, rowsPatched: 0 });

    await runScanChunk({ scanId: SCAN_ID, ownerId: OWNER_ID, baseUrl: BASE_URL });

    const patches = progressPatches();
    // 0 guardados / 1 error → "failed" por el contrato de completitud, pero
    // NO "error" de runtime — el fallo quedó contenido al símbolo.
    expect(patches.find((p) => p.status === "error")).toBeUndefined();
    const terminal = patches.find((p) => ["complete", "partial", "failed"].includes(p.status));
    expect(terminal).toBeTruthy();
    expect(buildResearchRow).not.toHaveBeenCalled();
  });
});
