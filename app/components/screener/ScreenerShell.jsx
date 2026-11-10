"use client";

// ScreenerShell es una capa presentacional pura: no posee estado, efectos ni
// persistencia. Toda la lógica vive en app/page.jsx (container) y en los hooks
// useQuickReviewSession / useResultViewModel. Recibe `resultView` (el objeto
// devuelto por useResultViewModel) como prop-bag de solo lectura; el useEffect
// de persistencia del container referencia escalares sueltos, no este objeto,
// por lo que pasar el bag completo no provoca escrituras por identity-change.
//
// Excepción: visibilidad de UI pura del móvil (estudio móvil 2026-11): qué
// fila enseña la hoja de vista rápida, si el buscador está desplegado y si el
// detalle de frescura está abierto. No es estado de negocio ni se persiste.
// La hoja de filtros sigue gobernada por `showMobileFilters` del container.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { regimeFilterNote } from "@/lib/marketRegimeFreshness";
import { restartStatsEdgeSession } from "@/lib/cloudReauth";
import ResultFilterBar from "@/app/components/screener/ResultFilterBar";
import ResultPagerTable from "@/app/components/screener/ResultPagerTable";
import HuntCardRail from "@/app/components/screener/HuntCardRail";
import HuntCardModeStrip from "@/app/components/screener/HuntCardModeStrip";
import IpoCohortWindowChips from "@/app/components/screener/IpoCohortWindowChips";
import WeeklyChangesLine from "@/app/components/screener/WeeklyChangesLine";
import { useWeeklyChanges } from "@/app/components/screener/useWeeklyChanges";
import { MarketScopeChip } from "@/app/components/screener/ScreenerSidebar";
import MobileFilterSheet from "@/app/components/screener/MobileFilterSheet";
import MobilePeekSheet from "@/app/components/screener/MobilePeekSheet";
import ScreenerLaboratoryPanel from "@/app/components/screener/ScreenerLaboratoryPanel";
import {
  FilterArchitecturePanel,
  MobileResultList,
  PreviewCard,
  SearchCandidateList,
  SearchScopeList,
} from "@/app/screenerPanels";
import { MobileSortSelect, mobileFreshnessDates, mobileShortDay } from "@/lib/screenerMobile";
import { decisionResolutionKeyForSymbol } from "@/lib/stockDecisionResolution";
import { activeLayerCount, analyzedCountForDisplay, investorStatusLabel, compactMobileScanStatus } from "@/lib/screenerFormat";
import { num } from "@/lib/formatters";
import {
  favoritesQueueView,
  huntDisplayName,
  resolveActiveHuntCard,
  weeklyQueueViews,
} from "@/lib/screenerHuntCards";
import { formatDayLabel, weeklyHeadingFromPayload } from "@/lib/weeklyChanges";
import { huntCardModeDisclosure, huntCardSheetFamilyKeys } from "@/lib/huntCardModeDisclosure";
import { SessionPlumbingPanel } from "@/lib/screenerFiltersView";
import {
  buildCuratedPopulationNotice,
  MARKETS_MISALIGNMENT_EMPTY_LABEL,
  resolveMarketsMisalignmentNotice,
} from "@/lib/marketAvailability";
import { buildLideresIntlGuardrailNotice, LIDERES_INTL_CTA } from "@/lib/lideresIntlGuardrail";
import { buildScreenerFilterBreakdown } from "@/lib/screenerFilterBreakdown";
import {
  buildScreenerTruthLine,
  resolveScreenerTruthCounts,
  SCREENER_TRUTH_VARIANT_TICKET,
} from "@/lib/screenerTruthLine";
import { screenerSortOptions } from "@/lib/screenerColumns";
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
import { MARKET_PRESET_CHIP_OPTIONS } from "@/lib/screenerChromeMode";
import {
  FILTER_LAYERS_UPGRADE_NOTICE_SOURCE,
  filterLayersUpgradeNoticeReadyToShow,
} from "@/lib/screenerFilterLayers";
import { isDismissibleSampleNotice } from "@/lib/snapshotFreshness";
import {
  coldProgressEmptyLabel,
  isPrimaryScanProgressStatus,
  resolveColdProgressSurfaces,
} from "@/lib/screenerColdProgress";
import MesaEmptyCard from "@/app/components/screener/MesaEmptyCard";
import { HUNT_EMPTY_ACTIONS, OPEN_FILTER_POPOVER_EVENT, resolveHuntEmptyState } from "@/lib/screenerHuntTapeEmpty";
import { huntPeekInclusion } from "@/lib/screenerHuntTape";
import ScreenerDataStateDrawer from "@/app/components/screener/ScreenerDataStateDrawer";
import {
  shouldFoldSnapshotNoticeIntoMesaEmpty,
  shouldShowMesaEmptyCard,
} from "@/lib/mesaEmptyState";
import {
  buildScreenerBannerCandidates,
  isBannerSlotVisible,
  selectBannerSlots,
} from "@/lib/screenerBannerQueue";

// Paso 6: verdad corta de una cola externa — cuántos de la cola están en la
// mesa cargada y, si viene de los cambios semanales, desde cuándo.
function buildQueueTruthLine({ queue, passCount = 0, visibleCount = 0, sortLabel = "" }) {
  const total = queue?.symbols?.size || 0;
  return [
    `${passCount} de ${total} en la mesa`,
    visibleCount !== passCount ? `${visibleCount} en lista` : null,
    queue?.since ? `desde el ${formatDayLabel(queue.since)}` : null,
    sortLabel ? `ordenado por ${sortLabel}` : null,
  ].filter(Boolean).join(" · ");
}

