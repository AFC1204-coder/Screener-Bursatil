import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import QuickReviewModal from "@/app/components/screener/QuickReviewModal";
import ChartIdentityCard from "@/app/stock/[symbol]/ChartIdentityCard";
import { buildChartIdentityCard } from "@/lib/chartIdentityCard";
import { DESCRIPTIVE_ABSENCE } from "@/lib/descriptiveStrip";
import {
  QUICK_BUSINESS_EMPTY,
  quickBusinessActivity,
  quickBusinessDescription,
  quickBusinessMarket,
} from "@/lib/screenerFormat";
import {
  RS_NOT_HYDRATED_REASON,
  RS_NOT_RANKED_REASON,
  canonicalRs,
} from "@/lib/rsCanonical";
import { REVIEW_RS_SHORT, reviewRsCell } from "@/lib/reviewRsDisplay";
import { resolveStockCompanyBriefSurface } from "@/lib/stockCompanyBriefSurface";

const MUTE_DASH = /^[-–—]$/;

function modalMarkup(row, extra = {}) {
  return renderToStaticMarkup(createElement(QuickReviewModal, {
    activeModalRow: row,
    modalReviewRows: [row],
    modalReviewPosition: 0,
    modalDecisionResolutions: {},
    chartSettings: {},
    closeQuickReview: () => {},
    moveQuickReview: () => {},
    reopenQuickReviewDecision: () => {},
    resolveQuickReviewDecision: () => {},
    saveQuickReviewStockOpen: () => {},
    updateChartScope: () => {},
    updateChartSettings: () => {},
    ...extra,
  }));
}

describe("REVIEW-MODAL-ABSENCE-1 — RS vía reviewRsCell", () => {
  it("fila sin weeklyRs → Cargando… (cola + El valor), cero guion mudo en RS", () => {
    const row = { symbol: "AVAH", companyName: "Aveanna", country: "US" };
    const cell = reviewRsCell(canonicalRs(row), {
      availableTitle: "RS semanal del universo",
    });
    expect(cell.text).toBe(REVIEW_RS_SHORT.loading);
    expect(cell.text).not.toMatch(MUTE_DASH);
    expect(cell.title).toBe(RS_NOT_HYDRATED_REASON);

    const html = modalMarkup(row);
    expect(html).toContain("Cargando…");
    expect(html.match(/reviewRsMissing/g)?.length).toBeGreaterThanOrEqual(2);
    // Ninguna celda RS del modal es solo guion
    expect(html).not.toMatch(/title="[^"]*">\s*[-–—]\s*</);
  });

  it("weeklyRsAvailable false → Sin ranking", () => {
    const row = {
      symbol: "AVAH",
      companyName: "Aveanna",
      weeklyRsAvailable: false,
      weeklyRsReason: RS_NOT_RANKED_REASON,
    };
    const html = modalMarkup(row);
    expect(html).toContain("Sin ranking");
    expect(reviewRsCell(canonicalRs(row)).text).toBe(REVIEW_RS_SHORT.not_ranked);
  });

  it("RS disponible → número, sin clase muted", () => {
    const row = {
      symbol: "AAPL",
      companyName: "Apple",
      weeklyRsAvailable: true,
      weeklyRsRating: 91,
    };
    const html = modalMarkup(row);
    expect(html).toMatch(/>91</);
    expect(html).not.toContain("reviewRsMissing");
  });
});

describe("REVIEW-MODAL-ABSENCE-1 — Negocio sin «opera en» inventado", () => {
  it("sin businessSummary no fabrica opera en industria/sector", () => {
    const row = {
      symbol: "AVAH",
      companyName: "Aveanna Healthcare",
      industry: "Medical Care Facilities",
      sector: "Healthcare",
      theme: "Medtech / biotech",
    };
    const text = quickBusinessDescription(row);
    expect(text).toBe(QUICK_BUSINESS_EMPTY);
    expect(text).not.toMatch(/opera en/i);

    const ficha = resolveStockCompanyBriefSurface({
      data: { summary: "", short: "", theme: "Medtech / biotech" },
    });
    expect(ficha.state).toBe("empty");
    expect(ficha.message).toBe(QUICK_BUSINESS_EMPTY);

    const html = modalMarkup(row);
    expect(html).toContain(QUICK_BUSINESS_EMPTY);
    expect(html).not.toMatch(/opera en/i);
  });

  it("con businessSummary usable lo muestra (compactado)", () => {
    const row = {
      symbol: "AAPL",
      companyName: "Apple",
      businessSummary: "Apple designs and sells consumer electronics worldwide.",
      industry: "Consumer Electronics",
    };
    expect(quickBusinessDescription(row)).toContain("Apple designs");
    expect(quickBusinessDescription(row)).not.toMatch(/opera en/i);
  });

  it("Actividad / Mercado sin guion mudo", () => {
    expect(quickBusinessActivity({ symbol: "X" })).toBe("Sin actividad");
    expect(quickBusinessActivity({ symbol: "X" })).not.toMatch(MUTE_DASH);
    expect(quickBusinessMarket({ symbol: "X" })).toBe("Sin mercado");
    expect(quickBusinessMarket({ symbol: "X" })).not.toMatch(MUTE_DASH);

    const withMeta = {
      symbol: "AVAH",
      industry: "Medical Care Facilities",
      sector: "Healthcare",
      country: "US",
      exchange: "NASDAQ",
    };
    expect(quickBusinessActivity(withMeta)).toContain("Medical Care");
    expect(quickBusinessMarket(withMeta)).toMatch(/NASDAQ/);

    const html = modalMarkup({ symbol: "X", companyName: "Empty Co" });
    expect(html).toContain("Sin actividad");
    expect(html).toContain("Sin mercado");
  });
});

describe("REVIEW-MODAL-ABSENCE-1 — stretch ChartIdentityCard RS", () => {
  it("Absent de RS pinta copy corto, no guion mudo; motivo largo en hint", () => {
    const card = buildChartIdentityCard({
      symbol: "AVAH",
      data: {
        name: "Aveanna",
        chartBars: Array.from({ length: 100 }, (_, i) => ({
          date: `2025-01-${String((i % 28) + 1).padStart(2, "0")}`,
          close: 10 + i * 0.01,
        })),
        relativeStrength: {},
        stage: { weekly: { state: "insufficient_history", detail: "Requiere al menos 40 semanas." } },
        financialResults: {},
      },
      rsUniverse: null,
    });
    expect(card.rs.value).toBeNull();
    const html = renderToStaticMarkup(createElement(ChartIdentityCard, { card }));
    expect(html).toContain("Sin ranking");
    expect(html).toContain(DESCRIPTIVE_ABSENCE.rs.slice(0, 30));
    expect(html).toContain("reviewRsMissing");
    // Tras la etiqueta RS no hay guion aria-hidden (solo copy corto)
    const afterRs = html.split("chartIdCardRsLabel")[1] || "";
    const rsCell = afterRs.split("chartIdCardStructCell")[0] || "";
    expect(rsCell).toContain("Sin ranking");
    expect(rsCell).not.toMatch(/aria-hidden="true">–</);
  });
});
