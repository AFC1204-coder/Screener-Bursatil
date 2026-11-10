/**
 * FILTER-CPU-1 — perfil CPU Node con dataset US real (~3580 filas).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { phasedFilterAnalyzedRows, validatePhasedAgainstCanon } from "./phased-filter.mjs";
import { phasedViewModelWork } from "./view-model-phases.mjs";
import { huntPresetActiveSettings, getOrComputeHuntFilter, huntFilterCacheKey } from "@/lib/screenerHuntFilterCache";
import { filterAnalyzedRows } from "@/lib/screenerPipeline";
import { effectiveSettingsFromLayers } from "@/lib/screenerFilterLayers";
import {
  DEFAULT_FIELD_RULES,
  DEFAULT_FILTER_LAYERS,
  filterLayersForPreset,
  settingsForPreset,
} from "@/lib/screenerFilterCatalog";
import { settingsAtFamilyIntensity } from "@/lib/filterFamilyIntensity";
import { applyPerfPeriodSelection, applySortSelection } from "@/lib/screenerSortInvariant";

const OUT_DIR = path.join(process.cwd(), "research", "filter-cpu-1");
const BASE_URL = process.env.PERF_BASE_URL || "http://127.0.0.1:3300";
const WARMUP = 2;
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
    headers: { "Content-Type": "application/json", Cookie: "" },
    body: JSON.stringify({ token }),
  });
  if (!sessionRes.ok) throw new Error(`Auth failed: ${sessionRes.status}`);
  const cookie = sessionRes.headers.getSetCookie?.()?.join("; ") || "";

  const url = `${BASE_URL}/api/scans?includeRows=1&limit=1&rowsLimit=6000&anchor=nightly-us&hydrateRs=1`;
  const t0 = performance.now();
  const res = await fetch(url, { headers: cookie ? { Cookie: cookie } : {} });
  if (!res.ok) throw new Error(`Scans failed: ${res.status} ${await res.text()}`);
  const payload = await res.json();
  const fetchMs = performance.now() - t0;
  const scan = payload?.scans?.[0];
  const rows = scan?.rows || scan?.analyzedRows || [];
  if (!rows.length) throw new Error("Dataset vacío — STOP");
  return {
    fetchMs,
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

function runTimed(label, fn, repeats = REPEATS) {
  const samples = [];
  let lastResult = null;
  for (let i = 0; i < WARMUP + repeats; i++) {
    const t0 = performance.now();
    lastResult = fn();
    const ms = performance.now() - t0;
    if (i >= WARMUP) samples.push(ms);
  }
  return {
    workflow: label,
    coldMs: samples[0] ?? null,
    warmMs: median(samples.slice(1)),
    medianMs: median(samples),
    samples,
    ...lastResult,
  };
}

function mergePhaseStats(workflowResults) {
  const acc = new Map();
  for (const run of workflowResults) {
    const phases = run.phases || {};
    for (const [key, ms] of Object.entries(phases)) {
      if (key.endsWith("__calls")) continue;
      const bucket = acc.get(key) || { cold: [], warm: [] };
      bucket.cold.push(run.coldPhases?.[key] ?? ms);
      bucket.warm.push(ms);
      acc.set(key, bucket);
    }
  }
  return acc;
}

function timedPhasedFilter(rows, settings, context) {
  const result = phasedFilterAnalyzedRows(rows, settings, context);
  const vm = phasedViewModelWork(result.rows, settings, {
    sort: applySortSelection("activePerf", { perfPeriod: "perf3m" }).sort,
  });
  return {
    phases: { ...result.phases, ...Object.fromEntries(
      Object.entries(vm.phases).map(([k, v]) => [`vm.${k}`, v]),
    ) },
    filterPhases: result.phases,
    vmPhases: vm.phases,
    filterMs: result.filterMs,
    vmMs: vm.totalMs,
    passCount: result.passCount,
    path: result.path,
    usedFastPath: result.usedFastPath,
    rescored: result.rescored,
  };
}

function buildWorkflows(dataset) {
  const { rows, context } = dataset;
  const balancedLayers = filterLayersForPreset("balanced");
  const balancedSettings = settingsForPreset("balanced");
  const balancedActive = effectiveSettingsFromLayers(balancedSettings, balancedLayers, DEFAULT_FIELD_RULES);

  const nearPivotActive = huntPresetActiveSettings("nearPivot");
  const weaknessActive = huntPresetActiveSettings("weakness");

  const momentumOffLayers = { ...balancedLayers, momentum: false };
  const momentumOffActive = effectiveSettingsFromLayers(balancedSettings, momentumOffLayers, DEFAULT_FIELD_RULES);

  const liquidityOffLayers = { ...balancedLayers, liquidity: false };
  const liquidityOffActive = effectiveSettingsFromLayers(balancedSettings, liquidityOffLayers, DEFAULT_FIELD_RULES);

  const rsPatch = settingsAtFamilyIntensity("relativeStrength", 75);
  const rsIntensityActive = effectiveSettingsFromLayers(
    { ...balancedSettings, ...rsPatch.settings },
    balancedLayers,
    { ...DEFAULT_FIELD_RULES, ...rsPatch.fieldRules },
  );

  const sortRs = applySortSelection("rsGlobalPct", { perfPeriod: "perf3m" });
  const period6m = applyPerfPeriodSelection("perf6m");

  const huntCache = new Map();

  return [
    {
      id: "hunt-stage2-cold",
      label: "Hunt Líderes Etapa 2 (frío)",
      run: () => timedPhasedFilter(rows, balancedActive, context),
    },
    {
      id: "hunt-stage2-warm",
      label: "Hunt Líderes Etapa 2 (repetición)",
      run: () => timedPhasedFilter(rows, balancedActive, context),
    },
    {
      id: "hunt-cache-hit",
      label: "Hunt Cerca de pivot (caché caliente)",
      prewarm: () => {
        getOrComputeHuntFilter(huntCache, "nearPivot", rows, context, filterAnalyzedRows);
      },
      run: () => {
        const cached = getOrComputeHuntFilter(huntCache, "nearPivot", rows, context, filterAnalyzedRows);
        const vm = phasedViewModelWork(cached.view.rows, nearPivotActive);
        return {
          phases: { cacheHit: cached.fromCache ? 0.01 : 0, ...vm.phases },
          filterMs: cached.view.filterMs,
          vmMs: vm.totalMs,
          passCount: cached.view.rows.length,
          path: cached.view.path,
          fromCache: cached.fromCache,
        };
      },
    },
    {
      id: "hunt-pivot-cold",
      label: "Hunt Cerca de pivot (frío, sin caché)",
      run: () => timedPhasedFilter(rows, nearPivotActive, context),
    },
    {
      id: "toggle-momentum-off",
      label: "Toggle Momentum OFF",
      run: () => timedPhasedFilter(rows, momentumOffActive, context),
    },
    {
      id: "toggle-momentum-on",
      label: "Toggle Momentum ON (vuelta)",
      run: () => timedPhasedFilter(rows, balancedActive, context),
    },
    {
      id: "toggle-liquidity-off",
      label: "Toggle Liquidez OFF",
      run: () => timedPhasedFilter(rows, liquidityOffActive, context),
    },
    {
      id: "intensity-rs-75",
      label: "Intensidad RS → 75",
      run: () => timedPhasedFilter(rows, rsIntensityActive, context),
    },
    {
      id: "sort-rs",
      label: "Sort por RS (solo view-model)",
      run: () => {
        const base = phasedFilterAnalyzedRows(rows, balancedActive, context);
        const vm = phasedViewModelWork(base.rows, balancedActive, { sort: sortRs.sort, sortAsc: false });
        return {
          phases: { ...base.phases, ...Object.fromEntries(Object.entries(vm.phases).map(([k, v]) => [`vm.${k}`, v])) },
          filterMs: base.filterMs,
          vmMs: vm.totalMs,
          passCount: base.passCount,
          path: base.path,
        };
      },
    },
    {
      id: "period-6m",
      label: "Cambio periodo → 6M",
      run: () => {
        const base = phasedFilterAnalyzedRows(rows, balancedActive, context);
        const vm = phasedViewModelWork(base.rows, balancedActive, {
          sort: period6m.sort,
          sortAsc: false,
        });
        return {
          phases: { ...base.phases, ...Object.fromEntries(Object.entries(vm.phases).map(([k, v]) => [`vm.${k}`, v])) },
          filterMs: base.filterMs,
          vmMs: vm.totalMs,
          passCount: base.passCount,
        };
      },
    },
    {
      id: "hunt-deterioro-cold",
      label: "Hunt Deterioro (frío)",
      run: () => timedPhasedFilter(rows, weaknessActive, context),
    },
  ];
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const dataset = await fetchUsScan();
  console.log(`Dataset: ${dataset.rowCount} filas · ${dataset.localId} · fetch ${Math.round(dataset.fetchMs)}ms`);

  const validation = validatePhasedAgainstCanon(
    dataset.rows.slice(0, 200),
    huntPresetActiveSettings("balanced"),
    dataset.context,
  );
  if (!validation.match) {
    console.warn("WARN: phased diverge del canon en muestra — revisar instrumentación");
  }

  const workflows = buildWorkflows(dataset);
  const results = [];

  for (const wf of workflows) {
    wf.prewarm?.();
    const samples = [];
    const phaseSamples = [];
    for (let i = 0; i < WARMUP + REPEATS; i++) {
      const t0 = performance.now();
      const out = wf.run();
      const wallMs = performance.now() - t0;
      if (i >= WARMUP) {
        samples.push(wallMs);
        phaseSamples.push(out.phases || {});
      }
    }
    const coldPhases = phaseSamples[0] || {};
    const warmPhaseMedians = {};
    const phaseKeys = new Set(phaseSamples.flatMap((p) => Object.keys(p)));
    for (const key of phaseKeys) {
      warmPhaseMedians[key] = median(phaseSamples.slice(1).map((p) => p[key] || 0));
    }
    const coldMs = samples[0];
    const warmMs = median(samples.slice(1));
    const lastOut = wf.run();
    results.push({
      id: wf.id,
      workflow: wf.label,
      coldMs: Math.round(coldMs),
      warmMs: Math.round(warmMs),
      medianMs: Math.round(median(samples)),
      filterMs: Math.round(median(phaseSamples.map((p, idx) => {
        const filterKeys = Object.keys(p).filter((k) => !k.startsWith("vm."));
        return filterKeys.reduce((s, k) => s + (p[k] || 0), 0);
      }))),
      vmMs: Math.round(median(phaseSamples.map((p) => Object.entries(p)
        .filter(([k]) => k.startsWith("vm."))
        .reduce((s, [, v]) => s + v, 0)))),
      passCount: lastOut.passCount,
      path: lastOut.path,
      fromCache: lastOut.fromCache,
      coldPhases,
      warmPhases: warmPhaseMedians,
      samples: samples.map((s) => Math.round(s)),
    });
    console.log(`${wf.label}: cold=${Math.round(coldMs)}ms warm=${Math.round(warmMs)}ms`);
  }

  const output = {
    meta: {
      dataset: {
        rowCount: dataset.rowCount,
        localId: dataset.localId,
        fetchMs: Math.round(dataset.fetchMs),
        baseUrl: BASE_URL,
      },
      validation: { match: validation.match, canonMs: validation.canon.filterMs, phasedMs: validation.phased.filterMs },
      repeats: REPEATS,
      warmup: WARMUP,
      finishedAt: new Date().toISOString(),
    },
    workflows: results,
  };

  writeFileSync(path.join(OUT_DIR, "node-profile.json"), JSON.stringify(output, null, 2));
  return output;
}

main().catch((err) => {
  console.error("FILTER-CPU-1 node profile failed:", err?.message || err);
  process.exitCode = 1;
});
