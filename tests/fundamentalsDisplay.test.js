// tests/fundamentalsDisplay.test.js — exposición honesta de fundamentales
// (research/datos-fundamentales-2026-11/). Cada caso nace de un símbolo real.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ABSENT_REASONS,
  annualGrowthCells,
  debtToEquityDisplay,
  dividendYieldDisplay,
  growthDisplay,
  marginDisplay,
  multipleDisplay,
  quarterlyAbsenceReason,
  roeDisplay,
} from "@/lib/fundamentalsDisplay";
import { fetchYahooFundamentals } from "@/lib/yahoo";

describe("dividendYieldDisplay", () => {
  it("distingue «no paga» (0) de «sin dato» (null)", () => {
    expect(dividendYieldDisplay(0).text).toBe(ABSENT_REASONS.noDividend);
    expect(dividendYieldDisplay(null).text).toBe(ABSENT_REASONS.provider);
    expect(dividendYieldDisplay(undefined).state).toBe("ghost");
    expect(dividendYieldDisplay(0.32).state).toBe("value");
  });
});

describe("growthDisplay", () => {
  it("no pinta cifras absurdas (ABT.MI −1.424 %, GERHSP.CO +810 %)", () => {
    expect(growthDisplay(-1424.57).state).toBe("note");
    expect(growthDisplay(809.68).text).toContain(">+500");
    expect(growthDisplay(11.7).state).toBe("value");
    expect(growthDisplay(null).text).toBe(ABSENT_REASONS.provider);
  });
});

describe("marginDisplay", () => {
  it("un 0 sin ingresos es ausencia (RCE.AX grossMargin 0)", () => {
    expect(marginDisplay(0, { revenue: 0 }).state).toBe("ghost");
    expect(marginDisplay(0, {}).state).toBe("ghost");
    expect(marginDisplay(0, { revenue: 1000 }).state).toBe("value");
    expect(marginDisplay(27.6, { revenue: 1 }).state).toBe("value");
  });
});

describe("roeDisplay / debtToEquityDisplay", () => {
  it("patrimonio negativo no produce ratio (SBUX)", () => {
    expect(roeDisplay(-31.2, { equity: -8_000_000_000 }).text).toBe(ABSENT_REASONS.negativeEquity);
    expect(debtToEquityDisplay(-328.7, { equity: -8e9 }).text).toBe(ABSENT_REASONS.negativeEquity);
    expect(debtToEquityDisplay(-328.7).text).toBe(ABSENT_REASONS.negativeEquity);
  });
  it("con patrimonio positivo sí hay cifra", () => {
    expect(roeDisplay(142.3, { equity: 1e11 }).state).toBe("value");
    expect(debtToEquityDisplay(84.28, { equity: 1e11, format: (n) => `${n / 100}x` }).text).toBe("0.8428x");
  });
});

describe("multipleDisplay", () => {
  it("explica la ausencia por pérdidas", () => {
    expect(multipleDisplay(null, { earnings: -5 }).text).toBe(ABSENT_REASONS.losses);
    expect(multipleDisplay(null, {}).text).toBe(ABSENT_REASONS.provider);
    expect(multipleDisplay(-3, {}).text).toBe(ABSENT_REASONS.losses);
    expect(multipleDisplay(38.1, { format: (n) => `${n}x` }).text).toBe("38.1x");
  });
});

