import assert from "node:assert/strict";

const BASE_URL = process.env.COHERENCE_BASE_URL || "http://127.0.0.1:3000";
const TOKEN = process.env.STATSEDGE_ACCESS_TOKEN || process.env.STATSEDGE_API_TOKEN || process.env.STATSEDGE_ADMIN_TOKEN || "";
const SAMPLE_LIMIT = Math.max(1, Math.min(Number(process.env.COHERENCE_SAMPLE_LIMIT || 20), 25));

async function getJson(path) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      ...(TOKEN ? { "x-statsedge-token": TOKEN } : {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(`${path}: ${data.error || data.message || `HTTP ${res.status}`}`);
  return data;
}

function assertRsContract(leaderboard, threshold, label) {
  const items = leaderboard?.items || [];
  for (const item of items) {
    assert.ok(
      Number.isFinite(item.rsGlobalPct) && item.rsGlobalPct >= threshold,
      `${label}: ${item.symbol} must have rsGlobalPct >= ${threshold}; got ${item.rsGlobalPct}`,
    );
  }
  return items.length;
}

async function main() {
  const status = await getJson("/api/supabase/status");
  assert.equal(status.ok, true, "Supabase status must be OK");
  assert.deepEqual(status.missing || [], [], "Supabase status must not miss tables");
  assert.deepEqual(status.missingFunctions || [], [], "Supabase status must not miss RPC functions");

  const favorites = await getJson("/api/favorites?includeDeleted=1&limit=500");
  assert.equal(favorites.ok, true, "favorites endpoint must be OK");
  assert.equal((favorites.favorites || []).some((item) => item.deletedAt), false, "active favorites response must not include deleted rows");

  const scans = await getJson("/api/scans?includeRows=0&includeDeleted=1&limit=100");
  assert.equal(scans.ok, true, "scans endpoint must be OK");
  assert.equal((scans.scans || []).some((item) => item.deletedAt), false, "active scans response must not include deleted rows");

  const alerts = await getJson("/api/alerts?status=all&limit=500");
  assert.equal(alerts.ok, true, "alerts endpoint must be OK");
  const alertIds = new Set();
  for (const alert of alerts.alerts || []) {
    const key = alert.id || alert.payload?.localId || alert.cloudId;
    assert.ok(key, "every alert must expose a stable local id");
    assert.equal(alertIds.has(key), false, `duplicate alert id returned: ${key}`);
    alertIds.add(key);
    assert.ok(alert.updatedAt || alert.triggeredAt || alert.createdAt, `alert ${key} must expose a freshness timestamp`);
  }

  const settings = await getJson("/api/settings?type=screener_filters&key=default");
  assert.equal(settings.ok, true, "settings endpoint must be OK");
  assert.ok(settings.setting, "default screener settings must exist in Supabase");
  assert.ok(settings.setting.updatedAt, "saved settings must expose updatedAt");

  const strictRs = await getJson("/api/leaderboards?key=global-rs&strategy=rs&minRs=99&cache=0&limit=10&maxPriceFreshnessDays=999");
  const strictCount = assertRsContract(strictRs.leaderboard, 99, "strict RS leaderboard");

  const filteredRs = await getJson("/api/leaderboards?key=global-rs&strategy=rs&minRsRating=99&cache=0&limit=10&maxPriceFreshnessDays=999");
  const filteredCount = assertRsContract(filteredRs.leaderboard, 99, "screener-filtered RS leaderboard");

  const fallback = await getJson(`/api/leaderboards?key=global-rs&strategy=rs&minRs=90&cache=0&limit=${SAMPLE_LIMIT}&maxPriceFreshnessDays=999`);
  assertRsContract(fallback.leaderboard, 90, "RS fallback audit leaderboard");

  const symbol = strictRs.leaderboard?.items?.[0]?.symbol || fallback.leaderboard?.items?.[0]?.symbol || "NVDA";
  const sampledItems = (fallback.leaderboard?.items || []).slice(0, SAMPLE_LIMIT);
  if (!sampledItems.some((item) => item.symbol === symbol)) sampledItems.unshift({ symbol });
  const briefAudits = [];
  for (const item of sampledItems.slice(0, SAMPLE_LIMIT)) {
    const brief = await getJson(`/api/company-brief?symbol=${encodeURIComponent(item.symbol)}`);
    assert.equal(Boolean(brief.dataQuality?.providers), false, `${item.symbol}: company brief must not expose provider internals by default`);
    if (Number.isFinite(brief.relativeStrength?.rsGlobalPct)) {
      assert.ok(brief.relativeStrength.rsGlobalPct >= 0 && brief.relativeStrength.rsGlobalPct <= 99, `${item.symbol}: stock brief RS global must be a percentile`);
      assert.ok(brief.relativeStrength.rsGlobalAsOf || brief.dataQuality?.freshness?.rsGlobalAsOf, `${item.symbol}: stock brief RS global must include an as-of date`);
    }
    if (Number.isFinite(item.rsGlobalPct) && Number.isFinite(brief.relativeStrength?.rsGlobalPct)) {
      assert.ok(
        Math.abs(item.rsGlobalPct - brief.relativeStrength.rsGlobalPct) <= 10,
        `${item.symbol}: leaderboard/ficha RS global diverged too much (${item.rsGlobalPct} vs ${brief.relativeStrength.rsGlobalPct})`,
      );
    }
    briefAudits.push({
      symbol: item.symbol,
      leaderboardRs: Number.isFinite(item.rsGlobalPct) ? item.rsGlobalPct : null,
      briefRs: Number.isFinite(brief.relativeStrength?.rsGlobalPct) ? brief.relativeStrength.rsGlobalPct : null,
      hasAsOf: Boolean(brief.relativeStrength?.rsGlobalAsOf || brief.dataQuality?.freshness?.rsGlobalAsOf),
    });
  }

  console.log(JSON.stringify({
    ok: true,
    supabaseTables: status.tables?.length || 0,
    supabaseFunctions: status.functions?.length || 0,
    activeFavorites: favorites.favorites?.length || 0,
    favoriteTombstones: favorites.favoriteTombstones?.length || 0,
    activeScans: scans.scans?.length || 0,
    scanTombstones: scans.scanTombstones?.length || 0,
    alerts: alerts.alerts?.length || 0,
    settingsSaved: Boolean(settings.setting),
    strictRsCount: strictCount,
    filteredRsCount: filteredCount,
    sampledFicha: symbol,
    sampledBriefs: briefAudits,
  }, null, 2));
}

main().catch((error) => {
  console.error(`FAIL data-coherence-audit: ${error.message}`);
  process.exitCode = 1;
});
