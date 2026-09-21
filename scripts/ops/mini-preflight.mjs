#!/usr/bin/env node
/**
 * OPS-MINI-HARDEN-1 — ordered preflight for Mini daily ritual (no Playwright).
 *
 * Checks:
 *   1) SSH tunnel :15432 (optional --start via ensureMiniTunnel)
 *   2) .env.local hints — STATSEDGE_DB_MODE=pg + DATABASE_URL → 127.0.0.1:15432 (no secrets in logs)
 *   3) Next isolated :3300 — port open + HTTP probe
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureMiniTunnel, isPortOpen, tunnelCommand } from "./mini-tunnel.mjs";

export const MINI_TUNNEL_PORT = Number(process.env.STATSEDGE_MINI_TUNNEL_PORT || 15432);
export const MINI_APP_PORT = Number(process.env.STATSEDGE_MINI_APP_PORT || 3300);
export const MINI_APP_HOST = process.env.STATSEDGE_MINI_APP_HOST || "127.0.0.1";
export const MINI_APP_BASE = process.env.SMOKE_BASE
  || process.env.PERF_BASE_URL
  || `http://${MINI_APP_HOST}:${MINI_APP_PORT}`;
export const PRECHECK_MS = Number(process.env.SMOKE_PRECHECK_MS || 4000);

/**
 * Redact credentials from a Postgres URL — only host:port/db for human hints.
 * @param {string | undefined | null} url
 * @returns {string | null}
 */
