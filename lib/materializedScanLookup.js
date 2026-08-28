// lib/materializedScanLookup.js — último scan materializado publicable para un
// conjunto concreto de mercados (preset materialized-cache), sin confundirlo con
// el nocturno US ni con "el más reciente" de la base.
import { EUROPE_PRIORITY_MARKETS, EUROPE_SECONDARY_MARKETS, normalizeMarketList } from "@/lib/markets";
import { PUBLISHABLE_PARENT_STATUS, readNightlyUsScan } from "@/lib/nightlyUsScan";
import { isTestLocalId } from "@/lib/scanLocalId";
import { disabledPayload, supabaseConfig, supabaseRequest } from "@/lib/supabaseServer";

export const DEFAULT_MATERIALIZED_LOOKUP_TIMEOUT_MS = 12000;

// Mercados con cohort cron de un solo mercado (HK/AU/KR/IN/CA/JP + Europa priority/secondary):
// deben materializar ≥15 filas; por debajo de este umbral el snapshot no sustituye
// al nocturno US.
export const MATERIALIZED_MIN_ROWS_CURATED_CORE = 15;
/** @deprecated Usar MATERIALIZED_MIN_ROWS_CURATED_CORE */
export const MATERIALIZED_MIN_ROWS_HK_AU = MATERIALIZED_MIN_ROWS_CURATED_CORE;

const CURATED_CORE_LOOKUP_MARKETS = new Set(["HK", "AU", "KR", "IN", "CA", "JP", ...EUROPE_PRIORITY_MARKETS, ...EUROPE_SECONDARY_MARKETS]);

export const MATERIALIZED_LOOKUP_COLUMNS = "id,local_id,created_at,settings,row_count,preset";

function statusOf(scan = {}) {
  return String(scan?.settings?.progress?.status || "").trim();
}

/** Mercados normalizados y ordenados para comparar conjuntos. */
export function sortedMarketsForLookup(markets = []) {
  return normalizeMarketList(markets, []).slice().sort();
}

export function marketsSettingsMatch(storedMarkets = [], requestedMarkets = []) {
  const stored = sortedMarketsForLookup(storedMarkets);
  const requested = sortedMarketsForLookup(requestedMarkets);
  if (!requested.length || stored.length !== requested.length) return false;
  return stored.every((code, index) => code === requested[index]);
}

function insufficientRowsForMarket(markets, rowCount) {
  const code = sortedMarketsForLookup(markets)[0];
  if (!CURATED_CORE_LOOKUP_MARKETS.has(code)) return false;
  return Number(rowCount) < MATERIALIZED_MIN_ROWS_CURATED_CORE;
}

function buildMaterializedScanSummary(row, requested) {
  const status = statusOf(row);
  const rowCount = Number(row.row_count) || 0;
  return {
    id: row.id,
    localId: row.local_id,
    createdAt: row.created_at,
    status,
    rowCount,
    markets: requested,
  };
}

function buildNightlyUsScanSummary(row) {
  const status = statusOf(row);
  const rowCount = Number(row.row_count) || 0;
  return {
    id: row.id,
    localId: row.local_id,
    createdAt: row.created_at,
    status,
    rowCount,
    markets: ["US"],
  };
}

function buildSyntheticMergedRow(requested, sources, { includeNightlyUs = false } = {}) {
  const mergedFrom = sources.map((source) => ({
    localId: source.scan.localId,
    cloudId: source.row.id,
    market: source.scan.markets?.[0] || source.market || null,
    rowCount: source.scan.rowCount,
    createdAt: source.scan.createdAt,
    status: source.scan.status,
    ...(source.source ? { source: source.source } : {}),
  }));
  const createdAt = mergedFrom.reduce(
    (latest, item) => (item.createdAt > latest ? item.createdAt : latest),
    mergedFrom[0].createdAt,
  );
  const rowCount = mergedFrom.reduce((sum, item) => sum + item.rowCount, 0);
  const marketsKey = requested.join("-");
  const dateKey = String(createdAt).slice(0, 10);
  const sourceType = includeNightlyUs ? "merged-nightly-materialized" : "merged-materialized";
  const localIdPrefix = includeNightlyUs ? "merged-nightly-materialized" : "merged-materialized";
  const localId = `${localIdPrefix}:${marketsKey}:${dateKey}`;
  return {
    id: localId,
    local_id: localId,
    name: `Materializado fusionado ${requested.join(", ")}`,
    preset: "materialized-cache",
    settings: {
      markets: requested,
      progress: { status: "partial" },
      source: sourceType,
      mergedFrom,
    },
    market_score: null,
    market_regime: null,
    row_count: rowCount,
    created_at: createdAt,
    updated_at: createdAt,
    deleted_at: null,
  };
}

/**
 * Último scan materializado publicable para UN mercado (settings.markets exacto).
 * Devuelve { scan, row, reason } simétrico a readNightlyUsScan.
 */
