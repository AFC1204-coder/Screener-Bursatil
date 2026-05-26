import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();
const ENV_FILES = [".env.local", ".env"];

function loadEnv() {
  for (const file of ENV_FILES) {
    const fullPath = path.join(ROOT, file);
    if (!fs.existsSync(fullPath)) continue;
    const raw = fs.readFileSync(fullPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const index = trimmed.indexOf("=");
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

loadEnv();

import { buildCoverageReport } from "../lib/coveragePlan.js";

async function main() {
  try {
    const report = await buildCoverageReport();
    console.log("=== COVERAGE REPORT SUCCESS ===");
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error("Error building coverage report:", error.message);
  }
}

main();
