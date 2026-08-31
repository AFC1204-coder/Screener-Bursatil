// Contrato de la proyección ligera (lib/scanLightProjection.js).
//
// El escaneo nocturno guarda ahora la población que NO pasa el preset con una
// proyección reducida. Si alguien añade un control de filtro, una columna a la
// tabla o un criterio de orden a las Listas y NO añade su campo a la lista, la
// consecuencia sería un filtro que deja de morder, o una celda vacía, de noche
// y en silencio. Es el mismo modo de fallo que ya sufrió `minRsRating`
// (docs/auditoria-filtros-2026-08-13.md, E.2 punto 2), que lleva meses sin
// evaluarse porque compara un campo que la fila no trae.
//
// Este archivo lo convierte en un test rojo. Recorre las fuentes reales —el
// catálogo de reglas, las columnas y los contratos de lista— y comprueba que
// cada campo consultado esté en la proyección.

import { describe, expect, it } from "vitest";

import {
  AUDITED_TABLE_METRICS,
  SCAN_LIGHT_EXCLUDED_FIELDS,
  SCAN_LIGHT_FIELDS,
  metricAuditFlags,
  scanLightMetrics,
  screenOutcome,
} from "@/lib/scanLightProjection";
import { compactChartPreview } from "@/lib/researchRowContract";
import { COMPOSITE_WEIGHTS } from "@/lib/scoringEngine";
import { DISTANCE_RULES, FIELD_RULES } from "@/lib/screenerFilterCatalog";
import { PERFORMANCE_PERIODS } from "@/lib/screenerPeriods";

const FIELDS = new Set(SCAN_LIGHT_FIELDS);

// Campos que el motor compara con código propio, fuera de FIELD_RULES. Se
// listan a mano porque no hay tabla que recorrer: la única forma de que esta
// lista se quede corta es que alguien añada OTRA regla con código propio, y
// entonces el test de abajo sobre el recuento de controles lo detecta.
const HANDCODED_RULE_FIELDS = [
  "priceFreshnessDays", "lastDate",       // maxPriceFreshnessDays
  "weeklyRsAvailable", "weeklyRsRating",  // minRsRating
  "weeklyCountryRsAvailable", "weeklyCountryRsRating", // minRsCountryPct
  "weeklyThemeRsAvailable", "weeklyThemeRsRating", // minThemeRsRating
  "weaknessScore",                        // minWeaknessScore
  "ipoAgeMonths", "ipoDate",              // maxIpoAgeMonths / requireRecentIpo
  "weeksAboveSma30w", "weeksAboveSma30wAbove", // minWeeksAboveSma30w
];

// Campos que leen los seis interruptores de sí/no y las tres puertas
// implícitas (lib/screenerFilters.js: stage2RejectDetail, dailyLongBiasIssue,
// patternValidityGate, setupModeGate).
const GATE_INPUT_FIELDS = [
  "weeklyStageState", "weeklyStageLabel", "weeklyFastWeeks", "weeklySlowWeeks",
  "sma50", "sma150", "sma200", "sma200Slope", "upVolume", "contractionsDecreasing",
  "patternDataStatus", "patternEligible", "patternVolumeEligible",
  "contractionStructureStatus", "methodologyReliabilityState",
  "setupDisplayDataLimited", "setupDisplayBlocksPatternClaim", "methodologyBlocksPatternClaim",
  "totalScore", "rsGlobalPct", "ipoScore", "distanceToPivotPct", "pivotPrice",
];

// Campos de orden de las nueve secciones de Listas (app/lists/page.jsx) y los
// que consulta rowPassesListContract (lib/listRationale.js).
const LIST_FIELDS = [
  "objectiveScore", "rsQualityScore", "weaknessScore", "weinsteinScore",
  "minerviniScore", "ipoScore", "totalScore",
  "rsGlobalPct", "perf3m", "distance52w", "extSma50", "price", "sma50",
  "sector", "industry", "priceFreshnessOk", "priceFreshnessIssue",
];

// Las 17 métricas que la ficha del valor lee de scan_results
// (readUniverseRsSnapshot, app/api/company-brief/route.js). Importan porque,
// con el universo guardado, la fila más reciente de un símbolo puede ser una
// fila ligera: si le falta una, la ficha pierde el dato sin decirlo.
const STOCK_PAGE_FIELDS = [
  "rsGlobalPct", "rsRating", "rsCountryPct", "rsSectorPct",
  "rsGlobalSample", "rsCountrySample", "rsSectorSample",
  "totalScore", "weinsteinScore", "minerviniScore", "riskScore",
  "riskRewardScore", "liquidityScore", "maxDailyMove20dPct",
  "range63dPct", "highsSpreadPct", "extSma50",
];

