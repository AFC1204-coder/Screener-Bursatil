import { describe, expect, it } from "vitest";

import { businessThemeKey, THEME_RULES } from "@/lib/businessTheme";

// Auditoría de filtros 2026-11, propuesta 4: sector/industria del proveedor
// mandan; la descripción solo decide cuando no hay taxonomía, y sin palabras
// ambiguas («properties», «data», «platform»…).

describe("businessThemeKey: taxonomía existente", () => {
  it("conserva las 12 claves anteriores y añade solo «Materiales / minería»", () => {
    expect(THEME_RULES.map((rule) => rule.key).sort()).toEqual([
      "Autos / movilidad",
      "Automatizacion",
      "Consumer tech / hardware",
      "Consumo / marca",
      "Defensa / aeroespacial",
      "Energia / red",
      "Finanzas",
      "Inmobiliario / REIT",
      "Internet / plataformas",
      "Materiales / minería",
      "Medtech / biotech",
      "Semis / fotonica",
      "Software / IA",
    ].sort());
  });

  it("mantiene las asignaciones que ya eran correctas", () => {
    expect(businessThemeKey("Technology", "Semiconductors", "")).toBe("Semis / fotonica");
    expect(businessThemeKey("Technology", "Software - Infrastructure", "")).toBe("Software / IA");
    expect(businessThemeKey("Real Estate", "REIT - Mortgage", "commercial real estate credit")).toBe("Inmobiliario / REIT");
    expect(businessThemeKey("Real Estate", "REIT - Healthcare Facilities", "")).toBe("Inmobiliario / REIT");
    expect(businessThemeKey("Healthcare", "Biotechnology", "")).toBe("Medtech / biotech");
    expect(businessThemeKey("Industrials", "Aerospace & Defense", "")).toBe("Defensa / aeroespacial");
    expect(businessThemeKey("Energy", "Oil & Gas E&P", "")).toBe("Energia / red");
    expect(businessThemeKey("Energy", "Uranium", "")).toBe("Energia / red");
    expect(businessThemeKey("Communication Services", "Telecom Services", "")).toBe("Internet / plataformas");
    expect(businessThemeKey("Consumer Cyclical", "Residential Construction", "")).toBe("Inmobiliario / REIT");
  });
});

describe("businessThemeKey: casos de la auditoría", () => {
  it("mineras de oro con «mineral properties» van a Materiales, no a REIT", () => {
    expect(businessThemeKey(
      "Basic Materials",
      "Gold",
      "Engages in the acquisition, exploration and development of mineral properties.",
    )).toBe("Materiales / minería");
    expect(businessThemeKey("Basic Materials", "Other Industrial Metals & Mining", "mineral resource properties")).toBe("Materiales / minería");
    expect(businessThemeKey("Basic Materials", "Silver", "")).toBe("Materiales / minería");
    expect(businessThemeKey("Basic Materials", "Copper", "")).toBe("Materiales / minería");
  });

  it("fertilizantes, química y acero van a Materiales aunque la descripción hable de data/platform", () => {
    expect(businessThemeKey(
      "Basic Materials",
      "Agricultural Inputs",
      "Provides crop inputs through a digital platform and data analytics for growers.",
    )).toBe("Materiales / minería");
    expect(businessThemeKey("Basic Materials", "Specialty Chemicals", "advanced materials for semiconductors")).toBe("Materiales / minería");
    expect(businessThemeKey("Basic Materials", "Steel", "electric vehicles market")).toBe("Materiales / minería");
    expect(businessThemeKey("Basic Materials", "Building Materials", "residential properties")).toBe("Materiales / minería");
  });

  it("seguros de daños («Property & Casualty») son Finanzas", () => {
    expect(businessThemeKey("Financial Services", "Insurance - Property & Casualty", "")).toBe("Finanzas");
    expect(businessThemeKey("Financial Services", "Insurance—Property & Casualty", "")).toBe("Finanzas");
  });

  it("normaliza las variantes de guion de Yahoo", () => {
    expect(businessThemeKey("Financial Services", "Banks—Regional", "")).toBe("Finanzas");
    expect(businessThemeKey("Technology", "Software—Application", "")).toBe("Software / IA");
  });

  it("transporte va a «Autos / movilidad» y los industriales a «Automatizacion»", () => {
    expect(businessThemeKey("Industrials", "Airlines", "aviation")).toBe("Autos / movilidad");
    expect(businessThemeKey("Industrials", "Marine Shipping", "")).toBe("Autos / movilidad");
    expect(businessThemeKey("Consumer Cyclical", "Auto Parts", "")).toBe("Autos / movilidad");
    expect(businessThemeKey("Industrials", "Building Products & Equipment", "residential properties")).toBe("Automatizacion");
    expect(businessThemeKey("Industrials", "Engineering & Construction", "data centers platform")).toBe("Automatizacion");
  });

  it("Communication Equipment: fotónica por descripción, si no hardware", () => {
    expect(businessThemeKey("Technology", "Communication Equipment", "optical networking transceivers and lasers")).toBe("Semis / fotonica");
    expect(businessThemeKey("Technology", "Communication Equipment", "wireless routers and IoT modules")).toBe("Consumer tech / hardware");
  });
});

describe("businessThemeKey: sin taxonomía del proveedor", () => {
  it("usa la descripción sin palabras ambiguas", () => {
    expect(businessThemeKey("Sin sector", "Sin industria", "Owns mineral properties in Nevada.")).toBe("Materiales / minería");
    expect(businessThemeKey("", "", "Operates hotels and leases residential properties.")).not.toBe("Inmobiliario / REIT");
    expect(businessThemeKey("", "", "Provides data and platform services to farmers.")).not.toBe("Software / IA");
  });

  it("gana la palabra que aparece antes en la descripción", () => {
    expect(businessThemeKey("", "", "Operates as a property and casualty insurance company with digital e-commerce channels.")).toBe("Finanzas");
  });

  it("acepta como descripción una clave de tema ya calculada", () => {
    expect(businessThemeKey("", "", "Semis / fotonica")).toBe("Semis / fotonica");
  });

  it("conserva el residual por sector o «General»", () => {
    expect(businessThemeKey("Other", "Holding", "Diversified holding company")).toBe("Other");
    expect(businessThemeKey("", "", "")).toBe("General");
  });
});
