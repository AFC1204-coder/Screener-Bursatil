// lib/screenerFilters.jsx — paneles y controles de filtros del screener:
// chips de vista, contrato, plantillas, familias, capas y diagnósticos.

import { InfoHint } from "@/app/components/ui/InfoHint";
import { rowPassesListContract } from "@/lib/listRationale";
import { canonicalRsValue } from "@/lib/rsCanonical";
import { CORE_LAYER_KEYS, OPTIONAL_LAYER_KEYS, VIEW_LAYERS } from "@/lib/screenerConfig";
import {
  EXECUTION_LAYERS,
  FILTER_FAMILY_PRESETS,
  FILTER_FIELDS,
  NEUTRAL_FIELD_VALUES,
  REGIME_LAYER,
  SCREENER_FILTER_PRESETS as PRESETS,
  SETTING_LAYER_DEPENDENCIES,
} from "@/lib/screenerFilterCatalog";
import {
  fieldLayerKeys,
  inactiveFieldReason,
  inactiveSettingReason,
  isFieldRuleActive,
  settingApplies,
} from "@/lib/screenerFilterLayers";
import { isHuntCardPreset, optionalBasePresetEntries } from "@/lib/screenerHuntCards";
import { ruleCountLabel } from "@/lib/screenerFormat";

export function SetupChipRail({ rows = [], presetKey, setupMode, sort, onPreset, onMode, onSort }) {
  const counts = {
    stage2: rows.filter((row) => rowPassesListContract(row, "weinstein")).length,
    trend: rows.filter((row) => rowPassesListContract(row, "minervini")).length,
    watch: rows.filter((row) => rowPassesListContract(row, "nearPivot")).length,
    rs: rows.filter((row) => (canonicalRsValue(row) ?? 0) >= 75).length,
  };
  const chips = [
    { key: "stage2", label: "Etapa 2", count: counts.stage2, active: setupMode === "leader", action: () => onMode("leader") },
    // "Trend Template" era nombre propio de metodología (retirados de la UI);
    // lo que cuenta el chip es la estructura de tendencia completa.
    { key: "trend", label: "Estructura de tendencia", count: counts.trend, active: presetKey === "strict", action: () => onPreset("strict") },
    { key: "watch", label: "Vigilancia", count: counts.watch, active: setupMode === "nearPivot", action: () => onMode("nearPivot") },
    { key: "rs", label: "RS", count: counts.rs, active: sort === "rsGlobalPct", action: () => onSort("rsGlobalPct") },
  ];
  return <div className="mobileChipRail">
    {chips.map((chip) => <button type="button" key={chip.key} className={chip.active ? "active" : ""} onClick={chip.action}>
      {chip.label} <span>{chip.count}</span>
    </button>)}
  </div>;
}

export function ResultFilterChips({ chips = [], hiddenCount = 0, visibleCount = null, totalCount = null, onClearAll, onReview }) {
  if (!chips.length && !hiddenCount) return null;
  const hasVisibleCounts = Number.isFinite(visibleCount) && Number.isFinite(totalCount);
  const visibleLabel = hasVisibleCounts ? `${visibleCount}/${totalCount}` : String(Math.max(0, Number(visibleCount) || 0));
  const filterSummary = chips.length
    ? `${chips.length} filtro${chips.length === 1 ? "" : "s"}`
    : "sin filtros";
  const hiddenSummary = hiddenCount > 0 ? ` · −${hiddenCount} ocultas` : "";
  return <div className="resultFilterChips">
    <div className="resultViewFocusSummary" aria-label="Resumen de vista activa">
      <p className="resultViewFocusLine">
        <b>Vista: {visibleLabel}</b>
        <span> · {filterSummary}{hiddenSummary}</span>
      </p>
      {onReview && Number(visibleCount) > 0 ? <button type="button" onClick={onReview}>Revisar vista</button> : null}
    </div>
    {/* El "Brief vista" (veredicto + Freno + Primero) se retiró: era el mismo
        juicio operativo que el panel Decisiones, solo que condicionado a tener
        filtros activos. buildResultViewBrief sigue calculándose. */}
    <div className="resultViewChipRail">
      {chips.map((chip) => <button type="button" key={chip.key} className="resultFilterChip" onClick={chip.onClear} title={chip.impact ? `${chip.impact} en esta opción` : undefined}>
        <span>{chip.label}</span>
        {chip.impact ? <i className="resultFilterChipImpact">{chip.impact}</i> : null}
        <b aria-hidden="true">×</b>
      </button>)}
      {chips.length ? <button type="button" className="resultFilterClear" onClick={onClearAll}>Limpiar vista</button> : null}
    </div>
  </div>;
}

