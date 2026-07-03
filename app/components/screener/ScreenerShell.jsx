"use client";

// ScreenerShell es una capa presentacional pura: no posee estado, efectos ni
// persistencia. Toda la lógica vive en app/page.jsx (container) y en los hooks
// useQuickReviewSession / useResultViewModel. Recibe `resultView` (el objeto
// devuelto por useResultViewModel) como prop-bag de solo lectura; el useEffect
// de persistencia del container referencia escalares sueltos, no este objeto,
// por lo que pasar el bag completo no provoca escrituras por identity-change.

import { ReviewPriorityResultRail } from "@/app/components/screener/ReviewWidgets";
import DecisionGroups from "@/app/components/screener/DecisionGroups";
import ResultFilterBar from "@/app/components/screener/ResultFilterBar";
import ResultPagerTable from "@/app/components/screener/ResultPagerTable";
import {
  CompactResultsTable,
  DecisionEvidenceSummaryRail,
  DecisionOperatingBrief,
  DecisionQualityStrip,
  DecisionSummaryRail,
  DataHealthSummaryRail,
  AuditabilitySummaryRail,
  FilterArchitecturePanel,
  FilterDiagnosticsPanel,
  FilterNumber,
  FilterTemplatePanel,
  FilterToggle,
  MarketMiniTape,
  MobileResultList,
  PendingDecisionWorkRail,
  PendingResultsBar,
  PreviewCard,
  ResultFilterChips,
  SearchCandidateList,
  SearchScopeList,
  ScoreAuditSummaryRail,
  SetupChipRail,
} from "@/app/screenerPanels";
import { investorStatusLabel } from "@/lib/screenerFormat";
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
  SCAN_BATCH_SIZES,
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

