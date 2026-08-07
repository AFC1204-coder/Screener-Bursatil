// Tests de lib/scanPercentileFinalization.js.
//
// Cubre el paso de finalización de percentiles RS: recalcula rsGlobalPct/
// rsCountryPct/rsSectorPct como percentil sobre el universo completo del scan
// (no batch-local) y marca percentileScope: "final".
//
// Patron: fixtures inline (igual que tests/scanDecisionProjection.test.js y
// tests/relativeStrength.test.js). El pure helper se testea sin mocks; el
// orchestrator se testea con vi.mock("@/lib/supabaseServer") (primer uso de
// vi.mock en el repo — documentado inline).
import { afterEach, describe, expect, it, vi } from "vitest";
import { enrichRelativePercentiles } from "@/lib/relativeStrength";
import { finalizeScanPercentiles, finalizeScanResultsInDb } from "@/lib/scanPercentileFinalization";
import { scoreCompositeValue } from "@/lib/scoring";

// --- Helpers de fixtures --------------------------------------------------

// Construye una fila DB cruda con los campos que rsRawComposite consume.
// rsRawComposite lee: perf3m, perf6m, perf12m, rs3m, rs6m, rs12m, distance52w,
// maxDrawdown63d. enrichRelativePercentiles además agrupa por country y theme/sector.
function makeDbRow(symbol, rawFields, { id, metrics = {} } = {}) {
  return {
    id: id || `${symbol}-uuid`,
    symbol,
    metrics: { percentileScope: "batch", ...metrics },
    raw: {
      symbol,
      perf3m: 0, perf6m: 0, perf12m: 0,
      rs3m: 0, rs6m: 0, rs12m: 0,
      distance52w: -10, maxDrawdown63d: 15,
      country: "US",
      theme: "Technology",
      sector: "Technology",
      ...rawFields,
    },
  };
}

// 24 filas distribuidas en 8 "batches" lógicos de 3. El símbolo AAA-1 es el
// más fuerte de SU batch (de 3) pero MEDIO-BAJO en el universo (de 24).
// Diseñado para que el percentil batch-local (sobre 3) sea alto y el del
// universo (sobre 24, ≥ RS_GLOBAL_MIN_SAMPLE=20) sea claramente menor.
//
// rsRawComposite pondera perf3m/6m/12m y rs3m/6m/12m (positivos → composite más alto),
// más bonificación por distance52w cerca de máximos y penalización por drawdown.
function buildUniverse() {
  const rows = [];
  // Ocho "batches" lógicos (A-H), cada uno con 3 filas decrecientes en fuerza.
  // El batch A es el más débil colectivamente; el H el más fuerte. AAA-1 es el
  // más fuerte del batch A, pero al sumar los batches B-H queda en percentil
  // medio-bajo del universo.
  const batchProfiles = [
    ["A", 1], ["A", 2], ["A", 3],
    ["B", 1], ["B", 2], ["B", 3],
    ["C", 1], ["C", 2], ["C", 3],
    ["D", 1], ["D", 2], ["D", 3],
    ["E", 1], ["E", 2], ["E", 3],
    ["F", 1], ["F", 2], ["F", 3],
    ["G", 1], ["G", 2], ["G", 3],
    ["H", 1], ["H", 2], ["H", 3],
  ];
  // Asignamos "fuerza" decreciente: la 1ª fila de cada batch es la más fuerte
  // del batch; el batch H es el más fuerte del universo. AAA-1 (batch A, pos 1)
  // queda por debajo de todas las pos-1 de B-H y por debajo de muchas pos-2.
  for (const [letter, pos] of batchProfiles) {
    const batchRank = letter.charCodeAt(0) - "A".charCodeAt(0); // A=0, H=7
    const strength = batchRank * 8 + (3 - pos) * 3; // H-1 = 56+6=62, A-1 = 0+6=6
    const perf3m = Math.max(0, strength * 0.4);
    const perf6m = Math.max(0, strength * 0.7);
    const perf12m = Math.max(0, strength * 1.1);
    const distance52w = -Math.max(2, 25 - strength * 0.4);
    const maxDrawdown63d = Math.max(5, 25 - strength * 0.3);
    rows.push(makeDbRow(`${letter}${letter}${letter}-${pos}`, {
      perf3m, perf6m, perf12m, distance52w, maxDrawdown63d,
    }));
  }
  return rows;
}

// --- Tests del pure helper ------------------------------------------------

