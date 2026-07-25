// lib/chartViewportLifecycle.js — pieza pura del ciclo de vida de viewport
// (ADR chart-controller-extraction §4 / §9.6, paso 6 de §9).
//
// Esta capa encapsula la lógica del hook `useChartViewport` sin React, sin
// DOM, sin `lightweight-charts`. Trabaja sobre un objeto `state` plano
// (refs-like) que el caller provee, y un `publish` callback que recibe
// notificaciones de cambio (la integración React lo traduce a `setState`).
//
// El `timeScale` nativo sigue siendo la fuente de verdad operativa
// mientras hay un attach (§4.1): las actions leen el rango nativo, escriben
// una sola vez y dejan que la subscription confirme.
//
// API pública (estable, §4.4):
//   createViewportLifecycle({ state, publish, getInteractionState, interval,
//     dataRange, requestedHeight, getRowTimes }) → {
//     prepare(container),
//     attach({ chart, container, renderMeta, profile, onGeometryChange }) => release(),
//     detach({ reason }),
//     actions: { zoom, pan, reset, scrollToLatest },
//     getSnapshot(),
//   }
//
// `attachmentId` no se expone al consumidor: invalida callbacks, RAF y
// timeouts del chart anterior (§4.3). La cleanup `release()` de un attach
// viejo se vuelve no-op cuando llega un attach nuevo (§4.8.6).
//
// Esta pieza es 100% pura: no importa React, no accede a `window`/`document`
// directamente (los polyfills `ResizeObserver`/`requestAnimationFrame` se
// reciben del caller o se leen de `globalThis` si están disponibles, igual
// que `lib/chartNavigation.js`).

import {
  chartViewStateFromLogicalRange,
  latestLogicalRange,
  manualChartWindowRestorePolicy,
  rescaledLogicalRange,
  shiftedLogicalRange,
  timeWindowFromLogicalRange,
  timeWindowLogicalRange,
  zoomedLogicalRange,
} from "@/lib/chartNavigation";
import {
  adaptiveChartProfile,
  chartWindowLabel,
  emptyManualWindow,
  numericVisibleTimeRange,
  responsiveChartHeight,
} from "@/lib/chartViewportModel";

const INITIAL_VIEW_STATE = chartViewStateFromLogicalRange(null, 0);

function safeTimeScale(chart) {
  if (!chart || typeof chart.timeScale !== "function") return null;
  try { return chart.timeScale(); } catch { return null; }
}

function snapshotManualWindow(prev, renderMeta) {
  if (!prev || !prev.active) return emptyManualWindow();
  return {
    active: true,
    timeRange: prev.timeRange ? { ...prev.timeRange } : null,
    logicalRange: prev.logicalRange ? { ...prev.logicalRange } : null,
    rowCount: Number.isFinite(prev.rowCount) ? prev.rowCount : 0,
    renderMeta: renderMeta
      ? { ready: true, symbol: renderMeta.symbol, range: renderMeta.range, interval: renderMeta.interval, style: renderMeta.style, scale: renderMeta.scale }
      : prev.renderMeta || null,
  };
}

function buildRenderMeta(input = {}) {
  return {
    ready: true,
    symbol: input.symbol || "",
    range: input.range || "",
    interval: input.interval || "",
    style: input.style || "",
    scale: input.scale || "",
    rowCount: Number.isFinite(input.rowCount) ? input.rowCount : 0,
  };
}

function rafAvailable() {
  return typeof globalThis !== "undefined"
    && typeof globalThis.requestAnimationFrame === "function";
}

function scheduleRaf(callback) {
  if (rafAvailable()) return globalThis.requestAnimationFrame(callback);
  return setTimeout(callback, 16);
}

function cancelScheduledRaf(handle) {
  if (handle == null) return;
  if (typeof globalThis !== "undefined"
    && typeof globalThis.cancelAnimationFrame === "function") {
    globalThis.cancelAnimationFrame(handle);
    return;
  }
  clearTimeout(handle);
}

