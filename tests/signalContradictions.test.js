// Tests de lib/signalContradictions.js (reglas C1-C6) + integración en
// lib/scanPercentileFinalization.js.
//
// Las 6 reglas son datos declarados en CONTRADICTION_RULES; evaluateContradictions
// es pura. Aquí probamos:
//   1. C1-C6: fixture que dispara la regla JUSTO en el umbral (>=, <= inclusivos)
//      Y fixture que NO la dispara (justo debajo del umbral) → 12 tests mínimo.
//   2. partial:true en una señal implicada → contradictionsSkipped, no fired.
//   3. Múltiples contradicciones simultáneas → orden thesis>execution, C1→C6.
//   4. Fila sin contradicciones → ambos arrays vacíos.
//   5. Integración: finalizeScanPercentiles + finalizeScanResultsInDb populan
//      signalContradictions en el patch final para un scan multi-batch.
//
// Convención: las fixtures traen scores planos + signalCoverage opcional. Sin
// signalCoverage, isPartialSignal devuelve false (la regla se evalúa normalmente).
import { afterEach, describe, expect, it, vi } from "vitest";
import { CONTRADICTION_RULES, evaluateContradictions } from "@/lib/signalContradictions";

// --- Helpers de fixtures --------------------------------------------------

// Construye una fila "sana" base: todos los scores neutros que NO disparan
// ninguna regla. Cada test muta solo los campos relevantes a la regla que prueba.
// Umbrales (recordatorio): C1 rs≥70∧mom≤30, C2 setup≥70∧ad≤35, C3 setup≥70∧rs≤40,
// C4 setup≥70∧rr≤30, C5 mom≥75∧liq≤25, C6 (w≥70∨m≥70)∧weak≥65.
function cleanRow(overrides = {}) {
  return {
    rsGlobalPct: 60,        // < 70 (no C1) y > 40 (no C3)
    momentumScore: 50,      // > 30 (no C1) y < 75 (no C5)
    setupQualityScore: 50,  // < 70 (no C2/C3/C4)
    adProxyScore: 50,       // > 35 (no C2)
    riskRewardScore: 50,    // > 30 (no C4)
    liquidityScore: 50,     // > 25 (no C5)
    weinsteinScore: 50,     // < 70 (no C6)
    minerviniScore: 50,     // < 70 (no C6)
    weaknessScore: 30,      // < 65 (no C6)
    percentileScope: "final",
    ...overrides,
  };
}

// signalCoverage con partial:false en todas las signalKeys que usan las reglas.
// Usado por defecto: las reglas se evalúan normalmente. Para forzar partial,
// el test muta solo la entrada relevante.
function cleanCoverage(overrides = {}) {
  const base = {};
  for (const key of [
    "rsGlobalPct", "momentumScore", "setupQualityScore", "adProxyScore",
    "riskRewardScore", "liquidityScore", "weinsteinScore", "minerviniScore",
    "weaknessScore",
  ]) {
    base[key] = { coverage: 1.0, partial: false };
  }
  return { ...base, ...overrides };
}

// ===========================================================================
// 1. Reglas C1-C6: trigger (en umbral) + no-trigger (justo debajo)
// ===========================================================================

describe("evaluateContradictions · C1 Líder frenándose", () => {
  it("DISPARA cuando rsGlobalPct>=70 ∧ momentumScore<=30 (en el umbral exacto)", () => {
    const row = cleanRow({ rsGlobalPct: 70, momentumScore: 30 });
    const { signalContradictions, contradictionsSkipped } = evaluateContradictions(row);
    expect(contradictionsSkipped).toEqual([]);
    expect(signalContradictions).toHaveLength(1);
    const c = signalContradictions[0];
    expect(c.key).toBe("leader-stalling");
    expect(c.tier).toBe("thesis");
    expect(c.label).toBe("Líder frenándose");
    expect(c.signals).toEqual(["rsGlobalPct", "momentumScore"]);
    expect(c.values).toEqual({ rsGlobalPct: 70, momentumScore: 30 });
    expect(c.thresholds).toEqual({ rsGlobalPct: ">=70", momentumScore: "<=30" });
    expect(c.percentileScope).toBe("final");
  });

  it("NO dispara cuando rsGlobalPct=69 (justo debajo) o momentumScore=31", () => {
    expect(evaluateContradictions(cleanRow({ rsGlobalPct: 69, momentumScore: 30 })).signalContradictions).toEqual([]);
    expect(evaluateContradictions(cleanRow({ rsGlobalPct: 70, momentumScore: 31 })).signalContradictions).toEqual([]);
  });
});

describe("evaluateContradictions · C2 Base bajo distribución", () => {
  it("DISPARA cuando setupQualityScore>=70 ∧ adProxyScore<=35 (en el umbral exacto)", () => {
    const row = cleanRow({ setupQualityScore: 70, adProxyScore: 35 });
    const { signalContradictions } = evaluateContradictions(row);
    expect(signalContradictions).toHaveLength(1);
    expect(signalContradictions[0].key).toBe("base-under-distribution");
    expect(signalContradictions[0].tier).toBe("thesis");
    expect(signalContradictions[0].values).toEqual({ setupQualityScore: 70, adProxyScore: 35 });
  });

  it("NO dispara cuando setupQualityScore=69 o adProxyScore=36", () => {
    expect(evaluateContradictions(cleanRow({ setupQualityScore: 69, adProxyScore: 35 })).signalContradictions).toEqual([]);
    expect(evaluateContradictions(cleanRow({ setupQualityScore: 70, adProxyScore: 36 })).signalContradictions).toEqual([]);
  });
});

