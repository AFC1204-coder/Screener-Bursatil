#!/usr/bin/env node
/**
 * OPS-MINI-HARDEN-1 — daily Mini ritual: preflight (ES) + optional Playwright smoke.
 *
 * Usage:
 *   node scripts/ops/ops-mini-daily.mjs --check           # preflight only (fast)
 *   node scripts/ops/ops-mini-daily.mjs                   # preflight + smoke
 *   node scripts/ops/ops-mini-daily.mjs --start-tunnel    # try ssh if :15432 closed, then smoke
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatPreflightReport, runMiniPreflight } from "./mini-preflight.mjs";
import { runMiniSmokePlaywright } from "./mini-smoke-playwright.mjs";

function resolveDailyOutDir() {
  const preferred = process.env.SMOKE_OUT_DIR
    || path.join(process.cwd(), "research", "ops-mini-harden-1");
  try {
    fs.mkdirSync(preferred, { recursive: true });
    const probe = path.join(preferred, ".write-probe");
    fs.writeFileSync(probe, "ok");
    fs.unlinkSync(probe);
    return preferred;
  } catch {
    const fallback = path.join("/tmp", "statsedge-ops-mini-harden-1");
    fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  }
}

async function main() {
  const checkOnly = process.argv.includes("--check");
  const startTunnel = process.argv.includes("--start-tunnel");

  const preflight = await runMiniPreflight({ startTunnel });
  console.log(formatPreflightReport(preflight));

  if (!preflight.ok) {
    console.error("\nVERDICT: FAIL — corrige el preflight antes del smoke (npm run ops:mini:check).");
    process.exit(1);
  }

  if (checkOnly) {
    console.log("\nVERDICT: PASS — preflight listo (sin Playwright).");
    return;
  }

  console.log("\n· Smoke Playwright (home US, Caza, review AAPL)…");
  const outDir = resolveDailyOutDir();
  const summary = await runMiniSmokePlaywright({ outDir });
  console.log(JSON.stringify(summary, null, 2));

  if (!summary.ok) {
    console.error(`\nVERDICT: ${summary.verdict}${summary.error ? ` — ${summary.error}` : ""}`);
    console.error(`Artefactos: ${outDir}`);
    process.exit(1);
  }

  console.log(`\nVERDICT: ${summary.verdict}`);
  console.log(`Artefactos: ${outDir}`);
}

main().catch((error) => {
  console.error(`FAIL ${error.message}`);
  process.exit(1);
});