function newState() {
  return {
    lifecycle: "detached",
    attachmentId: 0,
    currentAttachmentId: 0,
    chart: null,
    container: null,
    profile: null,
    renderMeta: { ready: false, symbol: "", range: "", interval: "", style: "", scale: "", rowCount: 0 },
    previousRenderMeta: { ready: false, symbol: "", range: "", interval: "", style: "", scale: "", rowCount: 0 },
    visibleLogicalRange: null,
    visibleTimeRange: null,
    manualWindow: emptyManualWindow(),
    view: INITIAL_VIEW_STATE,
    lastInteractiveView: INITIAL_VIEW_STATE,
    visibleWindowLabel: "Sin ventana",
    rafHandle: null,
    restoreTimeouts: [],
    resizeObserver: null,
    wheelHandler: null,
    unsubscribeLogical: null,
    unsubscribeTimeRange: null,
  };
}

function buildPublicSnapshot(state) {
  return {
    lifecycle: state.lifecycle,
    visibleLogicalRange: state.visibleLogicalRange ? { ...state.visibleLogicalRange } : null,
    visibleTimeRange: state.visibleTimeRange ? { ...state.visibleTimeRange } : null,
    visibleWindowLabel: state.visibleWindowLabel,
    profile: state.profile,
  };
}

function buildPrivateSnapshot(state) {
  return {
    lifecycle: state.lifecycle,
    logicalRange: state.visibleLogicalRange ? { ...state.visibleLogicalRange } : null,
    timeRange: state.visibleTimeRange ? { ...state.visibleTimeRange } : null,
    rowCount: state.rowCount,
    view: state.view,
    lastInteractiveView: state.lastInteractiveView,
    manualWindow: snapshotManualWindow(state.manualWindow, state.renderMeta.ready ? state.renderMeta : null),
    profile: state.profile,
  };
}

/**
 * Crea el ciclo de vida de viewport.
 *
 * @param {object} args
 * @param {object} args.state                   refs-like: si el caller no provee uno se crea uno interno.
 * @param {(snapshot: object) => void} args.publish  callback que recibe el snapshot público.
 * @param {() => string} [args.getInteractionState]  devuelve 'idle' | 'armed' | ...
 * @param {string} args.interval                intervalo normalizado (D, 1H, ...)
 * @param {string} args.dataRange               rango normalizado
 * @param {number} args.requestedHeight         altura objetivo
 * @param {() => number[]} args.getRowTimes     devuelve los rowTimes vigentes (lectura síncrona).
 */
