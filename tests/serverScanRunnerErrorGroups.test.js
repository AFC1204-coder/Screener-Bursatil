// Tests de integración de lib/serverScanRunner.js — el progreso persistido
// lleva los errores AGRUPADOS POR MOTIVO, no una entrada por símbolo.
//
// Contexto (docs/timeout-scan-universo-2026-08-09.md, segunda causa): el array
// progress.errors viaja entero en cada latido del bucle de progreso (cada
// ~1,5-3 s). Con el formato plano y el tope de 300 entradas, el mismo texto
// largo de `reason` se repetía en cientos de entradas — ~48 KiB reescritos
// cada dos segundos, y el escaneo de "todo el universo" (10.234 símbolos)
// murió en el 2.222 con el timeout de Postgres al guardar el progreso.
//
// Lo que fijan estos tests, sobre el runner real (no sobre el agregador
// aislado, que ya cubre tests/scanErrorGroups.test.js):
//   · lo que se persiste son grupos { reason, kind, status, count, symbols },
//   · progress.errorsTotal lleva el recuento entero,
//   · completeness.errors (contrato de lib/scanStatus.js) sigue siendo el
//     número real de símbolos fallidos, no el número de grupos,
//   · el encadenamiento entre eslabones no pierde el recuento.
//
// Mismo patrón de mocks que serverScanRunnerFinalization.test.js.

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

import { MAX_STORED_ERROR_GROUPS, MAX_SYMBOLS_PER_ERROR_GROUP } from "@/lib/scanErrorGroups";
import { runScanChunk } from "@/lib/serverScanRunner";
import { supabaseRequest, supabaseRpc } from "@/lib/supabaseServer";
import { finalizeScanResultsInDb } from "@/lib/scanPercentileFinalization";
import { fetchYahooChart } from "@/lib/marketData";

const SCAN_ID = "scan-error-groups-uuid";
const OWNER_ID = "owner-error-groups";
const BASE_URL = "http://localhost";

// El motivo real del incidente de producción. classifyProviderError
// (lib/scanErrors.js) lo clasifica como "unknown": su patrón terminal exige
// "sin historico", y este texto dice "historico insuficiente".
const NO_HISTORY = "Yahoo historico insuficiente · Stooq fallback sin STOOQ_API_KEY · Alpha Vantage sin ALPHA_VANTAGE_API_KEY";
const NO_HISTORY_KIND = "unknown";

function snapshotFor({ total, chunkSize, cursor = 0, rowCount = 0, progressExtra = {} }) {
  const symbols = Array.from({ length: total }, (_, i) => `SYM${i + 1}`);
  return {
    settings: {
      owner_id: OWNER_ID,
      scanSymbols: symbols,
      progress: { status: "running", cursor, chunkSize, completed: cursor, total, link: 0, ...progressExtra },
    },
    row_count: rowCount,
  };
}

function configureSnapshotOnce(snapshot) {
  supabaseRequest.mockImplementationOnce(async () => [snapshot]);
  supabaseRequest.mockResolvedValue([]);
}

function progressPatches() {
  return supabaseRpc.mock.calls
    .filter(([fn]) => fn === "scan_progress_patch")
    .map(([, payload]) => payload?.p_progress)
    .filter(Boolean);
}

// Lanza el mismo error para TODOS los símbolos salvo los exentos.
function failEveryChartWith(message, { except = new Set() } = {}) {
  fetchYahooChart.mockImplementation(async (symbol) => {
    if (except.has(symbol) || ["SPY", "QQQ", "ACWI"].includes(symbol)) return { bars: [], meta: {} };
    throw new Error(message);
  });
}