describe("evaluateContradictions · C3 Patrón en rezagado", () => {
  it("DISPARA cuando setupQualityScore>=70 ∧ rsGlobalPct<=40 (en el umbral exacto)", () => {
    const row = cleanRow({ setupQualityScore: 70, rsGlobalPct: 40 });
    const { signalContradictions } = evaluateContradictions(row);
    expect(signalContradictions).toHaveLength(1);
    expect(signalContradictions[0].key).toBe("pattern-in-laggard");
    expect(signalContradictions[0].tier).toBe("thesis");
    // C3 es la única regla thesis con rsGlobalPct como segundo check; C1 no dispara
    // porque rsGlobalPct=40 < 70.
    expect(signalContradictions[0].values).toEqual({ setupQualityScore: 70, rsGlobalPct: 40 });
  });

  it("NO dispara cuando setupQualityScore=69 o rsGlobalPct=41", () => {
    expect(evaluateContradictions(cleanRow({ setupQualityScore: 69, rsGlobalPct: 40 })).signalContradictions).toEqual([]);
    expect(evaluateContradictions(cleanRow({ setupQualityScore: 70, rsGlobalPct: 41 })).signalContradictions).toEqual([]);
  });
});

describe("evaluateContradictions · C4 Setup sin entrada", () => {
  it("DISPARA cuando setupQualityScore>=70 ∧ riskRewardScore<=30 (en el umbral exacto)", () => {
    const row = cleanRow({ setupQualityScore: 70, riskRewardScore: 30 });
    const { signalContradictions } = evaluateContradictions(row);
    expect(signalContradictions).toHaveLength(1);
    expect(signalContradictions[0].key).toBe("setup-no-entry");
    expect(signalContradictions[0].tier).toBe("execution");
    expect(signalContradictions[0].values).toEqual({ setupQualityScore: 70, riskRewardScore: 30 });
  });

  it("NO dispara cuando setupQualityScore=69 o riskRewardScore=31", () => {
    expect(evaluateContradictions(cleanRow({ setupQualityScore: 69, riskRewardScore: 30 })).signalContradictions).toEqual([]);
    expect(evaluateContradictions(cleanRow({ setupQualityScore: 70, riskRewardScore: 31 })).signalContradictions).toEqual([]);
  });
});

describe("evaluateContradictions · C5 Movimiento no operable", () => {
  it("DISPARA cuando momentumScore>=75 ∧ liquidityScore<=25 (en el umbral exacto)", () => {
    const row = cleanRow({ momentumScore: 75, liquidityScore: 25 });
    const { signalContradictions } = evaluateContradictions(row);
    expect(signalContradictions).toHaveLength(1);
    expect(signalContradictions[0].key).toBe("untraceable-move");
    expect(signalContradictions[0].tier).toBe("execution");
    expect(signalContradictions[0].values).toEqual({ momentumScore: 75, liquidityScore: 25 });
  });

  it("NO dispara cuando momentumScore=74 o liquidityScore=26", () => {
    expect(evaluateContradictions(cleanRow({ momentumScore: 74, liquidityScore: 25 })).signalContradictions).toEqual([]);
    expect(evaluateContradictions(cleanRow({ momentumScore: 75, liquidityScore: 26 })).signalContradictions).toEqual([]);
  });
});

describe("evaluateContradictions · C6 Estructura bajo debilidad", () => {
  it("DISPARA cuando weinsteinScore>=70 (OR) ∧ weaknessScore>=65 (en el umbral exacto)", () => {
    const row = cleanRow({ weinsteinScore: 70, minerviniScore: 0, weaknessScore: 65 });
    const { signalContradictions } = evaluateContradictions(row);
    expect(signalContradictions).toHaveLength(1);
    const c = signalContradictions[0];
    expect(c.key).toBe("structure-under-weakness");
    expect(c.tier).toBe("thesis");
    // La disjunction reporta AMBAS signalKeys (weinsteinScore, minerviniScore)
    // más weaknessScore.
    expect(c.signals).toEqual(["weinsteinScore", "minerviniScore", "weaknessScore"]);
    expect(c.values).toEqual({ weinsteinScore: 70, minerviniScore: 0, weaknessScore: 65 });
    expect(c.thresholds).toEqual({ weinsteinScore: ">=70", minerviniScore: ">=70", weaknessScore: ">=65" });
  });

  it("DISPARA también cuando solo minerviniScore>=70 (la otra rama del OR)", () => {
    const row = cleanRow({ weinsteinScore: 0, minerviniScore: 70, weaknessScore: 65 });
    const { signalContradictions } = evaluateContradictions(row);
    expect(signalContradictions).toHaveLength(1);
    expect(signalContradictions[0].key).toBe("structure-under-weakness");
    expect(signalContradictions[0].values.minerviniScore).toBe(70);
  });

  it("NO dispara cuando ambas weinstein/minervini < 70, aunque weaknessScore>=65", () => {
    const row = cleanRow({ weinsteinScore: 69, minerviniScore: 69, weaknessScore: 65 });
    expect(evaluateContradictions(row).signalContradictions).toEqual([]);
  });

  it("NO dispara cuando weaknessScore=64 (justo debajo), aunque weinsteinScore>=70", () => {
    const row = cleanRow({ weinsteinScore: 70, minerviniScore: 70, weaknessScore: 64 });
    expect(evaluateContradictions(row).signalContradictions).toEqual([]);
  });
});