export function createViewportLifecycle({
  state: externalState = null,
  publish,
  getInteractionState = null,
  interval = "D",
  dataRange = "1A",
  requestedHeight = 460,
  getRowTimes,
} = {}) {
  if (typeof publish !== "function") {
    throw new Error("createViewportLifecycle: publish es obligatorio");
  }
  if (typeof getRowTimes !== "function") {
    throw new Error("createViewportLifecycle: getRowTimes es obligatorio");
  }

  const state = externalState || newState();

  // ─────────────────────────────────────────────────────────────────────────
  // Publicación agrupada por RAF. BUG 1: la callback valida que el
  // attachment siga vigente (ADR §4.8.6).
  // ─────────────────────────────────────────────────────────────────────────
  function schedulePublishSoon(expectedAttachmentId = null) {
    if (state.rafHandle != null) return;
    state.rafHandle = scheduleRaf(() => {
      state.rafHandle = null;
      if (expectedAttachmentId != null && state.attachmentId !== expectedAttachmentId) {
        return;
      }
      publish(buildPublicSnapshot(state));
    });
  }

  function cancelScheduledPublish() {
    if (state.rafHandle != null) {
      cancelScheduledRaf(state.rafHandle);
      state.rafHandle = null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helpers de suscripción: actualizan refs, planifican publicación.
  // ─────────────────────────────────────────────────────────────────────────
  function updateViewStateFromLogicalRange(logicalRange) {
    if (!logicalRange) return;
    const rowTimes = getRowTimes();
    const nextViewState = chartViewStateFromLogicalRange(logicalRange, rowTimes.length);
    state.view = nextViewState;
    state.visibleLogicalRange = logicalRange;
    const derivedTimeRange = timeWindowFromLogicalRange({ rowTimes, logicalRange });
    if (derivedTimeRange) state.visibleTimeRange = derivedTimeRange;
    state.visibleWindowLabel = chartWindowLabel(derivedTimeRange || state.visibleTimeRange, interval);
    if (nextViewState.isManual) {
      state.manualWindow = {
        active: true,
        timeRange: derivedTimeRange || state.visibleTimeRange,
        logicalRange,
        rowCount: rowTimes.length,
      };
    }
    if (nextViewState.key !== "unknown") state.lastInteractiveView = nextViewState;
    schedulePublishSoon();
  }

  function updateTimeRangeState(timeRange) {
    const next = numericVisibleTimeRange(timeRange);
    if (!next) return;
    state.visibleTimeRange = next;
    state.visibleWindowLabel = chartWindowLabel(next, interval);
    schedulePublishSoon();
  }

  function captureManualWindow() {
    const timeScale = safeTimeScale(state.chart);
    if (!timeScale) return state.manualWindow;
    const logicalRange = typeof timeScale.getVisibleLogicalRange === "function"
      ? timeScale.getVisibleLogicalRange()
      : null;
    if (!logicalRange) return state.manualWindow;
    const rowTimes = getRowTimes();
    const timeRange = timeWindowFromLogicalRange({ rowTimes, logicalRange }) || state.visibleTimeRange;
    const viewState = chartViewStateFromLogicalRange(logicalRange, rowTimes.length);
    state.visibleLogicalRange = logicalRange;
    if (timeRange) state.visibleTimeRange = timeRange;
    state.view = viewState;
    if (viewState.isManual) {
      state.manualWindow = {
        active: true,
        timeRange,
        logicalRange,
        rowCount: rowTimes.length,
      };
    }
    return state.manualWindow;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Actions: singletons dentro de la pieza pura, no por attach. El guard
  // `lifecycle === "attached"` ya descarta escrituras cuando no hay chart
  // vigente; el guard `attachmentId === currentAttachmentId` es defensivo
  // y redundante con la máquina de estados actual
  // (attach/detach/resetBySymbol/release/unmount mantienen ambos ids
  // sincronizados y/o dejan lifecycle en "detached"). Se conserva como
  // cinturón de seguridad explícito frente a una regresión futura que
  // permita un estado "attached" con ids desincronizados; no es la
  // protección que BUG 4 llamaba, sino documentación viva del invariante.
  // ─────────────────────────────────────────────────────────────────────────
  function zoom(factor = 1) {
    if (state.lifecycle !== "attached") return;
    if (state.attachmentId !== state.currentAttachmentId) return;
    const timeScale = safeTimeScale(state.chart);
    if (!timeScale || typeof timeScale.getVisibleLogicalRange !== "function") return;
    const currentRange = timeScale.getVisibleLogicalRange();
    const nextRange = zoomedLogicalRange({
      rowCount: getRowTimes().length,
      currentRange,
      factor,
      anchorLatest: !state.view?.isAwayFromLatest,
    });
    if (!nextRange) return;
    timeScale.setVisibleLogicalRange?.(nextRange);
  }

  function pan(direction = -1) {
    if (state.lifecycle !== "attached") return;
    if (state.attachmentId !== state.currentAttachmentId) return;
    const timeScale = safeTimeScale(state.chart);
    if (!timeScale || typeof timeScale.getVisibleLogicalRange !== "function") return;
    const currentRange = timeScale.getVisibleLogicalRange();
    const nextRange = shiftedLogicalRange({
      rowCount: getRowTimes().length,
      currentRange,
      direction,
    });
    if (!nextRange) return;
    timeScale.setVisibleLogicalRange?.(nextRange);
  }

  function scrollToLatest() {
    if (state.lifecycle !== "attached") return;
    if (state.attachmentId !== state.currentAttachmentId) return;
    const timeScale = safeTimeScale(state.chart);
    if (!timeScale) return;
    const rowTimes = getRowTimes();
    const nextRange = latestLogicalRange({
      rowCount: rowTimes.length,
      currentRange: typeof timeScale.getVisibleLogicalRange === "function"
        ? timeScale.getVisibleLogicalRange()
        : null,
      fallbackSpan: Math.min(rowTimes.length, 90),
    });
    if (nextRange) {
      timeScale.setVisibleLogicalRange?.(nextRange);
      return;
    }
    timeScale.scrollToRealTime?.();
  }

  function reset() {
    if (state.lifecycle !== "attached") return;
    if (state.attachmentId !== state.currentAttachmentId) return;
    const timeScale = safeTimeScale(state.chart);
    if (!timeScale) return;
    timeScale.fitContent?.();
    const rightOffsetPixels = state.profile?.timeScale?.rightOffsetPixels;
    if (Number.isFinite(rightOffsetPixels)) {
      timeScale.applyOptions?.({ rightOffsetPixels });
    }
    const rowTimes = getRowTimes();
    const restoredRange = latestLogicalRange({
      rowCount: rowTimes.length,
      currentRange: null,
      fallbackSpan: rowTimes.length,
    });
    if (restoredRange) {
      timeScale.setVisibleLogicalRange?.(restoredRange);
    }
    state.manualWindow = emptyManualWindow();
    if (restoredRange) {
      updateViewStateFromLogicalRange(restoredRange);
    } else {
      schedulePublishSoon(state.currentAttachmentId);
    }
  }

  const actions = { zoom, pan, reset, scrollToLatest };

  // ─────────────────────────────────────────────────────────────────────────
  // `prepare`: mide el contenedor y devuelve profile sin crear chart.
  // ─────────────────────────────────────────────────────────────────────────
  function prepare(container) {
    if (!container) return null;
    const width = Math.max(container.clientWidth || 0, 280);
    const height = responsiveChartHeight(width, requestedHeight);
    const profile = adaptiveChartProfile({
      interval,
      range: dataRange,
      rowCount: getRowTimes().length,
      width,
      volume: true,
    });
    return { width, height, profile };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // `attach`: ciclo completo de la §4.7.
  // ─────────────────────────────────────────────────────────────────────────
  function attach({
    chart,
    container,
    renderMeta,
    profile,
    onGeometryChange,
  } = {}) {
    if (!chart || !container) return () => {};

    // §4.7.1: invalidar cualquier attachment anterior.
    state.attachmentId += 1;
    const myAttachmentId = state.attachmentId;

    state.previousRenderMeta = state.renderMeta && state.renderMeta.ready
      ? state.renderMeta
      : { ready: false, symbol: "", range: "", interval: "", style: "", scale: "", rowCount: 0 };
    state.renderMeta = buildRenderMeta({
      ...renderMeta,
      rowCount: getRowTimes().length,
    });

    const timeScale = safeTimeScale(chart);
    if (!timeScale) {
      state.lifecycle = "detached";
      schedulePublishSoon();
      return () => {};
    }

    const myHandles = {
      unsubscribeLogical: null,
      unsubscribeTimeRange: null,
      detachWheel: null,
      resizeDisconnect: null,
      restoreTimeouts: [],
      rafPublication: null,
    };

    function localHandleSet(key, value) {
      myHandles[key] = value;
      if (state.attachmentId === myAttachmentId) {
        if (key === "unsubscribeLogical") state.unsubscribeLogical = value;
        else if (key === "unsubscribeTimeRange") state.unsubscribeTimeRange = value;
        else if (key === "detachWheel") state.wheelHandler = value;
        else if (key === "resizeDisconnect") state.resizeObserver = value;
        else if (key === "restoreTimeouts") state.restoreTimeouts = value;
        else if (key === "rafPublication") state.rafHandle = value;
      }
    }

    state.lifecycle = "attached";
    state.chart = chart;
    state.container = container;
    state.currentAttachmentId = myAttachmentId;
    state.profile = profile || adaptiveChartProfile({
      interval,
      range: dataRange,
      rowCount: getRowTimes().length,
      width: Math.max(container.clientWidth || 0, 280),
      volume: true,
    });

    if (profile?.timeScale && typeof chart.applyOptions === "function") {
      try { chart.applyOptions({ timeScale: { ...profile.timeScale } }); } catch { /* noop */ }
    }
    timeScale.fitContent?.();

    const nextRenderMeta = state.renderMeta;
    const previousRenderMeta = state.previousRenderMeta;
    const previousManual = state.manualWindow;
    const restoreViewState = previousManual?.active
      ? { isManual: true }
      : state.view?.isManual
        ? state.view
        : state.lastInteractiveView;
    const restoreTimeRange = previousManual?.active ? previousManual.timeRange : state.visibleTimeRange;
    const restoreLogicalRange = previousManual?.active ? previousManual.logicalRange : state.visibleLogicalRange;
    const restorePreviousRowCount = previousManual?.active ? previousManual.rowCount : previousRenderMeta?.rowCount;

    const restorePolicy = manualChartWindowRestorePolicy({
      previousMeta: previousRenderMeta,
      nextMeta: nextRenderMeta,
      viewState: restoreViewState,
      visibleTimeRange: restoreTimeRange,
    });

    let restoredLogicalRange = null;
    if (restorePolicy.restore) {
      const rowTimes = getRowTimes();
      const fromTime = timeWindowLogicalRange({
        rowTimes,
        timeRange: restoreTimeRange,
        minSpan: 8,
      });
      const fromLogical = rescaledLogicalRange({
        previousRowCount: restorePreviousRowCount,
        nextRowCount: rowTimes.length,
        previousRange: restoreLogicalRange,
        minSpan: 8,
      });
      const fromTimeState = chartViewStateFromLogicalRange(fromTime, rowTimes.length);
      const fromLogicalState = chartViewStateFromLogicalRange(fromLogical, rowTimes.length);
      if (fromTimeState.isManual) {
        restoredLogicalRange = fromTime;
      } else if (fromLogicalState.isManual) {
        restoredLogicalRange = fromLogical;
      } else {
        restoredLogicalRange = fromTime || fromLogical;
      }
    }

    const onLogicalRangeChange = () => {
      if (state.attachmentId !== myAttachmentId) return;
      const next = timeScale.getVisibleLogicalRange?.();
      if (next) updateViewStateFromLogicalRange(next);
    };
    const onTimeRangeChange = (nextTimeRange) => {
      if (state.attachmentId !== myAttachmentId) return;
      updateTimeRangeState(nextTimeRange);
    };
    if (typeof timeScale.subscribeVisibleLogicalRangeChange === "function") {
      timeScale.subscribeVisibleLogicalRangeChange(onLogicalRangeChange);
      localHandleSet("unsubscribeLogical", () => {
        try { timeScale.unsubscribeVisibleLogicalRangeChange?.(onLogicalRangeChange); } catch { /* noop */ }
      });
    }
    if (typeof timeScale.subscribeVisibleTimeRangeChange === "function") {
      timeScale.subscribeVisibleTimeRangeChange(onTimeRangeChange);
      localHandleSet("unsubscribeTimeRange", () => {
        try { timeScale.unsubscribeVisibleTimeRangeChange?.(onTimeRangeChange); } catch { /* noop */ }
      });
    }

    const initialTimeRange = typeof timeScale.getVisibleRange === "function"
      ? numericVisibleTimeRange(timeScale.getVisibleRange())
      : null;
    if (initialTimeRange) {
      state.visibleTimeRange = initialTimeRange;
      state.visibleWindowLabel = chartWindowLabel(initialTimeRange, interval);
    }

    if (restoredLogicalRange) {
      const applyRestored = () => {
        if (state.attachmentId !== myAttachmentId) return;
        timeScale.setVisibleLogicalRange?.(restoredLogicalRange);
        updateViewStateFromLogicalRange(restoredLogicalRange);
      };
      applyRestored();
      const rafId = scheduleRaf(applyRestored);
      localHandleSet("rafPublication", rafId);
      const timeoutId = setTimeout(applyRestored, 80);
      myHandles.restoreTimeouts.push(timeoutId);
      localHandleSet("restoreTimeouts", myHandles.restoreTimeouts.slice());
    } else {
      onLogicalRangeChange();
      const rafId = scheduleRaf(onLogicalRangeChange);
      localHandleSet("rafPublication", rafId);
    }

    // §4.6: wheel gateado por getInteractionState() === "idle".
    const wheelListener = (event) => {
      const interactionState = typeof getInteractionState === "function" ? getInteractionState() : "idle";
      const isIdle = interactionState === "idle";
      if (event.ctrlKey) {
        if (event.cancelable) {
          try { event.preventDefault(); } catch { /* noop */ }
        }
        try { event.stopImmediatePropagation(); } catch { /* noop */ }
        if (!isIdle) return;
        if (state.attachmentId !== myAttachmentId) return;
        const factor = Math.exp(event.deltaY * 0.0015);
        zoom(factor);
        return;
      }
      try { event.stopImmediatePropagation(); } catch { /* noop */ }
    };
    container.addEventListener("wheel", wheelListener, { capture: true, passive: false });
    localHandleSet("detachWheel", () => container.removeEventListener("wheel", wheelListener, { capture: true }));

    // §4.5: resize conserva manual, readapta automático.
    const onResize = ([entry]) => {
      if (state.attachmentId !== myAttachmentId) return;
      const nextWidth = Math.max(Math.floor(entry?.contentRect?.width || 0), 280);
      if (nextWidth <= 0) return;
      const nextHeight = responsiveChartHeight(nextWidth, requestedHeight);
      const ts = safeTimeScale(chart);
      const logicalRange = ts && typeof ts.getVisibleLogicalRange === "function"
        ? ts.getVisibleLogicalRange()
        : null;
      const wasManual = chartViewStateFromLogicalRange(logicalRange, getRowTimes().length).isManual;
      const nextProfile = adaptiveChartProfile({
        interval,
        range: dataRange,
        rowCount: getRowTimes().length,
        width: nextWidth,
        volume: true,
      });
      state.profile = nextProfile;
      try {
        chart.applyOptions?.({
          width: nextWidth,
          height: nextHeight,
          timeScale: { ...nextProfile.timeScale },
        });
      } catch { /* noop */ }
      if (wasManual && logicalRange) {
        ts?.setVisibleLogicalRange?.(logicalRange);
      }
      if (typeof onGeometryChange === "function") {
        onGeometryChange({ width: nextWidth, height: nextHeight, profile: nextProfile });
      }
      schedulePublishSoon();
    };
    if (typeof ResizeObserver === "function") {
      const observer = new ResizeObserver(onResize);
      observer.observe(container);
      localHandleSet("resizeDisconnect", () => observer.disconnect());
    }

    schedulePublishSoon(myAttachmentId);

    // §4.4: `release()` libera sólo el attachment que lo creó.
    return function release() {
      if (state.attachmentId !== myAttachmentId) return;
      // BUG 3/9: guard explícito. Si este attach sigue siendo el
      // vigente Y el chart aún vive, capturamos la ventana manual
      // antes de desuscribir.
      if (state.currentAttachmentId === myAttachmentId) {
        captureManualWindow();
      }
      state.attachmentId += 1;
      try { myHandles.unsubscribeLogical?.(); } catch { /* noop */ }
      try { myHandles.unsubscribeTimeRange?.(); } catch { /* noop */ }
      try { myHandles.detachWheel?.(); } catch { /* noop */ }
      try { myHandles.resizeDisconnect?.(); } catch { /* noop */ }
      for (const t of myHandles.restoreTimeouts) {
        try { clearTimeout(t); } catch { /* noop */ }
      }
      if (myHandles.rafPublication != null) cancelScheduledRaf(myHandles.rafPublication);
      state.unsubscribeLogical = null;
      state.unsubscribeTimeRange = null;
      state.wheelHandler = null;
      state.resizeObserver = null;
      state.restoreTimeouts = [];
      if (state.rafHandle === myHandles.rafPublication) state.rafHandle = null;
      state.lifecycle = "detached";
      schedulePublishSoon();
    };
  }

  // §4.7: detach — captura la ventana manual final, desuscribe, cancela
  // tareas y vacía referencias nativas. NO llama `chart.remove()`.
  function detach({ reason = "manual" } = {}) {
    if (state.lifecycle !== "attached") return;
    captureManualWindow();
    state.attachmentId += 1;
    state.currentAttachmentId = state.attachmentId;
    cancelScheduledPublish();
    if (state.rafHandle != null) {
      cancelScheduledRaf(state.rafHandle);
      state.rafHandle = null;
    }
    for (const t of state.restoreTimeouts || []) {
      try { clearTimeout(t); } catch { /* noop */ }
    }
    state.restoreTimeouts = [];
    try { state.unsubscribeLogical?.(); } catch { /* noop */ }
    try { state.unsubscribeTimeRange?.(); } catch { /* noop */ }
    try { state.wheelHandler?.(); } catch { /* noop */ }
    try { state.resizeObserver?.(); } catch { /* noop */ }
    state.unsubscribeLogical = null;
    state.unsubscribeTimeRange = null;
    state.wheelHandler = null;
    state.resizeObserver = null;
    state.chart = null;
    state.container = null;
    state.previousRenderMeta = state.renderMeta;
    state.lifecycle = "detached";
    void reason;
    schedulePublishSoon();
  }

  function resetBySymbol() {
    cancelScheduledPublish();
    if (state.rafHandle != null) {
      cancelScheduledRaf(state.rafHandle);
      state.rafHandle = null;
    }
    for (const t of state.restoreTimeouts || []) {
      try { clearTimeout(t); } catch { /* noop */ }
    }
    state.restoreTimeouts = [];
    try { state.unsubscribeLogical?.(); } catch { /* noop */ }
    try { state.unsubscribeTimeRange?.(); } catch { /* noop */ }
    try { state.wheelHandler?.(); } catch { /* noop */ }
    try { state.resizeObserver?.(); } catch { /* noop */ }
    state.unsubscribeLogical = null;
    state.unsubscribeTimeRange = null;
    state.wheelHandler = null;
    state.resizeObserver = null;
    state.attachmentId += 1;
    state.currentAttachmentId = state.attachmentId;
    state.manualWindow = emptyManualWindow();
    state.visibleLogicalRange = null;
    state.visibleTimeRange = null;
    state.lastInteractiveView = INITIAL_VIEW_STATE;
    state.view = INITIAL_VIEW_STATE;
    state.previousRenderMeta = { ready: false, symbol: "", range: "", interval: "", style: "", scale: "", rowCount: 0 };
    state.renderMeta = { ready: false, symbol: "", range: "", interval: "", style: "", scale: "", rowCount: 0 };
    state.lifecycle = "detached";
    state.chart = null;
    state.container = null;
    schedulePublishSoon(state.attachmentId);
  }

  function unmount() {
    cancelScheduledPublish();
    if (state.rafHandle != null) {
      cancelScheduledRaf(state.rafHandle);
      state.rafHandle = null;
    }
    for (const t of state.restoreTimeouts || []) {
      try { clearTimeout(t); } catch { /* noop */ }
    }
    state.restoreTimeouts = [];
    try { state.unsubscribeLogical?.(); } catch { /* noop */ }
    try { state.unsubscribeTimeRange?.(); } catch { /* noop */ }
    try { state.wheelHandler?.(); } catch { /* noop */ }
    try { state.resizeObserver?.(); } catch { /* noop */ }
    state.unsubscribeLogical = null;
    state.unsubscribeTimeRange = null;
    state.wheelHandler = null;
    state.resizeObserver = null;
    state.attachmentId += 1;
    state.lifecycle = "detached";
    state.chart = null;
    state.container = null;
  }

  function getSnapshot() {
    if (state.lifecycle === "attached") {
      const ts = safeTimeScale(state.chart);
      const native = ts && typeof ts.getVisibleLogicalRange === "function" ? ts.getVisibleLogicalRange() : null;
      if (native) updateViewStateFromLogicalRange(native);
    }
    return buildPrivateSnapshot({ ...state, rowCount: getRowTimes().length });
  }

  return {
    prepare,
    attach,
    detach,
    resetBySymbol,
    unmount,
    actions,
    getSnapshot,
    _state: state, // exportado sólo para tests/debug.
  };
}
