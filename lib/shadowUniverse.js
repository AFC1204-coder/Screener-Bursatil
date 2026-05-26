import { MARKET_COVERAGE_TARGETS } from "@/lib/coveragePlan";
import { envValue } from "@/lib/env";
import { EUROPE_CORE_MARKETS, normalizeMarketList } from "@/lib/markets";
import { fetchEsmaFirdsReferenceUniverse, fetchFcaFirdsReferenceUniverse } from "@/lib/officialUniverses";
import { DEFERRED_LOW_PRIORITY_MARKETS, WESTERN_PRIORITY_MARKETS, readShadowReferenceCounts, readSymbolResolutionCounts } from "@/lib/shadowUniverseStore";
import { getUniverseEngineSnapshot } from "@/lib/universeEngine";

const EUROPE_FIRDS_MARKETS = new Set(["AT", "BE", "DE", "DK", "ES", "FI", "FR", "IE", "IT", "NL", "NO", "PT", "SE"]);
const FCA_FIRDS_MARKETS = new Set(["GB"]);

const SHADOW_POLICY = {
  US: { status: "scannable", source: "NasdaqTrader", legalMode: "public-symbol-directory", nextAction: "Mantener como scannable completo." },
  HK: { status: "scannable", source: "HKEX Full List", legalMode: "public-reference-internal-cache", nextAction: "Mantener oculto como universo completo y exponer solo rankings derivados." },
  AU: { status: "partial", source: "ASIC short reports", legalMode: "regulator-short-report-proxy", nextAction: "ASX completo solo con licencia/proveedor; ASIC no es master list." },
  JP: { status: "ready-when-configured", source: "J-Quants", legalMode: "official-api-plan", nextAction: "Configurar J-Quants para universo y OHLCV JP por lotes." },
  GB: { status: "shadow-reference-ready", source: "FCA FIRDS reference data", legalMode: "regulatory-reference-data", nextAction: "Sembrar FCA FIRDS UK en shadow_instruments, resolver ISINs por lotes y validar OHLCV antes de escanear." },
  CH: { status: "licensed-needed", source: "SIX/provider", legalMode: "exchange-data-licensed", nextAction: "Mantener core curado o contratar proveedor; SIX completo no es free-clean." },
  CA: { status: "partial", source: "Expanded curated core; TMX/provider later", legalMode: "curated-legal-safe-core", nextAction: "Mantener core CA 200+ y escanear por lotes; TSX/TSXV completo requiere licencia/proveedor." },
  IN: { status: "deferred-licensed-needed", source: "NSE/BSE/provider", legalMode: "exchange-data-licensed", nextAction: "No prioritario para el usuario occidental inicial; mantener core curado y evitar directorio completo gratis." },
  IL: { status: "deferred-licensed-needed", source: "TASE/provider", legalMode: "exchange-data-licensed", nextAction: "No prioritario para el usuario occidental inicial; mantener core curado y proveedor/licencia solo si hay demanda." },
  SG: { status: "licensed-needed", source: "SGX/provider", legalMode: "exchange-data-licensed", nextAction: "Mantener core curado; SGX completo solo con permiso/proveedor." },
  ZA: { status: "licensed-needed", source: "JSE/provider", legalMode: "exchange-data-licensed", nextAction: "Mantener core curado; JSE completo solo con licencia/proveedor." },
  KR: { status: "planned", source: "KRX/provider", legalMode: "to-review", nextAction: "Revisar KRX/KOSDAQ antes de ampliar." },
  CN: { status: "planned", source: "SSE/SZSE/provider", legalMode: "to-review", nextAction: "Fase posterior por complejidad y precio mapping." },
  BR: { status: "planned", source: "B3/provider", legalMode: "to-review", nextAction: "Fase posterior LatAm." },
  MX: { status: "planned", source: "BMV/provider", legalMode: "to-review", nextAction: "Fase posterior LatAm." },
};

function envFlag(name) {
  return /^(1|true|yes|on)$/i.test(envValue(name));
}

