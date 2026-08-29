// lib/chartViewportLifecycle.js — ciclo de vida del viewport del chart.
//
// CONTRATO (docs/analisis-grafico-2026-08-14.md, Parte C.1 — la inversión):
//
//   La ventana visible es una función pura de (settings, datos, desviación
//   manual). El rango declarado se dibuja ENTERO al adjuntar (`fitContent`);
//   la única desviación legítima es un gesto o acción explícita del usuario,
//   que se conserva como estado de primera clase (`manualView`, una ventana
//   TEMPORAL {fromTime, toTime}) y se re-aplica tal cual en cada re-attach.
//   No existe política de restauración heurística: `clearManual()` —invocado
//   por el hook al cambiar símbolo/rango/intervalo— es la única forma de
//   volver al comportamiento puro, además de la acción `reset()` del usuario.
//
// Reglas de instancia:
//   - UNA instancia por montaje del componente. Los parámetros dinámicos
//     (config, rowTimes, altura, estado de interacción) entran como getters
//     y se leen en el momento de uso: la instancia nunca se recrea por
//     cambios de identidad de props.
//   - `attach()` libera automáticamente el attachment anterior si sigue
//     vivo, y devuelve su propio `release()`. `detach()`/`unmount()` liberan
//     el vigente. Nada queda suscrito ni programado tras liberar: wheel,
//     ResizeObserver, suscripciones del timeScale y el RAF de publicación
//     se retiran siempre.
//   - Publicación: un único mecanismo (`schedulePublish`), agrupado por RAF.
//     El callback SIEMPRE limpia su handle antes de publicar; no hay ningún
//     otro escritor de ese handle. El snapshot público incluye `view` (la
//     clasificación de chartViewStateFromLogicalRange): el raíl y los
//     botones se alimentan de él.
//
// La fuente de verdad operativa del rango visible sigue siendo el timeScale
// nativo mientras hay chart adjunto; `manualView` se DERIVA de cada cambio
// del rango visible (gesto, acción o programático): si la vista clasifica
// como manual se recuerda su ventana temporal, si clasifica como completa se
// olvida. La derivación es convergente: re-aplicar una ventana recordada
// produce la misma ventana recordada.

import {
  chartViewStateFromLogicalRange,
  latestLogicalRange,
  shiftedLogicalRange,
  timeWindowFromLogicalRange,
  timeWindowLogicalRange,
  zoomedLogicalRange,
} from "@/lib/chartNavigation";
import {
  adaptiveChartProfile,
  chartWindowLabel,
  responsiveChartHeight,
} from "@/lib/chartViewportModel";

const INITIAL_VIEW_STATE = chartViewStateFromLogicalRange(null, 0);

