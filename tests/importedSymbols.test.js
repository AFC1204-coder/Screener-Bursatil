// Ningún archivo puede USAR un símbolo exportado por el repo sin IMPORTARLO.
//
// Por qué existe este test: el proyecto no tiene linter (no hay eslint, biome
// ni oxlint en package.json, ni configuración en el árbol), así que nada
// avisaba de un identificador libre. app/lists/page.jsx llamaba a
// userFacingServiceError sin importarlo desde el 2026-08-13; el fallo solo se
// manifestaba cuando la red fallaba de verdad —dentro del catch— y dejaba la
// página colgada en "Cargando" (docs/migracion-listas-2026-08-13.md §4.1).
//
// Alcance deliberadamente estrecho: solo símbolos que el propio repo exporta.
// Un `no-undef` completo necesita análisis de ámbitos y un parser; esto cubre
// la clase de fallo que ya ha ocurrido sin arrastrar esa maquinaria.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIRS = ["app", "lib"];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      walk(full, out);
    } else if (/\.(js|jsx|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

// Comentarios y cadenas fuera: una mención en prosa ("ver fetchYahooChart()")
// o dentro de un literal no es una llamada. Se sustituyen por espacios para no
// desplazar los números de línea.
function stripNoise(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n")
    .map((line) => line.replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, (m) => " ".repeat(m.length)).split("//")[0])
    .join("\n");
}

function exportedNames(src) {
  const names = [];
  for (const m of src.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) names.push(m[1]);
  for (const m of src.matchAll(/^export\s+(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) names.push(m[1]);
  for (const m of src.matchAll(/^export\s*\{([^}]+)\}/gm)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.push(name);
    }
  }
  return names;
}

// Todo lo que hace que un nombre sea legítimo en este archivo: importado,
// declarado, desestructurado (incluido el multilínea de props) o parámetro.
function boundNames(raw, src) {
  const bound = new Set();
  for (const m of raw.matchAll(/import\s+([^;]+?)\s+from\s+['"][^'"]+['"]/gs)) {
    for (const named of m[1].matchAll(/\{([^}]*)\}/gs)) {
      for (const part of named[1].split(",")) {
        const name = part.trim().split(/\s+as\s+/).pop().trim();
        if (name) bound.add(name);
      }
    }
    for (const part of m[1].replace(/\{[^}]*\}/gs, "").replace(/\*\s+as\s+/, "").split(",")) {
      const name = part.trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) bound.add(name);
    }
  }
  for (const m of src.matchAll(/(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/g)) bound.add(m[1]);
  for (const m of src.matchAll(/(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) bound.add(m[1]);
  // Desestructurado o parámetro, en una línea o repartido en varias.
  for (const m of src.matchAll(/[{,(]\s*\.{0,3}\s*([A-Za-z_$][\w$]*)\s*[,}=:)]/g)) bound.add(m[1]);
  for (const m of src.matchAll(/^\s*([A-Za-z_$][\w$]*)\s*[,}]?\s*$/gm)) bound.add(m[1]);
  for (const m of src.matchAll(/([A-Za-z_$][\w$]*)\s*=>/g)) bound.add(m[1]);
  return bound;
}

const files = DIRS.flatMap((dir) => walk(path.join(ROOT, dir)));
const sources = new Map(files.map((file) => {
  const raw = fs.readFileSync(file, "utf8");
  return [file, { raw, clean: stripNoise(raw), rel: path.relative(ROOT, file) }];
}));

const catalog = new Map();
for (const [, { raw, rel }] of sources) {
  for (const name of exportedNames(raw)) {
    if (!catalog.has(name)) catalog.set(name, new Set());
    catalog.get(name).add(rel);
  }
}

describe("símbolos del repo usados sin importar", () => {
  it("no hay ninguno en app/ ni lib/", () => {
    // Una sola pasada por archivo recogiendo lo que se llama, en vez de
    // probar el catálogo entero contra cada línea (que era cuadrático).
    // Lookbehind, no grupo previo: con `[^\w$.]` capturado, una llamada
    // anidada —`fuera(dentro(x))`— se perdía porque el paréntesis que
    // precede a `dentro` ya lo había consumido el match de `fuera`. Ese
    // descuido dejaba pasar justo el caso que motivó este test.
    const CALL = /(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(/g;
    const METHOD = /^\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/;
    const offenders = [];
    for (const [, { raw, clean, rel }] of sources) {
      const bound = boundNames(raw, clean);
      clean.split("\n").forEach((line, index) => {
        // Un método de objeto o de clase define el nombre, no lo usa.
        const method = line.match(METHOD)?.[1];
        for (const match of line.matchAll(CALL)) {
          const name = match[1];
          if (name === method || bound.has(name)) continue;
          const from = catalog.get(name);
          if (!from || from.has(rel)) continue;
          offenders.push(`${rel}:${index + 1} usa ${name}() sin importarlo (lo exporta ${[...from].join(", ")})`);
        }
      });
    }
    expect([...new Set(offenders)]).toEqual([]);
  });

  it("el catálogo y el barrido no están vacíos (el test se estaría autoengañando)", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(catalog.size).toBeGreaterThan(500);
  });
});
