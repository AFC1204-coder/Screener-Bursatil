// Análisis previo: cuántas reglas hay, clases muertas, reglas totalmente sombreadas
// y reparto por ruta. No modifica nada.
import { readFileSync } from "node:fs";
import { buildClassUsage, classesInSelector, declarationsOf, loadSources, parseCss } from "./parse.mjs";

const root = process.cwd();
const css = readFileSync("app/globals.css", "utf8");
const nodes = parseCss(css);
const sources = loadSources(root);
const usage = buildClassUsage(sources);

// aplanar (media → reglas con contexto)
const flat = [];
function flatten(list, media = "") {
  for (const node of list) {
    if (node.type === "at") flatten(node.children, `${media}${node.selector} `);
    else if (node.type === "rule") flat.push({ ...node, media });
  }
}
flatten(nodes);
console.log("nodos top-level:", nodes.length, "| reglas aplanadas:", flat.length);

// clases del CSS y uso
const allClasses = new Set();
for (const rule of flat) for (const cls of classesInSelector(rule.selector)) allClasses.add(cls);
console.log("clases distintas en CSS:", allClasses.size);

const usageCache = new Map();
const routesFor = (cls) => {
  if (!usageCache.has(cls)) usageCache.set(cls, usage(cls));
  return usageCache.get(cls);
};
const deadClasses = [...allClasses].filter((cls) => routesFor(cls).size === 0);
console.log("clases sin uso en app/lib:", deadClasses.length);

// regla muerta = todos sus selectores contienen ≥1 clase muerta
let deadRules = 0, deadLines = 0;
for (const rule of flat) {
  if (rule.selector.startsWith("@")) continue;
  const selectors = rule.selector.split(",").map((s) => s.trim());
  const allDead = selectors.length && selectors.every((sel) => classesInSelector(sel).some((cls) => routesFor(cls).size === 0));
  if (allDead) { deadRules += 1; deadLines += rule.body.split("\n").length + 1; }
}
console.log("reglas 100% muertas:", deadRules, `(~${deadLines} líneas)`);

// reglas totalmente sombreadas: mismo (media, selector) más adelante redeclara TODAS sus props
const bySelector = new Map();
flat.forEach((rule, index) => {
  const key = `${rule.media}|${rule.selector}`;
  (bySelector.get(key) ?? bySelector.set(key, []).get(key)).push(index);
});
let shadowed = 0, shadowedLines = 0, duplicatedSelectors = 0;
for (const [, indices] of bySelector) {
  if (indices.length < 2) continue;
  duplicatedSelectors += 1;
  for (let a = 0; a < indices.length - 1; a++) {
    const early = declarationsOf(flat[indices[a]].body);
    if (!early.length) continue;
    const laterProps = new Set();
    for (let b = a + 1; b < indices.length; b++) for (const d of declarationsOf(flat[indices[b]].body)) laterProps.add(d.prop);
    if (early.every((d) => laterProps.has(d.prop))) { shadowed += 1; shadowedLines += early.length + 2; }
  }
}
console.log("selectores duplicados (multi-declaración):", duplicatedSelectors, "| reglas totalmente sombreadas:", shadowed, `(~${shadowedLines} líneas)`);

// reparto por ruta (para la partición)
const buckets = { tokens: 0, base: 0, components: 0, screener: 0, stock: 0, review: 0, "research-desk": 0, lists: 0, sectors: 0, "market-health": 0, "ipo-radar": 0, dead: 0 };
for (const rule of flat) {
  const classes = classesInSelector(rule.selector);
  if (rule.selector.startsWith(":root")) { buckets.tokens += 1; continue; }
  if (!classes.length) { buckets.base += 1; continue; }
  const routes = new Set();
  let anyAlive = false;
  for (const cls of classes) for (const r of routesFor(cls)) { routes.add(r); anyAlive = true; }
  if (!anyAlive) { buckets.dead += 1; continue; }
  routes.delete("shared");
  if (routes.size === 1 && !classes.some((cls) => routesFor(cls).has("shared"))) buckets[[...routes][0]] += 1;
  else buckets.components += 1;
}
console.log("reparto reglas:", JSON.stringify(buckets));
console.log("muestra clases muertas:", deadClasses.slice(0, 30).join(", "));
