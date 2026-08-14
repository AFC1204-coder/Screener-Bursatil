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

// La política de restauración heurística (`manualChartWindowRestorePolicy`) y
// el reescalado de rangos entre recuentos (`rescaledLogicalRange`) se
// eliminaron con la inversión del contrato de ventana
// (docs/analisis-grafico-2026-08-14.md, Parte C.1): la desviación manual es
// ahora estado explícito del lifecycle (una ventana temporal) y se re-aplica
// mapeándola por tiempo con `timeWindowLogicalRange`; no hay nada que
// adivinar entre re-attaches.
