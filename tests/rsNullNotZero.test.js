// Móvil 2026-11, M3: un RS ausente (null) no puede pintarse como «0».
// Number(null) === 0 y Number.isFinite(0) === true; estas superficies usaban
// ese patrón: badges del gráfico (vista rápida, Review, ficha) vía
// useChartController, el mapeo fila→chart (chartRsRowProps) y la celda RS de
// Review (reviewRsCell).
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isScore, scoreOrNull } from "@/lib/scoreValue";
import { chartRsPropsFromRow } from "@/lib/chartRsRowProps";
import { reviewRsCell, reviewRsCompactCell } from "@/lib/reviewRsDisplay";
import { canonicalRs } from "@/lib/rsCanonical";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("scoreOrNull / isScore", () => {
  it("null, undefined, '' y NaN son ausencia; 0 real sigue siendo 0", () => {
    expect(scoreOrNull(null)).toBeNull();
    expect(scoreOrNull(undefined)).toBeNull();
    expect(scoreOrNull("")).toBeNull();
    expect(scoreOrNull("abc")).toBeNull();
    expect(scoreOrNull(0)).toBe(0);
    expect(scoreOrNull("42")).toBe(42);
    expect(isScore(null)).toBe(false);
    expect(isScore(0)).toBe(true);
  });
});

describe("chartRsPropsFromRow (vista rápida / Review → badges del gráfico)", () => {
  it("RS país/tema null en fila y en /api/rs-weekly → null, no 0", () => {
    const props = chartRsPropsFromRow({ symbol: "TJGC", weeklyCountryRsRating: null, weeklyThemeRsRating: null }, { countryRsRating: null, themeRsRating: null });
    expect(props.rsCountryMainScore).toBeNull();
    expect(props.rsThemeMainScore).toBeNull();
  });

  it("conserva valores reales, incluido 0", () => {
    const props = chartRsPropsFromRow({ weeklyCountryRsRating: 0, weeklyThemeRsRating: 77 });
    expect(props.rsCountryMainScore).toBe(0);
    expect(props.rsThemeMainScore).toBe(77);
  });
});

describe("reviewRsCell (cola y ficha de Review)", () => {
  it("available con value null no pinta «0»", () => {
    const cell = reviewRsCell({ available: true, value: null, hydrated: true, reason: "" });
    expect(cell.text).not.toBe("0");
    expect(cell.missing).toBe(true);
    expect(reviewRsCompactCell({ available: true, value: null, hydrated: true }).text).toBe("Sin RS");
  });

  it("fila sin RS (canonicalRs) → texto de ausencia, no número", () => {
    const cell = reviewRsCell(canonicalRs({ symbol: "TJGC", weeklyRsAvailable: false, weeklyRsRating: null }));
    expect(cell.missing).toBe(true);
    expect(cell.text).not.toMatch(/^\d+$/);
  });

  it("RS real se sigue pintando", () => {
    expect(reviewRsCell({ available: true, value: 64 }).text).toBe("64");
  });
});

describe("useChartController: badges sin Number(null) → 0", () => {
  it("los tres badges RS pasan por scoreOrNull", () => {
    const source = readFileSync(resolve(ROOT, "app/useChartController.js"), "utf8");
    expect(source).toMatch(/rsMainScore:\s*scoreOrNull\(rsMainScore\)/);
    expect(source).toMatch(/countryRsScore:\s*scoreOrNull\(rsCountryMainScore\)/);
    expect(source).toMatch(/themeRsScore:\s*scoreOrNull\(rsThemeMainScore\)/);
    expect(source).not.toMatch(/Number\.isFinite\(Number\(rs(Main|CountryMain|ThemeMain)Score\)\)/);
  });
});