function clampPct(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function targetForMarket(market) {
  return Number(MARKET_COVERAGE_TARGETS[market]?.investableTarget || 0);
}

function policyForMarket(market) {
  if (FCA_FIRDS_MARKETS.has(market)) {
    return {
      status: envFlag("FCA_FIRDS_ENABLED") ? "shadow-reference-active" : "shadow-reference-ready",
      source: "FCA FIRDS reference data",
      legalMode: "regulatory-reference-data",
      nextAction: "Usar FCA FIRDS como universo oculto UK; resolver a ticker y OHLCV por lotes antes de escanear.",
    };
  }
  if (EUROPE_FIRDS_MARKETS.has(market)) {
    return {
      status: envFlag("ESMA_FIRDS_ENABLED") ? "shadow-reference-active" : "shadow-reference-ready",
      source: "ESMA FIRDS reference data",
      legalMode: "regulatory-reference-data",
      nextAction: "Usar como universo oculto por ISIN/MIC/CFI; resolver a ticker y OHLCV por lotes antes de escanear.",
    };
  }
  return SHADOW_POLICY[market] || { status: "unknown", source: "unknown", legalMode: "to-review", nextAction: "Revisar fuente legal antes de ampliar." };
}

function priorityForMarket(market) {
  if (WESTERN_PRIORITY_MARKETS.includes(market)) return "core-western";
  if (DEFERRED_LOW_PRIORITY_MARKETS.includes(market)) return "deferred";
  return "later-review";
}

async function firdsReferenceCount(market) {
  if (FCA_FIRDS_MARKETS.has(market)) {
    if (!envFlag("FCA_FIRDS_ENABLED")) return 0;
    const rows = await fetchFcaFirdsReferenceUniverse(market).catch(() => []);
    return rows.length;
  }
  if (!EUROPE_FIRDS_MARKETS.has(market) || !envFlag("ESMA_FIRDS_ENABLED")) return 0;
  const rows = await fetchEsmaFirdsReferenceUniverse(market).catch(() => []);
  return rows.length;
}

export async function buildShadowUniverseReport({ markets = [], refresh = false, maxAgeHours = 24 } = {}) {
  const normalizedMarkets = normalizeMarketList(markets, ["US", ...EUROPE_CORE_MARKETS, "CA", "JP", "HK", "AU", "IN", "IL"]);
  const snapshot = await getUniverseEngineSnapshot({ markets: normalizedMarkets, refresh, maxAgeHours });
  const byMarket = snapshot.coverage?.byMarket || {};
  const [storedReferences, storedFcaReferences, storedResolutions] = await Promise.all([
    readShadowReferenceCounts({ markets: normalizedMarkets, maxAgeHours: 0 }),
    readShadowReferenceCounts({ markets: normalizedMarkets.filter((market) => FCA_FIRDS_MARKETS.has(market)), provider: "fca-firds", maxAgeHours: 0 }),
    readSymbolResolutionCounts({ markets: normalizedMarkets, maxAgeHours: 0 }),
  ]);
  const rows = [];
  for (const market of normalizedMarkets) {
    const target = targetForMarket(market);
    const scannableCount = Number(byMarket[market] || 0);
    const policy = policyForMarket(market);
    const persistedReferenceCount = Number((FCA_FIRDS_MARKETS.has(market) ? storedFcaReferences.byMarket?.[market] : storedReferences.byMarket?.[market]) || 0);
    const resolvedCandidateCount = Number(storedResolutions.byMarket?.[market] || 0);
    const hiddenReferenceCount = persistedReferenceCount || await firdsReferenceCount(market);
    const effectiveHiddenCount = Math.max(scannableCount, Math.min(hiddenReferenceCount || 0, target || hiddenReferenceCount || scannableCount));
    const potentialCount = Math.max(scannableCount, effectiveHiddenCount);
    rows.push({
      market,
      priority: priorityForMarket(market),
      target,
      scannableCount,
      hiddenReferenceCount,
      persistedReferenceCount,
      resolvedCandidateCount,
      potentialCount,
      scannablePct: target ? clampPct((scannableCount / target) * 100) : 0,
      potentialPct: target ? clampPct((potentialCount / target) * 100) : 0,
      hiddenReady: hiddenReferenceCount > scannableCount,
      ...policy,
    });
  }
  const targetTotal = rows.reduce((sum, row) => sum + row.target, 0);
  const scannableTotal = rows.reduce((sum, row) => sum + row.scannableCount, 0);
  const potentialTotal = rows.reduce((sum, row) => sum + row.potentialCount, 0);
  return {
    generatedAt: new Date().toISOString(),
    mode: "shadow-universe-aggregate-only",
    objective: "Mantener universos amplios ocultos para jobs internos y exponer al usuario solo acciones que pasan filtros, frescura y rankings derivados.",
    providerReadiness: {
      esmaFirdsEnabled: envFlag("ESMA_FIRDS_ENABLED"),
      fcaFirdsEnabled: envFlag("FCA_FIRDS_ENABLED"),
      fcaFirdsImplemented: true,
      jquantsConfigured: Boolean(envValue("JQUANTS_API_KEY") || envValue("JQUANTS_REFRESH_TOKEN")),
    },
    focus: {
      primary: WESTERN_PRIORITY_MARKETS,
      deferred: DEFERRED_LOW_PRIORITY_MARKETS,
      rule: "Priorizar usuarios occidentales: EEUU, Canada, Europa, Reino Unido, Japon, Hong Kong y Australia. India/Israel quedan solo como core curado o futuro proveedor.",
    },
    persistence: {
      references: storedReferences.status,
      fcaReferences: storedFcaReferences.status,
      resolutions: storedResolutions.status,
      referenceTotal: Number(storedReferences.total || 0) + Number(storedFcaReferences.total || 0),
      fcaReferenceTotal: storedFcaReferences.total || 0,
      resolutionTotal: storedResolutions.total || 0,
      errors: [storedReferences.error, storedFcaReferences.error, storedResolutions.error].filter(Boolean),
    },
    summary: {
      markets: rows.length,
      target: targetTotal,
      scannable: scannableTotal,
      potential: potentialTotal,
      scannablePct: targetTotal ? clampPct((scannableTotal / targetTotal) * 100) : 0,
      potentialPct: targetTotal ? clampPct((potentialTotal / targetTotal) * 100) : 0,
      hiddenReference: rows.reduce((sum, row) => sum + row.hiddenReferenceCount, 0),
      resolvedCandidates: rows.reduce((sum, row) => sum + row.resolvedCandidateCount, 0),
    },
    legalGuardrails: [
      "Oculto no significa libre: si la fuente es licenciada, no se construye universo completo sin permiso.",
      "Los universos ocultos pueden alimentar jobs internos; la UI debe mostrar rankings derivados, no directorios completos.",
      "Una accion solo pasa a scannable cuando tiene ticker resuelto, OHLCV fresco y Quality Gate aprobado.",
    ],
    rows,
  };
}
