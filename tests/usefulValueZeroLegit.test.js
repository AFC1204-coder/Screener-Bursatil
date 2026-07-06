// Tests for the zero-legit fix in usefulValue / coveragePct.
//
// Context: usefulValue originally treated ANY numeric 0 as "missing data", penalizing
// coveragePct for fields where 0 is a legitimate real-world value (e.g. debtToEquity=0
// for a debt-free company). This test suite verifies:
//   1. Each zero-legit field counts as "present" when its value is exactly 0.
//   2. Non-zero-legit fields (price, sma50, volume, etc.) still count as "absent" when 0.
//   3. The integration through dataCoverageForRow correctly propagates field names.
//
// Fields where 0 is legitimate (ZERO_LEGIT_FIELDS):
//   shortPercentOfFloat — 0% means no short positions exist
//   debtToEquity        — 0 means zero debt / cash-rich company
//   insiderOwnership    — 0% means no insider holdings filed
//   institutionalOwnership — 0% means no institutional holders
//   maxDrawdown63d      — 0% means no pullback (consecutive highs)
//   operatingMargin     — 0% means operating breakeven
//   profitMargin        — 0% means net breakeven
//   ebitdaMargin        — 0% means EBITDA breakeven
import { describe, expect, it } from "vitest";
import { usefulValue, coveragePct, dataCoverageForRow } from "@/lib/researchRow";

