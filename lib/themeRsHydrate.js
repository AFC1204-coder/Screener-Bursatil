// lib/themeRsHydrate.js — hidratación server-only del RS tema (MET-3b).

import { finiteOrNull, supabaseConfig, supabaseRequest, toDate } from "@/lib/supabaseServer";
import { themeRsEngineVersion } from "@/lib/rsEngines";
import { exclusionReasonText } from "@/lib/globalRs";
import { dedupeWeeklyRsSeriesByWeekKey } from "@/lib/rsWeeklySeries";
import {
  attachWeeklyThemeRs,
  themeExclusionReasonText,
  themeKeyForRow,
  themeRsAssignmentForRow,
  THEME_RS_NOT_RANKED_REASON,
} from "@/lib/themeRs";
import { THEME_PROFILE_MISSING, THEME_RESIDUAL } from "@/lib/themeRsAssign";

const WEEKLY_THEME_RS_SELECT = "symbol,snapshot_date,week_key,engine_version,rank_index,rs_rating,rs_raw,sample_size,metrics";

function cleanSymbol(value = "") {
  return String(value || "").trim().toUpperCase();
}

function weeklyThemeRsEntry(row = {}, themeKey = "") {
  const rsRating = finiteOrNull(row.rs_rating);
  if (!Number.isFinite(rsRating)) {
    const code = String(row?.metrics?.exclusionReason || "").trim();
    if (!code) return null;
    const detail = String(row?.metrics?.exclusionDetail || "").trim();
    return {
      available: false,
      reason: themeExclusionReasonText(code, detail) || exclusionReasonText(code) || THEME_RS_NOT_RANKED_REASON,
      exclusionReason: code,
      exclusionDetail: detail,
      themeKey,
    };
  }
  return {
    available: true,
    rsRating,
    rsRaw: finiteOrNull(row.rs_raw),
    rank: Number.isFinite(Number(row.rank_index)) ? Number(row.rank_index) : null,
    sampleSize: Number.isFinite(Number(row.sample_size)) ? Number(row.sample_size) : null,
    asOf: toDate(row.snapshot_date),
    weekKey: row.week_key || "",
    engineVersion: row.engine_version || "",
    themeKey,
  };
}

async function readEngineThemeRsForSymbols(symbols = [], engineVersion = "", themeKey = "") {
  const config = supabaseConfig();
  const cleanSymbols = [...new Set((symbols || []).map((s) => String(s || "").trim().toUpperCase()).filter(Boolean))];
  const bySymbol = new Map();
  if (!config.configured || !cleanSymbols.length || !engineVersion) {
    return { configured: config.configured, bySymbol };
  }
  for (const symbol of cleanSymbols) {
    bySymbol.set(symbol, { available: false, reason: THEME_RS_NOT_RANKED_REASON, themeKey });
  }
  const chunkSize = 16;
  const rowsPerSymbolCap = 5;
  const chunks = [];
  for (let i = 0; i < cleanSymbols.length; i += chunkSize) chunks.push(cleanSymbols.slice(i, i + chunkSize));
  for (const chunk of chunks) {
    const rows = await supabaseRequest("rs_weekly_items", {
      query: [
        `owner_id=eq.${encodeURIComponent(config.ownerId)}`,
        `engine_version=eq.${encodeURIComponent(engineVersion)}`,
        `symbol=in.(${chunk.map(encodeURIComponent).join(",")})`,
        `select=${WEEKLY_THEME_RS_SELECT}`,
        "order=symbol.asc,snapshot_date.desc",
        `limit=${Math.min(chunk.length * rowsPerSymbolCap, 1000)}`,
      ].join("&"),
    });
    const latestBySymbol = new Map();
    for (const row of rows || []) {
      const symbol = String(row.symbol || "").trim().toUpperCase();
      if (!latestBySymbol.has(symbol)) latestBySymbol.set(symbol, row);
    }
    for (const [symbol, row] of latestBySymbol) {
      const entry = weeklyThemeRsEntry(row, themeKey);
      if (entry) bySymbol.set(symbol, entry);
    }
  }
  return { configured: true, bySymbol };
}