// ===========================================================================
// 2. partial:true → contradictionsSkipped
// ===========================================================================

describe("evaluateContradictions · partial:true va a contradictionsSkipped", () => {
  // IMPORTANTE: una signalKey puede participar en varias reglas (p.ej.
  // momentumScore está en C1 y C5; setupQualityScore en C2/C3/C4). El contrato
  // para checks AND simples es "si CUALQUIER señal implicada tiene partial, la
  // regla se salta" — esto se evalúa por signalCoverage, NO por valores. Por
  // eso, marcar partial una señal compartida salta TODAS las reglas que la usan.
  // Para aislar el skip de UNA regla usamos señales EXCLUSIVAS de esa regla:
  //   C2 ← adProxyScore (exclusiva)
  //   C4 ← riskRewardScore (exclusiva)
  //   C5 ← liquidityScore (exclusiva)
  //   C6 ← weaknessScore (exclusiva), weinsteinScore/minerviniScore (exclusivas
  //        del {any:[...]} de C6 — pero con lógica de tres valores, ver suite
  //        "C6 · lógica de tres valores" abajo)
  // Para C1/C3 (rsGlobalPct compartido entre ambas) aislamos vía momentumScore
  // manteniendo rsGlobalPct fuera de la zona de cruce de C3.
  //
  // NOTA: los checks {any: [...]} (solo C6) siguen lógica de tres valores, NO
  // la regla conservadora "cualquier partial → skip". Esa suite está aparte.

  it("C2 se salta cuando adProxyScore es partial (aunque los valores crucen umbrales)", () => {
    // setupQualityScore=70 ∧ adProxyScore=35 dispararían C2, pero adProxyScore
    // (exclusiva de C2) es partial → solo C2 va a skipped. C3 requiere
    // rsGlobalPct<=40; lo dejamos en 60 para que el rsGlobalPct de C3 no cruce
    // (y rsGlobalPct no es partial) → C3 no se evalúa como candidata-skip.
    const row = {
      ...cleanRow({ setupQualityScore: 70, adProxyScore: 35 }),
      signalCoverage: cleanCoverage({ adProxyScore: { coverage: 0.5, partial: true } }),
    };
    const { signalContradictions, contradictionsSkipped } = evaluateContradictions(row);
    expect(signalContradictions).toEqual([]);
    expect(contradictionsSkipped).toEqual([
      { key: "base-under-distribution", reason: "partial:adProxyScore" },
    ]);
  });

  it("C5 se salta cuando liquidityScore es partial (exclusiva de C5)", () => {
    const row = {
      ...cleanRow({ momentumScore: 75, liquidityScore: 25 }),
      signalCoverage: cleanCoverage({ liquidityScore: { coverage: 0.5, partial: true } }),
    };
    const { signalContradictions, contradictionsSkipped } = evaluateContradictions(row);
    expect(signalContradictions).toEqual([]);
    expect(contradictionsSkipped).toEqual([
      { key: "untraceable-move", reason: "partial:liquidityScore" },
    ]);
  });

  it("C6 se salta cuando weaknessScore es partial (exclusiva de C6)", () => {
    const row = {
      ...cleanRow({ weinsteinScore: 70, minerviniScore: 50, weaknessScore: 65 }),
      signalCoverage: cleanCoverage({ weaknessScore: { coverage: 0.5, partial: true } }),
    };
    const { signalContradictions, contradictionsSkipped } = evaluateContradictions(row);
    expect(signalContradictions).toEqual([]);
    expect(contradictionsSkipped).toEqual([
      { key: "structure-under-weakness", reason: "partial:weaknessScore" },
    ]);
  });

  it("C2: dos señales parciales → reporta solo la PRIMERA en orden de declaración", () => {
    // C2 checks en orden: [setupQualityScore, adProxyScore]. Ambos parciales →
    // reason menciona setupQualityScore. C3/C4 también leen setupQualityScore,
    // así que también aparecen en skipped (es lo correcto: partial es por
    // signalCoverage). Verificamos que C2 específicamente reporta la primera.
    const row = {
      ...cleanRow({ setupQualityScore: 70, adProxyScore: 35 }),
      signalCoverage: cleanCoverage({
        setupQualityScore: { coverage: 0.3, partial: true },
        adProxyScore: { coverage: 0.5, partial: true },
      }),
    };
    const { contradictionsSkipped } = evaluateContradictions(row);
    const c2Skip = contradictionsSkipped.find((s) => s.key === "base-under-distribution");
    expect(c2Skip).toBeDefined();
    expect(c2Skip.reason).toBe("partial:setupQualityScore"); // primera en orden
  });

  it("Una regla con partial NO bloquea otra regla sin partial (se evalúan independientemente)", () => {
    // C2 dispararía (setup>=70 ∧ ad<=35) PERO adProxyScore es partial → C2 skip.
    // C5 dispara (mom>=75 ∧ liq<=25), liquidityScore NO es partial → C5 fired.
    // Aislamos con señales exclusivas (adProxyScore, liquidityScore) para que
    // el skip de C2 no arrastre a C5.
    const row = {
      ...cleanRow({ setupQualityScore: 70, adProxyScore: 35, momentumScore: 75, liquidityScore: 25 }),
      signalCoverage: cleanCoverage({ adProxyScore: { coverage: 0.5, partial: true } }),
    };
    const { signalContradictions, contradictionsSkipped } = evaluateContradictions(row);
    expect(signalContradictions.map((c) => c.key)).toEqual(["untraceable-move"]);
    expect(contradictionsSkipped.map((s) => s.key)).toContain("base-under-distribution");
  });
});

