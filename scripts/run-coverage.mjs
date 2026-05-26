import { register } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";

const loaderPath = path.resolve(process.cwd(), "scripts", "loader.mjs");
const loaderUrl = pathToFileURL(loaderPath).href;

register(loaderUrl, pathToFileURL(import.meta.url));

await import("./get-coverage.mjs");
