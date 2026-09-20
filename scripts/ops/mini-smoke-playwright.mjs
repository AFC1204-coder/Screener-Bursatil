#!/usr/bin/env node
/**
 * OPS-MINI-SMOKE-1 — Playwright headless smoke against isolated Next (:3300).
 *
 * Checks:
 *   1) Home US — truth line with real analyzed count (not 0/0)
 *   2) Caza — sparks in hunt tape OR truth line with pasan count
 *   3) /review?symbol=AAPL — chart leaves "Cargando histórico…"
 *
 * Env:
 *   SMOKE_BASE / PERF_BASE_URL  (default http://127.0.0.1:3300)
 *   SMOKE_OUT_DIR               (default research/ops-mini-smoke-1)
 *   SMOKE_TIMEOUT_MS            (default 180000)
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { isPortOpen } from "./mini-tunnel.mjs";

const ROOT = process.cwd();
const BASE = process.env.SMOKE_BASE || process.env.PERF_BASE_URL || "http://127.0.0.1:3300";
const PORT = Number(new URL(BASE).port || 3300);
const HOST = new URL(BASE).hostname || "127.0.0.1";
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 180000);
const PRECHECK_MS = Number(process.env.SMOKE_PRECHECK_MS || 4000);

function resolveOutDir() {
  const preferred = process.env.SMOKE_OUT_DIR
    || path.join(ROOT, "research", "ops-mini-smoke-1");
  try {
    fs.mkdirSync(preferred, { recursive: true });
    const probe = path.join(preferred, ".write-probe");
    fs.writeFileSync(probe, "ok");
    fs.unlinkSync(probe);
    return preferred;
  } catch {
    const fallback = path.join("/tmp", "statsedge-ops-mini-smoke-1");
    fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  }
}

function readAccessToken() {
  const envPath = path.join(ROOT, ".env.local");
  if (!fs.existsSync(envPath)) throw new Error(".env.local missing (STATSEDGE_ACCESS_TOKEN required)");
  const line = fs.readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .find((item) => /^STATSEDGE_ACCESS_TOKEN\s*=/.test(item));
  if (!line) throw new Error("STATSEDGE_ACCESS_TOKEN missing in .env.local");
  return line.replace(/^STATSEDGE_ACCESS_TOKEN\s*=\s*/, "").trim().replace(/^['"]|['"]$/g, "");
}

function httpProbe(url, timeoutMs) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve({ ok: res.statusCode >= 200 && res.statusCode < 500, status: res.statusCode });
    });
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, status: 0, error: "timeout" }); });
    req.on("error", (error) => resolve({ ok: false, status: 0, error: error.message }));
  });
}

async function precheckServices() {
  const tunnel = await isPortOpen("127.0.0.1", 15432);
  if (!tunnel) {
    return {
      ok: false,
      error: "Mini Postgres tunnel :15432 is down. Run: node scripts/ops/mini-tunnel.mjs --start",
      tunnel15432: false,
      app3300: false,
    };
  }
  const appPortOpen = await isPortOpen(HOST, PORT);
  if (!appPortOpen) {
    return {
      ok: false,
      error: `Next app not listening on ${HOST}:${PORT}. Start: PORT=${PORT} ./node_modules/.bin/next start -p ${PORT}`,
      tunnel15432: true,
      app3300: false,
    };
  }
  const probe = await httpProbe(`${BASE}/`, PRECHECK_MS);
  if (!probe.ok) {
    return {
      ok: false,
      error: `HTTP probe ${BASE}/ failed (${probe.error || `status ${probe.status}`})`,
      tunnel15432: true,
      app3300: false,
    };
  }
  return { ok: true, tunnel15432: true, app3300: true, httpStatus: probe.status };
}

async function login(context, token) {
  const res = await context.request.post(`${BASE}/api/auth/session`, {
    headers: { "Content-Type": "application/json" },
    data: { token },
  });
  if (!res.ok()) throw new Error(`Auth failed: HTTP ${res.status()}`);
}

