import { providerStatus } from "@/lib/dataProviders";
import { envValue, hasEnvValue } from "@/lib/env";
import { EUROPE_CORE_MARKETS, normalizeMarketList } from "@/lib/markets";
import { supabaseConfig, supabaseRequestAll } from "@/lib/supabaseServer";
import { getUniverseEngineSnapshot } from "@/lib/universeEngine";

export const CORE_COVERAGE_MARKETS = ["US", ...EUROPE_CORE_MARKETS, "CA", "JP", "HK", "SG", "TW", "KR", "CN", "AU", "ZA", "BR", "MX"];

const EUROPE_MARKETS = new Set(EUROPE_CORE_MARKETS);
const ESMA_FIRDS_MARKETS = new Set(["AT", "BE", "DE", "DK", "ES", "FI", "FR", "IE", "IT", "NL", "NO", "PT", "SE"]);
const DEFAULT_SCAN_SINCE_DAYS = 45;
const DEFAULT_SCAN_MAX_ROWS = 20000;
const DEFAULT_MAX_PRICE_FRESHNESS_DAYS = 5;
const DEFAULT_MIN_SCAN_COVERAGE = 40;

export const MARKET_COVERAGE_TARGETS = {
  US: { region: "US", investableTarget: 5500, priority: 1, status: "active", source: "NasdaqTrader public symbol directories", nextAction: "Mantener cache diario y mejorar dedupe de ADR/preferred/units." },
  AU: { region: "Australia", investableTarget: 1200, priority: 1, status: "partial", source: "ASIC short reports + curated", nextAction: "Anadir ASX master list oficial/licenciada; mantener ASIC solo para short interest." },
  JP: { region: "Japan", investableTarget: 1500, priority: 1, status: "active-when-configured", source: "J-Quants V2/V1 when configured + curated fallback", nextAction: "Configurar JQUANTS_API_KEY y activar el grupo cron asia-japan para cerrar universo, OHLCV y fundamentales JP por lotes." },
  HK: { region: "Hong Kong", investableTarget: 2500, priority: 1, status: "active", source: "HKEX Full List of Securities + curated fallback", nextAction: "Refrescar a cache Supabase y medir liquidez/market cap para separar small/microcaps." },
  GB: { region: "Europe", investableTarget: 650, priority: 1, status: "active-when-enabled", source: "Curated now; FCA FIRDS opt-in + OpenFIGI resolver", nextAction: "Activar FCA_FIRDS_ENABLED o ejecutar /api/jobs/shadow-firds-refresh?source=fca para sembrar UK oculto; OHLCV sigue pasando por freshness gate." },
  DE: { region: "Europe", investableTarget: 500, priority: 1, status: "active-when-enabled", source: "Curated now; ESMA FIRDS opt-in + OpenFIGI resolver", nextAction: "Activar ESMA_FIRDS_ENABLED y resolver ISINs por lotes para Xetra/Frankfurt; OHLCV seguira por cache/proveedor permitido." },
  FR: { region: "Europe", investableTarget: 450, priority: 1, status: "active-when-enabled", source: "Curated now; ESMA FIRDS opt-in + OpenFIGI resolver", nextAction: "Activar ESMA_FIRDS_ENABLED para Euronext Paris y resolver ISINs por lotes." },
  NL: { region: "Europe", investableTarget: 200, priority: 2, status: "active-when-enabled", source: "Curated now; ESMA FIRDS opt-in + OpenFIGI resolver", nextAction: "Activar ESMA FIRDS para Euronext Amsterdam; mantener limites por job." },
  CH: { region: "Europe", investableTarget: 250, priority: 2, status: "gap", source: "Curated now; SIX/provider next", nextAction: "SIX no entra limpio por ESMA; mantener core curado o usar proveedor low-cost/licenciado." },
  SE: { region: "Europe", investableTarget: 350, priority: 1, status: "active-when-enabled", source: "Expanded curated Nordic core; ESMA FIRDS opt-in + OpenFIGI resolver", nextAction: "Activar ESMA FIRDS para referencia oficial y resolver ISINs; Nasdaq Nordic completo solo con licencia." },
  DK: { region: "Europe", investableTarget: 120, priority: 1, status: "active-when-enabled", source: "Expanded curated Nordic core; ESMA FIRDS opt-in + OpenFIGI resolver", nextAction: "Activar ESMA FIRDS para referencia oficial y resolver ISINs; Nasdaq Copenhagen completo solo con licencia." },
  NO: { region: "Europe", investableTarget: 180, priority: 1, status: "active-when-enabled", source: "Expanded curated Nordic core; ESMA FIRDS opt-in + OpenFIGI resolver", nextAction: "Activar ESMA FIRDS para referencia oficial y resolver ISINs; Euronext Oslo completo sigue siendo licenciado." },
  FI: { region: "Europe", investableTarget: 150, priority: 2, status: "active-when-enabled", source: "Curated now; ESMA FIRDS opt-in + OpenFIGI resolver", nextAction: "Activar ESMA FIRDS y validar Nasdaq Helsinki/licencia para cobertura completa." },
  IT: { region: "Europe", investableTarget: 300, priority: 2, status: "gap", source: "Curated now; Borsa Italiana next", nextAction: "Conectar Milan listed equities." },
  ES: { region: "Europe", investableTarget: 140, priority: 2, status: "gap", source: "Curated now; BME next", nextAction: "Conectar BME listed equities y Mercado Continuo." },
  BE: { region: "Europe", investableTarget: 100, priority: 3, status: "gap", source: "Curated now; Euronext next", nextAction: "Conectar Euronext Brussels." },
  PT: { region: "Europe", investableTarget: 50, priority: 3, status: "gap", source: "Curated now; Euronext next", nextAction: "Conectar Euronext Lisbon." },
  AT: { region: "Europe", investableTarget: 70, priority: 3, status: "gap", source: "Curated now; Vienna next", nextAction: "Conectar Vienna Stock Exchange." },
  IE: { region: "Europe", investableTarget: 50, priority: 3, status: "gap", source: "Curated now; Euronext Dublin next", nextAction: "Conectar Euronext Dublin." },
  CA: { region: "Canada", investableTarget: 1000, priority: 1, status: "partial", source: "Expanded curated legal-safe core; no TMX bulk redistribution", nextAction: "Mantener core CA 200+ por liquidez/market cap; TSX/TSXV completo solo con licencia/proveedor." },
  SG: { region: "Asia", investableTarget: 350, priority: 3, status: "partial", source: "Curated legal-safe core; no SGX bulk redistribution", nextAction: "Mantener SG como core curado; SGX completo solo con permiso/proveedor." },
  TW: { region: "Asia", investableTarget: 900, priority: 3, status: "active", source: "TWSE ISIN listed equities + curated fallback", nextAction: "Monitorizar disponibilidad TWSE y anadir TPEx/.TWO solo si el price mapping queda fiable." },
  KR: { region: "Asia", investableTarget: 1100, priority: 3, status: "gap", source: "Curated now", nextAction: "Conectar KRX/KOSDAQ cuando Asia ex-JP/HK pase a fase 2." },
  IN: { region: "Asia", investableTarget: 1200, priority: 4, status: "deferred", source: "Curated legal-safe core; no NSE/BSE bulk redistribution", nextAction: "No entra en el core occidental inicial. Mantener manual/curado y evitar trabajo legal o bulk hasta que haya demanda." },
  IL: { region: "Asia", investableTarget: 450, priority: 4, status: "deferred", source: "Curated legal-safe core; no TASE paid-data bypass", nextAction: "No entra en el core occidental inicial. Mantener manual/curado y usar TASE Data Hub/API solo con permiso o plan adecuado." },
  CN: { region: "China A", investableTarget: 1600, priority: 3, status: "gap", source: "Curated now", nextAction: "Conectar Shanghai/Shenzhen o dejar como fase posterior por complejidad." },
  ZA: { region: "Africa", investableTarget: 250, priority: 3, status: "partial", source: "Curated legal-safe core; no JSE bulk redistribution", nextAction: "Mantener JSE como core curado; universo completo solo con licencia/proveedor." },
  BR: { region: "LatAm", investableTarget: 250, priority: 3, status: "gap", source: "Curated now", nextAction: "Conectar B3 si LatAm entra en alcance core." },
  MX: { region: "LatAm", investableTarget: 120, priority: 3, status: "gap", source: "Curated now", nextAction: "Conectar BMV si LatAm entra en alcance core." },
};

