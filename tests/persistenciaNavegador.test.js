// Persistencia local del navegador (lib/localState.js + lib/screenerPipeline.js).
//
// Medido el 2026-08-15: localStorage acumulaba 51 MB — la sesión del screener
// guardaba las mismas 500 filas que el snapshot local (18,8 MB duplicados) más
// las 282 visibles sin compactar (11,4 MB), con cada fila inflada a ~39,5 KB
// por objectiveMetricAudit (16 KB) y decisionTrace (6 KB). Y safeWrite se
// tragaba el error de cuota: la cola de revisión no se escribía y el raíl de
// navegación de la ficha desaparecía sin mensaje.
//
// Este archivo fija el contrato de la corrección:
//   1. La fila persistida NO lleva los campos pesados recalculables.
//   2. Los snapshots locales respetan su presupuesto.
//   3. Un fallo de escritura NOTIFICA (nada de silencio).
//   4. La cola de revisión degrada (sin miniaturas) antes que perderse.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  budgetFor,
  freeUpLocalScans,
  isQuotaError,
  lastStorageWriteFailure,
  payloadChars,
  reportStorageOutcome,
  safeWrite,
  STORAGE_BUDGETS,
  STORAGE_KEYS,
  storageFootprint,
  subscribeStorageWriteFailures,
} from "@/lib/localState";
import { filterAnalyzedRows, fitScansForBrowser, persistReviewQueue, persistRowForBrowser, persistRowsForBrowser } from "@/lib/screenerPipeline";
import { SCAN_LIGHT_EXCLUDED_FIELDS } from "@/lib/scanLightProjection";
import { qualityGateForResearchRow } from "@/lib/qualityGate";
import { settingsForPreset } from "@/lib/screenerFilterCatalog";

function quotaError() {
  const error = new Error("QuotaExceededError: quota reached");
  error.name = "QuotaExceededError";
  return error;
}

// localStorage de mentira con cuota configurable, para entorno node.
function installFakeStorage({ maxChars = Infinity } = {}) {
  const store = new Map();
  const fake = {
    get length() { return store.size; },
    key(index) { return [...store.keys()][index] ?? null; },
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, value) {
      const text = String(value);
      const others = [...store.entries()].filter(([k]) => k !== key)
        .reduce((sum, [, v]) => sum + v.length, 0);
      if (others + text.length > maxChars) throw quotaError();
      store.set(key, text);
    },
    removeItem(key) { store.delete(key); },
    clear() { store.clear(); },
  };
  globalThis.window = globalThis;
  globalThis.localStorage = fake;
  return fake;
}

function bigRow(symbol = "TEST") {
  return {
    symbol,
    companyName: `${symbol} Corp`,
    theme: "Consumer tech",
    sector: "Technology",
    industry: "Hardware",
    country: "US",
    exchange: "NASDAQ",
    currency: "USD",
    price: 100.5,
    rsRating: 92,
    totalScore: 71,
    marketCap: 2_000_000_000,
    perf3m: 12.5,
    perf6m: 30.1,
    perf12m: 80.4,
    distance52w: -3.2,
    weeklyRsRank: 92,
    chartPreview: Array.from({ length: 96 }, (_, i) => ({
      date: `2026-0${(i % 8) + 1}-15`, open: 99 + i, high: 101 + i, low: 98 + i,
      close: 100.123456789 + i, sma50: 95.5555 + i, sma200: 90.4444 + i, volume: 1_000_000 + i,
    })),
    objectiveMetricAudit: {
      status: "ok",
      items: [
        { key: "perf3m", status: "verified", detail: "x".repeat(4000) },
        { key: "distance52w", status: "mismatch", detail: "y".repeat(4000) },
      ],
    },
    decisionTrace: { version: 9, action: { key: "a" }, blob: "z".repeat(6000) },
    growthMetrics: { revenueGrowth: 0.31, nested: { statements: ["big".repeat(1500)] } },
  };
}

afterEach(() => {
  delete globalThis.localStorage;
  if (globalThis.window === globalThis) delete globalThis.window;
});

