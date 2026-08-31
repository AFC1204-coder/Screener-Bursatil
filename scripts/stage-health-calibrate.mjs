#!/usr/bin/env node
// MET-5-calibrate — muestreo read-only de umbrales salud de etapa (Etapas 2 y 4).
// Sin write a DB de producto, sin UI, sin scoring.
//
// Uso:
//   node --env-file=.env.local --loader ./scripts/loader.mjs scripts/stage-health-calibrate.mjs
// Opciones (env):
//   STAGE_HEALTH_CALIBRATE_CONCURRENCY=12
//   STAGE_HEALTH_CALIBRATE_MARKDOWN=docs/scratch/stage-health-calibrate.md

import fs from "node:fs/promises";
import path from "node:path";
import { readDailyBarsCache } from "@/lib/dailyBarsCache.js";
import { detectPriceDiscontinuities } from "@/lib/indicators.js";
import {
  UP_DOWN_VOLUME_RATIO_BALANCED,
  UP_DOWN_VOLUME_THRESHOLD,
} from "@/lib/marketVolume.js";
import { readNightlyUsScan } from "@/lib/nightlyUsScan.js";
import {
  ADVANCE_DEAD_BAND_PP,
  advancePriorPct,
  PRICE_DISCONTINUITY_FACTOR,
  trendSupportFieldsFromBars,
} from "@/lib/trendSupport.js";
import { scanDecisionRowFromDb } from "@/lib/scanDecisionProjection.js";
import { supabaseConfig, supabaseRequest } from "@/lib/supabaseServer.js";

const POSTGREST_MAX_ROWS = 1000;
const PERSISTENCE_30_SAT = 26;
const PERSISTENCE_10_SAT = 10;
const EXTENSION_GOOD_PCT = 15;
const EXTENSION_BAD_PCT = 50;
const WEIGHTS = { p30: 25, p10: 10, accel: 20, vol: 25, ext: 20 };
const CONCURRENCY = Math.max(1, Number(process.env.STAGE_HEALTH_CALIBRATE_CONCURRENCY || 12));
const MARKDOWN_PATH = process.env.STAGE_HEALTH_CALIBRATE_MARKDOWN || "";
const EXAMPLE_SYMBOLS = new Set(
  (process.env.STAGE_HEALTH_CALIBRATE_EXAMPLES
    || "NVDA,AAPL,MSFT,META,GOOGL,AMZN,TSLA,AMD,INTC,F,BA,DIS,PYPL,NFLX")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean),
);

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function stageSideAbove(stageState) {
  return stageState === "stage2";
}

function persistence30Subscore(weeks, stageState) {
  const n = finite(weeks);
  if (n === null || n <= 0) return null;
  return Math.min(n / PERSISTENCE_30_SAT, 1);
}

function persistence10Subscore(weeks, weeksAbove, stageState) {
  const n = finite(weeks);
  const above = weeksAbove;
  const expectedAbove = stageSideAbove(stageState);
  if (n === null || n <= 0 || above === null) return null;
  if (above !== expectedAbove) return 0;
  return Math.min(n / PERSISTENCE_10_SAT, 1);
}

function accelerationSubscore(recent, prior, stageState) {
  const r1 = finite(recent);
  const r0 = finite(prior);
  if (r1 === null || r0 === null) return null;
  const delta = r1 - r0;
  const directed = stageState === "stage4" ? -delta : delta;
  if (directed > ADVANCE_DEAD_BAND_PP) return 1;
  if (Math.abs(directed) <= ADVANCE_DEAD_BAND_PP) return 0.75;
  return 0;
}

function volumeSubscore(ratio, stageState) {
  const n = finite(ratio);
  if (n === null) return null;
  if (stageState === "stage2") {
    if (n >= UP_DOWN_VOLUME_THRESHOLD) return 1;
    if (n >= UP_DOWN_VOLUME_RATIO_BALANCED) return 0.6;
    return 0;
  }
  if (n < UP_DOWN_VOLUME_RATIO_BALANCED) return 1;
  if (n < UP_DOWN_VOLUME_THRESHOLD) return 0.6;
  return 0;
}

