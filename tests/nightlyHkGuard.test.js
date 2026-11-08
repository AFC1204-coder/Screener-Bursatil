import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { expectedSession } from "../scripts/ops/bars-freshness.mjs";

const GUARD = path.resolve("scripts/ops/nightly-hk-guard.sh");

function script(dir, name, body) {
  const file = path.join(dir, name);
  writeFileSync(file, `#!/bin/bash\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
}

function runGuard({ withList = true, list = "exit 0", bars = "exit 0", fresh = 'echo \'{"pct":99,"ok":true}\'; exit 0', scan = "exit 0" }) {
  const root = mkdtempSync(path.join(tmpdir(), "hkguard-"));
  mkdirSync(path.join(root, "logs"));
  if (withList) writeFileSync(path.join(root, "logs", "hk-liquid-universe.json"), JSON.stringify({ market: "HK", symbols: [{ symbol: "0700.HK" }] }));
  const env = {
    ...process.env,
    STATSEDGE_GUARD_ROOT: root,
    STATSEDGE_GUARD_RETRY_SLEEP: "0",
    STATSEDGE_GUARD_SCAN_ATTEMPTS: "1",
    STATSEDGE_HK_LIST_CMD: script(root, "list.sh", list),
    STATSEDGE_HK_BARS_CMD: script(root, "bars.sh", `echo x >> "${root}/bars-calls"; ${bars}`),
    STATSEDGE_HK_FRESH_CMD: script(root, "fresh.sh", fresh),
    STATSEDGE_HK_SCAN_CMD: script(root, "scan.sh", scan),
    NOTIFY_LOG: path.join(root, "logs", "notify.log"),
  };
  delete env.NOTIFY_URL;
  const r = spawnSync("bash", [GUARD], { env, encoding: "utf8" });
  const status = JSON.parse(readFileSync(path.join(root, "logs", "nightly-hk-status.json"), "utf8"));
  const calls = path.join(root, "bars-calls");
  const notifyFile = path.join(root, "logs", "notify.log");
  return {
    code: r.status,
    status,
    barsCalls: existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").length : 0,
    notify: existsSync(notifyFile) ? readFileSync(notifyFile, "utf8") : "",
  };
}

describe("guardián HK", () => {
  it("todo bien: ok y sin aviso", () => {
    const out = runGuard({});
    expect(out.status.result).toBe("ok");
    expect(out.notify).toBe("");
    expect(out.code).toBe(0);
  });

  it("barras con exit=2 no se reintentan y dejan degraded con aviso", () => {
    const out = runGuard({ bars: "exit 2", fresh: 'echo \'{"pct":30}\'; exit 1' });
    expect(out.barsCalls).toBe(1);
    expect(out.status.result).toBe("degraded");
    expect(out.notify).toMatch(/\[warn\].*HK/);
  });

  it("otro error de barras se reintenta una vez", () => {
    const out = runGuard({ bars: "exit 1", fresh: "exit 0" });
    expect(out.barsCalls).toBe(2);
    expect(out.status.result).toBe("degraded");
  });

  it("frescura baja con barras sin error: degraded", () => {
    const out = runGuard({ fresh: 'echo \'{"pct":50}\'; exit 1' });
    expect(out.status.result).toBe("degraded");
    expect(out.status.reason).toMatch(/atrasadas/);
  });

  it("si falla el scan es fail con aviso de error", () => {
    const out = runGuard({ scan: "exit 1" });
    expect(out.status.result).toBe("fail");
    expect(out.notify).toMatch(/\[error\]/);
    expect(out.code).toBe(1);
  });

  it("sin lista líquida y sin poder generarla: fail", () => {
    const out = runGuard({ withList: false, list: "exit 1" });
    expect(out.status.result).toBe("fail");
    expect(out.status.reason).toMatch(/lista líquida/);
    expect(out.code).toBe(1);
  });
});

describe("expectedSession para HK", () => {
  it("sábado → viernes; lunes de madrugada → viernes", () => {
    expect(expectedSession(new Date("2026-11-07T04:00:00Z"), "HK")).toBe("2026-11-06");
    expect(expectedSession(new Date("2026-11-09T01:00:00Z"), "HK")).toBe("2026-11-06");
  });

  it("la sesión de HK se asienta a las 16:30 HKT (08:30Z)", () => {
    expect(expectedSession(new Date("2026-11-04T08:10:00Z"), "HK")).toBe("2026-11-03");
    expect(expectedSession(new Date("2026-11-04T08:40:00Z"), "HK")).toBe("2026-11-04");
  });
});
