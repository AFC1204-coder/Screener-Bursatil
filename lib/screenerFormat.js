// lib/screenerFormat.js — helpers de formato/texto del screener.
// Funciones puras (sin JSX, sin React, sin estado). Extraídos de
// app/screenerPanels.jsx para que presentación y formato no se mezclen.
// NOTA: los números y fechas salen SIEMPRE de lib/formatters.js (capa única
// es-ES). Aquí solo quedan alias con nombre local (`money` = precio) y los
// helpers de texto propios del screener.

import { amount as sharedAmount, cap as sharedCap, priceMoney } from "@/lib/formatters";
import { assetDomainForName, assetDomainForSymbol } from "@/lib/companyAssets";
import { methodologyCompactDetailLine, methodologyCompactReasonLine, methodologySetupLabel } from "@/lib/methodologyDisplay";
import { objectiveMetricAuditStatusForRow } from "@/lib/objectiveMetricTruth";
import { compactBusinessSummary, domainFromUrl } from "@/lib/researchRow";
import { marketName } from "@/lib/screenerConfig";
import { DEFAULT_FILTER_LAYERS, EXECUTION_LAYERS } from "@/lib/screenerFilterCatalog";
import { metricSourceFromItem } from "@/app/components/ui/MetricSource";

// `money` = PRECIO (dos decimales siempre, es-ES). Antes recortaba los
// céntimos por encima de 100 ("1235 USD") mientras la ficha escribía
// "1.234,50": mismo dato, dos números.
export const money = (n, currency = "") => Number.isFinite(n) ? priceMoney(n, currency) : "-";
export const cap = sharedCap;
export const amount = (n, currency = "") => Number.isFinite(n) && n > 0 ? sharedAmount(n, currency) : "-";
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
  estimatedRow: "Datos no disponibles para este símbolo en este momento.",
  historyUnavailable: "Histórico no disponible para este símbolo.",
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

// Cuántas filas mostrar como "analizadas" en el panel de resultados
// (app/components/screener/ScreenerShell.jsx). SIEMPRE el tamaño real de
// `analyzedRows` — nunca un fallback al universo cargado en el navegador.
// Antes había `analyzedRows.length || resultsUniverse.length || 0`: como 0 es
// falsy en JS, un scan que procesó 0 filas (fallo temprano, o antes de correr
// ningún scan) mostraba el tamaño del universo pedido en su lugar — p.ej.
// "19 pasan · 10234 analizadas" cuando el scan real solo llegó a procesar 47
// símbolos. docs/timeout-scan-universo-2026-08-09.md.
export function analyzedCountForDisplay(analyzedRows) {
  return Array.isArray(analyzedRows) ? analyzedRows.length : 0;
}

// Mapeo de errores crudos del escaneo en servidor (Postgres/PostgREST, red) a
// su forma user-facing en español. Mismo principio que userFacingSearchError
// arriba: punto único para que el texto técnico ("canceling statement due to
// statement timeout", códigos HTTP de Supabase, errores de socket) NUNCA
// llegue crudo a la pantalla (app/components/screener/ScreenerShell.jsx, el
// banner `err`). El mensaje original NO se descarta — el caller lo manda a
// consola para depuración; aquí solo se decide qué ve el usuario.
// docs/timeout-scan-universo-2026-08-09.md documenta el caso que motivó esto:
// un escaneo de universo completo mostraba literalmente el error de Postgres.
const USER_FACING_SCAN_ERROR_PATTERNS = Object.freeze([
  {
    // Postgres aborta la consulta por exceder su statement_timeout. Es el caso
    // que motivó este mapeo — ver el documento citado arriba.
    test: /canceling statement due to statement timeout/i,
    message: "El servidor tardó demasiado en guardar el progreso del escaneo, probablemente porque el universo pedido era muy grande. Prueba con un universo más pequeño o inténtalo de nuevo en unos minutos.",
  },
  {
    // Aborto por el tope de tiempo que el propio servidor pone a sus llamadas a
    // Supabase (AbortSignal.timeout en lib/supabaseServer.js). El texto crudo lo
    // genera undici/Node, no nosotros, y varía según cómo se abortó:
    // "The operation was aborted due to timeout" (AbortSignal.timeout),
    // "This operation was aborted" / "The user aborted a request" (AbortController).
    // Va ANTES del patrón genérico de timeout porque la variante de
    // AbortSignal.timeout también contiene la palabra "timeout" y allí recibiría
    // un mensaje menos accionable. Caso motivador: el INSERT que crea el scan,
    // que hasta docs/upstream-timeout-2026-08-09.md no tenía tope ninguno.
    test: /\bAbortError\b|\bTimeoutError\b|\boperation was aborted\b|\baborted a request\b|\bsignal is aborted\b/i,
    message: "El escaneo se canceló porque la base de datos tardó demasiado en responder. Si pediste todo el universo, prueba con un universo más pequeño; si no, inténtalo de nuevo en unos minutos.",
  },
  {
    test: /\bETIMEDOUT\b|\btimed out\b|\btime-?out\b/i,
    message: "El servidor tardó demasiado en responder. Inténtalo de nuevo en unos minutos.",
  },
  {
    // "Failed to fetch" es el TypeError que lanza el propio navegador (fetch()
    // del cliente) cuando la conexión de red falla antes de llegar al
    // servidor; "fetch failed" es su equivalente en Node/undici (servidor).
    test: /\bECONNRESET\b|\bECONNREFUSED\b|\bfetch failed\b|\bfailed to fetch\b|\bnetwork\b.*\berror\b/i,
    message: "No se pudo conectar con el servidor. Comprueba tu conexión e inténtalo de nuevo.",
  },
  {
    // El texto lo compone lib/supabaseServer.js; se reconoce por el código
    // HTTP, no por el nombre del servicio (que ya no aparece en el mensaje).
    test: /\bHTTP 5\d\d\b/i,
    message: "El servidor tuvo un problema temporal al guardar los resultados. Inténtalo de nuevo en unos minutos.",
  },
]);

