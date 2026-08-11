// Tests del contrato de finalizeScanResultsInDb tras la migración a la RPC
// scan_finalize_inputs (thin-raw projection).
//
// Complementa tests/scanPercentileFinalization.test.js (que cubre el pure helper
// y el contrato original). Aquí validamos especificamente el NUEVO contrato de
// lectura y escritura:
//
//   1. El orchestrator carga filas vía scan_finalize_inputs RPC (NO via
//      supabaseRequestAll con select=id,metrics,raw). El payload de la RPC de
//      lectura no expone "metrics,raw" como select REST.
//   2. El patch enviado a finalize_scan_results lleva SOLO los overrides
//      (percentiles + samples + scope + contradicciones), NO el echo
//      `...row.metrics` — porque finalize_scan_results mergea en Postgres
//      (sr.metrics || src.metrics_patch) y el echo es redundante.
//   3. Idempotencia preservada, errores propagados, scanId/ownerId requeridos.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabaseServer", () => ({
  supabaseRpc: vi.fn(),
}));

import {
  FINALIZE_READ_BATCH_SIZE,
  finalizeScanPercentiles,
  finalizeScanResultsInDb,
} from "@/lib/scanPercentileFinalization";
import { supabaseRpc } from "@/lib/supabaseServer";

// Construye una fila "thin" tal como la devolvería scan_finalize_inputs: solo id
// + raw proyectado (sin metrics, sin chartPreview/growthMetrics/decisionTrace).
// Estos son los campos que el pure helper consume.
function makeThinRow(symbol, rawFields, id) {
  return {
    id: id || `${symbol}-uuid`,
    raw: {
      symbol,
      perf3m: 0, perf6m: 0, perf12m: 0,
      rs3m: 0, rs6m: 0, rs12m: 0,
      distance52w: -10, maxDrawdown63d: 15,
      country: "US", theme: "Technology", sector: "Technology",
      ...rawFields,
    },
  };
}

// Universo de 24 filas (≥ RS_GLOBAL_MIN_SAMPLE=20) para que los percentiles sean
// finitos. Replica la estructura de buildUniverse() de scanPercentileFinalization.test.js
// pero en formato thin (raw proyectado, sin metrics).
function buildThinUniverse() {
  const rows = [];
  const batchProfiles = [
    ["A", 1], ["A", 2], ["A", 3], ["B", 1], ["B", 2], ["B", 3],
    ["C", 1], ["C", 2], ["C", 3], ["D", 1], ["D", 2], ["D", 3],
    ["E", 1], ["E", 2], ["E", 3], ["F", 1], ["F", 2], ["F", 3],
    ["G", 1], ["G", 2], ["G", 3], ["H", 1], ["H", 2], ["H", 3],
  ];
  for (const [letter, pos] of batchProfiles) {
    const batchRank = letter.charCodeAt(0) - "A".charCodeAt(0);
    const strength = batchRank * 8 + (3 - pos) * 3;
    const perf3m = Math.max(0, strength * 0.4);
    const perf6m = Math.max(0, strength * 0.7);
    const perf12m = Math.max(0, strength * 1.1);
    const distance52w = -Math.max(2, 25 - strength * 0.4);
    const maxDrawdown63d = Math.max(5, 25 - strength * 0.3);
    rows.push(makeThinRow(`${letter}${letter}${letter}-${pos}`, { perf3m, perf6m, perf12m, distance52w, maxDrawdown63d }));
  }
  return rows;
}