describe("persistRowForBrowser", () => {
  it("descarta los campos pesados recalculables y conserva lo que la tabla y los filtros consultan", () => {
    const row = bigRow();
    const persisted = persistRowForBrowser(row);
    for (const field of SCAN_LIGHT_EXCLUDED_FIELDS) {
      expect(persisted[field], field).toBeUndefined();
    }
    // Lo que la tabla de siete columnas y los filtros consultan sigue ahí.
    for (const field of ["symbol", "companyName", "theme", "country", "price", "rsRating", "totalScore", "marketCap", "perf3m", "perf6m", "perf12m", "distance52w"]) {
      expect(persisted[field], field).toBe(row[field]);
    }
    // La auditoría no viaja entera: viaja su resumen de ~100 B.
    expect(persisted.metricAuditFlags).toEqual({ distance52w: "mismatch" });
    // La miniatura queda en la forma compacta del contrato (48 puntos ligeros).
    expect(persisted.chartPreview.length).toBeLessThanOrEqual(48);
    expect(persisted.chartPreview[0].open).toBeUndefined();
    // Identidad que las superficies de revisión muestran.
    expect(persisted.exchange).toBe("NASDAQ");
    expect(persisted.currency).toBe("USD");
    // Sin marca de cribado inventada: esta fila no venía del filtro nocturno.
    expect(persisted.screenPassed).toBeUndefined();
    expect(persisted.rowProjection).toBeUndefined();
    // El peso cae a una fracción de la fila original.
    expect(payloadChars(persisted)).toBeLessThan(payloadChars(row) / 3);
  });

  it("conserva la marca de cribado real cuando la fila la trae", () => {
    const persisted = persistRowForBrowser({ ...bigRow(), screenPassed: true, rowProjection: "full" });
    expect(persisted.screenPassed).toBe(true);
    expect(persisted.rowProjection).toBe("full");
  });
});

describe("re-filtrado de la fila persistida (espejo)", () => {
  // La fila rehidratada de un snapshot local vuelve a pasar por
  // filterAnalyzedRows. Si la proyección pierde un campo que una puerta del
  // filtro consulta (como pasó con chartBarsCount y el quality gate: 500 filas
  // rechazadas con "histórico 0/180" al restaurar), el veredicto cambia. Este
  // espejo exige el MISMO veredicto y el MISMO motivo para la fila completa y
  // la persistida.
  const filterReadyRow = (symbol, overrides = {}) => ({
    ...bigRow(symbol),
    chartBarsCount: 250,
    sma50: 95, sma150: 92, sma200: 90, sma200Slope: 0.4,
    weeklyStageState: "stage2", weeklyStageLabel: "Etapa 2",
    weeklyFastWeeks: 30, weeklySlowWeeks: 40,
    priceFreshnessDays: 1, priceFreshnessOk: true, lastDate: "2026-08-14",
    dataCoverageScore: 90, technicalCoverageScore: 90, fundamentalCoverageScore: 80,
    avgVolume: 2_000_000, latestVolume: 2_500_000, avgTurnover: 200_000_000,
    latestTurnover: 250_000_000, relativeVolume: 1.2, upDownVolRatio: 1.4, upVolume: true,
    weinsteinScore: 80, minerviniScore: 75, momentumScore: 70, riskScore: 60,
    volumeScore: 65, liquidityScore: 85, sectorScore: 55, weaknessScore: 80,
    volatility63d: 30, maxDrawdown63d: -12, extSma50: 5,
    weeklyRsAvailable: true, weeklyRsRating: 92, rsCountryPct: 90, rsSectorPct: 88,
    rsQualityScore: 70, objectiveScore: 71, ipoAgeMonths: 60,
    ...overrides,
  });

  it("una fila con datos completos produce el mismo resultado antes y después de persistirse", () => {
    const settings = settingsForPreset("balanced");
    const context = { symbolsCount: 3, baseCount: 3, providerErrors: [] };
    const rows = [
      filterReadyRow("PASA"),
      filterReadyRow("HIST", { chartBarsCount: 59 }),          // rechazo del quality gate
      filterReadyRow("TREN", { price: 80, sma200: 90 }),       // rechazo de la puerta de tendencia
    ];
    const full = filterAnalyzedRows(rows, settings, context);
    const light = filterAnalyzedRows(persistRowsForBrowser(rows), settings, context);
    expect(light.rows.map((row) => row.symbol)).toEqual(full.rows.map((row) => row.symbol));
    expect(light.diagnostics?.hardRejected).toBe(full.diagnostics?.hardRejected);
    const reasonsBySymbol = (view) => (view.diagnostics?.blocks || [])
      .flatMap((block) => (block.examples || []).map((example) => `${block.key}:${example.symbol}:${example.detail}`))
      .sort();
    expect(reasonsBySymbol(light)).toEqual(reasonsBySymbol(full));
  });

  it("el quality gate ve el mismo histórico en la fila persistida", () => {
    const row = filterReadyRow("GATE", { chartBarsCount: 200 });
    const persisted = persistRowForBrowser(row);
    expect(qualityGateForResearchRow(persisted, {}).passed).toBe(qualityGateForResearchRow(row, {}).passed);
    expect(persisted.chartBarsCount).toBe(200);
  });
});

