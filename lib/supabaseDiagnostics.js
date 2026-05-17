import { disabledPayload, supabaseConfig, supabaseRequest } from "@/lib/supabaseServer";

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
  { name: "provider_runs", area: "ops" },
];

function statusForError(error = {}) {
  const code = error.details?.code;
  if (error.status === 404 || code === "PGRST205") return "missing";
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

  const missing = tables.filter((table) => table.status === "missing").map((table) => table.name);
  const permissionErrors = tables.filter((table) => table.status === "permission-error").map((table) => table.name);
  const errors = tables.filter((table) => table.status === "error").map((table) => table.name);
  return {
    configured: true,
    ok: missing.length === 0 && permissionErrors.length === 0 && errors.length === 0,
    schemaReady: missing.length === 0,
    ownerId: config.ownerId,
    missing,
    permissionErrors,
    errors,
    tables,
    message: missing.length
      ? `Supabase conectado, pero faltan tablas: ${missing.join(", ")}.`
      : "Supabase conectado y schema esperado disponible.",
  };
}
