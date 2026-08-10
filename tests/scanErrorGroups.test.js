// Tests de lib/scanErrorGroups.js — el formato agrupado de progress.errors.
//
// Contexto (docs/timeout-scan-universo-2026-08-09.md): progress.errors viaja
// entero en cada latido del bucle de progreso. Con el formato plano anterior
// (una entrada por símbolo, tope 300) el mismo texto largo de `reason` se
// repetía en cientos de entradas — ~48 KiB reescritos cada dos segundos, y un
// escaneo de "todo el universo" murió con el timeout de Postgres al guardar el
// progreso. Estos tests fijan las tres propiedades de las que depende el fix:
//   1. mismo motivo → un solo grupo,
//   2. el recuento total es exacto aunque se guarden pocos símbolos por grupo
//      y aunque se descarten grupos por el tope,
//   3. el tope de grupos se respeta.

import { describe, expect, it } from "vitest";

import {
  createScanErrorAggregator,
  MAX_STORED_ERROR_GROUPS,
  MAX_SYMBOLS_PER_ERROR_GROUP,
  normalizeScanErrorGroups,
  scanErrorTotal,
} from "@/lib/scanErrorGroups";

// El motivo real del incidente: 110 de los ~160 bytes de cada entrada plana.
const NO_HISTORY = "Yahoo historico insuficiente · Stooq fallback sin STOOQ_API_KEY · Alpha Vantage sin ALPHA_VANTAGE_API_KEY";

function entry(symbol, reason = NO_HISTORY, kind = "terminal", status = null) {
  return { symbol, reason, kind, status };
}

describe("createScanErrorAggregator · agrupación por motivo", () => {
  it("errores con el mismo motivo se agrupan en una sola entrada", () => {
    const agg = createScanErrorAggregator();
    for (let i = 0; i < 40; i += 1) agg.add(entry(`SYM${i}`));

    const groups = agg.groups();
    expect(groups).toHaveLength(1);
    expect(groups[0].reason).toBe(NO_HISTORY);
    expect(groups[0].kind).toBe("terminal");
    expect(groups[0].count).toBe(40);
  });

  it("motivos distintos NO se mezclan, y tampoco el mismo texto con distinto kind/status", () => {
    const agg = createScanErrorAggregator();
    agg.add(entry("AAA", NO_HISTORY, "terminal", null));
    agg.add(entry("BBB", "Yahoo chart HTTP 429", "retryable", 429));
    agg.add(entry("CCC", "Yahoo chart HTTP 429", "retryable", 429));
    agg.add(entry("DDD", "Yahoo chart HTTP 429", "terminal", 429)); // mismo texto, otra clase

    const groups = agg.groups();
    expect(groups).toHaveLength(3);
    // Orden por count descendente: el grupo de 2 va primero.
    expect(groups[0]).toMatchObject({ reason: "Yahoo chart HTTP 429", kind: "retryable", status: 429, count: 2 });
    expect(groups.map((g) => g.count).reduce((a, b) => a + b, 0)).toBe(4);
  });

  it("el recuento total es exacto aunque solo se guarden 20 símbolos por grupo", () => {
    const agg = createScanErrorAggregator();
    for (let i = 0; i < 250; i += 1) agg.add(entry(`SYM${i}`));

    const [group] = agg.groups();
    expect(group.count).toBe(250);
    expect(group.symbols).toHaveLength(MAX_SYMBOLS_PER_ERROR_GROUP);
    expect(group.symbols[0]).toBe("SYM0");
    expect(group.symbols.at(-1)).toBe(`SYM${MAX_SYMBOLS_PER_ERROR_GROUP - 1}`);
    expect(agg.total).toBe(250);
  });

  it("el tope de grupos se respeta: los motivos que no caben dejan de almacenarse pero SIGUEN contando", () => {
    const agg = createScanErrorAggregator();
    const distinctReasons = MAX_STORED_ERROR_GROUPS + 15;
    for (let i = 0; i < distinctReasons; i += 1) agg.add(entry(`SYM${i}`, `Motivo distinto numero ${i}`));

    expect(agg.groups()).toHaveLength(MAX_STORED_ERROR_GROUPS);
    expect(agg.groupCount).toBe(MAX_STORED_ERROR_GROUPS);
    // Ni un solo error perdido en el recuento.
    expect(agg.total).toBe(distinctReasons);
  });

  it("un motivo ya almacenado sigue acumulando aunque el mapa de grupos esté lleno", () => {
    const agg = createScanErrorAggregator();
    agg.add(entry("FIRST", NO_HISTORY));
    for (let i = 0; i < MAX_STORED_ERROR_GROUPS + 10; i += 1) agg.add(entry(`SYM${i}`, `Motivo distinto numero ${i}`));
    agg.add(entry("LATER", NO_HISTORY));

    const historyGroup = agg.groups().find((g) => g.reason === NO_HISTORY);
    expect(historyGroup.count).toBe(2);
    expect(historyGroup.symbols).toEqual(["FIRST", "LATER"]);
  });

  it("un error sin código HTTP guarda status null, no 0 (Number(null) === 0)", () => {
    const agg = createScanErrorAggregator();
    agg.add(entry("AAA", NO_HISTORY, "unknown", null));
    agg.add({ symbol: "BBB", reason: NO_HISTORY, kind: "unknown" });
    agg.add({ symbol: "CCC", reason: NO_HISTORY, kind: "unknown", status: "" });

    const groups = agg.groups();
    expect(groups).toHaveLength(1);
    expect(groups[0].status).toBeNull();
    expect(groups[0].count).toBe(3);
    // Y un 0 real sí se distingue de "sin código".
    agg.add({ symbol: "DDD", reason: NO_HISTORY, kind: "unknown", status: 0 });
    expect(agg.groups()).toHaveLength(2);
  });

  it("errores sin símbolo o sin motivo no rompen el grupo (kind cae a 'unknown')", () => {
    const agg = createScanErrorAggregator();
    agg.add({});
    agg.add({ symbol: "AAA", reason: "" });

    const groups = agg.groups();
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ reason: "Proveedor no disponible", kind: "unknown", status: null, count: 2 });
    expect(groups[0].symbols).toEqual(["AAA"]);
  });
});

