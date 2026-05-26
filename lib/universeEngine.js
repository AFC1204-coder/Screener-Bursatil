import { supabaseConfig, supabaseRequest, supabaseRequestAll } from "@/lib/supabaseServer";
import { envValue } from "@/lib/env";
import { qualityGateForResearchRow } from "@/lib/qualityGate";
import { countryCode } from "@/lib/symbols";
import { normalizeMarketList } from "@/lib/markets";
import { getUniverse, marketSymbols } from "@/lib/universes";

const MEMORY_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_MAX_AGE_HOURS = 24;
const REQUIRED_SOURCE_BY_MARKET = {
  HK: "HKEX Full List of Securities",
  TW: "TWSE ISIN listed equities",
};
const FIRDS_CACHE_MARKETS = new Set(["AT", "BE", "DE", "DK", "ES", "FI", "FR", "IE", "IT", "NL", "NO", "PT", "SE"]);
const FCA_FIRDS_CACHE_MARKETS = new Set(["GB"]);
const memoryCache = new Map();

function cleanText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeMarkets(markets = []) {
  return normalizeMarketList(markets, ["US"]);
}

function envFlag(name) {
  return /^(1|true|yes|on)$/i.test(envValue(name));
}

function universeSourceSignature(markets = []) {
  const normalized = normalizeMarkets(markets);
  const parts = [];
  if (normalized.some((market) => FIRDS_CACHE_MARKETS.has(market))) {
    parts.push(envFlag("ESMA_FIRDS_ENABLED")
      ? [
        "esma-firds:on",
        `files:${envValue("ESMA_FIRDS_MAX_FILES") || "1"}`,
        `resolve:${envValue("ESMA_FIRDS_RESOLVE_LIMIT_PER_MARKET") || "25"}`,
        `scan:${envValue("ESMA_FIRDS_SCAN_RECORD_LIMIT") || "750000"}`,
      ].join(":")
      : "esma-firds:off");
  }
  if (normalized.some((market) => FCA_FIRDS_CACHE_MARKETS.has(market))) {
    parts.push(envFlag("FCA_FIRDS_ENABLED")
      ? [
        "fca-firds:on",
        `files:${envValue("FCA_FIRDS_MAX_FILES") || "1"}`,
        `resolve:${envValue("FCA_FIRDS_RESOLVE_LIMIT_PER_MARKET") || "25"}`,
        `scan:${envValue("FCA_FIRDS_SCAN_RECORD_LIMIT") || "750000"}`,
      ].join(":")
      : "fca-firds:off");
  }
  return parts.join("|");
}

function cacheKey(markets = []) {
  const normalized = normalizeMarkets(markets).sort().join(",");
  const signature = universeSourceSignature(markets);
  return `universe:${normalized}${signature ? `|${signature}` : ""}`;
}

function instrumentTypeFor(entry = {}) {
  const name = cleanText(entry.name || entry.companyName || "").toUpperCase();
  const symbol = cleanText(entry.symbol).toUpperCase();
  if (/\b(ETF|ETFS|ETC|ETN|INDEX FUND|VANGUARD|BETASHARES|ISHARES|GLOBALX|VANECK)\b/.test(name)) return "fund";
  if (/\b(BONDS?|TREASURY|NOTES?|LOAN|DEBENTURES?|BILLS?)\b/.test(name)) return "debt";
  if (/\b(WARRANTS?|OPTIONS?|RIGHTS?|UNLISTED)\b/.test(name)) return "derivative";
  if (/\bUNITS?\b/.test(name) && !/\b(STAPLED|REIT|PROPERTY|TRUST)\b/.test(name)) return "derivative";
  if (/\b(PREFERRED|PREFERENCE|PREF|CONVERTIBLE)\b/.test(name)) return "hybrid";
  if (/\bDEPOSITARY SHARES?\b/.test(name) && /\b(PREFERRED|PREFERENCE|PERPETUAL)\b/.test(name)) return "hybrid";
  if (/\b(REIT|STAPLED|UNITS STAPLED|PROPERTY TRUST)\b/.test(name)) return "listed-vehicle";
  if (/\b(CDI|ORDINARY|COMMON|PLC|LTD|LIMITED|CORP|CORPORATION|GROUP|HOLDINGS?|INC|SA|AG|NV)\b/.test(name)) return "equity";
  if (symbol.endsWith(".AX") && /^[A-Z0-9]{2,6}\.AX$/.test(symbol)) return "equity";
  if (/^[A-Z0-9.-]{1,12}(\.[A-Z]{1,3})?$/.test(symbol)) return "equity";
  return "unknown";
}

