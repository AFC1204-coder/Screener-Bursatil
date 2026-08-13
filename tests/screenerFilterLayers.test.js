import { describe, expect, it } from "vitest";
import {
  ALL_FILTER_LAYERS,
  DEFAULT_FIELD_RULES,
  DEFAULT_FILTER_LAYERS,
  EXECUTION_LAYERS,
  PRESET_LAYER_OVERRIDES,
  SCREENER_WEB_FILTER_PRESETS,
  filterLayersForPreset,
  settingsForPreset,
  setupModeLayerRequirements,
} from "@/lib/screenerFilterCatalog";
import {
  FILTER_LAYERS_CONTRACT_VERSION,
  effectiveSettingsFromLayers,
  restoreFilterLayers,
} from "@/lib/screenerFilterLayers";
import { applyScreenerFilters, screenerFiltersFromParams } from "@/lib/screenerFilters";

const PRESET_KEYS = Object.keys(SCREENER_WEB_FILTER_PRESETS);

// Las seis reglas que antes de este cambio sólo actuaban en el escaneo
// nocturno: el cron aplica el preset crudo y la pantalla lo pasaba por las
// capas, con volumeSurge y riskReward apagadas de fábrica.
// Ver docs/auditoria-filtros-2026-08-13.md, sección D.5.
const REGLAS_SOLO_NOCTURNAS = [
  "minRelativeVolume",
  "minVolumeSurgePct",
  "minUpDownVolRatio",
  "minRiskRewardScore",
  "minReturnToVol3m",
  "minReturnToDrawdown3m",
];

// Fila base que pasa el preset balanced con holgura. Cada caso de prueba la
// degrada en un solo campo para aislar la regla que se quiere ejercitar.
function filaLider(overrides = {}) {
  return {
    symbol: "LIDER",
    price: 120,
    marketCap: 8_000_000_000,
    avgVolume: 900_000,
    avgTurnover: 90_000_000,
    latestVolume: 900_000,
    latestTurnover: 90_000_000,
    relativeVolume: 1.4,
    volumeSurgePct: 40,
    upDownVolRatio: 1.5,
    volumeEffectScore: 70,
    perf3m: 30,
    perf6m: 50,
    perf12m: 70,
    distance20d: -1,
    distance50d: -1,
    distance52w: -1,
    distanceATH: -1,
    highsSpreadPct: 2,
    extSma50: 10,
    maxDailyMove20dPct: 6,
    maxDailyRange20dPct: 6,
    range63dPct: 40,
    volatility63d: 35,
    maxDrawdown63d: 8,
    riskRewardScore: 90,
    returnToVol3m: 0.9,
    returnToDrawdown3m: 4,
    dataCoverageScore: 95,
    technicalCoverageScore: 95,
    priceFreshnessDays: 1,
    weinsteinScore: 100,
    minerviniScore: 100,
    momentumScore: 90,
    riskScore: 80,
    volumeScore: 75,
    liquidityScore: 90,
    objectiveScore: 85,
    totalScore: 85,
    weaknessScore: 0,
    sma50: 105,
    sma150: 90,
    sma200: 80,
    sma200Slope: 6,
    weeklyStageState: "stage2",
    weeklyStageLabel: "Stage 2 probable",
    upVolume: true,
    ...overrides,
  };
}

// Una fila por regla que sólo actuaba de noche, degradada justo por debajo del
// umbral de balanced. Con el cambio, la pantalla las rechaza igual que el cron.
const POBLACION = [
  filaLider(),
  filaLider({ symbol: "VOLREL_BAJO", relativeVolume: 0.4 }),
  filaLider({ symbol: "SURGE_BAJO", volumeSurgePct: -20 }),
  filaLider({ symbol: "UPDOWN_BAJO", upDownVolRatio: 0.5 }),
  filaLider({ symbol: "RR_BAJO", riskRewardScore: 10 }),
  filaLider({ symbol: "RETVOL_BAJO", returnToVol3m: -0.5 }),
  filaLider({ symbol: "RETDD_BAJO", returnToDrawdown3m: -1 }),
  filaLider({ symbol: "SIN_STAGE2", weeklyStageState: "stage1", weeklyStageLabel: "Stage 1", price: 70, sma50: 75 }),
  filaLider({ symbol: "PERF_FLOJA", perf3m: -5, perf6m: -8, perf12m: -12 }),
];

// Cómo aplica el preset el escaneo nocturno: crudo, sin capas
// (scripts/scan-universe.mjs:289 -> screenerFiltersFromParams({ filterPreset })).
function ajustesDelCron(presetKey) {
  return screenerFiltersFromParams({ filterPreset: presetKey }).values;
}

