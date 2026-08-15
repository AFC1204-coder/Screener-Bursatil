// tests/signalRegistryAudit.test.js
//
// Auditoría ejecutable del contrato docs/audit-score-coherence-contract.md v4.
//
// Tres rutas auditadas, EJECUTADAS REAL con la misma fixture determinista:
//   A: lib/researchRow.js · buildResearchRow — API pública.
//   B: lib/screenerPipeline.js · sectorize — API pública.
//   C: lib/materializedScanner.js · buildResearchRow/sectorize — vía seam
//      `_forTest` (cambio no funcional añadido al final del archivo).
//
// Equivalencia numérica: para cada señal EQUIVALENT/EQUIVALENT_ADAPT en la
// matriz, se compara el valor post-ruta contra el canon (computeSignal) o
// contra el golden snapshot.
//
// El test FALLA si:
//   1. Registry ↔ matriz desincronizados.
//   2. COMPOSITE_WEIGHTS no suma 1.0.
//   3. Ruta A/B/C produce un valor numéricamente distinto del canon.
//   4. Una DIVERGENCE_DOC no tiene respaldo literal en el ADR.
//   5. Una DIVERGENCE_PENDING no aparece en el Markdown generado.
//   6. El archivo Markdown en disco no coincide byte-a-byte con
//      renderContractMarkdown().
//   7. El estado global indica pendiente cuando no debería o viceversa.
//   8. El ipoScore DIVERGENCE_DOC: B y C no se construyen desde la misma
//      semilla, o la diferencia observada no es exactamente 0.02*ipoScore.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildResearchRow as routeABuildResearchRow } from "@/lib/researchRow";
import { sectorize as routeBSectorize } from "@/lib/screenerPipeline";
import { _forTest as routeC } from "@/lib/materializedScanner";
import {
  SIGNAL_REGISTRY,
  COMPOSITE_WEIGHTS,
  computeSignal,
  scoreWeakness,
} from "@/lib/scoringEngine";
import {
  scoreWeinstein as snapWeinstein,
  scoreMinervini as snapMinervini,
  scoreMomentum as snapMomentum,
  scoreRisk as snapRisk,
  scoreRiskReward as snapRiskReward,
  scoreVolumeEffect as snapVolumeEffect,
  scoreVolume as snapVolume,
  scoreLiquidity as snapLiquidity,
  scoreIpo as snapIpo,
  scoreObjectiveSetupQuality as snapObjectiveSetup,
  scorePatternContribution as snapPatternContribution,
  scorePatternQuality as snapPatternQuality,
  scoreSetupQuality as snapSetupQuality,
  scoreDemandQuality as snapDemand,
  scoreGrowthQuality as snapGrowth,
  scoreEpsGrowthProxy as snapEps,
  scoreAdProxy as snapAdProxy,
} from "./_golden_snapshot_scoring.js";
import {
  ACCEPTED_DIVERGENCES,
  EQUIVALENCE_MATRIX,
  PENDING_DIVERGENCES,
  auditGlobalStatus,
  compositeWeightsCheck,
  registryInventory,
  renderContractMarkdown,
  validateMatrixCoverage,
} from "./_audit_contract.js";
import { stage2Bars, stage4Bars } from "./fixtures.js";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");
const ADR_PATH = path.join(PROJECT_ROOT, "docs/adr-scoring-pipeline-canon.md");
const MATERIALIZED_PATH = path.join(PROJECT_ROOT, "lib/materializedScanner.js");
const CONTRACT_PATH = path.join(PROJECT_ROOT, "docs/audit-score-coherence-contract.md");

const readFile = (p) => fs.readFileSync(p, "utf8");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const isAcceptable = (v) => v === null || (typeof v === "number" && Number.isFinite(v));

function expectSameNumber(label, expected, actual) {
  if (expected === null && actual === null) return;
  if (expected === null || actual === null) {
    throw new Error(`${label}: divergencia — expected=${expected}, actual=${actual}`);
  }
  if (Math.abs(expected - actual) > 1e-6) {
    throw new Error(`${label}: divergencia numérica — expected=${expected}, actual=${actual}, diff=${Math.abs(expected - actual)}`);
  }
}

/**
 * Construye una fila determinista lista para sectorize (con todos los
 * campos que sectorize necesita: precios, SMAs, RS, growthMetrics).
 * Esta es la SEMILLA COMÚN para B y C en el test de ipoScore DIVERGENCE_DOC.
 *
 * IMPORTANTE: para que B y C operen sobre inputs NUMÉRICAMENTE IDÉNTICOS,
 * partimos del builder de Ruta A (más conservador). NO mutamos rsGlobalPct
 * ni campos que el builder ya lee internamente — eso falsea el test.
 */
