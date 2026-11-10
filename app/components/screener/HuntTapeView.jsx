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
  HUNT_TAPE_ABSENT,
  HUNT_TAPE_DIST_EMPTY,
  HUNT_TAPE_STAGE_EMPTY,
  huntTapeUserMark,
  huntTapeDist52w,
  huntTapeEnterSymbol,
  huntTapeMoveFocus,
  huntTapeRowKey,
  huntTapeRsDisplay,
  huntTapeSparkBars,
  huntTapeSparkTitle,
  huntTapeSparkWrapProps,
  huntTapeStageLine,
  huntTapeThemeCell,
  huntTapeDrillUrl,
  huntTapePeekKeyAction,
} from "@/lib/screenerHuntTape";
import HuntPeekPanel from "@/app/components/screener/HuntPeekPanel";
import { HuntTapePivotCell } from "@/lib/entryPivotChip";
import { HuntTapeEmpty } from "@/lib/screenerHuntTapeEmpty";
import {
  DEFAULT_HUNT_TAPE_DENSITY,
  HUNT_TAPE_DESKTOP_1080_LIST_HEIGHT_PX,
  huntTapeRowHeightPx,
  resolveHuntTapeDensity,
} from "@/lib/screenerHuntTapeDensity";
import { decisionResolutionKeyForSymbol } from "@/lib/stockDecisionResolution";

