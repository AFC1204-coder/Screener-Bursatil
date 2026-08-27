// lib/materializedScanLookup.js — último scan materializado publicable para un
// conjunto concreto de mercados (preset materialized-cache), sin confundirlo con
// el nocturno US ni con "el más reciente" de la base.
import { normalizeMarketList } from "@/lib/markets";
import { PUBLISHABLE_PARENT_STATUS } from "@/lib/nightlyUsScan";
import { isTestLocalId } from "@/lib/scanLocalId";
import { disabledPayload, supabaseConfig, supabaseRequest } from "@/lib/supabaseServer";

export const DEFAULT_MATERIALIZED_LOOKUP_TIMEOUT_MS = 12000;

// HK/AU: el cron core-us-hk-au suele materializar decenas de filas útiles como
// mucho; por debajo de este umbral el snapshot no sustituye al nocturno US.
export const MATERIALIZED_MIN_ROWS_HK_AU = 15;

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
  if (code !== "HK" && code !== "AU") return false;
  return Number(rowCount) < MATERIALIZED_MIN_ROWS_HK_AU;
}

/**
 * El último scan materializado publicable cuyo settings.markets coincide con el
 * conjunto pedido (mismo conjunto, orden irrelevante). Devuelve { scan, row,
 * reason } simétrico a readNightlyUsScan.
 */
export async function readLatestMaterializedScanForMarkets(
  markets = [],
  { timeoutMs = DEFAULT_MATERIALIZED_LOOKUP_TIMEOUT_MS, columns = MATERIALIZED_LOOKUP_COLUMNS } = {},
) {
  const requested = sortedMarketsForLookup(markets);
  if (!requested.length) {
    return { configured: true, scan: null, row: null, reason: "no-markets", requested: [] };
  }
  const config = supabaseConfig();
  if (!config.configured) {
    return { configured: false, ...disabledPayload(), scan: null, row: null, reason: "supabase-disabled", requested };
  }

  const queryParts = [
    `owner_id=eq.${encodeURIComponent(config.ownerId)}`,
    "preset=eq.materialized-cache",
    "deleted_at=is.null",
    `select=${columns}`,
    "order=created_at.desc",
    "limit=25",
  ];
  // Para un solo mercado, acota candidatos con contains en settings.markets.
  if (requested.length === 1) {
    queryParts.splice(3, 0, `settings->markets=cs.${encodeURIComponent(JSON.stringify(requested))}`);
  }

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
    scan: {
      id: row.id,
      localId: row.local_id,
      createdAt: row.created_at,
      status,
      rowCount,
      markets: requested,
    },
    row,
    reason: null,
    requested,
  };
}
