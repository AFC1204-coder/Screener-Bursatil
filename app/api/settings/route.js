import { disabledPayload, requirePersistenceAuth, supabaseConfig, supabaseRequest, textOrNull } from "@/lib/supabaseServer";

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
    const saved = await supabaseRequest("app_settings", {
      method: "POST",
      query: "on_conflict=owner_id,setting_type,setting_key",
      prefer: "resolution=merge-duplicates,return=representation",
      body: [{
        owner_id: config.ownerId,
        setting_type: type,
        setting_key: key,
        value,
        updated_at: new Date().toISOString(),
      }],
    });
    return Response.json({ configured: true, ok: true, setting: settingFromDb(saved[0]), saved: saved.length });
  } catch (error) {
    return Response.json({ configured: true, ok: false, error: error.message, details: error.details || null }, { status: 500 });
  }
}
