// Teclado del gráfico (auditoría 2026-11, H12): ← → mover, + − zoom,
// Inicio/Fin, Esc restaurar; nunca desde un campo de texto ni con
// modificadores (no secuestra atajos del navegador).
import { describe, expect, it } from "vitest";
import { CHART_NAV_HINT, chartKeyAction } from "@/app/UniversalPriceChart";

const onCanvas = (key, extra = {}) => chartKeyAction({ key, target: { tagName: "DIV" }, ...extra });

describe("chartKeyAction", () => {
  it("mapea las teclas documentadas", () => {
    expect(onCanvas("ArrowLeft")).toEqual({ type: "pan", direction: -1 });
    expect(onCanvas("ArrowRight")).toEqual({ type: "pan", direction: 1 });
    expect(onCanvas("+").type).toBe("zoom");
    expect(onCanvas("+").factor).toBeLessThan(1);
    expect(onCanvas("-").factor).toBeGreaterThan(1);
    expect(onCanvas("Home")).toEqual({ type: "start" });
    expect(onCanvas("End")).toEqual({ type: "latest" });
    expect(onCanvas("Escape")).toEqual({ type: "reset" });
  });

  it("no actúa desde campos de texto ni con modificadores ni con teclas ajenas", () => {
    for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) {
      expect(chartKeyAction({ key: "ArrowLeft", target: { tagName } })).toBeNull();
    }
    expect(chartKeyAction({ key: "+", target: { tagName: "DIV", isContentEditable: true } })).toBeNull();
    expect(onCanvas("ArrowLeft", { metaKey: true })).toBeNull();
    expect(onCanvas("+", { ctrlKey: true })).toBeNull();
    expect(onCanvas("ArrowDown")).toBeNull();
    expect(onCanvas("j")).toBeNull();
  });

  it("las teclas viven en el tooltip", () => {
    expect(CHART_NAV_HINT).toMatch(/←.*→.*\+.*−.*Inicio.*Fin.*Esc/);
  });
});
