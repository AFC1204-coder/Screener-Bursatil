// app/useChartDrawings.js — Hook de interacción (D2/D3/D4) para trendlines v1.
//
// Tras el ADR chart-interaction-state-machine (P0b), este hook adelgaza a
// DOMINIO PURO de drawings: store, primitiva, conversión pantalla→dominio,
// callbacks de overlay y teclado. Los listeners pointer y el arbitraje contra
// la librería viven ahora en `app/useChartInteraction.js` (que consume la
// máquina pura `lib/chartInteractionMachine.js`).
//
// API pública (estable, no cambia para UniversalPriceChart):
//   attach(chart, series, container)
//   detach()
//   setRowTimes(rows)
//   toolbarProps = { toolActive, inProgress, selectedId, hasSelection,
//                    modeLabel, toggleTool, cancelDraw, removeSelected,
//                    hitTolerance }
//
// Estado React:
//   - toolActive : derivado de la máquina (state ∈ {armed, drawing}).
//   - inProgress : derivado de la máquina (state === drawing).
//   - selectedId : bandera propia (sigue siendo UI state del consumidor).
//   - attachKey  : cambia en cada attach real (compatibilidad con useEffect
//                  consumidores si los hubiera).

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  HIT_TOLERANCE_PX,
  add as storeAdd,
  createTrendline,
  list as storeList,
  remove as storeRemove,
  subscribe as storeSubscribe,
  update as storeUpdate,
} from "@/lib/chartDrawings";
import { TrendlinePrimitive } from "@/lib/trendlinePrimitive";
import { useChartInteraction } from "@/app/useChartInteraction";

const DEFAULT_HIT_TOLERANCE = HIT_TOLERANCE_PX;

function rowsToTimes(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => Number(row?.time)).filter(Number.isFinite);
}

function logicalFromRowTimes(rowTimes, time) {
  if (!Array.isArray(rowTimes) || rowTimes.length < 2) return 0;
  const target = Number(time);
  if (!Number.isFinite(target)) return 0;
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
  const span = rowTimes[hi] - rowTimes[lo];
  if (span <= 0) return lo;
  return lo + (target - rowTimes[lo]) / span;
}


