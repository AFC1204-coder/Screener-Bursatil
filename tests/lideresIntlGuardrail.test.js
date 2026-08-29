import { describe, expect, it } from "vitest";
import {
  LIDERES_INTL_CTA,
  batchIsMajorityUs,
  batchUsShare,
  buildLideresIntlGuardrailNotice,
  isLideresIntlDataMisaligned,
  scannedDataIncludesIntl,
  selectionIncludesIntlMarkets,
} from "@/lib/lideresIntlGuardrail";

function usRows(count) {
  return Array.from({ length: count }, (_, index) => ({
    symbol: `SYM${index}`,
    country: "US",
  }));
}

function mixedRows(usCount, hkCount) {
  return [
    ...usRows(usCount),
    ...Array.from({ length: hkCount }, (_, index) => ({
      symbol: `${700 + index}.HK`,
      country: "HK",
    })),
  ];
}

describe("lideresIntlGuardrail detection", () => {
  it("H-07: solo US cargado + ficha Líderes intl → desalineado", () => {
    const rows = usRows(3321);
    expect(isLideresIntlDataMisaligned({
      presetKey: "intl",
      markets: ["US", "HK", "CA"],
      scannedMarkets: ["US"],
      analyzedRows: rows,
    })).toBe(true);
  });

  it("CA cargado + mercados CA + Líderes intl → alineado", () => {
    const rows = [{ symbol: "RY.TO", country: "CA" }];
    expect(isLideresIntlDataMisaligned({
      presetKey: "intl",
      markets: ["CA"],
      scannedMarkets: ["CA"],
      analyzedRows: rows,
    })).toBe(false);
  });

  it("solo US seleccionado + preset intl → desalineado", () => {
    expect(isLideresIntlDataMisaligned({
      presetKey: "intl",
      markets: ["US"],
      scannedMarkets: ["US"],
      analyzedRows: usRows(100),
    })).toBe(true);
  });

  it("lote mayoritariamente US con intl en selección → desalineado", () => {
    const rows = mixedRows(3000, 40);
    expect(batchIsMajorityUs(rows)).toBe(true);
    expect(isLideresIntlDataMisaligned({
      presetKey: "intl",
      markets: ["US", "HK"],
      scannedMarkets: ["US", "HK"],
      analyzedRows: rows,
    })).toBe(true);
  });

  it("Líderes Etapa 2 con solo US no dispara guardrail", () => {
    expect(isLideresIntlDataMisaligned({
      presetKey: "balanced",
      markets: ["US"],
      scannedMarkets: ["US"],
      analyzedRows: usRows(3321),
    })).toBe(false);
  });

  it("helpers de cobertura intl", () => {
    expect(selectionIncludesIntlMarkets(["US", "CA"])).toBe(true);
    expect(selectionIncludesIntlMarkets(["US"])).toBe(false);
    expect(scannedDataIncludesIntl(["US"], usRows(10))).toBe(false);
    expect(scannedDataIncludesIntl(["HK"], [])).toBe(true);
    expect(batchUsShare(mixedRows(60, 40))).toBe(0.6);
  });
});

describe("buildLideresIntlGuardrailNotice", () => {
  it("expone copy y CTAs sugeridos en H-07", () => {
    const notice = buildLideresIntlGuardrailNotice({
      presetKey: "intl",
      markets: ["US", "HK"],
      scannedMarkets: ["US"],
      analyzedRows: usRows(3321),
    });
    expect(notice?.label).toBe("Líderes intl");
    expect(notice?.detail).toContain("Datos cargados: US (3321)");
    expect(notice?.detail).toContain("🇺🇸");
    expect(notice?.ctas.map((cta) => cta.id)).toEqual([
      LIDERES_INTL_CTA.LOAD_CORE_INTL,
      LIDERES_INTL_CTA.REMOVE_US,
      LIDERES_INTL_CTA.SWITCH_ETAPA_2,
    ]);
    expect(notice?.ctas[0]?.primary).toBe(true);
  });

  it("devuelve null cuando no hay desalineación", () => {
    expect(buildLideresIntlGuardrailNotice({
      presetKey: "intl",
      markets: ["CA"],
      scannedMarkets: ["CA"],
      analyzedRows: [{ symbol: "RY.TO", country: "CA" }],
    })).toBeNull();
  });

  it("solo US seleccionado ofrece Core intl y Líderes E2 sin Quitar US duplicado innecesario", () => {
    const notice = buildLideresIntlGuardrailNotice({
      presetKey: "intl",
      markets: ["US"],
      scannedMarkets: ["US"],
      analyzedRows: usRows(50),
    });
    expect(notice?.ctas.some((cta) => cta.id === LIDERES_INTL_CTA.REMOVE_US)).toBe(true);
    expect(notice?.ctas.some((cta) => cta.id === LIDERES_INTL_CTA.SWITCH_ETAPA_2)).toBe(true);
  });
});
