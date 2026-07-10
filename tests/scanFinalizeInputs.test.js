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

import { finalizeScanResultsInDb } from "@/lib/scanPercentileFinalization";
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
      p_max_rows: 50000, // FINALIZE_MAX_ROWS por defecto
    });
    // El payload de lectura NO contiene la firma del select legacy.
    expect(JSON.stringify(supabaseRpc.mock.calls[0])).not.toContain("select=id,metrics,raw");

    expect(result).toEqual({ rowsProcessed: universe.length, rowsPatched: universe.length });
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

    // CLAVE del nuevo contrato: NO hay echo de metrics. Las claves que vivirían
    // en metrics (totalScore, decisionTrace, objectiveScore, etc.) NO aparecen
    // en el patch. finalize_scan_results las conserva via sr.metrics || patch.
    expect(patch).not.toHaveProperty("totalScore");
    expect(patch).not.toHaveProperty("decisionTrace");
    expect(patch).not.toHaveProperty("objectiveScore");
    // El patch solo trae los overrides (+ claves de contradicciones que sean
    // necesarias). Verificamos que el número de claves es pequeño (no todo metrics).
    const overrideKeys = Object.keys(patch);
    expect(overrideKeys.length).toBeLessThan(12);
  });

  it("scan vacío (0 inputs) → 0 patches, sin invocar finalize_scan_results", async () => {
    supabaseRpc.mockResolvedValueOnce({ inputs: [], rowsRead: 0 });
    const result = await finalizeScanResultsInDb("scan-3", "owner-3");
    expect(result).toEqual({ rowsProcessed: 0, rowsPatched: 0 });
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

  it("p_max_rows se respeta desde options.maxRows", async () => {
    supabaseRpc.mockResolvedValueOnce({ inputs: [], rowsRead: 0 });
    await finalizeScanResultsInDb("scan-7", "owner-7", { maxRows: 1234 });
    expect(supabaseRpc.mock.calls[0][1].p_max_rows).toBe(1234);
  });
});
