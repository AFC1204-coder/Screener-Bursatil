import { envValue } from "@/lib/env";

const DEFAULT_OWNER = "personal";

function cleanUrl(url = "") {
  return String(url || "").trim().replace(/\/+$/, "");
}

export function supabaseConfig() {
  const url = cleanUrl(envValue("SUPABASE_URL") || envValue("NEXT_PUBLIC_SUPABASE_URL"));
  const key = envValue("SUPABASE_SERVICE_ROLE_KEY");
  const ownerId = envValue("STATSEDGE_OWNER_ID") || DEFAULT_OWNER;
  const missing = [];
  if (!url) missing.push("SUPABASE_URL o NEXT_PUBLIC_SUPABASE_URL");
  if (!key) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  return { url, key, ownerId, configured: Boolean(url && key), missing };
}

function persistenceApiToken() {
  const token = envValue("STATSEDGE_API_TOKEN") || envValue("STATSEDGE_ADMIN_TOKEN");
  return token || null;
}

function bearerToken(value = "") {
  const match = String(value || "").match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

export function requirePersistenceAuth(req) {
  const expected = persistenceApiToken();
  if (!expected) return null;
  const provided = req?.headers?.get("x-statsedge-token") || bearerToken(req?.headers?.get("authorization"));
  if (provided === expected) return null;
  return Response.json({ configured: true, ok: false, authRequired: true, error: "No autorizado" }, { status: 401 });
}

export function disabledPayload() {
  const config = supabaseConfig();
  return {
    configured: false,
    skipped: true,
    missing: config.missing,
    message: "Supabase no configurado. La app sigue funcionando con localStorage.",
  };
}

function qs(query = {}) {
  if (typeof query === "string") return query.replace(/^\?/, "");
  return new URLSearchParams(query).toString();
}

export async function supabaseRequest(path, options = {}) {
  const config = supabaseConfig();
  if (!config.configured) {
    const error = new Error("Supabase no configurado");
    error.code = "SUPABASE_DISABLED";
    error.details = config.missing;
    throw error;
  }
  const query = qs(options.query || "");
  const url = `${config.url}/rest/v1/${path.replace(/^\/+/, "")}${query ? `?${query}` : ""}`;
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
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text ? { message: text } : null;
  }
  if (!res.ok) {
    const error = new Error(data?.message || data?.hint || `Supabase HTTP ${res.status}`);
    error.status = res.status;
    error.details = data;
    throw error;
  }
  return data;
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
    const error = new Error("Supabase no configurado");
    error.code = "SUPABASE_DISABLED";
    error.details = config.missing;
    throw error;
  }
  const query = qs(options.query || "");
  const url = `${config.url}/rest/v1/${path.replace(/^\/+/, "")}${query ? `?${query}` : ""}`;
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
  });
  if (!res.ok) {
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text ? { message: text } : null;
    }
    const error = new Error(data?.message || data?.hint || `Supabase HTTP ${res.status}`);
    error.status = res.status;
    error.details = data;
    throw error;
  }
  const range = res.headers.get("content-range") || "";
  const total = Number(range.split("/").pop());
  return Number.isFinite(total) ? total : 0;
}

export function finiteOrNull(value) {
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
