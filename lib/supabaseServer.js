const DEFAULT_OWNER = "personal";

function cleanUrl(url = "") {
  return String(url || "").trim().replace(/\/+$/, "");
}

export function supabaseConfig() {
  const url = cleanUrl(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const ownerId = process.env.STATSEDGE_OWNER_ID || DEFAULT_OWNER;
  const missing = [];
  if (!url) missing.push("SUPABASE_URL o NEXT_PUBLIC_SUPABASE_URL");
  if (!key) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  return { url, key, ownerId, configured: Boolean(url && key), missing };
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
