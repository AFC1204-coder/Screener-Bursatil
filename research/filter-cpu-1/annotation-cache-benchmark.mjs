/**
 * FILTER-ANNOTATION-1 — benchmark de memo incremental de anotación.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import {
  annotateScreenerRows,
  clearScreenerAnnotationCache,
  getScreenerAnnotationCacheStats,
  resetScreenerAnnotationCacheStats,
} from "@/lib/screenerAnnotationCache.js";
import { huntPresetActiveSettings } from "@/lib/screenerHuntFilterCache.js";
import { filterAnalyzedRows } from "@/lib/screenerPipeline.js";
import { effectiveSettingsFromLayers } from "@/lib/screenerFilterLayers.js";
import {
  DEFAULT_FIELD_RULES,
  filterLayersForPreset,
  settingsForPreset,
} from "@/lib/screenerFilterCatalog.js";

const OUT_DIR = path.join(process.cwd(), "research", "filter-cpu-1");
const BASE_URL = process.env.PERF_BASE_URL || "http://127.0.0.1:3300";
const REPEATS = 5;

function accessToken() {
  const source = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
  const line = source.split(/\r?\n/).find((item) => /^STATSEDGE_ACCESS_TOKEN\s*=/.test(item));
  if (!line) throw new Error("STATSEDGE_ACCESS_TOKEN missing in .env.local");
  return line.replace(/^STATSEDGE_ACCESS_TOKEN\s*=\s*/, "").trim().replace(/^['"]|['"]$/g, "");
}

async function fetchUsScan() {
  const token = accessToken();
  const sessionRes = await fetch(`${BASE_URL}/api/auth/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!sessionRes.ok) throw new Error(`Auth failed: ${sessionRes.status}`);
  const cookie = sessionRes.headers.getSetCookie?.()?.join("; ") || "";
  const url = `${BASE_URL}/api/scans?includeRows=1&limit=1&rowsLimit=6000&anchor=nightly-us&hydrateRs=1`;
  const res = await fetch(url, { headers: cookie ? { Cookie: cookie } : {} });
  if (!res.ok) throw new Error(`Scans failed: ${res.status}`);
  const payload = await res.json();
  const scan = payload?.scans?.[0];
  const rows = scan?.rows || scan?.analyzedRows || [];
  if (!rows.length) throw new Error("Dataset vacío");
  return {
    rowCount: rows.length,
    localId: scan?.local_id || scan?.id || "unknown",
    rows,
    context: {
      id: scan?.id || scan?.local_id || "nightly-us",
      useRegimeFilter: true,
      marketHealth: scan?.marketHealth || null,
      symbolsCount: rows.length,
      baseCount: scan?.baseCount || rows.length,
    },
  };
}

function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  if (!s.length) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function timedAnnotate(rows, settings, repeats = REPEATS) {
  const samples = [];
  let lastStats = null;
  for (let i = 0; i < repeats; i++) {
    clearScreenerAnnotationCache();
    resetScreenerAnnotationCacheStats();
    const t0 = performance.now();
    annotateScreenerRows(rows, settings);
    samples.push(performance.now() - t0);
    lastStats = getScreenerAnnotationCacheStats();
  }
  return { coldMs: samples[0], warmMs: median(samples.slice(1)), stats: lastStats };
}

function timedAnnotateCached(rows, settings, repeats = REPEATS) {
  clearScreenerAnnotationCache();
  annotateScreenerRows(rows, settings);
  const samples = [];
  let lastStats = null;
  for (let i = 0; i < repeats; i++) {
    resetScreenerAnnotationCacheStats();
    const t0 = performance.now();
    annotateScreenerRows(rows.map((row) => ({ ...row })), settings);
    samples.push(performance.now() - t0);
    lastStats = getScreenerAnnotationCacheStats();
  }
  return { warmMs: median(samples), stats: lastStats };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const dataset = await fetchUsScan();
  const balancedActive = effectiveSettingsFromLayers(
    settingsForPreset("balanced"),
    filterLayersForPreset("balanced"),
    DEFAULT_FIELD_RULES,
  );
  const nearPivotActive = huntPresetActiveSettings("nearPivot");
  const momentumOffActive = effectiveSettingsFromLayers(
    settingsForPreset("balanced"),
    { ...filterLayersForPreset("balanced"), momentum: false },
    DEFAULT_FIELD_RULES,
  );

  const balancedPass = filterAnalyzedRows(dataset.rows, balancedActive, dataset.context).rows;
  const nearPivotPass = filterAnalyzedRows(dataset.rows, nearPivotActive, dataset.context).rows;
  const momentumOffPass = filterAnalyzedRows(dataset.rows, momentumOffActive, dataset.context).rows;

  const scenarios = [
    { id: "balanced-cold", label: "Líderes E2 (frío)", rows: balancedPass, settings: balancedActive },
    { id: "balanced-cached", label: "Líderes E2 (2.º pase)", rows: balancedPass, settings: balancedActive, cached: true },
    { id: "hunt-pivot-pass", label: "Cerca pivot (26 pasan)", rows: nearPivotPass, settings: nearPivotActive, cached: true },
    { id: "momentum-off", label: "Momentum OFF (979 pasan)", rows: momentumOffPass, settings: momentumOffActive },
    { id: "toggle-back-balanced", label: "Vuelta Líderes E2 tras Momentum OFF", rows: balancedPass, settings: balancedActive, cached: true },
  ];

  const results = [];
  for (const scenario of scenarios) {
    const out = scenario.cached
      ? timedAnnotateCached(scenario.rows, scenario.settings)
      : timedAnnotate(scenario.rows, scenario.settings);
    results.push({
      id: scenario.id,
      label: scenario.label,
      passCount: scenario.rows.length,
      annotateColdMs: out.coldMs ? Math.round(out.coldMs) : null,
      annotateWarmMs: Math.round(out.warmMs),
      cacheStats: out.stats,
    });
    console.log(`${scenario.label}: annotate=${Math.round(out.warmMs)}ms hits=${out.stats.cacheHits + out.stats.rowHits} misses=${out.stats.misses}`);
  }

  const output = {
    meta: {
      dataset: { rowCount: dataset.rowCount, localId: dataset.localId, baseUrl: BASE_URL },
      finishedAt: new Date().toISOString(),
    },
    scenarios: results,
  };
  writeFileSync(path.join(OUT_DIR, "annotation-cache-benchmark.json"), JSON.stringify(output, null, 2));
  return output;
}

main().catch((err) => {
  console.error("annotation-cache-benchmark failed:", err?.message || err);
  process.exitCode = 1;
});