describe("finalizeScanResultsInDb · contrato thin-raw vía scan_finalize_inputs", () => {
  afterEach(() => supabaseRpc.mockReset());

  it("carga vía scan_finalize_inputs RPC (no supabaseRequestAll con select metrics,raw)", async () => {
    const universe = buildThinUniverse();
    // Primera llamada: scan_finalize_inputs devuelve {inputs, rowsRead}.
    supabaseRpc.mockResolvedValueOnce({ inputs: universe, rowsRead: universe.length });
    // Segunda llamada: finalize_scan_results devuelve updated_count.
    supabaseRpc.mockResolvedValueOnce([{ updated_count: universe.length }]);

    const result = await finalizeScanResultsInDb("scan-1", "owner-1");

    // 2 RPCs: 1 de lectura (scan_finalize_inputs) + 1 de escritura (finalize_scan_results).
    expect(supabaseRpc).toHaveBeenCalledTimes(2);
    const [readName, readPayload] = supabaseRpc.mock.calls[0];
    expect(readName).toBe("scan_finalize_inputs");
    expect(readPayload).toEqual({
      p_owner_id: "owner-1",
      p_scan_id: "scan-1",
      // Ya NO se piden las 50000 de golpe: p_max_rows es el tamaño de PÁGINA
      // (FINALIZE_READ_BATCH_SIZE) y p_offset el desplazamiento. 24 filas < 50
      // → una única página, así que sigue habiendo una sola llamada de lectura.
      p_max_rows: FINALIZE_READ_BATCH_SIZE,
      p_offset: 0,
    });
    // El payload de lectura NO contiene la firma del select legacy.
    expect(JSON.stringify(supabaseRpc.mock.calls[0])).not.toContain("select=id,metrics,raw");

    // batchesDone/batchesTotal: 24 filas < FINALIZE_PATCH_BATCH_SIZE (100) →
    // una sola tanda de escritura.
    expect(result).toEqual({
      rowsProcessed: universe.length,
      rowsPatched: universe.length,
      batchesTotal: 1,
      batchesDone: 1,
    });
  });

  it("el patch enviado a finalize_scan_results lleva SOLO overrides (sin echo de metrics)", async () => {
    // Fixture: fila thin con scores planos que dispararían contradicciones si
    // se evaluaran, para confirmar que el patch trae signalContradictions pero
    // NO trae el echo (e.g. NO trae "totalScore" ni "decisionTrace" que vivirían
    // en metrics si se hubieran cargado).
    const thinRows = [
      makeThinRow("KEEP-1", {
        perf3m: 30, perf6m: 20, perf12m: 15,
        country: "US", theme: "Technology", sector: "Technology",
        // scores planos para evaluateContradiciones (C3: setupQuality>=70 ∧ rsGlobal<=40)
        setupQualityScore: 75, weaknessScore: 20,
      }),
    ];
    supabaseRpc.mockResolvedValueOnce({ inputs: thinRows, rowsRead: 1 });
    supabaseRpc.mockResolvedValueOnce([{ updated_count: 1 }]);

    await finalizeScanResultsInDb("scan-2", "owner-2");

    const [writeName, writePayload] = supabaseRpc.mock.calls[1];
    expect(writeName).toBe("finalize_scan_results");
    expect(writePayload.p_owner_id).toBe("owner-2");
    expect(writePayload.p_scan_id).toBe("scan-2");
    expect(writePayload.p_patches).toHaveLength(1);

    const patch = writePayload.p_patches[0].metrics_patch;
    // Overrides esperados (siempre presentes).
    expect(patch.percentileScope).toBe("final");
    expect(patch).toHaveProperty("rsGlobalPct");
    expect(patch).toHaveProperty("rsGlobalSample");
    expect(patch).toHaveProperty("rsCountryPct");
    expect(patch).toHaveProperty("rsCountrySample");
    expect(patch).toHaveProperty("rsSectorPct");
    expect(patch).toHaveProperty("rsSectorSample");
    expect(patch).toHaveProperty("signalContradictions");
    expect(patch).toHaveProperty("contradictionsSkipped");

    // SectorScore final-time + composite recompute (audit 2026-07-10 C2 + C3,
    // ADR fase 1): sectorScore, groupStrengthScore, objectiveScore,
    // compositeScore, totalScore SÍ aparecen en el patch — son los overrides
    // finales que se aplican en el mismo PATCH atómico que los percentiles RS.
    expect(patch).toHaveProperty("sectorScore");
    expect(patch).toHaveProperty("groupStrengthScore");
    expect(patch).toHaveProperty("objectiveScore");
    expect(patch).toHaveProperty("compositeScore");
    expect(patch).toHaveProperty("totalScore");
    // groupStrengthScore y sectorScore siempre coinciden (alias histórico del
    // composite que los consumers leen como fallback: row.sectorScore ?? row.groupStrengthScore).
    expect(patch.groupStrengthScore).toBe(patch.sectorScore);
    // totalScore === compositeScore: misma convención que el scoring path.
    expect(patch.totalScore).toBe(patch.compositeScore);

    // CLAVE del contrato: NO hay echo de metrics. Las claves que viven
    // exclusivamente en metrics (decisionTrace y otros payloads pesados) NO
    // aparecen en el patch — finalize_scan_results las conserva via
    // sr.metrics || patch. sectorScore/objectiveScore/compositeScore/totalScore
    // NO cuentan como "echo": son overrides finales que el pure helper
    // recalcula sobre la población completa del scan.
    expect(patch).not.toHaveProperty("decisionTrace");
    // El patch solo trae los overrides (+ claves de contradicciones que sean
    // necesarias). Verificamos que el número de claves es pequeño (no todo metrics).
    // 9 originales (rsGlobalPct/Sample x3, percentileScope, signalContradictions,
    // contradictionsSkipped) + 5 nuevos (sectorScore, groupStrengthScore,
    // objectiveScore, compositeScore, totalScore) = 14.
    const overrideKeys = Object.keys(patch);
    expect(overrideKeys.length).toBeLessThan(16);
  });

  it("scan vacío (0 inputs) → 0 patches, sin invocar finalize_scan_results", async () => {
    supabaseRpc.mockResolvedValueOnce({ inputs: [], rowsRead: 0 });
    const result = await finalizeScanResultsInDb("scan-3", "owner-3");
    expect(result).toEqual({ rowsProcessed: 0, rowsPatched: 0, batchesTotal: 0, batchesDone: 0 });
    // Solo se llamó a scan_finalize_inputs (lectura), no a finalize_scan_results.
    expect(supabaseRpc).toHaveBeenCalledTimes(1);
    expect(supabaseRpc.mock.calls[0][0]).toBe("scan_finalize_inputs");
  });

  it("lanza si falta scanId u ownerId (contrato)", async () => {
    await expect(finalizeScanResultsInDb("", "owner")).rejects.toThrow(/scanId.*requerido/);
    await expect(finalizeScanResultsInDb("scan", "")).rejects.toThrow(/scanId.*requerido/);
  });

  it("RPC de lectura falla → throw (sin aplicar patches)", async () => {
    supabaseRpc.mockRejectedValueOnce(new Error("scan_finalize_inputs timeout"));
    await expect(finalizeScanResultsInDb("scan-4", "owner-4")).rejects.toThrow("scan_finalize_inputs timeout");
    expect(supabaseRpc).toHaveBeenCalledTimes(1);
    expect(supabaseRpc.mock.calls[0][0]).toBe("scan_finalize_inputs");
  });

  it("RPC de escritura falla → throw; ninguna fila queda tocada (transacción revierte)", async () => {
    const universe = buildThinUniverse();
    supabaseRpc.mockResolvedValueOnce({ inputs: universe, rowsRead: universe.length });
    supabaseRpc.mockRejectedValueOnce(new Error("finalize_scan_results DB timeout"));
    await expect(finalizeScanResultsInDb("scan-5", "owner-5")).rejects.toThrow("finalize_scan_results DB timeout");
    // 2 llamadas: lectura OK, escritura fallida.
    expect(supabaseRpc).toHaveBeenCalledTimes(2);
  });

  it("acepta respuesta RPC de lectura como objeto o array PostgREST", async () => {
    const universe = buildThinUniverse();
    // PostgREST puede devolver array o objeto suelto según el prefer header.
    supabaseRpc.mockResolvedValueOnce([{ inputs: universe, rowsRead: universe.length }]);
    supabaseRpc.mockResolvedValueOnce([{ updated_count: universe.length }]);
    const result = await finalizeScanResultsInDb("scan-6", "owner-6");
    expect(result.rowsProcessed).toBe(universe.length);
    expect(result.rowsPatched).toBe(universe.length);
  });

  it("options.maxRows es el tope GLOBAL: topa el tamaño de la página si es menor que la tanda", async () => {
    supabaseRpc.mockResolvedValueOnce({ inputs: [], rowsRead: 0 });
    await finalizeScanResultsInDb("scan-7", "owner-7", { maxRows: 12 });
    // maxRows(12) < FINALIZE_READ_BATCH_SIZE(50) → la primera página pide 12,
    // nunca más que el tope global.
    expect(supabaseRpc.mock.calls[0][1].p_max_rows).toBe(12);
    expect(supabaseRpc.mock.calls[0][1].p_offset).toBe(0);
  });
});

