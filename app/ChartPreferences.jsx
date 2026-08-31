"use client";
import { useEffect } from "react";
import { CHART_INTERVALS, CHART_RANGES, CHART_SCALE_MODES, CHART_STYLES, DEFAULT_CHART_SETTINGS, normalizeChartInterval } from "@/lib/chartSettings";

function compatibleRangeForInterval(nextInterval = DEFAULT_CHART_SETTINGS.interval, currentRange = DEFAULT_CHART_SETTINGS.range) {
  const interval = normalizeChartInterval(nextInterval);
  const range = currentRange || DEFAULT_CHART_SETTINGS.range;
  if (interval === "1m") return "1D";
  if (["5m", "15m", "30m"].includes(interval)) return ["1D", "5D"].includes(range) ? range : "5D";
  if (interval === "1H") return ["1D", "5D", "1M"].includes(range) ? range : "1M";
  if (interval === "4H") return ["5D", "1M", "3M"].includes(range) ? range : "3M";
  if (interval === "W") return ["1D", "5D", "1M"].includes(range) ? "1A" : range;
  if (interval === "M") return range === "MAX" ? "5A" : ["1D", "5D", "1M", "3M"].includes(range) ? "1A" : range;
  return range;
}

function rangeIsCompatibleWithInterval(nextInterval = DEFAULT_CHART_SETTINGS.interval, rangeKey = DEFAULT_CHART_SETTINGS.range) {
  const interval = normalizeChartInterval(nextInterval);
  if (interval === "1m") return rangeKey === "1D";
  if (["5m", "15m", "30m"].includes(interval)) return ["1D", "5D"].includes(rangeKey);
  if (interval === "1H") return ["1D", "5D", "1M"].includes(rangeKey);
  if (interval === "4H") return ["5D", "1M", "3M"].includes(rangeKey);
  if (interval === "W") return !["1D", "5D", "1M"].includes(rangeKey);
  if (interval === "M") return !["1D", "5D", "1M", "3M", "MAX"].includes(rangeKey);
  return true;
}

function ChartSegmentedControl({ label = "", options = [], value = "", onChange, disabledOption = () => false }) {
  return <div className="chartPrefGroup" role="group" aria-label={label}>
    <span className="chartPrefGroupLabel">{label}</span>
    <div className="chartSegmented">
      {options.map((item) => {
        const active = item.key === value;
        const disabled = disabledOption(item);
        return <button
          type="button"
          key={item.key}
          className={active ? "active" : ""}
          onClick={() => onChange?.(item.key)}
          disabled={disabled}
          aria-pressed={active}
          aria-label={`${label} ${item.label}`}
          title={disabled ? `${item.label} no aplica a esta temporalidad` : `${label}: ${item.label}`}
        >
          {item.label}
        </button>;
      })}
    </div>
  </div>;
}

