import { describe, expect, it } from "vitest";
import { buildSnapshotFreshnessNotice, staleDurationLabel } from "@/lib/snapshotFreshness";

describe("snapshot freshness", () => {
  it("no muestra aviso para snapshots frescos y completos", () => {
    expect(buildSnapshotFreshnessNotice({ stale: false }, { decisionProjectionPartialRows: 0 })).toBeNull();
  });

  // Este aviso se pinta TAL CUAL en el banner del screener (ScreenerShell →
  // snapshotNotice.detail), así que su texto es copia de producto: ni el
  // nombre del servicio de base de datos ni el error original del proveedor.
  it("explica en lenguaje de producto que se sirve una copia guardada", () => {
    const notice = buildSnapshotFreshnessNotice({
      stale: true,
      staleForMs: 125000,
      staleReason: "Timeout consultando Supabase.",
    });

    expect(notice.label).toBe("Snapshot cacheado");
    expect(notice.tone).toBe("warn");
    expect(notice.detail).toContain("última disponible");
    expect(notice.detail).toContain("2 min");
    expect(notice.detail).toMatch(/tardó demasiado en responder/i);
    expect(notice.detail).not.toMatch(/supabase/i);
  });

  it("descarta el motivo crudo del servidor cuando no lo reconoce", () => {
    const notice = buildSnapshotFreshnessNotice({
      stale: true,
      staleForMs: 60000,
      staleReason: 'PostgREST: relation "public.scans" does not exist',
    });

    expect(notice.detail).not.toContain("PostgREST");
    expect(notice.detail).not.toContain("public.scans");
  });

  it("advierte cuando la proyeccion de decision queda parcial", () => {
    const notice = buildSnapshotFreshnessNotice({}, { decisionProjectionPartialRows: 3 });

    expect(notice.label).toBe("Snapshot parcial");
    expect(notice.tone).toBe("info");
    expect(notice.detail).toContain("3 filas");
  });

  it("formatea duraciones stale compactas", () => {
    expect(staleDurationLabel(30000)).toBe("menos de 1 min");
    expect(staleDurationLabel(20 * 60000)).toBe("20 min");
    expect(staleDurationLabel(2 * 60 * 60000)).toBe("2 h");
  });

  // Recorte silencioso (docs/timeout-arranque-2026-08-13.md, punto 6): si
  // rowsLimit cortó el escaneo antes de traerlo entero, el usuario debe
  // verlo — hoy creía que veía el escaneo completo y no era cierto.
  it("avisa cuando el escaneo llegó recortado (rowsTruncated)", () => {
    const notice = buildSnapshotFreshnessNotice({ stale: false }, {
      rowsAvailable: 9918,
      rowsReturned: 500,
      rowsTruncated: true,
    });

    expect(notice).not.toBeNull();
    expect(notice.label).toBe("Snapshot incompleto");
    expect(notice.tone).toBe("warn");
    expect(notice.truncated).toBe(true);
    expect(notice.detail).toContain("500");
    expect(notice.detail).toContain("9918");
  });

  // El criterio del recorte importa tanto como el número (2026-08-17): si la
  // muestra fueran "las primeras", que ordenan por puntuación, cualquier
  // filtro de valores débiles devolvería vacío sin que el usuario supiera por
  // qué. Cuando el servidor reparte las páginas por todo el ranking, el aviso
  // lo dice.
  it("dice que la muestra va repartida cuando el servidor la repartió", () => {
    const notice = buildSnapshotFreshnessNotice({ stale: false }, {
      rowsAvailable: 20000,
      rowsReturned: 6000,
      rowsTruncated: true,
      rowsSampled: true,
    });

    expect(notice.sampled).toBe(true);
    expect(notice.detail).toContain("muestra repartida por todo el ranking");
    expect(notice.detail).not.toContain("el resto no se cargó");
  });

  it("mantiene el texto anterior cuando el recorte NO va repartido", () => {
    const notice = buildSnapshotFreshnessNotice({ stale: false }, {
      rowsAvailable: 9918,
      rowsReturned: 500,
      rowsTruncated: true,
    });

    expect(notice.sampled).toBe(false);
    expect(notice.detail).toContain("el resto no se cargó por el límite de tamaño de la restauración");
  });

  it("no avisa de recorte si rowsTruncated es false, aunque vengan los conteos", () => {
    const notice = buildSnapshotFreshnessNotice({ stale: false }, {
      rowsAvailable: 42,
      rowsReturned: 42,
      rowsTruncated: false,
    });

    expect(notice).toBeNull();
  });

  it("combina stale y truncado en un solo aviso si pasan las dos cosas a la vez", () => {
    const notice = buildSnapshotFreshnessNotice({
      stale: true,
      staleForMs: 30000,
    }, {
      rowsAvailable: 9918,
      rowsReturned: 500,
      rowsTruncated: true,
    });

    expect(notice.label).toBe("Snapshot cacheado");
    expect(notice.detail).toContain("última disponible");
    expect(notice.detail).toContain("500");
    expect(notice.detail).toContain("9918");
  });
});
