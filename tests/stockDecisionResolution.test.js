import { describe, expect, it } from "vitest";
import {
  applyStockDecisionResolution,
  buildStockDecisionResolutionNote,
  buildStockDecisionResolutionSummary,
  decisionResolutionHistory,
  decisionResolutionForSymbol,
  filterRowsByDecisionResolution,
  reopenStockDecisionResolution,
  reviewDecisionStateForRows,
  stockDecisionValidationState,
} from "@/lib/stockDecisionResolution";

describe("stock decision resolution", () => {
  it("marca una candidata como revisada sin ocultarla", () => {
    const review = applyStockDecisionResolution({
      reviewedSymbols: ["OLD"],
      hiddenSymbols: ["TEST"],
    }, {
      symbol: "test",
      actionKey: "candidate",
      source: "stock",
      note: "Setup limpio",
      at: "2026-06-17T10:00:00.000Z",
    });

    expect(review.reviewedSymbols).toEqual(["OLD", "TEST"]);
    expect(review.hiddenSymbols).toEqual([]);
    expect(decisionResolutionForSymbol(review, "TEST")).toEqual({
      key: "candidate",
      label: "Candidata",
      detail: "Mantener en seguimiento activo",
      tone: "good",
      source: "stock",
      note: "Setup limpio",
      updatedAt: "2026-06-17T10:00:00.000Z",
    });
    expect(decisionResolutionHistory(review, { symbol: "test" })).toEqual([{
      symbol: "TEST",
      key: "candidate",
      label: "Candidata",
      detail: "Mantener en seguimiento activo",
      tone: "good",
      source: "stock",
      note: "Setup limpio",
      updatedAt: "2026-06-17T10:00:00.000Z",
    }]);
  });

  it("descartar deja la acción revisada y oculta en Review", () => {
    const review = applyStockDecisionResolution({}, {
      symbol: "DROP",
      actionKey: "reject",
      at: "2026-06-17T10:00:00.000Z",
    });

    expect(review.reviewedSymbols).toEqual(["DROP"]);
    expect(review.hiddenSymbols).toEqual(["DROP"]);
    expect(decisionResolutionForSymbol(review, "drop")).toMatchObject({
      key: "reject",
      label: "Descartar",
      tone: "bad",
    });
  });

  it("ignora acciones inválidas sin mutar el review", () => {
    const original = { reviewedSymbols: ["A"] };

    expect(applyStockDecisionResolution(original, { symbol: "A", actionKey: "noop" })).toBe(original);
  });

  it("compone notas de validación de foco para el historial de ficha", () => {
    expect(stockDecisionValidationState("validated")).toMatchObject({
      label: "Validado",
      tone: "good",
    });
    expect(stockDecisionValidationState("unknown")).toMatchObject({
      key: "pending",
      label: "Pendiente",
    });
    expect(buildStockDecisionResolutionNote({
      validationKey: "validated",
      focusLabel: "Setup accionable",
      comment: "Volumen confirma el pivot",
    })).toBe("Validado: Setup accionable · Volumen confirma el pivot");
    expect(buildStockDecisionResolutionNote({
      validationKey: "blocked",
      focusLabel: "Precio perseguible",
      comment: "Demasiado extendida para entrada limpia",
    })).toBe("Bloquea: Precio perseguible · Demasiado extendida para entrada limpia");
  });

  it("resume pendientes y resoluciones por orden de cola", () => {
    const review = {
      decisionResolutions: {
        AAA: { key: "candidate", label: "Candidata" },
        CCC: { key: "watch", label: "Vigilar" },
      },
    };
    const rows = [{ symbol: "AAA" }, { symbol: "BBB" }, { symbol: "CCC" }];

    expect(buildStockDecisionResolutionSummary(rows, review)).toEqual([
      { key: "all", label: "Todas", tone: "neutral", count: 3, firstIndex: 0, sampleSymbols: ["AAA", "BBB", "CCC"] },
      { key: "pending", label: "Pendientes", tone: "neutral", count: 1, firstIndex: 1, sampleSymbols: ["BBB"] },
      { key: "candidate", label: "Candidata", tone: "good", count: 1, firstIndex: 0, sampleSymbols: ["AAA"] },
      { key: "watch", label: "Vigilar", tone: "warn", count: 1, firstIndex: 2, sampleSymbols: ["CCC"] },
    ]);
  });

  it("filtra filas por resolución de ficha", () => {
    const review = {
      decisionResolutions: {
        AAA: { key: "candidate" },
        CCC: { key: "watch" },
      },
    };
    const rows = [{ symbol: "AAA" }, { symbol: "BBB" }, { symbol: "CCC" }];

    expect(filterRowsByDecisionResolution(rows, review, "all").map((row) => row.symbol)).toEqual(["AAA", "BBB", "CCC"]);
    expect(filterRowsByDecisionResolution(rows, review, "pending").map((row) => row.symbol)).toEqual(["BBB"]);
    expect(filterRowsByDecisionResolution(rows, review, "watch").map((row) => row.symbol)).toEqual(["CCC"]);
    expect(filterRowsByDecisionResolution(rows, review, "unknown").map((row) => row.symbol)).toEqual(["AAA", "BBB", "CCC"]);
  });

  it("mantiene un historial ordenado y compatible con resoluciones legacy", () => {
    const first = applyStockDecisionResolution({}, {
      symbol: "AAA",
      actionKey: "watch",
      source: "stock",
      note: "Falta volumen",
      at: "2026-06-17T10:00:00.000Z",
    });
    const second = applyStockDecisionResolution(first, {
      symbol: "AAA",
      actionKey: "candidate",
      source: "stock",
      note: "Pivot recuperado",
      at: "2026-06-17T11:00:00.000Z",
    });
    const third = applyStockDecisionResolution(second, {
      symbol: "BBB",
      actionKey: "reject",
      source: "stock",
      at: "2026-06-17T12:00:00.000Z",
    });

    expect(decisionResolutionHistory(third, { symbol: "AAA" }).map((entry) => entry.key)).toEqual(["candidate", "watch"]);
    expect(decisionResolutionHistory(third, { limit: 2 }).map((entry) => `${entry.symbol}:${entry.key}`)).toEqual(["BBB:reject", "AAA:candidate"]);

    expect(decisionResolutionHistory({
      decisionResolutions: {
        OLD: {
          key: "watch",
          label: "Vigilar",
          detail: "No es entrada limpia todavía",
          tone: "warn",
          source: "stock",
          note: "Legacy",
          updatedAt: "2026-06-17T09:00:00.000Z",
        },
      },
    })).toEqual([{
      symbol: "OLD",
      key: "watch",
      label: "Vigilar",
      detail: "No es entrada limpia todavía",
      tone: "warn",
      source: "stock",
      note: "Legacy",
      updatedAt: "2026-06-17T09:00:00.000Z",
    }]);
  });

  it("reabre una decisión y devuelve la acción a pendiente visible", () => {
    const rejected = applyStockDecisionResolution({
      reviewedSymbols: ["DROP"],
      hiddenSymbols: [],
    }, {
      symbol: "drop",
      actionKey: "reject",
      at: "2026-06-17T10:00:00.000Z",
    });
    const reopened = reopenStockDecisionResolution(rejected, {
      symbol: "DROP",
      source: "review",
      note: "Volver a mirar",
      at: "2026-06-17T11:00:00.000Z",
    });

    expect(reopened.reviewedSymbols).toEqual([]);
    expect(reopened.hiddenSymbols).toEqual([]);
    expect(decisionResolutionForSymbol(reopened, "drop")).toBeNull();
    expect(filterRowsByDecisionResolution([{ symbol: "DROP" }], reopened, "pending").map((row) => row.symbol)).toEqual(["DROP"]);
    expect(decisionResolutionHistory(reopened, { symbol: "DROP" }).map((entry) => entry.key)).toEqual(["reopen", "reject"]);
    expect(decisionResolutionHistory(reopened, { symbol: "DROP" })[0]).toMatchObject({
      label: "Reabierta",
      source: "review",
      note: "Volver a mirar",
    });
  });

  it("preserva el estado de decisión solo para símbolos de la nueva cola", () => {
    const review = {
      reviewedSymbols: ["AAA", "OLD"],
      hiddenSymbols: ["CCC", "OLD"],
      decisionResolutions: {
        AAA: { key: "candidate", label: "Candidata", updatedAt: "2026-06-17T10:00:00.000Z" },
        CCC: { key: "reject", label: "Descartar", updatedAt: "2026-06-17T11:00:00.000Z" },
        OLD: { key: "watch", label: "Vigilar", updatedAt: "2026-06-17T12:00:00.000Z" },
      },
      decisionResolutionLog: [
        { symbol: "OLD", key: "watch", label: "Vigilar", updatedAt: "2026-06-17T12:00:00.000Z" },
        { symbol: "CCC", key: "reject", label: "Descartar", updatedAt: "2026-06-17T11:00:00.000Z" },
        { symbol: "AAA", key: "candidate", label: "Candidata", updatedAt: "2026-06-17T10:00:00.000Z" },
      ],
    };

    expect(reviewDecisionStateForRows(review, [{ symbol: "AAA" }, { symbol: "BBB" }, { symbol: "CCC" }])).toEqual({
      reviewedSymbols: ["AAA", "CCC"],
      hiddenSymbols: ["CCC"],
      decisionResolutions: {
        AAA: {
          key: "candidate",
          label: "Candidata",
          detail: "Mantener en seguimiento activo",
          tone: "good",
          source: "stock",
          note: "",
          updatedAt: "2026-06-17T10:00:00.000Z",
        },
        CCC: {
          key: "reject",
          label: "Descartar",
          detail: "Sacar de la cola visible",
          tone: "bad",
          source: "stock",
          note: "",
          updatedAt: "2026-06-17T11:00:00.000Z",
        },
      },
      decisionResolutionLog: [
        {
          symbol: "CCC",
          key: "reject",
          label: "Descartar",
          detail: "Sacar de la cola visible",
          tone: "bad",
          source: "stock",
          note: "",
          updatedAt: "2026-06-17T11:00:00.000Z",
        },
        {
          symbol: "AAA",
          key: "candidate",
          label: "Candidata",
          detail: "Mantener en seguimiento activo",
          tone: "good",
          source: "stock",
          note: "",
          updatedAt: "2026-06-17T10:00:00.000Z",
        },
      ],
    });
  });
});