// ===========================================================================
// Lectura en tandas (migración 20260811150000_scan_finalize_inputs_read_pagination)
// ===========================================================================
//
// El escaneo de 9.920 filas moría ANTES de contar las tandas de escritura
// (finalizationBatchesDone/Total en NULL): el paso que se agotaba era la
// LECTURA, que traía raw+metrics (47,4 KB de texto por fila ≈ 470 MB) en una
// sola llamada contra un statement_timeout de 8 s. Ahora scan_finalize_inputs
// se pagina con p_offset, FINALIZE_READ_BATCH_SIZE filas por llamada.

// Mock de la RPC de lectura que se comporta como la función SQL paginada:
// sirve la ventana [p_offset, p_offset + p_max_rows) del universo dado, en el
// mismo orden. La escritura devuelve updated_count = filas de esa tanda.
function mockPaginatedRead(universe) {
  supabaseRpc.mockImplementation(async (name, payload) => {
    if (name === "scan_finalize_inputs") {
      const offset = payload.p_offset || 0;
      const page = universe.slice(offset, offset + payload.p_max_rows);
      return { inputs: page, rowsRead: page.length };
    }
    if (name === "finalize_scan_results") {
      return [{ updated_count: payload.p_patches.length }];
    }
    throw new Error(`RPC inesperada en el mock: ${name}`);
  });
}