describe("fitScansForBrowser", () => {
  it("proyecta las filas y recorta los scans más antiguos que no caben en el presupuesto", () => {
    const scan = (id) => ({ id, createdAt: "2026-08-15T09:00:00Z", rows: [bigRow(`S${id}`)] });
    const fitted = fitScansForBrowser([scan("a"), scan("b"), scan("c")], payloadChars(fitScansForBrowser([scan("a")])[0]) * 2 + 10);
    expect(fitted.map((item) => item.id)).toEqual(["a", "b"]);
    expect(fitted[0].rows[0].objectiveMetricAudit).toBeUndefined();
  });

  it("conserva siempre el scan más reciente aunque exceda el presupuesto", () => {
    const fitted = fitScansForBrowser([{ id: "solo", rows: [bigRow()] }], 10);
    expect(fitted.map((item) => item.id)).toEqual(["solo"]);
  });

  // El universo entero se transporta (para poder filtrarlo) pero NO cabe en
  // localStorage: 3.312 filas en proyección de persistencia son del orden de
  // 25 M de caracteres frente a los 4,5 M de presupuesto de la clave. Lo que
  // se guarda es una muestra REPARTIDA, no las primeras: las filas llegan
  // ordenadas por rank_index (puntuación), así que quedarse con la cabeza
  // dejaría la copia local sin un solo valor débil.
  it("recorta las filas del scan más reciente a una muestra repartida cuando no cabe", () => {
    const rows = Array.from({ length: 300 }, (_, index) => bigRow(`S${String(index).padStart(3, "0")}`));
    const entero = fitScansForBrowser([{ id: "grande", rowsAvailable: 300, rows }], Infinity)[0];
    const budget = Math.floor(payloadChars(entero) / 3);

    const fitted = fitScansForBrowser([{ id: "grande", rowsAvailable: 300, rows }], budget)[0];

    expect(payloadChars(fitted)).toBeLessThanOrEqual(budget);
    expect(fitted.rows.length).toBeGreaterThan(1);
    expect(fitted.rows.length).toBeLessThan(300);
    expect(fitted.rowsAvailable).toBe(300);
    expect(fitted.rowsReturned).toBe(fitted.rows.length);
    expect(fitted.rowsTruncated).toBe(true);
    expect(fitted.rowsSampled).toBe(true);
    // Reparto real: la muestra llega hasta el final de la lista, no se queda
    // en la cabeza del ranking.
    expect(fitted.rows[0].symbol).toBe("S000");
    expect(Number(fitted.rows.at(-1).symbol.slice(1))).toBeGreaterThan(200);
  });

  it("no marca muestra cuando el scan cabe entero", () => {
    const fitted = fitScansForBrowser([{ id: "cabe", rows: [bigRow("AAA"), bigRow("BBB")] }], 4_500_000)[0];
    expect(fitted.rowsSampled).toBeUndefined();
    expect(fitted.rows).toHaveLength(2);
  });
});

