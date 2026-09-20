// lib/reviewMetricGrid.js — filas del grid de métricas de /review.
// RS / RS país / RS tema usan reviewRsDisplay (copy corto + title largo).

import { pct, ratio } from "@/lib/formatters";
import { canonicalRs } from "@/lib/rsCanonical";
import { countryRs } from "@/lib/countryRs";
import { themeRs } from "@/lib/themeRs";
import { reviewRsCell } from "@/lib/reviewRsDisplay";

function value(row = {}, key) {
  return row[key] ?? row.snapshot?.[key] ?? null;
}

function metricCell(label, text, title = "", className = "") {
  return { label, text, title, className };
}

/**
 * Grid de métricas de la ficha Review.
 * Cada entrada: { label, text, title, className }.
 */
export function buildReviewMetricRows(row = {}) {
  const rs = reviewRsCell(canonicalRs(row), {
    availableTitle: "RS semanal del universo",
  });
  const crs = reviewRsCell(countryRs(row), {
    availableTitle: "RS semanal del mercado local",
  });
  const trs = reviewRsCell(themeRs(row), {
    availableTitle: "RS semanal de la ocupación curada",
  });

  return [
    metricCell("RS", rs.text, rs.title, rs.className),
    metricCell("RS país", crs.text, crs.title, crs.className),
    metricCell("RS tema", trs.text, trs.title, trs.className),
    metricCell("3M", pct(value(row, "perf3m"))),
    metricCell("6M", pct(value(row, "perf6m"))),
    metricCell("12M", pct(value(row, "perf12m"))),
    metricCell("SMA50", pct(value(row, "extSma50"))),
    metricCell("Vol rel 20d", ratio(value(row, "relativeVolume"))),
    metricCell("Short float", pct(value(row, "shortPercentOfFloat"))),
    metricCell("Vol 63d", pct(value(row, "volatility63d"))),
    metricCell(
      "DD 63d",
      pct(Number.isFinite(value(row, "maxDrawdown63d")) ? -value(row, "maxDrawdown63d") : null),
    ),
    metricCell("R/Vol 3M", ratio(value(row, "returnToVol3m"))),
    metricCell("R/DD 3M", ratio(value(row, "returnToDrawdown3m"))),
  ];
}