describe("quarterlyAbsenceReason / annualGrowthCells", () => {
  it("HK semestral: motivo concreto y alternativa anual", () => {
    expect(quarterlyAbsenceReason({ quarterlyRows: 0, annualRows: 4, symbol: "0425.HK" })).toMatch(/semestralmente/);
    expect(quarterlyAbsenceReason({ quarterlyRows: 5, annualRows: 4, symbol: "AAPL" })).toMatch(/5 trimestres/);
    expect(quarterlyAbsenceReason({ quarterlyRows: 8 })).toBe("");
  });
  it("crecimiento anual con base positiva", () => {
    const out = annualGrowthCells({
      incomeAnnual: [
        { date: "2025-12-31", revenue: 120, eps: 2.4 },
        { date: "2024-12-31", revenue: 100, eps: 2.0 },
        { date: "2023-12-31", revenue: 80, eps: -1 },
      ],
    });
    expect(out.cells.map((c) => c.label)).toEqual(["2023", "2024", "2025"]);
    expect(out.cells[2].revenueYoY).toBeCloseTo(20);
    expect(out.cells[2].epsYoY).toBeCloseTo(20);
    expect(out.cells[1].epsYoY).toBeNull(); // base negativa
    expect(out.usable).toBe(true);
  });
});

describe("fetchYahooFundamentals: BPA", () => {
  afterEach(() => vi.unstubAllGlobals());
  const point = (d, v) => ({ asOfDate: d, currencyCode: "USD", reportedValue: { raw: v } });
  it("pide los tipos de BPA y los vuelca a las filas trimestrales y anuales", async () => {
    let requested = "";
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      requested = String(url);
      const mk = (type, rows) => ({ meta: { type: [type] }, [type]: rows });
      return { ok: true, json: async () => ({ timeseries: { result: [
        mk("quarterlyTotalRevenue", [point("2026-03-31", 90), point("2026-06-30", 100)]),
        mk("quarterlyNetIncome", [point("2026-03-31", 9), point("2026-06-30", 10)]),
        mk("quarterlyDilutedEPS", [point("2026-03-31", 0.9), point("2026-06-30", 1.1)]),
        mk("quarterlyDilutedAverageShares", [point("2026-06-30", 9)]),
        mk("annualTotalRevenue", [point("2025-12-31", 380)]),
        mk("annualDilutedEPS", [point("2025-12-31", 3.9)]),
      ] } }) };
    }));
    const out = await fetchYahooFundamentals("TEST");
    for (const t of ["quarterlyDilutedEPS", "quarterlyBasicEPS", "annualDilutedEPS", "quarterlyDilutedAverageShares"]) {
      expect(requested).toContain(t);
    }
    const q = out.financialResults.incomeQuarterly;
    expect(q[0].eps).toBe(1.1);
    expect(q[0].weightedAverageShsOutDil).toBe(9);
    expect(q[1].eps).toBe(0.9);
    expect(out.financialResults.incomeAnnual[0].eps).toBe(3.9);
    expect(out.financialResults.latest.eps).toBe(1.1);
  });
});

describe("tarjeta de identidad: alternativa anual", () => {
  it("HK sin trimestres pero con 4 años: usa crecimiento anual y explica el motivo", async () => {
    const { buildChartIdentityCard } = await import("@/lib/chartIdentityCard");
    const card = buildChartIdentityCard({
      symbol: "0425.HK",
      data: {
        financialResults: {
          incomeQuarterly: [],
          incomeAnnual: [
            { date: "2025-12-31", revenue: 130, eps: 2.3 },
            { date: "2024-12-31", revenue: 120, eps: 2.0 },
            { date: "2023-12-31", revenue: 100, eps: 1.8 },
            { date: "2022-12-31", revenue: 90, eps: 1.5 },
          ],
        },
      },
      rsUniverse: null,
    });
    expect(card.growth.usable).toBe(false);
    expect(card.growth.annual.usable).toBe(true);
    expect(card.growth.absenceReason).toMatch(/semestralmente/);
  });
});

describe("roeDisplay sin patrimonio en balance", () => {
  it("ROE negativo con margen neto positivo = patrimonio negativo (SBUX)", () => {
    expect(roeDisplay(-31.2, { profitMargin: 6.7 }).text).toBe(ABSENT_REASONS.negativeEquity);
    expect(roeDisplay(-8, { profitMargin: -5 }).state).toBe("value"); // pérdidas reales
  });
});
