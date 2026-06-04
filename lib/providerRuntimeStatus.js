import { envValue, hasEnvValue } from "@/lib/env";

const FAILURE_TTL_MS = 45 * 60 * 1000;
const SUCCESS_TTL_MS = 6 * 60 * 60 * 1000;
const ESMA_FIRDS_MARKETS = new Set(["AT", "BE", "DE", "DK", "ES", "FI", "FR", "IE", "IT", "NL", "NO", "PT", "SE"]);

const providerRuntime = new Map();

function nowIso() {
  return new Date().toISOString();
}

function isoAt(ms) {
  return ms ? new Date(ms).toISOString() : "";
}

function compactReason(error) {
  const message = typeof error === "string" ? error : error?.message || "provider unavailable";
  return String(message).replace(/\s+/g, " ").trim().slice(0, 220);
}

function envFlag(name) {
  return /^(1|true|yes|on)$/i.test(envValue(name));
}

export function universeProviderForMarket(market = "") {
  const code = String(market || "").toUpperCase();
  if (code === "US") {
    return {
      id: "nasdaq-trader",
      market: code,
      label: "NasdaqTrader Symbol Directory",
      configured: true,
      retryTtlMs: FAILURE_TTL_MS,
    };
  }
  if (code === "HK") {
    return {
      id: "hkex-securities-list",
      market: code,
      label: "HKEX Full List of Securities",
      configured: true,
      retryTtlMs: FAILURE_TTL_MS,
    };
  }
  if (code === "TW") {
    return {
      id: "twse-isin-list",
      market: code,
      label: "TWSE ISIN listed equities",
      configured: true,
      retryTtlMs: FAILURE_TTL_MS,
    };
  }
  if (code === "JP") {
    return {
      id: "jquants",
      market: code,
      label: "J-Quants",
      configured: hasEnvValue("JQUANTS_API_KEY") || hasEnvValue("JQUANTS_REFRESH_TOKEN"),
      retryTtlMs: FAILURE_TTL_MS,
    };
  }
  if (code === "AU") {
    return {
      id: "asic-short",
      market: code,
      label: "ASIC short position reports",
      configured: true,
      retryTtlMs: 20 * 60 * 1000,
    };
  }
  if (code === "GB") {
    return {
      id: "fca-firds",
      market: code,
      label: "FCA FIRDS reference data",
      configured: envFlag("FCA_FIRDS_ENABLED"),
      retryTtlMs: FAILURE_TTL_MS,
    };
  }
  if (ESMA_FIRDS_MARKETS.has(code)) {
    return {
      id: "esma-firds",
      market: code,
      label: "ESMA FIRDS reference data",
      configured: envFlag("ESMA_FIRDS_ENABLED"),
      retryTtlMs: FAILURE_TTL_MS,
    };
  }
  return null;
}

function runtimeKey(policy = {}) {
  return `${policy.id || "provider"}:${policy.market || "-"}`;
}

function normalizeRuntime(entry = {}, policy = universeProviderForMarket(entry.market) || {}) {
  const retryAfterMs = Date.parse(entry.retryAfter || "") || 0;
  const expiresAtMs = Date.parse(entry.expiresAt || "") || 0;
  const retryBlocked = retryAfterMs > Date.now();
  return {
    providerId: entry.providerId || policy.id || "",
    market: entry.market || policy.market || "",
    label: entry.label || policy.label || "",
    status: entry.status || "unknown",
    reason: entry.reason || "",
    count: Number.isFinite(Number(entry.count)) ? Number(entry.count) : null,
    updatedAt: entry.updatedAt || "",
    retryAfter: entry.retryAfter || "",
    retryBlocked,
    expiresAt: entry.expiresAt || "",
    stale: Boolean(expiresAtMs && expiresAtMs <= Date.now()),
  };
}

export function getProviderRuntimeStatus(market = "") {
  const policy = universeProviderForMarket(market);
  if (!policy) return null;
  if (!policy.configured) {
    return {
      providerId: policy.id,
      market: policy.market,
      label: policy.label,
      status: "not_configured",
      reason: "Provider credentials or enable flag are not configured.",
      count: null,
      updatedAt: "",
      retryAfter: "",
      retryBlocked: false,
      expiresAt: "",
      stale: false,
    };
  }
  const entry = providerRuntime.get(runtimeKey(policy));
  if (!entry) {
    return {
      providerId: policy.id,
      market: policy.market,
      label: policy.label,
      status: "unknown",
      reason: "",
      count: null,
      updatedAt: "",
      retryAfter: "",
      retryBlocked: false,
      expiresAt: "",
      stale: false,
    };
  }
  return normalizeRuntime(entry, policy);
}

export function shouldSkipProviderFetch(market = "") {
  const status = getProviderRuntimeStatus(market);
  return Boolean(status?.retryBlocked && ["error", "degraded"].includes(status.status));
}

export function recordProviderSuccess(market = "", { count = null } = {}) {
  const policy = universeProviderForMarket(market);
  if (!policy) return null;
  const entry = {
    providerId: policy.id,
    market: policy.market,
    label: policy.label,
    status: "ok",
    reason: "",
    count: Number.isFinite(Number(count)) ? Number(count) : null,
    updatedAt: nowIso(),
    retryAfter: "",
    expiresAt: isoAt(Date.now() + SUCCESS_TTL_MS),
  };
  providerRuntime.set(runtimeKey(policy), entry);
  return normalizeRuntime(entry, policy);
}

export function recordProviderFailure(market = "", error, { count = null, status = "error", retryTtlMs = null } = {}) {
  const policy = universeProviderForMarket(market);
  if (!policy) return null;
  const ttl = Math.max(60_000, Number(retryTtlMs || policy.retryTtlMs || FAILURE_TTL_MS));
  const entry = {
    providerId: policy.id,
    market: policy.market,
    label: policy.label,
    status,
    reason: compactReason(error),
    count: Number.isFinite(Number(count)) ? Number(count) : null,
    updatedAt: nowIso(),
    retryAfter: isoAt(Date.now() + ttl),
    expiresAt: isoAt(Date.now() + ttl),
  };
  providerRuntime.set(runtimeKey(policy), entry);
  return normalizeRuntime(entry, policy);
}

export function providerRuntimeDiagnosticsForMarkets(markets = []) {
  const byMarket = {};
  for (const market of markets || []) {
    const status = getProviderRuntimeStatus(market);
    if (status) byMarket[String(market || "").toUpperCase()] = status;
  }
  const rows = Object.values(byMarket);
  return {
    byMarket,
    issues: rows
      .filter((row) => ["error", "degraded", "not_configured"].includes(row.status))
      .map((row) => ({
        market: row.market,
        providerId: row.providerId,
        label: row.label,
        status: row.status,
        reason: row.reason,
        retryAfter: row.retryAfter,
      })),
  };
}
