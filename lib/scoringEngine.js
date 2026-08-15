// lib/scoringEngine.js — fuente única de verdad del scoring (fase de consolidación).
// Isomorfo (cliente/servidor). No depende de DOM ni de Next. Sin estado.
//
// =============================================================================
// DISCREPANCIAS DETECTADAS (requieren decisión humana)
// =============================================================================
// Comparación byte-a-byte de las 21 fórmulas entre lib/scoring.js y
// lib/materializedScanner.js antes de la consolidación:
//
// 1. Renombración: `scoreLiq` (scoring.js) ≡ `scoreLiquidity` (materializedScanner.js).
//    Fórmula idéntica, distinto nombre. En este engine la key canónica es
//    `liquidityScore`. La fachada `lib/scoring.js` re-exporta como `scoreLiq`
//    para preservar el consumer `lib/researchRow.js:288`.
//
// 2. `scoreIpo` solo existe en `lib/scoring.js`. `lib/materializedScanner.js`
//    NO la invoca. RESUELTO el 2026-08-15 retirando el término del composite
//    (ver COMPOSITE_WEIGHTS abajo): la señal sigue registrada y exportada —
//    las Listas la consumen (lib/listRationale.js, lib/leaderboards.js) — pero
//    ya no es uno de los términos del promedio, así que da igual quién la
//    invoque. El default de parámetro `ipoScore = 0` que convertía la ausencia
//    en un dato presente está eliminado.
//
// 3. Helpers `gt/gte/lt/lte/between` estaban duplicados textualmente en
//    ambos archivos. Este engine los posee canónicamente.
//
// 4. `monthsSince` y `ipoAgeMonthsForRow` están duplicados en `lib/scoring.js`,
//    `lib/materializedScanner.js` y `lib/stockRows.js`. NO son señales del
//    composite; quedan fuera del scope de esta tarea. `lib/scoring.js` los
//    conserva localmente (los siguen importando `lib/researchRow.js`,
//    `lib/screenerMarket.jsx`).
//
// 5. `scoreWeakness` (canónica) vive en este engine y se re-exporta desde
//    `lib/scoring.js` como fachada (consolidado en una tarea anterior). Tanto
//    `lib/screenerFilters.js` como `lib/scoring.js` la importan/re-exportan
//    desde aquí — ya no existe implementación paralela. Es señal diagnóstica
//    (no entra al composite por la cascada de prioridad en decisionAudit.js)
//    PERO SÍ entra al registry (direction "negative") para que signalCoverage
//    la rastree igual que las 19 señales del composite, y para que las reglas
//    de contradicción C6 (lib/signalContradictions.js) puedan leer su valor.
//
// =============================================================================
// FUERA DEL REGISTRO (declarados pero no usados todavía)
// =============================================================================
// - `direction` ("positive"/"negative") se declara por señal para soportar
//   futuras contradicciones entre señales, pero la lógica de contradicciones
//   NO se implementa en esta fase.
// - `coveragePct` no se implementa aquí; las fases futuras lo traerán
//   desde `lib/scoring.js`/`lib/materializedScanner.js`.
//
// =============================================================================
// DEPENDENCIAS DEL COMPOSITE QUE NO SON DEL ENGINE
// =============================================================================
// `computeComposite` recibe ya calculados: rsAnchor (rsGlobalPct ?? rsRating),
// rsQualityScore (lib/relativeStrength.js), sectorScore (sectorize),
// epsAnchor (epsGrowthProxyScore ?? growthScore). Igual que scoreCompositeValue
// original. No se computan aquí porque requieren datos fuera del row de
// señales puras.

// Bump obligatorio cuando cambia el contrato comparable del composite.
// El histórico persiste este valor en cada observación.
// 2026-08-15: "eaee4f1" → "composite-11t". El composite pasa de doce términos
// a once (fuera el de IPO) y el resultado se renormaliza sobre el peso
// presente, así que los scores de este motor NO son comparables punto a punto
// con los del anterior: suben ~2% (mediana medida 1,15 puntos). El valor deja
// de ser un hash de commit —no se puede escribir el hash de un commit que
// todavía no existe— y pasa a nombrar el contrato.
export const SCORING_ENGINE_VERSION = "composite-11t";
// =============================================================================

import { clamp, firstFinite } from "@/lib/indicators";
import { methodologyPatternEvidenceBonus } from "@/lib/methodologyDisplay";
import { rsPrimaryValue } from "@/lib/relativeStrength";
import { isConfirmedStage2 } from "@/lib/trendStructure";

// ---------------------------------------------------------------------------
// Helpers (verbatim de scoring.js L17-L21)
// ---------------------------------------------------------------------------
export function gt(value, threshold) { return Number.isFinite(value) && Number.isFinite(threshold) && value > threshold; }
export function gte(value, threshold) { return Number.isFinite(value) && Number.isFinite(threshold) && value >= threshold; }
export function lt(value, threshold) { return Number.isFinite(value) && Number.isFinite(threshold) && value < threshold; }
export function lte(value, threshold) { return Number.isFinite(value) && Number.isFinite(threshold) && value <= threshold; }
export function between(value, min, max) { return gte(value, min) && lte(value, max); }

