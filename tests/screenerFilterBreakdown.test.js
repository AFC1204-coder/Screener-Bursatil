import { describe, expect, it } from "vitest";
import { buildScreenerFilterBreakdown } from "@/lib/screenerFilterBreakdown";

describe("buildScreenerFilterBreakdown", () => {
  it("resume preset y principal rechazo con diagnostics", () => {
    const result = buildScreenerFilterBreakdown({
      diagnostics: {
        analyzed: 3321,
        finalCount: 47,
        blocks: [{ label: "Etapa mínima", count: 2100, stage: "Filtro" }],
      },
      passCount: 47,
      presetName: "Líderes Etapa 2",
      hiddenByView: 0,
      viewChips: [],
    });
    expect(result.summaryLabel).toBe("¿Qué recorta?");
    expect(result.hasDiagnostics).toBe(true);
    expect(result.lines[0]).toBe("Ficha «Líderes Etapa 2» deja 47 de 3321");
    expect(result.lines[1]).toBe("Principal corte: Etapa mínima (−2100)");
  });

  it("menciona ocultas de vista y chips activos", () => {
    const result = buildScreenerFilterBreakdown({
      diagnostics: {
        analyzed: 100,
        finalCount: 50,
        blocks: [],
      },
      passCount: 50,
      presetName: "Líderes Etapa 2",
      hiddenByView: 12,
      viewChips: [{ label: "Tema: Semis" }, { label: "Sector: Tech" }],
    });
    expect(result.lines.some((line) => line.includes("Vista oculta 12 más"))).toBe(true);
    expect(result.lines.some((line) => line.includes("Tema: Semis"))).toBe(true);
  });

  it("sin diagnostics devuelve mensaje honesto", () => {
    const result = buildScreenerFilterBreakdown({
      diagnostics: null,
      passCount: 10,
      presetName: "Líderes Etapa 2",
      hiddenByView: 0,
      viewChips: [],
    });
    expect(result.hasDiagnostics).toBe(false);
    expect(result.lines[0]).toBe("Sin desglose del embudo; solo vista");
  });

  it("limita a tres líneas", () => {
    const result = buildScreenerFilterBreakdown({
      diagnostics: {
        analyzed: 200,
        finalCount: 40,
        blocks: [{ label: "Liquidez", count: 80 }],
      },
      passCount: 40,
      presetName: "Radar IPO",
      hiddenByView: 5,
      viewChips: [{ label: "País: Canadá" }],
    });
    expect(result.lines).toHaveLength(3);
  });
});
