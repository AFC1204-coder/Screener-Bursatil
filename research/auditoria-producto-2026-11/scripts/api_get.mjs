// Descarga autenticada de endpoints (solo GET) contra :3320. Uso: node api_get.mjs <repo> <outdir> <ruta> [<ruta>...]
// Guarda cada respuesta como JSON en outdir; no imprime el token.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const [repo, outdir, ...rutas] = process.argv.slice(2);
const BASE = "http://localhost:3320";
const src = readFileSync(repo + "/.env.local", "utf8");
const line = src.split(/\r?\n/).find((l) => /^STATSEDGE_ACCESS_TOKEN\s*=/.test(l));
const token = line.replace(/^STATSEDGE_ACCESS_TOKEN\s*=\s*/, "").trim().replace(/^['"]|['"]$/g, "");
mkdirSync(outdir, { recursive: true });
const r = await fetch(`${BASE}/api/auth/session`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
const cookie = (r.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
for (const ruta of rutas) {
  const t0 = Date.now();
  const res = await fetch(BASE + ruta, { headers: { cookie } });
  const txt = await res.text();
  const name = ruta.replace(/[^a-zA-Z0-9]+/g, "_").slice(0, 90) + ".json";
  writeFileSync(`${outdir}/${name}`, txt);
  console.log(res.status, ruta, `${(txt.length / 1024).toFixed(0)} KB`, `${Date.now() - t0} ms`, name);
}
