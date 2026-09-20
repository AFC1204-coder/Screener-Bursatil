#!/usr/bin/env node
/**
 * OPS-MINI-SMOKE-1 — check / optional start of SSH tunnel to Mac Mini Postgres (:15432).
 *
 * If the port already listens, exits 0 without touching any existing ssh process.
 *
 * Env overrides:
 *   STATSEDGE_MINI_TUNNEL_PORT   (default 15432)
 *   STATSEDGE_MINI_SSH_HOST      (default 192.168.0.116)
 *   STATSEDGE_MINI_SSH_USER      (default cristian)
 *   STATSEDGE_MINI_SSH_TARGET    (default 127.0.0.1:5432)
 */
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const TUNNEL_PORT = Number(process.env.STATSEDGE_MINI_TUNNEL_PORT || 15432);
const SSH_HOST = process.env.STATSEDGE_MINI_SSH_HOST || "192.168.0.116";
const SSH_USER = process.env.STATSEDGE_MINI_SSH_USER || "cristian";
const SSH_TARGET = process.env.STATSEDGE_MINI_SSH_TARGET || "127.0.0.1:5432";
const CONNECT_TIMEOUT_MS = Number(process.env.STATSEDGE_MINI_CONNECT_TIMEOUT_MS || 2000);
const START_WAIT_MS = Number(process.env.STATSEDGE_MINI_START_WAIT_MS || 4000);

export function tunnelCommand() {
  return `ssh -f -N -L ${TUNNEL_PORT}:${SSH_TARGET} ${SSH_USER}@${SSH_HOST}`;
}

export function isPortOpen(host, port, timeoutMs = CONNECT_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (open) => {
      socket.removeAllListeners();
      try { socket.destroy(); } catch { /* noop */ }
      resolve(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

async function waitForPort(host, port, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isPortOpen(host, port, 800)) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

function spawnTunnel() {
  const [targetHost, targetPort] = SSH_TARGET.split(":");
  const args = [
    "-f",
    "-N",
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=8",
    "-L", `${TUNNEL_PORT}:${targetHost}:${targetPort}`,
    `${SSH_USER}@${SSH_HOST}`,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn("ssh", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stderr });
      else reject(new Error(stderr.trim() || `ssh exited ${code}`));
    });
  });
}

/**
 * @param {{ start?: boolean }} opts
 * @returns {Promise<{ ok: boolean, listening: boolean, started: boolean, port: number, command: string, error?: string }>}
 */
export async function ensureMiniTunnel({ start = false } = {}) {
  const host = "127.0.0.1";
  const command = tunnelCommand();
  const listening = await isPortOpen(host, TUNNEL_PORT);
  if (listening) {
    return { ok: true, listening: true, started: false, port: TUNNEL_PORT, command };
  }
  if (!start) {
    return {
      ok: false,
      listening: false,
      started: false,
      port: TUNNEL_PORT,
      command,
      error: `Mini tunnel not listening on ${host}:${TUNNEL_PORT}. Run: ${command}`,
    };
  }
  try {
    await spawnTunnel();
  } catch (error) {
    return {
      ok: false,
      listening: false,
      started: false,
      port: TUNNEL_PORT,
      command,
      error: `Failed to start tunnel: ${error.message}`,
    };
  }
  const up = await waitForPort(host, TUNNEL_PORT, START_WAIT_MS);
  if (!up) {
    return {
      ok: false,
      listening: false,
      started: true,
      port: TUNNEL_PORT,
      command,
      error: `ssh launched but ${host}:${TUNNEL_PORT} still closed after ${START_WAIT_MS}ms`,
    };
  }
  return { ok: true, listening: true, started: true, port: TUNNEL_PORT, command };
}

async function main() {
  const start = process.argv.includes("--start");
  const json = process.argv.includes("--json");
  const result = await ensureMiniTunnel({ start });
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    console.log(result.started
      ? `OK Mini tunnel started on 127.0.0.1:${result.port}`
      : `OK Mini tunnel already listening on 127.0.0.1:${result.port}`);
  } else {
    console.error(`FAIL ${result.error}`);
    console.error(`Hint: ${result.command}`);
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
