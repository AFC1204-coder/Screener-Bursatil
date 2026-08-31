#!/usr/bin/env node
// scripts/patch-scan-trend-support.mjs — backfill MET-4b fields onto current US nightly.
// Dry-run by default. --write requires explicit owner OK (touches scan_results).
//
//   node --env-file=.env.local --loader ./scripts/loader.mjs \
//     scripts/patch-scan-trend-support.mjs [--limit=N] [--concurrency=12] [--write]

import { pathToFileURL } from "node:url";

import { readDailyBarsCache } from "@/lib/dailyBarsCache.js";
import { readNightlyUsScan } from "@/lib/nightlyUsScan.js";
import { trendSupportFieldsFromBars } from "@/lib/trendSupport.js";
import { supabaseConfig, supabaseRequest, supabaseRequestAll } from "@/lib/supabaseServer.js";

const WRITE_BATCH = 40;
const FIELD_KEYS = [
  "weeksAboveSma30w",
  "weeksAboveSma30wAbove",
  "weeksAboveSma10w",
  "weeksAboveSma10wAbove",
  "advanceRecentPct",
  "advancePriorPct",
];

export function parseArgs(argv = []) {
  const out = { write: false, dryRun: true, limit: 0, concurrency: 12 };
  for (const arg of argv) {
    const [rawKey, rawValue] = arg.replace(/^--/, "").split("=");
    const key = rawKey.trim();
    if (key === "write") out.write = rawValue === undefined ? true : rawValue !== "false";
    else if (key === "dry-run") out.dryRun = rawValue === undefined ? true : rawValue !== "false";
    else if (key === "limit") out.limit = Math.max(0, Number(rawValue) || 0);
    else if (key === "concurrency") out.concurrency = Math.max(1, Number(rawValue) || 12);
  }
  if (out.write && !argv.some((a) => a.startsWith("--dry-run"))) out.dryRun = false;
  return out;
}

function hasTrendSupport(metrics = {}) {
  return Number.isFinite(Number(metrics.weeksAboveSma30w))
    && typeof metrics.weeksAboveSma30wAbove === "boolean";
}

function mergeMetrics(metrics = {}, fields = {}) {
  const next = { ...(metrics && typeof metrics === "object" ? metrics : {}) };
  let changed = false;
  for (const key of FIELD_KEYS) {
    const value = fields[key];
    if (value === undefined) continue;
    if (next[key] !== value) {
      next[key] = value;
      changed = true;
    }
  }
  return { metrics: next, changed };
}

async function mapPool(items, concurrency, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = supabaseConfig();
  if (!config.configured) {
    console.error("Supabase no configurado:", config.missing?.join(", "));
    process.exit(1);
  }

  console.log(`=== patch-scan-trend-support — modo=${args.dryRun ? "dry-run" : "WRITE"} concurrency=${args.concurrency} limit=${args.limit || "all"} ===`);

  const nightly = await readNightlyUsScan({});
  if (!nightly.scan?.id) {
    console.error("No hay escaneo nocturno US:", nightly.reason || "desconocido");
    process.exit(1);
  }
  const scanId = nightly.scan.id;
  console.log(`Scan: ${nightly.scan.localId || nightly.scan.local_id || scanId} · id=${scanId}`);

  let results = await supabaseRequestAll("scan_results", {
    query: {
      select: "id,symbol,metrics,raw",
      scan_id: `eq.${scanId}`,
      order: "rank_index.asc",
    },
  });
  if (args.limit > 0) results = results.slice(0, args.limit);
  console.log(`Filas a considerar: ${results.length}`);

  const already = results.filter((row) => hasTrendSupport(row.metrics)).length;
  console.log(`Ya con weeksAboveSma30w: ${already}`);

  const planned = await mapPool(results, args.concurrency, async (row) => {
    const symbol = String(row.symbol || "").trim();
    if (!symbol) {
      return { id: row.id, symbol, skip: "no-symbol", changed: false };
    }
    if (hasTrendSupport(row.metrics) && Number.isFinite(Number(row.metrics?.advanceRecentPct))) {
      return {
        id: row.id,
        symbol,
        skip: "already",
        changed: false,
        weeksAboveSma30w: row.metrics.weeksAboveSma30w,
        weeksAboveSma30wAbove: row.metrics.weeksAboveSma30wAbove,
      };
    }
    const cached = await readDailyBarsCache(symbol, {});
    const bars = Array.isArray(cached?.bars) ? cached.bars : [];
    if (bars.length < 30) {
      return { id: row.id, symbol, skip: "short-history", changed: false, bars: bars.length };
    }
    const fields = trendSupportFieldsFromBars(bars);
    const merged = mergeMetrics(row.metrics, fields);
    return {
      id: row.id,
      symbol,
      raw: row.raw,
      metrics: merged.metrics,
      changed: merged.changed,
      skip: merged.changed ? null : "unchanged",
      weeksAboveSma30w: fields.weeksAboveSma30w,
      weeksAboveSma30wAbove: fields.weeksAboveSma30wAbove,
      bars: bars.length,
    };
  });

  const wouldPatch = planned.filter((row) => row.changed);
  const above8 = planned.filter((row) => row.weeksAboveSma30wAbove === true && Number(row.weeksAboveSma30w) >= 8).length;
  const withField = planned.filter((row) => Number.isFinite(Number(row.weeksAboveSma30w))).length;
  const skips = planned.reduce((acc, row) => {
    const key = row.skip || (row.changed ? "patch" : "other");
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  console.log(`wouldPatch=${wouldPatch.length} withField=${withField} above8=${above8}`);
  console.log("skips", skips);
  for (const sample of planned.filter((row) => Number.isFinite(Number(row.weeksAboveSma30w))).slice(0, 8)) {
    console.log(`  sample ${sample.symbol} 30w=${sample.weeksAboveSma30w} above=${sample.weeksAboveSma30wAbove} bars=${sample.bars}`);
  }

  if (args.dryRun) {
    console.log("Dry-run: no se escribió nada. Pasa --write con OK del dueño.");
    return;
  }

  let written = 0;
  for (let i = 0; i < wouldPatch.length; i += WRITE_BATCH) {
    const batch = wouldPatch.slice(i, i + WRITE_BATCH);
    await Promise.all(batch.map(async (row) => {
      const raw = row.raw && typeof row.raw === "object" && Object.keys(row.raw).length
        ? { ...row.raw }
        : null;
      if (raw) {
        for (const key of FIELD_KEYS) {
          if (row.metrics[key] !== undefined) raw[key] = row.metrics[key];
        }
      }
      const body = raw ? { metrics: row.metrics, raw } : { metrics: row.metrics };
      await supabaseRequest("scan_results", {
        method: "PATCH",
        query: `id=eq.${encodeURIComponent(row.id)}`,
        prefer: "return=minimal",
        body,
      });
    }));
    written += batch.length;
    if (written % 200 === 0 || written === wouldPatch.length) {
      console.log(`  ...escritas ${written}/${wouldPatch.length}`);
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