// ---------------------------------------------------------------------------
// scoreWeakness (canónico — relocalizado desde lib/scoring.js L81-127).
// Señal diagnóstica de deterioro; no entra al composite (cascada de prioridad
// en decisionAudit.js). Cadena de fallback RS unificada con lib/screenerFilters.js:
// rsGlobalPct ?? rsRating ?? rsCountryPct ?? rsSectorPct ?? 50.
// Verbatim: cero cambios de lógica. Usada por SIGNAL_REGISTRY.weaknessScore.compute
// y re-exportada como `scoreWeakness` para preservar consumers en
// lib/screenerFilters.js, lib/materializedScanner.js, lib/researchRow.js,
// lib/screenerPipeline.js.
// ---------------------------------------------------------------------------
export function scoreWeakness(r = {}) {
  let s = 0;
  const reasons = [];
  // Cadena de fallback unificada con lib/screenerFilters.js (metric(row, "rsPrimary")):
  // rsGlobalPct ?? rsRating ?? rsCountryPct ?? rsSectorPct ?? 50.
  // Antes este punto usaba rsPrimaryScore(r) que solo cubría rsGlobalPct ?? rsRating,
  // cayendo a 50 cuando ambos faltaban incluso si rsCountryPct/rsSectorPct estaban
  // presentes. Esa divergencia hacía que scoreWeakness devolviera scores distintos
  // según qué consumidor lo invocara (researchRow/screenerPipeline vía scoring.js vs
  // materializedScanner vía screenerFilters.js). Ver test `scoreWeakness · cadena de
  // fallback RS unificada con screenerFilters.js`.
  const rs = firstFinite(r.rsGlobalPct, r.rsRating, r.rsCountryPct, r.rsSectorPct) ?? 50;
  if (rs < 30) { s += 18; reasons.push("RS muy bajo"); }
  else if (rs < 45) { s += 13; reasons.push("RS bajo"); }
  else if (rs < 55) s += 6;
  if (Number.isFinite(r.price) && Number.isFinite(r.sma50) && r.price < r.sma50) { s += 12; reasons.push("bajo SMA50"); }
  if (Number.isFinite(r.price) && Number.isFinite(r.sma200) && r.price < r.sma200) { s += 18; reasons.push("bajo SMA200"); }
  if (Number.isFinite(r.sma200Slope) && r.sma200Slope < 0) { s += 12; reasons.push("SMA200 cae"); }
  if (Number.isFinite(r.sma50) && Number.isFinite(r.sma200) && r.sma50 < r.sma200) s += 7;
  if (Number.isFinite(r.perf3m) && r.perf3m < 0) { s += 8; reasons.push("3M negativo"); }
  if (Number.isFinite(r.perf6m) && r.perf6m < 0) s += 8;
  if (Number.isFinite(r.perf12m) && r.perf12m < 0) s += 8;
  if (Number.isFinite(r.distance52w)) {
    if (r.distance52w < -45) { s += 12; reasons.push("muy lejos de máximos"); }
    else if (r.distance52w < -30) { s += 8; reasons.push("lejos de máximos"); }
    else if (r.distance52w < -20) s += 4;
  }
  if (Number.isFinite(r.distance20d) && r.distance20d < -12) s += 5;
  if (Number.isFinite(r.maxDrawdown63d)) {
    if (r.maxDrawdown63d > 40) { s += 10; reasons.push("drawdown alto"); }
    else if (r.maxDrawdown63d > 28) s += 7;
  }
  if (Number.isFinite(r.upDownVolRatio)) {
    if (r.upDownVolRatio < .7) { s += 9; reasons.push("volumen vendedor"); }
    else if (r.upDownVolRatio < .9) s += 5;
  }
  if (r.upVolume === false && Number.isFinite(r.relativeVolume) && r.relativeVolume >= 1.15) { s += 7; reasons.push("caída con volumen"); }
  if (Number.isFinite(r.riskScore) && r.riskScore < 35) s += 7;
  if (Number.isFinite(r.extSma50) && r.extSma50 < -12) s += 5;
  if (Number.isFinite(r.speculationRiskScore) && r.speculationRiskScore >= 70) s += 4;
  const weaknessScore = Math.max(0, Math.min(100, s));
  return {
    weaknessScore,
    weaknessLabel: weaknessScore >= 78 ? "Deterioro severo" : weaknessScore >= 65 ? "Deterioro alto" : weaknessScore >= 50 ? "Deterioro visible" : weaknessScore >= 35 ? "Debilidad mixta" : "Sin deterioro claro",
    weaknessReasons: reasons.length ? reasons.slice(0, 4) : ["Sin evidencia fuerte"],
  };
}

// ---------------------------------------------------------------------------
// resolvePatternContribution — override coherente de r.patternContribution.
//
// Un override solo es válido si es un número FINITO. Esto respeta `0` (override
// legítimo: "el productor calculó la contribución y es cero") y rechaza como
// inválidos: undefined, null, NaN, Infinity/-Infinity, strings, booleanos y
// cualquier otro tipo. En esos casos se cae al fallback metodológico canónico
// (methodologyPatternEvidenceBonus), que degrada a 0 internamente cuando los
// datos de patrón no son usables.
//
// Antes el guardia era `!== undefined`, que admitía null/NaN/strings/etc. como
// override (bug: propagaba valores no numéricos a los scores). El contrato que
// endurecemos aquí es: value de computeSignal NUNCA es no-finito por esta vía.
// Ver tests "patternContributionScore · override endurecido (Number.isFinite)".
// ---------------------------------------------------------------------------
export function resolvePatternContribution(row = {}) {
  return Number.isFinite(row.patternContribution)
    ? row.patternContribution
    : methodologyPatternEvidenceBonus(row);
}