export function ScreenerContractPanel({ contract }) {
  if (!contract) return null;
  const warnings = contract.warnings || [];
  const statsByKey = new Map((contract.stats || []).map((stat) => [stat.key, stat]));
  const visibleStats = ["rules", "results", "scope", "regime"]
    .map((key) => statsByKey.get(key))
    .filter(Boolean);
  const viewStat = statsByKey.get("view");
  if (viewStat?.value && viewStat.value !== "limpia") visibleStats.push(viewStat);
  const infoText = [contract.text, warnings.length ? "" : contract.okText].filter(Boolean).join(" ");
  return <section className={`screenerContractPanel ${contract.tone}`} data-contract-key={contract.key}>
    <div className="screenerContractIntro">
      <span className="screenerContractLabel">{contract.label}</span>
      <div>
        <h2>{contract.title}{infoText ? <InfoHint text={infoText} /> : null}</h2>
      </div>
    </div>
    <div className="screenerContractStats" aria-label="Estado objetivo del filtro">
      {visibleStats.map((stat) => <span key={stat.key}>
        <b>{stat.value}</b>
        <em>{stat.label}</em>
      </span>)}
    </div>
    {warnings.length ? <div className="screenerContractStatus warn">
      {warnings.slice(0, 3).map((warning) => <span key={warning.key}>{warning.text}</span>)}
    </div> : null}
  </section>;
}

