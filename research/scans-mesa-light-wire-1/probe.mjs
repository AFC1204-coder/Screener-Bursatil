#!/usr/bin/env node
/**
 * SCANS-MESA-LIGHT-WIRE-1 — ahorro JSON cold parse (synthetic, sin Mini).
 *
 * 1) Mix US ~3574: light + N full gordas (allowlist).
 * 2) Light realistas con narrativa display-only (MESA_TRANSPORT_OMIT).
 *
 *   node --loader ./scripts/loader.mjs research/scans-mesa-light-wire-1/probe.mjs
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {
  MESA_TRANSPORT_OMIT_FIELDS,
  projectScanRowForMesaTransport,
  SCAN_LIGHT_FIELDS,
} from "@/lib/scanLightProjection.js";
import { stripChartPreviewForTransport } from "@/lib/scansChartPreviewTransport.js";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "research/scans-mesa-light-wire-1");
fs.mkdirSync(OUT, { recursive: true });

const TOTAL = 3574;

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
    setupDisplayReason: "Sin plan operable en este valor",
    methodologyReliabilityState: "ok",
    contractionStructureStatus: "valid",
    setupDisplayEvidence: "",
    setupDisplayLine: "",
    weeklyBreakoutVolDetail: "",
    methodologyReliabilityReason: "",
    contractionStructureReason: "",
  };
  if (narrative) {
    row.setupDisplayEvidence = `Evidence for ${row.symbol}. `.repeat(12);
    row.setupDisplayLine = `Line for ${row.symbol}. `.repeat(10);
    row.weeklyBreakoutVolDetail = `Breakout vol detail ${row.symbol}. `.repeat(10);
    row.methodologyReliabilityReason = `Reliability ${row.symbol}. `.repeat(10);
    row.contractionStructureReason = `Structure ${row.symbol}. `.repeat(10);
  }
  // Rellenar escalares restantes del allowlist (aprox. peso light real).
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
    chartPreview: Array.from({ length: 48 }, (_, k) => ({
      date: `2026-01-${String((k % 28) + 1).padStart(2, "0")}`,
      close: 10 + k * 0.1,
      sma50: 9 + k * 0.05,
      sma200: 8 + k * 0.02,
      volume: 1000 + k,
    })),
    growthMetrics: {
      revenueGrowth: 0.12,
      nested: { statements: Array.from({ length: 20 }, () => "stmt".repeat(40)) },
    },
    signalCoverage: { coverage: 0.9, detail: "sig".repeat(800) },
    businessSummary: "Business summary text. ".repeat(120),
    measuredContractionSwings: Array.from({ length: 30 }, (_, k) => ({ k, depth: k * 0.15 })),
    ratingModel: { version: 3, weights: Array.from({ length: 60 }, (_, k) => k * 0.01) },
    objectiveMetricAudit: {
      items: Array.from({ length: 24 }, (_, k) => ({
        key: `m${k}`,
        status: k % 5 === 0 ? "mismatch" : "verified",
        label: `Metric ${k}`,
        value: k,
        expected: k + 1,
        source: "bars",
        formula: "close/sma",
      })),
    },
    decisionTrace: { engineVersion: "decision-trace-v9", brief: "brief ".repeat(200) },
  };
}

function measure(rows) {
  const deferred = rows.map(stripChartPreviewForTransport);
  const projected = deferred.map((row) => projectScanRowForMesaTransport(row, { omitChartPreview: true }));
  const beforeJson = JSON.stringify(deferred);
  const afterJson = JSON.stringify(projected);
  return {
    beforeBytes: beforeJson.length,
    afterBytes: afterJson.length,
    savedBytes: beforeJson.length - afterJson.length,
    savedPct: Number((((beforeJson.length - afterJson.length) / beforeJson.length) * 100).toFixed(2)),
    beforeMb: Number((beforeJson.length / 1e6).toFixed(2)),
    afterMb: Number((afterJson.length / 1e6).toFixed(2)),
    gzipBefore: zlib.gzipSync(beforeJson, { level: 6 }).length,
    gzipAfter: zlib.gzipSync(afterJson, { level: 6 }).length,
  };
}

const allLightEmptyNarrative = Array.from({ length: TOTAL }, (_, i) => lightRow(i, { narrative: false }));
const allLightFatNarrative = Array.from({ length: TOTAL }, (_, i) => lightRow(i, { narrative: true }));
const mix80Full = [
  ...Array.from({ length: 80 }, (_, i) => fullRow(i)),
  ...Array.from({ length: TOTAL - 80 }, (_, i) => lightRow(i + 80, { narrative: true })),
];

const summary = {
  ticket: "SCANS-MESA-LIGHT-WIRE-1",
  at: new Date().toISOString(),
  method: "synthetic · strip chartPreview then projectScanRowForMesaTransport",
  totalRows: TOTAL,
  wave5ResidualJsonMb: 20.5,
  omitFields: MESA_TRANSPORT_OMIT_FIELDS,
  scenarios: {
    lightEmptyNarrative: measure(allLightEmptyNarrative),
    lightFatNarrative: measure(allLightFatNarrative),
    mix80FullFatNarrative: measure(mix80Full),
  },
  note: "Sin Mini/DB. lightEmpty ≈ omit strings vacíos; lightFat/mix ≈ techo si la narrativa viene poblada.",
};

fs.writeFileSync(path.join(OUT, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