describe("la proyección ligera cubre todo lo que se consulta", () => {
  it("cubre los campos de FIELD_RULES", () => {
    const missing = Object.entries(FIELD_RULES)
      .filter(([, rule]) => !FIELDS.has(rule.metric))
      .map(([key, rule]) => `${key} → ${rule.metric}`);
    expect(missing).toEqual([]);
  });

  it("cubre los campos de DISTANCE_RULES", () => {
    const missing = Object.entries(DISTANCE_RULES)
      .filter(([, rule]) => !FIELDS.has(rule.metric))
      .map(([key, rule]) => `${key} → ${rule.metric}`);
    expect(missing).toEqual([]);
  });

  it("cubre las reglas con código propio", () => {
    expect(HANDCODED_RULE_FIELDS.filter((field) => !FIELDS.has(field))).toEqual([]);
  });

  it("cubre los interruptores y las tres puertas implícitas", () => {
    expect(GATE_INPUT_FIELDS.filter((field) => !FIELDS.has(field))).toEqual([]);
  });

  it("cubre los periodos de la columna de rendimiento", () => {
    expect(PERFORMANCE_PERIODS.map((item) => item.key).filter((key) => !FIELDS.has(key))).toEqual([]);
  });

  it("cubre la identidad y la miniatura de la tabla de ocho columnas", () => {
    // Ticker, tema, RS, RS país, etapa, distancia a 52s y capitalización. El RS lo resuelve
    // canonicalRs sobre los weeklyRs*, que se hidratan al leer.
    const tableFields = [
      "symbol", "companyName", "country", "chartPreview", "theme",
      "weeklyStageState", "weeklyStageLabel", "distance52w", "marketCap",
      "weeklyRsAvailable", "weeklyRsRating", "weeklyRsAsOf", "weeklyRsWeekKey",
      "weeklyRsRank", "weeklyRsSampleSize", "weeklyRsEngineVersion", "weeklyRsReason",
      "weeklyCountryRsAvailable", "weeklyCountryRsRating", "weeklyCountryRsRank",
      "weeklyCountryRsSampleSize", "weeklyCountryRsWeekKey", "weeklyCountryRsReason",
    ];
    expect(tableFields.filter((field) => !FIELDS.has(field))).toEqual([]);
  });

  it("cubre el orden y el contrato de las Listas", () => {
    expect(LIST_FIELDS.filter((field) => !FIELDS.has(field))).toEqual([]);
  });

  it("cubre las 17 métricas que la ficha del valor lee de scan_results", () => {
    expect(STOCK_PAGE_FIELDS.filter((field) => !FIELDS.has(field))).toEqual([]);
  });

  // Los once términos de COMPOSITE_WEIGHTS. Este bloque existe porque el modo
  // de fallo YA OCURRIÓ: setupQualityScore, demandScore y growthScore se
  // calculaban, puntuaban y se tiraban al guardar, así que el 99,1% de las
  // filas del nocturno llevaba un score imposible de reconstruir con lo que la
  // fila enseña, y el desglose de la ficha imputaba +0,0 a componentes que sí
  // habían pesado (docs/analisis-compuesto-2026-08-15.md, B.3).
  //
  // Dos términos no son campos de fila sino cadenas de fallback resueltas en
  // el llamador (lib/materializedScanner.js, lib/screenerPipeline.js); para
  // ellos basta con que la proyección lleve algún eslabón de la cadena.
  const COMPOSITE_TERM_FIELDS = {
    rsAnchor: ["rsGlobalPct", "rsRating"],
    epsAnchor: ["epsGrowthProxyScore", "growthScore"],
  };

  it("cubre los once términos del composite", () => {
    const sinCubrir = COMPOSITE_WEIGHTS
      .map(({ key }) => ({ key, fields: COMPOSITE_TERM_FIELDS[key] || [key] }))
      .filter(({ fields }) => !fields.some((field) => FIELDS.has(field)))
      .map(({ key, fields }) => `${key} → ${fields.join(" | ")}`);
    expect(sinCubrir).toEqual([]);
  });

  it("no persiste un término que el composite ya no usa", () => {
    // ipoScore salió del composite el 2026-08-15 pero SIGUE en la proyección:
    // lo consultan el contrato y el orden de la Lista "IPO / New Leaders"
    // (lib/listRationale.js:177,394). Es una permanencia deliberada, no un
    // resto: si algún día esa Lista deja de leerlo, el campo sale de aquí.
    expect(FIELDS.has("ipoScore")).toBe(true);
    expect(COMPOSITE_WEIGHTS.map((w) => w.key)).not.toContain("ipoScore");
  });
});

