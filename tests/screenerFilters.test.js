import { describe, expect, it } from "vitest";
import { buildScreenerFilterExplainPlan, screenerFilterRejectReason } from "@/lib/screenerFilters";

describe("minWeaknessScore", () => {
  it("se omite en leader aunque esté configurado y deja un trace observable", () => {
    const filters = { setupMode: "leader", minWeaknessScore: 50 };

    expect(screenerFilterRejectReason({ weaknessScore: 0 }, filters)).toBe("");
    expect(buildScreenerFilterExplainPlan({ weaknessScore: 0 }, filters).passed).toContainEqual(expect.objectContaining({
      field: "minWeaknessScore",
      status: "skipped",
      detail: expect.stringContaining("no es weakness"),
    }));
  });

  it("acepta deterioro que alcanza el umbral en weakness", () => {
    expect(screenerFilterRejectReason({ weaknessScore: 60 }, {
      setupMode: "weakness",
      minWeaknessScore: 50,
    })).toBe("");
  });

  it("rechaza deterioro por debajo del umbral en weakness", () => {
    expect(screenerFilterRejectReason({ weaknessScore: 20 }, {
      setupMode: "weakness",
      minWeaknessScore: 50,
    })).toMatchObject({ field: "minWeaknessScore" });
  });

  it("respeta minWeaknessScore 0 sin suelo implícito", () => {
    expect(screenerFilterRejectReason({ weaknessScore: 0 }, {
      setupMode: "weakness",
      minWeaknessScore: 0,
    })).toBe("");
  });

  it("omite el criterio con weaknessScore nulo y lo deja distinguible en el trace", () => {
    const filters = { setupMode: "weakness", minWeaknessScore: 50 };

    expect(screenerFilterRejectReason({ weaknessScore: null }, filters)).toBe("");
    expect(screenerFilterRejectReason({ weaknessScore: null }, { setupMode: "leader", minWeaknessScore: 50 })).toBe("");
    expect(buildScreenerFilterExplainPlan({ weaknessScore: null }, filters).passed).toContainEqual(expect.objectContaining({
      field: "minWeaknessScore",
      status: "skipped",
      detail: "deterioro omitido: sin dato",
    }));
  });
});

// minRsRating lee el RS semanal (rs_weekly_items sobre el universo US
// completo), no rsGlobalPct (percentil del lote del escaneo). Cuando el
// símbolo no está en el ranking semanal, el criterio se OMITE — no rechaza
// la fila, aunque rsGlobalPct sea bajo o esté ausente (docs/adr-rs-universo-us.md).
describe("minRsRating (RS semanal)", () => {
  it("acepta un símbolo en el ranking con RS semanal por encima del umbral", () => {
    const row = { weeklyRsAvailable: true, weeklyRsRating: 82, rsGlobalPct: 40 };
    expect(screenerFilterRejectReason(row, { minRsRating: 75 })).toBe("");
  });

  it("rechaza un símbolo en el ranking con RS semanal por debajo del umbral", () => {
    const row = { weeklyRsAvailable: true, weeklyRsRating: 60, rsGlobalPct: 95 };
    expect(screenerFilterRejectReason(row, { minRsRating: 75 })).toMatchObject({ field: "minRsRating" });
  });

  it("NO rechaza un símbolo que no está en el ranking semanal, aunque rsGlobalPct sea bajo", () => {
    const row = { weeklyRsAvailable: false, weeklyRsRating: null, rsGlobalPct: 10 };
    expect(screenerFilterRejectReason(row, { minRsRating: 75 })).toBe("");
  });

  it("NO rechaza un símbolo que no está en el ranking semanal, aunque rsGlobalPct esté ausente", () => {
    const row = { weeklyRsAvailable: false };
    expect(screenerFilterRejectReason(row, { minRsRating: 75 })).toBe("");
  });

  it("con minRsRating desactivado (0), no evalúa el criterio en ningún caso", () => {
    expect(screenerFilterRejectReason({ weeklyRsAvailable: true, weeklyRsRating: 1 }, { minRsRating: 0 })).toBe("");
  });

  it("el plan de explicación solo añade la regla minRsRating cuando el símbolo está en el ranking", () => {
    const inRanking = buildScreenerFilterExplainPlan({ weeklyRsAvailable: true, weeklyRsRating: 82 }, { minRsRating: 75 });
    expect([...inRanking.passed, ...inRanking.failed, ...inRanking.near, ...inRanking.missing]).toContainEqual(expect.objectContaining({ field: "minRsRating" }));

    const notInRanking = buildScreenerFilterExplainPlan({ weeklyRsAvailable: false }, { minRsRating: 75 });
    expect([...notInRanking.passed, ...notInRanking.failed, ...notInRanking.near, ...notInRanking.missing]).not.toContainEqual(expect.objectContaining({ field: "minRsRating" }));
  });
});