// ---------------------------------------------------------------------------
// Registry de señales (data-driven)
// Cada entrada: { key, requiredInputs, direction, compute }
// `compute` es la fórmula migrada VERBATIM de scoring.js (sin reescritura).
// `direction` ∈ {"positive","negative"}; pendiente de uso en fase de contradicciones.
// ---------------------------------------------------------------------------
export const SIGNAL_REGISTRY = {
  weinsteinScore: {
    key: "weinsteinScore",
    requiredInputs: ["price", "sma50", "sma150", "sma200", "sma200Slope", "distance52w", "perf6m"],
    direction: "positive",
    compute: (r) => {
      let s = 0;
      if (gt(r.price, r.sma150)) s += 18;
      if (gt(r.sma150, r.sma200)) s += 18;
      if (gt(r.sma200Slope, 0)) s += 18;
      if (gt(r.price, r.sma50)) s += 14;
      if (gt(r.sma50, r.sma150)) s += 14;
      if (gte(r.distance52w, -25)) s += 10;
      if (gt(r.perf6m, 0)) s += 8;
      return clamp(s);
    },
  },
  minerviniScore: {
    key: "minerviniScore",
    requiredInputs: ["price", "sma50", "sma150", "sma200", "sma200Slope", "lowAdvance52w", "distance52w", "distance20d", "highsSpreadPct", "perf3m"],
    direction: "positive",
    compute: (r) => {
      let s = 0;
      if (gt(r.price, r.sma150) && gt(r.price, r.sma200)) s += 14;
      if (gt(r.sma150, r.sma200)) s += 12;
      if (gt(r.sma200Slope, 0)) s += 12;
      if (gt(r.sma50, r.sma150) && gt(r.sma50, r.sma200)) s += 12;
      if (gt(r.price, r.sma50)) s += 10;
      if (gte(r.lowAdvance52w, 30)) s += 12;
      if (gte(r.distance52w, -25)) s += 8;
      if (gte(r.distance20d, -10)) s += 8;
      if (lte(r.highsSpreadPct, 12)) s += 6;
      if (gt(r.perf3m, 10)) s += 6;
      return clamp(s);
    },
  },
  momentumScore: {
    key: "momentumScore",
    requiredInputs: ["perf3m", "perf6m", "perf12m"],
    direction: "positive",
    compute: (r) => {
      let s = 0;
      if (gte(r.perf3m, 20)) s += 35;
      else if (gte(r.perf3m, 10)) s += 25;
      else if (gte(r.perf3m, 0)) s += 12;
      if (gte(r.perf6m, 40)) s += 35;
      else if (gte(r.perf6m, 20)) s += 25;
      else if (gte(r.perf6m, 5)) s += 12;
      if (gte(r.perf12m, 80)) s += 30;
      else if (gte(r.perf12m, 40)) s += 22;
      else if (gte(r.perf12m, 15)) s += 12;
      return clamp(s);
    },
  },
  riskScore: {
    key: "riskScore",
    requiredInputs: ["extSma50", "distance20d", "distance50d", "price", "sma50"],
    direction: "positive",
    compute: (r) => {
      const e = r.extSma50;
      let s = 0;
      if (between(e, -3, 8)) s += 38;
      else if (between(e, -8, 15)) s += 30;
      else if (lte(e, 25)) s += 18;
      else if (lte(e, 35)) s += 8;
      if (gte(r.distance20d, -5)) s += 22;
      else if (gte(r.distance20d, -10)) s += 14;
      if (gte(r.distance50d, -10)) s += 18;
      else if (gte(r.distance50d, -18)) s += 10;
      if (gt(r.price, r.sma50)) s += 22;
      return clamp(s);
    },
  },
  riskRewardScore: {
    key: "riskRewardScore",
    requiredInputs: ["returnToVol3m", "returnToDrawdown3m", "volatility63d", "maxDrawdown63d", "maxDailyMove20dPct", "range63dPct", "perf3m"],
    direction: "positive",
    compute: (r) => {
      let s = 0;
      if (gte(r.returnToVol3m, 1.2)) s += 26;
      else if (gte(r.returnToVol3m, .8)) s += 20;
      else if (gte(r.returnToVol3m, .35)) s += 12;
      else if (gte(r.returnToVol3m, 0)) s += 4;
      if (gte(r.returnToDrawdown3m, 2.5)) s += 26;
      else if (gte(r.returnToDrawdown3m, 1.5)) s += 18;
      else if (gte(r.returnToDrawdown3m, .8)) s += 10;
      else if (gte(r.returnToDrawdown3m, 0)) s += 4;
      if (Number.isFinite(r.volatility63d)) {
        if (r.volatility63d <= 25) s += 18;
        else if (r.volatility63d <= 40) s += 12;
        else if (r.volatility63d <= 60) s += 6;
      }
      if (Number.isFinite(r.maxDrawdown63d)) {
        if (r.maxDrawdown63d <= 10) s += 20;
        else if (r.maxDrawdown63d <= 18) s += 14;
        else if (r.maxDrawdown63d <= 32) s += 7;
      }
      if (Number.isFinite(r.maxDailyMove20dPct)) {
        if (r.maxDailyMove20dPct <= 8) s += 8;
        else if (r.maxDailyMove20dPct <= 14) s += 4;
      }
      if (Number.isFinite(r.range63dPct)) {
        if (r.range63dPct <= 55) s += 6;
        else if (r.range63dPct <= 85) s += 3;
      }
      if (gt(r.perf3m, 0)) s += 10;
      return clamp(s);
    },
  },
  volumeEffectScore: {
    key: "volumeEffectScore",
    requiredInputs: ["latestTurnover", "latestVolume", "relativeVolume", "volumeSurgePct", "upDownVolRatio", "upVolume"],
    direction: "positive",
    compute: (r) => {
      let s = 0;
      if (gte(r.latestTurnover, 25000000)) s += 24;
      else if (gte(r.latestTurnover, 10000000)) s += 18;
      else if (gte(r.latestTurnover, 3000000)) s += 10;
      else if (gte(r.latestTurnover, 1000000)) s += 5;
      if (gte(r.latestVolume, 2000000)) s += 15;
      else if (gte(r.latestVolume, 500000)) s += 11;
      else if (gte(r.latestVolume, 150000)) s += 6;
      if (gte(r.relativeVolume, 2.2)) s += 22;
      else if (gte(r.relativeVolume, 1.6)) s += 16;
      else if (gte(r.relativeVolume, 1.2)) s += 9;
      else if (gte(r.relativeVolume, 1)) s += 4;
      if (gte(r.volumeSurgePct, 80)) s += 17;
      else if (gte(r.volumeSurgePct, 35)) s += 12;
      else if (gte(r.volumeSurgePct, 15)) s += 6;
      if (gte(r.upDownVolRatio, 1.8)) s += 16;
      else if (gte(r.upDownVolRatio, 1.25)) s += 11;
      else if (gte(r.upDownVolRatio, 1)) s += 5;
      if (r.upVolume === true && gte(r.relativeVolume, 1.1)) s += 6;
      return clamp(s);
    },
  },
  volumeScore: {
    key: "volumeScore",
    requiredInputs: ["avgTurnover", "avgVolume", "upDownVolRatio", "relativeVolume", "volumeSurgePct", "volumeEffectScore"],
    direction: "positive",
    compute: (r) => {
      let s = 0;
      if (gte(r.avgTurnover, 25000000)) s += 22;
      else if (gte(r.avgTurnover, 10000000)) s += 16;
      else if (gte(r.avgTurnover, 3000000)) s += 9;
      if (gte(r.avgVolume, 1000000)) s += 22;
      else if (gte(r.avgVolume, 300000)) s += 15;
      else if (gte(r.avgVolume, 100000)) s += 8;
      if (gte(r.upDownVolRatio, 1.5)) s += 20;
      else if (gte(r.upDownVolRatio, 1.1)) s += 14;
      else if (gte(r.upDownVolRatio, .9)) s += 7;
      if (gte(r.relativeVolume, 1.8)) s += 14;
      else if (gte(r.relativeVolume, 1.3)) s += 9;
      else if (gte(r.relativeVolume, 1.05)) s += 4;
      if (gte(r.volumeSurgePct, 50)) s += 12;
      else if (gte(r.volumeSurgePct, 25)) s += 8;
      else if (gte(r.volumeSurgePct, 10)) s += 4;
      s += (r.volumeEffectScore || 0) * .1;
      return clamp(s);
    },
  },
  liquidityScore: {
    key: "liquidityScore",
    requiredInputs: ["marketCap", "avgTurnover", "avgVolume", "price"],
    direction: "positive",
    compute: (r) => {
      let s = 0;
      if (gte(r.marketCap, 1000000000)) s += 35;
      else if (gte(r.marketCap, 300000000)) s += 24;
      else if (gte(r.marketCap, 150000000)) s += 12;
      if (gte(r.avgTurnover, 25000000)) s += 30;
      else if (gte(r.avgTurnover, 10000000)) s += 22;
      else if (gte(r.avgTurnover, 3000000)) s += 12;
      if (gte(r.avgVolume, 1000000)) s += 22;
      else if (gte(r.avgVolume, 300000)) s += 15;
      else if (gte(r.avgVolume, 100000)) s += 7;
      if (gte(r.price, 5)) s += 13;
      else if (gte(r.price, 3)) s += 7;
      return clamp(s);
    },
  },
  ipoScore: {
    key: "ipoScore",
    requiredInputs: ["ipoAgeMonths", "ipoDate", "distanceATH", "distance52w", "avgVolume", "price", "sma50", "perf3m", "sectorScore"],
    direction: "positive",
    compute: (r) => {
      // Replica inline de ipoAgeMonthsForRow: lee ipoAgeMonths (o snapshot.ipoAgeMonths)
      // y, si no está, deriva desde ipoDate (o snapshot.ipoDate). Mantenemos aquí la
      // dependencia mínima — no importamos la función de scoring.js para evitar ciclo.
      const direct = firstFinite(r.ipoAgeMonths, r.snapshot?.ipoAgeMonths);
      const m = Number.isFinite(direct)
        ? direct
        : (() => {
            const d = r.ipoDate || r.snapshot?.ipoDate || "";
            if (!d) return null;
            const x = new Date(d);
            if (Number.isNaN(x.getTime())) return null;
            const n = new Date();
            return (n.getFullYear() - x.getFullYear()) * 12 + n.getMonth() - x.getMonth();
          })();
      if (!Number.isFinite(m) || m < 0 || m > 60) return 0;
      const age = m < 6 ? 25 : m < 18 ? 30 : m < 36 ? 24 : 16;
      const high = gte(r.distanceATH, -15) || gte(r.distance52w, -15) ? 25 : gte(r.distance52w, -25) ? 15 : 5;
      const liq = gte(r.avgVolume, 1000000) ? 15 : gte(r.avgVolume, 300000) ? 8 : 0;
      const st = gt(r.price, r.sma50) && gt(r.perf3m, 10) ? 20 : 8;
      return clamp(age + high + liq + st + (r.sectorScore ? r.sectorScore * .15 : 5));
    },
  },
  objectiveSetupScore: {
    key: "objectiveSetupScore",
    requiredInputs: ["price", "sma50", "sma150", "sma200", "sma200Slope", "distance52w", "distance20d", "extSma50", "highsSpreadPct"],
    direction: "positive",
    // isConfirmedStage2 consulta trendStructure con campos derivados del row;
    // se invoca desde aquí (no como requiredInput) para no romper consumidores
    // que pasan filas sin stage pre-calculado.
    compute: (r) => {
      let s = 0;
      if (isConfirmedStage2(r)) s += 28;
      else if (gt(r.price, r.sma200) && gte(r.sma200Slope, 0)) s += 18;
      else if (gt(r.price, r.sma200)) s += 10;
      if (gt(r.price, r.sma50)) s += 10;
      if (gt(r.sma50, r.sma150)) s += 8;
      if (gte(r.distance52w, -5)) s += 16;
      else if (gte(r.distance52w, -15)) s += 11;
      else if (gte(r.distance52w, -25)) s += 6;
      if (gte(r.distance20d, -5)) s += 10;
      else if (gte(r.distance20d, -10)) s += 6;
      if (Number.isFinite(r.extSma50)) {
        if (r.extSma50 >= -4 && r.extSma50 <= 9) s += 16;
        else if (r.extSma50 <= 18) s += 11;
        else if (r.extSma50 <= 28) s += 4;
      }
      if (lte(r.highsSpreadPct, 8)) s += 7;
      else if (lte(r.highsSpreadPct, 15)) s += 4;
      return clamp(s);
    },
  },
  patternContributionScore: {
    key: "patternContributionScore",
    // requiredInputs está vacío a propósito. Originalmente declaraba
    // ["methodologyPatternContext"] — un campo fantasma que NUNCA existía en
    // ninguna fila (cero asignaciones, cero lecturas en todo el repo, ninguna
    // señal hermana lo usa). La declaración se introdujo durante la
    // consolidación al registry pero nunca se cableó a lógica alguna. Como
    // resultaba, la señal reportaba coverage=0/partial=true SIEMPRE, incluso
    // con inputs reales presentes, porque el campo inexistente faltaba.
    //
    // compute() = methodologyPatternEvidenceBonus(r) decide internamente su
    // propia degradación (retorna 0 si los datos de patrón no son "usables").
    // No hay un único campo escalar requerido que podamos declarar sin inventar
    // lógica de negocio, así que dejamos el array vacío: "nada requerido →
    // coverage=1.0" (contrato documentado de inputCoverage). La distinción de
    // "¿tuvo compute() datos suficientes?" queda reflejada en value (0 vs >0),
    // no en coverage.
    requiredInputs: [],
    direction: "positive",
    // compute() respeta el override escalar cuando el productor ya calculó la
    // contribución; si no existe o no es un número finito, conserva el fallback
    // canónico por evidencia. Ver resolvePatternContribution arriba.
    compute: (r) => resolvePatternContribution(r),
  },
  patternScore: {
    key: "patternScore",
    requiredInputs: ["patternContribution", "patternQualityScore", "baseQualityScore", "contractionScore"],
    direction: "positive",
    compute: (r) => {
      const contribution = resolvePatternContribution(r);
      if (!contribution) return 0;
      const quality = firstFinite(r.patternQualityScore, r.baseQualityScore, r.contractionScore);
      return Number.isFinite(quality) ? clamp(quality) : clamp(contribution * 4);
    },
  },
  setupQualityScore: {
    key: "setupQualityScore",
    requiredInputs: ["objectiveSetupScore", "patternContribution", "failedBreakout"],
    direction: "positive",
    compute: (r) => {
      // Recalculamos objectiveSetup desde la fila (es barato y evita dependencia circular
      // con el consumer que ya tendría objectiveSetup pre-calculado). Si la fila trae
      // setupObjective pre-calculado, lo respetamos; si no, lo derivamos.
      let s = Number.isFinite(r.objectiveSetupScore)
        ? r.objectiveSetupScore
        : SIGNAL_REGISTRY.objectiveSetupScore.compute(r);
      const contribution = resolvePatternContribution(r);
      s += contribution || 0;
      if (r.failedBreakout) s -= 12;
      return clamp(s);
    },
  },
  demandScore: {
    key: "demandScore",
    requiredInputs: ["rsGlobalPct", "rsRating", "volumeScore", "volumeEffectScore", "liquidityScore", "upDownVolRatio", "relativeVolume", "volumeSurgePct", "avgVolume"],
    direction: "positive",
    compute: (r) => {
      let s = 0;
      const rs = rsPrimaryValue(r) ?? 50;
      if (rs >= 90) s += 34;
      else if (rs >= 80) s += 29;
      else if (rs >= 70) s += 22;
      else if (rs >= 55) s += 13;
      s += (r.volumeScore || 0) * .28;
      s += (r.volumeEffectScore || 0) * .12;
      s += (r.liquidityScore || 0) * .14;
      if (gte(r.upDownVolRatio, 1.8)) s += 18;
      else if (gte(r.upDownVolRatio, 1.3)) s += 13;
      else if (gte(r.upDownVolRatio, 1)) s += 7;
      if (gte(r.relativeVolume, 1.5)) s += 8;
      else if (gte(r.relativeVolume, 1.2)) s += 5;
      if (gte(r.volumeSurgePct, 35)) s += 6;
      else if (gte(r.volumeSurgePct, 15)) s += 3;
      if (gte(r.avgVolume, 1000000)) s += 6;
      else if (gte(r.avgVolume, 300000)) s += 3;
      return clamp(s);
    },
  },
  growthScore: {
    key: "growthScore",
    // Dot-notation paths into the growthMetrics container. These match the
    // fields read by compute() (the some(Number.isFinite) guard at L382 reads
    // exactly these 9). Coverage is now proportional to how many of these
    // scalars are actually present, instead of 1.0 whenever {} exists.
    requiredInputs: [
      "growthMetrics.revenueGrowth",
      "growthMetrics.earningsGrowth",
      "growthMetrics.grossMargin",
      "growthMetrics.operatingMargin",
      "growthMetrics.profitMargin",
      "growthMetrics.roe",
      "growthMetrics.roa",
      "growthMetrics.debtToEquity",
      "growthMetrics.currentRatio",
    ],
    direction: "positive",
    compute: (r) => {
      const metrics = r.growthMetrics || {};
      const values = ["revenueGrowth", "earningsGrowth", "grossMargin", "operatingMargin", "profitMargin", "roe", "roa", "debtToEquity", "currentRatio"].map((k) => metrics[k]);
      // Sin ningún campo finito no hay señal de crecimiento que calcular — se
      // señaliza ausencia (null), igual que epsGrowthProxyScore (línea 547), en
      // vez de fabricar un 45 "neutro" indistinguible de una medición real.
      // computeComposite (línea ~730) renormaliza sobre los términos presentes
      // cuando esto ocurre, en vez de tratar la ausencia como el peor caso.
      if (!values.some(Number.isFinite)) return null;
      let s = 28;
      const revenue = metrics.revenueGrowth;
      const earnings = metrics.earningsGrowth;
      const gross = metrics.grossMargin;
      const operating = metrics.operatingMargin;
      const profit = metrics.profitMargin;
      const roe = metrics.roe;
      const roa = metrics.roa;
      const debt = metrics.debtToEquity;
      const current = metrics.currentRatio;
      if (gte(revenue, 30)) s += 19; else if (gte(revenue, 15)) s += 15; else if (gte(revenue, 5)) s += 9; else if (gte(revenue, 0)) s += 4; else if (Number.isFinite(revenue)) s -= 6;
      if (gte(earnings, 35)) s += 19; else if (gte(earnings, 15)) s += 14; else if (gte(earnings, 0)) s += 7; else if (Number.isFinite(earnings)) s -= 8;
      if (gte(gross, 55)) s += 10; else if (gte(gross, 35)) s += 6; else if (lt(gross, 20)) s -= 4;
      if (gte(operating, 25)) s += 9; else if (gte(operating, 12)) s += 6; else if (lt(operating, 0)) s -= 5;
      if (gte(profit, 20)) s += 8; else if (gte(profit, 8)) s += 5; else if (lt(profit, 0)) s -= 7;
      if (gte(roe, 25)) s += 8; else if (gte(roe, 12)) s += 5;
      if (gte(roa, 10)) s += 5; else if (gte(roa, 5)) s += 3;
      if (Number.isFinite(debt)) {
        if (debt <= 60) s += 5;
        else if (debt > 180) s -= 6;
      }
      if (Number.isFinite(current)) {
        if (current >= 1.4) s += 4;
        else if (current < .9) s -= 4;
      }
      return clamp(s);
    },
  },
  epsGrowthProxyScore: {
    key: "epsGrowthProxyScore",
    // Dot-notation paths into growthMetrics. Only the 6 fields that compute()'s
    // some(Number.isFinite) guard at L425 actually reads (debtToEquity/currentRatio
    // are optional adjustments there, not part of the presence guard). Coverage is
    // now proportional instead of reporting 1.0 for an empty {} container.
    requiredInputs: [
      "growthMetrics.revenueGrowth",
      "growthMetrics.earningsGrowth",
      "growthMetrics.operatingMargin",
      "growthMetrics.profitMargin",
      "growthMetrics.roe",
      "growthMetrics.roa",
    ],
    direction: "positive",
    compute: (r) => {
      const metrics = r.growthMetrics || {};
      const revenue = metrics.revenueGrowth;
      const earnings = metrics.earningsGrowth;
      const operating = metrics.operatingMargin;
      const profit = metrics.profitMargin;
      const roe = metrics.roe;
      const roa = metrics.roa;
      const debt = metrics.debtToEquity;
      const current = metrics.currentRatio;
      if (![revenue, earnings, operating, profit, roe, roa].some(Number.isFinite)) return null;
      let s = 35;
      if (gte(earnings, 50)) s += 24; else if (gte(earnings, 25)) s += 18; else if (gte(earnings, 10)) s += 11; else if (gte(earnings, 0)) s += 5; else if (Number.isFinite(earnings)) s -= 12;
      if (gte(revenue, 30)) s += 18; else if (gte(revenue, 15)) s += 13; else if (gte(revenue, 5)) s += 7; else if (gte(revenue, 0)) s += 3; else if (Number.isFinite(revenue)) s -= 8;
      if (gte(operating, 25)) s += 10; else if (gte(operating, 12)) s += 6; else if (lt(operating, 0)) s -= 7;
      if (gte(profit, 18)) s += 8; else if (gte(profit, 8)) s += 5; else if (lt(profit, 0)) s -= 8;
      if (gte(roe, 22)) s += 8; else if (gte(roe, 12)) s += 5;
      if (gte(roa, 10)) s += 5; else if (gte(roa, 5)) s += 3;
      if (Number.isFinite(debt)) {
        if (debt <= 60) s += 4;
        else if (debt > 180) s -= 5;
      }
      if (Number.isFinite(current) && current < .9) s -= 4;
      return Math.round(clamp(s));
    },
  },
  adProxyScore: {
    key: "adProxyScore",
    requiredInputs: ["upDownVolRatio", "relativeVolume", "upVolume", "volumeSurgePct", "perf3m", "distance20d", "distance52w", "price", "sma50", "maxDrawdown63d"],
    direction: "positive",
    compute: (r) => {
      let s = 45;
      if (gte(r.upDownVolRatio, 2)) s += 20;
      else if (gte(r.upDownVolRatio, 1.5)) s += 15;
      else if (gte(r.upDownVolRatio, 1.15)) s += 9;
      else if (Number.isFinite(r.upDownVolRatio) && r.upDownVolRatio < .75) s -= 15;
      else if (Number.isFinite(r.upDownVolRatio) && r.upDownVolRatio < .95) s -= 8;
      if (r.upVolume === true && gte(r.relativeVolume, 1.1)) s += 10;
      if (r.upVolume === false && gte(r.relativeVolume, 1.2)) s -= 10;
      if (gte(r.volumeSurgePct, 50) && gte(r.perf3m, 0)) s += 10;
      else if (gte(r.volumeSurgePct, 20) && gte(r.perf3m, 0)) s += 6;
      if (gte(r.relativeVolume, 1.5) && gte(r.distance20d, -8)) s += 8;
      if (gte(r.distance52w, -15)) s += 7;
      else if (Number.isFinite(r.distance52w) && r.distance52w < -35) s -= 7;
      if (gt(r.price, r.sma50)) s += 5;
      else if (Number.isFinite(r.price) && Number.isFinite(r.sma50)) s -= 5;
      if (gt(r.maxDrawdown63d, 32)) s -= 6;
      return Math.round(clamp(s));
    },
  },
  // weaknessScore: señal diagnóstica de deterioro. NO entra al composite (se resuelve
  // por cascada de prioridad en decisionAudit.js), pero se registra aquí para que
  // signalContradictions (fase posterior) pueda evaluar reglas que lo involucren
  // con el mismo mecanismo de coverage/partial que las 19 señales existentes.
  //
  // direction: "negative" — a diferencia de las 19 señales "positive", aquí los
  // valores ALTOS significan PEOR estado (más deterioro). Esta es la única señal
  // negativa del registry.
  //
  // requiredInputs: lista verificada leyendo el cuerpo de scoreWeakness
  // (lib/scoring.js L81-127). RS se resuelve vía fallback chain
  // rsGlobalPct ?? rsRating ?? rsCountryPct ?? rsSectorPct ?? 50 (L92). El resto
  // son lecturas directas. Los 4 campos RS se declaran por separado porque cada
  // uno puede ser la fuente efectiva del fallback.
  //
  // compute: envuelve scoreWeakness(r) y extrae solo el número (`.weaknessScore`).
  // NO se modifica scoreWeakness ni su firma ({weaknessScore, weaknessLabel,
  // weaknessReasons}); los campos row.weaknessScore/weaknessLabel/weaknessReasons
  // siguen ensamblándose por los pipelines vía scoreWeakness(row) directo.
  weaknessScore: {
    key: "weaknessScore",
    requiredInputs: [
      "rsGlobalPct", "rsRating", "rsCountryPct", "rsSectorPct",
      "price", "sma50", "sma200", "sma200Slope",
      "perf3m", "perf6m", "perf12m",
      "distance52w", "distance20d",
      "maxDrawdown63d", "upDownVolRatio", "upVolume", "relativeVolume",
      "riskScore", "extSma50", "speculationRiskScore",
    ],
    direction: "negative",
    compute: (r) => scoreWeakness(r).weaknessScore,
  },
};

