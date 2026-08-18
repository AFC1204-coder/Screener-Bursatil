// tests/volumeDivergence.test.js — divergencia con el umbral del briefing
// (docs/diseno-indicadores-mercado-2026-08-17.md, C.3 #4).
//
// El briefing compara la frecuencia del baremo "índice > 0 % y
// participación < 0 pp" (39 % de las sesiones) con la del umbral
// "índice ≥ +2 % y participación ≤ −5 pp a 20 semanas" (10 % de las
// sesiones). Aquí se prueba que la función aplica el umbral correctamente.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_DIVERGENCE_THRESHOLD,
  applyThreshold,
  divergenceFactText,
  divergenceWithThreshold,
  legacyDivergence,
} from "@/lib/volumeDivergence";

function summary({
  weeks = 20,
  indexChangePct = 0,
  participationDeltaPp = 0,
  participationStartPct = 50,
  participationEndPct = 50,
  divergence = false,
} = {}) {
  return {
    weeks,
    fromDate: "2026-03-15",
    toDate: "2026-08-14",
    indexChangePct,
    participationStartPct,
    participationEndPct,
    participationDeltaPp,
    divergence,
  };
}

describe("divergenceWithThreshold", () => {
  it("devuelve el umbral del briefing por defecto", () => {
    const out = divergenceWithThreshold(summary({ indexChangePct: 2.5, participationDeltaPp: -5.5, weeks: 20 }));
    expect(out.threshold).toEqual(DEFAULT_DIVERGENCE_THRESHOLD);
    expect(out.thresholdMet).toBe(true);
  });

  it("NO dispara si el índice no llega al +2%", () => {
    const out = divergenceWithThreshold(summary({ indexChangePct: 1.5, participationDeltaPp: -6, weeks: 20 }));
    expect(out.thresholdMet).toBe(false);
  });

  it("NO dispara si la participación no baja −5 pp", () => {
    const out = divergenceWithThreshold(summary({ indexChangePct: 4, participationDeltaPp: -3, weeks: 20 }));
    expect(out.thresholdMet).toBe(false);
  });

  it("SÍ dispara cuando ambos se cumplen en 20 semanas", () => {
    const out = divergenceWithThreshold(summary({ indexChangePct: 2.5, participationDeltaPp: -5.5, weeks: 20 }));
    expect(out.thresholdMet).toBe(true);
  });

  it("NO dispara si la ventana es insuficiente", () => {
    const out = divergenceWithThreshold(summary({ indexChangePct: 5, participationDeltaPp: -10, weeks: 12 }));
    expect(out.thresholdMet).toBe(false);
  });

  it("respeta overrides del umbral", () => {
    const out = divergenceWithThreshold(summary({ indexChangePct: 1, participationDeltaPp: -2, weeks: 20 }), { indexUpPct: 0.5, participationDownPp: -1 });
    expect(out.threshold.indexUpPct).toBe(0.5);
    expect(out.threshold.participationDownPp).toBe(-1);
    expect(out.thresholdMet).toBe(true);
  });

  it("puede apagarse desde summary nulo", () => {
    expect(divergenceWithThreshold(null)).toBe(null);
  });
});

describe("legacyDivergence", () => {
  it("mantiene el baremo antiguo retrocompatible", () => {
    const out = legacyDivergence(summary({ indexChangePct: 1, participationDeltaPp: -3, divergence: true }));
    expect(out.threshold).toBe(null);
    expect(out.thresholdMet).toBe(true);
  });

  it("devuelve null si no hay summary", () => {
    expect(legacyDivergence(null)).toBe(null);
  });
});

describe("applyThreshold", () => {
  it("aplica el umbral por defecto", () => {
    const out = applyThreshold(summary({ indexChangePct: 2.5, participationDeltaPp: -5.5, weeks: 20 }));
    expect(out.threshold).toEqual(DEFAULT_DIVERGENCE_THRESHOLD);
    expect(out.thresholdMet).toBe(true);
  });

  it("puede desactivarse con threshold: false", () => {
    const out = applyThreshold(summary({ indexChangePct: 1, participationDeltaPp: -3, divergence: true }), { threshold: false });
    expect(out.threshold).toBe(null);
    expect(out.thresholdMet).toBe(true);
  });

  it("null in, null out", () => {
    expect(applyThreshold(null)).toBe(null);
  });
});

describe("divergenceFactText", () => {
  it("devuelve un texto descriptivo con el veredicto del umbral", () => {
    const s = applyThreshold(summary({ indexChangePct: 2.5, participationDeltaPp: -5.5, weeks: 20 }));
    const fact = divergenceFactText(s);
    expect(fact).not.toBe(null);
    expect(fact.text).toContain("20 semanas");
    expect(fact.text).toContain("+2.50%");
    expect(fact.text).toContain("-5.50 pp");
    expect(fact.text).toContain("cumple el umbral");
  });

  it("declara cuando NO se cumple el umbral", () => {
    const s = applyThreshold(summary({ indexChangePct: 1, participationDeltaPp: -2, weeks: 20 }));
    const fact = divergenceFactText(s);
    expect(fact.text).toContain("no alcanza el umbral");
    expect(fact.thresholdMet).toBe(false);
  });

  it("devuelve null si no hay umbral aplicado", () => {
    expect(divergenceFactText(legacyDivergence(summary({ divergence: true })))).toBe(null);
  });
});
