import { describe, expect, it } from "vitest";
import { trendTemplateIssue } from "@/lib/trendStructure";

const complete = { price: 100, sma50: 95, sma150: 90, sma200: 80, sma200Slope: 2 };

describe("trendTemplateIssue · dato ausente = no cumple (sin dato)", () => {
  it("fila completa y sana: cumple", () => {
    expect(trendTemplateIssue(complete)).toBe("");
  });

  it("fila vacía o con solo precio ya no pasa en silencio", () => {
    expect(trendTemplateIssue({})).toMatch(/sin dato$/);
    expect(trendTemplateIssue({ price: 10 })).toMatch(/SMA50 diaria.*sin dato$/);
  });

  it("nombra lo que falta (SMA50 nula con el resto sano)", () => {
    expect(trendTemplateIssue({ ...complete, sma50: null })).toBe("SMA50 diaria sin dato");
  });

  it("falta la pendiente: sin dato, no «sube»", () => {
    expect(trendTemplateIssue({ ...complete, sma200Slope: undefined })).toBe("Pendiente SMA200 sin dato");
  });

  it("con todos los datos sigue marcando el fallo concreto", () => {
    expect(trendTemplateIssue({ ...complete, price: 90 })).toBe("Precio bajo SMA50 diaria");
    expect(trendTemplateIssue({ ...complete, sma200Slope: -1 })).toBe("SMA200 diaria no sube");
  });
});
