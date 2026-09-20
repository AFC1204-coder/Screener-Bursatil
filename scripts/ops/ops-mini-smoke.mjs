#!/usr/bin/env node
/**
 * OPS-MINI-SMOKE-1 — single entry: Mini tunnel check (+ optional start) + Playwright smoke.
 *
 * Usage:
 *   node scripts/ops/ops-mini-smoke.mjs              # check tunnel; fail fast if down
 *   node scripts/ops/ops-mini-smoke.mjs --start-tunnel # start ssh only when :15432 closed
 *   node scripts/ops/ops-mini-smoke.mjs --tunnel-only
 */
import { ensureMiniTunnel } from "./mini-tunnel.mjs";
import { runMiniSmokePlaywright } from "./mini-smoke-playwright.mjs";

async function main() {
  const startTunnel = process.argv.includes("--start-tunnel");
  const tunnelOnly = process.argv.includes("--tunnel-only");

  const tunnel = await ensureMiniTunnel({ start: startTunnel });
  if (!tunnel.ok) {
    const payload = { ok: false, verdict: "FAIL", stage: "tunnel", tunnel };
    console.log(JSON.stringify(payload, null, 2));
    console.error(`\nVERDICT: FAIL — ${tunnel.error}`);
    process.exit(1);
  }

  if (tunnelOnly) {
    console.log(JSON.stringify({ ok: true, verdict: "PASS", stage: "tunnel", tunnel }, null, 2));
    return;
  }

  const summary = await runMiniSmokePlaywright();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    console.error(`\nVERDICT: ${summary.verdict}${summary.error ? ` — ${summary.error}` : ""}`);
    process.exit(1);
  }
  console.log(`\nVERDICT: ${summary.verdict}`);
}

main().catch((error) => {
  console.error(`FAIL ${error.message}`);
  process.exit(1);
});
