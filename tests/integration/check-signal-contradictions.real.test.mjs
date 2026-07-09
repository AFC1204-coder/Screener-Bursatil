// PIEZA 2 — Verificación real de signalContradictions contra lógica pura.
//
// Inserta 3 filas sintéticas en scan_results bajo un owner_id ÚNICO por
// ejecución, con scores precomputados a mano para forzar que las reglas C1, C2, C5
// disparen. NO depende de un scan real ni de fetches externos — los scores
// se eligen directamente para cruzar los umbrales declarados en
// lib/signalContradictions.js:99-130.
//
// evaluateContradictions(row) es función pura (sin IO) — se importa y se
// llama directamente. NO usamos Playwright (acordado). NO escribimos en la UI.
// Lo que validamos es la lógica de detección contra las reglas C1-C6
// declaradas en CONTRADICTION_RULES.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Carga .env.local manualmente.
const envLocal = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envLocal)) {
  for (const line of fs.readFileSync(envLocal, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const idx = t.indexOf("=");
    const k = t.slice(0, idx).trim();
    const v = t.slice(idx + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

delete process.env.STATSEDGE_OWNER_ID;
// Owner ÚNICO por ejecución (timestamp+pid+random). Antes esta suite y
// PIEZA 1 compartían owner_id="playwright-check-2" y se borraban datos
// mutuamente al hacer cleanup global en paralelo. Ahora cada suite crea
// y limpia solo sus propias filas. owner_id es `text` en el schema.
const OWNER = `playwright-signal-cx-${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
if (OWNER === "personal" || OWNER === "") {
  throw new Error(`SAFETY ABORT: owner="${OWNER}"`);
}

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const skipIntegration = !SUPABASE_URL || !SERVICE_KEY;
const describeIf = skipIntegration ? describe.skip : describe;

describeIf("PIEZA 2 · signalContradictions C1-C6 (lógica pura)", () => {
  let supabaseRequest;
  let evaluateContradictions;
  let scanId;
  let results = {};
  // Scan header para anclar las filas scan_results (FK scan_id). Deriva del
  // OWNER único de esta ejecución para evitar conflictos de uniqueness con
  // leftovers de otras suites/corridas.
  const SCAN_LOCAL_ID = `${OWNER}-cx-${Date.now()}`;

  // Filas sintéticas diseñadas para disparar reglas específicas:
  const SCENARIOS = [
    {
      name: "C1 · Líder frenándose",
      symbol: "PLAYWRIGHT-C1",
      scores: { rsGlobalPct: 75, momentumScore: 25 },
      expectedRule: { key: "leader-stalling", tier: "thesis", label: "Líder frenándose" },
      // Regla C1: rsGlobalPct>=70 ∧ momentumScore<=30
    },
    {
      name: "C2 · Base bajo distribución",
      symbol: "PLAYWRIGHT-C2",
      scores: { setupQualityScore: 80, adProxyScore: 30 },
      expectedRule: { key: "base-under-distribution", tier: "thesis", label: "Base bajo distribución" },
      // Regla C2: setupQualityScore>=70 ∧ adProxyScore<=35
    },
    {
      name: "C5 · Movimiento no operable",
      symbol: "PLAYWRIGHT-C5",
      scores: { momentumScore: 80, liquidityScore: 20 },
      expectedRule: { key: "untraceable-move", tier: "execution", label: "Movimiento no operable" },
      // Regla C5: momentumScore>=75 ∧ liquidityScore<=25
    },
  ];

  beforeAll(async () => {
    if (OWNER === "personal" || OWNER === "") {
      throw new Error(`SAFETY ABORT en beforeAll: owner="${OWNER}"`);
    }
    process.env.STATSEDGE_OWNER_ID = OWNER;
    const srv = await import("@/lib/supabaseServer.js");
    supabaseRequest = srv.supabaseRequest;
    const cfg = srv.supabaseConfig();
    if (cfg.ownerId !== OWNER) {
      throw new Error(`SAFETY ABORT: supabaseConfig() ownerId="${cfg.ownerId}" esperado "${OWNER}"`);
    }

    const cx = await import("@/lib/signalContradictions.js");
    evaluateContradictions = cx.evaluateContradictions;

    console.log(`\n[PIEZA 2] Verificación real contra ${SUPABASE_URL.slice(0, 40)}...`);
    console.log(`[PIEZA 2] Owner: ${OWNER}  Escenarios: ${SCENARIOS.length}`);

    // Pre-cleanup.
    console.log(`[PRE-CLEANUP] Borrando leftovers previos bajo ${OWNER}`);
    await supabaseRequest("scan_results", { method: "DELETE", query: `owner_id=eq.${OWNER}`, prefer: "return=minimal" });
    await supabaseRequest("scans", { method: "DELETE", query: `owner_id=eq.${OWNER}`, prefer: "return=minimal" });

    // Crea un scan header para anclar las filas (FK scan_id → scans.id).
    const inserted = await supabaseRequest("scans", {
      method: "POST",
      body: [{
        owner_id: OWNER,
        local_id: SCAN_LOCAL_ID,
        name: "Pieza2 signalContradictions fixtures",
        preset: `${OWNER}-cx`,
        settings: {
          scanSymbols: SCENARIOS.map((s) => s.symbol),
          progress: { status: "done", cursor: 0, chunkSize: SCENARIOS.length, completed: SCENARIOS.length, total: SCENARIOS.length, saved: 0, errors: [], startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
          markets: ["US"],
        },
        row_count: 0,
      }],
      prefer: "return=representation",
    });
    scanId = inserted[0].id;
    console.log(`     scan header creado: id=${scanId.slice(0, 8)}...`);
  }, 60_000);

  afterAll(async () => {
    if (skipIntegration) return;
    if (OWNER === "personal" || OWNER === "") {
      throw new Error(`SAFETY ABORT en afterAll: owner="${OWNER}"`);
    }
    console.log(`\n[CLEANUP] Borrando datos de test bajo ${OWNER}`);
    await supabaseRequest("scan_results", { method: "DELETE", query: `owner_id=eq.${OWNER}`, prefer: "return=minimal" });
    await supabaseRequest("scans", { method: "DELETE", query: `owner_id=eq.${OWNER}`, prefer: "return=minimal" });

    try {
      const r1 = await supabaseRequest("scans", { query: `owner_id=eq.${OWNER}&select=id&limit=1` });
      const r2 = await supabaseRequest("scan_results", { query: `owner_id=eq.${OWNER}&select=id&limit=1` });
      const c1 = Array.isArray(r1) ? r1.length : -1;
      const c2 = Array.isArray(r2) ? r2.length : -1;
      console.log(`[POST-CLEANUP] scans=${c1}  scan_results=${c2}  (esperado: 0,0)`);
      if (c1 !== 0 || c2 !== 0) {
        console.warn(`[POST-CLEANUP WARN] cleanup incompleto: scans=${c1} scan_results=${c2}`);
      }
    } catch (err) {
      console.warn(`[POST-CLEANUP WARN] verificación falló: ${err.message}`);
    }
    console.log(`[SUMMARY] 2=${results.p2}`);
  }, 30_000);

  for (const scenario of SCENARIOS) {
    it(`${scenario.name}`, async () => {
      if (OWNER === "personal" || OWNER === "") {
        throw new Error(`SAFETY ABORT en it: owner="${OWNER}"`);
      }

      // Construye la fila sintética (forma que evaluateContradictions acepta).
      const rowFixture = {
        ...scenario.scores,
        // signalCoverage vacío: sin partial:true → todas las señales son "firmes".
        signalCoverage: {},
      };

      // 1. Evalúa la lógica pura localmente (la parte que importa para C1-C6).
      const cxResult = evaluateContradictions(rowFixture);
      console.log(`     [${scenario.name}] evaluateContradictions:`);
      console.log(`       signalContradictions=${JSON.stringify(cxResult.signalContradictions)}`);
      console.log(`       contradictionsSkipped=${JSON.stringify(cxResult.contradictionsSkipped)}`);

      // 2. Verifica que disparó la regla esperada.
      const triggered = cxResult.signalContradictions.find(
        (r) => r.key === scenario.expectedRule.key,
      );
      console.log(`       triggered=${JSON.stringify(triggered)}`);
      expect(triggered).toBeDefined();
      expect(triggered.tier).toBe(scenario.expectedRule.tier);
      expect(triggered.label).toBe(scenario.expectedRule.label);
      // Verifica que las señales correctas aparecen en el output:
      // (las 2 implicadas en el check AND).
      const signalKeys = triggered.signals || [];
      const expectedKeys = Object.keys(scenario.scores);
      for (const k of expectedKeys) {
        expect(signalKeys).toContain(k);
      }

      // 3. Persiste la fila en scan_results para tener evidencia física en DB
      //    de que los scores se almacenan correctamente con la forma esperada
      //    por la UI. NO ejecutamos finalize aquí — el propósito es solo
      //    verificar la detección de contradicciones, no el flujo de finalize.
      //
      //    IMPORTANTE: el DDL de scan_results (schema.sql:30-50) solo tiene
      //    weinstein_score/minervini_score/risk_score/rs_rating/total_score
      //    como columnas top-level. Las demás viven dentro de `metrics` jsonb.
      //    Por eso metemos todos los scores en metrics (excepto los 5 que
      //    son columnas planas).
      const TOP_LEVEL_SCORES = ["weinsteinScore", "minerviniScore", "riskScore", "rsRating", "totalScore"];
      const topLevelScores = Object.fromEntries(
        Object.entries(scenario.scores).filter(([k]) => TOP_LEVEL_SCORES.includes(k)),
      );
      const metricsScores = Object.fromEntries(
        Object.entries(scenario.scores).filter(([k]) => !TOP_LEVEL_SCORES.includes(k)),
      );
      const rowPayload = {
        owner_id: OWNER,
        scan_id: scanId,
        symbol: scenario.symbol,
        company_name: scenario.name,
        country: "US",
        sector: "Test",
        industry: "Test",
        theme: OWNER,
        rank_index: SCENARIOS.indexOf(scenario) + 1,
        total_score: Object.values(scenario.scores).reduce((a, b) => a + b, 0) / Object.values(scenario.scores).length,
        // top-level: solo los scores que tienen columna en la tabla.
        ...topLevelScores,
        // jsonb: todo lo demás.
        metrics: {
          percentileScope: "final",
          ...metricsScores,
          // Para coherencia, también guardamos los top-level aquí dentro.
          ...topLevelScores,
        },
        raw: scenario.scores,
      };
      const inserted = await supabaseRequest("scan_results", {
        method: "POST",
        body: [rowPayload],
        prefer: "return=representation",
      });
      expect(Array.isArray(inserted)).toBe(true);
      expect(inserted.length).toBe(1);
      const persisted = inserted[0];
      console.log(`       DB persistido: ${persisted.symbol}  rank=${persisted.rank_index}  percentileScope=${persisted.metrics?.percentileScope}`);

      // 4. Verifica que la fila persistida tiene los scores correctos en metrics.
      for (const [k, v] of Object.entries(scenario.scores)) {
        expect(persisted.metrics[k]).toBe(v);
      }

      results[`p2-${scenario.expectedRule.key}`] = `OK`;
    }, 30_000);
  }

  it("summary: al menos 3 reglas disparadas en total", () => {
    const okCount = Object.values(results).filter((v) => v === "OK").length;
    console.log(`     Total reglas disparadas OK: ${okCount}/3`);
    expect(okCount).toBe(3);
  }, 5_000);
});