export function userFacingScanError(rawMessage) {
  const text = String(rawMessage == null ? "" : rawMessage).trim();
  if (!text) return "";
  const match = USER_FACING_SCAN_ERROR_PATTERNS.find((entry) => entry.test.test(text));
  if (match) return match.message;
  // Mensaje no reconocido: podría ser cualquier detalle interno de
  // Postgres/PostgREST — no lo pintamos crudo. El original queda en consola
  // (ver caller) para quien necesite depurar.
  return "El escaneo no se pudo completar por un problema del servidor. Inténtalo de nuevo; si el problema persiste, revisa la consola del navegador para más detalle.";
}

// Traductor general de errores de servicio: vive en lib/serviceErrors.js (sin
// dependencias, para que también lo pueda usar lógica pura de lib/) y se
// re-exporta aquí porque esta es la puerta de entrada habitual del screener a
// los helpers de texto.
export { DEFAULT_SERVICE_ERROR_MESSAGE, userFacingServiceError } from "@/lib/serviceErrors";

// Cartel de estado del escaneo de universo completo ANTES de lanzarlo
// (app/page.jsx, justo antes del POST /api/scan). Antes decía "Escaneando todo
// el universo: 10234/10234 acciones": esos dos números eran `symbols.length` y
// `base.length` —lo pedido y el universo cargado, iguales por definición en
// modo "todo el universo"— y no un contador de progreso. El usuario leía un
// 10234/10234 como "ya está todo analizado" cuando el análisis ni siquiera
// había empezado, y si la creación del scan fallaba el cartel se quedaba
// congelado en ese falso 100% (docs/upstream-timeout-2026-08-09.md, Parte B).
// Regla: aquí NUNCA va un recuento con forma "hechos/total". El recuento real
// lo escribe publishPartial, y solo tras un sondeo con respuesta del servidor.
export function scanPreparationStatus({ symbolsCount = 0, hadVisibleRows = false } = {}) {
  const parsed = Number(symbolsCount);
  const count = Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
  const scope = count ? `${count} acciones` : "el universo cargado";
  const tail = hadVisibleRows
    ? "Tabla visible congelada."
    : "Puedes detenerlo si tarda demasiado.";
  return `Preparando el escaneo de todo el universo (${scope}). Todavía no ha empezado el análisis. ${tail}`;
}

// Mensaje que se muestra en el banner `err` cuando classifyScanOutcome
// (lib/scanStatus.js) da "failed". Reutiliza userFacingScanError cuando hay
// un mensaje crudo del servidor que traducir (progress.error, p.ej. un
// timeout de Postgres). Cuando NO lo hay —progress.status:"failed" es un
// veredicto de calidad (mayoría de símbolos sin resultado utilizable, ver
// computeTerminalCompleteness en lib/scanStatus.js), no un error con texto
// propio— se explica en lenguaje llano qué significa, sin inventar un
// segundo mecanismo de traducción (docs/limite-600-scan-2026-08-09.md).
export function scanFailureExplanation(rawError) {
  const text = String(rawError == null ? "" : rawError).trim();
  if (text) return userFacingScanError(text);
  return "La mayoría de los símbolos analizados no se pudieron procesar correctamente.";
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
  return "Sin gráfico disponible";
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

export { ratio as ratioLabel } from "@/lib/formatters";

export function priorityTooltip(priority = null) {
  if (!priority) return "";
  const parts = (priority.components || []).map((item) => {
    const value = Number(item.value);
    const sign = Number.isFinite(value) && value >= 0 ? "+" : "";
    return `${item.label} ${sign}${Number.isFinite(value) ? Math.round(value) : "-"}`;
  });
  if (priority.issuePenalty) parts.push(`issues -${Math.round(priority.issuePenalty)}`);
  return [`Prioridad decisión ${Math.round(priority.score || 0)}`, ...parts].join(" · ");
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
      title: [status.label, status.detail || issueText, "No usar métricas objetivas sin revisar"].filter(Boolean).join(" · "),
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
      title: status.detail || "Sin auditoría de métricas objetivas",
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
      "Métricas objetivas auditadas",
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
  return metricSourceFromItem(item, "", "Métrica");
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
  if (!useRegime) off.push("régimen");
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
