import { compactChartPreview } from "@/lib/researchRowContract";
import { readLatestMaterializedScanForMarkets } from "@/lib/materializedScanLookup";
import {
  chartPreviewScanIdsFromScan,
  isScanUuid,
  isSyntheticChartPreviewScanId,
  marketsFromSyntheticScanId,
  normalizeChartPreviewScanIds,
} from "@/lib/scansChartPreviewScanIds";
import { requirePersistenceAuth, supabaseConfig, supabaseRequest } from "@/lib/supabaseServer";
import { compressedJsonResponse } from "@/lib/compressedJsonResponse";

const SCANS_SUPABASE_TIMEOUT_MS = 12000;
const MAX_SYMBOLS = 120;
const SYMBOL_CHUNK = 40;

function normalizeSymbols(input = []) {
  const list = Array.isArray(input)
    ? input
    : String(input || "").split(",");
  return [...new Set(list.map((item) => String(item || "").trim().toUpperCase()).filter(Boolean))].slice(0, MAX_SYMBOLS);
}

function chartPreviewFromDbRow(item = {}) {
  const raw = item?.raw && typeof item.raw === "object" ? item.raw : {};
  const metrics = item?.metrics && typeof item.metrics === "object" ? item.metrics : {};
  const preview = metrics.chartPreview ?? raw.chartPreview;
  if (!Array.isArray(preview) || preview.length < 2) return null;
  return compactChartPreview(preview);
}

function uuidScanIdsFromMaterializedLookup(materialized = {}) {
  const fromSources = Array.isArray(materialized.sourceScans)
    ? materialized.sourceScans.map((scan) => scan?.id)
    : [];
  const fallback = materialized.row?.id || materialized.scan?.id;
  return normalizeChartPreviewScanIds([...fromSources, fallback]);
}

/**
 * Resuelve UUIDs reales para consultar scan_results.
 * Nunca devolver ids sintéticos: Postgres tipa scan_id como uuid.
 */
export async function resolveChartPreviewScanIds({
  scanId = "",
  scanIds = [],
  settings = null,
} = {}) {
  const explicit = normalizeChartPreviewScanIds([
    ...(Array.isArray(scanIds) ? scanIds : [scanIds]),
    ...(settings ? chartPreviewScanIdsFromScan({ settings, cloudId: scanId }) : []),
  ]);
  if (explicit.length) return explicit;

  const primary = String(scanId || "").trim();
  if (isScanUuid(primary)) return [primary];

  if (isSyntheticChartPreviewScanId(primary)) {
    const markets = marketsFromSyntheticScanId(primary);
    const materialized = await readLatestMaterializedScanForMarkets(markets, {
      timeoutMs: SCANS_SUPABASE_TIMEOUT_MS,
    });
    return uuidScanIdsFromMaterializedLookup(materialized);
  }

  // local_id real en tabla scans (p. ej. materialized:US:…) → cloud UUID.
  if (primary) {
    const config = supabaseConfig();
    if (config.configured) {
      const rows = await supabaseRequest("scans", {
        query: [
          `owner_id=eq.${encodeURIComponent(config.ownerId)}`,
          `local_id=eq.${encodeURIComponent(primary)}`,
          "deleted_at=is.null",
          "select=id,local_id",
          "limit=1",
        ].join("&"),
        timeoutMs: SCANS_SUPABASE_TIMEOUT_MS,
      });
      const id = Array.isArray(rows) ? rows[0]?.id : null;
      if (isScanUuid(id)) return [id];
    }
  }

  return [];
}

async function readChartPreviewsForSymbols({ ownerId, scanIds = [], symbols = [] }) {
  const ids = normalizeChartPreviewScanIds(scanIds);
  if (!ids.length) return {};
  const scanIdFilter = ids.length === 1
    ? `scan_id=eq.${encodeURIComponent(ids[0])}`
    : `scan_id=in.(${ids.map(encodeURIComponent).join(",")})`;
  const previews = {};
  for (let index = 0; index < symbols.length; index += SYMBOL_CHUNK) {
    const chunk = symbols.slice(index, index + SYMBOL_CHUNK);
    const rows = await supabaseRequest("scan_results", {
      query: [
        `owner_id=eq.${encodeURIComponent(ownerId)}`,
        scanIdFilter,
        `symbol=in.(${chunk.map(encodeURIComponent).join(",")})`,
        "select=symbol,metrics,raw",
      ].join("&"),
      timeoutMs: SCANS_SUPABASE_TIMEOUT_MS,
    });
    for (const item of rows) {
      const symbol = String(item?.symbol || "").trim().toUpperCase();
      if (!symbol || previews[symbol]) continue;
      const chartPreview = chartPreviewFromDbRow(item);
      if (chartPreview) previews[symbol] = chartPreview;
    }
  }
  return previews;
}

export async function POST(req) {
  const authError = requirePersistenceAuth(req);
  if (authError) return authError;
  const config = supabaseConfig();
  if (!config.configured) {
    return Response.json({ configured: false, ok: false, previews: {}, message: "Persistencia en la nube no configurada" });
  }

  const body = await req.json().catch(() => ({}));
  const scanId = String(body.scanId || body.cloudId || "").trim();
  const symbols = normalizeSymbols(body.symbols);
  if (!scanId && !(Array.isArray(body.scanIds) && body.scanIds.length)) {
    return Response.json({ error: "Falta scanId", previews: {} }, { status: 400 });
  }
  if (!symbols.length) return Response.json({ error: "Faltan symbols", previews: {} }, { status: 400 });

  try {
    const resolvedScanIds = await resolveChartPreviewScanIds({
      scanId,
      scanIds: body.scanIds,
      settings: body.settings && typeof body.settings === "object" ? body.settings : null,
    });
    if (!resolvedScanIds.length) {
      // Id sintético / basura: no consultar Postgres (evita 500 uuid).
      return Response.json({
        configured: true,
        ok: false,
        error: "scanId no resoluble a UUID de persistencia",
        previews: {},
      }, { status: 400 });
    }

    const previews = await readChartPreviewsForSymbols({
      ownerId: config.ownerId,
      scanIds: resolvedScanIds,
      symbols,
    });
    return compressedJsonResponse(req, {
      configured: true,
      ok: true,
      previews,
      scanIds: resolvedScanIds,
    });
  } catch (error) {
    return Response.json({
      configured: true,
      ok: false,
      error: error.message || "No se pudieron cargar miniaturas",
      previews: {},
    }, { status: 500 });
  }
}
