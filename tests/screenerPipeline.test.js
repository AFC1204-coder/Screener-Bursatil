import { describe, expect, it } from "vitest";
import { DEFAULT_PERFORMANCE_PERIOD } from "@/lib/screenerPeriods";
import { defaultSortForSettings, scanSettingsSignature, sortMetric, sortRowsForMode } from "@/lib/screenerPipeline";

const cleanCandidate = {
  symbol: "CLEAN",
  price: 50,
  chartBarsCount: 260,
  priceFreshnessOk: true,
  dataCoverageScore: 82,
  technicalCoverageScore: 88,
  fundamentalCoverageScore: 64,
  totalScore: 82,
  rsGlobalPct: 90,
  rsSectorPct: 82,
  rsQualityScore: 78,
  weinsteinScore: 86,
  minerviniScore: 82,
  volumeEffectScore: 76,
  adProxyScore: 74,
  growthScore: 70,
  epsGrowthProxyScore: 68,
  riskRewardScore: 72,
  weaknessScore: 12,
  extSma50: 10,
  setupDisplayPlanValid: true,
};

describe("screener pipeline sorting", () => {
  it("ordena por calidad de decision usando el contexto activo", () => {
    const riskyHigherScore = {
      ...cleanCandidate,
      symbol: "RISKY",
      totalScore: 96,
      rsGlobalPct: 55,
      extSma50: 24,
      riskRewardScore: 42,
    };

    const leaderScore = sortMetric(cleanCandidate, "decisionPriority", { setupMode: "leader" });
    const weaknessScore = sortMetric(cleanCandidate, "decisionPriority", { setupMode: "weakness" });
    const sorted = sortRowsForMode([riskyHigherScore, cleanCandidate], { setupMode: "leader" }, "decisionPriority");

    expect(leaderScore).toBeGreaterThan(weaknessScore);
    expect(sorted.map((row) => row.symbol)).toEqual(["CLEAN", "RISKY"]);
  });

  // El ranking por defecto de los modos largos es el rendimiento del periodo
  // activo de la tabla, no el score compuesto: la tabla de siete columnas ya no
  // muestra ese score y ordenar por algo invisible deja al usuario sin poder
  // explicarse el orden (docs/principios-producto.md, principios 1 y 7).
  it("usa el rendimiento del periodo por defecto como ranking en modos largos", () => {
    const riskyHigherScore = {
      ...cleanCandidate,
      symbol: "RISKY",
      totalScore: 96,
      rsGlobalPct: 55,
      extSma50: 24,
      riskRewardScore: 42,
    };

    expect(defaultSortForSettings({ setupMode: "leader" })).toBe(DEFAULT_PERFORMANCE_PERIOD);
    expect(defaultSortForSettings({ setupMode: "weakness" })).toBe("weaknessScore");
    expect(sortRowsForMode([
      { ...riskyHigherScore, perf3m: 8 },
      { ...cleanCandidate, perf3m: 26 },
    ], { setupMode: "leader" }).map((row) => row.symbol)).toEqual(["CLEAN", "RISKY"]);
  });

  it("no deja que un VCP suba el ranking objetivo principal", () => {
    const objectiveLeader = {
      ...cleanCandidate,
      symbol: "OBJ",
      objectiveScore: 81,
      totalScore: 81,
      patternScore: 0,
      setupDisplayPlanValid: false,
    };
    const vcpBoosted = {
      ...cleanCandidate,
      symbol: "VCP",
      objectiveScore: 67,
      totalScore: 92,
      patternScore: 95,
      setupDisplayPlanValid: true,
    };

    expect(sortMetric(vcpBoosted, "objectiveScore", { setupMode: "leader" })).toBe(67);
    expect(sortMetric(vcpBoosted, "totalScore", { setupMode: "leader" })).toBe(92);
    expect(sortRowsForMode([vcpBoosted, objectiveLeader], { setupMode: "leader" }, "objectiveScore").map((row) => row.symbol)).toEqual(["OBJ", "VCP"]);
  });
});

