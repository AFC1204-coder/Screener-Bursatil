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
