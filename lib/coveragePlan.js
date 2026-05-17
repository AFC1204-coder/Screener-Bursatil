import { providerStatus } from "@/lib/dataProviders";
import { supabaseConfig } from "@/lib/supabaseServer";
import { getUniverseEngineSnapshot } from "@/lib/universeEngine";

export const CORE_COVERAGE_MARKETS = ["US", "ES", "DE", "FR", "NL", "GB", "CH", "SE", "DK", "NO", "FI", "IT", "BE", "PT", "AT", "IE", "CA", "JP", "HK", "SG", "TW", "KR", "IN", "CN", "AU", "BR", "MX"];

const EUROPE_MARKETS = new Set(["ES", "DE", "FR", "NL", "GB", "CH", "SE", "DK", "NO", "FI", "IT", "BE", "PT", "AT", "IE"]);

export const MARKET_COVERAGE_TARGETS = {
  US: { region: "US", investableTarget: 5500, priority: 1, status: "active", source: "NasdaqTrader public symbol directories", nextAction: "Mantener cache diario y mejorar dedupe de ADR/preferred/units." },
  AU: { region: "Australia", investableTarget: 1200, priority: 1, status: "partial", source: "ASIC short reports + curated", nextAction: "Anadir ASX master list oficial/licenciada; mantener ASIC solo para short interest." },
  JP: { region: "Japan", investableTarget: 1500, priority: 1, status: "active-when-configured", source: "J-Quants V2/V1 when configured + curated fallback", nextAction: "Configurar JQUANTS_API_KEY para pasar de lista curada a universo TSE oficial." },
  HK: { region: "Hong Kong", investableTarget: 2500, priority: 1, status: "active", source: "HKEX Full List of Securities + curated fallback", nextAction: "Refrescar a cache Supabase y medir liquidez/market cap para separar small/microcaps." },
  GB: { region: "Europe", investableTarget: 650, priority: 1, status: "gap", source: "Curated now; LSE next", nextAction: "Conectar listado LSE/official list o proveedor low-cost si licencia publica no escala." },
  DE: { region: "Europe", investableTarget: 500, priority: 1, status: "gap", source: "Curated now; Deutsche Boerse/Xetra next", nextAction: "Conectar listado Xetra/Boerse Frankfurt y mapear sufijos Yahoo." },
  FR: { region: "Europe", investableTarget: 450, priority: 1, status: "gap", source: "Curated now; Euronext next", nextAction: "Conectar Euronext instruments para Paris y cachear mapping MIC." },
  NL: { region: "Europe", investableTarget: 200, priority: 2, status: "gap", source: "Curated now; Euronext next", nextAction: "Conectar Euronext Amsterdam." },
  CH: { region: "Europe", investableTarget: 250, priority: 2, status: "gap", source: "Curated now; SIX next", nextAction: "Conectar SIX official list o proveedor low-cost." },
  SE: { region: "Europe", investableTarget: 350, priority: 2, status: "gap", source: "Curated now; Nasdaq Nordic next", nextAction: "Conectar Nasdaq Nordic listed shares." },
  DK: { region: "Europe", investableTarget: 120, priority: 2, status: "gap", source: "Curated now; Nasdaq Nordic next", nextAction: "Conectar Nasdaq Copenhagen." },
  NO: { region: "Europe", investableTarget: 180, priority: 2, status: "gap", source: "Curated now; Oslo Bors next", nextAction: "Conectar Oslo Bors listed shares." },
  FI: { region: "Europe", investableTarget: 150, priority: 2, status: "gap", source: "Curated now; Nasdaq Nordic next", nextAction: "Conectar Nasdaq Helsinki." },
  IT: { region: "Europe", investableTarget: 300, priority: 2, status: "gap", source: "Curated now; Borsa Italiana next", nextAction: "Conectar Milan listed equities." },
  ES: { region: "Europe", investableTarget: 140, priority: 2, status: "gap", source: "Curated now; BME next", nextAction: "Conectar BME listed equities y Mercado Continuo." },
  BE: { region: "Europe", investableTarget: 100, priority: 3, status: "gap", source: "Curated now; Euronext next", nextAction: "Conectar Euronext Brussels." },
  PT: { region: "Europe", investableTarget: 50, priority: 3, status: "gap", source: "Curated now; Euronext next", nextAction: "Conectar Euronext Lisbon." },
  AT: { region: "Europe", investableTarget: 70, priority: 3, status: "gap", source: "Curated now; Vienna next", nextAction: "Conectar Vienna Stock Exchange." },
  IE: { region: "Europe", investableTarget: 50, priority: 3, status: "gap", source: "Curated now; Euronext Dublin next", nextAction: "Conectar Euronext Dublin." },
  CA: { region: "Canada", investableTarget: 1000, priority: 2, status: "gap", source: "Curated now; TSX/TSXV next", nextAction: "Conectar TSX/TSXV listed issuers o low-cost global." },
  SG: { region: "Asia", investableTarget: 350, priority: 3, status: "gap", source: "Curated now", nextAction: "Conectar SGX securities list si se mantiene en core." },
  TW: { region: "Asia", investableTarget: 900, priority: 3, status: "gap", source: "Curated now", nextAction: "Conectar TWSE/TPEX cuando Asia ex-JP/HK pase a fase 2." },
  KR: { region: "Asia", investableTarget: 1100, priority: 3, status: "gap", source: "Curated now", nextAction: "Conectar KRX/KOSDAQ cuando Asia ex-JP/HK pase a fase 2." },
  IN: { region: "Asia", investableTarget: 1200, priority: 3, status: "gap", source: "Curated now", nextAction: "Conectar NSE/BSE si licencia lo permite o low-cost global." },
  CN: { region: "China A", investableTarget: 1600, priority: 3, status: "gap", source: "Curated now", nextAction: "Conectar Shanghai/Shenzhen o dejar como fase posterior por complejidad." },
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
    steps: ["Hong Kong via HKEX listados integrado", "Japon via J-Quants V2 al configurar API key", "Europa por exchange: Euronext/LSE/Xetra/SIX/Nasdaq Nordic/BME", "Australia con ASX master list si licencia lo permite"],
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

function marketGrade(current, target) {
  const pct = target > 0 ? current / target : 0;
  if (pct >= 0.9) return "alta";
  if (pct >= 0.6) return "util";
  if (pct >= 0.25) return "parcial";
  return "baja";
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
    jquantsConfigured: Boolean(process.env.JQUANTS_API_KEY || process.env.JQUANTS_REFRESH_TOKEN),
    stooqConfigured: Boolean(process.env.STOOQ_API_KEY),
    alphaVantageConfigured: Boolean(process.env.ALPHA_VANTAGE_API_KEY),
    fmpConfigured: Boolean(process.env.FMP_API_KEY),
    openfigi: byId.openfigi?.runtime || null,
  };
}

