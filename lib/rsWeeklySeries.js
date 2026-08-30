function dateTime(value = "") {
  const time = Date.parse(String(value || "").length <= 10 ? `${value}T00:00:00Z` : value);
  return Number.isFinite(time) ? time : 0;
}

/** Una fila por weekKey: conserva el punto con snapshot_date (date) más reciente. */
export function dedupeWeeklyRsSeriesByWeekKey(series = []) {
  const list = Array.isArray(series) ? series : [];
  const byWeekKey = new Map();
  for (const point of list) {
    const key = String(point?.weekKey ?? "");
    const existing = byWeekKey.get(key);
    if (!existing || dateTime(point.date) > dateTime(existing.date)) {
      byWeekKey.set(key, point);
    }
  }
  return Array.from(byWeekKey.values()).sort((a, b) => dateTime(a.date) - dateTime(b.date));
}