export function FilterTemplatePanel({
  presetKey,
  savedTemplates = [],
  selectedTemplateId = "",
  templateName = "",
  onPreset,
  onApplySaved,
  onTemplateName,
  onSave,
  onDelete,
  onSaveCloud,
  onLoadCloud,
}) {
  const internalPresetName = PRESETS[presetKey]?.name;
  const showInternalPreset = !isHuntCardPreset(presetKey) && internalPresetName;
  return <section className="filterTemplatePanel">
    <div className="filterTemplateHead">
      <span>Ajustes de sesión</span>
      <em>{showInternalPreset ? `Base ${internalPresetName}` : "Mercados y afinado"}</em>
    </div>

    <details className="savedTemplatesDisclosure">
      <summary><span>Mis plantillas</span><em>{savedTemplates.length} guardadas</em></summary>
      <div className="savedTemplateTools">
        <select className="select" value={selectedTemplateId} onChange={(event) => onApplySaved?.(event.target.value)} aria-label="Plantillas guardadas">
          <option value="">Mis plantillas guardadas</option>
          {savedTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
        </select>
        <input className="input" value={templateName} onChange={(event) => onTemplateName?.(event.target.value)} placeholder="Nombre de plantilla" aria-label="Nombre de plantilla" />
        <div className="savedTemplateActions">
          <button type="button" className="btn btnSmall" onClick={() => onSave?.(false)}>Guardar</button>
          <button type="button" className="btn btnSmall btnGhost" onClick={() => onSave?.(true)}>Copia</button>
          <button type="button" className="btn btnSmall btnGhost" onClick={onDelete} disabled={!selectedTemplateId}>Borrar</button>
        </div>
        <div className="cloudTemplateActions">
          <button type="button" className="btn btnSmall btnGhost" onClick={onSaveCloud}>Guardar nube</button>
          <button type="button" className="btn btnSmall btnGhost" onClick={onLoadCloud}>Cargar nube</button>
        </div>
      </div>
    </details>
  </section>;
}

export function OptionalBasePresetsPanel({ presetKey, onPreset }) {
  const optionalBases = optionalBasePresetEntries();
  return <details className="templateQuickPresets optionalBasePresets">
    <summary><span>Más bases de filtro</span><em>{optionalBases.length}</em></summary>
    <p className="optionalBasePresetsHint">No sustituyen las fichas del centro; cambian umbrales del filtro.</p>
    <div className="filterTemplateGrid">
      {optionalBases.map(([key, preset]) => <button
        type="button"
        key={key}
        className={`filterTemplateBtn ${presetKey === key ? "active" : ""}`}
        onClick={() => onPreset?.(key)}
        title={preset.desc}
      >
        <b>{preset.name}</b>
        <small>{preset.desc}</small>
      </button>)}
    </div>
  </details>;
}

export function FilterFamilyModal({ layerKey, settings, filterLayers, fieldRules, onClose, onToggleLayer, onApplyAction, onUpdateSetting, onToggleFieldRule, onToggleLayeredSetting }) {
  if (!layerKey) return null;
  const layer = EXECUTION_LAYERS.find((item) => item.key === layerKey);
  if (!layer) return null;
  const family = FILTER_FAMILY_PRESETS[layerKey] || { title: layer.label, intro: layer.detail, actions: [] };
  const layerActive = filterLayers[layerKey] !== false;
  const familyFields = FILTER_FIELDS.filter((field) => fieldLayerKeys(field).includes(layerKey));
  const familySettingKeys = Object.entries(SETTING_LAYER_DEPENDENCIES)
    .filter(([, dependency]) => dependency.layer === layerKey)
    .map(([key]) => key);
  const settingLabels = {
    requireStage2: "Etapa 2",
    requirePulso: "Pulso",
    requireUpVolume: "Volumen en vela alcista",
    requireRecentIpo: "IPO real reciente",
    requireContractionsDecreasing: "Contracciones decrecientes",
  };

  return <dialog className="filterFamilyModal stockModal" open onClick={(event) => { if (event.target === event.currentTarget) onClose?.(); }}>
    <div className="filterFamilyInner">
      <header className="filterFamilyHeader">
        <div>
          <span>Familia de filtro</span>
          <h2>{family.title}</h2>
          <p>{family.intro}</p>
        </div>
        <div className="filterFamilyHeaderActions">
          <button
            type="button"
            className={`filterFamilyPower ${layerActive ? "on" : "off"}`}
            aria-pressed={layerActive}
            onClick={() => onToggleLayer?.(layerKey)}
            title={layerActive ? "Familia activa — clic para apagar" : "Familia apagada — clic para activar"}
          >
            <b>{layerActive ? "Activa" : "Apagada"}</b>
            <span>{ruleCountLabel(layer.count)}</span>
          </button>
          <button type="button" className="stockModalClose" onClick={onClose} aria-label="Cerrar">×</button>
        </div>
      </header>

      {family.actions.length ? <div className="filterFamilyToolbar">
        <div className="filterFamilyPresetRail" aria-label="Ajustes rápidos de exigencia">
          <span>Exigencia</span>
          <div>
            {family.actions.map((action) => <button type="button" className="filterFamilyPreset" key={action.label} onClick={() => onApplyAction?.(layerKey, action)} title={action.detail}>
              {action.label}
            </button>)}
          </div>
        </div>
      </div> : null}

      {layerKey === "trend" ? <div className={`weeklyStageControls modalWeeklyControls ${layerActive ? "" : "isMuted"}`}>
        <label><span>Media rápida semanal</span><input className="input" type="number" min="2" max="80" step="1" value={settings.stageFastWeeks || 10} onChange={(event) => onUpdateSetting?.("stageFastWeeks", Number(event.target.value) || 10)} /></label>
        <label><span>Media lenta semanal</span><input className="input" type="number" min="3" max="120" step="1" value={settings.stageSlowWeeks || 30} onChange={(event) => onUpdateSetting?.("stageSlowWeeks", Number(event.target.value) || 30)} /></label>
        <label><span>Pendiente semanas</span><input className="input" type="number" min="2" max="40" step="1" value={settings.stageSlopeWeeks || 10} onChange={(event) => onUpdateSetting?.("stageSlopeWeeks", Number(event.target.value) || 10)} /></label>
        <label><span>Media plana ±%</span><input className="input" type="number" min="0" max="20" step="0.5" value={settings.stageFlatPct ?? 2} onChange={(event) => onUpdateSetting?.("stageFlatPct", Number(event.target.value))} /></label>
      </div> : null}

      {familySettingKeys.length ? <div className="filterSwitches filterFamilySwitches">
        {familySettingKeys.map((key) => <FilterToggle
          key={key}
          active={settings[key]}
          applies={settingApplies(key, filterLayers)}
          detail={inactiveSettingReason(key, filterLayers)}
          onClick={() => onToggleLayeredSetting?.(key)}
        >
          {settingLabels[key] || key}
        </FilterToggle>)}
      </div> : null}

      <div className="filterFamilyFields">
        <div className="filterFamilySubhead">
          <span>Ajustes finos</span>
          <em>{familyFields.filter((field) => isFieldRuleActive(field, fieldRules, filterLayers)).length}/{familyFields.length}</em>
        </div>
        {familyFields.length ? <div className="filterFields">
          {familyFields.map((field) => <FilterNumber
            key={field.key}
            field={field}
            value={settings[field.key]}
            onChange={onUpdateSetting}
            active={isFieldRuleActive(field, fieldRules, filterLayers)}
            inactiveReason={inactiveFieldReason(field, fieldRules, filterLayers)}
            onToggle={() => onToggleFieldRule?.(field)}
          />)}
        </div> : <p className="filterFamilyEmpty">Esta familia se controla con los botones superiores.</p>}
      </div>
    </div>
  </dialog>;
}

export function FilterNumber({ field, value, onChange, active = true, inactiveReason = "", onToggle }) {
  const scale = field.scale || 1;
  const step = field.step || 1;
  const currentValue = Number.isFinite(value) ? value / scale : 0;
  const shown = Number.isFinite(value) ? value / scale : "";
  const neutral = NEUTRAL_FIELD_VALUES[field.key];
  const minValue = Number.isFinite(field.min)
    ? field.min
    : (field.key.startsWith("min") && Number.isFinite(neutral) && neutral < 0 ? neutral / scale : 0);

  const handleDecrement = (e) => {
    e.preventDefault();
    const newValue = Math.max(minValue, currentValue - step);
    onChange(field.key, Number(newValue.toFixed(4)) * scale);
  };

  const handleIncrement = (e) => {
    e.preventDefault();
    const newValue = currentValue + step;
    onChange(field.key, Number(newValue.toFixed(4)) * scale);
  };

  return <div className={`filterField ${active ? "isActive" : "isOff"}`}>
    <label className="filterFieldLabel">
      <span className={`ruleMiniToggle ${active ? "on" : "off"}`} title={active ? "Quitar esta regla del filtro" : inactiveReason || "Activar esta regla"}>
        <input type="checkbox" checked={active} onChange={onToggle} aria-label={`${active ? "Quitar" : "Activar"} ${field.label}`} />
        <span>{active ? "✓" : ""}</span>
      </span>
      <span>{field.label}</span>
      {field.hint && <InfoHint text={field.hint} />}
    </label>
    <div className="filterInputWrap">
      <button type="button" className="filterStepperBtn decrement" onClick={handleDecrement} title="Disminuir" aria-label="Disminuir">-</button>
      <input className="input" type="number" step={step} value={shown} aria-label={field.label} onChange={(e) => onChange(field.key, (Number(e.target.value) || 0) * scale)} />
      {field.unit && <b className="filterUnit">{field.unit}</b>}
      <button type="button" className="filterStepperBtn increment" onClick={handleIncrement} title="Incrementar" aria-label="Incrementar">+</button>
    </div>
  </div>;
}

export function FilterToggle({ active, applies = true, detail = "", onClick, children }) {
  const checked = Boolean(active && applies);
  return <label className={`filterToggleLine ${checked ? "on" : ""} ${applies ? "" : "isMuted"}`} title={detail}>
    <input type="checkbox" checked={checked} onChange={onClick} />
    <span>{children}</span>
    {detail ? <small>{detail}</small> : null}
  </label>;
}

export function LayerToggleButton({ active, onClick, label }) {
  return <button
    type="button"
    className={`layerPowerToggle ${active ? "on" : "off"}`}
    aria-pressed={active}
    aria-label={`${active ? "Desactivar" : "Activar"} ${label}`}
    onClick={onClick}
    title={active ? "Activa — clic para apagar" : "Apagada — clic para activar"}
  >
    <span className="layerPowerIcon" aria-hidden="true">⏻</span>
  </button>;
}

export function LayerControl({ active, onClick, onOpen, label, detail, countLabel }) {
  return <div className={`layerControlRow ${active ? "on" : "off"} ${onOpen ? "hasOpen" : "simple"}`}>
    <LayerToggleButton active={active} onClick={onClick} label={label} />
    <div className="layerControlBody">
      <strong className="layerControlLabel">{label}</strong>
      {(detail || countLabel) ? <span className="layerControlMeta">
        {detail ? <small>{detail}</small> : null}
        {detail && countLabel ? <span className="layerControlSep" aria-hidden="true">·</span> : null}
        {countLabel ? <em>{countLabel}</em> : null}
      </span> : null}
    </div>
    {detail ? <InfoHint text={detail} /> : null}
    {onOpen ? <button type="button" className="layerOpenBtn" onClick={onOpen} aria-label={`Abrir ${label}`}>Abrir ▸</button> : null}
  </div>;
}

export function FilterArchitecturePanel({ filterLayers, viewLayers, useRegimeFilter, onToggleLayer, onOpenLayer, onToggleViewLayer, onToggleRegime, executionRuleActive, executionRuleTotal, viewFiltersActive }) {
  const layerByKey = Object.fromEntries(EXECUTION_LAYERS.map((layer) => [layer.key, layer]));
  return <section className="filterArchitecture">
    <div className="filterArchitectureHead">
      <div>
        <span>Filtro activo</span>
        <strong>{executionRuleActive} de {executionRuleTotal} reglas</strong>
      </div>
    </div>
    <div className="filterLayerBlock">
      <h3>Núcleo</h3>
      {CORE_LAYER_KEYS.map((key) => {
        const layer = layerByKey[key];
        return <LayerControl key={key} active={filterLayers[key]} onClick={() => onToggleLayer(key)} onOpen={() => onOpenLayer?.(key)} label={layer.label} detail={layer.detail} countLabel={ruleCountLabel(layer.count)} />;
      })}
    </div>
    <div className="filterLayerBlock">
      <h3>Adicionales</h3>
      {OPTIONAL_LAYER_KEYS.map((key) => {
        const layer = layerByKey[key];
        return <LayerControl key={key} active={filterLayers[key]} onClick={() => onToggleLayer(key)} onOpen={() => onOpenLayer?.(key)} label={layer.label} detail={layer.detail} countLabel={ruleCountLabel(layer.count)} />;
      })}
      <LayerControl active={useRegimeFilter} onClick={onToggleRegime} label={REGIME_LAYER.label} detail={REGIME_LAYER.detail} countLabel={ruleCountLabel(REGIME_LAYER.count)} />
    </div>
    <details className="viewLayerMini">
      <summary><span>Vista de resultados</span><em>{viewFiltersActive} activos</em></summary>
      <div className="viewLayerBar">
        {VIEW_LAYERS.map((layer) => <LayerControl key={layer.key} active={viewLayers[layer.key]} onClick={() => onToggleViewLayer(layer.key)} label={layer.label} detail={layer.detail} countLabel="vista" />)}
      </div>
    </details>
  </section>;
}

export function FilterDiagnosticsPanel({ diagnostics, rowsCount, filteredCount }) {
  const viewHidden = Math.max(0, rowsCount - filteredCount);
  if (!diagnostics) return <section className="scanDiagnostics empty">
    <div className="scanDiagnosticsHead">
      <span>Embudo del filtro</span>
      <strong>Sin diagnóstico</strong>
    </div>
    <div className="scanDiagnosticHint">Cuando haya datos cargados, aquí se ve qué bloque corta acciones y qué parte solo afecta a la vista.</div>
  </section>;
  const blocks = diagnostics?.blocks || [];
  const analyzed = Number(diagnostics?.analyzed || 0);
  const finalCount = Number(diagnostics?.finalCount || 0);
  const universeTotal = Number(diagnostics?.universeTotal || analyzed || 0);
  const passRate = analyzed > 0 ? (finalCount / analyzed) * 100 : null;
  const sampleRate = universeTotal > 0 ? (analyzed / universeTotal) * 100 : null;
  const limitedSample = universeTotal > analyzed;
  return <section className="scanDiagnostics">
    <div className="scanDiagnosticsHead">
      <span>Embudo del filtro</span>
      <strong>{`${diagnostics.finalCount}/${diagnostics.analyzed} pasan`}</strong>
    </div>
    <div className="diagnosticStats">
      <span><b>{diagnostics?.analyzed ?? "-"}</b><em>analizadas</em></span>
      <span><b>{Number.isFinite(passRate) ? `${passRate.toFixed(0)}%` : "-"}</b><em>pasan</em></span>
      <span><b>{Number.isFinite(sampleRate) ? `${sampleRate < 10 ? sampleRate.toFixed(1) : sampleRate.toFixed(0)}%` : "-"}</b><em>muestra</em></span>
      <span><b>{diagnostics?.hardRejected ?? "-"}</b><em>filtros duros</em></span>
      <span><b>{diagnostics?.providerRejected ?? "-"}</b><em>datos</em></span>
      <span><b>{diagnostics?.regimeRejected ?? "-"}</b><em>régimen</em></span>
      <span><b>{diagnostics?.postRejected ?? "-"}</b><em>post</em></span>
      <span><b>{viewHidden}</b><em>vista</em></span>
    </div>
    {limitedSample ? <div className="scanSampleNotice">
      Muestra actual: <b>{analyzed}</b> de <b>{universeTotal}</b> acciones ({Number.isFinite(sampleRate) ? `${sampleRate.toFixed(1)}%` : "sin porcentaje"}). Si salen pocos resultados, primero aumenta lotes o usa snapshots/cache antes de endurecer filtros.
    </div> : null}
    {blocks.length ? <div className="diagnosticBlocks">
      {blocks.slice(0, 7).map((block) => <article key={block.key} className="diagnosticBlock">
        <div><span>{block.stage}</span><strong>{block.label}</strong></div>
        <b>{block.count}</b>
        <ul>{block.examples.slice(0, 2).map((example, index) => <li key={`${block.key}-${example.symbol}-${index}`}><em>{example.symbol}</em>{example.detail}</li>)}</ul>
      </article>)}
    </div> : <div className="scanDiagnosticHint">No hay rechazos registrados en el último scan.</div>}
  </section>;
}