export function useChartDrawings({ symbol = "", interval = "D" } = {}) {
  const [selectedId, setSelectedId] = useState(null);
  const [hasSelection, setHasSelection] = useState(false);
  const [attachKey, setAttachKey] = useState(0);
  // toolActive/inProgress derivados de la máquina; los suscribimos a un
  // estado local para que React re-renderice cuando cambian.
  const [toolActive, setToolActive] = useState(false);
  const [inProgress, setInProgress] = useState(null);

  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const containerRef = useRef(null);
  const primitiveRef = useRef(null);
  const unsubscribeRangeRef = useRef(null);
  const unsubscribeStoreRef = useRef(null);
  const selectedIdRef = useRef(null);
  const rowTimesCacheRef = useRef([]);
  const attachFnRef = useRef(null);
  const detachFnRef = useRef(null);
  const interactionRef = useRef(null);

  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);

  // Sincroniza rowTimes directamente desde fuera (llamado por UniversalPriceChart
  // cuando rows cambian). Mantiene rowTimesCacheRef actualizado sin necesidad
  // de pasar un provider que pueda capturar un rowTimes[] obsoleto.
  const setRowTimes = useCallback((rows) => {
    const times = rowsToTimes(rows);
    rowTimesCacheRef.current = times;
    if (primitiveRef.current) {
      primitiveRef.current.setRowsProvider(() => rowTimesCacheRef.current);
      primitiveRef.current.updateAllViews();
    }
  }, []);

  useEffect(() => {
    if (!symbol) return undefined;
    const updateHas = (list) => {
      const id = selectedIdRef.current;
      const stillExists = list.some((d) => d.id === id);
      if (!stillExists) {
        setSelectedId(null);
        setHasSelection(false);
      } else {
        setHasSelection(true);
      }
    };
    updateHas(storeList(symbol));
    const unsubscribe = storeSubscribe(symbol, updateHas);
    unsubscribeStoreRef.current = unsubscribe;
    return () => {
      unsubscribe();
      unsubscribeStoreRef.current = null;
    };
  }, [symbol]);

  const attach = useCallback((chart, series, container) => {
    if (!chart || !series) return;
    if (chartRef.current === chart && primitiveRef.current) {
      const range = chart.timeScale?.().getVisibleLogicalRange?.();
      if (range) primitiveRef.current.setVisibleLogicalRange(range);
      primitiveRef.current.updateAllViews();
      return;
    }
    if (primitiveRef.current && seriesRef.current) {
      try { seriesRef.current.detachPrimitive?.(primitiveRef.current); } catch { /* noop */ }
    }
    if (unsubscribeRangeRef.current) {
      try { unsubscribeRangeRef.current(); } catch { /* noop */ }
      unsubscribeRangeRef.current = null;
    }

    chartRef.current = chart;
    seriesRef.current = series;
    containerRef.current = container || containerRef.current || chart.chartElement?.() || null;

    const primitive = new TrendlinePrimitive({
      symbol,
      requestRedraw: () => {
        try { chart.applyOptions?.({}); } catch { /* noop */ }
      },
    });
    primitive.setRowsProvider(() => rowTimesCacheRef.current);
    if (typeof window !== "undefined") {
      // Exponer la primitiva activa en window sólo para inspección desde tests E2E.
      // No usar desde el código de producción.
      window.__trendlinePrimitive = primitive;
    }
    const range = chart.timeScale?.().getVisibleLogicalRange?.();
    if (range) primitive.setVisibleLogicalRange(range);
    primitive.setSelectedId(selectedIdRef.current);
    series.attachPrimitive?.(primitive);
    primitiveRef.current = primitive;

    const onRangeChange = () => {
      const next = chart.timeScale?.().getVisibleLogicalRange?.();
      if (next) primitive.setVisibleLogicalRange(next);
    };
    chart.timeScale?.().subscribeVisibleLogicalRangeChange?.(onRangeChange);
    unsubscribeRangeRef.current = () => {
      chart.timeScale?.().unsubscribeVisibleLogicalRangeChange?.(onRangeChange);
    };

    setAttachKey((k) => k + 1);
  }, [symbol]);

  const detach = useCallback(() => {
    // Avisamos a la máquina que el chart muere (idle limpio, sin applyOptions
    // — el chart viejo se destruye; el nuevo nacerá con NATIVE_GESTURES_ON).
    try { interactionRef.current?.detach?.(); } catch { /* noop */ }
    if (primitiveRef.current && seriesRef.current) {
      try { seriesRef.current.detachPrimitive?.(primitiveRef.current); } catch { /* noop */ }
    }
    if (unsubscribeRangeRef.current) {
      try { unsubscribeRangeRef.current(); } catch { /* noop */ }
      unsubscribeRangeRef.current = null;
    }
    primitiveRef.current = null;
    chartRef.current = null;
    seriesRef.current = null;
    containerRef.current = null;
    rowTimesCacheRef.current = [];
    setInProgress(null);
    setToolActive(false);
  }, []);

  useEffect(() => () => {
    detach();
  }, [detach]);

  // ───────────────────────────────────────────────────────────────────────
  // Proyección pantalla → dominio. Compartida por el adaptador (que la
  // inyecta en useChartInteraction) y por el cálculo inverso de pixel para
  // el overlay del cursor.
  // ───────────────────────────────────────────────────────────────────────

  const screenToDomain = useCallback((clientX, clientY) => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const container = containerRef.current || chart?.chartElement?.() || null;
    if (!chart || !series || !container) return null;
    const rect = container.getBoundingClientRect ? container.getBoundingClientRect() : null;
    if (!rect) return null;
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const logical = chart.timeScale?.().coordinateToLogical?.(x);
    if (!Number.isFinite(logical)) return null;
    const price = series.coordinateToPrice?.(y);
    if (!Number.isFinite(price)) return null;
    const rows = rowTimesCacheRef.current;
    if (!Array.isArray(rows) || rows.length < 2) return null;
    const lo = Math.max(0, Math.min(rows.length - 2, Math.floor(logical)));
    const hi = Math.min(rows.length - 1, lo + 1);
    const span = rows[hi] - rows[lo];
    if (span <= 0) return { time: rows[lo], price, x, y, logical };
    const t = Math.max(0, Math.min(1, logical - lo));
    const time = rows[lo] + span * t;
    return { time, price, x, y, logical };
  }, []);

  // Proyección inversa dominio → píxel (para overlay p1 durante drawing).
  const pixelFromTimePrice = useCallback((time, price) => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return null;
    const rows = rowTimesCacheRef.current;
    if (!Array.isArray(rows) || rows.length < 2) return null;
    const logical = logicalFromRowTimes(rows, time);
    const x = chart.timeScale?.().logicalToCoordinate?.(logical);
    const y = series.priceToCoordinate?.(price);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
  }, []);

  // ───────────────────────────────────────────────────────────────────────
  // Callbacks de dominio. El adaptador los invoca cuando la máquina emite
  // efectos que requieren mutar el store / overlay / selección.
  // ───────────────────────────────────────────────────────────────────────

  const handleCommitDraw = useCallback(({ p1, p2 }) => {
    if (!symbol || !p1 || !p2) return;
    const drawing = createTrendline({
      symbol,
      p1,
      p2,
      createdAtInterval: interval || "D",
    });
    storeAdd(symbol, drawing);
  }, [symbol, interval]);

  const handleUpdateHandleDrag = useCallback(({ drawingId, handle, domain }) => {
    if (!symbol || !drawingId || !handle) return;
    const drawing = storeList(symbol).find((d) => d.id === drawingId);
    if (!drawing) return;
    const handleIndex = handle === "p1" ? 0 : 1;
    const updatedPoints = drawing.points.map((p, i) =>
      i === handleIndex ? { time: domain.time, price: domain.price } : p,
    );
    storeUpdate(symbol, { ...drawing, points: updatedPoints });
  }, [symbol]);

  const handleRevertHandleDrag = useCallback(({ drawingId, handle, originalPoint }) => {
    if (!symbol || !drawingId || !handle || !originalPoint) return;
    const drawing = storeList(symbol).find((d) => d.id === drawingId);
    if (!drawing) return;
    const handleIndex = handle === "p1" ? 0 : 1;
    const updatedPoints = drawing.points.map((p, i) =>
      i === handleIndex ? { time: originalPoint.time, price: originalPoint.price } : p,
    );
    storeUpdate(symbol, { ...drawing, points: updatedPoints });
  }, [symbol]);

  const handleSelect = useCallback((id) => {
    if (!id) {
      setSelectedId(null);
      primitiveRef.current?.setSelectedId(null);
      return;
    }
    setSelectedId(id);
    primitiveRef.current?.setSelectedId(id);
  }, []);

  const handleDeselect = useCallback(() => {
    setSelectedId(null);
    primitiveRef.current?.setSelectedId(null);
  }, []);

  const handleBeginOverlay = useCallback((payload) => {
    setInProgress({ p1: { time: payload?.p1?.x, price: payload?.p1?.y } });
    primitiveRef.current?.setPendingOverlay({
      p1: payload?.p1 || null,
      cursor: payload?.cursor || null,
    });
  }, []);

  const handleUpdateOverlay = useCallback((payload) => {
    primitiveRef.current?.setPendingOverlay({
      p1: payload?.p1 || null,
      cursor: payload?.cursor || null,
    });
  }, []);

  const handleClearOverlay = useCallback(() => {
    setInProgress(null);
    primitiveRef.current?.setPendingOverlay(null);
  }, []);

  const resolveHandlePoint = useCallback((drawingId, handle) => {
    const drawing = storeList(symbol).find((d) => d.id === drawingId);
    if (!drawing) return null;
    const idx = handle === "p1" ? 0 : 1;
    const point = drawing.points[idx];
    return point ? { time: point.time, price: point.price } : null;
  }, [symbol]);

  const interactionCallbacks = useMemo(() => ({
    onCommitDraw: handleCommitDraw,
    onUpdateHandleDrag: handleUpdateHandleDrag,
    onRevertHandleDrag: handleRevertHandleDrag,
    onSelect: handleSelect,
    onDeselect: handleDeselect,
    onBeginOverlay: handleBeginOverlay,
    onUpdateOverlay: handleUpdateOverlay,
    onClearOverlay: handleClearOverlay,
    onResolveHandlePoint: resolveHandlePoint,
  }), [
    handleCommitDraw,
    handleUpdateHandleDrag,
    handleRevertHandleDrag,
    handleSelect,
    handleDeselect,
    handleBeginOverlay,
    handleUpdateOverlay,
    handleClearOverlay,
    resolveHandlePoint,
  ]);

  // ───────────────────────────────────────────────────────────────────────
  // Adaptador de interacción. Se monta una sola vez por mount del hook; se
  // re-engancha cuando cambia `container` (cada attach puede dar un
  // container DOM distinto).
  // ───────────────────────────────────────────────────────────────────────

  const interaction = useChartInteraction({
    containerRef,
    chartRef,
    primitiveRef,
    screenToDomainRef: { current: screenToDomain },
    pixelFromTimePriceRef: { current: pixelFromTimePrice },
    callbacksRef: { current: interactionCallbacks },
    symbol,
    attachKey,
  });
  interactionRef.current = interaction;

  // Suscripción a la máquina para derivar toolActive/inProgress. La regla:
  //   toolActive ⇔ state ∈ {armed, drawing}
  //   inProgress ⇔ state === drawing
  // (ADR §2: "toolActive e inProgress desaparecen como banderas independientes
  // y pasan a ser derivados del estado de la máquina".)
  useEffect(() => {
    const unsubscribe = interaction.subscribe((next) => {
      const active = next === "armed" || next === "drawing";
      setToolActive(active);
      if (next === "drawing") {
        // En drawing hay p1 colocado; marcamos inProgress con un objeto
        // "sentinel" para que el modeLabel muestre "clic para punto 2/2".
        setInProgress({ p1: { sentinel: true } });
      } else {
        // armed (sin p1) o idle → limpiamos el flag visual.
        setInProgress(null);
      }
      // Si la máquina cae a idle y estábamos en drawing, el overlay ya fue
      // limpiado por el efecto clearOverlay/commitDraw.
    });
    return unsubscribe;
  }, [interaction]);

  // ───────────────────────────────────────────────────────────────────────
  // Toolbar / disparadores.
  // ───────────────────────────────────────────────────────────────────────

  const toggleTool = useCallback(() => {
    const st = interaction.getState();
    if (st === "armed" || st === "drawing") {
      interaction.disarm();
      setSelectedId(null);
    } else {
      // Antes de armar, deseleccionamos para que el siguiente click no se
      // confunda con un hit-test sobre la línea seleccionada.
      setSelectedId(null);
      primitiveRef.current?.setSelectedId(null);
      interaction.arm();
    }
  }, [interaction]);

  const cancelDraw = useCallback(() => {
    // Equivale a ESCAPE: la máquina limpia overlay, vuelve a idle y aplica
    // nativeOn (la herramienta lápiz se apaga).
    interaction.escape();
  }, [interaction]);

  const removeSelected = useCallback(() => {
    const id = selectedIdRef.current;
    if (!id || !symbol) return;
    storeRemove(symbol, id);
    setSelectedId(null);
  }, [symbol, interaction]);

  // Teclado: Supr/Backspace borra selección, Escape cancela dibujo (D4).
  // (Escape va ahora por la máquina para que también cubra ESCAPE en editing.)
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") {
        const st = interaction.getState();
        if (st === "armed" || st === "drawing" || st === "editing") {
          interaction.escape();
        }
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedIdRef.current) {
          const st = interaction.getState();
          // Borrar selección sólo en idle (guard trivial del ADR §7.5).
          if (st !== "idle") return;
          const tag = (e.target?.tagName || "").toUpperCase();
          const editable = tag === "INPUT" || tag === "TEXTAREA" || e.target?.isContentEditable;
          if (editable) return;
          e.preventDefault();
          removeSelected();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [interaction, removeSelected]);

  const modeLabel = useMemo(() => {
    if (!toolActive) return null;
    return inProgress ? "Dibujando · clic para punto 2/2" : "Dibujando · clic para punto 1/2";
  }, [toolActive, inProgress]);

  const toolbarProps = useMemo(() => ({
    toolActive,
    inProgress,
    selectedId,
    hasSelection,
    modeLabel,
    toggleTool,
    cancelDraw,
    removeSelected,
    hitTolerance: DEFAULT_HIT_TOLERANCE,
  }), [toolActive, inProgress, selectedId, hasSelection, modeLabel, toggleTool, cancelDraw, removeSelected]);

  // Refs "puente" para que el useEffect del chart pueda usar attach/detach
  // sin incluirlos en sus deps (si no, el objeto retornado por el hook cambia
  // cada render y el effect entra en loop).
  attachFnRef.current = attach;
  detachFnRef.current = detach;

  return {
    attach,
    detach,
    toolbarProps,
    setRowTimes,
    // Acceso a la máquina para que el caller (UniversalPriceChart) pueda
    // gatear handlers que NO son pointer events (p.ej. wheel/trackpad, ADR §6).
    // La máquina también está expuesta en `window.__chartInteractionState`
    // (sólo dev) para inspección desde scripts E2E (ADR §7.6).
    getInteractionState: () => interaction.getState(),
    interaction,
  };
}