describe("finalizeScanPercentiles (pure)", () => {
  it("recalcula rsGlobalPct sobre el universo completo, no batch-local", () => {
    const universe = buildUniverse();
    const aaa1Symbol = "AAA-1";

    // Batch-local: si solo procesáramos el batch A (3 filas, sample < 20),
    // AAA-1 sería el top del batch PERO el percentil sería null por sample
    // insuficiente. En el universo completo (24 filas, ≥ RS_GLOBAL_MIN_SAMPLE)
    // el percentil es finito. Para comparar dirección usamos un batch amplio
    // (A+B+C+D = 12 filas, aún < 20, percentil null) vs universo (24, finito).
    // En su lugar, verificamos el contrato: el universo produce finito, y
    // AAA-1 cae en percentil medio-bajo (no top) porque hay 21 filas más fuertes.

    const patches = finalizeScanPercentiles(universe);
    const aaa1Patch = patches.find((p) => p.id === `${aaa1Symbol}-uuid`);
    expect(Number.isFinite(aaa1Patch.metrics_patch.rsGlobalPct)).toBe(true);
    expect(aaa1Patch.metrics_patch.rsGlobalSample).toBe(24);

    // AAA-1 es el más débil de todos los "pos-1" y todos los batches B-H son
    // más fuertes → su percentil global debe estar en la mitad baja (< 50).
    expect(aaa1Patch.metrics_patch.rsGlobalPct).toBeLessThan(50);

    // Y el símbolo más fuerte del universo (HHH-1) debe estar en el top.
    const hhh1Patch = patches.find((p) => p.id === "HHH-1-uuid");
    expect(hhh1Patch.metrics_patch.rsGlobalPct).toBeGreaterThan(80);

    // Contraste con batch-local: el batch A solo (3 filas) da percentil null
    // por sample insuficiente — confirma que el universo es el que produce finito.
    const batchAOnly = universe.slice(0, 3).map((r) => ({ id: r.id, ...r.raw, metrics: r.metrics }));
    const batchEnriched = enrichRelativePercentiles(batchAOnly);
    const batchAaa1 = batchEnriched.find((r) => r.symbol === aaa1Symbol);
    expect(batchAaa1.rsGlobalPct).toBeNull();
    expect(batchAaa1.rsGlobalSample).toBe(3);
  });

  it("toda fila de salida lleva percentileScope: 'final' (incluso si percentile=null por sample)", () => {
    // Caso con sample insuficiente: 1 sola fila (< RS_GLOBAL_MIN_SAMPLE) →
    // rsGlobalPct=null, pero percentileScope debe ser "final" igual (la
    // finalización se ejecutó; el null es por sample).
    const single = [makeDbRow("SOLO", { perf3m: 10 })];
    const [patch] = finalizeScanPercentiles(single);
    expect(patch.metrics_patch.percentileScope).toBe("final");
    expect(patch.metrics_patch.rsGlobalPct).toBeNull();
    expect(patch.metrics_patch.rsGlobalSample).toBeLessThan(5);
  });

  it("conserva el resto de metrics (no solo los percentiles) — pero totalScore/compositeScore/objectiveScore/sectorScore son overrides", () => {
    // decisionTrace sigue siendo echo puro (no entra al recompute). totalScore,
    // compositeScore, objectiveScore y sectorScore son overrides nuevos del
    // contrato (audit C2 + sub-caso C3: el composite se recalcula con el
    // sectorScore final para evitar rankings stale). Por tanto totalScore
    // ya NO se conserva del metrics echo — se sustituye por el compositeScore
    // recomputado sobre el sectorScore final.
    const row = makeDbRow("KEEP", { perf3m: 10 }, { metrics: { totalScore: 82, decisionTrace: { v: 1 } } });
    const [patch] = finalizeScanPercentiles([row]);
    // Echo puro (lo único que el contrato conserva del metrics de origen).
    expect(patch.metrics_patch.decisionTrace).toEqual({ v: 1 });
    // Overrides nuevos — sustituyen cualquier valor previo del metrics de origen.
    expect(patch.metrics_patch.percentileScope).toBe("final");
    expect(patch.metrics_patch).toHaveProperty("sectorScore");
    expect(patch.metrics_patch).toHaveProperty("objectiveScore");
    expect(patch.metrics_patch).toHaveProperty("compositeScore");
    expect(patch.metrics_patch).toHaveProperty("totalScore");
    // totalScore === compositeScore (mismo verbatim que lib/screenerPipeline.js:350).
    expect(patch.metrics_patch.totalScore).toBe(patch.metrics_patch.compositeScore);
    // objectiveScore === compositeScore AQUÍ porque la fila no trae
    // objectiveSetupScore (fixture no lo setea): el degrade cae a
    // setupQualityScore para ambas llamadas. Cuando sí viene objectiveSetupScore
    // (con bonus de patrón incluido en setupQualityScore), objectiveScore y
    // compositeScore divergen — ver test "objectiveScore y totalScore
    // divergen cuando hay bonus de patrón" más abajo.
    expect(patch.metrics_patch.objectiveScore).toBe(patch.metrics_patch.compositeScore);
    // sectorScore y groupStrengthScore siempre coinciden (alias histórico).
    expect(patch.metrics_patch.groupStrengthScore).toBe(patch.metrics_patch.sectorScore);
  });

  it("rsCountryPct y rsSectorPct se recalculan con su sample respectivo", () => {
    // 2 países distintos, 2 themes distintos → cada scoped percentile usa su grupo.
    const rows = [
      makeDbRow("US-TECH", { perf3m: 30, country: "US", theme: "Technology" }),
      makeDbRow("US-ENRG", { perf3m: 5, country: "US", theme: "Energy" }),
      makeDbRow("EU-TECH", { perf3m: 20, country: "DE", theme: "Technology" }),
    ];
    const patches = finalizeScanPercentiles(rows);
    const usTech = patches.find((p) => p.id === "US-TECH-uuid");
    // sample por país US = 2 filas.
    expect(usTech.metrics_patch.rsCountrySample).toBe(2);
    // sample por theme Technology = 2 filas.
    expect(usTech.metrics_patch.rsSectorSample).toBe(2);
  });

  it("idempotente: dos pasadas producen el mismo resultado", () => {
    const universe = buildUniverse();
    const once = finalizeScanPercentiles(universe);
    // Simula una segunda pasada: las filas ya tienen scope="final" y los nuevos
    // percentiles (que es lo que tendrían si se re-cargan de DB tras un PATCH).
    const secondPassInput = universe.map((r, i) => ({
      ...r,
      metrics: once[i].metrics_patch,
    }));
    const twice = finalizeScanPercentiles(secondPassInput);
    // Los percentiles deben ser estables (segunda pasada no los mueve).
    for (let i = 0; i < once.length; i++) {
      expect(twice[i].metrics_patch.rsGlobalPct).toBe(once[i].metrics_patch.rsGlobalPct);
      expect(twice[i].metrics_patch.rsCountryPct).toBe(once[i].metrics_patch.rsCountryPct);
      expect(twice[i].metrics_patch.rsSectorPct).toBe(once[i].metrics_patch.rsSectorPct);
      expect(twice[i].metrics_patch.percentileScope).toBe("final");
    }
  });

  it("input vacío o inválido → array vacío (sin throw)", () => {
    expect(finalizeScanPercentiles([])).toEqual([]);
    expect(finalizeScanPercentiles(undefined)).toEqual([]);
    expect(finalizeScanPercentiles(null)).toEqual([]);
  });

  it("filas con country/theme ausentes caen a fallback (no crash)", () => {
    const rows = [
      makeDbRow("X1", { perf3m: 10, country: null, theme: null, sector: null }),
      makeDbRow("X2", { perf3m: 20, country: null, theme: null, sector: null }),
    ];
    const patches = finalizeScanPercentiles(rows);
    expect(patches).toHaveLength(2);
    expect(patches[0].metrics_patch.percentileScope).toBe("final");
    // countryCode(symbol) y "Sin grupo" son los fallbacks en enrichRelativePercentiles;
    // con 2 filas en el mismo grupo fallback, los scoped percentiles son finitos.
    expect(patches[0].metrics_patch.rsCountrySample).toBeGreaterThanOrEqual(2);
  });

  // ─── sectorScore final-time (audit C2 + ADR fase 1) ───────────────────
  // El helper recalcula sectorScore sobre la POBLACIÓN COMPLETA del scan (no
  // por lote local) y lo escribe en metrics_patch junto con objectiveScore y
  // compositeScore recomputados. Estos tests cubren la regresión del hallazgo
  // C2 del audit 2026-07-10 (bonus temático eliminado) y la idempotencia del
  // nuevo contrato.

  it("sectorScore final-time: toda la población en 1 grupo → mismo sectorScore en todas las filas", () => {
    // buildUniverse() = 24 filas, todas theme:"Technology" → 1 grupo de 24.
    // Antes del fix: sectorScore variaba por lote + recibía +10 del bonus
    // temático (tema "Technology" NO estaba en el regex, así que el bonus era
    // +10, no +20 — pero el sectorScore AÚN variaba por composición de lote).
    // Después del fix: sectorScore es UN valor para todo el scan (calculado
    // una vez sobre la población completa) y NO incluye el bonus.
    const universe = buildUniverse();
    const patches = finalizeScanPercentiles(universe);
    const sectorScores = patches.map((p) => p.metrics_patch.sectorScore);
    // Todas finitas.
    sectorScores.forEach((s) => expect(Number.isFinite(s)).toBe(true));
    // Todas iguales (un solo grupo).
    const first = sectorScores[0];
    sectorScores.forEach((s) => expect(s).toBe(first));
    // Rango efectivo 0-80 (sin renormalizar). El grupo de 24 con theme
    // "Technology" y avg3/avg6 finitos: como máximo teórico es 25 (groupSize)
    // + 20 (avg3) + 20 (avg6/2) + 15 (leaders) = 80, todos clamp 0-X.
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThanOrEqual(80);
  });

  it("sectorScore final-time: NO bonus temático — 'Semis / fotonica' y 'Software' producen el MISMO sectorScore para grupos equivalentes", () => {
    // Regresión EXPLICITA del hallazgo C2 del audit 2026-07-10: el contrato
    // viejo daba +20 al tema "Semis / fotonica" (regex matcheaba) vs +10 al
    // resto (incluido "Software"). En el mismo universo, dos grupos con la
    // MISMA composición (mismo tamaño, mismos perf3m/6m/leaders) deben
    // recibir EXACTAMENTE el mismo sectorScore.
    const semRow = (i, suffix) => makeDbRow(`SEMIS-${i}`, {
      perf3m: 15, perf6m: 25, weinsteinScore: 85, minerviniScore: 75,
      country: "US", theme: "Semis / fotonica", sector: "Technology",
    }, { id: `SEMIS-${i}-uuid${suffix || ""}` });
    const softRow = (i) => makeDbRow(`SOFT-${i}`, {
      perf3m: 15, perf6m: 25, weinsteinScore: 85, minerviniScore: 75,
      country: "US", theme: "Software", sector: "Technology",
    }, { id: `SOFT-${i}-uuid` });
    // 5 filas en cada grupo, mismos inputs numéricos. ANTES: SEMIS recibía
    // +20 extra → sectorScore de Semis > sectorScore de Software. AHORA:
    // deben ser idénticos.
    const rows = [
      semRow(1), semRow(2), semRow(3), semRow(4), semRow(5),
      softRow(1), softRow(2), softRow(3), softRow(4), softRow(5),
    ];
    const patches = finalizeScanPercentiles(rows);
    const semSector = patches.find((p) => p.id.startsWith("SEMIS-1-uuid")).metrics_patch.sectorScore;
    const softSector = patches.find((p) => p.id.startsWith("SOFT-1-uuid")).metrics_patch.sectorScore;
    expect(softSector).toBe(semSector);
  });

  it("sectorScore final-time: objetivoScore y compositeScore se recalculan con sectorScore final (no con el del batch)", () => {
    // Caso: dos filas del mismo tema (mismo sectorScore en la nueva señal),
    // pero con distinos setupQualityScore → objectiveScore/compositeScore
    // finales dependen solo de los scores individuales (no del sectorScore,
    // que es idéntico para ambas). Verificamos que ambas filas tienen
    // objectiveScore/compositeScore finitos, sectorScore coherente, y que
    // NO hay NaN ni undefined (los inputs faltantes caen a 0 vía el wrapper).
    const rows = [
      makeDbRow("RICH", {
        perf3m: 25, perf6m: 30, weinsteinScore: 80, minerviniScore: 80,
        setupQualityScore: 75, rsQualityScore: 80, adProxyScore: 70,
        riskRewardScore: 70, momentumScore: 60, demandScore: 65,
        growthScore: 70, epsGrowthProxyScore: 68, riskScore: 70,
        ipoScore: 30, rsRating: 80,
        country: "US", theme: "Software", sector: "Technology",
      }, { id: "RICH-uuid" }),
      makeDbRow("LEAN", {
        perf3m: 25, perf6m: 30, weinsteinScore: 80, minerviniScore: 80,
        setupQualityScore: 30, rsQualityScore: 30, adProxyScore: 30,
        riskRewardScore: 30, momentumScore: 30, demandScore: 30,
        growthScore: 30, epsGrowthProxyScore: 30, riskScore: 30,
        ipoScore: 30, rsRating: 80,
        country: "US", theme: "Software", sector: "Technology",
      }, { id: "LEAN-uuid" }),
    ];
    const patches = finalizeScanPercentiles(rows);
    const rich = patches.find((p) => p.id === "RICH-uuid").metrics_patch;
    const lean = patches.find((p) => p.id === "LEAN-uuid").metrics_patch;
    // Mismo sectorScore (mismo grupo).
    expect(rich.sectorScore).toBe(lean.sectorScore);
    // objectiveScore/compositeScore finitos para ambas (no NaN por inputs
    // faltantes — el wrapper JS hace fallback a 0 explícito).
    expect(Number.isFinite(rich.objectiveScore)).toBe(true);
    expect(Number.isFinite(rich.compositeScore)).toBe(true);
    expect(Number.isFinite(lean.objectiveScore)).toBe(true);
    expect(Number.isFinite(lean.compositeScore)).toBe(true);
    // RICH tiene mejores scores individuales → mayor composite que LEAN.
    expect(rich.compositeScore).toBeGreaterThan(lean.compositeScore);
    // totalScore === compositeScore (verbatim del path vivo).
    expect(rich.totalScore).toBe(rich.compositeScore);
    expect(lean.totalScore).toBe(lean.compositeScore);
    // objectiveScore === compositeScore AQUÍ porque ninguna fixture trae
    // objectiveSetupScore (la RPC scan_finalize_inputs todavía no lo proyecta
    // — ver comentario en lib/scanPercentileFinalization.js): el degrade cae
    // a setupQualityScore para ambas llamadas. No es un invariante general del
    // helper — con objectiveSetupScore presente, divergen (ver test dedicado).
    expect(rich.objectiveScore).toBe(rich.compositeScore);
    expect(lean.objectiveScore).toBe(lean.compositeScore);
  });

  it("objectiveScore y totalScore divergen cuando hay bonus de patrón (objectiveSetupScore != setupQualityScore)", () => {
    // Regresión del colapso: antes del fix, ambas llamadas a scoreCompositeValue
    // recibían la MISMA variable setupQualityScore, así que objectiveScore y
    // compositeScore (y por tanto totalScore) eran siempre idénticos tras
    // finalizar. En el path vivo (lib/screenerPipeline.js:335-336),
    // setupQualityScore = objectiveSetupScore + bonus de patrón (VCP/contracciones)
    // — objectiveScore NO debe llevar ese bonus, compositeScore SÍ. Con
    // objectiveSetupScore < setupQualityScore (bonus de patrón presente),
    // objectiveScore (que usa objectiveSetupScore) debe ser MENOR que
    // compositeScore/totalScore (que usa setupQualityScore).
    const row = makeDbRow("PATTERNED", {
      setupQualityScore: 70, // incluye +15 de bonus de patrón (VCP)
      objectiveSetupScore: 55, // sin el bonus de patrón
      rsQualityScore: 60, adProxyScore: 50, riskRewardScore: 50,
      momentumScore: 50, demandScore: 50, growthScore: 50,
      epsGrowthProxyScore: 50, riskScore: 50, ipoScore: 30, rsRating: 60,
    });
    const [patch] = finalizeScanPercentiles([row]);
    const { objectiveScore, compositeScore, totalScore } = patch.metrics_patch;
    expect(Number.isFinite(objectiveScore)).toBe(true);
    expect(Number.isFinite(compositeScore)).toBe(true);
    // totalScore sigue siendo alias de compositeScore (no cambia por este fix).
    expect(totalScore).toBe(compositeScore);
    // El fix: objectiveScore YA NO colapsa con compositeScore/totalScore.
    expect(objectiveScore).not.toBe(compositeScore);
    expect(objectiveScore).toBeLessThan(compositeScore);
  });

  // ─── Ausencia real ya no fabrica constante (docs/constantes-finalizacion-2026-08-07.md) ───
  // Verifica que, para una fila sin ningún fundamental, el compositeScore que
  // produce finalizeScanPercentiles coincide EXACTAMENTE con llamar al motor
  // (scoreCompositeValue, la misma función que scanPercentileFinalization.js
  // ya usa por dentro) directamente, pasando growthScore/epsAnchor como
  // ausentes (`null`) en vez de que finalización los fabrique. Si ambas vías
  // no coincidieran, significaría que finalización sigue sustituyendo por una
  // constante en vez de excluir y renormalizar como hace el motor.
  it("fila sin fundamentales: el composite de finalización coincide con el del motor excluyendo los mismos términos", () => {
    const row = makeDbRow("NOFUND", {
      setupQualityScore: 70,
      rsQualityScore: 60,
      demandScore: 55,
      adProxyScore: 45,
      riskRewardScore: 50,
      riskScore: 60,
      momentumScore: 40,
      ipoScore: 20,
      rsRating: 65,
      // growthScore y epsGrowthProxyScore deliberadamente ausentes: "fila sin
      // ningún fundamental" (docs/constantes-finalizacion-2026-08-07.md, A.2).
    });
    const [patch] = finalizeScanPercentiles([row]);
    const { sectorScore, compositeScore } = patch.metrics_patch;

    // rsAnchor cae a rsRating porque la muestra es 1 (< RS_GLOBAL_MIN_SAMPLE):
    // rsGlobalPct sale null y la cadena SIN TOCAR (excepción documentada)
    // degrada al dato real rsRating=65 — no es un término "sin fundamento",
    // así que se replica tal cual en la llamada directa al motor de abajo.
    expect(Number.isFinite(compositeScore)).toBe(true);

    // Motor, en directo, con los MISMOS inputs efectivos que usó la
    // finalización: sectorScore ya calculado final-time por finalización
    // (mismo grupo, mismo valor), growthScore/epsAnchor como `null` (ausentes
    // de verdad, no fabricados con 0).
    const motorComposite = scoreCompositeValue({
      setupQualityScore: 70,
      rsAnchor: 65,
      rsQualityScore: 60,
      demandScore: 55,
      adProxyScore: 45,
      growthScore: null,
      epsAnchor: null,
      sectorScore,
      riskRewardScore: 50,
      riskScore: 60,
      momentumScore: 40,
      ipoScore: 20,
    });

    expect(compositeScore).toBe(motorComposite);
  });

  it("sectorScore final-time: idempotente — segunda pasada produce el mismo sectorScore y composite", () => {
    // Verifica que el recompute es determinista: pasar el output del primer
    // recompute como input del segundo no cambia el resultado.
    const universe = buildUniverse();
    const once = finalizeScanPercentiles(universe);
    const secondPassInput = universe.map((r, i) => ({
      ...r,
      // Simulamos que la fila ya pasó por finalize: llevamos los overrides
      // como parte de `raw` para que el recompute lea los mismos valores.
      raw: { ...r.raw, sectorScore: once[i].metrics_patch.sectorScore, objectiveScore: once[i].metrics_patch.objectiveScore, compositeScore: once[i].metrics_patch.compositeScore },
    }));
    const twice = finalizeScanPercentiles(secondPassInput);
    for (let i = 0; i < once.length; i += 1) {
      expect(twice[i].metrics_patch.sectorScore).toBe(once[i].metrics_patch.sectorScore);
      expect(twice[i].metrics_patch.objectiveScore).toBe(once[i].metrics_patch.objectiveScore);
      expect(twice[i].metrics_patch.compositeScore).toBe(once[i].metrics_patch.compositeScore);
    }
  });
});

