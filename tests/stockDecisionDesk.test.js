import { describe, expect, it } from "vitest";
import { buildStockDecisionDesk } from "@/lib/stockDecisionDesk";

const baseOrigin = {
  sourceLabel: "Review · Screener actual",
  readiness: { key: "watch", label: "Vigilar" },
  decisionProfile: { key: "operable-fragile", label: "Operable fragil", tone: "warn" },
  decisionBrief: {
    thesis: { label: "Tesis", value: "Setup 82", detail: "RS fuerte", tone: "good" },
    risk: { label: "Riesgo", value: "Vigilar", detail: "Falta volumen", tone: "warn" },
    nextAction: { label: "Siguiente", value: "Esperar confirmación", detail: "Validar demanda", tone: "warn" },
  },
  decisionTrace: {
    evidence: {
      status: "needs-work",
      tone: "warn",
      passedCount: 3,
      totalCount: 6,
      pending: [
        { key: "setup-accionable", label: "Setup accionable", detail: "Falta punto limpio", tone: "warn" },
        { key: "demanda-volumen", label: "Demanda/volumen", detail: "Falta volumen", tone: "warn" },
      ],
      items: [
        { key: "liderazgo-global", label: "Liderazgo global", status: "confirmed", detail: "RS 88", tone: "good" },
      ],
    },
  },
};

describe("buildStockDecisionDesk", () => {
  it("convierte evidencia pendiente en lectura de grafico accionable", () => {
    const desk = buildStockDecisionDesk({
      origin: baseOrigin,
      chartSettings: {
        range: "1D",
        interval: "5m",
        indicators: { volume: false, rsLine: false },
      },
      setupPattern: { pivotPrice: 100 },
      setupDisplay: {},
      rsUniverse: 88,
      activeBenchmark: "SPY",
      showVcpDiagnostics: false,
    });

    expect(desk.status).toBe("Pendiente");
    expect(desk.guardrail).toMatchObject({
      title: "Apoyo de observación, no señal automática",
    });
    expect(desk.observationChecklist.map((item) => item.key)).toEqual(["method", "focus", "evidence", "chart"]);
    expect(desk.observationChecklist[0]).toMatchObject({
      label: "Criterio propio",
      value: "Obligatorio",
    });
    expect(desk.ratio).toBe("3/6");
    expect(desk.presetKey).toBe("entry");
    expect(desk.activePresetKey).toBe("");
    expect(desk.pending.map((item) => item.key)).toContain("setup-accionable");
    expect(desk.pending.find((item) => item.key === "setup-accionable")).toMatchObject({
      focusPresetKey: "entry",
      focusLabel: "Entrada",
    });
    expect(desk.pending.find((item) => item.key === "demanda-volumen")).toMatchObject({
      focusPresetKey: "entry",
      focusLabel: "Demanda",
    });
    expect(desk.chartRead.map((item) => item.key)).toEqual(expect.arrayContaining(["interval", "range", "rs-line", "volume", "vcp"]));
    expect(desk.metrics).toContainEqual({ key: "bench", label: "Benchmark", value: "SPY" });
  });

  it("prioriza el foco enviado desde Review en la mesa de ficha", () => {
    const desk = buildStockDecisionDesk({
      origin: {
        ...baseOrigin,
        decisionFocus: {
          state: "blocked",
          stateLabel: "Bloqueada",
          filterLabel: "Bloqueadas",
          ratio: "4/6",
          label: "Precio perseguible",
          tone: "bad",
          instruction: "Resolver bloqueo antes de marcarla como candidata.",
          check: {
            key: "precio-perseguible",
            label: "Precio perseguible",
            detail: "El precio esta demasiado extendido.",
            tone: "bad",
          },
        },
      },
      chartSettings: {
        range: "1A",
        interval: "D",
        indicators: { volume: true, rsLine: true },
      },
      setupPattern: { pivotPrice: 100 },
      setupDisplay: {},
    });

    expect(desk.decisionFocus).toMatchObject({
      state: "blocked",
      stateLabel: "Bloqueada",
      filterLabel: "Bloqueadas",
      ratio: "4/6",
      label: "Precio perseguible",
      focusPresetKey: "entry",
      focusLabel: "Entrada",
    });
    expect(desk.focus).toMatch(/Precio perseguible/);
    expect(desk.focus).toMatch(/Resolver bloqueo/);
  });

  it("marca la lectura como alineada cuando la ficha ya muestra las capas necesarias", () => {
    const desk = buildStockDecisionDesk({
      origin: {
        ...baseOrigin,
        decisionTrace: {
          evidence: {
            status: "ready",
            tone: "good",
            passedCount: 6,
            totalCount: 6,
            pending: [],
            items: [
              { key: "setup-accionable", label: "Setup accionable", status: "confirmed", detail: "Plan valido", tone: "good" },
              { key: "liderazgo-global", label: "Liderazgo global", status: "confirmed", detail: "RS 91", tone: "good" },
              { key: "demanda-volumen", label: "Demanda/volumen", status: "confirmed", detail: "RelVol 2x", tone: "good" },
            ],
          },
        },
      },
      chartSettings: {
        range: "1A",
        interval: "D",
        indicators: { volume: true, rsLine: true },
      },
      setupPattern: { pivotPrice: 100 },
      setupDisplay: {},
      rsUniverse: 91,
      showVcpDiagnostics: true,
    });

    expect(desk.status).toBe("Listo");
    expect(desk.presetKey).toBe("entry");
    expect(desk.activePresetKey).toBe("decision");
    expect(desk.pending).toEqual([]);
    expect(desk.confirmed.find((item) => item.key === "liderazgo-global")).toMatchObject({
      focusPresetKey: "decision",
      focusLabel: "Liderazgo",
    });
    expect(desk.chartRead).toEqual([
      { key: "aligned", label: "Lectura gráfico", value: "Alineada", detail: "Marco y capas coherentes con la observación", tone: "good" },
    ]);
  });

  it("muestra guardrail metodologico aunque el origen no traiga trace completo", () => {
    const desk = buildStockDecisionDesk({
      origin: {
        sourceLabel: "Review · Trabajo pendiente",
        sourceDetail: "Cola manual sin traza completa",
        readiness: { key: "watch", label: "Vigilar", detail: "Revisar manualmente" },
        statusText: "Sin decidir · prioridad decision",
        text: "Contexto de screener restaurado.",
      },
      chartSettings: {
        range: "1A",
        interval: "D",
        indicators: { volume: true, rsLine: true },
      },
      setupDisplay: {},
    });

    expect(desk.guardrail.title).toBe("Apoyo de observación, no señal automática");
    expect(desk.sourceLabel).toBe("Review · Trabajo pendiente");
    expect(desk.status).toBe("Vigilar");
    expect(desk.brief).toEqual([]);
    expect(desk.observationChecklist.find((item) => item.key === "method")).toMatchObject({
      label: "Criterio propio",
      value: "Obligatorio",
    });
  });
});