export default function ChartPreferences({ settings, onChange, symbol = "", listId = "", scope = "global", onScopeChange, compact = false }) {
  const note = settings?.notes?.[symbol] || "";
  const indicators = { ...DEFAULT_CHART_SETTINGS.indicators, ...(settings?.indicators || {}) };
  const interval = normalizeChartInterval(settings?.interval || DEFAULT_CHART_SETTINGS.interval);
  const range = settings?.range || DEFAULT_CHART_SETTINGS.range;
  const rangeOptions = CHART_RANGES.filter((item) => !(interval === "M" && item.key === "MAX"));
  const activeRange = rangeOptions.some((item) => item.key === range) ? range : "5A";
  const scopes = [
    { key: "global", label: "Global" },
    symbol ? { key: "symbol", label: "Simbolo" } : null,
    listId ? { key: "list", label: "Lista" } : null,
  ].filter(Boolean);
  const update = (patch) => onChange?.({ ...settings, ...patch });

  useEffect(() => {
    const compatibleRange = compatibleRangeForInterval(interval, range);
    if (compatibleRange !== range) {
      onChange?.({ ...settings, range: compatibleRange });
    }
  }, [interval, range, onChange, settings]);

  const updateInterval = (value) => {
    const interval = normalizeChartInterval(value);
    update({
      interval,
      range: compatibleRangeForInterval(interval, settings?.range || DEFAULT_CHART_SETTINGS.range),
    });
  };
  const updateIndicators = (patch) => update({ indicators: { ...indicators, ...patch } });
  const updateNote = (value) => update({ notes: { ...(settings?.notes || {}), [symbol]: value } });

  const scopeSelect = scopes.length > 1 ? (
    <select aria-label="Preset de grafico" value={scope} onChange={(event) => onScopeChange?.(event.target.value)}>
      {scopes.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
    </select>
  ) : null;
  const rangeControl = (
    <ChartSegmentedControl
      label="Rango"
      options={rangeOptions}
      value={activeRange}
      onChange={(value) => update({ range: value })}
      disabledOption={(item) => !rangeIsCompatibleWithInterval(interval, item.key)}
    />
  );
  const intervalControl = (
    <ChartSegmentedControl
      label="Temporalidad"
      options={CHART_INTERVALS}
      value={interval}
      onChange={updateInterval}
    />
  );
  const styleSelect = (
    <select aria-label="Tipo de grafico" value={settings?.style || "1"} onChange={(event) => update({ style: event.target.value })}>
      {CHART_STYLES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
    </select>
  );
  const scaleControl = (
    <div className="segmented compactSeg">
      {CHART_SCALE_MODES.map((item) => (
        <button type="button" key={item.key} className={(settings?.scale || "price") === item.key ? "active" : ""} onClick={() => update({ scale: item.key })}>
          {item.label}
        </button>
      ))}
    </div>
  );
  const rsToggle = (
    <button
      type="button"
      className={`btn btnSmall ${indicators.rsLine ? "btnActive" : "btnGhost"}`}
      style={{ padding: "4px 10px", fontSize: 11, height: 32, display: "inline-flex", alignItems: "center", gap: 4, fontWeight: 600, borderRadius: "var(--radius)" }}
      onClick={() => updateIndicators({ rsLine: !indicators.rsLine })}
      title="Mostrar u ocultar la capa de RS global"
    >
      <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: indicators.rsLine ? "var(--accent)" : "rgba(255,255,255,0.2)" }} />
      RS
    </button>
  );
  const rsCountryToggle = (
    <button
      type="button"
      className={`btn btnSmall ${indicators.rsCountryLine ? "btnActive" : "btnGhost"}`}
      style={{ padding: "4px 10px", fontSize: 11, height: 32, display: "inline-flex", alignItems: "center", gap: 4, fontWeight: 600, borderRadius: "var(--radius)" }}
      onClick={() => updateIndicators({ rsCountryLine: !indicators.rsCountryLine })}
      title="Mostrar u ocultar la capa de RS país (ranking intra-mercado)"
    >
      <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: indicators.rsCountryLine ? "var(--soft)" : "rgba(255,255,255,0.2)" }} />
      RS país
    </button>
  );
  const rsThemeToggle = (
    <button
      type="button"
      className={`btn btnSmall ${indicators.rsThemeLine ? "btnActive" : "btnGhost"}`}
      style={{ padding: "4px 10px", fontSize: 11, height: 32, display: "inline-flex", alignItems: "center", gap: 4, fontWeight: 600, borderRadius: "var(--radius)" }}
      onClick={() => updateIndicators({ rsThemeLine: !indicators.rsThemeLine })}
      title="Mostrar u ocultar la capa de RS tema (ranking intra-ocupación)"
    >
      <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: indicators.rsThemeLine ? "var(--rs-theme)" : "rgba(255,255,255,0.2)" }} />
      RS tema
    </button>
  );
  const indicatorsPanel = (
    <details className="chartIndicators">
      <summary>Indicadores</summary>
      <div className="chartIndicatorPanel">
        <label><input type="checkbox" checked={indicators.volume} onChange={(event) => updateIndicators({ volume: event.target.checked })} /> Volumen</label>
        <label><input type="checkbox" checked={indicators.rsLine} onChange={(event) => updateIndicators({ rsLine: event.target.checked })} /> Fuerza relativa (global)</label>
        <label><input type="checkbox" checked={indicators.rsCountryLine} onChange={(event) => updateIndicators({ rsCountryLine: event.target.checked })} /> RS país</label>
        <label><input type="checkbox" checked={indicators.rsThemeLine} onChange={(event) => updateIndicators({ rsThemeLine: event.target.checked })} /> RS tema</label>
        <label><input type="checkbox" checked={indicators.maFast} onChange={(event) => updateIndicators({ maFast: event.target.checked })} /> Media 1</label>
        <input aria-label="Periodo media 1" type="number" min="2" max="400" value={indicators.maFastLength} onChange={(event) => updateIndicators({ maFastLength: event.target.value })} />
        <label><input type="checkbox" checked={indicators.maSlow} onChange={(event) => updateIndicators({ maSlow: event.target.checked })} /> Media 2</label>
        <input aria-label="Periodo media 2" type="number" min="2" max="600" value={indicators.maSlowLength} onChange={(event) => updateIndicators({ maSlowLength: event.target.value })} />
      </div>
    </details>
  );
  const notesPanel = symbol ? (
    <details className="chartNotes">
      <summary>Notas</summary>
      <textarea value={note} onChange={(event) => updateNote(event.target.value)} placeholder="Anotaciones privadas..." />
    </details>
  ) : null;

  return <div className={`chartPrefs ${compact ? "compact" : ""}`}>
    <div className="chartPrefsLine">
      {scopeSelect}
      {compact ? (
        <>
          <div className="chartPrefCluster chartPrefClusterScope">
            {rangeControl}
            {intervalControl}
          </div>
          <div className="chartPrefCluster chartPrefClusterDisplay">
            {styleSelect}
            {scaleControl}
            {rsToggle}
            {rsCountryToggle}
            {rsThemeToggle}
            {indicatorsPanel}
            {notesPanel}
          </div>
        </>
      ) : (
        <>
          {rangeControl}
          {intervalControl}
          {styleSelect}
          {scaleControl}
          {rsToggle}
          {rsCountryToggle}
          {rsThemeToggle}
          {indicatorsPanel}
          {notesPanel}
        </>
      )}
    </div>
  </div>;
}
