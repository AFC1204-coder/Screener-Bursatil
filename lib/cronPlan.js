import { intlBroadPerMarketLimit } from "@/lib/intlUniverseGates";
import { EUROPE_PRIORITY_MARKETS, EUROPE_SECONDARY_MARKETS, normalizeMarketList } from "@/lib/markets";

// HK/CA official-broad (INT-3): 72–96 símbolos/noche caben en maxDuration=60 con
// caché de universo + Yahoo en paralelo (concurrency=2). Tunear sin redeploy vía
// STATSEDGE_INTL_BROAD_PER_MARKET.
const INTL_BROAD_CRON_PER_MARKET = intlBroadPerMarketLimit();

// EU1/EU2 (the 14 FIRDS markets: GB, DE, FR, NL, CH, SE, IT, ES, DK, NO, FI, BE,
// PT, AT, IE) are intentionally excluded from this cron. Activating
// ESMA_FIRDS_ENABLED/FCA_FIRDS_ENABLED would make getUniverse() download and
// unzip the FIRDS ZIP per market inside buildUniverse(), which cannot complete
// within maxDuration=60 (~206-512s provider-only for all 14). European
// universes are seeded/persisted by app/api/jobs/shadow-firds-refresh and
// consumed here from the existing DB snapshot (refresh:false read path), never
// re-downloaded inline. See docs/firds-coverage-impact-study-2026-07-11.md.
//
// Daily refresh of the 13 ESMA seeds is owned by SHADOW_FIRDS_CRON_GROUPS
// (app/api/cron/shadow-firds-refresh). GB-FCA is excluded from that rotation
// because the FCA payload + OpenFIGI + Yahoo pass takes ~168s for 11.375 ISIN
// per docs/firds-coverage-impact-study-2026-07-11.md#e10; that exceeds
// maxDuration=60. GB continues to be re-seedable manually via
// /api/jobs/shadow-firds-refresh?markets=GB until a separate nocturnal cohort
// with maxDuration=300 is added.
export const CRON_UNIVERSE_MARKETS = ["US", "HK", "AU", "JP", "TW", "CA", "SG", "ZA"];

export const SCAN_CRON_GROUPS = [
  // US no está aquí: el nocturno completo lo cubre scripts/scan-universe.mjs
  // (local_id materialized:US:…, fuente de Listas). El antiguo core-us-hk-au
  // mezclaba US+HK+AU en un solo settings.markets (~2 filas útiles) e impedía
  // el lookup exacto de INT-1-P1 para HK/AU solos.
  {
    key: "asia-hongkong",
    title: "Asia Hong Kong",
    markets: ["HK"],
    limit: INTL_BROAD_CRON_PER_MARKET,
    perMarket: INTL_BROAD_CRON_PER_MARKET,
  },
  {
    key: "oceania-australia",
    title: "Oceania Australia",
    markets: ["AU"],
    limit: 24,
    perMarket: 24,
  },
  {
    key: "asia-korea",
    title: "Asia Korea",
    markets: ["KR"],
    limit: 24,
    perMarket: 24,
  },
  {
    key: "asia-india",
    title: "Asia India",
    markets: ["IN"],
    limit: 24,
    perMarket: 24,
  },
  ...EUROPE_PRIORITY_MARKETS.map((market) => ({
    key: `europe-${market.toLowerCase()}`,
    title: `Europe ${market}`,
    markets: [market],
    limit: 24,
    perMarket: 24,
  })),
  ...EUROPE_SECONDARY_MARKETS.map((market) => ({
    key: `europe-${market.toLowerCase()}`,
    title: `Europe ${market}`,
    markets: [market],
    limit: 24,
    perMarket: 24,
  })),
  {
    key: "asia-japan",
    title: "Asia Japan",
    markets: ["JP"],
    limit: 24,
    perMarket: 24,
  },
  {
    key: "asia-taiwan",
    title: "Asia Taiwán",
    markets: ["TW"],
    limit: 20,
    perMarket: 20,
  },
  {
    key: "north-america-canada",
    title: "North America Canada",
    markets: ["CA"],
    limit: INTL_BROAD_CRON_PER_MARKET,
    perMarket: INTL_BROAD_CRON_PER_MARKET,
  },
  {
    key: "asia-singapore-africa",
    title: "Asia Singapore / Africa South Africa",
    markets: ["SG", "ZA"],
    limit: 24,
    perMarket: 12,
  },
];

export const SHADOW_EUROPE_CRON_GROUPS = [
  {
    key: "shadow-europe-uk",
    title: "Shadow Europe UK",
    markets: ["GB"],
    resolvePerMarket: 3,
    pricePerMarket: 6,
    scanPerMarket: 6,
    scanLimit: 18,
  },
  {
    key: "shadow-europe-nordics",
    title: "Shadow Europe Nordics",
    markets: ["FI", "DK", "NO", "SE"],
    resolvePerMarket: 3,
    pricePerMarket: 6,
    scanPerMarket: 6,
    scanLimit: 24,
  },
  {
    key: "shadow-europe-west",
    title: "Shadow Europe West",
    markets: ["DE", "FR", "NL"],
    resolvePerMarket: 3,
    pricePerMarket: 6,
    scanPerMarket: 6,
    scanLimit: 24,
  },
  {
    key: "shadow-europe-south",
    title: "Shadow Europe South",
    markets: ["IT", "ES"],
    resolvePerMarket: 3,
    pricePerMarket: 6,
    scanPerMarket: 6,
    scanLimit: 18,
  },
];