export async function readThemeRsForSymbols(symbols = [], options = {}) {
  const config = supabaseConfig();
  const cleanSymbols = [...new Set((symbols || []).map((s) => String(s || "").trim().toUpperCase()).filter(Boolean))];
  const bySymbol = new Map();
  if (!config.configured || !cleanSymbols.length) {
    return { configured: config.configured, bySymbol };
  }

  const rowBySymbol = options.rowBySymbol || new Map();
  const byEngine = new Map();

  for (const symbol of cleanSymbols) {
    const row = rowBySymbol.get(symbol) || {};
    const assignment = themeRsAssignmentForRow(row);
    if (assignment.exclusionReason === THEME_PROFILE_MISSING || assignment.exclusionReason === THEME_RESIDUAL) {
      bySymbol.set(symbol, {
        available: false,
        reason: themeExclusionReasonText(assignment.exclusionReason) || THEME_RS_NOT_RANKED_REASON,
        exclusionReason: assignment.exclusionReason,
        exclusionDetail: assignment.exclusionDetail || "",
        themeKey: null,
      });
      continue;
    }
    const themeKey = assignment.themeKey || themeKeyForRow(row);
    const engineVersion = themeRsEngineVersion(themeKey);
    if (!engineVersion) continue;
    const list = byEngine.get(engineVersion) || { themeKey, symbols: [] };
    list.symbols.push(symbol);
    byEngine.set(engineVersion, list);
  }

  for (const [engineVersion, { themeKey, symbols: engineSymbols }] of byEngine) {
    const themed = await readEngineThemeRsForSymbols(engineSymbols, engineVersion, themeKey);
    for (const [symbol, entry] of themed.bySymbol || []) {
      bySymbol.set(symbol, entry);
    }
  }

  return { configured: true, bySymbol };
}

export { attachWeeklyThemeRs };

/** Serie histórica semanal del RS tema para la ficha (un engine por theme). */
export async function readThemeRsSeriesForSymbol(symbol = "", options = {}) {
  const config = supabaseConfig();
  const clean = cleanSymbol(symbol);
  if (!config.configured || !clean) {
    return { configured: config.configured, series: [], latest: null, themeKey: "" };
  }
  const themeKey = String(options.themeKey || "").trim();
  const engineVersion = themeRsEngineVersion(themeKey);
  if (!engineVersion) {
    return { configured: true, symbol: clean, themeKey, series: [], latest: null };
  }
  const limit = Math.min(Math.max(Number(options.limit || 180), 1), 260);
  const rows = await supabaseRequest("rs_weekly_items", {
    query: [
      `owner_id=eq.${encodeURIComponent(config.ownerId)}`,
      `symbol=eq.${encodeURIComponent(clean)}`,
      `engine_version=eq.${encodeURIComponent(engineVersion)}`,
      `select=${WEEKLY_THEME_RS_SELECT},base_currency`,
      "order=snapshot_date.desc",
      `limit=${limit}`,
    ].join("&"),
  });
  const series = dedupeWeeklyRsSeriesByWeekKey(
    (rows || [])
      .map((row) => ({
        date: toDate(row.snapshot_date),
        weekKey: row.week_key || "",
        rsRating: finiteOrNull(row.rs_rating),
        rsRaw: finiteOrNull(row.rs_raw),
        rank: Number.isFinite(Number(row.rank_index)) ? Number(row.rank_index) : null,
        sampleSize: Number.isFinite(Number(row.sample_size)) ? Number(row.sample_size) : null,
        baseCurrency: row.base_currency || "",
        engineVersion: row.engine_version || engineVersion,
        themeKey,
        metrics: row.metrics || {},
      }))
      .filter((row) => row.date && Number.isFinite(row.rsRating)),
  );
  return {
    configured: true,
    symbol: clean,
    themeKey,
    engineVersion,
    series,
    latest: series.at(-1) || null,
  };
}

export async function hydrateRowsWithWeeklyThemeRs(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return list;
  const rowBySymbol = new Map(list.map((row) => [
    String(row?.symbol || "").trim().toUpperCase(),
    row,
  ]));
  const symbols = list.map((row) => row?.symbol).filter(Boolean);
  const weekly = await readThemeRsForSymbols(symbols, { rowBySymbol }).catch(() => ({ configured: false, bySymbol: new Map() }));
  return list.map((row) => attachWeeklyThemeRs(row, weekly.bySymbol));
}
