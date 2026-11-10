#!/usr/bin/env node
// SCANS-TRANSPORT-1 — medición de cable HTTP (no usa fetch: strippea Content-Encoding).
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import zlib from "node:zlib";

const ROOT = process.cwd();
const env = {};
for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (!m) continue;
  env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
}

const host = process.env.SCANS_HOST || "127.0.0.1";
const port = Number(process.env.SCANS_PORT || 3315);
const scansPath = process.env.SCANS_PATH
  || "/api/scans?includeRows=1&limit=1&rowsLimit=6000&anchor=nightly-us&hydrateRs=1";
const token = env.STATSEDGE_ACCESS_TOKEN;
if (!token) throw new Error("STATSEDGE_ACCESS_TOKEN missing");

function request({ acceptEncoding }) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    let ttfb = null;
    const chunks = [];
    const req = http.request({
      host,
      port,
      path: scansPath,
      method: "GET",
      headers: {
        "x-statsedge-token": token,
        ...(acceptEncoding ? { "accept-encoding": acceptEncoding } : {}),
      },
    }, (res) => {
      res.on("data", (c) => {
        if (ttfb == null) ttfb = Date.now() - started;
        chunks.push(c);
      });
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        const enc = res.headers["content-encoding"] || null;
        let decoded = buf;
        if (enc && /gzip/i.test(enc)) decoded = zlib.gunzipSync(buf);
        else if (enc && /br/i.test(enc)) decoded = zlib.brotliDecompressSync(buf);
        let json = null;
        let parseMs = null;
        const t0 = Date.now();
        json = JSON.parse(decoded.toString("utf8"));
        parseMs = Date.now() - t0;
        const scan = json?.scans?.[0] || {};
        resolve({
          status: res.statusCode,
          encoding: enc,
          contentType: res.headers["content-type"] || null,
          contentLength: res.headers["content-length"] || null,
          transferEncoding: res.headers["transfer-encoding"] || null,
          vary: res.headers.vary || null,
          wireBytes: buf.length,
          decodedBytes: decoded.length,
          magic: buf.subarray(0, 2).toString("hex"),
          ttfbMs: ttfb,
          totalMs: Date.now() - started,
          parseMs,
          ok: json?.ok,
          projection: json?.projection,
          rsHydration: json?.rsHydration,
          rowCount: Array.isArray(scan.rows) ? scan.rows.length : 0,
          firstSymbols: (scan.rows || []).slice(0, 5).map((row) => row.symbol),
        });
      });
    });
    req.setTimeout(180000, () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

const gzip = await request({ acceptEncoding: "gzip, deflate, br" });
console.log(JSON.stringify({ host, port, path: scansPath, gzip }, null, 2));
