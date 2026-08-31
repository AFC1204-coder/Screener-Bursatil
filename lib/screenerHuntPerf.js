// lib/screenerHuntPerf.js — marcas ligeras PERF-NAC: gesto hunt → paint truth line.

let clock = () => (typeof performance !== "undefined" && typeof performance.now === "function"
  ? performance.now()
  : Date.now());

let lastGesture = null;
let lastTruthLineMs = null;
let lastTruthLineMeta = null;

/** Solo tests: fija el reloj de medición. */
export function __setHuntPerfClock(nextClock) {
  clock = typeof nextClock === "function" ? nextClock : clock;
}

export function resetHuntPerf() {
  lastGesture = null;
  lastTruthLineMs = null;
  lastTruthLineMeta = null;
}

export function markHuntGesture(source = "hunt-card") {
  lastGesture = { at: clock(), source: String(source || "hunt-card") };
  lastTruthLineMs = null;
  lastTruthLineMeta = null;
  return lastGesture.at;
}

export function recordTruthLinePaint(meta = {}) {
  if (!lastGesture) return null;
  if (lastTruthLineMs != null) return null;
  lastTruthLineMs = clock() - lastGesture.at;
  lastTruthLineMeta = { ...meta };
  return lastTruthLineMs;
}

export function huntPerfSnapshot() {
  return {
    lastGesture,
    lastTruthLineMs,
    lastTruthLineMeta,
  };
}

export function measureHuntTruthLineMs(gestureAt, paintAt) {
  const start = Number(gestureAt);
  const end = Number(paintAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return end - start;
}
