// lib/booksSearch.js — búsqueda sobre el texto por página de los libros privados (puro, sin fs).
//
// Qué resuelve: que un agente cite «Weinstein, p. PDF N» sin releer 350 páginas. El texto sale de
// scripts/books/extract.swift (research/books/_text/*.jsonl, IGNORADO por git). Este módulo solo
// puntúa y recorta; la carga de archivos vive en scripts/books/search.mjs.
//
// Reglas de uso (ver research/notes/00-books-manifest.md): el texto de los libros es privado.
// Los informes y los documentos versionados PARAFRASEAN y citan libro + página PDF; no pegan
// pasajes largos. Por eso los fragmentos que devuelve la búsqueda están acotados (SNIPPET_MAX).

export const SNIPPET_MAX = 280;
export const DEFAULT_LIMIT = 8;

const STOPWORDS = new Set([
  "a", "al", "algo", "como", "con", "de", "del", "el", "en", "es", "la", "las", "lo", "los", "no", "o", "para",
  "por", "que", "se", "si", "su", "un", "una", "y", "the", "of", "and", "to", "in", "is", "a", "an", "for", "on",
  "it", "be", "as", "at", "by", "or", "if", "that", "this", "with",
]);

/** Minúsculas, sin acentos, sin signos: base común de índice y consulta. */
export function normalizeText(text = "") {
  return String(text)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ%\s.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(text = "") {
  return normalizeText(text)
    .split(/[\s.-]+/)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

/**
 * Construye el índice: pages = [{ book, page, text, ocr }]. Guarda por página la forma normalizada
 * y la frecuencia de cada término, y por término el número de páginas que lo contienen.
 */
export function buildIndex(pages = []) {
  const docs = [];
  const documentFrequency = new Map();
  let totalLength = 0;
  for (const entry of pages) {
    const tokens = tokenize(entry.text);
    const frequency = new Map();
    for (const token of tokens) frequency.set(token, (frequency.get(token) || 0) + 1);
    for (const token of frequency.keys()) documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1);
    docs.push({ book: entry.book, page: entry.page, ocr: Boolean(entry.ocr), text: entry.text, normalized: normalizeText(entry.text), frequency, length: tokens.length });
    totalLength += tokens.length;
  }
  return { docs, documentFrequency, averageLength: docs.length ? totalLength / docs.length : 0 };
}

/** Fragmento corto alrededor de la primera aparición de cualquiera de los términos. */
export function snippetAround(text = "", terms = [], radius = Math.floor(SNIPPET_MAX / 2)) {
  const flat = String(text).replace(/\s+/g, " ").trim();
  if (!flat) return "";
  const lower = normalizeText(flat);
  // normalizeText puede cambiar longitudes (acentos descompuestos se eliminan): se busca sobre una
  // versión sin acentos del mismo largo para que los índices coincidan con `flat`.
  const folded = flat.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  let at = -1;
  for (const term of terms) {
    const found = folded.indexOf(term);
    if (found >= 0 && (at < 0 || found < at)) at = found;
  }
  if (at < 0) at = 0;
  const start = Math.max(0, at - Math.min(radius, Math.floor(SNIPPET_MAX / 2)));
  const end = Math.min(flat.length, start + SNIPPET_MAX);
  void lower;
  return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
}

/**
 * BM25 sencillo. opts: { book, limit, all }. `all` exige TODOS los términos en la página.
 * Devuelve [{ book, page, score, ocr, snippet }] de mayor a menor.
 */
export function searchIndex(index, query = "", opts = {}) {
  const terms = [...new Set(tokenize(query))];
  if (!terms.length) return [];
  const limit = Math.max(1, Number(opts.limit) || DEFAULT_LIMIT);
  const k1 = 1.4;
  const b = 0.75;
  const total = index.docs.length || 1;
  const phrase = normalizeText(query);
  const hits = [];
  for (const doc of index.docs) {
    if (opts.book && doc.book !== opts.book) continue;
    let score = 0;
    let matched = 0;
    for (const term of terms) {
      const tf = doc.frequency.get(term) || 0;
      if (!tf) continue;
      matched += 1;
      const df = index.documentFrequency.get(term) || 1;
      const idf = Math.log(1 + (total - df + 0.5) / (df + 0.5));
      score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (doc.length / (index.averageLength || 1)))));
    }
    if (!matched || (opts.all && matched < terms.length)) continue;
    if (terms.length > 1 && doc.normalized.includes(phrase)) score *= 1.5; // frase exacta
    score *= 1 + 0.15 * (matched - 1); // cuantos más términos distintos, mejor
    hits.push({ book: doc.book, page: doc.page, ocr: doc.ocr, score: Math.round(score * 1000) / 1000, snippet: snippetAround(doc.text, terms) });
  }
  hits.sort((x, y) => y.score - x.score || x.book.localeCompare(y.book) || x.page - y.page);
  return hits.slice(0, limit);
}

/** Texto de una página concreta (para contrastar un criterio con su fuente; uso privado). */
export function pageText(index, book, page) {
  const doc = index.docs.find((entry) => entry.book === book && entry.page === Number(page));
  return doc ? { book: doc.book, page: doc.page, ocr: doc.ocr, text: doc.text } : null;
}