function makePreSectorizeRow(label = "AUDIT_SEED") {
  const profile = {
    growthMetrics: {
      revenueGrowth: 18, earningsGrowth: 22, grossMargin: 45,
      operatingMargin: 18, profitMargin: 14, ebitdaMargin: 25,
      roe: 20, roa: 8, debtToEquity: 50, currentRatio: 1.5,
    },
  };
  const row = routeABuildResearchRow(label, { bars: stage2Bars() }, profile, { requireLongHistory: false }, {});
  // Para que ipoScore > 0: necesitamos un IPO válido con condiciones favorables.
  // Sin esto, ipoScore queda en 0 y la diferencia B-C es 0 (degenerate case).
  row.ipoDate = "2024-06-15"; // ~25 meses → bucket m<36 → age=24
  row.distanceATH = -5;       // cerca de ATH → high=25
  row.distance52w = -5;
  row.avgVolume = 1500000;    // liq=15
  row.perf3m = 15;            // > 10 → st=20
  return row;
}

/**
 * Variante con ipoScore NO computable (para tests que no requieren la
 * divergencia ipoScore explícita).
 */
function makePreSectorizeRowNoIpo(label = "AUDIT_SEED_NOIPO") {
  const profile = {
    growthMetrics: {
      revenueGrowth: 18, earningsGrowth: 22, grossMargin: 45,
      operatingMargin: 18, profitMargin: 14, ebitdaMargin: 25,
      roe: 20, roa: 8, debtToEquity: 50, currentRatio: 1.5,
    },
  };
  return routeABuildResearchRow(label, { bars: stage2Bars() }, profile, { requireLongHistory: false }, {});
}

/** Clona profundamente una fila para que B y C operen sobre inputs idénticos. */
function deepCloneRow(row) {
  return JSON.parse(JSON.stringify(row));
}

// ---------------------------------------------------------------------------
// 1. Integridad estructural — registry, matriz, pesos, estado global.
// ---------------------------------------------------------------------------