describe("la proyección ligera excluye lo que nadie consulta", () => {
  it("no lleva objectiveMetricAudit, decisionTrace ni growthMetrics", () => {
    // Los tres concentran 27,7 KB de los 46,5 KB de la fila completa
    // (docs/adr-universo-precalculado.md, B.5). Volver a meterlos aquí
    // devolvería el problema que este cambio resuelve.
    expect(SCAN_LIGHT_EXCLUDED_FIELDS.filter((field) => FIELDS.has(field))).toEqual([]);
  });

  it("scanLightMetrics no copia ninguno de los tres, aunque la fila los traiga", () => {
    const row = {
      symbol: "AAA", price: 10, objectiveScore: 60,
      objectiveMetricAudit: { items: [{ key: "perf3m", status: "verified" }] },
      decisionTrace: { pasos: ["uno", "dos"] },
      growthMetrics: { perf3m: 1 },
    };
    const metrics = scanLightMetrics(row);
    for (const field of SCAN_LIGHT_EXCLUDED_FIELDS) expect(metrics[field]).toBeUndefined();
    expect(metrics.price).toBe(10);
    expect(metrics.objectiveScore).toBe(60);
  });

  it("no hay claves duplicadas en la lista", () => {
    expect(SCAN_LIGHT_FIELDS.length).toBe(new Set(SCAN_LIGHT_FIELDS).size);
  });
});

describe("la miniatura tiene la MISMA forma que en la fila completa", () => {
  // La fila completa pasa chartPreview por compactChartPreview dentro de
  // scanDecisionRaw. Si la ligera lo copiara en crudo, el mismo campo tendría
  // dos formas en la misma tabla: medido en la corrida de 300 símbolos del
  // 2026-08-14, close salía 159.5399932861328 en la ligera y 26.8169 en la
  // completa, y la ligera no traía las claves sma50/sma200.
  const crudo = Array.from({ length: 96 }, (_, i) => ({
    date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
    open: 1, high: 2, low: 0.5,
    close: 159.5399932861328 + i,
    volume: 2799600 + i,
  }));

  it("recorta a 48 puntos, redondea y escribe siempre las claves de medias", () => {
    const { chartPreview } = scanLightMetrics({ symbol: "AAA", chartPreview: crudo });
    expect(chartPreview).toHaveLength(48);
    const bar = chartPreview[0];
    expect(Object.keys(bar).sort()).toEqual(["close", "date", "sma50", "sma200", "volume"].sort());
    expect(bar.close).toBe(Number(bar.close.toFixed(4)));
    // open/high/low no los lee ninguna MiniSparkline del repo.
    expect("open" in bar).toBe(false);
  });

  it("coincide punto por punto con la proyección de la fila completa", () => {
    const { chartPreview } = scanLightMetrics({ symbol: "AAA", chartPreview: crudo });
    expect(chartPreview).toEqual(compactChartPreview(crudo));
  });
});

describe("un dato ausente sigue ausente", () => {
  it("scanLightMetrics no materializa las ausencias como null", () => {
    // Principio 3 de docs/principios-producto.md. Es además la diferencia de
    // peso frente a scanResultPayload, que hace `?? null` campo a campo.
    const metrics = scanLightMetrics({ symbol: "AAA", price: 10, marketCap: null });
    expect("marketCap" in metrics).toBe(false);
    expect("rsGlobalPct" in metrics).toBe(false);
    expect(metrics.price).toBe(10);
  });
});

describe("el resumen de auditoría objetiva", () => {
  it("marca solo las métricas de la tabla con estado no fiable", () => {
    const flags = metricAuditFlags({
      objectiveMetricAudit: {
        items: [
          { key: "perf3m", status: "mismatch" },
          { key: "perf6m", status: "verified" },
          { key: "distance52w", status: "missing-source" },
          { key: "riskScore", status: "mismatch" },
        ],
      },
    });
    expect(flags).toEqual({ perf3m: "mismatch", distance52w: "missing-source" });
  });

  it("devuelve null cuando todo es fiable, para no escribir un objeto vacío", () => {
    expect(metricAuditFlags({ objectiveMetricAudit: { items: AUDITED_TABLE_METRICS.map((key) => ({ key, status: "verified" })) } })).toBe(null);
    expect(metricAuditFlags({})).toBe(null);
  });
});

describe("la marca de cribado", () => {
  it("distingue las que pasan de las que no, y en qué forma están guardadas", () => {
    expect(screenOutcome(true)).toEqual({ screenPassed: true, rowProjection: "full" });
    expect(screenOutcome(false, { field: "minPerf6m", reason: "perf 6M 3.20 < 8" })).toEqual({
      screenPassed: false,
      rowProjection: "light",
      screenRejectField: "minPerf6m",
      screenRejectReason: "perf 6M 3.20 < 8",
    });
  });

  it("una fila sin motivo de rechazo registrado deja el motivo ausente, no inventado", () => {
    expect(screenOutcome(false)).toEqual({
      screenPassed: false,
      rowProjection: "light",
      screenRejectField: null,
      screenRejectReason: null,
    });
  });

  it("scanLightMetrics siempre marca la fila como no pasada", () => {
    const metrics = scanLightMetrics({ symbol: "AAA" }, { rejection: { field: "requireStage2", reason: "No cumple Stage 2" } });
    expect(metrics.screenPassed).toBe(false);
    expect(metrics.rowProjection).toBe("light");
    expect(metrics.screenRejectField).toBe("requireStage2");
  });
});
