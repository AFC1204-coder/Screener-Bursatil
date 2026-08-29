"use client";

// lib/screenerMobile.jsx — composición de la superficie móvil del screener:
// cinta de movers, lista de resultados, fila de resultado y franja de régimen.

import { pct } from "@/lib/formatters";
import { methodologyTradePlanEligible } from "@/lib/methodologyDisplay";
import { DEFAULT_RESULT_PAGE_SIZE, RESULT_PAGE_SIZES, SORT_LABELS } from "@/lib/screenerConfig";
import { money } from "@/lib/screenerFormat";
import {
  PerformancePeriodPicker,
  screenerColumnLabel,
  screenerSortOptions,
  screenerVisibleColumns,
} from "@/lib/screenerColumns";
import { CompanyMark, MiniSparkline, ResultsDisclosureGroup } from "@/lib/screenerAtoms";
import { ipoWatchRowKey } from "@/lib/mergeIpoDiscoveryRows";

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

// La fila móvil lee EXACTAMENTE las mismas columnas que la tabla de escritorio
// (lib/screenerColumns.jsx): la primera —ticker con miniatura— hace de cabecera
// de la tarjeta y las otras seis se pintan como pares etiqueta/valor. Dejarla
// con quince datos mientras escritorio tiene siete sería peor que no tocar nada.
export function MobileResultRow({ row, onReview, onFavorite, isFavorite, onOpenStock, perfPeriod, sort = "", setupMode = "" }) {
  const ctx = {
    perfPeriod,
    favoriteSymbols: isFavorite ? new Set([row.symbol]) : new Set(),
    onFavorite,
    onOpenStock,
    sort,
    setupMode,
  };
  const [identityColumn, ...dataColumns] = screenerVisibleColumns(ctx);
  return <article className="mobileResultRow" onClick={(event) => { if (!event.target.closest("button, a")) onReview?.(row.symbol); }}>
    <div className="mobileResultHead">
      {identityColumn.cell(row, ctx)}
    </div>
    <dl className="mobileResultGrid">
      {dataColumns.map((column) => (
        <div key={column.key} className={`mobileResultField ${column.className}`} data-align={column.align}>
          <dt title={column.legend}>{screenerColumnLabel(column, ctx)}</dt>
          <dd>{column.cell(row, ctx)}</dd>
        </div>
      ))}
    </dl>
  </article>;
}