function safeTimeScale(chart) {
  if (!chart || typeof chart.timeScale !== "function") return null;
  try { return chart.timeScale(); } catch { return null; }
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

/**
 * Crea el ciclo de vida de viewport (instancia única por montaje).
 *
 * @param {object} args
 * @param {(snapshot: object) => void} args.publish   recibe el snapshot público.
 * @param {() => string} [args.getInteractionState]   'idle' | 'armed' | ...
 * @param {() => {interval: string, dataRange: string}} args.getConfig
 *                                                    config vigente, leída al usarla.
 * @param {() => number} [args.getRequestedHeight]    altura objetivo vigente.
 * @param {() => number[]} args.getRowTimes           rowTimes vigentes.
 */
export function createViewportLifecycle({
  publish,
  getPublish = null,
  getInteractionState = null,
  getConfig,
  getRequestedHeight = () => 460,
  getRowTimes,
} = {}) {
  if (typeof publish !== "function" && typeof getPublish !== "function") {
    throw new Error("createViewportLifecycle: publish es obligatorio");
  }
  if (typeof getRowTimes !== "function") {
    throw new Error("createViewportLifecycle: getRowTimes es obligatorio");
  }
  if (typeof getConfig !== "function") {
    throw new Error("createViewportLifecycle: getConfig es obligatorio");
  }

  function emit(snapshot) {
    const fn = typeof getPublish === "function" ? getPublish() : publish;
    if (typeof fn === "function") fn(snapshot);
  }

  const state = {
    lifecycle: "detached",
    chart: null,
    container: null,
    profile: null,
    view: INITIAL_VIEW_STATE,
    visibleLogicalRange: null,
    visibleTimeRange: null,
    visibleWindowLabel: "Sin ventana",
    // Desviación manual EXPLÍCITA: ventana temporal {from, to} en segundos,
    // o null (= la ventana es el rango declarado, anclada por fitContent).
    manualView: null,
    // Objetivo contractual EN VUELO. lightweight-charts aplica fitContent y
    // setVisibleLogicalRange en su propio animation frame: entre la petición
    // y la aplicación el timeScale sigue informando la ventana anterior (o la
    // de espaciado por defecto en un chart recién creado). Ese estado
    // intermedio NO es una desviación del usuario y no debe convertirse en
    // `manualView`. Mientras haya un objetivo pendiente, las emisiones que no
    // lo alcancen solo actualizan `view` (el raíl es honesto con lo visible);
    // la que lo alcanza lo consume. `pendingEmissions` es la vía de escape:
    // si el objetivo nunca llega (p. ej. un gesto lo canceló), tras unas
    // cuantas emisiones se suelta y la última ventana observada vuelve a ser
    // la verdad.
    contractTarget: null,
    pendingEmissions: 0,
    rafHandle: null,
    // Attachment vigente: attach() lo sustituye liberando el anterior.
    attachment: null,
  };

  // Emisiones intermedias toleradas antes de soltar un objetivo que no llega.
  const MAX_PENDING_EMISSIONS = 10;

  function rangeMatchesTarget(range, target) {
    if (!range || !target) return false;
    if (target.kind === "fit") {
      const rows = getRowTimes().length;
      if (rows < 2) return true;
      // fitContent anclado a la derecha. Con minBarSpacing el `from` puede ser
      // > 0 (no caben todas las barras): sigue siendo el contrato, no zoom
      // manual del usuario.
      const maxTo = rows - 0.5;
      return Number(range.to) >= maxTo - 1.5;
    }
    if (target.kind === "manual" && target.logical) {
      return Math.abs(range.from - target.logical.from) <= 1
        && Math.abs(range.to - target.logical.to) <= 1;
    }
    return false;
  }

  function interval() {
    return getConfig()?.interval || "D";
  }

  function buildSnapshot() {
    return {
      lifecycle: state.lifecycle,
      view: state.view,
      manual: state.manualView != null,
      visibleLogicalRange: state.visibleLogicalRange ? { ...state.visibleLogicalRange } : null,
      visibleTimeRange: state.visibleTimeRange ? { ...state.visibleTimeRange } : null,
      visibleWindowLabel: state.visibleWindowLabel,
      profile: state.profile,
    };
  }

  // ── Publicación: un único camino, agrupado por RAF. ──────────────────────
  function schedulePublish() {
    if (state.rafHandle != null) return;
    state.rafHandle = scheduleRaf(() => {
      state.rafHandle = null;
      emit(buildSnapshot());
    });
  }

  function cancelScheduledPublish() {
    if (state.rafHandle != null) {
      cancelScheduledRaf(state.rafHandle);
      state.rafHandle = null;
    }
  }

  // ── Derivación de estado desde el rango lógico vigente. ──────────────────
  //
  // Único punto donde se escriben view/visibleLogicalRange/visibleTimeRange y
  // (sin objetivo contractual en vuelo) manualView. Convergente: una vista
  // completa olvida el manual; una vista desviada lo recuerda como ventana
  // temporal.
  function deriveFromLogicalRange(logicalRange) {
    if (!logicalRange) return;
    const rowTimes = getRowTimes();
    const nextView = chartViewStateFromLogicalRange(logicalRange, rowTimes.length);
    state.view = nextView;
    state.visibleLogicalRange = { from: Number(logicalRange.from), to: Number(logicalRange.to) };
    const timeRange = timeWindowFromLogicalRange({ rowTimes, logicalRange });
    if (timeRange) state.visibleTimeRange = timeRange;
    state.visibleWindowLabel = chartWindowLabel(timeRange || state.visibleTimeRange, interval());

    let consumedFit = false;
    if (state.contractTarget) {
      if (rangeMatchesTarget(state.visibleLogicalRange, state.contractTarget)) {
        // El objetivo aplicó: se consume y la ventana observada es la verdad.
        consumedFit = state.contractTarget.kind === "fit";
        state.contractTarget = null;
        state.pendingEmissions = 0;
      } else {
        // Estado intermedio de la librería: no es una desviación del usuario.
        state.pendingEmissions += 1;
        if (state.pendingEmissions >= MAX_PENDING_EMISSIONS) {
          consumedFit = state.contractTarget.kind === "fit";
          state.contractTarget = null;
          state.pendingEmissions = 0;
        } else {
          schedulePublish();
          return;
        }
      }
    }

    // El fit contractual (aunque minBarSpacing recorte la izquierda) no es
    // desviación manual: si no, Restaurar queda siempre activo tras reset.
    if (consumedFit) {
      state.manualView = null;
      schedulePublish();
      return;
    }

    if (nextView.isManual && timeRange) {
      state.manualView = { from: timeRange.from, to: timeRange.to };
    } else if (nextView.isManual && !timeRange && state.visibleLogicalRange) {
      // rowTimes aún no listos: no borres una manualView previa; si no hay,
      // deja que el siguiente sync con tiempos la materialice.
    } else if (!nextView.isManual) {
      state.manualView = null;
    }
    schedulePublish();
  }

  function syncFromNative() {
    const timeScale = safeTimeScale(state.chart);
    if (!timeScale || typeof timeScale.getVisibleLogicalRange !== "function") return;
    const range = timeScale.getVisibleLogicalRange();
    if (range) deriveFromLogicalRange(range);
  }

  // ── Aplicación de la ventana contractual. ────────────────────────────────
  //
  // fitContent si no hay desviación manual; la ventana manual (mapeada por
  // tiempo sobre los datos vigentes) si la hay. Determinista: mismo input,
  // misma ventana. La aplicación real puede diferirse al animation frame de
  // la librería: `contractTarget` marca el objetivo para que los estados
  // intermedios no se lean como desviación del usuario.
  function applyContractWindow() {
    const timeScale = safeTimeScale(state.chart);
    if (!timeScale) return;
    if (state.manualView) {
      const logical = timeWindowLogicalRange({
        rowTimes: getRowTimes(),
        timeRange: state.manualView,
        minSpan: 8,
      });
      if (logical) {
        state.contractTarget = { kind: "manual", logical };
        state.pendingEmissions = 0;
        timeScale.setVisibleLogicalRange?.(logical);
        syncFromNative();
        return;
      }
      // La ventana manual no solapa con los datos vigentes: se descarta y
      // se vuelve al contrato puro.
      state.manualView = null;
    }
    state.contractTarget = { kind: "fit" };
    state.pendingEmissions = 0;
    timeScale.fitContent?.();
    syncFromNative();
    // Tras fit contractual no hay desviación manual (aunque view.isZoomed
    // sea true por minBarSpacing).
    state.manualView = null;
  }

  // ── Actions. Operan sobre el timeScale nativo del attachment vigente. ────
  //
  // Cada acción escribe el rango CALCULADO y lo declara como objetivo
  // contractual antes de derivar: el estado publicado sale del cálculo
  // determinista, no de lo que la librería haya llegado a aplicar todavía.
  function applyUserRange(timeScale, nextRange) {
    state.contractTarget = { kind: "manual", logical: nextRange };
    state.pendingEmissions = 0;
    timeScale.setVisibleLogicalRange?.(nextRange);
    deriveFromLogicalRange(nextRange);
    // Publicación síncrona en gestos de UI: el RAF a veces no llega al
    // setState de React a tiempo (chevrons/rail quedan muertos).
    cancelScheduledPublish();
    emit(buildSnapshot());
  }

  function resolveRowCount(timeScale, currentRange) {
    const timed = getRowTimes().length;
    if (timed >= 2) return timed;
    // Sin tiempos aún: estima desde el rango nativo (p. ej. whitespace de fit).
    const native = currentRange || (typeof timeScale.getVisibleLogicalRange === "function"
      ? timeScale.getVisibleLogicalRange()
      : null);
    const from = Number(native?.from);
    const to = Number(native?.to);
    if (Number.isFinite(from) && Number.isFinite(to) && to > from) {
      return Math.max(2, Math.floor(to) + 1);
    }
    return 0;
  }

  function zoom(factor = 1) {
    if (state.lifecycle !== "attached") return;
    const timeScale = safeTimeScale(state.chart);
    if (!timeScale || typeof timeScale.getVisibleLogicalRange !== "function") return;
    const currentRange = state.visibleLogicalRange || timeScale.getVisibleLogicalRange();
    const nextRange = zoomedLogicalRange({
      rowCount: resolveRowCount(timeScale, currentRange),
      currentRange,
      factor,
      anchorLatest: !state.view?.isAwayFromLatest,
    });
    if (!nextRange) return;
    applyUserRange(timeScale, nextRange);
  }

  function pan(direction = -1) {
    if (state.lifecycle !== "attached") return;
    const timeScale = safeTimeScale(state.chart);
    if (!timeScale || typeof timeScale.getVisibleLogicalRange !== "function") return;
    let currentRange = state.visibleLogicalRange || timeScale.getVisibleLogicalRange();
    const rowCount = resolveRowCount(timeScale, currentRange);
    const view = chartViewStateFromLogicalRange(currentRange, rowCount);
    // Vista a tope (fit completo): no hay hueco que desplazar. Acercar anclado
    // al último dato y luego panear — evita chevrons muertos en carga (CHART-NAV).
    if (direction < 0 && view && !view.canPanLeft && !view.isZoomed) {
      const zoomed = zoomedLogicalRange({
        rowCount,
        currentRange,
        factor: 0.5,
        anchorLatest: true,
      });
      if (zoomed) currentRange = zoomed;
    }
    const nextRange = shiftedLogicalRange({
      rowCount,
      currentRange,
      direction,
    });
    if (!nextRange) return;
    applyUserRange(timeScale, nextRange);
  }

  function scrollToLatest() {
    if (state.lifecycle !== "attached") return;
    const timeScale = safeTimeScale(state.chart);
    if (!timeScale) return;
    const rowTimes = getRowTimes();
    const nextRange = latestLogicalRange({
      rowCount: rowTimes.length,
      currentRange: state.visibleLogicalRange || (typeof timeScale.getVisibleLogicalRange === "function"
        ? timeScale.getVisibleLogicalRange()
        : null),
      fallbackSpan: Math.min(rowTimes.length, 90),
    });
    if (nextRange) {
      applyUserRange(timeScale, nextRange);
      return;
    }
    timeScale.scrollToRealTime?.();
  }

  function reset() {
    if (state.lifecycle !== "attached") return;
    state.manualView = null;
    applyContractWindow();
    // fitContent con minBarSpacing puede seguir viéndose "zoomed" en `view`;
    // la UI de Restaurar/raíl sigue `manualView`, que debe quedar limpia.
    state.manualView = null;
    cancelScheduledPublish();
    emit(buildSnapshot());
  }

  const actions = { zoom, pan, reset, scrollToLatest };

  // ── clearManual: la vía declarativa (cambio de símbolo/rango/intervalo). ─
  function clearManual() {
    state.manualView = null;
    state.visibleLogicalRange = null;
    state.visibleTimeRange = null;
    state.visibleWindowLabel = "Sin ventana";
    state.view = INITIAL_VIEW_STATE;
    if (state.lifecycle === "attached") {
      applyContractWindow();
      return;
    }
    schedulePublish();
  }

  // ── prepare: medir el contenedor y construir el perfil (sin chart). ──────
  function prepare(container) {
    if (!container) return null;
    const width = Math.max(container.clientWidth || 0, 280);
    const height = responsiveChartHeight(width, getRequestedHeight());
    const config = getConfig() || {};
    const profile = adaptiveChartProfile({
      interval: config.interval,
      range: config.dataRange,
      volume: true,
    });
    return { width, height, profile };
  }

  // ── attach / release. ────────────────────────────────────────────────────
  function attach({ chart, container, profile, onGeometryChange } = {}) {
    if (!chart || !container) return () => {};

    // Instancia única: un attach nuevo libera el anterior si sigue vivo.
    if (state.attachment) {
      try { state.attachment.release(); } catch { /* noop */ }
    }

    const timeScale = safeTimeScale(chart);
    if (!timeScale) {
      state.lifecycle = "detached";
      schedulePublish();
      return () => {};
    }

    state.lifecycle = "attached";
    state.chart = chart;
    state.container = container;
    state.profile = profile || prepare(container)?.profile || null;

    if (state.profile?.timeScale && typeof chart.applyOptions === "function") {
      try { chart.applyOptions({ timeScale: { ...state.profile.timeScale } }); } catch { /* noop */ }
    }

    // Ventana contractual: rango entero, o la desviación manual vigente.
    applyContractWindow();

    // Suscripciones: reflejan gestos nativos (arrastre/pinch) y cualquier
    // cambio programático. La derivación es idempotente para estos últimos.
    const onLogicalRangeChange = () => {
      const next = typeof timeScale.getVisibleLogicalRange === "function"
        ? timeScale.getVisibleLogicalRange()
        : null;
      if (next) deriveFromLogicalRange(next);
    };
    let unsubscribeLogical = null;
    if (typeof timeScale.subscribeVisibleLogicalRangeChange === "function") {
      timeScale.subscribeVisibleLogicalRangeChange(onLogicalRangeChange);
      unsubscribeLogical = () => {
        try { timeScale.unsubscribeVisibleLogicalRangeChange?.(onLogicalRangeChange); } catch { /* noop */ }
      };
    }

    // Wheel: ctrl+rueda = zoom (gateado por la máquina de interacción).
    // La rueda sin ctrl no se toca: el scroll de página sigue siendo del
    // navegador.
    const wheelListener = (event) => {
      if (!event.ctrlKey) return;
      if (event.cancelable) {
        try { event.preventDefault(); } catch { /* noop */ }
      }
      const interactionState = typeof getInteractionState === "function" ? getInteractionState() : "idle";
      if (interactionState !== "idle") return;
      zoom(Math.exp(event.deltaY * 0.0015));
    };
    container.addEventListener("wheel", wheelListener, { capture: true, passive: false });
    const detachWheel = () => {
      try { container.removeEventListener("wheel", wheelListener, { capture: true }); } catch { /* noop */ }
    };

    // Resize: geometría nueva + re-aplicación de la ventana contractual
    // (fit si no hay manual; la manual mapeada por tiempo si la hay).
    let resizeDisconnect = null;
    if (typeof ResizeObserver === "function") {
      let lastAppliedWidth = 0;
      let lastAppliedHeight = 0;
      const observer = new ResizeObserver(([entry]) => {
        if (state.attachment !== attachment) return;
        const nextWidth = Math.max(Math.floor(entry?.contentRect?.width || container.clientWidth || 0), 280);
        if (nextWidth <= 0) return;
        const nextHeight = responsiveChartHeight(nextWidth, getRequestedHeight());
        // Evita re-fitContent en micro-resizes (layout/identity card) que
        // borraban zoom/pan del usuario y dejaban los chevrons muertos.
        if (nextWidth === lastAppliedWidth && nextHeight === lastAppliedHeight) return;
        lastAppliedWidth = nextWidth;
        lastAppliedHeight = nextHeight;
        try {
          chart.applyOptions?.({ width: nextWidth, height: nextHeight });
        } catch { /* noop */ }
        applyContractWindow();
        if (typeof onGeometryChange === "function") {
          onGeometryChange({ width: nextWidth, height: nextHeight, profile: state.profile });
        }
      });
      observer.observe(container);
      resizeDisconnect = () => {
        try { observer.disconnect(); } catch { /* noop */ }
      };
    }

    let released = false;
    const attachment = {
      chart,
      release() {
        if (released) return;
        released = true;
        try { unsubscribeLogical?.(); } catch { /* noop */ }
        try { detachWheel(); } catch { /* noop */ }
        try { resizeDisconnect?.(); } catch { /* noop */ }
        if (state.attachment === attachment) {
          state.attachment = null;
          state.lifecycle = "detached";
          state.chart = null;
          state.container = null;
          schedulePublish();
        }
      },
    };
    state.attachment = attachment;

    schedulePublish();
    return attachment.release;
  }

  function detach() {
    if (state.attachment) {
      const current = state.attachment;
      try { current.release(); } catch { /* noop */ }
    }
  }

  function unmount() {
    detach();
    cancelScheduledPublish();
  }

  function getSnapshot() {
    // Solo lectura. Reconciliar desde el timeScale aquí pisaba gestos
    // programáticos (zoom/pan) cuyo setVisibleLogicalRange aún no había
    // convergido — y en DEV `__chartViewportSnapshot()` dejaba el estado
    // “pegado” al rango nativo anterior.
    return buildSnapshot();
  }

  return {
    prepare,
    attach,
    detach,
    clearManual,
    unmount,
    actions,
    getSnapshot,
    _state: state, // exportado sólo para tests/debug.
  };
}
