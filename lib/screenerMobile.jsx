"use client";

// lib/screenerMobile.jsx — superficie móvil del screener.
//
// Estudio móvil 2026-11 (research/movil-2026-11/propuesta.md, pasos 6-10):
// la lista móvil es la MISMA cinta que escritorio en una línea de 56 px
// (Valor · 12M · Etapa · RS · Máx 52s; bajo el valor, el nombre). Toda la notación sale de las funciones
// puras de lib/screenerHuntTape.jsx: «—» en --ghost para lo ausente (nunca
// «Sin VCP», nunca un RS nulo pintado como 0), miniatura atenuada si el precio
// de la fila va atrasado (lib/dataAge.js) y la marca del usuario (★ ● ◐ ○) a
// la izquierda del ticker. La huella VCP y el tema viven en la vista rápida.

import { useCallback, useEffect, useRef, useState } from "react";
import { pct } from "@/lib/formatters";
import { methodologyTradePlanEligible } from "@/lib/methodologyDisplay";
import { SORT_LABELS } from "@/lib/screenerConfig";
import { money } from "@/lib/screenerFormat";
import { screenerSortOptions } from "@/lib/screenerColumns";
import { CompanyMark, MiniSparkline } from "@/lib/screenerAtoms";
import { canonicalRs } from "@/lib/rsCanonical";
import { isScore } from "@/lib/scoreValue";
import { medianLastDate } from "@/lib/dataAge";
import { stageDisplayForRow } from "@/lib/stageDisplay";
import { decisionResolutionKeyForSymbol } from "@/lib/stockDecisionResolution";
import {
  HUNT_TAPE_ABSENT,
  HUNT_TAPE_DIST_EMPTY,
  HUNT_TAPE_STAGE_EMPTY,
  HuntTapeSparkline,
  huntTapeDist52w,
  huntTapeMarketSuffix,
  huntTapeRowKey,
  huntTapeRsDisplay,
  huntTapeSparkBars,
  huntTapeSparkTitle,
  huntTapeSparkWrapProps,
  huntTapeStageNumber,
  huntTapeUserMark,
} from "@/lib/screenerHuntTape";
import { HuntTapeEmpty } from "@/lib/screenerHuntTapeEmpty";
import { assessMarketRegime } from "@/lib/marketRegimeFreshness";
import {
  computeHuntChartPreviewHydrateLimit,
  computeHuntChartPreviewHydrateStart,
  emitHuntChartPreviewViewport,
  resolveHuntTapeSparkStatus,
} from "@/lib/scansChartPreviewHydrate";

/**
 * Máx 52s de la cinta sin convertir un dato ausente en «0,0 %»: el lector de
 * escritorio hace `Number(null)` → 0. Ausente → null («—» atenuado).
 */
export function mobileDist52w(row = {}) {
  return isScore(row?.distance52w) ? huntTapeDist52w(row) : null;
}

/** Alto de la fila móvil (px): con él salen 11 filas a 390×844 y 9 a 360×740. */
export const MOBILE_TAPE_ROW_H = 56;
/** Filas montadas al entrar; se añaden más al bajar (sin paginador). */
export const MOBILE_TAPE_INITIAL_ROWS = 60;
export const MOBILE_TAPE_ROWS_STEP = 60;

const MONTHS_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];

/** «2026-10-15» → «15 oct». Sin fecha válida → "". */
export function mobileShortDay(isoDate = "") {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoDate || ""));
  if (!match) return "";
  return `${Number(match[3])} ${MONTHS_ES[Number(match[2]) - 1]}`;
}

/**
 * Las dos fechas de la cabecera móvil (propuesta §2.6): la del precio (mediana
 * de lastDate, la misma que el aviso de escritorio) y la del RS semanal (la
 * más frecuente entre las filas con ranking). Son dos datos distintos.
 */
export function mobileFreshnessDates(rows = []) {
  const priceDate = medianLastDate(rows);
  const counts = new Map();
  for (const row of rows) {
    const asOf = canonicalRs(row).asOf;
    if (asOf) counts.set(asOf, (counts.get(asOf) || 0) + 1);
  }
  let rsDate = "";
  let best = 0;
  for (const [date, n] of counts) {
    if (n > best || (n === best && date > rsDate)) { rsDate = date; best = n; }
  }
  return { priceDate, rsDate: rsDate.slice(0, 10) };
}

const STAGE_QUALIFIER_SHORT = Object.freeze({ "Con fuga": "fuga", "Pre-fuga": "pre-fuga", Dudoso: "dudoso" });