function extensionSubscore(distanceSlowMaPct) {
  const e = Math.abs(finite(distanceSlowMaPct) ?? NaN);
  if (!Number.isFinite(e)) return null;
  if (e <= EXTENSION_GOOD_PCT) return 1;
  if (e >= EXTENSION_BAD_PCT) return 0;
  return (EXTENSION_BAD_PCT - e) / (EXTENSION_BAD_PCT - EXTENSION_GOOD_PCT);
}

function computeStageHealth(row = {}, trend = {}, bars = []) {
  const stageState = String(row.weeklyStageState || "").trim();
  if (stageState !== "stage2" && stageState !== "stage4") {
    return { available: false, reason: "non-trending-stage" };
  }

  const discontinuity = detectPriceDiscontinuities(bars, PRICE_DISCONTINUITY_FACTOR);
  if (discontinuity.discontinuous) {
    return { available: false, reason: "discontinuous" };
  }

  const recent = finite(row.perf3m) ?? finite(trend.advanceRecentPct);
  const prior = finite(trend.advancePriorPct) ?? advancePriorPct(recent, finite(row.perf6m));
  const distance =
    finite(row.distanceSma30w)
    ?? finite(row.weeklyDistanceSlowMa)
    ?? finite(row.weeklyStage?.distanceSlowMaPct);

  const components = {
    persistence30: persistence30Subscore(trend.weeksAboveSma30w, stageState),
    persistence10: persistence10Subscore(
      trend.weeksAboveSma10w,
      trend.weeksAboveSma10wAbove,
      stageState,
    ),
    acceleration: accelerationSubscore(recent, prior, stageState),
    volume: volumeSubscore(row.upDownVolRatio ?? trend.upDownVolRatio, stageState),
    extension: extensionSubscore(distance),
  };

  const missing = Object.entries(components).filter(([, v]) => v === null).map(([k]) => k);
  if (missing.length) {
    return { available: false, reason: `missing:${missing.join(",")}`, components };
  }

  const points = {
    persistence30: components.persistence30 * WEIGHTS.p30,
    persistence10: components.persistence10 * WEIGHTS.p10,
    acceleration: components.acceleration * WEIGHTS.accel,
    volume: components.volume * WEIGHTS.vol,
    extension: components.extension * WEIGHTS.ext,
  };
  const score = Math.round(
    points.persistence30
    + points.persistence10
    + points.acceleration
    + points.volume
    + points.extension,
  );

  return {
    available: true,
    stageState,
    score,
    components,
    points,
    inputs: {
      weeksAboveSma30w: trend.weeksAboveSma30w,
      weeksAboveSma10w: trend.weeksAboveSma10w,
      weeksAboveSma10wAbove: trend.weeksAboveSma10wAbove,
      advanceRecentPct: recent,
      advancePriorPct: prior,
      upDownVolRatio: finite(row.upDownVolRatio),
      distanceSlowMaPct: distance,
      weeklyStageWeek: finite(row.weeklyStageWeek),
    },
  };
}

function percentile(sorted = [], p = 50) {
  if (!sorted.length) return null;
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  const w = rank - lo;
  return sorted[lo] * (1 - w) + sorted[hi] * w;
}

function histogram(values = [], edges = []) {
  const counts = Array(edges.length).fill(0);
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    let idx = edges.length - 1;
    for (let i = 0; i < edges.length - 1; i += 1) {
      if (value < edges[i + 1]) {
        idx = i;
        break;
      }
    }
    counts[idx] += 1;
  }
  return counts;
}

function renderHistogram(title, values, edges, labels) {
  const counts = histogram(values, edges);
  const max = Math.max(...counts, 1);
  const width = 28;
  const lines = [`\n${title} (n=${values.length})`];
  for (let i = 0; i < labels.length; i += 1) {
    const barLen = Math.round((counts[i] / max) * width);
    lines.push(`${labels[i].padEnd(12)} ${String(counts[i]).padStart(5)} ${"█".repeat(barLen)}`);
  }
  return lines.join("\n");
}

