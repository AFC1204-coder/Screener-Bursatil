// REVIEW-HYDRATE-DEFER-1 — Rapid Review no bloquea en company-brief.
// Astra vinculante: A1-S (métricas = snapshot sesión), A2-CHART (banner = OHLC T1),
// A3-OMIT (no merge RS del brief), A5-ABSENT (Sin dato + motivo vía canonicalRs).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const testDir = dirname(fileURLToPath(import.meta.url));
function sourceWithoutComments(relativePath) {
  return readFileSync(resolve(testDir, relativePath), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("REVIEW-HYDRATE-DEFER-1 — /review sin brief en el camino crítico", () => {
  const source = sourceWithoutComments("../app/review/page.jsx");

  it("no llama a /api/company-brief ni hidrata filas en background", () => {
    expect(source).not.toContain("/api/company-brief");
    expect(source).not.toContain("hydrateReviewRow");
    expect(source).not.toContain("setHydration");
    expect(source).not.toContain("activeHydrating");
    expect(source).not.toContain("alreadyUsable");
  });

  it("no recalcula métricas técnicas desde barras (A1-S)", () => {
    expect(source).not.toContain("deriveTechnicalFromBars");
    expect(source).not.toContain("chartPreviewFromBars");
    expect(source).not.toContain("/api/chart?symbol=");
  });

  it("no mergea RS ni scores del brief (A3-OMIT)", () => {
    expect(source).not.toContain("rsQualityScore");
    expect(source).not.toContain("speculationRiskScore");
    expect(source).not.toMatch(/rsRating:\s/);
    expect(source).not.toContain("relativeStrength: rs.series");
  });

  it("la fila activa sale del snapshot de sesión sin capa de hidratación", () => {
    expect(source).toContain("normalizeRow(activeBaseRow)");
    expect(source).not.toContain("activeHydration");
  });

  it("el banner lateral de brief desapareció; el chart lleva su propio loading T1", () => {
    expect(source).not.toContain("Cargando histórico y métricas");
    expect(source).toContain("RowPriceChart");
    expect(source).not.toMatch(/ReviewChartPanel[^)]*loading/);
  });

  it("las métricas pintadas siguen el RS canónico de sesión (A5)", () => {
    expect(source).toContain("canonicalRs(row)");
    expect(source).toContain("countryRs(row)");
    expect(source).toContain("themeRs(row)");
  });
});
