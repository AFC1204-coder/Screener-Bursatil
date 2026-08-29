// lib/ipoRadarAlerts.js — ventana de avisos pre-IPO (IPO-1c).

export const IPO_ALERT_WINDOW_DAYS = 14;

export function dateOnly(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : "";
}

export function alertDate(item = {}) {
  return item.expectedTradeDate || item.expectedPricingDate || "";
}

export function daysUntil(value, now = new Date()) {
  const d = dateOnly(value);
  if (!d) return null;
  const target = new Date(`${d}T12:00:00`);
  const base = new Date(`${now.toISOString().slice(0, 10)}T12:00:00`);
  return Math.round((target - base) / 86400000);
}

export function isDue(item = {}, windowDays = IPO_ALERT_WINDOW_DAYS, now = new Date()) {
  const delta = daysUntil(alertDate(item), now);
  return Number.isFinite(delta)
    && delta >= 0
    && delta <= windowDays
    && item.status !== "listed"
    && item.status !== "passed";
}

export function filterIpoRadarDueItems(items = [], { windowDays = IPO_ALERT_WINDOW_DAYS, now = new Date(), includeAcknowledged = false } = {}) {
  return (Array.isArray(items) ? items : []).filter((item) => {
    if (!isDue(item, windowDays, now)) return false;
    if (!includeAcknowledged && item.alertAcknowledgedAt) return false;
    return true;
  });
}
