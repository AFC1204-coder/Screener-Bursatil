#!/usr/bin/env node
// Sandbox triad + source baseline for hardened date-001 acceptance.
// No Mini, no enqueue, no product correction.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";

const root = dirname(fileURLToPath(import.meta.url));
const accept = join(root, "accept-date.mjs");
const logs = join(root, "logs");
mkdirSync(logs, { recursive: true });

const targets = [
  { id: "WRONG", path: join(root, "fixtures/wrong/formatters.js"), expect: "FAIL" },
  { id: "RIGHT", path: join(root, "fixtures/right/formatters.js"), expect: "PASS" },
  { id: "PRESERVATION_BREAK", path: join(root, "fixtures/preservation-break/formatters.js"), expect: "FAIL" },
  { id: "BASELINE_SOURCE", path: join(root, "source/formatters.js"), expect: "FAIL" },
];

function run(id, modulePath) {
  const result = spawnSync(process.execPath, [accept, modulePath], {
    encoding: "utf8",
    env: { ...process.env, OPENSSL_CONF: "/dev/null" },
    timeout: 60000,
  });
  const out = `${result.stdout || ""}${result.stderr || ""}`;
  writeFileSync(join(logs, `${id.toLowerCase()}.log`), out);
  return {
    id,
    status: result.status === 0 ? "PASS" : "FAIL",
    exitCode: result.status,
    tail: out.trim().split("\n").slice(-8).join("\n"),
  };
}

const results = targets.map((t) => {
  const r = run(t.id, t.path);
  r.expect = t.expect;
  r.ok = r.status === t.expect;
  return r;
});

const allOk = results.every((r) => r.ok);
const verdict = allOk ? "DATE_ACCEPTANCE_HARDENED_OK" : "DATE_ACCEPTANCE_HARDENED_FAIL";

const summary = {
  verdict,
  timezones: ["Europe/Madrid", "America/New_York", "Asia/Tokyo"],
  results: results.map(({ id, expect, status, ok, exitCode, tail }) => ({
    id,
    expect,
    status,
    ok,
    exitCode,
    tail,
  })),
  expected_values_use_date_constructor_oracle: false,
  llm_judge: false,
  v1_py_touched: false,
};

writeFileSync(join(root, "triad-summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
process.exit(allOk ? 0 : 1);
