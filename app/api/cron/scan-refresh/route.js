import { scanCronGroupAt, scanCronGroupByKey } from "@/lib/cronPlan";
import { isInternalRequest } from "@/lib/internalAuth";
import {
  readScanBatchCursor,
  runMaterializedScan,
  writeMaterializedScan,
  writeScanBatchCursor,
} from "@/lib/materializedScanner";
import { writeScanSymbolHistory } from "@/lib/scanHistory";
import { supabaseConfig, supabaseRequest } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ROTATION_SETTING_TYPE = "jobs";
const ROTATION_SETTING_KEY = "scan-refresh-cron-rotation";

function authorized(request) {
  return isInternalRequest(request, { allowCron: true });
}

function numberParam(searchParams, key, fallback, min, max) {
  const raw = searchParams.get(key);
  const n = raw === null || raw === "" ? fallback : Number(raw);
  const value = Number.isFinite(n) ? n : fallback;
  return Math.min(Math.max(value, min), max);
}

async function readRotation() {
  const config = supabaseConfig();
  if (!config.configured) return { configured: false, value: {} };
  const rows = await supabaseRequest("app_settings", {
    query: `owner_id=eq.${encodeURIComponent(config.ownerId)}&setting_type=eq.${ROTATION_SETTING_TYPE}&setting_key=eq.${ROTATION_SETTING_KEY}&select=*&limit=1`,
  });
  const row = rows?.[0] || null;
  return {
    configured: true,
    value: row?.value && typeof row.value === "object" ? row.value : {},
    updatedAt: row?.updated_at || "",
  };
}

async function writeRotation(value = {}) {
  const config = supabaseConfig();
  if (!config.configured) return { configured: false, saved: false };
  const saved = await supabaseRequest("app_settings", {
    method: "POST",
    query: "on_conflict=owner_id,setting_type,setting_key",
    prefer: "resolution=merge-duplicates,return=representation",
    body: [{
      owner_id: config.ownerId,
      setting_type: ROTATION_SETTING_TYPE,
      setting_key: ROTATION_SETTING_KEY,
      value,
      updated_at: new Date().toISOString(),
    }],
  });
  return { configured: true, saved: true, row: saved?.[0] || null };
}

function cursorOffsets(cursor = {}, markets = []) {
  const savedMarkets = cursor.markets && typeof cursor.markets === "object" ? cursor.markets : {};
  return Object.fromEntries(markets.map((market) => [
    market,
    Math.max(Number(savedMarkets[market]?.offset || 0), 0),
  ]));
}

function nextCursorValue(previous = {}, options = {}, result = {}, savedScan = {}) {
  const markets = { ...((previous.markets && typeof previous.markets === "object") ? previous.markets : {}) };
  const selection = result.stats?.selection || {};
  const nextOffsets = selection.nextMarketOffsets || {};
  const selectedByMarket = selection.selectedByMarket || {};
  const marketTotals = selection.marketTotals || {};
  const now = new Date().toISOString();
  for (const market of options.markets) {
    if (!(market in nextOffsets)) continue;
    markets[market] = {
      offset: Math.max(Number(nextOffsets[market] || 0), 0),
      previousOffset: Math.max(Number(selection.marketOffsets?.[market] || 0), 0),
      selected: Number(selectedByMarket[market] || 0),
      universeTotal: Number(marketTotals[market] || 0),
      lastRunAt: now,
      lastScanId: savedScan.localId || savedScan.scanId || "",
    };
  }
  return {
    ...previous,
    updatedAt: now,
    lastRun: {
      at: now,
      markets: options.markets,
      selected: result.stats?.selected || 0,
      savedRows: result.stats?.savedRows || 0,
      localId: savedScan.localId || "",
      source: "cron",
    },
    markets,
  };
}

function sanitizeStats(stats = {}) {
  const selection = stats.selection || {};
  return {
    markets: stats.markets || [],
    universeTotal: Number(stats.universeTotal || 0),
    selected: Number(stats.selected || 0),
    passedBase: Number(stats.passedBase || 0),
    savedRows: Number(stats.savedRows || 0),
    rejected: Number(stats.rejected || 0),
    rejections: Array.isArray(stats.rejections) ? stats.rejections : [],
    selection: {
      marketTotals: selection.marketTotals || {},
      selectedByMarket: selection.selectedByMarket || {},
      marketOffsets: selection.marketOffsets || {},
      nextMarketOffsets: selection.nextMarketOffsets || {},
    },
    cache: stats.cache ? {
      hit: Boolean(stats.cache.hit),
      status: stats.cache.status || "",
      written: Boolean(stats.cache.written),
    } : null,
  };
}

async function createRun(group, options) {
  const config = supabaseConfig();
  if (!config.configured) return null;
  try {
    const [run] = await supabaseRequest("provider_runs", {
      method: "POST",
      prefer: "return=representation",
      body: [{
        owner_id: config.ownerId,
        provider: "statsedge-cron",
        run_type: "cron-scan-refresh",
        market: options.markets.join(","),
        status: "started",
        stats: {
          group: group.key,
          markets: options.markets,
          limit: options.limit,
          perMarket: options.perMarket,
        },
      }],
    });
    return run;
  } catch {
    return null;
  }
}

