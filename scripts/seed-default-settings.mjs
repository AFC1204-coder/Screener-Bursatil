const SUPABASE_URL = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/+$/, "");
const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const OWNER_ID = String(process.env.STATSEDGE_OWNER_ID || "personal").trim() || "personal";

const SETTING_TYPE = "screener_filters";
const SETTING_KEY = "default";

async function readJson(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

async function rest(path, options = {}) {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const data = await readJson(res);
  if (!res.ok) throw new Error(`${path}: ${data?.message || data?.hint || `HTTP ${res.status}`}`);
  return data;
}

async function main() {
  const query = new URLSearchParams({
    owner_id: `eq.${OWNER_ID}`,
    setting_type: `eq.${SETTING_TYPE}`,
    setting_key: `eq.${SETTING_KEY}`,
    select: "id,updated_at",
    limit: "1",
  });
  const existing = await rest(`app_settings?${query.toString()}`);
  if (existing?.[0]) {
    console.log(JSON.stringify({ ok: true, skipped: true, reason: "settings already exist", updatedAt: existing[0].updated_at }, null, 2));
    return;
  }

  const updatedAt = new Date().toISOString();
  const value = {
    version: 1,
    source: "bootstrap-default",
    updatedAt,
    presetKey: "balanced",
  };
  const saved = await rest("rpc/upsert_app_setting_newer_wins", {
    method: "POST",
    body: {
      p_owner_id: OWNER_ID,
      p_setting_type: SETTING_TYPE,
      p_setting_key: SETTING_KEY,
      p_value: value,
      p_updated_at: updatedAt,
    },
  });
  console.log(JSON.stringify({ ok: true, saved: saved?.length || 0, type: SETTING_TYPE, key: SETTING_KEY, updatedAt }, null, 2));
}

main().catch((error) => {
  console.error(`FAIL seed-default-settings: ${error.message}`);
  process.exitCode = 1;
});
