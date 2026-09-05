import { describe, expect, it } from "vitest";
import {
  chartRsPropsFromRow,
  chartRsPropsFromWeeklyResponse,
  rowHasChartRsSeries,
  rsWeeklyChartQuery,
} from "@/lib/chartRsRowProps";

describe("chartRsRowProps", () => {
  it("rowHasChartRsSeries detecta series hidratadas en la fila", () => {
    expect(rowHasChartRsSeries({ symbol: "AAPL" })).toBe(false);
    expect(rowHasChartRsSeries({ globalRsSeries: [{ date: "2026-01-01", rsRating: 90 }] })).toBe(true);
    expect(rowHasChartRsSeries({ countryRsSeries: [{ date: "2026-01-01", rsRating: 80 }] })).toBe(true);
  });

  it("chartRsPropsFromRow prioriza series hidratadas sobre fetch", () => {
    const row = {
      globalRsSeries: [{ date: "2026-01-01", rsRating: 91 }],
      countryRsSeries: [{ date: "2026-01-01", rsRating: 88 }],
      weeklyCountryRsRating: 88,
      weeklyThemeRsRating: 72,
    };
    const fetched = {
      globalRsSeries: [{ date: "2026-02-01", rsRating: 50 }],
      countryRsSeries: [],
      themeRsSeries: [{ date: "2026-02-01", rsRating: 40 }],
      countryRsRating: 40,
      themeRsRating: 40,
    };
    const props = chartRsPropsFromRow(row, fetched);
    expect(props.rsRatingSeries).toEqual(row.globalRsSeries);
    expect(props.rsCountrySeries).toEqual(row.countryRsSeries);
    expect(props.rsThemeSeries).toEqual(fetched.themeRsSeries);
    expect(props.rsCountryMainScore).toBe(88);
    expect(props.rsThemeMainScore).toBe(72);
  });

  it("chartRsPropsFromWeeklyResponse normaliza bloques global/country/theme", () => {
    const props = chartRsPropsFromWeeklyResponse({
      ok: true,
      series: [{ date: "2026-01-01", rsRating: 95 }],
      global: { series: [{ date: "2026-01-01", rsRating: 95 }], latest: { rsRating: 95 } },
      country: { series: [{ date: "2026-01-01", rsRating: 90 }], latest: { rsRating: 90 } },
      theme: { series: [], latest: null },
    });
    expect(props.globalRsSeries).toHaveLength(1);
    expect(props.countryRsSeries).toHaveLength(1);
    expect(props.countryRsRating).toBe(90);
  });

  it("rsWeeklyChartQuery incluye sector/industria/tema para RS tema", () => {
    const query = rsWeeklyChartQuery("MSFT", {
      sector: "Technology",
      industry: "Software",
      theme: "cloud",
    });
    expect(query).toContain("symbol=MSFT");
    expect(query).toContain("sector=Technology");
    expect(query).toContain("industry=Software");
    expect(query).toContain("theme=cloud");
  });
});
