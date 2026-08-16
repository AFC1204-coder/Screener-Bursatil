// Tests de la retención de escaneos nocturnos en scripts/scan-universe.mjs
// (pruneNightlyScans / shouldPruneAfterWrite).
//
// CONTEXTO: la retención NO usa la RPC upsert_scan_newer_wins (esa purga
// top-3-por-owner mezcla cualquier tipo de escaneo bajo el mismo owner_id —
// ver la cabecera de scripts/scan-universe.mjs para el porqué). Es lógica JS
// propia que solo lee/borra la tabla `scans`, filtrando por local_id con el
// prefijo "materialized:US:" — el cascade ON DELETE de scan_results.scan_id
// hace el resto (no se testea aquí; lo cubre el DDL, ver
// tests/upsertScanPurge.test.js para el mismo mecanismo de cascade).
//
// Se mockea supabaseRequest: estos tests no tocan Supabase real.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabaseServer.js", () => ({
  supabaseConfig: () => ({ configured: true, ownerId: "personal", url: "https://example.supabase.co", key: "test-key", missing: [] }),
  supabaseRequest: vi.fn(async () => []),
}));

import { supabaseRequest } from "@/lib/supabaseServer.js";
import { nightOfNightlyScan, parseArgs, pruneNightlyScans, shouldPruneAfterWrite } from "@/scripts/scan-universe.mjs";

const CONFIG = { ownerId: "personal" };

// Limpia historial de llamadas Y la cola de mockResolvedValueOnce entre cada
// test — sin esto, un test que no consume todos sus "once" encolados (o que
// no llama a supabaseRequest en absoluto) deja resultados de otro test
// disponibles para el siguiente, y los conteos de llamadas se acumulan.
beforeEach(() => {
  vi.mocked(supabaseRequest).mockReset();
  vi.mocked(supabaseRequest).mockImplementation(async () => []);
});

// Fábrica de filas `scans` con el mismo shape que devuelve el SELECT de
// pruneNightlyScans (select=id,local_id,row_count,created_at).
function nightlyScan(n, rowCount = 100) {
  return {
    id: `nightly-${n}`,
    local_id: `materialized:US:2026-08-${String(10 - n).padStart(2, "0")}:o0:l5605`,
    row_count: rowCount,
    created_at: new Date(2026, 7, 10 - n).toISOString(),
  };
}

describe("parseArgs — --sin-retencion", () => {
  it("por defecto skipRetention es false", () => {
    expect(parseArgs([]).skipRetention).toBe(false);
  });

  it("--sin-retencion pone skipRetention en true", () => {
    expect(parseArgs(["--sin-retencion"]).skipRetention).toBe(true);
  });

  it("--sin-retencion=false lo deja en false", () => {
    expect(parseArgs(["--sin-retencion=false"]).skipRetention).toBe(false);
  });
});

describe("shouldPruneAfterWrite — punto 9: no borrar si la escritura falló", () => {
  it("true cuando writeMaterializedScan confirmó saved:true", () => {
    expect(shouldPruneAfterWrite({ saved: true, scanId: "x" })).toBe(true);
  });

  it("false cuando saved es false", () => {
    expect(shouldPruneAfterWrite({ saved: false })).toBe(false);
  });

  it("false cuando savedScan es undefined/null (fallo antes de obtener respuesta)", () => {
    expect(shouldPruneAfterWrite(undefined)).toBe(false);
    expect(shouldPruneAfterWrite(null)).toBe(false);
  });

  it("false cuando savedScan.configured es false (Supabase no configurado)", () => {
    // writeMaterializedScan devuelve { configured:false, saved:false, ... } en ese caso.
    expect(shouldPruneAfterWrite({ configured: false, saved: false })).toBe(false);
  });
});

