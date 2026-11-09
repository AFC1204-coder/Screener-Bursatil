#!/usr/bin/env node
/**
 * Buscador sobre el texto por página de los libros privados (research/books/_text/*.jsonl).
 *
 *   node scripts/books/search.mjs "media móvil de 30 semanas" [--book=weinstein-es] [--limit=8] [--all] [--json]
 *   node scripts/books/search.mjs --page=120 --book=weinstein-es        (texto de una página, uso privado)
 *   node scripts/books/search.mjs --list                                 (libros indexados)
 *
 * Primero hay que extraer el texto (una vez): ver scripts/books/extract.swift.
 * La «página» es el índice de página del PDF (1-based), no el número impreso del libro.
 * Salida: 0 bien · 1 sin resultados · 2 uso o texto sin extraer.
 *
 * El texto es PRIVADO: los informes y documentos versionados parafrasean y citan «libro + página
 * PDF»; no pegan pasajes largos (research/notes/00-books-manifest.md).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildIndex, pageText, searchIndex } from "../../lib/booksSearch.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_DIR = path.join(ROOT, "research", "books", "_text");
const NOTICE = "(texto privado de los libros: parafrasea y cita libro + página PDF; no pegues pasajes largos en docs ni en la app)";

export function loadPages(dir = DEFAULT_DIR) {
  if (!fs.existsSync(dir)) throw new Error(`No existe ${dir}. Extrae primero el texto: swiftc -O scripts/books/extract.swift -o /tmp/extract-books && /tmp/extract-books research/books research/books/_text --ocr`);
  const pages = [];
  const books = new Set();
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith(".jsonl")).sort()) {
    const book = file.replace(/\.jsonl$/, "");
    books.add(book);
    for (const line of fs.readFileSync(path.join(dir, file), "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line);
        if (row.text) pages.push({ book, page: row.page, text: row.text, ocr: row.ocr });
      } catch {
        // línea dañada: se ignora
      }
    }
  }
  if (!pages.length) throw new Error(`No hay texto en ${dir}`);
  return { pages, books: [...books] };
}

function parseArgs(argv) {
  const args = { query: [], book: "", limit: 8, all: false, json: false, list: false, page: 0, dir: DEFAULT_DIR };
  for (const arg of argv) {
    if (arg.startsWith("--book=")) args.book = arg.slice(7);
    else if (arg.startsWith("--limit=")) args.limit = Number(arg.slice(8));
    else if (arg.startsWith("--page=")) args.page = Number(arg.slice(7));
    else if (arg.startsWith("--dir=")) args.dir = path.resolve(arg.slice(6));
    else if (arg === "--all") args.all = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--list") args.list = true;
    else if (arg.startsWith("--")) throw new Error(`Opción desconocida: ${arg}`);
    else args.query.push(arg);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const { pages, books } = loadPages(args.dir);
  const index = buildIndex(pages);
  if (args.list) {
    const counts = Object.fromEntries(books.map((book) => [book, pages.filter((p) => p.book === book).length]));
    console.log(args.json ? JSON.stringify(counts) : books.map((book) => `${book}\t${counts[book]} páginas con texto`).join("\n"));
    return 0;
  }
  if (args.page) {
    if (!args.book) throw new Error("--page exige --book=<slug>");
    const found = pageText(index, args.book, args.page);
    if (!found) {
      console.error(`Sin texto en ${args.book} p. ${args.page}`);
      return 1;
    }
    console.log(args.json ? JSON.stringify(found) : `${NOTICE}\n\n[${found.book} · p. PDF ${found.page}${found.ocr ? " · OCR" : ""}]\n${found.text}`);
    return 0;
  }
  const query = args.query.join(" ").trim();
  if (!query) throw new Error("Falta la consulta (o usa --list / --page)");
  const hits = searchIndex(index, query, { book: args.book, limit: args.limit, all: args.all });
  if (args.json) console.log(JSON.stringify({ query, hits }));
  else {
    console.log(NOTICE);
    for (const hit of hits) console.log(`\n[${hit.book} · p. PDF ${hit.page}${hit.ocr ? " · OCR" : ""} · ${hit.score}]\n  ${hit.snippet}`);
    if (!hits.length) console.log("\nSin resultados.");
  }
  return hits.length ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.exit(main());
  } catch (error) {
    console.error(`books-search: ${error.message}`);
    process.exit(2);
  }
}
