// lib/trendlinePrimitive.js — ISeriesPrimitive de lightweight-charts v5 que pinta
// líneas de tendencia (D6) leyendo del store de `lib/chartDrawings.js`.
//
// Decisiones:
// - Una sola `IPaneView` por primitiva; `updateAllViews()` se invoca cuando el
//   store notifica cambios, para que lightweight repinte.
// - Los estilos se resuelven desde los tokens v2 vía `resolveCssTokens()`.
//   La primitiva guarda los últimos tokens y re-resuelve si cambian.
// - La previsualización de la línea en curso (entre P1 y el cursor) la pinta
//   el hook (no la primitiva) vía un segundo `updateAllViews` con un override:
//   la primitiva mira `pendingOverlay` además del store, para no contaminar el
//   esquema persistido.
// - El hit-test externo del primitive devuelve `externalId` con formato
//   `trendline:<id>[:handle:p1|p2]`, suficiente para que el hook decida.

import { list as storeList, subscribe as storeSubscribe } from "@/lib/chartDrawings";
import { HIT_TOLERANCE_PX, pointSegmentDistance, projectTrendline } from "@/lib/chartDrawings";

const ZORDER_TOP = "top";

function resolveDrawingStyles() {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return {
      reposo: "rgba(237, 232, 218, .60)",
      activa: "#EDE8DA",
      handleFill: "#17291F",
      handleStroke: "#EDE8DA",
      handleRadius: 4,
    };
  }
  const styles = window.getComputedStyle(document.documentElement);
  const read = (name, fallback) => {
    const value = styles.getPropertyValue(name).trim();
    return value || fallback;
  };
  const radiusRaw = read("--anotacion-handle", "4px");
  const radius = Number.parseFloat(radiusRaw) || 4;
  return {
    reposo: read("--anotacion", "rgba(237, 232, 218, .60)"),
    activa: read("--anotacion-activa", "#EDE8DA"),
    handleFill: read("--pizarra", "#17291F"),
    handleStroke: read("--tiza", "#EDE8DA"),
    handleRadius: radius,
  };
}

class TrendlinePaneView {
  constructor(primitive) {
    this._primitive = primitive;
  }

  zOrder() {
    return ZORDER_TOP;
  }

  renderer() {
    return this._primitive._renderer;
  }
}

class TrendlineRenderer {
  constructor(primitive) {
    this._primitive = primitive;
  }

