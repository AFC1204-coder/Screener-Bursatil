// F-A1 del ADR "Descubrimiento global curado" (docs/adr-discovery-global-curated.md §9).
//
// Contrato: los scans materializados persisten un estado terminal coherente en
// scans.settings.progress.status usando computeTerminalCompleteness, para que
// la RPC leaderboard_publishable_rows (parent_status ∈ complete|partial|done)
// deje de excluirlos por parent_status nulo. Invariantes de esta fase:
//   - percentilesFinalized es SIEMPRE false (percentiles del cron = por lote);
//   - ningún campo de scan_results cambia (scanResultPayload idéntico con y
//     sin progress en settings);
//   - la metadata previa de settings se conserva íntegra.
//
// Sin red, sin Supabase real: withDailyBarsCache/withProfileCache se mockean
// con fixtures deterministas y la regla de la RPC se replica en memoria.

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/dailyBarsCache", () => ({
  withDailyBarsCache: vi.fn(),
}));
vi.mock("@/lib/fundamentalsCache", () => ({
  withProfileCache: vi.fn(async () => ({})),
}));

import { withDailyBarsCache } from "@/lib/dailyBarsCache";
import {
  _forTest,
  materializedScanProgress,
  runMaterializedScan,
  scanResultPayload,
} from "@/lib/materializedScanner";
import { isPublicScanStatus, PUBLIC_SCAN_STATUSES } from "@/lib/scanStatus";

// ---------------------------------------------------------------------------
// Fixture: chart decision-grade con 260 barras diarias terminando hoy.
// Pasa baseRejectReason con defaults: >=180 barras, precio >= 1, turnover
// medio >= 250k (1M acciones * ~100), freshness 0d, cobertura >= 40.
// ---------------------------------------------------------------------------
function realChart(seed = 0) {
  const bars = [];
  const dayMs = 86400000;
  const today = Date.now();
  for (let i = 0; i < 260; i += 1) {
    const close = 60 + (260 - i) * 0.15 + seed;
    bars.push({
      date: new Date(today - i * dayMs).toISOString().slice(0, 10),
      open: close - 0.5,
      high: close + 1,
      low: close - 1,
      close,
      volume: 1_000_000,
      estimated: false,
    });
  }
  return { bars, meta: { regularMarketPrice: bars[0].close }, dataQuality: { status: "real" } };
}

const BENCHMARKS = new Set(["SPY", "QQQ", "ACWI"]);

function mockCharts({ failing = new Set() } = {}) {
  withDailyBarsCache.mockReset();
  withDailyBarsCache.mockImplementation(async (symbol) => {
    if (failing.has(symbol)) throw new Error(`proveedor caído para ${symbol}`);
    return realChart(BENCHMARKS.has(symbol) ? 5 : symbol.length);
  });
}

// Réplica en memoria del predicado de la RPC leaderboard_publishable_rows:
// parent_status = settings->'progress'->>'status'; publica solo si
// parent_status ∈ ('complete','partial','done'). NULL queda excluido.
function rpcParentStatus(scan) {
  return scan?.settings?.progress?.status ?? null;
}
function rpcWouldPublish(scan) {
  const status = rpcParentStatus(scan);
  return status !== null && PUBLIC_SCAN_STATUSES.includes(status);
}

describe("materializedScanProgress (contrato puro)", () => {
  it("run completo: todo ok => complete, percentilesFinalized false, shape exacta", () => {
    const analyzed = [
      { symbol: "AAA", ok: true, row: { symbol: "AAA" } },
      { symbol: "BBB", ok: true, row: { symbol: "BBB" } },
    ];
    const progress = materializedScanProgress({ analyzed, savedRows: 2, total: 2, finishedAt: "2026-07-16T00:00:00.000Z" });
    expect(progress).toEqual({
      status: "complete",
      completed: 2,
      total: 2,
      saved: 2,
      errors: 0,
      finishedAt: "2026-07-16T00:00:00.000Z",
      percentilesFinalized: false,
    });
  });

  it("errores duros con mayoría de guardadas => partial (ratio >= 0.5)", () => {
    const analyzed = [
      { symbol: "AAA", ok: true, row: {} },
      { symbol: "BAD", ok: false, rejection: "proveedor caído" },
    ];
    const progress = materializedScanProgress({ analyzed, savedRows: 1, total: 2, finishedAt: "x" });
    expect(progress.status).toBe("partial");
    expect(progress.saved).toBe(1);
    expect(progress.errors).toBe(1);
    expect(progress.percentilesFinalized).toBe(false);
  });

  it("errores en mayoría => failed; caso degenerado 0/0 => failed", () => {
    const failing = materializedScanProgress({
      analyzed: [
        { symbol: "A", ok: false, rejection: "x" },
        { symbol: "B", ok: false, rejection: "x" },
        { symbol: "C", ok: true, row: {} },
      ],
      savedRows: 1,
      total: 3,
      finishedAt: "x",
    });
    expect(failing.status).toBe("failed");
    const degenerate = materializedScanProgress({ analyzed: [], savedRows: 0, total: 0, finishedAt: "x" });
    expect(degenerate.status).toBe("failed");
    expect(degenerate.percentilesFinalized).toBe(false);
  });

  it("rechazos de política (item con row via baseRejectReason) NO cuentan como error", () => {
    const analyzed = [
      { symbol: "AAA", ok: true, row: {} },
      { symbol: "TINY", ok: false, rejection: "market cap bajo 1000000", row: { symbol: "TINY" } },
    ];
    const progress = materializedScanProgress({ analyzed, savedRows: 1, total: 2, finishedAt: "x" });
    expect(progress.status).toBe("complete");
    expect(progress.errors).toBe(0);
    expect(progress.completed).toBe(2);
  });
});