describe("runScanChunk · errores agrupados por motivo en progress.errors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabaseRpc.mockResolvedValue([{ updated_count: 0 }]);
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("40 símbolos con el mismo motivo → UN grupo con count 40 y 20 símbolos de ejemplo", async () => {
    failEveryChartWith(NO_HISTORY);
    configureSnapshotOnce(snapshotFor({ total: 40, chunkSize: 40 }));
    finalizeScanResultsInDb.mockResolvedValue({ rowsProcessed: 0, rowsPatched: 0 });

    await runScanChunk({ scanId: SCAN_ID, ownerId: OWNER_ID, baseUrl: BASE_URL });

    const terminal = progressPatches().find((p) => ["complete", "partial", "failed"].includes(p.status));
    expect(terminal).toBeTruthy();
    expect(terminal.errors).toHaveLength(1);
    expect(terminal.errors[0]).toMatchObject({ reason: NO_HISTORY, kind: NO_HISTORY_KIND, count: 40 });
    expect(terminal.errors[0].symbols).toHaveLength(MAX_SYMBOLS_PER_ERROR_GROUP);
    // El recuento entero se conserva aunque solo se guarden 20 ejemplos.
    expect(terminal.errorsTotal).toBe(40);
    // Y el contrato de completitud sigue viendo 40 fallos, no 1 grupo.
    expect(terminal.completeness.errors).toBe(40);
    expect(terminal.completeness.saved).toBe(0);
  });

  it("motivos distintos producen grupos distintos y el total sigue siendo la suma", async () => {
    fetchYahooChart.mockImplementation(async (symbol) => {
      if (["SPY", "QQQ", "ACWI"].includes(symbol)) return { bars: [], meta: {} };
      const index = Number(symbol.replace("SYM", ""));
      if (index <= 6) throw new Error(NO_HISTORY);
      if (index <= 9) throw new Error("Yahoo chart HTTP 429");
      return { bars: [], meta: {} };
    });
    configureSnapshotOnce(snapshotFor({ total: 10, chunkSize: 10 }));
    finalizeScanResultsInDb.mockResolvedValue({ rowsProcessed: 1, rowsPatched: 1 });

    await runScanChunk({ scanId: SCAN_ID, ownerId: OWNER_ID, baseUrl: BASE_URL });

    const terminal = progressPatches().find((p) => ["complete", "partial", "failed"].includes(p.status));
    expect(terminal.errors).toHaveLength(2);
    const byReason = Object.fromEntries(terminal.errors.map((g) => [g.reason, g]));
    expect(byReason[NO_HISTORY].count).toBe(6);
    expect(byReason["Yahoo chart HTTP 429"]).toMatchObject({ count: 3, kind: "retryable", status: 429 });
    expect(terminal.errorsTotal).toBe(9);
    expect(terminal.completeness.errors).toBe(9);
    // El kindBreakdown, que se calcula aparte, sigue coherente con los grupos.
    expect(terminal.completeness.kindBreakdown.retryable).toBe(3);
    expect(terminal.completeness.kindBreakdown[NO_HISTORY_KIND]).toBe(6);
  });

  it("más motivos distintos que el tope: se guardan MAX_STORED_ERROR_GROUPS grupos, el total no pierde ninguno", async () => {
    const total = MAX_STORED_ERROR_GROUPS + 12;
    fetchYahooChart.mockImplementation(async (symbol) => {
      if (["SPY", "QQQ", "ACWI"].includes(symbol)) return { bars: [], meta: {} };
      throw new Error(`Motivo distinto para ${symbol}`);
    });
    configureSnapshotOnce(snapshotFor({ total, chunkSize: total }));
    finalizeScanResultsInDb.mockResolvedValue({ rowsProcessed: 0, rowsPatched: 0 });

    await runScanChunk({ scanId: SCAN_ID, ownerId: OWNER_ID, baseUrl: BASE_URL });

    const terminal = progressPatches().find((p) => ["complete", "partial", "failed"].includes(p.status));
    expect(terminal.errors).toHaveLength(MAX_STORED_ERROR_GROUPS);
    expect(terminal.errorsTotal).toBe(total);
    expect(terminal.completeness.errors).toBe(total);
  });

  it("el eslabón siguiente rehidrata grupos y total del anterior en vez de empezar de cero", async () => {
    // Estado dejado por un eslabón previo: 300 fallos ya contados, agrupados.
    const previousProgress = {
      errors: [{ reason: NO_HISTORY, kind: NO_HISTORY_KIND, status: null, count: 300, symbols: ["OLD1", "OLD2"] }],
      errorsTotal: 300,
    };
    failEveryChartWith(NO_HISTORY);
    configureSnapshotOnce(snapshotFor({ total: 5, chunkSize: 5, progressExtra: previousProgress }));
    finalizeScanResultsInDb.mockResolvedValue({ rowsProcessed: 0, rowsPatched: 0 });

    await runScanChunk({ scanId: SCAN_ID, ownerId: OWNER_ID, baseUrl: BASE_URL });

    const terminal = progressPatches().find((p) => ["complete", "partial", "failed"].includes(p.status));
    expect(terminal.errors).toHaveLength(1);
    expect(terminal.errors[0].count).toBe(305);
    expect(terminal.errorsTotal).toBe(305);
    expect(terminal.completeness.errors).toBe(305);
  });

  it("un scan que venía con el formato plano antiguo se convierte a grupos sin perder el recuento", async () => {
    const legacyEntries = Array.from({ length: 7 }, (_, i) => ({
      symbol: `OLD${i}`,
      reason: NO_HISTORY,
      kind: NO_HISTORY_KIND,
      status: null,
    }));
    failEveryChartWith(NO_HISTORY);
    configureSnapshotOnce(snapshotFor({ total: 3, chunkSize: 3, progressExtra: { errors: legacyEntries } }));
    finalizeScanResultsInDb.mockResolvedValue({ rowsProcessed: 0, rowsPatched: 0 });

    await runScanChunk({ scanId: SCAN_ID, ownerId: OWNER_ID, baseUrl: BASE_URL });

    const terminal = progressPatches().find((p) => ["complete", "partial", "failed"].includes(p.status));
    expect(terminal.errors).toHaveLength(1);
    expect(terminal.errors[0].count).toBe(10);
    expect(terminal.errorsTotal).toBe(10);
  });

  it("el progreso persistido no repite el texto del motivo una vez por símbolo", async () => {
    // La propiedad que motivó el cambio: el payload que viaja en cada latido
    // debe contener el texto largo UNA vez por motivo, no una vez por símbolo.
    failEveryChartWith(NO_HISTORY);
    configureSnapshotOnce(snapshotFor({ total: 60, chunkSize: 60 }));
    finalizeScanResultsInDb.mockResolvedValue({ rowsProcessed: 0, rowsPatched: 0 });

    await runScanChunk({ scanId: SCAN_ID, ownerId: OWNER_ID, baseUrl: BASE_URL });

    for (const patch of progressPatches()) {
      const serialized = JSON.stringify(patch.errors || []);
      const occurrences = serialized.split("Yahoo historico insuficiente").length - 1;
      expect(occurrences).toBeLessThanOrEqual(1);
    }
  });
});