export default function ScreenerShell({ chrome, sidebar, search, resultView, results, actions }) {
  // --- chrome ---
  const {
    presetKey,
    markets,
    filtered,
    filteredCount,
    running,
    err,
    status,
    snapshotNotice,
    showMobileFilters,
    sidebarCollapsed,
    setShowMobileFilters,
    setSidebarCollapsed,
    stopScan,
    run,
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
    loadUniverse,
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
    scanMode,
    setScanMode,
    scanBatchSize,
    setScanBatchSize,
    batchStart,
    setBatchStart,
    nextBatch,
    universe,
    diagnostics,
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
  const {
    sort,
    setSort,
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
    visibleDecisionAudit,
    visibleAuditabilitySummary,
    optionLabel,
    readinessSummary,
    readinessFilter,
    setReadinessFilter,
    decisionProfileFilter,
    setDecisionProfileFilter,
    reviewPrioritySummary,
    reviewPriorityFilter,
    setReviewPriorityFilter,
    reviewPriorityOptions,
    openReviewPriorityQueue,
    reliabilityFilter,
    setReliabilityFilter,
    reliabilityOptions,
    decisionEvidenceSummary,
    decisionEvidenceFilter,
    setDecisionEvidenceFilter,
    openReviewDecisionEvidenceQueue,
    confidenceFilter,
    setConfidenceFilter,
    confidenceOptions,
    confidenceCounts,
    dataHealthSummary,
    dataHealthFilter,
    setDataHealthFilter,
    scoreAuditSummary,
    scoreAuditFilter,
    setScoreAuditFilter,
    openReviewScoreAuditQueue,
    decisionResolutionFilter,
    setDecisionResolutionFilter,
    decisionResolutionOptions,
    decisionIssueFilter,
    setDecisionIssueFilter,
    actionFilter,
    setActionFilter,
    actionOptions,
    actionCounts,
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
    pendingDecisionWorkSummary,
    pendingDecisionWorkActive,
    applyPendingDecisionWorkFocus,
    clearPendingDecisionWorkFocus,
    reviewPendingDecisionWork,
    resultFilterChips,
    resultViewBrief,
    hiddenByView,
    clearResultView,
    openResultViewReview,
    openReviewMethodologyFocusQueue,
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
    universe: resultsUniverse,
    pendingResults,
    pendingFilteredCount,
    favoriteSymbols: resultsFavoriteSymbols,
    screenerDecisionResolutions: resultsDecisionResolutions,
    restoringScan,
  } = results;

  // --- actions ---
  const {
    openReview,
    saveSnapshot,
    csv,
    decisionAuditJson,
    commitPendingResults,
    resetScreenerSession,
    addFavorite: actionsAddFavorite,
    saveSessionBeforeStockOpen: actionsSaveSessionBeforeStockOpen,
  } = actions;

  return <main className="page screenerTerminalPage">
    <div className="topbar screenerHeroBar">
      <div className="screenerHeroTitle">
        <span className="screenerEyebrow">StatsEdge · Screener</span>
        <h1 className="title">Global Leaders</h1>
        <p>{PRESETS[presetKey]?.name || "Filtro activo"} · {markets.length} mercados · {resultsFiltered.length} resultados visibles</p>
      </div>
      <div className="actions">
        <button className="btn btnMobileOnly" onClick={() => setShowMobileFilters(!showMobileFilters)}>Filtros</button>
        <button className={`btn ${running ? "btnGhost" : "btnPrimary"}`} onClick={() => { if (running) stopScan(); else { setShowMobileFilters(false); run(); } }}>{running ? "Detener" : "Ejecutar"}</button>
      </div>
    </div>
    {err && <div className="error">{err}</div>}
    <div className={`scanStatusBar ${running ? "running" : err ? "error" : ""}`} role="status" aria-live="polite">
      <span>{running ? "En ejecución" : err ? "Incidencia" : "Estado"}</span>
      <b>{investorStatusLabel(status)}</b>
    </div>
    {snapshotNotice ? <div className={`snapshotFreshnessNotice ${snapshotNotice.tone || "info"}`} role="note">
      <span>{snapshotNotice.label}</span>
      <b>{snapshotNotice.detail}</b>
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
      <aside className={`sidebar ${showMobileFilters ? "mobileOpen" : ""}`}>
        <div className="mobileSidebarHeader">
          <h2>Filtros</h2>
          <button className={`btn ${running ? "btnGhost" : "btnPrimary"}`} onClick={() => { if (running) stopScan(); else { setShowMobileFilters(false); run(); } }}>{running ? "Detener" : "Aplicar"}</button>
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
          running={running}
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
            <span>Mercados</span>
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
            <button className="btn btnSmall btnPrimary marketUniverseBtn" onClick={loadUniverse} disabled={running || !markets.length} title="Prepara la lista de tickers de los mercados seleccionados">
              Cargar universo
            </button>
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
          <button className="btn btnSmall btnGhost" onClick={() => { setFilterLayers(filterLayersForPreset(presetKey)); setUseRegimeFilter(true); }}>Base preset</button>
          <button className="btn btnSmall btnGhost" onClick={() => { setFilterLayers(ALL_FILTER_LAYERS); setUseRegimeFilter(true); }}>Todo activo</button>
        </div>

        <div className="sidebarGroup" style={{ marginBottom: 24 }}>
          <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>Condiciones</span>
          <div className={`weeklyStageControls ${filterLayers.trend ? "" : "isMuted"}`}>
            <label><span>Media rapida semanal</span><input className="input" type="number" min="2" max="80" step="1" value={settings.stageFastWeeks || 10} onChange={(event) => updateSetting("stageFastWeeks", Number(event.target.value) || 10)} /></label>
            <label><span>Media lenta semanal</span><input className="input" type="number" min="3" max="120" step="1" value={settings.stageSlowWeeks || 30} onChange={(event) => updateSetting("stageSlowWeeks", Number(event.target.value) || 30)} /></label>
            <label><span>Pendiente semanas</span><input className="input" type="number" min="2" max="40" step="1" value={settings.stageSlopeWeeks || 10} onChange={(event) => updateSetting("stageSlopeWeeks", Number(event.target.value) || 10)} /></label>
          </div>
          <div className="filterSwitches">
            <FilterToggle active={settings.requireStage2} applies={settingApplies("requireStage2", filterLayers)} detail={inactiveSettingReason("requireStage2", filterLayers)} onClick={() => toggleLayeredSetting("requireStage2")}>Stage 2</FilterToggle>
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
              <button className="btn btnGhost btnSmall" style={{ width: "100%" }} onClick={() => { setSettings(settingsForPreset(presetKey)); setFieldRules(DEFAULT_FIELD_RULES); setFilterLayers(filterLayersForPreset(presetKey)); setUseRegimeFilter(true); }}>Resetear condiciones</button>
            </div>
          </details>
        </div>

        <details className="disclosurePanel compactDisclosure" style={{ marginBottom: 20 }}>
          <summary><span>Cobertura y alcance</span></summary>
          <div className="grid" style={{ gap: 8 }}>
            <select className="select" value={scanMode} onChange={(e) => { setScanMode(e.target.value); setBatchStart(0); }}><option value="batch">Por lote</option><option value="random">Aleatorio</option><option value="all">Todo el universo</option></select>
            <select className="select" value={scanBatchSize} onChange={(e) => { setScanBatchSize(Number(e.target.value)); setBatchStart(0); }} aria-label="Tickers por lote">
              {SCAN_BATCH_SIZES.map((size) => <option key={size} value={size}>{size} tickers por lote</option>)}
            </select>
            <input className="input" type="number" value={batchStart} placeholder="Inicio" onChange={(e) => setBatchStart(Number(e.target.value) || 0)} />
            <button className="btn btnGhost" onClick={nextBatch} disabled={running || !universe.length || scanMode === "all"}>Siguiente lote</button>
          </div>
        </details>

        <details className="scanDiagnosticsDisclosure">
          <summary>
            <span>Auditoria de filtros</span>
            <em>{running ? "analizando" : diagnostics ? `${diagnostics.finalCount}/${diagnostics.analyzed} pasan` : "sin scan"}</em>
          </summary>
          <FilterDiagnosticsPanel diagnostics={diagnostics} rowsCount={resultsRows.length} filteredCount={resultsFiltered.length} running={running} />
        </details>
        </details>
      </aside>

      <main className="mainContent">
        <section className="searchCard" style={{ marginBottom: 20 }}>
          <div className="commandSearchPanel searchPanelBare">
              <form className="searchBar" onSubmit={runSearch} style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <input className="input searchInput" value={searchSymbol} onChange={(e) => updateSearchSymbol(e.target.value)} placeholder="Ticker, nombre, sector, subsector o pais..." />
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
          <PendingResultsBar pending={pendingResults ? { ...pendingResults, filteredCount: pendingFilteredCount } : null} visibleCount={resultsRows.length} filteredCount={resultsFiltered.length} onCommit={commitPendingResults} />
          <PendingDecisionWorkRail
            summary={pendingDecisionWorkSummary}
            active={pendingDecisionWorkActive}
            onFocus={applyPendingDecisionWorkFocus}
            onClear={clearPendingDecisionWorkFocus}
            onReview={reviewPendingDecisionWork}
            className="mobile"
          />
          <MobileResultList
            rows={resultsPagedRows}
            settings={activeSettings}
            totalRows={resultsFiltered.length}
            sort={sort}
            onSort={setSort}
            onReview={(symbol) => openReview(resultsFiltered, symbol)}
            onFavorite={addFavorite}
            favoriteSymbols={resultsFavoriteSymbols}
            onSave={() => saveSnapshot(resultsFiltered)}
            onCsv={() => csv(resultsFiltered)}
            onAuditJson={() => decisionAuditJson(resultsFiltered)}
            onOpenStock={saveSessionBeforeStockOpen}
            savingDisabled={running}
            page={visibleResultPage}
            pageSize={resultPageSize}
            totalPages={totalResultPages}
            onPage={setResultPageClamped}
            onPageSize={updateResultPageSize}
            decisionQuality={visibleDecisionAudit}
            decisionIssueFilter={decisionIssueFilter}
            onDecisionIssueFilter={setDecisionIssueFilter}
            decisionProfileFilter={decisionProfileFilter}
            onDecisionProfileFilter={setDecisionProfileFilter}
            reviewPriorityFilter={reviewPriorityFilter}
            reviewPriorityOptions={reviewPriorityOptions}
            onReviewPriorityFilter={setReviewPriorityFilter}
            reliabilityFilter={reliabilityFilter}
            reliabilityOptions={reliabilityOptions}
            onReliabilityFilter={setReliabilityFilter}
            decisionEvidenceSummary={decisionEvidenceSummary}
            decisionEvidenceFilter={decisionEvidenceFilter}
            onDecisionEvidenceFilter={setDecisionEvidenceFilter}
            onDecisionEvidenceReview={openReviewDecisionEvidenceQueue}
            readinessSummary={readinessSummary}
            readinessFilter={readinessFilter}
            onReadinessFilter={setReadinessFilter}
            confidenceFilter={confidenceFilter}
            confidenceOptions={confidenceOptions}
            confidenceCounts={confidenceCounts}
            onConfidenceFilter={setConfidenceFilter}
            dataHealthSummary={dataHealthSummary}
            dataHealthFilter={dataHealthFilter}
            onDataHealthFilter={setDataHealthFilter}
            scoreAuditSummary={scoreAuditSummary}
            scoreAuditFilter={scoreAuditFilter}
            onScoreAuditFilter={setScoreAuditFilter}
            onScoreAuditReview={openReviewScoreAuditQueue}
            decisionResolutionFilter={decisionResolutionFilter}
            decisionResolutionOptions={decisionResolutionOptions}
            onDecisionResolutionFilter={setDecisionResolutionFilter}
            decisionResolutions={resultsDecisionResolutions}
            emptyLabel={restoringScan ? "Cargando último snapshot guardado..." : undefined}
          />
        </section>

        <section className="desktopResultsSection" style={{ marginBottom: 20 }}>
          <PendingResultsBar pending={pendingResults ? { ...pendingResults, filteredCount: pendingFilteredCount } : null} visibleCount={resultsRows.length} filteredCount={resultsFiltered.length} onCommit={commitPendingResults} />
          <div className="resultsHeader">
            <div className="resultsTitleBlock">
              <span>Results</span>
              <h2>{resultsFiltered.length} resultados</h2>
              <p>{resultsRows.length} pasan · {analyzedRows.length || resultsUniverse.length || 0} analizadas · {SORT_LABELS[sort] || sort}</p>
              {/* Rails de decisión: control clicable único para readiness/reviewPriority.
                  Los <select> que antes duplicaban estos estados se eliminaron; el re-click
                  del chip limpia a "Todos"/"all", y ResultFilterChips también permite limpiar. */}
              <DecisionSummaryRail summary={readinessSummary} activeKey={readinessFilter} onSelect={setReadinessFilter} />
              <ReviewPriorityResultRail summary={reviewPrioritySummary} activeKey={reviewPriorityFilter} onSelect={setReviewPriorityFilter} onReview={openReviewPriorityQueue} />
            </div>
            <div className="controls">
              {(resultsRows.length > 0 || pendingResults?.rows?.length || diagnostics) ? <button className="btn btnSmall btnGhost" onClick={resetScreenerSession}>Reset sesión</button> : null}
              {resultsFiltered.length ? <>
                <button className="btn btnSmall btnGhost" onClick={() => csv(resultsFiltered)}>↓ CSV</button>
                <button className="btn btnSmall btnGhost" onClick={() => decisionAuditJson(resultsFiltered)} title="Exportar JSON compatible con audit:decisions">JSON audit</button>
                <button className="btn btnSmall btnPrimary" onClick={() => openReview(resultsFiltered)}>Revisar</button>
                <button className="btn btnSmall btnGhost" onClick={() => saveSnapshot(resultsFiltered)} disabled={running} aria-label="Guardar snapshot de resultados">Guardar</button>
              </> : null}
            </div>
          </div>

          <DecisionGroups
            audit={visibleDecisionAudit}
            filteredCount={resultsFiltered.length}
            filteredRows={resultsFiltered}
            onReviewAll={() => openReview(resultsFiltered)}
            decisionIssueFilter={decisionIssueFilter}
            onDecisionIssueFilter={setDecisionIssueFilter}
            decisionProfileFilter={decisionProfileFilter}
            onDecisionProfileFilter={setDecisionProfileFilter}
            onReadinessFilter={setReadinessFilter}
            onConfidenceFilter={setConfidenceFilter}
            pendingDecisionWorkSummary={pendingDecisionWorkSummary}
            pendingDecisionWorkActive={pendingDecisionWorkActive}
            onPendingDecisionWorkFocus={applyPendingDecisionWorkFocus}
            onPendingDecisionWorkClear={clearPendingDecisionWorkFocus}
            onPendingDecisionWorkReview={reviewPendingDecisionWork}
            decisionEvidenceSummary={decisionEvidenceSummary}
            decisionEvidenceFilter={decisionEvidenceFilter}
            onDecisionEvidenceFilter={setDecisionEvidenceFilter}
            onReviewDecisionEvidenceQueue={openReviewDecisionEvidenceQueue}
            dataHealthSummary={dataHealthSummary}
            dataHealthFilter={dataHealthFilter}
            onDataHealthFilter={setDataHealthFilter}
            scoreAuditSummary={scoreAuditSummary}
            scoreAuditFilter={scoreAuditFilter}
            onScoreAuditFilter={setScoreAuditFilter}
            onReviewScoreAuditQueue={openReviewScoreAuditQueue}
            auditabilitySummary={visibleAuditabilitySummary}
            onReviewMethodologyFocusQueue={openReviewMethodologyFocusQueue}
          />

          <ResultFilterBar
            optionLabel={optionLabel}
            decisionResolutionFilter={decisionResolutionFilter}
            decisionResolutionOptions={decisionResolutionOptions}
            onDecisionResolutionFilter={setDecisionResolutionFilter}
            reliabilityFilter={reliabilityFilter}
            reliabilityOptions={reliabilityOptions}
            onReliabilityFilter={setReliabilityFilter}
            confidenceFilter={confidenceFilter}
            confidenceOptions={confidenceOptions}
            confidenceCounts={confidenceCounts}
            onConfidenceFilter={setConfidenceFilter}
            actionFilter={actionFilter}
            actionOptions={actionOptions}
            actionCounts={actionCounts}
            onActionFilter={setActionFilter}
            sort={sort}
            onSort={setSort}
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
            brief={resultViewBrief}
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
            settings={activeSettings}
            favoriteSymbols={resultsFavoriteSymbols}
            onFavorite={addFavorite}
            onReview={(symbol) => openReview(resultsFiltered, symbol)}
            onOpenStock={saveSessionBeforeStockOpen}
            decisionIssueFilter={decisionIssueFilter}
            onDecisionIssueFilter={setDecisionIssueFilter}
            decisionEvidenceFilter={decisionEvidenceFilter}
            onDecisionEvidenceFilter={setDecisionEvidenceFilter}
            dataHealthFilter={dataHealthFilter}
            onDataHealthFilter={setDataHealthFilter}
            scoreAuditFilter={scoreAuditFilter}
            onScoreAuditFilter={setScoreAuditFilter}
            decisionResolutions={resultsDecisionResolutions}
            emptyLabel={restoringScan ? "Cargando último snapshot guardado..." : undefined}
          />
        </section>
      </main>
    </div>
    <footer className="footer" style={{ marginTop: 40, borderTop: "1px solid rgba(255,255,255,.04)", paddingTop: 16, fontSize: 11, opacity: 0.5 }}>StatsEdge · Datos orientativos · {investorStatusLabel(status)}</footer>
  </main>;
}
