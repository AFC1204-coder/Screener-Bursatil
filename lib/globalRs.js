import { finiteOrNull, supabaseConfig, supabaseRequest, toDate } from "@/lib/supabaseServer";

export const GLOBAL_RS_ENGINE_VERSION = "statsedge-global-rs-usd-v1";
export const GLOBAL_RS_BASE_CURRENCY = "USD";

function cleanSymbol(value = "") {
  return String(value || "").trim().toUpperCase();
}

function dateTime(value = "") {
  const time = Date.parse(String(value || "").length <= 10 ? `${value}T00:00:00Z` : value);
  return Number.isFinite(time) ? time : 0;
}

export async function readGlobalRsSeriesForSymbol(symbol = "", options = {}) {
  const config = supabaseConfig();
  const clean = cleanSymbol(symbol);
  if (!config.configured || !clean) return { configured: config.configured, series: [], latest: null };
  const limit = Math.min(Math.max(Number(options.limit || 180), 1), 260);
  const rows = await supabaseRequest("rs_weekly_items", {
    query: [
      `owner_id=eq.${encodeURIComponent(config.ownerId)}`,
      `symbol=eq.${encodeURIComponent(clean)}`,
      "select=symbol,snapshot_date,week_key,base_currency,engine_version,rank_index,rs_rating,rs_raw,sample_size,metrics",
      "order=snapshot_date.desc",
      `limit=${limit}`,
    ].join("&"),
  });
  const series = (rows || [])
    .map((row) => ({
      date: toDate(row.snapshot_date),
      weekKey: row.week_key || "",
      rsRating: finiteOrNull(row.rs_rating),
      rsRaw: finiteOrNull(row.rs_raw),
      rank: Number.isFinite(Number(row.rank_index)) ? Number(row.rank_index) : null,
      sampleSize: Number.isFinite(Number(row.sample_size)) ? Number(row.sample_size) : null,
      baseCurrency: row.base_currency || GLOBAL_RS_BASE_CURRENCY,
      engineVersion: row.engine_version || "",
      metrics: row.metrics || {},
    }))
    .filter((row) => row.date && Number.isFinite(row.rsRating))
    .sort((a, b) => dateTime(a.date) - dateTime(b.date));
  return {
    configured: true,
    symbol: clean,
    series,
    latest: series.at(-1) || null,
  };
}
