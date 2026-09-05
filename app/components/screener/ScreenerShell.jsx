"use client";

// ScreenerShell es una capa presentacional pura: no posee estado, efectos ni
// persistencia. Toda la lógica vive en app/page.jsx (container) y en los hooks
// useQuickReviewSession / useResultViewModel. Recibe `resultView` (el objeto
// devuelto por useResultViewModel) como prop-bag de solo lectura; el useEffect
// de persistencia del container referencia escalares sueltos, no este objeto,
// por lo que pasar el bag completo no provoca escrituras por identity-change.
//
// Única excepción: el useEffect de cierre del panel de filtros móvil (Escape /
// click fuera) más abajo. `showMobileFilters` es visibilidad de UI pura, no
// estado de negocio — mantenerlo aquí evita subir un ref del DOM del propio
// panel al container solo para esto.

import { useEffect, useLayoutEffect, useRef } from "react";
import { restartStatsEdgeSession } from "@/lib/cloudReauth";
import ResultFilterBar from "@/app/components/screener/ResultFilterBar";
import ResultPagerTable from "@/app/components/screener/ResultPagerTable";
import HuntCardRail from "@/app/components/screener/HuntCardRail";
import HuntCardModeStrip from "@/app/components/screener/HuntCardModeStrip";
import WeeklyChangesLine from "@/app/components/screener/WeeklyChangesLine";
import ScreenerSidebar from "@/app/components/screener/ScreenerSidebar";
import ScreenerLaboratoryPanel from "@/app/components/screener/ScreenerLaboratoryPanel";
import {
  MarketMiniTape,
  MobileResultList,
  PreviewCard,
  SearchCandidateList,
  SearchScopeList,
} from "@/app/screenerPanels";
import { investorStatusLabel, compactMobileScanStatus } from "@/lib/screenerFormat";
import { huntDisplayName } from "@/lib/screenerHuntCards";
import { huntCardSheetFamilyKeys } from "@/lib/huntCardModeDisclosure";
import { SessionPlumbingPanel } from "@/lib/screenerFiltersView";
import { MARKETS_MISALIGNMENT_EMPTY_LABEL, resolveMarketsMisalignmentNotice } from "@/lib/marketAvailability";
import { buildLideresIntlGuardrailNotice, LIDERES_INTL_CTA } from "@/lib/lideresIntlGuardrail";
import { buildScreenerFilterBreakdown } from "@/lib/screenerFilterBreakdown";
import { buildScreenerTruthLine, marketCountLabel, resolveScreenerTruthCounts } from "@/lib/screenerTruthLine";
import { recordTruthLinePaint } from "@/lib/screenerHuntPerf";
import {
  RESULT_PAGE_SIZES,
  SECTOR_STRENGTH_LABELS,
  SECTOR_STRENGTH_OPTIONS,
  marketName,
} from "@/lib/screenerConfig";
import { metricShortLabel } from "@/lib/metricCatalog";
import { rankActionLabel } from "@/lib/screenerExplainability";
import { decisionConfidenceLabel } from "@/lib/decisionAudit";
import { useScreenerMobileViewport } from "@/lib/useScreenerMobileViewport";
import { FILTER_LAYERS_UPGRADE_NOTICE_SOURCE } from "@/lib/screenerFilterLayers";
import { isDismissibleSampleNotice } from "@/lib/snapshotFreshness";

function showScanStatusBar(err, status = "") {
  if (err) return true;
  const text = String(status || "").trim();
  return /^(Cargando|Actualizando|Sincronizando|Descargando|Guardando|Importando|Subiendo)/i.test(text);
}

function MobileCollapsibleNotice({
  label,
  detail,
  peekDetail,
  bodyDetail,
  tone = "",
  defaultOpen = false,
  role = "status",
  children,
}) {
  const peek = peekDetail ?? detail;
  const body = bodyDetail ?? detail;
  return (
    <details
      className={`screenerMobileNotice${tone ? ` screenerMobileNotice--${tone}` : ""}`}
      open={defaultOpen}
    >
      <summary>
        <span className="screenerMobileNoticeLabel">{label}</span>
        <em className="screenerMobileNoticePeek">{peek}</em>
      </summary>
      <div className="screenerMobileNoticeBody" role={role} aria-live="polite">
        <p>{body}</p>
        {children}
      </div>
    </details>
  );
}

