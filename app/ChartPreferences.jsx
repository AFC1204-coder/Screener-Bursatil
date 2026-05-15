"use client";
import { CHART_INTERVALS, CHART_RANGES, CHART_STYLES } from "@/lib/chartSettings";

export default function ChartPreferences({ settings, onChange, symbol = "", compact = false }) {
  const note = settings?.notes?.[symbol] || "";
  const update = (patch) => onChange?.({ ...settings, ...patch });
  const updateNote = (value) => update({ notes: { ...(settings?.notes || {}), [symbol]: value } });
  return <div className={`chartPrefs ${compact ? "compact" : ""}`}>
    <div className="chartPrefsLine">
      <div className="segmented compactSeg">
        {CHART_RANGES.map((item) => (
          <button type="button" key={item.key} className={settings?.range === item.key ? "active" : ""} onClick={() => update({ range: item.key })}>
            {item.label}
          </button>
        ))}
      </div>
      <div className="segmented compactSeg">
        {CHART_INTERVALS.map((item) => (
          <button type="button" key={item.key} className={settings?.interval === item.key ? "active" : ""} onClick={() => update({ interval: item.key })}>
            {item.label}
          </button>
        ))}
      </div>
      <select aria-label="Tipo de grafico" value={settings?.style || "1"} onChange={(event) => update({ style: event.target.value })}>
        {CHART_STYLES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
      </select>
      {symbol && <details className="chartNotes">
        <summary>Notas</summary>
        <textarea value={note} onChange={(event) => updateNote(event.target.value)} placeholder="Anotaciones privadas..." />
      </details>}
    </div>
  </div>;
}
