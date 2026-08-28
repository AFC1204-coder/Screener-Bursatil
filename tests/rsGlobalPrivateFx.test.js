// tests/rsGlobalPrivateFx.test.js — invariantes del motor de RS global privado
// (MET-1b): conversión de divisa, política de fallo FX, orden de exclusiones y
// versionado del denominador.
//
// QUÉ PROTEGE CADA BLOQUE, y por qué no es redundante con los tests que ya hay:
//
//   - GBX: LSE cotiza en peniques. Sin la normalización, RR.L entra al ranking
//     con un precio ×100. El RS es un ratio, así que el factor se cancela
//     MIENTRAS la unidad no cambie — y ese "mientras" es exactamente la trampa:
//     el precio en USD que se persiste para auditoría sí queda inflado, y una
//     serie que cambie de unidad a mitad produce un rendimiento inventado.
//
//   - FX stale/unavailable: la regla dura del addendum §9 es que un dato
//     ausente NUNCA se sustituye por 0, por paridad ni por una media. Un test
//     que solo comprobara "devuelve algo" pasaría con paridad silenciosa.
//
//   - Orden de exclusiones: el spec fija barras → discontinuidad local → FX. Si
//     el orden se invierte, un símbolo con split sin ajustar Y sin FX reportaría
//     el motivo equivocado, y el motivo es lo que la UI enseña al usuario.

import { describe, expect, it } from "vitest";

import {
  convertToBase,
  currencyForMarket,
  fxDirectPairs,
  fxPairsFor,
  fxSeriesDiscontinuity,
  FX_BASE_CURRENCY,
  FX_CURRENCIES,
  FX_EXCLUSION_REASONS,
  FX_MAX_AGE_SESSIONS,
  MARKET_CURRENCY,
  normalizeCurrencyCode,
  normalizeCurrencyUnit,
  pickFxObservation,
} from "@/lib/rsFx";
import { computeSymbol } from "@/scripts/rs-global-private.mjs";
import { GLOBAL_RS_INTL_MARKETS, intlCountsByMarket, intlUniverseRows, universeFingerprint } from "@/lib/rsGlobalUniverse";

// Serie sintética descendente (bars[0] = más reciente), suficiente para las
// cuatro ventanas: 52 semanas × 5 sesiones + 1 = 261 barras.
function syntheticBars({ count = 300, start = 100, growthPerBar = 0.001, currencyUnitFactor = 1 } = {}) {
  const bars = [];
  for (let i = 0; i < count; i += 1) {
    const date = new Date(Date.UTC(2026, 0, 1) + (count - i) * 86400000).toISOString().slice(0, 10);
    bars.push({ date, close: start * (1 + growthPerBar) ** (count - i) * currencyUnitFactor });
  }
  // Orden desc por fecha, la convención del motor.
  return bars.sort((a, b) => (a.date < b.date ? 1 : -1));
}

function flatFxSeries(rate, { count = 400, endDate = "2027-01-01" } = {}) {
  const bars = [];
  const end = Date.parse(`${endDate}T00:00:00Z`);
  for (let i = 0; i < count; i += 1) {
    bars.push({ date: new Date(end - i * 86400000).toISOString().slice(0, 10), close: rate });
  }
  return bars;
}

describe("GBX → GBP (la trampa de LSE)", () => {
  it("divide entre 100 el precio en peniques y deja el código en GBP", () => {
    const result = normalizeCurrencyUnit(2500, "GBX");
    expect(result.price).toBe(25);
    expect(result.currency).toBe("GBP");
    expect(result.divisor).toBe(100);
  });

  it("NO divide un precio ya expresado en libras", () => {
    const result = normalizeCurrencyUnit(25, "GBP");
    expect(result.price).toBe(25);
    expect(result.divisor).toBe(1);
  });

  it("convertToBase aplica la normalización ANTES del tipo de cambio", () => {
    // 2500 peniques = 25 GBP; a 1,27 USD/GBP son 31,75 USD. Sin normalizar
    // serían 3.175 USD — el error que este test existe para atrapar.
    const converted = convertToBase(2500, "GBX", { rate: 1.27, inverse: false });
    expect(converted.ok).toBe(true);
    expect(converted.priceInBase).toBeCloseTo(31.75, 6);
    expect(converted.localPrice).toBe(25);
    expect(converted.normalizedCurrency).toBe("GBP");
    expect(converted.unitDivisor).toBe(100);
  });

  it("el universo declara GB en GBX, no en GBP — si esto cambia, la normalización deja de dispararse", () => {
    expect(MARKET_CURRENCY.GB).toBe("GBX");
    expect(currencyForMarket("GB")).toBe("GBX");
    // Y el par FX que se pide sigue siendo el de la libra: no existe GBXUSD=X.
    expect(normalizeCurrencyCode("GBX")).toBe("GBP");
    expect(fxPairsFor("GBX")).toEqual(["GBPUSD=X", "USDGBP=X"]);
  });
});