// --- Tests del orchestrator (con mock de Supabase) ------------------------
//
// PRIMER USO de vi.mock en el repo. Mockeamos supabaseRpc (y supabaseRequestAll
// por compatibilidad histórica del mock) para simular DB sin tocar red.
//
// El contrato del orchestrator cambió al migrar la lectura a la RPC
// scan_finalize_inputs (thin-raw projection): ahora hay 2 RPCs — 1 de lectura
// (scan_finalize_inputs devuelve {inputs, rowsRead}) + 1 de escritura atómica
// (finalize_scan_results). La cobertura exhaustiva del NUEVO contrato vive en
// tests/scanFinalizeInputs.test.js. Aquí mantenemos un smoke del happy path para
// no perder la cobertura histórica de la integración pure-helper ↔ orchestrator.
//
// La atomicidad real la da la función PL/pgSQL finalize_scan_results (que hace
// un único UPDATE masivo en una transacción); aquí solo verificamos que el
// orchestrator la invoca correctamente y propaga errores.

vi.mock("@/lib/supabaseServer", () => ({
  supabaseRequestAll: vi.fn(),
  supabaseRpc: vi.fn(),
}));

import { supabaseRequestAll, supabaseRpc } from "@/lib/supabaseServer";

// Helper: universo thin tal como lo devuelve scan_finalize_inputs (sin metrics,
// sin chartPreview — solo id + raw proyectado). Mismo shape que makeThinRow de
// tests/scanFinalizeInputs.test.js pero reutilizando buildUniverse().
function thinUniverse() {
  return buildUniverse().map((r) => ({ id: r.id, raw: r.raw }));
}