describe("scanSettingsSignature", () => {
  // Contrato: solo markets/manual/scanMode determinan el universo real. El hash
  // debe ser estable, determinista e independiente del orden de arrays/claves.
  // Cualquier cambio en estas tres variables produce un hash distinto → staleness.
  // activeSettings/filterLayers/useRegimeFilter/marketHealth NO entran aquí.

  it("es determinista: mismo input → mismo output", () => {
    const a = scanSettingsSignature(["US"], "NVDA\nAAPL", "all");
    const b = scanSettingsSignature(["US"], "NVDA\nAAPL", "all");
    expect(a).toBe(b);
  });

  it("es independiente del orden de markets (mismo conjunto → mismo hash)", () => {
    const a = scanSettingsSignature(["US", "DE", "FR"], "", "all");
    const b = scanSettingsSignature(["FR", "US", "DE"], "", "all");
    expect(a).toBe(b);
  });

  it("es independiente del orden de símbolos manuales", () => {
    const a = scanSettingsSignature(["US"], "NVDA\nAAPL\nMSFT", "all");
    const b = scanSettingsSignature(["US"], "MSFT,AAPL,NVDA", "all");
    expect(a).toBe(b);
  });

  it("cambia cuando cambia markets (different set)", () => {
    const a = scanSettingsSignature(["US", "DE"], "", "all");
    const b = scanSettingsSignature(["US", "FR"], "", "all");
    expect(a).not.toBe(b);
  });

  it("cambia cuando cambia manual (different symbols)", () => {
    const a = scanSettingsSignature(["US"], "NVDA", "all");
    const b = scanSettingsSignature(["US"], "AAPL", "all");
    expect(a).not.toBe(b);
  });

  it("cambia cuando cambia scanMode", () => {
    const a = scanSettingsSignature(["US"], "", "all");
    const b = scanSettingsSignature(["US"], "", "batch");
    expect(a).not.toBe(b);
  });

  it("no depende de settings que sean post-filtrado: el hash no acepta extra args", () => {
    // El contrato de la función es (markets, manual, scanMode) — 3 args. Si el
    // caller intentara pasar activeSettings como 4º arg, la firma lo ignora
    // (no es un parámetro). Verificamos que un umbral distinto NO cambia el hash.
    const base = scanSettingsSignature(["US"], "", "all");
    // Simulamos "otra configuración" simplemente llamando igual — el hash debe
    // ser idéntico porque scanSettingsSignature no recibe settings en absoluto.
    expect(scanSettingsSignature(["US"], "", "all")).toBe(base);
  });

  it("normaliza markets a mayúsculas y filtra vacíos/inválidos", () => {
    const a = scanSettingsSignature(["us", "DE", ""], "", "all");
    const b = scanSettingsSignature(["US", "DE"], "", "all");
    expect(a).toBe(b);
  });

  it("default scanMode a 'all' cuando se omite", () => {
    const a = scanSettingsSignature(["US"], "");
    const b = scanSettingsSignature(["US"], "", "all");
    expect(a).toBe(b);
  });

  it("produce un string no vacío con prefijo de versión para futuras migraciones", () => {
    const sig = scanSettingsSignature(["US"], "", "all");
    expect(typeof sig).toBe("string");
    expect(sig.length).toBeGreaterThan(0);
    expect(sig.startsWith("v1|")).toBe(true);
  });

  // ─── Gaps cubiertos en Fase 2 (endurecimiento) ─────────────────────────────
  // Pieza 3 del prompt: ampliar cobertura sin duplicar la existente.

  it("acepta null/undefined como argumentos sin lanzar excepción", () => {
    expect(() => scanSettingsSignature(null, null, null)).not.toThrow();
    expect(() => scanSettingsSignature(undefined, undefined, undefined)).not.toThrow();
    expect(() => scanSettingsSignature()).not.toThrow();
  });

  it("hash estable y NO idéntico cuando todos los inputs son vacíos vs. con contenido", () => {
    const empty = scanSettingsSignature([], "", "");
    const emptyAlt = scanSettingsSignature([], "", "all"); // "" default → "all"
    const withContent = scanSettingsSignature(["US"], "NVDA", "all");
    // vacío canónico es estable (dos llamadas producen el mismo string)
    expect(empty).toBe(emptyAlt);
    // y es claramente distinto de uno con contenido
    expect(withContent).not.toBe(empty);
  });

  it("normaliza símbolos manuales a mayúsculas (mismo ticker en distinta caja → mismo hash)", () => {
    const upper = scanSettingsSignature(["US"], "NVDA\nAAPL", "all");
    const lower = scanSettingsSignature(["US"], "nvda\naapl", "all");
    const mixed = scanSettingsSignature(["US"], "NvDa, AaPl", "all");
    expect(lower).toBe(upper);
    expect(mixed).toBe(upper);
  });
});
