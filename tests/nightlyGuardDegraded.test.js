import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { expectedSession, summarizeFreshness } from "../scripts/ops/bars-freshness.mjs";

const GUARD = path.resolve("scripts/ops/nightly-us-guard.sh");

function script(dir, name, body) {
  const file = path.join(dir, name);
  writeFileSync(file, `#!/bin/bash\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
}

function runGuard({ bars, fresh, scan = "exit 0" }) {
  const root = mkdtempSync(path.join(tmpdir(), "guard-"));
  mkdirSync(path.join(root, "logs"));
  const env = {
    ...process.env,
    STATSEDGE_GUARD_ROOT: root,
    STATSEDGE_GUARD_RETRY_SLEEP: "0",
    STATSEDGE_GUARD_SCAN_ATTEMPTS: "1",
    STATSEDGE_GUARD_BARS_CMD: script(root, "bars.sh", `echo x >> "${root}/bars-calls"; ${bars}`),
    STATSEDGE_GUARD_SCAN_CMD: script(root, "scan.sh", scan),
    NOTIFY_LOG: path.join(root, "logs", "notify.log"),
  };
  delete env.NOTIFY_URL;
  if (fresh) env.STATSEDGE_GUARD_FRESH_CMD = script(root, "fresh.sh", fresh);
  else env.STATSEDGE_GUARD_SKIP_FRESH = "1";
  const r = spawnSync("bash", [GUARD], { env, encoding: "utf8" });
  const status = JSON.parse(readFileSync(path.join(root, "logs", "nightly-us-status.json"), "utf8"));
  const callsFile = path.join(root, "bars-calls");
  const barsCalls = existsSync(callsFile) ? readFileSync(callsFile, "utf8").trim().split("\n").length : 0;
  const notify = existsSync(path.join(root, "logs", "notify.log"))
    ? readFileSync(path.join(root, "logs", "notify.log"), "utf8")
    : "";
  return { code: r.status, status, barsCalls, notify };
}

describe("guardián nocturno: estado degraded", () => {
  it("todo bien: result ok, sin aviso", () => {
    const out = runGuard({ bars: "exit 0", fresh: 'echo \'{"pct":99.1,"ok":true}\'; exit 0' });
    expect(out.status.result).toBe("ok");
    expect(out.status.barsExit).toBe("0");
    expect(out.status.freshness).toEqual({ pct: 99.1, ok: true });
    expect(out.notify).toBe("");
    expect(out.code).toBe(0);
  });

  it("refresh-bars exit=2 (tope) no se reintenta y deja degraded con aviso", () => {
    const out = runGuard({ bars: "exit 2", fresh: 'echo \'{"pct":23.6,"ok":false}\'; exit 1' });
    expect(out.barsCalls).toBe(1);
    expect(out.status.result).toBe("degraded");
    expect(out.status.barsExit).toBe("2");
    expect(out.status.reason).toMatch(/exit=2/);
    expect(out.notify).toMatch(/\[warn\].*datos incompletos/);
    expect(out.code).toBe(0);
  });

  it("otro error de barras sí se reintenta una vez", () => {
    const out = runGuard({ bars: "exit 1", fresh: 'echo \'{"pct":10}\'; exit 1' });
    expect(out.barsCalls).toBe(2);
    expect(out.status.result).toBe("degraded");
  });

  it("barras sin error pero universo atrasado: degraded por frescura", () => {
    const out = runGuard({ bars: "exit 0", fresh: 'echo \'{"pct":60,"ok":false}\'; exit 1' });
    expect(out.status.result).toBe("degraded");
    expect(out.status.reason).toMatch(/atrasadas/);
    expect(out.status.freshExit).toBe("1");
  });

  it("si el scan falla, es fail (error) aunque las barras estén bien", () => {
    const out = runGuard({ bars: "exit 0", fresh: "exit 0", scan: "exit 1" });
    expect(out.status.result).toBe("fail");
    expect(out.notify).toMatch(/\[error\].*falló/);
    expect(out.code).toBe(1);
  });
});

describe("bars-freshness: funciones puras", () => {
  it("expectedSession: sábado → viernes; lunes de madrugada → viernes", () => {
    expect(expectedSession(new Date("2026-11-07T04:00:00Z"))).toBe("2026-11-06");
    expect(expectedSession(new Date("2026-11-09T04:00:00Z"))).toBe("2026-11-06");
  });

  it("expectedSession: la sesión aún sin asentar no cuenta; ya asentada sí", () => {
    // Jueves 5-nov: cierre 21:00Z (EST) + 30 min.
    expect(expectedSession(new Date("2026-11-05T21:10:00Z"))).toBe("2026-11-04");
    expect(expectedSession(new Date("2026-11-05T21:40:00Z"))).toBe("2026-11-05");
  });

  it("expectedSession salta festivos NYSE (Acción de Gracias 26-nov-2026)", () => {
    expect(expectedSession(new Date("2026-11-27T04:00:00Z"))).toBe("2026-11-25");
  });

  it("summarizeFreshness reproduce el caso real del Mini (23,6 % al día)", () => {
    const s = summarizeFreshness(
      [
        { last: "2026-11-06", n: 1387 },
        { last: "2026-11-05", n: 4192 },
        { last: "2026-08-10", n: 268 },
        { last: null, n: 23 },
      ],
      "2026-11-06",
      95,
    );
    expect(s.universe).toBe(5870);
    expect(s.upToDate).toBe(1387);
    expect(s.noBars).toBe(23);
    expect(s.stale).toBe(4460);
    expect(s.pct).toBe(23.6);
    expect(s.ok).toBe(false);
  });

  it("summarizeFreshness: universo vacío nunca es ok", () => {
    expect(summarizeFreshness([], "2026-11-06").ok).toBe(false);
  });
});
