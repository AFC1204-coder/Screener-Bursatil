#!/usr/bin/env node
// SCANS-PAYLOAD-1 — medición read-only. No toca producto.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { performance } from "node:perf_hooks";
import pg from "pg";
import {
  SCAN_LIGHT_FIELDS,
  SCAN_LIGHT_EXCLUDED_FIELDS,
  scanLightMetrics,
} from "@/lib/scanLightProjection.js";
import { compactResearchRow } from "@/lib/researchRowContract.js";
import { DISTANCE_RULES, FIELD_RULES } from "@/lib/screenerFilterCatalog.js";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "research/scans-payload-1");
const APP = "http://127.0.0.1:3300";
fs.mkdirSync(OUT_DIR, { recursive: true });

function readEnvLocal() {
  const env = {};
  const text = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
  }
  return env;
}

function bytes(value) {
  if (value === undefined) return 0;
  return Buffer.byteLength(JSON.stringify(value));
}

function present(value) {
  return value !== undefined && value !== null;
}

function gzipBytes(buf) {
  return zlib.gzipSync(buf, { level: 6 }).length;
}

function classifyType(value) {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

const FILTER_METRICS = new Set([
  ...Object.values(FIELD_RULES).map((r) => r.metric),
  ...Object.values(DISTANCE_RULES).map((r) => r.metric),
  "priceFreshnessDays", "lastDate",
  "weeklyRsAvailable", "weeklyRsRating",
  "weeklyCountryRsAvailable", "weeklyCountryRsRating",
  "weeklyThemeRsAvailable", "weeklyThemeRsRating",
  "weaknessScore", "ipoAgeMonths", "ipoDate",
  "weeksAboveSma30w", "weeksAboveSma30wAbove",
  "weeklyStageState", "weeklyStageLabel", "weeklyFastWeeks", "weeklySlowWeeks",
  "sma50", "sma150", "sma200", "sma200Slope", "upVolume", "contractionsDecreasing",
  "vcpCandidate", "patternDataStatus", "patternEligible", "patternVolumeEligible",
  "contractionStructureStatus", "methodologyReliabilityState",
  "setupDisplayDataLimited", "setupDisplayBlocksPatternClaim", "methodologyBlocksPatternClaim",
  "totalScore", "rsGlobalPct", "ipoScore", "distanceToPivotPct", "pivotPrice",
  "chartBarsCount", "price", "rowProjection", "screenPassed",
  "weeklyStageStructure",
]);

const SORT_FIELDS = new Set([
  "rsGlobalPct", "weeklyCountryRsRating", "weeklyThemeRsRating", "contractionCount",
  "perf3m", "perf6m", "perf12m", "distance52w", "marketCap", "weaknessScore",
  "ipoDate", "ipoDesdeSalidaPct", "totalScore", "objectiveScore", "weinsteinScore",
  "minerviniScore", "ipoScore", "price", "extSma50", "rsQualityScore",
]);

const TABLE_DISPLAY = new Set([
  "symbol", "companyName", "country", "chartPreview", "theme", "website", "logoDomain",
  "weeklyStageState", "weeklyStageLabel", "weeklyStageStructure", "weeklyStageStructureLabel",
  "weeklyStageConfirmation", "distance52w", "marketCap", "contractionCount",
  "distanceToPivotPct", "vcpCandidate", "metricAuditFlags",
  "weeklyRsAvailable", "weeklyRsRating", "weeklyRsAsOf", "weeklyRsWeekKey",
  "weeklyRsRank", "weeklyRsSampleSize", "weeklyRsEngineVersion", "weeklyRsReason",
  "weeklyCountryRsAvailable", "weeklyCountryRsRating", "weeklyCountryRsRank",
  "weeklyCountryRsSampleSize", "weeklyCountryRsWeekKey", "weeklyCountryRsReason",
  "weeklyThemeRsAvailable", "weeklyThemeRsRating",
  "perf3m", "perf6m", "perf12m", "ipoDate", "ipoAnchorClose", "ipoAnchorDate",
  "weaknessLabel", "priceFreshnessOk",
]);

const REVIEW_FIELDS = new Set([
  ...SCAN_LIGHT_FIELDS,
  "decisionTrace", "objectiveMetricAudit", "setupDisplayEvidence", "setupDisplayLine",
  "setupDisplayReason", "setupVerdictEvidence", "setupStructureEvidence",
  "compositeReasons", "compositeRisks", "weaknessReasons", "weaknessLabel",
  "patternIssues", "businessSummary", "businessEs", "exchange", "currency",
  "growthMetrics", "chartEstimated",
]);

const STOCK_ONLY = new Set([
  "growthMetrics", "businessSummary", "businessEs", "financials", "incomeStatement",
  "balanceSheet", "cashFlow", "news", "officers", "employees", "sharesOutstanding",
  "floatShares", "sharesShort", "shortRatio", "sharesPercentSharesOut",
  "rsGlobalSample", "rsCountrySample", "rsSectorSample",
]);

function consumerFlags(field) {
  const filter = FILTER_METRICS.has(field);
  const sort = SORT_FIELDS.has(field);
  const table = TABLE_DISPLAY.has(field);
  const light = SCAN_LIGHT_FIELDS.includes(field);
  const excluded = SCAN_LIGHT_EXCLUDED_FIELDS.includes(field);
  const stock = STOCK_ONLY.has(field);
  const review = REVIEW_FIELDS.has(field) && !filter && !sort && !table;
  let candidate = "no";
  if (excluded) candidate = "yes-already-excluded-from-light";
  else if (stock && !filter && !sort && !table) candidate = "yes-stock-refetch";
  else if (!filter && !sort && !table && !light) candidate = "yes-not-in-screener-contract";
  else if (!filter && !sort && table && field === "chartPreview") candidate = "defer-display-only";
  else if (!filter && !sort && !table && light) candidate = "maybe-review-copy";
  return {
    filterRequired: filter,
    sortRequired: sort,
    tableDisplay: table,
    reviewRequired: review || (light && !filter && !sort && !table),
    stockOnly: stock && !filter && !sort,
    inLight: light,
    candidateToOmit: candidate,
  };
}

function fieldStats(rows) {
  const n = rows.length;
  const stats = new Map();
  const bump = (field, value) => {
    let rec = stats.get(field);
    if (!rec) {
      rec = { field, present: 0, bytes: 0, types: {}, maxBytes: 0, example: null };
      stats.set(field, rec);
    }
    if (!present(value)) return;
    rec.present += 1;
    const b = bytes(value);
    rec.bytes += b;
    if (b > rec.maxBytes) {
      rec.maxBytes = b;
      rec.example = typeof value === "object" ? typeShape(value) : String(value).slice(0, 80);
    }
    const t = classifyType(value);
    rec.types[t] = (rec.types[t] || 0) + 1;
  };
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    for (const [k, v] of Object.entries(row)) bump(k, v);
  }
  return [...stats.values()]
    .map((rec) => ({
      ...rec,
      presencePct: n ? +(100 * rec.present / n).toFixed(2) : 0,
      avgBytesPresent: rec.present ? Math.round(rec.bytes / rec.present) : 0,
      avgBytesAll: n ? Math.round(rec.bytes / n) : 0,
      ...consumerFlags(rec.field),
    }))
    .sort((a, b) => b.bytes - a.bytes);
}

