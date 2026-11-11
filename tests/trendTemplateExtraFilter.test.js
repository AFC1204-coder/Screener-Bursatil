import { describe, expect, it } from "vitest";
import {
  buildScreenerFilterExplainPlan,
  screenerFilterRejectReason,
  screenerFiltersFromParams,
} from "@/lib/screenerFilters";
import {
  BOOLEAN_FILTER_KEYS,
  QUALITY_DEFAULTS,
  SCREENER_FILTER_QUERY_KEYS,
  SETTING_LAYER_DEPENDENCIES,
} from "@/lib/screenerFilterCatalog";
import { effectiveSettingsFromLayers } from "@/lib/screenerFilterLayers";

// Filtro `requireTrendTemplateExtra`: criterios 6-8 del Trend Template
// (lib/trendStructure.js → trendTemplateExtendedStatus). Apagado por defecto.

const sinPuertas = {
  setupMode: "any",
  requireStage2: false,
  filterStrictness: "discovery",
};

const cumple = { lowAdvance52w: 80, distance52w: -8, rsGlobalPct: 85 };
const con = (row) => screenerFilterRejectReason(row, { ...sinPuertas, requireTrendTemplateExtra: true });
const sin = (row) => screenerFilterRejectReason(row, { ...sinPuertas });

describe("requireTrendTemplateExtra", () => {
  it("está declarado en el catálogo y apagado por defecto", () => {
    expect(SCREENER_FILTER_QUERY_KEYS).toContain("requireTrendTemplateExtra");
    expect(BOOLEAN_FILTER_KEYS.has("requireTrendTemplateExtra")).toBe(true);
    expect(QUALITY_DEFAULTS.requireTrendTemplateExtra).toBe(false);
    expect(SETTING_LAYER_DEPENDENCIES.requireTrendTemplateExtra.layer).toBe("trend");
  });

  it("se lee de la URL como booleano", () => {
    const f = screenerFiltersFromParams({ requireTrendTemplateExtra: "true" });
    expect(f.values.requireTrendTemplateExtra).toBe(true);
  });

  it("deja pasar a quien cumple los tres criterios", () => {
    expect(con(cumple)).toBe("");
  });

  it("rechaza con el campo y el motivo cuando falla cada criterio", () => {
    expect(con({ ...cumple, lowAdvance52w: 12 })).toMatchObject({ field: "requireTrendTemplateExtra" });
    expect(con({ ...cumple, lowAdvance52w: 12 }).reason).toMatch(/12 % sobre el mínimo/);
    expect(con({ ...cumple, distance52w: -40 }).reason).toMatch(/40 % del máximo/);
    expect(con({ ...cumple, rsGlobalPct: 50 }).reason).toMatch(/RS 50/);
  });

  it("rechaza el dato ausente y lo dice, en lugar de dejarlo pasar", () => {
    const r = con({ ...cumple, lowAdvance52w: null });
    expect(r).toMatchObject({ field: "requireTrendTemplateExtra" });
    expect(r.reason).toMatch(/sin dato/);
  });

  it("el «casi cumple» (25-30 %) sigue rechazando, pero lo indica", () => {
    const r = con({ ...cumple, lowAdvance52w: 27 });
    expect(r).toBeTruthy();
    expect(r.reason).toMatch(/casi cumple/);
  });

  it("apagado, la misma fila fallida no se rechaza por este filtro", () => {
    const mala = { ...cumple, lowAdvance52w: 5, rsGlobalPct: 10 };
    expect(sin(mala)?.field).not.toBe("requireTrendTemplateExtra");
  });

  it("aparece en el plan de explicación como regla con su estado", () => {
    const plan = JSON.stringify(buildScreenerFilterExplainPlan({ ...cumple, lowAdvance52w: 5 }, { ...sinPuertas, requireTrendTemplateExtra: true }));
    expect(plan).toContain("requireTrendTemplateExtra");
    expect(plan).toContain("Plantilla 6-8");
  });

  it("la capa Tendencia apagada lo desactiva", () => {
    const eff = effectiveSettingsFromLayers({ requireTrendTemplateExtra: true }, { trend: false });
    expect(eff.requireTrendTemplateExtra).toBe(false);
  });
});
