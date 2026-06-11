// Capturas de todas las rutas para comparar render antes/después del refactor CSS.
// Uso: node scripts/css-refactor/snap.mjs <prefijo>   (ej. "before" | "after")
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const prefix = process.argv[2] || "before";
const ROUTES = [
  ["screener", "/"],
  ["stock", "/stock/NVDA"],
  ["review", "/review"],
  ["research-desk", "/research-desk"],
  ["lists", "/lists"],
  ["sectors", "/sectors"],
  ["market-health", "/market-health"],
  ["ipo-radar", "/ipo-radar"],
];

mkdirSync("output/css-refactor", { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
for (const [name, path] of ROUTES) {
  try {
    await page.goto(`http://127.0.0.1:3000${path}`, { waitUntil: "networkidle", timeout: 90000 });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `output/css-refactor/${prefix}-${name}.png`, fullPage: false });
    console.log(`${prefix}-${name}.png ok`);
  } catch (error) {
    console.log(`${prefix}-${name} FALLO: ${error.message.split("\n")[0]}`);
  }
}
await browser.close();
