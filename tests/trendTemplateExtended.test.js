import { describe, expect, it } from "vitest";
import { trendTemplateExtendedStatus, trendTemplateIssue } from "@/lib/trendStructure";

const ok = { lowAdvance52w: 80, distance52w: -8, rsGlobalPct: 85 };

describe("trendTemplateExtendedStatus · criterios 6-8", () => {
  it("cumple los tres", () => {
    expect(trendTemplateExtendedStatus(ok)).toEqual({ pass: true, nearMiss: false, issues: [] });
  });

  it("6: bajo el 30 % sobre el mínimo falla; entre 25 y 30 es «casi cumple»", () => {
    const lejos = trendTemplateExtendedStatus({ ...ok, lowAdvance52w: 12 });
    expect(lejos.pass).toBe(false);
    expect(lejos.nearMiss).toBe(false);
    expect(lejos.issues[0]).toMatch(/12 % sobre el mínimo/);
    const casi = trendTemplateExtendedStatus({ ...ok, lowAdvance52w: 27 });
    expect(casi.pass).toBe(false);
    expect(casi.nearMiss).toBe(true);
  });

  it("6: el umbral exacto del 30 % cumple y el del 25 % es casi", () => {
    expect(trendTemplateExtendedStatus({ ...ok, lowAdvance52w: 30 }).pass).toBe(true);
    expect(trendTemplateExtendedStatus({ ...ok, lowAdvance52w: 25 }).nearMiss).toBe(true);
    expect(trendTemplateExtendedStatus({ ...ok, lowAdvance52w: 24.9 }).nearMiss).toBe(false);
  });

  it("«casi cumple» no tapa otro fallo: con RS baja deja de ser casi", () => {
    const r = trendTemplateExtendedStatus({ ...ok, lowAdvance52w: 27, rsGlobalPct: 40 });
    expect(r.pass).toBe(false);
    expect(r.nearMiss).toBe(false);
    expect(r.issues).toHaveLength(2);
  });

  it("7: más de un 25 % bajo el máximo falla, justo 25 % cumple", () => {
    expect(trendTemplateExtendedStatus({ ...ok, distance52w: -26 }).issues[0]).toMatch(/26 % del máximo/);
    expect(trendTemplateExtendedStatus({ ...ok, distance52w: -25 }).pass).toBe(true);
  });

  it("8: RS por debajo de 70 falla, 70 cumple", () => {
    expect(trendTemplateExtendedStatus({ ...ok, rsGlobalPct: 69 }).issues[0]).toMatch(/RS 69/);
    expect(trendTemplateExtendedStatus({ ...ok, rsGlobalPct: 70 }).pass).toBe(true);
  });

  it("dato ausente = no cumple, y lo nombra como «sin dato»", () => {
    const r = trendTemplateExtendedStatus({});
    expect(r.pass).toBe(false);
    expect(r.issues).toHaveLength(3);
    r.issues.forEach((issue) => expect(issue).toMatch(/sin dato$/));
  });

  it("lee también de row.metrics, como el resto del módulo", () => {
    expect(trendTemplateExtendedStatus({ metrics: ok }).pass).toBe(true);
  });

  it("no altera las seis condiciones diarias del Pulso", () => {
    const diaria = { price: 100, sma50: 95, sma150: 90, sma200: 80, sma200Slope: 2 };
    expect(trendTemplateIssue(diaria)).toBe("");
    expect(trendTemplateIssue({ ...diaria, ...ok, rsGlobalPct: 10 })).toBe("");
  });
});