function parseTruthCounts(text = "") {
  const pasan = text.match(/(\d[\d\s.,]*)\s+de\s+(\d[\d\s.,]*)\s+pasan/i);
  if (pasan) {
    return {
      pass: Number(String(pasan[1]).replace(/[\s.,]/g, "")),
      total: Number(String(pasan[2]).replace(/[\s.,]/g, "")),
    };
  }
  const analyzed = text.match(/(\d[\d\s.,]*)\s+analizadas/i);
  if (analyzed) {
    return { analyzed: Number(String(analyzed[1]).replace(/[\s.,]/g, "")) };
  }
  return {};
}

async function waitTruthReady(page, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const text = await page.locator(".screenerTruthLine").innerText().catch(() => "");
    const counts = parseTruthCounts(text);
    const hasRows = (counts.pass > 0 && counts.total > 100)
      || (counts.analyzed > 100)
      || /35\d{2}|3576|3580|3319/.test(text);
    if (hasRows && !/0\s+de\s+0|0\s+analizadas/i.test(text)) {
      return { text, ms: Date.now() - t0, counts };
    }
    await page.waitForTimeout(250);
  }
  const text = await page.locator(".screenerTruthLine").innerText().catch(() => "");
  return { text, ms: Date.now() - t0, counts: parseTruthCounts(text), timeout: true };
}

async function readCazaSignals(page) {
  return page.evaluate(() => {
    const truth = document.querySelector(".screenerTruthLine")?.textContent?.trim() || "";
    const sparks = document.querySelectorAll(".miniSparkline path, .miniSparkline polyline, .huntTapeRow .miniSparkline").length;
    const svgs = document.querySelectorAll(".miniSparkline").length;
    const huntRows = document.querySelectorAll(".huntTapeRow, .huntTapeItem").length;
    const cazaOn = [...document.querySelectorAll(".huntTapeModeToggle button")].some(
      (btn) => /Caza/i.test(btn.textContent || "") && btn.getAttribute("aria-pressed") === "true",
    );
    return { truth, sparks, svgs, huntRows, cazaOn };
  });
}

async function waitReviewChartReady(page, expectedSymbol, timeoutMs) {
  const want = String(expectedSymbol || "").trim().toUpperCase();
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const state = await page.evaluate((sym) => {
      const body = document.body?.innerText || "";
      const loading = /Cargando histórico/i.test(body);
      const canvas = document.querySelector(".universalChartCanvasWrap canvas, .reviewNativeChart canvas");
      const empty = document.querySelector(".previewEmpty, .universalChart.empty:not(.loading)");
      const symbol = document.querySelector(".reviewIdentity > span > b, .universalChartSymbol")?.textContent?.trim() || "";
      const urlSymbol = new URL(location.href).searchParams.get("symbol")?.trim().toUpperCase() || "";
      return {
        loading,
        hasCanvas: Boolean(canvas),
        emptyText: empty?.textContent?.trim() || null,
        symbol,
        urlSymbol,
        symbolMatch: !sym || symbol.toUpperCase() === sym || urlSymbol === sym,
      };
    }, want);
    if (state.symbolMatch && !state.loading && (state.hasCanvas || state.emptyText)) {
      return { ...state, ms: Date.now() - t0 };
    }
    await page.waitForTimeout(200);
  }
  const state = await page.evaluate((sym) => {
    const symbol = document.querySelector(".reviewIdentity > span > b, .universalChartSymbol")?.textContent?.trim() || "";
    const urlSymbol = new URL(location.href).searchParams.get("symbol")?.trim().toUpperCase() || "";
    return {
      loading: /Cargando histórico/i.test(document.body?.innerText || ""),
      hasCanvas: Boolean(document.querySelector(".universalChartCanvasWrap canvas, .reviewNativeChart canvas")),
      symbol,
      urlSymbol,
      symbolMatch: !sym || symbol.toUpperCase() === sym || urlSymbol === sym,
    };
  }, want);
  return { ...state, ms: Date.now() - t0, timeout: true };
}

