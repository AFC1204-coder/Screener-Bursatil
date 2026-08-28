import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildReviewPageHref, resolvePrimaryReviewStartSymbol } from "@/lib/screenerReviewLaunch";

const rows = [{ symbol: "AAA" }, { symbol: "BBB" }, { symbol: "CCC" }];

describe("resolvePrimaryReviewStartSymbol", () => {
  it("prioriza fila seleccionada en tabla sobre selectedSymbol y primera fila", () => {
    expect(resolvePrimaryReviewStartSymbol({
      selectedResultSymbol: "BBB",
      selectedSymbol: "CCC",
      rows,
    })).toBe("BBB");
  });

  it("usa selectedSymbol cuando no hay fila seleccionada en tabla", () => {
    expect(resolvePrimaryReviewStartSymbol({
      selectedResultSymbol: "",
      selectedSymbol: "CCC",
      rows,
    })).toBe("CCC");
  });

  it("cae a la primera fila visible cuando no hay selección previa", () => {
    expect(resolvePrimaryReviewStartSymbol({
      selectedResultSymbol: "",
      selectedSymbol: "",
      rows,
    })).toBe("AAA");
  });

  it("ignora símbolos fuera de la lista visible", () => {
    expect(resolvePrimaryReviewStartSymbol({
      selectedResultSymbol: "ZZZ",
      selectedSymbol: "YYY",
      rows,
    })).toBe("AAA");
  });
});

describe("buildReviewPageHref", () => {
  it("construye la URL de review con source y symbol", () => {
    expect(buildReviewPageHref("DK", "current")).toBe("/review?source=current&symbol=DK");
  });
});

describe("openPrimaryReview handler", () => {
  it("resuelve símbolo, persiste con openReviewPage y navega con router.push", () => {
    const source = readFileSync(resolve(import.meta.dirname, "../app/page.jsx"), "utf8");
    expect(source).toContain("function openPrimaryReview()");
    expect(source).toContain("resolvePrimaryReviewStartSymbol");
    expect(source).toContain("openReviewPage(filtered, startSymbol)");
    expect(source).toContain("router.push(href)");
  });
});
