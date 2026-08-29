import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { screenerEnterReviewSymbol } from "@/lib/screenerResultKeyboard";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function source(path) {
  return readFileSync(join(root, path), "utf8");
}

describe("UX-17: gestos fila → Vista rápida", () => {
  it("Enter con fila seleccionada devuelve el símbolo para abrir Vista rápida", () => {
    const rows = [{ symbol: "DK" }, { symbol: "HNGE" }];
    expect(screenerEnterReviewSymbol({
      key: "Enter",
      target: { tagName: "TR" },
      selectedResultSymbol: "DK",
      pagedRows: rows,
    })).toBe("DK");
  });

  it("Enter sin fila seleccionada no navega", () => {
    expect(screenerEnterReviewSymbol({
      key: "Enter",
      target: { tagName: "TR" },
      selectedResultSymbol: "",
      pagedRows: [{ symbol: "DK" }],
    })).toBeNull();
  });

  it("Enter ignora inputs y modal de Vista rápida abierto", () => {
    expect(screenerEnterReviewSymbol({
      key: "Enter",
      target: { tagName: "INPUT" },
      selectedResultSymbol: "DK",
      pagedRows: [{ symbol: "DK" }],
    })).toBeNull();
    expect(screenerEnterReviewSymbol({
      key: "Enter",
      target: { tagName: "TR" },
      selectedResultSymbol: "DK",
      pagedRows: [{ symbol: "DK" }],
      activeModalRow: { symbol: "DK" },
    })).toBeNull();
  });

  it("page.jsx usa openResultReview en Enter, no stockUrl directo", () => {
    const page = source("app/page.jsx");
    expect(page).toContain("screenerEnterReviewSymbol");
    expect(page).toContain("openResultReview(symbol)");
    expect(page).not.toMatch(/window\.location\.href\s*=\s*stockUrl/);
  });

  it("CompactResultsTable documenta y expone doble clic en fila", () => {
    const table = source("lib/screenerTable.jsx");
    expect(table).toContain("onDoubleClick");
    expect(table).toContain("Vista rápida");
    expect(table).toContain("activateResultRow");
  });
});
