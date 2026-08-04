#!/usr/bin/env node
// Servidor MCP de SOLO LECTURA contra PostgREST de Supabase.
// No existe ninguna ruta de código que escriba. Solo emite GET.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ENV_PATH = process.env.STATSEDGE_ENV_PATH || resolve(process.cwd(), ".env.local");

function loadEnv(path) {
  const out = {};
  let raw = "";
  try { raw = readFileSync(path, "utf8"); } catch { throw new Error(`No pude leer ${path}`); }
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!match) continue;
    out[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, "");
  }
  return out;
}

const env = loadEnv(ENV_PATH);
const BASE_URL = env.SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!BASE_URL || !KEY) throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local");

const TABLES = new Set([
  "scans", "scan_results", "scan_symbol_history", "symbol_resolutions",
  "shadow_instruments", "app_settings", "favorites", "provider_runs",
  "scan_executions", "scan_result_sets", "scan_work_items", "scan_result_set_rows",
  "universe_snapshots", "universe_snapshot_symbols",
]);

const MAX_LIMIT = 200;

async function queryTable({ table, select, filter, order, limit }) {
  if (!TABLES.has(table)) throw new Error(`Tabla no permitida: ${table}. Permitidas: ${[...TABLES].join(", ")}`);
  const params = new URLSearchParams();
  params.set("select", select || "*");
  if (order) params.set("order", order);
  params.set("limit", String(Math.min(Number(limit) || 20, MAX_LIMIT)));
  let query = params.toString();
  if (filter) {
    if (/[\r\n]/.test(filter)) throw new Error("filter no puede contener saltos de línea");
    query += `&${filter}`;
  }
  const url = `${BASE_URL.replace(/\/$/, "")}/rest/v1/${table}?${query}`;
  const response = await fetch(url, {
    method: "GET",
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Accept: "application/json" },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`PostgREST ${response.status}: ${text.slice(0, 500)}`);
  return text;
}

const TOOL = {
  name: "supabase_query",
  description: "Consulta de SOLO LECTURA contra las tablas de StatsEdge en Supabase (PostgREST). No puede escribir, borrar ni ejecutar SQL arbitrario. Tablas permitidas: " + [...TABLES].join(", ") + ".",
  inputSchema: {
    type: "object",
    properties: {
      table: { type: "string", description: "Nombre de la tabla (debe estar en la lista permitida)" },
      select: { type: "string", description: "Columnas PostgREST, p.ej. 'symbol,total_score' o '*'. Por defecto '*'." },
      filter: { type: "string", description: "Filtros PostgREST crudos concatenados con &, p.ej. symbol=eq.AAPL&status=eq.priced. Operadores: eq, neq, gt, gte, lt, lte, like, ilike, is, in." },
      order: { type: "string", description: "Orden, p.ej. 'created_at.desc'" },
      limit: { type: "number", description: "Máximo de filas (tope 200, por defecto 20)" },
    },
    required: ["table"],
  },
};

function send(message) { process.stdout.write(`${JSON.stringify(message)}\n`); }

async function handle(request) {
  const { id, method, params } = request;
  if (method === "initialize") {
    return { jsonrpc: "2.0", id, result: {
      protocolVersion: params?.protocolVersion || "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "supabase-readonly", version: "1.0.0" },
    } };
  }
  if (method === "tools/list") return { jsonrpc: "2.0", id, result: { tools: [TOOL] } };
  if (method === "tools/call") {
    if (params?.name !== TOOL.name) return { jsonrpc: "2.0", id, error: { code: -32601, message: `Herramienta desconocida: ${params?.name}` } };
    try {
      const rows = await queryTable(params.arguments || {});
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: rows }] } };
    } catch (error) {
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `ERROR: ${error.message}` }], isError: true } };
    }
  }
  if (method === "ping") return { jsonrpc: "2.0", id, result: {} };
  return { jsonrpc: "2.0", id, error: { code: -32601, message: `Método no soportado: ${method}` } };
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", async (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    let request;
    try { request = JSON.parse(line); } catch { continue; }
    if (request.id === undefined) continue;
    send(await handle(request));
  }
});
