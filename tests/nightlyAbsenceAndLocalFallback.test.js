// El respaldo local del arranque y cómo se enuncia la ausencia del nocturno.
//
// El anclaje del servidor no basta por sí solo: cuando la nube no responde, el
// arranque cae en la copia guardada en el navegador, y esa copia contenía
// —precisamente por el fallo que se está corrigiendo— escaneos del cron de
// otros mercados. Restaurar el más reciente de ellos es volver a enseñar una
// acción italiana, esta vez sin que la nube tenga nada que ver.
import { describe, expect, it } from "vitest";
import { dropForeignMarketSnapshots, pickNightlyUsRestorableScan } from "@/lib/snapshotRestore";
import { nightlyAbsenceNotice, nightlyAbsenceReasonText, nightlyAbsenceStatus } from "@/lib/nightlyAbsence";

const snapshot = (id, createdAt, rows = 1) => ({
  id,
  createdAt,
  rows: Array.from({ length: rows }, (_, index) => ({ symbol: `S${index}` })),
  settings: { progress: { status: "partial" } },
});

const NIGHTLY = snapshot("materialized:US:2026-08-16:o0:l5609", "2026-08-16T03:57:58.557Z", 3);
const CRON_IT_ES = snapshot("materialized:IT-ES:2026-08-16:o0:l12", "2026-08-16T23:00:26.053Z");
const CRON_JP = snapshot("materialized:JP:2026-08-16:o0:l24", "2026-08-16T22:42:57.174Z");
const GUARDADO_POR_EL_USUARIO = snapshot("k3f8s1", "2026-08-16T20:00:00.000Z", 2);

describe("copia local · el respaldo también está anclado", () => {
  it("con el cron europeo más reciente en local, restaura igualmente el nocturno", () => {
    expect(pickNightlyUsRestorableScan([CRON_IT_ES, CRON_JP, NIGHTLY])?.id).toBe(NIGHTLY.id);
  });

  it("sin nocturno en local no restaura otro mercado: no hay nada que restaurar", () => {
    expect(pickNightlyUsRestorableScan([CRON_IT_ES, CRON_JP])).toBeNull();
  });

  it("un snapshot guardado a mano por el usuario no se hace pasar por el nocturno", () => {
    expect(pickNightlyUsRestorableScan([GUARDADO_POR_EL_USUARIO])).toBeNull();
  });

  it("las corridas de prueba tampoco cuelan (llevan el prefijo test:)", () => {
    expect(pickNightlyUsRestorableScan([snapshot("test:materialized:US:2026-08-16:o0:l300", "2026-08-16T23:59:00.000Z")])).toBeNull();
  });
});

describe("Reset sesión · limpia el residuo, no el trabajo del usuario", () => {
  it("tira los escaneos cacheados del cron de otros mercados", () => {
    const kept = dropForeignMarketSnapshots([CRON_IT_ES, CRON_JP, NIGHTLY, GUARDADO_POR_EL_USUARIO]);
    expect(kept.map((scan) => scan.id)).toEqual([NIGHTLY.id, GUARDADO_POR_EL_USUARIO.id]);
  });

  it("es idempotente: una segunda pasada no cambia nada", () => {
    const once = dropForeignMarketSnapshots([CRON_IT_ES, NIGHTLY]);
    expect(dropForeignMarketSnapshots(once)).toEqual(once);
  });
});

describe("ausencia declarada, con su motivo", () => {
  it("sin nocturno lo dice, y dice además que no se ha puesto otro mercado en su lugar", () => {
    const notice = nightlyAbsenceNotice({ reason: "no-nightly-scan" });
    expect(notice.tone).toBe("warn");
    expect(notice.detail).toContain("Todavía no hay ningún escaneo nocturno de Estados Unidos");
    expect(notice.detail).toContain("No se carga el escaneo de otro mercado en su lugar.");
    expect(notice.nightlyMissing).toBe(true);
  });

  it("un nocturno que falló se distingue de no tener nocturno, con su fecha", () => {
    const text = nightlyAbsenceReasonText({
      reason: "nightly-not-publishable",
      rejectedScan: { createdAt: "2026-08-16T03:57:58.557Z", status: "failed" },
    });
    expect(text).toContain("2026-08-16");
    expect(text).toContain("no terminó correctamente");
  });

  it("no filtra al usuario ni el nombre del servicio ni el error crudo", () => {
    const detail = nightlyAbsenceNotice({ reason: "cloud-unavailable" }).detail;
    expect(detail).not.toMatch(/supabase|fetch failed|HTTP \d/i);
  });

  it("la línea de estado dice que no hay datos, no un texto de carga eterna", () => {
    expect(nightlyAbsenceStatus({ reason: "no-nightly-scan" })).toMatch(/^Sin datos que mostrar\./);
  });
});
