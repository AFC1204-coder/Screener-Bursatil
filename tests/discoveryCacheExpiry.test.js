// La caché de discovery caduca al cruzar la frontera del escaneo nocturno.
//
// Regresión: hasta 2026-08-13 no caducaba nunca, y Listas y Sectores
// sirvieron 54 días un payload del 20 de junio con seis valores para nueve
// secciones (docs/migracion-listas-2026-08-13.md §2).
import { describe, expect, it } from "vitest";
import { discoverySnapshotFreshness, nightlyBoundaryBefore } from "@/lib/discoveryCache";

const at = (iso) => new Date(iso);

describe("frontera del nocturno", () => {
  it("después de las 04:00 UTC la frontera es la de hoy", () => {
    expect(nightlyBoundaryBefore(at("2026-08-13T10:00:00Z")).toISOString()).toBe("2026-08-13T04:00:00.000Z");
  });

  it("antes de las 04:00 UTC la última frontera cruzada es la de ayer", () => {
    expect(nightlyBoundaryBefore(at("2026-08-13T02:30:00Z")).toISOString()).toBe("2026-08-12T04:00:00.000Z");
  });

  it("justo en la frontera cuenta como cruzada", () => {
    expect(nightlyBoundaryBefore(at("2026-08-13T04:00:00Z")).toISOString()).toBe("2026-08-13T04:00:00.000Z");
  });
});

describe("caducidad del snapshot", () => {
  it("el snapshot congelado del 20 de junio está caducado", () => {
    const result = discoverySnapshotFreshness("2026-06-20T10:15:30.940Z", at("2026-08-13T18:00:00Z"));
    expect(result.fresh).toBe(false);
    expect(result.status).toBe("expired");
    expect(Math.round(result.ageHours / 24)).toBe(54);
  });

  it("un snapshot posterior al nocturno de hoy sirve", () => {
    const result = discoverySnapshotFreshness("2026-08-13T05:30:00Z", at("2026-08-13T18:00:00Z"));
    expect(result.fresh).toBe(true);
    expect(result.status).toBe("fresh");
  });

  it("un snapshot de ayer por la tarde caduca al llegar el nocturno de hoy", () => {
    // 14 horas de antigüedad: un TTL de 24 h lo daría por bueno. No lo es,
    // porque entremedias ha corrido el escaneo nocturno.
    const generated = "2026-08-12T20:00:00Z";
    expect(discoverySnapshotFreshness(generated, at("2026-08-12T23:00:00Z")).fresh).toBe(true);
    expect(discoverySnapshotFreshness(generated, at("2026-08-13T10:00:00Z")).fresh).toBe(false);
  });

  it("un snapshot de las 02:00 no cubre el nocturno que corre a las 03:00", () => {
    // Dos horas de antigüedad y ya caducado: es el caso que ningún TTL en
    // horas resuelve, porque el dato cambia de golpe, no envejece.
    const result = discoverySnapshotFreshness("2026-08-13T02:00:00Z", at("2026-08-13T04:05:00Z"));
    expect(result.fresh).toBe(false);
    expect(result.ageHours).toBeLessThan(3);
  });

  it("sin fecha no se afirma frescura", () => {
    expect(discoverySnapshotFreshness("", at("2026-08-13T10:00:00Z")).fresh).toBe(false);
    expect(discoverySnapshotFreshness(null, at("2026-08-13T10:00:00Z")).status).toBe("undated");
  });
});
