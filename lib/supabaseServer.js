import { envValue } from "@/lib/env";
import { requireInternalAuth } from "@/lib/internalAuth";

const DEFAULT_OWNER = "personal";

function cleanUrl(url = "") {
  return String(url || "").trim().replace(/\/+$/, "");
}

function isPgMode() {
  return envValue("STATSEDGE_DB_MODE") === "pg" && Boolean(envValue("DATABASE_URL"));
}

// Import dinámico: `pg` es Node-only y no puede entrar en el bundle del navegador
// (page → cloudSyncClient → materializedScanLookup → supabaseServer).
async function loadPgAdapter() {
  return import("@/lib/pgPostgrestAdapter");
}

export function supabaseConfig() {
  const url = cleanUrl(envValue("SUPABASE_URL") || envValue("NEXT_PUBLIC_SUPABASE_URL"));
  const key = envValue("SUPABASE_SERVICE_ROLE_KEY");
  const ownerId = envValue("STATSEDGE_OWNER_ID") || DEFAULT_OWNER;
  const databaseUrl = envValue("DATABASE_URL");
  const mode = isPgMode() ? "pg" : "postgrest";

  if (mode === "pg") {
    return {
      url,
      key,
      ownerId,
      configured: true,
      missing: [],
      mode,
      databaseUrl,
    };
  }

  const missing = [];
  if (!url) missing.push("SUPABASE_URL o NEXT_PUBLIC_SUPABASE_URL");
  if (!key) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  return { url, key, ownerId, configured: Boolean(url && key), missing, mode, databaseUrl };
}

// Delegado en lib/internalAuth para que toda la superficie /api comparta una
// única política de tokens y un 401 uniforme.
export function requirePersistenceAuth(req) {
  return requireInternalAuth(req);
}

export function disabledPayload() {
  const config = supabaseConfig();
  return {
    configured: false,
    skipped: true,
    missing: config.missing,
    // Este texto lo devuelven las rutas /api cuando la nube está apagada y el
    // cliente lo enseña tal cual: sin nombre de servicio ni jerga de navegador.
    message: "La copia en la nube no está activada. La app sigue funcionando con los datos de este dispositivo.",
  };
}

function qs(query = {}) {
  if (typeof query === "string") return query.replace(/^\?/, "");
  return new URLSearchParams(query).toString();
}

export async function supabaseRequest(path, options = {}) {
  const config = supabaseConfig();
  if (!config.configured) {
    const error = new Error("La copia en la nube no está activada");
    error.code = "SUPABASE_DISABLED";
    error.details = config.missing;
    throw error;
  }
  if (config.mode === "pg") {
    const normalizedPath = String(path || "").replace(/^\/+/, "");
    if (!normalizedPath || normalizedPath.startsWith("rpc/")) {
      const rpcName = normalizedPath.replace(/^rpc\//, "") || "unknown";
      const error = new Error(`RPC ${rpcName} no disponible en modo pg local (solo lecturas GET)`);
      error.code = "PG_RPC_UNSUPPORTED";
      throw error;
    }
    const { getPgPool, pgRequest: runPgRequest } = await loadPgAdapter();
    const pool = await getPgPool(config.databaseUrl);
    const data = await runPgRequest(pool, normalizedPath, options);
    return data === null ? null : data;
  }
  const query = qs(options.query || "");
  const url = `${config.url}/rest/v1/${path.replace(/^\/+/, "")}${query ? `?${query}` : ""}`;
  const timeoutMs = Number(options.timeoutMs || 0);
  const signal = options.signal || (timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined);
  const res = await fetch(url, {
    method: options.method || "GET",
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      "Content-Type": "application/json",
      ...(options.prefer ? { Prefer: options.prefer } : {}),
      ...(options.headers || {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store",
    signal,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text ? { message: text } : null;
  }
  if (!res.ok) {
    const error = new Error(data?.message || data?.hint || `Base de datos HTTP ${res.status}`);
    error.status = res.status;
    error.details = data;
    throw error;
  }
  return data;
}

export async function supabaseRpc(functionName, payload = {}, options = {}) {
  return supabaseRequest(`rpc/${functionName}`, {
    method: "POST",
    ...options,
    body: payload,
  });
}

function withoutPaging(query = "") {
  return String(query || "")
    .replace(/^\?/, "")
    .split("&")
    .filter((part) => part && !/^limit=/i.test(part) && !/^offset=/i.test(part))
    .join("&");
}

export async function supabaseRequestAll(path, options = {}, paging = {}) {
  const maxRows = Math.min(Math.max(Number(paging.maxRows || options.maxRows || 10000), 1), 50000);
  const pageSize = Math.min(Math.max(Number(paging.pageSize || 1000), 1), 1000);
  const base = withoutPaging(qs(options.query || ""));
  const rows = [];
  for (let offset = 0; rows.length < maxRows; offset += pageSize) {
    const limit = Math.min(pageSize, maxRows - rows.length);
    const query = `${base}${base ? "&" : ""}limit=${limit}&offset=${offset}`;
    const page = await supabaseRequest(path, { ...options, query });
    if (!Array.isArray(page)) return rows.length ? rows : page;
    rows.push(...page);
    if (page.length < limit) break;
  }
  return rows;
}

export async function supabaseCount(path, options = {}) {
  const config = supabaseConfig();
  if (!config.configured) {
    const error = new Error("La copia en la nube no está activada");
    error.code = "SUPABASE_DISABLED";
    error.details = config.missing;
    throw error;
  }
  if (config.mode === "pg") {
    const normalizedPath = String(path || "").replace(/^\/+/, "");
    const { getPgPool, pgCount: runPgCount } = await loadPgAdapter();
    const pool = await getPgPool(config.databaseUrl);
    return runPgCount(pool, normalizedPath, options);
  }
  const query = qs(options.query || "");
  const url = `${config.url}/rest/v1/${path.replace(/^\/+/, "")}${query ? `?${query}` : ""}`;
  const timeoutMs = Number(options.timeoutMs || 0);
  const signal = options.signal || (timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined);
  const res = await fetch(url, {
    method: "GET",
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      "Content-Type": "application/json",
      Prefer: "count=exact",
      Range: "0-0",
      ...(options.headers || {}),
    },
    cache: "no-store",
    signal,
  });
  if (!res.ok) {
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text ? { message: text } : null;
    }
    const error = new Error(data?.message || data?.hint || `Base de datos HTTP ${res.status}`);
    error.status = res.status;
    error.details = data;
    throw error;
  }
  const range = res.headers.get("content-range") || "";
  const total = Number(range.split("/").pop());
  return Number.isFinite(total) ? total : 0;
}

export function finiteOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function textOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

export function toDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}

export function toTimestamp(value) {
  if (!value) return new Date().toISOString();
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}