// Los grupos "Decisiones" y "Auditoría y datos" se retiraron de esta superficie
// (principio 1): eran los mismos rails de auditoría interna que en escritorio.
// Sus resúmenes se siguen calculando en useResultViewModel; simplemente ya no
// se pintan aquí. El detalle por valor vive en la ficha.
export function MobileResultList({ rows = [], settings, totalRows = rows.length, sort, onSort, perfPeriod, onPerfPeriod, onReview, onFavorite, favoriteSymbols, onSave, onCsv, onAuditJson, onOpenStock, savingDisabled = false, page = 1, pageSize = DEFAULT_RESULT_PAGE_SIZE, totalPages = 1, onPage, onPageSize, decisionResolutionFilter = "all", decisionResolutionOptions = [{ key: "all", displayLabel: "Resolución: Todas" }], onDecisionResolutionFilter, decisionResolutions = {}, emptyLabel = "Sin resultados con este filtro." }) {
  const start = totalRows ? ((page - 1) * pageSize) + 1 : 0;
  const end = totalRows ? Math.min(page * pageSize, totalRows) : 0;
  const hasRows = totalRows > 0;
  const mobileFiltersActive = decisionResolutionFilter !== "all" ? 1 : 0;
  const setupMode = settings?.setupMode || "";
  const sortCtx = { perfPeriod, sort, setupMode };
  // El orden móvil solo ofrece las columnas que la tabla muestra. Si la sesión
  // guardada traía un criterio antiguo (score compuesto, deterioro...), se
  // mantiene visible como opción para no cambiar el orden a espaldas del
  // usuario, pero ya no se puede elegir de nuevo.
  const sortOptions = screenerSortOptions(sortCtx);
  const legacySort = sort && !sortOptions.some((item) => item.value === sort)
    ? { value: sort, label: SORT_LABELS[sort] || sort }
    : null;
  return <section className="mobileResultList">
    <div className="mobileResultListHead">
      <span>{hasRows ? `${totalRows} resultados · ${start}-${end} · ${SORT_LABELS[sort] || sort}` : "0 resultados"}</span>
      {hasRows ? <div>
        <select value={sort} onChange={(event) => onSort(event.target.value)} aria-label="Orden movil">
          {legacySort ? <option value={legacySort.value}>{legacySort.label}</option> : null}
          {sortOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        <button type="button" onClick={onCsv} disabled={!rows.length}>CSV</button>
        <button type="button" onClick={onSave} disabled={!rows.length || savingDisabled} aria-label="Guardar snapshot de resultados">Guardar</button>
        <button type="button" className="mobileReviewBtn" onClick={() => onReview()} disabled={!rows.length}>Revisar</button>
        <details className="mobileResultsMoreMenu">
          <summary aria-label="Más herramientas" title="Más herramientas">⋯</summary>
          <button type="button" onClick={onAuditJson} disabled={!rows.length} title="Exportar JSON compatible con audit:decisions">JSON audit</button>
        </details>
      </div> : null}
    </div>
    {hasRows ? <div className="mobileResultPeriodBar">
      <PerformancePeriodPicker value={perfPeriod} onChange={onPerfPeriod} />
    </div> : null}
    {/* Mismo conjunto que la barra de escritorio. Confianza, fiabilidad y acción
        se retiraron allí por filtrar juicios del sistema; «prioridad de
        investigación» es del mismo tipo y aquí no tenía par en escritorio desde
        que se fue su rail, así que cae con ellos. Queda «Resolución», que filtra
        por lo que el usuario marcó en Review/Ficha. */}
    {hasRows ? <ResultsDisclosureGroup label="Filtros" count={mobileFiltersActive ? `${mobileFiltersActive} activos` : "Sin filtros"} className="compactDisclosure mobileFilterDisclosure">
      <div className="mobileFilterGrid">
        <select value={decisionResolutionFilter} onChange={(event) => onDecisionResolutionFilter?.(event.target.value)} aria-label="Filtrar por resolución de decisión">
          {decisionResolutionOptions.map((item) => <option key={item.key} value={item.key}>{item.displayLabel || item.label}</option>)}
        </select>
      </div>
    </ResultsDisclosureGroup> : null}
    {/* Mismo criterio que el pie de escritorio: con una sola página el pager no
        dice nada que la cabecera no diga ya, y ocupa una franja entera. */}
    {hasRows && totalPages > 1 ? <div className="controls mobileResultPager" style={{ marginBottom: 10 }}>
      <select value={pageSize} onChange={(event) => onPageSize?.(Number(event.target.value))} aria-label="Acciones por pagina">
        {RESULT_PAGE_SIZES.map((size) => <option key={size} value={size}>{size} / página</option>)}
      </select>
      <button type="button" onClick={() => onPage?.(page - 1)} disabled={page <= 1} aria-label="Página anterior">‹</button>
      <span className="fine">{page}/{totalPages}</span>
      <button type="button" onClick={() => onPage?.(page + 1)} disabled={page >= totalPages} aria-label="Página siguiente">›</button>
    </div> : null}
    <div className="mobileRows">
      {rows.length ? rows.map((row) => <MobileResultRow key={ipoWatchRowKey(row)} row={row} perfPeriod={perfPeriod} sort={sort} setupMode={setupMode} onReview={onReview} onFavorite={onFavorite} onOpenStock={onOpenStock} isFavorite={favoriteSymbols?.has(row.symbol)} />) : <div className="mobileEmpty">{emptyLabel}</div>}
    </div>
  </section>;
}

export function RegimeStrip({ rows = [], marketHealth, presetName, setupName, mode = "leader" }) {
  const weaknessMode = mode === "weakness";
  const elite = rows.filter((r) => (r.objectiveScore ?? r.totalScore ?? 0) >= 75).length;
  const actionable = rows.filter(methodologyTradePlanEligible).length;
  const weaknessCount = rows.filter((r) => (r.weaknessScore || 0) >= 65).length;
  const marketScore = marketHealth?.marketScore;
  const regime = marketHealth?.regime?.label || "Sin régimen";
  return <div className="regimeStrip">
    <span><b>{Number.isFinite(marketScore) ? Math.round(marketScore) : "-"}</b><em>{regime}</em></span>
    <span><b>{rows.length}</b><em>pasan filtro</em></span>
    <span><b>{weaknessMode ? weaknessCount : elite}</b><em>{weaknessMode ? "deterioro alto" : "elite/leader"}</em></span>
    <span><b>{weaknessMode ? rows.filter((r) => (r.weaknessReasons || []).includes("bajo SMA200")).length : actionable}</b><em>{weaknessMode ? "bajo SMA200" : "planes validos"}</em></span>
    <span><b>{presetName}</b><em>{setupName}</em></span>
  </div>;
}
