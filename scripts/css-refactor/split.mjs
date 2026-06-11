// Commit 1: parte app/globals.css en styles/* SIN tocar el contenido de las reglas.
// - tokens.css: bloques :root (en su orden original).
// - base.css: reglas sin clases (elementos, @font-face, @keyframes, scrollbars).
// - <ruta>.css: reglas cuyas clases se usan en una única ruta.
// - components.css: el resto (compartidas, multi-ruta o sin uso detectado).
// El orden relativo original se preserva dentro de cada archivo; los @media se
// reparten envolviendo cada fragmento en su misma media query.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { buildClassUsage, classesInSelector, loadSources, parseCss, stringifyRule } from "./parse.mjs";

const root = process.cwd();
const css = readFileSync("app/globals.css", "utf8");
const nodes = parseCss(css);
const sources = loadSources(root);
const usage = buildClassUsage(sources);
const usageCache = new Map();
const routesFor = (cls) => {
  if (!usageCache.has(cls)) usageCache.set(cls, usage(cls));
  return usageCache.get(cls);
};

const ROUTE_BUCKETS = ["screener", "stock", "review", "research-desk", "lists", "sectors", "market-health", "ipo-radar"];
const buckets = Object.fromEntries(["tokens", "base", "components", ...ROUTE_BUCKETS].map((k) => [k, []]));

function bucketOfRule(rule) {
  const selector = rule.selector;
  if (/^:root\b/.test(selector)) return "tokens";
  const classes = classesInSelector(selector);
  if (!classes.length) return "base";
  const routes = new Set();
  let shared = false;
  let anyUsed = false;
  for (const cls of classes) {
    const r = routesFor(cls);
    if (r.size) anyUsed = true;
    if (r.has("shared")) shared = true;
    for (const route of r) if (route !== "shared") routes.add(route);
  }
  if (!anyUsed) return "components"; // reglas sin uso detectado: globales (se revisan en commit 2)
  if (shared || routes.size !== 1) return "components";
  return [...routes][0];
}

let pendingComment = null;
for (const node of nodes) {
  if (node.type === "comment") {
    // banner: se adjunta al bucket de la siguiente regla
    if (pendingComment) buckets.components.push(stringifyRule(pendingComment));
    pendingComment = node;
    continue;
  }
  if (node.type === "statement") {
    // @import debe preceder a toda regla: va al principio de tokens.css (primer
    // archivo importado por el layout) para conservar su validez en la cascada.
    if (node.raw.startsWith("@import")) buckets.tokens.unshift(stringifyRule(node));
    else buckets.base.push(stringifyRule(node));
    continue;
  }
  if (node.type === "rule") {
    const bucket = bucketOfRule(node);
    if (pendingComment) { buckets[bucket].push(stringifyRule(pendingComment)); pendingComment = null; }
    buckets[bucket].push(stringifyRule(node));
    continue;
  }
  if (node.type === "at") {
    // repartir hijos conservando orden; un wrapper @media por bucket implicado
    const perBucket = new Map();
    let innerComment = null;
    for (const child of node.children) {
      if (child.type === "comment") { innerComment = child; continue; }
      const bucket = child.type === "rule" ? bucketOfRule(child) : "base";
      if (!perBucket.has(bucket)) perBucket.set(bucket, []);
      if (innerComment) { perBucket.get(bucket).push(innerComment); innerComment = null; }
      perBucket.get(bucket).push(child);
    }
    if (pendingComment) {
      const firstBucket = perBucket.size ? [...perBucket.keys()][0] : "components";
      buckets[firstBucket].push(stringifyRule(pendingComment));
      pendingComment = null;
    }
    for (const [bucket, children] of perBucket) {
      buckets[bucket].push(stringifyRule({ type: "at", selector: node.selector, children }));
    }
  }
}
if (pendingComment) buckets.components.push(stringifyRule(pendingComment));

mkdirSync("styles", { recursive: true });
const HEADERS = {
  tokens: "/* styles/tokens.css — variables de diseño (:root). Extraído verbatim de app/globals.css. */",
  base: "/* styles/base.css — resets, elementos, keyframes y scrollbars. Extraído de app/globals.css. */",
  components: "/* styles/components.css — componentes compartidos entre rutas. Extraído de app/globals.css. */",
};
let total = 0;
for (const [name, rules] of Object.entries(buckets)) {
  const header = HEADERS[name] || `/* styles/${name}.css — reglas exclusivas de la ruta ${name}. Extraído de app/globals.css. */`;
  const text = `${header}\n\n${rules.join("\n\n")}\n`;
  writeFileSync(`styles/${name}.css`, text);
  const lines = text.split("\n").length;
  total += lines;
  console.log(`styles/${name}.css: ${lines} líneas (${rules.length} bloques)`);
}
console.log("total líneas:", total, "| original:", css.split("\n").length);
