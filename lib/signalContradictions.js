// lib/signalContradictions.js — detección de tensiones entre señales.
//
// Contexto: SIGNAL_REGISTRY expone 20 señales (19 positive + weaknessScore
// negative) cada una con { value, coverage, partial } vía computeSignal. Los
// 3 pipelines de scoring ya pueblan row.signalCoverage[signalKey] = { coverage,
// partial }. Este módulo declara 6 reglas de contradicción (C1-C6) — pares de
// señales que, cuando ambas cruzan umbrales opuestos, indican tensión
// diagnóstica (líder frenándose, base bajo distribución, etc.) — y exporta una
// función pura evaluateContradictions(row) que devuelve { signalContradictions,
// contradictionsSkipped }.
//
// DISEÑO (reglas C1-C6, Fable — no rediseñar):
//
// | Regla | Condición                                          | Tier       | Label                     |
// |-------|----------------------------------------------------|------------|---------------------------|
// | C1    | rsGlobalPct>=70 ∧ momentumScore<=30               | thesis     | "Líder frenándose"        |
// | C2    | setupQualityScore>=70 ∧ adProxyScore<=35          | thesis     | "Base bajo distribución"  |
// | C3    | setupQualityScore>=70 ∧ rsGlobalPct<=40           | thesis     | "Patrón en rezagado"      |
// | C4    | setupQualityScore>=70 ∧ riskRewardScore<=30       | execution  | "Setup sin entrada"       |
// | C5    | momentumScore>=75 ∧ liquidityScore<=25            | execution  | "Movimiento no operable"  |
// | C6    | (weinsteinScore>=70 ∨ minerviniScore>=70) ∧ weaknessScore>=65 | thesis | "Estructura bajo debilidad" |
//
// C6 reutiliza el umbral 65 de weaknessScore porque coincide con la frontera
// semántica existente en scoreWeakness ("Debilidad mixta" / "Deterioro visible").
// No se inventan umbrales nuevos.
//
// REGLA DE EVALUACIÓN (partial):
//  - Checks AND simples ({signalKey, operator, threshold}): NO evaluar la regla
//    si la señal del check tiene partial:true. En un AND, una rama desconocida
//    puede cambiar el resultado aunque otra sea verdadera → sin excepciones.
//  - Checks disyunción OR ({any: [...]}): lógica de tres valores. La regla NO
//    se salta si alguna rama con partial:false satisface su threshold (la OR es
//    verdadera de forma confiable; las ramas parciales son irrelevantes). Se
//    salta solo si ninguna rama confirmada satisface Y al menos una rama partial
//    podría haberlo hecho (no se puede confirmar que la OR es falsa). Si todas
//    las ramas tienen partial:false y ninguna satisface, la OR es falsa de
//    forma confiable → la regla simplemente no dispara (no es un skip).
//  - En todos los casos, el reason del skip es "partial:<key>" de la primera
//    señal (en orden de declaración de la regla) cuyo check es "unknown".
//  - Esta lógica de tres valores aplica SOLO a {any: [...]}. La pata AND
//    weaknessScore>=65 de C6, y todos los checks de C1-C5, siguen la regla
//    original: cualquier partial → skip sin excepción.
//
// ORDEN DE SALIDA:
//  - thesis antes que execution.
//  - Dentro del mismo tier, orden de declaración C1→C6.
//  - El array vacío es válido (fila sin contradicciones ni skips).
//
// PURE: sin IO, sin estado, sin dependencias de Next/DOM. Isomorfo. Acepta una
// fila con scores planos + signalCoverage ya poblados; no re-computa señales.

// ---------------------------------------------------------------------------
// Operadores — se evalúan genéricamente a partir de la declaración de la regla
// (no hay 6 funciones hardcodeadas; cada check es datos).
// ---------------------------------------------------------------------------
const OPERATORS = {
  ">=": (a, b) => Number.isFinite(a) && a >= b,
  "<=": (a, b) => Number.isFinite(a) && a <= b,
  ">":  (a, b) => Number.isFinite(a) && a >  b,
  "<":  (a, b) => Number.isFinite(a) && a <  b,
  "==": (a, b) => Number.isFinite(a) && a === b,
  "!=": (a, b) => Number.isFinite(a) && a !== b,
};

