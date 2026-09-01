import { afterEach, describe, expect, it } from "vitest";
import {
  ALL_FILTER_LAYERS,
  CORE_LAYER_KEYS,
  DEFAULT_FIELD_RULES,
  DEFAULT_FILTER_LAYERS,
  EXECUTION_LAYERS,
  FILTER_FAMILIES,
  FILTER_FAMILY_PRESETS,
  FILTER_FIELDS,
  FILTER_FIELD_LAYERS,
  FILTER_FAMILY_ORDER,
  NEUTRAL_FIELD_VALUES,
  OPTIONAL_LAYER_KEYS,
  PRESET_LAYER_OVERRIDES,
  SETTING_LAYER_DEPENDENCIES,
  SCREENER_WEB_FILTER_PRESETS,
  filterLayersForPreset,
  settingsForPreset,
  setupModeLayerRequirements,
} from "@/lib/screenerFilterCatalog";
import {
  FILTER_LAYERS_CONTRACT_VERSION,
  effectiveSettingsFromLayers,
  layerToggleImpact,
  buildFilterLayersUpgradeNotice,
  filterLayersContractWasUpgraded,
  filterLayersUpgradeNoticeIfNeeded,
  resolveSnapshotNotice,
  restoreFilterLayers,
} from "@/lib/screenerFilterLayers";
import { applyScreenerFilters, screenerFiltersFromParams } from "@/lib/screenerFilters";
import { PRIVATE_GLOBAL_RS_DISCLOSURE } from "@/lib/rsEngines";

const PRESET_KEYS = Object.keys(SCREENER_WEB_FILTER_PRESETS);

