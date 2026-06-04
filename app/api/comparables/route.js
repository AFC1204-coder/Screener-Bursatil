import { supabaseConfig, supabaseRequestAll } from "@/lib/supabaseServer";
import { businessThemeKey } from "@/lib/businessTheme";

function clean(value = "") {
  return String(value || "").trim();
}

function firstFinite(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function rowValue(row = {}, key = "") {
  return row.raw?.[key] ?? row.metrics?.[key] ?? row[key] ?? null;
}

function normalizedTheme(row = {}, raw = {}) {
  const sector = row.sector || raw.sector || "";
  const industry = row.industry || raw.industry || "";
  if (sector || industry) return businessThemeKey(sector, industry, raw.businessSummary || raw.summary || raw.businessEs || row.theme || raw.theme || "");
  return row.theme || raw.theme || "";
}

function normalizeResult(row = {}) {
  const raw = row.raw || {};
  const metrics = row.metrics || {};
  return {
    symbol: row.symbol || raw.symbol || "",
    companyName: row.company_name || raw.companyName || raw.name || row.symbol || "",
    country: row.country || raw.country || "",
    sector: row.sector || raw.sector || "",
    industry: row.industry || raw.industry || "",
    theme: normalizedTheme(row, raw),
    asOf: row.created_at || "",
    totalScore: firstFinite(raw.totalScore, row.total_score),
    rsGlobalPct: firstFinite(raw.rsGlobalPct, metrics.rsGlobalPct, row.rs_rating),
    rsSectorPct: firstFinite(raw.rsSectorPct, metrics.rsSectorPct),
    setupQualityScore: firstFinite(raw.setupQualityScore, metrics.setupQualityScore),
    patternFamily: clean(rowValue(row, "patternFamily")),
    patternMaturity: clean(rowValue(row, "patternMaturity")),
    patternQualityScore: firstFinite(rowValue(row, "patternQualityScore")),
    setupStructureKey: clean(rowValue(row, "setupStructureKey")),
    setupStructureLabel: clean(rowValue(row, "setupStructureLabel")),
    setupStructureReason: clean(rowValue(row, "setupStructureReason")),
    setupStructureEvidence: clean(rowValue(row, "setupStructureEvidence")),
    setupStructureTone: clean(rowValue(row, "setupStructureTone")),
    setupStructureStrict: rowValue(row, "setupStructureStrict"),
    setupStructureDataLabel: clean(rowValue(row, "setupStructureDataLabel")),
    patternDataStatus: clean(rowValue(row, "patternDataStatus")) || "sin dato",
    patternEligible: rowValue(row, "patternEligible"),
    consolidationCandidate: rowValue(row, "consolidationCandidate"),
    baseContextStatus: clean(rowValue(row, "baseContextStatus")),
    pivotSqueeze: rowValue(row, "pivotSqueeze"),
    contractionDepths: Array.isArray(rowValue(row, "contractionDepths")) ? rowValue(row, "contractionDepths") : [],
    contractionCount: firstFinite(rowValue(row, "contractionCount")),
    lastContractionDepthPct: firstFinite(rowValue(row, "lastContractionDepthPct")),
    baseDepthPct: firstFinite(rowValue(row, "baseDepthPct")),
    baseWeeks: firstFinite(rowValue(row, "baseWeeks")),
    distanceToPivotPct: firstFinite(rowValue(row, "distanceToPivotPct")),
    absDistanceToPivotPct: firstFinite(rowValue(row, "absDistanceToPivotPct")),
    volumeDryUpRatio: firstFinite(rowValue(row, "volumeDryUpRatio")),
    tightness10dPct: firstFinite(rowValue(row, "tightness10dPct")),
    extSma50: firstFinite(rowValue(row, "extSma50")),
    avgTurnover: firstFinite(rowValue(row, "avgTurnover")),
  };
}

function relationFor(item = {}, target = {}) {
  if (clean(item.symbol).toUpperCase() === clean(target.symbol).toUpperCase()) return { key: "current", label: "Activo actual", rank: 0 };
  if (clean(item.industry) && clean(item.industry) === clean(target.industry)) return { key: "industry", label: "Misma industria", rank: 1 };
  if (clean(item.theme) && clean(item.theme) === clean(target.theme)) return { key: "theme", label: "Mismo tema", rank: 2 };
  if (clean(item.sector) && clean(item.sector) === clean(target.sector)) return { key: "sector", label: "Mismo sector", rank: 3 };
  if (clean(item.country) && clean(item.country) === clean(target.country)) return { key: "country", label: "Mismo mercado", rank: 4 };
  return { key: "context", label: "Contexto relacionado", rank: 5 };
}

function comparableScore(item = {}, target = {}) {
  const relation = relationFor(item, target);
  return relation.rank * 1000
    - (Number.isFinite(item.rsSectorPct) ? item.rsSectorPct : 0)
    - (Number.isFinite(item.patternQualityScore) ? item.patternQualityScore * .5 : 0)
    + (Number.isFinite(item.absDistanceToPivotPct) ? item.absDistanceToPivotPct * .7 : 8);
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const config = supabaseConfig();
  const symbol = clean(searchParams.get("symbol")).toUpperCase();
  if (!symbol) return Response.json({ error: "Missing symbol" }, { status: 400 });
  if (!config.configured) {
    return Response.json({ configured: false, target: { symbol }, results: [], note: "Contexto comparativo requiere snapshots guardados en Supabase." });
  }
  const sinceDays = Math.min(Math.max(Number(searchParams.get("sinceDays") || 60), 7), 180);
  const since = new Date(Date.now() - sinceDays * 86400000).toISOString();
  let rows = [];
  try {
    rows = await supabaseRequestAll("scan_results", {
      query: [
        `owner_id=eq.${encodeURIComponent(config.ownerId)}`,
        `created_at=gte.${encodeURIComponent(since)}`,
        "select=created_at,scan_id,symbol,company_name,country,sector,industry,theme,total_score,rs_rating,metrics,raw",
        "order=created_at.desc",
      ].join("&"),
    }, { limit: 1000, maxRows: 4000 });
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
    const normalized = normalizeResult(row);
    const key = clean(normalized.symbol).toUpperCase();
    if (!key || bySymbol.has(key)) continue;
    bySymbol.set(key, normalized);
  }
  const target = bySymbol.get(symbol) || {
    symbol,
    sector: clean(searchParams.get("sector")),
    industry: clean(searchParams.get("industry")),
    theme: clean(searchParams.get("theme")),
    country: clean(searchParams.get("country")),
  };
  const universe = [...bySymbol.values()].filter((item) => {
    if (clean(item.symbol).toUpperCase() === symbol) return true;
    return (target.industry && item.industry === target.industry)
      || (target.theme && item.theme === target.theme)
      || (target.sector && item.sector === target.sector)
      || (target.country && item.country === target.country);
  });
  const results = universe
    .map((item) => ({ ...item, relation: relationFor(item, target) }))
    .sort((a, b) => comparableScore(a, target) - comparableScore(b, target))
    .slice(0, Math.min(Math.max(Number(searchParams.get("limit") || 10), 4), 20));
  return Response.json({
    configured: true,
    target,
    results,
    note: results.length
      ? "Comparables derivados de snapshots recientes. Ordena evidencia observable; no establece preferencias."
      : "Sin referencias comparables en los snapshots recientes con los datos actuales.",
  });
}