function qualityGate(entry = {}) {
  const symbol = cleanText(entry.symbol).toUpperCase();
  const name = cleanText(entry.name || entry.companyName || symbol);
  const instrumentType = instrumentTypeFor(entry);
  const reasons = [];
  if (!symbol) reasons.push("sin simbolo");
  if (!/^[A-Z0-9.-]{1,18}$/.test(symbol)) reasons.push("simbolo no soportado");
  if (!name || name === symbol) reasons.push("nombre parcial");
  if (["fund", "debt", "derivative", "hybrid"].includes(instrumentType)) reasons.push(`instrumento ${instrumentType}`);
  if (instrumentType === "unknown") reasons.push("tipo no clasificado");
  return {
    passed: !reasons.some((reason) => /sin simbolo|simbolo no soportado|instrumento|tipo no clasificado/.test(reason)),
    label: reasons.length ? "parcial" : "apto",
    reasons,
    instrumentType,
  };
}

function coverageForUniverseEntry(entry = {}, gate = qualityGate(entry)) {
  const checks = [
    Boolean(entry.symbol),
    Boolean(entry.name && entry.name !== entry.symbol),
    Boolean(entry.country || countryCode(entry.symbol)),
    Boolean(entry.source),
    gate.instrumentType !== "unknown",
    gate.passed,
  ];
  const score = Math.round((checks.filter(Boolean).length / checks.length) * 100);
  return {
    universeCoverageScore: score,
    universeCoverageLabel: score >= 85 ? "alta" : score >= 65 ? "util" : score >= 45 ? "parcial" : "baja",
  };
}

function normalizeEntry(entry = {}, market = "") {
  const symbol = cleanText(entry.symbol).toUpperCase();
  const gate = qualityGate({ ...entry, symbol });
  const coverage = coverageForUniverseEntry({ ...entry, symbol }, gate);
  return {
    symbol,
    name: cleanText(entry.name || entry.companyName || symbol),
    country: cleanText(entry.country || countryCode(symbol) || market),
    market,
    source: cleanText(entry.source || "universe"),
    qualityGate: gate,
    ...coverage,
  };
}

function snapshotSummary(rows = [], excluded = []) {
  const byMarket = {};
  const bySource = {};
  const byInstrumentType = {};
  for (const row of rows) {
    byMarket[row.market || row.country || "-"] = (byMarket[row.market || row.country || "-"] || 0) + 1;
    bySource[row.source || "-"] = (bySource[row.source || "-"] || 0) + 1;
    byInstrumentType[row.qualityGate?.instrumentType || "unknown"] = (byInstrumentType[row.qualityGate?.instrumentType || "unknown"] || 0) + 1;
  }
  return {
    byMarket,
    bySource,
    byInstrumentType,
    excludedByReason: excluded.reduce((map, row) => {
      for (const reason of row.qualityGate?.reasons || ["sin detalle"]) map[reason] = (map[reason] || 0) + 1;
      return map;
    }, {}),
  };
}

function snapshotFromRows({ key, markets, rows, excluded, cache = null }) {
  const now = new Date().toISOString();
  return {
    key,
    markets,
    source: markets.includes("AU") ? "Universe Engine: providers + ASIC + curated" : "Universe Engine: providers + curated",
    count: rows.length,
    totalBeforeGate: rows.length + excluded.length,
    excludedCount: excluded.length,
    qualityGate: {
      enabled: true,
      stage: "pre-scan universe hygiene",
      keeps: ["common equity", "ordinary shares", "CDIs", "listed vehicles"],
      excludes: ["ETFs/funds", "debt", "warrants/options/rights", "malformed symbols"],
    },
    coverage: snapshotSummary(rows, excluded),
    universe: rows,
    excluded,
    cache: cache || { hit: false, status: "memory/build" },
    updatedAt: now,
  };
}

