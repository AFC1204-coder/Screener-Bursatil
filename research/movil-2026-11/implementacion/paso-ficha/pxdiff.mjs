import { createRequire } from "node:module";
const [repo, dir, ...names] = process.argv.slice(2);
const require = createRequire(repo + "/package.json");
const sharp = require("sharp");
for (const n of names) {
  const a = sharp(`${dir}/antes-${n}.png`); const b = sharp(`${dir}/despues-${n}.png`);
  const [ma, mb] = [await a.metadata(), await b.metadata()];
  if (ma.width !== mb.width || ma.height !== mb.height) { console.log(n, "TAMAÑO", ma.width, ma.height, mb.width, mb.height); continue; }
  const [ra, rb] = [await a.raw().toBuffer(), await b.raw().toBuffer()];
  let diff = 0, minY = Infinity, maxY = -1; const ch = ma.channels;
  for (let i = 0; i < ra.length; i += ch) { if (ra[i] !== rb[i] || ra[i+1] !== rb[i+1] || ra[i+2] !== rb[i+2]) { diff++; const y = Math.floor(i / ch / ma.width); minY = Math.min(minY, y); maxY = Math.max(maxY, y); } }
  console.log(n, `${ma.width}x${ma.height}`, "px distintos:", diff, diff ? `filas ${minY}-${maxY}` : "");
}
