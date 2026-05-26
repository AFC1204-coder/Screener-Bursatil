import { register } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";

// Get absolute path to the loader script and convert to file:// URL
const loaderPath = path.resolve(process.cwd(), "scripts", "loader.mjs");
const loaderUrl = pathToFileURL(loaderPath).href;

console.log(`[BOOTSTRAP] Registering ESM custom loader: ${loaderUrl}`);

// Register the custom loader
register(loaderUrl, pathToFileURL(import.meta.url));

// Execute the test script
await import("./test-esef.mjs");