describe("safeWrite con cuota llena", () => {
  it("notifica el fallo a los suscriptores en vez de tragárselo", () => {
    installFakeStorage({ maxChars: 50 });
    const seen = [];
    const unsubscribe = subscribeStorageWriteFailures((failure) => seen.push(failure));
    const ok = safeWrite(STORAGE_KEYS.review, { rows: ["x".repeat(500)] });
    unsubscribe();
    expect(ok).toBe(false);
    expect(seen).toHaveLength(1);
    expect(seen[0].key).toBe(STORAGE_KEYS.review);
    expect(seen[0].quota).toBe(true);
    expect(seen[0].failed).toBe(true);
  });

  it("con silent registra el fallo sin notificar (intentos intermedios de un orquestador)", () => {
    installFakeStorage({ maxChars: 50 });
    const seen = [];
    const unsubscribe = subscribeStorageWriteFailures((failure) => seen.push(failure));
    const ok = safeWrite(STORAGE_KEYS.scans, { rows: ["x".repeat(500)] }, { silent: true });
    unsubscribe();
    expect(ok).toBe(false);
    expect(seen).toHaveLength(0);
    expect(lastStorageWriteFailure()?.key).toBe(STORAGE_KEYS.scans);
  });

  it("reportStorageOutcome avisa una única vez del desenlace degradado", () => {
    const seen = [];
    const unsubscribe = subscribeStorageWriteFailures((failure) => seen.push(failure));
    reportStorageOutcome({ key: STORAGE_KEYS.review, degraded: true });
    unsubscribe();
    expect(seen).toHaveLength(1);
    expect(seen[0].degraded).toBe(true);
    expect(seen[0].failed).toBe(false);
  });

  it("clasifica los errores de cuota de los navegadores reales", () => {
    expect(isQuotaError(quotaError())).toBe(true);
    expect(isQuotaError(new Error("otra cosa"))).toBe(false);
  });
});

describe("persistReviewQueue", () => {
  const queue = (count = 8) => ({
    source: "current",
    rows: Array.from({ length: count }, (_, i) => bigRow(`Q${i}`)),
    currentIndex: 0,
    decisionResolutions: { Q1: { actionKey: "discard" } },
  });

  it("escribe la cola en proyección ligera cuando hay espacio", () => {
    installFakeStorage();
    expect(persistReviewQueue(queue())).toBe(true);
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEYS.review));
    expect(stored.rows).toHaveLength(8);
    expect(stored.rows[0].objectiveMetricAudit).toBeUndefined();
    expect(stored.rows[0].decisionTrace).toBeUndefined();
    expect(stored.rows[0].chartPreview.length).toBeGreaterThan(0);
    expect(stored.decisionResolutions.Q1.actionKey).toBe("discard");
  });

  it("cuando no cabe, degrada a cola sin miniaturas y reporta el desenlace", () => {
    installFakeStorage();
    const light = { ...queue(), rows: persistRowsForBrowser(queue().rows) };
    const withoutPreviews = payloadChars({ ...light, rows: light.rows.map(({ chartPreview, ...rest }) => rest) });
    installFakeStorage({ maxChars: Math.floor((payloadChars(light) + withoutPreviews) / 2) });
    const seen = [];
    const unsubscribe = subscribeStorageWriteFailures((failure) => seen.push(failure));
    expect(persistReviewQueue(queue())).toBe(true);
    unsubscribe();
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEYS.review));
    expect(stored.rows[0].chartPreview).toBeUndefined();
    expect(stored.rows[0].symbol).toBe("Q0");
    expect(stored.storageNote).toContain("sin miniaturas");
    expect(seen.some((failure) => failure.degraded && !failure.failed)).toBe(true);
    expect(seen.some((failure) => failure.failed)).toBe(false);
  });

  it("si no cabe de ninguna forma, reporta el fallo (nunca en silencio)", () => {
    installFakeStorage({ maxChars: 40 });
    const seen = [];
    const unsubscribe = subscribeStorageWriteFailures((failure) => seen.push(failure));
    expect(persistReviewQueue(queue())).toBe(false);
    unsubscribe();
    expect(seen.some((failure) => failure.failed)).toBe(true);
  });

  it("libera snapshots locales viejos antes de rendirse", () => {
    const fake = installFakeStorage();
    const scans = [{ id: "nuevo", rows: [bigRow("A")] }, { id: "viejo", rows: [bigRow("B")] }];
    fake.setItem(STORAGE_KEYS.scans, JSON.stringify(scans));
    const scansChars = fake.getItem(STORAGE_KEYS.scans).length;
    const light = { ...queue(2), rows: persistRowsForBrowser(queue(2).rows) };
    // Cabe la cola O los dos scans, no ambos: persistReviewQueue debe recortar scans.
    installFakeStorage({ maxChars: scansChars + Math.floor(payloadChars(light) / 2) });
    localStorage.setItem(STORAGE_KEYS.scans, JSON.stringify(scans));
    expect(persistReviewQueue(queue(2))).toBe(true);
    const keptScans = JSON.parse(localStorage.getItem(STORAGE_KEYS.scans));
    expect(keptScans.map((scan) => scan.id)).toEqual(["nuevo"]);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.review)).rows).toHaveLength(2);
  });
});

