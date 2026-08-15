import { describe, expect, it } from "vitest";
import { buildReviewQueueNavigation, reviewQueueSourceLabel } from "@/lib/reviewQueueNavigation";

const strongRow = {
  symbol: "AAA",
  price: 50,
  chartBarsCount: 260,
  priceFreshnessOk: true,
  dataCoverageScore: 82,
  technicalCoverageScore: 88,
  fundamentalCoverageScore: 64,
  totalScore: 82,
  rsGlobalPct: 90,
  rsSectorPct: 82,
  rsQualityScore: 78,
  weinsteinScore: 86,
  minerviniScore: 82,
  volumeEffectScore: 76,
  adProxyScore: 74,
  growthScore: 70,
  epsGrowthProxyScore: 68,
  riskRewardScore: 72,
  weaknessScore: 12,
  extSma50: 10,
  setupDisplayPlanValid: true,
};

function row(symbol, patch = {}) {
  return { ...strongRow, symbol, ...patch };
}

describe("buildReviewQueueNavigation", () => {
  it("respeta ocultas, resoluciones y filtro de pruebas activo", () => {
    const navigation = buildReviewQueueNavigation({
      source: "current",
      rows: [
        row("READY"),
        row("BLOCK", {
          decisionProjectionPartial: true,
          decisionProjectionMissing: ["chartBarsCount", "price"],
        }),
        row("HIDE"),
      ],
      hiddenSymbols: ["HIDE"],
      decisionResolutions: {
        READY: { key: "candidate", label: "Candidata" },
      },
      resolutionFilter: "pending",
      digestFilter: "blocked",
    }, "BLOCK");

    expect(navigation.sourceLabel).toBe("Screener actual");
    expect(navigation.filterLabel).toBe("Pendientes · Bloqueadas");
    expect(navigation.totalRows).toBe(3);
    expect(navigation.baseVisibleCount).toBe(2);
    expect(navigation.visibleCount).toBe(1);
    expect(navigation.currentIndex).toBe(0);
    expect(navigation.positionLabel).toBe("1/1");
    expect(navigation.items.map((item) => item.symbol)).toEqual(["BLOCK"]);
    expect(navigation.nextSymbol).toBe("");
    expect(navigation.reviewHref).toBe("/review?source=current&symbol=BLOCK");
  });

  it("calcula anterior y siguiente dentro de la cola visible", () => {
    const navigation = buildReviewQueueNavigation({
      source: "latest",
      rows: [row("AAA"), row("BBB"), row("CCC")],
    }, "BBB");

    expect(navigation.sourceLabel).toBe("Último snapshot");
    expect(navigation.positionLabel).toBe("2/3");
    expect(navigation.previousSymbol).toBe("AAA");
    expect(navigation.previousHref).toBe("/stock/AAA");
    expect(navigation.nextSymbol).toBe("CCC");
    expect(navigation.nextHref).toBe("/stock/CCC");
  });

  it("usa etiqueta personalizada para colas derivadas del Screener actual", () => {
    const navigation = buildReviewQueueNavigation({
      source: "current",
      sourceLabel: "Trabajo pendiente",
      rows: [row("AAA"), row("BBB")],
    }, "AAA");

    expect(navigation.sourceLabel).toBe("Trabajo pendiente");
    expect(navigation.reviewHref).toBe("/review?source=current&symbol=AAA");
    expect(reviewQueueSourceLabel("latest", { sourceLabel: "Trabajo pendiente" })).toBe("Último snapshot");
  });

  it("redirige el retorno a Review al primer visible si el actual queda fuera del filtro", () => {
    const navigation = buildReviewQueueNavigation({
      source: "current",
      rows: [
        row("READY"),
        row("BLOCK", {
          decisionProjectionPartial: true,
          decisionProjectionMissing: ["price"],
        }),
      ],
      digestFilter: "blocked",
    }, "READY");

    expect(navigation.isCurrentVisible).toBe(false);
    expect(navigation.positionLabel).toBe("1 en filtro");
    expect(navigation.nextSymbol).toBe("BLOCK");
    expect(navigation.reviewHref).toBe("/review?source=current&symbol=BLOCK");
  });

  it("señala el siguiente pendiente cuando el símbolo actual ya se resolvió", () => {
    const navigation = buildReviewQueueNavigation({
      source: "current",
      sourceLabel: "Trabajo pendiente",
      rows: [row("DONE"), row("NEXT")],
      decisionResolutions: {
        DONE: { key: "candidate", label: "Candidata" },
      },
      resolutionFilter: "pending",
    }, "DONE");

    expect(navigation.isCurrentVisible).toBe(false);
    expect(navigation.sourceLabel).toBe("Trabajo pendiente");
    expect(navigation.nextSymbol).toBe("NEXT");
    expect(navigation.nextHref).toBe("/stock/NEXT");
    expect(navigation.positionLabel).toBe("1 en filtro");
  });

  it("expone una cola vacía cuando el último pendiente queda resuelto", () => {
    const navigation = buildReviewQueueNavigation({
      source: "current",
      sourceLabel: "Trabajo pendiente",
      rows: [row("DONE")],
      decisionResolutions: {
        DONE: { key: "candidate", label: "Candidata" },
      },
      resolutionFilter: "pending",
    }, "DONE");

    expect(navigation.isCurrentVisible).toBe(false);
    expect(navigation.visibleCount).toBe(0);
    expect(navigation.nextSymbol).toBe("");
    expect(navigation.filterLabel).toBe("Pendientes");
    expect(navigation.positionLabel).toBe("sin cola");
    expect(navigation.reviewHref).toBe("/review?source=current&symbol=DONE");
  });

  it("expone etiquetas de origen estables", () => {
    expect(reviewQueueSourceLabel("favorites")).toBe("Favoritos");
    expect(reviewQueueSourceLabel("latest")).toBe("Último snapshot");
    expect(reviewQueueSourceLabel("other")).toBe("Cola guardada");
  });
});