// ===========================================================================
// 2b. C6 · lógica de tres valores para checks {any: [...]}
// ===========================================================================
//
// C6 es la única regla con un check disyuntivo {any: [...]}:
//   (weinsteinScore>=70 ∨ minerviniScore>=70) ∧ weaknessScore>=65
//
// La lógica de tres valores (aplica SOLO a {any: [...]}) establece:
//   - Rama partial:false que satisface → OR confirmada true → la regla se
//     EVALÚA (la otra rama, aunque partial, es irrelevante).
//   - Ninguna rama confirma Y al menos una es partial → indeterminada → SALTA.
//   - Todas las ramas partial:false y ninguna satisface → OR confirmada false
//     → la regla simplemente NO dispara (no es un skip).
//
// Los checks AND simples (C1-C5 + la pata weaknessScore>=65 de C6) siguen la
// regla original sin excepción: cualquier partial ahí salta la regla entera,
// incluso si la OR está confirmada.

describe("evaluateContradictions · C6 lógica de tres valores (any-check)", () => {
  it("rama confirmada satisface → EVALÚA y dispara (rama partial irrelevante)", () => {
    // weinsteinScore=partial, minerviniScore=90 (completo, ≥70) → OR confirmada.
    // weaknessScore=70 (≥65). La regla DISPARA: la rama partial no hace falta.
    const row = {
      ...cleanRow({ weinsteinScore: 50, minerviniScore: 90, weaknessScore: 70 }),
      signalCoverage: cleanCoverage({ weinsteinScore: { coverage: 0.5, partial: true } }),
    };
    const { signalContradictions, contradictionsSkipped } = evaluateContradictions(row);
    expect(contradictionsSkipped).toEqual([]);
    expect(signalContradictions).toHaveLength(1);
    expect(signalContradictions[0].key).toBe("structure-under-weakness");
    // El entry reporta AMBAS signalKeys de la disyunción (incluso la partial),
    // con sus valores y thresholds — el shape de salida no cambia.
    expect(signalContradictions[0].signals).toEqual(["weinsteinScore", "minerviniScore", "weaknessScore"]);
    expect(signalContradictions[0].values).toEqual({ weinsteinScore: 50, minerviniScore: 90, weaknessScore: 70 });
  });

  it("misma lógica con la OTRA rama confirmando (weinstein=90, minervini=partial)", () => {
    // Simétrico al anterior: ahora es weinsteinScore la que confirma.
    const row = {
      ...cleanRow({ weinsteinScore: 90, minerviniScore: 50, weaknessScore: 70 }),
      signalCoverage: cleanCoverage({ minerviniScore: { coverage: 0.5, partial: true } }),
    };
    const { signalContradictions, contradictionsSkipped } = evaluateContradictions(row);
    expect(contradictionsSkipped).toEqual([]);
    expect(signalContradictions.map((c) => c.key)).toEqual(["structure-under-weakness"]);
  });

  it("ninguna rama confirma Y al menos una partial → SALTA (indeterminada)", () => {
    // weinsteinScore=partial, minerviniScore=50 (completo, <70, no confirma).
    // No podemos asegurar que la OR sea false (weinstein parcial podría haber
    // sido ≥70) → SALTA con reason de la primera rama partial.
    const row = {
      ...cleanRow({ weinsteinScore: 50, minerviniScore: 50, weaknessScore: 70 }),
      signalCoverage: cleanCoverage({ weinsteinScore: { coverage: 0.5, partial: true } }),
    };
    const { signalContradictions, contradictionsSkipped } = evaluateContradictions(row);
    expect(signalContradictions).toEqual([]);
    expect(contradictionsSkipped).toEqual([
      { key: "structure-under-weakness", reason: "partial:weinsteinScore" },
    ]);
  });

  it("ambas ramas parciales → SALTA reportando la primera en orden de declaración", () => {
    // weinsteinScore (declarada 1ra en C6) y minerviniScore (2da) ambas partial.
    // Ninguna confirma → indeterminada. Reason = weinsteinScore (primera).
    const row = {
      ...cleanRow({ weinsteinScore: 50, minerviniScore: 50, weaknessScore: 70 }),
      signalCoverage: cleanCoverage({
        weinsteinScore: { coverage: 0.5, partial: true },
        minerviniScore: { coverage: 0.5, partial: true },
      }),
    };
    const { signalContradictions, contradictionsSkipped } = evaluateContradictions(row);
    expect(signalContradictions).toEqual([]);
    expect(contradictionsSkipped).toEqual([
      { key: "structure-under-weakness", reason: "partial:weinsteinScore" },
    ]);
  });

  it("ambas ramas completas, ninguna satisface → NO dispara, NO salta (false confirmado)", () => {
    // weinsteinScore=60 (<70), minerviniScore=50 (<70), ambos partial:false.
    // La OR es false de forma confiable → la regla simplemente no dispara.
    // Esto NO es un skip: no hay incertidumbre.
    const row = {
      ...cleanRow({ weinsteinScore: 60, minerviniScore: 50, weaknessScore: 70 }),
      signalCoverage: cleanCoverage(), // ninguna partial
    };
    const result = evaluateContradictions(row);
    expect(result.signalContradictions).toEqual([]);
    expect(result.contradictionsSkipped).toEqual([]);
  });

  it("AND simple (weaknessScore) sigue conservador: partial ahí salta la regla aunque la OR confirme", () => {
    // Garantía de que la lógica de tres valores NO se filtró a los AND simples.
    // OR confirmada por minerviniScore=90, pero weaknessScore (la pata AND) es
    // partial → la regla se SALTA sin excepción (regla original para AND).
    const row = {
      ...cleanRow({ weinsteinScore: 50, minerviniScore: 90, weaknessScore: 70 }),
      signalCoverage: cleanCoverage({ weaknessScore: { coverage: 0.5, partial: true } }),
    };
    const { signalContradictions, contradictionsSkipped } = evaluateContradictions(row);
    expect(signalContradictions).toEqual([]);
    expect(contradictionsSkipped).toEqual([
      { key: "structure-under-weakness", reason: "partial:weaknessScore" },
    ]);
  });
});

