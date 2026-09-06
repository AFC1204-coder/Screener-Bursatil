import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CompanyMark } from "@/lib/screenerAtoms";
import { companyMarkLogoCandidates } from "@/lib/screenerFormat";

describe("companyMarkLogoCandidates", () => {
  it("con dominio: Google favicon y luego Clearbit", () => {
    expect(companyMarkLogoCandidates({
      symbol: "AAPL",
      website: "https://www.apple.com",
      logoDomain: "apple.com",
    })).toEqual([
      "https://www.google.com/s2/favicons?domain=apple.com&sz=128",
      "https://logo.clearbit.com/apple.com",
    ]);
  });

  it("sin dominio: lista vacía", () => {
    expect(companyMarkLogoCandidates({ symbol: "ZZZZ", companyName: "Zeta Zeta" })).toEqual([]);
  });
});

describe("CompanyMark", () => {
  it("con website pinta img de favicon, no iniciales", () => {
    const html = renderToStaticMarkup(React.createElement(CompanyMark, {
      row: { symbol: "AAPL", companyName: "Apple Inc.", website: "https://www.apple.com", logoDomain: "apple.com" },
    }));
    expect(html).toContain("<img");
    expect(html).toContain("https://www.google.com/s2/favicons?domain=apple.com&amp;sz=128");
    expect(html).not.toContain("<b>");
  });

  it("sin dominio pinta iniciales", () => {
    const html = renderToStaticMarkup(React.createElement(CompanyMark, {
      row: { symbol: "ZZZZ", companyName: "Zeta Holdings" },
    }));
    expect(html).not.toContain("<img");
    expect(html).toContain("<b>ZH</b>");
  });
});