export default function ScreenerShell({ chrome, sidebar, search, resultView, results, actions, staleness }) {
  // --- chrome ---
  const {
    presetKey,
    markets,
    filtered,
    filteredCount,
    err,
    status,
    snapshotNotice,
    onDismissFilterLayersUpgradeNotice,
    onDismissSnapshotSampleNotice,
    restoringScan,
    showMobileFilters,
    sidebarCollapsed,
    setShowMobileFilters,
    setSidebarCollapsed,
    marketHealth,
    rows,
    huntTruthOverride = null,
    isHuntTransitionPending = false,
    onHuntTruthLinePaint,
  } = chrome;
  const onHuntTruthLinePaintRef = useRef(onHuntTruthLinePaint);
  onHuntTruthLinePaintRef.current = onHuntTruthLinePaint;

  // --- sidebar ---
  const {
    savedFilterTemplates,
    selectedFilterTemplateId,
    filterTemplateName,
    setPreset,
    applyHuntCard,
    applySavedFilterTemplate,
    setFilterTemplateName,
    saveCurrentFilterTemplate,
    deleteSavedFilterTemplate,
    saveFilterConfigToCloud,
    loadFilterConfigFromCloud,
    isMarketPresetActive,
    marketPreset,
    setMarketsAndInvalidate,
    filterLayers,
    viewLayers,
    useRegimeFilter,
    setUseRegimeFilter,
    toggleFilterLayer,
    setActiveFilterFamily,
    viewFiltersActive,
    settings,
    fieldRules,
    diagnostics,
    familyIntensity,
    familyIntensityCustom,
    familyCoverage,
    familyImpact,
    previewFamilyIntensity,
    commitFamilyIntensity,
  } = sidebar;

  // --- search ---
  const {
    searchSymbol,
    updateSearchSymbol,
    searchCandidates,
    searchResult,
    searchScopeItems,
    searchLoading,
    searchError,
    runSearch,
    clearSearch,
    applySearchScope,
    setSearchSymbol,
    loadSearchResult,
    favoriteSymbols,
    screenerDecisionResolutions,
    addFavorite,
    saveSessionBeforeStockOpen,
  } = search;

  // --- resultView (objeto del hook useResultViewModel) ---
  // Los agregados de auditoría del conjunto (visibleDecisionAudit,
  // visibleAuditabilitySummary, dataHealthSummary, scoreAuditSummary,
  // decisionEvidenceSummary, readinessSummary, reviewPrioritySummary,
  // pendingDecisionWorkSummary) SIGUEN calculándose en useResultViewModel y
  // viajando en el bag: el screener ya no los pinta, por el principio 1 de
  // docs/principios-producto.md. El detalle por valor vive en la ficha
  // (DataHealthPanel / ScoreAuditPanel / DecisionEvidenceChecklist).
  const {
    sort,
    setSort,
    sortAsc,
    toggleSortColumn,
    perfPeriod,
    setPerfPeriod,
    updateSetting: resultUpdateSetting,
    filtered: rvFiltered,
    pagedRows,
    visibleResultPage,
    resultPageSize,
    updateResultPageSize,
    totalResultPages,
    setResultPageClamped,
    resultPageStart,
    resultPageEnd,
    optionLabel,
    decisionResolutionFilter,
    setDecisionResolutionFilter,
    decisionResolutionOptions,
    countryFilter,
    setCountryFilter,
    countryOptions,
    countryCounts,
    themeFilter,
    setThemeFilter,
    setSectorFilter,
    setIndustryFilter,
    themeOptions,
    themeCounts,
    sectorFilter,
    sectorOptions,
    sectorCounts,
    industryFilter,
    industryOptions,
    industryCounts,
    sectorStrength,
    setSectorStrength,
    sectorStrengthCounts,
    ipo,
    setIpo,
    ipos,
    ipoCounts,
    resultFilterChips,
    hiddenByView,
    clearResultView,
    openResultViewReview,
    rowsDeferredStale = false,
  } = resultView;

  // El container pasa `filtered` y `rows` también por `results` para no
  // depender de resultView.filtered (que es el mismo array pero accedido vía
  // el bag). Usamos los que llegan por `results` para coherencia con el resto
  // de bindings del container (diagnósticos, KPIs, openReview(filtered)).
  const {
    filtered: resultsFiltered,
    rows: resultsRows,
    pagedRows: resultsPagedRows,
    activeSettings,
    analyzedRows,
    favoriteSymbols: resultsFavoriteSymbols,
    screenerDecisionResolutions: resultsDecisionResolutions,
    emptyLabel: resultsEmptyLabel,
  } = results;

  // --- actions ---
  const {
    openReview,
    openPrimaryReview,
    saveSnapshot,
    csv,
    decisionAuditJson,
    resetScreenerSession,
    refreshScreenerSnapshotData,
    loadScanForMarketSelection,
    addFavorite: actionsAddFavorite,
    saveSessionBeforeStockOpen: actionsSaveSessionBeforeStockOpen,
    selectedResultSymbol,
    onSelectResultRow,
    openResultReview,
  } = actions;

  // --- staleness ---
  // El container calcula si la selección de mercados diverge del scan cargado.
  // UX-NAC-1: con desalineación la mesa no enseña filas del mercado equivocado
  // como caza usable — solo banner + CTA (UX-14) y empty state bloqueante.
  // UX-NAC-3: auto-carga sin CTA obligatorio; progreso neutro; CTA solo si falla.
  const {
    scanStale = false,
    marketsStale = false,
    scannedAt = null,
    scannedMarkets = [],
    marketsLoadFailed = false,
    marketsLoadFailedDetail = "",
  } = staleness || {};
  const isMobileViewport = useScreenerMobileViewport();
  const huntLabel = huntDisplayName(presetKey, markets);
  const sheetFamilyKeys = huntCardSheetFamilyKeys({ presetKey, markets });
  const presetNameForTruth = huntTruthOverride?.presetName ?? huntLabel;
  const marketsMisalignment = resolveMarketsMisalignmentNotice({
    scannedMarkets,
    selectedMarkets: markets,
    rowCount: analyzedRows.length,
    restoringScan,
    loadFailed: marketsLoadFailed,
    loadFailedDetail: marketsLoadFailedDetail,
  });
  const resultsBlockedByMarketMisalignment = Boolean(
    marketsMisalignment && marketsMisalignment.blocksResults !== false,
  );
  // TRUTH-LOAD-1: la mesa sigue vacía bajo bloqueo UX-NAC, pero la verdad no
  // afirma 0·0·0 mientras restoringScan trae datos (p. ej. muestra 157/204).
  const truthLineLoading = restoringScan;
  const suppressTruthCounts = resultsBlockedByMarketMisalignment && !truthLineLoading;
  const huntResultsRows = resultsBlockedByMarketMisalignment ? [] : resultsRows;
  const huntResultsFiltered = resultsBlockedByMarketMisalignment ? [] : resultsFiltered;
  const huntResultsPagedRows = resultsBlockedByMarketMisalignment ? [] : resultsPagedRows;
  const huntResultsEmptyLabel = resultsBlockedByMarketMisalignment
    ? MARKETS_MISALIGNMENT_EMPTY_LABEL
    : resultsEmptyLabel;
  const truthPassRows = suppressTruthCounts ? [] : resultsRows;
  const truthFilteredRows = suppressTruthCounts ? [] : resultsFiltered;
  const truthAnalyzedRows = suppressTruthCounts ? [] : analyzedRows;
  const { passCount: passCountForTruth, visibleCount: visibleCountForTruth } = resolveScreenerTruthCounts({
    eagerPassCount: truthPassRows.length,
    filteredVisibleCount: truthFilteredRows.length,
    huntTruthOverride,
    isHuntTransitionPending,
    rowsDeferredStale,
    viewFiltersActive,
  });
  const truthLine = buildScreenerTruthLine({
    analyzedRows: truthAnalyzedRows,
    passCount: passCountForTruth,
    visibleCount: visibleCountForTruth,
    loading: truthLineLoading,
    pageSize: resultPageSize,
    totalPages: totalResultPages,
    presetName: presetNameForTruth,
    sort,
    sortAsc,
    scannedAt,
    scannedMarkets,
    selectedMarkets: markets,
    marketsMisaligned: resultsBlockedByMarketMisalignment && marketsLoadFailed,
    suppressMisalignmentAlarm: resultsBlockedByMarketMisalignment && !marketsLoadFailed,
    compactMarketSegments: isMobileViewport,
  });
  useLayoutEffect(() => {
    const ms = recordTruthLinePaint({
      presetName: presetNameForTruth,
      pending: isHuntTransitionPending,
    });
    if (ms != null) onHuntTruthLinePaintRef.current?.(ms);
  }, [truthLine, presetNameForTruth, isHuntTransitionPending]);
  const filterBreakdown = buildScreenerFilterBreakdown({
    diagnostics,
    passCount: passCountForTruth,
    presetName: presetNameForTruth,
    hiddenByView,
    viewChips: resultFilterChips,
  });
  const lideresIntlGuardrail = buildLideresIntlGuardrailNotice({
    presetKey,
    markets,
    scannedMarkets,
    analyzedRows,
  });
  const showSnapshotNotice = snapshotNotice && snapshotNotice.source !== "markets-stale";
  const isFilterLayersUpgradeNotice = snapshotNotice?.source === FILTER_LAYERS_UPGRADE_NOTICE_SOURCE;
  const isSampleTruncationNotice = isDismissibleSampleNotice(snapshotNotice);

  function renderFilterLayersUpgradeDismiss() {
    if (!isFilterLayersUpgradeNotice || !onDismissFilterLayersUpgradeNotice) return null;
    return (
      <div className="storageAlertActions">
        <button
          type="button"
          className="btn btnSmall btnGhost storageAlertFree"
          onClick={onDismissFilterLayersUpgradeNotice}
        >
          Entendido
        </button>
      </div>
    );
  }

  function renderSampleTruncationNoticeActions() {
    if (!isSampleTruncationNotice || !onDismissSnapshotSampleNotice) return null;
    return (
      <div className="storageAlertActions">
        <button
          type="button"
          className="btn btnSmall btnGhost storageAlertFree"
          onClick={onDismissSnapshotSampleNotice}
        >
          Entendido
        </button>
        <button
          type="button"
          className="btn btnSmall btnPrimary"
          onClick={refreshScreenerSnapshotData}
          disabled={restoringScan}
        >
          {restoringScan ? "Actualizando…" : "Traer datos frescos"}
        </button>
      </div>
    );
  }

  function renderSnapshotNoticeActions() {
    if (isFilterLayersUpgradeNotice) return renderFilterLayersUpgradeDismiss();
    if (isSampleTruncationNotice) return renderSampleTruncationNoticeActions();
    return null;
  }

  function handleLideresIntlGuardrailCta(ctaId) {
    if (ctaId === LIDERES_INTL_CTA.LOAD_CORE_INTL) {
      marketPreset("core-intl");
      return;
    }
    if (ctaId === LIDERES_INTL_CTA.REMOVE_US) {
      const nextMarkets = markets.filter((code) => String(code || "").toUpperCase() !== "US");
      setMarketsAndInvalidate(nextMarkets, "US quitado de la selección.");
      return;
    }
    if (ctaId === LIDERES_INTL_CTA.SWITCH_ETAPA_2) {
      applyHuntCard("lideres-etapa-2");
    }
  }

  function renderMarketsMisalignmentNotice() {
    if (!marketsMisalignment) return null;
    const cta = marketsMisalignment.showCta !== false ? (
      <button
        type="button"
        className="btn btnSmall btnPrimary"
        onClick={() => loadScanForMarketSelection(markets, "Cargando datos de la selección…")}
        disabled={restoringScan}
      >
        {restoringScan ? "Cargando…" : marketsMisalignment.ctaLabel}
      </button>
    ) : null;
    if (isMobileViewport) {
      const mobileTone = marketsMisalignment.tone === "loading"
        ? "loading"
        : marketsMisalignment.tone === "error"
          ? "error"
          : "warn";
      return (
        <MobileCollapsibleNotice
          label={marketsMisalignment.label}
          detail={marketsMisalignment.detail}
          peekDetail={marketsMisalignment.peekDetail}
          bodyDetail={marketsMisalignment.bodyDetail}
          tone={mobileTone}
          defaultOpen={false}
        >
          {cta}
        </MobileCollapsibleNotice>
      );
    }
    const toneClass = marketsMisalignment.tone === "loading"
      ? " scanStaleNotice--loading"
      : marketsMisalignment.tone === "error"
        ? " scanStaleNotice--error"
        : "";
    return (
      <div className={`scanStaleNotice${toneClass}`} role="status" aria-live="polite">
        <span className="scanStaleNoticeLabel">{marketsMisalignment.label}</span>
        <b>{marketsMisalignment.detail}</b>
        {cta}
      </div>
    );
  }

  function renderScanStaleNotice() {
    const notice = (
      <>
        <span className="scanStaleNoticeLabel">Cobertura</span>
        <b>Los criterios de cobertura cambiaron; los datos cargados son de la selección anterior.</b>
        <button
          type="button"
          className="btn btnSmall btnPrimary"
          onClick={refreshScreenerSnapshotData}
          disabled={restoringScan}
        >
          {restoringScan ? "Actualizando…" : "Traer datos frescos"}
        </button>
      </>
    );
    if (isMobileViewport) {
      return (
        <MobileCollapsibleNotice
          label="Cobertura"
          detail="Criterios de cobertura cambiados; datos de la selección anterior."
          tone="warn"
        >
          <button
            type="button"
            className="btn btnSmall btnPrimary"
            onClick={refreshScreenerSnapshotData}
            disabled={restoringScan}
          >
            {restoringScan ? "Actualizando…" : "Traer datos frescos"}
          </button>
        </MobileCollapsibleNotice>
      );
    }
    return (
      <div className="scanStaleNotice" role="status" aria-live="polite">
        {notice}
      </div>
    );
  }

  function renderLideresIntlGuardrail() {
    if (!lideresIntlGuardrail) return null;
    const actions = (
      <div className="lideresIntlGuardrailActions">
        {lideresIntlGuardrail.ctas.map((cta) => (
          <button
            key={cta.id}
            type="button"
            className={`btn btnSmall ${cta.primary ? "btnPrimary" : "btnGhost"}`}
            onClick={() => handleLideresIntlGuardrailCta(cta.id)}
            disabled={restoringScan}
          >
            {cta.label}
          </button>
        ))}
      </div>
    );
    if (isMobileViewport) {
      return (
        <MobileCollapsibleNotice
          label={lideresIntlGuardrail.label}
          detail={lideresIntlGuardrail.detail}
          tone="warn"
        >
          {actions}
        </MobileCollapsibleNotice>
      );
    }
    return (
      <div className="scanStaleNotice lideresIntlGuardrail" role="status" aria-live="polite">
        <span className="scanStaleNoticeLabel">{lideresIntlGuardrail.label}</span>
        <b>{lideresIntlGuardrail.detail}</b>
        {actions}
      </div>
    );
  }

  // --- franja P3 (percentil por lote) ---
  // Solo avisamos si hay filas con percentileScope explícito "batch"; ausente
  // no cuenta (scans materializados sin finalize no deben alarmar).
  const visibleBatchRows = huntResultsFiltered.some((row) => row.percentileScope === "batch");
  const statusLabel = investorStatusLabel(status);
  const mobileStatusLabel = compactMobileScanStatus(status);
  const scanStatusVisible = showScanStatusBar(err, status);

  // Cierre del panel de filtros en móvil: Escape en cualquier punto de la
  // página y click/tap fuera del panel (mobileFiltersRef). El botón "Filtros"
  // de la topbar y el propio botón de cierre siguen cerrando via su onClick
  // normal; esto cubre los dos casos que no tenían manejador.
  const mobileFiltersRef = useRef(null);
  const desktopMoreMenuRef = useRef(null);
  const mobileMoreMenuRef = useRef(null);

  function openLaboratoryPanel() {
    const menu = isMobileViewport ? mobileMoreMenuRef.current : desktopMoreMenuRef.current;
    if (!menu) return;
    menu.open = true;
    const lab = menu.querySelector(".screenerLaboratoryPanel");
    if (lab instanceof HTMLDetailsElement) lab.open = true;
  }

  useEffect(() => {
    if (!showMobileFilters) return undefined;
    function handleKeyDown(event) {
      if (event.key === "Escape") setShowMobileFilters(false);
    }
    function handlePointerDown(event) {
      if (mobileFiltersRef.current && !mobileFiltersRef.current.contains(event.target)) {
        setShowMobileFilters(false);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [showMobileFilters, setShowMobileFilters]);

  const sessionPlumbing = (
    <SessionPlumbingPanel
      presetKey={presetKey}
      savedTemplates={savedFilterTemplates}
      selectedTemplateId={selectedFilterTemplateId}
      templateName={filterTemplateName}
      onPreset={setPreset}
      onApplySaved={applySavedFilterTemplate}
      onTemplateName={setFilterTemplateName}
      onSave={saveCurrentFilterTemplate}
      onDelete={deleteSavedFilterTemplate}
      onSaveCloud={saveFilterConfigToCloud}
      onLoadCloud={loadFilterConfigFromCloud}
    />
  );

  const laboratoryPanel = (
    <ScreenerLaboratoryPanel
      diagnostics={diagnostics}
      resultsRows={resultsRows}
      resultsFiltered={resultsFiltered}
    />
  );

  return <main className="page screenerTerminalPage">
    <div className="topbar screenerHeroBar">
      <div className="screenerHeroTitle">
        <span className="screenerEyebrow">StatsEdge · Screener</span>
        <h1 className="title">{huntLabel}</h1>
        <p>{marketCountLabel(markets.length)}</p>
        {/* Autocontenido, como GlobalCoveragePanel: posee su fetch a
            GET /api/weekly-changes y no bloquea la primera pintura. Es la
            segunda excepción a la nota de cabecera de este archivo. */}
        <WeeklyChangesLine onOpenStock={saveSessionBeforeStockOpen} />
      </div>
      <div className="actions">
        <button className="btn btnMobileOnly" onClick={() => setShowMobileFilters(!showMobileFilters)}>Filtros</button>
      </div>
    </div>
    {err && <div className="error">{err}</div>}
    {isMobileViewport && (scanStatusVisible || showSnapshotNotice) ? <div className="screenerMobileNoticeStack">
      {scanStatusVisible ? <div className={`scanStatusBar scanStatusBar--mobileFold ${err ? "error" : "running"}`} role="status" aria-live="polite">
        <span>{err ? "Incidencia" : "Estado"}</span>
        <b>{mobileStatusLabel}</b>
      </div> : null}
      {showSnapshotNotice && !snapshotNotice.requiresReauth ? (
        <MobileCollapsibleNotice
          label={snapshotNotice.label}
          detail={snapshotNotice.detail}
          peekDetail={snapshotNotice.peekDetail}
          bodyDetail={snapshotNotice.bodyDetail}
          tone={snapshotNotice.tone || "info"}
          role="alert"
        >
          {renderSnapshotNoticeActions()}
        </MobileCollapsibleNotice>
      ) : null}
    </div> : null}
    {!isMobileViewport && scanStatusVisible ? <div className={`scanStatusBar ${err ? "error" : "running"}`} role="status" aria-live="polite">
      <span>{err ? "Incidencia" : "Estado"}</span>
      <b>{statusLabel}</b>
    </div> : null}
    {!isMobileViewport && showSnapshotNotice ? <div className={`snapshotFreshnessNotice ${snapshotNotice.requiresReauth ? "compact warn" : snapshotNotice.tone || "info"}`} role="alert" aria-live="polite">
      <span>{snapshotNotice.label}</span>
      <b>{snapshotNotice.detail}</b>
      {snapshotNotice.requiresReauth ? (
        <div className="storageAlertActions">
          <button type="button" className="btn btnSmall btnPrimary" onClick={() => { void restartStatsEdgeSession(); }}>
            Vuelve a entrar
          </button>
        </div>
      ) : renderSnapshotNoticeActions()}
    </div> : null}
    {isMobileViewport && showSnapshotNotice && snapshotNotice.requiresReauth ? <div className="snapshotFreshnessNotice compact warn" role="alert" aria-live="polite">
      <span>{snapshotNotice.label}</span>
      <b>{snapshotNotice.detail}</b>
      <div className="storageAlertActions">
        <button type="button" className="btn btnSmall btnPrimary" onClick={() => { void restartStatsEdgeSession(); }}>
          Vuelve a entrar
        </button>
      </div>
    </div> : null}

    <div className={`dashboardContainer ${sidebarCollapsed ? "sidebarCollapsed" : ""}`}>
      <button
        type="button"
        className="sidebarCollapseBtn"
        onClick={() => setSidebarCollapsed((value) => !value)}
        aria-label={sidebarCollapsed ? "Mostrar filtros" : "Ocultar filtros"}
        aria-expanded={!sidebarCollapsed}
      >
        {sidebarCollapsed ? "Filtros" : "‹"}
      </button>
      <ScreenerSidebar
        mobileFiltersRef={mobileFiltersRef}
        showMobileFilters={showMobileFilters}
        onCloseMobileFilters={() => setShowMobileFilters(false)}
        markets={markets}
        marketsStale={marketsStale}
        isMarketPresetActive={isMarketPresetActive}
        marketPreset={marketPreset}
        setMarketsAndInvalidate={setMarketsAndInvalidate}
        filterLayers={filterLayers}
        useRegimeFilter={useRegimeFilter}
        toggleFilterLayer={toggleFilterLayer}
        setActiveFilterFamily={setActiveFilterFamily}
        setUseRegimeFilter={setUseRegimeFilter}
        sheetFamilyKeys={sheetFamilyKeys}
        cardLabel={huntLabel}
        settings={settings}
        fieldRules={fieldRules}
        familyIntensity={familyIntensity}
        familyIntensityCustom={familyIntensityCustom}
        familyCoverage={familyCoverage}
        familyImpact={familyImpact}
        previewFamilyIntensity={previewFamilyIntensity}
        commitFamilyIntensity={commitFamilyIntensity}
      />

      <main className="mainContent">
        <section className="searchCard">
          <div className="commandSearchPanel searchPanelBare">
              <form className="searchBar" onSubmit={runSearch} style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <input className="input searchInput" value={searchSymbol} onChange={(e) => updateSearchSymbol(e.target.value)} placeholder="Ticker, nombre, sector, subsector o país..." />
                {(searchSymbol || searchCandidates.length || searchResult) && <button type="button" className="btn btnGhost" onClick={clearSearch}>Limpiar</button>}
                <button className="btn btnPrimary" disabled={searchLoading}>{searchLoading ? "Buscando..." : "Buscar"}</button>
              </form>
              <SearchScopeList items={searchScopeItems} onPick={applySearchScope} />
              {searchError && <div className="dataNote error" style={{ marginTop: 12 }}>{investorStatusLabel(searchError)}</div>}
              {searchResult ? <div className="searchResult searchResultPrimary">
                <PreviewCard row={searchResult} variant="search" onFavorite={addFavorite} onOpenStock={saveSessionBeforeStockOpen} isFavorite={favoriteSymbols.has(searchResult.symbol)} decisionResolutions={screenerDecisionResolutions} />
              </div> : null}
              <SearchCandidateList candidates={searchCandidates} activeSymbol={searchResult?.symbol} onPick={(item) => { setSearchSymbol(item.symbol); loadSearchResult(item.symbol, item); }} />
          </div>
          <HuntCardRail presetKey={presetKey} markets={markets} onSelect={applyHuntCard} pending={isHuntTransitionPending} />
          <HuntCardModeStrip
            presetKey={presetKey}
            markets={markets}
            passedRows={resultsRows}
            onOpenFamily={(familyKey) => {
              setShowMobileFilters(true);
              setActiveFilterFamily(familyKey);
            }}
          />
          {renderLideresIntlGuardrail()}
          <p className="screenerTruthLine" role="status" aria-live="polite">{truthLine}</p>
          <details className="screenerFilterBreakdown">
            <summary><span>{filterBreakdown.summaryLabel}</span></summary>
            <div className="screenerFilterBreakdownBody">
              {filterBreakdown.lines.map((line) => (
                <p key={line}>{line}</p>
              ))}
              {filterBreakdown.hasDiagnostics ? (
                <button
                  type="button"
                  className="screenerFilterBreakdownAuditLink"
                  onClick={openLaboratoryPanel}
                >
                  Ver auditoría
                </button>
              ) : null}
            </div>
          </details>
        </section>

        {isMobileViewport ? <section className="mobileResearchHome">
          <MarketMiniTape marketHealth={marketHealth} />
          {renderMarketsMisalignmentNotice()}
          {marketsMisalignment ? null : scanStale ? renderScanStaleNotice() : null}
          <MobileResultList
            rows={huntResultsPagedRows}
            settings={activeSettings}
            totalRows={huntResultsFiltered.length}
            sort={sort}
            onSort={setSort}
            perfPeriod={perfPeriod}
            setupMode={activeSettings.setupMode}
            scannedMarkets={scannedMarkets}
            onPerfPeriod={setPerfPeriod}
            onReview={(symbol) => openReview(huntResultsFiltered, symbol)}
            onFavorite={addFavorite}
            favoriteSymbols={resultsFavoriteSymbols}
            onSave={() => saveSnapshot(huntResultsFiltered)}
            onCsv={() => csv(huntResultsFiltered)}
            onAuditJson={() => decisionAuditJson(huntResultsFiltered)}
            onRefresh={refreshScreenerSnapshotData}
            onReset={resetScreenerSession}
            sessionPlumbing={sessionPlumbing}
            laboratoryPanel={laboratoryPanel}
            moreMenuRef={mobileMoreMenuRef}
            refreshing={restoringScan}
            onOpenStock={saveSessionBeforeStockOpen}
            page={visibleResultPage}
            pageSize={resultPageSize}
            totalPages={totalResultPages}
            onPage={setResultPageClamped}
            onPageSize={updateResultPageSize}
            decisionResolutionFilter={decisionResolutionFilter}
            decisionResolutionOptions={decisionResolutionOptions}
            onDecisionResolutionFilter={setDecisionResolutionFilter}
            decisionResolutions={resultsDecisionResolutions}
            emptyLabel={huntResultsEmptyLabel}
          />
        </section> : null}

        {!isMobileViewport ? <section className="desktopResultsSection" style={{ marginBottom: 20 }}>
          {renderMarketsMisalignmentNotice()}
          {marketsMisalignment ? null : scanStale ? (
            <div className="scanStaleNotice" role="status" aria-live="polite">
              <span className="scanStaleNoticeLabel">Cobertura</span>
              <b>Los criterios de cobertura cambiaron; los datos cargados son de la selección anterior.</b>
              <button
                type="button"
                className="btn btnSmall btnPrimary"
                onClick={refreshScreenerSnapshotData}
                disabled={restoringScan}
              >
                {restoringScan ? "Actualizando…" : "Traer datos frescos"}
              </button>
            </div>
          ) : null}
          <div className="resultsHeader">
            <div className="resultsTitleBlock">
              <h2>Resultados</h2>
            </div>
            <div className="controls resultsToolbar">
              {huntResultsFiltered.length ? (
                <button className="btn btnSmall btnPrimary" onClick={openPrimaryReview}>Revisar</button>
              ) : null}
              {/* Siempre visible, incluso con la tabla vacía. Sin botón
                  Ejecutar, este es el único camino de vuelta a un estado bueno;
                  esconderlo justo cuando no hay resultados —que es cuando hace
                  falta— dejaba la sesión sin salida. */}
              <details ref={desktopMoreMenuRef} className="resultsMoreMenu">
                <summary className="btn btnSmall btnGhost" aria-label="Más herramientas" title="Más herramientas">⋯</summary>
                <div className="resultsMoreMenuPanel">
                  {sessionPlumbing}
                  <div className="resultsMoreMenuLaboratory">
                    {laboratoryPanel}
                  </div>
                  <button
                    type="button"
                    className="btn btnSmall btnGhost"
                    onClick={refreshScreenerSnapshotData}
                    disabled={restoringScan}
                    title="Trae el último escaneo nocturno sin cambiar tus filtros ni plantilla"
                  >
                    {restoringScan ? "Actualizando…" : "Traer datos frescos"}
                  </button>
                  <button
                    type="button"
                    className="btn btnSmall btnGhost"
                    onClick={resetScreenerSession}
                    disabled={restoringScan}
                    title="Borra criterios y vuelve al preset equilibrado con datos nuevos"
                  >
                    Resetear criterios
                  </button>
                  {huntResultsFiltered.length ? <>
                    <button type="button" className="btn btnSmall btnGhost" onClick={() => csv(huntResultsFiltered)}>↓ CSV</button>
                    <button type="button" className="btn btnSmall btnGhost" onClick={() => saveSnapshot(huntResultsFiltered)} aria-label="Guardar copia de resultados">Guardar</button>
                    <button type="button" className="btn btnSmall btnGhost" onClick={() => decisionAuditJson(huntResultsFiltered)} title="Exportar JSON compatible con audit:decisions">JSON audit</button>
                  </> : null}
                </div>
              </details>
            </div>
          </div>

          <ResultFilterBar
            optionLabel={optionLabel}
            decisionResolutionFilter={decisionResolutionFilter}
            decisionResolutionOptions={decisionResolutionOptions}
            onDecisionResolutionFilter={setDecisionResolutionFilter}
            viewLayers={viewLayers}
            viewFiltersActive={viewFiltersActive}
            countryFilter={countryFilter}
            countryOptions={countryOptions}
            countryCounts={countryCounts}
            onCountryFilter={setCountryFilter}
            themeFilter={themeFilter}
            themeOptions={themeOptions}
            themeCounts={themeCounts}
            onThemeFilter={setThemeFilter}
            onSectorFilter={setSectorFilter}
            onIndustryFilter={setIndustryFilter}
            sectorFilter={sectorFilter}
            sectorOptions={sectorOptions}
            sectorCounts={sectorCounts}
            industryFilter={industryFilter}
            industryOptions={industryOptions}
            industryCounts={industryCounts}
            sectorStrength={sectorStrength}
            sectorStrengthCounts={sectorStrengthCounts}
            onSectorStrength={setSectorStrength}
            ipo={ipo}
            ipos={ipos}
            ipoCounts={ipoCounts}
            onIpo={setIpo}
            chips={resultFilterChips}
            hiddenCount={hiddenByView}
            visibleCount={huntResultsFiltered.length}
            totalCount={huntResultsRows.length}
            onClearAll={clearResultView}
            onReview={huntResultsFiltered.length ? openResultViewReview : undefined}
          />
          <ResultPagerTable
            visibleCount={huntResultsFiltered.length}
            resultPageStart={resultPageStart}
            resultPageEnd={resultPageEnd}
            resultPageSize={resultPageSize}
            onPageSizeChange={updateResultPageSize}
            visibleResultPage={visibleResultPage}
            totalResultPages={totalResultPages}
            onSetResultPage={setResultPageClamped}
            pagedRows={huntResultsPagedRows}
            favoriteSymbols={resultsFavoriteSymbols}
            onFavorite={addFavorite}
            onReview={openResultReview}
            onOpenStock={saveSessionBeforeStockOpen}
            selectedSymbol={selectedResultSymbol}
            onSelectRow={onSelectResultRow}
            perfPeriod={perfPeriod}
            onPerfPeriod={setPerfPeriod}
            sort={sort}
            sortAsc={sortAsc}
            onSortColumn={toggleSortColumn}
            setupMode={activeSettings.setupMode}
            scannedMarkets={scannedMarkets}
            hasBatchPercentiles={visibleBatchRows}
            emptyLabel={huntResultsEmptyLabel}
          />
        </section> : null}
      </main>
    </div>
    <footer className="footer" style={{ marginTop: 40, borderTop: "1px solid rgba(255,255,255,.04)", paddingTop: 16, fontSize: 11, opacity: 0.5 }}>StatsEdge · Datos orientativos · {investorStatusLabel(status)}</footer>
  </main>;
}
