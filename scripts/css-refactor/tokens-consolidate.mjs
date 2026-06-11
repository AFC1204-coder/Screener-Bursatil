// Consolida los 5 bloques :root apilados de styles/tokens.css en un único :root
// resuelto (gana la última declaración), agrupado por categoría. Emite además
// output/css-refactor/tokens-report.txt con el histórico de cada variable
// redeclarada y separa en una sección comentada las variables sin uso.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { declarationsOf, loadSources, parseCss } from "./parse.mjs";

const css = readFileSync("styles/tokens.css", "utf8");
const nodes = parseCss(css);

// 1) histórico de declaraciones en orden de aparición
const history = new Map(); // nombre → [valores]
const order = []; // primer orden de aparición
for (const node of nodes) {
  if (node.type !== "rule" || !/^:root\b/.test(node.selector)) continue;
  for (const { prop, value } of declarationsOf(node.body)) {
    if (!history.has(prop)) { history.set(prop, []); order.push(prop); }
    history.get(prop).push(value);
  }
}
const finalValue = (prop) => history.get(prop).at(-1);

// 2) consumo: var(--x) en styles/*.css (fuera de tokens) y en el código (JSX/JS)
const cssFiles = ["base.css", "components.css", "screener.css", "stock.css", "review.css", "research-desk.css", "lists.css", "sectors.css", "market-health.css", "ipo-radar.css"]
  .map((file) => readFileSync(`styles/${file}`, "utf8")).join("\n");
const sourceText = loadSources(process.cwd()).map((s) => s.text).join("\n");
const tokensValues = [...history.values()].flat().join("\n"); // referencias entre variables
function isConsumed(prop) {
  if (!prop.startsWith("--")) return true; // color-scheme y similares
  const ref = `var(${prop}`;
  return cssFiles.includes(ref) || sourceText.includes(ref) || tokensValues.includes(ref);
}

// 3) categorías
const CATEGORIES = [
  ["Colores base (fondos, superficies, líneas)", /^--(bg|surface\d*|panel\d*|line\d*)$/],
  ["Tipografía (colores de texto)", /^--(text|muted|soft)$/],
  ["Acentos semánticos (estado, señal, marca)", /^--(accent.*|lime|red|amber|teal|gold\d*)$/],
  ["Espaciado", /^--space-\d+$/],
  ["Radios", /^--radius.*$/],
  ["Sombras", /^--shadow.*$/],
];
function categoryOf(prop) {
  if (!prop.startsWith("--")) return "Base";
  for (const [name, re] of CATEGORIES) if (re.test(prop)) return name;
  return "Otros";
}

const used = order.filter(isConsumed);
const unused = order.filter((prop) => !isConsumed(prop));
const groups = new Map([["Base", []]]);
for (const [name] of CATEGORIES) groups.set(name, []);
groups.set("Otros", []);
for (const prop of used) groups.get(categoryOf(prop)).push(prop);

const pad = (prop) => prop.padEnd(Math.max(...order.map((p) => p.length)) + 1);
let out = "/* styles/tokens.css — variables de diseño (:root). Consolidado: 5 bloques de pasadas\n";
out += "   de rediseño resueltos a su valor final efectivo (ganaba la última declaración).\n";
out += "   Histórico completo de valores enterrados: output/css-refactor/tokens-report.txt. */\n\n";
out += "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600;700&display=swap');\n\n";
out += ":root {\n";
for (const [category, props] of groups) {
  if (!props.length) continue;
  if (category !== "Base") out += `\n  /* ${category} */\n`;
  for (const prop of props) out += `  ${pad(prop)}: ${finalValue(prop)};\n`;
}
if (unused.length) {
  out += "\n  /* Sin uso: definidas en pasadas anteriores y no consumidas por ningún CSS ni JSX.\n";
  out += "     Conservadas comentadas por si se reactivan; candidatas a borrar. */\n";
  for (const prop of unused) out += `  /* ${pad(prop)}: ${finalValue(prop)}; */\n`;
}
out += "}\n";
writeFileSync("styles/tokens.css", out);

// 4) informe de auditoría
mkdirSync("output/css-refactor", { recursive: true });
let report = "Variables con más de una declaración en los 5 :root históricos (gana la última):\n\n";
for (const prop of order) {
  const values = history.get(prop);
  if (values.length < 2) continue;
  report += `${prop} (${values.length} declaraciones)\n`;
  values.forEach((value, index) => {
    report += `  ${index === values.length - 1 ? "GANA →" : "      "} ${value}\n`;
  });
  report += "\n";
}
report += `\nVariables sin uso (conservadas comentadas): ${unused.join(", ") || "ninguna"}\n`;
report += `Variables únicas totales: ${order.length} · redeclaradas: ${order.filter((p) => history.get(p).length > 1).length}\n`;
writeFileSync("output/css-refactor/tokens-report.txt", report);
console.log(out);
console.log("=== informe en output/css-refactor/tokens-report.txt ===");
console.log(report.split("\n").slice(-3).join("\n"));
