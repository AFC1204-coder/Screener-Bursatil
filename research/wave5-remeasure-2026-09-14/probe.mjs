#!/usr/bin/env node
/**
 * WAVE5 post-remeasure — cold/warm US after THEME + CHARTPREVIEW + REACT-COMMIT + HYDRATE-VISIBLE.
 * Compara vs research/scans-rs-hydrate-1/probe-summary.json (f4695aa).
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import zlib from "node:zlib";
import { performance } from "node:perf_hooks";
import { execSync } from "node:child_process";
import { clearScansApiCache } from "@/lib/scansApiCache.js";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "research/wave5-remeasure-2026-09-14");
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
        const scan = parsed?.scans?.[0];
        const rows = scan?.rows || [];
        const withPreview = rows.filter((r) => Array.isArray(r.chartPreview) && r.chartPreview.length >= 2).length;
        resolve({
          status: res.statusCode,
          ttfbMs: Math.round(ttfb ?? 0),
          totalMs: Math.round(performance.now() - started),
          transferAfterTtfbMs: Math.round((performance.now() - started) - (ttfb ?? 0)),
          wireBytes: wire.length,
          jsonBytes: body.length,
          contentEncoding: encoding,
          chartPreviewTransport: parsed?.chartPreviewTransport || scan?.chartPreviewTransport || null,
          rsHydration: parsed?.rsHydration || null,
          rowCount: rows.length,
          withPreviewInline: withPreview,
          ok: parsed?.ok ?? null,
          error: parsed?.error || parsed?.message || null,
        });
      });
    });
    req.setTimeout(300000, () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

async function main() {
  if (!token) throw new Error("STATSEDGE_ACCESS_TOKEN missing");
  let tunnel = false;
  try {
    execSync("nc -zv 127.0.0.1 15432", { stdio: "pipe" });
    tunnel = true;
  } catch { /* */ }

  const head = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  const probe = Date.now();
  const base = "/api/scans?includeRows=1&limit=1&rowsLimit=6000&anchor=markets&markets=US";

  clearScansApiCache();
  const coldCore = await httpGet(`${base}&hydrateRs=0&_probe=${probe}c`, { bustCache: true });
  clearScansApiCache();
  const coldExtended = await httpGet(`${base}&hydrateRs=1&_probe=${probe}e`, { bustCache: true });
  const warmExtended = await httpGet(`${base}&hydrateRs=1&_probe=${probe}w`);

  const prior = {
    head: "f4695aa",
    coldExtendedTtfbMs: 17861,
    coldCoreTtfbMs: 8586,
    warmExtendedTtfbMs: 203,
    deltaHydrateMs: 9275,
    note: "pre chartPreview-defer; wire ~34 MB uncompressed",
  };

  const summary = {
    ticket: "WAVE5-REMEASURE",
    at: new Date().toISOString(),
    head,
    tunnel15432: tunnel,
    app: `${host}:${port}`,
    prior,
    http: {
      coldCore,
      coldExtended,
      warmExtended,
      deltaHydrateTtfbMs: coldExtended.ttfbMs - coldCore.ttfbMs,
    },
    deltasVsPrior: {
      coldExtendedTtfbMs: coldExtended.ttfbMs - prior.coldExtendedTtfbMs,
      coldCoreTtfbMs: coldCore.ttfbMs - prior.coldCoreTtfbMs,
      warmExtendedTtfbMs: warmExtended.ttfbMs - prior.warmExtendedTtfbMs,
      deltaHydrateTtfbMs: (coldExtended.ttfbMs - coldCore.ttfbMs) - prior.deltaHydrateMs,
      wireBytesColdCore: coldCore.wireBytes,
    },
  };

  fs.writeFileSync(path.join(OUT, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
