"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  HuntTapeSparkline,
  HuntTapeTickerCell,
  formatVcpFootprintFromRow,
  formatVcpFootprintTitle,
  huntTapeDist52w,
  huntTapeEnterSymbol,
  huntTapeMoveFocus,
  huntTapeRowKey,
  huntTapeRsValue,
  huntTapeSparkBars,
  huntTapeStageLine,
  huntTapeDrillUrl,
} from "@/lib/screenerHuntTape";

export default function HuntTapeView({
  rows = [],
  emptyLabel = "Sin resultados con este filtro.",
  onOpenStock,
  activeModalRow = null,
}) {
  const [focusIndex, setFocusIndex] = useState(0);
  const [keyboardActive, setKeyboardActive] = useState(false);
  const listRef = useRef(null);
  const rowRefs = useRef([]);

  useEffect(() => {
    if (focusIndex >= rows.length) {
      setFocusIndex(Math.max(0, rows.length - 1));
    }
  }, [rows.length, focusIndex]);

  const scrollFocusIntoView = useCallback((index) => {
    const el = rowRefs.current[index];
    el?.scrollIntoView({ block: "nearest" });
  }, []);

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

  return (
    <div className="huntTapeBlock">
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
          const rs = huntTapeRsValue(row);
          const footprint = formatVcpFootprintFromRow(row);
          const dist = huntTapeDist52w(row);
          const sparkBars = huntTapeSparkBars(row);

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
              <div className="huntTapeSparkWrap" title="Spark desde chartPreview del scan">
                <HuntTapeSparkline bars={sparkBars} />
              </div>
              <span className="huntTapeStage" title={stage?.title || "Sin etapa semanal"}>
                {stage?.line || "–"}
              </span>
              <span className="huntTapeRs" title={rs.reason || "RS canónico semanal"}>
                {Number.isFinite(rs.value) ? rs.value : "–"}
              </span>
              <span
                className={`huntTapeVcp${footprint ? "" : " huntTapeVcpEmpty"}`}
                title={formatVcpFootprintTitle(row)}
              >
                {footprint || "–"}
              </span>
              <span className={`huntTapeExt${dist?.hot ? " isHot" : ""}`} title="Distancia al máximo de 52 semanas">
                {dist?.label || "–"}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