describe("finalizeScanResultsInDb · lectura en tandas", () => {
  afterEach(() => supabaseRpc.mockReset());

  it("trocea la lectura: varias llamadas a scan_finalize_inputs con p_offset creciente", async () => {
    const universe = buildManyThinRows(25);
    mockPaginatedRead(universe);

    const result = await finalizeScanResultsInDb("scan-read", "owner-read", {
      readBatchSize: 10,
      patchBatchSize: 100,
    });

    const readCalls = supabaseRpc.mock.calls.filter(([name]) => name === "scan_finalize_inputs");
    // 25 filas / 10 por tanda → páginas de 10, 10, 5. La de 5 viene incompleta,
    // así que el bucle para ahí: NO hay una cuarta llamada de sondeo.
    expect(readCalls.map(([, payload]) => [payload.p_offset, payload.p_max_rows])).toEqual([
      [0, 10], [10, 10], [20, 10],
    ]);
    expect(readCalls.every(([, payload]) => payload.p_owner_id === "owner-read" && payload.p_scan_id === "scan-read")).toBe(true);
    expect(result.rowsProcessed).toBe(25);
    expect(result.rowsPatched).toBe(25);
  });

  it("pide una página más cuando la última encaja EXACTA (no puede saber que no hay más)", async () => {
    const universe = buildManyThinRows(20);
    mockPaginatedRead(universe);

    await finalizeScanResultsInDb("scan-exact", "owner-exact", { readBatchSize: 10 });

    const readCalls = supabaseRpc.mock.calls.filter(([name]) => name === "scan_finalize_inputs");
    // 20 filas / 10 = 2 páginas llenas + 1 página vacía que confirma el final.
    expect(readCalls.map(([, payload]) => payload.p_offset)).toEqual([0, 10, 20]);
  });

  it("el resultado de la lectura troceada es IDÉNTICO al de una lectura única", async () => {
    const universe = buildManyThinRows(25);
    // Referencia: los patches que produce el helper puro viendo las 25 filas
    // juntas de una vez (= lo que haría una lectura sin trocear).
    const expectedPatches = finalizeScanPercentiles(universe)
      .map(({ id, metrics_patch }) => ({ id, metrics_patch }));

    mockPaginatedRead(universe);
    const troceado = await finalizeScanResultsInDb("scan-cmp", "owner-cmp", { readBatchSize: 7 });
    const sentTroceado = supabaseRpc.mock.calls
      .filter(([name]) => name === "finalize_scan_results")
      .flatMap(([, payload]) => payload.p_patches);

    supabaseRpc.mockReset();
    // Contraste: una sola página de 50 (> 25 filas) = la lectura de antes.
    mockPaginatedRead(universe);
    const unico = await finalizeScanResultsInDb("scan-cmp", "owner-cmp", { readBatchSize: 50 });
    const sentUnico = supabaseRpc.mock.calls
      .filter(([name]) => name === "finalize_scan_results")
      .flatMap(([, payload]) => payload.p_patches);

    // 4 páginas de lectura (7,7,7,4) frente a 1: MISMOS patches, mismo orden.
    expect(sentTroceado).toEqual(sentUnico);
    expect(sentTroceado).toEqual(expectedPatches);
    expect(troceado).toEqual(unico);
    // Los percentiles son agregados de la población: si el troceo hubiera
    // calculado por página, rsGlobalPct no coincidiría con la referencia.
    expect(sentTroceado.some((patch) => Number.isFinite(patch.metrics_patch.rsGlobalPct))).toBe(true);
  });

  it("lee TODO antes de escribir: ninguna escritura se lanza hasta que la lectura acabó", async () => {
    const universe = buildManyThinRows(25);
    const order = [];
    supabaseRpc.mockImplementation(async (name, payload) => {
      order.push(name);
      if (name === "scan_finalize_inputs") {
        const offset = payload.p_offset || 0;
        const page = universe.slice(offset, offset + payload.p_max_rows);
        return { inputs: page, rowsRead: page.length };
      }
      return [{ updated_count: payload.p_patches.length }];
    });

    await finalizeScanResultsInDb("scan-order", "owner-order", { readBatchSize: 10, patchBatchSize: 10 });

    // El percentil necesita la población completa antes de escribir la primera
    // fila: todas las lecturas van primero, sin intercalar.
    const firstWrite = order.indexOf("finalize_scan_results");
    expect(firstWrite).toBeGreaterThan(0);
    expect(order.slice(0, firstWrite).every((name) => name === "scan_finalize_inputs")).toBe(true);
    expect(order.slice(firstWrite).every((name) => name === "finalize_scan_results")).toBe(true);
  });

  it("onReadProgress se invoca tras cada tanda de lectura con el acumulado", async () => {
    const universe = buildManyThinRows(25);
    mockPaginatedRead(universe);
    const readProgress = [];

    await finalizeScanResultsInDb("scan-readprog", "owner-readprog", {
      readBatchSize: 10,
      onReadProgress: (info) => readProgress.push({ ...info }),
    });

    expect(readProgress).toEqual([
      { readBatchesDone: 1, rowsRead: 10, readBatchSize: 10 },
      { readBatchesDone: 2, rowsRead: 20, readBatchSize: 10 },
      { readBatchesDone: 3, rowsRead: 25, readBatchSize: 10 },
    ]);
  });

  it("fallo a mitad de la LECTURA: no escribe nada y el error dice dónde murió", async () => {
    const universe = buildManyThinRows(25);
    supabaseRpc.mockImplementation(async (name, payload) => {
      if (name === "scan_finalize_inputs") {
        if ((payload.p_offset || 0) >= 10) {
          throw new Error("canceling statement due to statement timeout");
        }
        const page = universe.slice(payload.p_offset || 0, (payload.p_offset || 0) + payload.p_max_rows);
        return { inputs: page, rowsRead: page.length };
      }
      throw new Error("finalize_scan_results NO debería llamarse si la lectura falló");
    });

    let caught;
    try {
      await finalizeScanResultsInDb("scan-readfail", "owner-readfail", { readBatchSize: 10 });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeTruthy();
    expect(caught.finalizationPhase).toBe("read");
    expect(caught.readBatchesDone).toBe(1);
    expect(caught.rowsRead).toBe(10);
    expect(caught.cause).toBeInstanceOf(Error);
    expect(caught.cause.message).toContain("statement timeout");
    // Ninguna escritura: la fase de escritura empieza cuando la lectura ya
    // terminó entera, así que la base queda intacta.
    expect(supabaseRpc.mock.calls.some(([name]) => name === "finalize_scan_results")).toBe(false);
  });
});

// ===========================================================================
// Escritura en tandas (docs/finalizacion-percentiles-tandas-2026-08-11.md)
// ===========================================================================
//
// Lo que se troceó aquí es la ESCRITURA: finalize_scan_results se llama varias
// veces, una por tanda de `patchBatchSize` filas, en orden. Estos tests usan
// universos de 25 filas, por debajo de FINALIZE_READ_BATCH_SIZE (50), así que
// la lectura cabe en una sola página y no interfiere. El troceo de la LECTURA
// tiene su propio bloque más abajo.

// N filas sintéticas para probar el TROCEO. No reproducen la distribución de
// buildThinUniverse (eso ya está cubierto arriba) — solo necesitan que
// finalizeScanPercentiles no explote con campos ausentes.
function buildManyThinRows(n) {
  return Array.from({ length: n }, (_, i) => makeThinRow(`SYM${i}`, {
    perf3m: i % 40, perf6m: i % 55, perf12m: i % 80,
    distance52w: -(5 + (i % 20)), maxDrawdown63d: 8 + (i % 15),
  }, `id-${i}`));
}

// Mock de finalize_scan_results que se comporta como la RPC real: updated_count
// = cuántas filas venían en ESE p_patches. Permite que rowsPatched acumulado
// en los tests coincida con lo que devolvería Postgres real, sin necesidad de
// encadenar mockResolvedValueOnce por cada tanda.
function mockWriteEchoesBatchSize() {
  supabaseRpc.mockImplementation(async (name, payload) => {
    if (name === "finalize_scan_results") {
      return [{ updated_count: payload.p_patches.length }];
    }
    throw new Error(`RPC inesperada en el mock: ${name}`);
  });
}

describe("finalizeScanResultsInDb · escritura en tandas", () => {
  afterEach(() => supabaseRpc.mockReset());

  it("trocea la escritura en varias llamadas, y el resultado final es IDÉNTICO al de una escritura única", async () => {
    const universe = buildManyThinRows(25);
    // El cálculo puro no cambia con el troceo: lo que finalizeScanPercentiles
    // produciría en una sola pasada es el "resultado único" de referencia.
    const expectedPatches = finalizeScanPercentiles(universe);

    supabaseRpc.mockResolvedValueOnce({ inputs: universe, rowsRead: universe.length });
    mockWriteEchoesBatchSize();
    // Salvo la primera respuesta (lectura) ya consumida por mockResolvedValueOnce
    // arriba, el resto de llamadas usa mockImplementation (aplica a partir de
    // la 2ª porque mockResolvedValueOnce tiene prioridad en la cola una vez).

    const result = await finalizeScanResultsInDb("scan-batch", "owner-batch", { patchBatchSize: 10 });

    // 25 filas / 10 por tanda = tandas de 10, 10, 5. Más la lectura: 4 llamadas.
    expect(supabaseRpc).toHaveBeenCalledTimes(4);
    const writeCalls = supabaseRpc.mock.calls.filter(([name]) => name === "finalize_scan_results");
    expect(writeCalls.map(([, payload]) => payload.p_patches.length)).toEqual([10, 10, 5]);

    // Concatenar las 3 tandas, EN ORDEN, reproduce exactamente los patches que
    // habría producido una única llamada con las 25 filas de golpe — ni se
    // pierde, ni se duplica, ni se reordena ninguna fila.
    const allSentPatches = writeCalls.flatMap(([, payload]) => payload.p_patches);
    expect(allSentPatches).toEqual(expectedPatches.map(({ id, metrics_patch }) => ({ id, metrics_patch })));

    expect(result).toEqual({ rowsProcessed: 25, rowsPatched: 25, batchesTotal: 3, batchesDone: 3 });
  });

  it("onBatchProgress se invoca tras cada tanda con el acumulado correcto", async () => {
    const universe = buildManyThinRows(25);
    supabaseRpc.mockResolvedValueOnce({ inputs: universe, rowsRead: universe.length });
    mockWriteEchoesBatchSize();
    const progressCalls = [];

    await finalizeScanResultsInDb("scan-progress", "owner-progress", {
      patchBatchSize: 10,
      onBatchProgress: (info) => progressCalls.push({ ...info }),
    });

    expect(progressCalls).toEqual([
      { batchesDone: 1, batchesTotal: 3, rowsPatched: 10, rowsTotal: 25 },
      { batchesDone: 2, batchesTotal: 3, rowsPatched: 20, rowsTotal: 25 },
      { batchesDone: 3, batchesTotal: 3, rowsPatched: 25, rowsTotal: 25 },
    ]);
  });

  it("una tanda fallida a mitad: NO sigue con las siguientes, y el error expone cuánto quedó finalizado", async () => {
    const universe = buildManyThinRows(25);
    supabaseRpc.mockResolvedValueOnce({ inputs: universe, rowsRead: universe.length }); // lectura
    supabaseRpc.mockResolvedValueOnce([{ updated_count: 10 }]); // tanda 1/3 OK
    supabaseRpc.mockRejectedValueOnce(new Error("finalize_scan_results DB timeout")); // tanda 2/3 falla

    let caught;
    try {
      await finalizeScanResultsInDb("scan-partial", "owner-partial", { patchBatchSize: 10 });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeTruthy();
    expect(caught.message).toContain("batch 2/3");
    expect(caught.message).toContain("10/25");
    expect(caught.rowsProcessed).toBe(25);
    expect(caught.rowsPatched).toBe(10); // solo la tanda 1 quedó comprometida
    expect(caught.rowsTotal).toBe(25);
    expect(caught.batchesDone).toBe(1);
    expect(caught.batchesTotal).toBe(3);
    expect(caught.cause).toBeInstanceOf(Error);
    expect(caught.cause.message).toBe("finalize_scan_results DB timeout");

    // Lectura + tanda 1 (OK) + tanda 2 (fallida) = 3. La tanda 3 NUNCA se intenta.
    expect(supabaseRpc).toHaveBeenCalledTimes(3);
  });
});
