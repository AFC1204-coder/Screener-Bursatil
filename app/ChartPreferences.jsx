"use client";
import { useEffect } from "react";
import { CHART_INTERVALS, CHART_RANGES, CHART_SCALE_MODES, CHART_STYLES, DEFAULT_CHART_SETTINGS, normalizeChartInterval } from "@/lib/chartSettings";

function compatibleRangeForInterval(nextInterval = DEFAULT_CHART_SETTINGS.interval, currentRange = DEFAULT_CHART_SETTINGS.range) {
  const interval = normalizeChartInterval(nextInterval);
  if (interval === "1m") return "1D";
  if (["5m", "15m", "30m"].includes(interval)) return "5D";
  if (interval === "1H") return "1M";
  if (interval === "4H") return "3M";
  if (interval === "D") return "1A";
  if (interval === "W") return "5A";
  if (interval === "M") return "5A";
  return currentRange;
}

export default function ChartPreferences({ settings, onChange, symbol = "", listId = "", scope = "global", onScopeChange, compact = false }) {
  const note = settings?.notes?.[symbol] || "";
  const indicators = { ...DEFAULT_CHART_SETTINGS.indicators, ...(settings?.indicators || {}) };
  const interval = normalizeChartInterval(settings?.interval || DEFAULT_CHART_SETTINGS.interval);
  const range = settings?.range || DEFAULT_CHART_SETTINGS.range;
  const rangeOptions = CHART_RANGES.filter((item) => !(interval === "M" && item.key === "MAX"));
  const scopes = [
    { key: "global", label: "Global" },
    symbol ? { key: "symbol", label: "Simbolo" } : null,
    listId ? { key: "list", label: "Lista" } : null,
  ].filter(Boolean);
  const update = (patch) => onChange?.({ ...settings, ...patch });

  useEffect(() => {
    if (interval === "M" && range === "MAX") {
      onChange?.({ ...settings, range: "5A" });
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
  return <div className={`chartPrefs ${compact ? "compact" : ""}`}>
    <div className="chartPrefsLine">
      {scopes.length > 1 && <select aria-label="Preset de grafico" value={scope} onChange={(event) => onScopeChange?.(event.target.value)}>
        {scopes.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
      </select>}
      <select aria-label="Rango" value={rangeOptions.some((item) => item.key === range) ? range : "5A"} onChange={(event) => update({ range: event.target.value })}>
        {rangeOptions.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
      </select>
      <select aria-label="Temporalidad" value={interval} onChange={(event) => updateInterval(event.target.value)}>
        {CHART_INTERVALS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
      </select>
      <select aria-label="Tipo de grafico" value={settings?.style || "1"} onChange={(event) => update({ style: event.target.value })}>
        {CHART_STYLES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
      </select>
      <div className="segmented compactSeg">
        {CHART_SCALE_MODES.map((item) => (
          <button type="button" key={item.key} className={(settings?.scale || "price") === item.key ? "active" : ""} onClick={() => update({ scale: item.key })}>
            {item.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        className={`btn btnSmall ${indicators.rsLine ? "btnActive" : "btnGhost"}`}
        style={{ padding: "4px 10px", fontSize: 11, height: 32, display: "inline-flex", alignItems: "center", gap: 4, fontWeight: 600, borderRadius: "var(--radius)" }}
        onClick={() => updateIndicators({ rsLine: !indicators.rsLine })}
        title="Mostrar u ocultar la capa de fuerza relativa"
      >
        <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: indicators.rsLine ? "var(--accent)" : "rgba(255,255,255,0.2)" }} />
        RS
      </button>
      <details className="chartIndicators">
        <summary>Indicadores</summary>
        <div className="chartIndicatorPanel">
          <label><input type="checkbox" checked={indicators.volume} onChange={(event) => updateIndicators({ volume: event.target.checked })} /> Volumen</label>
          <label><input type="checkbox" checked={indicators.rsLine} onChange={(event) => updateIndicators({ rsLine: event.target.checked })} /> Fuerza relativa</label>
          <label><input type="checkbox" checked={indicators.maFast} onChange={(event) => updateIndicators({ maFast: event.target.checked })} /> Media 1</label>
          <input aria-label="Periodo media 1" type="number" min="2" max="400" value={indicators.maFastLength} onChange={(event) => updateIndicators({ maFastLength: event.target.value })} />
          <label><input type="checkbox" checked={indicators.maSlow} onChange={(event) => updateIndicators({ maSlow: event.target.checked })} /> Media 2</label>
          <input aria-label="Periodo media 2" type="number" min="2" max="600" value={indicators.maSlowLength} onChange={(event) => updateIndicators({ maSlowLength: event.target.value })} />
        </div>
      </details>
      {symbol && <details className="chartNotes">
        <summary>Notas</summary>
        <textarea value={note} onChange={(event) => updateNote(event.target.value)} placeholder="Anotaciones privadas..." />
      </details>}
    </div>
  </div>;
}
