import { buildDiscoverySnapshot } from "@/lib/discovery";
import { readScanRows } from "@/lib/leaderboards";

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

function isStatementTimeout(error = {}) {
  const text = `${error.message || ""} ${error.details || ""}`.toLowerCase();
  return text.includes("statement timeout") || text.includes("canceling statement") || text.includes("timeout");
}

async function readDiscoveryScanRows(params = {}) {
  try {
    return { scanData: await readScanRows({ maxRows: params.maxRows, sinceDays: params.sinceDays }), degraded: false, fallback: null };
  } catch (error) {
    if (!isStatementTimeout(error)) throw error;
    const requestedMaxRows = numberOrNull(params.maxRows);
    const requestedSinceDays = numberOrNull(params.sinceDays);
    const fallback = {
      maxRows: Math.min(Math.max(requestedMaxRows || 1200, 1), 1200),
      sinceDays: Math.min(Math.max(requestedSinceDays || 21, 1), 21),
      reason: error.message || "statement timeout",
    };
    return {
      scanData: await readScanRows({ maxRows: fallback.maxRows, sinceDays: fallback.sinceDays }),
      degraded: true,
      fallback,
    };
  }
}

export async function GET(request) {
  const params = paramsFromRequest(request);
  try {
    const { scanData, degraded, fallback } = await readDiscoveryScanRows(params);
    if (!scanData.configured) {
      return Response.json(apiPayload({
        configured: false,
        source: "local_snapshot_fallback_required",
        message: scanData.message || "Supabase no configurado; Sector/Listas deben declarar fallback local.",
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
    const health = degraded ? {
      ...snapshot.health,
      state: snapshot.health?.state === "pass" ? "warn" : snapshot.health?.state,
      note: `${snapshot.health?.note || ""} Lectura limitada por timeout: ${fallback.maxRows} filas max, ${fallback.sinceDays} dias.`,
    } : snapshot.health;
    return Response.json(apiPayload({
      configured: true,
      ownerId: scanData.ownerId,
      ...snapshot,
      health,
      degraded,
      fallback,
    }));
  } catch (error) {
    return Response.json({ ok: false, error: error.message || "Discovery unavailable", details: error.details || null }, { status: 500 });
  }
}