// ===========================================================================
// 2c. AND simples (C1-C5) no cambiaron — cualquier partial salta sin excepción
// ===========================================================================
//
// Confirmación explícita de que la lógica de tres valores SOLO afectó a los
// checks {any: [...]}. Los checks AND simples de C1-C5 mantienen el
// comportamiento conservador: cualquier partial en el check → skip de la regla,
// sin importar si el valor del otro check ya confirmó el resultado.

describe("evaluateContradictions · checks AND simples siguen siendo conservadores", () => {
  it("C1: rsGlobalPct=70 (confirma >=70) + momentumScore=partial → SALTA (sin excepción)", () => {
    //Aunque rsGlobalPct ya satisface su rama, momentumScore partial en un AND
    // sigue siendo incertidumbre que puede cambiar el resultado → skip.
    // NOTA: momentumScore está en C1 y C5; ambas se saltan (comportamiento
    // correcto del AND conservador). Verificamos que C1 esté en skipped.
    const row = {
      ...cleanRow({ rsGlobalPct: 70, momentumScore: 30 }),
      signalCoverage: cleanCoverage({ momentumScore: { coverage: 0.5, partial: true } }),
    };
    const { signalContradictions, contradictionsSkipped } = evaluateContradictions(row);
    expect(signalContradictions).toEqual([]);
    expect(contradictionsSkipped).toEqual(
      expect.arrayContaining([
        { key: "leader-stalling", reason: "partial:momentumScore" },
        // C5 también lee momentumScore → también se salta (conservador).
        { key: "untraceable-move", reason: "partial:momentumScore" },
      ]),
    );
  });

  it("C2: setupQualityScore=70 (confirma) + adProxyScore=partial → SALTA (sin excepción)", () => {
    const row = {
      ...cleanRow({ setupQualityScore: 70, adProxyScore: 35 }),
      signalCoverage: cleanCoverage({ adProxyScore: { coverage: 0.5, partial: true } }),
    };
    const { signalContradictions, contradictionsSkipped } = evaluateContradictions(row);
    expect(signalContradictions).toEqual([]);
    // C2 aparece en skipped (también C3/C4 por shared setupQualityScore, pero
    // esos no tienen por qué estar aquí porque sus otros checks no cruzan).
    expect(contradictionsSkipped.map((s) => s.key)).toContain("base-under-distribution");
  });
});

// ===========================================================================
// 3. Orden: thesis antes que execution; C1→C6 dentro del tier
// ===========================================================================

describe("evaluateContradictions · orden de salida", () => {
  it("filas con varias contradicciones: thesis antes que execution", () => {
    // Disparamos C4 (execution) + C1 (thesis). En la salida, C1 va primero.
    const row = cleanRow({
      rsGlobalPct: 70, momentumScore: 30,            // C1 thesis
      setupQualityScore: 70, riskRewardScore: 30,    // C4 execution
    });
    const { signalContradictions } = evaluateContradictions(row);
    expect(signalContradictions.map((c) => c.key)).toEqual(["leader-stalling", "setup-no-entry"]);
    expect(signalContradictions.map((c) => c.tier)).toEqual(["thesis", "execution"]);
  });

  it("múltiples thesis respetan orden de declaración C1→C3 (C2 no dispara aquí)", () => {
    // C1 y C3 disparan (ambas thesis); C2 no porque adProxyScore=50 (>35).
    // Nota: C1 requiere rs≥70, C3 requiere rs≤40 — mutuamente excluyentes en
    // rsGlobalPct. Para que ambas disparen a la vez tendríamos que romper la
    // lógica. En su lugar disparamos C1+C2 (ambas thesis, orden C1→C2).
    const row = cleanRow({
      rsGlobalPct: 70, momentumScore: 30,           // C1
      setupQualityScore: 70, adProxyScore: 35,      // C2
    });
    const { signalContradictions } = evaluateContradictions(row);
    expect(signalContradictions.map((c) => c.key)).toEqual(["leader-stalling", "base-under-distribution"]);
  });

  it("C6 (thesis, declarada última) sale después de C1/C2/C3 dentro del bloque thesis", () => {
    // C2 + C6 disparan (ambas thesis). C6 está declarada última → sale después.
    const row = cleanRow({
      setupQualityScore: 70, adProxyScore: 35,      // C2
      weinsteinScore: 70, minerviniScore: 50, weaknessScore: 65, // C6
    });
    const { signalContradictions } = evaluateContradictions(row);
    expect(signalContradictions.map((c) => c.key)).toEqual(["base-under-distribution", "structure-under-weakness"]);
  });

  it("ambas execution (C4, C5) respetan orden de declaración C4→C5", () => {
    const row = cleanRow({
      setupQualityScore: 70, riskRewardScore: 30,   // C4
      momentumScore: 75, liquidityScore: 25,        // C5
    });
    const { signalContradictions } = evaluateContradictions(row);
    expect(signalContradictions.map((c) => c.key)).toEqual(["setup-no-entry", "untraceable-move"]);
  });
});

