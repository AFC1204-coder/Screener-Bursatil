// lib/screenerFormat.js — helpers de formato/texto del screener.
// Funciones puras (sin JSX, sin React, sin estado). Extraídos de
// app/screenerPanels.jsx para que presentación y formato no se mezclen.
// NOTA: `money`/`cap` aquí son específicos del screener (precio / market cap)
// y difieren de los de lib/formatters.js — no consolidar sin renombrar.

import { assetDomainForName, assetDomainForSymbol } from "@/lib/companyAssets";
import { methodologyCompactDetailLine, methodologyCompactReasonLine, methodologySetupLabel } from "@/lib/methodologyDisplay";
import { objectiveMetricAuditStatusForRow } from "@/lib/objectiveMetricTruth";
import { compactBusinessSummary, domainFromUrl } from "@/lib/researchRow";
import { marketName } from "@/lib/screenerConfig";
import { DEFAULT_FILTER_LAYERS, EXECUTION_LAYERS } from "@/lib/screenerFilterCatalog";
import { metricSourceFromItem } from "@/app/components/ui/MetricSource";

export const money = (n, currency = "") => Number.isFinite(n) ? `${n >= 100 ? n.toFixed(0) : n.toFixed(2)}${currency ? ` ${currency}` : ""}` : "-";
export const cap = (n) => Number.isFinite(n) && n > 0 ? n >= 1000000000000 ? `${(n / 1000000000000).toFixed(2)}T` : n >= 1000000000 ? `${(n / 1000000000).toFixed(1)}B` : n >= 1000000 ? `${(n / 1000000).toFixed(0)}M` : `${n.toFixed(0)}` : "-";
export const amount = (n, currency = "") => Number.isFinite(n) && n > 0 ? `${cap(n)}${currency ? ` ${currency}` : ""}` : "-";
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const searchText = (value = "") => String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

// Mapeo de mensajes de error internos (guards de dataQuality / chart) a su forma
// user-facing en español. Punto único para que los strings técnicos de los guards
// ("Serie estimada excluida de ...", "Historico estimado/no disponible") NUNCA
// lleguen crudos a la UI. Cualquier mensaje que NO sea de estos dos guards pasa
// tal cual (ej. "Proveedor no disponible" tras un fallo de red real).
//
// Por diseño NO filtra la palabra "estimado" de la copia final user-facing —
// filtra los marcadores internos completos. La salida es español neutro, sin
// jerga de proveedor ni detalles de implementación.
const USER_FACING_DATA_QUALITY_MESSAGES = Object.freeze({
  estimatedRow: "Datos no disponibles para este simbolo en este momento.",
  historyUnavailable: "Historico no disponible para este simbolo.",
});

export function userFacingSearchError(rawMessage) {
  const text = String(rawMessage == null ? "" : rawMessage);
  if (!text) return "";
  // Guard de decisión (lib/chartDataQuality.js → assertDecisionGrade, llamado
  // desde buildResearchRow y materializedScanner). El contexto variable
  // ("research row", "scoring", "decisión", ...) descarta el sufijo.
  if (/^Serie estimada excluida de /.test(text)) {
    return USER_FACING_DATA_QUALITY_MESSAGES.estimatedRow;
  }
  // Guard de review (app/review/page.jsx → "Historico estimado/no disponible")
  // y variantes sueltas del mismo marcador interno ("Historico estimado",
  // "Historico insuficiente") en company-brief / stock / research-desk. Todas
  // son el mismo concepto operacional: el chart no es decision-grade y el
  // caller lo está propagando a la UI sin traducir.
  if (
    /Historico estimado\/no disponible/.test(text) ||
    /^Historico estimado\b/.test(text) ||
    /^Historico insuficiente\b/.test(text)
  ) {
    return USER_FACING_DATA_QUALITY_MESSAGES.historyUnavailable;
  }
  return text;
}