describe("convención FX del addendum §7", () => {
  it("§7.3 — divisa igual a la base da fx=1 por contrato, sin buscar par", () => {
    const converted = convertToBase(100, "USD", null);
    expect(converted.ok).toBe(true);
    expect(converted.fxRate).toBe(1);
    expect(converted.priceInBase).toBe(100);
    expect(fxPairsFor("USD")).toEqual([]);
  });

  it("§7.1 — el par directo se multiplica", () => {
    const converted = convertToBase(100, "HKD", { rate: 0.128, inverse: false });
    expect(converted.priceInBase).toBeCloseTo(12.8, 9);
  });

  it("§7.2 — el par inverso se normaliza a 1/rate antes de multiplicar", () => {
    // USDJPY=X a 150 significa 1 USD = 150 JPY, así que 3.000 JPY son 20 USD.
    const converted = convertToBase(3000, "JPY", { rate: 150, inverse: true });
    expect(converted.ok).toBe(true);
    expect(converted.priceInBase).toBeCloseTo(20, 9);
  });

  it("una divisa fuera del universo v1 se excluye, NUNCA se asume paridad", () => {
    const converted = convertToBase(100, "KRW", { rate: 0.00075, inverse: false });
    expect(converted.ok).toBe(false);
    expect(converted.exclusionReason).toBe(FX_EXCLUSION_REASONS.CURRENCY_UNKNOWN);
  });

  it("sin tasa aplicable no cae a 1: excluye con fx-unavailable", () => {
    const converted = convertToBase(100, "HKD", null);
    expect(converted.ok).toBe(false);
    expect(converted.exclusionReason).toBe(FX_EXCLUSION_REASONS.UNAVAILABLE);
    expect(converted.priceInBase).toBeUndefined();
  });

  it("v1 no ejercita cruces: las diez divisas tienen par contra USD", () => {
    expect(FX_CURRENCIES).toEqual(["AUD", "CAD", "CHF", "DKK", "EUR", "GBP", "HKD", "JPY", "NOK", "SEK"]);
    expect(fxDirectPairs()).toHaveLength(10);
    expect(fxDirectPairs().every((pair) => pair.endsWith(`${FX_BASE_CURRENCY}=X`))).toBe(true);
  });
});

describe("política de fallo FX (addendum §9, fxMaxAge cerrado en el spec)", () => {
  const asOf = "2026-08-14"; // viernes

  it("usa la observación del mismo día cuando existe (edad 0)", () => {
    const picked = pickFxObservation([{ date: asOf, close: 0.128 }], asOf);
    expect(picked.ok).toBe(true);
    expect(picked.rate).toBe(0.128);
    expect(picked.fxDate).toBe(asOf);
    expect(picked.ageSessions).toBe(0);
  });

  it("permite forward-fill dentro de fxMaxAge y registra la fecha REALMENTE usada", () => {
    // Última observación el lunes 10; el símbolo cierra el viernes 14. Son 4
    // sesiones de hueco, por debajo del límite de 5.
    const picked = pickFxObservation([{ date: "2026-08-10", close: 0.1275 }], asOf);
    expect(picked.ok).toBe(true);
    expect(picked.fxDate).toBe("2026-08-10");
    expect(picked.ageSessions).toBeLessThanOrEqual(FX_MAX_AGE_SESSIONS);
  });

  it("por encima de fxMaxAge excluye con fx-stale — no extrapola ni usa la media", () => {
    const picked = pickFxObservation([{ date: "2026-07-20", close: 0.1275 }], asOf);
    expect(picked.ok).toBe(false);
    expect(picked.exclusionReason).toBe(FX_EXCLUSION_REASONS.STALE);
    expect(picked.rate).toBeUndefined();
  });

  it("sin serie FX excluye con fx-unavailable", () => {
    const picked = pickFxObservation([], asOf);
    expect(picked.ok).toBe(false);
    expect(picked.exclusionReason).toBe(FX_EXCLUSION_REASONS.UNAVAILABLE);
  });

  it("anti-lookahead §8: ignora observaciones POSTERIORES a la fecha del símbolo", () => {
    const picked = pickFxObservation([
      { date: "2026-08-21", close: 0.9 }, // futura respecto al cierre: no debe usarse
      { date: "2026-08-13", close: 0.128 },
    ], asOf);
    expect(picked.ok).toBe(true);
    expect(picked.fxDate).toBe("2026-08-13");
    expect(picked.rate).toBe(0.128);
  });

  it("detecta discontinuidad en la serie FX, separada del split del subyacente", () => {
    const broken = [
      { date: "2026-08-14", close: 0.128 },
      { date: "2026-08-13", close: 0.032 }, // salto de 4x: dato corrupto, no split
      { date: "2026-08-12", close: 0.128 },
    ];
    const result = fxSeriesDiscontinuity(broken);
    expect(result.discontinuous).toBe(true);
    expect(result.factor).toBeGreaterThanOrEqual(3);
    expect(fxSeriesDiscontinuity(flatFxSeries(0.128)).discontinuous).toBe(false);
  });
});