// ===========================================================================
// 4. Fila sin contradicciones → ambos arrays vacíos
// ===========================================================================

describe("evaluateContradictions · fila limpia", () => {
  it("fila con scores neutros no dispara ninguna regla y no tiene skips", () => {
    const row = cleanRow();
    const result = evaluateContradictions(row);
    expect(result.signalContradictions).toEqual([]);
    expect(result.contradictionsSkipped).toEqual([]);
  });

  it("fila vacía o inválida → ambos arrays vacíos (no crash)", () => {
    expect(evaluateContradictions({})).toEqual({ signalContradictions: [], contradictionsSkipped: [] });
    expect(evaluateContradictions(undefined)).toEqual({ signalContradictions: [], contradictionsSkipped: [] });
    expect(evaluateContradictions(null)).toEqual({ signalContradictions: [], contradictionsSkipped: [] });
  });
});

// ===========================================================================
// 5. percentileScope informativo
// ===========================================================================

describe("evaluateContradictions · percentileScope informativo", () => {
  it("hereda row.percentileScope si viene como 'batch'", () => {
    const row = { ...cleanRow({ rsGlobalPct: 70, momentumScore: 30 }), percentileScope: "batch" };
    const { signalContradictions } = evaluateContradictions(row);
    expect(signalContradictions[0].percentileScope).toBe("batch");
  });

  it("default 'batch' si row.percentileScope no está presente", () => {
    const row = cleanRow({ rsGlobalPct: 70, momentumScore: 30 });
    delete row.percentileScope;
    const { signalContradictions } = evaluateContradictions(row);
    expect(signalContradictions[0].percentileScope).toBe("batch");
  });
});

// ===========================================================================
// 6. Integridad del registro de reglas
// ===========================================================================

describe("CONTRADICTION_RULES · integridad declarativa", () => {
  it("tiene exactamente 6 reglas con keys C1-C6 esperadas", () => {
    expect(CONTRADICTION_RULES).toHaveLength(6);
    expect(CONTRADICTION_RULES.map((r) => r.key)).toEqual([
      "leader-stalling",
      "base-under-distribution",
      "pattern-in-laggard",
      "setup-no-entry",
      "untraceable-move",
      "structure-under-weakness",
    ]);
  });

  it("cada regla tiene tier válido (thesis|execution) y al menos 2 checks", () => {
    for (const rule of CONTRADICTION_RULES) {
      expect(["thesis", "execution"]).toContain(rule.tier);
      expect(Array.isArray(rule.checks)).toBe(true);
      expect(rule.checks.length).toBeGreaterThanOrEqual(2);
      for (const check of rule.checks) {
        if (Array.isArray(check.any)) {
          expect(check.any.length).toBeGreaterThanOrEqual(2);
          for (const sub of check.any) {
            expect(typeof sub.signalKey).toBe("string");
            expect(typeof sub.operator).toBe("string");
            expect(Number.isFinite(sub.threshold)).toBe(true);
          }
        } else {
          expect(typeof check.signalKey).toBe("string");
          expect(typeof check.operator).toBe("string");
          expect(Number.isFinite(check.threshold)).toBe(true);
        }
      }
    }
  });
});

// ===========================================================================
// 7. Integración: finalizeScanPercentiles + finalizeScanResultsInDb
// ===========================================================================
//
// Verifica que la finalización (que recalcula percentiles sobre el universo
// completo) evalúa contradicciones DESPUÉS de que rsGlobalPct sea final, y que
// el resultado va en el mismo metrics_patch que percentileScope:"final".

import { finalizeScanPercentiles, finalizeScanResultsInDb } from "@/lib/scanPercentileFinalization";

// Scores planos completos para todas las signalKeys que las reglas C1-C6 leen.
// Usado como defaults en makeDbRow: cada test sobreescribe solo los relevantes.
const FULL_NEUTRAL_SCORES = {
  momentumScore: 50, setupQualityScore: 50, adProxyScore: 50, riskRewardScore: 50,
  liquidityScore: 50, weinsteinScore: 50, minerviniScore: 50, weaknessScore: 30,
};