export function redactDatabaseUrl(url) {
  if (!url || !String(url).trim()) return null;
  try {
    const normalized = String(url).trim().replace(/^postgres(ql)?:/, "http:");
    const parsed = new URL(normalized);
    const db = parsed.pathname?.replace(/^\//, "") || "?";
    const port = parsed.port || "5432";
    return `${parsed.hostname}:${port}/${db}`;
  } catch {
    return "(URL no parseable)";
  }
}

/**
 * @param {{ dbMode?: string, databaseUrl?: string, tunnelPort?: number }} cfg
 */
export function auditMiniDatabaseConfig({ dbMode, databaseUrl, tunnelPort = MINI_TUNNEL_PORT } = {}) {
  const hints = [];
  const issues = [];
  const redacted = redactDatabaseUrl(databaseUrl);
  const mode = String(dbMode || "").trim().toLowerCase();

  if (mode !== "pg") {
    issues.push("STATSEDGE_DB_MODE no es «pg»");
    hints.push("En .env.local define STATSEDGE_DB_MODE=pg para leer la mesa del Mini.");
  }

  if (!databaseUrl || !String(databaseUrl).trim()) {
    issues.push("DATABASE_URL ausente en .env.local");
    hints.push(`Añade DATABASE_URL apuntando al túnel local (127.0.0.1:${tunnelPort}/statsedge).`);
  } else {
    try {
      const parsed = new URL(String(databaseUrl).trim().replace(/^postgres(ql)?:/, "http:"));
      const port = Number(parsed.port || 5432);
      const host = parsed.hostname;
      const localHost = host === "127.0.0.1" || host === "localhost" || host === "::1";
      if (!localHost) {
        issues.push(`DATABASE_URL no apunta a localhost (visto: ${redacted})`);
        hints.push(`Con túnel Mini activo, DATABASE_URL debe usar 127.0.0.1:${tunnelPort}.`);
      } else if (port !== tunnelPort) {
        issues.push(`DATABASE_URL usa puerto ${port}, no el túnel :${tunnelPort} (visto: ${redacted})`);
        hints.push(`Ajusta DATABASE_URL a …@127.0.0.1:${tunnelPort}/statsedge`);
      }
    } catch {
      issues.push("DATABASE_URL no parseable");
      hints.push("Revisa el formato postgresql://usuario@127.0.0.1:15432/statsedge en .env.local");
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    hints,
    redacted,
    dbMode: mode || null,
  };
}

export function nextStartCommand(port = MINI_APP_PORT) {
  return `PORT=${port} ./node_modules/.bin/next start -p ${port} >> /tmp/statsedge-${port}.log 2>&1 &`;
}

/**
 * @param {{ stage: string, message: string, hint?: string, command?: string }} item
 */
export function formatPreflightLine(item) {
  const lines = [`✗ ${item.message}`];
  if (item.hint) lines.push(`  → ${item.hint}`);
  if (item.command) lines.push(`  → ${item.command}`);
  return lines.join("\n");
}

/**
 * @param {{ ok: boolean, stage?: string, checks: Record<string, unknown>, failures: Array<{ stage: string, message: string, hint?: string, command?: string }> }} result
 */
export function formatPreflightReport(result) {
  if (result.ok) {
    const tunnel = result.checks?.tunnel;
    const env = result.checks?.env;
    const app = result.checks?.app;
    const lines = [
      "✓ Preflight Mini OK",
      `  · Túnel Postgres :${tunnel?.port ?? MINI_TUNNEL_PORT} escuchando${tunnel?.started ? " (arrancado ahora)" : ""}`,
    ];
    if (env?.redacted) lines.push(`  · DATABASE_URL → ${env.redacted}`);
    if (app?.httpStatus) lines.push(`  · Next ${MINI_APP_BASE} HTTP ${app.httpStatus}`);
    return lines.join("\n");
  }

  const lines = ["✗ Preflight Mini FALLÓ", ""];
  for (const failure of result.failures) {
    lines.push(formatPreflightLine(failure));
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

/**
 * Read selected keys from .env.local without printing secrets.
 * @param {string} [envPath]
 */
export function readEnvLocalHints(envPath = path.join(process.cwd(), ".env.local")) {
  if (!fs.existsSync(envPath)) {
    return { exists: false, dbMode: null, databaseUrl: null, path: envPath };
  }
  const vars = {};
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^(STATSEDGE_DB_MODE|DATABASE_URL)\s*=\s*(.*)$/);
    if (!match) continue;
    const value = match[2].trim().replace(/^['"]|['"]$/g, "");
    vars[match[1]] = value;
  }
  return {
    exists: true,
    path: envPath,
    dbMode: vars.STATSEDGE_DB_MODE || null,
    databaseUrl: vars.DATABASE_URL || null,
  };
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

/**
 * @param {{ startTunnel?: boolean, envPath?: string, base?: string }} opts
 */
export async function runMiniPreflight({
  startTunnel = false,
  envPath = path.join(process.cwd(), ".env.local"),
  base = MINI_APP_BASE,
} = {}) {
  const failures = [];
  const checks = {};
  const url = new URL(base);
  const appPort = Number(url.port || MINI_APP_PORT);
  const appHost = url.hostname || MINI_APP_HOST;

  const tunnel = await ensureMiniTunnel({ start: startTunnel });
  checks.tunnel = tunnel;
  if (!tunnel.ok) {
    failures.push({
      stage: "tunnel",
      message: `Túnel Postgres del Mini no escucha en 127.0.0.1:${tunnel.port}`,
      hint: "Arranca el forward SSH al Mac Mini antes del smoke.",
      command: tunnel.command || tunnelCommand(),
    });
  }

  const envFile = readEnvLocalHints(envPath);
  checks.envFile = { exists: envFile.exists, path: envFile.path };
  const envAudit = auditMiniDatabaseConfig({
    dbMode: envFile.dbMode,
    databaseUrl: envFile.databaseUrl,
    tunnelPort: MINI_TUNNEL_PORT,
  });
  checks.env = envAudit;
  if (!envFile.exists) {
    failures.push({
      stage: "env",
      message: "Falta .env.local en la raíz del repo",
      hint: "Copia la plantilla local con STATSEDGE_DB_MODE=pg, DATABASE_URL y STATSEDGE_ACCESS_TOKEN.",
    });
  } else if (!envAudit.ok) {
    for (let i = 0; i < envAudit.issues.length; i += 1) {
      failures.push({
        stage: "env",
        message: envAudit.issues[i],
        hint: envAudit.hints[i] || envAudit.hints[0],
      });
    }
  }

  const portOpen = await isPortOpen(appHost, appPort);
  checks.app = { host: appHost, port: appPort, portOpen, base };
  if (!portOpen) {
    failures.push({
      stage: "app",
      message: `Next aislado no escucha en ${appHost}:${appPort}`,
      hint: "No uses :3000 del dueño; levanta una instancia en :3300.",
      command: nextStartCommand(appPort),
    });
  } else {
    const probe = await httpProbe(`${base}/`, PRECHECK_MS);
    checks.app.httpStatus = probe.status;
    checks.app.httpOk = probe.ok;
    if (!probe.ok) {
      failures.push({
        stage: "app",
        message: `HTTP ${base}/ no responde (${probe.error || `status ${probe.status}`})`,
        hint: "Revisa /tmp/statsedge-3300.log o reinicia next start -p 3300.",
        command: nextStartCommand(appPort),
      });
    }
  }

  const ok = failures.length === 0;
  const stage = ok ? "preflight" : failures[0]?.stage || "preflight";
  return { ok, stage, checks, failures };
}

async function main() {
  const startTunnel = process.argv.includes("--start-tunnel");
  const json = process.argv.includes("--json");
  const result = await runMiniPreflight({ startTunnel });

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatPreflightReport(result));
  }
  process.exit(result.ok ? 0 : 1);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main().catch((error) => {
    console.error(`FAIL ${error.message}`);
    process.exit(1);
  });
}
