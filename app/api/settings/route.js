import { disabledPayload, requirePersistenceAuth, supabaseConfig, supabaseRequest, supabaseRpc, textOrNull, toTimestamp } from "@/lib/supabaseServer";

const DEFAULT_TYPE = "general";
const DEFAULT_KEY = "default";

function settingType(value) {
  return textOrNull(value) || DEFAULT_TYPE;
}

function settingKey(value) {
  return textOrNull(value) || DEFAULT_KEY;
}

function settingFromDb(row = {}) {
  return {
    id: row.id,
    type: row.setting_type,
    key: row.setting_key,
    value: row.value || {},
    updatedAt: row.updated_at,
  };
}

function timestampValue(value) {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

export function settingSyncSummary(rows = [], payload = {}) {
  const incomingTime = timestampValue(payload.updated_at);
  const skippedStale = incomingTime && rows.some((row) => timestampValue(row.updated_at) > incomingTime) ? 1 : 0;
  return {
    saved: Math.max(rows.length - skippedStale, 0),
    returned: rows.length,
    skippedStale,
  };
}

function settingSyncError(error = {}) {
  const code = error.details?.code;
  const message = error.message || "";
  if (code === "PGRST202" || /upsert_app_setting_newer_wins/i.test(message)) {
    return "Falta una RPC de sincronizacion de settings. Aplica supabase/schema.sql antes de sincronizar settings.";
  }
  return message || "No se pudieron sincronizar settings";
}

export async function GET(req) {
  const authError = requirePersistenceAuth(req);
  if (authError) return authError;
  const config = supabaseConfig();
  if (!config.configured) return Response.json({ ...disabledPayload(), setting: null });
  const { searchParams } = new URL(req.url);
  const type = settingType(searchParams.get("type"));
  const key = settingKey(searchParams.get("key"));
  try {
    const rows = await supabaseRequest("app_settings", {
      query: `owner_id=eq.${encodeURIComponent(config.ownerId)}&setting_type=eq.${encodeURIComponent(type)}&setting_key=eq.${encodeURIComponent(key)}&select=*&limit=1`,
    });
    return Response.json({ configured: true, ok: true, setting: rows[0] ? settingFromDb(rows[0]) : null });
  } catch (error) {
    return Response.json({ configured: true, ok: false, error: error.message, details: error.details || null }, { status: 500 });
  }
}

export async function POST(req) {
  const authError = requirePersistenceAuth(req);
  if (authError) return authError;
  const config = supabaseConfig();
  if (!config.configured) return Response.json(disabledPayload());
  try {
    const body = await req.json();
    const type = settingType(body.type || body.settingType);
    const key = settingKey(body.key || body.settingKey);
    const value = body.value && typeof body.value === "object" && !Array.isArray(body.value) ? body.value : {};
    const updatedAt = toTimestamp(body.updatedAt || body.updated_at || value.updatedAt || value.updated_at || new Date().toISOString());
    const payload = {
      owner_id: config.ownerId,
      setting_type: type,
      setting_key: key,
      value,
      updated_at: updatedAt,
    };
    const saved = await supabaseRpc("upsert_app_setting_newer_wins", {
      p_owner_id: config.ownerId,
      p_setting_type: type,
      p_setting_key: key,
      p_value: value,
      p_updated_at: updatedAt,
    });
    const summary = settingSyncSummary(saved, payload);
    return Response.json({ configured: true, ok: true, setting: saved[0] ? settingFromDb(saved[0]) : null, ...summary });
  } catch (error) {
    return Response.json({ configured: true, ok: false, error: settingSyncError(error), details: error.details || null }, { status: 500 });
  }
}
