import { describe, expect, it } from "vitest";
import {
  buildSessionKeepNotice,
  buildSnapshotFreshnessNotice,
  localScanIsSampled,
  localSampleDetail,
  screenerSessionRefreshReason,
  staleDurationLabel,
} from "@/lib/snapshotFreshness";

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

const sampledScan = {
  id: "scan-sampled",
  rowsSampled: true,
  rowsAvailable: 3309,
  rows: Array.from({ length: 576 }, (_, index) => ({ symbol: `S${index}` })),
};

describe("copia local muestreada (P2)", () => {
  it("detecta la muestra repartida que fitScansForBrowser deja en el navegador", () => {
    expect(localScanIsSampled(sampledScan)).toBe(true);
    expect(localScanIsSampled({ ...sampledScan, rowsSampled: false })).toBe(false);
    expect(localScanIsSampled({ ...sampledScan, rowsAvailable: 576 })).toBe(false);
    expect(localScanIsSampled({ rowsSampled: true, rowsAvailable: 3309 })).toBe(false);
    expect(localScanIsSampled(null)).toBe(false);
  });

  it("el aviso de muestra usa el mismo texto que restoreLocalSnapshot", () => {
    expect(localSampleDetail(sampledScan)).toBe(
      "La copia local guarda 576 de 3309 acciones, repartidas por todo el ranking, porque el escaneo entero no cabe en este navegador.",
    );
    expect(localSampleDetail({ ...sampledScan, rowsSampled: false })).toBe("");
  });

  it("si la nube falla, el aviso de sesión nombra la muestra y no vacía el contrato", () => {
    const notice = buildSessionKeepNotice({
      reason: "La copia guardada en la nube no está disponible.",
      scan: sampledScan,
    });
    expect(notice).not.toBeNull();
    expect(notice.tone).toBe("warn");
    expect(notice.source).toBe("session-sample");
    expect(notice.detail).toContain("576");
    expect(notice.detail).toContain("3309");
    expect(notice.detail).toMatch(/repartidas por todo el ranking/i);
    expect(notice.detail).toMatch(/nube no está disponible/i);
  });

  it("sin muestra, el aviso de sesión sigue siendo el de datos sin renovar (P1)", () => {
    const notice = buildSessionKeepNotice({
      reason: "La copia guardada en la nube no está disponible.",
      scan: { id: "completo", rows: sampledScan.rows, rowsAvailable: sampledScan.rows.length },
    });
    expect(notice.label).toBe("Datos sin renovar");
    expect(notice.source).toBe("session-stale");
    expect(notice.detail).toMatch(/datos guardados en este navegador/i);
    expect(notice.detail).not.toMatch(/repartidas por todo el ranking/i);
  });
});

describe("un solo refresh de sesión (P1+P2)", () => {
  it("caducada, muestreada o las dos: una sola razón de renovación", () => {
    expect(screenerSessionRefreshReason({ expired: false, sampled: false })).toBeNull();
    expect(screenerSessionRefreshReason({ expired: true, sampled: false })).toBe("expired");
    expect(screenerSessionRefreshReason({ expired: false, sampled: true })).toBe("sampled");
    expect(screenerSessionRefreshReason({ expired: true, sampled: true })).toBe("expired-and-sampled");
  });
});
