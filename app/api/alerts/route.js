import { disabledPayload, finiteOrNull, supabaseConfig, supabaseRequest, textOrNull, toTimestamp } from "@/lib/supabaseServer";

function alertPayload(alert = {}, ownerId) {
  return {
    owner_id: ownerId,
    symbol: textOrNull(alert.symbol)?.toUpperCase() || "-",
    alert_type: textOrNull(alert.alertType || alert.alert_type) || "methodology_event",
    operator: textOrNull(alert.operator),
    threshold: finiteOrNull(alert.threshold),
    payload: {
      ...(alert.payload || {}),
      localId: alert.id || alert.payload?.localId || crypto.randomUUID(),
    },
    status: textOrNull(alert.status) || "active",
    created_at: toTimestamp(alert.createdAt || alert.created_at),
    triggered_at: alert.triggeredAt || alert.triggered_at ? toTimestamp(alert.triggeredAt || alert.triggered_at) : null,
  };
}

function alertFromDb(row = {}) {
  return {
    id: row.payload?.localId || row.id,
    cloudId: row.id,
    symbol: row.symbol,
    alertType: row.alert_type,
    operator: row.operator,
    threshold: finiteOrNull(row.threshold),
    payload: row.payload || {},
    status: row.status || "active",
    createdAt: row.created_at,
    triggeredAt: row.triggered_at,
  };
}

function uniqByLocalId(alerts = []) {
  const seen = new Set();
  const out = [];
  for (const alert of alerts) {
    const key = alert.id || alert.payload?.localId;
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(alert);
  }
  return out;
}

export async function GET(req) {
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
  const config = supabaseConfig();
  if (!config.configured) return Response.json(disabledPayload());
  try {
    const body = await req.json();
    const alerts = body.alerts || (body.alert ? [body.alert] : []);
    if (!alerts.length) return Response.json({ configured: true, ok: true, saved: 0, alerts: [] });
    const existing = await supabaseRequest("alerts", {
      query: `owner_id=eq.${encodeURIComponent(config.ownerId)}&select=id,payload&limit=1000`,
    }).catch(() => []);
    const existingLocalIds = new Set((existing || []).map((row) => row.payload?.localId).filter(Boolean));
    const newAlerts = alerts.filter((alert) => {
      const localId = alert.id || alert.payload?.localId;
      return !localId || !existingLocalIds.has(localId);
    });
    if (!newAlerts.length) return Response.json({ configured: true, ok: true, saved: 0, alerts: [] });
    const saved = await supabaseRequest("alerts", {
      method: "POST",
      prefer: "return=representation",
      body: newAlerts.map((alert) => alertPayload(alert, config.ownerId)),
    });
    return Response.json({ configured: true, ok: true, saved: saved.length, alerts: saved.map(alertFromDb) });
  } catch (error) {
    return Response.json({ configured: true, ok: false, error: error.message, details: error.details || null }, { status: 500 });
  }
}

export async function PATCH(req) {
  const config = supabaseConfig();
  if (!config.configured) return Response.json(disabledPayload());
  try {
    const body = await req.json();
    const cloudId = body.cloudId || body.id;
    if (!cloudId) return Response.json({ error: "Falta cloudId" }, { status: 400 });
    const status = textOrNull(body.status) || "resolved";
    const payload = body.payload || {};
    const saved = await supabaseRequest("alerts", {
      method: "PATCH",
      query: `owner_id=eq.${encodeURIComponent(config.ownerId)}&id=eq.${encodeURIComponent(cloudId)}`,
      prefer: "return=representation",
      body: {
        status,
        payload: {
          ...payload,
          resolvedAt: payload.resolvedAt || new Date().toISOString(),
        },
      },
    });
    return Response.json({ configured: true, ok: true, alerts: saved.map(alertFromDb) });
  } catch (error) {
    return Response.json({ configured: true, ok: false, error: error.message, details: error.details || null }, { status: 500 });
  }
}
