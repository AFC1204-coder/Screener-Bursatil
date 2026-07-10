import { buildCoverageReport, CORE_COVERAGE_MARKETS, MARKET_COVERAGE_TARGETS } from "@/lib/coveragePlan";
import { normalizeMarketList } from "@/lib/markets";
import { buildShadowUniverseReport } from "@/lib/shadowUniverse";
import { marketSymbols } from "@/lib/universes";

const COVERAGE_RESPONSE_TIMEOUT_MS = Number(process.env.COVERAGE_RESPONSE_TIMEOUT_MS || 8500);
const COVERAGE_SCAN_MAX_ROWS = Number(process.env.COVERAGE_SCAN_MAX_ROWS || 4000);
const COVERAGE_SCAN_TIMEOUT_MS = Number(process.env.COVERAGE_SCAN_TIMEOUT_MS || 7000);

// Ejecuta `build(params)` con un presupuesto de tiempo. Si vence el timeout,
// ABORTA la señal (mezclada en `params.signal`) y ESPERA a que el trabajo
// termine (rechazando o resolviendo) antes de rechazar con
// "Coverage report timeout". Devolver el fallback sin esperar dejaría
// mutaciones/rejects en background tras la respuesta (el síntoma concreto que
// tests/coverageTimeout.test.js cubre).
//
// Contrato:
//  - `build` se llama UNA vez y recibe `params` con `signal` ya inyectado.
//  - Si `build` rechaza o aborta dentro del presupuesto, ese error propaga
//    intacto (mismo comportamiento que un `Promise.race` para ese caso).
//  - Si vence el timeout: abortamos, esperamos a que `build` termine de
//    forma cooperativa (rechazando con el AbortError), y entonces rechazamos
//    con `Error("Coverage report timeout")`.
//  - El caller (GET) captura ese error y devuelve `partialCoverageReport`.
export async function runCoverageWithTimeout(build, params = {}, timeoutMs = COVERAGE_RESPONSE_TIMEOUT_MS) {
  const controller = new AbortController();
  const budget = Math.max(1, Number(timeoutMs) || 0);
  let timedOut = false;
  setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("Coverage report timeout"));
  }, budget);
  // Espera el resultado del build. Si vence el timeout, el handler `abort`
  // del build es responsable de liberar sus recursos y rechazar — esa
  // rejection se captura aquí para que, cuando `timedOut` sea true, esperemos
  // cooperativamente al build antes de propagar "Coverage report timeout".
  // Devolver el fallback sin esperar dejaría timers/mutaciones en background.
  try {
    return await Promise.resolve().then(() => build({ ...params, signal: controller.signal }));
  } catch (error) {
    if (timedOut) {
      // El build cooperó (o no) y su rejection ya se propagó; el caller solo
      // necesita el error de timeout canónico. Mantener el `throw` aquí
      // garantiza que el `await` del caller espere a este tick completo.
      throw new Error("Coverage report timeout");
    }
    throw error;
  }
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
    const report = await runCoverageWithTimeout(
      (params) => buildCoverageReport(params),
      { markets, refresh, maxAgeHours, scanMaxRows, scanTimeoutMs },
      COVERAGE_RESPONSE_TIMEOUT_MS,
    );
    if (!includeShadow) return Response.json(report);
    return Response.json({
      ...report,
      shadowUniverse: await buildShadowUniverseReport({ markets, refresh: false, maxAgeHours }),
    });
  } catch (error) {
    return Response.json(partialCoverageReport(markets, error));
  }
}
