// Commit 2: consolidación de styles/*.css sin cambiar el render.
// A) Borra reglas muertas: TODOS sus selectores exigen alguna clase que no aparece
//    en ningún fuente de app/ o lib/ (la comprobación equivale al grep por clase;
//    se respetan prefijos dinámicos tipo `companyMark-${size}`).
// B) Borra reglas totalmente sombreadas: mismo (media, selector) más adelante en el
//    mismo archivo redeclara todas sus propiedades (last-wins exacto).
// C) Fusiona reglas idénticas consecutivas (mismo cuerpo) en un grupo de selectores.
// D) Funde bloques @media consecutivos con la misma query.
// Emite un informe de lo borrado en output/css-refactor/removed.txt.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { buildClassUsage, classesInSelector, declarationsOf, loadSources, parseCss, splitSelectors, stringifyRule } from "./parse.mjs";

const root = process.cwd();
const sources = loadSources(root);
const usage = buildClassUsage(sources);
const usageCache = new Map();

// Prefijos dinámicos: `algo-${...}` en JSX implica clases algo-* construidas en runtime.
const dynamicPrefixes = new Set();
for (const { text } of sources) {
  for (const match of text.matchAll(/([A-Za-z][\w-]*-)\$\{/g)) dynamicPrefixes.add(match[1]);
}
function classIsUsed(cls) {
  if (!usageCache.has(cls)) {
    let used = usage(cls).size > 0;
    if (!used) for (const prefix of dynamicPrefixes) if (cls.startsWith(prefix)) { used = true; break; }
    usageCache.set(cls, used);
  }
  return usageCache.get(cls);
}

function selectorIsDead(selector) {
  // un selector no puede casar si alguna de sus clases no existe en el markup
  return classesInSelector(selector).some((cls) => !classIsUsed(cls));
}

function ruleIsDead(rule) {
  if (rule.selector.startsWith("@") || rule.selector.startsWith(":")) return false;
  const selectors = splitSelectors(rule.selector);
  if (!selectors.length) return false;
  return selectors.every(selectorIsDead);
}

const removedReport = [];

function processRules(rules, media, file) {
  // A) muertas
  let out = rules.filter((node) => {
    if (node.type !== "rule") return true;
    if (ruleIsDead(node)) {
      removedReport.push(`[muerta] ${file} ${media} ${node.selector}`);
      return false;
    }
    return true;
  });
  // limpia selectores muertos dentro de grupos con parte viva
  for (const node of out) {
    if (node.type !== "rule" || node.selector.startsWith("@")) continue;
    const selectors = splitSelectors(node.selector);
    if (selectors.length < 2) continue;
    const alive = selectors.filter((sel) => !selectorIsDead(sel));
    if (alive.length && alive.length < selectors.length) {
      removedReport.push(`[selector-muerto] ${file} ${media} ${selectors.filter((s) => selectorIsDead(s)).join(", ")}`);
      node.selector = alive.join(", ");
    }
  }
  // B) totalmente sombreadas (mismo selector, mismas props redeclaradas después)
  const groups = new Map();
  out.forEach((node, index) => {
    if (node.type !== "rule") return;
    const key = node.selector;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(index);
  });
  const shadowed = new Set();
  for (const [, indices] of groups) {
    if (indices.length < 2) continue;
    for (let a = 0; a < indices.length - 1; a++) {
      const decls = declarationsOf(out[indices[a]].body);
      if (!decls.length || out[indices[a]].body.includes("{")) continue; // anidado: no tocar
      const later = new Set();
      for (let b = a + 1; b < indices.length; b++) for (const d of declarationsOf(out[indices[b]].body)) later.add(d.prop);
      if (decls.every((d) => later.has(d.prop))) {
        shadowed.add(indices[a]);
        removedReport.push(`[sombreada] ${file} ${media} ${out[indices[a]].selector}`);
      }
    }
  }
  out = out.filter((node, index) => !shadowed.has(index));
  // B2) poda a nivel de propiedad: en grupos del mismo selector, una declaración
  // anterior cuyo prop se redeclara después (con igual o mayor importancia) nunca
  // puede ganar — misma especificidad, gana la última. Estrictamente seguro.
  const groups2 = new Map();
  out.forEach((node, index) => {
    if (node.type !== "rule" || node.selector.startsWith("@") || node.body.includes("{")) return;
    if (!groups2.has(node.selector)) groups2.set(node.selector, []);
    groups2.get(node.selector).push(index);
  });
  const emptied = new Set();
  for (const [, indices] of groups2) {
    if (indices.length < 2) continue;
    for (let a = 0; a < indices.length - 1; a++) {
      const laterProps = new Map(); // prop → tiene !important más adelante
      for (let b = a + 1; b < indices.length; b++) {
        for (const d of declarationsOf(out[indices[b]].body)) {
          const important = /!important\s*$/.test(d.value);
          laterProps.set(d.prop, (laterProps.get(d.prop) || false) || important);
        }
      }
      const decls = declarationsOf(out[indices[a]].body);
      const kept = decls.filter((d) => {
        if (!laterProps.has(d.prop)) return true;
        const earlyImportant = /!important\s*$/.test(d.value);
        return earlyImportant && !laterProps.get(d.prop);
      });
      if (kept.length === decls.length) continue;
      removedReport.push(`[props-podadas:${decls.length - kept.length}] ${file} ${media} ${out[indices[a]].selector}`);
      if (!kept.length) { emptied.add(indices[a]); continue; }
      out[indices[a]].body = "\n" + kept.map((d) => `  ${d.prop}:${d.value};`).join("\n");
    }
  }
  out = out.filter((node, index) => !emptied.has(index));
  // C) idénticas consecutivas → grupo de selectores
  const merged = [];
  for (const node of out) {
    const previous = merged.at(-1);
    if (node.type === "rule" && previous?.type === "rule" && !node.selector.startsWith("@")
      && previous.body.trim() === node.body.trim() && !previous.selector.startsWith("@")) {
      previous.selector = `${previous.selector},\n${node.selector}`;
      removedReport.push(`[fusionada] ${file} ${media} ${node.selector}`);
      continue;
    }
    merged.push(node);
  }
  return merged;
}

mkdirSync("output/css-refactor", { recursive: true });
// tokens.css queda fuera: el :root es intocable.
const files = ["base.css", "components.css", "screener.css", "stock.css", "review.css", "research-desk.css", "lists.css", "sectors.css", "market-health.css", "ipo-radar.css"];
let totalBefore = 0, totalAfter = 0;
for (const file of files) {
  const css = readFileSync(`styles/${file}`, "utf8");
  totalBefore += css.split("\n").length;
  const nodes = parseCss(css);
  // procesar top-level y dentro de cada @media
  let processed = processRules(nodes, "", file);
  processed = processed.map((node) => {
    if (node.type !== "at") return node;
    return { ...node, children: processRules(node.children, node.selector, file) };
  }).filter((node) => node.type !== "at" || node.children.some((c) => c.type !== "comment"));
  // D) fundir @media consecutivos con la misma query
  const compact = [];
  for (const node of processed) {
    const previous = compact.at(-1);
    if (node.type === "at" && previous?.type === "at" && previous.selector === node.selector) {
      previous.children.push(...node.children);
      continue;
    }
    compact.push(node);
  }
  const text = compact.map((node) => stringifyRule(node)).join("\n\n") + "\n";
  writeFileSync(`styles/${file}`, text);
  totalAfter += text.split("\n").length;
  console.log(`${file}: ${css.split("\n").length} → ${text.split("\n").length}`);
}
writeFileSync("output/css-refactor/removed.txt", removedReport.join("\n"));
console.log(`TOTAL: ${totalBefore} → ${totalAfter} líneas · ${removedReport.length} acciones (informe en output/css-refactor/removed.txt)`);
