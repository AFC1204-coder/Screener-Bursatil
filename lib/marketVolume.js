// lib/marketVolume.js — indicadores de volumen agregados sobre el escaneo
// nocturno, calculados sobre los campos que ya publica scan_results al 100 %
// de cobertura: upDownVolRatio (50d), volumeDryUpRatio (10d/50d), volumeSurgePct
// (5d/20d) y latestVolume (última sesión).
//
// Documento de origen: docs/diseno-indicadores-mercado-2026-08-17.md, Parte C.
// Las cuatro cifras recomendadas que el briefing dice servir en Salud de
// mercado son:
//   1. Reparto del volumen del universo sobre 50 sesiones
//   2. Sesiones de venta con volumen (descriptor agregado)
//   3. Volumen seco (10d/50d)
//   4. Divergencia con umbral de Índice y Participación
//
// El briefing proponía medir (1) y (2) sobre la SERIE diaria del universo
// completo, lo que requeriría leer todas las daily_bars del escaneo en cada
// request. Ese cálculo queda fuera de esta entrega (no hay primitiva de
// batch-read across-universe, y el briefing reconoce en B.1.2 que el
// nocturno tiene una sola fecha de mercado reutilizable). Aquí se agregan
// los campos persistidos por valor, que son 50-d por diseño, y se publica
// el nivel agregado junto a una etiqueta de ventana — sin inventar un valor
// distinto.
//
// Sin jerga de escuela: lo que se publica es el número y la ventana, no un
// veredicto. Si la cobertura del campo cae por debajo del umbral, el
// indicador se declara ausente con el mismo motivo que el resto de la
// pantalla (lib/marketBreadth.js:50-64).
import { finiteOrNull, toDate } from "@/lib/supabaseServer";

export const MARKET_VOLUME_MIN_COVERAGE_PCT = 60;
// Umbrales del briefing C.1, replicados en lib/scoring.js:80-82. No se
// cambian: ya son el patrón operativo que el producto usa.
export const VOLUME_SURGE_THRESHOLD_PCT = 15;
export const UP_DOWN_VOLUME_THRESHOLD = 1.25;
export const VOLUME_DRYUP_THRESHOLD = 1;
export const UP_DOWN_VOLUME_RATIO_BALANCED = 1;

function pctOf(count, total) {
  return total > 0 ? (count / total) * 100 : null;
}

// Misma forma que indicator() en lib/marketBreadth.js:50-64. Un indicador
// medido sobre menos del 60 % de la población se declara ausente (principio
// 3) y la razón se entrega ya formateada para que la UI pinte MissingValue.
export function volumeIndicator({
  key,
  label,
  count,
  measured,
  population,
  windowLabel,
  thresholdLabel,
}) {
  const coveragePct = pctOf(measured, population);
  const available = Number.isFinite(coveragePct) && coveragePct >= MARKET_VOLUME_MIN_COVERAGE_PCT;
  return {
    key,
    label,
    windowLabel: windowLabel || "",
    thresholdLabel: thresholdLabel || "",
    count: available ? count : null,
    measured,
    population,
    pct: available ? pctOf(count, measured) : null,
    coveragePct,
    available,
    reason: available
      ? null
      : `Solo ${measured} de ${population} valores del escaneo traen este dato (cobertura ${Math.round(coveragePct ?? 0)}%, mínimo ${MARKET_VOLUME_MIN_COVERAGE_PCT}%).`,
  };
}

// Pura: una fila de scan_results de la noche, con metrics ya proyectado a
// las claves que nos interesan. Acepta tanto shape plano (metrics->key
// extraído por la consulta ligera) como el payload bruto con metrics anidado.
function readNumeric(row, ...keys) {
  for (const key of keys) {
    if (row == null) return null;
    if (row[key] !== undefined && row[key] !== null) return finiteOrNull(row[key]);
    if (row.metrics && row.metrics[key] !== undefined && row.metrics[key] !== null) {
      return finiteOrNull(row.metrics[key]);
    }
  }
  return null;
}

