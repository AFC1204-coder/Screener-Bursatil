import { supabaseConfig, supabaseRequest, supabaseRequestAll } from "@/lib/supabaseServer";
import { cleanComparableText, comparableRelationFor, comparableScore, normalizeComparableResult } from "@/lib/comparables";

const COMPARABLES_TTL_MS = 5 * 60 * 1000;
const COMPARABLES_MAX_ROWS = 2500;
const COMPARABLES_PAGE_SIZE = 750;
const COMPARABLES_SCAN_LIMIT = 12;
const COMPARABLES_MIN_SCAN_ROWS = 20;
const comparablesCache = globalThis.__statsedgeComparablesCache || new Map();
globalThis.__statsedgeComparablesCache = comparablesCache;

function eqFilter(field = "", value = "") {
  const clean = cleanComparableText(value);
  return clean ? `${field}.eq.${encodeURIComponent(clean)}` : "";
}

function cacheGet(key = "") {
  const hit = comparablesCache.get(key);
  if (!hit || hit.expiresAt < Date.now()) {
    return null;
  }
  return hit.value;
}

function cacheStale(key = "") {
  return comparablesCache.get(key)?.value || null;
}

function cacheSet(key = "", value = null) {
  comparablesCache.set(key, { value, expiresAt: Date.now() + COMPARABLES_TTL_MS });
  return value;
}

async function comparableUniverse({ ownerId, since, sinceDays, symbol, sector, industry, theme, country }) {
  const filters = [
    eqFilter("symbol", symbol),
    eqFilter("industry", industry),
    eqFilter("theme", theme),
    eqFilter("sector", sector),
    eqFilter("country", country),
  ].filter(Boolean);
  const cacheKey = JSON.stringify({ ownerId, sinceDays, filters });
  const cached = cacheGet(cacheKey);
  if (cached) return { ...cached, cache: { hit: true, ttlMs: COMPARABLES_TTL_MS } };
  const scanQuery = (requireMeaningful = true) => [
    `owner_id=eq.${encodeURIComponent(ownerId)}`,
    "deleted_at=is.null",
    `updated_at=gte.${encodeURIComponent(since)}`,
    requireMeaningful ? `row_count=gte.${COMPARABLES_MIN_SCAN_ROWS}` : "",
    "select=id,updated_at,row_count,market_regime",
    "order=updated_at.desc",
    `limit=${COMPARABLES_SCAN_LIMIT}`,
  ].filter(Boolean).join("&");
  let scans = await supabaseRequest("scans", {
    query: scanQuery(true),
  });
  if (!Array.isArray(scans) || !scans.length) {
    scans = await supabaseRequest("scans", {
      query: scanQuery(false),
    });
  }
  const scanIds = (Array.isArray(scans) ? scans : []).map((scan) => scan.id).filter(Boolean);
  if (!scanIds.length) {
    return cacheSet(cacheKey, {
      rows: [],
      cache: { hit: false, ttlMs: COMPARABLES_TTL_MS },
    });
  }
  const query = [
    `owner_id=eq.${encodeURIComponent(ownerId)}`,
    `scan_id=in.(${scanIds.map(encodeURIComponent).join(",")})`,
    filters.length ? `or=(${filters.join(",")})` : "",
    "select=created_at,scan_id,symbol,company_name,country,sector,industry,theme,total_score,rs_rating,metrics",
    "order=created_at.desc",
  ].filter(Boolean).join("&");
  try {
    const rows = await supabaseRequestAll("scan_results", { query }, { pageSize: COMPARABLES_PAGE_SIZE, maxRows: COMPARABLES_MAX_ROWS });
    return cacheSet(cacheKey, {
      rows,
      cache: { hit: false, ttlMs: COMPARABLES_TTL_MS },
    });
  } catch (error) {
    const stale = cacheStale(cacheKey);
    if (stale) return { ...stale, cache: { hit: true, stale: true, ttlMs: COMPARABLES_TTL_MS } };
    throw error;
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const config = supabaseConfig();
  const symbol = cleanComparableText(searchParams.get("symbol")).toUpperCase();
  if (!symbol) return Response.json({ error: "Missing symbol" }, { status: 400 });
  if (!config.configured) {
    return Response.json({ configured: false, target: { symbol }, results: [], note: "El contexto comparativo necesita escaneos guardados." });
  }
  const targetFromParams = {
    symbol,
    sector: cleanComparableText(searchParams.get("sector")),
    industry: cleanComparableText(searchParams.get("industry")),
    theme: cleanComparableText(searchParams.get("theme")),
    country: cleanComparableText(searchParams.get("country")),
  };
  const sinceDays = Math.min(Math.max(Number(searchParams.get("sinceDays") || 45), 7), 180);
  const since = new Date(Date.now() - sinceDays * 86400000).toISOString();
  let rows = [];
  let cache = { hit: false, ttlMs: COMPARABLES_TTL_MS };
  try {
    const universe = await comparableUniverse({ ownerId: config.ownerId, since, sinceDays, ...targetFromParams });
    rows = universe.rows || [];
    cache = universe.cache || cache;
  } catch (error) {
    return Response.json({
      configured: true,
      target: { symbol },
      results: [],
      note: "Contexto comparativo no disponible por una incidencia temporal de datos.",
    });
  }
  const bySymbol = new Map();
  for (const row of rows || []) {
    const normalized = normalizeComparableResult(row);
    const key = cleanComparableText(normalized.symbol).toUpperCase();
    if (!key || bySymbol.has(key)) continue;
    bySymbol.set(key, normalized);
  }
  const target = bySymbol.get(symbol) || {
    symbol,
    sector: targetFromParams.sector,
    industry: targetFromParams.industry,
    theme: targetFromParams.theme,
    country: targetFromParams.country,
  };
  const universe = [...bySymbol.values()].filter((item) => {
    if (cleanComparableText(item.symbol).toUpperCase() === symbol) return true;
    return (target.industry && item.industry === target.industry)
      || (target.theme && item.theme === target.theme)
      || (target.sector && item.sector === target.sector)
      || (target.country && item.country === target.country);
  });
  const results = universe
    .filter((item) => cleanComparableText(item.symbol).toUpperCase() !== symbol)
    .map((item) => ({ ...item, relation: comparableRelationFor(item, target) }))
    .sort((a, b) => comparableScore(a, target) - comparableScore(b, target))
    .slice(0, Math.min(Math.max(Number(searchParams.get("limit") || 10), 4), 20));
  return Response.json({
    configured: true,
    target,
    results,
    cache,
    note: results.length
      ? "Comparables derivados de snapshots recientes. Ordena evidencia observable; no establece preferencias."
      : "Sin referencias comparables en los snapshots recientes con los datos actuales.",
  });
}
