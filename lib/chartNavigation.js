export function chartViewStateFromLogicalRange(logicalRange = null, rowCount = 0) {
  const from = Number(logicalRange?.from);
  const to = Number(logicalRange?.to);
  const rows = Number(rowCount);
  if (!Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(rows) || rows < 2) {
    return {
      key: "unknown",
      label: "Vista",
      detail: "Rango no disponible",
      visibleBars: null,
      distanceFromLatest: null,
      isAwayFromLatest: false,
      isZoomed: false,
      isManual: false,
      canPanLeft: false,
      canPanRight: false,
    };
  }

  const latestIndex = rows - 1;
  const minFrom = -0.5;
  const maxTo = rows - 0.5;
  const span = Math.max(1, to - from);
  const distanceFromLatest = Math.max(0, latestIndex - to);
  const isAwayFromLatest = distanceFromLatest > 0.75;
  const visibleBars = Math.max(1, Math.round(span));
  const isZoomed = visibleBars < Math.max(8, rows - 2);
  const isManual = isAwayFromLatest || isZoomed;
  const canPanLeft = from > minFrom + 0.75;
  const canPanRight = to < maxTo - 0.75;

  return {
    key: isAwayFromLatest ? "history" : isZoomed ? "zoom" : "latest",
    label: isAwayFromLatest ? "Historial" : isZoomed ? "Zoom" : "Último dato",
    detail: isAwayFromLatest
      ? `${visibleBars} barras · a ${Math.round(distanceFromLatest)} del último`
      : isZoomed
        ? `${visibleBars} barras · anclado al último`
      : `${visibleBars} barras visibles`,
    visibleBars,
    distanceFromLatest: Math.round(distanceFromLatest),
    isAwayFromLatest,
    isZoomed,
    isManual,
    canPanLeft,
    canPanRight,
  };
}

export function clampedLogicalRange({ rowCount = 0, currentRange = null, minSpan = 8 } = {}) {
  const rows = Number(rowCount);
  const from = Number(currentRange?.from);
  const to = Number(currentRange?.to);
  if (!Number.isFinite(rows) || rows < 2 || !Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
    return null;
  }
  const minFrom = -0.5;
  const maxTo = rows - 0.5;
  const span = Math.max(Number(minSpan) || 8, Math.min(rows, to - from));
  if (span >= rows) return { from: minFrom, to: maxTo };
  const center = (from + to) / 2;
  const maxFrom = Math.max(minFrom, maxTo - span);
  const nextFrom = Math.max(minFrom, Math.min(maxFrom, center - span / 2));
  return {
    from: nextFrom,
    to: nextFrom + span,
  };
}

export function latestLogicalRange({ rowCount = 0, currentRange = null, fallbackSpan = 90 } = {}) {
  const rows = Number(rowCount);
  if (!Number.isFinite(rows) || rows < 2) return null;
  const fallback = Number(fallbackSpan);
  const rawSpan = Number(currentRange?.to) - Number(currentRange?.from);
  const span = Math.max(8, Math.min(rows + 1, Number.isFinite(rawSpan) && rawSpan > 0 ? rawSpan : fallback));
  const to = rows - 0.5;
  return {
    from: Math.max(-0.5, to - span),
    to,
  };
}

export function zoomedLogicalRange({ rowCount = 0, currentRange = null, factor = 1, anchorLatest = false, minSpan = 8 } = {}) {
  const rows = Number(rowCount);
  const from = Number(currentRange?.from);
  const to = Number(currentRange?.to);
  if (!Number.isFinite(rows) || rows < 2 || !Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
    return null;
  }
  const rawFactor = Number(factor);
  const span = Math.max(1, to - from);
  const nextSpan = Math.max(Number(minSpan) || 8, Math.min(rows, span * (Number.isFinite(rawFactor) && rawFactor > 0 ? rawFactor : 1)));
  const maxTo = rows - 0.5;
  if (anchorLatest || maxTo - to <= 0.75) {
    return clampedLogicalRange({
      rowCount: rows,
      currentRange: { from: maxTo - nextSpan, to: maxTo },
      minSpan,
    });
  }
  const center = (from + to) / 2;
  return clampedLogicalRange({
    rowCount: rows,
    currentRange: { from: center - nextSpan / 2, to: center + nextSpan / 2 },
    minSpan,
  });
}

export function shiftedLogicalRange({ rowCount = 0, currentRange = null, direction = -1, stepRatio = 0.45 } = {}) {
  const rows = Number(rowCount);
  const from = Number(currentRange?.from);
  const to = Number(currentRange?.to);
  if (!Number.isFinite(rows) || rows < 2 || !Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
    return null;
  }

  const minFrom = -0.5;
  const maxTo = rows - 0.5;
  const span = Math.max(1, to - from);
  const step = Math.max(1, span * Math.max(0.1, Number(stepRatio) || 0.45));
  const maxFrom = Math.max(minFrom, maxTo - span);
  const nextFrom = Math.max(minFrom, Math.min(maxFrom, from + (direction >= 0 ? step : -step)));
  return {
    from: nextFrom,
    to: nextFrom + span,
  };
}