// Recorre las filas del escaneo y devuelve los cuatro indicadores pedidos
// por el briefing, con cobertura y fecha declaradas. La fecha del dato es
// la más reciente entre las filas de la población, igual que en
// aggregateUniverseBreadth().
export function aggregateVolumeIndicators(rows = []) {
  const population = rows.length;
  const upDownAll = []; // todos los upDownVolRatio medidos (para media)
  const upDown = [];
  const dryUp = [];
  const surge = [];
  const participationUp = [];
  const dates = new Map();
  for (const row of rows) {
    const ud = readNumeric(row, "upDownVolRatio");
    if (ud !== null) upDownAll.push(ud);
    if (ud !== null && ud >= UP_DOWN_VOLUME_RATIO_BALANCED) upDown.push(ud);
    if (ud !== null && ud >= UP_DOWN_VOLUME_THRESHOLD) participationUp.push(ud);
    const dry = readNumeric(row, "volumeDryUpRatio");
    if (dry !== null) dryUp.push(dry);
    const surgePct = readNumeric(row, "volumeSurgePct");
    if (surgePct !== null) surge.push(surgePct);
    const lastDate = toDate(row.lastDate);
    if (lastDate) dates.set(lastDate, (dates.get(lastDate) || 0) + 1);
  }
  const sortedDates = [...dates.keys()].sort();
  const dataAsOf = sortedDates.at(-1) || null;
  const staleRows = dataAsOf ? population - (dates.get(dataAsOf) || 0) : population;
  const upDownMean = upDownAll.length ? upDownAll.reduce((a, b) => a + b, 0) / upDownAll.length : null;
  const upDownBelow = upDownAll.filter((v) => v < UP_DOWN_VOLUME_RATIO_BALANCED).length;
  const upDownAbove = upDown.length;
  const dryUpCount = dryUp.filter((v) => v < VOLUME_DRYUP_THRESHOLD).length;
  const surgeCount = surge.filter((v) => v >= VOLUME_SURGE_THRESHOLD_PCT).length;
  const participationUpCount = participationUp.length;
  const indicators = {
    upDownVolumeRatio: volumeIndicator({
      key: "upDownVolumeRatio",
      label: "Reparto del volumen (50d)",
      count: upDownAbove,
      measured: upDownAll.length,
      population,
      windowLabel: "50 sesiones",
      thresholdLabel: `up/down >= ${UP_DOWN_VOLUME_RATIO_BALANCED}×`,
    }),
    participationUp: volumeIndicator({
      key: "participationUp",
      label: "Reparto de volumen alto (50d)",
      count: participationUpCount,
      measured: upDownAll.length,
      population,
      windowLabel: "50 sesiones",
      thresholdLabel: `up/down >= ${UP_DOWN_VOLUME_THRESHOLD}×`,
    }),
    volumeDryUp: volumeIndicator({
      key: "volumeDryUp",
      label: "Volumen seco (10d/50d)",
      count: dryUpCount,
      measured: dryUp.length,
      population,
      windowLabel: "10 vs 50 sesiones",
      thresholdLabel: "media 10 / media 50 < 1",
    }),
    volumeSurge: volumeIndicator({
      key: "volumeSurge",
      label: "Impulso de volumen (5d/20d)",
      count: surgeCount,
      measured: surge.length,
      population,
      windowLabel: "5 vs 20 sesiones",
      thresholdLabel: `media 5 / media 20 ≥ +${VOLUME_SURGE_THRESHOLD_PCT}%`,
    }),
  };
  return {
    population,
    dataAsOf,
    staleRows,
    minCoveragePct: MARKET_VOLUME_MIN_COVERAGE_PCT,
    thresholds: {
      upDownBalanced: UP_DOWN_VOLUME_RATIO_BALANCED,
      upDownHigh: UP_DOWN_VOLUME_THRESHOLD,
      dryUp: VOLUME_DRYUP_THRESHOLD,
      surgePct: VOLUME_SURGE_THRESHOLD_PCT,
    },
    upDownMean: Number.isFinite(upDownMean) ? upDownMean : null,
    upDownBelow,
    upDownAbove,
    indicators,
  };
}

// Fila de hecho única para el bloque "Reparto del volumen del universo".
// Describe — no predice (principio 1): cuenta cuántos, dice la ventana y la
// fecha, sin recomendar exposición.
export function volumeFactLine(volume) {
  if (!volume || !volume.indicators) return null;
  const ind = volume.indicators.upDownVolumeRatio;
  if (!ind.available) return null;
  const mean = Number.isFinite(volume.upDownMean) ? volume.upDownMean : null;
  return {
    text:
      `En las últimas 50 sesiones, ${ind.count} de ${ind.measured} valores del escaneo ` +
      `cerraron con más volumen en sesiones de subida que en sesiones de bajada ` +
      `(${mean !== null ? mean.toFixed(2) : "—"}× de media).`,
    count: ind.count,
    measured: ind.measured,
    pct: ind.pct,
    mean,
    window: ind.windowLabel,
    dataAsOf: volume.dataAsOf,
  };
}
