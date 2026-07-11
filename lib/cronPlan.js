import { normalizeMarketList } from "@/lib/markets";

// EU1/EU2 (the 14 FIRDS markets: GB, DE, FR, NL, CH, SE, IT, ES, DK, NO, FI, BE,
// PT, AT, IE) are intentionally excluded from this cron. Activating
// ESMA_FIRDS_ENABLED/FCA_FIRDS_ENABLED would make getUniverse() download and
// unzip the FIRDS ZIP per market inside buildUniverse(), which cannot complete
// within maxDuration=60 (~206-512s provider-only for all 14). European
// universes are seeded/persisted by app/api/jobs/shadow-firds-refresh and
// consumed here from the existing DB snapshot (refresh:false read path), never
// re-downloaded inline. See docs/firds-coverage-impact-study-2026-07-11.md.
export const CRON_UNIVERSE_MARKETS = ["US", "HK", "AU", "JP", "TW", "CA", "SG", "ZA"];

export const SCAN_CRON_GROUPS = [
  {
    key: "core-us-hk-au",
    title: "Core US/HK/AU",
    markets: ["US", "HK", "AU"],
    limit: 12,
    perMarket: 4,
  },
  {
    key: "europe-priority",
    title: "Europe priority",
    markets: ["EU1"],
    limit: 24,
    perMarket: 3,
  },
  {
    key: "europe-secondary",
    title: "Europe secondary",
    markets: ["EU2"],
    limit: 21,
    perMarket: 3,
  },
  {
    key: "asia-japan",
    title: "Asia Japan",
    markets: ["JP"],
    limit: 24,
    perMarket: 24,
  },
  {
    key: "asia-taiwan",
    title: "Asia Taiwan",
    markets: ["TW"],
    limit: 20,
    perMarket: 20,
  },
  {
    key: "north-america-canada",
    title: "North America Canada",
    markets: ["CA"],
    limit: 24,
    perMarket: 24,
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
