#!/usr/bin/env node
/**
 * SCANS-RS-HYDRATE-1 — medición cold/warm + fases aisladas.
 *
 * Requisitos:
 *   nc -zv 127.0.0.1 15432
 *   next start en :3300 (o SCANS_PORT)
 *   .env.local con STATSEDGE_ACCESS_TOKEN + DATABASE_URL
 *
 * Uso:
 *   node research/scans-rs-hydrate-1/probe.mjs
 *   SCANS_PORT=3300 node research/scans-rs-hydrate-1/probe.mjs --hydrate-only
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { performance } from "node:perf_hooks";
import pg from "pg";
import { clearScansApiCache } from "@/lib/scansApiCache.js";
import { readGlobalRsForSymbols } from "@/lib/globalRs.js";
import { readCountryRsForSymbols } from "@/lib/countryRsHydrate.js";
import { readThemeRsForSymbols } from "@/lib/themeRsHydrate.js";
import { US_EQUITY_RS_ENGINE_VERSION } from "@/lib/rsEngines.js";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "research/scans-rs-hydrate-1");
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

const env = readEnvLocal();
const token = env.STATSEDGE_ACCESS_TOKEN;
const host = process.env.SCANS_HOST || "127.0.0.1";
const port = Number(process.env.SCANS_PORT || 3300);
const hydrateOnly = process.argv.includes("--hydrate-only");

async function checkTunnel() {
  const { execSync } = await import("node:child_process");
  try {
    execSync("nc -zv 127.0.0.1 15432", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function httpGet(scansPath, { bustCache = false } = {}) {
  return new Promise((resolve, reject) => {
    if (bustCache) clearScansApiCache();
    const started = performance.now();
    let ttfb = null;
    const chunks = [];
    const req = http.request({
      host,
      port,
      path: scansPath,
      method: "GET",
      headers: { "x-statsedge-token": token },
    }, (res) => {
      res.on("data", (c) => {
        if (ttfb == null) ttfb = performance.now() - started;
        chunks.push(c);
      });
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        resolve({
          status: res.statusCode,
          ttfbMs: Math.round(ttfb ?? 0),
          totalMs: Math.round(performance.now() - started),
          transferAfterTtfbMs: Math.round((performance.now() - started) - (ttfb ?? 0)),
          wireBytes: buf.length,
          contentEncoding: res.headers["content-encoding"] || null,
          rsHydration: (() => {
            try {
              return JSON.parse(buf.toString("utf8"))?.rsHydration;
            } catch {
              return null;
            }
          })(),
        });
      });
    });
    req.setTimeout(180000, () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

async function loadNightlySymbols() {
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 2 });
  try {
    // El nocturno US se ancla por local_id (API nightly-us), no por settings.source
    // (en Mini suele ser jobs/scan-refresh).
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

async function timePhase(label, fn) {
  const t0 = performance.now();
  const result = await fn();
  return { label, ms: Math.round(performance.now() - t0), meta: result };
}

async function measureHydratePhases(symbols, results) {
  const symbolList = symbols.map((s) => s.symbol).filter(Boolean);
  const themeRows = new Map(results.map((r) => [String(r.symbol).toUpperCase(), r]));

  const globalBulk = await timePhase("globalRs_bulk", async () => {
    const r = await readGlobalRsForSymbols(symbolList);
    return { hits: r.bySymbol.size, bySymbol: r.bySymbol };
  });

  return {
    globalBulk: { label: globalBulk.label, ms: globalBulk.ms, meta: { hits: globalBulk.meta.hits } },
    countryUsNoBulk_legacy: await timePhase("countryUs_readGlobalRs_bulkSnapshot_false", async () => {
      const r = await readGlobalRsForSymbols(symbolList, {
        engineVersion: US_EQUITY_RS_ENGINE_VERSION,
        bulkSnapshot: false,
      });
      return { hits: r.bySymbol.size };
    }),
    countryUsBulk_fallback: await timePhase("countryUs_readGlobalRs_bulkSnapshot_true", async () => {
      const r = await readGlobalRsForSymbols(symbolList, {
        engineVersion: US_EQUITY_RS_ENGINE_VERSION,
        bulkSnapshot: true,
      });
      return { hits: r.bySymbol.size };
    }),
    countryFull_withReuse: await timePhase("readCountryRsForSymbols_reuseGlobal", async () => {
      const r = await readCountryRsForSymbols(symbolList, {
        reuseGlobalRsBySymbol: globalBulk.meta.bySymbol,
      });
      return { hits: r.bySymbol.size };
    }),
    themeFull: await timePhase("readThemeRsForSymbols", async () => {
      const r = await readThemeRsForSymbols(symbolList, { rowBySymbol: themeRows });
      return { hits: r.bySymbol.size };
    }),
  };
}

async function main() {
  if (!token) throw new Error("STATSEDGE_ACCESS_TOKEN missing");
  const tunnelUp = await checkTunnel();
  const summary = {
    ticket: "SCANS-RS-HYDRATE-1",
    at: new Date().toISOString(),
    head: (await import("node:child_process")).execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim(),
    tunnel15432: tunnelUp,
    app: `${host}:${port}`,
  };

  if (tunnelUp) {
    const loaded = await loadNightlySymbols();
    const { rows } = loaded;
    summary.symbolCount = rows.length;
    summary.scanLocalId = loaded.localId;
    summary.scanRowCount = loaded.rowCount;
    if (!hydrateOnly) {
      const coldHydrate = `/api/scans?includeRows=1&limit=1&rowsLimit=5999&anchor=nightly-us&hydrateRs=1&_probe=${Date.now()}`;
      const coldCore = `/api/scans?includeRows=1&limit=1&rowsLimit=5998&anchor=nightly-us&_probe=${Date.now()}`;
      clearScansApiCache();
      summary.http = {
        coldExtended: await httpGet(coldHydrate, { bustCache: true }),
        coldCore: await httpGet(coldCore, { bustCache: true }),
        warmExtended: await httpGet(coldHydrate.replace(/_probe=\d+/, `_probe=${Date.now()}`)),
      };
      summary.http.deltaTtfbMs =
        summary.http.coldExtended.ttfbMs - summary.http.coldCore.ttfbMs;
    }
    summary.isolatedHydrate = await measureHydratePhases(rows, rows);
  } else {
    summary.error = "tunnel 15432 down — skipped live HTTP/hydrate timings";
    summary.priorArt = "research/scans-payload-1/summary.json (2026-09-13, HEAD 75f2a2c)";
  }

  const outPath = path.join(OUT, "probe-summary.json");
  fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
  console.error(`\nWrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