export async function runMiniSmokePlaywright({ outDir = resolveOutDir() } = {}) {
  const startedAt = new Date().toISOString();
  const precheck = await precheckServices();
  if (!precheck.ok) {
    const fail = {
      ok: false,
      verdict: "FAIL",
      base: BASE,
      startedAt,
      finishedAt: new Date().toISOString(),
      precheck,
      checks: {},
      error: precheck.error,
      outDir,
    };
    fs.writeFileSync(path.join(outDir, "smoke-summary.json"), JSON.stringify(fail, null, 2));
    return fail;
  }

  const token = readAccessToken();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  page.setDefaultTimeout(TIMEOUT_MS);

  const checks = {};
  const screenshots = {};

  try {
    await login(context, token);

    // --- Home US ---
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
    const usBtn = page.locator('.marketPresetBar button', { hasText: "EE. UU." });
    if (await usBtn.count()) await usBtn.click();
    const truth = await waitTruthReady(page, TIMEOUT_MS);
    checks.homeUs = {
      pass: !truth.timeout && ((truth.counts.pass > 0 && truth.counts.total > 100) || truth.counts.analyzed > 100 || /35\d{2}|3319/.test(truth.text)),
      truthLine: truth.text.slice(0, 200),
      ms: truth.ms,
      timeout: Boolean(truth.timeout),
    };
    screenshots.homeUs = path.join(outDir, "home-us.png");
    await page.screenshot({ path: screenshots.homeUs, fullPage: false });

    // --- Caza (sparks or truth line) ---
    const cazaBtn = page.locator('.huntTapeModeToggle button', { hasText: "Caza" });
    if (await cazaBtn.count() && await cazaBtn.getAttribute("aria-pressed") !== "true") {
      await cazaBtn.click();
      await page.waitForTimeout(400);
    }
    // Allow chart-preview hydrate a short window
    await page.waitForTimeout(3000);
    const caza = await readCazaSignals(page);
    const truthOk = (parseTruthCounts(caza.truth).pass > 0) || /pasan/i.test(caza.truth);
    checks.caza = {
      pass: truthOk || caza.sparks > 0 || caza.svgs > 0,
      ...caza,
    };
    screenshots.caza = path.join(outDir, "caza.png");
    await page.screenshot({ path: screenshots.caza, fullPage: false });

    // --- Review AAPL ---
    await page.evaluate(() => {
      try { localStorage.removeItem("statsedge.review.v1"); } catch { /* noop */ }
    });
    await page.goto(`${BASE}/review?symbol=AAPL`, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
    await page.waitForFunction(
      () => {
        const sym = document.querySelector(".reviewIdentity > span > b")?.textContent?.trim().toUpperCase() || "";
        const urlSym = new URL(location.href).searchParams.get("symbol")?.trim().toUpperCase() || "";
        return sym === "AAPL" || urlSym === "AAPL";
      },
      null,
      { timeout: TIMEOUT_MS },
    ).catch(() => null);
    const review = await waitReviewChartReady(page, "AAPL", TIMEOUT_MS);
    checks.reviewAapl = {
      pass: !review.timeout && !review.loading && review.symbolMatch,
      symbol: review.symbol,
      urlSymbol: review.urlSymbol,
      hasCanvas: review.hasCanvas,
      emptyText: review.emptyText || null,
      ms: review.ms,
      timeout: Boolean(review.timeout),
      stillLoading: review.loading,
      symbolMatch: review.symbolMatch,
    };
    screenshots.reviewAapl = path.join(outDir, "review-aapl.png");
    await page.screenshot({ path: screenshots.reviewAapl, fullPage: false });
  } finally {
    await browser.close();
  }

  const ok = Object.values(checks).every((c) => c.pass);
  const summary = {
    ok,
    verdict: ok ? "PASS" : "FAIL",
    base: BASE,
    startedAt,
    finishedAt: new Date().toISOString(),
    precheck,
    checks,
    screenshots,
    outDir,
  };
  fs.writeFileSync(path.join(outDir, "smoke-summary.json"), JSON.stringify(summary, null, 2));
  return summary;
}

async function main() {
  const summary = await runMiniSmokePlaywright();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    console.error(`\nVERDICT: ${summary.verdict}${summary.error ? ` — ${summary.error}` : ""}`);
    process.exit(1);
  }
  console.log(`\nVERDICT: ${summary.verdict}`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main().catch((error) => {
    console.error(`FAIL ${error.message}`);
    process.exit(1);
  });
}