function typeShape(value) {
  if (Array.isArray(value)) {
    const first = value[0];
    const keys = first && typeof first === "object" ? Object.keys(first).slice(0, 12).join(",") : typeof first;
    return `array(len=${value.length}, item=${keys})`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value);
    return `object(keys=${keys.length}: ${keys.slice(0, 10).join(",")})`;
  }
  return typeof value;
}

function simulateLight(rows) {
  const out = [];
  for (const row of rows) {
    const light = scanLightMetrics(row);
    delete light.screenPassed;
    delete light.rowProjection;
    delete light.screenRejectField;
    delete light.screenRejectReason;
    for (const key of ["screenPassed", "rowProjection", "screenRejectField", "screenRejectReason", "exchange", "currency", "theme", "metricAuditFlags", "chartBarsCount"]) {
      if (present(row[key])) light[key] = row[key];
    }
    out.push(light);
  }
  return out;
}

function simulateLightNoSpark(rows) {
  return simulateLight(rows).map((row) => {
    const copy = { ...row };
    delete copy.chartPreview;
    return copy;
  });
}

async function fetchTimed(url, { token, acceptEncoding, timeoutMs = 180000 } = {}) {
  const headers = { "x-statsedge-token": token };
  if (acceptEncoding) headers["Accept-Encoding"] = acceptEncoding;
  const started = performance.now();
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  const ttfb = performance.now() - started;
  const encoding = res.headers.get("content-encoding");
  const contentType = res.headers.get("content-type");
  const contentLength = res.headers.get("content-length");
  const buf = Buffer.from(await res.arrayBuffer());
  const total = performance.now() - started;
  return {
    url,
    status: res.status,
    encoding,
    contentType,
    contentLength: contentLength ? Number(contentLength) : null,
    bodyBytes: buf.length,
    gzipEstimate: gzipBytes(buf),
    ttfbMs: Math.round(ttfb),
    totalMs: Math.round(total),
    transferAfterTtfbMs: Math.round(total - ttfb),
    buf,
    headerDump: Object.fromEntries([...res.headers.entries()].filter(([k]) => /content|encoding|cache|vary|etag/i.test(k))),
  };
}