describe("pruneNightlyScans — conserva los N nocturnos más recientes", () => {
  it("con 10 nocturnos y retentionCount=7, conserva 7 y marca 3 como candidatos a borrar", async () => {
    const rows = Array.from({ length: 10 }, (_, i) => nightlyScan(i));
    vi.mocked(supabaseRequest).mockResolvedValueOnce(rows); // SELECT
    vi.mocked(supabaseRequest).mockResolvedValueOnce([]); // DELETE

    const result = await pruneNightlyScans(CONFIG, { retentionCount: 7 });

    expect(result.kept).toHaveLength(7);
    expect(result.candidates).toHaveLength(3);
    expect(result.deletedScanCount).toBe(3);
    // Los 3 borrados son los MÁS VIEJOS (índices 7,8,9 — el SELECT llegó
    // ordenado created_at desc, así que kept = los primeros 7 del array).
    expect(result.candidates.map((c) => c.id)).toEqual(["nightly-7", "nightly-8", "nightly-9"]);
  });

  it("suma row_count de los borrados sin consultar scan_results", async () => {
    const rows = [nightlyScan(0, 5605), nightlyScan(1, 97), nightlyScan(2, 200), nightlyScan(3, 150)];
    vi.mocked(supabaseRequest).mockResolvedValueOnce(rows);
    vi.mocked(supabaseRequest).mockResolvedValueOnce([]);

    const result = await pruneNightlyScans(CONFIG, { retentionCount: 2 });

    expect(result.deletedScanCount).toBe(2);
    expect(result.deletedRowCount).toBe(200 + 150);
    // Solo 2 llamadas a supabaseRequest: el SELECT de `scans` y el DELETE.
    // Nunca se llama a scan_results — el cascade de la FK hace ese trabajo.
    expect(vi.mocked(supabaseRequest)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(supabaseRequest).mock.calls.every(([table]) => table === "scans")).toBe(true);
  });

  it("con 7 o menos nocturnos, no borra nada (no llama DELETE)", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => nightlyScan(i));
    vi.mocked(supabaseRequest).mockResolvedValueOnce(rows);

    const result = await pruneNightlyScans(CONFIG, { retentionCount: 7 });

    expect(result.kept).toHaveLength(5);
    expect(result.candidates).toHaveLength(0);
    expect(result.deletedScanCount).toBe(0);
    expect(result.deletedRowCount).toBe(0);
    // Sin candidatos a borrar, no debe haber una segunda llamada (DELETE).
    expect(vi.mocked(supabaseRequest)).toHaveBeenCalledTimes(1);
  });

  it("dry-run:true nunca llama DELETE, aunque haya de sobra", async () => {
    const rows = Array.from({ length: 10 }, (_, i) => nightlyScan(i));
    vi.mocked(supabaseRequest).mockResolvedValueOnce(rows);

    const result = await pruneNightlyScans(CONFIG, { retentionCount: 7, dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.candidates).toHaveLength(3);
    // deletedScanCount/deletedRowCount se quedan en 0 en dry-run: candidates
    // es "lo que se borraría", no "lo que se borró".
    expect(result.deletedScanCount).toBe(0);
    expect(result.deletedRowCount).toBe(0);
    // Solo el SELECT — ninguna llamada de escritura/borrado.
    expect(vi.mocked(supabaseRequest)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(supabaseRequest).mock.calls[0][1].method).not.toBe("DELETE");
  });

  it("skip:true no toca Supabase en absoluto", async () => {
    const result = await pruneNightlyScans(CONFIG, { skip: true });

    expect(result.skipped).toBe(true);
    expect(vi.mocked(supabaseRequest)).not.toHaveBeenCalled();
  });
});

describe("nightOfNightlyScan — la noche de un escaneo es la fecha de su local_id", () => {
  it("extrae la fecha del formato sin y con marca de hora", () => {
    expect(nightOfNightlyScan({ local_id: "materialized:US:2026-08-15:o0:l5609" })).toBe("2026-08-15");
    expect(nightOfNightlyScan({ local_id: "materialized:US:2026-08-16:t035758:o0:l5609" })).toBe("2026-08-16");
  });

  it("con un local_id raro cae a la fecha de created_at, nunca agrupa todo junto", () => {
    expect(nightOfNightlyScan({ local_id: "materialized:US-extra", created_at: "2026-08-14T04:59:30.126Z" })).toBe("2026-08-14");
    expect(nightOfNightlyScan({})).toBe("sin-fecha");
  });
});

