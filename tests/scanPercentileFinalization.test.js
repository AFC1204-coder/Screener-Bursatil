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

  it("conserva el resto de metrics (no solo los percentiles)", () => {
    const row = makeDbRow("KEEP", { perf3m: 10 }, { metrics: { totalScore: 82, decisionTrace: { v: 1 } } });
    const [patch] = finalizeScanPercentiles([row]);
    expect(patch.metrics_patch.totalScore).toBe(82);
    expect(patch.metrics_patch.decisionTrace).toEqual({ v: 1 });
    expect(patch.metrics_patch.percentileScope).toBe("final");
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
