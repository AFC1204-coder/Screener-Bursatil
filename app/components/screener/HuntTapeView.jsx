"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  computeHuntChartPreviewHydrateLimit,
  computeHuntChartPreviewHydrateStart,
  emitHuntChartPreviewViewport,
  resolveHuntTapeSparkStatus,
} from "@/lib/scansChartPreviewHydrate";
import {
  HuntTapeSparkline,
  HuntTapeTickerCell,
  formatVcpFootprintFromRow,
  formatVcpFootprintTitle,
  HUNT_TAPE_DIST_EMPTY,
  HUNT_TAPE_STAGE_EMPTY,
  huntTapeDist52w,
  huntTapeEnterSymbol,
  huntTapeMoveFocus,
  huntTapeRowKey,
  huntTapeRsDisplay,
  huntTapeSparkBars,
  huntTapeSparkTitle,
  huntTapeStageLine,
  huntTapeDrillUrl,
} from "@/lib/screenerHuntTape";
import {
  DEFAULT_HUNT_TAPE_DENSITY,
  HUNT_TAPE_DESKTOP_1080_LIST_HEIGHT_PX,
  huntTapeRowHeightPx,
  resolveHuntTapeDensity,
} from "@/lib/screenerHuntTapeDensity";

export default function HuntTapeView({
  rows = [],
  emptyLabel = "Sin resultados con este filtro.",
  onOpenStock,
  activeModalRow = null,
  chartPreviewDeferred = false,
  density = DEFAULT_HUNT_TAPE_DENSITY,
}) {
  const [focusIndex, setFocusIndex] = useState(0);
  const [keyboardActive, setKeyboardActive] = useState(false);
  const listRef = useRef(null);
  const rowRefs = useRef([]);
  const hydrateStartRef = useRef(0);
  const hydrateLimitRef = useRef(0);
  const scrollRafRef = useRef(0);
  const tapeDensity = resolveHuntTapeDensity(density);
  const rowHeightPx = huntTapeRowHeightPx(tapeDensity);
  const queueKey = `${rows[0]?.symbol || ""}:${rows.length}:${rows[rows.length - 1]?.symbol || ""}:${tapeDensity}`;

  const publishHydrateViewport = useCallback(() => {
    const el = listRef.current;
    const listHeight = el?.clientHeight > 0
      ? el.clientHeight
      : HUNT_TAPE_DESKTOP_1080_LIST_HEIGHT_PX;
    const limit = computeHuntChartPreviewHydrateLimit(listHeight, {
      rowHeight: rowHeightPx,
    });
    const start = computeHuntChartPreviewHydrateStart(el?.scrollTop || 0, {
      rowCount: rows.length,
      rowHeight: rowHeightPx,
      limit,
    });
    if (start === hydrateStartRef.current && limit === hydrateLimitRef.current) return;
    hydrateStartRef.current = start;
    hydrateLimitRef.current = limit;
    emitHuntChartPreviewViewport({ start, limit });
  }, [rows.length, rowHeightPx]);

  const handleListScroll = useCallback(() => {
    if (scrollRafRef.current) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = 0;
      publishHydrateViewport();
    });
  }, [publishHydrateViewport]);

  useEffect(() => {
    if (focusIndex >= rows.length) {
      setFocusIndex(Math.max(0, rows.length - 1));
    }
  }, [rows.length, focusIndex]);

  // Nueva cola (ficha/filtro/densidad): reset scroll + re-publicar ventana de hydrate.
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
    hydrateStartRef.current = -1;
    hydrateLimitRef.current = 0;
    publishHydrateViewport();
    return () => {
      if (scrollRafRef.current) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = 0;
      }
    };
  }, [queueKey, publishHydrateViewport]);

  // Resize de la lista (vh / layout) → recalcular viewport + buffer.
  useEffect(() => {
    const el = listRef.current;
    if (!el || typeof ResizeObserver !== "function") {
      if (typeof window !== "undefined") {
        const onResize = () => publishHydrateViewport();
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
      }
      return undefined;
    }
    const observer = new ResizeObserver(() => publishHydrateViewport());
    observer.observe(el);
    return () => observer.disconnect();
  }, [publishHydrateViewport, queueKey]);
  const scrollFocusIntoView = useCallback((index) => {
    const el = rowRefs.current[index];
    el?.scrollIntoView({ block: "nearest" });
    requestAnimationFrame(() => publishHydrateViewport());
  }, [publishHydrateViewport]);

  const moveFocus = useCallback((delta) => {
    if (!rows.length) return;
    setFocusIndex((current) => {
      const next = huntTapeMoveFocus(current, delta, rows.length);
      requestAnimationFrame(() => scrollFocusIntoView(next));
      return next;
    });
    setKeyboardActive(true);
  }, [rows.length, scrollFocusIntoView]);

  const drillInto = useCallback((row) => {
    if (!row?.symbol) return;
    onOpenStock?.(row);
    window.location.assign(huntTapeDrillUrl(row.symbol));
  }, [onOpenStock]);

  useEffect(() => {
    function handleKeyDown(event) {
      if (activeModalRow) return;
      const tag = String(event.target?.tagName || "").toUpperCase();
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;

      if (event.key === "Escape") {
        if (keyboardActive || listRef.current?.contains(document.activeElement)) {
          event.preventDefault();
          setKeyboardActive(false);
          listRef.current?.blur();
        }
        return;
      }

      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        moveFocus(1);
      } else if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        moveFocus(-1);
      } else if (event.key === "Enter") {
        const symbol = huntTapeEnterSymbol({
          key: event.key,
          target: event.target,
          rows,
          focusIndex,
          activeModalRow,
        });
        if (symbol) {
          event.preventDefault();
          const row = rows[focusIndex];
          if (row) drillInto(row);
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [activeModalRow, drillInto, focusIndex, keyboardActive, moveFocus, rows]);

  if (!rows.length) {
    return <div className="huntTapeEmpty" role="status">{emptyLabel}</div>;
  }

  const densityClass = tapeDensity === "comfort" ? "huntTapeDensityComfort" : "huntTapeDensityCompact";

  return (
    <div className={`huntTapeBlock ${densityClass}`.trim()} data-density={tapeDensity}>
      <p className="huntTapeHint" aria-live="polite">
        <kbd>j</kbd>/<kbd>k</kbd> pasar · <kbd>Enter</kbd> abrir ficha · <kbd>Esc</kbd> quitar foco
      </p>
      <div className="huntTapeHead" aria-hidden="true">
        <span>Ticker</span>
        <span>Semanal ~12M</span>
        <span>Etapa</span>
        <span>RS</span>
        <span>VCP</span>
        <span>Máx 52s</span>
      </div>
      <ul
        ref={listRef}
        className="huntTapeList"
        role="listbox"
        aria-label="Cola de caza"
        tabIndex={0}
        onScroll={handleListScroll}
        onFocus={() => setKeyboardActive(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            setKeyboardActive(false);
          }
        }}
      >
        {rows.map((row, index) => {
          const rowKey = huntTapeRowKey(row);
          const active = index === focusIndex;
          const stage = huntTapeStageLine(row);
          const rs = huntTapeRsDisplay(row);
          const footprint = formatVcpFootprintFromRow(row);
          const dist = huntTapeDist52w(row);
          const sparkBars = huntTapeSparkBars(row);
          const sparkStatus = resolveHuntTapeSparkStatus(row, {
            deferred: chartPreviewDeferred,
          });
          const sparkTitle = huntTapeSparkTitle(sparkStatus);

          return (
            <li
              key={rowKey}
              ref={(el) => { rowRefs.current[index] = el; }}
              className={`huntTapeRow${active ? " isActive" : ""}`}
              role="option"
              aria-selected={active}
              tabIndex={-1}
              onClick={() => {
                setFocusIndex(index);
                setKeyboardActive(true);
                drillInto(row);
              }}
            >
              <HuntTapeTickerCell row={row} onOpenStock={onOpenStock} />
              <div className="huntTapeSparkWrap" title={sparkTitle}>
                <HuntTapeSparkline bars={sparkBars} status={sparkStatus} />
              </div>
              <span
                className={`huntTapeStage${stage?.line ? "" : " huntTapeCellEmpty"}`}
                title={stage?.title || HUNT_TAPE_STAGE_EMPTY}
              >
                {stage?.line || HUNT_TAPE_STAGE_EMPTY}
              </span>
              <span
                className={`huntTapeRs${rs.missing ? " huntTapeCellEmpty" : ""}`}
                title={rs.title}
              >
                {rs.text}
              </span>
              <span
                className={`huntTapeVcp${footprint ? "" : " huntTapeVcpEmpty"}`}
                title={formatVcpFootprintTitle(row)}
              >
                {footprint || "Sin VCP"}
              </span>
              <span
                className={`huntTapeExt${dist?.hot ? " isHot" : ""}${dist?.label ? "" : " huntTapeCellEmpty"}`}
                title={dist?.label ? "Distancia al máximo de 52 semanas" : HUNT_TAPE_DIST_EMPTY}
              >
                {dist?.label || HUNT_TAPE_DIST_EMPTY}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
