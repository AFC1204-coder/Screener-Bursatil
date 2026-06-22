import { buildCoverageReport, CORE_COVERAGE_MARKETS, MARKET_COVERAGE_TARGETS } from "@/lib/coveragePlan";
import { normalizeMarketList } from "@/lib/markets";
import { buildShadowUniverseReport } from "@/lib/shadowUniverse";
import { marketSymbols } from "@/lib/universes";

const COVERAGE_RESPONSE_TIMEOUT_MS = Number(process.env.COVERAGE_RESPONSE_TIMEOUT_MS || 8500);
const COVERAGE_SCAN_MAX_ROWS = Number(process.env.COVERAGE_SCAN_MAX_ROWS || 4000);
const COVERAGE_SCAN_TIMEOUT_MS = Number(process.env.COVERAGE_SCAN_TIMEOUT_MS || 2500);

function timeoutAfter(ms, message) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), Math.max(500, Number(ms) || 0));
  });
}

function partialCoverageReport(markets = [], error = {}) {
  const normalizedMarkets = normalizeMarketList(markets, CORE_COVERAGE_MARKETS);
  const rows = normalizedMarkets.map((market, index) => {
    const target = MARKET_COVERAGE_TARGETS[market] || {};
    const targetCount = Number(target.investableTarget || 1);
    const current = marketSymbols(market).length;
    return {
      market,
      region: target.region || market,
      priority: target.priority || index + 1,
      sourceStatus: target.status || "unknown",
      current,
      currentMeaning: "curated_core_operational_fallback_not_full_inventory_claim",
      target: targetCount,
      coveragePct: Math.min(100, Math.round((current / Math.max(targetCount, 1)) * 100)),
      grade: "parcial",
      gap: Math.max(0, targetCount - current),
      inventory: { candidates: current, target: targetCount, coveragePct: Math.min(100, Math.round((current / Math.max(targetCount, 1)) * 100)), grade: "parcial", gap: Math.max(0, targetCount - current) },
      scan: {
        uniqueSymbols: 0,
        fresh: 0,
        qualityOk: 0,
        rankingEligible: 0,
        actionable: 0,
        scannedPct: 0,
        rankingEligiblePct: 0,
        actionablePct: 0,
        activationPct: 0,
        grade: "baja",
        gap: targetCount,
        actionableGap: targetCount,
      },
      activeSource: target.source || "unknown",
      nextAction: target.nextAction || "Reintentar coverage report con proveedores/caché disponibles.",
      readiness: { state: "operational-timeout", label: "Informe parcial", blocksCoverageClaim: true, detail: error.message || "Coverage excedio el presupuesto operativo." },
    };
  });
  const targetTotal = rows.reduce((sum, row) => sum + Number(row.target || 0), 0);
  const currentTotal = rows.reduce((sum, row) => sum + Number(row.current || 0), 0);
  return {
    generatedAt: new Date().toISOString(),
    degraded: true,
    status: "partial-timeout",
    objective: "Coverage report parcial para continuidad operativa.",
    measurementModel: {
      inventoryCandidates: "Fallback operativo: no representa inventario completo.",
      scannedFresh: "No calculado por timeout.",
      rankingEligible: "No calculado por timeout.",
      actionable: "No calculado por timeout.",
      defaultScanWindowDays: 45,
      defaultMaxPriceFreshnessDays: 5,
    },
    summary: {
      markets: rows.length,
      current: currentTotal,
      target: targetTotal,
      gap: Math.max(0, targetTotal - currentTotal),
      coveragePct: Math.round((currentTotal / Math.max(targetTotal, 1)) * 100),
      rankingEligibleCoveragePct: 0,
      actionableCoveragePct: 0,
    },
    scanCoverage: {
      status: "timeout",
      sinceDays: 45,
      maxPriceFreshnessDays: 5,
      minCoverageScore: 40,
      rowsRead: 0,
      uniqueSymbols: 0,
      fresh: 0,
      qualityOk: 0,
      rankingEligible: 0,
      actionable: 0,
      latestScanAt: "",
      error: error.message || "Coverage report timeout",
    },
    cache: null,
    providerReadiness: null,
    providerDiagnostics: null,
    blockers: [{ severity: "medium", area: "coverage-timeout", message: error.message || "Coverage excedio el presupuesto operativo; reintentar fuera de smoke." }],
    backfillPlan: { recommendedJobs: [] },
    regions: [],
    markets: rows,
    nextImplementation: [],
    legalLimits: [],
  };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const marketParam = searchParams.get("markets") || searchParams.get("market") || "";
  const markets = marketParam ? marketParam.split(",").map((item) => item.trim().toUpperCase()).filter(Boolean) : CORE_COVERAGE_MARKETS;
  const refresh = searchParams.get("refresh") === "1";
  const maxAgeHours = Math.max(1, Math.min(Number(searchParams.get("maxAgeHours") || 24), 168));
  const includeShadow = searchParams.get("includeShadow") === "1";
  const scanMaxRows = Math.max(100, Math.min(Number(searchParams.get("scanMaxRows") || COVERAGE_SCAN_MAX_ROWS), 20000));
  const scanTimeoutMs = Math.max(500, Math.min(Number(searchParams.get("scanTimeoutMs") || COVERAGE_SCAN_TIMEOUT_MS), 10000));
  try {
    const report = await Promise.race([
      buildCoverageReport({ markets, refresh, maxAgeHours, scanMaxRows, scanTimeoutMs }),
      timeoutAfter(COVERAGE_RESPONSE_TIMEOUT_MS, "Coverage report timeout"),
    ]);
    if (!includeShadow) return Response.json(report);
    return Response.json({
      ...report,
      shadowUniverse: await buildShadowUniverseReport({ markets, refresh: false, maxAgeHours }),
    });
  } catch (error) {
    return Response.json(partialCoverageReport(markets, error));
  }
}
