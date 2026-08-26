// Los DATOS de la sesión del screener caducan al cruzar la frontera nocturna;
// los criterios no caducan nunca.
//
// Regresión: hasta 2026-08-25 la restauración de sesión no comparaba fechas
// y una sesión del 16 de agosto enseñó "scan 16 ago, 05:58" durante una
// semana, con 500 filas top de ranking sobre las que el preset de deterioro
// daba 0 por aritmética. El único remedio era borrar localStorage a mano
// (docs/analisis-screener-uso-real-2026-08-23.md, A1-A3). Es el mismo defecto
// que la caché de discovery del 13-08 y comparte regla: lib/nightlyBoundary.js.
import { describe, expect, it } from "vitest";
import { nightlyBoundaryBefore, nightlyDataFreshness, screenerSessionDataExpired } from "@/lib/nightlyBoundary";
import { localScanIsSampled, screenerSessionRefreshReason } from "@/lib/snapshotFreshness";

const at = (iso) => new Date(iso);
const sessionScannedAt = (iso) => ({ version: 4, scanContext: { scannedAt: iso } });

describe("frontera del nocturno (módulo compartido)", () => {
  it("después de las 04:00 UTC la frontera es la de hoy", () => {
    expect(nightlyBoundaryBefore(at("2026-08-23T10:00:00Z")).toISOString()).toBe("2026-08-23T04:00:00.000Z");
  });

  it("antes de las 04:00 UTC la última frontera cruzada es la de ayer", () => {
    expect(nightlyBoundaryBefore(at("2026-08-23T02:30:00Z")).toISOString()).toBe("2026-08-22T04:00:00.000Z");
  });
});

describe("caducidad de los datos de la sesión", () => {
  it("la sesión del dueño (nocturno del 16, mirada el 23) está caducada", () => {
    // El caso real: scannedAt = 2026-08-16T03:58Z ("16 ago, 05:58" en UTC+2),
    // pantalla abierta el 23. Siete fronteras nocturnas por medio.
    expect(screenerSessionDataExpired(sessionScannedAt("2026-08-16T03:58:00Z"), at("2026-08-23T10:00:00Z"))).toBe(true);
  });

  it("una sesión guardada tras el nocturno de hoy está fresca", () => {
    // El nocturno corre entre las 03:55 y las 04:02 UTC; una sesión que
    // referencia el de hoy no debe re-descargar nada.
    expect(screenerSessionDataExpired(sessionScannedAt("2026-08-23T04:02:00Z"), at("2026-08-23T18:00:00Z"))).toBe(false);
  });

  it("el nocturno de hoy fechado ANTES de las 04:00 también está fresco", () => {
    // Regresión encontrada en la verificación del 25-08: el nocturno real
    // corrió a las 03:58:43, dos minutos antes de la frontera. Sin la ventana
    // del nocturno, la sesión que lo referencia se daba por caducada y cada
    // recarga re-descargaba 27 MB para recibir el mismo escaneo.
    expect(screenerSessionDataExpired(sessionScannedAt("2026-08-25T03:58:43Z"), at("2026-08-25T10:00:00Z"))).toBe(false);
  });

  it("la ventana no rescata el nocturno de AYER", () => {
    // Mismo minuto (03:58) pero de la noche anterior: caducado.
    expect(screenerSessionDataExpired(sessionScannedAt("2026-08-24T03:58:43Z"), at("2026-08-25T10:00:00Z"))).toBe(true);
  });

  it("la sesión de ayer por la tarde caduca al llegar el nocturno de hoy", () => {
    // 14 horas de antigüedad: un TTL de 24 h la daría por buena. No lo es,
    // porque entremedias ha corrido el escaneo nocturno.
    const session = sessionScannedAt("2026-08-22T20:00:00Z");
    expect(screenerSessionDataExpired(session, at("2026-08-22T23:00:00Z"))).toBe(false);
    expect(screenerSessionDataExpired(session, at("2026-08-23T10:00:00Z"))).toBe(true);
  });

  it("de madrugada, antes de la frontera, la sesión de ayer sigue valiendo", () => {
    // A las 03:30 UTC el nocturno de hoy puede no haber terminado: la última
    // frontera cruzada es la de ayer y los datos de ayer siguen siendo los
    // vigentes. No hay nada más nuevo que traer.
    expect(screenerSessionDataExpired(sessionScannedAt("2026-08-22T04:01:00Z"), at("2026-08-23T03:30:00Z"))).toBe(false);
  });

  it("sin fecha de escaneo, la sesión se trata como caducada", () => {
    // En la duda, datos frescos: una sesión que no puede decir de cuándo son
    // sus datos no puede afirmar que estén vigentes.
    expect(screenerSessionDataExpired({ version: 4, scanContext: {} }, at("2026-08-23T10:00:00Z"))).toBe(true);
    expect(screenerSessionDataExpired({ version: 4 }, at("2026-08-23T10:00:00Z"))).toBe(true);
    expect(screenerSessionDataExpired(null, at("2026-08-23T10:00:00Z"))).toBe(true);
    expect(screenerSessionDataExpired(sessionScannedAt("no-es-una-fecha"), at("2026-08-23T10:00:00Z"))).toBe(true);
  });

  it("justo en la frontera cuenta como fresca", () => {
    expect(screenerSessionDataExpired(sessionScannedAt("2026-08-23T04:00:00Z"), at("2026-08-23T12:00:00Z"))).toBe(false);
  });

  it("la frescura genérica reporta estado y edad", () => {
    const result = nightlyDataFreshness("2026-08-16T03:58:00Z", at("2026-08-23T10:00:00Z"));
    expect(result.status).toBe("expired");
    expect(Math.round(result.ageHours / 24)).toBe(7);
    expect(result.boundary).toBe("2026-08-23T04:00:00.000Z");
  });

  it("sesión fresca + copia muestreada pide renovación; las dos a la vez no doblan", () => {
    // P2: la recarga con sesión vigente rehidrataba 576 filas en silencio.
    // P1+P2: caducidad y muestra disparan el MISMO refreshSessionSnapshotData.
    const fresh = sessionScannedAt("2026-08-25T03:58:43Z");
    const sampled = { rowsSampled: true, rowsAvailable: 3309, rows: Array.from({ length: 576 }, () => ({})) };
    expect(screenerSessionDataExpired(fresh, at("2026-08-25T10:00:00Z"))).toBe(false);
    expect(localScanIsSampled(sampled)).toBe(true);
    expect(screenerSessionRefreshReason({
      expired: screenerSessionDataExpired(fresh, at("2026-08-25T10:00:00Z")),
      sampled: localScanIsSampled(sampled),
    })).toBe("sampled");
    expect(screenerSessionRefreshReason({
      expired: screenerSessionDataExpired(sessionScannedAt("2026-08-16T03:58:00Z"), at("2026-08-25T10:00:00Z")),
      sampled: localScanIsSampled(sampled),
    })).toBe("expired-and-sampled");
    expect(screenerSessionRefreshReason({
      expired: screenerSessionDataExpired(fresh, at("2026-08-25T10:00:00Z")),
      sampled: localScanIsSampled({ ...sampled, rowsSampled: false, rowsAvailable: 576 }),
    })).toBeNull();
  });
});