export function rescaledLogicalRange({
  previousRowCount = 0,
  nextRowCount = 0,
  previousRange = null,
  minSpan = 8,
} = {}) {
  const previousRows = Number(previousRowCount);
  const nextRows = Number(nextRowCount);
  const from = Number(previousRange?.from);
  const to = Number(previousRange?.to);
  if (!Number.isFinite(previousRows) || previousRows < 2 || !Number.isFinite(nextRows) || nextRows < 2) return null;
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return null;

  const previousMaxTo = previousRows - 0.5;
  const nextMaxTo = nextRows - 0.5;
  const spanRatio = Math.max(0, Math.min(1, (to - from) / previousRows));
  const distanceRatio = Math.max(0, Math.min(1, (previousMaxTo - to) / previousRows));
  const nextSpan = Math.max(Number(minSpan) || 8, Math.min(nextRows, nextRows * spanRatio));
  const nextTo = nextMaxTo - (distanceRatio * nextRows);
  return clampedLogicalRange({
    rowCount: nextRows,
    currentRange: { from: nextTo - nextSpan, to: nextTo },
    minSpan,
  });
}

export function timeWindowLogicalRange({ rowTimes = [], timeRange = null, minSpan = 8 } = {}) {
  const times = Array.isArray(rowTimes) ? rowTimes.map(Number) : [];
  if (times.length < 2) return null;
  const fromTime = Number(timeRange?.from);
  const toTime = Number(timeRange?.to);
  if (!Number.isFinite(fromTime) || !Number.isFinite(toTime)) return null;
  const start = Math.min(fromTime, toTime);
  const end = Math.max(fromTime, toTime);
  const firstTime = times[0];
  const lastTime = times.at(-1);
  if (!Number.isFinite(firstTime) || !Number.isFinite(lastTime) || end < firstTime || start > lastTime) return null;

  const fromIndex = times.findIndex((time) => time >= start);
  let toIndex = -1;
  for (let index = times.length - 1; index >= 0; index -= 1) {
    if (times[index] <= end) {
      toIndex = index;
      break;
    }
  }
  if (fromIndex < 0 || toIndex < 0) return null;
  const centerIndex = toIndex >= fromIndex
    ? (fromIndex + toIndex) / 2
    : times.reduce((bestIndex, time, index) => {
      const midpoint = start + ((end - start) / 2);
      return Math.abs(time - midpoint) < Math.abs(times[bestIndex] - midpoint) ? index : bestIndex;
    }, 0);
  const visibleCount = toIndex >= fromIndex ? toIndex - fromIndex + 1 : 1;
  const span = Math.max(Number(minSpan) || 8, visibleCount);
  return clampedLogicalRange({
    rowCount: times.length,
    currentRange: { from: centerIndex - span / 2, to: centerIndex + span / 2 },
    minSpan,
  });
}

export function timeWindowFromLogicalRange({ rowTimes = [], logicalRange = null } = {}) {
  const times = Array.isArray(rowTimes) ? rowTimes.map(Number).filter(Number.isFinite) : [];
  const from = Number(logicalRange?.from);
  const to = Number(logicalRange?.to);
  if (times.length < 2 || !Number.isFinite(from) || !Number.isFinite(to) || to <= from) return null;

  const startIndex = Math.max(0, Math.min(times.length - 1, Math.ceil(from)));
  const endIndex = Math.max(0, Math.min(times.length - 1, Math.floor(to)));
  if (endIndex < startIndex) {
    const centerIndex = Math.max(0, Math.min(times.length - 1, Math.round((from + to) / 2)));
    return {
      from: times[centerIndex],
      to: times[centerIndex],
    };
  }
  return {
    from: times[startIndex],
    to: times[endIndex],
  };
}

function finiteTimeWindow(timeRange = null) {
  const from = Number(timeRange?.from);
  const to = Number(timeRange?.to);
  return Number.isFinite(from) && Number.isFinite(to) && from !== to;
}

function renderMetaValue(meta = {}, key = "") {
  return String(meta?.[key] ?? "").trim();
}

export function manualChartWindowRestorePolicy({
  previousMeta = null,
  nextMeta = null,
  viewState = null,
  visibleTimeRange = null,
} = {}) {
  if (!previousMeta?.ready) {
    return { restore: false, reason: "first-render" };
  }
  if (renderMetaValue(previousMeta, "symbol") !== renderMetaValue(nextMeta, "symbol")) {
    return { restore: false, reason: "symbol-change" };
  }
  if (!viewState?.isManual) {
    return { restore: false, reason: "automatic-view" };
  }
  if (!finiteTimeWindow(visibleTimeRange)) {
    return { restore: false, reason: "missing-time-window" };
  }

  if (renderMetaValue(previousMeta, "interval") !== renderMetaValue(nextMeta, "interval")) {
    return { restore: true, reason: "interval-change" };
  }
  if (renderMetaValue(previousMeta, "range") !== renderMetaValue(nextMeta, "range")) {
    return { restore: true, reason: "range-change" };
  }
  if (renderMetaValue(previousMeta, "style") !== renderMetaValue(nextMeta, "style")) {
    return { restore: true, reason: "style-change" };
  }
  if (renderMetaValue(previousMeta, "scale") !== renderMetaValue(nextMeta, "scale")) {
    return { restore: true, reason: "scale-change" };
  }

  return { restore: true, reason: "same-symbol-redraw" };
}
