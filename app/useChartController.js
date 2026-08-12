// app/useChartController.js — compositor del chart controller (ADR §5, paso 7).
//
// El controller es el ÚNICO dueño del ciclo de vida del chart nativo:
//   - crea y destruye el chart (§5.4 / §5.5);
//   - compone las tres fronteras: data model, drawings/interaction, viewport;
//   - traduce la salida de las tres a un `viewModel` declarativo para la vista.
//
// Reglas del contrato (ADR §5.1, §5.3, §5.4, §5.5, §6):
//   - `chart.remove()` ocurre exactamente una vez por attachment, sólo aquí.
//   - `drawings.detach()` se llama ANTES de `viewport.detach()` y ANTES de
//     `chart.remove()`. §5.5 orden inverso.
//   - El `controllerAttachmentId` invalida cualquier init en vuelo, incluido
//     el `await import("lightweight-charts")`. Una respuesta tardía no puede
//     instalar un chart después de que sus props hayan cambiado.
//   - El adapter nativo (`chartNativeAdapter`) no llama `chart.remove()`.
//     Eso es exclusivo del controller.
//   - El controller NO toca `useChartInteraction.js` ni `chartInteractionMachine.js`;
//     la frontera de interacción se compone con su API pública.
//
// Nota sobre la carrera `resetBySymbol` vs `attach`:
//   `useChartViewport.js` documenta una posible carrera si este controller
//   invoca un nuevo `attach` en el mismo render en que el padre cambió
//   `symbol`. Aquí lo evitamos haciendo que el effect del controller use
//   `symbol` como dep y ejecute la transacción de cleanup→crear explícita
//   en cada cambio de símbolo. El reset por símbolo de viewport puede
//   llegar antes o después; en cualquier caso, el controller reconcilia.

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CHART_RANGES, DEFAULT_CHART_SETTINGS } from "@/lib/chartSettings";
import { resolveChartViewportConfig } from "@/lib/chartViewportModel";
import { useChartDataModel } from "@/app/useChartDataModel";
import { useChartDrawings } from "@/app/useChartDrawings";
import { useChartViewport } from "@/app/useChartViewport";
import { createChartNativeAdapter, resolveCssTokensNative } from "@/app/chartNativeAdapter";
import { userFacingSearchError } from "@/lib/screenerFormat";
import { methodologyDisplayForRow } from "@/lib/methodologyDisplay";
import { vcpDiagnosticSnapshot } from "@/lib/vcpDiagnostics";

/**
 * Hook orquestador del chart. Sigue el orden fijo de §5.3.
 *
 * @param {object} props
 * @param {Array}   [props.bars=[]]
 * @param {string}  [props.symbol=""]
 * @param {string}  [props.currency=""]
 * @param {object}  [props.settings]
 * @param {string}  [props.tradingViewUrl=""]
 * @param {object}  [props.relativeStrength=null]
 * @param {string}  [props.benchmarkSymbol=""]
 * @param {number}  [props.rsMainScore=null]
 * @param {Array}   [props.rsRatingSeries=[]]
 * @param {object}  [props.patternOverlay=null]
 * @param {boolean} [props.showPatternDiagnostics=false]
 * @param {object}  [props.localQuality=null]         ChartQuality canónico (ADR §3.2).
 * @param {string}  [props.className=""]
 * @param {number}  [props.height=460]
 */
// Defaults con IDENTIDAD ESTABLE. `rsRatingSeries` entra en el array de
// dependencias de la transacción §5.4/§5.5, que llama a `viewport.attach()`, y
// attach publica un snapshot vía setState. Un default `[]` en línea crea un
// array nuevo en cada render: la dependencia cambia siempre, el efecto se
// re-ejecuta, attach vuelve a publicar y el ciclo no termina ("Maximum update
// depth exceeded", con la pestaña colgada). Los callers que sí pasan la prop
// —la ficha del valor— nunca vieron el fallo; lo destapó el primer caller que
// la omite y llega a `availability: "ready"`.
const EMPTY_RS_RATING_SERIES = [];