  draw(target) {
    const ctx = target.context;
    if (!ctx) return;
    const mediaSize = target.mediaSize || { width: 0, height: 0 };
    const state = this._primitive._frameState;
    if (!state || !state.viewportSize) return;

    const styles = this._primitive._styles;
    const lines = state.lines;
    const pending = state.pending;
    const selectedId = state.selectedId;
    if (!lines || lines.length === 0) return;

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (const entry of lines) {
      if (!entry?.clipped) continue;
      const isSelected = entry.drawing.id === selectedId;
      const stroke = isSelected ? styles.activa : styles.reposo;
      const width = isSelected ? 2 : 1.5;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(entry.x1, entry.y1);
      ctx.lineTo(entry.x2, entry.y2);
      ctx.stroke();
    }

    if (pending?.p1 && pending?.cursor) {
      ctx.strokeStyle = styles.activa;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(pending.p1.x, pending.p1.y);
      ctx.lineTo(pending.cursor.x, pending.cursor.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Tiradores sólo para la línea seleccionada (D5): relleno pizarra, borde tiza.
    const radius = styles.handleRadius || 4;
    const selectedEntry = lines.find((entry) => entry.drawing.id === selectedId && entry.clipped);
    if (selectedEntry?.handles) {
      ctx.fillStyle = styles.handleFill;
      ctx.strokeStyle = styles.handleStroke;
      ctx.lineWidth = 2;
      for (const key of ["p1", "p2"]) {
        const handle = selectedEntry.handles[key];
        if (!handle || !Number.isFinite(handle.x)) continue;
        ctx.beginPath();
        ctx.arc(handle.x, handle.y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    ctx.restore();
    void mediaSize;
  }
}

export class TrendlinePrimitive {
  constructor({ symbol, resolveTokens, requestRedraw }) {
    this._symbol = symbol;
    this._rowsProvider = null;       // () => number[] | null
    this._visibleLogicalRange = null; // {from, to} | null
    this._styles = resolveTokens ? resolveTokens() : resolveDrawingStyles();
    this._requestRedraw = requestRedraw || (() => {});
    this._selectedId = null;
    this._pendingOverlay = null; // {p1:{x,y}, cursor:{x,y}} | null
    this._frameState = { lines: [], pending: null, selectedId: null, viewportSize: null };
    this._chart = null;
    this._series = null;
    this._unsubscribeStore = null;
    this._lastRowsHash = null;
    this._lastRangeHash = null;
    this._renderer = new TrendlineRenderer(this);
    this._view = new TrendlinePaneView(this);
  }

  setSymbol(symbol) {
    if (this._symbol === symbol) return;
    this._detachStore();
    this._symbol = symbol;
    this._attachStore();
    this.updateAllViews();
  }

  setRowsProvider(provider) {
    this._rowsProvider = typeof provider === "function" ? provider : null;
    this._lastRowsHash = null;
    this.updateAllViews();
  }

  setVisibleLogicalRange(range) {
    this._visibleLogicalRange = range || null;
    this._lastRangeHash = null;
    this.updateAllViews();
  }

  setSelectedId(id) {
    if (this._selectedId === id) return;
    this._selectedId = id || null;
    this.updateAllViews();
  }

  setPendingOverlay(overlay) {
    this._pendingOverlay = overlay || null;
    this.updateAllViews();
  }

  refreshStyles() {
    this._styles = resolveDrawingStyles();
    this.updateAllViews();
  }

  _attachStore() {
    if (!this._symbol) return;
    this._unsubscribeStore = storeSubscribe(this._symbol, () => this.updateAllViews());
  }

  _detachStore() {
    if (this._unsubscribeStore) {
      this._unsubscribeStore();
      this._unsubscribeStore = null;
    }
  }

  attached(param) {
    this._chart = param?.chart || null;
    this._series = param?.series || null;
    this._attachStore();
  }

  detached() {
    this._detachStore();
    this._chart = null;
    this._series = null;
  }

  paneViews() {
    return [this._view];
  }

  updateAllViews() {
    const rows = this._rowsProvider ? this._rowsProvider() : null;
    const range = this._visibleLogicalRange;
    if (!Array.isArray(rows) || rows.length < 2 || !range) {
      this._frameState = {
        lines: [],
        pending: null,
        selectedId: this._selectedId,
        viewportSize: this._frameState.viewportSize,
      };
      this._requestRedraw();
      return;
    }

    const drawings = storeList(this._symbol).filter((d) => d.kind === "trendline");
    const viewportSize = computeViewportSize(this._chart);
    const lines = [];
    for (const drawing of drawings) {
      const projected = projectTrendline(drawing, {
        rowTimes: rows,
        visibleLogicalRange: range,
        extrapolate: true,
      });
      if (!projected) continue;
      const x1 = logicalToX(this._chart, projected.clipped.p1Logical);
      const y1 = priceToY(this._series, drawing.points[0].price, projected.p1Logical);
      const x2 = logicalToX(this._chart, projected.clipped.p2Logical);
      const y2 = priceToY(this._series, drawing.points[1].price, projected.p2Logical);
      const originalX1 = logicalToX(this._chart, projected.p1Logical);
      const originalY1 = priceToY(this._series, drawing.points[0].price, projected.p1Logical);
      const originalX2 = logicalToX(this._chart, projected.p2Logical);
      const originalY2 = priceToY(this._series, drawing.points[1].price, projected.p2Logical);
      lines.push({
        drawing,
        x1: Number.isFinite(x1) ? x1 : null,
        y1: Number.isFinite(y1) ? y1 : null,
        x2: Number.isFinite(x2) ? x2 : null,
        y2: Number.isFinite(y2) ? y2 : null,
        handles: {
          p1: Number.isFinite(originalX1) && Number.isFinite(originalY1)
            ? { x: originalX1, y: originalY1 }
            : null,
          p2: Number.isFinite(originalX2) && Number.isFinite(originalY2)
            ? { x: originalX2, y: originalY2 }
            : null,
        },
        clipped: {
          p1Logical: projected.clipped.p1Logical,
          p2Logical: projected.clipped.p2Logical,
        },
      });
    }

    this._frameState = {
      lines,
      pending: this._pendingOverlay,
      selectedId: this._selectedId,
      viewportSize,
    };
    this._requestRedraw();
  }

  // Hit-test expuesto al consumidor (no es el hitTest() de la API — la
  // primitiva delega al store; aquí sólo damos una API conveniente para el
  // hook, que ya tiene acceso a x,y en píxeles).
    // Para tests: devuelve las coordenadas de los extremos de la primera línea
  // proyectada en píxeles del canvas (las mismas que pickAt acepta).
  getFirstLineCenter() {
    const lines = this._frameState.lines || [];
    const entry = lines[0];
    if (!entry) return null;
    const x1 = entry.x1, y1 = entry.y1, x2 = entry.x2, y2 = entry.y2;
    if (![x1, y1, x2, y2].every(Number.isFinite)) return null;
    return { x1, y1, x2, y2, center: { x: (x1 + x2) / 2, y: (y1 + y2) / 2 } };
  }

    pickAt(x, y) {
    const tolerance = HIT_TOLERANCE_PX;
    let best = null;
    const handleTol = Math.max(tolerance, 8);
    const lines = this._frameState.lines || [];
    for (const entry of lines) {
      if (!entry) continue;
      const { drawing } = entry;
      const handles = entry.handles || {};
      if (handles.p1 && Number.isFinite(handles.p1.x)) {
        const d = Math.hypot(x - handles.p1.x, y - handles.p1.y);
        if (d <= handleTol && (!best || d < best.distance)) {
          best = { drawingId: drawing.id, handle: "p1", distance: d, kind: "handle" };
          continue;
        }
      }
      if (handles.p2 && Number.isFinite(handles.p2.x)) {
        const d = Math.hypot(x - handles.p2.x, y - handles.p2.y);
        if (d <= handleTol && (!best || d < best.distance)) {
          best = { drawingId: drawing.id, handle: "p2", distance: d, kind: "handle" };
          continue;
        }
      }
      const { x: x1, y: y1 } = { x: entry.x1, y: entry.y1 };
      const { x: x2, y: y2 } = { x: entry.x2, y: entry.y2 };
      if ([x1, y1, x2, y2].every(Number.isFinite)) {
        const d = pointSegmentDistance(x, y, x1, y1, x2, y2);
        if (d <= tolerance && (!best || d < best.distance)) {
          best = { drawingId: drawing.id, handle: null, distance: d, kind: "body" };
        }
      }
    }
    return best;
  }

  getState() {
    return this._frameState;
  }
}

function logicalToX(chart, logical) {
  if (!chart || !Number.isFinite(logical)) return null;
  const timeScale = chart.timeScale?.();
  if (!timeScale || typeof timeScale.logicalToCoordinate !== "function") return null;
  const x = timeScale.logicalToCoordinate(logical);
  return Number.isFinite(x) ? x : null;
}

function priceToY(series, price, fallbackLogical) {
  if (!series || !Number.isFinite(price)) return null;
  const scale = series.priceScale?.();
  const y = typeof series.priceToCoordinate === "function"
    ? series.priceToCoordinate(price)
    : null;
  if (Number.isFinite(y)) return y;
  // Fallback defensivo: si la serie no está lista, devolvemos null. La primitiva
  // ya cubre el caso común porque `priceToCoordinate` siempre está disponible
  // en ISeriesApi; este fallback sólo se dispara en estados transitorios.
  void scale;
  void fallbackLogical;
  return null;
}

function computeViewportSize(chart) {
  if (!chart) return null;
  try {
    const timeScale = chart.timeScale?.();
    if (!timeScale) return null;
    const logical = timeScale.getVisibleLogicalRange?.();
    if (!logical) return null;
    const width = timeScale.width?.();
    if (!Number.isFinite(width)) return null;
    return { from: Number(logical.from), to: Number(logical.to), width };
  } catch {
    return null;
  }
}