// ---------------------------------------------------------------------------
// Composite (declarativo). ONCE términos; los pesos declarados suman 0.98 y el
// cálculo renormaliza sobre esa suma (ver computeCompositeDetailed). La suma no
// tiene por qué ser 1.00: lo que define la escala 0-100 es la renormalización,
// no el total declarado.
//
// El término número doce, `ipoScore` (peso 0.02), se retiró el 2026-08-15.
// Motivo medido sobre las 3.314 filas del nocturno de ese día
// (docs/analisis-compuesto-2026-08-15.md, puntos 5 y 9):
//
//   - Valía 0 en el 100% de las filas, de todos los escaneos, porque el dato
//     del que depende no existe en ninguna: `ipoDate` no vacío = 0 filas,
//     `ipoAgeMonths` finito = 0 filas, y scoreIpo devuelve 0 sin ellos.
//   - Pero ese 0 NO se excluía: entraba como término presente (el default de
//     parámetro lo materializaba y Number.isFinite(0) es cierto), así que
//     comprimía TODOS los scores un 2% —mediana 1,15 puntos— y movía 287 filas
//     (8,7%) de banda en compositeLabel.
//   - No aportaba nada al orden: Spearman 1,000000 entre el orden con y sin él.
//
// Retirarlo del promedio no retira la SEÑAL: SIGNAL_REGISTRY.ipoScore sigue
// existiendo y sigue alimentando la Lista "IPO / New Leaders"
// (lib/listRationale.js:177,394 · lib/leaderboards.js:466). Si algún día
// `ipoDate` se puebla, volver a añadirlo aquí es una línea.
//
// ── ¿Queda algún término con el mismo patrón? Medido: ninguno igual, pero
//    seis podrían ─────────────────────────────────────────────────────────
// Ejecutando cada término con una fila VACÍA, seis devuelven un número finito
// en vez de null; es decir, entran al promedio sin que nadie haya medido nada:
//
//   setupQualityScore → 0  (peso .17)      riskRewardScore → 0  (peso .08)
//   demandScore       → 0  (peso .10)      riskScore       → 0  (peso .05)
//   adProxyScore      → 45 (peso .08)      momentumScore   → 0  (peso .02)
//
// Son el 50% del peso. Solo growthScore —y epsAnchor, que hereda su ausencia—
// devuelve null y se excluye.
//
// La diferencia con ipoScore es que hoy esos seis SÍ tienen dato. Contado
// sobre las 3.314 filas del nocturno del 2026-08-15:
//   - riskRewardScore vale 0 en 97 filas, y en las 97 están presentes sus
//     siete inputs: es un cero MEDIDO (rentabilidad/riesgo realmente malo).
//   - momentumScore vale 0 en 513 filas, y en 498 están sus tres inputs. En
//     las otras 15 falta perf12m: ahí el 0 sí es ausencia. Son 51 las filas
//     sin perf12m, valga lo que valga la señal.
//   - adProxyScore no cae a su 45 en ninguna: está presente en el 100% de las
//     filas con rango real 2-100.
// Ninguno reproduce el caso de ipoScore —cero universal por un dato que no
// existe en ninguna fila—, pero la puerta sigue abierta: si mañana falla el
// proveedor de un input, el término entra igual y comprime el score sin
// avisar. Cerrarla es cambiar esas seis señales, no este bloque.
// ---------------------------------------------------------------------------
export const COMPOSITE_WEIGHTS = [
  { key: "setupQualityScore", weight: 0.17 },
  { key: "rsAnchor",          weight: 0.16 },
  { key: "rsQualityScore",    weight: 0.06 },
  { key: "demandScore",       weight: 0.10 },
  { key: "adProxyScore",      weight: 0.08 },
  { key: "growthScore",       weight: 0.08 },
  { key: "epsAnchor",         weight: 0.08 },
  { key: "sectorScore",       weight: 0.10 },
  { key: "riskRewardScore",   weight: 0.08 },
  { key: "riskScore",         weight: 0.05 },
  { key: "momentumScore",     weight: 0.02 },
];

