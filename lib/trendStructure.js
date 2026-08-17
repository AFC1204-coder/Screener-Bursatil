function cleanText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function rowNumber(row = {}, key = "") {
  const value = row[key] ?? row.metrics?.[key] ?? row.growthMetrics?.[key] ?? row.raw?.[key] ?? row.snapshot?.[key];
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function rowText(row = {}, key = "") {
  return cleanText(row[key] ?? row.metrics?.[key] ?? row.raw?.[key] ?? row.snapshot?.[key] ?? "");
}

function pairIssue(left, right, check, detail) {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return "";
  return check(left, right) ? "" : detail;
}

// Las seis condiciones DIARIAS sobre las medias de 50/150/200 sesiones.
//
// No son un criterio de etapa: son los seis primeros criterios de la
// plantilla de tendencia de Minervini, y miden salud de corto plazo — "cómo
// está ahora mismo", no "en qué fase del ciclo está". Estuvieron dentro de
// `stage2RejectDetail` haciendo de filtro de etapa 2, que es lo que hacía que
// la etapa mostrada y la etapa filtrada fueran distintas
// (docs/auditoria-etapas-2026-08-16.md, C-15). No sobran: estaban mal
// etiquetadas. Ahora son un filtro propio, `requirePulso`.
//
// Nota: la media de 30 semanas NO aparece aquí, y es correcto que no aparezca.
// Esta función no decide etapas.
export function trendTemplateIssue(row = {}) {
  const price = rowNumber(row, "price");
  const sma50 = rowNumber(row, "sma50");
  const sma150 = rowNumber(row, "sma150");
  const sma200 = rowNumber(row, "sma200");
  const slope = rowNumber(row, "sma200Slope");

  return pairIssue(price, sma50, (a, b) => a > b, "Precio bajo SMA50 diaria")
    || pairIssue(price, sma150, (a, b) => a > b, "Precio bajo SMA150 diaria")
    || pairIssue(price, sma200, (a, b) => a > b, "Precio bajo SMA200 diaria")
    || pairIssue(sma50, sma150, (a, b) => a > b, "SMA50 diaria no supera SMA150")
    || pairIssue(sma150, sma200, (a, b) => a > b, "SMA150 diaria no supera SMA200")
    || (Number.isFinite(slope) && slope <= 0 ? "SMA200 diaria no sube" : "");
}

// Nombre anterior, conservado porque lib/stockRows.js lo consume para
// explicar la estructura diaria en la ficha, donde el texto sigue siendo el
// correcto. Mismo cálculo, un solo sitio.
export const dailyLeaderTrendIssue = trendTemplateIssue;

export function dailyLongBiasIssue(row = {}) {
  const price = rowNumber(row, "price");
  const sma200 = rowNumber(row, "sma200");
  const slope = rowNumber(row, "sma200Slope");

  if (Number.isFinite(price) && Number.isFinite(sma200) && price <= sma200) return "Precio bajo SMA200 diaria";
  if (Number.isFinite(slope) && slope < -2) return "SMA200 diaria cae con fuerza";
  return "";
}

export function isDailyStage2(row = {}) {
  const price = rowNumber(row, "price");
  const sma50 = rowNumber(row, "sma50");
  const sma150 = rowNumber(row, "sma150");
  const sma200 = rowNumber(row, "sma200");
  const slope = rowNumber(row, "sma200Slope");
  if (![price, sma50, sma150, sma200, slope].every(Number.isFinite)) return false;
  return price > sma50 && price > sma150 && price > sma200 && sma50 > sma150 && sma150 > sma200 && slope > 0;
}

// El filtro de etapa 2 comprueba LA ETAPA. Nada más.
//
// Antes esta puerta mezclaba dos criterios: exigía además las seis
// condiciones diarias cuando la etapa era 2, y dejaba pasar por la vía diaria
// valores que no estaban en etapa 2. Consecuencia medida sobre el nocturno
// del 16-08: 53 filas pasaban sin llevar la etiqueta "Etapa 2" y 182 que sí
// la llevaban quedaban fuera. Pedir "etapa 2" devolvía otra cosa.
//
// Quien quiera además la estructura diaria tiene `requirePulso`
// (trendTemplateIssue), que es un filtro aparte y compone con este.
export function stage2RejectDetail(row = {}, settings = {}) {
  const weeklyState = rowText(row, "weeklyStageState");
  const weeklyLabel = rowText(row, "weeklyStageLabel") || "sin dato";
  const slowWeeks = rowNumber(row, "weeklySlowWeeks") ?? Number(settings.stageSlowWeeks || 30);

  if (!weeklyState) {
    return `Sin etapa semanal: faltan barras para la media de ${slowWeeks || 30} semanas`;
  }
  if (weeklyState === "insufficient_history") {
    return `Histórico semanal insuficiente para la media de ${slowWeeks || 30} semanas`;
  }
  if (weeklyState === "stage2") return "";
  return `No está en etapa 2: ${weeklyLabel}`;
}

export function isConfirmedStage2(row = {}, settings = {}) {
  return !stage2RejectDetail(row, settings);
}

// Filtro "Pulso": las seis condiciones diarias, con su nombre. Devuelve el
// motivo del rechazo o "" si las cumple todas.
export function pulsoRejectDetail(row = {}) {
  return trendTemplateIssue(row);
}
