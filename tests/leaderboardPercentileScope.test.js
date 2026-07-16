// Tests de buildLeaderboard · percentileScope y desempate final>batch.
//
// El cambio de producto introduce percentileScope ("batch" | "final") en el
// item público y un desempate que ordena `final` antes que `batch` cuando score
// y objectiveScore empatan. Estos tests cubren exclusivamente ese contrato,
// sin acoplarse a la implementación de las estrategias ni a Supabase.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabaseServer", () => ({
  supabaseConfig: vi.fn(() => ({ configured: true, url: "https://example.supabase.co", ownerId: "owner-test" })),
  supabaseRpc: vi.fn(),
  supabaseRequest: vi.fn(),
  supabaseRequestAll: vi.fn(),
  textOrNull: (v) => (v == null ? null : String(v)),
  finiteOrNull: (v) => (Number.isFinite(v) ? v : null),
  disabledPayload: () => ({ disabled: true }),
}));

import { buildLeaderboard } from "@/lib/leaderboards";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

// Fixture base: fila long-opportunity válida (trend template OK, precio fresco)
// con objectiveScore suficiente para pasar el mínimo de composite (total >= 50)
// y rsGlobalPct válido para pasar el mínimo de rs (>= 60). Se parametriza
// symbol, objectiveScore, rsGlobalPct y percentileScope.
//
// Importante para entender los tests:
//  - En `strategy: "composite"` strategyScore === clamp(objectiveMetric(row)),
//    por lo que score y objectiveScore van necesariamente juntos.
//  - En `strategy: "rs"` strategyScore === clamp(rsGlobalPct), por lo que se
//    puede fijar un score idéntico entre dos filas y variar objectiveScore
//    sin alterar el score de estrategia. Esta propiedad es la que usa el
//    test "objectiveScore prevalece sobre percentileScope".
function makeRow({ symbol = "TEST", objectiveScore = 70, rsGlobalPct = 75, percentileScope }) {
  return {
    symbol,
    raw: {
      symbol,
      companyName: symbol,
      country: "US",
      sector: "Technology",
      industry: "Software",
      // Trend template alcista válido: precio > sma50 > sma150 > sma200, slope>0.
      price: 120, sma50: 110, sma150: 100, sma200: 95, sma200Slope: 0.4,
      distance52w: -3, extSma50: 5,
      objectiveScore,
      totalScore: objectiveScore,
      compositeScore: objectiveScore,
      rsGlobalPct,
      dataCoverageScore: 80,
      lastDate: new Date().toISOString().slice(0, 10),
      ...(percentileScope ? { percentileScope } : {}),
    },
  };
}

describe("buildLeaderboard · percentileScope en el item público", () => {
  it("percentileScope sale en el item público cuando la fila lo trae", () => {
    const lb = buildLeaderboard([makeRow({ symbol: "FINAL", percentileScope: "final" })], {
      strategy: "composite",
      limit: 10,
    });
    expect(lb.count).toBe(1);
    expect(lb.items[0].symbol).toBe("FINAL");
    expect(lb.items[0].percentileScope).toBe("final");
  });

  it("una fila sin scope sale como 'batch' (default)", () => {
    const lb = buildLeaderboard([makeRow({ symbol: "NOSCOPE" })], {
      strategy: "composite",
      limit: 10,
    });
    expect(lb.count).toBe(1);
    expect(lb.items[0].symbol).toBe("NOSCOPE");
    expect(lb.items[0].percentileScope).toBe("batch");
  });

  it("percentileScope='batch' se respeta literalmente en el item público", () => {
    const lb = buildLeaderboard([makeRow({ symbol: "BATCH", percentileScope: "batch" })], {
      strategy: "composite",
      limit: 10,
    });
    expect(lb.items[0].percentileScope).toBe("batch");
  });
});