describe("pruneNightlyScans — la unidad de retención es la NOCHE, no la fila de scans", () => {
  it("dos corridas de la misma noche cuentan como una: se conserva la más reciente y la superada es candidata", async () => {
    // El caso real medido el 2026-08-16: tres corridas del 12-08 ocupaban
    // tres de los siete huecos y "7 escaneos" eran solo 5 noches.
    const rows = [
      { id: "n16-b", local_id: "materialized:US:2026-08-16:t051200:o0:l5609", row_count: 3313, created_at: "2026-08-16T05:12:00Z" },
      { id: "n16-a", local_id: "materialized:US:2026-08-16:t035758:o0:l5609", row_count: 3313, created_at: "2026-08-16T03:57:58Z" },
      { id: "n15", local_id: "materialized:US:2026-08-15:o0:l5609", row_count: 3314, created_at: "2026-08-15T03:50:28Z" },
    ];
    vi.mocked(supabaseRequest).mockResolvedValueOnce(rows);
    vi.mocked(supabaseRequest).mockResolvedValueOnce([]);

    const result = await pruneNightlyScans(CONFIG, { retentionCount: 7 });

    expect(result.kept).toEqual(["n16-b", "n15"]);
    expect(result.keptNights).toEqual(["2026-08-16", "2026-08-15"]);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      id: "n16-a",
      night: "2026-08-16",
      reason: "corrida superada de una noche conservada",
    });
  });

  it("con 8 noches distintas y retención 7, la octava (la más vieja) es candidata aunque haya menos de 7+1 filas por noche", async () => {
    const rows = Array.from({ length: 8 }, (_, i) => nightlyScan(i));
    vi.mocked(supabaseRequest).mockResolvedValueOnce(rows);
    vi.mocked(supabaseRequest).mockResolvedValueOnce([]);

    const result = await pruneNightlyScans(CONFIG, { retentionCount: 7 });

    expect(result.keptNights).toHaveLength(7);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].reason).toBe("noche fuera de la retención");
  });

  it("una noche con reintentos no desplaza noches buenas: 7 noches + 3 reintentos de la última siguen conservando las 7 noches", async () => {
    const retries = Array.from({ length: 3 }, (_, i) => ({
      id: `retry-${i}`,
      local_id: `materialized:US:2026-08-10:t0${i}0000:o0:l5605`,
      row_count: 100,
      created_at: `2026-08-10T0${i}:00:00Z`,
    })).reverse();
    const nights = Array.from({ length: 7 }, (_, i) => nightlyScan(i));
    // nightlyScan(0) también es del 2026-08-10: esa noche acumula 4 corridas
    // (3 reintentos + la original) y aun así solo debe contar como UNA noche.
    const rows = [...nights, ...retries].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    vi.mocked(supabaseRequest).mockResolvedValueOnce(rows);
    vi.mocked(supabaseRequest).mockResolvedValueOnce([]);

    const result = await pruneNightlyScans(CONFIG, { retentionCount: 7 });

    expect(result.keptNights).toHaveLength(7);
    // Ningún candidato es "noche fuera de la retención" de las 7 conservadas:
    // los reintentos superados se borran, las noches distintas se quedan.
    for (const candidate of result.candidates) {
      if (candidate.reason === "corrida superada de una noche conservada") {
        expect(result.keptNights).toContain(candidate.night);
      }
    }
  });
});

describe("pruneNightlyScans — no toca escaneos que no sean nocturnos", () => {
  it("el SELECT filtra por local_id con el prefijo materialized:US: (PostgREST like)", async () => {
    vi.mocked(supabaseRequest).mockResolvedValueOnce([]);

    await pruneNightlyScans(CONFIG, { retentionCount: 7 });

    const [table, options] = vi.mocked(supabaseRequest).mock.calls[0];
    expect(table).toBe("scans");
    // encodeURIComponent("materialized:US:*") — confirma que se pide EXACTAMENTE
    // ese patrón a Supabase, nunca "materialized:" a secas (que sí atraparía
    // los escaneos del cron europeo/asiático) ni el local_id de un escaneo
    // interactivo (que no tiene el prefijo "materialized:" en absoluto).
    expect(options.query).toContain(`local_id=like.${encodeURIComponent("materialized:US:*")}`);
    expect(options.query).toContain("deleted_at=is.null");
  });

  it("el DELETE solo referencia los ids devueltos por ese SELECT filtrado — nunca un id ajeno", async () => {
    // Fixture: el SELECT (ya filtrado server-side) solo devuelve escaneos
    // nocturnos. Confirmamos que el DELETE usa exactamente esos ids — no hay
    // ninguna vía en pruneNightlyScans para que un id de un escaneo
    // interactivo/cron entre en el WHERE del DELETE.
    const rows = Array.from({ length: 9 }, (_, i) => nightlyScan(i));
    vi.mocked(supabaseRequest).mockResolvedValueOnce(rows);
    vi.mocked(supabaseRequest).mockResolvedValueOnce([]);

    await pruneNightlyScans(CONFIG, { retentionCount: 7 });

    const [table, options] = vi.mocked(supabaseRequest).mock.calls[1];
    expect(table).toBe("scans");
    expect(options.method).toBe("DELETE");
    expect(options.query).toBe(`id=in.(${encodeURIComponent("nightly-7")},${encodeURIComponent("nightly-8")})`);
  });
});
