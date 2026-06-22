import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ROUTES_ROOT = path.join(ROOT, "app/api");
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

const ALWAYS_PROTECTED_ROUTES = new Set([
  "app/api/alerts/route.js",
  "app/api/favorites/route.js",
  "app/api/favorites/snapshots/route.js",
  "app/api/mvp-health/route.js",
  "app/api/scan/route.js",
  "app/api/scan/cancel/route.js",
  "app/api/scan/continue/route.js",
  "app/api/scan-coverage/route.js",
  "app/api/scans/route.js",
  "app/api/settings/route.js",
]);

const METHOD_PROTECTED_ROUTES = new Map([
  ["app/api/leaderboards/route.js", ["POST"]],
]);

function walkRouteFiles(dir = ROUTES_ROOT) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) return walkRouteFiles(absolute);
    return entry.name === "route.js" ? [absolute] : [];
  });
}

function relativeRoute(absolute) {
  return path.relative(ROOT, absolute).split(path.sep).join("/");
}

function exportedMethods(source = "") {
  return HTTP_METHODS.filter((method) => {
    const pattern = new RegExp(`export\\s+(?:async\\s+function\\s+${method}\\b|const\\s+${method}\\s*=)`);
    return pattern.test(source);
  });
}

function methodBody(source = "", method = "", seen = new Set()) {
  if (seen.has(method)) return "";
  seen.add(method);
  const alias = source.match(new RegExp(`export\\s+const\\s+${method}\\s*=\\s*(${HTTP_METHODS.join("|")})\\s*;`));
  if (alias) return methodBody(source, alias[1], seen);

  const match = source.match(new RegExp(`export\\s+async\\s+function\\s+${method}\\b`));
  if (!match) return "";
  const start = match.index;
  const tail = source.slice(start + match[0].length);
  const nextExport = tail.search(new RegExp(`\\nexport\\s+(?:async\\s+function|const)\\s+(?:${HTTP_METHODS.join("|")})\\b`));
  return nextExport === -1 ? source.slice(start) : source.slice(start, start + match[0].length + nextExport);
}

function protectedMethodsFor(route, methods) {
  if (route.startsWith("app/api/jobs/") || route.startsWith("app/api/cron/")) return methods;
  if (ALWAYS_PROTECTED_ROUTES.has(route)) return methods;
  return METHOD_PROTECTED_ROUTES.get(route) || [];
}

describe("internal API protection policy", () => {
  it("keeps privileged API routes guarded at route level", () => {
    const failures = [];
    const protectedSpecs = [];

    for (const file of walkRouteFiles()) {
      const route = relativeRoute(file);
      const source = fs.readFileSync(file, "utf8");
      const methods = exportedMethods(source);
      const protectedMethods = protectedMethodsFor(route, methods);
      if (!protectedMethods.length) continue;
      protectedSpecs.push({ route, protectedMethods });

      for (const method of protectedMethods) {
        const body = methodBody(source, method);
        const hasGuard = /require(?:Persistence|Internal)Auth\s*\(|authorized\s*\(|isInternalRequest\s*\(/.test(body);
        if (!hasGuard) failures.push(`${route} ${method}`);
      }
    }

    expect(protectedSpecs.length).toBeGreaterThanOrEqual(20);
    expect(failures).toEqual([]);
  });
});