describe("createScanErrorAggregator · siembra entre eslabones encadenados", () => {
  it("rehidrata grupos y recuento del eslabón anterior y sigue sumando", () => {
    const first = createScanErrorAggregator();
    for (let i = 0; i < 30; i += 1) first.add(entry(`SYM${i}`));

    const second = createScanErrorAggregator(first.groups(), first.total);
    for (let i = 30; i < 40; i += 1) second.add(entry(`SYM${i}`));

    const groups = second.groups();
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(40);
    expect(second.total).toBe(40);
    // Los símbolos de ejemplo siguen topados pese a la rehidratación.
    expect(groups[0].symbols).toHaveLength(MAX_SYMBOLS_PER_ERROR_GROUP);
  });

  it("el total sembrado gana sobre la suma de grupos cuando el eslabón previo truncó grupos", () => {
    // Un eslabón anterior descartó grupos por el tope: la suma de los grupos
    // persistidos (2) es menor que el total real (500).
    const previous = [{ reason: NO_HISTORY, kind: "terminal", status: null, count: 2, symbols: ["AAA", "BBB"] }];
    const agg = createScanErrorAggregator(previous, 500);
    agg.add(entry("CCC"));

    expect(agg.total).toBe(501);
    expect(agg.groups()[0].count).toBe(3);
  });

  it("acepta el formato plano antiguo como siembra (scan empezado antes del cambio)", () => {
    const legacy = [entry("AAA"), entry("BBB"), entry("CCC", "Yahoo chart HTTP 404", "terminal", 404)];
    const agg = createScanErrorAggregator(legacy, null);
    agg.add(entry("DDD"));

    const groups = agg.groups();
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.reason === NO_HISTORY).count).toBe(3);
    expect(agg.total).toBe(4);
  });
});