describe("finalizeScanResultsInDb (orchestrator · smoke de integración post-thin-raw)", () => {
  afterEach(() => {
    supabaseRequestAll.mockReset();
    supabaseRpc.mockReset();
  });

  it("carga vía scan_finalize_inputs + aplica TODO en finalize_scan_results atómica", async () => {
    const universe = thinUniverse();
    // 1ª llamada: scan_finalize_inputs → {inputs, rowsRead}.
    supabaseRpc.mockResolvedValueOnce({ inputs: universe, rowsRead: universe.length });
    // 2ª llamada: finalize_scan_results → { updated_count }.
    supabaseRpc.mockResolvedValueOnce([{ updated_count: universe.length }]);

    const result = await finalizeScanResultsInDb("scan-1", "owner-1");

    // 2 RPCs (1 lectura thin + 1 escritura). supabaseRequestAll NO se usa.
    expect(supabaseRequestAll).not.toHaveBeenCalled();
    expect(supabaseRpc).toHaveBeenCalledTimes(2);
    expect(result.rowsProcessed).toBe(universe.length);
    expect(result.rowsPatched).toBe(universe.length);

    // La escritura es la 2ª llamada: finalize_scan_results con payload correcto.
    const [writeName, writePayload, writeOptions] = supabaseRpc.mock.calls[1];
    expect(writeName).toBe("finalize_scan_results");
    expect(writePayload.p_owner_id).toBe("owner-1");
    expect(writePayload.p_scan_id).toBe("scan-1");
    expect(Array.isArray(writePayload.p_patches)).toBe(true);
    expect(writePayload.p_patches).toHaveLength(universe.length);
    expect(writeOptions.prefer).toBe("return=representation");

    // Cada patch lleva id + metrics_patch con scope "final" y percentil finito.
    for (const patch of writePayload.p_patches) {
      expect(typeof patch.id).toBe("string");
      expect(patch.metrics_patch.percentileScope).toBe("final");
      // Con 24 filas (≥ RS_GLOBAL_MIN_SAMPLE=20), el percentil global es finito.
      expect(Number.isFinite(patch.metrics_patch.rsGlobalPct)).toBe(true);
    }
  });

  it("lanza si falta scanId u ownerId (contrato)", async () => {
    await expect(finalizeScanResultsInDb("", "owner")).rejects.toThrow(/scanId.*requerido/);
    await expect(finalizeScanResultsInDb("scan", "")).rejects.toThrow(/scanId.*requerido/);
  });
});

// El contrato completo del nuevo orchestrator thin-raw (RPC de lectura, patch
// sin echo de metrics, manejo de array/objeto, idempotencia, propagación de
// errores) está cubierto en tests/scanFinalizeInputs.test.js. Este archivo
// mantiene los tests del PURE helper (arriba) que son la base atómica.

// --- Nota sobre cobertura del caller (runScanChunk) ------------------------
//
// La integración de finalizeScanResultsInDb con runScanChunk (escritura de
// finalizationStatus: "succeeded"/"failed" en progress) se valida por inspección
// del código en lib/serverScanRunner.js:238-285. Un test end-to-end requeriría
// mockear fetchYahooChart/fetchYahooProfile/supabaseRequest (snapshot de scan,
// DELETE de filas, PATCH de progress) — un setup extenso que pertenece a una
// suite de integración aparte.
//
// El contrato de detección de retry queda documentado en el código:
//   - status="done" + finalizationStatus="succeeded" → finalización OK.
//   - status="error" + finalizationStatus="failed" → finalización falló (re-finalizable).
//   - status="error" sin finalizationStatus (o "pending") → error antes de finalizar.
