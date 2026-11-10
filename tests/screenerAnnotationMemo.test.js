import { describe, expect, it } from "vitest";
import { annotateScreenerRow, annotateScreenerRowMemo, annotateScreenerRowsMemo } from "@/lib/screenerAnnotation";
import { applyResultViewFilters } from "@/lib/screenerResultView";
import { compareRowsForSort } from "@/lib/screenerPipeline";

// FILTER-ANNOTATE-MEMO-1 — golden: el memo por identidad no cambia ni una fila, ni el orden, ni los textos.

function rng(seed) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

function makeRows(n) {
  const r = rng(42);
  const pick = (a) => a[Math.floor(r() * a.length)];
  return Array.from({ length: n }, (_, i) => {
    const row = {
      symbol: `S${i}`,
      companyName: `Co ${i}`,
      price: 5 + r() * 400,
      chartBarsCount: pick([0, 40, 120, 260, 400]),
      priceFreshnessOk: r() > 0.1,
      dataCoverageScore: Math.round(r() * 100),
      technicalCoverageScore: Math.round(r() * 100),
      fundamentalCoverageScore: Math.round(r() * 100),
      profileCoverageScore: Math.round(r() * 100),
      totalScore: Math.round(r() * 100),
      objectiveScore: Math.round(r() * 100),
      rsGlobalPct: Math.round(r() * 100),
      rsSectorPct: Math.round(r() * 100),
      rsQualityScore: Math.round(r() * 100),
      weinsteinScore: Math.round(r() * 100),
      minerviniScore: Math.round(r() * 100),
      volumeEffectScore: Math.round(r() * 100),
      adProxyScore: Math.round(r() * 100),
      growthScore: Math.round(r() * 100),
      riskRewardScore: Math.round(r() * 100),
      weaknessScore: Math.round(r() * 60),
      extSma50: Math.round(r() * 40) - 5,
      setupDisplayPlanValid: r() > 0.3,
      sector: pick(["Tech", "Health", "Energy", "Fin", ""]),
    };
    // huecos reales: campos ausentes / null
    if (r() < 0.15) delete row.rsGlobalPct;
    if (r() < 0.1) row.riskRewardScore = null;
    if (r() < 0.1) delete row.growthScore;
    return row;
  });
}

const viewState = (activeSettings, extra = {}) => ({
  viewLayers: {}, countryFilter: "Todos", themeFilter: "Todos", sectorFilter: "Todos",
  industryFilter: "Todos", sectorStrength: "Todos", ipo: "Todos",
  decisionResolutionFilter: "all", decisionResolutions: {}, activeSettings, ...extra,
});

const SORTS = ["totalScore", "decisionPriority", "rsGlobalPct", "symbol"];

function render(rows, settings, annotate, sort) {
  const annotated = rows.map((r) => annotate(r, settings));
  const filtered = applyResultViewFilters(annotated, viewState(settings));
  return [...filtered].sort((a, b) => compareRowsForSort(a, b, { sort, sortAsc: false, settings }));
}

describe("annotateScreenerRowMemo (golden)", () => {
  const all = makeRows(1500);
  const modes = [{ setupMode: "leader" }, { setupMode: "weakness" }, { setupMode: "breakout" }, {}];

  it("cada fila anotada es profundamente igual a la anotación sin memo (varios modos)", () => {
    for (const settings of modes) {
      for (const row of all) {
        expect(annotateScreenerRowMemo(row, settings)).toEqual(annotateScreenerRow(row, settings));
      }
    }
  });

  it("salida de pantalla idéntica (filas, orden, anotación serializada) en secuencia de gestos", () => {
    // gestos: subconjuntos solapados y cambios de modo, como toggles de filtro
    const subsets = [all.slice(0, 560), all.slice(200, 1179), all.filter((_, i) => i % 3 === 0), all.slice(0, 26)];
    for (const settings of [...modes, ...modes]) {
      for (const subset of subsets) {
        for (const sort of SORTS) {
          const cached = render(subset, settings, annotateScreenerRowMemo, sort);
          const plain = render(subset, settings, annotateScreenerRow, sort);
          expect(JSON.stringify(cached)).toBe(JSON.stringify(plain));
        }
      }
    }
  }, 60000);

  it("memo: misma identidad por (fila, modo); modo distinto o fila distinta no comparten", () => {
    const row = all[0];
    const a = annotateScreenerRowMemo(row, { setupMode: "leader" });
    expect(annotateScreenerRowMemo(row, { setupMode: "leader", otro: 1 })).toBe(a);
    const b = annotateScreenerRowMemo(row, { setupMode: "weakness" });
    expect(b).not.toBe(a);
    expect(annotateScreenerRowMemo(row, { setupMode: "leader" })).toBe(a);
    expect(annotateScreenerRowMemo({ ...row }, { setupMode: "leader" })).not.toBe(a);
    // no muta la fila original
    expect(row.__screenerAnnotation).toBeUndefined();
  });

  it("annotateScreenerRowsMemo conserva longitud y orden", () => {
    const out = annotateScreenerRowsMemo(all.slice(0, 50), modes[0]);
    expect(out.map((r) => r.symbol)).toEqual(all.slice(0, 50).map((r) => r.symbol));
  });

  it("bench: gesto de filtro repetido (3.576 filas, ~560 -> ~979 pasan)", () => {
    const rows = makeRows(3576);
    const settings = { setupMode: "leader" };
    const gesture = (annotate, subset) => {
      const t = performance.now();
      subset.map((r) => annotate(r, settings));
      return performance.now() - t;
    };
    const s560 = rows.slice(0, 560);
    const s979 = rows.slice(0, 979);
    const s979b = rows.filter((_, i) => i % 4 !== 0).slice(0, 979);
    gesture(annotateScreenerRow, rows.slice(3000, 3100)); // warmup JIT
    const base = [s560, s979, s560, s979b, s979].map((s) => gesture(annotateScreenerRow, s));
    const memo = [s560, s979, s560, s979b, s979].map((s) => gesture(annotateScreenerRowMemo, s));
    // eslint-disable-next-line no-console
    console.log(`[annotate-memo-bench] sin memo ms=${base.map((x) => x.toFixed(1)).join("/")} | con memo ms=${memo.map((x) => x.toFixed(1)).join("/")}`);
    expect(memo[2]).toBeLessThan(base[2] * 0.2); // repetir subconjunto ya visto: casi gratis
    expect(memo[4]).toBeLessThan(base[4] * 0.2);
  });
});
