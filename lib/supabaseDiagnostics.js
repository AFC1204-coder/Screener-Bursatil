import { disabledPayload, supabaseConfig, supabaseRequest, supabaseRpc } from "@/lib/supabaseServer";

export const REQUIRED_SUPABASE_TABLES = [
  { name: "scans", area: "core" },
  { name: "scan_results", area: "core" },
  { name: "favorites", area: "core" },
  { name: "favorite_snapshots", area: "core" },
  { name: "notes", area: "core" },
  { name: "alerts", area: "core" },
  { name: "company_profiles", area: "core" },
  { name: "universe_snapshots", area: "coverage-cache" },
  { name: "universe_snapshot_symbols", area: "coverage-cache" },
  { name: "daily_bars", area: "market-data-cache" },
  { name: "fundamental_snapshots", area: "fundamentals-cache" },
  { name: "shadow_instruments", area: "shadow-universe" },
  { name: "symbol_resolutions", area: "shadow-universe" },
  { name: "provider_runs", area: "ops" },
  { name: "app_settings", area: "settings" },
  { name: "leaderboard_snapshots", area: "derived-products" },
  { name: "leaderboard_items", area: "derived-products" },
  { name: "rs_weekly_snapshots", area: "derived-products" },
  { name: "rs_weekly_items", area: "derived-products" },
];

export const REQUIRED_SUPABASE_FUNCTIONS = [
  { name: "upsert_scan_newer_wins", area: "sync", payload: (config) => ({ p_owner_id: config.ownerId, p_scan: null, p_results: [] }) },
  { name: "delete_scan_newer_wins", area: "sync", payload: (config) => ({ p_owner_id: config.ownerId, p_local_id: null, p_deleted_at: new Date().toISOString() }) },
  { name: "upsert_favorites_newer_wins", area: "sync", payload: (config) => ({ p_owner_id: config.ownerId, p_favorites: [] }) },
  { name: "delete_favorite_newer_wins", area: "sync", payload: (config) => ({ p_owner_id: config.ownerId, p_symbol: null, p_local_id: null, p_deleted_at: new Date().toISOString() }) },
  { name: "upsert_alerts_newer_wins", area: "sync", payload: (config) => ({ p_owner_id: config.ownerId, p_alerts: [] }) },
  { name: "update_alert_status_newer_wins", area: "sync", payload: (config) => ({ p_owner_id: config.ownerId, p_cloud_id: null, p_local_id: null, p_status: "resolved", p_payload: {}, p_updated_at: new Date().toISOString() }) },
  { name: "upsert_app_setting_newer_wins", area: "settings", payload: (config) => ({ p_owner_id: config.ownerId, p_setting_type: null, p_setting_key: null, p_value: null, p_updated_at: new Date().toISOString() }) },
];

function statusForError(error = {}) {
  const code = error.details?.code;
  if (error.status === 404 || code === "PGRST205" || code === "PGRST202") return "missing";
  if (error.status === 401 || error.status === 403) return "permission-error";
  return "error";
}

export async function checkSupabaseSchema() {
  const config = supabaseConfig();
  if (!config.configured) {
    return {
      ...disabledPayload(),
      schemaReady: false,
      tables: REQUIRED_SUPABASE_TABLES.map((table) => ({ ...table, status: "skipped" })),
      functions: REQUIRED_SUPABASE_FUNCTIONS.map((fn) => ({ ...fn, status: "skipped" })),
    };
  }

  const tables = [];
  for (const table of REQUIRED_SUPABASE_TABLES) {
    try {
      await supabaseRequest(table.name, { query: "select=id&limit=1" });
      tables.push({ ...table, status: "ok" });
    } catch (error) {
      tables.push({
        ...table,
        status: statusForError(error),
        httpStatus: error.status || null,
        message: error.message || "Supabase table check failed",
        details: error.details || null,
      });
    }
  }

  const functions = [];
  for (const fn of REQUIRED_SUPABASE_FUNCTIONS) {
    try {
      await supabaseRpc(fn.name, fn.payload ? fn.payload(config) : {});
      functions.push({ name: fn.name, area: fn.area, status: "ok" });
    } catch (error) {
      functions.push({
        name: fn.name,
        area: fn.area,
        status: statusForError(error),
        httpStatus: error.status || null,
        message: error.message || "Supabase function check failed",
        details: error.details || null,
      });
    }
  }

  const missing = tables.filter((table) => table.status === "missing").map((table) => table.name);
  const missingFunctions = functions.filter((fn) => fn.status === "missing").map((fn) => fn.name);
  const permissionErrors = tables.filter((table) => table.status === "permission-error").map((table) => table.name);
  const functionPermissionErrors = functions.filter((fn) => fn.status === "permission-error").map((fn) => fn.name);
  const errors = tables.filter((table) => table.status === "error").map((table) => table.name);
  const functionErrors = functions.filter((fn) => fn.status === "error").map((fn) => fn.name);
  return {
    configured: true,
    ok: missing.length === 0 && missingFunctions.length === 0 && permissionErrors.length === 0 && functionPermissionErrors.length === 0 && errors.length === 0 && functionErrors.length === 0,
    schemaReady: missing.length === 0 && missingFunctions.length === 0,
    ownerId: config.ownerId,
    missing,
    missingFunctions,
    permissionErrors,
    functionPermissionErrors,
    errors,
    functionErrors,
    tables,
    functions,
    message: missing.length
      ? `Supabase conectado, pero faltan tablas: ${missing.join(", ")}.`
      : missingFunctions.length
        ? `Supabase conectado, pero faltan funciones RPC: ${missingFunctions.join(", ")}.`
      : "Supabase conectado y schema esperado disponible.",
  };
}