async function finishRun(run, status, payload = {}) {
  if (!run?.id) return;
  try {
    await supabaseRequest("provider_runs", {
      method: "PATCH",
      query: `id=eq.${encodeURIComponent(run.id)}`,
      prefer: "return=minimal",
      body: {
        status,
        finished_at: new Date().toISOString(),
        stats: payload.stats || {},
        error: payload.error || null,
      },
    });
  } catch {
    // Cron logging must not block the materialized scan.
  }
}

export async function GET(request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const rotation = await readRotation().catch(() => ({ value: {} }));
  const manualGroup = scanCronGroupByKey(searchParams.get("group"));
  const rotated = scanCronGroupAt(rotation.value?.nextIndex || 0);
  const group = manualGroup || rotated.group;
  const groupIndex = manualGroup ? rotated.groups.findIndex((item) => item.key === manualGroup.key) : rotated.index;
  const limit = numberParam(searchParams, "limit", group.limit, 1, Math.min(group.limit, 80));
  const perMarket = numberParam(searchParams, "perMarket", group.perMarket, 1, Math.min(group.perMarket, 25));
  const cursor = await readScanBatchCursor().catch(() => ({ value: {} }));
  const options = {
    markets: group.markets,
    limit,
    perMarket,
    marketOffsets: cursorOffsets(cursor.value || {}, group.markets),
    concurrency: numberParam(searchParams, "concurrency", 2, 1, 3),
    maxSavedRows: 500,
    maxPriceFreshnessDays: 5,
    maxFundamentalsAgeDays: 14,
    minBars: 180,
    minPrice: 1,
    minAvgTurnover: 250000,
    minMarketCap: 300000000,
    minCoverageScore: 40,
    cache: true,
    // universe-refresh corre a las 21:10 UTC, 70 min antes que este cron
    // (22:20 UTC) — en operación normal el snapshot tiene minutos de
    // antigüedad. 48h es solo el colchón para el día en que universe-refresh
    // falle o se salte, evitando el fallback a buildUniverse() completo
    // (que puede tardar >60s y detona el maxDuration del cron).
    universeMaxAgeHours: 48,
    refreshUniverse: searchParams.get("refreshUniverse") === "1",
    refreshPrices: searchParams.get("refreshPrices") === "1",
    refreshProfiles: searchParams.get("refreshProfiles") === "1",
  };
  if (searchParams.get("dryRun") === "1") {
    return Response.json({
      ok: true,
      dryRun: true,
      group: { key: group.key, title: group.title, index: groupIndex, nextIndex: rotation.value?.nextIndex || 0 },
      options,
    });
  }
  const run = await createRun(group, options);
  try {
    const result = await runMaterializedScan(options);
    const savedScan = await writeMaterializedScan(result.scan);
    const history = savedScan.saved && result.history
      ? await writeScanSymbolHistory({
        ownerId: supabaseConfig().ownerId,
        sourceScanId: savedScan.scanId,
        ...result.history,
      })
      : { skipped: true, saved: 0 };
    const cursorWrite = savedScan.saved
      ? await writeScanBatchCursor(nextCursorValue(cursor.value || {}, options, result, savedScan)).catch((error) => ({ saved: false, error: error.message }))
      : { skipped: true };
    // Refresco de leaderboards movido a /api/cron/leaderboards-refresh
    // (cadencia baja, propia) para no recomputar la RPC
    // leaderboard_publishable_rows en cada corrida de este cron.
    const leaderboards = { skipped: true, saved: 0 };
    const nextRotation = {
      updatedAt: new Date().toISOString(),
      previousIndex: groupIndex,
      nextIndex: manualGroup ? (rotation.value?.nextIndex || 0) : (groupIndex + 1) % rotated.groups.length,
      lastGroup: group.key,
      lastMarkets: group.markets,
      lastSavedRows: savedScan.rows || 0,
    };
    const rotationWrite = manualGroup ? { skipped: true } : await writeRotation(nextRotation).catch((error) => ({ saved: false, error: error.message }));
    const stats = {
      group: group.key,
      ...sanitizeStats(result.stats),
      savedScan: { saved: Boolean(savedScan.saved), rows: savedScan.rows || 0 },
      history,
      cursor: {
        saved: Boolean(cursorWrite.saved),
        skipped: Boolean(cursorWrite.skipped),
        error: cursorWrite.error || "",
      },
      leaderboards: {
        saved: leaderboards.saved || 0,
        skipped: Boolean(leaderboards.skipped),
      },
      rotation: {
        saved: Boolean(rotationWrite.saved),
        skipped: Boolean(rotationWrite.skipped),
        nextIndex: nextRotation.nextIndex,
      },
    };
    await finishRun(run, result.stats.savedRows ? "completed" : "partial", { stats });
    return Response.json({
      ok: true,
      group: { key: group.key, title: group.title, index: groupIndex },
      scan: { localId: result.scan.id, rowCount: result.scan.rows.length },
      savedScan,
      history,
      cursor: stats.cursor,
      leaderboards,
      rotation: stats.rotation,
      stats: sanitizeStats(result.stats),
    });
  } catch (error) {
    await finishRun(run, "failed", { error: error.message, stats: { group: group.key, markets: options.markets, limit: options.limit } });
    return Response.json({ ok: false, group: group.key, error: error.message || "Cron scan refresh failed" }, { status: 502 });
  }
}

export const POST = GET;