// Construye una fila DB con los campos que la finalización + evaluateContradictions
// consumen. raw lleva los scores planos + signalCoverage; metrics lleva el
// scope batch previo. `strength` controla el rsRawComposite (vía perf/rs fields)
// para ubicar a la fila arriba o abajo del universo al finalizar percentiles.
function makeDbRow(symbol, {
  rawScores = {},
  signalCoverage = null,
  metrics = {},
  id,
  // Campos que alimentan rsRawComposite: perf3m pondera 0.38 (el máximo).
  // strength=100 → perf3m=100 → composite alto (top del universo).
  strength = 0,
} = {}) {
  return {
    id: id || `${symbol}-uuid`,
    symbol,
    metrics: { percentileScope: "batch", ...metrics },
    raw: {
      symbol,
      perf3m: strength, perf6m: strength * 0.5, perf12m: strength * 0.3,
      rs3m: 0, rs6m: 0, rs12m: 0,
      distance52w: -10, maxDrawdown63d: 15,
      country: "US", theme: "Technology", sector: "Technology",
      ...FULL_NEUTRAL_SCORES,
      ...rawScores,
      ...(signalCoverage ? { signalCoverage } : {}),
    },
  };
}

// Universo de 25 filas donde el símbolo `targetSymbol` tiene strength=100 (top)
// y las 24 restantes strength=0-50. Con sample=25 (≥ RS_GLOBAL_MIN_SAMPLE=20),
// el rsGlobalPct FINAL del target será alto (top del universo → percentil ≥70).
// rsRawComposite(target) = 100*0.38 + 50*0.24 + 30*0.14 + ... ≈ 64.2
// rsRawComposite(otros strength=0) ≈ -10*0.16 - 15*0.12 = -3.4
// → target es el máximo absoluto → belowOrEqual=25/25 → percentileFromSorted
// devuelve clamp(25/25*99, 1, 99) = 99. Pero el conteo es "≤ value" y el propio
// target cuenta → 25/25=1.0 → 99 (top). Eso es ≥70 → C1 dispararía si mom≤30.
function buildUniverseWithLeader(targetSymbol = "LEAD") {
  const rows = [];
  rows.push(makeDbRow(targetSymbol, {
    rawScores: { ...FULL_NEUTRAL_SCORES, momentumScore: 30 },
    id: `${targetSymbol}-uuid`,
    strength: 100,
  }));
  // 24 filas más débiles (strength 0-50) para alcanzar sample ≥20.
  for (let i = 1; i <= 24; i++) {
    rows.push(makeDbRow(`F${i}`, {
      rawScores: { ...FULL_NEUTRAL_SCORES },
      id: `F${i}-uuid`,
      strength: (i * 2) % 50,
    }));
  }
  return rows;
}

describe("finalizeScanPercentiles · integración con contradicciones", () => {
  it("evalúa C1 sobre el rsGlobalPct FINAL (top del universo → percentil alto)", () => {
    // LEAD es el más fuerte de un universo de 25 → su rsGlobalPct final será ~99
    // (top). Con momentumScore=30 (≤30), C1 dispara.
    const universe = buildUniverseWithLeader("LEAD");
    const patches = finalizeScanPercentiles(universe);
    const leadPatch = patches.find((p) => p.id === "LEAD-uuid");

    // Sanity: la finalización efectivamente recalculó rsGlobalPct como top.
    expect(leadPatch.metrics_patch.percentileScope).toBe("final");
    expect(leadPatch.metrics_patch.rsGlobalPct).toBeGreaterThanOrEqual(70);

    // C1 dispara sobre el valor final.
    expect(leadPatch.metrics_patch.signalContradictions.map((c) => c.key)).toContain("leader-stalling");
    expect(leadPatch.metrics_patch.contradictionsSkipped).toEqual([]);
    const c1 = leadPatch.metrics_patch.signalContradictions.find((c) => c.key === "leader-stalling");
    expect(c1.percentileScope).toBe("final");
    // El value reportado es el rsGlobalPct final (no el batch-local).
    expect(c1.values.rsGlobalPct).toBeGreaterThanOrEqual(70);
  });

  it("sin contradicciones → ambos arrays vacíos en el patch (universe limpio)", () => {
    // Universo de 25 filas con scores neutros: ninguna regla dispara.
    const universe = [];
    for (let i = 0; i < 25; i++) {
      universe.push(makeDbRow(`N${i}`, { rawScores: { ...FULL_NEUTRAL_SCORES }, id: `N${i}-uuid`, strength: i * 3 }));
    }
    const patches = finalizeScanPercentiles(universe);
    for (const patch of patches) {
      expect(patch.metrics_patch.signalContradictions).toEqual([]);
      expect(patch.metrics_patch.contradictionsSkipped).toEqual([]);
      expect(patch.metrics_patch.percentileScope).toBe("final");
    }
  });

  it("respeta signalCoverage.partial: la regla se salta, no dispara", () => {
    // Usamos C5 (momentumScore+liquidityScore, sin setupQualityScore ni
    // rsGlobalPct) para aislar el comportamiento del partial sin que otras
    // reglas disparen incidentalmente. momentumScore=75 ∧ liquidityScore=25
    // dispararían C5, pero liquidityScore (exclusiva de C5) es partial → skip.
    // NOTA: momentumScore=75 también aparece en C1, pero C1 requiere
    // rsGlobalPct>=70; la PART tiene strength=0 → rsGlobalPct bajo → C1 no es
    // candidata-skip (rsGlobalPct no es partial). Así skipped = solo C5.
    const universe = [];
    for (let i = 0; i < 24; i++) {
      universe.push(makeDbRow(`P${i}`, { rawScores: { ...FULL_NEUTRAL_SCORES }, id: `P${i}-uuid`, strength: i }));
    }
    universe.push(makeDbRow("PART", {
      rawScores: { ...FULL_NEUTRAL_SCORES, momentumScore: 75, liquidityScore: 25 },
      signalCoverage: { liquidityScore: { coverage: 0.5, partial: true } },
      id: "PART-uuid",
      strength: 0,
    }));
    const patches = finalizeScanPercentiles(universe);
    const partPatch = patches.find((p) => p.id === "PART-uuid");
    expect(partPatch.metrics_patch.signalContradictions).toEqual([]);
    expect(partPatch.metrics_patch.contradictionsSkipped).toEqual([
      { key: "untraceable-move", reason: "partial:liquidityScore" },
    ]);
  });
});

