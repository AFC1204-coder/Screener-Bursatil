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
import GlobalCoveragePanel from "@/app/components/screener/GlobalCoveragePanel";
import ResultFilterBar from "@/app/components/screener/ResultFilterBar";
import ResultPagerTable from "@/app/components/screener/ResultPagerTable";
import HuntCardRail from "@/app/components/screener/HuntCardRail";
import HuntCardModeStrip from "@/app/components/screener/HuntCardModeStrip";
import WeeklyChangesLine from "@/app/components/screener/WeeklyChangesLine";
import {
  FilterArchitecturePanel,
  FilterDiagnosticsPanel,
  FilterNumber,
  FilterTemplatePanel,
  FilterToggle,
  MarketMiniTape,
  MobileResultList,
  PreviewCard,
  SearchCandidateList,
  SearchScopeList,
} from "@/app/screenerPanels";
import { investorStatusLabel } from "@/lib/screenerFormat";
import { huntDisplayName } from "@/lib/screenerHuntCards";
import { OptionalBasePresetsPanel } from "@/lib/screenerFiltersView";
import { isMarketSelectable, MARKETS_MISALIGNMENT_EMPTY_LABEL, marketUnavailabilityReason, resolveMarketsMisalignmentNotice } from "@/lib/marketAvailability";
import { buildLideresIntlGuardrailNotice, LIDERES_INTL_CTA } from "@/lib/lideresIntlGuardrail";
import { buildScreenerFilterBreakdown } from "@/lib/screenerFilterBreakdown";
import { buildScreenerTruthLine, marketCountLabel, resolveScreenerTruthCounts } from "@/lib/screenerTruthLine";
import { recordTruthLinePaint } from "@/lib/screenerHuntPerf";
import {
  ALL_FILTER_LAYERS,
  DEFAULT_FIELD_RULES,
  FILTER_GROUPS,
  filterLayersForPreset,
  settingsForPreset,
} from "@/lib/screenerFilterCatalog";
import {
  MARKET_ORDER,
  MARKETS,
  RESULT_PAGE_SIZES,
  SECTOR_STRENGTH_LABELS,
  SECTOR_STRENGTH_OPTIONS,
  marketExchange,
  marketName,
} from "@/lib/screenerConfig";
import { marketFlag } from "@/lib/symbols";
import { metricShortLabel } from "@/lib/metricCatalog";
import { rankActionLabel } from "@/lib/screenerExplainability";
import { decisionConfidenceLabel } from "@/lib/decisionAudit";
import { useScreenerMobileViewport } from "@/lib/useScreenerMobileViewport";

const PERCENTILE_BATCH_BADGE = "Ranking provisional";
const PERCENTILE_BATCH_NOTE = "Estas filas se conservan, pero sus percentiles se calcularon sobre un lote menor y pueden cambiar al finalizar el universo. En empates, las filas con percentil final aparecen primero.";
const MARKET_REGION_PRESETS = ["global", "us", "us-core-intl", "core-intl", "europe", "asia", "hk"];

