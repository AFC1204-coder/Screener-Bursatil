import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Valida la matriz viva research/auditoria-libros/matriz.json: que no se pudra.
// No lee los libros (privados); si research/books/_text existe, comprueba además que las páginas
// citadas existan en el libro indicado.
const ROOT = path.resolve(".");
const matriz = JSON.parse(fs.readFileSync(path.join(ROOT, "research/auditoria-libros/matriz.json"), "utf8"));
const TEXT_DIR = path.join(ROOT, "research/books/_text");
const TEMAS = ["etapas", "vcp", "mercado"];

function loadBookPages(slug) {
  const file = path.join(TEXT_DIR, `${slug}.jsonl`);
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).length;
}

describe("matriz de auditoría libros ↔ código", () => {
  it("tiene meta y filas con el esquema esperado", () => {
    expect(matriz.meta.estados.length).toBeGreaterThan(3);
    expect(matriz.rows.length).toBeGreaterThan(20);
    for (const row of matriz.rows) {
      expect(typeof row.id, row.id).toBe("string");
      expect(TEMAS, row.id).toContain(row.tema);
      expect(row.criterio?.length, `${row.id} criterio`).toBeGreaterThan(10);
      expect(Array.isArray(row.fuentes), `${row.id} fuentes`).toBe(true);
      expect(Array.isArray(row.codigo), `${row.id} codigo`).toBe(true);
      expect(Array.isArray(row.tests), `${row.id} tests`).toBe(true);
      expect(matriz.meta.estados, `${row.id} estado_sep08`).toContain(row.estado_sep08);
      if (row.estado_actual != null) {
        expect(matriz.meta.estados, `${row.id} estado_actual`).toContain(row.estado_actual);
        expect(row.verificado, `${row.id} verificado (commit+fecha)`).toBeTruthy();
      }
    }
  });

  it("los ids son únicos", () => {
    const ids = matriz.rows.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("los libros citados son conocidos y las páginas son enteros positivos", () => {
    for (const row of matriz.rows) {
      for (const fuente of row.fuentes) {
        expect(matriz.meta.libros, `${row.id} libro`).toContain(fuente.libro);
        for (const page of fuente.paginas) expect(Number.isInteger(page) && page > 0, `${row.id} p.${page}`).toBe(true);
      }
    }
  });

  it("los archivos y símbolos de código citados existen", () => {
    for (const row of matriz.rows) {
      for (const ref of row.codigo) {
        const file = path.join(ROOT, ref.archivo);
        expect(fs.existsSync(file), `${row.id}: falta ${ref.archivo}`).toBe(true);
        const source = fs.readFileSync(file, "utf8");
        expect(new RegExp(`\\b${ref.simbolo}\\b`).test(source), `${row.id}: ${ref.simbolo} no aparece en ${ref.archivo}`).toBe(true);
      }
    }
  });

  it("los tests citados existen", () => {
    for (const row of matriz.rows) {
      for (const test of row.tests) expect(fs.existsSync(path.join(ROOT, test)), `${row.id}: falta ${test}`).toBe(true);
    }
  });

  it("si el texto de los libros está extraído, las páginas citadas caben en el libro", () => {
    if (!fs.existsSync(TEXT_DIR)) return; // sin textos (otro equipo/CI): se omite
    for (const row of matriz.rows) {
      for (const fuente of row.fuentes) {
        const total = loadBookPages(fuente.libro);
        if (total == null) continue;
        for (const page of fuente.paginas) expect(page, `${row.id} ${fuente.libro} p.${page}`).toBeLessThanOrEqual(total + 40);
      }
    }
  });
});