// --- Integración del orchestrator (con mock de Supabase) -------------------
//
// Verifica el contrato: finalizeScanResultsInDb carga filas, evalúa
// contradicciones sobre el universo finalizado, y envía el resultado en el
// payload de la RPC atómica (junto con percentileScope:"final").

vi.mock("@/lib/supabaseServer", () => ({
  supabaseRequestAll: vi.fn(),
  supabaseRpc: vi.fn(),
}));

import { supabaseRequestAll, supabaseRpc } from "@/lib/supabaseServer";

describe("finalizeScanResultsInDb · integra contradicciones en RPC atómica", () => {
  afterEach(() => {
    supabaseRequestAll.mockReset();
    supabaseRpc.mockReset();
  });

  it("scan multi-batch: cada patch del payload RPC lleva signalContradictions", async () => {
    // Universo de 25 filas (≥ RS_GLOBAL_MIN_SAMPLE) simulando un scan multi-batch
    // finalizado. Tres casos distinguibles, cada uno en una fila distinta y
    // usando reglas con señales NO compartidas para que el comportamiento sea
    // determinista respecto al rsGlobalPct finalizado:
    //  - LEAD: top del universo (rsGlobalPct final ≥70) + momentumScore=30 → C1.
    //  - MID (F10): dispara C6 (weinsteinScore=70 ∧ weaknessScore=65) — C6 no
    //    lee setupQualityScore ni rsGlobalPct, así que su disparo es estable
    //    sin importar la posición de MID en el universo.
    //  - PART: dispararía C5 (momentumScore=75 ∧ liquidityScore=25) pero
    //    liquidityScore (exclusiva de C5) es partial → skipped.
    //  - Resto: limpio.
    const rows = buildUniverseWithLeader("LEAD"); // 25 filas, LEAD strength=100
    // MID (F10): forzamos scores C6.
    const mid = rows.find((r) => r.id === "F10-uuid");
    mid.raw.weinsteinScore = 70;
    mid.raw.minerviniScore = 50;
    mid.raw.weaknessScore = 65;
    // Reemplazamos F11 por PART con partial.
    const partIdx = rows.findIndex((r) => r.id === "F11-uuid");
    rows[partIdx] = makeDbRow("PART", {
      rawScores: { ...FULL_NEUTRAL_SCORES, momentumScore: 75, liquidityScore: 25 },
      signalCoverage: { liquidityScore: { coverage: 0.5, partial: true } },
      id: "PART-uuid",
      strength: 22, // mid strength
    });

    supabaseRequestAll.mockResolvedValue(rows);
    supabaseRpc.mockResolvedValue([{ updated_count: rows.length }]);

    await finalizeScanResultsInDb("scan-c", "owner-c");

    expect(supabaseRpc).toHaveBeenCalledTimes(1);
    const [, payload] = supabaseRpc.mock.calls[0];
    expect(payload.p_patches).toHaveLength(rows.length);

    const byId = Object.fromEntries(payload.p_patches.map((p) => [p.id, p.metrics_patch]));

    // LEAD: C1 disparada (rsGlobalPct final ≥70 ∧ momentumScore=30).
    expect(byId["LEAD-uuid"].rsGlobalPct).toBeGreaterThanOrEqual(70);
    expect(byId["LEAD-uuid"].signalContradictions.map((c) => c.key)).toContain("leader-stalling");
    expect(byId["LEAD-uuid"].contradictionsSkipped).toEqual([]);

    // MID (F10): C6 disparada (weinsteinScore=70 ∧ weaknessScore=65).
    expect(byId["F10-uuid"].signalContradictions.map((c) => c.key)).toContain("structure-under-weakness");
    expect(byId["F10-uuid"].contradictionsSkipped).toEqual([]);

    // PART: skip por partial:liquidityScore.
    expect(byId["PART-uuid"].signalContradictions).toEqual([]);
    expect(byId["PART-uuid"].contradictionsSkipped).toEqual([
      { key: "untraceable-move", reason: "partial:liquidityScore" },
    ]);

    // Todas las filas tienen scope "final" en el patch (la finalización se ejecutó).
    for (const patch of payload.p_patches) {
      expect(patch.metrics_patch.percentileScope).toBe("final");
      expect(Array.isArray(patch.metrics_patch.signalContradictions)).toBe(true);
      expect(Array.isArray(patch.metrics_patch.contradictionsSkipped)).toBe(true);
    }
  });
});