// Daily refresh of the 13 ESMA FIRDS shadow seeds. Cohorts are built from the
// provider-only measurements in
// docs/firds-coverage-impact-study-2026-07-11.md (table E10, lines 109-125):
//   - light markets (15-20s): IE, PT, AT, NL, DK, FI, BE
//   - medium markets (~21-24s): NO, ES, IT
//   - heavy solo markets (~26-36s): SE, DE, FR (DE: full shard ~10.534 ISIN
//     makes a re-download potentially high; with the cron reading the DB
//     snapshot only and running resolve+price on top, the per-turn cost is
//     dominated by 5 ISIN per market via OpenFIGI keyed, well under 60s).
// Two-market pairs of light markets fit comfortably under maxDuration=60; SE,
// DE and FR get their own solo slot to keep a margin for DB persistence and
// the higher per-market resolve load. With one cohort per day, the 13 ESMA
// markets cycle in 8 days — acceptable for a non-day-trading product (lowest
// acceptable cadence for keeping the shadow union fresh without
// re-downloading FIRDS inline).
// GB-FCA is intentionally NOT here (~168s for 11.375 ISIN) and is re-served by
// the manual job shadow-firds-refresh?markets=GB until a separate nocturnal
// path with maxDuration=300 is introduced.
//
// pricePerMarket bumped from 8 → 20 (2026-07-11). Empirical measurements in
// docs/evidence/shadow-write-mechanism-confirm-2026-07-11.md §4 show the
// worst-pair (ES+IT) at 26.7s on cache-hit runs, with DE/FR solo around 12-20s,
// all comfortably under maxDuration=60. Combined with the corrected status
// filter in app/api/cron/shadow-firds-refresh/route.js (now re-validates
// priced + resolved + price-unavailable instead of only resolved), the
// effective cycle per market shrinks to 4-5d for most cohorts. Without this
// bump the quota has no effect: the pre-fix status=eq.resolved pool has only
// ~12 candidates in DE and 0 elsewhere.
export const SHADOW_FIRDS_CRON_GROUPS = [
  {
    key: "shadow-firds-pair-1",
    title: "FIRDS pair — IE+PT",
    markets: ["IE", "PT"],
    resolvePerMarket: 5,
    pricePerMarket: 20,
  },
  {
    key: "shadow-firds-pair-2",
    title: "FIRDS pair — AT+BE",
    markets: ["AT", "BE"],
    resolvePerMarket: 5,
    pricePerMarket: 20,
  },
  {
    key: "shadow-firds-pair-3",
    title: "FIRDS pair — NL+DK",
    markets: ["NL", "DK"],
    resolvePerMarket: 5,
    pricePerMarket: 20,
  },
  {
    key: "shadow-firds-pair-4",
    title: "FIRDS pair — FI+NO",
    markets: ["FI", "NO"],
    resolvePerMarket: 5,
    pricePerMarket: 20,
  },
  {
    key: "shadow-firds-pair-5",
    title: "FIRDS pair — ES+IT",
    markets: ["ES", "IT"],
    resolvePerMarket: 5,
    pricePerMarket: 20,
  },
  {
    key: "shadow-firds-solo-se",
    title: "FIRDS solo — SE",
    markets: ["SE"],
    resolvePerMarket: 5,
    pricePerMarket: 20,
  },
  {
    key: "shadow-firds-solo-de",
    title: "FIRDS solo — DE",
    markets: ["DE"],
    resolvePerMarket: 5,
    pricePerMarket: 20,
  },
  {
    key: "shadow-firds-solo-fr",
    title: "FIRDS solo — FR",
    markets: ["FR"],
    resolvePerMarket: 5,
    pricePerMarket: 20,
  },
];

export function expandedUniverseCronMarkets() {
  return normalizeMarketList(CRON_UNIVERSE_MARKETS, []);
}

export function expandedScanCronGroups() {
  return SCAN_CRON_GROUPS.map((group) => ({
    ...group,
    markets: normalizeMarketList(group.markets, []),
  }));
}

export function scanCronGroupByKey(key = "") {
  const normalized = String(key || "").trim().toLowerCase();
  return expandedScanCronGroups().find((group) => group.key === normalized) || null;
}

export function scanCronGroupAt(index = 0) {
  const groups = expandedScanCronGroups();
  const safeIndex = groups.length ? Math.max(Number(index) || 0, 0) % groups.length : 0;
  return { group: groups[safeIndex], index: safeIndex, groups };
}

export function expandedShadowEuropeCronGroups() {
  return SHADOW_EUROPE_CRON_GROUPS.map((group) => ({
    ...group,
    markets: normalizeMarketList(group.markets, []),
  }));
}

export function shadowEuropeCronGroupByKey(key = "") {
  const normalized = String(key || "").trim().toLowerCase();
  return expandedShadowEuropeCronGroups().find((group) => group.key === normalized) || null;
}

export function shadowEuropeCronGroupAt(index = 0) {
  const groups = expandedShadowEuropeCronGroups();
  const safeIndex = groups.length ? Math.max(Number(index) || 0, 0) % groups.length : 0;
  return { group: groups[safeIndex], index: safeIndex, groups };
}

export function expandedShadowFirdsCronGroups() {
  return SHADOW_FIRDS_CRON_GROUPS.map((group) => ({
    ...group,
    markets: normalizeMarketList(group.markets, []),
  }));
}

export function shadowFirdsCronGroupByKey(key = "") {
  const normalized = String(key || "").trim().toLowerCase();
  return expandedShadowFirdsCronGroups().find((group) => group.key === normalized) || null;
}

export function shadowFirdsCronGroupAt(index = 0) {
  const groups = expandedShadowFirdsCronGroups();
  const safeIndex = groups.length ? Math.max(Number(index) || 0, 0) % groups.length : 0;
  return { group: groups[safeIndex], index: safeIndex, groups };
}