function showScanStatusBar(err, status = "") {
  if (err) return true;
  const text = String(status || "").trim();
  return /^(Cargando|Actualizando|Sincronizando|Descargando|Guardando|Importando|Subiendo)/i.test(text);
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
    advancedOpen,
    persistAdvancedOpen,
    advancedChangeCount,
    filterLayers,
    viewLayers,
    useRegimeFilter,
    setUseRegimeFilter,
    toggleFilterLayer,
    setActiveFilterFamily,
    toggleViewLayer,
    executionRuleActive,
    executionRuleTotal,
    viewFiltersActive,
    setFilterLayers,
    settings,
    updateSetting,
    settingApplies,
    inactiveSettingReason,
    toggleLayeredSetting,
    fieldRules,
    isFieldRuleActive,
    inactiveFieldReason,
    toggleFieldRule,
    fineRuleActive,
    fineRuleTotal,
    setSettings,
    setFieldRules,
    diagnostics,
    markAdvancedBaseline,
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
  const huntLabel = huntDisplayName(presetKey, markets);
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
  const huntResultsRows = resultsBlockedByMarketMisalignment ? [] : resultsRows;
  const huntResultsFiltered = resultsBlockedByMarketMisalignment ? [] : resultsFiltered;
  const huntResultsPagedRows = resultsBlockedByMarketMisalignment ? [] : resultsPagedRows;
  const huntResultsEmptyLabel = resultsBlockedByMarketMisalignment
    ? MARKETS_MISALIGNMENT_EMPTY_LABEL
    : resultsEmptyLabel;
  const { passCount: passCountForTruth, visibleCount: visibleCountForTruth } = resolveScreenerTruthCounts({
    eagerPassCount: huntResultsRows.length,
    filteredVisibleCount: huntResultsFiltered.length,
    huntTruthOverride,
    isHuntTransitionPending,
    rowsDeferredStale,
    viewFiltersActive,
  });
  const truthLine = buildScreenerTruthLine({
    analyzedRows: resultsBlockedByMarketMisalignment ? [] : analyzedRows,
    passCount: passCountForTruth,
    visibleCount: visibleCountForTruth,
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
  const selectableMarketCount = MARKETS.filter(([code]) => isMarketSelectable(code)).length;
  const hasActiveMarketPreset = MARKET_REGION_PRESETS.some((key) => isMarketPresetActive(key));
  const marketCustomizeLabel = `Personalizar mercados (${markets.length}/${selectableMarketCount})${hasActiveMarketPreset ? "" : " · personalizado"}`;
  const lideresIntlGuardrail = buildLideresIntlGuardrailNotice({
    presetKey,
    markets,
    scannedMarkets,
    analyzedRows,
  });
  const showSnapshotNotice = snapshotNotice && snapshotNotice.source !== "markets-stale";

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
    const toneClass = marketsMisalignment.tone === "loading"
      ? " scanStaleNotice--loading"
      : marketsMisalignment.tone === "error"
        ? " scanStaleNotice--error"
        : "";
    return (
      <div className={`scanStaleNotice${toneClass}`} role="status" aria-live="polite">
        <span className="scanStaleNoticeLabel">{marketsMisalignment.label}</span>
        <b>{marketsMisalignment.detail}</b>
        {marketsMisalignment.showCta !== false ? (
          <button
            type="button"
            className="btn btnSmall btnPrimary"
            onClick={() => loadScanForMarketSelection(markets, "Cargando datos de la selección…")}
            disabled={restoringScan}
          >
            {restoringScan ? "Cargando…" : marketsMisalignment.ctaLabel}
          </button>
        ) : null}
      </div>
    );
  }

  // --- franja P3 (percentil por lote) ---
  // Comunicamos honestamente los percentiles batch de la lista visible; si el
  // conjunto es "final", no hay nada que decir.
  const visibleBatchRows = huntResultsRows.some((row) => (row.percentileScope || "batch") === "batch");
  const statusLabel = investorStatusLabel(status);
  const scanStatusVisible = showScanStatusBar(err, status);

  // Cierre del panel de filtros en móvil: Escape en cualquier punto de la
  // página y click/tap fuera del panel (mobileFiltersRef). El botón "Filtros"
  // de la topbar y el propio botón de cierre siguen cerrando via su onClick
  // normal; esto cubre los dos casos que no tenían manejador.
  const isMobileViewport = useScreenerMobileViewport();
  const mobileFiltersRef = useRef(null);
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
    {scanStatusVisible ? <div className={`scanStatusBar ${err ? "error" : "running"}`} role="status" aria-live="polite">
      <span>{err ? "Incidencia" : "Estado"}</span>
      <b>{statusLabel}</b>
    </div> : null}
    {showSnapshotNotice ? <div className={`snapshotFreshnessNotice ${snapshotNotice.requiresReauth ? "compact warn" : snapshotNotice.tone || "info"}`} role="alert" aria-live="polite">
      <span>{snapshotNotice.label}</span>
      <b>{snapshotNotice.detail}</b>
      {snapshotNotice.requiresReauth ? (
        <div className="storageAlertActions">
          <button type="button" className="btn btnSmall btnPrimary" onClick={() => { void restartStatsEdgeSession(); }}>
            Vuelve a entrar
          </button>
        </div>
      ) : null}
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
      <aside ref={mobileFiltersRef} className={`sidebar ${showMobileFilters ? "mobileOpen" : ""}`}>
        <div className="mobileSidebarHeader">
          <h2>Filtros</h2>
          <div className="mobileSidebarHeaderActions">
            {/* Los filtros se aplican solos al cambiarlos; cerrar es la única acción. */}
            <button type="button" className="btn btnPrimary" onClick={() => setShowMobileFilters(false)}>Listo</button>
            <button type="button" className="mobileSidebarCloseBtn" onClick={() => setShowMobileFilters(false)} aria-label="Cerrar filtros" title="Cerrar filtros">✕</button>
          </div>
        </div>
        <FilterTemplatePanel
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

        <div className="sidebarGroup marketPanel" style={{ marginBottom: 24 }}>
          <div className="marketPanelHead">
            <span>Mercados{marketsStale ? <i className="controlDot controlDotStale" aria-hidden="true" title="Mercados cambiados desde el último corte de datos" /> : null}</span>
            <em>{markets.length}/{MARKETS.length}</em>
          </div>
          <div className="marketPresetBar">
            {[
              ["global", "Global"],
              ["us", "EE. UU."],
              ["us-core-intl", "US+Core"],
              ["core-intl", "Core intl"],
              ["europe", "Europa"],
              ["asia", "Asia"],
              ["hk", "HK"],
            ].map(([key, label]) => <button key={key} className={`btn btnGhost btnSmall ${isMarketPresetActive(key) ? "btnActive" : ""}`} onClick={() => marketPreset(key)}>{label}</button>)}
          </div>
          <details className="marketCustomizeDisclosure">
            <summary><span>{marketCustomizeLabel}</span></summary>
            <div className="marketSelector marketGrid">
            {MARKETS.map(([c, n]) => {
              const active = markets.includes(c);
              const selectable = isMarketSelectable(c);
              const disabledReason = selectable ? null : marketUnavailabilityReason(c);
              return <button
                key={c}
                type="button"
                className={`marketChip countryMarketChip ${active ? "active" : ""} ${selectable ? "" : "isDisabled"}`}
                title={disabledReason || `${n} · ${marketExchange(c)}`}
                aria-pressed={active}
                aria-disabled={selectable ? undefined : true}
                disabled={!selectable}
                onClick={() => {
                  if (!selectable) return;
                  const selectedMarkets = active ? markets.filter((x) => x !== c) : [...markets, c];
                  const nextMarkets = MARKET_ORDER.filter((code) => selectedMarkets.includes(code));
                  setMarketsAndInvalidate(nextMarkets, `Mercados actualizados: ${nextMarkets.length}`);
                }}
              >
                <span className="marketChipFlag">{marketFlag(c)}</span>
                <span className="marketChipCode">{c}</span>
              </button>;
            })}
            </div>
          </details>
        </div>

        {/* Configuración avanzada: agrupa capas, umbrales, reglas de campo, alcance de
            lote y diagnóstico. Cerrada por defecto; el colapso persiste en localStorage. */}
        <details className="disclosurePanel advancedConfigPanel" open={advancedOpen} onToggle={(event) => persistAdvancedOpen(event.currentTarget.open)}>
          <summary>
            <span>Configuración avanzada</span>
            <em>{advancedChangeCount > 0 ? `Avanzado · ${advancedChangeCount} ${advancedChangeCount === 1 ? "cambio" : "cambios"}` : "Sin cambios sobre el preset"}</em>
          </summary>

        <OptionalBasePresetsPanel presetKey={presetKey} onPreset={setPreset} />

        <FilterArchitecturePanel
          filterLayers={filterLayers}
          viewLayers={viewLayers}
          useRegimeFilter={useRegimeFilter}
          onToggleLayer={toggleFilterLayer}
          onOpenLayer={setActiveFilterFamily}
          onToggleViewLayer={toggleViewLayer}
          onToggleRegime={() => setUseRegimeFilter((prev) => !prev)}
          executionRuleActive={executionRuleActive}
          executionRuleTotal={executionRuleTotal}
          viewFiltersActive={viewFiltersActive}
          settings={settings}
          fieldRules={fieldRules}
          familyIntensity={familyIntensity}
          familyIntensityCustom={familyIntensityCustom}
          familyCoverage={familyCoverage}
          familyImpact={familyImpact}
          onFamilyIntensityChange={previewFamilyIntensity}
          onFamilyIntensityCommit={commitFamilyIntensity}
        />
        <div className="controls filterLayerActions">
          <button className="btn btnSmall btnGhost" onClick={() => {
            const nextLayers = filterLayersForPreset(presetKey);
            setFilterLayers(nextLayers);
            setUseRegimeFilter(true);
            markAdvancedBaseline?.(settings, nextLayers);
          }}>Base preset</button>
          <button className="btn btnSmall btnGhost" onClick={() => { setFilterLayers(ALL_FILTER_LAYERS); setUseRegimeFilter(true); }}>Todo activo</button>
        </div>

        <div className="sidebarGroup" style={{ marginBottom: 24 }}>
          <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>Condiciones</span>
          <div className={`weeklyStageControls ${filterLayers.trend ? "" : "isMuted"}`}>
            <label><span>Media rápida semanal</span><input className="input" type="number" min="2" max="80" step="1" value={settings.stageFastWeeks || 10} onChange={(event) => updateSetting("stageFastWeeks", Number(event.target.value) || 10)} /></label>
            <label><span>Media lenta semanal</span><input className="input" type="number" min="3" max="120" step="1" value={settings.stageSlowWeeks || 30} onChange={(event) => updateSetting("stageSlowWeeks", Number(event.target.value) || 30)} /></label>
            <label><span>Pendiente semanas</span><input className="input" type="number" min="2" max="40" step="1" value={settings.stageSlopeWeeks || 10} onChange={(event) => updateSetting("stageSlopeWeeks", Number(event.target.value) || 10)} /></label>
            <label><span>Media plana ±%</span><input className="input" type="number" min="0" max="20" step="0.5" value={settings.stageFlatPct ?? 2} onChange={(event) => updateSetting("stageFlatPct", Number(event.target.value))} /></label>
          </div>
          <div className="filterSwitches">
            <FilterToggle active={settings.requireStage2} applies={settingApplies("requireStage2", filterLayers)} detail={inactiveSettingReason("requireStage2", filterLayers)} hint="Mira solo la etapa MM30s; no distingue pre-fuga de avance con fuga." onClick={() => toggleLayeredSetting("requireStage2")}>Etapa 2</FilterToggle>
            <FilterToggle active={settings.requirePulso} applies={settingApplies("requirePulso", filterLayers)} detail={inactiveSettingReason("requirePulso", filterLayers)} onClick={() => toggleLayeredSetting("requirePulso")}>Pulso</FilterToggle>
            <FilterToggle active={settings.requireUpVolume} applies={settingApplies("requireUpVolume", filterLayers)} detail={inactiveSettingReason("requireUpVolume", filterLayers)} onClick={() => toggleLayeredSetting("requireUpVolume")}>Volumen en vela alcista</FilterToggle>
            <FilterToggle active={settings.requireRecentIpo} applies={settingApplies("requireRecentIpo", filterLayers)} detail={inactiveSettingReason("requireRecentIpo", filterLayers)} onClick={() => toggleLayeredSetting("requireRecentIpo")}>IPO real reciente</FilterToggle>
          </div>

          <details className="advancedFiltersDetails" style={{ marginTop: 12 }}>
            <summary style={{ cursor: 'pointer', color: '#a1a1aa', fontSize: 12, fontWeight: 500, display: 'inline-block', borderBottom: '1px dashed rgba(255,255,255,.2)', paddingBottom: 2 }}>Ajustes finos ({fineRuleActive}/{fineRuleTotal})</summary>
            <div className="filterGroups" style={{ marginTop: 16 }}>
              {FILTER_GROUPS.map((group) => {
                const activeInGroup = group.fields.filter((field) => isFieldRuleActive(field, fieldRules, filterLayers)).length;
                return <details className="filterGroup" key={group.title}>
                  <summary className="filterGroupHead"><h3>{group.title}</h3><span>{activeInGroup}/{group.fields.length}</span></summary>
                  <div className="filterFields">{group.fields.map((field) => <FilterNumber key={field.key} field={field} value={settings[field.key]} onChange={updateSetting} active={isFieldRuleActive(field, fieldRules, filterLayers)} inactiveReason={inactiveFieldReason(field, fieldRules, filterLayers)} onToggle={() => toggleFieldRule(field)} />)}</div>
                </details>;
              })}
            </div>
            <div className="controls filterFooter" style={{ marginTop: 12 }}>
              <button className="btn btnGhost btnSmall" style={{ width: "100%" }} onClick={() => {
                const nextSettings = settingsForPreset(presetKey);
                const nextLayers = filterLayersForPreset(presetKey);
                setSettings(nextSettings);
                setFieldRules(DEFAULT_FIELD_RULES);
                setFilterLayers(nextLayers);
                setUseRegimeFilter(true);
                markAdvancedBaseline?.(nextSettings, nextLayers);
              }}>Resetear condiciones</button>
            </div>
          </details>
        </div>

        <details className="scanDiagnosticsDisclosure">
          <summary>
            <span>Auditoría de filtros</span>
            <em>{diagnostics ? `${diagnostics.finalCount}/${diagnostics.analyzed} pasan` : "sin datos"}</em>
          </summary>
          <FilterDiagnosticsPanel diagnostics={diagnostics} rowsCount={resultsRows.length} filteredCount={resultsFiltered.length} />
        </details>
        </details>

        {/* Cobertura internacional por mercado (solo lectura). Carga asíncrona
            desde GET /api/coverage; no bloquea la primera pintura. Comunica que
            los lotes son trabajo interno del escáner, no el universo completo,
            y distingue inventario de elegibles para ranking. Sin acciones que
            ejecuten scan/backfill. */}
        <details className="disclosurePanel globalCoverageDisclosure">
          <summary>
            <span>Cobertura internacional por mercado</span>
            <em>informativo</em>
          </summary>
          <GlobalCoveragePanel />
        </details>
      </aside>

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
              persistAdvancedOpen(true);
              setShowMobileFilters(true);
              setActiveFilterFamily(familyKey);
            }}
          />
          {lideresIntlGuardrail ? (
            <div className="scanStaleNotice lideresIntlGuardrail" role="status" aria-live="polite">
              <span className="scanStaleNoticeLabel">{lideresIntlGuardrail.label}</span>
              <b>{lideresIntlGuardrail.detail}</b>
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
            </div>
          ) : null}
          <p className="screenerTruthLine" role="status" aria-live="polite">
            <span>{truthLine}</span>
            {visibleBatchRows ? <span className="percentileScopeBadge" title={PERCENTILE_BATCH_NOTE} aria-label={`${PERCENTILE_BATCH_BADGE}. ${PERCENTILE_BATCH_NOTE}`}>{PERCENTILE_BATCH_BADGE}</span> : null}
          </p>
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
                  onClick={() => {
                    persistAdvancedOpen(true);
                    setShowMobileFilters(true);
                  }}
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
          <MobileResultList
            rows={huntResultsPagedRows}
            settings={activeSettings}
            totalRows={huntResultsFiltered.length}
            sort={sort}
            onSort={setSort}
            perfPeriod={perfPeriod}
            setupMode={activeSettings.setupMode}
            onPerfPeriod={setPerfPeriod}
            onReview={(symbol) => openReview(huntResultsFiltered, symbol)}
            onFavorite={addFavorite}
            favoriteSymbols={resultsFavoriteSymbols}
            onSave={() => saveSnapshot(huntResultsFiltered)}
            onCsv={() => csv(huntResultsFiltered)}
            onAuditJson={() => decisionAuditJson(huntResultsFiltered)}
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
              {/* Siempre visible, incluso con la tabla vacía. Sin botón
                  Ejecutar, este es el único camino de vuelta a un estado bueno;
                  esconderlo justo cuando no hay resultados —que es cuando hace
                  falta— dejaba la sesión sin salida. */}
              <div className="resultsToolbarSecondary">
                <button
                  className="btn btnSmall btnGhost"
                  onClick={refreshScreenerSnapshotData}
                  disabled={restoringScan}
                  title="Trae el último escaneo nocturno sin cambiar tus filtros ni plantilla"
                >
                  {restoringScan ? "Actualizando…" : "Traer datos frescos"}
                </button>
                <button
                  className="btn btnSmall btnGhost"
                  onClick={resetScreenerSession}
                  disabled={restoringScan}
                  title="Borra criterios y vuelve al preset equilibrado con datos nuevos"
                >
                  Resetear criterios
                </button>
                {huntResultsFiltered.length ? <>
                  <button className="btn btnSmall btnGhost" onClick={() => csv(huntResultsFiltered)}>↓ CSV</button>
                  <button className="btn btnSmall btnGhost" onClick={() => saveSnapshot(huntResultsFiltered)} aria-label="Guardar copia de resultados">Guardar</button>
                </> : null}
              </div>
              {huntResultsFiltered.length ? <>
                <button className="btn btnSmall btnPrimary" onClick={openPrimaryReview}>Revisar</button>
                <details className="resultsMoreMenu">
                  <summary className="btn btnSmall btnGhost" aria-label="Más herramientas" title="Más herramientas">⋯</summary>
                  <div className="resultsMoreMenuPanel">
                    <button type="button" className="btn btnSmall btnGhost" onClick={() => decisionAuditJson(huntResultsFiltered)} title="Exportar JSON compatible con audit:decisions">JSON audit</button>
                  </div>
                </details>
              </> : null}
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
            emptyLabel={huntResultsEmptyLabel}
          />
        </section> : null}
      </main>
    </div>
    <footer className="footer" style={{ marginTop: 40, borderTop: "1px solid rgba(255,255,255,.04)", paddingTop: 16, fontSize: 11, opacity: 0.5 }}>StatsEdge · Datos orientativos · {investorStatusLabel(status)}</footer>
  </main>;
}
