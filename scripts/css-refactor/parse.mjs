// Parser mínimo de CSS por bloques de llaves + mapa de uso de clases en el código.
// Compartido por el particionador (commit 1) y el consolidador (commit 2).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// --- Parser de nodos top-level (reglas, at-rules con cuerpo, comentarios sueltos) ---
export function parseCss(css) {
  const nodes = [];
  let i = 0;
  const n = css.length;
  let pending = ""; // texto acumulado (selector o comentario) antes de una llave
  while (i < n) {
    const ch = css[i];
    if (ch === "'" || ch === '"') {
      // cadena: copiar entera para que ';' '{' '}' internos no corten nada
      const quote = ch;
      let j = i + 1;
      while (j < n && css[j] !== quote) j += css[j] === "\\" ? 2 : 1;
      pending += css.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (ch === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      const comment = css.slice(i, end + 2);
      if (pending.trim()) pending += comment;
      else nodes.push({ type: "comment", raw: comment });
      i = end + 2;
      continue;
    }
    if (ch === "{") {
      // localizar el cierre equilibrado (anidamiento para @media etc.)
      let depth = 1;
      let j = i + 1;
      while (j < n && depth > 0) {
        if (css[j] === "'" || css[j] === '"') {
          const quote = css[j];
          j += 1;
          while (j < n && css[j] !== quote) j += css[j] === "\\" ? 2 : 1;
          j += 1;
          continue;
        }
        if (css[j] === "/" && css[j + 1] === "*") { j = css.indexOf("*/", j) + 2; continue; }
        if (css[j] === "{") depth += 1;
        else if (css[j] === "}") depth -= 1;
        j += 1;
      }
      const selector = pending.trim();
      const body = css.slice(i + 1, j - 1);
      if (selector.startsWith("@") && /^@(media|supports|container|layer)/.test(selector)) {
        nodes.push({ type: "at", selector, children: parseCss(body) });
      } else {
        nodes.push({ type: "rule", selector, body });
      }
      pending = "";
      i = j;
      continue;
    }
    if (ch === ";" && pending.trim().startsWith("@")) {
      nodes.push({ type: "statement", raw: pending.trim() + ";" });
      pending = "";
      i += 1;
      continue;
    }
    pending += ch;
    i += 1;
  }
  return nodes;
}

export function stringifyRule(node, indent = "") {
  if (node.type === "comment") return `${indent}${node.raw}`;
  if (node.type === "statement") return `${indent}${node.raw}`;
  if (node.type === "at") {
    const inner = node.children.map((child) => stringifyRule(child, indent + "  ")).join("\n");
    return `${indent}${node.selector} {\n${inner}\n${indent}}`;
  }
  return `${indent}${node.selector} {${node.body.trimEnd()}\n${indent}}`;
}

export function classesInSelector(selector) {
  return [...new Set([...selector.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((m) => m[1]))];
}

export function declarationsOf(body) {
  // pares prop:valor de primer nivel (sin anidados; suficiente para reglas planas)
  const out = [];
  let depth = 0, current = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "/" && body[i + 1] === "*") { i = body.indexOf("*/", i) + 1; continue; }
    if (ch === "{") depth += 1;
    if (ch === "}") depth -= 1;
    if (ch === ";" && depth === 0) {
      if (current.trim()) out.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out.map((decl) => {
    const idx = decl.indexOf(":");
    return idx > 0 ? { prop: decl.slice(0, idx).trim().toLowerCase(), value: decl.slice(idx + 1).trim() } : null;
  }).filter(Boolean);
}

// --- Código fuente: qué archivos usan cada clase ---
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (["node_modules", ".next", ".git", "output"].includes(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(jsx|js|mjs)$/.test(entry) && !full.includes("scripts/css-refactor")) out.push(full);
  }
  return out;
}

export function loadSources(root) {
  const files = [...walk(join(root, "app")), ...walk(join(root, "lib"))];
  return files.map((file) => ({ file: file.slice(root.length + 1), text: readFileSync(file, "utf8") }));
}

const ROUTE_OF_FILE = [
  [/^app\/stock\//, "stock"],
  [/^app\/review\//, "review"],
  [/^app\/research-desk\//, "research-desk"],
  [/^app\/lists\//, "lists"],
  [/^app\/sectors\//, "sectors"],
  [/^app\/market-health\//, "market-health"],
  [/^app\/ipo-radar\//, "ipo-radar"],
  [/^app\/(page|screenerPanels)\.jsx$/, "screener"],
  [/^app\/api\//, null],
  [/^app\//, "shared"], // layout, componentes compartidos (UniversalPriceChart, etc.)
  [/^lib\//, "shared"],
];

export function routeOfFile(file) {
  for (const [re, route] of ROUTE_OF_FILE) if (re.test(file)) return route;
  return "shared";
}

export function buildClassUsage(sources) {
  // clase → Set de rutas que la usan (busca el nombre como token en el fuente)
  return function usage(className) {
    const routes = new Set();
    const re = new RegExp(`(?<![\\w-])${className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`);
    for (const { file, text } of sources) {
      if (re.test(text)) {
        const route = routeOfFile(file);
        if (route) routes.add(route);
      }
    }
    return routes;
  };
}
