// Móvil 2026-11 (M6): la segunda fase del arranque ya no re-descarga el
// escaneo entero. El parche (symbol + weeklyCountryRs* / weeklyThemeRs*) debe
// producir exactamente el mismo merge que las filas extended completas.
import { describe, expect, it } from "vitest";
import { mergeExtendedRsIntoRows, projectScansPayloadToRsPatch } from "@/lib/scansRsBootstrap";

const coreRows = [
  { symbol: "AAA", price: 10, weeklyRsRating: 80, weeklyCountryRsRating: null, weeklyThemeRsRating: null },
  { symbol: "BBB", price: 20, weeklyRsRating: null, weeklyCountryRsRating: null, weeklyThemeRsRating: null },
];
const extendedRows = [
  { symbol: "AAA", price: 10, weeklyRsRating: 80, weeklyCountryRsAvailable: true, weeklyCountryRsRating: 71, weeklyCountryRsAsOf: "2026-09-27", weeklyThemeRsAvailable: true, weeklyThemeRsRating: 64, chartPreview: { closes: [1, 2, 3] }, metrics: { big: "x".repeat(200) } },
  { symbol: "BBB", price: 20, weeklyRsRating: null, weeklyCountryRsAvailable: false, weeklyCountryRsRating: null, weeklyThemeRsAvailable: false, weeklyThemeRsRating: null, weeklyThemeRsReason: "Sin tema" },
];

describe("projectScansPayloadToRsPatch", () => {
  const payload = { ok: true, configured: true, rsHydration: "extended", scans: [{ id: "cron-nightly-us-x", rows: extendedRows, rowsAvailable: 2 }] };

  it("deja solo symbol y campos RS país/tema, conserva metadatos del escaneo", () => {
    const patched = projectScansPayloadToRsPatch(payload);
    expect(patched.projection).toBe("rs-patch");
    expect(patched.scans[0].id).toBe("cron-nightly-us-x");
    expect(patched.scans[0].rowsAvailable).toBe(2);
    for (const row of patched.scans[0].rows) {
      for (const key of Object.keys(row)) {
        expect(key === "symbol" || key.startsWith("weeklyCountryRs") || key.startsWith("weeklyThemeRs")).toBe(true);
      }
    }
  });

  it("no muta el payload de entrada (caché compartida)", () => {
    const before = JSON.stringify(payload);
    projectScansPayloadToRsPatch(payload);
    expect(JSON.stringify(payload)).toBe(before);
  });

  it("el merge con el parche es idéntico al merge con las filas extended completas", () => {
    const patched = projectScansPayloadToRsPatch(payload);
    expect(mergeExtendedRsIntoRows(coreRows, patched.scans[0].rows)).toEqual(mergeExtendedRsIntoRows(coreRows, extendedRows));
  });

  it("tolera payloads sin scans o sin filas", () => {
    expect(projectScansPayloadToRsPatch(null)).toBeNull();
    expect(projectScansPayloadToRsPatch({ ok: false })).toEqual({ ok: false });
    expect(projectScansPayloadToRsPatch({ scans: [{ id: "x" }] }).scans[0]).toEqual({ id: "x" });
  });
});