async function parseTimed(buf) {
  const text = buf.toString("utf8");
  const t0 = performance.now();
  const json = JSON.parse(text);
  const parseMs = performance.now() - t0;
  const t1 = performance.now();
  JSON.stringify(json);
  const stringifyMs = performance.now() - t1;
  return { json, parseMs: +parseMs.toFixed(1), stringifyMs: +stringifyMs.toFixed(1), textBytes: buf.length };
}

const env = readEnvLocal();
if (!env.DATABASE_URL) throw new Error("DATABASE_URL missing");
if (!env.STATSEDGE_ACCESS_TOKEN) throw new Error("STATSEDGE_ACCESS_TOKEN missing");

const client = new pg.Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 8000 });
await client.connect();

const report = {
  measuredAt: new Date().toISOString(),
  gitHead: fs.existsSync(path.join(ROOT, ".git/HEAD")) ? fs.readFileSync(path.join(ROOT, ".git/HEAD"), "utf8").trim() : null,
  buildId: fs.existsSync(path.join(ROOT, ".next/BUILD_ID")) ? fs.readFileSync(path.join(ROOT, ".next/BUILD_ID"), "utf8").trim() : null,
  app: APP,
};

const scanQ = await client.query(`
  SELECT id, local_id, row_count, created_at, preset, name,
         pg_column_size(settings) AS settings_bytes
  FROM scans
  WHERE owner_id = 'personal'
    AND deleted_at IS NULL
    AND local_id LIKE 'materialized:US:%'
  ORDER BY created_at DESC
  LIMIT 3
`);
report.latestUsScans = scanQ.rows;
const scan = scanQ.rows[0];
if (!scan) throw new Error("No materialized US scan");
report.scan = scan;

const sizeQ = await client.query(`
  SELECT
    count(*)::int AS rows,
    count(*) FILTER (WHERE coalesce(metrics->>'rowProjection','') = 'light')::int AS light_rows,
    count(*) FILTER (WHERE coalesce(metrics->>'rowProjection','') = 'full')::int AS full_rows,
    count(*) FILTER (WHERE coalesce(metrics->>'screenPassed','') = 'true')::int AS screen_passed,
    coalesce(sum(pg_column_size(metrics)),0)::bigint AS metrics_bytes,
    coalesce(sum(pg_column_size(raw)),0)::bigint AS raw_bytes,
    coalesce(sum(pg_column_size(metrics) + pg_column_size(raw)),0)::bigint AS jsonb_bytes,
    coalesce(avg(pg_column_size(metrics)),0)::int AS avg_metrics,
    coalesce(avg(pg_column_size(raw)),0)::int AS avg_raw,
    coalesce(avg(pg_column_size(metrics)) FILTER (WHERE coalesce(metrics->>'rowProjection','') = 'light'),0)::int AS avg_metrics_light,
    coalesce(avg(pg_column_size(raw)) FILTER (WHERE coalesce(metrics->>'rowProjection','') = 'light'),0)::int AS avg_raw_light,
    coalesce(avg(pg_column_size(metrics)) FILTER (WHERE coalesce(metrics->>'rowProjection','') = 'full'),0)::int AS avg_metrics_full,
    coalesce(avg(pg_column_size(raw)) FILTER (WHERE coalesce(metrics->>'rowProjection','') = 'full'),0)::int AS avg_raw_full,
    coalesce(max(pg_column_size(metrics)),0)::int AS max_metrics,
    coalesce(max(pg_column_size(raw)),0)::int AS max_raw
  FROM scan_results
  WHERE scan_id = $1
`, [scan.id]);
report.dbSizes = sizeQ.rows[0];