export const IMPLEMENTATION_PHASES = [
  {
    id: "cache-foundation",
    title: "Activar cache persistente",
    status: "ready",
    steps: ["Aplicar supabase/schema.sql", "Refrescar Universe Engine por mercado", "Guardar daily_bars y fundamentals snapshots antes de scans grandes"],
  },
  {
    id: "official-universes",
    title: "Completar universos oficiales core",
    status: "in-progress",
    steps: ["Hong Kong via HKEX listados integrado", "Taiwan via TWSE ISIN listados integrado", "Japon via J-Quants V2 al configurar API key", "Europa/EEA via ESMA FIRDS opt-in para referencia ISIN/MIC/CFI y resolucion OpenFIGI por lotes", "UK via FCA FIRDS opt-in separado de ESMA", "Europa via ESEF para fundamentales anuales", "Canada/Singapur/Sudafrica como cores curados legal-safe", "India/Israel diferidos y manuales", "Australia con ASX master list si licencia lo permite"],
  },
  {
    id: "daily-bars-cache",
    title: "OHLCV diario cacheado",
    status: "next",
    steps: ["Backfill inicial 2-5 anos por lotes", "Refresh incremental diario", "Leer scanner desde Supabase antes de proveedor live"],
  },
  {
    id: "fundamentals-depth",
    title: "Fundamentales regionales",
    status: "planned",
    steps: ["SEC EDGAR US", "ESEF anual Europa", "J-Quants statements Japon", "FMP/EODHD como capa premium si la cobertura gratuita no alcanza"],
  },
];

