function cleanText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function rowNumber(row = {}, key = "") {
  const value = row[key] ?? row.metrics?.[key] ?? row.growthMetrics?.[key] ?? row.raw?.[key] ?? row.snapshot?.[key];
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function rowText(row = {}, key = "") {
  return cleanText(row[key] ?? row.metrics?.[key] ?? row.raw?.[key] ?? row.snapshot?.[key] ?? "");
}

function pairIssue(left, right, check, detail) {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return "";
  return check(left, right) ? "" : detail;
}

export function dailyLeaderTrendIssue(row = {}) {
  const price = rowNumber(row, "price");
  const sma50 = rowNumber(row, "sma50");
  const sma150 = rowNumber(row, "sma150");
  const sma200 = rowNumber(row, "sma200");
  const slope = rowNumber(row, "sma200Slope");

  return pairIssue(price, sma50, (a, b) => a > b, "Precio bajo SMA50 diaria")
    || pairIssue(price, sma150, (a, b) => a > b, "Precio bajo SMA150 diaria")
    || pairIssue(price, sma200, (a, b) => a > b, "Precio bajo SMA200 diaria")
    || pairIssue(sma50, sma150, (a, b) => a > b, "SMA50 diaria no supera SMA150")
    || pairIssue(sma150, sma200, (a, b) => a > b, "SMA150 diaria no supera SMA200")
    || (Number.isFinite(slope) && slope <= 0 ? "SMA200 diaria no sube" : "");
}

export function dailyLongBiasIssue(row = {}) {
  const price = rowNumber(row, "price");
  const sma200 = rowNumber(row, "sma200");
  const slope = rowNumber(row, "sma200Slope");

  if (Number.isFinite(price) && Number.isFinite(sma200) && price <= sma200) return "Precio bajo SMA200 diaria";
  if (Number.isFinite(slope) && slope < -2) return "SMA200 diaria cae con fuerza";
  return "";
}

export function isDailyStage2(row = {}) {
  const price = rowNumber(row, "price");
  const sma50 = rowNumber(row, "sma50");
  const sma150 = rowNumber(row, "sma150");
  const sma200 = rowNumber(row, "sma200");
  const slope = rowNumber(row, "sma200Slope");
  if (![price, sma50, sma150, sma200, slope].every(Number.isFinite)) return false;
  return price > sma50 && price > sma150 && price > sma200 && sma50 > sma150 && sma150 > sma200 && slope > 0;
}

export function stage2RejectDetail(row = {}, settings = {}) {
  const weeklyState = rowText(row, "weeklyStageState");
  const weeklyLabel = rowText(row, "weeklyStageLabel") || "sin dato";
  const fastWeeks = rowNumber(row, "weeklyFastWeeks") ?? Number(settings.stageFastWeeks || 10);
  const slowWeeks = rowNumber(row, "weeklySlowWeeks") ?? Number(settings.stageSlowWeeks || 30);
  const dailyIssue = dailyLeaderTrendIssue(row);

  if (weeklyState) {
    if (weeklyState !== "stage2") {
      if (isDailyStage2(row)) return "";
      return `No cumple Stage 2 semanal ${fastWeeks || 10}W/${slowWeeks || 30}W: ${weeklyLabel}`;
    }
    return dailyIssue ? `Stage 2 semanal sin confirmacion diaria: ${dailyIssue}` : "";
  }

  if (isDailyStage2(row)) return "";
  return dailyIssue || "No cumple Stage 2 diario con precio, medias 50/150/200 y SMA200 ascendente";
}

export function isConfirmedStage2(row = {}, settings = {}) {
  return !stage2RejectDetail(row, settings);
}