describe("audit · registry ↔ matriz ↔ contrato (estructura)", () => {
  const inv = registryInventory();
  const status = auditGlobalStatus();

  it(`registry tiene ${inv.total} señales (${inv.positiveCount} positives + ${inv.negativeCount} negative)`, () => {
    expect(inv.positiveCount + inv.negativeCount).toBe(inv.total);
    expect(inv.positives.length).toBe(17);
    expect(inv.negatives).toEqual(["weaknessScore"]);
    expect(inv.negatives.length).toBe(1);
  });

  it("matriz cubre exactamente las mismas claves que el registry (sin huérfanas ni faltantes)", () => {
    const v = validateMatrixCoverage();
    expect(v.missingInMatrix, `señales del registry sin clasificar: ${v.missingInMatrix.join(",")}`).toEqual([]);
    expect(v.extraInMatrix, `clasificaciones huérfanas en la matriz: ${v.extraInMatrix.join(",")}`).toEqual([]);
    expect(v.ok).toBe(true);
  });

  it("el composite conserva la escala 0-100 renormalizando sobre los pesos declarados", () => {
    // Antes esta invariante era "los pesos suman 1.00". Dejó de serlo el
    // 2026-08-15, cuando el término IPO salió de COMPOSITE_WEIGHTS: suman .98
    // y el motor divide por esa suma. Lo que hay que proteger no es el total
    // declarado sino la escala — un composite comprimido un 2% es exactamente
    // el defecto que se corrigió, y "suman 1.00" no lo habría detectado.
    const check = compositeWeightsCheck();
    expect(check.ok, `con todos los términos a 100 el composite da ${check.scaleTop}, no 100`).toBe(true);
    expect(check.scaleTop).toBeCloseTo(100, 9);
    expect(check.sum).toBeCloseTo(0.98, 6);
  });

  it("estado global expone pendingCount y acceptedCount coherentes", () => {
    expect(status.pendingCount).toBe(PENDING_DIVERGENCES.length);
    expect(status.acceptedCount).toBe(ACCEPTED_DIVERGENCES.length);
    expect(typeof status.isReadyForClosure).toBe("boolean");
    expect(typeof status.message).toBe("string");
  });

  it("mientras existan DIVERG-PENDIENTE, Camino A NO está listo para cierre", () => {
    if (status.pendingCount > 0) {
      expect(status.isReadyForClosure).toBe(false);
      expect(status.message).toMatch(/NO listo|pendiente/i);
    }
  });

  it("cada entrada del registry tiene shape { key, requiredInputs: string[], direction, compute }", () => {
    for (const [key, entry] of Object.entries(SIGNAL_REGISTRY)) {
      expect(entry.key).toBe(key);
      expect(Array.isArray(entry.requiredInputs)).toBe(true);
      if (entry.requiredInputs.length === 0) {
        expect(key).toBe("patternContributionScore");
      }
      expect(["positive", "negative"]).toContain(entry.direction);
      expect(typeof entry.compute).toBe("function");
    }
  });

  it("weaknessScore.requiredInputs.length === 20", () => {
    expect(SIGNAL_REGISTRY.weaknessScore.requiredInputs.length).toBe(20);
  });

  it("growthScore/epsGrowthProxyScore usan dot-notation en growthMetrics.*", () => {
    expect(SIGNAL_REGISTRY.growthScore.requiredInputs.length).toBe(9);
    expect(SIGNAL_REGISTRY.epsGrowthProxyScore.requiredInputs.length).toBe(6);
    expect(SIGNAL_REGISTRY.growthScore.requiredInputs.every((p) => p.startsWith("growthMetrics."))).toBe(true);
    expect(SIGNAL_REGISTRY.epsGrowthProxyScore.requiredInputs.every((p) => p.startsWith("growthMetrics."))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Sincronización Markdown ↔ matriz (byte-a-byte con el renderizador).
// ---------------------------------------------------------------------------

describe("audit · contrato Markdown ↔ matriz estructurada (byte-a-byte)", () => {
  const expected = renderContractMarkdown();
  const actual = readFile(CONTRACT_PATH);

  it("el archivo docs/audit-score-coherence-contract.md coincide EXACTAMENTE con renderContractMarkdown()", () => {
    if (expected !== actual) {
      // Mostrar la primera diferencia para diagnóstico.
      const linesExpected = expected.split("\n");
      const linesActual = actual.split("\n");
      for (let i = 0; i < Math.max(linesExpected.length, linesActual.length); i++) {
        if (linesExpected[i] !== linesActual[i]) {
          throw new Error(`Markdown desincronizado en línea ${i + 1}:\n  expected: ${JSON.stringify(linesExpected[i])}\n  actual:   ${JSON.stringify(linesActual[i])}\n\nRegenera con: npx vitest run tests/_regen.test.js (o un wrapper equivalente que llame a renderContractMarkdown() y sobreescriba el archivo).`);
        }
      }
    }
    expect(actual).toBe(expected);
  });

  it("el render incluye los IDs de las 8 DIVERG-DOC aceptadas", () => {
    for (const div of ACCEPTED_DIVERGENCES) {
      expect(expected, `${div.id} ausente en render`).toContain(div.id);
    }
  });

  it("el render incluye los IDs de las DIVERG-PENDIENTE", () => {
    for (const div of PENDING_DIVERGENCES) {
      expect(expected, `${div.id} ausente en render`).toContain(div.id);
    }
  });

  it("el render declara pendingCount=0 y base auditable lista, sin declarar cierre formal", () => {
    expect(expected).toContain("**Divergencias pendientes (DIVERG-PENDIENTE):** 0");
    expect(expected).toMatch(/\*\*Listo para cierre formal:\*\* SÍ/);
  });

  it("cada celda (señal × ruta × kind) está presente en el render", () => {
    for (const [route, matrix] of Object.entries(EQUIVALENCE_MATRIX)) {
      for (const [signal, entry] of Object.entries(matrix)) {
        const sig = "`" + signal + "`";
        const cellLine = `| ${sig} | ${entry.kind} |`;
        expect(expected, `celda (route=${route}, signal=${signal}, kind=${entry.kind}) ausente del render`).toContain(cellLine);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Ruta A — buildResearchRow: equivalencia numérica contra computeSignal.
// ---------------------------------------------------------------------------

describe("audit · Ruta A (buildResearchRow) equivalencia numérica vs computeSignal", () => {
  const row = makePreSectorizeRow("AUDIT_STAGE2");
  const declaredEquivalents = Object.entries(EQUIVALENCE_MATRIX.researchRow)
    .filter(([, e]) => e.kind === "EQUIVALENT" || e.kind === "EQUIVALENT_ADAPT")
    .map(([k]) => k);

  for (const signal of declaredEquivalents) {
    it(`Ruta A · ${signal} · row.X === computeSignal(row, X).value`, () => {
      const direct = computeSignal(row, signal);
      const fromBuilder = row[signal];
      expect(isAcceptable(direct.value), `computeSignal ${signal} no es finito: ${direct.value}`).toBe(true);
      expect(isAcceptable(fromBuilder), `row.${signal} no es finito: ${fromBuilder}`).toBe(true);
      expectSameNumber(`${signal} builder vs canon`, direct.value, fromBuilder);
    });
  }

  it("Ruta A · signalCoverage contiene todas las señales declaradas como EQUIVALENT/EQUIV_ADAPT", () => {
    for (const k of declaredEquivalents) {
      expect(row.signalCoverage, `signalCoverage.${k} ausente`).toBeDefined();
      expect(row.signalCoverage[k]).toHaveProperty("coverage");
      expect(row.signalCoverage[k]).toHaveProperty("partial");
      expect(typeof row.signalCoverage[k].coverage).toBe("number");
      expect(typeof row.signalCoverage[k].partial).toBe("boolean");
    }
  });

  it("Ruta A · chartEstimated=false (invariante de superficie)", () => {
    expect(row.chartEstimated).toBe(false);
  });

  it("Ruta A · weaknessScore: campo plano === computeSignal value", () => {
    expect(row.weaknessScore).toBe(computeSignal(row, "weaknessScore").value);
  });
});

// ---------------------------------------------------------------------------
// 4. Ruta B — screenerPipeline.sectorize: equivalencia numérica real.
// ---------------------------------------------------------------------------

describe("audit · Ruta B (screenerPipeline.sectorize) equivalencia numérica vs canon", () => {
  const seed = makePreSectorizeRow("AUDIT_STAGE2");
  // Construimos 3 copias (B opera sobre un array para percentiles).
  const inputRows = [deepCloneRow(seed), deepCloneRow({ ...seed, symbol: "AUDIT_B2" }), deepCloneRow({ ...seed, symbol: "AUDIT_B3" })];
  const out = routeBSectorize(inputRows);
  expect(out.length).toBe(3);
  const row = out[0];

  // Los nombres del composite. `totalScore` es una copia byte a byte de
  // `compositeScore`: conviven porque `total_score` es la columna de la base y
  // el único de los dos que llevan las filas ligeras, mientras que
  // `compositeScore` lo leen directamente lib/leaderboards.js:385,490,
  // lib/discoveryAudit.js:61 y lib/screenerMarket.jsx:107. Este test fija que
  // no puedan separarse mientras convivan: dos nombres, un número.
  it("Ruta B · los dos nombres del composite son el mismo número", () => {
    expect(isAcceptable(row.compositeScore)).toBe(true);
    expectSameNumber("totalScore === compositeScore", row.compositeScore, row.totalScore);
  });

  it("Ruta B · legacyTotalScore ya no se produce", () => {
    // Era un cuarto compuesto de trece términos cuyo único consumidor era una
    // columna del CSV. Eliminado el 2026-08-15.
    expect(row.legacyTotalScore).toBeUndefined();
  });

  // Pre-calc preservados: B no recalcula, preserva el valor de Ruta A.
  const preCalcSignals = [
    "weinsteinScore", "minerviniScore", "momentumScore", "riskScore",
    "riskRewardScore", "volumeEffectScore", "volumeScore", "liquidityScore",
  ];
  for (const signal of preCalcSignals) {
    it(`Ruta B · ${signal} · preserva el valor pre-calculado de Ruta A (misma semilla)`, () => {
      const inputVal = inputRows[0][signal];
      const outputVal = row[signal];
      expect(isAcceptable(inputVal)).toBe(true);
      expect(isAcceptable(outputVal)).toBe(true);
      expectSameNumber(`${signal} preservado de A`, inputVal, outputVal);
      expect(row.signalCoverage[signal]).toBeDefined();
    });
  }

  it("Ruta B · ipoScore · row.X === computeSignal({...r, sectorScore}, ipoScore).value", () => {
    const sectorScore = row.sectorScore;
    expect(isAcceptable(sectorScore), "sectorScore debe estar poblado tras sectorize").toBe(true);
    const canonical = computeSignal({ ...row, sectorScore }, "ipoScore");
    expect(isAcceptable(canonical.value)).toBe(true);
    expectSameNumber("ipoScore B vs canon", canonical.value, row.ipoScore);
    expect(row.signalCoverage.ipoScore).toBeDefined();
  });

  const computedByB = [
    "objectiveSetupScore", "patternContributionScore", "patternScore",
    "setupQualityScore", "demandScore", "growthScore",
  ];
  for (const signal of computedByB) {
    it(`Ruta B · ${signal} · row.X === computeSignal(row, X).value`, () => {
      const canonical = computeSignal(row, signal);
      expect(isAcceptable(canonical.value)).toBe(true);
      expectSameNumber(`${signal} B vs canon`, canonical.value, row[signal]);
      expect(row.signalCoverage[signal]).toBeDefined();
    });
  }

  describe("Ruta B · adProxyScore / epsGrowthProxyScore — regla de override", () => {
    it("adProxyScore pre-calc finito → preservado", () => {
      const preCalc = 73;
      const seed2 = makePreSectorizeRow("OVR_B");
      seed2.adProxyScore = preCalc;
      seed2.epsGrowthProxyScore = 66;
      const out2 = routeBSectorize([seed2, deepCloneRow(seed2), deepCloneRow(seed2)]);
      expect(out2[0].adProxyScore).toBe(preCalc);
    });

    it("adProxyScore pre-calc no-finito → fallback === canon", () => {
      const seed2 = makePreSectorizeRow("FBK_B");
      seed2.adProxyScore = null;
      const out2 = routeBSectorize([seed2, deepCloneRow(seed2), deepCloneRow(seed2)]);
      const canonical = computeSignal(out2[0], "adProxyScore");
      expect(isAcceptable(canonical.value)).toBe(true);
      expectSameNumber("adProxyScore fallback", canonical.value, out2[0].adProxyScore);
    });

    it("epsGrowthProxyScore pre-calc finito → preservado", () => {
      const preCalc = 66;
      const seed2 = makePreSectorizeRow("OVR_E");
      seed2.epsGrowthProxyScore = preCalc;
      const out2 = routeBSectorize([seed2, deepCloneRow(seed2), deepCloneRow(seed2)]);
      expect(out2[0].epsGrowthProxyScore).toBe(preCalc);
    });

    it("epsGrowthProxyScore pre-calc no-finito → fallback === canon", () => {
      const seed2 = makePreSectorizeRow("FBK_E");
      seed2.epsGrowthProxyScore = null;
      const out2 = routeBSectorize([seed2, deepCloneRow(seed2), deepCloneRow(seed2)]);
      const canonical = computeSignal(out2[0], "epsGrowthProxyScore");
      if (canonical.value === null) {
        expect(out2[0].epsGrowthProxyScore).toBeNull();
      } else {
        expectSameNumber("epsGrowthProxyScore fallback", canonical.value, out2[0].epsGrowthProxyScore);
      }
    });
  });

  it("Ruta B · weaknessScore: doble invocación consistente", () => {
    expect(row.weaknessScore).toBe(computeSignal(row, "weaknessScore").value);
    expect(row.weaknessLabel).toBeDefined();
    expect(Array.isArray(row.weaknessReasons)).toBe(true);
  });

  it("Ruta B · compositeLabel + compositeReasons + compositeRisks presentes", () => {
    expect(row.compositeLabel).toBeDefined();
    expect(row.compositeScore).toBeGreaterThan(0);
    expect(Array.isArray(row.compositeReasons)).toBe(true);
    expect(Array.isArray(row.compositeRisks)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. Ruta C — materializedScanner vía seam _forTest.
// ---------------------------------------------------------------------------

describe("audit · Ruta C (materializedScanner._forTest) equivalencia numérica vs canon", () => {
  it("seam _forTest expone buildResearchRow y sectorize reales", () => {
    expect(typeof routeC.buildResearchRow).toBe("function");
    expect(typeof routeC.sectorize).toBe("function");
  });

  describe("Ruta C · buildResearchRow — equivalencia numérica por señal", () => {
    const profile = {
      growthMetrics: {
        revenueGrowth: 18, earningsGrowth: 22, grossMargin: 45,
        operatingMargin: 18, profitMargin: 14, ebitdaMargin: 25,
        roe: 20, roa: 8, debtToEquity: 50, currentRatio: 1.5,
      },
    };
    const rowC = routeC.buildResearchRow("C_STAGE2", { bars: stage2Bars() }, profile, {}, {});

    const declaredEquivalents = Object.entries(EQUIVALENCE_MATRIX.materializedScanner_build)
      .filter(([, e]) => e.kind === "EQUIVALENT" || e.kind === "EQUIVALENT_ADAPT")
      .map(([k]) => k);

    for (const signal of declaredEquivalents) {
      it(`Ruta C · buildResearchRow · ${signal} (${EQUIVALENCE_MATRIX.materializedScanner_build[signal].kind}) · row.X === computeSignal(row, X).value`, () => {
        const direct = computeSignal(rowC, signal);
        const fromBuilder = rowC[signal];
        expect(isAcceptable(direct.value), `computeSignal ${signal} no es aceptable: ${direct.value}`).toBe(true);
        expect(isAcceptable(fromBuilder), `rowC.${signal} no es aceptable: ${fromBuilder}`).toBe(true);
        expectSameNumber(`${signal} C builder vs canon`, direct.value, fromBuilder);
        expect(rowC.signalCoverage[signal]).toBeDefined();
      });
    }

    it("Ruta C · chartEstimated=false tras guard decision-grade", () => {
      expect(rowC.chartEstimated).toBe(false);
    });

    it("Ruta C · rechaza chart estimado antes de ensamblar la fila", () => {
      expect(() => routeC.buildResearchRow("C_ESTIMATED", {
        dataQuality: { status: "estimated" },
        bars: stage2Bars(),
      }, profile, {}, {})).toThrow("Serie estimada excluida de materialized scan");
    });

    it("Ruta C · weaknessScore: doble invocación consistente", () => {
      expect(rowC.weaknessScore).toBe(computeSignal(rowC, "weaknessScore").value);
    });
  });

  describe("Ruta C · sectorize — equivalencia numérica por señal", () => {
    const profile = {
      growthMetrics: {
        revenueGrowth: 18, earningsGrowth: 22, grossMargin: 45,
        operatingMargin: 18, profitMargin: 14, ebitdaMargin: 25,
        roe: 20, roa: 8, debtToEquity: 50, currentRatio: 1.5,
      },
    };
    const seed = makePreSectorizeRow("C_SEED");
    const inputRows = [deepCloneRow(seed), deepCloneRow({ ...seed, symbol: "C_B" }), deepCloneRow({ ...seed, symbol: "C_C" })];
    const out = routeC.sectorize(inputRows);
    expect(out.length).toBe(3);
    const row = out[0];

    const computedByC = Object.entries(EQUIVALENCE_MATRIX.materializedScanner_sectorize)
      .filter(([, e]) => e.kind === "EQUIVALENT" || e.kind === "EQUIVALENT_ADAPT")
      .filter(([k]) => !["epsGrowthProxyScore", "adProxyScore", "weaknessScore", "ipoScore"].includes(k))
      .map(([k]) => k);
    for (const signal of computedByC) {
      it(`Ruta C · sectorize · ${signal} (EQUIVALENT) · row.X === computeSignal(row, X).value`, () => {
        const canonical = computeSignal(row, signal);
        expect(isAcceptable(canonical.value)).toBe(true);
        expectSameNumber(`${signal} C sectorize vs canon`, canonical.value, row[signal]);
        expect(row.signalCoverage[signal]).toBeDefined();
      });
    }

    describe("Ruta C · adProxyScore / epsGrowthProxyScore — regla de override", () => {
      it("adProxyScore pre-calc finito → preservado", () => {
        const preCalc = 73;
        const seed2 = makePreSectorizeRow("OVR_C");
        seed2.adProxyScore = preCalc;
        seed2.epsGrowthProxyScore = 66;
        const out2 = routeC.sectorize([seed2, deepCloneRow(seed2), deepCloneRow(seed2)]);
        expect(out2[0].adProxyScore).toBe(preCalc);
      });

      it("epsGrowthProxyScore pre-calc finito → preservado", () => {
        const preCalc = 66;
        const seed2 = makePreSectorizeRow("OVR_EC");
        seed2.epsGrowthProxyScore = preCalc;
        const out2 = routeC.sectorize([seed2, deepCloneRow(seed2), deepCloneRow(seed2)]);
        expect(out2[0].epsGrowthProxyScore).toBe(preCalc);
      });

      it("adProxyScore fallback === canon", () => {
        const seed2 = makePreSectorizeRow("FBK_C");
        seed2.adProxyScore = null;
        const out2 = routeC.sectorize([seed2, deepCloneRow(seed2), deepCloneRow(seed2)]);
        const canonical = computeSignal(out2[0], "adProxyScore");
        expect(isAcceptable(canonical.value)).toBe(true);
        expectSameNumber("adProxyScore C fallback", canonical.value, out2[0].adProxyScore);
      });
    });

    it("Ruta C · weaknessScore · row.X === computeSignal(row, X).value (post-percentiles)", () => {
      expect(row.weaknessScore).toBe(computeSignal(row, "weaknessScore").value);
      expect(row.weaknessScore).toBe(scoreWeakness(row).weaknessScore);
    });
  });
});

// ---------------------------------------------------------------------------
// 6. DIVERGENCE_DOC #1 (ipoScore): MISMA SEMILLA, B vs C, diferencia = 0.
// ---------------------------------------------------------------------------
// La clave del test: la semilla pre-sectorize debe ser IDÉNTICA para B y C.
// Solo cambia el sectorize invocado. Hasta el 2026-08-15 la diferencia
// observable era exactamente 0.02 * ipoScore_B, porque B pasaba la señal al
// composite y C no. Retirado el término de COMPOSITE_WEIGHTS, la divergencia
// se queda en el CAMPO (C sigue sin calcularlo) y desaparece del score: la
// diferencia esperada es ahora CERO, y este test lo fija para que reintroducir
// el término por la puerta de atrás vuelva a ponerse en rojo.
//
// Verificaciones:
//   1. Los inputs pre-sectorize son idénticos (mismo JSON.stringify).
//   2. Los componentes equivalentes coinciden antes de la diferencia.
//   3. B sigue calculando ipoScore canónico (>0 si el seed es favorable).
//   4. C omite ipoScore (no está en el sidecar).
//   5. delta composite = delta objective = 0, con ipoScore_B > 0.
//   6. Si algún otro componente difiere, no se oculta — se reporta.

describe("audit · DIVERGENCE_DOC #1 (ipoScore) — misma semilla, diferencia = 0", () => {
  it("B y C reciben la misma semilla; el composite y el objective coinciden aunque solo B tenga ipoScore", () => {
    // Seed con ipoScore computable (>0).
    const seed = makePreSectorizeRow("DIVERG_SEED");
    const seedForB = deepCloneRow(seed);
    const seedForC = deepCloneRow(seed);

    // (1) Inputs idénticos.
    expect(JSON.stringify(seedForB)).toBe(JSON.stringify(seedForC));

    // (2-5) Sectorize B y C por separado.
    const outB = routeBSectorize([seedForB]);
    const outC = routeC.sectorize([seedForC]);
    const rowB = outB[0];
    const rowC = outC[0];

    // (3) B calcula ipoScore canónico.
    const ipoB = rowB.ipoScore;
    expect(isAcceptable(ipoB), `rowB.ipoScore no es aceptable: ${ipoB}`).toBe(true);
    expect(ipoB, "Se esperaba ipoScore > 0 con el seed favorable").toBeGreaterThan(0);

    // (4) C omite ipoScore.
    expect(rowC.signalCoverage.ipoScore, "Ruta C no debería tener ipoScore en sidecar").toBeUndefined();
    expect(rowC.ipoScore, "Ruta C no debería tener ipoScore como campo").toBeUndefined();

    // (2) Componentes que B y C deben coincidir (excluyendo ipoScore).
    // Listamos todos los campos que sectorize produce y verificamos igualdad
    // bit-a-bit. Si alguno difiere, lo reportamos explícitamente.
    const sharedFields = [
      "weinsteinScore", "minerviniScore", "momentumScore", "riskScore",
      "riskRewardScore", "volumeEffectScore", "volumeScore", "liquidityScore",
      "objectiveSetupScore", "patternContributionScore", "patternScore",
      "setupQualityScore", "demandScore", "growthScore",
      "epsGrowthProxyScore", "adProxyScore", "weaknessScore",
      "sectorScore", "weaknessLabel",
    ];
    const divergingFields = [];
    for (const field of sharedFields) {
      const bVal = rowB[field];
      const cVal = rowC[field];
      if (JSON.stringify(bVal) !== JSON.stringify(cVal)) {
        divergingFields.push({ field, bVal, cVal });
      }
    }
    if (divergingFields.length > 0) {
      throw new Error(
        `B y C difieren en ${divergingFields.length} campo(s) que deberían coincidir (misma semilla):\n` +
        divergingFields.map((d) => `  - ${d.field}: B=${JSON.stringify(d.bVal)} C=${JSON.stringify(d.cVal)}`).join("\n")
      );
    }

    // (5) Ya no hay diferencia observable: ipoScore salió de COMPOSITE_WEIGHTS,
    // así que da igual que B lo calcule y C no. El seed tiene ipoScore > 0
    // (comprobado en (3)), de modo que un delta de 0 solo puede significar que
    // el término no participa — no que la señal valga cero.
    const deltaComposite = rowB.compositeScore - rowC.compositeScore;
    const deltaObjective = rowB.objectiveScore - rowC.objectiveScore;

    expectSameNumber("composite B - composite C debe ser 0 (ipoScore fuera del composite)", 0, deltaComposite);
    expectSameNumber("objective B - objective C debe ser 0 (ipoScore fuera del composite)", 0, deltaObjective);
  });
});

// ---------------------------------------------------------------------------
// 7. Golden snapshot — referencia independiente.
// ---------------------------------------------------------------------------

describe("audit · equivalencia vs golden snapshot (referencia independiente)", () => {
  const SNAPSHOT_FNS = {
    weinsteinScore: snapWeinstein,
    minerviniScore: snapMinervini,
    momentumScore: snapMomentum,
    riskScore: snapRisk,
    riskRewardScore: snapRiskReward,
    volumeEffectScore: snapVolumeEffect,
    volumeScore: snapVolume,
    liquidityScore: snapLiquidity,
    ipoScore: snapIpo,
    objectiveSetupScore: snapObjectiveSetup,
    patternScore: snapPatternQuality,
    patternContributionScore: snapPatternContribution,
    setupQualityScore: snapSetupQuality,
    demandScore: snapDemand,
    growthScore: snapGrowth,
    epsGrowthProxyScore: snapEps,
    adProxyScore: snapAdProxy,
  };

  function completeRow() {
    return {
      price: 120, sma50: 110, sma150: 100, sma200: 95, sma200Slope: 0.4,
      distance52w: -3, distance20d: -2, distance50d: -3, distanceATH: -5,
      perf6m: 25, perf3m: 12, perf12m: 50,
      extSma50: 5, lowAdvance52w: 40, highsSpreadPct: 8,
      upDownVolRatio: 1.5, relativeVolume: 1.3, volumeSurgePct: 20,
      upVolume: true, latestVolume: 600000, latestTurnover: 12000000,
      avgVolume: 400000, avgTurnover: 9000000, marketCap: 500000000,
      volatility63d: 30, maxDrawdown63d: 15, maxDailyMove20dPct: 6,
      range63dPct: 50, returnToVol3m: 0.9, returnToDrawdown3m: 1.6,
      failedBreakout: false,
      rsGlobalPct: 75, rsRating: 75, rsCountryPct: 80, rsSectorPct: 80,
      rsQualityScore: 70, sectorScore: 65, riskRewardScore: 60,
      riskScore: 70, momentumScore: 50, growthScore: 60,
      adProxyScore: 55, demandScore: 55, setupQualityScore: 60,
      objectiveSetupScore: 60,
      patternContribution: 5, patternQualityScore: 70,
      baseQualityScore: 60, contractionScore: 50,
      growthMetrics: {
        revenueGrowth: 18, earningsGrowth: 22, grossMargin: 45,
        operatingMargin: 18, profitMargin: 14, roe: 20, roa: 8,
        debtToEquity: 50, currentRatio: 1.5,
      },
      ipoAgeMonths: 12, ipoDate: "",
    };
  }

  for (const [signal, snapFn] of Object.entries(SNAPSHOT_FNS)) {
    it(`computeSignal(${signal}) === snapshot(${signal}) en fila completa`, () => {
      const r = completeRow();
      const fromEngine = computeSignal(r, signal).value;
      const snapInput = (signal === "growthScore" || signal === "epsGrowthProxyScore")
        ? r.growthMetrics
        : r;
      const fromSnap = snapFn(snapInput);
      expectSameNumber(`${signal} engine vs snapshot`, fromSnap, fromEngine);
    });
  }

  it("patternContributionScore respeta el override r.patternContribution y coincide con golden", () => {
    const r = completeRow();
    r.patternContribution = 42;
    const fromEngine = computeSignal(r, "patternContributionScore").value;
    const fromSnap = snapPatternContribution(r);
    expect(fromSnap).toBe(42);
    expect(fromEngine).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// 8. Divergencias aceptadas — respaldo literal en el ADR.
// ---------------------------------------------------------------------------

describe("audit · divergencias aceptadas (DIVERG-DOC) — respaldo literal en el ADR", () => {
  const adr = readFile(ADR_PATH);

  for (const div of ACCEPTED_DIVERGENCES) {
    it(`${div.id} · cita literal "${div.adrQuote}" presente en ADR ${div.adrSection}`, () => {
      expect(adr, `ADR no encontrado en ${ADR_PATH}`).toContain(div.adrQuote);
    });
  }

  it("ACCEPTED_DIVERGENCES.length === 8", () => {
    expect(ACCEPTED_DIVERGENCES.length).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// 9. Divergencias pendientes — todas deben aparecer en el Markdown.
// ---------------------------------------------------------------------------

describe("audit · divergencias pendientes (DIVERG-PENDIENTE)", () => {
  const contract = renderContractMarkdown();

  it("PENDING_DIVERGENCES.length === 0", () => {
    expect(PENDING_DIVERGENCES.length).toBe(0);
  });

  for (const div of PENDING_DIVERGENCES) {
    it(`${div.id} · aparece en el render Markdown con estado "${div.status}"`, () => {
      expect(contract, `${div.id} no aparece en render`).toContain(div.id);
      expect(contract, `${div.id} no aparece con status correcto`).toContain(div.status);
      // Aparece en §4 (tabla de pendientes), NO en §3 (aceptadas).
      const section3End = contract.indexOf("## 4.");
      const section3 = contract.substring(0, section3End);
      expect(section3, `${div.id} no debe estar en §3 (aceptadas)`).not.toContain(div.id);
    });
  }

  it("estado global sin pendientes: listo para cierre formal (sin declarar cierre)", () => {
    const status = auditGlobalStatus();
    expect(status.pendingCount).toBe(0);
    expect(status.isReadyForClosure).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 10. Inspección estática de Ruta C — guard complementario.
// ---------------------------------------------------------------------------

describe("audit · Ruta C — guard estático complementario", () => {
  const source = readFile(MATERIALIZED_PATH);

  it("el seam _forTest está declarado con namespace explícito", () => {
    expect(source).toMatch(/export const _forTest/);
    expect(source).toContain("buildResearchRow");
    expect(source).toContain("sectorize");
  });

  it("_forTest está documentado como CAMINO A / solo-para-tests", () => {
    expect(source).toMatch(/SEAM DE TEST/);
    expect(source).toMatch(/Camino A/);
  });

  it("no se modificó la lógica del builder privado", () => {
    expect(source).toMatch(/function buildResearchRow\(symbol, chart = \{\}, profile = \{\}, benchmarks = \{\}, options = \{\}\)/);
    expect(source).toMatch(/function sectorize\(rows = \[\]\)/);
  });
});