function clampPct(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function firstFinite(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function metric(row = {}, key = "") {
  return firstFinite(row[key], row.metrics?.[key], row.raw?.[key], row.raw?.growthMetrics?.[key]);
}

function metricText(row = {}, key = "") {
  return String(row[key] || row.metrics?.[key] || row.raw?.[key] || "").replace(/\s+/g, " ").trim();
}

function marketGrade(current, target) {
  const pct = target > 0 ? current / target : 0;
  if (pct >= 0.9) return "alta";
  if (pct >= 0.6) return "util";
  if (pct >= 0.25) return "parcial";
  return "baja";
}

function priceFreshness(row = {}, maxDays = DEFAULT_MAX_PRICE_FRESHNESS_DAYS) {
  const stored = metric(row, "priceFreshnessDays");
  if (Number.isFinite(stored)) return { days: stored, ok: stored <= maxDays };
  const lastDate = metricText(row, "lastDate");
  const timestamp = Date.parse(lastDate);
  if (!Number.isFinite(timestamp)) return { days: null, ok: false };
  const days = Math.max(0, Math.floor((Date.now() - timestamp) / 86400000));
  return { days, ok: days <= maxDays };
}

function scanRowShape(row = {}, { maxPriceFreshnessDays = DEFAULT_MAX_PRICE_FRESHNESS_DAYS, minCoverageScore = DEFAULT_MIN_SCAN_COVERAGE } = {}) {
  const freshness = priceFreshness(row, maxPriceFreshnessDays);
  const coverage = metric(row, "dataCoverageScore");
  const totalScore = firstFinite(row.total_score, row.raw?.totalScore, row.metrics?.totalScore);
  const qualityOk = freshness.ok && (!Number.isFinite(coverage) || coverage >= minCoverageScore);
  return {
    symbol: String(row.symbol || row.raw?.symbol || "").trim().toUpperCase(),
    country: String(row.country || row.raw?.country || "US").trim().toUpperCase(),
    totalScore,
    dataCoverageScore: coverage,
    priceFresh: freshness.ok,
    qualityOk,
    actionable: qualityOk && (!Number.isFinite(totalScore) || totalScore >= 45),
    createdAt: row.created_at || "",
  };
}

function latestBySymbol(rows = []) {
  const bySymbol = new Map();
  for (const row of rows) {
    if (!row.symbol) continue;
    const previous = bySymbol.get(row.symbol);
    const currentTime = Date.parse(row.createdAt || "") || 0;
    const previousTime = Date.parse(previous?.createdAt || "") || 0;
    if (!previous || currentTime >= previousTime) bySymbol.set(row.symbol, row);
  }
  return [...bySymbol.values()];
}

function emptyScanCoverage(status = "unavailable", extra = {}) {
  return {
    status,
    sinceDays: DEFAULT_SCAN_SINCE_DAYS,
    maxPriceFreshnessDays: DEFAULT_MAX_PRICE_FRESHNESS_DAYS,
    minCoverageScore: DEFAULT_MIN_SCAN_COVERAGE,
    rowsRead: 0,
    uniqueSymbols: 0,
    fresh: 0,
    qualityOk: 0,
    actionable: 0,
    latestScanAt: "",
    byMarket: {},
    ...extra,
  };
}

async function buildScanCoverage({ sinceDays = DEFAULT_SCAN_SINCE_DAYS, maxPriceFreshnessDays = DEFAULT_MAX_PRICE_FRESHNESS_DAYS, minCoverageScore = DEFAULT_MIN_SCAN_COVERAGE, maxRows = DEFAULT_SCAN_MAX_ROWS } = {}) {
  const config = supabaseConfig();
  if (!config.configured) return emptyScanCoverage("supabase-disabled", { missing: config.missing });
  const since = new Date(Date.now() - sinceDays * 86400 * 1000).toISOString();
  try {
    const rows = await supabaseRequestAll("scan_results", {
      query: `owner_id=eq.${encodeURIComponent(config.ownerId)}&created_at=gte.${encodeURIComponent(since)}&select=symbol,country,total_score,metrics,raw,created_at&order=created_at.desc`,
    }, {
      maxRows,
    });
    const shaped = latestBySymbol((rows || []).map((row) => scanRowShape(row, { maxPriceFreshnessDays, minCoverageScore })));
    const byMarket = {};
    let latestScanAt = 0;
    for (const row of shaped) {
      const market = row.country || "-";
      if (!byMarket[market]) byMarket[market] = { uniqueSymbols: 0, fresh: 0, qualityOk: 0, actionable: 0 };
      byMarket[market].uniqueSymbols += 1;
      if (row.priceFresh) byMarket[market].fresh += 1;
      if (row.qualityOk) byMarket[market].qualityOk += 1;
      if (row.actionable) byMarket[market].actionable += 1;
      latestScanAt = Math.max(latestScanAt, Date.parse(row.createdAt || "") || 0);
    }
    return {
      status: "supabase",
      sinceDays,
      maxPriceFreshnessDays,
      minCoverageScore,
      rowsRead: rows?.length || 0,
      uniqueSymbols: shaped.length,
      fresh: shaped.filter((row) => row.priceFresh).length,
      qualityOk: shaped.filter((row) => row.qualityOk).length,
      actionable: shaped.filter((row) => row.actionable).length,
      latestScanAt: latestScanAt ? new Date(latestScanAt).toISOString() : "",
      byMarket,
    };
  } catch (error) {
    return emptyScanCoverage("error", { error: error.message || "scan coverage unavailable" });
  }
}

function regionForMarket(market) {
  if (EUROPE_MARKETS.has(market)) return "Europe";
  return MARKET_COVERAGE_TARGETS[market]?.region || market;
}

function providerReadiness() {
  const providers = providerStatus();
  const byId = Object.fromEntries(providers.map((provider) => [provider.id, provider]));
  return {
    supabaseConfigured: supabaseConfig().configured,
    jquantsConfigured: hasEnvValue("JQUANTS_API_KEY") || hasEnvValue("JQUANTS_REFRESH_TOKEN"),
    stooqConfigured: hasEnvValue("STOOQ_API_KEY"),
    alphaVantageConfigured: hasEnvValue("ALPHA_VANTAGE_API_KEY"),
    fmpConfigured: hasEnvValue("FMP_API_KEY"),
    esmaFirdsEnabled: /^(1|true|yes|on)$/i.test(envValue("ESMA_FIRDS_ENABLED")),
    fcaFirdsEnabled: /^(1|true|yes|on)$/i.test(envValue("FCA_FIRDS_ENABLED")),
    openfigi: byId.openfigi?.runtime || null,
  };
}

function blockersFor(snapshot) {
  const blockers = [];
  const byMarket = snapshot.coverage?.byMarket || {};
  const supabase = supabaseConfig();
  if (!supabase.configured) blockers.push({ severity: "high", area: "cache", message: "Supabase no esta configurado; el engine solo puede usar memoria local." });
  if (snapshot.cache?.status === "supabase-skip") blockers.push({ severity: "high", area: "cache", message: "Las tablas de universe cache no existen todavia en Supabase. Aplica supabase/schema.sql." });
  if (!hasEnvValue("SUPABASE_ACCESS_TOKEN")) blockers.push({ severity: "medium", area: "ops", message: "Falta SUPABASE_ACCESS_TOKEN; no puedo aplicar schema automaticamente desde el script del repo." });
  if (!hasEnvValue("JQUANTS_API_KEY") && !hasEnvValue("JQUANTS_REFRESH_TOKEN")) blockers.push({ severity: "medium", area: "japan", message: "Falta credencial J-Quants; Japon seguira curado hasta configurar cuenta/plan." });
  if (snapshot.markets?.includes("GB") && !/^(1|true|yes|on)$/i.test(envValue("FCA_FIRDS_ENABLED"))) blockers.push({ severity: "low", area: "uk", message: "FCA FIRDS esta implementado pero desactivado para carga automatica; UK seguira con core curado salvo jobs shadow manuales." });
  if (snapshot.markets?.some((market) => ESMA_FIRDS_MARKETS.has(market)) && !/^(1|true|yes|on)$/i.test(envValue("ESMA_FIRDS_ENABLED"))) blockers.push({ severity: "low", area: "europe", message: "ESMA FIRDS esta implementado pero desactivado; Europa seguira con core curado hasta activar ESMA_FIRDS_ENABLED y resolver ISINs por lotes." });
  if (snapshot.markets?.includes("HK") && Number(byMarket.HK || 0) < 500) blockers.push({ severity: "medium", area: "hong-kong", message: "HKEX no devolvio el universo completo; se uso fallback curado. Revisar conectividad, URL publica o terminos de HKEX." });
  return blockers;
}

function buildBackfillPlan(rows = []) {
  const remainingInventory = rows.reduce((sum, row) => sum + Math.max(0, row.inventory.candidates - row.scan.uniqueSymbols), 0);
  const targetGap = rows.reduce((sum, row) => sum + row.scan.gap, 0);
  return {
    goal: "Materializar el inventario existente en scan_results por lotes, manteniendo cache, freshness gate y limite de proveedor.",
    remainingInventory,
    targetGap,
    safeBatchPolicy: "Usar cursor=1, skipRecent=1 y lotes pequenos; no ejecutar scans globales live.",
    recommendedJobs: [
      {
        label: "Core liquido US/HK/AU/CA",
        path: "/api/jobs/scan-refresh?markets=US,HK,AU,CA&perMarket=25&limit=100&cursor=1&skipRecent=1&recentScanDays=45&leaderboards=1",
      },
      {
        label: "Europa prioridad",
        path: "/api/jobs/scan-refresh?markets=EU1&perMarket=10&limit=80&cursor=1&skipRecent=1&recentScanDays=45&leaderboards=1",
      },
      {
        label: "Europa secundaria",
        path: "/api/jobs/scan-refresh?markets=EU2&perMarket=8&limit=56&cursor=1&skipRecent=1&recentScanDays=45&leaderboards=1",
      },
      {
        label: "Europa shadow validada",
        path: "/api/cron/shadow-europe-refresh?group=shadow-europe-west&resolvePerMarket=3&pricePerMarket=6&scanPerMarket=6",
      },
    ],
  };
}

export async function buildCoverageReport({ markets = CORE_COVERAGE_MARKETS, refresh = false, maxAgeHours = 24 } = {}) {
  const normalizedMarkets = normalizeMarketList(markets, CORE_COVERAGE_MARKETS);
  const [snapshot, scanCoverage] = await Promise.all([
    getUniverseEngineSnapshot({ markets: normalizedMarkets.length ? normalizedMarkets : CORE_COVERAGE_MARKETS, refresh, maxAgeHours }),
    buildScanCoverage(),
  ]);
  const byMarket = snapshot.coverage?.byMarket || {};
  const rows = snapshot.markets.map((market) => {
    const target = MARKET_COVERAGE_TARGETS[market] || { region: regionForMarket(market), investableTarget: Math.max(byMarket[market] || 0, 1), priority: 3, status: "unknown", source: "unknown", nextAction: "Definir target y fuente oficial." };
    const current = Number(byMarket[market] || 0);
    const targetCount = Number(target.investableTarget || current || 1);
    const scan = scanCoverage.byMarket?.[market] || {};
    const scanned = Number(scan.uniqueSymbols || 0);
    const fresh = Number(scan.fresh || 0);
    const qualityOk = Number(scan.qualityOk || 0);
    const actionable = Number(scan.actionable || 0);
    const gap = Math.max(0, targetCount - current);
    const scanGap = Math.max(0, targetCount - scanned);
    const actionableGap = Math.max(0, targetCount - actionable);
    return {
      market,
      region: target.region || regionForMarket(market),
      priority: target.priority || 3,
      sourceStatus: target.status || "unknown",
      current,
      currentMeaning: "inventory_candidates_after_universe_quality_gate",
      target: targetCount,
      coveragePct: clampPct((current / targetCount) * 100),
      grade: marketGrade(current, targetCount),
      gap,
      inventory: {
        candidates: current,
        target: targetCount,
        coveragePct: clampPct((current / targetCount) * 100),
        grade: marketGrade(current, targetCount),
        gap,
      },
      scan: {
        uniqueSymbols: scanned,
        fresh,
        qualityOk,
        actionable,
        scannedPct: clampPct((scanned / targetCount) * 100),
        actionablePct: clampPct((actionable / targetCount) * 100),
        activationPct: clampPct((scanned / Math.max(current, 1)) * 100),
        grade: marketGrade(actionable, targetCount),
        gap: scanGap,
        actionableGap,
      },
      activeSource: target.source || "unknown",
      nextAction: target.nextAction || "Definir fuente oficial.",
    };
  }).sort((a, b) => a.priority - b.priority || b.gap - a.gap || a.market.localeCompare(b.market));
  const targetTotal = rows.reduce((sum, row) => sum + row.target, 0);
  const currentTotal = rows.reduce((sum, row) => sum + row.current, 0);
  const scannedTotal = rows.reduce((sum, row) => sum + row.scan.uniqueSymbols, 0);
  const freshTotal = rows.reduce((sum, row) => sum + row.scan.fresh, 0);
  const qualityOkTotal = rows.reduce((sum, row) => sum + row.scan.qualityOk, 0);
  const actionableTotal = rows.reduce((sum, row) => sum + row.scan.actionable, 0);
  const regionCoverage = rows.reduce((map, row) => {
    const key = row.region;
    if (!map[key]) map[key] = { region: key, current: 0, target: 0, gap: 0, scanned: 0, fresh: 0, actionable: 0 };
    map[key].current += row.current;
    map[key].target += row.target;
    map[key].gap += row.gap;
    map[key].scanned += row.scan.uniqueSymbols;
    map[key].fresh += row.scan.fresh;
    map[key].actionable += row.scan.actionable;
    return map;
  }, {});
  const regions = Object.values(regionCoverage).map((row) => ({
    ...row,
    coveragePct: clampPct((row.current / Math.max(row.target, 1)) * 100),
    grade: marketGrade(row.current, Math.max(row.target, 1)),
    scanCoveragePct: clampPct((row.scanned / Math.max(row.target, 1)) * 100),
    actionableCoveragePct: clampPct((row.actionable / Math.max(row.target, 1)) * 100),
    scanGrade: marketGrade(row.actionable, Math.max(row.target, 1)),
  })).sort((a, b) => b.gap - a.gap);
  return {
    generatedAt: new Date().toISOString(),
    objective: "Cobertura maxima razonable de acciones ordinarias/vehiculos listados utiles para Weinstein-Minervini, excluyendo instrumentos basura, microcaps e iliquidas.",
    measurementModel: {
      inventoryCandidates: "Simbolos disponibles para cola interna tras el Universe Quality Gate. No implica OHLCV fresco ni ranking materializado.",
      scannedFresh: "Simbolos presentes en scan_results dentro de la ventana reciente y con Price Freshness Gate aprobado.",
      actionable: "Simbolos escaneados, frescos, con cobertura minima y puntuacion suficiente para aparecer en rankings/listas.",
      defaultScanWindowDays: scanCoverage.sinceDays,
      defaultMaxPriceFreshnessDays: scanCoverage.maxPriceFreshnessDays,
    },
    summary: {
      markets: rows.length,
      current: currentTotal,
      target: targetTotal,
      gap: Math.max(0, targetTotal - currentTotal),
      coveragePct: clampPct((currentTotal / Math.max(targetTotal, 1)) * 100),
      snapshotCandidates: snapshot.totalBeforeGate,
      snapshotExcluded: snapshot.excludedCount,
      inventoryCandidates: currentTotal,
      inventoryCoveragePct: clampPct((currentTotal / Math.max(targetTotal, 1)) * 100),
      scannedSymbols: scannedTotal,
      scannedCoveragePct: clampPct((scannedTotal / Math.max(targetTotal, 1)) * 100),
      freshSymbols: freshTotal,
      qualityOkSymbols: qualityOkTotal,
      actionableSymbols: actionableTotal,
      actionableCoveragePct: clampPct((actionableTotal / Math.max(targetTotal, 1)) * 100),
      activationPct: clampPct((scannedTotal / Math.max(currentTotal, 1)) * 100),
      scanLatestAt: scanCoverage.latestScanAt,
    },
    scanCoverage: {
      status: scanCoverage.status,
      sinceDays: scanCoverage.sinceDays,
      maxPriceFreshnessDays: scanCoverage.maxPriceFreshnessDays,
      minCoverageScore: scanCoverage.minCoverageScore,
      rowsRead: scanCoverage.rowsRead,
      uniqueSymbols: scanCoverage.uniqueSymbols,
      fresh: scanCoverage.fresh,
      qualityOk: scanCoverage.qualityOk,
      actionable: scanCoverage.actionable,
      latestScanAt: scanCoverage.latestScanAt,
      error: scanCoverage.error,
    },
    cache: snapshot.cache,
    providerReadiness: providerReadiness(),
    blockers: [
      ...blockersFor(snapshot),
      ...(scannedTotal < currentTotal ? [{
        severity: "medium",
        area: "scan-materialization",
        message: `El universo inventariable (${currentTotal}) supera ampliamente lo escaneado fresco (${scannedTotal}). Ejecutar backfill por lotes antes de presentar cobertura como operativa.`,
      }] : []),
    ],
    backfillPlan: buildBackfillPlan(rows),
    regions,
    markets: rows,
    nextImplementation: IMPLEMENTATION_PHASES,
    legalLimits: [
      "No redistribuir datos de Yahoo/Stooq/Alpha/FMP ni usarlos como display comercial sin revisar terminos.",
      "Los listados oficiales suelen permitir consulta publica, pero no siempre redistribucion masiva; cache interno de investigacion primero.",
      "Short interest no es comparable entre paises sin etiquetar metodologia, lag y denominador.",
    ],
  };
}
