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

  // Dato ausente = NO cumple (decisión del dueño, 2026-11-10; misma política que
  // lib/missingDataPolicy.js: rechazar y contar aparte como «sin dato»). Antes una fila sin
  // medias pasaba el Pulso en silencio. El texto termina en «sin dato» para poder contarlo.
  const missing = [
    [price, "Precio"],
    [sma50, "SMA50 diaria"],
    [sma150, "SMA150 diaria"],
    [sma200, "SMA200 diaria"],
    [slope, "Pendiente SMA200"],
  ].filter(([value]) => !Number.isFinite(value)).map(([, label]) => label);
  if (missing.length) return `${missing.join(", ")} sin dato`;

  return pairIssue(price, sma50, (a, b) => a > b, "Precio bajo SMA50 diaria")
    || pairIssue(price, sma150, (a, b) => a > b, "Precio bajo SMA150 diaria")
    || pairIssue(price, sma200, (a, b) => a > b, "Precio bajo SMA200 diaria")
    || pairIssue(sma50, sma150, (a, b) => a > b, "SMA50 diaria no supera SMA150")
    || pairIssue(sma150, sma200, (a, b) => a > b, "SMA150 diaria no supera SMA200")
    || (slope <= 0 ? "SMA200 diaria no sube" : "");
}

// Criterios 6-8 de la plantilla de tendencia de Minervini (decisión del dueño, 2026-11-10):
//   6. precio al menos un 30 % sobre el mínimo de 52 semanas (25-30 % = «casi cumple»),
//   7. precio a no más de un 25 % por debajo del máximo de 52 semanas,
//   8. RS relativa ≥ 70.
// Función APARTE de `trendTemplateIssue` a propósito: el filtro «Pulso» sigue midiendo las seis
// condiciones diarias. Conectar estos tres al Pulso (o a un filtro nuevo) cambia lo que
// significa ese filtro y necesita decisión y aviso de interfaz. Dato ausente = no cumple.
export const TREND_TEMPLATE_LOW_ADVANCE_MIN_PCT = 30;
export const TREND_TEMPLATE_LOW_ADVANCE_NEAR_PCT = 25;
export const TREND_TEMPLATE_HIGH_DISTANCE_MAX_PCT = 25;
export const TREND_TEMPLATE_RS_MIN = 70;

export function trendTemplateExtendedStatus(row = {}) {
  const lowAdvance = rowNumber(row, "lowAdvance52w");
  const distHigh = rowNumber(row, "distance52w");
  const rs = rowNumber(row, "rsGlobalPct");
  const issues = [];
  let nearMiss = false;

  if (!Number.isFinite(lowAdvance)) issues.push("Avance sobre mínimo 52s sin dato");
  else if (lowAdvance < TREND_TEMPLATE_LOW_ADVANCE_MIN_PCT) {
    if (lowAdvance >= TREND_TEMPLATE_LOW_ADVANCE_NEAR_PCT) nearMiss = true;
    issues.push(`Solo ${lowAdvance.toFixed(0)} % sobre el mínimo de 52s (pide ${TREND_TEMPLATE_LOW_ADVANCE_MIN_PCT} %)`);
  }

  // distance52w es negativa bajo el máximo (-12 = 12 % por debajo).
  if (!Number.isFinite(distHigh)) issues.push("Distancia al máximo 52s sin dato");
  else if (distHigh < -TREND_TEMPLATE_HIGH_DISTANCE_MAX_PCT) {
    issues.push(`A ${Math.abs(distHigh).toFixed(0)} % del máximo de 52s (pide ≤ ${TREND_TEMPLATE_HIGH_DISTANCE_MAX_PCT} %)`);
  }

  if (!Number.isFinite(rs)) issues.push("RS sin dato");
  else if (rs < TREND_TEMPLATE_RS_MIN) issues.push(`RS ${rs.toFixed(0)} (pide ≥ ${TREND_TEMPLATE_RS_MIN})`);

  const hardIssues = issues.length - (nearMiss ? 1 : 0);
  return { pass: issues.length === 0, nearMiss: nearMiss && hardIssues === 0, issues };
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