describe("baseRejectReason · marketCap ausente no se confunde con marketCap=0 (docs/inventario-dato-ausente-2026-08-01.md C15-C17)", () => {
  const passingRow = {
    price: 40,
    chartBarsCount: 260,
    priceFreshnessOk: true,
    avgTurnover: 1_000_000,
    dataCoverageScore: 90,
  };

  it("perfil sin marketCap (null) => NO rechaza por market cap", () => {
    const reason = _forTest.baseRejectReason({ ...passingRow, marketCap: null });
    expect(reason).toBe("");
  });

  it("marketCap real por debajo del umbral SÍ rechaza (guard sigue activo)", () => {
    const reason = _forTest.baseRejectReason({ ...passingRow, marketCap: 1000 });
    expect(reason).toBe("market cap bajo 1000");
  });
});

describe("paridad en memoria con la regla de leaderboard_publishable_rows", () => {
  it("scan materializado SIN progress.status => parent_status nulo => NO publicable", () => {
    const legacyScan = { settings: { source: "jobs/scan-refresh", markets: ["US"] } };
    expect(rpcParentStatus(legacyScan)).toBeNull();
    expect(rpcWouldPublish(legacyScan)).toBe(false);
    expect(isPublicScanStatus(rpcParentStatus(legacyScan))).toBe(false);
  });

  it("scan materializado con complete o partial => publicable; failed => no", () => {
    for (const status of ["complete", "partial"]) {
      const scan = { settings: { progress: { status, percentilesFinalized: false } } };
      expect(rpcWouldPublish(scan)).toBe(true);
      expect(isPublicScanStatus(status)).toBe(true);
    }
    const failedScan = { settings: { progress: { status: "failed", percentilesFinalized: false } } };
    expect(rpcWouldPublish(failedScan)).toBe(false);
    expect(isPublicScanStatus("failed")).toBe(false);
  });
});

describe("runMaterializedScan · wiring de progress (mocks, sin red ni Supabase)", () => {
  const baseOptions = {
    symbols: ["GOODA", "GOODB"],
    limit: 2,
    concurrency: 1,
    refreshLeaderboards: false,
  };

  it("run completo guarda progress.status complete y conserva la metadata previa", async () => {
    mockCharts();
    const result = await runMaterializedScan(baseOptions);
    const { settings } = result.scan;
    expect(settings.progress).toMatchObject({
      status: "complete",
      completed: 2,
      total: 2,
      saved: 2,
      errors: 0,
      percentilesFinalized: false,
    });
    expect(typeof settings.progress.finishedAt).toBe("string");
    expect(settings.progress.finishedAt).not.toBe("");
    // Metadata previa intacta (muestra representativa del shape existente).
    expect(settings.source).toBe("jobs/scan-refresh");
    expect(settings.legalMode).toBe("derived-signals-only");
    expect(settings.minBars).toBe(180);
    expect(settings.minAvgTurnover).toBe(250000);
    expect(Array.isArray(settings.markets)).toBe(true);
    expect(settings.screenerFilters).toBeDefined();
    // La regla de la RPC ahora lo publicaría.
    expect(rpcWouldPublish(result.scan)).toBe(true);
  });

  it("run parcial (un símbolo con proveedor caído) guarda partial", async () => {
    mockCharts({ failing: new Set(["BADX"]) });
    const result = await runMaterializedScan({ ...baseOptions, symbols: ["GOODA", "BADX"] });
    expect(result.scan.settings.progress.status).toBe("partial");
    expect(result.scan.settings.progress.saved).toBe(1);
    expect(result.scan.settings.progress.errors).toBe(1);
    expect(result.scan.settings.progress.percentilesFinalized).toBe(false);
    expect(rpcWouldPublish(result.scan)).toBe(true);
  });

  it("run fallido (todos los símbolos fallan) guarda failed => no publicable", async () => {
    mockCharts({ failing: new Set(["BADX", "BADY"]) });
    const result = await runMaterializedScan({ ...baseOptions, symbols: ["BADX", "BADY"] });
    expect(result.scan.settings.progress.status).toBe("failed");
    expect(result.scan.settings.progress.saved).toBe(0);
    expect(result.scan.settings.progress.errors).toBe(2);
    expect(result.scan.settings.progress.percentilesFinalized).toBe(false);
    expect(rpcWouldPublish(result.scan)).toBe(false);
  });

  it("scan_results no cambia: scanResultPayload es idéntico con y sin progress en settings", async () => {
    mockCharts();
    const result = await runMaterializedScan(baseOptions);
    const row = result.scan.rows[0];
    expect(row).toBeDefined();
    const settingsWithProgress = result.scan.settings;
    const settingsWithoutProgress = { ...settingsWithProgress };
    delete settingsWithoutProgress.progress;

    const before = scanResultPayload(row, "scan-test", "owner-test", 0, settingsWithoutProgress);
    const after = scanResultPayload(row, "scan-test", "owner-test", 0, settingsWithProgress);
    expect(after).toEqual(before);
    // Ninguna fuga de la metadata nueva hacia la fila persistida.
    const serialized = JSON.stringify(after);
    expect(serialized).not.toContain("percentilesFinalized");
    // El scope de percentil de la fila no se ve alterado por esta fase.
    expect(after.metrics.percentileScope ?? after.raw.percentileScope ?? "batch").toBe("batch");
  });
});
