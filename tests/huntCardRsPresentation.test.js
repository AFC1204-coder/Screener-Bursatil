import { describe, expect, it } from "vitest";
import {
  buildHuntCardRsChip,
  huntCardRsChipLabel,
  huntCardRsCoverageFromPassedRows,
  huntCardShowsRsCoverage,
  HUNT_RS_COPY_SHORT,
  HUNT_RS_LEADERS_CARD_ID,
} from "@/lib/huntCardRsPresentation";
import { compareRowsForSort, RS_TABLE_SORT_KEY } from "@/lib/screenerPipeline";

function row(symbol, rs = null) {
  if (rs === null) return { symbol, weeklyRsAvailable: false };
  return { symbol, weeklyRsAvailable: true, weeklyRsRating: rs };
}

describe("huntCardRsPresentation", () => {
  it("solo muestra cobertura RS en Líderes Etapa 2", () => {
    expect(huntCardShowsRsCoverage({ cardId: HUNT_RS_LEADERS_CARD_ID })).toBe(true);
    expect(huntCardShowsRsCoverage({ cardId: "cerca-pivot" })).toBe(false);
    expect(huntCardShowsRsCoverage({ presetKey: "balanced", markets: ["US"] })).toBe(true);
    expect(huntCardShowsRsCoverage({ presetKey: "balanced", markets: ["CA"] })).toBe(false);
  });

  it("cuenta RS solo sobre filas que pasan la ficha", () => {
    const passed = [
      row("AAA", 80),
      row("BBB", 70),
      row("CCC"),
      row("DDD"),
    ];
    const stats = huntCardRsCoverageFromPassedRows(passed);
    expect(stats).toMatchObject({ total: 4, withRsData: 2 });
    expect(huntCardRsChipLabel(stats)).toBe("RS 2/4");
  });

  it("construye chip con copy honesto", () => {
    const chip = buildHuntCardRsChip({
      cardId: HUNT_RS_LEADERS_CARD_ID,
      passedRows: [row("AAA", 90), row("BBB")],
    });
    expect(chip).toMatchObject({
      label: "RS 1/2",
      title: HUNT_RS_COPY_SHORT,
    });
    expect(chip.stats.withRsData).toBe(1);
  });

  it("no construye chip fuera de Líderes Etapa 2", () => {
    expect(buildHuntCardRsChip({
      cardId: "deterioro",
      passedRows: [row("AAA", 90)],
    })).toBeNull();
  });
});

describe("compareRowsForSort · RS", () => {
  it("ordena con RS arriba y Sin dato al final (desc)", () => {
    const rows = [row("ZZZ"), row("AAA", 50), row("BBB", 90), row("CCC")];
    const sorted = [...rows].sort((a, b) => compareRowsForSort(a, b, {
      sort: RS_TABLE_SORT_KEY,
      sortAsc: false,
    }));
    expect(sorted.map((r) => r.symbol)).toEqual(["BBB", "AAA", "CCC", "ZZZ"]);
  });

  it("mantiene Sin dato al final también en ascendente", () => {
    const rows = [row("ZZZ"), row("AAA", 50), row("BBB", 90), row("CCC")];
    const sorted = [...rows].sort((a, b) => compareRowsForSort(a, b, {
      sort: RS_TABLE_SORT_KEY,
      sortAsc: true,
    }));
    expect(sorted.map((r) => r.symbol)).toEqual(["AAA", "BBB", "CCC", "ZZZ"]);
  });

  it("desempata por símbolo de forma estable", () => {
    const rows = [row("BBB", 80), row("AAA", 80), row("CCC", 80)];
    const sorted = [...rows].sort((a, b) => compareRowsForSort(a, b, {
      sort: RS_TABLE_SORT_KEY,
      sortAsc: false,
    }));
    expect(sorted.map((r) => r.symbol)).toEqual(["AAA", "BBB", "CCC"]);
  });
});