// Prioridad para el placeholder del chart de review: error > loading > vacío.
// Trata error vacío/solo-espacios como "sin error" para no mostrar un placeholder
// engañoso cuando el caller propaga un string residual. Es deliberadamente
// opuesto al flujo "searchError" del screener — aquí el usuario siempre debe
// ver ALGO (mensaje de error, mensaje de carga o copy estático de "no hay
// gráfico"), nunca un hueco silencioso.
export function reviewChartPlaceholder({ error, loading } = {}) {
  const errorText = String(error == null ? "" : error).trim();
  if (errorText) return errorText;
  if (loading) return "Cargando datos...";
  return "Sin grafico disponible";
}

export function investorStatusLabel(text = "") {
  return String(text || "")
    .replaceAll("Supabase", "nube")
    .replaceAll("localStorage", "modo local")
    .replaceAll("Proveedor", "Datos")
    .replaceAll("proveedor", "datos")
    .replaceAll("Yahoo/mercado", "mercado")
    .replaceAll("Yahoo", "fuente de mercado");
}

export const ratioLabel = (n) => Number.isFinite(n) ? `${n.toFixed(2)}x` : "-";

export function priorityTooltip(priority = null) {
  if (!priority) return "";
  const parts = (priority.components || []).map((item) => {
    const value = Number(item.value);
    const sign = Number.isFinite(value) && value >= 0 ? "+" : "";
    return `${item.label} ${sign}${Number.isFinite(value) ? Math.round(value) : "-"}`;
  });
  if (priority.issuePenalty) parts.push(`issues -${Math.round(priority.issuePenalty)}`);
  return [`Prioridad decision ${Math.round(priority.score || 0)}`, ...parts].join(" · ");
}

export function initials(name = "", symbol = "") {
  return String(name || symbol).split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]?.toUpperCase()).join("") || String(symbol).slice(0, 2).toUpperCase() || "SE";
}

export function shortBusiness(row = {}) {
  return [row.industry, row.sector, row.theme].filter((value, index, arr) => value && value !== "Sin industria" && value !== "Sin sector" && arr.indexOf(value) === index).slice(0, 3).join(" · ") || row.businessEs || row.exchange || "";
}

export function quickBusinessDescription(row = {}) {
  const summary = compactBusinessSummary(row.businessSummary, 300);
  if (summary) return summary;
  const activity = shortBusiness(row);
  if (activity) return `${row.companyName || row.symbol} opera en ${activity}.`;
  return "Descripción de negocio no disponible en el proveedor.";
}

export function quickBusinessMarket(row = {}) {
  return [marketName(row.country), row.exchange].filter((value, index, arr) => value && value !== "-" && arr.indexOf(value) === index).join(" · ") || "-";
}

export function chartPath(points, key, x, y) {
  let open = false;
  return points.map((p, i) => {
    const value = p[key];
    if (!Number.isFinite(value)) {
      open = false;
      return "";
    }
    const cmd = open ? "L" : "M";
    open = true;
    return `${cmd}${x(i).toFixed(1)},${y(value).toFixed(1)}`;
  }).filter(Boolean).join(" ");
}

export function companyLogoDomain(row = {}) {
  return row.logoDomain || domainFromUrl(row.website || "") || assetDomainForSymbol(row.symbol) || assetDomainForName(row.companyName || row.name);
}

export function quickSetup(row) {
  if (!row) return "Sin dato";
  return methodologySetupLabel(row);
}

export function compactPatternReason(row = {}) {
  return methodologyCompactReasonLine(row);
}

export function compactPatternDetail(row = {}) {
  return methodologyCompactDetailLine(row);
}