describe("computeSymbol — orden de exclusiones y motivo persistible", () => {
  const fx = new Map([["HKD", { currency: "HKD", pair: "HKDUSD=X", inverse: false, bars: flatFxSeries(0.128), discontinuity: { discontinuous: false } }]]);

  it("US computa con fx=1 y sin consultar ninguna serie FX", () => {
    const result = computeSymbol({ symbol: "AAPL", market: "US", currency: "USD" }, syntheticBars(), new Map());
    expect(result.ok).toBe(true);
    expect(result.fxRate).toBe(1);
    expect(result.priceInBase).toBe(result.localClose);
    // Rendimientos positivos: la serie sintética crece.
    expect(result.returns["13w"]).toBeGreaterThan(0);
    expect(result.raw).toBeGreaterThan(0);
  });

  it("un símbolo de HK computa y su precio en USD es el local por la tasa", () => {
    const result = computeSymbol({ symbol: "0700.HK", market: "HK", currency: "HKD" }, syntheticBars(), fx);
    expect(result.ok).toBe(true);
    expect(result.fxRate).toBeCloseTo(0.128, 9);
    expect(result.priceInBase).toBeCloseTo(result.localClose * 0.128, 6);
  });

  it("con FX constante, el RS de HK iguala al del mismo perfil en US — la tasa plana no inventa rendimiento", () => {
    const bars = syntheticBars();
    const us = computeSymbol({ symbol: "AAPL", market: "US", currency: "USD" }, bars, new Map());
    const hk = computeSymbol({ symbol: "0700.HK", market: "HK", currency: "HKD" }, bars, fx);
    expect(hk.raw).toBeCloseTo(us.raw, 9);
  });

  it("con FX que se debilita, el mismo rendimiento local rankea PEOR — es la métrica que pide el spec", () => {
    const bars = syntheticBars();
    // La divisa local pierde valor con el tiempo: la tasa más reciente (bars[0])
    // es menor que la de hace 52 semanas.
    const weakening = flatFxSeries(0.128).map((bar, index) => ({ ...bar, close: 0.128 * (1 - 0.0005) ** (400 - index) }));
    const weakFx = new Map([["HKD", { currency: "HKD", pair: "HKDUSD=X", inverse: false, bars: weakening, discontinuity: { discontinuous: false } }]]);
    const us = computeSymbol({ symbol: "AAPL", market: "US", currency: "USD" }, bars, new Map());
    const hk = computeSymbol({ symbol: "0700.HK", market: "HK", currency: "HKD" }, bars, weakFx);
    expect(hk.ok).toBe(true);
    expect(hk.raw).toBeLessThan(us.raw);
  });

  it("(1) barras insuficientes gana sobre cualquier otro motivo", () => {
    const result = computeSymbol({ symbol: "NEW.HK", market: "HK", currency: "HKD" }, syntheticBars({ count: 100 }), new Map());
    expect(result.ok).toBe(false);
    expect(result.exclusionReason).toBe("insufficient-bars");
  });

  it("(2) discontinuidad LOCAL se reporta como split, no como fallo de FX", () => {
    const bars = syntheticBars();
    bars[10] = { ...bars[10], close: bars[10].close * 8 }; // split sin ajustar
    const result = computeSymbol({ symbol: "SPLIT.HK", market: "HK", currency: "HKD" }, bars, new Map());
    expect(result.ok).toBe(false);
    // Aunque NO hay serie FX para HKD en este mapa, el motivo debe ser el
    // split: el orden del spec pone la serie local antes que el FX.
    expect(result.exclusionReason).toBe("discontinuous");
  });

  it("(3) FX ausente excluye con fx-unavailable, con la serie local sana", () => {
    const result = computeSymbol({ symbol: "0700.HK", market: "HK", currency: "HKD" }, syntheticBars(), new Map());
    expect(result.ok).toBe(false);
    expect(result.exclusionReason).toBe("fx-unavailable");
  });

  it("FX viejo excluye con fx-stale, distinto de fx-unavailable", () => {
    // Serie FX que se detiene mucho antes que la serie de precios.
    const staleFx = new Map([["HKD", {
      currency: "HKD",
      pair: "HKDUSD=X",
      inverse: false,
      bars: flatFxSeries(0.128, { count: 400, endDate: "2025-01-01" }),
      discontinuity: { discontinuous: false },
    }]]);
    const result = computeSymbol({ symbol: "0700.HK", market: "HK", currency: "HKD" }, syntheticBars(), staleFx);
    expect(result.ok).toBe(false);
    expect(result.exclusionReason).toBe("fx-stale");
  });

  it("serie FX discontinua excluye con fx-discontinuous, NO con discontinuous", () => {
    const brokenFx = new Map([["HKD", {
      currency: "HKD",
      pair: "HKDUSD=X",
      inverse: false,
      bars: flatFxSeries(0.128),
      discontinuity: { discontinuous: true, factor: 4.2, date: "2026-08-13" },
    }]]);
    const result = computeSymbol({ symbol: "0700.HK", market: "HK", currency: "HKD" }, syntheticBars(), brokenFx);
    expect(result.ok).toBe(false);
    expect(result.exclusionReason).toBe("fx-discontinuous");
    expect(result.exclusionReason).not.toBe("discontinuous");
  });

  it("todo motivo de exclusión es un código estable, no una frase libre", () => {
    // La UI traduce el código; si el motor empezara a devolver prosa, la
    // traducción fallaría en silencio y volvería el "–" mudo.
    const codes = new Set([
      "insufficient-bars",
      "discontinuous",
      ...Object.values(FX_EXCLUSION_REASONS),
    ]);
    const cases = [
      computeSymbol({ symbol: "A", market: "HK", currency: "HKD" }, syntheticBars({ count: 10 }), new Map()),
      computeSymbol({ symbol: "B", market: "HK", currency: "HKD" }, syntheticBars(), new Map()),
    ];
    for (const result of cases) {
      expect(result.ok).toBe(false);
      expect(codes.has(result.exclusionReason)).toBe(true);
    }
  });
});