describe("presupuestos y medición", () => {
  it("las tres claves que crecen con datos tienen presupuesto", () => {
    expect(budgetFor(STORAGE_KEYS.scans)).toBeGreaterThan(0);
    expect(budgetFor(STORAGE_KEYS.review)).toBeGreaterThan(0);
    expect(budgetFor(STORAGE_KEYS.screenerSession)).toBeGreaterThan(0);
    // El total presupuestado cabe en la cuota de 10 MB de un navegador real.
    const total = Object.values(STORAGE_BUDGETS).reduce((sum, value) => sum + value, 0);
    expect(total).toBeLessThanOrEqual(10_000_000);
  });

  it("storageFootprint mide solo las claves del producto", () => {
    const fake = installFakeStorage();
    fake.setItem(STORAGE_KEYS.review, "abc");
    fake.setItem("ajena.key", "zzzz");
    const footprint = storageFootprint();
    expect(footprint.totalChars).toBe(3);
    expect(footprint.keys).toEqual([{ key: STORAGE_KEYS.review, chars: 3 }]);
  });

  it("freeUpLocalScans conserva el más reciente y devuelve lo liberado", () => {
    const fake = installFakeStorage();
    fake.setItem(STORAGE_KEYS.scans, JSON.stringify([{ id: "a", rows: [] }, { id: "b", rows: [] }]));
    const freed = freeUpLocalScans(1);
    expect(freed).toBeGreaterThan(0);
    expect(JSON.parse(fake.getItem(STORAGE_KEYS.scans)).map((scan) => scan.id)).toEqual(["a"]);
  });
});

// El quality gate y las filas ligeras ya guardadas (2026-08-17).
//
// El nocturno guarda la población entera, pero su proyección ligera no
// incluía chartBarsCount, y qualityGateForResearchRow exige 180 barras. Medido
// sobre el nocturno servido entero ese día: 41 de 3.312 filas llevaban el
// campo. Es decir, el usuario filtraba sobre 41 acciones —justo las que ya
// habían pasado el preset del nocturno— creyendo filtrar sobre el universo.
describe("qualityGateForResearchRow · filas en proyección ligera", () => {
  it("acepta la fila ligera sin chartBarsCount: el productor ya exigió 180 barras", () => {
    const gate = qualityGateForResearchRow({ symbol: "LIG", price: 12, rowProjection: "light" }, {});
    expect(gate.passed).toBe(true);
    expect(gate.reasons).toEqual([]);
  });

  it("pero NO acepta una fila ligera con histórico explícitamente corto", () => {
    const gate = qualityGateForResearchRow({ symbol: "LIG", price: 12, rowProjection: "light", chartBarsCount: 40 }, {});
    expect(gate.passed).toBe(false);
    expect(gate.reasons[0]).toContain("histórico 40/180");
  });

  it("ni una fila normal sin histórico: la excepción es solo para la proyección ligera", () => {
    const gate = qualityGateForResearchRow({ symbol: "NOR", price: 12 }, {});
    expect(gate.passed).toBe(false);
    expect(gate.reasons[0]).toContain("histórico 0/180");
  });

  it("el precio se sigue exigiendo siempre", () => {
    const gate = qualityGateForResearchRow({ symbol: "LIG", rowProjection: "light" }, {});
    expect(gate.passed).toBe(false);
    expect(gate.reasons).toEqual(["precio no disponible"]);
  });
});