function snapshotAgeHours(value = "") {
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return Infinity;
  return (Date.now() - t) / 36e5;
}

function missingRequiredSources(snapshot = {}, markets = []) {
  const bySource = snapshot.coverage?.bySource || {};
  return markets.some((market) => {
    const requiredSource = REQUIRED_SOURCE_BY_MARKET[market];
    return requiredSource && Number(bySource[requiredSource] || 0) <= 0;
  });
}

async function buildUniverse(markets = []) {
  const normalizedMarkets = normalizeMarkets(markets);
  const raw = [];
  for (const market of normalizedMarkets) {
    const rows = await getUniverse(market);
    raw.push(...rows.map((row) => normalizeEntry(row, market)));
  }
  const deduped = [...new Map(raw.filter((row) => row.symbol).map((row) => [row.symbol, row])).values()];
  const universe = deduped.filter((row) => row.qualityGate.passed);
  const excluded = deduped.filter((row) => !row.qualityGate.passed);
  return snapshotFromRows({ key: cacheKey(normalizedMarkets), markets: normalizedMarkets, rows: universe, excluded });
}

function cachedPriority(markets = []) {
  const priority = new Map();
  for (const market of markets || []) {
    for (const symbol of marketSymbols(market)) {
      const key = cleanText(symbol).toUpperCase();
      if (key && !priority.has(key)) priority.set(key, priority.size);
    }
  }
  return priority;
}

function sortCachedUniverseRows(rows = [], markets = []) {
  const priority = cachedPriority(markets);
  return rows.sort((a, b) => {
    const ap = priority.has(a.symbol) ? priority.get(a.symbol) : Infinity;
    const bp = priority.has(b.symbol) ? priority.get(b.symbol) : Infinity;
    return ap - bp || String(a.symbol).localeCompare(String(b.symbol));
  });
}

function dbSnapshotToApi(snapshot = {}, symbols = [], cache = {}) {
  const universe = symbols
    .filter((row) => row.passed !== false)
    .map((row) => ({
      symbol: row.symbol,
      name: row.name || row.symbol,
      country: row.country,
      market: row.market,
      source: row.source,
      qualityGate: row.quality_gate || {},
      ...(row.coverage || {}),
    }));
  const excluded = symbols
    .filter((row) => row.passed === false)
    .map((row) => ({
      symbol: row.symbol,
      name: row.name || row.symbol,
      country: row.country,
      market: row.market,
      source: row.source,
      qualityGate: row.quality_gate || {},
      ...(row.coverage || {}),
    }));
  return {
    key: snapshot.cache_key,
    markets: snapshot.markets || [],
    source: snapshot.source || "Universe Engine cache",
    count: universe.length,
    totalBeforeGate: Number(snapshot.total_count || universe.length + excluded.length),
    excludedCount: Number(snapshot.excluded_count || excluded.length),
    qualityGate: snapshot.quality_gate || {},
    coverage: snapshot.coverage || snapshotSummary(universe, excluded),
    universe: sortCachedUniverseRows(universe, snapshot.markets || []),
    excluded,
    cache,
    updatedAt: snapshot.updated_at,
  };
}

async function readSupabaseSnapshot(key, maxAgeHours = DEFAULT_MAX_AGE_HOURS) {
  const config = supabaseConfig();
  if (!config.configured) return null;
  const snapshots = await supabaseRequest("universe_snapshots", {
    query: `owner_id=eq.${encodeURIComponent(config.ownerId)}&cache_key=eq.${encodeURIComponent(key)}&select=*&order=updated_at.desc&limit=1`,
  });
  const snapshot = snapshots?.[0];
  if (!snapshot || snapshotAgeHours(snapshot.updated_at) > maxAgeHours) return null;
  const symbols = await supabaseRequestAll("universe_snapshot_symbols", {
    query: `snapshot_id=eq.${encodeURIComponent(snapshot.id)}&select=*&order=symbol.asc`,
  }, {
    maxRows: Number(snapshot.total_count || 20000),
  });
  const apiSnapshot = dbSnapshotToApi(snapshot, symbols || [], {
    hit: true,
    status: "supabase",
    ageHours: Math.round(snapshotAgeHours(snapshot.updated_at) * 10) / 10,
  });
  if (missingRequiredSources(apiSnapshot, snapshot.markets || [])) return null;
  return apiSnapshot;
}