const fatKeysQ = await client.query(`
  WITH sample AS (
    SELECT metrics, raw, coalesce(metrics->>'rowProjection','?') AS proj
    FROM scan_results
    WHERE scan_id = $1
  )
  SELECT proj,
    count(*)::int AS n,
    coalesce(avg(pg_column_size(metrics->'chartPreview')),0)::int AS avg_chart_preview,
    coalesce(avg(pg_column_size(metrics->'decisionTrace')),0)::int AS avg_decision_trace,
    coalesce(avg(pg_column_size(metrics->'objectiveMetricAudit')),0)::int AS avg_objective_audit,
    coalesce(avg(pg_column_size(metrics->'growthMetrics')),0)::int AS avg_growth_metrics,
    coalesce(avg(pg_column_size(metrics->'setupDisplayEvidence')),0)::int AS avg_setup_evidence,
    coalesce(avg(pg_column_size(metrics->'setupDisplayLine')),0)::int AS avg_setup_line,
    coalesce(avg(pg_column_size(raw->'chartPreview')),0)::int AS avg_raw_chart_preview,
    coalesce(avg(pg_column_size(raw->'growthMetrics')),0)::int AS avg_raw_growth,
    coalesce(avg(pg_column_size(raw->'decisionTrace')),0)::int AS avg_raw_trace,
    count(*) FILTER (WHERE metrics ? 'decisionTrace')::int AS metrics_has_trace,
    count(*) FILTER (WHERE metrics ? 'objectiveMetricAudit')::int AS metrics_has_audit,
    count(*) FILTER (WHERE metrics ? 'chartPreview')::int AS metrics_has_preview,
    count(*) FILTER (WHERE raw <> '{}'::jsonb)::int AS raw_nonempty
  FROM sample
  GROUP BY proj
  ORDER BY proj
`, [scan.id]);
report.dbFatKeys = fatKeysQ.rows;

const tPg0 = performance.now();
const pages = await Promise.all([0, 1, 2, 3].map((i) => client.query({
  text: `
    SELECT scan_id, rank_index, raw, symbol, company_name, country, sector, industry, theme,
           total_score, weinstein_score, minervini_score, risk_score, rs_rating, metrics
    FROM scan_results
    WHERE owner_id = 'personal' AND scan_id = $1
    ORDER BY rank_index ASC
    LIMIT 1000 OFFSET $2
  `,
  values: [scan.id, i * 1000],
})));
const pgReadMs = performance.now() - tPg0;
const dbRows = pages.flatMap((p) => p.rows);
const tSer0 = performance.now();
const dbJson = JSON.stringify(dbRows);
const dbSerializeMs = performance.now() - tSer0;
report.pgSelect = {
  rows: dbRows.length,
  pageRowCounts: pages.map((p) => p.rows.length),
  parallel4x1000Ms: +pgReadMs.toFixed(1),
  stringifyMs: +dbSerializeMs.toFixed(1),
  jsonBytes: Buffer.byteLength(dbJson),
  gzipBytes: gzipBytes(Buffer.from(dbJson)),
};

const explain = await client.query(`
  EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
  SELECT scan_id, rank_index, raw, symbol, company_name, country, sector, industry, theme,
         total_score, weinstein_score, minervini_score, risk_score, rs_rating, metrics
  FROM scan_results
  WHERE owner_id = 'personal' AND scan_id = $1
  ORDER BY rank_index ASC
  LIMIT 1000 OFFSET 0
`, [scan.id]);
report.explainFirstPage = explain.rows[0]["QUERY PLAN"]?.[0]?.["Execution Time"]
  ?? explain.rows[0];

