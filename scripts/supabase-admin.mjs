import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const ENV_FILES = [".env.local", ".env"];
const SCHEMA_PATH = path.join(ROOT, "supabase", "schema.sql");
const MANAGEMENT_API = "https://api.supabase.com/v1";
const REQUIRED_TABLES = [
  ["scans", "core"],
  ["scan_results", "core"],
  ["favorites", "core"],
  ["favorite_snapshots", "core"],
  ["notes", "core"],
  ["alerts", "core"],
  ["company_profiles", "core"],
  ["universe_snapshots", "coverage-cache"],
  ["universe_snapshot_symbols", "coverage-cache"],
  ["daily_bars", "market-data-cache"],
  ["fundamental_snapshots", "fundamentals-cache"],
  ["shadow_instruments", "shadow-universe"],
  ["symbol_resolutions", "shadow-universe"],
  ["provider_runs", "ops"],
  ["app_settings", "settings"],
  ["leaderboard_snapshots", "derived-products"],
  ["leaderboard_items", "derived-products"],
  ["rs_weekly_snapshots", "derived-products"],
  ["rs_weekly_items", "derived-products"],
];
const REQUIRED_FUNCTIONS = [
  ["upsert_scan_newer_wins", "sync", (config) => ({ p_owner_id: config.ownerId, p_scan: null, p_results: [] })],
  ["delete_scan_newer_wins", "sync", (config) => ({ p_owner_id: config.ownerId, p_local_id: null, p_deleted_at: new Date().toISOString() })],
  ["upsert_favorites_newer_wins", "sync", (config) => ({ p_owner_id: config.ownerId, p_favorites: [] })],
  ["delete_favorite_newer_wins", "sync", (config) => ({ p_owner_id: config.ownerId, p_symbol: null, p_local_id: null, p_deleted_at: new Date().toISOString() })],
  ["upsert_alerts_newer_wins", "sync", (config) => ({ p_owner_id: config.ownerId, p_alerts: [] })],
  ["update_alert_status_newer_wins", "sync", (config) => ({ p_owner_id: config.ownerId, p_cloud_id: null, p_local_id: null, p_status: "resolved", p_payload: {}, p_updated_at: new Date().toISOString() })],
  ["upsert_app_setting_newer_wins", "settings", (config) => ({ p_owner_id: config.ownerId, p_setting_type: null, p_setting_key: null, p_value: null, p_updated_at: new Date().toISOString() })],
];

