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

import { useEffect, useRef } from "react";
import GlobalCoveragePanel from "@/app/components/screener/GlobalCoveragePanel";
import ResultFilterBar from "@/app/components/screener/ResultFilterBar";
import ResultPagerTable from "@/app/components/screener/ResultPagerTable";
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
  SetupChipRail,
} from "@/app/screenerPanels";
import { dateTime } from "@/lib/formatters";
import { analyzedCountForDisplay, investorStatusLabel } from "@/lib/screenerFormat";
import {
  ALL_FILTER_LAYERS,
  DEFAULT_FIELD_RULES,
  FILTER_GROUPS,
  SCREENER_FILTER_PRESETS as PRESETS,
  filterLayersForPreset,
  settingsForPreset,
} from "@/lib/screenerFilterCatalog";
import {
  MARKET_ORDER,
  MARKETS,
  RESULT_PAGE_SIZES,
  SECTOR_STRENGTH_LABELS,
  SECTOR_STRENGTH_OPTIONS,
  SORT_LABELS,
  marketExchange,
  marketName,
} from "@/lib/screenerConfig";
import { marketFlag } from "@/lib/symbols";
import { metricShortLabel } from "@/lib/metricCatalog";
import { rankActionLabel } from "@/lib/screenerExplainability";
import { decisionConfidenceLabel } from "@/lib/decisionAudit";

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
    showMobileFilters,
    sidebarCollapsed,
    setShowMobileFilters,
    setSidebarCollapsed,
    kpiUniverseCount,
    marketHealth,
    rows,
  } = chrome;

  // --- sidebar ---
  const {
    savedFilterTemplates,
    selectedFilterTemplateId,
    filterTemplateName,
    setPreset,
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
    saveSnapshot,
    csv,
    decisionAuditJson,
    resetScreenerSession,
    addFavorite: actionsAddFavorite,
    saveSessionBeforeStockOpen: actionsSaveSessionBeforeStockOpen,
    selectedResultSymbol,
    onSelectResultRow,
    openResultReview,
  } = actions;

  // --- staleness ---
  // El container (app/page.jsx) calcula si el scan mostrado quedó desactualizado
  // respecto a markets/manual/scanMode actuales. El banner es no-modal: NO oculta
  // ni degrada la tabla (los datos siguen siendo válidos, solo del universo previo).
  // Los dot indicators marcan el control concreto que diverge del último scan.
  const {
    scanStale = false,
    marketsStale = false,
    scanModeStale = false,
    scannedAt = null,
  } = staleness || {};
  const scannedAtLabel = scannedAt ? dateTime(scannedAt) : "";

  // --- franja P3 (percentil por lote) ---
  // Comunicamos honestamente los percentiles batch de la lista visible; si el
  // conjunto es "final", no hay nada que decir.
  const visibleBatchRows = resultsRows.some((row) => (row.percentileScope || "batch") === "batch");

  // Cierre del panel de filtros en móvil: Escape en cualquier punto de la
  // página y click/tap fuera del panel (mobileFiltersRef). El botón "Filtros"
  // de la topbar y el propio botón de cierre siguen cerrando via su onClick
  // normal; esto cubre los dos casos que no tenían manejador.
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
        <h1 className="title">{PRESETS[presetKey]?.name || "Screener"}</h1>
        <p>{PRESETS[presetKey]?.name || "Filtro activo"} · {markets.length} mercados · {resultsFiltered.length} resultados visibles</p>
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
    <div className={`scanStatusBar ${err ? "error" : ""}`} role="status" aria-live="polite">
      <span>{err ? "Incidencia" : "Estado"}</span>
      <b>{investorStatusLabel(status)}</b>
    </div>
    {snapshotNotice ? <div className={`snapshotFreshnessNotice ${snapshotNotice.tone || "info"}`} role="note">
      <span>{snapshotNotice.label}</span>
      <b>{snapshotNotice.detail}</b>
    </div> : null}
    {visibleBatchRows ? <details className="percentileScopeNotice">
      <summary>Muestra parcial · percentil por lote</summary>
      <p>Estas filas se conservan, pero sus percentiles se calcularon sobre un lote menor y pueden cambiar al finalizar el universo. En empates, las filas con percentil final aparecen primero.</p>
    </details> : null}

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
        <div className="kpis" style={{ marginBottom: 20 }}>
          <div className="kpi"><b>{kpiUniverseCount}</b><span>universo</span></div>
          <div className="kpi"><b>{resultsRows.length}</b><span>pasan</span></div>
          <div className="kpi"><b>{marketHealth ? Math.round(marketHealth.marketScore) : "-"}</b><span>{marketHealth?.regime?.label || "score"}</span></div>
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
            <span>Mercados{marketsStale ? <i className="controlDot controlDotStale" aria-hidden="true" title="Mercados cambiados desde el último scan" /> : null}</span>
            <em>{markets.length}/{MARKETS.length}</em>
          </div>
          <div className="marketPresetBar">
            {[
              ["global", "Global"],
              ["us", "EE. UU."],
              ["europe", "Europa"],
              ["asia", "Asia"],
              ["hk", "HK"],
            ].map(([key, label]) => <button key={key} className={`btn btnGhost btnSmall ${isMarketPresetActive(key) ? "btnActive" : ""}`} onClick={() => marketPreset(key)}>{label}</button>)}
          </div>
          <div className="marketSelector marketGrid">
            {MARKETS.map(([c, n]) => {
              const active = markets.includes(c);
              return <button key={c} className={`marketChip countryMarketChip ${active ? "active" : ""}`} title={`${n} · ${marketExchange(c)}`} aria-pressed={active} onClick={() => {
                const selectedMarkets = active ? markets.filter((x) => x !== c) : [...markets, c];
                const nextMarkets = MARKET_ORDER.filter((code) => selectedMarkets.includes(code));
                setMarketsAndInvalidate(nextMarkets, `Mercados actualizados: ${nextMarkets.length}`);
              }}>
                <span className="marketChipFlag">{marketFlag(c)}</span>
                <span className="marketChipCode">{c}</span>
              </button>;
            })}
          </div>
        </div>

        {/* Configuración avanzada: agrupa capas, umbrales, reglas de campo, alcance de
            lote y diagnóstico. Cerrada por defecto; el colapso persiste en localStorage. */}
        <details className="disclosurePanel advancedConfigPanel" open={advancedOpen} onToggle={(event) => persistAdvancedOpen(event.currentTarget.open)}>
          <summary>
            <span>Configuración avanzada</span>
            <em>{advancedChangeCount > 0 ? `Avanzado · ${advancedChangeCount} ${advancedChangeCount === 1 ? "cambio" : "cambios"}` : "Sin cambios sobre el preset"}</em>
          </summary>

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
            <FilterToggle active={settings.requireStage2} applies={settingApplies("requireStage2", filterLayers)} detail={inactiveSettingReason("requireStage2", filterLayers)} onClick={() => toggleLayeredSetting("requireStage2")}>Etapa 2</FilterToggle>
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
        <section className="searchCard" style={{ marginBottom: 20 }}>
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
        </section>

        <section className="mobileResearchHome">
          <MarketMiniTape marketHealth={marketHealth} />
          <SetupChipRail
            rows={resultsFiltered}
            presetKey={presetKey}
            setupMode={activeSettings.setupMode}
            sort={sort}
            onPreset={setPreset}
            onMode={(mode) => { updateSetting("setupMode", mode); if (mode === "weakness") setSort("weaknessScore"); }}
            onSort={setSort}
          />
          {scanStale ? (
            <div className="scanStaleNotice" role="status" aria-live="polite">
              <span className="scanStaleNoticeLabel">Cobertura</span>
              <b>La selección de mercados cambió; los datos cargados son de la selección anterior.</b>
            </div>
          ) : null}
          <MobileResultList
            rows={resultsPagedRows}
            settings={activeSettings}
            totalRows={resultsFiltered.length}
            sort={sort}
            onSort={setSort}
            perfPeriod={perfPeriod}
            onPerfPeriod={setPerfPeriod}
            onReview={(symbol) => openReview(resultsFiltered, symbol)}
            onFavorite={addFavorite}
            favoriteSymbols={resultsFavoriteSymbols}
            onSave={() => saveSnapshot(resultsFiltered)}
            onCsv={() => csv(resultsFiltered)}
            onAuditJson={() => decisionAuditJson(resultsFiltered)}
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
            emptyLabel={resultsEmptyLabel}
          />
        </section>

        <section className="desktopResultsSection" style={{ marginBottom: 20 }}>
          {scanStale ? (
            <div className="scanStaleNotice" role="status" aria-live="polite">
              <span className="scanStaleNoticeLabel">Cobertura</span>
              <b>La selección de mercados cambió; los datos cargados son de la selección anterior.</b>
            </div>
          ) : null}
          <div className="resultsHeader">
            <div className="resultsTitleBlock">
              <span>Results</span>
              <h2>{resultsFiltered.length} resultados</h2>
              <p>{resultsRows.length} pasan · {analyzedCountForDisplay(analyzedRows)} analizadas · {SORT_LABELS[sort] || sort}{scannedAtLabel ? ` · scan ${scannedAtLabel}` : ""}</p>
            </div>
            <div className="controls">
              {/* Siempre visible, incluso con la tabla vacía. Sin botón
                  Ejecutar, este es el único camino de vuelta a un estado bueno;
                  esconderlo justo cuando no hay resultados —que es cuando hace
                  falta— dejaba la sesión sin salida. */}
              <button className="btn btnSmall btnGhost" onClick={resetScreenerSession}>Reset sesión</button>
              {resultsFiltered.length ? <>
                <button className="btn btnSmall btnGhost" onClick={() => csv(resultsFiltered)}>↓ CSV</button>
                <button className="btn btnSmall btnGhost" onClick={() => decisionAuditJson(resultsFiltered)} title="Exportar JSON compatible con audit:decisions">JSON audit</button>
                <button className="btn btnSmall btnPrimary" onClick={() => openReview(resultsFiltered)}>Revisar</button>
                <button className="btn btnSmall btnGhost" onClick={() => saveSnapshot(resultsFiltered)} aria-label="Guardar snapshot de resultados">Guardar</button>
              </> : null}
            </div>
          </div>

          <ResultFilterBar
            optionLabel={optionLabel}
            decisionResolutionFilter={decisionResolutionFilter}
            decisionResolutionOptions={decisionResolutionOptions}
            onDecisionResolutionFilter={setDecisionResolutionFilter}
            sort={sort}
            onSort={setSort}
            perfPeriod={perfPeriod}
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
            visibleCount={resultsFiltered.length}
            totalCount={resultsRows.length}
            onClearAll={clearResultView}
            onReview={resultsFiltered.length ? openResultViewReview : undefined}
          />
          <ResultPagerTable
            visibleCount={resultsFiltered.length}
            resultPageStart={resultPageStart}
            resultPageEnd={resultPageEnd}
            resultPageSize={resultPageSize}
            onPageSizeChange={updateResultPageSize}
            visibleResultPage={visibleResultPage}
            totalResultPages={totalResultPages}
            onSetResultPage={setResultPageClamped}
            pagedRows={resultsPagedRows}
            favoriteSymbols={resultsFavoriteSymbols}
            onFavorite={addFavorite}
            onReview={openResultReview}
            onOpenStock={saveSessionBeforeStockOpen}
            selectedSymbol={selectedResultSymbol}
            onSelectRow={onSelectResultRow}
            perfPeriod={perfPeriod}
            onPerfPeriod={setPerfPeriod}
            emptyLabel={resultsEmptyLabel}
          />
        </section>
      </main>
    </div>
    <footer className="footer" style={{ marginTop: 40, borderTop: "1px solid rgba(255,255,255,.04)", paddingTop: 16, fontSize: 11, opacity: 0.5 }}>StatsEdge · Datos orientativos · {investorStatusLabel(status)}</footer>
  </main>;
}