// ---------------------------------------------------------------------------
// API pública del motor
// ---------------------------------------------------------------------------

/**
 * Evaluates whether a single input is "present" for coverage purposes.
 * Numeric inputs must be finite; non-numeric inputs must not be null/undefined.
 */
function isInputPresent(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "number") return Number.isFinite(value);
  return true;
}

/**
 * Resolves a requiredInput path against a row. Supports dot notation for fields
 * nested inside container objects (e.g. "growthMetrics.revenueGrowth").
 *
 * - Plain keys ("price") → row.price.
 * - Dotted paths ("growthMetrics.revenueGrowth") → walks row.growthMetrics?.revenueGrowth,
 *   returning undefined if any intermediate segment is null/undefined or not an object.
 *
 * This lets requiredInputs describe the actual scalar fields a compute() reads inside
 * a container (rather than just the container itself), so coverage reflects whether
 * compute() had real data — not whether an empty {} happened to exist.
 */
function resolveInputPath(row, path) {
  if (!path.includes(".")) return row[path];
  let current = row;
  for (const segment of path.split(".")) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    current = current[segment];
  }
  return current;
}

/**
 * Computes coverage of requiredInputs: fraction of inputs that are present.
 * Returns { present, total, coverage } where coverage = present/total.
 * If requiredInputs is empty, coverage is 1.0 (nothing required → all satisfied).
 *
 * Paths may use dot notation (see resolveInputPath) to require scalar fields inside
 * a container (e.g. "growthMetrics.revenueGrowth"). This was added to fix the
 * misleading coverage=1.0 produced when a container existed but was empty — e.g.
 * growthScore/epsGrowthProxyScore with growthMetrics={} used to report coverage=1.0
 * even though compute() had no real data and degraded to null (both signals now
 * signal absence the same way — see growthScore.compute above).
 */
