function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function avg(values = []) {
  const xs = values.filter(Number.isFinite);
  return xs.length ? xs.reduce((sum, value) => sum + value, 0) / xs.length : null;
}

function clamp(n, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n));
}

function rangeStats(rows = []) {
  const highs = rows.map((bar) => finite(bar.high) ?? finite(bar.close)).filter(Number.isFinite);
  const lows = rows.map((bar) => finite(bar.low) ?? finite(bar.close)).filter(Number.isFinite);
  const high = highs.length ? Math.max(...highs) : null;
  const low = lows.length ? Math.min(...lows) : null;
  const depthPct = Number.isFinite(high) && Number.isFinite(low) && high > 0 ? ((high - low) / high) * 100 : null;
  return { high, low, depthPct };
}

function closeLocation(bar = {}) {
  const high = finite(bar.high) ?? finite(bar.close);
  const low = finite(bar.low) ?? finite(bar.close);
  const close = finite(bar.close);
  if (![high, low, close].every(Number.isFinite) || high <= low) return null;
  return ((close - low) / (high - low)) * 100;
}

function contractionDepths(rows = []) {
  if (rows.length < 45) return [];
  const asc = [...rows].reverse();
  const recent = asc.slice(-90);
  const chunkSize = Math.floor(recent.length / 3);
  if (chunkSize < 12) return [];
  return [0, 1, 2].map((index) => rangeStats(recent.slice(index * chunkSize, (index + 1) * chunkSize)).depthPct);
}

export function setupPatternForBars(bars = []) {
  const rows = (bars || []).filter((bar) => Number.isFinite(finite(bar.close)));
  const latest = rows[0] || {};
  const price = finite(latest.close);
  const baseRows = rows.slice(0, Math.min(65, rows.length));
  const pivotRows = rows.slice(1, Math.min(66, rows.length));
  const base = rangeStats(baseRows);
  const pivotPrice = rangeStats(pivotRows).high;
  const avgVolume50 = avg(rows.slice(1, 51).map((bar) => finite(bar.volume)));
  const avgVolume10 = avg(rows.slice(0, 10).map((bar) => finite(bar.volume)));
  const avgVolume5 = avg(rows.slice(0, 5).map((bar) => finite(bar.volume)));
  const latestVolume = finite(latest.volume);
  const volumeDryUpRatio = Number.isFinite(avgVolume10) && Number.isFinite(avgVolume50) && avgVolume50 > 0 ? avgVolume10 / avgVolume50 : null;
  const latestVolumeRatio = Number.isFinite(latestVolume) && Number.isFinite(avgVolume50) && avgVolume50 > 0 ? latestVolume / avgVolume50 : null;
  const distanceToPivotPct = Number.isFinite(price) && Number.isFinite(pivotPrice) && pivotPrice > 0 ? ((price / pivotPrice) - 1) * 100 : null;
  const latestCloseLocationPct = closeLocation(latest);
  const depths = contractionDepths(rows);
  const contractionCount = depths.filter(Number.isFinite).length;
  const contractionsTighten = contractionCount >= 3 && depths[0] > depths[1] && depths[1] > depths[2];
  const vcpCandidate = Boolean(contractionsTighten && Number.isFinite(volumeDryUpRatio) && volumeDryUpRatio <= 0.85 && Number.isFinite(base.depthPct) && base.depthPct <= 35);
  const breakoutQualityScore = clamp(
    (Number.isFinite(distanceToPivotPct) && distanceToPivotPct >= 0 && distanceToPivotPct <= 5 ? 32 : 0)
    + (Number.isFinite(latestVolumeRatio) ? clamp((latestVolumeRatio - 1) * 35, 0, 28) : 0)
    + (Number.isFinite(latestCloseLocationPct) ? clamp((latestCloseLocationPct - 50) * 0.5, 0, 20) : 0)
    + (vcpCandidate ? 20 : 0)
  );
  const breakoutAttempt = Number.isFinite(distanceToPivotPct) && distanceToPivotPct >= 0 && Number.isFinite(latestVolumeRatio) && latestVolumeRatio >= 1.25;
  const recentlyAbovePivot = Number.isFinite(pivotPrice) && rows.slice(0, 10).some((bar) => (finite(bar.high) ?? finite(bar.close)) > pivotPrice);
  const failedBreakout = Boolean(recentlyAbovePivot && Number.isFinite(price) && Number.isFinite(pivotPrice) && price < pivotPrice && Number.isFinite(latestVolumeRatio) && latestVolumeRatio >= 1.1);
  return {
    pivotPrice,
    distanceToPivotPct,
    baseDepthPct: base.depthPct,
    baseDays: baseRows.length,
    baseWeeks: baseRows.length ? baseRows.length / 5 : null,
    volumeDryUpRatio,
    latestVolumeRatio,
    latestCloseLocationPct,
    contractionDepths: depths,
    contractionCount,
    vcpCandidate,
    breakoutAttempt,
    breakoutQualityScore,
    failedBreakout,
    avgVolume5,
    avgVolume10,
    avgVolume50,
  };
}
