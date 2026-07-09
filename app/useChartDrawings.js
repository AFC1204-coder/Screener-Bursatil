// app/useChartDrawings.js — Hook de interacción (D2/D3/D4) para trendlines v1.
//
// Estado React:
//   - toolActive : herramienta lápiz activa (botón en nav group)
//   - inProgress : dibujo a medias (p1 colocado, esperando p2)
//   - selectedId : línea seleccionada (null si ninguna)
//   - attachKey  : cambia en cada attach real (dispara re-suscripción de
//                  listeners DOM del canvas)
//
// attach(chart, series, container, rowTimesProvider) / detach(): idempotentes;
// el efecto de UniversalPriceChart los llama en cada recreación del chart.

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

const DEFAULT_HIT_TOLERANCE = HIT_TOLERANCE_PX;

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

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
  const [toolActive, setToolActive] = useState(false);
  const [inProgress, setInProgress] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [hasSelection, setHasSelection] = useState(false);
  const [attachKey, setAttachKey] = useState(0);

  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const containerRef = useRef(null);
  const rowTimesProviderRef = useRef(null);
  const primitiveRef = useRef(null);
  const handleScrollBackupRef = useRef(null);
  const unsubscribeRangeRef = useRef(null);
  const unsubscribeStoreRef = useRef(null);
  const dragStateRef = useRef(null);
  const inProgressRef = useRef(null);
  const selectedIdRef = useRef(null);
  const toolActiveRef = useRef(false);
  const rowTimesCacheRef = useRef([]);
  const attachFnRef = useRef(null);
  const detachFnRef = useRef(null);

  useEffect(() => { inProgressRef.current = inProgress; }, [inProgress]);
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);

  // Sincroniza rowTimes directamente desde fuera (llamado por UniversalPriceChart
  // cuando rows cambian). Mantiene rowTimesCacheRef actualizado sin necesidad
  // de pasar un provider que pueda capturar un rowTimes[] obsoleto.
  const setRowTimes = useCallback((rows) => {
    const times = Array.isArray(rows) ? rows.map((r) => Number(r?.time)).filter(Number.isFinite) : [];
    rowTimesCacheRef.current = times;
    if (primitiveRef.current) {
      primitiveRef.current.setRowsProvider(() => rowTimesCacheRef.current);
      primitiveRef.current.updateAllViews();
    }
  }, []);
  useEffect(() => { toolActiveRef.current = toolActive; }, [toolActive]);

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
    rowTimesProviderRef.current = null;
    rowTimesCacheRef.current = [];
    restoreHandleScroll();
  }, []);

  useEffect(() => () => {
    detach();
  }, [detach]);

  const toggleTool = useCallback(() => {
    setToolActive((active) => {
      const next = !active;
      if (!next) setInProgress(null);
      return next;
    });
    setSelectedId(null);
  }, []);

  const cancelDraw = useCallback(() => {
    setInProgress(null);
    setToolActive(false);
    primitiveRef.current?.setPendingOverlay(null);
  }, []);

  const removeSelected = useCallback(() => {
    const id = selectedIdRef.current;
    if (!id || !symbol) return;
    storeRemove(symbol, id);
    setSelectedId(null);
  }, [symbol]);

  const captureHandleScroll = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const current = chart.options?.()?.handleScroll;
    handleScrollBackupRef.current = current ? { ...current } : null;
    chart.applyOptions?.({
      handleScroll: {
        mouseWheel: false,
        pressedMouseMove: false,
        horzTouchDrag: false,
        vertTouchDrag: false,
      },
    });
  }, []);

  const restoreHandleScroll = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) {
      handleScrollBackupRef.current = null;
      return;
    }
    if (handleScrollBackupRef.current) {
      chart.applyOptions?.({ handleScroll: handleScrollBackupRef.current });
    } else {
      chart.applyOptions?.({
        handleScroll: {
          mouseWheel: false,
          pressedMouseMove: true,
          horzTouchDrag: true,
          vertTouchDrag: false,
        },
      });
    }
    handleScrollBackupRef.current = null;
  }, []);

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

  const beginDrawAt = useCallback((domain) => {
    if (!symbol) return;
    setInProgress({ p1: { time: domain.time, price: domain.price } });
  }, [symbol]);

  const finishDrawAt = useCallback((domain) => {
    if (!symbol) return;
    const current = inProgressRef.current;
    if (!current?.p1) return;
    const p1 = current.p1;
    const p2 = { time: domain.time, price: domain.price };
    if (p1.time === p2.time && p1.price === p2.price) {
      setInProgress(null);
      primitiveRef.current?.setPendingOverlay(null);
      return;
    }
    const drawing = createTrendline({
      symbol,
      p1,
      p2,
      createdAtInterval: interval || "D",
    });
    storeAdd(symbol, drawing);
    setInProgress(null);
    primitiveRef.current?.setPendingOverlay(null);
    setToolActive(false);
  }, [symbol, interval]);

  const onPointerDown = useCallback((event) => {
    if (!chartRef.current || !primitiveRef.current) return;
    const point = event?.point;
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;

    if (toolActiveRef.current) {
      const domain = screenToDomain(point.x, point.y);
      if (!domain) return;
      if (!inProgressRef.current?.p1) {
        beginDrawAt(domain);
        primitiveRef.current?.setPendingOverlay({
          p1: { x: domain.x, y: domain.y },
          cursor: { x: domain.x, y: domain.y },
        });
      } else {
        finishDrawAt(domain);
      }
      return;
    }

    const hit = primitiveRef.current.pickAt(point.x, point.y);
    if (!hit) {
      setSelectedId(null);
      primitiveRef.current?.setSelectedId(null);
      return;
    }
    setSelectedId(hit.drawingId);
    primitiveRef.current?.setSelectedId(hit.drawingId);
    if (hit.kind === "handle") {
      const drawing = storeList(symbol).find((d) => d.id === hit.drawingId);
      if (drawing) {
        const handleIndex = hit.handle === "p1" ? 0 : 1;
        dragStateRef.current = {
          drawingId: hit.drawingId,
          handle: hit.handle,
          originalPoint: { ...drawing.points[handleIndex] },
        };
        captureHandleScroll();
      }
    }
  }, [beginDrawAt, finishDrawAt, captureHandleScroll, screenToDomain, symbol]);

  const onPointerMove = useCallback((event) => {
    const point = event?.point;
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    const primitive = primitiveRef.current;
    if (!primitive) return;
    if (toolActiveRef.current && inProgressRef.current?.p1) {
      const domain = screenToDomain(point.x, point.y);
      if (!domain) return;
      const p1 = inProgressRef.current.p1;
      const logical = logicalFromRowTimes(rowTimesCacheRef.current, p1.time);
      const x = chartRef.current?.timeScale?.().logicalToCoordinate?.(logical);
      const y = seriesRef.current?.priceToCoordinate?.(p1.price);
      primitive.setPendingOverlay({
        p1: Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null,
        cursor: { x: domain.x, y: domain.y },
      });
      return;
    }
    const drag = dragStateRef.current;
    if (!drag) return;
    const domain = screenToDomain(point.x, point.y);
    if (!domain) return;
    const drawing = storeList(symbol).find((d) => d.id === drag.drawingId);
    if (!drawing) return;
    const handleIndex = drag.handle === "p1" ? 0 : 1;
    const updatedPoints = drawing.points.map((p, i) =>
      i === handleIndex ? { time: domain.time, price: domain.price } : p,
    );
    storeUpdate(symbol, { ...drawing, points: updatedPoints });
  }, [screenToDomain, symbol]);

  const onPointerUp = useCallback(() => {
    if (dragStateRef.current) {
      dragStateRef.current = null;
      restoreHandleScroll();
    }
  }, [restoreHandleScroll]);

  // Suscripción DOM al canvas — se re-engancha cuando attachKey cambia, es
  // decir, cada vez que attach() registra un chart nuevo. La función
  // chart.chartElement() devuelve el contenedor real del chart tras
  // createChart(); caemos a containerRef si la API no lo expone.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return undefined;
    const container = chart.chartElement?.() || containerRef.current;
    if (!container) return undefined;
    containerRef.current = container;

    const localPoint = (clientX, clientY) => {
      const rect = container.getBoundingClientRect();
      return { x: clientX - rect.left, y: clientY - rect.top };
    };
    // Lightweight-charts v5 monta su árbol DOM (`.tv-lightweight-charts`)
    // DENTRO del contenedor padre y captura los eventos ahí. En lugar de
    // competir con su captura, enganchamos al contenedor en fase de captura
    // para que se dispare ANTES que cualquier listener interno.
    const inChart = (target) => container.contains(target);
    const onPointerEventDown = (e) => {
      if (!inChart(e.target)) return;
      onPointerDown({ point: localPoint(e.clientX, e.clientY) });
    };
    const onPointerEventMove = (e) => {
      if (!inChart(e.target)) return;
      onPointerMove({ point: localPoint(e.clientX, e.clientY) });
    };
    const onPointerEventUp = (e) => {
      // pointerup puede dispararse fuera del chart; aceptamos cualquiera.
      void e;
      onPointerUp();
    };

    container.addEventListener("pointerdown", onPointerEventDown, true);
    container.addEventListener("pointermove", onPointerEventMove, true);
    container.addEventListener("pointerup", onPointerEventUp, true);
    container.addEventListener("pointercancel", onPointerEventUp, true);

    return () => {
      container.removeEventListener("pointerdown", onPointerEventDown, true);
      container.removeEventListener("pointermove", onPointerEventMove, true);
      container.removeEventListener("pointerup", onPointerEventUp, true);
      container.removeEventListener("pointercancel", onPointerEventUp, true);
    };
  }, [attachKey, onPointerDown, onPointerMove, onPointerUp]);

  // Teclado: Supr/Backspace borra selección, Escape cancela dibujo (D4).
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") {
        if (inProgressRef.current) cancelDraw();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedIdRef.current && !toolActiveRef.current) {
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
  }, [cancelDraw, removeSelected]);

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

  return { attach, detach, toolbarProps, setRowTimes };
}

export { safeNumber };