// Descripción textual del umbral para el campo thresholds del output. Mantiene
// el formato ">=70" / "<=35" del shape especificado.
function thresholdLabel(check) {
  return `${check.operator}${check.threshold}`;
}

// ---------------------------------------------------------------------------
// Reglas C1-C6 declaradas como datos. El orden del array ES el orden de
// declaración (C1→C6). evaluateContradictions particiona por tier respetando
// este orden dentro de cada tier.
//
// Convención de `check`:
//  - check simple: { signalKey, operator, threshold }
//  - check disyuntivo (OR): { any: [check, check, ...] }
//    Se satisface si ALGÚN sub-check pasa. Usado por C6 (weinsteinScore>=70 ∨
//    minerviniScore>=70). El campo signals/thresholds/values del output reporta
//    TODAS las signalKeys implicadas en la disyunción.
// ---------------------------------------------------------------------------
const TIER_THESIS = "thesis";
const TIER_EXECUTION = "execution";

export const CONTRADICTION_RULES = [
  {
    key: "leader-stalling",
    tier: TIER_THESIS,
    label: "Líder frenándose",
    detail: "RS de líder con momentum desacelerándose: fuerza relativa que pierde tracción.",
    checks: [
      { signalKey: "rsGlobalPct", operator: ">=", threshold: 70 },
      { signalKey: "momentumScore", operator: "<=", threshold: 30 },
    ],
  },
  {
    key: "base-under-distribution",
    tier: TIER_THESIS,
    label: "Base bajo distribución",
    detail: "Patrón constructivo con firma de volumen distributiva.",
    checks: [
      { signalKey: "setupQualityScore", operator: ">=", threshold: 70 },
      { signalKey: "adProxyScore", operator: "<=", threshold: 35 },
    ],
  },
  {
    key: "pattern-in-laggard",
    tier: TIER_THESIS,
    label: "Patrón en rezagado",
    detail: "Setup sólido en un nombre con fuerza relativa débil: calidad aislada del grupo.",
    checks: [
      { signalKey: "setupQualityScore", operator: ">=", threshold: 70 },
      { signalKey: "rsGlobalPct", operator: "<=", threshold: 40 },
    ],
  },
  {
    key: "setup-no-entry",
    tier: TIER_EXECUTION,
    label: "Setup sin entrada",
    detail: "Setup objetivo con perfil riesgo/recompensa desfavorable: no es operable como entrada.",
    checks: [
      { signalKey: "setupQualityScore", operator: ">=", threshold: 70 },
      { signalKey: "riskRewardScore", operator: "<=", threshold: 30 },
    ],
  },
  {
    key: "untraceable-move",
    tier: TIER_EXECUTION,
    label: "Movimiento no operable",
    detail: "Momentum fuerte en un nombre ilíquido: el movimiento existe pero no se puede tomar tamaño.",
    checks: [
      { signalKey: "momentumScore", operator: ">=", threshold: 75 },
      { signalKey: "liquidityScore", operator: "<=", threshold: 25 },
    ],
  },
  {
    key: "structure-under-weakness",
    tier: TIER_THESIS,
    label: "Estructura bajo debilidad",
    detail: "Estructura de tendencia sana (Weinstein/Minervini) convive con deterioro manifiesto.",
    checks: [
      { any: [
        { signalKey: "weinsteinScore", operator: ">=", threshold: 70 },
        { signalKey: "minerviniScore", operator: ">=", threshold: 70 },
      ] },
      { signalKey: "weaknessScore", operator: ">=", threshold: 65 },
    ],
  },
];

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

// Lee el valor de una signalKey desde la fila. Las señales viven como campos
// planos en la fila (weinsteinScore, momentumScore, rsGlobalPct, etc.) —
// evaluadas por el pipeline + finalización de percentiles.
function readSignalValue(row, signalKey) {
  return row?.[signalKey];
}

// ¿La signalKey está marcada partial:true en row.signalCoverage?
// Si signalCoverage no existe o no tiene la entrada, se asume NO parcial
// (la regla se evalúa normalmente con el valor plano disponible). Esto permite
// usar evaluateContradictions en filas de fixture que solo traen scores planos.
function isPartialSignal(row, signalKey) {
  const entry = row?.signalCoverage?.[signalKey];
  return Boolean(entry && entry.partial === true);
}

