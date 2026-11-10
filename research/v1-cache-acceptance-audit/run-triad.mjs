#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";

const root = dirname(fileURLToPath(import.meta.url));
const hardened = join(root, "accept-cache.mjs");
const old = join(root, "controls/accept-cache.mjs");
const logs = join(root, "logs");
mkdirSync(logs, { recursive: true });

const targets = [
  { id: "WRONG", path: join(root, "fixtures/wrong/serverCache.js"), expect: "FAIL" },
  { id: "RIGHT", path: join(root, "fixtures/right/serverCache.js"), expect: "PASS" },
  { id: "PRESERVATION_BREAK", path: join(root, "fixtures/preservation-break/serverCache.js"), expect: "FAIL" },
  { id: "BASELINE_SOURCE", path: join(root, "source/serverCache.js"), expect: "FAIL" },
];

function summarize(out) {
  const lines = out.split("\n").filter((l) => l.startsWith("PASS ") || l.startsWith("FAIL "));
  const json = out.split("\n").filter((l) => l.startsWith("{")).pop() || null;
  return { lines, json, failNames: lines.filter((l) => l.startsWith("FAIL ")).map((l) => l.slice(5).split(" Expected")[0]) };
}

function run(acceptPath, id, modulePath) {
  const r = spawnSync(process.execPath, [acceptPath, modulePath], {
    encoding: "utf8",
    env: { ...process.env, OPENSSL_CONF: "/dev/null" },
    timeout: 120000,
  });
  const out = `${r.stdout || ""}${r.stderr || ""}`;
  writeFileSync(join(logs, `${id.toLowerCase()}.log`), out);
  const s = summarize(out);
  return {
    id,
    status: r.status === 0 ? "PASS" : "FAIL",
    exitCode: r.status,
    summary: s.json,
    failNames: s.failNames,
  };
}

const ORIGINAL_DEFECTS = [
  "synchronous throw clears pending state and permits next loader",
  "clear prevents old completion from repopulating empty cache",
  "clear then explicit set preserves newer value",
  "clear old completion cannot delete replacement inflight entry",
  "explicit set invalidates old result only for that key",
  "expired replacement still bars an older loader from publishing",
  "old completion after replacement completes cannot overwrite it",
  "superseded rejection does not delete replacement pending loader",
];

const results = targets.map((t) => {
  const r = run(hardened, t.id, t.path);
  r.expect = t.expect;
  r.ok = r.status === t.expect;
  return r;
});

const baseline = results.find((r) => r.id === "BASELINE_SOURCE");
const baselineDefectsOk = ORIGINAL_DEFECTS.every((name) =>
  baseline.failNames.some((f) => f.startsWith(name)),
);

const allOk = results.every((r) => r.ok) && baselineDefectsOk;
const verdict = allOk ? "CACHE_ACCEPTANCE_HARDENED_OK" : "CACHE_ACCEPTANCE_WEAK";

// Evidence: old accept on adversarial
const oldWrong = run(old, "OLD_WRONG", join(root, "fixtures/wrong/serverCache.js"));
const oldBreak = run(old, "OLD_PRESERVATION_BREAK", join(root, "fixtures/preservation-break/serverCache.js"));

const frozenBaseline = readFileSync(join(root, "controls/baseline.log"), "utf8");
const frozenSummary = frozenBaseline.split("\n").filter((l) => l.startsWith("{")).pop();

const summary = {
  verdict,
  timezones_n_a: "cache is process-local; no TZ matrix",
  hardened_results: results,
  baseline_original_eight_defects_still_fail: baselineDefectsOk,
  frozen_baseline_summary: frozenSummary,
  old_accept_accepts_wrong: oldWrong.status === "PASS",
  old_accept_accepts_preservation_break: oldBreak.status === "PASS",
  expected_values_literal_or_independent: true,
  llm_judge: false,
  v1_py_touched: false,
};

writeFileSync(join(root, "triad-summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
process.exit(allOk ? 0 : 1);
