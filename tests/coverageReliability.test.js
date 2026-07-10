import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabaseServer", () => ({
  supabaseConfig: vi.fn(() => ({ configured: true, ownerId: "owner-test", missing: [] })),
  supabaseRpc: vi.fn(async () => { throw new Error("PGRST202 coverage_scan_summary missing"); }),
}));
vi.mock("@/lib/dataProviders", () => ({ providerStatus: vi.fn(() => []) }));
vi.mock("@/lib/env", () => ({ envValue: vi.fn(() => ""), hasEnvValue: vi.fn(() => false) }));
vi.mock("@/lib/universeEngine", () => ({
  getUniverseEngineSnapshot: vi.fn(async () => ({
    markets: ["CA"],
    totalBeforeGate: 250,
    excludedCount: 0,
    coverage: { byMarket: { CA: 250 }, bySource: {}, bySourceByMarket: {} },
    providerDiagnostics: { byMarket: {} },
    cache: { status: "hit" },
  })),
}));

import { buildCoverageReport } from "@/lib/coveragePlan";

describe("coverage degradation contract", () => {
  it("eleva un fallo de la RPC al nivel superior y no presenta los ceros como informe completo", async () => {
    const report = await buildCoverageReport({ markets: ["CA"] });
    console.log(`[COVERAGE-RPC-MISSING] status=${report.status} degraded=${report.degraded} scanStatus=${report.scanCoverage.status} scanned=${report.summary.scannedSymbols}`);
    expect(report).toMatchObject({
      status: "partial-scan-coverage",
      degraded: true,
      scanCoverage: { status: "error", uniqueSymbols: 0 },
    });
    expect(report.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: "high", area: "scan-coverage" }),
    ]));
  });
});