describe("universo privado y versionado del denominador", () => {
  it("es determinista: dos construcciones dan la misma huella", () => {
    const a = universeFingerprint(intlUniverseRows().map((row) => row.symbol));
    const b = universeFingerprint(intlUniverseRows().map((row) => row.symbol));
    expect(a.hash).toBe(b.hash);
    expect(a.count).toBe(b.count);
  });

  it("la huella depende del CONJUNTO, no del orden", () => {
    const symbols = intlUniverseRows().map((row) => row.symbol);
    const shuffled = [...symbols].reverse();
    expect(universeFingerprint(symbols).hash).toBe(universeFingerprint(shuffled).hash);
  });

  it("la huella CAMBIA si entra o sale un símbolo — es lo que la hace útil", () => {
    const symbols = intlUniverseRows().map((row) => row.symbol);
    expect(universeFingerprint([...symbols, "9999.XX"]).hash).not.toBe(universeFingerprint(symbols).hash);
  });

  it("cubre los mercados del spec y ninguno fuera de v1", () => {
    expect(GLOBAL_RS_INTL_MARKETS).toContain("HK");
    expect(GLOBAL_RS_INTL_MARKETS).toContain("CA");
    expect(GLOBAL_RS_INTL_MARKETS).toContain("JP");
    expect(GLOBAL_RS_INTL_MARKETS).toContain("AU");
    // Fuera de v1 por decisión del spec (pregunta 2): entrar después exige
    // engine_version nuevo, no editar esta lista en silencio.
    for (const outside of ["KR", "IN", "IL", "CN", "BR", "MX", "SG", "ZA", "TW"]) {
      expect(GLOBAL_RS_INTL_MARKETS).not.toContain(outside);
    }
  });

  it("todo símbolo del universo intl tiene divisa conocida y con par FX", () => {
    for (const row of intlUniverseRows()) {
      expect(row.currency, `${row.symbol} (${row.market}) sin divisa`).toBeTruthy();
      const code = normalizeCurrencyCode(row.currency);
      expect(FX_CURRENCIES.includes(code), `${row.symbol}: ${code} sin par FX en v1`).toBe(true);
    }
  });

  it("el tamaño del universo intl está en el orden declarado por el spec (~830)", () => {
    const rows = intlUniverseRows();
    expect(rows.length).toBeGreaterThan(700);
    expect(rows.length).toBeLessThan(1000);
    const counts = intlCountsByMarket(rows);
    expect(counts.HK).toBeGreaterThan(50);
    expect(counts.CA).toBeGreaterThan(150);
  });

  it("no hay símbolos duplicados entre mercados", () => {
    const symbols = intlUniverseRows().map((row) => row.symbol);
    expect(new Set(symbols).size).toBe(symbols.length);
  });
});
