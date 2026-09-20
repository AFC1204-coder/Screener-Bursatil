import { describe, expect, it } from "vitest";
import {
  RS_NOT_HYDRATED_REASON,
  RS_NOT_RANKED_REASON,
  canonicalRs,
} from "@/lib/rsCanonical";
import {
  COUNTRY_RS_MARKET_UNSUPPORTED_REASON,
  COUNTRY_RS_NOT_HYDRATED_REASON,
  COUNTRY_RS_NOT_RANKED_REASON,
  countryRs,
} from "@/lib/countryRs";
import {
  THEME_RS_NOT_HYDRATED_REASON,
  THEME_RS_NOT_RANKED_REASON,
  themeRs,
} from "@/lib/themeRs";
import {
  REVIEW_RS_SHORT,
  classifyReviewRsState,
  reviewRsCell,
} from "@/lib/reviewRsDisplay";
import { buildReviewMetricRows } from "@/lib/reviewMetricGrid";
import { exclusionReasonText } from "@/lib/globalRs";
import { countryExclusionReasonText } from "@/lib/countryRs";
import { themeExclusionReasonText } from "@/lib/themeRs";

describe("REVIEW-RS-COPY-1 — classify + short copy", () => {
  it("available → número, sin clase muted", () => {
    const cell = reviewRsCell(
      { available: true, value: 88, reason: "", hydrated: true },
      { availableTitle: "RS semanal del universo" },
    );
    expect(cell).toEqual({
      state: "available",
      text: "88",
      title: "RS semanal del universo",
      missing: false,
      className: "",
    });
  });

  it("loading (not hydrated) → Cargando… + reason completo en title", () => {
    expect(classifyReviewRsState({
      available: false,
      reason: RS_NOT_HYDRATED_REASON,
      hydrated: false,
    })).toBe("loading");
    const cell = reviewRsCell({
      available: false,
      reason: RS_NOT_HYDRATED_REASON,
      hydrated: false,
    });
    expect(cell.text).toBe(REVIEW_RS_SHORT.loading);
    expect(cell.title).toBe(RS_NOT_HYDRATED_REASON);
    expect(cell.className).toBe("reviewRsMissing");
    expect(cell.missing).toBe(true);
  });

  it("sin ranking (not ranked genérico) → Sin ranking", () => {
    expect(classifyReviewRsState({
      available: false,
      reason: RS_NOT_RANKED_REASON,
      hydrated: true,
    })).toBe("not_ranked");
    expect(reviewRsCell({
      available: false,
      reason: RS_NOT_RANKED_REASON,
      hydrated: true,
    }).text).toBe(REVIEW_RS_SHORT.not_ranked);
  });

  it("sin histórico (insufficient-bars / discontinuous) → Sin histórico", () => {
    const insufficient = exclusionReasonText("insufficient-bars");
    const discontinuous = exclusionReasonText("discontinuous");
    expect(classifyReviewRsState({
      available: false,
      reason: insufficient,
      hydrated: true,
    })).toBe("no_history");
    expect(classifyReviewRsState({
      available: false,
      reason: discontinuous,
      hydrated: true,
    })).toBe("no_history");
    expect(reviewRsCell({
      available: false,
      reason: insufficient,
      hydrated: true,
    }).text).toBe(REVIEW_RS_SHORT.no_history);
  });

  it("error FX → Error", () => {
    const fx = exclusionReasonText("fx-unavailable");
    expect(classifyReviewRsState({
      available: false,
      reason: fx,
      hydrated: true,
    })).toBe("error");
    expect(reviewRsCell({
      available: false,
      reason: fx,
      hydrated: true,
    }).text).toBe(REVIEW_RS_SHORT.error);
  });

  it("país / tema: mismos estados vía reasons canónicos", () => {
    expect(classifyReviewRsState({
      available: false,
      reason: COUNTRY_RS_NOT_HYDRATED_REASON,
      hydrated: false,
    })).toBe("loading");
    expect(classifyReviewRsState({
      available: false,
      reason: THEME_RS_NOT_HYDRATED_REASON,
      hydrated: false,
    })).toBe("loading");
    expect(classifyReviewRsState({
      available: false,
      reason: COUNTRY_RS_NOT_RANKED_REASON,
      hydrated: true,
    })).toBe("not_ranked");
    expect(classifyReviewRsState({
      available: false,
      reason: THEME_RS_NOT_RANKED_REASON,
      hydrated: true,
    })).toBe("not_ranked");
    expect(classifyReviewRsState({
      available: false,
      reason: COUNTRY_RS_MARKET_UNSUPPORTED_REASON,
      hydrated: false,
    })).toBe("not_ranked");
    expect(classifyReviewRsState({
      available: false,
      reason: countryExclusionReasonText("insufficient-bars"),
      hydrated: true,
    })).toBe("no_history");
    expect(classifyReviewRsState({
      available: false,
      reason: themeExclusionReasonText("insufficient-bars"),
      hydrated: true,
    })).toBe("no_history");
  });
});

