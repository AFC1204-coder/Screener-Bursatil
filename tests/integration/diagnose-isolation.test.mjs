// Diagnóstico READ-ONLY: confirmar aislamiento del owner_id antes de cualquier
// escritura real contra el proyecto Supabase.
//
// Ejecución: `npx vitest run tests/integration/diagnose-isolation.test.mjs`
//
// Estrategia: tres queries de solo lectura para verificar que el override
// STATSEDGE_OWNER_ID=playwright-check produce owner_id correcto en:
//   1. PostgREST directo (fetch nativo con apikey) — control de bajo nivel
//   2. supabaseRequest (vía lib/supabaseServer.js) — el camino real de la app
//   3. supabaseConfig() — el export puro que usa la app
//
// Solo se permiten queries SELECT con LIMIT pequeño. NUNCA escribe.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Carga .env.local ANTES de cualquier import que lea env.
const envLocal = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envLocal)) {
  for (const line of fs.readFileSync(envLocal, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const idx = trimmed.indexOf("=");
    const k = trimmed.slice(0, idx).trim();
    const v = trimmed.slice(idx + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

const TARGET_OWNER = "playwright-check";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const skipIntegration = !SUPABASE_URL || !SERVICE_KEY;
const describeIf = skipIntegration ? describe.skip : describe;

describeIf("DIAGNÓSTICO READ-ONLY · aislamiento owner_id playwright-check", () => {
  it("confirmar env vars cargadas", () => {
    expect(SUPABASE_URL).toMatch(/^https:\/\/[a-z0-9]+\.supabase\.co$/);
    expect(SERVICE_KEY.length).toBeGreaterThan(20);
    console.log(`     SUPABASE_URL: ${SUPABASE_URL}`);
    console.log(`     SERVICE_KEY length: ${SERVICE_KEY.length}`);
  });

  it("1 · PostgREST directo: 0 filas bajo playwright-check", async () => {
    const url = `${SUPABASE_URL}/rest/v1/daily_bars?owner_id=eq.${TARGET_OWNER}&select=id&limit=1`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
    });
    const text = await res.text();
    console.log(`     GET ${url}`);
    console.log(`     status: ${res.status}`);
    console.log(`     content-range header: ${res.headers.get("content-range") || "(none)"}`);
    console.log(`     body: ${text.slice(0, 200)}`);
    expect(res.status).toBe(200);
    // playwright-check nunca se ha usado → debería ser [] (count=0).
    expect(text).toBe("[]");
  });

  it("2 · PostgREST directo: 0 filas en favorites bajo playwright-check", async () => {
    const url = `${SUPABASE_URL}/rest/v1/favorites?owner_id=eq.${TARGET_OWNER}&select=id&limit=1`;
    const res = await fetch(url, {
      method: "GET",
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    const text = await res.text();
    console.log(`     GET ${url}`);
    console.log(`     status: ${res.status}, body: ${text.slice(0, 200)}`);
    expect(res.status).toBe(200);
    expect(text).toBe("[]");
  });

  it("3 · supabaseConfig() reporta owner_id = playwright-check tras el override", async () => {
    process.env.STATSEDGE_OWNER_ID = TARGET_OWNER;
    // dynamic import para que el módulo vea el env actualizado al importarse.
    const { supabaseConfig } = await import("@/lib/supabaseServer.js");
    const cfg = supabaseConfig();
    console.log(`     supabaseConfig(): ${JSON.stringify({ ownerId: cfg.ownerId, configured: cfg.configured, url: cfg.url?.slice(0, 40) })}`);
    expect(cfg.ownerId).toBe(TARGET_OWNER);
    expect(cfg.configured).toBe(true);
  });

  it("4 · readDailyBarsCache bajo playwright-check → 0 filas (via código de app)", async () => {
    process.env.STATSEDGE_OWNER_ID = TARGET_OWNER;
    const { readDailyBarsCache } = await import("@/lib/dailyBarsCache.js");
    const r = await readDailyBarsCache("PROBE-SYMBOL-NONEXISTENT", { range: "MAX" });
    console.log(`     readDailyBarsCache result: ${JSON.stringify({ status: r.status, rows: r.rows, hit: r.hit })}`);
    // Esperado: status="miss" (no hay barras), rows=0.
    expect(r.rows).toBe(0);
    expect(["miss", "stale"]).toContain(r.status);
  });

  it("5 · isSymbolReferenced para símbolo inexistente devuelve false", async () => {
    process.env.STATSEDGE_OWNER_ID = TARGET_OWNER;
    const cache = await import("@/lib/dailyBarsCache.js");
    // isSymbolReferenced no es exportado; lo probamos indirectamente: el cap
    // aplicado debe ser 400 (no 1260). Verificable vía writeDailyBarsCache pero
    // eso escribe — no lo invocamos. En su lugar, simplemente confirmamos que
    // las 3 queries EXISTS no encuentran filas (deberían devolver []).
    const { supabaseRequest } = await import("@/lib/supabaseServer.js");
    for (const t of ["favorites", "notes", "alerts"]) {
      const rows = await supabaseRequest(t, {
        query: `owner_id=eq.${TARGET_OWNER}&symbol=eq.PROBE-SYMBOL&select=id&limit=1`,
      });
      console.log(`     ${t}: ${JSON.stringify(rows)}`);
      expect(Array.isArray(rows)).toBe(true);
      expect(rows.length).toBe(0);
    }
  });
});