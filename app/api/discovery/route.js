import { buildDiscoverySnapshot } from "@/lib/discovery";
import { discoveryCacheKeyForParams, readMaterializedDiscoverySnapshot } from "@/lib/discoveryCache";
import { readScanRows } from "@/lib/leaderboards";

const DEFAULT_DISCOVERY_SCAN_ROWS = 900;
const DEFAULT_DISCOVERY_SINCE_DAYS = 21;
const MAX_DISCOVERY_SCAN_ROWS = Number(process.env.DISCOVERY_MAX_SCAN_ROWS || DEFAULT_DISCOVERY_SCAN_ROWS);
const MAX_DISCOVERY_SINCE_DAYS = Number(process.env.DISCOVERY_MAX_SINCE_DAYS || DEFAULT_DISCOVERY_SINCE_DAYS);
const FALLBACK_DISCOVERY_SCAN_ROWS = 900;
const FALLBACK_DISCOVERY_SINCE_DAYS = 14;
const DISCOVERY_READ_TIMEOUT_MS = Number(process.env.DISCOVERY_READ_TIMEOUT_MS || 3500);
const DISCOVERY_FALLBACK_TIMEOUT_MS = Number(process.env.DISCOVERY_FALLBACK_TIMEOUT_MS || 2500);

function paramsFromRequest(request) {
  const { searchParams } = new URL(request.url);
  return {
    limit: searchParams.get("limit") || "",
    groupItemLimit: searchParams.get("groupItemLimit") || "",
    groupsLimit: searchParams.get("groupsLimit") || "",
    minGroupSize: searchParams.get("minGroupSize") || "",
    minCoverageScore: searchParams.get("minCoverageScore") || "",
    maxPriceFreshnessDays: searchParams.get("maxPriceFreshnessDays") || "",
    maxRows: searchParams.get("maxRows") || "",
    sinceDays: searchParams.get("sinceDays") || "",
    scopeType: searchParams.get("scopeType") || searchParams.get("groupType") || "",
    scopeValue: searchParams.get("scopeValue") || searchParams.get("group") || "",
    cache: searchParams.get("cache") !== "0",
  };
}

