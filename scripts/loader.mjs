import { pathToFileURL, fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

export async function resolve(specifier, context, nextResolve) {
  let target = specifier;
  const rootDir = process.cwd();

  if (target.startsWith("@/")) {
    target = path.join(rootDir, target.replace(/^@\//, ""));
  } else if (context.parentURL && (specifier.startsWith("./") || specifier.startsWith("../"))) {
    try {
      const parentPath = fileURLToPath(new URL(context.parentURL));
      const parentDir = path.dirname(parentPath);
      target = path.resolve(parentDir, specifier);
    } catch (e) {
      // If parentURL is not a valid file URL, ignore
    }
  }

  // If the target is an absolute system path, resolve extensions and indexes
  if (path.isAbsolute(target)) {
    let resolvedPath = target;
    if (!fs.existsSync(resolvedPath)) {
      if (fs.existsSync(resolvedPath + ".js")) {
        resolvedPath = resolvedPath + ".js";
      } else if (fs.existsSync(resolvedPath + ".json")) {
        resolvedPath = resolvedPath + ".json";
      } else if (fs.existsSync(resolvedPath + ".mjs")) {
        resolvedPath = resolvedPath + ".mjs";
      }
    } else {
      const stat = fs.statSync(resolvedPath);
      if (stat.isDirectory()) {
        if (fs.existsSync(path.join(resolvedPath, "index.js"))) {
          resolvedPath = path.join(resolvedPath, "index.js");
        } else if (fs.existsSync(path.join(resolvedPath, "index.mjs"))) {
          resolvedPath = path.join(resolvedPath, "index.mjs");
        }
      }
    }

    target = pathToFileURL(resolvedPath).href;
  }

  return nextResolve(target, context);
}
