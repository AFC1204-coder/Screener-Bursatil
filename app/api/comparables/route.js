import { supabaseConfig, supabaseRequestAll } from "@/lib/supabaseServer";
import { cleanComparableText, comparableRelationFor, comparableScore, normalizeComparableResult } from "@/lib/comparables";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const config = supabaseConfig();
  const symbol = cleanComparableText(searchParams.get("symbol")).toUpperCase();
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
    const normalized = normalizeComparableResult(row);
    const key = cleanComparableText(normalized.symbol).toUpperCase();
    if (!key || bySymbol.has(key)) continue;
    bySymbol.set(key, normalized);
  }
  const target = bySymbol.get(symbol) || {
    symbol,
    sector: cleanComparableText(searchParams.get("sector")),
    industry: cleanComparableText(searchParams.get("industry")),
    theme: cleanComparableText(searchParams.get("theme")),
    country: cleanComparableText(searchParams.get("country")),
  };
  const universe = [...bySymbol.values()].filter((item) => {
    if (cleanComparableText(item.symbol).toUpperCase() === symbol) return true;
    return (target.industry && item.industry === target.industry)
      || (target.theme && item.theme === target.theme)
      || (target.sector && item.sector === target.sector)
      || (target.country && item.country === target.country);
  });
  const results = universe
    .map((item) => ({ ...item, relation: comparableRelationFor(item, target) }))
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