// ---------------------------------------------------------------------------
// 1. usefulValue unit tests: each zero-legit field with value 0 → present
// ---------------------------------------------------------------------------
describe("usefulValue · zero-legit fields", () => {
  const ZERO_LEGIT = [
    "shortPercentOfFloat",
    "debtToEquity",
    "insiderOwnership",
    "institutionalOwnership",
    "maxDrawdown63d",
    "operatingMargin",
    "profitMargin",
    "ebitdaMargin",
  ];

  for (const field of ZERO_LEGIT) {
    it(`${field}=0 cuenta como presente (dato real)`, () => {
      expect(usefulValue(0, field)).toBe(true);
    });

    it(`${field}=undefined cuenta como ausente (sin dato)`, () => {
      expect(usefulValue(undefined, field)).toBe(false);
    });

    it(`${field}=null cuenta como ausente (sin dato)`, () => {
      expect(usefulValue(null, field)).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// 2. usefulValue unit tests: non-zero-legit fields with value 0 → absent
// ---------------------------------------------------------------------------
describe("usefulValue · non-zero-legit fields (0 = dato faltante)", () => {
  const NON_ZERO_LEGIT = [
    "price",
    "sma50",
    "sma150",
    "sma200",
    "sma200Slope",
    "avgVolume",
    "avgTurnover",
    "latestVolume",
    "latestTurnover",
    "volatility63d",
    "marketCap",
    "roe",
    "roa",
    "currentRatio",
    "grossMargin",
    "relativeVolume",
    "upDownVolRatio",
  ];

  for (const field of NON_ZERO_LEGIT) {
    it(`${field}=0 cuenta como ausente (dato faltante/roto)`, () => {
      expect(usefulValue(0, field)).toBe(false);
    });

    it(`${field}=42 cuenta como presente (valor real)`, () => {
      expect(usefulValue(42, field)).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// 3. usefulValue backward compatibility: no field name → old behavior
// ---------------------------------------------------------------------------
describe("usefulValue · backward compat (sin field)", () => {
  it("sin segundo argumento, 0 sigue contando como ausente", () => {
    expect(usefulValue(0)).toBe(false);
  });

  it("sin segundo argumento, valores positivos cuentan como presentes", () => {
    expect(usefulValue(42)).toBe(true);
    expect(usefulValue(-3)).toBe(true);
  });

  it("sin segundo argumento, null/undefined/'' cuentan como ausentes", () => {
    expect(usefulValue(null)).toBe(false);
    expect(usefulValue(undefined)).toBe(false);
    expect(usefulValue("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. coveragePct with [value, field] pairs
// ---------------------------------------------------------------------------
describe("coveragePct · pares [value, field]", () => {
  it("cuenta shortPercentOfFloat=0 como presente en coveragePct", () => {
    const pct = coveragePct([[0, "shortPercentOfFloat"]]);
    expect(pct).toBe(100);
  });

  it("cuenta debtToEquity=0 como presente en coveragePct", () => {
    const pct = coveragePct([[0, "debtToEquity"]]);
    expect(pct).toBe(100);
  });

  it("cuenta maxDrawdown63d=0 como presente en coveragePct", () => {
    const pct = coveragePct([[0, "maxDrawdown63d"]]);
    expect(pct).toBe(100);
  });

  it("mezcla: zero-legit en 0 + no-zero-legit en 0 → solo cuenta el primero", () => {
    const pct = coveragePct([
      [0, "shortPercentOfFloat"],  // presente (zero-legit)
      [0, "price"],               // ausente (non-zero-legit)
      [100, "sma50"],             // presente
    ]);
    // 2 de 3 → 67%
    expect(pct).toBe(67);
  });

  it("backward compat: flat array sin pares funciona como antes", () => {
    const pct = coveragePct([42, 0, 7, 0, 3]);
    // 3 de 5 (42, 7, 3) → 60%
    expect(pct).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// 5. dataCoverageForRow integration: zero-legit fields at 0 boost coverage
// ---------------------------------------------------------------------------
describe("dataCoverageForRow · zero-legit integration", () => {
  // Base row with non-zero technicals, but zero-legit fundamentals at 0
  const rowWithZeroLegitZero = {
    symbol: "CASHRICH",
    priceFreshnessOk: true,
    priceFreshnessDays: 1,
    priceFreshnessMaxDays: 5,
    chartBarsCount: 260,
    price: 120,
    sma50: 115,
    sma150: 108,
    sma200: 100,
    sma200Slope: 0.5,
    distance20d: 3,
    distance50d: 5,
    distance52w: -10,
    distanceATH: -15,
    highsSpreadPct: 8,
    perf3m: 12,
    perf6m: 25,
    perf12m: 40,
    extSma50: 1.1,
    avgVolume: 500000,
    avgTurnover: 60000000,
    latestVolume: 550000,
    latestTurnover: 66000000,
    relativeVolume: 1.1,
    volumeSurgePct: 5,
    upDownVolRatio: 1.3,
    volumeEffectScore: 60,
    shortPercentOfFloat: 0,   // zero-legit: sin posiciones cortas
    maxDailyMove20dPct: 3,
    maxDailyRange20dPct: 5,
    range63dPct: 20,
    volatility63d: 25,
    maxDrawdown63d: 0,        // zero-legit: sin drawdown
    rsRating: 85,
    rs3m: 5,
    rs6m: 10,
    rs12m: 20,
    companyName: "CashRich Corp",
    exchange: "NASDAQ",
    country: "US",
    currency: "USD",
    marketCap: 5000000000,
    sector: "Technology",
    industry: "Software",
    website: "https://cashrich.com",
    ipoDate: "2015-06-15",
    growthMetrics: {
      revenueGrowth: 20,
      earningsGrowth: 15,
      grossMargin: 65,
      operatingMargin: 0,          // zero-legit: breakeven operativo
      profitMargin: 0,            // zero-legit: breakeven neto
      ebitdaMargin: 0,            // zero-legit: breakeven EBITDA
      roe: 12,
      roa: 8,
      debtToEquity: 0,            // zero-legit: sin deuda
      currentRatio: 2.5,
      institutionalOwnership: 0,  // zero-legit: sin inst. holders
      insiderOwnership: 0,         // zero-legit: sin insider holdings
      shortPercentOfFloat: 0,    // zero-legit: sin posiciones cortas
    },
  };

  it("fundamental coverage cuenta los campos zero-legit en 0 como presentes", () => {
    const coverage = dataCoverageForRow(rowWithZeroLegitZero, {});
    // All 13 fundamental fields are either non-zero or zero-legit at 0 → 100%
    expect(coverage.fundamentalCoverageScore).toBe(100);
  });

  it("technical coverage cuenta shortPercentOfFloat=0 y maxDrawdown63d=0 como presentes", () => {
    const coverage = dataCoverageForRow(rowWithZeroLegitZero, {});
    // priceFreshnessOk (100) + chartBarsCount (260) + all other technicals non-zero
    // + shortPercentOfFloat=0 (zero-legit, counts) + maxDrawdown63d=0 (zero-legit, counts)
    // Should be very high — all 35 fields present
    expect(coverage.technicalCoverageScore).toBe(100);
  });

  it("dataCoverageScore total refleja el boost por zero-legit", () => {
    const coverage = dataCoverageForRow(rowWithZeroLegitZero, {});
    // technical=100, profile=90 (businessSummary missing from profile={}), fundamental=100
    // 100*0.68 + 90*0.22 + 100*0.1 = 68 + 19.8 + 10 = 97.8 → 98
    expect(coverage.dataCoverageScore).toBe(98);
  });

  it("antes del fix, debtToEquity=0 e insiderOwnership=0 bajaban fundamentalCoverageScore", () => {
    // Simulate old behavior: manually count non-zero values in fundamental fields
    const gm = rowWithZeroLegitZero.growthMetrics;
    const fundamentalValues = [
      gm.revenueGrowth, gm.earningsGrowth, gm.grossMargin,
      gm.operatingMargin, gm.profitMargin, gm.ebitdaMargin,
      gm.roe, gm.roa, gm.debtToEquity, gm.currentRatio,
      gm.institutionalOwnership, gm.insiderOwnership, gm.shortPercentOfFloat,
    ];
    // Old behavior: 0 counts as absent. Only non-zero values count.
    const oldUseful = (v) => Number.isFinite(v) ? v !== 0 : v !== undefined && v !== null && v !== "";
    const oldCount = fundamentalValues.filter(oldUseful).length;
    // revenueGrowth(20), earningsGrowth(15), grossMargin(65), roe(12), roa(8), currentRatio(2.5) = 6
    // operatingMargin(0), profitMargin(0), ebitdaMargin(0), debtToEquity(0), institutionalOwnership(0), insiderOwnership(0), shortPercentOfFloat(0) = 7 zeros
    expect(oldCount).toBe(6);
    // Old fundamentalCoverageScore: round(6/13 * 100) = 46
    const oldFundamentalPct = Math.round((oldCount / fundamentalValues.length) * 100);
    expect(oldFundamentalPct).toBe(46);
  });
});

// ---------------------------------------------------------------------------
// 6. dataCoverageForRow integration: non-zero-legit fields at 0 still absent
// ---------------------------------------------------------------------------
describe("dataCoverageForRow · non-zero-legit at 0 remains absent", () => {
  it("price=0 baja technicalCoverageScore (dato faltante, no real)", () => {
    const row = {
      symbol: "BROKEN",
      priceFreshnessOk: true,
      chartBarsCount: 260,
      price: 0,          // non-zero-legit: 0 = dato roto
      sma50: 115,
      sma150: 108,
      sma200: 100,
      sma200Slope: 0.5,
      distance20d: 3,
      distance50d: 5,
      distance52w: -10,
      distanceATH: -15,
      highsSpreadPct: 8,
      perf3m: 12,
      perf6m: 25,
      perf12m: 40,
      extSma50: 1.1,
      avgVolume: 500000,
      avgTurnover: 60000000,
      latestVolume: 550000,
      latestTurnover: 66000000,
      relativeVolume: 1.1,
      volumeSurgePct: 5,
      upDownVolRatio: 1.3,
      volumeEffectScore: 60,
      shortPercentOfFloat: 0,
      maxDailyMove20dPct: 3,
      maxDailyRange20dPct: 5,
      range63dPct: 20,
      volatility63d: 25,
      maxDrawdown63d: 0,
      rsRating: 85,
      rs3m: 5,
      rs6m: 10,
      rs12m: 20,
    };
    const coverage = dataCoverageForRow(row, {});
    // price=0 should NOT count, so 34 of 35 technical fields present → 97%
    expect(coverage.technicalCoverageScore).toBe(97);
    // Before fix: same result (price was never zero-legit). After fix: still same.
    // This test documents the expected behavior for non-zero-legit fields.
  });

  it("avgVolume=0 baja technicalCoverageScore (dato faltante)", () => {
    const row = {
      symbol: "NOVOL",
      priceFreshnessOk: true,
      chartBarsCount: 260,
      price: 120,
      sma50: 115,
      sma150: 108,
      sma200: 100,
      sma200Slope: 0.5,
      distance20d: 3,
      distance50d: 5,
      distance52w: -10,
      distanceATH: -15,
      highsSpreadPct: 8,
      perf3m: 12,
      perf6m: 25,
      perf12m: 40,
      extSma50: 1.1,
      avgVolume: 0,       // non-zero-legit: 0 = dato roto
      avgTurnover: 60000000,
      latestVolume: 550000,
      latestTurnover: 66000000,
      relativeVolume: 1.1,
      volumeSurgePct: 5,
      upDownVolRatio: 1.3,
      volumeEffectScore: 60,
      shortPercentOfFloat: 0,
      maxDailyMove20dPct: 3,
      maxDailyRange20dPct: 5,
      range63dPct: 20,
      volatility63d: 25,
      maxDrawdown63d: 0,
      rsRating: 85,
      rs3m: 5,
      rs6m: 10,
      rs12m: 20,
    };
    const coverage = dataCoverageForRow(row, {});
    // avgVolume=0 should NOT count → 34 of 35 → 97%
    expect(coverage.technicalCoverageScore).toBe(97);
  });

  it("marketCap=0 baja profileCoverageScore (dato faltante)", () => {
    const row = {
      symbol: "NOCAP",
      priceFreshnessOk: true,
      chartBarsCount: 260,
      price: 120,
      companyName: "NoCap Inc",
      exchange: "NASDAQ",
      country: "US",
      currency: "USD",
      marketCap: 0,       // non-zero-legit: 0 = dato roto
      sector: "Technology",
      industry: "Software",
      website: "https://nocap.com",
      ipoDate: "2020-01-01",
    };
    const coverage = dataCoverageForRow(row, { businessSummary: "A company with no market cap data." });
    // marketCap=0 should NOT count → 9 of 10 profile → 90%
    expect(coverage.profileCoverageScore).toBe(90);
  });
});
