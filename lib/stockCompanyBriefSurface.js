// Superficie del panel «Negocio» en /stock — estados loading / ok / vacío / error
// y celdas RS país/tema con el mismo copy corto que Review (reviewRsDisplay).

import { shouldShowCountryRsOnIdentityCard, isUsStockMarket } from "@/lib/chartIdentityCard";
import { reviewRsCell } from "@/lib/reviewRsDisplay";
import { canonicalBriefRs } from "@/lib/rsCanonical";

const YAHOO_NO_SUMMARY = /^Yahoo no ofrece/i;
const DEGRADED_SUMMARY = /ficha degradada|proveedor no respond/i;

export function companyBriefSummaryText(data = {}) {
  const summary = String(data?.summary || "").replace(/\s+/g, " ").trim();
  if (summary && !YAHOO_NO_SUMMARY.test(summary) && !DEGRADED_SUMMARY.test(summary)) {
    return summary;
  }
  const short = String(data?.short || "").replace(/\s+/g, " ").trim();
  if (short && !YAHOO_NO_SUMMARY.test(short) && !DEGRADED_SUMMARY.test(short)) {
    return short;
  }
  return "";
}

function briefRsCell({ value, reason, availableTitle }) {
  const numeric = value == null || value === "" ? NaN : Number(value);
  const available = Number.isFinite(numeric);
  return reviewRsCell(
    available
      ? { available: true, value: numeric, reason: "", hydrated: true }
      : { available: false, value: null, reason: String(reason || "").trim(), hydrated: true },
    { availableTitle },
  );
}

export function stockCompanyBriefRsCells(data = {}, symbol = "") {
  const rs = data?.relativeStrength || {};
  const rsUniverse = canonicalBriefRs(rs);
  const countryCell = briefRsCell({
    value: rs.countryRsRating,
    reason: rs.countryRsReason,
    availableTitle: "RS semanal de país",
  });
  const themeCell = briefRsCell({
    value: rs.themeRsRating,
    reason: rs.themeRsReason,
    availableTitle: "RS semanal de tema",
  });
  const showCountry = shouldShowCountryRsOnIdentityCard({
    rsValue: rsUniverse,
    countryRsValue: Number.isFinite(rs.countryRsRating) ? rs.countryRsRating : null,
    isUsMarket: isUsStockMarket(data, symbol),
  });
  const rows = [];
  if (showCountry) {
    rows.push({ key: "country", label: "RS país", cell: countryCell });
  }
  if (data?.theme || rs.themeRsRating != null || rs.themeRsReason) {
    rows.push({ key: "theme", label: "RS tema", cell: themeCell });
  }
  return rows;
}

/**
 * @returns {{
 *   state: "loading"|"ok"|"empty"|"error",
 *   message: string,
 *   summary: string,
 *   themeLabel: string,
 *   rsRows: Array<{ key: string, label: string, cell: object }>,
 * }}
 */
export function resolveStockCompanyBriefSurface({
  data = null,
  loading = false,
  error = "",
  symbol = "",
} = {}) {
  const cleanError = String(error || "").trim();
  if (cleanError) {
    return {
      state: "error",
      message: cleanError,
      summary: "",
      themeLabel: "",
      rsRows: [],
    };
  }

  if (!data) {
    return {
      state: "loading",
      message: loading ? "Cargando descripción del negocio…" : "Cargando descripción del negocio…",
      summary: "",
      themeLabel: "",
      rsRows: [],
    };
  }

  if (data.notFound) {
    return {
      state: "empty",
      message: "No hay ficha de empresa para este símbolo.",
      summary: "",
      themeLabel: "",
      rsRows: [],
    };
  }

  const themeLabel = String(data.theme || data.sector || "").trim() || "Sin clasificar";
  const rsRows = stockCompanyBriefRsCells(data, symbol);
  const summary = companyBriefSummaryText(data);
  const degraded = Boolean(data.dataQuality?.degraded || data.dataQuality?.unavailable);

  if (!summary) {
    const providerNote = String(data.growthMetrics?.providerNote || "").trim();
    const message = degraded
      ? (providerNote || "Descripción no disponible: el proveedor no respondió a tiempo.")
      : "Sin descripción de negocio disponible para este valor.";
    return {
      state: "empty",
      message,
      summary: "",
      themeLabel,
      rsRows,
    };
  }

  return {
    state: "ok",
    message: "",
    summary,
    themeLabel,
    rsRows,
  };
}