function inputCoverage(row, requiredInputs) {
  if (!requiredInputs || !requiredInputs.length) return { present: 0, total: 0, coverage: 1.0 };
  let present = 0;
  for (const key of requiredInputs) {
    const value = resolveInputPath(row, key);
    if (isInputPresent(value)) present++;
  }
  const total = requiredInputs.length;
  return { present, total, coverage: total > 0 ? present / total : 1.0 };
}

/**
 * Executes a signal from the registry.
 *
 * Returns { value, coverage, partial }:
 *   - value:   the raw result of compute(row) — unchanged from pre-wrapper behavior.
 *              May be null (e.g. epsGrowthProxyScore when no data is available).
 *   - coverage: fraction 0-1 of requiredInputs that were present (finite for numbers,
 *              not null/undefined for others). 1.0 if all present.
 *   - partial:  true if coverage < 1.0 (at least one requiredInput missing).
 *
 * Returns null only if the key is not found in the registry.
 *
 * DESIGN DECISION: compute() is always invoked, even when coverage=0.
 * Rationale:
 *   1. All 19 compute functions already tolerate missing inputs without throwing
 *      (they degrade to 0, 45, or null — the pre-existing "silent degradation"
 *      pattern documented in the original audit).
 *   2. Skipping compute() would require auditing each function to confirm they don't
 *      throw, and would make the wrapper behavior inconsistent with the legacy path.
 *   3. The value with missing inputs is still meaningful (reflects what the signal
 *      "can say" given available data). The consumer decides whether to use it
 *      via the coverage/partial metadata.
 */
