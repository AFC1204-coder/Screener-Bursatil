// scripts/patch-scan-ipodate.mjs — copia ipoDate del perfil cacheado a scan_results
// del scan US vigente (IPO-NOCT). Dry-run por defecto; --write exige OK del dueño.
//
// Nota 2026-08-29: el primer write productivo se hizo vía SQL bulk en Supabase
// (3289/3320). Este script es la vía reproducible por REST para re-aplicar.
//
//   node --env-file=.env.local --loader ./scripts/loader.mjs \
//     scripts/patch-scan-ipodate.mjs [--local-id=…] [--write]

import { pathToFileURL } from "node:url";

import { mergeScanMetricsIpoDate, summarizePatchPlan } from "@/lib/patchScanIpoDate.js";
import { supabaseConfig, supabaseRequest, supabaseRequestAll } from "@/lib/supabaseServer.js";

const DEFAULT_LOCAL_ID = "materialized:US:2026-08-28:t152018:o0:l5607";
const WRITE_BATCH = 40;

export function parseArgs(argv = []) {
  const out = { localId: DEFAULT_LOCAL_ID, write: false, dryRun: true };
  for (const arg of argv) {
    const [rawKey, rawValue] = arg.replace(/^--/, "").split("=");
    const key = rawKey.trim();
    if (key === "local-id") out.localId = String(rawValue || "").trim() || DEFAULT_LOCAL_ID;
    else if (key === "write") out.write = rawValue === undefined ? true : rawValue !== "false";
    else if (key === "dry-run") out.dryRun = rawValue === undefined ? true : rawValue !== "false";
  }
  if (out.write && !argv.some((a) => a.startsWith("--dry-run"))) out.dryRun = false;
  return out;
}

function profileIpoMap(rows = []) {
  const map = new Map();
  for (const row of rows) {
    const symbol = String(row.symbol || "").trim();
    const ipoDate = String(row.metrics?.ipoDate || "").trim();
    if (!symbol || !ipoDate || map.has(symbol)) continue;
    map.set(symbol, {
      ipoDate,
      ipoDateSource: row.metrics?.ipoDateSource || null,
    });
  }
  return map;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = supabaseConfig();
  if (!config.configured) {
    console.error("Supabase no configurado:", config.missing?.join(", "));
    process.exit(1);
  }

  console.log(`=== patch-scan-ipodate — modo=${args.dryRun ? "dry-run" : "WRITE"} local_id=${args.localId} ===`);

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
  console.log(`Filas scan_results: ${results.length}`);

  const profiles = await supabaseRequestAll("fundamental_snapshots", {
    query: {
      select: "symbol,metrics,updated_at",
      order: "updated_at.desc",
    },
  });
  // Filtrar en cliente: PostgREST no filtra bien jsonb nonempty de forma portable aquí.
  const withIpo = profiles.filter((row) => String(row.metrics?.ipoDate || "").trim());
  const bySymbol = profileIpoMap(withIpo);
  console.log(`Perfiles con ipoDate (tras dedupe): ${bySymbol.size}`);

  const planned = results.map((row) => {
    const profile = bySymbol.get(String(row.symbol || "").trim()) || {};
    const merged = mergeScanMetricsIpoDate(row.metrics, profile);
    return {
      id: row.id,
      symbol: row.symbol,
      raw: row.raw,
      ...merged,
    };
  });
  const summary = summarizePatchPlan(planned);
  console.log(`wouldPatch=${summary.wouldPatch} already=${summary.already} noProfile=${summary.noProfile}`);
  for (const sample of summary.sample) {
    console.log(`  sample ${sample.symbol} ${sample.ipoDate} ${sample.ipoAgeMonths}m [${sample.ipoDateSource}]`);
  }

  if (args.dryRun) {
    console.log("Dry-run: no se escribió nada. Pasa --write con OK del dueño.");
    return;
  }

  const toWrite = planned.filter((row) => row.changed);
  let written = 0;
  for (let i = 0; i < toWrite.length; i += WRITE_BATCH) {
    const batch = toWrite.slice(i, i + WRITE_BATCH);
    await Promise.all(batch.map(async (row) => {
      const raw = row.raw && typeof row.raw === "object" ? { ...row.raw } : {};
      raw.ipoDate = row.metrics.ipoDate;
      raw.ipoAgeMonths = row.metrics.ipoAgeMonths;
      raw.ipoDateSource = row.metrics.ipoDateSource;
      delete raw.ipoDateReason;
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