// Cómo lo aplica la pantalla: preset + capas + reglas finas
// (app/page.jsx -> effectiveSettingsFromLayers(settings, filterLayers, fieldRules)).
function ajustesDeLaPantalla(presetKey) {
  return effectiveSettingsFromLayers(
    settingsForPreset(presetKey),
    filterLayersForPreset(presetKey),
    DEFAULT_FIELD_RULES,
  );
}

describe("ninguna capa viene apagada de fábrica", () => {
  it("DEFAULT_FILTER_LAYERS tiene las trece capas de ejecución encendidas", () => {
    const apagadas = Object.entries(DEFAULT_FILTER_LAYERS).filter(([, on]) => on !== true).map(([key]) => key);
    expect(apagadas).toEqual([]);
    expect(Object.keys(DEFAULT_FILTER_LAYERS).sort()).toEqual(EXECUTION_LAYERS.map((layer) => layer.key).sort());
  });

  it("ningún preset apaga capas por su cuenta", () => {
    expect(PRESET_LAYER_OVERRIDES).toEqual({});
    for (const presetKey of PRESET_KEYS) {
      const apagadas = Object.entries(filterLayersForPreset(presetKey)).filter(([, on]) => on !== true).map(([key]) => key);
      expect(apagadas, `el preset ${presetKey} apaga capas`).toEqual([]);
    }
  });

  it("ALL_FILTER_LAYERS coincide con el estado de fábrica", () => {
    expect(ALL_FILTER_LAYERS).toEqual(DEFAULT_FILTER_LAYERS);
  });

  it("setupModeLayerRequirements sólo pide capas encendidas, nunca las apaga", () => {
    for (const mode of ["leader", "nearPivot", "pullback", "early", "ipoRecent", "extended", "weakness", "any"]) {
      const pedidas = Object.values(setupModeLayerRequirements(mode));
      expect(pedidas.every((value) => value === true), `el modo ${mode} apaga alguna capa`).toBe(true);
    }
    // El modo weakness necesita la capa `score`: sin ella
    // effectiveSettingsFromLayers degrada el modo a "any".
    expect(setupModeLayerRequirements("weakness")).toEqual({ score: true });
  });
});

describe("la pantalla y el escaneo nocturno aplican el mismo preset", () => {
  it.each(PRESET_KEYS)("los ajustes efectivos coinciden en el preset %s", (presetKey) => {
    const cron = ajustesDelCron(presetKey);
    const pantalla = ajustesDeLaPantalla(presetKey);
    const distintos = [...new Set([...Object.keys(cron), ...Object.keys(pantalla)])]
      // maxSymbols es el tope de símbolos del escaneo, no una regla de filtro:
      // stripInternalPresetFields lo quita de la vista web del preset y no está
      // en SCREENER_FILTER_QUERY_KEYS, FIELD_RULES ni DISTANCE_RULES.
      .filter((key) => key !== "maxSymbols")
      .filter((key) => cron[key] !== pantalla[key]);
    expect(distintos).toEqual([]);
  });

  it.each(PRESET_KEYS)("el conjunto de filas que pasa es el mismo en el preset %s", (presetKey) => {
    const porElCron = applyScreenerFilters(POBLACION, screenerFiltersFromParams({ filterPreset: presetKey }));
    const porLaPantalla = applyScreenerFilters(POBLACION, {
      enabled: true,
      preset: presetKey,
      values: ajustesDeLaPantalla(presetKey),
    });
    expect(porLaPantalla.rows.map((row) => row.symbol)).toEqual(porElCron.rows.map((row) => row.symbol));
    expect(porLaPantalla.rejections.map((item) => `${item.symbol}:${item.field}`))
      .toEqual(porElCron.rejections.map((item) => `${item.symbol}:${item.field}`));
  });

  it("las seis reglas que sólo actuaban de noche ahora también cortan en la pantalla", () => {
    const pantalla = ajustesDeLaPantalla("balanced");
    const cron = ajustesDelCron("balanced");
    for (const regla of REGLAS_SOLO_NOCTURNAS) {
      expect(pantalla[regla], `${regla} sigue neutralizado en la pantalla`).toBe(cron[regla]);
    }
    const rechazadas = applyScreenerFilters(POBLACION, {
      enabled: true,
      preset: "balanced",
      values: pantalla,
    }).rejections.map((item) => item.field);
    for (const regla of REGLAS_SOLO_NOCTURNAS) {
      expect(rechazadas, `${regla} no rechazó ninguna fila en la pantalla`).toContain(regla);
    }
  });
});

