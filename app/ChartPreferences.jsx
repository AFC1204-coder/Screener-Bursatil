"use client";
import { CHART_INTERVALS, CHART_RANGES, CHART_SCALE_MODES, CHART_STYLES, DEFAULT_CHART_SETTINGS } from "@/lib/chartSettings";

export default function ChartPreferences({ settings, onChange, symbol = "", compact = false }) {
  const note = settings?.notes?.[symbol] || "";
  const indicators = { ...DEFAULT_CHART_SETTINGS.indicators, ...(settings?.indicators || {}) };
  const update = (patch) => onChange?.({ ...settings, ...patch });
  const updateIndicators = (patch) => update({ indicators: { ...indicators, ...patch } });
  const updateNote = (value) => update({ notes: { ...(settings?.notes || {}), [symbol]: value } });
  return <div className={`chartPrefs ${compact ? "compact" : ""}`}>
    <div className="chartPrefsLine">
      <select aria-label="Rango" value={settings?.range || "1A"} onChange={(event) => update({ range: event.target.value })}>
        {CHART_RANGES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
      </select>
      <select aria-label="Temporalidad" value={settings?.interval || "D"} onChange={(event) => update({ interval: event.target.value })}>
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
      <details className="chartIndicators">
        <summary>Indicadores</summary>
        <div className="chartIndicatorPanel">
          <label><input type="checkbox" checked={indicators.volume} onChange={(event) => updateIndicators({ volume: event.target.checked })} /> Volumen</label>
          <label><input type="checkbox" checked={indicators.rsLine} onChange={(event) => updateIndicators({ rsLine: event.target.checked })} /> Linea RS</label>
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