export function computeSignal(row, key) {
  const entry = SIGNAL_REGISTRY[key];
  if (!entry) return null;
  const { present, total, coverage } = inputCoverage(row, entry.requiredInputs);
  const value = entry.compute(row);
  return { value, coverage, partial: coverage < 1.0 };
}

// Suma de los pesos declarados en COMPOSITE_WEIGHTS: 0.98 (once términos), con
// el redondeo de punto flotante que salga de sumarlos en ese orden. Se usa tal
// cual, nunca redondeada, y se acumula en el MISMO orden dentro de
// computeCompositeDetailed, de modo que con cobertura completa presentWeight y
// esta constante son idénticos bit a bit y coverage da exactamente 1.
const COMPOSITE_TOTAL_WEIGHT = COMPOSITE_WEIGHTS.reduce((sum, w) => sum + w.weight, 0);

/**
 * Calcula el composite renormalizando sobre los términos presentes.
 *
 * Un término ausente (null/undefined/NaN — cualquier valor no Number.isFinite)
 * ya NO se trata como 0 (que en la escala 0-100 del resto de señales equivale a
 * "peor caso posible", no a "sin dato"). En vez de eso, se EXCLUYE de la suma y
 * su peso se redistribuye proporcionalmente entre los términos que sí están
 * presentes — el resultado es el promedio ponderado de lo que sí se pudo medir,
 * no un castigo implícito por lo que falta.
 *
 * La división por `presentWeight` se ejecuta SIEMPRE, también con cobertura
 * completa. Antes había un atajo (`if (missing === 0) return weightedSum`) que
 * era correcto mientras los pesos declarados sumaban 1.00; con once términos
 * suman 0.98, y saltarse la división dejaría todos los scores comprimidos un
 * 2% — exactamente el defecto que retirar el término de IPO viene a corregir.
 * Con cobertura completa `presentWeight` es bit a bit igual a
 * COMPOSITE_TOTAL_WEIGHT (misma cadena de sumas, mismo orden), así que la
 * división es una sola operación bien definida y coverage da exactamente 1.
 *
 * Devuelve { value, coverage, partial }, el mismo contrato que computeSignal:
 *   - value: el composite, en la misma escala 0-100 de siempre.
 *   - coverage: fracción del peso total que SÍ participó (1.0 si nada faltó).
 *   - partial: coverage < 1.0.
 */
