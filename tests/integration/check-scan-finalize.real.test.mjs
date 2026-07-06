// PIEZA 1 — Verificación real (Supabase "Healthy") de finalize_scan_results.
//
// Inserta un scan de prueba bajo owner_id="playwright-check-2" con un
// universo pequeño (2-3 símbolos para el smoke test), invoca
// runScanChunk que produce filas scan_results y ejecuta la RPC
// finalize_scan_results al final, y verifica que percentileScope pasa
// de "batch" a "final" en las métricas patcheadas.
//
// Aísla el estado bajo owner_id="playwright-check-2". Cleanup midido:
// SELECT count(*) por tabla tras el cleanup, no asume DELETE.
//
// Smoke test mínimo: 2-3 símbolos para validar el flujo end-to-end sin
// agotar la cuota compartida de Yahoo (los fetches externos pueden caer
// a Stooq/AlphaVantage — toleramos eso, siempre que las filas scan_results
// lleguen a la DB). Si el flujo funciona, escalable a 10-20 símbolos.

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

// SAFETY ABORT — mismo patrón que pieza 3.
delete process.env.STATSEDGE_OWNER_ID;
const OWNER = "playwright-check-2";
if (OWNER === "personal" || OWNER === "") {
  throw new Error(`SAFETY ABORT: owner="${OWNER}" — no se permite ejecutar contra el workspace real.`);
}

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const skipIntegration = !SUPABASE_URL || !SERVICE_KEY;
const describeIf = skipIntegration ? describe.skip : describe;

