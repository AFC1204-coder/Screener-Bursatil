// scripts/backfill-ipo-anchor.mjs — audita y opcionalmente puebla ipoAnchorClose
// en scan_results del scan US vigente (IPO-UX-D2). Dry-run por defecto.
//
// Uso:
//   node --env-file=.env.local --loader ./scripts/loader.mjs \
//     scripts/backfill-ipo-anchor.mjs [--local-id=…] [--limit=500] [--write]
//
// --write exige credenciales Supabase y OK del dueño (AGENTS.md: datos).

import { pathToFileURL } from "node:url";

import { readDailyBarsCache } from "@/lib/dailyBarsCache.js";
import { mergeScanMetricsIpoAnchor, summarizeIpoAnchorPatchPlan } from "@/lib/patchScanIpoAnchor.js";
import { supabaseConfig, supabaseRequest, supabaseRequestAll } from "@/lib/supabaseServer.js";

const DEFAULT_LOCAL_ID = "materialized:US:2026-08-28:t152018:o0:l5607";
const WRITE_BATCH = 40;
const DEFAULT_LIMIT = 0;

export function parseArgs(argv = []) {
  const out = { localId: DEFAULT_LOCAL_ID, limit: DEFAULT_LIMIT, write: false, dryRun: true };
  for (const arg of argv) {
    const [rawKey, rawValue] = arg.replace(/^--/, "").split("=");
    const key = rawKey.trim();
    if (key === "local-id") out.localId = String(rawValue || "").trim() || DEFAULT_LOCAL_ID;
    else if (key === "limit") out.limit = Math.max(0, Number(rawValue) || DEFAULT_LIMIT);
    else if (key === "write") out.write = rawValue === undefined ? true : rawValue !== "false";
    else if (key === "dry-run") out.dryRun = rawValue === undefined ? true : rawValue !== "false";
  }
  if (out.write && !argv.some((a) => a.startsWith("--dry-run"))) out.dryRun = false;
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = supabaseConfig();
  if (!config.configured) {
    console.error("Supabase no configurado:", config.missing?.join(", "));
    process.exit(1);
  }

  console.log(`=== backfill-ipo-anchor — modo=${args.dryRun ? "dry-run" : "WRITE"} local_id=${args.localId} limit=${args.limit || "todas"} ===`);

  const scans = await supabaseRequest("scans", {
    query: {
      select: "id,local_id,row_count,created_at",
      local_id: `eq.${args.localId}`,
      limit: "1",
    },
  });
  const scan = scans?.[0];
  if (!scan?.id) {
    console.error("Scan no encontrado:", args.localId);
    process.exit(1);
  }
  console.log(`Scan: ${scan.local_id} · rows=${scan.row_count} · id=${scan.id}`);

  const results = await supabaseRequestAll("scan_results", {
    query: {
      select: "id,symbol,metrics,raw",
      scan_id: `eq.${scan.id}`,
      order: "rank_index.asc",
    },
  });
  const candidates = results.filter((row) => String(row.metrics?.ipoDate || row.raw?.ipoDate || "").trim());
  const target = args.limit > 0 ? candidates.slice(0, args.limit) : candidates;
  console.log(`Filas con ipoDate: ${candidates.length} · a procesar: ${target.length}`);

  const planned = [];
  for (const row of target) {
    const metrics = row.metrics && typeof row.metrics === "object" ? row.metrics : {};
    const ipoDate = String(metrics.ipoDate || row.raw?.ipoDate || "").trim();
    const mergedBase = ipoDate && !metrics.ipoDate ? { ...metrics, ipoDate } : metrics;
    const cache = await readDailyBarsCache(row.symbol, { minBars: 20, maxAgeDays: 3650 });
    const merged = mergeScanMetricsIpoAnchor(mergedBase, cache.bars || []);
    planned.push({
      id: row.id,
      symbol: row.symbol,
      raw: row.raw,
      ...merged,
    });
  }

  const summary = summarizeIpoAnchorPatchPlan(planned);
  const missingAnchor = candidates.filter((row) => {
    const m = row.metrics || {};
    return !Number.isFinite(m.ipoAnchorClose) || !String(m.ipoAnchorDate || "").trim();
  }).length;
  console.log(`sinAnclaHoy=${missingAnchor} wouldPatch=${summary.wouldPatch} already=${summary.already} noHistory=${summary.noHistory}`);
  for (const sample of summary.sample) {
    console.log(`  sample ${sample.symbol} ${sample.ipoDate} → ${sample.ipoAnchorClose} @ ${sample.ipoAnchorDate}`);
  }

  if (args.dryRun) {
    console.log("Dry-run: no se escribió nada. Pasa --write con OK del dueño para actualizar scan_results.");
    return;
  }

  const toWrite = planned.filter((row) => row.changed);
  let written = 0;
  for (let i = 0; i < toWrite.length; i += WRITE_BATCH) {
    const batch = toWrite.slice(i, i + WRITE_BATCH);
    await Promise.all(batch.map(async (row) => {
      const raw = row.raw && typeof row.raw === "object" ? { ...row.raw } : {};
      raw.ipoAnchorClose = row.metrics.ipoAnchorClose;
      raw.ipoAnchorDate = row.metrics.ipoAnchorDate;
      await supabaseRequest("scan_results", {
        method: "PATCH",
        query: `id=eq.${encodeURIComponent(row.id)}`,
        prefer: "return=minimal",
        body: { metrics: row.metrics, raw },
      });
    }));
    written += batch.length;
    if (written % 200 === 0 || written === toWrite.length) {
      console.log(`  ...escritas ${written}/${toWrite.length}`);
    }
  }
  console.log(`WRITE OK: ${written} filas actualizadas.`);
}

const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  main().catch((error) => {
    console.error("Error fatal:", error?.message || error);
    process.exit(1);
  });
}