function blockersFor(snapshot) {
  const blockers = [];
  const byMarket = snapshot.coverage?.byMarket || {};
  const supabase = supabaseConfig();
  if (!supabase.configured) blockers.push({ severity: "high", area: "cache", message: "Supabase no esta configurado; el engine solo puede usar memoria local." });
  if (snapshot.cache?.status === "supabase-skip") blockers.push({ severity: "high", area: "cache", message: "Las tablas de universe cache no existen todavia en Supabase. Aplica supabase/schema.sql." });
  if (!process.env.SUPABASE_ACCESS_TOKEN) blockers.push({ severity: "medium", area: "ops", message: "Falta SUPABASE_ACCESS_TOKEN; no puedo aplicar schema automaticamente desde el script del repo." });
  if (!process.env.JQUANTS_API_KEY && !process.env.JQUANTS_REFRESH_TOKEN) blockers.push({ severity: "medium", area: "japan", message: "Falta credencial J-Quants; Japon seguira curado hasta configurar cuenta/plan." });
  if (snapshot.markets?.includes("HK") && Number(byMarket.HK || 0) < 500) blockers.push({ severity: "medium", area: "hong-kong", message: "HKEX no devolvio el universo completo; se uso fallback curado. Revisar conectividad, URL publica o terminos de HKEX." });
  return blockers;
}

export async function buildCoverageReport({ markets = CORE_COVERAGE_MARKETS, refresh = false, maxAgeHours = 24 } = {}) {
  const normalizedMarkets = [...new Set((Array.isArray(markets) ? markets : String(markets).split(",")).map((item) => String(item).trim().toUpperCase()).filter(Boolean))];
  const snapshot = await getUniverseEngineSnapshot({ markets: normalizedMarkets.length ? normalizedMarkets : CORE_COVERAGE_MARKETS, refresh, maxAgeHours });
  const byMarket = snapshot.coverage?.byMarket || {};
  const rows = snapshot.markets.map((market) => {
    const target = MARKET_COVERAGE_TARGETS[market] || { region: regionForMarket(market), investableTarget: Math.max(byMarket[market] || 0, 1), priority: 3, status: "unknown", source: "unknown", nextAction: "Definir target y fuente oficial." };
    const current = Number(byMarket[market] || 0);
    const targetCount = Number(target.investableTarget || current || 1);
    const gap = Math.max(0, targetCount - current);
    return {
      market,
      region: target.region || regionForMarket(market),
      priority: target.priority || 3,
      sourceStatus: target.status || "unknown",
      current,
      target: targetCount,
      coveragePct: clampPct((current / targetCount) * 100),
      grade: marketGrade(current, targetCount),
      gap,
      activeSource: target.source || "unknown",
      nextAction: target.nextAction || "Definir fuente oficial.",
    };
  }).sort((a, b) => a.priority - b.priority || b.gap - a.gap || a.market.localeCompare(b.market));
  const targetTotal = rows.reduce((sum, row) => sum + row.target, 0);
  const currentTotal = rows.reduce((sum, row) => sum + row.current, 0);
  const regionCoverage = rows.reduce((map, row) => {
    const key = row.region;
    if (!map[key]) map[key] = { region: key, current: 0, target: 0, gap: 0 };
    map[key].current += row.current;
    map[key].target += row.target;
    map[key].gap += row.gap;
    return map;
  }, {});
  const regions = Object.values(regionCoverage).map((row) => ({
    ...row,
    coveragePct: clampPct((row.current / Math.max(row.target, 1)) * 100),
    grade: marketGrade(row.current, Math.max(row.target, 1)),
  })).sort((a, b) => b.gap - a.gap);
  return {
    generatedAt: new Date().toISOString(),
    objective: "Cobertura maxima razonable de acciones ordinarias/vehiculos listados utiles para Weinstein-Minervini, excluyendo instrumentos basura, microcaps e iliquidas.",
    summary: {
      markets: rows.length,
      current: currentTotal,
      target: targetTotal,
      gap: Math.max(0, targetTotal - currentTotal),
      coveragePct: clampPct((currentTotal / Math.max(targetTotal, 1)) * 100),
      snapshotCandidates: snapshot.totalBeforeGate,
      snapshotExcluded: snapshot.excludedCount,
    },
    cache: snapshot.cache,
    providerReadiness: providerReadiness(),
    blockers: blockersFor(snapshot),
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
