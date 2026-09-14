#!/usr/bin/env node
/**
 * SCANS-CHARTPREVIEW-1 — baseline peso chartPreview en light US (túnel :15432).
 *
 * Uso:
 *   node --env-file=.env.local --loader ./scripts/loader.mjs research/scans-chartpreview-1/probe.mjs
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import pg from "pg";
import { compactResearchRow } from "@/lib/researchRowContract.js";
import { scanDecisionRowFromDb } from "@/lib/scanDecisionProjection.js";
import { stripChartPreviewForTransport } from "@/lib/scansChartPreviewTransport.js";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "research/scans-chartpreview-1");
fs.mkdirSync(OUT, { recursive: true });

function readEnvLocal() {
  const env = {};
  for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
  }
  return env;
}

function fieldBytes(rows, field) {
  let total = 0;
  for (const row of rows) {
    if (field in row) total += Buffer.byteLength(JSON.stringify(row[field]));
  }
  return total;
}

const env = readEnvLocal();
const dbUrl = env.DATABASE_URL || env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error("Falta DATABASE_URL en .env.local");
  process.exit(1);
}

const client = new pg.Client({ connectionString: dbUrl });
await client.connect();

const { rows: scans } = await client.query(`
  SELECT id, local_id, row_count, created_at
  FROM scans
  WHERE local_id LIKE 'materialized:US:%'
    AND deleted_at IS NULL
  ORDER BY created_at DESC
  LIMIT 1
`);

if (!scans.length) {
  console.error("Sin nocturno US en DB");
  process.exit(1);
}

const scan = scans[0];
const { rows: dbRows } = await client.query(
  `SELECT symbol, raw, metrics, company_name, country, sector, industry, theme,
          total_score, weinstein_score, minervini_score, risk_score, rs_rating,
          scan_id, rank_index
   FROM scan_results
   WHERE scan_id = $1
   ORDER BY rank_index ASC`,
  [scan.id],
);

await client.end();

const compactRows = dbRows.map((item) => {
  const raw = item.raw && typeof item.raw === "object" ? compactResearchRow(item.raw) : {};
  return scanDecisionRowFromDb({ ...item, raw }, {});
});

const deferredRows = compactRows.map(stripChartPreviewForTransport);
const inlineJson = JSON.stringify(compactRows);
const deferredJson = JSON.stringify(deferredRows);
const chartPreviewBytes = fieldBytes(compactRows, "chartPreview");
const savingsPct = ((inlineJson.length - deferredJson.length) / inlineJson.length) * 100;
const chartPreviewPct = (chartPreviewBytes / inlineJson.length) * 100;

const summary = {
  measuredAt: new Date().toISOString(),
  scan: { id: scan.id, localId: scan.local_id, rowCount: scan.row_count, fetchedRows: dbRows.length },
  bytes: {
    inlineJson: inlineJson.length,
    deferredJson: deferredJson.length,
    chartPreviewField: chartPreviewBytes,
    gzipInline: zlib.gzipSync(inlineJson, { level: 6 }).length,
    gzipDeferred: zlib.gzipSync(deferredJson, { level: 6 }).length,
  },
  savings: {
    jsonBytes: inlineJson.length - deferredJson.length,
    jsonPct: Number(savingsPct.toFixed(2)),
    chartPreviewSharePct: Number(chartPreviewPct.toFixed(2)),
  },
  roiThresholdMet: savingsPct >= 25,
  approach: savingsPct >= 25 ? "omit+hydrate" : "diag-only",
};

fs.writeFileSync(path.join(OUT, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
