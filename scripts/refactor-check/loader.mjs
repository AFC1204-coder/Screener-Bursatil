// Loader de Node para el harness: resuelve "@/..." a la raíz del proyecto y
// fuerza formato ESM en los .js del proyecto (package.json no declara "type").
import { readFile } from "node:fs/promises";

const ROOT = new URL("../../", import.meta.url);

export async function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) {
    let target = new URL(specifier.slice(2), ROOT).href;
    if (!target.endsWith(".js") && !target.endsWith(".mjs")) target += ".js";
    return { url: target, shortCircuit: true };
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url.startsWith(ROOT.href) && url.endsWith(".js") && !url.includes("node_modules")) {
    const source = await readFile(new URL(url), "utf8");
    return { format: "module", source, shortCircuit: true };
  }
  return next(url, context);
}
