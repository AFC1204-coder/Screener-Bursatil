const ALERTABLE_TYPES = new Set([
  "rs_improves",
  "rs_weakens",
  "score_improves",
  "score_deteriorates",
  "deterioration_increases",
  "vcp_candidate",
  "breakout_attempt",
  "failed_breakout",
  "sector_rank_improves",
  "sector_rank_weakens",
  "stage_changes",
  "price_reclaims_sma50",
  "price_loses_sma50",
  "price_loses_sma200",
  "relative_volume_spikes",
]);

function cleanSymbol(value = "") {
  return String(value || "").trim().toUpperCase();
}

function stableId(parts = []) {
  return parts.map((part) => String(part || "").replace(/[^a-zA-Z0-9_.:-]/g, "_")).join(":");
}

export function alertSeverityRank(value = "") {
  if (value === "warning") return 3;
  if (value === "positive") return 2;
  return 1;
}

export function alertsFromScan(scan = {}) {
  const rows = Array.isArray(scan.rows) ? scan.rows : [];
  const createdAt = scan.createdAt || new Date().toISOString();
  return rows.flatMap((row) => {
    const symbol = cleanSymbol(row.symbol);
    if (!symbol) return [];
    return (row.methodologyEvents || [])
      .filter((event) => ALERTABLE_TYPES.has(event.type))
      .map((event) => {
        const id = stableId([scan.id || createdAt, symbol, event.type, event.metric, event.current, event.previous]);
        return {
          id,
          symbol,
          alertType: event.type,
          operator: event.metric || null,
          threshold: Number.isFinite(event.current) ? event.current : null,
          status: "active",
          createdAt,
          triggeredAt: createdAt,
          payload: {
            localId: id,
            scanId: scan.id || null,
            scanName: scan.name || "",
            scanPreset: scan.preset || "",
            marketRegime: scan.marketRegime || "sin dato",
            marketScore: scan.marketScore ?? null,
            companyName: row.companyName || row.name || symbol,
            sector: row.sector || "",
            industry: row.industry || "",
            theme: row.theme || "",
            severity: event.severity || "neutral",
            label: event.label || event.type,
            detail: event.detail || "",
            metric: event.metric || "",
            current: event.current ?? null,
            previous: event.previous ?? null,
          },
        };
      });
  });
}

export function mergeAlerts(existing = [], incoming = []) {
  const map = new Map();
  for (const alert of [...existing, ...incoming]) {
    const key = alert.id || alert.payload?.localId || stableId([alert.symbol, alert.alertType, alert.createdAt]);
    if (!key) continue;
    const current = map.get(key);
    if (!current) {
      map.set(key, alert);
      continue;
    }
    const currentTime = Date.parse(current.updatedAt || current.triggeredAt || current.createdAt || 0);
    const nextTime = Date.parse(alert.updatedAt || alert.triggeredAt || alert.createdAt || 0);
    map.set(key, nextTime >= currentTime ? { ...current, ...alert } : current);
  }
  return [...map.values()].sort(sortAlerts);
}

export function sortAlerts(a = {}, b = {}) {
  const severity = alertSeverityRank(b.payload?.severity) - alertSeverityRank(a.payload?.severity);
  if (severity) return severity;
  return Date.parse(b.triggeredAt || b.createdAt || 0) - Date.parse(a.triggeredAt || a.createdAt || 0);
}

export function activeAlerts(alerts = []) {
  return alerts.filter((alert) => alert.status !== "resolved" && alert.status !== "dismissed").sort(sortAlerts);
}

export function resolveAlert(alert = {}, status = "resolved") {
  return {
    ...alert,
    status,
    updatedAt: new Date().toISOString(),
    payload: {
      ...(alert.payload || {}),
      resolvedAt: new Date().toISOString(),
    },
  };
}

export function alertSummary(alerts = []) {
  const active = activeAlerts(alerts);
  return {
    total: alerts.length,
    active: active.length,
    warnings: active.filter((alert) => alert.payload?.severity === "warning").length,
    positives: active.filter((alert) => alert.payload?.severity === "positive").length,
    neutral: active.filter((alert) => !["warning", "positive"].includes(alert.payload?.severity)).length,
  };
}
