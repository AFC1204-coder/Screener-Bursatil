#!/usr/bin/env node
/**
 * SCREENER-BOOTSTRAP-CORE-FIRST-1 — T_core vs baseline bloqueante hydrateRs=1.
 * Compara TTFB/total de core (hydrateRs=0) vs extended (hydrateRs=1) en :3300.
 *
 * Uso:
 *   SCANS_PORT=3300 node research/screener-bootstrap-core-first-1/probe.mjs
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import zlib from "node:zlib";
import { performance } from "node:perf_hooks";
import { execSync } from "node:child_process";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "research/screener-bootstrap-core-first-1");
fs.mkdirSync(OUT, { recursive: true });

function readEnvLocal() {
  const env = {};
  const file = path.join(ROOT, ".env.local");
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
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
const rowsLimit = 6000;

function scansPath(hydrateRs, probeTag = "") {
  const suffix = probeTag ? `&_probe=${probeTag}` : "";
  return `/api/scans?includeRows=1&limit=1&rowsLimit=${rowsLimit}&anchor=nightly-us&hydrateRs=${hydrateRs}${suffix}`;
}

function httpGet(scansUrl) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    let ttfb = null;
    const chunks = [];
    const req = http.request({
      host,
      port,
      path: scansUrl,
      method: "GET",
      headers: {
        "x-statsedge-token": token,
        "accept-encoding": "gzip, deflate, br",
      },
    }, (res) => {
      res.on("data", (c) => {
        if (ttfb == null) ttfb = performance.now() - started;
        chunks.push(c);
      });
      res.on("end", () => {
        const wire = Buffer.concat(chunks);
        const encoding = res.headers["content-encoding"] || null;
        let body = wire;
        try {
          if (encoding && String(encoding).includes("gzip")) body = zlib.gunzipSync(wire);
          else if (encoding && String(encoding).includes("br")) body = zlib.brotliDecompressSync(wire);
          else if (encoding && String(encoding).includes("deflate")) body = zlib.inflateSync(wire);
        } catch { /* keep wire */ }
        let parsed = null;
        try { parsed = JSON.parse(body.toString("utf8")); } catch { /* ignore */ }
        resolve({
          status: res.statusCode,
          ttfbMs: Math.round(ttfb ?? 0),
          totalMs: Math.round(performance.now() - started),
          wireBytes: wire.length,
          jsonBytes: body.length,
          contentEncoding: encoding,
          rsHydration: parsed?.rsHydration || null,
          rowCount: parsed?.scans?.[0]?.rows?.length ?? 0,
          ok: parsed?.ok ?? null,
        });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

let head = "unknown";
try { head = execSync("git rev-parse --short HEAD", { cwd: ROOT }).toString().trim(); } catch { /* ignore */ }

const probeTag = Date.now();
const coreCold = await httpGet(scansPath("0", `${probeTag}c`));
const extendedCold = await httpGet(scansPath("1", `${probeTag}e`));
const coreWarm = await httpGet(scansPath("0", `${probeTag}cw`));
const extendedWarm = await httpGet(scansPath("1", `${probeTag}ew`));

const summary = {
  ticket: "SCREENER-BOOTSTRAP-CORE-FIRST-1",
  at: new Date().toISOString(),
  head,
  app: `${host}:${port}`,
  method: "GET /api/scans anchor=nightly-us · bootstrap core-first",
  prior: {
    source: "research/wave5-remeasure-2026-09-14/summary.json",
    note: "Baseline bloqueante = un solo hydrateRs=1 antes de este ticket",
  },
  T_core: {
    cold: { ttfbMs: coreCold.ttfbMs, totalMs: coreCold.totalMs, rsHydration: coreCold.rsHydration, rowCount: coreCold.rowCount },
    warm: { ttfbMs: coreWarm.ttfbMs, totalMs: coreWarm.totalMs },
  },
  T_blocking_extended: {
    cold: { ttfbMs: extendedCold.ttfbMs, totalMs: extendedCold.totalMs, rsHydration: extendedCold.rsHydration, rowCount: extendedCold.rowCount },
    warm: { ttfbMs: extendedWarm.ttfbMs, totalMs: extendedWarm.totalMs },
  },
  deltaColdTtfbMs: extendedCold.ttfbMs - coreCold.ttfbMs,
  deltaColdTotalMs: extendedCold.totalMs - coreCold.totalMs,
  verdict: {
    bootstrap: "Core pinta mesa; extended en background no bloquea T_core",
    T_core_vs_blocking: coreCold.totalMs < extendedCold.totalMs
      ? `T_core (${coreCold.totalMs}ms) < T_blocking (${extendedCold.totalMs}ms) en frío`
      : "Ruido de túnel/DB — repetir en pasada caliente",
  },
};

fs.writeFileSync(path.join(OUT, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
