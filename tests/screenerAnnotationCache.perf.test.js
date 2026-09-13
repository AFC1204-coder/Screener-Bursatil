import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  annotateScreenerRows,
  clearScreenerAnnotationCache,
  getScreenerAnnotationCacheStats,
  resetScreenerAnnotationCacheStats,
} from "@/lib/screenerAnnotationCache";
import { huntPresetActiveSettings } from "@/lib/screenerHuntFilterCache";
import { filterAnalyzedRows } from "@/lib/screenerPipeline";
import { effectiveSettingsFromLayers } from "@/lib/screenerFilterLayers";
import {
  DEFAULT_FIELD_RULES,
  filterLayersForPreset,
  settingsForPreset,
} from "@/lib/screenerFilterCatalog";

const RUN_PERF = process.env.SCREENER_ANNOTATION_PERF === "1";
const BASE_URL = process.env.PERF_BASE_URL || "http://127.0.0.1:3300";
const OUT_PATH = path.join(process.cwd(), "research", "filter-cpu-1", "annotation-cache-benchmark.json");

function accessToken() {
  const source = readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
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

function timedAnnotate(rows, settings, repeats = 5) {
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

function timedAnnotateCached(rows, settings, repeats = 5) {
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

describe.runIf(RUN_PERF)("screener annotation cache perf (real dataset)", () => {
  it("mide cold vs cached annotate sobre 3500+ filas", async () => {
    const dataset = await fetchUsScan();
    expect(dataset.rowCount).toBeGreaterThan(3000);

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
      { id: "hunt-pivot-pass", label: "Cerca pivot", rows: nearPivotPass, settings: nearPivotActive, cached: true },
      { id: "momentum-off", label: "Momentum OFF", rows: momentumOffPass, settings: momentumOffActive },
      { id: "toggle-back-balanced", label: "Vuelta Líderes E2", rows: balancedPass, settings: balancedActive, cached: true },
    ];

    const results = scenarios.map((scenario) => {
      const out = scenario.cached
        ? timedAnnotateCached(scenario.rows, scenario.settings)
        : timedAnnotate(scenario.rows, scenario.settings);
      return {
        id: scenario.id,
        label: scenario.label,
        passCount: scenario.rows.length,
        annotateColdMs: out.coldMs ? Math.round(out.coldMs) : null,
        annotateWarmMs: Math.round(out.warmMs),
        cacheStats: out.stats,
      };
    });

    const cachedScenario = results.find((item) => item.id === "balanced-cached");
    expect(cachedScenario.cacheStats.cacheHits).toBeGreaterThan(0);
    expect(cachedScenario.annotateWarmMs).toBeLessThan(cachedScenario.annotateColdMs || 999);

    mkdirSync(path.dirname(OUT_PATH), { recursive: true });
    writeFileSync(OUT_PATH, JSON.stringify({
      meta: {
        dataset: { rowCount: dataset.rowCount, localId: dataset.localId, baseUrl: BASE_URL },
        finishedAt: new Date().toISOString(),
      },
      scenarios: results,
    }, null, 2));
  }, 120000);
});