export function objectiveMetricCompactState(row = {}) {
  const status = objectiveMetricAuditStatusForRow(row);
  const audit = status.audit || null;
  const items = Array.isArray(audit?.items) ? audit.items : [];
  const usable = items.filter((item) => ["verified", "traceable"].includes(item.status));
  const proxyCount = usable.filter((item) => item.proxy === true).length;
  const measuredCount = usable.filter((item) => item.proxy !== true).length;
  const issueText = Array.isArray(audit?.issues) && audit.issues.length
    ? audit.issues.slice(0, 4).map((item) => `${item.label || item.key}: ${item.status}`).join(" · ")
    : "";
  if (status.key === "bad") {
    return {
      key: "blocked",
      label: "Bloq.",
      tone: "bad",
      title: [status.label, status.detail || issueText, "No usar metricas objetivas sin revisar"].filter(Boolean).join(" · "),
      measuredCount,
      proxyCount,
      issueCount: Array.isArray(audit?.issues) ? audit.issues.length : 0,
    };
  }
  if (status.key === "warn") {
    return {
      key: "review",
      label: "Rev.",
      tone: "warn",
      title: [status.label, status.detail || issueText, `${measuredCount} medidas · ${proxyCount} proxy`].filter(Boolean).join(" · "),
      measuredCount,
      proxyCount,
      issueCount: Array.isArray(audit?.issues) ? audit.issues.length : 0,
    };
  }
  if (status.key === "missing") {
    return {
      key: "missing",
      label: "Sin audit",
      tone: "warn",
      title: status.detail || "Sin auditoria de metricas objetivas",
      measuredCount: 0,
      proxyCount: 0,
      issueCount: 1,
    };
  }
  return {
    key: proxyCount ? "mixed" : "measured",
    label: proxyCount ? "Mixto" : "Med.",
    tone: proxyCount ? "neutral" : "good",
    measuredCount,
    proxyCount,
    issueCount: 0,
    title: [
      "Metricas objetivas auditadas",
      `${measuredCount} medidas`,
      proxyCount ? `${proxyCount} proxy/estimadas` : "",
      status.detail,
    ].filter(Boolean).join(" · "),
  };
}

export function compactTone(value, strongAt, weakBelow = null) {
  if (!Number.isFinite(value)) return "";
  if (value >= strongAt) return "good";
  if (Number.isFinite(weakBelow) && value < weakBelow) return "soft";
  return "";
}

export function compactMetricSource(item = null) {
  return metricSourceFromItem(item, "", "Metrica");
}

export function compactMetricSourceLookup(row = {}) {
  const audit = objectiveMetricAuditStatusForRow(row)?.audit;
  const items = Array.isArray(audit?.items) ? audit.items : [];
  const byKey = new Map(items.filter((item) => item?.key).map((item) => [item.key, item]));
  return (key) => compactMetricSource(byKey.get(key));
}

export function activeLayerCount(layers = {}) {
  return Object.values(layers).filter(Boolean).length;
}

export function ruleCountLabel(count = 0, singular = "regla", plural = "reglas") {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function layerStatusText(layers = DEFAULT_FILTER_LAYERS, useRegime = true) {
  const off = EXECUTION_LAYERS.filter((x) => !layers[x.key]).map((x) => x.label.toLowerCase());
  if (!useRegime) off.push("regimen");
  return off.length ? `capas off: ${off.join(", ")}` : "todas las capas activas";
}

export function compactIssueLabel(label = "", key = "") {
  const text = String(label || key || "").toLowerCase();
  if (/\brs\b|liderazgo rs/.test(text)) return "RS";
  if (/\bscore\b/.test(text)) return "Score";
  if (/\bsma50\b/.test(text)) return "SMA50";
  if (/evidencia|prueba/.test(text)) return "Pruebas";
  if (/\bdatos?\b|\bprecio\b/.test(text)) return "Datos";
  if (/volumen|demanda/.test(text)) return "Demanda";
  if (/riesgo/.test(text)) return "Riesgo";
  if (/setup|vcp/.test(text)) return "Setup";
  if (/operable|candidato|confirmaci/.test(text)) return "Validar";
  return String(label || key || "Revisar").split(/\s+/).slice(0, 2).join(" ");
}

export function vcpCompactLabel(audit = null) {
  const key = audit?.key || "";
  if (key === "audit-ready") return "Audit.";
  if (key === "needs-validation") return "Valid.";
  if (key === "summary-only") return "Resumen";
  if (key === "needs-data") return "Datos";
  if (key === "inconsistent") return "Rev.";
  if (key === "blocked") return "Bloq.";
  return "VCP";
}