describe("normalizeScanErrorGroups / scanErrorTotal · lectura por los consumidores", () => {
  it("convierte la lista plana antigua en grupos", () => {
    const legacy = Array.from({ length: 40 }, (_, i) => entry(`SYM${i}`));
    const groups = normalizeScanErrorGroups(legacy);

    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(40);
    expect(groups[0].symbols).toHaveLength(MAX_SYMBOLS_PER_ERROR_GROUP);
    expect(scanErrorTotal(legacy)).toBe(40);
  });

  it("deja el formato nuevo intacto en cuanto a recuentos", () => {
    const groups = [
      { reason: NO_HISTORY, kind: "terminal", status: null, count: 40, symbols: ["AAA", "BBB"] },
      { reason: "Yahoo chart HTTP 429", kind: "retryable", status: 429, count: 3, symbols: ["CCC"] },
    ];
    expect(normalizeScanErrorGroups(groups)).toHaveLength(2);
    expect(scanErrorTotal(groups)).toBe(43);
  });

  it("scanErrorTotal prefiere errorsTotal cuando es mayor que la suma de los grupos", () => {
    const groups = [{ reason: NO_HISTORY, kind: "terminal", status: null, count: 3, symbols: ["AAA"] }];
    expect(scanErrorTotal(groups, 500)).toBe(500);
    // …pero nunca por debajo de lo que los grupos ya demuestran.
    expect(scanErrorTotal(groups, 1)).toBe(3);
  });

  it("entradas basura no rompen nada", () => {
    expect(normalizeScanErrorGroups(null)).toEqual([]);
    expect(normalizeScanErrorGroups([null, undefined, 3, "x"])).toEqual([]);
    expect(scanErrorTotal(undefined)).toBe(0);
  });
});

describe("efecto en bytes del progreso persistido", () => {
  // La medición del incidente: 300 errores del caso real (40 símbolos sin
  // histórico + otros motivos) en el array plano frente al agrupado.
  function realWorldErrors(total = 300) {
    const reasons = [
      { reason: NO_HISTORY, kind: "terminal", status: null, share: 40 },
      { reason: "Yahoo chart HTTP 404 · Stooq fallback sin STOOQ_API_KEY · Alpha Vantage sin ALPHA_VANTAGE_API_KEY", kind: "terminal", status: 404, share: 120 },
      { reason: "Yahoo chart HTTP 429 · Stooq fallback sin STOOQ_API_KEY · Alpha Vantage sin ALPHA_VANTAGE_API_KEY", kind: "retryable", status: 429, share: 90 },
      { reason: "Sin historico Yahoo · Stooq fallback sin STOOQ_API_KEY · Alpha Vantage sin ALPHA_VANTAGE_API_KEY", kind: "terminal", status: null, share: 30 },
      { reason: "fetch failed · Stooq fallback sin STOOQ_API_KEY · Alpha Vantage sin ALPHA_VANTAGE_API_KEY", kind: "retryable", status: null, share: 20 },
    ];
    const out = [];
    let i = 0;
    for (const spec of reasons) {
      for (let n = 0; n < spec.share && out.length < total; n += 1, i += 1) {
        out.push({ symbol: `SYM${i}`, reason: spec.reason, kind: spec.kind, status: spec.status });
      }
    }
    return out;
  }

  it("300 errores del caso real ocupan al menos 5x menos agrupados que en lista plana", () => {
    const flat = realWorldErrors(300);
    expect(flat).toHaveLength(300);

    const agg = createScanErrorAggregator();
    for (const item of flat) agg.add(item);

    const flatBytes = Buffer.byteLength(JSON.stringify(flat), "utf8");
    const groupedBytes = Buffer.byteLength(JSON.stringify(agg.groups()), "utf8");

    // El recuento no se pierde por el camino.
    expect(agg.total).toBe(300);
    expect(agg.groups().reduce((sum, g) => sum + g.count, 0)).toBe(300);
    expect(agg.groups()).toHaveLength(5);

    expect(groupedBytes * 5).toBeLessThan(flatBytes);
  });
});