/**
 * Etapa en notación de cinta compacta: «2·41» (etapa · semanas en ella) y,
 * debajo, el calificador corto («fuga», «dudoso»). Sin etapa → null.
 */
export function mobileStageCell(row = {}) {
  const stageNum = huntTapeStageNumber(row);
  const weeks = isScore(row.weeklyStageWeek) ? Math.round(Number(row.weeklyStageWeek)) : null;
  if (!stageNum && weeks == null) return null;
  const text = [stageNum, weeks != null ? String(weeks) : ""].filter(Boolean).join("·");
  const display = stageDisplayForRow(row);
  const qualifier = STAGE_QUALIFIER_SHORT[display?.qualifier] || "";
  const base = stageNum
    ? `Etapa semanal ${stageNum}${weeks != null ? ` · ${weeks} semanas en esta etapa` : ""}`
    : `Semanas en etapa: ${weeks}`;
  return { text, qualifier, title: [base, display?.qualifierTitle].filter(Boolean).join(" · ") };
}

function rowUserMark(row, favoriteSymbols, decisionResolutions) {
  if (!row?.symbol) return null;
  return huntTapeUserMark({
    favorite: Boolean(favoriteSymbols?.has?.(row.symbol)),
    resolutionKey: decisionResolutions
      ? decisionResolutionKeyForSymbol({ decisionResolutions }, row.symbol)
      : "",
  });
}

export function MobileTapeRow({
  row,
  index = 0,
  active = false,
  userMark = null,
  chartPreviewDeferred = false,
  onOpen,
}) {
  const symbol = row.symbol || row.companyName || "IPO vigilada";
  const market = row.symbol ? huntTapeMarketSuffix(row) : null;
  const name = String(row.companyName || row.name || "").trim();
  const stage = mobileStageCell(row);
  const rs = huntTapeRsDisplay(row);
  const dist = mobileDist52w(row);
  const sparkStatus = resolveHuntTapeSparkStatus(row, { deferred: chartPreviewDeferred });
  const sparkProps = huntTapeSparkWrapProps(row, huntTapeSparkTitle(sparkStatus));
  const open = () => onOpen?.(index);
  return (
    <li
      className={`mobileTapeRow${active ? " isActive" : ""}`}
      role="button"
      tabIndex={0}
      data-index={index}
      aria-label={`${symbol}: vista rápida`}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      }}
    >
      <span className="mobileTapeId" title={name && name !== symbol ? name : undefined}>
        <span className="mobileTapeTk">
          <span
            className={`huntTapeMark${userMark ? ` huntTapeMark--${userMark.tone}` : ""}`}
            title={userMark?.title}
            aria-label={userMark?.title}
            role={userMark ? "img" : undefined}
            aria-hidden={userMark ? undefined : true}
          >
            {userMark?.glyph || ""}
          </span>
          <b>{symbol}</b>
          {market ? <span className="huntTapeMarket">{market}</span> : null}
        </span>
        {/* El nombre de la empresa vuelve a la segunda línea (decisión del usuario:
            en móvil basta el gráfico; pivote y riesgo viven en la vista rápida). */}
        {name && name !== symbol ? <span className="mobileTapeName">{name}</span> : null}
      </span>
      <span {...sparkProps} className="mobileTapeSpark">
        <HuntTapeSparkline bars={huntTapeSparkBars(row)} status={sparkStatus} />
      </span>
      <span className="mobileTapeCell mobileTapeStage" title={stage?.title || HUNT_TAPE_STAGE_EMPTY}>
        {stage?.text ? stage.text : <span className="huntTapeGhost">{HUNT_TAPE_ABSENT}</span>}
        {stage?.qualifier ? <small>{stage.qualifier}</small> : null}
      </span>
      <span
        className={`mobileTapeCell mobileTapeRs${rs.ghost ? " huntTapeGhost" : ""}`}
        title={rs.title}
        aria-label={rs.missing ? rs.title : undefined}
      >
        {rs.text}
      </span>
      <span
        className={`mobileTapeCell mobileTapeExt${dist?.hot ? " isHot" : ""}${dist?.label ? "" : " huntTapeGhost"}`}
        title={dist?.label ? "Distancia al máximo de 52 semanas" : HUNT_TAPE_DIST_EMPTY}
      >
        {dist?.label || HUNT_TAPE_ABSENT}
      </span>
    </li>
  );
}