export async function readLatestSingleMarketMaterializedScan(
  markets = [],
  { timeoutMs = DEFAULT_MATERIALIZED_LOOKUP_TIMEOUT_MS, columns = MATERIALIZED_LOOKUP_COLUMNS } = {},
) {
  const requested = sortedMarketsForLookup(markets);
  if (!requested.length) {
    return { configured: true, scan: null, row: null, reason: "no-markets", requested: [] };
  }
  if (requested.length !== 1) {
    return { configured: true, scan: null, row: null, reason: "single-market-only", requested };
  }
  const config = supabaseConfig();
  if (!config.configured) {
    return { configured: false, ...disabledPayload(), scan: null, row: null, reason: "supabase-disabled", requested };
  }

  const queryParts = [
    `owner_id=eq.${encodeURIComponent(config.ownerId)}`,
    "preset=eq.materialized-cache",
    `settings->markets=cs.${encodeURIComponent(JSON.stringify(requested))}`,
    "deleted_at=is.null",
    `select=${columns}`,
    "order=created_at.desc",
    "limit=25",
  ];

  const scans = await supabaseRequest("scans", {
    query: queryParts.join("&"),
    timeoutMs,
  });
  const candidates = (Array.isArray(scans) ? scans : []).filter(
    (row) => row && !isTestLocalId(row.local_id) && marketsSettingsMatch(row.settings?.markets, requested),
  );
  const row = candidates[0] || null;
  if (!row) {
    return { configured: true, scan: null, row: null, reason: "no-materialized-scan", requested };
  }

  const status = statusOf(row);
  if (!PUBLISHABLE_PARENT_STATUS.includes(status)) {
    return {
      configured: true,
      scan: null,
      row: null,
      reason: "materialized-not-publishable",
      requested,
      rejectedScan: { id: row.id, localId: row.local_id, createdAt: row.created_at, status, rowCount: row.row_count },
    };
  }

  const rowCount = Number(row.row_count) || 0;
  if (insufficientRowsForMarket(requested, rowCount)) {
    return {
      configured: true,
      scan: null,
      row: null,
      reason: "insufficient-rows",
      requested,
      rejectedScan: { id: row.id, localId: row.local_id, createdAt: row.created_at, status, rowCount },
    };
  }

  return {
    configured: true,
    scan: buildMaterializedScanSummary(row, requested),
    row,
    reason: null,
    requested,
  };
}

/**
 * Último scan materializado publicable para el conjunto pedido.
 * Un mercado: scan exacto. Varios: unión de materializados por mercado si todos
 * son publicables; si falta alguno, reason partial-markets.
 */
async function readMergedIntlMaterializedScans(requested, options = {}) {
  const perMarket = await Promise.all(
    requested.map((code) => readLatestSingleMarketMaterializedScan([code], options)),
  );
  const missing = [];
  const sources = [];
  for (let index = 0; index < requested.length; index += 1) {
    const result = perMarket[index];
    if (!result.scan) {
      missing.push({ market: requested[index], reason: result.reason || "no-materialized-scan" });
    } else {
      sources.push(result);
    }
  }
  if (missing.length) {
    return {
      configured: true,
      scan: null,
      row: null,
      reason: "partial-markets",
      requested,
      missingMarkets: missing.map((item) => item.market),
      missingDetails: missing,
    };
  }

  const syntheticRow = buildSyntheticMergedRow(requested, sources);
  const sourceScans = sources.map((source) => source.row);
  return {
    configured: true,
    scan: {
      ...buildMaterializedScanSummary(syntheticRow, requested),
      source: "merged-materialized",
      sourceScans,
    },
    row: syntheticRow,
    sourceScans,
    merged: true,
    reason: null,
    requested,
  };
}

export async function readLatestMaterializedScanForMarkets(
  markets = [],
  options = {},
) {
  const requested = sortedMarketsForLookup(markets);
  if (!requested.length) {
    return { configured: true, scan: null, row: null, reason: "no-markets", requested: [] };
  }

  const config = supabaseConfig();
  if (!config.configured) {
    return { configured: false, ...disabledPayload(), scan: null, row: null, reason: "supabase-disabled", requested };
  }

  if (requested.length === 1) {
    if (requested[0] === "US") {
      const nightly = await readNightlyUsScan(options);
      if (!nightly.scan) {
        return {
          configured: true,
          scan: null,
          row: null,
          reason: nightly.reason || "no-nightly-scan",
          requested,
          rejectedScan: nightly.rejectedScan || null,
        };
      }
      return {
        configured: true,
        scan: { ...buildNightlyUsScanSummary(nightly.row), source: "nightly-us" },
        row: nightly.row,
        reason: null,
        requested,
      };
    }
    return readLatestSingleMarketMaterializedScan(requested, options);
  }

  if (!requested.includes("US")) {
    return readMergedIntlMaterializedScans(requested, options);
  }

  const intlMarkets = requested.filter((code) => code !== "US");
  const [usResult, ...intlResults] = await Promise.all([
    readNightlyUsScan(options),
    ...intlMarkets.map((code) => readLatestSingleMarketMaterializedScan([code], options)),
  ]);

  const missing = [];
  if (!usResult.scan) {
    missing.push({ market: "US", reason: usResult.reason || "no-nightly-scan" });
  }
  for (let index = 0; index < intlMarkets.length; index += 1) {
    const result = intlResults[index];
    if (!result.scan) {
      missing.push({ market: intlMarkets[index], reason: result.reason || "no-materialized-scan" });
    }
  }
  if (missing.length) {
    return {
      configured: true,
      scan: null,
      row: null,
      reason: "partial-markets",
      requested,
      missingMarkets: missing.map((item) => item.market),
      missingDetails: missing,
    };
  }

  const sources = [{
    scan: buildNightlyUsScanSummary(usResult.row),
    row: usResult.row,
    market: "US",
    source: "nightly-us",
  }];
  for (const result of intlResults) sources.push(result);

  const syntheticRow = buildSyntheticMergedRow(requested, sources, { includeNightlyUs: true });
  const sourceScans = sources.map((source) => source.row);
  return {
    configured: true,
    scan: {
      ...buildMaterializedScanSummary(syntheticRow, requested),
      source: "merged-nightly-materialized",
      sourceScans,
    },
    row: syntheticRow,
    sourceScans,
    merged: true,
    reason: null,
    requested,
  };
}
