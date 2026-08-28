import { describe, expect, it } from "vitest";
import { SCREENER_FILTER_PRESETS } from "@/lib/screenerFilterCatalog";
import { DEFAULT_PERFORMANCE_PERIOD } from "@/lib/screenerPeriods";
import {
  HUNT_CARDS,
  huntCardSelection,
  huntDisplayName,
  optionalBasePresetEntries,
  resolveActiveHuntCard,
} from "@/lib/screenerHuntCards";

describe("HUNT_CARDS", () => {
  it("expone exactamente 5 fichas de caza mapeadas a presets reales", () => {
    expect(HUNT_CARDS).toHaveLength(5);
    expect(HUNT_CARDS.map((card) => [card.id, card.label, card.presetKey])).toEqual([
      ["lideres-etapa-2", "Líderes Etapa 2", "balanced"],
      ["cerca-pivot", "Cerca de pivot", "nearPivot"],
      ["deterioro", "Deterioro", "weakness"],
      ["lideres-intl", "Líderes intl", "intl"],
      ["radar-ipo", "Radar IPO", "ipoDiscovery"],
    ]);
    for (const card of HUNT_CARDS) {
      expect(SCREENER_FILTER_PRESETS[card.presetKey]).toBeTruthy();
    }
  });

  it("deja strict, early, broad e ipo institucional fuera del rail diario", () => {
    const keys = optionalBasePresetEntries().map(([key]) => key);
    expect(keys).toEqual(["strict", "early", "broad", "ipo"]);
    expect(HUNT_CARDS.some((card) => keys.includes(card.presetKey))).toBe(false);
  });
});

describe("resolveActiveHuntCard", () => {
  it("US + balanced → Líderes Etapa 2", () => {
    expect(resolveActiveHuntCard("balanced", ["US"])?.id).toBe("lideres-etapa-2");
  });

  it("sin US + balanced → Líderes intl (auto-switch)", () => {
    expect(resolveActiveHuntCard("balanced", ["CA"])?.id).toBe("lideres-intl");
    expect(resolveActiveHuntCard("nearPivot", ["HK", "GB"])?.id).toBe("lideres-intl");
  });

  it("US + intl a mano sigue en Líderes intl (el restore lo hace el cambio de mercados)", () => {
    expect(resolveActiveHuntCard("intl", ["US"])?.id).toBe("lideres-intl");
    expect(resolveActiveHuntCard("intl", ["US", "CA"])?.id).toBe("lideres-intl");
  });

  it("mapea nearPivot, weakness e ipoDiscovery cuando el auto-switch no aplica", () => {
    expect(resolveActiveHuntCard("nearPivot", ["US"])?.id).toBe("cerca-pivot");
    expect(resolveActiveHuntCard("weakness", ["US"])?.id).toBe("deterioro");
    expect(resolveActiveHuntCard("weakness", ["CA"])?.id).toBe("deterioro");
    expect(resolveActiveHuntCard("ipoDiscovery", ["US"])?.id).toBe("radar-ipo");
    expect(resolveActiveHuntCard("ipo", ["US"])?.id).toBe("radar-ipo");
    expect(resolveActiveHuntCard("intl", ["CA"])?.id).toBe("lideres-intl");
  });

  it("presets fuera del rail no activan ficha", () => {
    expect(resolveActiveHuntCard("strict", ["US"])).toBeNull();
    expect(resolveActiveHuntCard("early", ["US"])).toBeNull();
    expect(resolveActiveHuntCard("broad", ["CA"])).toBeNull();
  });
});

describe("huntDisplayName", () => {
  it("usa el label de la ficha activa, no el nombre interno del preset", () => {
    expect(huntDisplayName("balanced", ["US"])).toBe("Líderes Etapa 2");
    expect(huntDisplayName("nearPivot", ["US"])).toBe("Cerca de pivot");
    expect(SCREENER_FILTER_PRESETS.balanced.name).toBe("Balanceado");
  });

  it("cae al nombre del preset si no hay ficha", () => {
    expect(huntDisplayName("strict", ["US"])).toBe("Líderes estrictos");
    expect(huntDisplayName("unknown", ["US"])).toBe("Filtro");
  });
});

describe("huntCardSelection", () => {
  it("Líderes Etapa 2 e intl siguen el periodo de rendimiento activo", () => {
    expect(huntCardSelection("lideres-etapa-2", { perfPeriod: "perf6m" })).toEqual({
      presetKey: "balanced",
      sort: "perf6m",
      sortAsc: false,
    });
    expect(huntCardSelection("lideres-intl", { perfPeriod: "perf12m" }).sort).toBe("perf12m");
    expect(huntCardSelection("radar-ipo", { perfPeriod: DEFAULT_PERFORMANCE_PERIOD }).sort).toBe(
      DEFAULT_PERFORMANCE_PERIOD,
    );
  });

  it("Cerca de pivot ordena por Dist. máx 52s (cerca del máximo)", () => {
    expect(huntCardSelection("cerca-pivot")).toEqual({
      presetKey: "nearPivot",
      sort: "distance52w",
      sortAsc: false,
    });
  });

  it("Deterioro ordena por weaknessScore", () => {
    expect(huntCardSelection("deterioro")).toEqual({
      presetKey: "weakness",
      sort: "weaknessScore",
      sortAsc: false,
    });
  });

  it("id desconocido → null", () => {
    expect(huntCardSelection("no-existe")).toBeNull();
  });
});
