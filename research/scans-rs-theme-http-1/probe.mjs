#!/usr/bin/env node
/**
 * SCANS-RS-THEME-HTTP-1 — baseline ms + modelo HTTP de readThemeRsForSymbols.
 *
 * Requisitos: túnel :15432 UP, .env.local con DATABASE_URL + Supabase/pg.
 * Uso: node --env-file=.env.local --loader ./scripts/loader.mjs research/scans-rs-theme-http-1/probe.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import pg from "pg";
import { readThemeRsForSymbols } from "@/lib/themeRsHydrate.js";
import { themeRsAssignmentForRow } from "@/lib/themeRs.js";
import { THEME_PROFILE_MISSING, THEME_RESIDUAL } from "@/lib/themeRsAssign.js";
import { themeRsEngineVersion } from "@/lib/rsEngines.js";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "research/scans-rs-theme-http-1");
fs.mkdirSync(OUT, { recursive: true });

const CHUNK_SIZE = 333;
const CONCURRENCY = 6;
const ROWS_PER_SYMBOL_CAP = 3;

function readEnvLocal() {
  const env = {};
  for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
  }
  return env;
}

const env = readEnvLocal();

async function checkTunnel() {
  const { execSync } = await import("node:child_process");
  try {
    execSync("nc -zv 127.0.0.1 15432", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

async function loadNightlySymbols() {
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 2 });
  try {
    const scan = await pool.query(`
      SELECT id, row_count, local_id FROM scans
      WHERE owner_id = $1 AND deleted_at IS NULL
        AND local_id LIKE 'materialized:US:%'
      ORDER BY created_at DESC LIMIT 1
    `, [env.STATSEDGE_OWNER_ID || "personal"]);
    if (!scan.rows[0]) throw new Error("no US materialized scan");
    const rows = await pool.query(`
      SELECT symbol, country, theme, sector, industry
      FROM scan_results
      WHERE scan_id = $1
      ORDER BY rank_index ASC
      LIMIT 8000
    `, [scan.rows[0].id]);
    return {
      scanId: scan.rows[0].id,
      localId: scan.rows[0].local_id,
      rowCount: scan.rows[0].row_count,
      rows: rows.rows,
    };
  } finally {
    await pool.end();
  }
}

function modelChunkHttp(symbols = [], { chunkSize = CHUNK_SIZE } = {}) {
  const chunks = Math.ceil(symbols.length / chunkSize);
  return { symbols: symbols.length, chunks, http: chunks };
}

function themeBulkBeatsChunk(symbolCount, chunkSize) {
  const chunkHttp = Math.ceil(symbolCount / chunkSize);
  const bulkHttp = 1 + Math.max(1, Math.ceil(symbolCount / 1000));
  return bulkHttp < chunkHttp;
}

function modelThemeHttp(rows = [], { chunkSize = CHUNK_SIZE, bulkSnapshot = false, hybrid = false } = {}) {
  const byEngine = new Map();
  let skipped = 0;
  for (const row of rows) {
    const symbol = String(row.symbol || "").trim().toUpperCase();
    const assignment = themeRsAssignmentForRow(row);
    if (assignment.exclusionReason === THEME_PROFILE_MISSING || assignment.exclusionReason === THEME_RESIDUAL) {
      skipped += 1;
      continue;
    }
    const engineVersion = themeRsEngineVersion(assignment.themeKey || row.theme);
    if (!engineVersion) continue;
    const list = byEngine.get(engineVersion) || [];
    list.push(symbol);
    byEngine.set(engineVersion, list);
  }

  const perEngine = [];
  let totalHttp = 0;
  for (const [engineVersion, symbols] of byEngine) {
    const useBulk = bulkSnapshot && (!hybrid || themeBulkBeatsChunk(symbols.length, chunkSize));
    if (useBulk) {
      const head = 1;
      const pages = Math.max(1, Math.ceil(symbols.length / 1000));
      const http = head + pages;
      perEngine.push({ engineVersion, symbols: symbols.length, http, mode: "bulk" });
      totalHttp += http;
    } else {
      const { chunks, http } = modelChunkHttp(symbols, { chunkSize });
      perEngine.push({ engineVersion, symbols: symbols.length, chunks, http, mode: "chunk-in" });
      totalHttp += http;
    }
  }
  return {
    enginesActive: byEngine.size,
    skippedProfileOrResidual: skipped,
    totalHttp,
    perEngine,
    chunkSize,
    concurrency: CONCURRENCY,
    rowsPerSymbolCap: ROWS_PER_SYMBOL_CAP,
    bulkSnapshot,
    hybrid,
  };
}

async function main() {
  const tunnelUp = await checkTunnel();
  const summary = {
    ticket: "SCANS-RS-THEME-HTTP-1",
    at: new Date().toISOString(),
    head: (await import("node:child_process")).execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim(),
    tunnel15432: tunnelUp,
  };

  if (!tunnelUp) {
    summary.error = "tunnel 15432 down";
    summary.priorArt = "research/scans-rs-hydrate-1/probe-summary.json themeFull.ms≈786";
    const outPath = path.join(OUT, "probe-summary.json");
    fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(JSON.stringify(summary, null, 2));
    process.exit(1);
  }

  const loaded = await loadNightlySymbols();
  const { rows } = loaded;
  const symbolList = rows.map((r) => r.symbol).filter(Boolean);
  const themeRows = new Map(rows.map((r) => [String(r.symbol).toUpperCase(), r]));

  summary.symbolCount = rows.length;
  summary.scanLocalId = loaded.localId;
  summary.httpModel = {
    chunkIn80: modelThemeHttp(rows, { chunkSize: 80, bulkSnapshot: false }),
    chunkIn333: modelThemeHttp(rows, { chunkSize: CHUNK_SIZE, bulkSnapshot: false }),
    bulkSnapshot: modelThemeHttp(rows, { bulkSnapshot: true }),
    hybrid: modelThemeHttp(rows, { bulkSnapshot: true, hybrid: true }),
  };

  const t0 = performance.now();
  const result = await readThemeRsForSymbols(symbolList, { rowBySymbol: themeRows });
  const ms = Math.round(performance.now() - t0);

  const hits = result.bySymbol.size;
  const available = [...result.bySymbol.values()].filter((e) => e.available).length;
  const excluded = [...result.bySymbol.values()].filter((e) => !e.available).length;

  summary.themeFull = {
    ms,
    httpThemeModelChunk80: summary.httpModel.chunkIn80.totalHttp,
    httpThemeModelChunk333: summary.httpModel.chunkIn333.totalHttp,
    enginesActive: summary.httpModel.chunkIn333.enginesActive,
    hits,
    available,
    excluded,
  };

  const outPath = path.join(OUT, "probe-summary.json");
  fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
  console.error(`\nWrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
