// lib/chartDrawings.js — Modelo + geometría pura para anotaciones del usuario
// sobre UniversalPriceChart (trendlines v1).
//
// Decisiones D1/D4: dos anclas `{ time, price }` en dominio absoluto, segmento
// recto, sin estilo por línea, sin persistencia. El store es de módulo para
// sobrevivir a la navegación SPA; muere al recargar (intencional en v1).
//
// Este módulo NO depende de React ni del DOM: la única excepción es
// `crypto.randomUUID()` para generar ids; si no está disponible (tests jsdom
// antiguos) cae a un generador determinista. Toda la geometría es pura.
//
// Contrato de la proyección (detalle D1): `timeToCoordinate()` de lightweight
// devuelve `null` cuando el tiempo no coincide con una barra (caso universal al
// agregar a W/M). Aquí se resuelve con búsqueda binaria sobre `rowTimes` y
// un índice lógico fraccional interpolado que sí entra en `logicalToCoordinate`.

const DEFAULT_HIT_TOLERANCE = 6; // px (D4). Mismo valor en mobile hasta evidencia v1.

function generateId() {
  if (typeof globalThis !== "undefined" && typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  // Fallback determinista pero único dentro de la misma sesión: timestamp + contador.
  generateId.counter = (generateId.counter || 0) + 1;
  return `d-${Date.now().toString(36)}-${generateId.counter.toString(36)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Esquema de línea. Misma forma que la futura fila Supabase `user_drawings`.
// ─────────────────────────────────────────────────────────────────────────────

export function createTrendline({
  symbol = "",
  p1,
  p2,
  createdAtInterval = "D",
  createdAt = null,
  id = null,
} = {}) {
  if (!symbol) throw new Error("createTrendline: symbol es obligatorio");
  if (!isFinitePoint(p1) || !isFinitePoint(p2)) {
    throw new Error("createTrendline: p1 y p2 deben tener {time, price} finitos");
  }
  return {
    id: id || generateId(),
    symbol,
    kind: "trendline",
    points: [toPoint(p1), toPoint(p2)],
    createdAtInterval,
    createdAt: createdAt || new Date().toISOString(),
  };
}

function toPoint(value) {
  return { time: Number(value.time), price: Number(value.price) };
}

function isFinitePoint(value) {
  return Boolean(value)
    && Number.isFinite(Number(value?.time))
    && Number.isFinite(Number(value?.price));
}

export function validateTrendline(drawing) {
  if (!drawing || drawing.kind !== "trendline") return false;
  if (!Array.isArray(drawing.points) || drawing.points.length !== 2) return false;
  return drawing.points.every(isFinitePoint);
}

// ─────────────────────────────────────────────────────────────────────────────
// Store de sesión por símbolo.
//
// Interfaz exacta del contrato D1:
//   list(symbol) -> Drawing[]
//   add(symbol, drawing)
//   remove(symbol, id)
//   update(symbol, drawing)
//   subscribe(symbol, cb) -> unsubscribe
//
// El store es de módulo (singleton). Sobrevive a navegaciones SPA dentro de la
// pestaña; muere al recargar — comportamiento intencional v1.
// ─────────────────────────────────────────────────────────────────────────────

const _store = {
  bySymbol: new Map(),      // symbol -> Drawing[]
  listeners: new Map(),     // symbol -> Set<callback>
};

function ensureBucket(symbol) {
  if (!_store.bySymbol.has(symbol)) _store.bySymbol.set(symbol, []);
  return _store.bySymbol.get(symbol);
}

function notify(symbol) {
  const set = _store.listeners.get(symbol);
  if (!set) return;
  for (const cb of set) {
    try { cb(list(symbol)); } catch { /* swallow: el store nunca rompe al consumidor */ }
  }
}

export function list(symbol = "") {
  if (!symbol) return [];
  const bucket = _store.bySymbol.get(symbol);
  return bucket ? bucket.slice() : [];
}

export function add(symbol, drawing) {
  if (!symbol || !validateTrendline(drawing)) return null;
  const bucket = ensureBucket(symbol);
  const stamped = { ...drawing, symbol };
  bucket.push(stamped);
  notify(symbol);
  return stamped.id;
}

export function remove(symbol, id) {
  if (!symbol || !id) return false;
  const bucket = _store.bySymbol.get(symbol);
  if (!bucket) return false;
  const index = bucket.findIndex((d) => d.id === id);
  if (index < 0) return false;
  bucket.splice(index, 1);
  notify(symbol);
  return true;
}

export function update(symbol, drawing) {
  if (!symbol || !validateTrendline(drawing)) return false;
  const bucket = ensureBucket(symbol);
  const index = bucket.findIndex((d) => d.id === drawing.id);
  if (index < 0) return false;
  bucket[index] = { ...drawing, symbol };
  notify(symbol);
  return true;
}

export function subscribe(symbol, cb) {
  if (!symbol || typeof cb !== "function") return () => {};
  let set = _store.listeners.get(symbol);
  if (!set) {
    set = new Set();
    _store.listeners.set(symbol, set);
  }
  set.add(cb);
  return () => {
    const current = _store.listeners.get(symbol);
    if (!current) return;
    current.delete(cb);
    if (current.size === 0) _store.listeners.delete(symbol);
  };
}

// Útil sólo en tests / fixtures / depuración. NO usar en producción: borra
// el estado del usuario al recargar sí es intencional en v1.
export function __resetDrawingsStore() {
  _store.bySymbol.clear();
  _store.listeners.clear();
}

// ─────────────────────────────────────────────────────────────────────────────
// Proyección time ↔ índice lógico fraccional (detalle D1).
//
// El problema concreto: cuando una línea se creó en 1D y se cambia a W/M,
// `timeToCoordinate()` devuelve null porque el tiempo del ancla casi nunca
// coincide con una barra del agregado. Solución:
//   1. Búsqueda binaria del tiempo del ancla sobre `rowTimes` (array
//      estrictamente creciente) → devuelve índice `i` y peso `t` en [0,1].
//   2. Índice lógico fraccional = i + t, ya es estable entre agregaciones.
//   3. La primitiva llama a `logicalToCoordinate(i + t)` que sí funciona.
//
// Para anclas fuera del rango (izquierda/derecha del histórico cargado)
// extrapolamos linealmente en eje lógico usando el delta entre los dos
// extremos más cercanos; el recorte al viewport lo hace la primitiva al
// pintar (no recorta aquí, recorta después, porque queremos la extrapolación
// disponible para tests).
// ─────────────────────────────────────────────────────────────────────────────

export function timeToFractionalIndex(rowTimes, time) {
  if (!Array.isArray(rowTimes) || rowTimes.length === 0) return null;
  const target = Number(time);
  if (!Number.isFinite(target)) return null;

  const first = rowTimes[0];
  const last = rowTimes[rowTimes.length - 1];
  if (target <= first) return 0;
  if (target >= last) return rowTimes.length - 1;

  let lo = 0;
  let hi = rowTimes.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (rowTimes[mid] <= target) lo = mid;
    else hi = mid;
  }
  // Interpolación entre rowTimes[lo] y rowTimes[hi], hi = lo + 1 garantizado.
  const span = rowTimes[hi] - rowTimes[lo];
  const t = span > 0 ? (target - rowTimes[lo]) / span : 0;
  return lo + t;
}

// Anclas fuera de rango: extrapolamos usando el delta local del último par.
export function timeToFractionalIndexExtrapolated(rowTimes, time) {
  if (!Array.isArray(rowTimes) || rowTimes.length < 2) return null;
  const target = Number(time);
  if (!Number.isFinite(target)) return null;

  const first = rowTimes[0];
  const last = rowTimes[rowTimes.length - 1];
  if (target <= first) {
    const step = rowTimes[1] - rowTimes[0];
    if (step <= 0) return 0;
    return (target - first) / step;
  }
  if (target >= last) {
    const n = rowTimes.length;
    const step = rowTimes[n - 1] - rowTimes[n - 2];
    if (step <= 0) return n - 1;
    return (n - 1) + (target - last) / step;
  }
  return timeToFractionalIndex(rowTimes, target);
}

// Recorte al viewport lógico. Devuelve índices lógicos para los dos extremos
// del segmento visibles dentro de [fromLogical, toLogical]. Si el segmento
// cae completamente fuera, devuelve null. Si cae parcialmente, recorta.
export function clipLogicalSegment(p1Logical, p2Logical, fromLogical, toLogical) {
  if (!Number.isFinite(p1Logical) || !Number.isFinite(p2Logical)) return null;
  if (!Number.isFinite(fromLogical) || !Number.isFinite(toLogical)) return null;
  if (fromLogical > toLogical) return null;

  const min = Math.min(p1Logical, p2Logical);
  const max = Math.max(p1Logical, p2Logical);
  if (max < fromLogical || min > toLogical) return null;

  if (p1Logical === p2Logical) {
    if (p1Logical < fromLogical || p1Logical > toLogical) return null;
    return { p1Logical, p2Logical };
  }

  const slope = (toLogical - fromLogical) === 0 ? 0 : 1; // marcador; la fórmula es lineal en t
  const tAt = (target) => {
    // Resuelve t ∈ [0,1] tal que pointAt(t) === target en eje lógico.
    // pointAt(t) = p1 + (p2 - p1) * t
    return (target - p1Logical) / (p2Logical - p1Logical);
  };

  let tEnter = 0;
  let tExit = 1;
  if (p1Logical < p2Logical) {
    tEnter = Math.max(tEnter, tAt(fromLogical));
    tExit = Math.min(tExit, tAt(toLogical));
  } else {
    tEnter = Math.max(tEnter, tAt(toLogical));
    tExit = Math.min(tExit, tAt(fromLogical));
  }
  if (tEnter >= tExit) return null;
  // Guardamos una marca de pendiente nula por si el slope=0 del comentario
  // llegara a usarse en debugging futuro.
  void slope;
  return {
    p1Logical: p1Logical + (p2Logical - p1Logical) * tEnter,
    p2Logical: p1Logical + (p2Logical - p1Logical) * tExit,
    tEnter,
    tExit,
  };
}

// Proyecta una línea completa al viewport: devuelve los puntos lógicos
// visibles (con extrapolación opcional para anclas fuera de rango) y el
// recorte. Pureza: no toca el chart; sólo geometría.
export function projectTrendline(drawing, { rowTimes, visibleLogicalRange, extrapolate = true } = {}) {
  if (!validateTrendline(drawing)) return null;
  if (!Array.isArray(rowTimes) || rowTimes.length < 2) return null;
  if (!visibleLogicalRange) return null;

  const project = (point) => extrapolate
    ? timeToFractionalIndexExtrapolated(rowTimes, point.time)
    : timeToFractionalIndex(rowTimes, point.time);
  const p1Logical = project(drawing.points[0]);
  const p2Logical = project(drawing.points[1]);
  if (!Number.isFinite(p1Logical) || !Number.isFinite(p2Logical)) return null;

  const clip = clipLogicalSegment(
    p1Logical,
    p2Logical,
    Number(visibleLogicalRange.from),
    Number(visibleLogicalRange.to),
  );
  if (!clip) return null;
  return {
    p1Logical,
    p2Logical,
    clipped: clip,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Hit-test punto-segmento (D4).
//
// given los dos extremos del segmento en píxeles, devuelve la distancia
// mínima perpendicular del punto (x,y) al segmento infinito, y si esa
// distancia es ≤ tolerance, devuelve además los metadatos de selección.
// ─────────────────────────────────────────────────────────────────────────────

export function pointSegmentDistance(px, py, x1, y1, x2, y2) {
  if (![px, py, x1, y1, x2, y2].every(Number.isFinite)) return Infinity;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const ddx = px - x1;
    const ddy = py - y1;
    return Math.sqrt(ddx * ddx + ddy * ddy);
  }
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  const ddx = px - projX;
  const ddy = py - projY;
  return Math.sqrt(ddx * ddx + ddy * ddy);
}

// Selecciona, de una lista de líneas proyectadas a píxel, la primera dentro
// de tolerancia. La tolerancia para tiradores es mayor que para el cuerpo
// (un tirador es una diana circular más generosa).
export function hitTestLines(lines, x, y, tolerance = DEFAULT_HIT_TOLERANCE) {
  if (!Array.isArray(lines)) return null;
  let best = null;
  for (const entry of lines) {
    if (!entry) continue;
    const { drawing, endpoints, handles } = entry;
    if (!drawing || !endpoints) continue;
    const handleTol = Math.max(tolerance, 8);
    const { x: x1, y: y1 } = endpoints.p1 || {};
    const { x: x2, y: y2 } = endpoints.p2 || {};
    if (handles?.p1 && Number.isFinite(handles.p1.x)) {
      const d = Math.hypot(x - handles.p1.x, y - handles.p1.y);
      if (d <= handleTol && (!best || d < best.distance)) {
        best = { drawingId: drawing.id, distance: d, handle: "p1", kind: "handle" };
        continue;
      }
    }
    if (handles?.p2 && Number.isFinite(handles.p2.x)) {
      const d = Math.hypot(x - handles.p2.x, y - handles.p2.y);
      if (d <= handleTol && (!best || d < best.distance)) {
        best = { drawingId: drawing.id, distance: d, handle: "p2", kind: "handle" };
        continue;
      }
    }
    if (Number.isFinite(x1) && Number.isFinite(y1) && Number.isFinite(x2) && Number.isFinite(y2)) {
      const d = pointSegmentDistance(x, y, x1, y1, x2, y2);
      if (d <= tolerance && (!best || d < best.distance)) {
        best = { drawingId: drawing.id, distance: d, handle: null, kind: "body" };
      }
    }
  }
  return best;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constantes exportadas.
// ─────────────────────────────────────────────────────────────────────────────

export const HIT_TOLERANCE_PX = DEFAULT_HIT_TOLERANCE;