export default function HuntTapeView({
  rows = [],
  emptyLabel = "Sin resultados con este filtro.",
  onOpenStock,
  activeModalRow = null,
  chartPreviewDeferred = false,
  density = DEFAULT_HUNT_TAPE_DENSITY,
  // Marca del usuario: datos ya en memoria del screener (sin peticiones).
  favoriteSymbols = null,
  decisionResolutions = null,
  // Paso 7: panel lateral de lectura (sin peticiones: lee la fila enfocada).
  peekInclusion = "",
  onFavorite = null,
  onResolveDecision = null,
  // Paso 8: la salida única del estado vacío ({ label, onClick }).
  emptyAction = null,
}) {
  const [focusIndex, setFocusIndex] = useState(0);
  const [keyboardActive, setKeyboardActive] = useState(false);
  const [peekOpen, setPeekOpen] = useState(false);
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
      // Vista rápida (QuickReviewModal) u otro diálogo abierto: sus teclas
      // (← → Esc) son suyas; la cinta no se mueve ni abre el panel debajo.
      if (document.querySelector("dialog[open]")) return;
      const tag = String(event.target?.tagName || "").toUpperCase();
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;

      const peekAction = huntTapePeekKeyAction({
        key: event.key,
        target: event.target,
        peekOpen,
        rowCount: rows.length,
      });
      // Esc con el popover «+ Filtro» abierto cierra el popover, no el panel.
      const filterPopoverOpen = Boolean(document.querySelector("details.screenerFilterPopover[open]"));
      const escapeTaken = event.key === "Escape" && (filterPopoverOpen || event.defaultPrevented);
      if (peekAction && !escapeTaken) {
        event.preventDefault();
        if (peekAction === "close") setPeekOpen(false);
        else if (peekAction === "open") setPeekOpen(true);
        else setPeekOpen((open) => !open);
        setKeyboardActive(true);
        return;
      }

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
  }, [activeModalRow, drillInto, focusIndex, keyboardActive, moveFocus, peekOpen, rows]);

  if (!rows.length) {
    return <HuntTapeEmpty label={emptyLabel} action={emptyAction} />;
  }

  const densityClass = tapeDensity === "comfort" ? "huntTapeDensityComfort" : "huntTapeDensityCompact";
  const peekRow = peekOpen ? rows[Math.min(focusIndex, rows.length - 1)] : null;

  return (
    <div className={`huntTapeBlock ${densityClass}${peekRow ? " isPeekOpen" : ""}`.trim()} data-density={tapeDensity}>
      <div className="huntTapeHead" aria-hidden="true">
        <span>Ticker</span>
        <span>Tema</span>
        <span>Semanal ~12M</span>
        <span>Etapa</span>
        <span>RS</span>
        <span>VCP</span>
        <span title="Distancia al pivote · R = riesgo hasta el stop de referencia">Pivote · R</span>
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
          const { label: theme, title: themeTitle } = huntTapeThemeCell(row);
          const sparkBars = huntTapeSparkBars(row);
          const sparkStatus = resolveHuntTapeSparkStatus(row, {
            deferred: chartPreviewDeferred,
          });
          const sparkTitle = huntTapeSparkTitle(sparkStatus);
          const userMark = row.symbol
            ? huntTapeUserMark({
              favorite: Boolean(favoriteSymbols?.has?.(row.symbol)),
              resolutionKey: decisionResolutions
                ? decisionResolutionKeyForSymbol({ decisionResolutions }, row.symbol)
                : "",
            })
            : null;

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
                // Con el panel abierto, el clic lo lleva a esta fila; cerrado,
                // el clic abre la ficha como siempre.
                if (!peekOpen) drillInto(row);
              }}
            >
              <HuntTapeTickerCell row={row} onOpenStock={onOpenStock} userMark={userMark} />
              {/* Paso 6: tema en todas las filas (dato presente siempre) en
                  lugar de dejar la columna VCP sobredimensionada y vacía. */}
              <span className={`huntTapeTheme${theme ? "" : " huntTapeGhost"}`} title={themeTitle}>
                {theme || HUNT_TAPE_ABSENT}
              </span>
              <div {...huntTapeSparkWrapProps(row, sparkTitle)}>
                <HuntTapeSparkline bars={sparkBars} status={sparkStatus} />
              </div>
              <span
                className={`huntTapeStage${stage?.line ? "" : " huntTapeCellEmpty"}`}
                title={stage?.title || HUNT_TAPE_STAGE_EMPTY}
              >
                {stage?.line || HUNT_TAPE_STAGE_EMPTY}
              </span>
              <span
                className={`huntTapeRs${rs.missing ? " huntTapeCellEmpty" : ""}${rs.ghost ? " huntTapeGhost" : ""}`}
                title={rs.title}
                aria-label={rs.missing ? rs.title : undefined}
              >
                {rs.text}
              </span>
              <span
                className={`huntTapeVcp${footprint ? "" : " huntTapeVcpEmpty huntTapeGhost"}`}
                title={formatVcpFootprintTitle(row)}
                aria-label={footprint ? undefined : formatVcpFootprintTitle(row)}
              >
                {footprint || HUNT_TAPE_ABSENT}
              </span>
              <HuntTapePivotCell row={row} className="huntTapePivot" />
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
      {/* Paso 6: atajos como pie de 26 px con la posición en la cola (antes,
          una fila entera sobre la cabecera). */}
      <p className="huntTapeHint">
        <span><kbd>j</kbd>/<kbd>k</kbd> mover</span>
        <span><kbd>Space</kbd> panel</span>
        <span><kbd>Enter</kbd> ficha</span>
        <span><kbd>Esc</kbd> {peekRow ? "cerrar panel" : "quitar foco"}</span>
        <span className="huntTapeHintPos" aria-live="polite">{Math.min(focusIndex + 1, rows.length)} / {rows.length}</span>
      </p>
      {peekRow ? (
        <HuntPeekPanel
          row={peekRow}
          inclusion={peekInclusion}
          isFavorite={Boolean(favoriteSymbols?.has?.(peekRow.symbol))}
          resolutionKey={decisionResolutions
            ? decisionResolutionKeyForSymbol({ decisionResolutions }, peekRow.symbol)
            : ""}
          chartPreviewDeferred={chartPreviewDeferred}
          onClose={() => setPeekOpen(false)}
          onFavorite={onFavorite}
          onResolveDecision={onResolveDecision}
          onOpenStock={onOpenStock}
        />
      ) : null}
    </div>
  );
}