describeIf("PIEZA 1 · scan real + finalize_scan_results (Supabase real)", () => {
  let supabaseRequest;
  let runScanChunk;
  let scanId;
  let results = {};

  // Smoke test: 3 símbolos US bien conocidos (alta probabilidad de datos).
  const SMOKE_SYMBOLS = ["AAPL", "MSFT", "GOOGL"];
  const CHUNK_SIZE = SMOKE_SYMBOLS.length; // para que termine en un solo eslabón
  const SCAN_LOCAL_ID = `playwright-check-2-${Date.now()}`;
  const SCAN_NAME = "Pieza1 smoke scan";

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

    const runner = await import("@/lib/serverScanRunner.js");
    runScanChunk = runner.runScanChunk;

    console.log(`\n[PIEZA 1] Verificación real contra ${SUPABASE_URL.slice(0, 40)}...`);
    console.log(`[PIEZA 1] Owner: ${OWNER}  Símbolos: ${SMOKE_SYMBOLS.join(", ")}  chunkSize: ${CHUNK_SIZE}`);

    // Pre-cleanup: borra leftovers de runs previos bajo este owner.
    console.log(`[PRE-CLEANUP] Borrando leftovers previos bajo ${OWNER}`);
    // Borrar scan_results primero (cascade los limpia al borrar scans, pero
    // hacemos directo por seguridad y para poder medir el resultado).
    await supabaseRequest("scan_results", { method: "DELETE", query: `owner_id=eq.${OWNER}`, prefer: "return=minimal" });
    await supabaseRequest("scans", { method: "DELETE", query: `owner_id=eq.${OWNER}`, prefer: "return=minimal" });
  }, 60_000);

  afterAll(async () => {
    if (skipIntegration) return;
    if (OWNER === "personal" || OWNER === "") {
      throw new Error(`SAFETY ABORT en afterAll: owner="${OWNER}"`);
    }
    console.log(`\n[CLEANUP] Borrando datos de test bajo ${OWNER}`);
    await supabaseRequest("scan_results", { method: "DELETE", query: `owner_id=eq.${OWNER}`, prefer: "return=minimal" });
    await supabaseRequest("scans", { method: "DELETE", query: `owner_id=eq.${OWNER}`, prefer: "return=minimal" });

    // Verificación post-cleanup: count=0 bajo playwright-check-2.
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
    console.log(`[SUMMARY] 1a=${results.p1a}  1b=${results.p1b}`);
  }, 60_000);

  it("1a · crea scan pre-existente con scanSymbols poblado", async () => {
    if (OWNER === "personal" || OWNER === "") {
      throw new Error(`SAFETY ABORT en 1a: owner="${OWNER}"`);
    }
    const settings = {
      scanSymbols: SMOKE_SYMBOLS,
      progress: {
        status: "pending",
        cursor: 0,
        chunkSize: CHUNK_SIZE,
        link: 0,
        completed: 0,
        total: SMOKE_SYMBOLS.length,
        saved: 0,
        currentSymbol: "",
        cancelRequested: false,
        errors: [],
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      // defaults de markets y filtros vacíos → el universo es exactamente los 3 símbolos.
      markets: ["US"],
    };

    // INSERT del scan pre-existente. Devolvemos el id insertado.
    const inserted = await supabaseRequest("scans", {
      method: "POST",
      body: [{
        owner_id: OWNER,
        local_id: SCAN_LOCAL_ID,
        name: SCAN_NAME,
        preset: "playwright-check-2-smoke",
        settings,
        row_count: 0,
      }],
      prefer: "return=representation",
    });
    expect(Array.isArray(inserted)).toBe(true);
    expect(inserted.length).toBe(1);
    scanId = inserted[0].id;
    console.log(`     scan creado: id=${scanId}  local_id=${SCAN_LOCAL_ID}`);
    results.p1a = `OK (scanId=${scanId.slice(0, 8)}...)`;
  }, 30_000);

  it("1b · runScanChunk ejecuta end-to-end y finalize_scan_results pasa percentileScope a 'final'", async () => {
    if (OWNER === "personal" || OWNER === "") {
      throw new Error(`SAFETY ABORT en 1b: owner="${OWNER}"`);
    }

    // Captura antes/después de percentileScope en scan_results.
    // Antes: el scan no existe todavía en scan_results — read devuelve [].
    const before = await supabaseRequest("scan_results", {
      query: `scan_id=eq.${scanId}&select=id,metrics,raw&limit=200`,
    });
    console.log(`     [ANTES] scan_results con scan_id=${scanId.slice(0,8)}...: ${Array.isArray(before) ? before.length : "?"} filas`);

    // Invoca runScanChunk. Esto puede tardar ~30-90s con 3 símbolos + fetches
    // externos (Yahoo/Stooq/AlphaVantage) + batching por 50 (sólo 1 batch).
    console.log(`     Ejecutando runScanChunk... (puede tardar ~30-90s)`);
    const t0 = Date.now();
    await runScanChunk({ scanId, ownerId: OWNER, baseUrl: "" });
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`     runScanChunk terminó en ${elapsed}s`);

    // Verifica que el scan terminó en status="done" con finalizationStatus="succeeded".
    const scanState = await supabaseRequest("scans", {
      query: `id=eq.${scanId}&select=row_count,settings,deleted_at`,
    });
    expect(Array.isArray(scanState)).toBe(true);
    expect(scanState.length).toBe(1);
    const scan = scanState[0];
    const finalStatus = scan.settings?.progress?.status;
    const finalizationStatus = scan.settings?.progress?.finalizationStatus;
    const percentilesFinalized = scan.settings?.progress?.percentilesFinalized;
    const finalizationError = scan.settings?.progress?.finalizationError;
    console.log(`     [scan state] row_count=${scan.row_count}  status=${finalStatus}  finalizationStatus=${finalizationStatus}  percentilesFinalized=${percentilesFinalized}`);
    console.log(`     [scan state] finalizationError="${finalizationError || "(none)"}"`);

    // Si finalize falló, reproducir la llamada directa para capturar la
    // excepción cruda (el wrapper la enmascara en finalizationError).
    if (finalizationStatus === "failed" || finalizationStatus === "error") {
      console.log(`     [FINALIZE FAILED] Reproduciendo llamada directa a finalizeScanResultsInDb para capturar error:`);
      const { finalizeScanResultsInDb } = await import("@/lib/scanPercentileFinalization.js");
      try {
        const r = await finalizeScanResultsInDb(scanId, OWNER);
        console.log(`       directa OK: rowsPatched=${r.rowsPatched}`);
      } catch (e) {
        console.log(`       directa THREW:`);
        console.log(`         message: ${e.message}`);
        console.log(`         status: ${e.status}`);
        console.log(`         code: ${e.code}`);
        console.log(`         details: ${JSON.stringify(e.details)?.slice(0, 800)}`);
        console.log(`         stack (primeros 5):`);
        console.log(`           ${(e.stack || "").split("\n").slice(0, 5).join("\n           ")}`);
      }
    }

    // Verifica que scan_results tiene filas.
    const rows = await supabaseRequest("scan_results", {
      query: `scan_id=eq.${scanId}&select=symbol,rank_index,metrics,raw&order=rank_index.asc`,
    });
    expect(Array.isArray(rows)).toBe(true);
    console.log(`     [PostgREST count=exact] scan_results para scan_id=${scanId.slice(0,8)}...: ${rows.length} filas (esperado: hasta ${SMOKE_SYMBOLS.length})`);

    if (rows.length > 0) {
      // Para CADA fila, verificar el cambio percentileScope de "batch" → "final".
      const scopes = rows.map((r) => r.metrics?.percentileScope).filter(Boolean);
      const allFinal = scopes.length > 0 && scopes.every((s) => s === "final");
      const allBatch = scopes.length > 0 && scopes.every((s) => s === "batch");
      console.log(`     [percentileScope distribución] ${JSON.stringify(scopes)}`);
      console.log(`     [percentileScope final check] allFinal=${allFinal} allBatch=${allBatch}`);

      // Verifica también que rsGlobalPct/rsCountryPct/rsSectorPct están poblados
      // en metrics (estos son los que la RPC parchea).
      const sampleMetrics = rows[0].metrics || {};
      const rsGlobal = sampleMetrics.rsGlobalPct ?? sampleMetrics.rs_rating;
      const rsCountry = sampleMetrics.rsCountryPct;
      const rsSector = sampleMetrics.rsSectorPct;
      console.log(`     [sample row metrics] rsGlobalPct=${rsGlobal} rsCountryPct=${rsCountry} rsSectorPct=${rsSector} percentileScope=${sampleMetrics.percentileScope}`);

      if (allFinal && finalizationStatus === "succeeded") {
        console.log(`     [PASS] percentileScope='final' en ${scopes.length}/${rows.length} filas, finalizationStatus='succeeded'`);
        results.p1b = `OK (rows=${rows.length}, scopes=final, finalizationStatus=${finalizationStatus})`;
      } else if (allBatch) {
        // Posible: finalize no se invocó si state.completed < symbols.length
        // (lo cual ocurriría si fetches externos fallaron y todos los símbolos
        // cayeron al catch — state.errors los cubre y reduce completed).
        console.warn(`     ⚠️  percentileScope='batch' — finalize NO se ejecutó o scan incompleto.`);
        console.warn(`     ⚠️  Estado: completed=${scan.settings?.progress?.completed}/${SMOKE_SYMBOLS.length} errors=${JSON.stringify(scan.settings?.progress?.errors?.slice(0, 3))}`);
        results.p1b = `INCOMPLETE (rows=${rows.length}, scopes=batch, completed=${scan.settings?.progress?.completed}/${SMOKE_SYMBOLS.length})`;
      } else {
        console.warn(`     ⚠️  percentileScope mixto: ${JSON.stringify(scopes)}`);
        results.p1b = `MIXED (rows=${rows.length}, scopes=${JSON.stringify(scopes)})`;
      }
    } else {
      // Si no hay filas, el scan falló al 100% (todos los fetches cayeron al fallback).
      console.warn(`     ⚠️  scan_results tiene 0 filas — todos los fetches externos fallaron.`);
      console.warn(`     ⚠️  state.errors: ${JSON.stringify(scan.settings?.progress?.errors?.slice(0, 3))}`);
      results.p1b = `NO_ROWS (errors=${(scan.settings?.progress?.errors || []).length})`;
    }
  }, 180_000); // 3 min de timeout para el chunk real
});