const sampleLight = dbRows.find((r) => r.metrics?.rowProjection === "light");
const sampleFull = dbRows.find((r) => r.metrics?.rowProjection === "full");
report.sampleLightKeys = sampleLight ? {
  symbol: sampleLight.symbol,
  metricsKeyCount: Object.keys(sampleLight.metrics || {}).length,
  rawKeyCount: Object.keys(sampleLight.raw || {}).length,
  metricsBytes: bytes(sampleLight.metrics),
  rawBytes: bytes(sampleLight.raw),
  topMetrics: fieldStats([sampleLight.metrics]).slice(0, 15),
} : null;
report.sampleFullKeys = sampleFull ? {
  symbol: sampleFull.symbol,
  metricsKeyCount: Object.keys(sampleFull.metrics || {}).length,
  rawKeyCount: Object.keys(sampleFull.raw || {}).length,
  metricsBytes: bytes(sampleFull.metrics),
  rawBytes: bytes(sampleFull.raw),
  topMetrics: fieldStats([sampleFull.metrics]).slice(0, 20),
  topRaw: fieldStats([sampleFull.raw]).slice(0, 20),
  hasTrace: Boolean(sampleFull.metrics?.decisionTrace),
  hasAudit: Boolean(sampleFull.metrics?.objectiveMetricAudit),
} : null;

await client.end();

const token = env.STATSEDGE_ACCESS_TOKEN;
const productPath = `/api/scans?includeRows=1&limit=1&rowsLimit=6000&anchor=nightly-us&hydrateRs=1`;
const coldCompactPath = `/api/scans?includeRows=1&limit=1&rowsLimit=5999&anchor=nightly-us&hydrateRs=1`;
const coldCorePath = `/api/scans?includeRows=1&limit=1&rowsLimit=5998&anchor=nightly-us`;
const decisionPath = `/api/scans?includeRows=1&limit=1&rowsLimit=5997&anchor=nightly-us&hydrateRs=1&projection=decision`;
const fullPath = `/api/scans?includeRows=1&limit=1&rowsLimit=5996&anchor=nightly-us&hydrateRs=1&full=1`;

console.log("HTTP identity (no Accept-Encoding) cold compact...");
const identity = await fetchTimed(`${APP}${coldCompactPath}`, { token, acceptEncoding: null });
console.log("  status", identity.status, "bytes", identity.bodyBytes, "enc", identity.encoding, "ms", identity.totalMs);

console.log("HTTP gzip Accept-Encoding cold compact clone...");
const gzipReq = await fetchTimed(`${APP}${coldCompactPath}`, { token, acceptEncoding: "gzip, deflate, br" });
console.log("  status", gzipReq.status, "bytes", gzipReq.bodyBytes, "enc", gzipReq.encoding, "ms", gzipReq.totalMs, "headers", gzipReq.headerDump);

console.log("HTTP product URL (may be cached) 6000...");
const product = await fetchTimed(`${APP}${productPath}`, { token, acceptEncoding: "gzip, deflate, br" });
console.log("  status", product.status, "bytes", product.bodyBytes, "enc", product.encoding, "ms", product.totalMs);

console.log("HTTP compact core (no hydrateRs)...");
const core = await fetchTimed(`${APP}${coldCorePath}`, { token, acceptEncoding: "gzip, deflate, br" });
console.log("  status", core.status, "bytes", core.bodyBytes, "enc", core.encoding, "ms", core.totalMs);

console.log("HTTP decision...");
const decision = await fetchTimed(`${APP}${decisionPath}`, { token, acceptEncoding: "gzip, deflate, br" });
console.log("  status", decision.status, "bytes", decision.bodyBytes, "enc", decision.encoding, "ms", decision.totalMs);

console.log("HTTP full...");
let full = null;
try {
  full = await fetchTimed(`${APP}${fullPath}`, { token, acceptEncoding: "gzip, deflate, br", timeoutMs: 240000 });
  console.log("  status", full.status, "bytes", full.bodyBytes, "enc", full.encoding, "ms", full.totalMs);
} catch (error) {
  full = { error: String(error?.message || error) };
  console.log("  FAIL", full.error);
}

