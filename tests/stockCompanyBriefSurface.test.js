import { describe, expect, it } from "vitest";
import {
  companyBriefSummaryText,
  resolveStockCompanyBriefSurface,
  stockCompanyBriefRsCells,
} from "@/lib/stockCompanyBriefSurface";
import { COUNTRY_RS_NOT_RANKED_REASON } from "@/lib/countryRs";
import { REVIEW_RS_SHORT } from "@/lib/reviewRsDisplay";

describe("stockCompanyBriefSurface", () => {
  it("loading cuando aún no hay data", () => {
    const surface = resolveStockCompanyBriefSurface({ symbol: "AAPL", loading: true });
    expect(surface.state).toBe("loading");
    expect(surface.message).toMatch(/Cargando descripción/i);
    expect(surface.rsRows).toEqual([]);
  });

  it("ok con resumen usable", () => {
    const surface = resolveStockCompanyBriefSurface({
      symbol: "AAPL",
      data: {
        symbol: "AAPL",
        theme: "Software",
        summary: "Apple diseña y vende dispositivos y servicios digitales en todo el mundo.",
      },
    });
    expect(surface.state).toBe("ok");
    expect(surface.summary).toMatch(/Apple diseña/);
    expect(surface.themeLabel).toBe("Software");
  });

  it("vacío honesto sin resumen ni short", () => {
    const surface = resolveStockCompanyBriefSurface({
      symbol: "XYZ",
      data: {
        symbol: "XYZ",
        sector: "Technology",
        summary: "",
        short: "",
      },
    });
    expect(surface.state).toBe("empty");
    expect(surface.message).toMatch(/Sin descripción de negocio/i);
  });

  it("vacío degradado cuando el proveedor no respondió", () => {
    const surface = resolveStockCompanyBriefSurface({
      symbol: "AAPL",
      data: {
        symbol: "AAPL",
        summary: "Ficha degradada: datos de proveedor no disponibles temporalmente.",
        dataQuality: { degraded: true, unavailable: true },
        growthMetrics: { providerNote: "Datos degradados: proveedor temporalmente no disponible." },
      },
    });
    expect(surface.state).toBe("empty");
    expect(surface.message).toMatch(/proveedor/i);
  });

  it("error cuando la carga falla", () => {
    const surface = resolveStockCompanyBriefSurface({
      symbol: "AAPL",
      error: "No se ha podido cargar la ficha de este valor.",
    });
    expect(surface.state).toBe("error");
    expect(surface.message).toMatch(/No se ha podido cargar/i);
  });

  it("ignora resúmenes de Yahoo sin descripción", () => {
    expect(companyBriefSummaryText({
      summary: "Yahoo no ofrece descripción para este valor.",
      short: "Operador logístico regional.",
    })).toBe("Operador logístico regional.");
  });

  it("RS país ausente usa copy corto de reviewRsDisplay", () => {
    const rows = stockCompanyBriefRsCells({
      country: "Switzerland",
      theme: "Diagnostics",
      relativeStrength: {
        rating: 88,
        countryRsRating: undefined,
        countryRsReason: COUNTRY_RS_NOT_RANKED_REASON,
      },
    }, "SOPH.SW");
    const country = rows.find((row) => row.key === "country");
    expect(country).toBeTruthy();
    expect(country.cell.text).toBe(REVIEW_RS_SHORT.not_ranked);
    expect(country.cell.title).toMatch(/país/i);
  });

  it("RS tema disponible muestra el percentil", () => {
    const rows = stockCompanyBriefRsCells({
      theme: "Diagnostics",
      relativeStrength: {
        rating: 88,
        themeRsRating: 72,
      },
    }, "SOPH");
    const theme = rows.find((row) => row.key === "theme");
    expect(theme?.cell.text).toBe("72");
    expect(theme?.cell.missing).toBe(false);
  });
});