function showScanStatusBar(err, status = "") {
  return isPrimaryScanProgressStatus(err, status);
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

function MobileStatusFold({
  err = false,
  statusLabel = "",
  mobileStatusLabel = "",
  scanStatusVisible = false,
  snapshotNotice = null,
  showSnapshotNotice = false,
  children,
}) {
  const showSnapshot = showSnapshotNotice && snapshotNotice && !snapshotNotice.requiresReauth;
  if (!scanStatusVisible && !showSnapshot) return null;

  const summaryLabel = scanStatusVisible
    ? (err ? "Incidencia" : "Estado")
    : (snapshotNotice?.label || (err ? "Incidencia" : "Estado"));

  let peek = "";
  if (scanStatusVisible && showSnapshot) {
    peek = [
      mobileStatusLabel || statusLabel,
      snapshotNotice.peekDetail ?? snapshotNotice.detail,
    ].filter(Boolean).join(" · ");
  } else if (scanStatusVisible) {
    peek = mobileStatusLabel || statusLabel;
  } else if (showSnapshot) {
    const snapshotPeek = snapshotNotice.peekDetail ?? snapshotNotice.detail;
    peek = snapshotNotice.label
      ? `${snapshotNotice.label} · ${snapshotPeek}`
      : snapshotPeek;
  }

  return (
    <details className="screenerMobileStatusFold">
      <summary>
        <span className="screenerMobileStatusFoldLabel">{summaryLabel}</span>
        <em className="screenerMobileStatusFoldPeek">{peek}</em>
      </summary>
      <div className="screenerMobileStatusFoldBody" role="status" aria-live="polite">
        {scanStatusVisible ? <p>{statusLabel}</p> : null}
        {showSnapshot ? (
          <>
            <p>{snapshotNotice.bodyDetail ?? snapshotNotice.detail}</p>
            {children}
          </>
        ) : null}
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
    setShowMobileFilters,
    rows,
    huntTruthOverride = null,
    isHuntTransitionPending = false,
    onHuntTruthLinePaint,
    huntQueue = null,
    huntCardCounts = {},
    marketHealth = null,
  } = chrome;
  const onHuntTruthLinePaintRef = useRef(onHuntTruthLinePaint);
  onHuntTruthLinePaintRef.current = onHuntTruthLinePaint;

  // Rediseño 2026-11 (paso 5): el toggle Diario/Expert desaparece. Escritorio:
  // las familias viven en el popover «+ Filtro» de la barra sobre la tabla.
  // Móvil (estudio 2026-11, paso 9): las mismas familias en la hoja inferior
  // de filtros. La clave persistida de lib/screenerChromeMode.js ya no se lee.
  // Móvil: fila abierta en la vista rápida (-1 = cerrada), buscador y detalle
  // de frescura desplegados.
  const [mobilePeekIndex, setMobilePeekIndex] = useState(-1);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [mobileFreshOpen, setMobileFreshOpen] = useState(false);

  // --- sidebar ---
  const {
    savedFilterTemplates,
    selectedFilterTemplateId,
    filterTemplateName,
    setPreset,
    applyHuntCard,
    applyHuntQueue,
    clearHuntQueue,
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
    updateSetting,
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
    chartPreviewDeferred = false,
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
    resolveScreenerDecision,
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
    marketsSelectionLoadSettled = false,
    universeCache = null,
    providerDiagnostics = null,
    esmaFirdsEnabled = null,
    fcaFirdsEnabled = null,
    scanLocalId = "",
  } = staleness || {};
  const isMobileViewport = useScreenerMobileViewport();
  const mobileFreshness = useMemo(
    () => (isMobileViewport ? mobileFreshnessDates(analyzedRows) : { priceDate: "", rsDate: "" }),
    [isMobileViewport, analyzedRows],
  );
  // Paso 6: con una cola externa del raíl abierta, la vista ES la cola.
  const huntLabel = huntQueue?.label || huntDisplayName(presetKey, markets);
  const activeHuntCard = resolveActiveHuntCard(presetKey, markets);
  const filterActiveCount = activeLayerCount(filterLayers) + (useRegimeFilter ? 1 : 0);
  const sheetFamilyKeys = huntCardSheetFamilyKeys({ presetKey, markets });
  const presetNameForTruth = huntTruthOverride?.presetName ?? huntLabel;
  const marketsMisalignment = resolveMarketsMisalignmentNotice({
    scannedMarkets,
    selectedMarkets: markets,
    rowCount: analyzedRows.length,
    restoringScan,
    loadFailed: marketsLoadFailed,
    loadFailedDetail: marketsLoadFailedDetail,
    selectionLoadSettled: marketsSelectionLoadSettled,
  });
  const resultsBlockedByMarketMisalignment = Boolean(
    marketsMisalignment && marketsMisalignment.blocksResults !== false,
  );
  // T9: una historia de progreso en cold — status bar primario; weekly defer;
  // truth/empty no compiten con «cargando…» / «últimos datos guardados…».
  const coldProgress = resolveColdProgressSurfaces({ restoringScan, status, err });
  // Paso 6: una sola petición a /api/weekly-changes alimenta el raíl («Esta
  // noche») y el panel de detalle. T9: diferida en cold restore.
  // D2: la comparación se ancla al escaneo mostrado (scanContext.id).
  const weekly = useWeeklyChanges({ defer: coldProgress.deferWeekly, scanLocalId });
  const weeklyViews = weeklyQueueViews(weekly.payload);
  const weeklyHeading = weeklyHeadingFromPayload(weekly.payload);
  const weeklySinceLabel = weekly.payload?.state === "ok" ? formatDayLabel(weekly.payload?.window?.from) : "";
  // TRUTH-LOAD-1: la mesa sigue vacía bajo bloqueo UX-NAC, pero la verdad no
  // afirma 0·0·0 mientras restoringScan trae datos (p. ej. muestra 157/204).
  // Si el status bar ya cuenta la carga, la truth no duplica «cargando…».
  const truthLineLoading = coldProgress.truthLineLoading;
  const suppressTruthCounts = resultsBlockedByMarketMisalignment && !restoringScan;
  const huntResultsRows = resultsBlockedByMarketMisalignment ? [] : resultsRows;
  const huntResultsFiltered = resultsBlockedByMarketMisalignment ? [] : resultsFiltered;
  const huntResultsPagedRows = resultsBlockedByMarketMisalignment ? [] : resultsPagedRows;
  const huntResultsEmptyLabel = resultsBlockedByMarketMisalignment
    ? MARKETS_MISALIGNMENT_EMPTY_LABEL
    : (coldProgress.quietEmptyLabel ? coldProgressEmptyLabel() : resultsEmptyLabel);
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
  const truthQuietProgress = Boolean(
    coldProgress.primaryStatusBar
    && truthAnalyzedRows.length === 0
    && passCountForTruth === 0
    && visibleCountForTruth === 0,
  );
  const truthLineParams = {
    analyzedRows: truthAnalyzedRows,
    passCount: passCountForTruth,
    visibleCount: visibleCountForTruth,
    loading: truthLineLoading,
    quietProgress: truthQuietProgress,
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
    universeCache,
    providerDiagnostics,
    esmaFirdsEnabled,
    fcaFirdsEnabled,
  };
  // Rediseño 2026-11 (paso 4): el ticket pinta la variante corta (sin el nombre
  // de la vista, que es el título, ni la mesa alineada, que es el chip) y dice
  // por qué se ordena la cola. La frase completa queda en el title.
  const sortLabelForTruth = screenerSortOptions({
    perfPeriod,
    sort,
    setupMode: activeSettings?.setupMode,
    presetKey,
    scannedMarkets,
  }).find((option) => option.value === sort)?.label || "";
  const truthLineFull = buildScreenerTruthLine(truthLineParams);
  const truthLine = huntQueue
    ? buildQueueTruthLine({
      queue: huntQueue,
      passCount: passCountForTruth,
      visibleCount: visibleCountForTruth,
      sortLabel: sortLabelForTruth,
    })
    : buildScreenerTruthLine({
      ...truthLineParams,
      variant: SCREENER_TRUTH_VARIANT_TICKET,
      sortLabel: sortLabelForTruth,
    });
  useLayoutEffect(() => {
    const ms = recordTruthLinePaint({
      presetName: presetNameForTruth,
      pending: isHuntTransitionPending,
    });
    if (ms != null) onHuntTruthLinePaintRef.current?.(ms);
  }, [truthLine, presetNameForTruth, isHuntTransitionPending]);
  // Paso 8: vacío contractual — una frase con la causa real y una salida.
  const huntEmptyState = resolveHuntEmptyState({
    emptyLabel: huntResultsEmptyLabel,
    passive: resultsBlockedByMarketMisalignment || coldProgress.quietEmptyLabel || restoringScan,
    analyzedCount: analyzedRows.length,
    passCount: huntResultsRows.length,
    chips: resultFilterChips,
    queue: huntQueue,
    presetName: presetNameForTruth,
    diagnostics,
  });
  const huntEmptyActionHandlers = {
    [HUNT_EMPTY_ACTIONS.CLOSE_QUEUE]: () => clearHuntQueue?.(),
    [HUNT_EMPTY_ACTIONS.REFRESH]: () => refreshScreenerSnapshotData?.(),
    [HUNT_EMPTY_ACTIONS.ADJUST_FILTER]: () => window.dispatchEvent(new Event(OPEN_FILTER_POPOVER_EVENT)),
    [HUNT_EMPTY_ACTIONS.CLEAR_CHIP]: () => {
      const chip = resultFilterChips.find((item) => item.key === huntEmptyState.action?.chipKey)
        || resultFilterChips[resultFilterChips.length - 1];
      chip?.onClear?.();
    },
  };
  const huntEmptyAction = huntEmptyState.action
    ? {
      label: huntEmptyState.action.label,
      onClick: huntEmptyActionHandlers[huntEmptyState.action.kind],
      disabled: huntEmptyState.action.kind === HUNT_EMPTY_ACTIONS.REFRESH && restoringScan,
    }
    : null;
  // Paso 7: por qué está la fila en la cola (vista activa, no juicio).
  const huntPeekInclusionLabel = huntPeekInclusion({
    queue: huntQueue,
    presetName: presetNameForTruth,
    sinceLabel: huntQueue?.since ? formatDayLabel(huntQueue.since) : "",
  });
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
  const curatedPopulationNotice = buildCuratedPopulationNotice({
    scannedMarkets,
    selectedMarkets: markets,
    rowCount: analyzedRows.length,
    universeCache,
    providerDiagnostics,
    esmaFirdsEnabled,
    fcaFirdsEnabled,
  });
  const isFilterLayersUpgradeNotice = snapshotNotice?.source === FILTER_LAYERS_UPGRADE_NOTICE_SOURCE;
  // T3: no pintar «formato antiguo de filtros» mientras la mesa hidrata.
  const showFilterLayersUpgradeNotice = !isFilterLayersUpgradeNotice
    || filterLayersUpgradeNoticeReadyToShow({ restoringScan });
  // P1: empty de datos (sin escaneo) → tarjeta humana; no confundir con 0-pasan-filtro.
  const showMesaEmptyCard = shouldShowMesaEmptyCard({
    analyzedCount: analyzedRows.length,
    restoringScan,
    resultsBlocked: resultsBlockedByMarketMisalignment,
  });
  const foldSnapshotIntoMesaEmpty = showMesaEmptyCard
    && shouldFoldSnapshotNoticeIntoMesaEmpty(snapshotNotice);
  const showSnapshotNotice = Boolean(
    snapshotNotice
    && snapshotNotice.source !== "markets-stale"
    && showFilterLayersUpgradeNotice
    && !foldSnapshotIntoMesaEmpty,
  );
  const isSampleTruncationNotice = isDismissibleSampleNotice(snapshotNotice);
  // P2: cola ≤1 hard + ≤1 soft; overflow → «Estado de datos».
  // scanStatusVisible se calcula más abajo; usamos la misma regla aquí.
  const scanStatusVisibleForQueue = showScanStatusBar(err, status);
  const bannerCandidates = buildScreenerBannerCandidates({
    err,
    showSnapshotNotice,
    snapshotNotice,
    scanStatusVisible: scanStatusVisibleForQueue,
    marketsMisalignment,
    scanStale,
    lideresIntlGuardrail,
    curatedPopulationNotice,
  });
  const bannerSlots = selectBannerSlots(bannerCandidates);
  const bannerVisibleIds = bannerSlots.visibleIds;
  const snapshotBannerId = snapshotNotice?.requiresReauth
    ? "auth-reauth"
    : (String(snapshotNotice?.tone || "info").toLowerCase() === "warn"
      || String(snapshotNotice?.tone || "").toLowerCase() === "error"
      || String(snapshotNotice?.tone || "").toLowerCase() === "bad"
      || Boolean(snapshotNotice?.stale)
      ? "snapshot-warn"
      : "snapshot-info");
  const marketsBannerId = !marketsMisalignment
    ? null
    : (String(marketsMisalignment.tone || "").toLowerCase() === "error"
      ? "markets-error"
      : String(marketsMisalignment.tone || "").toLowerCase() === "loading"
        ? "markets-loading"
        : "markets-misalignment");
  const scanStatusBannerId = "scan-status";
  const showPrimaryErr = Boolean(err) && isBannerSlotVisible(bannerVisibleIds, "err");
  const showPrimarySnapshot = showSnapshotNotice && isBannerSlotVisible(bannerVisibleIds, snapshotBannerId);
  // Incidencia: el div `.error` es el hard; el status bar solo si es progreso soft.
  const showPrimaryScanStatus = scanStatusVisibleForQueue
    && !err
    && isBannerSlotVisible(bannerVisibleIds, scanStatusBannerId);
  const showPrimaryMarkets = Boolean(marketsBannerId)
    && isBannerSlotVisible(bannerVisibleIds, marketsBannerId);
  const showPrimaryScanStale = Boolean(scanStale)
    && !marketsMisalignment
    && isBannerSlotVisible(bannerVisibleIds, "scan-stale-coverage");
  const showPrimaryLideres = Boolean(lideresIntlGuardrail)
    && isBannerSlotVisible(bannerVisibleIds, "lideres-intl");
  const showPrimaryCuratedPopulation = Boolean(curatedPopulationNotice)
    && isBannerSlotVisible(bannerVisibleIds, "curated-population");
  const searchInputRef = useRef(null);

  function focusSearchInput() {
    if (isMobileViewport && !mobileSearchOpen) {
      setMobileSearchOpen(true);
      return;
    }
    const input = searchInputRef.current;
    if (!input) return;
    input.focus();
    input.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

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
    if (!marketsMisalignment || !showPrimaryMarkets) return null;
    const showActions = marketsMisalignment.showCta !== false;
    const cta = showActions ? (
      <button
        type="button"
        className="btn btnSmall btnPrimary"
        onClick={() => loadScanForMarketSelection(markets, "Cargando datos de la selección…")}
        disabled={restoringScan}
      >
        {restoringScan ? "Cargando…" : marketsMisalignment.ctaLabel}
      </button>
    ) : null;
    // P9: CTA secundaria «Quedarme en {mesa}» alinea la selección a lo ya cargado.
    const stayCta = showActions
      && marketsMisalignment.stayCtaLabel
      && Array.isArray(scannedMarkets)
      && scannedMarkets.length
      && marketsMisalignment.tone !== "loading"
      ? (
        <button
          type="button"
          className="btn btnSmall"
          onClick={() => setMarketsAndInvalidate(
            [...scannedMarkets],
            `Selección alineada a la mesa (${marketsMisalignment.stayCtaLabel}).`,
          )}
          disabled={restoringScan}
        >
          {marketsMisalignment.stayCtaLabel}
        </button>
      )
      : null;
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
          {stayCta}
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
        <b title={marketsMisalignment.detail}>{marketsMisalignment.detail}</b>
        {cta}
        {stayCta}
      </div>
    );
  }

  function renderScanStaleNotice() {
    if (!showPrimaryScanStale) return null;
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

  function renderCuratedPopulationNotice() {
    if (!curatedPopulationNotice || !showPrimaryCuratedPopulation) return null;
    if (isMobileViewport) {
      return (
        <MobileCollapsibleNotice
          label={curatedPopulationNotice.label}
          detail={curatedPopulationNotice.detail}
          peekDetail={curatedPopulationNotice.peekDetail}
          bodyDetail={curatedPopulationNotice.bodyDetail}
          tone="warn"
        />
      );
    }
    return (
      <div className="scanStaleNotice curatedPopulationNotice" role="status" aria-live="polite">
        <span className="scanStaleNoticeLabel">{curatedPopulationNotice.label}</span>
        <b title={curatedPopulationNotice.detail}>{curatedPopulationNotice.detail}</b>
      </div>
    );
  }

  function renderLideresIntlGuardrail() {
    if (!lideresIntlGuardrail || !showPrimaryLideres) return null;
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
        <b title={lideresIntlGuardrail.detail}>{lideresIntlGuardrail.detail}</b>
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
  const scanStatusVisible = showPrimaryScanStatus;

  function renderDataStateOverflowActions(item) {
    if (!item?.id) return null;
    if (item.id === "markets-misalignment" || item.id === "markets-error") {
      if (marketsMisalignment?.showCta === false) return null;
      return (
        <>
          <button
            type="button"
            className="btn btnSmall btnPrimary"
            onClick={() => loadScanForMarketSelection(markets, "Cargando datos de la selección…")}
            disabled={restoringScan}
          >
            {restoringScan ? "Cargando…" : (marketsMisalignment?.ctaLabel || "Cargar datos de la selección")}
          </button>
          {marketsMisalignment?.stayCtaLabel
            && Array.isArray(scannedMarkets)
            && scannedMarkets.length
            && marketsMisalignment.tone !== "loading"
            ? (
              <button
                type="button"
                className="btn btnSmall"
                onClick={() => setMarketsAndInvalidate(
                  [...scannedMarkets],
                  `Selección alineada a la mesa (${marketsMisalignment.stayCtaLabel}).`,
                )}
                disabled={restoringScan}
              >
                {marketsMisalignment.stayCtaLabel}
              </button>
            )
            : null}
        </>
      );
    }
    if (item.id === "scan-stale-coverage" || item.id === "snapshot-warn" || item.id === "snapshot-info") {
      if (item.id.startsWith("snapshot") && isFilterLayersUpgradeNotice) {
        return renderFilterLayersUpgradeDismiss();
      }
      if (item.id.startsWith("snapshot") && isSampleTruncationNotice) {
        return renderSampleTruncationNoticeActions();
      }
      if (item.id === "scan-stale-coverage" || item.id === "snapshot-warn") {
        return (
          <button
            type="button"
            className="btn btnSmall btnPrimary"
            onClick={refreshScreenerSnapshotData}
            disabled={restoringScan}
          >
            {restoringScan ? "Actualizando…" : "Traer datos frescos"}
          </button>
        );
      }
    }
    if (item.id === "lideres-intl" && lideresIntlGuardrail?.ctas?.length) {
      return (
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
    }
    if (item.id === "auth-reauth") {
      return (
        <button type="button" className="btn btnSmall btnPrimary" onClick={() => { void restartStatsEdgeSession(); }}>
          Vuelve a entrar
        </button>
      );
    }
    return null;
  }

  const dataStateOverflowActions = {};
  for (const item of bannerSlots.overflow) {
    const actions = renderDataStateOverflowActions(item);
    if (actions) dataStateOverflowActions[item.id] = actions;
  }
  const dataStateDrawer = (
    <ScreenerDataStateDrawer items={bannerSlots.overflow} childrenById={dataStateOverflowActions} />
  );

  // Móvil: la hoja de filtros (MobileSheet) cierra con Escape, toque en el
  // velo, arrastre o «Ver N valores». «Ajustar filtro» del estado vacío la abre.
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
    if (!isMobileViewport) return undefined;
    const open = () => setShowMobileFilters(true);
    window.addEventListener(OPEN_FILTER_POPOVER_EVENT, open);
    return () => window.removeEventListener(OPEN_FILTER_POPOVER_EVENT, open);
  }, [isMobileViewport, setShowMobileFilters]);

  // El buscador móvil se despliega bajo la cabecera y recibe el foco.
  useEffect(() => {
    if (mobileSearchOpen) searchInputRef.current?.focus();
  }, [mobileSearchOpen]);

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

  // Familias del filtro, lo que aplica la ficha y lo que recorta: los MISMOS
  // nodos en el popover «+ Filtro» de escritorio y en la hoja móvil.
  const familiesPanel = (
    <FilterArchitecturePanel
      filterLayers={filterLayers}
      useRegimeFilter={useRegimeFilter}
      onToggleLayer={toggleFilterLayer}
      onOpenLayer={setActiveFilterFamily}
      onToggleRegime={() => setUseRegimeFilter((prev) => !prev)}
      regimeNote={regimeFilterNote(marketHealth, useRegimeFilter)}
      sheetFamilyKeys={sheetFamilyKeys}
      cardLabel={huntLabel}
      settings={settings}
      fieldRules={fieldRules}
      familyIntensity={familyIntensity}
      familyIntensityCustom={familyIntensityCustom}
      familyCoverage={familyCoverage}
      familyImpact={familyImpact}
      onFamilyIntensityChange={previewFamilyIntensity}
      onFamilyIntensityCommit={commitFamilyIntensity}
    />
  );
  const huntModeStrip = (
    <HuntCardModeStrip
      presetKey={presetKey}
      markets={markets}
      passedRows={resultsRows}
      activeSettings={activeSettings}
      onOpenFamily={setActiveFilterFamily}
    />
  );
  const filterBreakdownDetails = (
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
  );
  const viewSelectProps = {
    optionLabel,
    decisionResolutionFilter,
    decisionResolutionOptions,
    onDecisionResolutionFilter: setDecisionResolutionFilter,
    viewLayers,
    countryFilter,
    countryOptions,
    countryCounts,
    onCountryFilter: setCountryFilter,
    themeFilter,
    themeOptions,
    themeCounts,
    onThemeFilter: setThemeFilter,
    onSectorFilter: setSectorFilter,
    onIndustryFilter: setIndustryFilter,
    sectorFilter,
    sectorOptions,
    sectorCounts,
    industryFilter,
    industryOptions,
    industryCounts,
    sectorStrength,
    sectorStrengthCounts,
    onSectorStrength: setSectorStrength,
  };

  // Rediseño 2026-11 (paso 5): barra de filtros sobre la tabla. En la fila solo
  // las fichas del filtro vivo y «+ Filtro»; lo que aplica la ficha, lo que
  // recorta, Resolución/capas de vista y las familias van dentro del popover.
  const desktopFilterBar = isMobileViewport ? null : (
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
      chips={resultFilterChips}
      hiddenCount={hiddenByView}
      visibleCount={huntResultsFiltered.length}
      totalCount={huntResultsRows.length}
      onClearAll={clearResultView}
      onReview={huntResultsFiltered.length ? openResultViewReview : undefined}
      families={familiesPanel}
    >
      {huntModeStrip}
      {filterBreakdownDetails}
    </ResultFilterBar>
  );

  const hasSearchState = Boolean(searchSymbol || searchCandidates.length || searchResult);
  const showSearchDropdown = Boolean(
    searchResult || searchError || searchCandidates.length || searchScopeItems?.length,
  );
  const showTicketActions = !isMobileViewport && !showMesaEmptyCard;
  // Paso 6: en escritorio, con la mesa pintada, el aviso de datos (no el de
  // sesión caducada) comparte banda con la barra de filtros: una línea menos.
  const inlineSnapshotNotice = !isMobileViewport
    && showPrimarySnapshot
    && !snapshotNotice?.requiresReauth
    && !showMesaEmptyCard;
  const snapshotNoticeInline = inlineSnapshotNotice ? (
    <div className={`snapshotFreshnessNotice ${snapshotNotice.tone || "info"} snapshotFreshnessNotice--inline`} role="status" aria-live="polite">
      <span>{snapshotNotice.label}</span>
      <b title={snapshotNotice.detail}>{snapshotNotice.detail}</b>
      {renderSnapshotNoticeActions()}
    </div>
  ) : null;
  const queueChip = huntQueue ? (
    <span className="resultQueueChip" title={`Cola «${huntQueue.label}»: no aplica el filtro de la ficha`}>
      Cola: {huntQueue.label}
      <button type="button" onClick={clearHuntQueue} aria-label={`Cerrar la cola ${huntQueue.label}`} title="Volver a la ficha">×</button>
    </span>
  ) : null;

  const searchBlock = (
  <div className="screenerTicketSearch searchPopoverHost">
    <form className="screenerTicketSearchForm" onSubmit={runSearch} role="search" aria-busy={searchLoading ? "true" : "false"}>
      <div className="searchFieldWrap">
        <input
          ref={searchInputRef}
          className="input searchInput"
          value={searchSymbol}
          onChange={(e) => updateSearchSymbol(e.target.value)}
          placeholder="Ticker, nombre o sector"
          aria-label="Buscar valor"
        />
        {hasSearchState ? (
          <button type="button" className="searchClearBtn" onClick={clearSearch} aria-label="Limpiar búsqueda">✕</button>
        ) : null}
      </div>
    </form>
    {showSearchDropdown ? (
      <div className="screenerTicketSearchResults">
        {searchResult ? <div className="searchResult searchResultPrimary">
          <PreviewCard row={searchResult} variant="search" onFavorite={addFavorite} onOpenStock={saveSessionBeforeStockOpen} isFavorite={favoriteSymbols.has(searchResult.symbol)} decisionResolutions={screenerDecisionResolutions} />
        </div> : null}
        <SearchScopeList items={searchScopeItems} onPick={applySearchScope} />
        {searchError && <div className="dataNote error">{investorStatusLabel(searchError)}</div>}
        <SearchCandidateList candidates={searchCandidates} activeSymbol={searchResult?.symbol} onPick={(item) => { setSearchSymbol(item.symbol); loadSearchResult(item.symbol, item); }} />
      </div>
    ) : null}
  </div>
  );

  // ── Móvil (estudio 2026-11) ───────────────────────────────────────────
  // Verdad corta: «937 de 3.287 · precios 15 oct · RS 27 sept». Las dos fechas
  // son dos datos distintos (barras y ranking semanal). Con la cola cargando o
  // sin universo evaluable, la verdad completa de siempre.
  const mobileCountsKnown = !truthLineLoading && !truthQuietProgress && truthAnalyzedRows.length > 0;
  const mobileCountsText = huntQueue
    ? buildQueueTruthLine({ queue: huntQueue, passCount: passCountForTruth, visibleCount: visibleCountForTruth })
    : (mobileCountsKnown
      ? `${num(visibleCountForTruth, 0)} de ${num(analyzedCountForDisplay(truthAnalyzedRows), 0)}`
      : truthLine);
  const mobilePriceDay = mobileShortDay(mobileFreshness.priceDate);
  const mobileRsDay = mobileShortDay(mobileFreshness.rsDate);
  const mobileFreshText = [mobilePriceDay ? `precios ${mobilePriceDay}` : "", mobileRsDay ? `RS ${mobileRsDay}` : ""]
    .filter(Boolean).join(" · ");
  // El aviso de precios atrasados (lib/dataAge.js) se lee en la propia fecha de
  // la cabecera: subrayado punteado y un toque para el detalle. Sin otra franja.
  const mobileDataAgeFolded = Boolean(
    isMobileViewport
    && showPrimarySnapshot
    && snapshotNotice?.source === "data-age"
    && !scanStatusVisible,
  );
  const mobileModeDisclosure = isMobileViewport && !huntQueue
    ? huntCardModeDisclosure({ presetKey, markets, activeSettings })
    : null;
  const mobileFilterSummary = isMobileViewport ? [
    huntQueue ? `Cola «${huntQueue.label}»` : "",
    ...(mobileModeDisclosure?.doors || []).map((door) => door.label),
    ...(resultFilterChips || []).map((chip) => chip.label),
  ].filter(Boolean).join(" · ") : "";
  const mobileFilterCount = filterActiveCount + (Number(viewFiltersActive) || 0);
  const mobilePeekRow = mobilePeekIndex >= 0 ? huntResultsFiltered[mobilePeekIndex] : null;

  function closeMobilePeek() {
    const index = mobilePeekIndex;
    setMobilePeekIndex(-1);
    // De vuelta en la lista, la fila que se leía queda a la vista.
    requestAnimationFrame(() => {
      document.querySelector(`.mobileTapeRow[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
    });
  }

  const mobileHead = (
    <div className="mobileStickyHead">
      <header className="mobileHead">
        <div className="mobileHeadTitle">
          <h1 className="title">{huntLabel}</h1>
          <p className="screenerTruthLine mobileHeadSub" role="status" aria-live="polite" title={truthLineFull}>
            <span>{mobileCountsText}</span>
            {mobileFreshText ? <>
              {" · "}
              {mobileDataAgeFolded ? (
                <button
                  type="button"
                  className="mobileFresh isStale"
                  aria-expanded={mobileFreshOpen}
                  onClick={() => setMobileFreshOpen((value) => !value)}
                  title={snapshotNotice.detail}
                >
                  {mobileFreshText}
                </button>
              ) : <span className="mobileFresh">{mobileFreshText}</span>}
            </> : null}
          </p>
        </div>
        <button
          type="button"
          className="mobileIconBtn"
          aria-label="Buscar valor"
          aria-expanded={mobileSearchOpen}
          onClick={() => setMobileSearchOpen((value) => !value)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
        </button>
        <details ref={mobileMoreMenuRef} className="mobileResultsMoreMenu">
          <summary className="mobileIconBtn" aria-label="Más herramientas" title="Más herramientas">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></svg>
          </summary>
          <div className="mobileResultsMoreMenuPanel">
            {sessionPlumbing}
            <div className="mobileResultsMoreMenuLaboratory">{laboratoryPanel}</div>
            <button type="button" onClick={refreshScreenerSnapshotData} disabled={restoringScan}>{restoringScan ? "Actualizando…" : "Traer datos frescos"}</button>
            <button type="button" onClick={resetScreenerSession} disabled={restoringScan}>Resetear criterios</button>
            {huntResultsFiltered.length ? <>
              <button type="button" onClick={() => csv(huntResultsFiltered)}>CSV</button>
              <button type="button" onClick={() => saveSnapshot(huntResultsFiltered)} disabled={!huntResultsFiltered.length} aria-label="Guardar snapshot de resultados">Guardar</button>
              <button type="button" onClick={() => decisionAuditJson(huntResultsFiltered)} title="Exportar JSON compatible con audit:decisions">JSON audit</button>
              <button type="button" onClick={openPrimaryReview}>Review · cola completa</button>
            </> : null}
          </div>
        </details>
      </header>
      {mobileSearchOpen ? <div className="mobileSearchRow">{searchBlock}</div> : null}
      <HuntCardRail
        layout="tabs"
        presetKey={presetKey}
        markets={markets}
        onSelect={applyHuntCard}
        pending={isHuntTransitionPending}
        cardCounts={huntCardCounts}
        activeCount={huntQueue || selectedFilterTemplateId ? null : passCountForTruth}
        activeQueueId={huntQueue?.id || ""}
        weeklyViews={weeklyViews}
        weeklySinceLabel={weeklySinceLabel}
        weeklyHeading={weeklyHeading}
        favoritesView={favoritesQueueView(favoriteSymbols)}
        onSelectQueue={applyHuntQueue}
        savedTemplates={savedFilterTemplates}
        selectedTemplateId={selectedFilterTemplateId}
        onApplyTemplate={applySavedFilterTemplate}
      />
      <div className="mobileFilterBar">
        <button
          type="button"
          className="mobileFilterBtn"
          aria-haspopup="dialog"
          aria-expanded={showMobileFilters}
          aria-label={`Filtros${mobileFilterCount ? ` (${mobileFilterCount} activos)` : ""}`}
          onClick={() => setShowMobileFilters(true)}
        >
          Filtros{mobileFilterCount ? <b>{mobileFilterCount}</b> : null}
        </button>
        <button type="button" className="mobileFilterChips" onClick={() => setShowMobileFilters(true)} tabIndex={-1} aria-hidden="true">
          {mobileFilterSummary || "Sin filtros"}
        </button>
        {huntResultsFiltered.length ? (
          <MobileSortSelect
            sort={sort}
            onSort={setSort}
            perfPeriod={perfPeriod}
            setupMode={activeSettings?.setupMode}
            scannedMarkets={scannedMarkets}
            presetKey={presetKey}
          />
        ) : null}
      </div>
      {mobileDataAgeFolded && mobileFreshOpen ? (
        <p className="mobileDataLine" role="status">
          <span>Datos</span>
          {snapshotNotice.detail}
        </p>
      ) : null}
    </div>
  );
  return <main className={`page screenerTerminalPage${isMobileViewport ? " screenerTerminalPage--mobile" : ""}`}>
    {/* Estudio móvil 2026-11 (pasos 7-8): cabecera de 52 px (vista + verdad
        corta con las dos fechas), pestañas de vistas y barra del filtro vivo,
        pegadas arriba; la cinta empieza debajo. */}
    {isMobileViewport ? mobileHead : null}
    {!isMobileViewport ? <>
    <div className="screenerTicket">
      <h1 className="title">{huntLabel}</h1>
      <MarketScopeChip
        className="screenerTicketScope"
        markets={markets}
        marketsStale={marketsStale}
        isMarketPresetActive={isMarketPresetActive}
        marketPreset={marketPreset}
        setMarketsAndInvalidate={setMarketsAndInvalidate}
      />
      <p className="screenerTruthLine" role="status" aria-live="polite" title={truthLineFull}>{truthLine}</p>
      {/* Autocontenido, como GlobalCoveragePanel: posee su fetch a
          GET /api/weekly-changes y no bloquea la primera pintura. Es la
          segunda excepción a la nota de cabecera de este archivo.
          T9: defer en cold restore para no sumar «comprobando…» al pasillo.
          Paso 4: solo un enlace «Cambios de la semana» que abre el panel. */}
      <WeeklyChangesLine
        onOpenStock={saveSessionBeforeStockOpen}
        defer={coldProgress.deferWeekly}
        weekly={weekly}
        compact
        panelOnly
      />
      {searchBlock}
      {showTicketActions && huntResultsFiltered.length ? (
        <button type="button" className="btn btnSmall btnPrimary" onClick={openPrimaryReview}>Revisar</button>
      ) : null}
      {/* Siempre visible, incluso con la tabla vacía. Sin botón
          Ejecutar, este es el único camino de vuelta a un estado bueno;
          esconderlo justo cuando no hay resultados —que es cuando hace
          falta— dejaba la sesión sin salida. */}
      {showTicketActions ? (
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
      ) : null}
    </div>
    </> : null}
    {showPrimaryErr && <div className="error">{err}</div>}
    {isMobileViewport && (scanStatusVisible || (showPrimarySnapshot && !mobileDataAgeFolded)) ? <div className="screenerMobileNoticeStack">
      <MobileStatusFold
        err={Boolean(err)}
        statusLabel={statusLabel}
        mobileStatusLabel={mobileStatusLabel}
        scanStatusVisible={scanStatusVisible}
        snapshotNotice={snapshotNotice}
        showSnapshotNotice={showPrimarySnapshot}
      >
        {renderSnapshotNoticeActions()}
      </MobileStatusFold>
    </div> : null}
    {!isMobileViewport && scanStatusVisible ? <div className={`scanStatusBar ${err ? "error" : "running"}`} role="status" aria-live="polite">
      <span>{err ? "Incidencia" : "Estado"}</span>
      <b>{statusLabel}</b>
    </div> : null}
    {!isMobileViewport && showPrimarySnapshot && !inlineSnapshotNotice ? <div className={`snapshotFreshnessNotice ${snapshotNotice.requiresReauth ? "compact warn" : snapshotNotice.tone || "info"}`} role="alert" aria-live="polite">
      <span>{snapshotNotice.label}</span>
      <b title={snapshotNotice.detail}>{snapshotNotice.detail}</b>
      {snapshotNotice.requiresReauth ? (
        <div className="storageAlertActions">
          <button type="button" className="btn btnSmall btnPrimary" onClick={() => { void restartStatsEdgeSession(); }}>
            Vuelve a entrar
          </button>
        </div>
      ) : renderSnapshotNoticeActions()}
    </div> : null}
    {isMobileViewport && showPrimarySnapshot && snapshotNotice.requiresReauth ? <div className="snapshotFreshnessNotice compact warn" role="alert" aria-live="polite">
      <span>{snapshotNotice.label}</span>
      <b>{snapshotNotice.detail}</b>
      <div className="storageAlertActions">
        <button type="button" className="btn btnSmall btnPrimary" onClick={() => { void restartStatsEdgeSession(); }}>
          Vuelve a entrar
        </button>
      </div>
    </div> : null}

    <div className={`dashboardContainer${showMesaEmptyCard ? " dashboardContainer--mesaEmpty" : ""}`}>
      {/* Paso 5: en escritorio el aside queda vacío (mercados en el ticket,
          familias en «+ Filtro»), así que solo se monta como cajón móvil.
          Paso 6: en su lugar va el raíl de vistas (var(--rail-w)). */}
      {isMobileViewport ? (
        <MobileFilterSheet
          open={showMobileFilters}
          onClose={() => setShowMobileFilters(false)}
          title={huntLabel}
          markets={markets}
          isMarketPresetActive={isMarketPresetActive}
          marketPreset={marketPreset}
          setMarketsAndInvalidate={setMarketsAndInvalidate}
          hasActiveMarketPreset={MARKET_PRESET_CHIP_OPTIONS.some(([key]) => isMarketPresetActive(key))}
          modeStrip={huntQueue ? null : huntModeStrip}
          families={familiesPanel}
          breakdown={filterBreakdownDetails}
          analyzedCount={analyzedCountForDisplay(truthAnalyzedRows)}
          passCount={passCountForTruth}
          visibleCount={visibleCountForTruth}
          viewSelects={viewSelectProps}
          decisionResolutionFilter={decisionResolutionFilter}
          decisionResolutionOptions={decisionResolutionOptions}
          onDecisionResolutionFilter={setDecisionResolutionFilter}
          perfPeriod={perfPeriod}
          onPerfPeriod={setPerfPeriod}
          onReset={clearResultView}
          resetDisabled={!(Number(viewFiltersActive) > 0)}
        />
      ) : (
        <HuntCardRail
          presetKey={presetKey}
          markets={markets}
          onSelect={applyHuntCard}
          pending={isHuntTransitionPending}
          cardCounts={huntCardCounts}
          activeCount={huntQueue || selectedFilterTemplateId ? null : passCountForTruth}
          activeQueueId={huntQueue?.id || ""}
          weeklyViews={weeklyViews}
          weeklySinceLabel={weeklySinceLabel}
          weeklyHeading={weeklyHeading}
          onOpenWeeklyDetail={() => weekly.openPanel()}
          favoritesView={favoritesQueueView(favoriteSymbols)}
          onSelectQueue={applyHuntQueue}
          savedTemplates={savedFilterTemplates}
          selectedTemplateId={selectedFilterTemplateId}
          onApplyTemplate={applySavedFilterTemplate}
          onSaveView={() => saveCurrentFilterTemplate()}
        />
      )}

      <main className="mainContent">
        {renderLideresIntlGuardrail()}
        {renderCuratedPopulationNotice()}

        {isMobileViewport ? <section className="mobileResearchHome">
          {renderMarketsMisalignmentNotice()}
          {showPrimaryScanStale ? renderScanStaleNotice() : null}
          {dataStateDrawer}
          {showMesaEmptyCard ? (
            <MesaEmptyCard
              markets={markets}
              snapshotNotice={snapshotNotice}
              err={err}
              onRetry={refreshScreenerSnapshotData}
              onFocusSearch={focusSearchInput}
              retrying={restoringScan}
            />
          ) : (
            <MobileResultList
              rows={huntResultsFiltered}
              chartPreviewDeferred={chartPreviewDeferred}
              favoriteSymbols={resultsFavoriteSymbols}
              decisionResolutions={resultsDecisionResolutions}
              activeIndex={mobilePeekIndex}
              onOpenRow={setMobilePeekIndex}
              emptyLabel={huntEmptyState.cause}
              emptyAction={huntEmptyAction}
            />
          )}
          <MobilePeekSheet
            rows={huntResultsFiltered}
            index={mobilePeekRow ? mobilePeekIndex : -1}
            onClose={closeMobilePeek}
            onStep={(delta) => setMobilePeekIndex((current) => Math.max(0, Math.min(huntResultsFiltered.length - 1, current + delta)))}
            isFavorite={Boolean(mobilePeekRow && resultsFavoriteSymbols?.has?.(mobilePeekRow.symbol))}
            resolutionKey={mobilePeekRow && resultsDecisionResolutions
              ? decisionResolutionKeyForSymbol({ decisionResolutions: resultsDecisionResolutions }, mobilePeekRow.symbol)
              : ""}
            chartPreviewDeferred={chartPreviewDeferred}
            onFavorite={addFavorite}
            onResolveDecision={resolveScreenerDecision}
            onOpenStock={saveSessionBeforeStockOpen}
          />
        </section> : null}

        {!isMobileViewport ? <section className={`desktopResultsSection${showMesaEmptyCard ? " desktopResultsSection--mesaEmpty" : ""}`} style={{ marginBottom: 20 }}>
          {renderMarketsMisalignmentNotice()}
          {showPrimaryScanStale ? (
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
          {dataStateDrawer}
          {showMesaEmptyCard ? (
            <MesaEmptyCard
              markets={markets}
              snapshotNotice={snapshotNotice}
              err={err}
              onRetry={refreshScreenerSnapshotData}
              onFocusSearch={focusSearchInput}
              retrying={restoringScan}
            />
          ) : (
            <>
          <IpoCohortWindowChips
            presetKey={presetKey}
            cardId={activeHuntCard?.id}
            analyzedRows={analyzedRows}
            activeSettings={activeSettings}
            onSelectWindow={(months) => updateSetting("maxIpoAgeMonths", months)}
          />

          <ResultPagerTable
            visibleCount={huntResultsFiltered.length}
            presetKey={presetKey}
            filteredRows={huntResultsFiltered}
            chartPreviewDeferred={chartPreviewDeferred}
            resultPageStart={resultPageStart}
            resultPageEnd={resultPageEnd}
            resultPageSize={resultPageSize}
            onPageSizeChange={updateResultPageSize}
            visibleResultPage={visibleResultPage}
            totalResultPages={totalResultPages}
            onSetResultPage={setResultPageClamped}
            pagedRows={huntResultsPagedRows}
            favoriteSymbols={resultsFavoriteSymbols}
            decisionResolutions={resultsDecisionResolutions}
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
            emptyLabel={huntEmptyState.cause}
            emptyAction={huntEmptyAction}
            peekInclusion={huntPeekInclusionLabel}
            onResolveDecision={resolveScreenerDecision}
            filterSlot={<>{queueChip}{desktopFilterBar}</>}
            noticeSlot={snapshotNoticeInline}
          />
            </>
          )}
        </section> : null}
      </main>
    </div>
    <footer className="footer" style={{ marginTop: 40, borderTop: "1px solid rgba(255,255,255,.04)", paddingTop: 16, fontSize: 11, opacity: 0.5 }}>StatsEdge · Datos orientativos · {investorStatusLabel(status)}</footer>
  </main>;
}