function slimHttp(result) {
  if (!result || result.error) return result;
  const { buf, ...rest } = result;
  return rest;
}

const compactParsed = await parseTimed(identity.buf);
const compactScan = compactParsed.json?.scans?.[0] || {};
const compactRows = Array.isArray(compactScan.rows) ? compactScan.rows : [];
const compactEnvelopeBytes = bytes({ ...compactParsed.json, scans: compactParsed.json.scans?.map((s) => ({ ...s, rows: [] })) });

const decisionParsed = decision.status === 200 ? await parseTimed(decision.buf) : null;
const decisionRows = decisionParsed?.json?.scans?.[0]?.rows || [];
const coreParsed = core.status === 200 ? await parseTimed(core.buf) : null;
const coreRows = coreParsed?.json?.scans?.[0]?.rows || [];
const fullParsed = full && full.status === 200 ? await parseTimed(full.buf) : null;
const fullRows = fullParsed?.json?.scans?.[0]?.rows || [];

const compactFieldStats = fieldStats(compactRows);
const lightSim = simulateLight(compactRows);
const lightSimJson = JSON.stringify({ ...compactParsed.json, scans: [{ ...compactScan, rows: lightSim }] });
const noSpark = simulateLightNoSpark(compactRows);
const noSparkJson = JSON.stringify({ ...compactParsed.json, scans: [{ ...compactScan, rows: noSpark }] });

const passed = compactRows.filter((r) => r.screenPassed === true);
const lights = compactRows.filter((r) => r.rowProjection === "light" || r.screenPassed === false);

function rowBytes(rows) {
  return rows.reduce((sum, row) => sum + bytes(row), 0);
}

const compactHas = {
  decisionTrace: compactRows.filter((r) => r.decisionTrace).length,
  objectiveMetricAudit: compactRows.filter((r) => r.objectiveMetricAudit).length,
  growthMetrics: compactRows.filter((r) => r.growthMetrics).length,
  chartPreview: compactRows.filter((r) => Array.isArray(r.chartPreview)).length,
  setupDisplayEvidence: compactRows.filter((r) => r.setupDisplayEvidence).length,
};

report.http = {
  identityNoAcceptEncoding: slimHttp(identity),
  gzipAcceptEncoding: slimHttp(gzipReq),
  productMaybeCached: slimHttp(product),
  compactCoreNoHydrateRs: slimHttp(core),
  decision: slimHttp(decision),
  full: slimHttp(full),
};
report.parse = {
  compact: { parseMs: compactParsed.parseMs, stringifyMs: compactParsed.stringifyMs, rows: compactRows.length, projection: compactParsed.json?.projection, rsHydration: compactParsed.json?.rsHydration },
  core: coreParsed ? { parseMs: coreParsed.parseMs, stringifyMs: coreParsed.stringifyMs, rows: coreRows.length, projection: coreParsed.json?.projection, rsHydration: coreParsed.json?.rsHydration } : null,
  decision: decisionParsed ? { parseMs: decisionParsed.parseMs, stringifyMs: decisionParsed.stringifyMs, rows: decisionRows.length, projection: decisionParsed.json?.projection, rsHydration: decisionParsed.json?.rsHydration } : null,
  full: fullParsed ? { parseMs: fullParsed.parseMs, stringifyMs: fullParsed.stringifyMs, rows: fullRows.length, projection: fullParsed.json?.projection, rsHydration: fullParsed.json?.rsHydration } : null,
};
report.payloadAnatomy = {
  envelopeBytes: compactEnvelopeBytes,
  allRowsBytes: rowBytes(compactRows),
  passedCount: passed.length,
  lightCount: lights.length,
  passedBytes: rowBytes(passed),
  lightBytes: rowBytes(lights),
  avgPassed: passed.length ? Math.round(rowBytes(passed) / passed.length) : 0,
  avgLight: lights.length ? Math.round(rowBytes(lights) / lights.length) : 0,
  compactHas,
  scanMeta: {
    localId: compactScan.id || compactScan.local_id,
    rowsAvailable: compactScan.rowsAvailable,
    rowsReturned: compactScan.rowsReturned,
    rowsTruncated: compactScan.rowsTruncated,
    nightly: compactParsed.json?.nightly || null,
  },
};
report.projectionCompare = {
  compactBytes: identity.bodyBytes,
  compactGzipEst: identity.gzipEstimate,
  coreBytes: core.bodyBytes,
  coreGzipEst: core.gzipEstimate,
  decisionBytes: decision.bodyBytes,
  decisionGzipEst: decision.gzipEstimate,
  fullBytes: full?.bodyBytes ?? null,
  fullGzipEst: full?.gzipEstimate ?? null,
  existingLightAppliedToAllRowsBytes: Buffer.byteLength(lightSimJson),
  existingLightAppliedGzipEst: gzipBytes(Buffer.from(lightSimJson)),
  existingLightMinusChartPreviewBytes: Buffer.byteLength(noSparkJson),
  existingLightMinusChartPreviewGzipEst: gzipBytes(Buffer.from(noSparkJson)),
};
report.topFields = compactFieldStats.slice(0, 80);
report.allFields = compactFieldStats;
report.decisionVsCompact = {
  extraInCompactNotDecision: decisionRows.length && compactRows.length
    ? [...new Set(compactRows.flatMap((r) => Object.keys(r)))].filter((k) => !decisionRows.some((r) => k in r)).slice(0, 50)
    : null,
  compactAvgKeys: compactRows.length ? Math.round(compactRows.reduce((s, r) => s + Object.keys(r).length, 0) / compactRows.length) : 0,
  decisionAvgKeys: decisionRows.length ? Math.round(decisionRows.reduce((s, r) => s + Object.keys(r).length, 0) / decisionRows.length) : 0,
  decisionHasTrace: decisionRows.filter((r) => r.decisionTrace).length,
  compactHasTrace: compactHas.decisionTrace,
};

