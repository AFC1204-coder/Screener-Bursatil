// Tests del agrupado por peso y del reintento adaptativo de
// scripts/purge-scans.mjs — ver el memo de la tarea: agrupar por número de
// escaneos (siete por tanda) ignoraba las filas hijas que arrastra cada uno,
// lo que provocó "canceling statement due to statement timeout" contra
// producción. Estos tests cubren la lógica pura (groupByWeight,
// isTimeoutError) y el flujo de reintento de deleteInBatches contra un
// supabaseRequest mockeado — sin tocar Supabase real.

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabaseServer.js", () => ({
  supabaseConfig: vi.fn(() => ({ configured: true, ownerId: "personal" })),
  supabaseRequest: vi.fn(),
  supabaseRequestAll: vi.fn(),
}));

import { supabaseRequest } from "@/lib/supabaseServer.js";
import { groupByWeight, isTimeoutError, deleteInBatches } from "../scripts/purge-scans.mjs";

function item(id, rowCount) {
  return { id, localId: id, rowCount };
}

// ===========================================================================
// groupByWeight — agrupado puro, sin red
// ===========================================================================

describe("groupByWeight", () => {
  it("un elemento cuyo propio peso supera el tope va solo en su tanda", () => {
    const candidates = [item("a", 100), item("heavy", 9900), item("b", 100)];
    const batches = groupByWeight(candidates, { weightCap: 3000, batchSize: 7 });
    // a+b se agrupan entre sí (200 < 3000), heavy va aparte y cierra tanda
    // en cuanto entra — nunca se mezcla con otros ni se descarta.
    const heavyBatch = batches.find((b) => b.some((r) => r.id === "heavy"));
    expect(heavyBatch).toHaveLength(1);
    expect(heavyBatch[0].id).toBe("heavy");
    const all = batches.flat().map((r) => r.id).sort();
    expect(all).toEqual(["a", "b", "heavy"]);
  });

  it("varios elementos ligeros se acumulan en la misma tanda hasta el tope", () => {
    // 20 escaneos de 20 filas cada uno = 400 filas, muy por debajo de 3000.
    const candidates = Array.from({ length: 20 }, (_, i) => item(`s${i}`, 20));
    const batches = groupByWeight(candidates, { weightCap: 3000, batchSize: 25 });
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(20);
  });

  it("respeta weightCap: una tanda nunca acumula más peso del tope salvo un único elemento pesado", () => {
    // 10 elementos de 1000 filas: el tope de 3000 permite como mucho 3 por tanda.
    const candidates = Array.from({ length: 10 }, (_, i) => item(`s${i}`, 1000));
    const batches = groupByWeight(candidates, { weightCap: 3000, batchSize: 10 });
    for (const batch of batches) {
      const weight = batch.reduce((s, r) => s + r.rowCount, 0);
      expect(weight).toBeLessThanOrEqual(3000);
    }
    expect(batches.every((b) => b.length <= 3)).toBe(true);
    expect(batches.flat()).toHaveLength(10);
  });

  it("respeta batchSize como tope máximo de elementos por tanda aunque el peso lo permitiera", () => {
    // 10 elementos de 1 fila cada uno: el peso jamás se acerca al tope, pero
    // batchSize=4 debe seguir limitando el nº de elementos por tanda.
    const candidates = Array.from({ length: 10 }, (_, i) => item(`s${i}`, 1));
    const batches = groupByWeight(candidates, { weightCap: 3000, batchSize: 4 });
    expect(batches.every((b) => b.length <= 4)).toBe(true);
    expect(batches.flat()).toHaveLength(10);
  });

  it("conserva el orden de entrada dentro y entre tandas", () => {
    const candidates = [item("a", 10), item("b", 10), item("c", 10), item("d", 10)];
    const batches = groupByWeight(candidates, { weightCap: 3000, batchSize: 2 });
    expect(batches.flat().map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("array vacío produce cero tandas", () => {
    expect(groupByWeight([], { weightCap: 3000, batchSize: 7 })).toEqual([]);
  });
});

// ===========================================================================
// isTimeoutError
// ===========================================================================

describe("isTimeoutError", () => {
  it("reconoce el código Postgres 57014 (statement_timeout)", () => {
    expect(isTimeoutError({ details: { code: "57014" }, message: "algo" })).toBe(true);
  });

  it("reconoce el mensaje textual de PostgREST reenviando el error de Postgres", () => {
    expect(isTimeoutError({ message: "canceling statement due to statement timeout" })).toBe(true);
  });

  it("no confunde otros errores (p.ej. constraint violation) con un timeout", () => {
    expect(isTimeoutError({ details: { code: "23505" }, message: "duplicate key value violates unique constraint" })).toBe(false);
  });
});

// ===========================================================================
// deleteInBatches — retry/backoff contra supabaseRequest mockeado
// ===========================================================================

describe("deleteInBatches · reintento adaptativo", () => {
  beforeEach(() => {
    supabaseRequest.mockReset();
  });

  it("una tanda que falla por timeout se reintenta dividida por la mitad, y ambas mitades acaban borradas", async () => {
    // Tanda inicial de 4 elementos ligeros (van juntos por peso). El primer
    // DELETE contra esos 4 IDs falla por timeout; el flujo debe dividir en
    // 2+2 y reintentar cada mitad — ambas acaban con éxito.
    const candidates = [item("a", 10), item("b", 10), item("c", 10), item("d", 10)];
    const timeoutError = Object.assign(new Error("canceling statement due to statement timeout"), {
      details: { code: "57014" },
    });

    supabaseRequest.mockImplementation(async (table, opts) => {
      if (opts.method === "DELETE") {
        const ids = opts.query.match(/id=in\.\(([^)]*)\)/)[1].split(",");
        if (ids.length === 4) throw timeoutError; // la tanda completa falla una vez
        return null; // las mitades (2+2) borran bien
      }
      // Verificación: nunca queda nada presente.
      return [];
    });

    const report = await deleteInBatches(candidates, {
      table: "scans",
      weightCap: 3000,
      batchSize: 7,
      pauseMs: 1,
      label: "scans",
      maxRetries: 3,
      maxPauseMs: 50,
    });

    expect(report.stoppedEarly).toBe(false);
    expect(report.deletedCount).toBe(4);
    expect(report.deletedRowCount).toBe(40);
    // La tanda de 4 se dividió: deben verse al menos 2 tandas registradas
    // (las dos mitades), ninguna de tamaño 4.
    expect(report.batches.length).toBeGreaterThanOrEqual(2);
    expect(report.batches.every((b) => b.ids.length <= 2)).toBe(true);
  });

  it("un elemento único que sigue fallando tras agotar los reintentos para todo y reporta cuál es y sus filas", async () => {
    const candidates = [item("solo-culpable", 9900)];
    const timeoutError = Object.assign(new Error("canceling statement due to statement timeout"), {
      details: { code: "57014" },
    });
    supabaseRequest.mockImplementation(async (table, opts) => {
      if (opts.method === "DELETE") throw timeoutError;
      return [];
    });

    const report = await deleteInBatches(candidates, {
      table: "scans",
      weightCap: 3000,
      batchSize: 7,
      pauseMs: 1,
      label: "scans",
      maxRetries: 2,
      maxPauseMs: 20,
    });

    expect(report.stoppedEarly).toBe(true);
    expect(report.deletedCount).toBe(0);
    expect(report.failedItem).not.toBeNull();
    expect(report.failedItem.id).toBe("solo-culpable");
    expect(report.error).toMatch(/solo-culpable/);
    expect(report.error).toMatch(/9900/);
  });

  it("un fallo no reintentable (p.ej. verificación tras DELETE) para de inmediato sin reintentar", async () => {
    const candidates = [item("a", 10), item("b", 10)];
    supabaseRequest.mockImplementation(async (table, opts) => {
      if (opts.method === "DELETE") return null;
      // La verificación posterior encuentra filas que deberían haberse borrado.
      return [{ id: "a" }];
    });

    const report = await deleteInBatches(candidates, {
      table: "scans",
      weightCap: 3000,
      batchSize: 7,
      pauseMs: 1,
      label: "scans",
      maxRetries: 3,
      maxPauseMs: 20,
    });

    expect(report.stoppedEarly).toBe(true);
    expect(report.deletedCount).toBe(0);
    expect(report.error).toMatch(/seguían presentes/);
  });

  it("agrupa por peso antes de borrar: un elemento pesado y varios ligeros no comparten tanda", async () => {
    const candidates = [item("light1", 20), item("light2", 20), item("heavy", 9000)];
    const seenBatchSizes = [];
    supabaseRequest.mockImplementation(async (table, opts) => {
      if (opts.method === "DELETE") {
        const ids = opts.query.match(/id=in\.\(([^)]*)\)/)[1].split(",");
        seenBatchSizes.push(ids);
        return null;
      }
      return [];
    });

    const report = await deleteInBatches(candidates, {
      table: "scans",
      weightCap: 3000,
      batchSize: 7,
      pauseMs: 1,
      label: "scans",
    });

    expect(report.stoppedEarly).toBe(false);
    expect(report.deletedCount).toBe(3);
    const heavyBatch = seenBatchSizes.find((ids) => ids.includes("heavy"));
    expect(heavyBatch).toEqual(["heavy"]);
  });
});