export function useChartController(props = {}) {
  const {
    bars = [],
    symbol = "",
    currency = "",
    settings = DEFAULT_CHART_SETTINGS,
    tradingViewUrl = "",
    relativeStrength = null,
    benchmarkSymbol = "",
    rsMainScore = null,
    rsRatingSeries = EMPTY_RS_RATING_SERIES,
    patternOverlay = null,
    showPatternDiagnostics = false,
    localQuality = null,
    className = "",
    height = 460,
  } = props || {};

  // §5.3 / 1: config canónica.
  const config = useMemo(() => resolveChartViewportConfig(settings || {}), [settings]);

  // §5.3 / 2: data model. ADR §3.3 + §9: la calidad local viaja sólo como
  // `localQuality` canónico (ChartQuality). La prop legacy `chartEstimated`
  // ya no forma parte del contrato público del chart.
  const dataModel = useChartDataModel({
    symbol,
    localSource: { bars, quality: localQuality },
    config: { dataRange: config.dataRange, interval: config.interval, style: config.style },
  });

  const rows = dataModel.rows;
  const rowTimes = dataModel.rowTimes;
  const notice = dataModel.notice;

  // §5.3 / 3: drawings + interaction (frontera existente, sin cambios).
  const drawings = useChartDrawings({ symbol, interval: config.interval });

  // §5.3 / 4: viewport.
  const viewport = useChartViewport({
    symbol,
    config,
    rowTimes,
    requestedHeight: height,
    getInteractionState: drawings.getInteractionState,
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Refs DOM que la vista necesita. El badge RS se queda imperativo
  // (§5.2) para no provocar renders React por cada cambio geométrico.
  // ─────────────────────────────────────────────────────────────────────────
  const canvasRef = useRef(null);
  const rsBadgeRef = useRef(null);

  // Refs internos del controller para gestionar el ciclo de vida nativo.
  const chartHandleRef = useRef(null);
  const controllerAttachmentIdRef = useRef(0);
  const mountedRef = useRef(true);
  const [renderError, setRenderError] = useState("");

  // Derivaciones puras (no son estado, son memoizadas por la naturaleza
  // síncrona de las entradas).
  const latest = rows.at(-1);
  const first = rows[0];
  const change = first?.close ? ((Number(latest?.close) / Number(first.close)) - 1) * 100 : null;
  const positive = !Number.isFinite(change) || change >= 0;

  // Helpers para construir el viewModel.
  const intraday = config.intraday;
  const rangeLabel = (CHART_RANGES.find((item) => item.key === config.dataRange)?.label || config.dataRange || "").toUpperCase();

  const patternSummary = useMemo(() => methodologyDisplayForRow(patternOverlay || {}), [patternOverlay]);
  const patternDiagnostic = useMemo(
    () => showPatternDiagnostics && patternOverlay && !intraday ? vcpDiagnosticSnapshot(patternOverlay) : null,
    [showPatternDiagnostics, patternOverlay, intraday],
  );

  // ─────────────────────────────────────────────────────────────────────────
  // §5.4 / §5.5: transacción de creación y destrucción del chart.
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    // NOTA: NO usamos `mountedRef.current` aquí. React 18 StrictMode
    // monta/desmonta/monta este efecto dos veces en dev; un `mountedRef`
    // compartido puesto a false por el primer desmontaje sintético dejaría
    // la segunda invocación sin ejecutar la transacción §5.4. La fuente
    // de verdad para esta invocación concreta es la variable local
    // `cancelled` del closure, que se activa sólo en el cleanup (real o
    // sintético) y descarta trabajo tardío vía `controllerAttachmentId`.
    // `mountedRef` se conserva únicamente para el cleanup de unmount
    // real (al final del archivo), que sigue protegiendo contra
    // actualizar `setRenderError`/refs tras desmontaje del todo.
    if (dataModel.availability !== "ready") {
      // §5.4: no se crea chart si la disponibilidad no es "ready".
      return undefined;
    }

    let cancelled = false;
    let myId = 0;
    let adapter = null;
    let resizeObserver = null;
    let lastProfile = null;
    let lastWidth = 0;
    let lastHeight = 0;

    // Incrementamos ANTES del await: cualquier respuesta tardía del import
    // dinámico se descarta al comparar myId con controllerAttachmentIdRef.
    controllerAttachmentIdRef.current += 1;
    myId = controllerAttachmentIdRef.current;

    async function render() {
      if (cancelled) return;
      const container = canvasRef.current;
      if (!container) return;
      container.innerHTML = "";

      const lib = await import("lightweight-charts");
      if (cancelled || myId !== controllerAttachmentIdRef.current) return;

      const profile = viewport.prepare(container);
      const colors = resolveCssTokensNative();
      lastProfile = profile;
      const width = Math.max(container.clientWidth || 0, 280);
      lastWidth = width;

      adapter = createChartNativeAdapter({
        container,
        lib,
        profile,
        config,
        rows,
        colors,
        overrides: {
          patternOverlay,
          rsRatingSeries,
          requestedHeight: height,
          positive,
          rsBadgeRef,
        },
      });

      // §5.4 / 7: viewport.attach — fit/restore/subscriptions/wheel/resize.
      const renderMeta = {
        ready: true,
        symbol,
        range: config.dataRange,
        interval: config.interval,
        style: config.style,
        scale: config.scale,
        rowCount: rows.length,
      };
      viewport.attach({
        chart: adapter.chart,
        container,
        renderMeta,
        profile,
        onGeometryChange: ({ width: w, height: h, profile: p }) => {
          lastWidth = w;
          lastHeight = h;
          lastProfile = p;
          adapter.updateGeometry({ width: w, height: h, profile: p });
        },
      });

      // §5.4 / 8: setRowTimes ANTES de attach, para que la primitiva
      // reciba los tiempos coherentes desde el primer attach.
      drawings.setRowTimes(rows);
      drawings.attach(adapter.chart, adapter.mainSeries, container);

      chartHandleRef.current = adapter;

      // §5.4 / 9: callbacks geométricos (badge RS). El adapter expone
      // updateRsBadge si pintó la línea RS.
      if (typeof adapter.updateRsBadge === "function") {
        adapter.updateRsBadge();
        const rafId = requestAnimationFrame(() => {
          if (!cancelled && typeof adapter.updateRsBadge === "function") {
            adapter.updateRsBadge();
          }
        });
        // Guardamos para cancelar en cleanup.
        cleanupFns.push(() => cancelAnimationFrame(rafId));
      }

      // ResizeObserver: la geometría ya la aplica el controller vía
      // viewport.onGeometryChange; aquí sólo observamos el container.
      if (typeof ResizeObserver === "function") {
        resizeObserver = new ResizeObserver(([entry]) => {
          if (cancelled) return;
          const nextWidth = Math.max(Math.floor(entry?.contentRect?.width || 0), 280);
          if (nextWidth > 0) lastWidth = nextWidth;
        });
        resizeObserver.observe(container);
      }
    }

    const cleanupFns = [];

    render().catch((error) => {
      if (cancelled) return;
      // §5.4 / 10: error en createChart o serie no muta dataModel.error;
      // se publica como renderError separado.
      const message = error?.message || "Grafico no disponible";
      setRenderError(message);
    });

    return () => {
      cancelled = true;
      // §5.5 orden inverso.
      for (const fn of cleanupFns) {
        try { fn(); } catch { /* noop */ }
      }
      if (resizeObserver) {
        try { resizeObserver.disconnect(); } catch { /* noop */ }
        resizeObserver = null;
      }
      // 1. drawings.detach (interacción → DETACH → idle, separa primitiva).
      try { drawings.detach?.(); } catch { /* noop */ }
      // 2. viewport.detach (captura ventana manual + elimina handlers).
      try { viewport.detach?.({ reason: "controller-cleanup" }); } catch { /* noop */ }
      // 3. adapter.destroySeries (libera series, NO chart.remove).
      if (adapter && typeof adapter.destroySeries === "function") {
        try { adapter.destroySeries(); } catch { /* noop */ }
      }
      // 4. chart.remove — exactamente una vez por attachment.
      if (adapter && adapter.chart && typeof adapter.chart.remove === "function") {
        try { adapter.chart.remove(); } catch { /* noop */ }
      }
      // 5. limpiar handles.
      if (chartHandleRef.current === adapter) {
        chartHandleRef.current = null;
      }
      controllerAttachmentIdRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    dataModel.availability,
    dataModel.rowTimes,
    symbol,
    config.dataRange,
    config.interval,
    config.style,
    config.scale,
    height,
    patternOverlay,
    rsRatingSeries,
    config.indicators.volume,
    config.indicators.rsLine,
    config.indicators.maFast,
    config.indicators.maFastLength,
    config.indicators.maSlow,
    config.indicators.maSlowLength,
    positive,
  ]);

  // drawings.setRowTimes en cada cambio de filas.
  useEffect(() => {
    drawings.setRowTimes?.(rows);
  }, [rows, drawings]);

  // Unmount cleanup.
  useEffect(() => () => {
    mountedRef.current = false;
    const handle = chartHandleRef.current;
    if (handle && handle.chart && typeof handle.chart.remove === "function") {
      try { handle.chart.remove(); } catch { /* noop */ }
    }
    chartHandleRef.current = null;
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // viewModel — contrato §5.2.
  // ─────────────────────────────────────────────────────────────────────────
  const status = dataModel.availability; // ready | empty | blocked
  const viewState = viewport.state.view || null;
  const viewportRail = {
    mode: viewState?.isManual ? viewState.label : "Último dato",
    window: viewport.state.visibleWindowLabel || "Sin ventana",
    bars: viewState?.visibleBars || null,
    distance: viewState?.distanceFromLatest || null,
    drawing: drawings.toolbarProps?.modeLabel || null,
    manual: !!viewState?.isManual,
    key: viewState?.key || "unknown",
  };
  const notes = {
    quality: notice && notice.kind === "quality" ? notice : null,
    expanding: notice && notice.kind === "expanding" ? notice : null,
    expansionFailed: notice && notice.kind === "error" && notice.code === "history-expansion-failed" ? notice : null,
    renderError: renderError || null,
  };
  const viewModel = useMemo(() => ({
    status,
    header: {
      symbol,
      latestClose: Number.isFinite(Number(latest?.close)) ? Number(latest.close) : null,
      changePct: Number.isFinite(change) ? change : null,
      positive,
      rangeLabel,
      interval: config.interval,
    },
    badges: {
      rsMainScore: Number.isFinite(Number(rsMainScore)) ? Number(rsMainScore) : null,
      pattern: patternSummary,
    },
    viewportRail,
    patternDiagnostic,
    rsLegend: {
      enabled: !!config.indicators.rsLine,
      intradayMuted: intraday,
    },
    notes,
    rootClassName: className,
  }), [status, symbol, latest, change, positive, rangeLabel, config.interval, config.indicators.rsLine, intraday, patternSummary, viewportRail, patternDiagnostic, notes, className]);

  // ─────────────────────────────────────────────────────────────────────────
  // actions — contrato §5.2.
  // ─────────────────────────────────────────────────────────────────────────
  const actions = useMemo(() => ({
    zoom: viewport.actions.zoom,
    pan: viewport.actions.pan,
    reset: viewport.actions.reset,
    scrollToLatest: viewport.actions.scrollToLatest,
    toggleDrawing: drawings.toolbarProps?.toggleTool || (() => {}),
    removeSelectedDrawing: drawings.toolbarProps?.removeSelected || (() => {}),
  }), [viewport.actions, drawings.toolbarProps]);

  return {
    canvasRef,
    rsBadgeRef,
    viewModel,
    actions,
    drawingToolbar: drawings.toolbarProps,
    emptyFallback: {
      text: notice && notice.kind === "quality" ? notice.text
        : notice && notice.kind === "loading" ? notice.text
          : notice && notice.kind === "error" ? notice.text
            : notice && notice.kind === "empty" ? notice.text
              : userFacingSearchError("Historico insuficiente"),
      title: notice && notice.kind === "quality" ? notice.title : "",
    },
  };
}

export default useChartController;