// Reglas de familias opcionales que el cron aplica en el preset crudo pero la
// pantalla neutraliza con capas off (UX-FILTERS-8).
const REGLAS_CAPAS_OPCIONALES = [
  "minRelativeVolume",
  "minVolumeSurgePct",
  "minUpDownVolRatio",
  "minRiskRewardScore",
  "minReturnToVol3m",
  "minReturnToDrawdown3m",
  "minContractionCount",
  "maxAbsDistanceToPivotPct",
  "vcpMinContractionCount",
  "vcpMaxLastContractionDepthPct",
  "minShortFloatPct",
  "maxShortFloatPct",
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

describe("auditoría campo → familia única (UX-FILTERS-8)", () => {
  it("cada setting key de familia pertenece a una sola capa", () => {
    const seen = new Map();
    for (const key of FILTER_FAMILY_ORDER) {
      const family = FILTER_FAMILIES[key];
      for (const settingKey of family.settingKeys || []) {
        expect(seen.has(settingKey), `${settingKey} duplicado en ${seen.get(settingKey)} y ${key}`).toBe(false);
        seen.set(settingKey, key);
      }
    }
    for (const [settingKey, dependency] of Object.entries(SETTING_LAYER_DEPENDENCIES)) {
      expect(dependency.layer, settingKey).toBe(seen.get(settingKey));
    }
  });

  it("cada field de FILTER_FIELDS tiene exactamente una familia en FILTER_FIELD_LAYERS", () => {
    const assignments = new Map();
    for (const [fieldKey, layers] of Object.entries(FILTER_FIELD_LAYERS)) {
      expect(layers, fieldKey).toHaveLength(1);
      const family = layers[0];
      expect(assignments.has(fieldKey), `${fieldKey} ya asignado a ${assignments.get(fieldKey)}`).toBe(false);
      assignments.set(fieldKey, family);
      expect(FILTER_FAMILIES[family].fields.some((field) => field.key === fieldKey)).toBe(true);
    }
    expect(assignments.size).toBe(FILTER_FIELDS.length);
  });
});

describe("taxonomía única de familias (UX-FILTERS-2)", () => {
  it("cada field pertenece a exactamente una capa", () => {
    for (const [key, layers] of Object.entries(FILTER_FIELD_LAYERS)) {
      expect(layers, `${key} debe tener una sola capa`).toHaveLength(1);
    }
  });

  it("toda key de FILTER_FIELDS aparece en exactamente una familia", () => {
    const fieldKeys = new Set(FILTER_FIELDS.map((field) => field.key));
    const familyFieldKeys = FILTER_FAMILY_ORDER.flatMap((key) => FILTER_FAMILIES[key].fields.map((field) => field.key));
    expect(new Set(familyFieldKeys).size).toBe(familyFieldKeys.length);
    expect([...fieldKeys].sort()).toEqual([...new Set(familyFieldKeys)].sort());
  });

  it("EXECUTION_LAYERS keys coinciden con DEFAULT_FILTER_LAYERS y familias", () => {
    const executionKeys = EXECUTION_LAYERS.map((layer) => layer.key).sort();
    expect(executionKeys).toEqual(Object.keys(DEFAULT_FILTER_LAYERS).sort());
    expect(executionKeys).toEqual([...FILTER_FAMILY_ORDER].sort());
  });

  it("con proximity off y score on, minRiskScore sigue aplicando (P5)", () => {
    const layers = { ...DEFAULT_FILTER_LAYERS, proximity: false, score: true };
    const settings = { ...settingsForPreset("balanced"), minRiskScore: 40 };
    const effective = effectiveSettingsFromLayers(settings, layers, DEFAULT_FIELD_RULES);
    expect(effective.minRiskScore).toBe(40);
    const resultado = applyScreenerFilters([filaLider({ riskScore: 10 })], {
      enabled: true,
      preset: "balanced",
      values: effective,
    });
    expect(resultado.rows).toHaveLength(0);
    expect(resultado.rejections.some((item) => item.field === "minRiskScore")).toBe(true);
  });

  it("ajustes finos no exponen grupos huérfanos Ratings proxy / Deterioro / Scores técnicos", () => {
    const titles = FILTER_FAMILY_ORDER.map((key) => FILTER_FAMILIES[key].title);
    expect(titles).not.toContain("Ratings proxy");
    expect(titles).not.toContain("Deterioro técnico");
    expect(titles).not.toContain("Scores técnicos");
  });
});

describe("Volumen+ no escribe minAdProxyScore", () => {
  it("la acción Acumulacion no cruza a la familia Scores", () => {
    const action = FILTER_FAMILIES.volumeSurge.actions.find((item) => item.label === "Acumulacion");
    expect(action.settings).not.toHaveProperty("minAdProxyScore");
    const offAction = FILTER_FAMILIES.volumeSurge.actions.find((item) => item.label === "Sin volumen+");
    expect(offAction.settings).not.toHaveProperty("minAdProxyScore");
  });
});

describe("copy familia RS (MET-1b)", () => {
  it("sidebar y modal alinean RS global; bench/país/grupo quedan como auxiliares", () => {
    const layer = EXECUTION_LAYERS.find((item) => item.key === "relativeStrength");
    const family = FILTER_FAMILY_PRESETS.relativeStrength;
    expect(layer.detail).toContain(PRIVATE_GLOBAL_RS_DISCLOSURE);
    expect(layer.detail).toMatch(/auxiliar/i);
    expect(layer.detail).not.toContain("universo, benchmark, país y grupo");
    expect(family.intro).toMatch(/ranking semanal global/i);
    expect(family.intro).toMatch(/auxiliar/i);
    expect(family.intro).not.toContain("Ranking contra universo, benchmark, país y grupo");
  });
});

describe("defaults conservadores (UX-FILTERS-8)", () => {
  it("núcleo on y familias opcionales off en frío", () => {
    for (const key of CORE_LAYER_KEYS) {
      expect(DEFAULT_FILTER_LAYERS[key], `${key} debe estar on`).toBe(true);
    }
    for (const key of OPTIONAL_LAYER_KEYS) {
      expect(DEFAULT_FILTER_LAYERS[key], `${key} debe estar off`).toBe(false);
    }
    expect(Object.keys(DEFAULT_FILTER_LAYERS).sort()).toEqual(EXECUTION_LAYERS.map((layer) => layer.key).sort());
  });

  it("ALL_FILTER_LAYERS sigue siendo el alias de todas encendidas (auditoría)", () => {
    expect(ALL_FILTER_LAYERS).toEqual(Object.fromEntries(FILTER_FAMILY_ORDER.map((key) => [key, true])));
    expect(ALL_FILTER_LAYERS).not.toEqual(DEFAULT_FILTER_LAYERS);
  });

  it("balanced / nearPivot / leader no activan pattern sin acción explícita", () => {
    for (const presetKey of ["balanced", "nearPivot"]) {
      expect(filterLayersForPreset(presetKey).pattern, presetKey).toBe(false);
    }
    const leaderLayers = filterLayersForPreset("balanced");
    expect(leaderLayers.pattern).toBe(false);
    expect(settingsForPreset("balanced").setupMode).toBe("leader");
  });

  it("sólo presets IPO encienden la capa ipo por override", () => {
    expect(PRESET_LAYER_OVERRIDES).toEqual({ ipo: { ipo: true }, ipoDiscovery: { ipo: true } });
    expect(filterLayersForPreset("ipo").ipo).toBe(true);
    expect(filterLayersForPreset("ipoDiscovery").ipo).toBe(true);
    expect(filterLayersForPreset("balanced").ipo).toBe(false);
  });

  it("ningún preset hunt E2 enciende pattern", () => {
    for (const presetKey of ["balanced", "nearPivot", "strict", "early"]) {
      expect(filterLayersForPreset(presetKey).pattern, presetKey).toBe(false);
    }
  });

  it("setupModeLayerRequirements sólo pide capas encendidas, nunca las apaga", () => {
    for (const mode of ["leader", "nearPivot", "pullback", "early", "ipoRecent", "extended", "weakness", "any"]) {
      const pedidas = Object.values(setupModeLayerRequirements(mode));
      expect(pedidas.every((value) => value === true), `el modo ${mode} apaga alguna capa`).toBe(true);
    }
    expect(setupModeLayerRequirements("weakness")).toEqual({ score: true });
  });
});

describe("pantalla con capas vs cron con preset crudo (UX-FILTERS-8)", () => {
  const CORE_PRESET_KEYS = PRESET_KEYS.filter((key) => !["ipo", "ipoDiscovery"].includes(key));

  it.each(CORE_PRESET_KEYS)("núcleo activo coincide en el preset %s", (presetKey) => {
    const cron = ajustesDelCron(presetKey);
    const pantalla = ajustesDeLaPantalla(presetKey);
    const coreFields = FILTER_FAMILY_ORDER
      .filter((key) => CORE_LAYER_KEYS.includes(key))
      .flatMap((key) => FILTER_FAMILIES[key].fields.map((field) => field.key));
    const distintos = coreFields.filter((key) => cron[key] !== pantalla[key]);
    expect(distintos).toEqual([]);
  });

  it("en frío, la pantalla neutraliza reglas de familias opcionales apagadas", () => {
    const pantalla = ajustesDeLaPantalla("balanced");
    const cron = ajustesDelCron("balanced");
    for (const regla of REGLAS_CAPAS_OPCIONALES) {
      expect(pantalla[regla], `${regla} no debería cortar en pantalla fría`).toBe(NEUTRAL_FIELD_VALUES[regla] ?? pantalla[regla]);
      if (cron[regla] !== pantalla[regla]) {
        expect(cron[regla], `${regla} sigue activa en el cron`).not.toBe(NEUTRAL_FIELD_VALUES[regla]);
      }
    }
  });

  it("con todas las capas on, la pantalla vuelve a coincidir con el cron", () => {
    const cron = ajustesDelCron("balanced");
    const pantalla = effectiveSettingsFromLayers(
      settingsForPreset("balanced"),
      ALL_FILTER_LAYERS,
      DEFAULT_FIELD_RULES,
    );
    const distintos = [...new Set([...Object.keys(cron), ...Object.keys(pantalla)])]
      .filter((key) => key !== "maxSymbols")
      .filter((key) => cron[key] !== pantalla[key]);
    expect(distintos).toEqual([]);
  });

  it("las reglas opcionales del preset balanced cortan en el cron pero no en pantalla fría", () => {
    const pantalla = ajustesDeLaPantalla("balanced");
    const rechazadasPantalla = applyScreenerFilters(POBLACION, {
      enabled: true,
      preset: "balanced",
      values: pantalla,
    }).rejections.map((item) => item.field);
    const rechazadasCron = applyScreenerFilters(POBLACION, screenerFiltersFromParams({ filterPreset: "balanced" }))
      .rejections.map((item) => item.field);
    for (const regla of ["minRelativeVolume", "minVolumeSurgePct", "minUpDownVolRatio", "minRiskRewardScore", "minReturnToVol3m", "minReturnToDrawdown3m"]) {
      expect(rechazadasCron, `${regla} no rechazó en cron`).toContain(regla);
      expect(rechazadasPantalla, `${regla} no debería rechazar en pantalla fría`).not.toContain(regla);
    }
  });
});

describe("restoreFilterLayers · configuración guardada en el navegador", () => {
  const guardadoAntiguo = { pattern: false, volumeSurge: false, shortInterest: false, riskReward: false, trend: true };
  const guardadoV2TodasOn = Object.fromEntries(FILTER_FAMILY_ORDER.map((key) => [key, true]));

  it("descarta capas guardadas antes de la v3 del contrato", () => {
    expect(restoreFilterLayers(guardadoAntiguo, undefined, "balanced")).toEqual(filterLayersForPreset("balanced"));
    expect(restoreFilterLayers(guardadoAntiguo, 1, "balanced")).toEqual(filterLayersForPreset("balanced"));
    expect(restoreFilterLayers(guardadoV2TodasOn, 2, "balanced")).toEqual(filterLayersForPreset("balanced"));
    expect(restoreFilterLayers(guardadoAntiguo, null, "weakness")).toEqual(filterLayersForPreset("weakness"));
  });

  it("respeta las capas guardadas a partir de la v3", () => {
    expect(restoreFilterLayers({ pattern: true }, FILTER_LAYERS_CONTRACT_VERSION, "balanced"))
      .toEqual({ ...filterLayersForPreset("balanced"), pattern: true });
    expect(restoreFilterLayers({ volumeSurge: true, riskReward: true }, FILTER_LAYERS_CONTRACT_VERSION, "strict"))
      .toEqual({ ...filterLayersForPreset("strict"), volumeSurge: true, riskReward: true });
  });

  it("no reencende capas obsoletas ni arrastra keys fuera del catálogo", () => {
    const restored = restoreFilterLayers(
      { vcp: true, pattern: true, removedFamily: false },
      FILTER_LAYERS_CONTRACT_VERSION,
      "balanced",
    );
    expect(restored).toEqual({ ...filterLayersForPreset("balanced"), vcp: true, pattern: true });
    expect(restored).not.toHaveProperty("removedFamily");
  });

  it("cae al estado de fábrica sin capas guardadas o con un valor corrupto", () => {
    expect(restoreFilterLayers(null, FILTER_LAYERS_CONTRACT_VERSION, "balanced")).toEqual(filterLayersForPreset("balanced"));
    expect(restoreFilterLayers("nada", FILTER_LAYERS_CONTRACT_VERSION, "balanced")).toEqual(filterLayersForPreset("balanced"));
    expect(restoreFilterLayers({ pattern: true }, "no-es-un-numero", "balanced")).toEqual(filterLayersForPreset("balanced"));
  });

  it("una sesión v2 ya no reintroduce todas las capas opcionales encendidas", () => {
    const capas = restoreFilterLayers(guardadoV2TodasOn, 2, "balanced");
    expect(capas.pattern).toBe(false);
    expect(capas.volumeSurge).toBe(false);
    for (const regla of ["minRelativeVolume", "minRiskRewardScore"]) {
      const pantalla = effectiveSettingsFromLayers(settingsForPreset("balanced"), capas, DEFAULT_FIELD_RULES);
      expect(pantalla[regla]).toBe(NEUTRAL_FIELD_VALUES[regla]);
    }
  });
});

describe("aviso one-shot al migrar filterLayersVersion < 3 (C-03)", () => {
  afterEach(() => {
    sessionStorage.clear();
  });

  it("detecta contratos v1/v2 como actualizados", () => {
    expect(filterLayersContractWasUpgraded(1)).toBe(true);
    expect(filterLayersContractWasUpgraded(2)).toBe(true);
    expect(filterLayersContractWasUpgraded(undefined)).toBe(true);
    expect(filterLayersContractWasUpgraded(FILTER_LAYERS_CONTRACT_VERSION)).toBe(false);
  });

  it("filterLayersUpgradeNoticeIfNeeded solo avisa una vez por pestaña", () => {
    expect(filterLayersUpgradeNoticeIfNeeded(2)?.source).toBe("filter-layers-upgrade");
    expect(filterLayersUpgradeNoticeIfNeeded(2)).toBeNull();
  });

  it("resolveSnapshotNotice prioriza auth sobre aviso de capas", () => {
    const auth = { requiresReauth: true, label: "Sesión caducada", detail: "x", source: "auth-required" };
    expect(resolveSnapshotNotice({ primary: auth, filterLayersVersion: 1 })).toBe(auth);
    expect(resolveSnapshotNotice({ primary: null, filterLayersVersion: 1 })?.label).toBe(
      buildFilterLayersUpgradeNotice().label,
    );
  });
});

describe("layerToggleImpact · aviso al apagar capas", () => {
  it("preset Deterioro + apagar Scores avisa que el modo pasa a Exploratorio", () => {
    const settings = settingsForPreset("weakness");
    const filterLayers = filterLayersForPreset("weakness");
    const impact = layerToggleImpact({
      settings,
      filterLayers,
      fieldRules: DEFAULT_FIELD_RULES,
      layerKey: "score",
      nextOn: false,
    });
    expect(impact.willChangeSetupMode).toBe(true);
    expect(impact.fromMode).toBe("weakness");
    expect(impact.toMode).toBe("any");
    expect(impact.warnings[0]).toContain("Apagar Scores quita el modo Deterioro técnico");
    expect(impact.warnings[0]).toContain("Exploratorio");
  });

  it("apagar Tendencia con modo Líder avisa degradación a Exploratorio", () => {
    const settings = { ...settingsForPreset("balanced"), setupMode: "leader" };
    const impact = layerToggleImpact({
      settings,
      filterLayers: DEFAULT_FILTER_LAYERS,
      fieldRules: DEFAULT_FIELD_RULES,
      layerKey: "trend",
      nextOn: false,
    });
    expect(impact.willChangeSetupMode).toBe(true);
    expect(impact.fromMode).toBe("leader");
    expect(impact.toMode).toBe("any");
    expect(impact.warnings[0]).toContain("Apagar Tendencia quita el modo Líder etapa 2");
  });

  it("encender una capa no genera avisos", () => {
    const impact = layerToggleImpact({
      settings: settingsForPreset("balanced"),
      filterLayers: { ...DEFAULT_FILTER_LAYERS, trend: false },
      fieldRules: DEFAULT_FIELD_RULES,
      layerKey: "trend",
      nextOn: true,
    });
    expect(impact.warnings).toEqual([]);
    expect(impact.willChangeSetupMode).toBe(false);
  });

  it("apagar Cercanía con minRiskScore activo ya no genera aviso de doble capa", () => {
    const impact = layerToggleImpact({
      settings: settingsForPreset("balanced"),
      filterLayers: DEFAULT_FILTER_LAYERS,
      fieldRules: DEFAULT_FIELD_RULES,
      layerKey: "proximity",
      nextOn: false,
    });
    expect(impact.warnings.some((line) => line.includes("Risk score min"))).toBe(false);
  });

  it("si la capa ya estaba apagada no recalcula avisos", () => {
    const impact = layerToggleImpact({
      settings: settingsForPreset("weakness"),
      filterLayers: { ...DEFAULT_FILTER_LAYERS, score: false },
      fieldRules: DEFAULT_FIELD_RULES,
      layerKey: "score",
      nextOn: false,
    });
    expect(impact.warnings).toEqual([]);
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