describe("REVIEW-RS-COPY-1 — lectores reales + metric grid", () => {
  it("fila sin weeklyRs → Cargando… (not hydrated), no guion", () => {
    const rs = canonicalRs({ symbol: "AVAH" });
    expect(rs.available).toBe(false);
    expect(rs.reason).toBe(RS_NOT_HYDRATED_REASON);
    const cell = reviewRsCell(rs, { availableTitle: "RS semanal del universo" });
    expect(cell.text).toBe("Cargando…");
    expect(cell.text).not.toMatch(/^[-–—]$/);
    expect(cell.title).toBe(RS_NOT_HYDRATED_REASON);
  });

  it("fila con weeklyRsAvailable false → Sin ranking", () => {
    const rs = canonicalRs({
      symbol: "AVAH",
      weeklyRsAvailable: false,
      weeklyRsReason: RS_NOT_RANKED_REASON,
    });
    expect(reviewRsCell(rs).text).toBe("Sin ranking");
    expect(reviewRsCell(rs).title).toBe(RS_NOT_RANKED_REASON);
  });

  it("buildReviewMetricRows no pinta - / – en RS ausentes", () => {
    const rows = buildReviewMetricRows({
      symbol: "AVAH",
      country: "US",
      theme: "Software / IA",
      perf3m: 12.5,
    });
    const rsRow = rows.find((r) => r.label === "RS");
    const countryRow = rows.find((r) => r.label === "RS país");
    const themeRow = rows.find((r) => r.label === "RS tema");
    for (const cell of [rsRow, countryRow, themeRow]) {
      expect(cell.text).not.toMatch(/^[-–—]$/);
      expect(cell.className).toBe("reviewRsMissing");
      expect(cell.title.length).toBeGreaterThan(10);
    }
    expect(rsRow.text).toBe("Cargando…");
    // country/theme sin hidratar → Cargando… (US soportado; tema rankable)
    expect(countryRs({ symbol: "AVAH", country: "US" }).reason).toBe(COUNTRY_RS_NOT_HYDRATED_REASON);
    expect(themeRs({ symbol: "AVAH", theme: "Software / IA" }).reason).toBe(THEME_RS_NOT_HYDRATED_REASON);
    expect(countryRow.text).toBe("Cargando…");
    expect(themeRow.text).toBe("Cargando…");
  });

  it("con RS disponible sigue el número", () => {
    const rows = buildReviewMetricRows({
      symbol: "AVAH",
      country: "US",
      theme: "Software / IA",
      weeklyRsAvailable: true,
      weeklyRsRating: 91,
      weeklyCountryRsAvailable: true,
      weeklyCountryRsRating: 77,
      weeklyThemeRsAvailable: true,
      weeklyThemeRsRating: 64,
      weeklyThemeRsThemeKey: "Software / IA",
    });
    expect(rows.find((r) => r.label === "RS")).toMatchObject({
      text: "91",
      title: "RS semanal del universo",
      className: "",
    });
    expect(rows.find((r) => r.label === "RS país")).toMatchObject({
      text: "77",
      className: "",
    });
    expect(rows.find((r) => r.label === "RS tema")).toMatchObject({
      text: "64",
      className: "",
    });
  });
});
