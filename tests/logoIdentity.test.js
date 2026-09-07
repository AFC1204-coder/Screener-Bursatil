import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { N0VerdictBlock } from "@/app/stock/[symbol]/StockClient";
import { CompanyMark } from "@/lib/screenerAtoms";
import {
  companyClearbitUrl,
  companyFaviconUrl,
  companyMarkLogoCandidates,
  stockHeroLogoCandidates,
} from "@/lib/screenerFormat";
import { scanLightMetrics } from "@/lib/scanLightProjection";

describe("identidad visual LOGO-1", () => {
  it("prioriza Clearbit sobre favicon en la portada /stock", () => {
    expect(stockHeroLogoCandidates({
      logoUrl: "https://www.google.com/s2/favicons?domain=apple.com&sz=128",
      clearbitLogoUrl: "https://logo.clearbit.com/apple.com",
    })).toEqual([
      "https://logo.clearbit.com/apple.com",
      "https://www.google.com/s2/favicons?domain=apple.com&sz=128",
    ]);
  });

  it("prioriza favicon sobre Clearbit en la mesa", () => {
    const candidates = companyMarkLogoCandidates({ logoDomain: "apple.com" });
    expect(candidates[0]).toBe(companyFaviconUrl("apple.com"));
    expect(candidates[1]).toBe(companyClearbitUrl("apple.com"));
  });

  it("N0VerdictBlock pinta Clearbit en stockLogoPro", () => {
    const html = renderToStaticMarkup(React.createElement(N0VerdictBlock, {
      symbol: "AAPL",
      data: {
        name: "Apple Inc.",
        visual: {
          initials: "AP",
          logoUrl: "https://www.google.com/s2/favicons?domain=apple.com&sz=128",
          clearbitLogoUrl: "https://logo.clearbit.com/apple.com",
        },
      },
      priceSnapshot: { price: 190 },
      freshness: {},
      actions: [],
    }));
    expect(html).toContain('class="stockLogoPro"');
    expect(html).toContain("https://logo.clearbit.com/apple.com");
  });

  it("CompanyMark usa favicon con dominio de website", () => {
    const html = renderToStaticMarkup(React.createElement(CompanyMark, {
      row: { symbol: "AAPL", companyName: "Apple Inc.", website: "https://www.apple.com" },
    }));
    expect(html).toContain("google.com/s2/favicons");
    expect(html).toContain("apple.com");
  });

  it("scanLightMetrics conserva website y logoDomain", () => {
    const metrics = scanLightMetrics({
      symbol: "AAPL",
      website: "https://www.apple.com",
      logoDomain: "apple.com",
    });
    expect(metrics.website).toBe("https://www.apple.com");
    expect(metrics.logoDomain).toBe("apple.com");
  });
});
