// lib/scansChartPreviewScanIds.js — resuelve UUIDs reales para POST /api/scans/chart-preview.
//
// Los scans fusionados/acumulados exponen cloudId sintético
// (`merged-nightly-materialized:…`, `accumulated-materialized:…`). Esa cadena
// NO es uuid: si se manda a scan_results.scan_id Postgres responde
// «invalid input syntax for type uuid» → 500 y sparks negras.
// Los UUIDs reales viven en settings.mergedFrom / accumulatedFrom (cloudId).

// Forma uuid que acepta Postgres (no exigimos variante RFC: los ids de test
// y algunos generados históricos no llevan nibble 8/9/a/b).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isScanUuid(value = "") {
  return UUID_RE.test(String(value || "").trim());
}

function pushUuid(out, seen, raw) {
  const id = String(raw || "").trim();
  if (!id || !isScanUuid(id) || seen.has(id)) return;
  seen.add(id);
  out.push(id);
}

/** Lista deduplicada de UUIDs desde body.scanIds / scanId / cloudId. */
export function normalizeChartPreviewScanIds(input = []) {
  const list = Array.isArray(input) ? input : [input];
  const out = [];
  const seen = new Set();
  for (const item of list) pushUuid(out, seen, item);
  return out;
}

/**
 * UUIDs de persistencia para hidratar chartPreview de un scan en RAM.
 * Preferencia: mergedFrom / accumulatedFrom → cloudId UUID → [].
 */
export function chartPreviewScanIdsFromScan(scan = {}) {
  const settings = scan?.settings && typeof scan.settings === "object" ? scan.settings : {};
  const out = [];
  const seen = new Set();

  for (const key of ["mergedFrom", "accumulatedFrom"]) {
    const sources = settings[key];
    if (!Array.isArray(sources)) continue;
    for (const source of sources) {
      pushUuid(out, seen, source?.cloudId || source?.id || source?.scanId);
    }
  }
  if (out.length) return out;

  pushUuid(out, seen, scan?.cloudId);
  if (out.length) return out;
  pushUuid(out, seen, scan?.id);
  return out;
}

/**
 * Mercados embebidos en ids sintéticos de fusión/acumulado (misma gramática
 * que marketAvailability.marketsFromLocalId).
 */
export function marketsFromSyntheticScanId(scanId = "") {
  const id = String(scanId || "").trim();
  if (!id || isScanUuid(id)) return [];
  const mergedNightly = id.match(/^merged-nightly-materialized:([A-Z]{2}(?:-[A-Z]{2})*):/);
  if (mergedNightly) return mergedNightly[1].split("-").slice().sort();
  const merged = id.match(/^merged-materialized:([A-Z]{2}(?:-[A-Z]{2})*):/);
  if (merged) return merged[1].split("-").slice().sort();
  const accumulated = id.match(/^accumulated-materialized:([A-Z]{2}):/);
  if (accumulated) return [accumulated[1]];
  return [];
}

export function isSyntheticChartPreviewScanId(scanId = "") {
  return marketsFromSyntheticScanId(scanId).length > 0;
}