function renderPercentiles(title, sorted = []) {
  if (!sorted.length) return `\n${title}: sin datos`;
  return [
    `\n${title} (n=${sorted.length})`,
    `  p10=${percentile(sorted, 10)?.toFixed(1)}  p25=${percentile(sorted, 25)?.toFixed(1)}`
      + `  p50=${percentile(sorted, 50)?.toFixed(1)}  p75=${percentile(sorted, 75)?.toFixed(1)}`
      + `  p90=${percentile(sorted, 90)?.toFixed(1)}  p95=${percentile(sorted, 95)?.toFixed(1)}`
      + `  min=${sorted[0].toFixed(1)}  max=${sorted.at(-1).toFixed(1)}`,
  ].join("\n");
}

function formatBreakdown(item) {
  const p = item.points;
  return [
    `salud ${item.score}`,
    `30w ${p.persistence30.toFixed(1)}/${WEIGHTS.p30}`,
    `10w ${p.persistence10.toFixed(1)}/${WEIGHTS.p10}`,
    `avance ${p.acceleration.toFixed(1)}/${WEIGHTS.accel}`,
    `vol ${p.volume.toFixed(1)}/${WEIGHTS.vol}`,
    `ext ${p.extension.toFixed(1)}/${WEIGHTS.ext}`,
  ].join(" · ");
}

function formatInputs(item) {
  const i = item.inputs;
  return [
    `30w=${i.weeksAboveSma30w}sem`,
    `10w=${i.weeksAboveSma10w}sem`,
    `Δavance=${finite(i.advanceRecentPct)?.toFixed(1)}% vs ${finite(i.advancePriorPct)?.toFixed(1)}%`,
    `vol=${finite(i.upDownVolRatio)?.toFixed(2)}×`,
    `|ext|=${Math.abs(finite(i.distanceSlowMaPct) ?? 0).toFixed(1)}%`,
    `weekInStage=${i.weeklyStageWeek ?? "—"}`,
  ].join(", ");
}