// Evalúa un check individual contra la fila. Devuelve true/false.
// Para `any:` (disjunction), pasa si ALGÚN sub-check pasa.
// NOTA: esta función asume que ninguna señal implicada hace el resultado
// UNKNOWN (eso se resuelve antes vía skipReasonForCheck). Aquí solo importa
// si el check pasa con los datos confirmados disponibles.
function checkPasses(row, check) {
  if (Array.isArray(check.any)) {
    return check.any.some((sub) => {
      const op = OPERATORS[sub.operator];
      if (!op) return false;
      return op(readSignalValue(row, sub.signalKey), sub.threshold);
    });
  }
  const op = OPERATORS[check.operator];
  if (!op) return false;
  return op(readSignalValue(row, check.signalKey), check.threshold);
}

// ---------------------------------------------------------------------------
// Lógica de tres valores para partial — SOLO aplica a checks {any: [...]}.
// ---------------------------------------------------------------------------
//
// Un check puede tener tres estados respecto al partial:
//   - "confirmed" : el resultado del check es fiable (true o false) con los
//                   datos disponibles. La regla se evalúa normalmente.
//   - "unknown"   : no se puede confirmar el resultado. La regla se SALTA
//                   (va a contradictionsSkipped).
//
// Reglas por tipo de check:
//
//  (A) Check AND simple ({signalKey, operator, threshold}):
//      - partial:true → "unknown" (en un AND, una rama desconocida puede
//        cambiar el resultado aunque otra rama sea verdadera → sin excepciones).
//      - partial:false → "confirmed" (el check pasa o no pasa de forma fiable).
//
//  (B) Check disyunción OR ({any: [...]}): lógica de tres valores clásica.
//      - Si ALGÚNA rama tiene partial:false Y satisface su threshold → la
//        disyunción es VERDADERA de forma confiable → "confirmed" (la otra
//        rama, aunque partial, es irrelevante: ya se probó el resultado).
//      - Si NINGUNA rama con partial:false satisface, pero AL MENOS UNA rama
//        con partial:true podría haber satisfecho → la disyunción es
//        INDETERMINADA → "unknown" (no se puede confirmar que es falsa).
//      - Si TODAS las ramas tienen partial:false y ninguna satisface → la
//        disyunción es FALSA de forma confiable → "confirmed" (la regla no
//        dispara, pero no se salta: es un "no contradicción", no un unknown).
//
// Esta lógica de tres valores aplica SOLO a {any: [...]}. Los checks AND
// simples (C1-C5 completos + la pata weaknessScore>=65 de C6) mantienen la
// regla original: cualquier partial ahí salta la regla entera sin excepción.
//
// Devuelve null si el check es "confirmed" (la regla puede evaluarse), o un
// string "<signalKey>" si es "unknown" (la regla debe saltarse con ese reason).

function skipReasonForAndCheck(row, check) {
  // AND simple: cualquier partial → unknown sin excepciones.
  if (isPartialSignal(row, check.signalKey)) return check.signalKey;
  return null;
}

function skipReasonForAnyCheck(row, check) {
  // Disyunción OR con lógica de tres valores.
  let confirmedTrue = false;   // alguna rama partial:false satisface → OR confirmada true
  let anyPartialBranch = null; // primera rama partial (en orden) — reason si termina unknown

  for (const sub of check.any) {
    if (isPartialSignal(row, sub.signalKey)) {
      // Rama partial: podría haber satisfecho. Recordamos la primera como
      // candidata a reason (si la disyunción termina siendo indeterminada).
      if (anyPartialBranch === null) anyPartialBranch = sub.signalKey;
      continue;
    }
    // Rama confirmada: evaluamos si satisface.
    const op = OPERATORS[sub.operator];
    if (op && op(readSignalValue(row, sub.signalKey), sub.threshold)) {
      confirmedTrue = true;
      break; // Ya sabemos que la OR es true de forma fiable.
    }
  }

  if (confirmedTrue) return null; // OR confirmada verdadera → evaluar regla.
  if (anyPartialBranch !== null) return anyPartialBranch; // indeterminada → skip.
  return null; // todas las ramas partial:false y ninguna satisface → OR false confirmada.
}

// Recorre los checks de una regla en orden de declaración. Devuelve la
// signalKey del PRIMER check cuyo resultado es "unknown" (para el reason del
// skip), o null si todos los checks son "confirmed" (la regla se evalúa).
function ruleSkipReason(row, rule) {
  for (const check of rule.checks) {
    const reason = Array.isArray(check.any)
      ? skipReasonForAnyCheck(row, check)
      : skipReasonForAndCheck(row, check);
    if (reason) return reason; // primer unknown en orden de declaración
  }
  return null;
}