describe("restoreFilterLayers · configuración guardada en el navegador", () => {
  const guardadoAntiguo = { pattern: false, volumeSurge: false, shortInterest: false, riskReward: false, trend: true };

  it("descarta las capas guardadas antes de la v2 del contrato", () => {
    expect(restoreFilterLayers(guardadoAntiguo, undefined, "balanced")).toEqual(DEFAULT_FILTER_LAYERS);
    expect(restoreFilterLayers(guardadoAntiguo, 1, "balanced")).toEqual(DEFAULT_FILTER_LAYERS);
    expect(restoreFilterLayers(guardadoAntiguo, null, "weakness")).toEqual(DEFAULT_FILTER_LAYERS);
  });

  it("respeta las capas guardadas a partir de la v2", () => {
    expect(restoreFilterLayers({ pattern: false }, FILTER_LAYERS_CONTRACT_VERSION, "balanced"))
      .toEqual({ ...DEFAULT_FILTER_LAYERS, pattern: false });
    expect(restoreFilterLayers({ volumeSurge: false, riskReward: false }, FILTER_LAYERS_CONTRACT_VERSION, "strict"))
      .toEqual({ ...DEFAULT_FILTER_LAYERS, volumeSurge: false, riskReward: false });
  });

  it("cae al estado de fábrica sin capas guardadas o con un valor corrupto", () => {
    expect(restoreFilterLayers(null, FILTER_LAYERS_CONTRACT_VERSION, "balanced")).toEqual(DEFAULT_FILTER_LAYERS);
    expect(restoreFilterLayers("nada", FILTER_LAYERS_CONTRACT_VERSION, "balanced")).toEqual(DEFAULT_FILTER_LAYERS);
    expect(restoreFilterLayers({ pattern: false }, "no-es-un-numero", "balanced")).toEqual(DEFAULT_FILTER_LAYERS);
  });

  it("una sesión antigua ya no puede reintroducir la divergencia con el cron", () => {
    const capas = restoreFilterLayers(guardadoAntiguo, 1, "balanced");
    const pantalla = effectiveSettingsFromLayers(settingsForPreset("balanced"), capas, DEFAULT_FIELD_RULES);
    for (const regla of REGLAS_SOLO_NOCTURNAS) {
      expect(pantalla[regla]).toBe(ajustesDelCron("balanced")[regla]);
    }
  });
});

describe("coherencia entre preset y modo de setup por parámetros", () => {
  it("un preset con nombre más el modo weakness ya no filtra sólo deteriorados", () => {
    const filtros = screenerFiltersFromParams({ filterPreset: "balanced", setupMode: "weakness" });
    // El modo pedido manda, pero arrastra los ajustes de su propio preset:
    // minWeaknessScore deja de ser el 50 que "Balanceado" hereda de
    // QUALITY_DEFAULTS y pasa a ser el 55 declarado del modo deterioro.
    expect(filtros.values.setupMode).toBe("weakness");
    expect(filtros.values.minWeaknessScore).toBe(SCREENER_WEB_FILTER_PRESETS.weakness.minWeaknessScore);
    expect(filtros.values.minPerf3m).toBe(SCREENER_WEB_FILTER_PRESETS.weakness.minPerf3m);
    expect(filtros.values.maxDistance52w).toBe(SCREENER_WEB_FILTER_PRESETS.weakness.maxDistance52w);
  });

  it("un valor sano deja de colarse como si el preset Balanceado buscara deterioro", () => {
    const filaSana = filaLider({ symbol: "SANA", weaknessScore: 0 });
    const filaDeteriorada = filaLider({ symbol: "ROTA", weaknessScore: 90 });
    const filtros = screenerFiltersFromParams({ filterPreset: "balanced", setupMode: "weakness" });
    const pasan = applyScreenerFilters([filaSana, filaDeteriorada], filtros).rows.map((row) => row.symbol);
    // Sigue siendo un screener de deterioro (lo pedido), pero con los umbrales
    // del modo deterioro, no con los de "Balanceado".
    expect(pasan).toEqual(["ROTA"]);
  });

  it("un parámetro explícito sigue mandando sobre el ajuste del modo", () => {
    const filtros = screenerFiltersFromParams({ filterPreset: "balanced", setupMode: "weakness", minWeaknessScore: 70 });
    expect(filtros.values.minWeaknessScore).toBe(70);
    expect(filtros.explicit).toContain("minWeaknessScore");
  });

  it("sin preset con nombre no se toca nada: los llamantes que componen params a mano siguen igual", () => {
    const filtros = screenerFiltersFromParams({ setupMode: "weakness", minWeaknessScore: 45 });
    expect(filtros.values).toEqual({ setupMode: "weakness", minWeaknessScore: 45 });
  });

  it("pedir el modo propio del preset no cambia sus umbrales", () => {
    const conModo = screenerFiltersFromParams({ filterPreset: "balanced", setupMode: "leader" });
    const sinModo = screenerFiltersFromParams({ filterPreset: "balanced" });
    expect(conModo.values).toEqual(sinModo.values);
  });
});