async function fetchAllScanRows(scanId) {
  const config = supabaseConfig();
  const rows = [];
  let offset = 0;
  for (;;) {
    const page = await supabaseRequest("scan_results", {
      query: [
        `owner_id=eq.${encodeURIComponent(config.ownerId)}`,
        `scan_id=eq.${encodeURIComponent(scanId)}`,
        "select=symbol,metrics,raw",
        "order=rank_index.asc",
        `limit=${POSTGREST_MAX_ROWS}`,
        `offset=${offset}`,
      ].join("&"),
      timeoutMs: 60000,
    });
    if (!page?.length) break;
    for (const item of page) rows.push(scanDecisionRowFromDb(item));
    offset += page.length;
    if (page.length < POSTGREST_MAX_ROWS) break;
  }
  return rows;
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const idx = next;
      next += 1;
      results[idx] = await worker(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

function recommendThresholds(stage2, stage4) {
  const lines = ["\n=== Recomendación (MET-5-calibrate) ==="];
  const w30 = [...stage2.weeks30, ...stage4.weeks30].sort((a, b) => a - b);
  const w10 = [...stage2.weeks10, ...stage4.weeks10].sort((a, b) => a - b);
  const ext = [...stage2.absExt, ...stage4.absExt].sort((a, b) => a - b);
  const health = [...stage2.health, ...stage4.health].sort((a, b) => a - b);

  const p75w30 = percentile(w30, 75);
  const p90w30 = percentile(w30, 90);
  const sat26share = w30.filter((v) => v >= PERSISTENCE_30_SAT).length / Math.max(w30.length, 1);
  const sat10share = w10.filter((v) => v >= PERSISTENCE_10_SAT).length / Math.max(w10.length, 1);
  const extGoodShare = ext.filter((v) => v <= EXTENSION_GOOD_PCT).length / Math.max(ext.length, 1);
  const extZeroShare = ext.filter((v) => v >= EXTENSION_BAD_PCT).length / Math.max(ext.length, 1);
  const healthSpread = (percentile(health, 90) ?? 0) - (percentile(health, 10) ?? 0);

  if (sat26share < 0.15 && p90w30 < PERSISTENCE_30_SAT) {
    lines.push(
      `- Persistencia 30w: recortar saturación 26 → ${Math.max(10, Math.round(p90w30))} sem`
        + ` (solo ${(sat26share * 100).toFixed(0)}% alcanza 26; p90=${p90w30?.toFixed(1)}).`,
    );
  } else {
    lines.push(
      `- Persistencia 30w: mantener 26 sem (${(sat26share * 100).toFixed(0)}% en techo; p75=${p75w30?.toFixed(1)}, p90=${p90w30?.toFixed(1)}).`,
    );
  }

  if (sat10share > 0.55) {
    lines.push(
      `- Persistencia 10w: mantener 10 sem (${(sat10share * 100).toFixed(0)}% saturan; discrimina bien).`,
    );
  } else {
    lines.push(
      `- Persistencia 10w: mantener 10 sem (p90=${percentile(w10, 90)?.toFixed(1)}; pocos en techo pero rampa corta útil).`,
    );
  }

  if (extZeroShare > 0.08) {
    lines.push(
      `- Extensión: mantener 15/50% (${(extGoodShare * 100).toFixed(0)}% ≤15%, ${(extZeroShare * 100).toFixed(0)}% ≥50% → penalización activa).`,
    );
  } else if (extGoodShare > 0.7) {
    lines.push(
      `- Extensión: valorar recorte banda buena 15 → 20% si se quiere más peso en estiramiento moderado`
        + ` (${(extGoodShare * 100).toFixed(0)}% ya ≤15%).`,
    );
  } else {
    lines.push(
      `- Extensión: mantener 15/50% (p50 |ext|=${percentile(ext, 50)?.toFixed(1)}%, p90=${percentile(ext, 90)?.toFixed(1)}%).`,
    );
  }

  if (healthSpread < 25) {
    lines.push(
      `- Índice: dispersión moderada (p90−p10=${healthSpread.toFixed(0)} pts); umbrales actuales no apelotonan en un rango estrecho.`,
    );
  } else {
    lines.push(
      `- Índice: buena dispersión (p90−p10=${healthSpread.toFixed(0)} pts); fórmula discrimina con umbrales propuestos.`,
    );
  }

  return lines.join("\n");
}

function pickExamples(computed = []) {
  const available = computed.filter((c) => c.health?.available);
  const byStage = {
    stage2: available.filter((c) => c.health.stageState === "stage2"),
    stage4: available.filter((c) => c.health.stageState === "stage4"),
  };
  const chosen = new Map();

  for (const symbol of EXAMPLE_SYMBOLS) {
    const hit = available.find((c) => c.symbol === symbol);
    if (hit) chosen.set(symbol, hit);
  }

  for (const stage of ["stage2", "stage4"]) {
    const pool = [...byStage[stage]].sort((a, b) => b.health.score - a.health.score);
    if (pool[0] && !chosen.has(pool[0].symbol)) chosen.set(pool[0].symbol, pool[0]);
    if (pool.at(-1) && !chosen.has(pool.at(-1).symbol)) chosen.set(pool.at(-1).symbol, pool.at(-1));
    const mid = pool[Math.floor(pool.length / 2)];
    if (mid && !chosen.has(mid.symbol)) chosen.set(mid.symbol, mid);
  }

  return [...chosen.values()].slice(0, 12);
}

async function main() {
  const nightly = await readNightlyUsScan({
    timeoutMs: 60000,
    columns: "id,local_id,created_at,settings",
  });
  if (!nightly.scan?.id) {
    console.error("No hay escaneo nocturno US publicable:", nightly.reason || "desconocido");
    process.exitCode = 1;
    return;
  }

  const scanId = nightly.scan.id;
  const started = Date.now();
  const allRows = await fetchAllScanRows(scanId);
  const trending = allRows.filter((r) => r.weeklyStageState === "stage2" || r.weeklyStageState === "stage4");

  console.log("=== MET-5-calibrate — salud de etapa (read-only) ===");
  console.log(`Scan: ${nightly.scan.local_id || scanId} · filas=${allRows.length} · etapa 2/4=${trending.length}`);

  const computed = await mapWithConcurrency(trending, CONCURRENCY, async (row) => {
    const cache = await readDailyBarsCache(row.symbol, { limit: 400, timeoutMs: 20000 });
    const bars = cache.bars || [];
    const trend = trendSupportFieldsFromBars(bars);
    const health = computeStageHealth(row, trend, bars);
    return { symbol: row.symbol, row, trend, health, barsCount: bars.length };
  });

  const buckets = {
    stage2: { weeks30: [], weeks10: [], absExt: [], health: [] },
    stage4: { weeks30: [], weeks10: [], absExt: [], health: [] },
  };
  const absence = { total: trending.length, available: 0, reasons: new Map() };

  for (const item of computed) {
    const stage = item.health.stageState;
    if (!item.health.available) {
      const reason = item.health.reason || "unknown";
      absence.reasons.set(reason, (absence.reasons.get(reason) || 0) + 1);
      continue;
    }
    absence.available += 1;
    const b = buckets[stage];
    b.weeks30.push(item.health.inputs.weeksAboveSma30w);
    b.weeks10.push(item.health.inputs.weeksAboveSma10w);
    b.absExt.push(Math.abs(item.health.inputs.distanceSlowMaPct));
    b.health.push(item.health.score);
  }

  const out = [];
  out.push(`\nCobertura índice: ${absence.available}/${absence.total} (${((absence.available / Math.max(absence.total, 1)) * 100).toFixed(1)}%)`);
  if (absence.reasons.size) {
    out.push("Ausencias:");
    for (const [reason, count] of [...absence.reasons.entries()].sort((a, b) => b[1] - a[1])) {
      out.push(`  ${reason}: ${count}`);
    }
  }

  for (const [label, key] of [["Etapa 2", "stage2"], ["Etapa 4", "stage4"]]) {
    const b = buckets[key];
    const n = b.health.length;
    out.push(`\n--- ${label} (índice computable: ${n}) ---`);
    out.push(renderPercentiles("Persistencia 30w (sem)", [...b.weeks30].sort((a, b) => a - b)));
    out.push(renderHistogram(
      "Histograma persistencia 30w",
      b.weeks30,
      [0, 5, 10, 15, 20, 25, 26, Infinity],
      ["0-4", "5-9", "10-14", "15-19", "20-24", "25", "26+"],
    ));
    out.push(renderPercentiles("Persistencia 10w (sem)", [...b.weeks10].sort((a, b) => a - b)));
    out.push(renderHistogram(
      "Histograma persistencia 10w",
      b.weeks10,
      [0, 1, 4, 7, 10, Infinity],
      ["0", "1-3", "4-6", "7-9", "10+"],
    ));
    out.push(renderPercentiles("|distanceSlowMaPct| (%)", [...b.absExt].sort((a, b) => a - b)));
    out.push(renderHistogram(
      "Histograma |extensión|",
      b.absExt,
      [0, 5, 15, 25, 35, 50, Infinity],
      ["0-4", "5-14", "15-24", "25-34", "35-49", "50+"],
    ));
    out.push(renderPercentiles("Salud de etapa (0-100)", [...b.health].sort((a, b) => a - b)));
    out.push(renderHistogram(
      "Histograma salud",
      b.health,
      [0, 20, 40, 60, 80, 101],
      ["0-19", "20-39", "40-59", "60-79", "80-100"],
    ));
  }

  out.push(recommendThresholds(buckets.stage2, buckets.stage4));

  out.push("\n=== Ejemplos con desglose ===");
  for (const item of pickExamples(computed)) {
    const stageLabel = item.health.stageState === "stage4" ? "Etapa 4" : "Etapa 2";
    out.push(`\n${item.symbol} · ${stageLabel}`);
    out.push(`  ${formatBreakdown(item.health)}`);
    out.push(`  ${formatInputs(item.health)}`);
  }

  out.push(`\nTiempo: ${((Date.now() - started) / 1000).toFixed(1)}s · concurrencia=${CONCURRENCY}`);
  const report = out.join("\n");
  console.log(report);

  if (MARKDOWN_PATH) {
    const mdPath = path.resolve(MARKDOWN_PATH);
    await fs.mkdir(path.dirname(mdPath), { recursive: true });
    await fs.writeFile(mdPath, `# MET-5-calibrate\n\n\`\`\`\n${report}\n\`\`\`\n`, "utf8");
    console.log(`\nInforme escrito en ${mdPath}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