fs.writeFileSync(path.join(OUT_DIR, "summary.json"), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(OUT_DIR, "fields.json"), JSON.stringify(compactFieldStats, null, 2));
fs.writeFileSync(path.join(OUT_DIR, "http-headers.json"), JSON.stringify({
  identity: identity.headerDump,
  gzip: gzipReq.headerDump,
  product: product.headerDump,
  decision: decision.headerDump,
  full: full?.headerDump || full,
}, null, 2));

const sampleOut = {
  lightHttp: compactRows.find((r) => r.rowProjection === "light") || lights[0] || null,
  fullHttp: passed[0] || compactRows.find((r) => r.rowProjection === "full") || null,
};
if (sampleOut.lightHttp) {
  fs.writeFileSync(path.join(OUT_DIR, "sample-light-row.json"), JSON.stringify(sampleOut.lightHttp, null, 2));
}
if (sampleOut.fullHttp) {
  fs.writeFileSync(path.join(OUT_DIR, "sample-full-row.json"), JSON.stringify(sampleOut.fullHttp, null, 2));
}

console.log(JSON.stringify({
  scan: scan.local_id,
  db: report.dbSizes,
  pgMs: report.pgSelect.parallel4x1000Ms,
  httpIdentity: { status: identity.status, bytes: identity.bodyBytes, enc: identity.encoding, ms: identity.totalMs, gzipEst: identity.gzipEstimate },
  gzipReq: { status: gzipReq.status, bytes: gzipReq.bodyBytes, enc: gzipReq.encoding, ms: gzipReq.totalMs },
  product: { bytes: product.bodyBytes, enc: product.encoding, ms: product.totalMs },
  core: { bytes: core.bodyBytes, ms: core.totalMs },
  decision: { bytes: decision.bodyBytes, ms: decision.totalMs, enc: decision.encoding },
  full: full?.error || { bytes: full.bodyBytes, ms: full.totalMs },
  rows: compactRows.length,
  passed: passed.length,
  lightSim: report.projectionCompare.existingLightAppliedToAllRowsBytes,
  parseMs: compactParsed.parseMs,
  top5: compactFieldStats.slice(0, 5).map((f) => `${f.field}:${(f.bytes / 1e6).toFixed(2)}MB`),
}, null, 2));
