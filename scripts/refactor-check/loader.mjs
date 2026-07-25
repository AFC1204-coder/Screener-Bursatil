// Loader de Node para el harness: resuelve "@/..." a la raíz del proyecto y
// fuerza formato ESM en los .js del proyecto (package.json no declara "type").
// Los .jsx además pasan por SWC: Node no parsea JSX, y el grafo del harness
// llega a componentes (lib/screenerFormat.js -> app/components/ui/MetricSource.jsx).
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

const ROOT = new URL("../../", import.meta.url);
const EXTENSIONS = [".js", ".jsx", ".mjs"];

export async function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) {
    const base = new URL(specifier.slice(2), ROOT);
    if (EXTENSIONS.some((extension) => base.href.endsWith(extension))) {
      return { url: base.href, shortCircuit: true };
    }
    for (const extension of EXTENSIONS) {
      const candidate = new URL(base.href + extension);
      if (existsSync(candidate)) return { url: candidate.href, shortCircuit: true };
    }
    // Ningún candidato existe: devolvemos .js para que el ENOENT nombre la ruta esperada.
    return { url: `${base.href}.js`, shortCircuit: true };
  }
  return next(specifier, context);
}

let swcPromise = null;

// @next/swc-wasm-nodejs es devDependency del proyecto y no depende de la plataforma.
async function transpileJsx(source, url) {
  swcPromise ??= import("@next/swc-wasm-nodejs");
  const swc = await swcPromise;
  const output = swc.transformSync(source, {
    filename: url,
    sourceMaps: false,
    module: { type: "es6" },
    jsc: {
      target: "es2022",
      parser: { syntax: "ecmascript", jsx: true },
      // Runtime automático: los componentes del proyecto no importan React.
      transform: { react: { runtime: "automatic" } },
    },
  });
  return output.code;
}

export async function load(url, context, next) {
  if (url.startsWith(ROOT.href) && !url.includes("node_modules")) {
    if (url.endsWith(".js")) {
      const source = await readFile(new URL(url), "utf8");
      return { format: "module", source, shortCircuit: true };
    }
    if (url.endsWith(".jsx")) {
      const source = await readFile(new URL(url), "utf8");
      return { format: "module", source: await transpileJsx(source, url), shortCircuit: true };
    }
  }
  return next(url, context);
}
