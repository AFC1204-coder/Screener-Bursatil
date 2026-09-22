#!/usr/bin/env node
/**
 * SCREENER-COLD-PAYLOAD-1 — remeasure synthetic vs WAVE5 + mesa-light-wire.
 *
 *   node --loader ./scripts/loader.mjs research/screener-cold-payload-1/probe.mjs
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { execSync } from "node:child_process";
import {
  MESA_TRANSPORT_OMIT_FIELDS,
  projectScanRowForMesaTransport,
  SCAN_LIGHT_FIELDS,
} from "@/lib/scanLightProjection.js";
import { stripChartPreviewForTransport } from "@/lib/scansChartPreviewTransport.js";
import {
  measureProjectedFieldWeights,
  measureRowsJsonBytes,
  topProjectedFieldWeights,
} from "@/lib/screenerColdPayload.js";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "research/screener-cold-payload-1");
fs.mkdirSync(OUT, { recursive: true });

const TOTAL = 3574;
const WAVE5_JSON_MB = 20.5;
const MESA_LIGHT_MIX_MB = 13.26;

function lightRow(i, { narrative = false } = {}) {
  const row = {
    symbol: `L${i}`,
    companyName: `Light ${i}`,
    country: "US",
    sector: "Technology",
    industry: "Software - Application",
    theme: "Software",
    price: 10 + (i % 50),
    chartBarsCount: 260,
    marketCap: 1e9 + i * 1e6,
    weinsteinScore: 40 + (i % 40),
    minerviniScore: 35 + (i % 40),
    rsRating: 50 + (i % 40),
    weeklyStageState: `stage${(i % 4) + 1}`,
    weeklyStageLabel: `Etapa ${(i % 4) + 1}`,
    weeklyStageStructure: "e2",
    weeklyStageStructureLabel: "Con fuga",
    weeklyStageStructureDetail: "Detalle estructural corto",
    perf3m: (i % 20) - 5,
    perf6m: (i % 30) - 8,
    perf12m: (i % 40) - 10,
    distance52w: -((i % 25)),
    screenPassed: false,
    rowProjection: "light",
    screenRejectField: "requireStage2",
    screenRejectReason: "No cumple Stage 2",
    setupDisplayLabel: "Observar",
    setupDisplayShortLabel: "Obs",
    setupDisplayReason: narrative ? `Reason for L${i}. `.repeat(12) : "",
    setupDisplayConfidenceLabel: narrative ? "Alta confianza operativa" : "",
    setupVerdictShortLabel: narrative ? "VCP estricto" : "",
    methodologyReliabilityState: "ok",
    contractionStructureStatus: "valid",
    setupDisplayEvidence: narrative ? `Evidence ${i}. `.repeat(12) : "",
    setupDisplayLine: narrative ? `Line ${i}. `.repeat(10) : "",
    weeklyBreakoutVolDetail: narrative ? `Breakout ${i}. `.repeat(10) : "",
    methodologyReliabilityReason: narrative ? `Reliability ${i}. `.repeat(10) : "",
    contractionStructureReason: narrative ? `Structure ${i}. `.repeat(10) : "",
  };
  for (const key of SCAN_LIGHT_FIELDS) {
    if (row[key] != null || key === "chartPreview") continue;
    if (/Score|Pct|Ratio|Cap|Volume|price|sma|perf|distance|weeks|Rank|Sample|Age|Close|Bars|Count|Depth|Move|Range|Drawdown|Turnover|Surge|Tight|Advance|Resistance|Rng|Dist/i.test(key)) {
      row[key] = Number((Math.sin(i + key.length) * 40 + 50).toFixed(4));
    } else if (/Available|Ok|Eligible|Decreasing|Candidate|Ruptura|HhHl|Actionable|Watch|Strict|Observable|PlanValid|TradePlan|Blocks|DataLimited|Above/.test(key)) {
      row[key] = i % 2 === 0;
    }
  }
  return row;
}

function fullRow(i) {
  return {
    ...lightRow(i, { narrative: true }),
    symbol: `F${i}`,
    companyName: `Full ${i}`,
    screenPassed: true,
    rowProjection: "full",
    screenRejectField: null,
    screenRejectReason: null,
    growthMetrics: {
      revenueGrowth: 0.12,
      nested: { statements: Array.from({ length: 20 }, () => "stmt".repeat(40)) },
    },
    objectiveMetricAudit: {
      items: Array.from({ length: 24 }, (_, k) => ({
        key: `m${k}`,
        status: k % 5 === 0 ? "mismatch" : "verified",
        label: `Metric ${k}`,
        value: k,
      })),
    },
    decisionTrace: { engineVersion: "decision-trace-v9", brief: "brief ".repeat(200) },
    businessSummary: "Business summary text. ".repeat(120),
  };
}

function measureScenario(rows) {
  const deferred = rows.map(stripChartPreviewForTransport);
  const projected = deferred.map((row) => projectScanRowForMesaTransport(row, { omitChartPreview: true }));
  const beforeBytes = measureRowsJsonBytes(deferred);
  const afterBytes = measureRowsJsonBytes(projected);
  const json = JSON.stringify(projected);
  return {
    beforeBytes,
    afterBytes,
    savedBytes: beforeBytes - afterBytes,
    savedPct: Number((((beforeBytes - afterBytes) / beforeBytes) * 100).toFixed(2)),
    beforeMb: Number((beforeBytes / 1e6).toFixed(2)),
    afterMb: Number((afterBytes / 1e6).toFixed(2)),
    gzipAfter: zlib.gzipSync(json, { level: 6 }).length,
    topFieldsAfter: topProjectedFieldWeights(projected, 8).map(({ field, bytes }) => ({
      field,
      mb: Number((bytes / 1e6).toFixed(3)),
    })),
  };
}

const mix80Full = [
  ...Array.from({ length: 80 }, (_, i) => fullRow(i)),
  ...Array.from({ length: TOTAL - 80 }, (_, i) => lightRow(i + 80, { narrative: true })),
];

const fatNarrative = Array.from({ length: TOTAL }, (_, i) => lightRow(i, { narrative: true }));
const scenario = measureScenario(mix80Full);
const fatScenario = measureScenario(fatNarrative);

const head = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();

const summary = {
  ticket: "SCREENER-COLD-PAYLOAD-1",
  at: new Date().toISOString(),
  head,
  method: "synthetic · deferred → projectScanRowForMesaTransport (mix80 + fat narrative)",
  prior: {
    wave5DeferredJsonMb: WAVE5_JSON_MB,
    mesaLightWireMixMb: MESA_LIGHT_MIX_MB,
    source: "research/wave5-remeasure-2026-09-14 + research/scans-mesa-light-wire-1",
  },
  omitFields: MESA_TRANSPORT_OMIT_FIELDS,
  scenarios: {
    mix80FullFatNarrative: scenario,
    allLightFatNarrative: fatScenario,
  },
  deltasVsWave5: {
    mix80ProjectedMb: scenario.afterMb,
    savedVsWave5Mb: Number((WAVE5_JSON_MB - scenario.afterMb).toFixed(2)),
    savedVsWave5Pct: Number((((WAVE5_JSON_MB - scenario.afterMb) / WAVE5_JSON_MB) * 100).toFixed(1)),
    fatNarrativeAfterMb: fatScenario.afterMb,
    setupDisplayReasonTopFieldMb: fatScenario.topFieldsAfter.find((f) => f.field === "setupDisplayReason")?.mb ?? null,
  },
  verdict: {
    lever: "MESA_TRANSPORT_OMIT ampliado: setupDisplayReason + confidence + verdictShortLabel",
    note: "Sin Mini/DB. mix80 ≈ universo US con ~80 filas full; fat = techo narrativa poblada.",
  },
};

fs.writeFileSync(path.join(OUT, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
