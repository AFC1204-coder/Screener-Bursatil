// TABLE-FIRE-1 — contrato CSS: tabla de resultados sin columnas aplastadas al resize.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SCREENER_COLUMNS } from "@/lib/screenerColumns";

const SCREENER_CSS = readFileSync(new URL("../styles/screener.css", import.meta.url), "utf8");

const COLUMN_CLASS_NAMES = [
  ...SCREENER_COLUMNS.map((column) => column.className),
  "colWeakness",
];

describe("TABLE-FIRE-1 · CSS contrato tabla compacta", () => {
  it("el wrap permite scroll horizontal, no hidden", () => {
    expect(SCREENER_CSS).not.toMatch(/\.compactTableWrap\s*\{[^}]*overflow-x:\s*hidden/s);
    expect(SCREENER_CSS).toMatch(/\.compactTableWrap\s*\{[^}]*overflow-x:\s*auto/s);
  });

  it("la tabla tiene piso de ancho útil (no min-width:0)", () => {
    expect(SCREENER_CSS).not.toMatch(/\.compactResultsTable\s*\{[^}]*min-width:\s*0/s);
    expect(SCREENER_CSS).toMatch(/\.compactResultsTable\s*\{[^}]*min-width:\s*\d+px/s);
  });

  it("cada columna visible tiene clase de ancho con min-width ≥24px", () => {
    for (const className of COLUMN_CLASS_NAMES) {
      const rule = new RegExp(`\\.compactResultsTable \\.${className}\\s*\\{[^}]*min-width:\\s*(\\d+)px`, "s");
      const match = SCREENER_CSS.match(rule);
      expect(match, `falta min-width en .${className}`).not.toBeNull();
      expect(Number(match[1]), `.${className} min-width`).toBeGreaterThanOrEqual(24);
    }
  });

  it("define anchos para RS país, RS tema y VCP (no solo las siete originales)", () => {
    for (const className of ["colRsCountry", "colRsTheme", "colVcp"]) {
      expect(SCREENER_CSS).toMatch(new RegExp(`\\.compactResultsTable \\.${className}\\s*\\{[^}]*width:`));
    }
  });
});