async function writeSupabaseSnapshot(snapshot) {
  const config = supabaseConfig();
  if (!config.configured) return { written: false, status: "supabase-disabled" };
  if (missingRequiredSources(snapshot, snapshot.markets || [])) {
    return { written: false, status: "supabase-skip", reason: "missing-required-official-source" };
  }
  const [saved] = await supabaseRequest("universe_snapshots", {
    method: "POST",
    query: "on_conflict=owner_id,cache_key",
    prefer: "resolution=merge-duplicates,return=representation",
    body: [{
      owner_id: config.ownerId,
      cache_key: snapshot.key,
      markets: snapshot.markets,
      source: snapshot.source,
      total_count: snapshot.totalBeforeGate,
      passed_count: snapshot.count,
      excluded_count: snapshot.excludedCount,
      quality_gate: snapshot.qualityGate,
      coverage: snapshot.coverage,
      updated_at: new Date().toISOString(),
    }],
  });
  await supabaseRequest("universe_snapshot_symbols", {
    method: "DELETE",
    query: `snapshot_id=eq.${encodeURIComponent(saved.id)}`,
  });
  const rows = [...snapshot.universe.map((row) => ({ ...row, passed: true })), ...snapshot.excluded.map((row) => ({ ...row, passed: false }))];
  for (let i = 0; i < rows.length; i += 500) {
    await supabaseRequest("universe_snapshot_symbols", {
      method: "POST",
      query: "on_conflict=snapshot_id,symbol",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: rows.slice(i, i + 500).map((row) => ({
        owner_id: config.ownerId,
        snapshot_id: saved.id,
        symbol: row.symbol,
        name: row.name,
        country: row.country,
        market: row.market,
        source: row.source,
        instrument_type: row.qualityGate?.instrumentType || "unknown",
        passed: row.passed,
        quality_gate: row.qualityGate || {},
        coverage: {
          universeCoverageScore: row.universeCoverageScore,
          universeCoverageLabel: row.universeCoverageLabel,
        },
        raw: row,
      })),
    });
  }
  return { written: true, status: "supabase", snapshotId: saved.id };
}

export async function getUniverseEngineSnapshot({ markets = ["US"], refresh = false, maxAgeHours = DEFAULT_MAX_AGE_HOURS } = {}) {
  const normalizedMarkets = normalizeMarkets(markets);
  const key = cacheKey(normalizedMarkets);
  const cached = memoryCache.get(key);
  if (!refresh && cached?.expiresAt > Date.now()) {
    return { ...cached.snapshot, cache: { hit: true, status: "memory" } };
  }
  if (!refresh) {
    try {
      const dbSnapshot = await readSupabaseSnapshot(key, maxAgeHours);
      if (dbSnapshot) {
        memoryCache.set(key, { expiresAt: Date.now() + MEMORY_TTL_MS, snapshot: dbSnapshot });
        return dbSnapshot;
      }
    } catch (error) {
      // Missing cache tables should never block the app.
    }
  }
  const snapshot = await buildUniverse(normalizedMarkets);
  let cache = { hit: false, status: "built" };
  try {
    cache = { ...cache, ...(await writeSupabaseSnapshot(snapshot)) };
  } catch (error) {
    cache = { ...cache, written: false, status: "supabase-skip", error: error.message };
  }
  const out = { ...snapshot, cache };
  memoryCache.set(key, { expiresAt: Date.now() + MEMORY_TTL_MS, snapshot: out });
  return out;
}

export { qualityGateForResearchRow };
