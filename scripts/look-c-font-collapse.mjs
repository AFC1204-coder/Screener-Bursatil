#!/usr/bin/env node
/**
 * LOOK-C: colapsa font-size: Npx → tokens v2 en CSS de alcance.
 * Uso: node scripts/look-c-font-collapse.mjs [archivo.css ...]
 */
import { readFileSync, writeFileSync } from "node:fs";

const HERO_KEEP = new Set([30, 32, 34, 56]);

function mapFontSize(px) {
  if (HERO_KEEP.has(px)) return null;
  if (px >= 6.5 && px <= 8.5) return "var(--text-xxs)";
  if (px >= 9 && px <= 10.5) return "var(--text-xs)";
  if (px >= 11 && px <= 11.5) return "var(--text-xs)";
  if (px >= 12 && px <= 13) return "var(--text-s)";
  if (px >= 13.5 && px <= 15) return "var(--text-m)";
  if (px === 16 || px === 18) return "var(--text-l)";
  if (px === 17) return "var(--data-m)";
  if (px >= 19 && px <= 20) return "var(--display-m)";
  if (px === 13) return "var(--display-s)";
  if (px >= 22 && px <= 26) return "var(--data-l)";
  if (px >= 27 && px <= 38) return "var(--data-xl)";
  return null;
}

function collapseCss(content) {
  return content.replace(/font-size:\s*([0-9]+(?:\.[0-9]+)?)px/g, (match, numStr, offset) => {
    const before = content.slice(Math.max(0, offset - 80), offset);
    if (/clamp\s*\([^)]*$/.test(before)) return match;
    const px = parseFloat(numStr);
    const token = mapFontSize(px);
    return token ? `font-size:${token}` : match;
  });
}

const files = process.argv.slice(2);
if (!files.length) {
  console.error("Usage: node look-c-font-collapse.mjs <file.css> ...");
  process.exit(1);
}

for (const file of files) {
  const before = readFileSync(file, "utf8");
  const after = collapseCss(before);
  writeFileSync(file, after);
  const remaining = (after.match(/font-size:\s*[0-9]/g) || []).length;
  console.log(`${file}: ${remaining} numeric font-size left`);
}
