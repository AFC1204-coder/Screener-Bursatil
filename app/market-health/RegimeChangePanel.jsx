"use client";
// MH-FILL-6 — «Qué cambió»: Δ semanal del régimen US bajo el hero.

import { MissingValue } from "@/lib/screenerColumns";
import { dateShort, num, pctShare } from "@/lib/formatters";
import { regimeSeriesDelta } from "@/lib/marketHealthSeries";

function Sparkline({ values = [], ariaLabel = "" }) {
  const finite = values.filter(Number.isFinite);
  if (finite.length < 2) return null;
  const width = 220;
  const height = 34;
  const pad = 3;
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const span = max - min || 1;
  const step = (width - pad * 2) / (values.length - 1);
  const points = values
    .map((value, index) => Number.isFinite(value)
      ? `${(pad + index * step).toFixed(1)},${(height - pad - ((value - min) / span) * (height - pad * 2)).toFixed(1)}`
      : null)
    .filter(Boolean)
    .join(" ");
  return (
    <svg className="marketBreadthSpark" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel} preserveAspectRatio="none">
      <polyline points={points} fill="none" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function formatDelta(value, { suffix = "", signed = true } = {}) {
  if (!Number.isFinite(value)) return "—";
  const rounded = Math.abs(value) >= 10 ? value.toFixed(0) : value.toFixed(1);
  if (!signed) return `${rounded}${suffix}`;
  const prefix = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${prefix}${Math.abs(Number(rounded))}${suffix}`;
}

export default function RegimeChangePanel({ regimeSeries = null }) {
  const points = Array.isArray(regimeSeries?.points) ? regimeSeries.points : [];
  if (points.length < 2) {
    return (
      <div className="marketRegimeChange" data-empty="true" data-testid="regime-change-panel">
        <div className="marketRegimeChangeHead">
          <h3>Qué cambió</h3>
          <span className="fine">Serie semanal US</span>
        </div>
        <p className="marketRegimeChangeEmpty">
          <MissingValue reason="Hace falta al menos dos semanas distintas en la serie del régimen para comparar evolución." />
        </p>
      </div>
    );
  }

  const delta = regimeSeriesDelta(points);
  const scoreValues = points.map((p) => p.marketScore);
  const amplitudeValues = points.map((p) => p.above30wPct);
  const first = points[0];
  const last = points.at(-1);

  return (
    <div className="marketRegimeChange" data-testid="regime-change-panel">
      <div className="marketRegimeChangeHead">
        <h3>Qué cambió</h3>
        <span className="fine">
          {dateShort(first.asOf)} → {dateShort(last.asOf)} · {points.length} semanas
        </span>
      </div>
      {delta && (
        <p className="marketRegimeChangeSummary">
          Vs semana previa ({delta.previous.weekKey} → {delta.current.weekKey}): market score{" "}
          <b>{formatDelta(delta.marketScoreDelta)}</b>
          {Number.isFinite(delta.above30wPctDelta) && (
            <> · universo sobre MM30s <b>{formatDelta(delta.above30wPctDelta, { suffix: " pp" })}</b></>
          )}
          {delta.current.regimeLabel && <> · régimen «{delta.current.regimeLabel}»</>}.
        </p>
      )}
      <div className="marketRegimeChangeSparks">
        <div className="marketBreadthSparkRow">
          <span className="marketBreadthSparkLabel">Market score</span>
          <span className="marketBreadthSparkValue"><b>{num(first.marketScore)}</b></span>
          <Sparkline values={scoreValues} ariaLabel="Evolución semanal del market score US" />
          <span className="marketBreadthSparkValue"><b>{num(last.marketScore)}</b></span>
        </div>
        <div className="marketBreadthSparkRow">
          <span className="marketBreadthSparkLabel">Sobre MM30s</span>
          <span className="marketBreadthSparkValue"><b>{pctShare(first.above30wPct)}</b></span>
          <Sparkline values={amplitudeValues} ariaLabel="Evolución semanal del porcentaje del universo US sobre MM30s" />
          <span className="marketBreadthSparkValue"><b>{pctShare(last.above30wPct)}</b></span>
        </div>
      </div>
      <ol className="marketRegimeChangeList">
        {points.slice(-5).reverse().map((point) => (
          <li key={point.weekKey}>
            <span>{point.weekKey}</span>
            <span>{num(point.marketScore)}</span>
            <span>{pctShare(point.above30wPct)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