describe("buildLeaderboard · desempate final > batch (mismo score y objectiveScore)", () => {
  it("con mismo score y mismo objectiveScore, final va antes que batch", () => {
    const rows = [
      makeRow({ symbol: "BATCH_A", objectiveScore: 70, percentileScope: "batch" }),
      makeRow({ symbol: "FINAL_A", objectiveScore: 70, percentileScope: "final" }),
    ];
    const lb = buildLeaderboard(rows, { strategy: "composite", limit: 10 });
    expect(lb.count).toBe(2);
    const order = lb.items.map((item) => item.symbol);
    expect(order).toEqual(["FINAL_A", "BATCH_A"]);
  });

  it("el desempate final>batch NO altera el orden cuando los scores difieren", () => {
    // batch tiene score mayor → debe ir primero pese a ser batch.
    const rows = [
      makeRow({ symbol: "FINAL_LOW", objectiveScore: 60, percentileScope: "final" }),
      makeRow({ symbol: "BATCH_HIGH", objectiveScore: 80, percentileScope: "batch" }),
    ];
    const lb = buildLeaderboard(rows, { strategy: "composite", limit: 10 });
    expect(lb.items.map((item) => item.symbol)).toEqual(["BATCH_HIGH", "FINAL_LOW"]);
  });

  it("el desempate final>batch NO altera el orden cuando objectiveScore difiere (mismo score)", () => {
    // Para composite strategyScore === objectiveScore, así que NO se puede
    // forzar "mismo score con objectiveScore distinto" — score y objectiveScore
    // son el mismo dato. Usamos strategy="rs" donde strategyScore ===
    // clamp(rsGlobalPct), independiente del objectiveScore (total/composite).
    //
    // Las dos filas comparten rsGlobalPct=80 → score idéntico (clamp(80)=80).
    // Pero objectiveScore difiere: 55 vs 75. Gana la de mayor objectiveScore
    // (75) ANTES que el desempate por scope, demostrando que el
    // objectiveScore prevalece sobre percentileScope.
    const rows = [
      makeRow({ symbol: "FINAL_OBJ_BAJO", objectiveScore: 55, rsGlobalPct: 80, percentileScope: "final" }),
      makeRow({ symbol: "BATCH_OBJ_ALTO", objectiveScore: 75, rsGlobalPct: 80, percentileScope: "batch" }),
    ];
    const lb = buildLeaderboard(rows, { strategy: "rs", limit: 10 });
    // Sanity: ambos scores de estrategia son idénticos (= clamp(rsGlobalPct)).
    expect(lb.items.find((i) => i.symbol === "FINAL_OBJ_BAJO").score).toBe(80);
    expect(lb.items.find((i) => i.symbol === "BATCH_OBJ_ALTO").score).toBe(80);
    // objectiveScore mayor (75) gana por encima del scope "final".
    expect(lb.items.map((item) => item.symbol)).toEqual(["BATCH_OBJ_ALTO", "FINAL_OBJ_BAJO"]);
  });

  it("mezcla 4 filas: orden correcto por score, luego final>batch en empates", () => {
    const rows = [
      makeRow({ symbol: "B1", objectiveScore: 70, percentileScope: "batch" }),
      makeRow({ symbol: "F1", objectiveScore: 70, percentileScope: "final" }),
      makeRow({ symbol: "B2", objectiveScore: 90, percentileScope: "batch" }),
      makeRow({ symbol: "F2", objectiveScore: 90, percentileScope: "final" }),
    ];
    const lb = buildLeaderboard(rows, { strategy: "composite", limit: 10 });
    // score 90: final antes que batch → F2, B2; score 70: F1, B1.
    expect(lb.items.map((item) => item.symbol)).toEqual(["F2", "B2", "F1", "B1"]);
  });
});

describe("buildLeaderboard · guardrails (no elimina batch, no muta)", () => {
  it("ninguna fila batch se elimina por el guardrail de scope", () => {
    const rows = [
      makeRow({ symbol: "BATCH1", percentileScope: "batch" }),
      makeRow({ symbol: "BATCH2", percentileScope: "batch" }),
      makeRow({ symbol: "FINAL1", percentileScope: "final" }),
    ];
    const lb = buildLeaderboard(rows, { strategy: "composite", limit: 10 });
    expect(lb.count).toBe(3);
    const scopes = lb.items.map((item) => item.percentileScope).sort();
    expect(scopes).toEqual(["batch", "batch", "final"]);
  });

  it("el ranking y los scores devueltos no se mutan como consecuencia del guardrail", () => {
    const rows = [
      makeRow({ symbol: "BATCH_A", objectiveScore: 70, percentileScope: "batch" }),
      makeRow({ symbol: "FINAL_A", objectiveScore: 70, percentileScope: "final" }),
    ];
    const lb = buildLeaderboard(rows, { strategy: "composite", limit: 10 });
    const snapshotItems = lb.items.map((item) => ({ symbol: item.symbol, score: item.score, rank: item.rank }));
    const snapshotRanking = lb.items.map((item) => item.symbol);

    // Re-ejecutamos y comprobamos que el resultado es idéntico (determinista).
    const lb2 = buildLeaderboard(rows, { strategy: "composite", limit: 10 });
    expect(lb2.items.map((item) => ({ symbol: item.symbol, score: item.score, rank: item.rank }))).toEqual(snapshotItems);
    expect(lb2.items.map((item) => item.symbol)).toEqual(snapshotRanking);

    // El score de la fila final y batch (mismo objectiveScore) debe ser igual.
    const finalItem = lb.items.find((item) => item.symbol === "FINAL_A");
    const batchItem = lb.items.find((item) => item.symbol === "BATCH_A");
    expect(finalItem.score).toBe(batchItem.score);
    // ranks consecutivos 1..N.
    expect(lb.items.map((item) => item.rank)).toEqual([1, 2]);
  });

  it("los items devueltos no comparten referencia mutable con las filas de entrada", () => {
    const row = makeRow({ symbol: "FINALX", objectiveScore: 70, percentileScope: "final" });
    const lb = buildLeaderboard([row], { strategy: "composite", limit: 10 });
    // Mutar la fila original NO debe afectar al item ya devuelto.
    row.raw.objectiveScore = 1;
    expect(lb.items[0].objectiveScore).not.toBe(1);
  });
});