/**
 * Orden de la cola en la barra de filtro (`Rend. 3M ▾`). Solo las columnas
 * que la cinta enseña; un criterio guardado antiguo se conserva visible.
 */
export function MobileSortSelect({ sort = "", onSort, perfPeriod, setupMode = "", scannedMarkets = [], presetKey = "" }) {
  const options = screenerSortOptions({ perfPeriod, sort, setupMode, scannedMarkets, presetKey });
  const legacy = sort && !options.some((item) => item.value === sort)
    ? { value: sort, label: SORT_LABELS[sort] || sort }
    : null;
  const current = options.find((item) => item.value === sort) || legacy;
  return (
    <label className="mobileSortBtn">
      <span>{current?.label || "Orden"}</span>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5" /></svg>
      <select value={sort} onChange={(event) => onSort?.(event.target.value)} aria-label="Ordenar la cola">
        {legacy ? <option value={legacy.value}>{legacy.label}</option> : null}
        {options.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
      </select>
    </label>
  );
}

/**
 * Lista móvil: cabecera de columnas pegajosa y filas de una línea. Sin
 * paginador: se montan MOBILE_TAPE_INITIAL_ROWS y se añaden más al bajar.
 * Las miniaturas se hidratan por ventana visible con el mismo evento que la
 * cinta de escritorio (/api/scans/chart-preview; ninguna petición nueva).
 */
export function MobileResultList({
  rows = [],
  chartPreviewDeferred = false,
  favoriteSymbols = null,
  decisionResolutions = null,
  activeIndex = -1,
  onOpenRow,
  emptyLabel = "Sin resultados con este filtro.",
  emptyAction = null,
}) {
  const [mounted, setMounted] = useState(MOBILE_TAPE_INITIAL_ROWS);
  const listRef = useRef(null);
  const headRef = useRef(null);
  const sentinelRef = useRef(null);
  const windowRef = useRef({ start: -1, limit: 0 });
  const rafRef = useRef(0);
  const queueKey = `${rows[0]?.symbol || ""}:${rows.length}:${rows[rows.length - 1]?.symbol || ""}`;

  const publishViewport = useCallback(() => {
    const list = listRef.current;
    if (!list || typeof window === "undefined") return;
    const headBottom = headRef.current?.getBoundingClientRect().bottom ?? 0;
    const offset = Math.max(0, headBottom - list.getBoundingClientRect().top);
    const limit = computeHuntChartPreviewHydrateLimit(window.innerHeight, { rowHeight: MOBILE_TAPE_ROW_H });
    const start = computeHuntChartPreviewHydrateStart(offset, {
      rowHeight: MOBILE_TAPE_ROW_H,
      rowCount: rows.length,
      limit,
    });
    if (start === windowRef.current.start && limit === windowRef.current.limit) return;
    windowRef.current = { start, limit };
    emitHuntChartPreviewViewport({ start, limit });
  }, [rows.length]);

  // Cola nueva (vista, filtro, orden): vuelve arriba y re-publica la ventana.
  useEffect(() => {
    setMounted(MOBILE_TAPE_INITIAL_ROWS);
    windowRef.current = { start: -1, limit: 0 };
    if (listRef.current && listRef.current.getBoundingClientRect().top < 0) window.scrollTo({ top: 0 });
    publishViewport();
  }, [queueKey, publishViewport]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onScroll = () => {
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        publishViewport();
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, [publishViewport]);

  // La cabecera de columnas se pega justo debajo de la cabecera fija de la
  // pantalla, cuya altura cambia (buscador o detalle de frescura abiertos).
  useEffect(() => {
    const sticky = typeof document !== "undefined" ? document.querySelector(".mobileStickyHead") : null;
    const section = listRef.current?.parentElement;
    if (!sticky || !section) return undefined;
    const sync = () => section.style.setProperty("--mobile-sticky-h", `${Math.round(sticky.getBoundingClientRect().height)}px`);
    sync();
    if (typeof ResizeObserver !== "function") return undefined;
    const observer = new ResizeObserver(sync);
    observer.observe(sticky);
    return () => observer.disconnect();
  }, [rows.length > 0]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || typeof IntersectionObserver !== "function" || mounted >= rows.length) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setMounted((current) => Math.min(rows.length, current + MOBILE_TAPE_ROWS_STEP));
      }
    }, { rootMargin: "800px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [mounted, rows.length]);

  // La vista rápida pasa de valor: la fila enfocada tiene que estar montada.
  useEffect(() => {
    if (activeIndex >= mounted) setMounted(Math.min(rows.length, activeIndex + MOBILE_TAPE_ROWS_STEP));
  }, [activeIndex, mounted, rows.length]);

  if (!rows.length) {
    return <section className="mobileResultList mobileResultList--empty"><HuntTapeEmpty label={emptyLabel} action={emptyAction} /></section>;
  }

  const visibleRows = rows.slice(0, mounted);
  return (
    <section className="mobileResultList">
      <div ref={headRef} className="mobileTapeHead" aria-hidden="true">
        <span>Valor</span>
        <span>12M</span>
        <span>Etapa</span>
        <span>RS</span>
        <span>Máx 52s</span>
      </div>
      <ul ref={listRef} className="mobileTapeList" aria-label="Cola de caza">
        {visibleRows.map((row, index) => (
          <MobileTapeRow
            key={huntTapeRowKey(row)}
            row={row}
            index={index}
            active={index === activeIndex}
            userMark={rowUserMark(row, favoriteSymbols, decisionResolutions)}
            chartPreviewDeferred={chartPreviewDeferred}
            onOpen={onOpenRow}
          />
        ))}
      </ul>
      <p ref={sentinelRef} className="mobileTapeFoot">
        {mounted < rows.length
          ? `${visibleRows.length} de ${rows.length} · se cargan más al bajar`
          : `${rows.length} ${rows.length === 1 ? "valor" : "valores"}`}
      </p>
    </section>
  );
}

// Compatibilidad del barril app/screenerPanels.jsx: la fila móvil es la cinta.
export { MobileTapeRow as MobileResultRow };

export function MobileMoverCard({ row, onSelect }) {
  const change = Number.isFinite(row.perf3m) ? row.perf3m : row.rs3m;
  return <button type="button" className="mobileMoverCard" onClick={() => onSelect(row)}>
    <CompanyMark row={row} size="sm" />
    <span className={(change || 0) >= 0 ? "up" : "down"}>{pct(change)}</span>
    <b>{row.symbol}</b>
    <em>{money(row.price, row.currency)}</em>
    <MiniSparkline bars={row.chartPreview || []} />
  </button>;
}

export function MobileTopMovers({ rows = [], onSelect }) {
  const movers = [...rows].filter((row) => Number.isFinite(row.perf3m)).sort((a, b) => (b.perf3m || 0) - (a.perf3m || 0)).slice(0, 8);
  return <section className="mobileTopMovers">
    <div className="mobileSectionHead">
      <span>Top movers · scan</span>
      <button type="button" onClick={() => document.querySelector(".mobileResultList")?.scrollIntoView({ behavior: "smooth", block: "start" })}>Ver más</button>
    </div>
    <div className="mobileMoverRail">
      {movers.length ? movers.map((row) => <MobileMoverCard key={row.symbol} row={row} onSelect={onSelect} />) : <div className="mobileEmpty">Sin datos de mercado todavía.</div>}
    </div>
  </section>;
}

export function RegimeStrip({ rows = [], marketHealth, presetName, setupName, mode = "leader" }) {
  const weaknessMode = mode === "weakness";
  const elite = rows.filter((r) => (r.objectiveScore ?? r.totalScore ?? 0) >= 75).length;
  const actionable = rows.filter(methodologyTradePlanEligible).length;
  const weaknessCount = rows.filter((r) => (r.weaknessScore || 0) >= 65).length;
  // Misma regla de caducidad que Mercado (D3): caducado o sin datos → sin veredicto.
  const regimeRead = assessMarketRegime(marketHealth);
  const marketScore = regimeRead.marketScore;
  const regime = regimeRead.usable ? regimeRead.regimeLabel : regimeRead.headline;
  return <div className="regimeStrip">
    <span><b>{Number.isFinite(marketScore) ? Math.round(marketScore) : "-"}</b><em>{regime}</em></span>
    <span><b>{rows.length}</b><em>pasan filtro</em></span>
    <span><b>{weaknessMode ? weaknessCount : elite}</b><em>{weaknessMode ? "deterioro alto" : "elite/leader"}</em></span>
    <span><b>{weaknessMode ? rows.filter((r) => (r.weaknessReasons || []).includes("bajo SMA200")).length : actionable}</b><em>{weaknessMode ? "bajo SMA200" : "planes validos"}</em></span>
    <span><b>{presetName}</b><em>{setupName}</em></span>
  </div>;
}