function apiPayload(payload = {}) {
  return {
    ok: true,
    legalMode: "derived-signals-only",
    note: "Discovery expone listas y grupos derivados desde scans guardados; no publica universos completos ni OHLCV crudo.",
    ...payload,
  };
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function boundedInt(value, fallback, max) {
  const n = numberOrNull(value);
  const normalized = Number.isFinite(n) ? n : fallback;
  return Math.min(Math.max(Math.round(normalized), 1), Math.max(Math.round(max || fallback), 1));
}

function isStatementTimeout(error = {}) {
  const text = `${error.message || ""} ${error.details || ""}`.toLowerCase();
  return text.includes("statement timeout") || text.includes("canceling statement") || text.includes("timeout");
}

function isRecoverableReadError(error = {}) {
  const status = Number(error.status || 0);
  const text = `${error.message || ""} ${JSON.stringify(error.details || "")}`.toLowerCase();
  return isStatementTimeout(error)
    || status >= 500
    || text.includes("fetch failed")
    || text.includes("cloudflare")
    || text.includes("web server is down")
    || text.includes("error code 521");
}

function readOptions(params = {}, fallback = {}) {
  const requestedMaxRows = numberOrNull(fallback.maxRows ?? params.maxRows);
  const requestedSinceDays = numberOrNull(fallback.sinceDays ?? params.sinceDays);
  const maxRows = boundedInt(fallback.maxRows || params.maxRows, DEFAULT_DISCOVERY_SCAN_ROWS, MAX_DISCOVERY_SCAN_ROWS);
  const sinceDays = boundedInt(fallback.sinceDays || params.sinceDays, DEFAULT_DISCOVERY_SINCE_DAYS, MAX_DISCOVERY_SINCE_DAYS);
  return {
    maxRows,
    sinceDays,
    timeoutMs: fallback.timeoutMs || DISCOVERY_READ_TIMEOUT_MS,
    bounded: (Number.isFinite(requestedMaxRows) && requestedMaxRows > maxRows)
      || (Number.isFinite(requestedSinceDays) && requestedSinceDays > sinceDays),
  };
}

async function readDiscoveryScanRows(params = {}) {
  const options = readOptions(params);
  try {
    return { scanData: await readScanRows(options), degraded: false, fallback: null, read: options };
  } catch (error) {
    if (!isRecoverableReadError(error)) throw error;
    const requestedMaxRows = numberOrNull(params.maxRows);
    const requestedSinceDays = numberOrNull(params.sinceDays);
    const fallback = {
      maxRows: Math.min(Math.max(requestedMaxRows || FALLBACK_DISCOVERY_SCAN_ROWS, 1), FALLBACK_DISCOVERY_SCAN_ROWS),
      sinceDays: Math.min(Math.max(requestedSinceDays || FALLBACK_DISCOVERY_SINCE_DAYS, 1), FALLBACK_DISCOVERY_SINCE_DAYS),
      timeoutMs: DISCOVERY_FALLBACK_TIMEOUT_MS,
      reason: error.message || "statement timeout",
    };
    const fallbackOptions = readOptions(params, fallback);
    try {
      return {
        scanData: await readScanRows(fallbackOptions),
        degraded: true,
        fallback,
        read: fallbackOptions,
      };
    } catch (fallbackError) {
      if (!isRecoverableReadError(fallbackError)) throw fallbackError;
      return {
        scanData: { configured: true, rows: [], ownerId: "" },
        degraded: true,
        fallback: {
          ...fallback,
          empty: true,
          fallbackReason: fallbackError.message || "No hay resultados de escaneo disponibles",
        },
        read: fallbackOptions,
      };
    }
  }
}

export async function GET(request) {
  const params = paramsFromRequest(request);
  try {
    const cacheKey = discoveryCacheKeyForParams(params);
    if (cacheKey) {
      const cached = await readMaterializedDiscoverySnapshot(cacheKey).catch(() => null);
      if (cached?.payload) {
        return Response.json(apiPayload({
          configured: true,
          ...cached.payload,
          source: "discovery_snapshots",
          cache: cached.cache,
          effectiveRead: cached.read,
        }));
      }
    }

    const { scanData, degraded, fallback, read } = await readDiscoveryScanRows(params);
    if (!scanData.configured) {
      return Response.json(apiPayload({
        configured: false,
        source: "local_snapshot_fallback_required",
        message: scanData.message || "Sin ranking en vivo: Sectores y Listas usan la copia local.",
        inputRows: 0,
        lists: [],
        rows: [],
        groups: { theme: [], sector: [], industry: [] },
        health: {
          state: "empty",
          rows: 0,
          listItemCount: 0,
          groupCount: 0,
          staleRows: 0,
          lowCoverageRows: 0,
          dataLimitedRows: 0,
          missingTaxonomyRows: 0,
          planClaims: 0,
          watchRows: 0,
          sourceLabel: "Fallback local requerido",
          note: "Sin scans persistidos disponibles para discovery derivado.",
        },
      }));
    }

    const snapshot = buildDiscoverySnapshot(scanData.rows, params);
    let health = degraded ? {
      ...snapshot.health,
      state: snapshot.health?.state === "pass" ? "warn" : snapshot.health?.state,
      note: `${snapshot.health?.note || ""} Lectura limitada por timeout: ${fallback.maxRows} filas max, ${fallback.sinceDays} dias.`,
    } : snapshot.health;
    if (read?.bounded) {
      health = {
        ...health,
        state: health?.state === "pass" ? "watch" : health?.state,
        note: `${health?.note || ""} Lectura acotada para mantener la respuesta interactiva: ${read.maxRows} filas max, ${read.sinceDays} dias.`,
      };
    }
    return Response.json(apiPayload({
      configured: true,
      ownerId: scanData.ownerId,
      ...snapshot,
      health,
      degraded,
      fallback,
      effectiveRead: read ? {
        maxRows: read.maxRows,
        sinceDays: read.sinceDays,
        timeoutMs: read.timeoutMs,
        bounded: read.bounded,
      } : null,
    }));
  } catch (error) {
    return Response.json({ ok: false, error: error.message || "Discovery unavailable", details: error.details || null }, { status: 500 });
  }
}
