import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { SNIPPET_MAX, buildIndex, normalizeText, pageText, searchIndex, snippetAround, tokenize } from "../lib/booksSearch.js";

// Páginas SINTÉTICAS: los tests no leen los libros reales (privados, fuera de git).
const PAGES = [
  { book: "libro-a", page: 1, text: "La media móvil de 30 semanas pierde inclinación descendente y comienza a allanarse en la Etapa 1." },
  { book: "libro-a", page: 2, text: "Cuando el precio cruza la media móvil de 30 semanas con volumen alto, empieza la Etapa 2." },
  { book: "libro-a", page: 3, text: "Un capítulo sin relación: historia de los mercados del siglo pasado." },
  { book: "libro-b", page: 7, text: "The pivot point appears after volatility contraction; volume dries up near the pivot." },
  { book: "libro-b", page: 8, text: "Unrelated page about psychology and discipline." },
];

describe("normalizeText / tokenize", () => {
  it("quita acentos, mayúsculas y signos", () => {
    expect(normalizeText("Media MÓVIL, 30-semanas!")).toBe("media movil 30-semanas");
    expect(tokenize("La media móvil de 30 semanas")).toEqual(["media", "movil", "30", "semanas"]);
  });

  it("no revienta con vacío o undefined", () => {
    expect(normalizeText()).toBe("");
    expect(tokenize(undefined)).toEqual([]);
  });
});

describe("searchIndex", () => {
  const index = buildIndex(PAGES);

  it("encuentra por palabra sin importar acentos y ordena por relevancia", () => {
    const hits = searchIndex(index, "media movil 30 semanas");
    expect(hits.map((h) => h.page).slice(0, 2).sort()).toEqual([1, 2]);
    expect(hits.every((h) => h.book === "libro-a")).toBe(true);
    expect(hits[0].score).toBeGreaterThanOrEqual(hits.at(-1).score);
  });

  it("premia la frase exacta", () => {
    const hits = searchIndex(index, "etapa 2 volumen alto");
    expect(hits[0].page).toBe(2);
  });

  it("filtra por libro y respeta el límite", () => {
    expect(searchIndex(index, "pivot volume", { book: "libro-b" }).every((h) => h.book === "libro-b")).toBe(true);
    expect(searchIndex(index, "media movil", { limit: 1 })).toHaveLength(1);
    expect(searchIndex(index, "media", { book: "libro-b" })).toEqual([]);
  });

  it("--all exige todos los términos", () => {
    expect(searchIndex(index, "pivot psychology", { all: true })).toEqual([]);
    expect(searchIndex(index, "pivot psychology")).toHaveLength(2);
  });

  it("consulta vacía o solo palabras vacías no devuelve nada", () => {
    expect(searchIndex(index, "")).toEqual([]);
    expect(searchIndex(index, "de la el")).toEqual([]);
  });

  it("índice vacío: no falla", () => {
    expect(searchIndex(buildIndex([]), "media")).toEqual([]);
  });
});

describe("snippetAround", () => {
  it("acota el fragmento (no se pegan páginas enteras) y marca los recortes", () => {
    const long = `${"relleno ".repeat(200)}pivot point aquí ${"más relleno ".repeat(200)}`;
    const snippet = snippetAround(long, ["pivot"]);
    expect(snippet.length).toBeLessThanOrEqual(SNIPPET_MAX + 2);
    expect(snippet).toContain("pivot");
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
  });

  it("encuentra términos con acento en el texto original", () => {
    expect(snippetAround("La media móvil sube", ["movil"])).toContain("móvil");
  });

  it("texto vacío → vacío", () => {
    expect(snippetAround("", ["x"])).toBe("");
  });
});

describe("pageText", () => {
  it("devuelve la página pedida o null", () => {
    const index = buildIndex(PAGES);
    expect(pageText(index, "libro-b", 7).text).toMatch(/pivot point/);
    expect(pageText(index, "libro-b", 99)).toBeNull();
  });
});

describe("CLI scripts/books/search.mjs", () => {
  const script = path.resolve("scripts/books/search.mjs");
  const dir = mkdtempSync(path.join(tmpdir(), "books-"));
  writeFileSync(path.join(dir, "libro-a.jsonl"), PAGES.filter((p) => p.book === "libro-a").map((p) => JSON.stringify({ page: p.page, chars: p.text.length, ocr: false, text: p.text })).join("\n"));
  writeFileSync(path.join(dir, "libro-b.jsonl"), `${PAGES.filter((p) => p.book === "libro-b").map((p) => JSON.stringify({ page: p.page, chars: p.text.length, ocr: p.page === 8, text: p.text })).join("\n")}\nlínea dañada {`);
  const run = (args) => spawnSync("node", [script, `--dir=${dir}`, ...args], { encoding: "utf8", env: { ...process.env, NODE_NO_WARNINGS: "1" } });

  it("busca, avisa de que el texto es privado y sale con 0", () => {
    const r = run(["media móvil 30 semanas"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/texto privado de los libros/);
    expect(r.stdout).toMatch(/libro-a · p\. PDF [12]/);
  });

  it("--json y --list", () => {
    const j = JSON.parse(run(["pivot", "--json"]).stdout);
    expect(j.hits[0]).toMatchObject({ book: "libro-b", page: 7 });
    expect(JSON.parse(run(["--list", "--json"]).stdout)).toEqual({ "libro-a": 3, "libro-b": 2 });
  });

  it("--page lee una página; sin resultados sale con 1; ignora líneas dañadas", () => {
    expect(run(["--page=7", "--book=libro-b"]).stdout).toMatch(/pivot point/);
    expect(run(["--page=99", "--book=libro-b"]).status).toBe(1);
    expect(run(["xyzxyz"]).status).toBe(1);
  });

  it("uso incorrecto o carpeta inexistente sale con 2", () => {
    expect(run([]).status).toBe(2);
    expect(run(["--page=1"]).status).toBe(2);
    expect(spawnSync("node", [script, "--dir=/no/existe", "algo"], { encoding: "utf8", env: { ...process.env, NODE_NO_WARNINGS: "1" } }).status).toBe(2);
  });
});
