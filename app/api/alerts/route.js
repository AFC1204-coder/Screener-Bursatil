import { disabledPayload, finiteOrNull, requirePersistenceAuth, supabaseConfig, supabaseRequest, supabaseRpc, textOrNull, toTimestamp } from "@/lib/supabaseServer";

const ALERTS_READ_TIMEOUT_MS = Number(process.env.ALERTS_READ_TIMEOUT_MS || 3500);

function alertLocalId(alert = {}) {
  return textOrNull(alert.localId || alert.payload?.localId || alert.id) || crypto.randomUUID();
}

function isUuid(value = "") {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function alertPayload(alert = {}, ownerId) {
  const localId = alertLocalId(alert);
  const updatedAt = toTimestamp(alert.updatedAt || alert.updated_at || alert.triggeredAt || alert.triggered_at || alert.createdAt || alert.created_at);
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
    updated_at: updatedAt,
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
    updatedAt: row.updated_at || row.triggered_at || row.created_at,
  };
}

function timestampValue(value) {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

export function alertSyncSummary(rows = [], payloads = []) {
  const incomingById = new Map(payloads.map((payload) => [String(payload?.local_id || "").trim(), timestampValue(payload?.updated_at)]));
  const skippedStale = rows.reduce((count, row) => {
    const incomingTime = incomingById.get(String(row?.local_id || "").trim()) || 0;
    if (!incomingTime) return count;
    return timestampValue(row?.updated_at) > incomingTime ? count + 1 : count;
  }, 0);
  return {
    saved: Math.max(rows.length - skippedStale, 0),
    returned: rows.length,
    skippedStale,
  };
}

function alertSyncError(error = {}) {
  const code = error.details?.code;
  const message = error.message || "";
  if (code === "PGRST202" || /(upsert_alerts_newer_wins|update_alert_status_newer_wins)/i.test(message)) {
    return "Falta una RPC de sincronizacion de alertas. Aplica supabase/schema.sql antes de sincronizar alertas.";
  }
  return message || "No se pudieron sincronizar alertas";
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
      timeoutMs: ALERTS_READ_TIMEOUT_MS,
    });
    return Response.json({ configured: true, ok: true, alerts: uniqByLocalId(rows.map(alertFromDb)) });
  } catch (error) {
    return Response.json({
      configured: true,
      ok: false,
      degraded: true,
      alerts: [],
      error: error.message || "Alertas no disponibles",
    });
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
    const payloads = alerts.map((alert) => alertPayload(alert, config.ownerId));
    const saved = await supabaseRpc("upsert_alerts_newer_wins", {
      p_owner_id: config.ownerId,
      p_alerts: payloads,
    });
    const summary = alertSyncSummary(saved, payloads);
    return Response.json({ configured: true, ok: true, ...summary, alerts: saved.map(alertFromDb) });
  } catch (error) {
    return Response.json({ configured: true, ok: false, error: alertSyncError(error), details: error.details || null }, { status: 500 });
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
    const updatedAt = toTimestamp(body.updatedAt || body.updated_at || body.payload?.resolvedAt || new Date().toISOString());
    const payload = body.payload || {};
    const saved = await supabaseRpc("update_alert_status_newer_wins", {
      p_owner_id: config.ownerId,
      p_cloud_id: cloudId,
      p_local_id: localId,
      p_status: status,
      p_payload: {
        ...payload,
        localId: localId || payload.localId || cloudId,
        resolvedAt: payload.resolvedAt || updatedAt,
      },
      p_updated_at: updatedAt,
    });
    const skippedStale = saved.some((row) => timestampValue(row.updated_at) > timestampValue(updatedAt)) ? 1 : 0;
    return Response.json({ configured: true, ok: true, saved: Math.max(saved.length - skippedStale, 0), returned: saved.length, skippedStale, alerts: saved.map(alertFromDb) });
  } catch (error) {
    return Response.json({ configured: true, ok: false, error: alertSyncError(error), details: error.details || null }, { status: 500 });
  }
}
