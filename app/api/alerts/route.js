import { disabledPayload, finiteOrNull, requirePersistenceAuth, supabaseConfig, supabaseRequest, textOrNull, toTimestamp } from "@/lib/supabaseServer";

function alertLocalId(alert = {}) {
  return textOrNull(alert.localId || alert.payload?.localId || alert.id) || crypto.randomUUID();
}

function isUuid(value = "") {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function alertPayload(alert = {}, ownerId) {
  const localId = alertLocalId(alert);
  return {
    owner_id: ownerId,
    local_id: localId,
    symbol: textOrNull(alert.symbol)?.toUpperCase() || "-",
    alert_type: textOrNull(alert.alertType || alert.alert_type) || "methodology_event",
    operator: textOrNull(alert.operator),
    threshold: finiteOrNull(alert.threshold),
    payload: {
      ...(alert.payload || {}),
      localId,
    },
    status: textOrNull(alert.status) || "active",
    created_at: toTimestamp(alert.createdAt || alert.created_at),
    triggered_at: alert.triggeredAt || alert.triggered_at ? toTimestamp(alert.triggeredAt || alert.triggered_at) : null,
  };
}

function alertFromDb(row = {}) {
  const localId = row.local_id || row.payload?.localId || row.id;
  return {
    id: localId,
    cloudId: row.id,
    symbol: row.symbol,
    alertType: row.alert_type,
    operator: row.operator,
    threshold: finiteOrNull(row.threshold),
    payload: { ...(row.payload || {}), localId },
    status: row.status || "active",
    createdAt: row.created_at,
    triggeredAt: row.triggered_at,
  };
}

function uniqByLocalId(alerts = []) {
  const seen = new Set();
  const out = [];
  for (const alert of alerts) {
    const key = alert.id || alert.localId || alert.payload?.localId || alert.cloudId;
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(alert);
  }
  return out;
}

export async function GET(req) {
  const authError = requirePersistenceAuth(req);
  if (authError) return authError;
  const config = supabaseConfig();
  if (!config.configured) return Response.json({ ...disabledPayload(), alerts: [] });
  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit") || 250), 500);
  const status = searchParams.get("status") || "active";
  const symbol = searchParams.get("symbol");
  const filters = [`owner_id=eq.${encodeURIComponent(config.ownerId)}`];
  if (status !== "all") filters.push(`status=eq.${encodeURIComponent(status)}`);
  if (symbol) filters.push(`symbol=eq.${encodeURIComponent(symbol.toUpperCase())}`);
  try {
    const rows = await supabaseRequest("alerts", {
      query: `${filters.join("&")}&select=*&order=triggered_at.desc.nullslast,created_at.desc&limit=${limit}`,
    });
    return Response.json({ configured: true, ok: true, alerts: uniqByLocalId(rows.map(alertFromDb)) });
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
    const alerts = body.alerts || (body.alert ? [body.alert] : []);
    if (!alerts.length) return Response.json({ configured: true, ok: true, saved: 0, alerts: [] });
    const saved = await supabaseRequest("alerts", {
      method: "POST",
      query: "on_conflict=owner_id,local_id",
      prefer: "resolution=merge-duplicates,return=representation",
      body: alerts.map((alert) => alertPayload(alert, config.ownerId)),
    });
    return Response.json({ configured: true, ok: true, saved: saved.length, alerts: saved.map(alertFromDb) });
  } catch (error) {
    return Response.json({ configured: true, ok: false, error: error.message, details: error.details || null }, { status: 500 });
  }
}

export async function PATCH(req) {
  const authError = requirePersistenceAuth(req);
  if (authError) return authError;
  const config = supabaseConfig();
  if (!config.configured) return Response.json(disabledPayload());
  try {
    const body = await req.json();
    const cloudId = isUuid(body.cloudId) ? body.cloudId : null;
    const localId = textOrNull(body.localId || body.payload?.localId || body.id || (!cloudId ? body.cloudId : null));
    if (!cloudId && !localId) return Response.json({ error: "Falta cloudId o localId" }, { status: 400 });
    const status = textOrNull(body.status) || "resolved";
    const payload = body.payload || {};
    const filter = cloudId ? `id=eq.${encodeURIComponent(cloudId)}` : `local_id=eq.${encodeURIComponent(localId)}`;
    const saved = await supabaseRequest("alerts", {
      method: "PATCH",
      query: `owner_id=eq.${encodeURIComponent(config.ownerId)}&${filter}`,
      prefer: "return=representation",
      body: {
        status,
        payload: {
          ...payload,
          localId: localId || payload.localId || cloudId,
          resolvedAt: payload.resolvedAt || new Date().toISOString(),
        },
      },
    });
    return Response.json({ configured: true, ok: true, alerts: saved.map(alertFromDb) });
  } catch (error) {
    return Response.json({ configured: true, ok: false, error: error.message, details: error.details || null }, { status: 500 });
  }
}