function loadEnv() {
  for (const file of ENV_FILES) {
    const fullPath = path.join(ROOT, file);
    if (!fs.existsSync(fullPath)) continue;
    const raw = fs.readFileSync(fullPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const index = trimmed.indexOf("=");
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

function cleanUrl(url = "") {
  return String(url || "").trim().replace(/\/+$/, "");
}

function getConfig() {
  const url = cleanUrl(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const accessToken = String(process.env.SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_MANAGEMENT_TOKEN || "").trim();
  const projectRef = String(process.env.SUPABASE_PROJECT_REF || deriveProjectRef(url) || "").trim();
  const ownerId = String(process.env.STATSEDGE_OWNER_ID || "personal").trim() || "personal";
  return { url, serviceKey, accessToken, projectRef, ownerId };
}

function deriveProjectRef(url) {
  try {
    const host = new URL(url).hostname;
    if (!host.endsWith(".supabase.co")) return "";
    return host.split(".")[0] || "";
  } catch {
    return "";
  }
}

function mask(value = "") {
  const text = String(value || "");
  if (!text) return "missing";
  if (text.length <= 12) return "set";
  return `${text.slice(0, 6)}...${text.slice(-4)}`;
}

async function readJson(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

async function restRequest(config, pathName, options = {}) {
  if (!config.url || !config.serviceKey) {
    throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.");
  }
  const res = await fetch(`${config.url}/rest/v1/${pathName}`, {
    method: options.method || "GET",
    headers: {
      apikey: config.serviceKey,
      Authorization: `Bearer ${config.serviceKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store",
  });
  const data = await readJson(res);
  return { ok: res.ok, status: res.status, data };
}

async function managementRequest(config, endpoint, body, method = "POST") {
  if (!config.projectRef) throw new Error("Falta SUPABASE_PROJECT_REF o una SUPABASE_URL valida.");
  if (!config.accessToken) throw new Error("Falta SUPABASE_ACCESS_TOKEN para usar la Management API.");
  const res = await fetch(`${MANAGEMENT_API}/projects/${config.projectRef}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await readJson(res);
  return { ok: res.ok, status: res.status, data };
}

function printConfig(config) {
  console.log("StatsEdge Supabase connector");
  console.log(`Project ref: ${config.projectRef || "missing"}`);
  console.log(`Owner id: ${config.ownerId}`);
  console.log(`SUPABASE_URL: ${config.url ? "set" : "missing"}`);
  console.log(`SERVICE_ROLE_KEY: ${mask(config.serviceKey)}`);
  console.log(`MANAGEMENT_TOKEN: ${mask(config.accessToken)}`);
}

function failureMessage(result) {
  return result?.data?.message || result?.data?.hint || JSON.stringify(result?.data || {});
}

function tableStatus(result) {
  if (result.ok) return "OK";
  if (result.status === 404 || result.data?.code === "PGRST205" || result.data?.code === "PGRST202") return "MISSING";
  if (result.status === 401 || result.status === 403) return "PERMISSION";
  return "WARN";
}

async function statusCommand(config) {
  printConfig(config);
  console.log("");

  const tableResults = [];
  try {
    for (const [table, area] of REQUIRED_TABLES) {
      const result = await restRequest(config, `${table}?select=id&limit=1`);
      tableResults.push({ table, area, result, status: tableStatus(result) });
    }
    const missing = tableResults.filter((item) => item.status === "MISSING");
    const permission = tableResults.filter((item) => item.status === "PERMISSION");
    const warn = tableResults.filter((item) => item.status === "WARN");
    console.log(`Data API tables: ${tableResults.filter((item) => item.status === "OK").length}/${REQUIRED_TABLES.length} OK.`);
    for (const item of tableResults) {
      const detail = item.status === "OK" ? "" : ` - ${failureMessage(item.result)}`;
      console.log(`${item.status} ${item.area}: public.${item.table}${detail}`);
    }
    if (missing.length) console.log(`PENDING Schema: faltan ${missing.map((item) => item.table).join(", ")}.`);
    if (permission.length) console.log(`FAIL Permissions: revisar service role key para ${permission.map((item) => item.table).join(", ")}.`);
    if (warn.length) console.log(`WARN Data API: revisar ${warn.map((item) => item.table).join(", ")}.`);
  } catch (error) {
    console.log(`FAIL Data API: ${error.message}`);
  }

  try {
    const functionResults = [];
    for (const [fn, area, payload] of REQUIRED_FUNCTIONS) {
      const result = await restRequest(config, `rpc/${fn}`, {
        method: "POST",
        body: payload ? payload(config) : {},
      });
      functionResults.push({ fn, area, result, status: tableStatus(result) });
    }
    const missing = functionResults.filter((item) => item.status === "MISSING");
    const permission = functionResults.filter((item) => item.status === "PERMISSION");
    const warn = functionResults.filter((item) => item.status === "WARN");
    console.log(`Data API RPC: ${functionResults.filter((item) => item.status === "OK").length}/${REQUIRED_FUNCTIONS.length} OK.`);
    for (const item of functionResults) {
      const detail = item.status === "OK" ? "" : ` - ${failureMessage(item.result)}`;
      console.log(`${item.status} ${item.area}: public.${item.fn}${detail}`);
    }
    if (missing.length) console.log(`PENDING Schema: faltan RPC ${missing.map((item) => item.fn).join(", ")}.`);
    if (permission.length) console.log(`FAIL Permissions: revisar grants RPC para ${permission.map((item) => item.fn).join(", ")}.`);
    if (warn.length) console.log(`WARN Data API RPC: revisar ${warn.map((item) => item.fn).join(", ")}.`);
  } catch (error) {
    console.log(`FAIL Data API RPC: ${error.message}`);
  }

  if (!config.accessToken) {
    console.log("PENDING Management API: falta SUPABASE_ACCESS_TOKEN.");
    return;
  }

  try {
    const result = await managementRequest(config, "/health?services=db&services=rest", undefined, "GET");
    if (result.ok) {
      console.log("OK Management API: proyecto alcanzable.");
    } else {
      console.log(`WARN Management API HTTP ${result.status}: ${failureMessage(result)}`);
    }
  } catch (error) {
    console.log(`FAIL Management API: ${error.message}`);
  }
}

async function schemaCommand(config) {
  printConfig(config);
  console.log("");

  if (!fs.existsSync(SCHEMA_PATH)) {
    throw new Error(`No encuentro ${path.relative(ROOT, SCHEMA_PATH)}.`);
  }

  const sql = fs.readFileSync(SCHEMA_PATH, "utf8").trim();
  if (!sql) throw new Error("supabase/schema.sql esta vacio.");
  if (!config.accessToken) {
    throw new Error("Falta SUPABASE_ACCESS_TOKEN. Crealo en Supabase Account > Access Tokens y anadelo a .env.local.");
  }

  console.log("Ejecutando supabase/schema.sql mediante Supabase Management API...");
  let result = await managementRequest(config, "/database/query", { query: sql });

  if (!result.ok && (result.status === 403 || result.status === 404 || result.status === 405)) {
    console.log(`database/query no disponible (${result.status}). Probando database/migrations...`);
    result = await managementRequest(config, "/database/migrations", {
      name: "statsedge_initial_schema",
      query: sql,
    });
  }

  if (!result.ok) {
    throw new Error(`Supabase schema HTTP ${result.status}: ${failureMessage(result)}`);
  }

  console.log("OK Schema aplicado.");
  await statusCommand(config);
}

function help() {
  console.log(`Usage:
  npm run supabase:status
  npm run supabase:schema

Required for app runtime:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  STATSEDGE_OWNER_ID=personal

Required only for schema/admin connector:
  SUPABASE_ACCESS_TOKEN
  SUPABASE_PROJECT_REF optional if SUPABASE_URL is set
`);
}

async function main() {
  loadEnv();
  const config = getConfig();
  const command = process.argv[2] || "status";

  if (command === "status") return statusCommand(config);
  if (command === "schema") return schemaCommand(config);
  if (command === "help" || command === "--help" || command === "-h") return help();

  throw new Error(`Comando desconocido: ${command}`);
}

main().catch((error) => {
  console.error(`FAIL ${error.message}`);
  process.exit(1);
});