function computeCompositeDetailed({
  setupQualityScore,
  rsAnchor,
  rsQualityScore,
  demandScore,
  adProxyScore,
  growthScore,
  epsAnchor,
  sectorScore,
  riskRewardScore,
  riskScore,
  momentumScore,
} = {}) {
  const values = {
    setupQualityScore, rsAnchor, rsQualityScore, demandScore, adProxyScore,
    growthScore, epsAnchor, sectorScore, riskRewardScore, riskScore,
    momentumScore,
  };
  let weightedSum = 0;
  let presentWeight = 0;
  for (const { key, weight } of COMPOSITE_WEIGHTS) {
    const v = values[key];
    if (Number.isFinite(v)) {
      weightedSum += v * weight;
      presentWeight += weight;
    }
  }
  if (presentWeight <= 0) {
    return { value: 0, coverage: 0, partial: true };
  }
  return {
    value: weightedSum / presentWeight,
    coverage: presentWeight / COMPOSITE_TOTAL_WEIGHT,
    partial: presentWeight < COMPOSITE_TOTAL_WEIGHT,
  };
}

/** Calcula el composite (verbatim de scoreCompositeValue scoring.js L209-L224 en
 * cobertura completa; renormalizado sobre términos presentes en cobertura parcial
 * — ver computeCompositeDetailed). Preserva la firma histórica: devuelve solo el
 * número. Usar computeCompositeWithCoverage para obtener también coverage/partial. */
export function computeComposite(args) {
  return computeCompositeDetailed(args).value;
}

/**
 * Como computeComposite, pero devuelve { value, coverage, partial } — el mismo
 * contrato que computeSignal. coverage/partial reflejan qué fracción del peso
 * total del composite realmente participó en el cálculo (1.0/false si ningún
 * término faltó). No hay ningún consumidor todavía: existe para que la capa de
 * ensamblaje de filas (screenerPipeline.js/materializedScanner.js) pueda empezar
 * a persistir esta señal sin que el número expuesto hoy como totalScore/
 * compositeScore cambie de contrato. materializedScanner consume además
 * coverage/partial para el histórico change-only.
 */
export function computeCompositeWithCoverage(args) {
  return computeCompositeDetailed(args);
}

/** Etiqueta categórica del composite (verbatim scoring.js L319-L325). */
export function compositeLabel(score) {
  if (score >= 85) return "Elite";
  if (score >= 75) return "Leader";
  if (score >= 65) return "Fuerte";
  if (score >= 55) return "Watchlist";
  return "Revisar";
}

// ---------------------------------------------------------------------------
// Re-exports canónicos (alias con nombres legacy para preservar API actual).
// La fachada lib/scoring.js re-exporta desde aquí; algunos call sites
// importan por nombre (lib/researchRow.js, lib/screenerPipeline.js, etc.).
// ---------------------------------------------------------------------------
export const scoreWeinstein     = (r) => SIGNAL_REGISTRY.weinsteinScore.compute(r);
export const scoreMinervini     = (r) => SIGNAL_REGISTRY.minerviniScore.compute(r);
export const scoreMomentum      = (r) => SIGNAL_REGISTRY.momentumScore.compute(r);
export const scoreRisk          = (r) => SIGNAL_REGISTRY.riskScore.compute(r);
export const scoreRiskReward    = (r) => SIGNAL_REGISTRY.riskRewardScore.compute(r);
export const scoreVolumeEffect  = (r) => SIGNAL_REGISTRY.volumeEffectScore.compute(r);
export const scoreVolume        = (r) => SIGNAL_REGISTRY.volumeScore.compute(r);
export const scoreLiquidity     = (r) => SIGNAL_REGISTRY.liquidityScore.compute(r);
export const scoreIpo           = (r) => SIGNAL_REGISTRY.ipoScore.compute(r);
export const scoreObjectiveSetupQuality = (r) => SIGNAL_REGISTRY.objectiveSetupScore.compute(r);
export const scorePatternContribution    = (r) => SIGNAL_REGISTRY.patternContributionScore.compute(r);
export const scorePatternQuality         = (r) => SIGNAL_REGISTRY.patternScore.compute(r);
export const scoreSetupQuality           = (r) => SIGNAL_REGISTRY.setupQualityScore.compute(r);
export const scoreCompositeValue         = computeComposite;
export const scoreDemandQuality          = (r) => SIGNAL_REGISTRY.demandScore.compute(r);
export const scoreGrowthQuality          = (r) => SIGNAL_REGISTRY.growthScore.compute(r);
export const scoreEpsGrowthProxy         = (r) => SIGNAL_REGISTRY.epsGrowthProxyScore.compute(r);
export const scoreAdProxy                = (r) => SIGNAL_REGISTRY.adProxyScore.compute(r);