// Construye el shape de output para una regla disparada (todos los checks
// pasan, ninguna señal partial). Reporta TODAS las signalKeys implicadas
// (incluyendo las de la disjunction C6) con sus valores y thresholds.
function buildContradictionEntry(row, rule, percentileScope) {
  const signals = [];
  const values = {};
  const thresholds = {};

  for (const check of rule.checks) {
    if (Array.isArray(check.any)) {
      // C6: reporta cada sub-señal de la disjunction (weinsteinScore,
      // minerviniScore). thresholds usa el operador/umbral de cada sub-check.
      for (const sub of check.any) {
        if (!signals.includes(sub.signalKey)) {
          signals.push(sub.signalKey);
          values[sub.signalKey] = readSignalValue(row, sub.signalKey);
          thresholds[sub.signalKey] = thresholdLabel(sub);
        }
      }
    } else {
      if (!signals.includes(check.signalKey)) {
        signals.push(check.signalKey);
        values[check.signalKey] = readSignalValue(row, check.signalKey);
        thresholds[check.signalKey] = thresholdLabel(check);
      }
    }
  }

  return {
    key: rule.key,
    tier: rule.tier,
    signals,
    values,
    thresholds,
    label: rule.label,
    detail: rule.detail,
    percentileScope,
  };
}

// ---------------------------------------------------------------------------
// evaluateContradictions — PURE.
//
// @param {object} row - fila con scores planos + signalCoverage ya poblados.
//   Ej: { rsGlobalPct: 81, momentumScore: 22, signalCoverage: {...}, ... }
// @returns {{ signalContradictions: Array, contradictionsSkipped: Array }}
//   Orden: thesis antes que execution; dentro del tier, orden de declaración
//   C1→C6. Ambos arrays pueden ser vacíos (fila sin tensiones ni skips).
// ---------------------------------------------------------------------------
export function evaluateContradictions(row = {}) {
  if (!row || typeof row !== "object") {
    return { signalContradictions: [], contradictionsSkipped: [] };
  }

  // percentileScope es informativo: refleja el scope de la fila tal como llegó.
  // Si la finalización ya escribió "final" en la fila, ese es el valor que
  // hereda la contradicción. Default "batch" si la fila no trae el campo
  // (filas en progreso o fixtures de test).
  const percentileScope = row.percentileScope ?? "batch";

  // Particiona por tier respetando el orden de declaración dentro de cada tier.
  // CONTRADICTION_RULES ya está ordenado C1→C6 (que a su vez es thesis, thesis,
  // thesis, execution, execution, thesis). Iteramos dos veces preservando ese
  // orden y filtrando por tier: así C6 (thesis, declarado último) sale en el
  // bloque thesis DESPUÉS de C1/C2/C3, y C4/C5 salen en el bloque execution.
  const fired = [];
  const skipped = [];

  for (const rule of CONTRADICTION_RULES) {
    // Skip si algún check tiene resultado "unknown" (partial relevante).
    // ruleSkipReason aplica lógica de tres valores a los {any:[...]} y la regla
    // original (cualquier partial → skip) a los checks AND simples. Reporta el
    // primer unknown en orden de declaración.
    const partialKey = ruleSkipReason(row, rule);
    if (partialKey) {
      skipped.push({ key: rule.key, reason: `partial:${partialKey}` });
      continue;
    }
    // Dispara solo si TODOS los checks pasan.
    if (rule.checks.every((check) => checkPasses(row, check))) {
      fired.push(buildContradictionEntry(row, rule, percentileScope));
    }
  }

  // Reordena fired: thesis antes que execution, preservando orden de declaración
  // (que es el orden de fired ya que iteramos CONTRADICTION_RULES en orden).
  const thesis = fired.filter((c) => c.tier === TIER_THESIS);
  const execution = fired.filter((c) => c.tier === TIER_EXECUTION);
  const signalContradictions = [...thesis, ...execution];

  // skipped mantiene el orden de declaración de reglas (C1→C6), sin reordenar
  // por tier: el contrato solo especifica orden para signalContradictions.
  return { signalContradictions, contradictionsSkipped: skipped };
}
